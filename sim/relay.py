#!/usr/bin/env python3
"""
Cross-broker alert relay for the P2P fault detection system.

Subscribes to facility/+/alerts on all three SBC brokers and
forwards each unique message to the other two brokers.

Deduplication is exact: the MD5 hash of the raw payload bytes is used
as the dedup key.  Because the ESP sets a millisecond timestamp on every
publish, the exact same alert event produces identical bytes on every broker
it arrives at → same hash → forwarded only once.

Usage:
    # rootful Podman (bridge IPs routable from host)
    python relay.py

    # rootless Podman (use port mappings)
    python relay.py --port1 1883 --port2 1884 --port3 1885

In production each SBC would run its own relay instance.  Here a single
process connected to all three brokers is equivalent.
"""

import argparse
import hashlib
import json
import threading
import time

import paho.mqtt.client as mqtt

TOPIC_SUB = "facility/+/alerts"
DEDUP_TTL = 30.0  # seconds


class Relay:
    def __init__(self, brokers: list[tuple[str, int]]):
        self._brokers = brokers
        self._clients: list[mqtt.Client] = []
        self._connected: list[bool] = [False] * len(brokers)
        self._seen: dict[str, float] = {}
        self._lock = threading.Lock()

    def _is_dup(self, payload_bytes: bytes) -> bool:
        h = hashlib.md5(payload_bytes).hexdigest()
        now = time.monotonic()
        with self._lock:
            if h in self._seen and now - self._seen[h] < DEDUP_TTL:
                return True
            self._seen[h] = now
            return False

    def _cleanup_loop(self):
        while True:
            time.sleep(60)
            cutoff = time.monotonic() - DEDUP_TTL
            with self._lock:
                stale = [k for k, t in self._seen.items() if t < cutoff]
                for k in stale:
                    del self._seen[k]

    def _make_client(self, idx: int) -> mqtt.Client:
        host, port = self._brokers[idx]

        def on_connect(client, _ud, _flags, rc):
            if rc == 0:
                self._connected[idx] = True
                print(f"[relay] SBC-{idx+1} connected ({host}:{port})", flush=True)
                client.subscribe(TOPIC_SUB, qos=1)
            else:
                self._connected[idx] = False
                print(f"[relay] SBC-{idx+1} refused rc={rc}", flush=True)

        def on_disconnect(_client, _ud, rc):
            self._connected[idx] = False
            if rc != 0:
                print(f"[relay] SBC-{idx+1} disconnected (rc={rc}) — will reconnect", flush=True)

        def on_message(_client, _ud, msg):
            raw = msg.payload
            try:
                node_id = json.loads(raw).get("node_id", "?")
            except Exception:
                node_id = "?"
            print(f"[relay] recv SBC-{idx+1}: {msg.topic}  node={node_id}", flush=True)

            if self._is_dup(raw):
                print(f"[relay]   dup — dropped", flush=True)
                return

            for i, c in enumerate(self._clients):
                if i == idx:
                    continue
                if self._connected[i]:
                    c.publish(msg.topic, raw, qos=1, retain=False)
                    print(f"[relay]   → SBC-{i+1}", flush=True)
                else:
                    print(f"[relay]   SBC-{i+1} not connected — skipped", flush=True)

        c = mqtt.Client(client_id=f"relay-sbc{idx+1}", clean_session=True)
        c.on_connect    = on_connect
        c.on_disconnect = on_disconnect
        c.on_message    = on_message
        c.reconnect_delay_set(min_delay=1, max_delay=30)
        return c

    def start(self):
        for i, (host, port) in enumerate(self._brokers):
            c = self._make_client(i)
            self._clients.append(c)
            c.connect_async(host, port, keepalive=60)
            c.loop_start()
        threading.Thread(target=self._cleanup_loop, daemon=True).start()
        print("[relay] starting — waiting for broker connections…", flush=True)

    def stop(self):
        for c in self._clients:
            c.loop_stop()
            c.disconnect()


def main():
    p = argparse.ArgumentParser(description="Cross-broker MQTT alert relay")
    p.add_argument("--sbc1",  default="192.168.1.100")
    p.add_argument("--sbc2",  default="192.168.1.101")
    p.add_argument("--sbc3",  default="192.168.1.102")
    p.add_argument("--port1", type=int, default=1883)
    p.add_argument("--port2", type=int, default=1883)
    p.add_argument("--port3", type=int, default=1883)
    args = p.parse_args()

    relay = Relay([
        (args.sbc1, args.port1),
        (args.sbc2, args.port2),
        (args.sbc3, args.port3),
    ])
    relay.start()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        relay.stop()


if __name__ == "__main__":
    main()
