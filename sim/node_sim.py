#!/usr/bin/env python3
"""
ESP32 node simulator for end-to-end P2P protocol testing.

Implements the same MQTT topics, JSON payloads, state machine, timing
constants, and dual-broker failover logic as the firmware so the full
wireless communication behaviour can be verified on Linux without hardware.

Broker addresses — two modes:
  Rootful Podman (bridge IPs routable from host):
    --primary 192.168.1.100 --secondary 192.168.1.101  (both port 1883)

  Rootless Podman (use port mappings):
    --primary localhost --port 1883 --secondary localhost --secondary-port 1884

Usage (each in its own terminal):
    # rootful
    python node_sim.py --node-id esp_01 --zone zone1
    python node_sim.py --node-id esp_02 --zone zone1 --primary 192.168.1.101
    python node_sim.py --node-id esp_03 --zone zone2

    # rootless
    python node_sim.py --node-id esp_01 --zone zone1 \\
        --primary localhost --port 1883 \\
        --secondary localhost --secondary-port 1884

Interactive commands:
    gas_warning   inject a GAS_WARNING fault (val=1800)
    gas_critical  inject a GAS_CRITICAL fault (val=3000)
    flame         inject a FLAME fault
    clear         clear local fault and return to IDLE
    status        print current FSM state and active broker
    quit          exit
"""

import argparse
import json
import sys
import threading
import time
from datetime import datetime
from enum import Enum

import paho.mqtt.client as mqtt

# ── Constants (mirror firmware config.h) ──────────────────────────────────────

TELEMETRY_INTERVAL   = 5.0   # seconds  (TELEMETRY_INTERVAL_MS)
PEER_ALARM_TIMEOUT   = 30.0  # seconds  (PEER_ALARM_TIMEOUT_MS)
RECONNECT_BASE_DELAY = 1.0   # seconds  (RECONNECT_BASE_DELAY_MS)
RECONNECT_MAX_DELAY  = 30.0  # seconds  (RECONNECT_MAX_DELAY_MS)
BROKER_SWITCH_AFTER  = 3     # failures before switching broker (mirrors firmware)

GAS_VAL_WARNING  = 1800
GAS_VAL_CRITICAL = 3000


# ── FSM enums (mirror firmware AlertManager.h) ────────────────────────────────

class NodeState(Enum):
    IDLE              = "IDLE"
    FAULT_DETECTED    = "FAULT_DETECTED"
    PEER_ALARM_ACTIVE = "PEER_ALARM_ACTIVE"

class FaultType(Enum):
    NONE         = "none"
    GAS_WARNING  = "gas_warning"
    GAS_CRITICAL = "gas_critical"
    FLAME        = "flame"


# ── Node simulator ────────────────────────────────────────────────────────────

class NodeSim:
    def __init__(self, node_id: str, zone_id: str,
                 primary: str, secondary: str,
                 port: int, secondary_port: int):
        self.node_id = node_id
        self.zone_id = zone_id

        # Broker failover state — mirrors MqttTransceiver dual-broker logic
        self._brokers        = [(primary, port), (secondary, secondary_port)]
        self._broker_idx     = 0          # 0 = primary, 1 = secondary
        self._failed_attempts = 0
        self._reconnect_delay = RECONNECT_BASE_DELAY
        self._broker_lock    = threading.Lock()

        # Topics — identical to firmware config.h macros
        self.TOPIC_ALERTS    = f"facility/{zone_id}/alerts"
        self.TOPIC_TELEMETRY = f"facility/{zone_id}/{node_id}/telemetry"
        self.TOPIC_SUBSCRIBE = "facility/+/alerts"

        # FSM state
        self._lock           = threading.Lock()
        self._state          = NodeState.IDLE
        self._fault          = FaultType.NONE
        self._peer_alarm_at: float | None = None
        self._alerting_peers: set[str]    = set()  # peers currently in FAULT

        self._client = mqtt.Client(client_id=f"sim-{node_id}", clean_session=True)
        self._client.on_connect    = self._on_connect
        self._client.on_message    = self._on_message
        self._client.on_disconnect = self._on_disconnect

    # ── Logging ───────────────────────────────────────────────────────────────

    def _ts(self) -> str:
        return datetime.now().strftime("%H:%M:%S.%f")[:-3]

    def _log(self, msg: str):
        print(f"[{self._ts()}] [{self.node_id:8s}] {msg}", flush=True)

    @property
    def _active_broker(self) -> tuple[str, int]:
        return self._brokers[self._broker_idx]

    @property
    def _active_broker_str(self) -> str:
        host, port = self._brokers[self._broker_idx]
        return f"{host}:{port}"

    # ── MQTT callbacks ────────────────────────────────────────────────────────

    def _on_connect(self, client, _userdata, _flags, rc):
        if rc == 0:
            with self._broker_lock:
                self._failed_attempts = 0
                self._reconnect_delay = RECONNECT_BASE_DELAY
            self._log(f"Connected → {self._active_broker_str}")
            client.subscribe(self.TOPIC_SUBSCRIBE, qos=1)
        else:
            self._log(f"Connection refused rc={rc} (broker={self._active_broker_str})")
            self._handle_connect_failure()

    def _on_disconnect(self, _client, _userdata, rc):
        if rc != 0:  # unexpected disconnect
            self._log(f"Lost connection to {self._active_broker_str} (rc={rc})")
            self._handle_connect_failure()

    def _handle_connect_failure(self):
        """Mirror MqttTransceiver::reconnectMqtt() — exponential backoff + broker switch."""
        with self._broker_lock:
            self._failed_attempts += 1
            label = "primary" if self._broker_idx == 0 else "secondary"
            self._log(f"  Attempt {self._failed_attempts} on {label} broker failed")

            if self._failed_attempts >= BROKER_SWITCH_AFTER:
                self._broker_idx      = 1 - self._broker_idx  # toggle
                self._failed_attempts = 0
                new_label = "primary" if self._broker_idx == 0 else "secondary"
                self._log(f"  ⚡ Switching to {new_label} broker → {self._active_broker_str}")

            self._reconnect_delay = min(
                self._reconnect_delay * 2, RECONNECT_MAX_DELAY
            )
            delay = self._reconnect_delay

        time.sleep(delay)
        host, port = self._active_broker
        try:
            self._client.connect_async(host, port, keepalive=60)
        except Exception as e:
            self._log(f"  Reconnect error: {e}")

    def _on_message(self, _client, _userdata, msg):
        try:
            payload = json.loads(msg.payload)
        except Exception:
            return

        sender = payload.get("node_id", "unknown")
        if sender == self.node_id:
            return  # ignore own retained messages

        raw_type = payload.get("type", "none")
        val      = payload.get("val", 0)

        try:
            fault = FaultType(raw_type)
        except ValueError:
            return

        if fault == FaultType.NONE:
            self._handle_peer_clear(sender)
            return

        self._log(f"PEER ALERT ← {sender}  type={raw_type}  val={val}")
        self._handle_peer_alert(fault, sender)

    # ── FSM transitions (mirror AlertManager.cpp) ─────────────────────────────

    def _handle_peer_alert(self, fault: FaultType, sender: str):
        """Mirror AlertManager::onPeerAlert() — local fault has priority."""
        with self._lock:
            self._alerting_peers.add(sender)
            if self._state == NodeState.FAULT_DETECTED:
                self._log("  └─ ignored (local fault has priority)")
                return

            self._peer_alarm_at = time.monotonic()
            self._fault = fault

            if self._state != NodeState.PEER_ALARM_ACTIVE:
                prev = self._state
                self._state = NodeState.PEER_ALARM_ACTIVE
                self._log(f"  └─ {prev.value} → PEER_ALARM_ACTIVE  "
                          f"(auto-clears in {PEER_ALARM_TIMEOUT}s if peer stays silent)")
            else:
                self._log("  └─ timeout refreshed")

    def _handle_peer_clear(self, sender: str):
        """Immediately clear PEER_ALARM once every alerting peer has recovered."""
        with self._lock:
            self._alerting_peers.discard(sender)
            if self._state != NodeState.PEER_ALARM_ACTIVE or self._alerting_peers:
                return
            self._state         = NodeState.IDLE
            self._fault         = FaultType.NONE
            self._peer_alarm_at = None
        self._log(f"PEER CLEAR ← {sender}  → IDLE ✓")

    def inject_fault(self, fault: FaultType, val: int):
        """Mirror main.cpp sensor-poll block — only publishes on state change (fix #1)."""
        with self._lock:
            if self._state == NodeState.FAULT_DETECTED and self._fault == fault:
                self._log(f"Already {fault.value} — no duplicate publish ✓")
                return
            prev        = self._state
            self._state = NodeState.FAULT_DETECTED
            self._fault = fault

        self._log(f"LOCAL FAULT  type={fault.value}  val={val}")
        self._log(f"  └─ {prev.value} → FAULT_DETECTED")
        self._publish_alert(fault, val)

    def clear_fault(self):
        """Mirror AlertManager::onClear()."""
        with self._lock:
            if self._state != NodeState.FAULT_DETECTED:
                self._log(f"Cannot clear from {self._state.value}")
                return
            prev        = self._state
            self._state = NodeState.IDLE
            self._fault = FaultType.NONE

        self._log(f"CLEAR  {prev.value} → IDLE")
        self._publish_alert(FaultType.NONE, 0)  # clears retained message on broker

    def _peer_timeout_loop(self):
        """Mirror AlertManager::update() — auto-expire peer alarm (fix #2)."""
        while True:
            time.sleep(1.0)
            with self._lock:
                if (self._state == NodeState.PEER_ALARM_ACTIVE
                        and self._peer_alarm_at is not None
                        and time.monotonic() - self._peer_alarm_at >= PEER_ALARM_TIMEOUT):
                    self._state         = NodeState.IDLE
                    self._fault         = FaultType.NONE
                    self._peer_alarm_at = None
                    do_log = True
                else:
                    do_log = False
            if do_log:
                self._log("PEER ALARM EXPIRED → IDLE ✓")

    def _telemetry_loop(self):
        """Publish periodic telemetry — mirrors TELEMETRY_INTERVAL_MS."""
        state_to_int = {
            NodeState.IDLE: 0, NodeState.FAULT_DETECTED: 1, NodeState.PEER_ALARM_ACTIVE: 2
        }
        while True:
            time.sleep(TELEMETRY_INTERVAL)
            with self._lock:
                local_fault = self._state == NodeState.FAULT_DETECTED
                gas_val = (GAS_VAL_WARNING  if (local_fault and self._fault == FaultType.GAS_WARNING)  else
                           GAS_VAL_CRITICAL if (local_fault and self._fault == FaultType.GAS_CRITICAL) else 0)
                payload = {
                    "node_id":   self.node_id,
                    "zone_id":   self.zone_id,
                    "gas_val":   gas_val,
                    "flame":     local_fault and self._fault == FaultType.FLAME,
                    "state":     state_to_int[self._state],
                    "timestamp": int(time.time() * 1000),
                }
            self._client.publish(self.TOPIC_TELEMETRY, json.dumps(payload), qos=0)
            self._log(f"telemetry  state={payload['state']}  gas={payload['gas_val']}  "
                      f"broker={self._active_broker_str}")

    # ── MQTT publish ──────────────────────────────────────────────────────────

    def _publish_alert(self, fault: FaultType, val: int):
        payload = {
            "node_id":   self.node_id,
            "zone_id":   self.zone_id,
            "type":      fault.value,
            "val":       val,
            "timestamp": int(time.time() * 1000),
        }
        self._client.publish(self.TOPIC_ALERTS, json.dumps(payload), qos=1, retain=False)
        self._log(f"  └─ published → {self.TOPIC_ALERTS}")

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def start(self):
        host, port = self._active_broker
        self._client.connect_async(host, port, keepalive=60)
        self._client.loop_start()
        threading.Thread(target=self._telemetry_loop,    daemon=True).start()
        threading.Thread(target=self._peer_timeout_loop, daemon=True).start()
        p_host, p_port = self._brokers[0]
        s_host, s_port = self._brokers[1]
        self._log(f"Node ready  zone={self.zone_id}  "
                  f"primary={p_host}:{p_port}  secondary={s_host}:{s_port}")
        self._log("Commands: gas_warning | gas_critical | flame | clear | status | quit")

    def status(self):
        with self._lock:
            state = self._state.value
            fault = self._fault.value
        label = "primary" if self._broker_idx == 0 else "secondary"
        self._log(f"state={state}  fault={fault}  "
                  f"broker={self._active_broker_str} ({label})")

    def stop(self):
        self._client.loop_stop()
        self._client.disconnect()


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="ESP32 node simulator — mirrors firmware FSM and dual-broker failover",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Rootful Podman (bridge IPs routable):\n"
            "  python node_sim.py --node-id esp_01 --zone zone1\n\n"
            "Rootless Podman (port mappings):\n"
            "  python node_sim.py --node-id esp_01 --zone zone1 \\\n"
            "      --primary localhost --port 1883 \\\n"
            "      --secondary localhost --secondary-port 1884"
        )
    )
    parser.add_argument("--node-id",        default="esp_01",
                        help="Unique node identifier")
    parser.add_argument("--zone",           default="zone1",
                        help="Zone identifier")
    parser.add_argument("--primary",        default="192.168.1.100",
                        help="Primary broker host (SBC-1)")
    parser.add_argument("--port",           type=int, default=1883,
                        help="Primary broker port")
    parser.add_argument("--secondary",      default="192.168.1.101",
                        help="Secondary broker host (SBC-2)")
    parser.add_argument("--secondary-port", type=int, default=1883,
                        help="Secondary broker port (use 1884 with rootless port mapping)")
    args = parser.parse_args()

    node = NodeSim(args.node_id, args.zone,
                   args.primary, args.secondary,
                   args.port, args.secondary_port)
    node.start()

    try:
        for line in sys.stdin:
            cmd = line.strip().lower()
            if cmd == "gas_warning":
                node.inject_fault(FaultType.GAS_WARNING, GAS_VAL_WARNING)
            elif cmd == "gas_critical":
                node.inject_fault(FaultType.GAS_CRITICAL, GAS_VAL_CRITICAL)
            elif cmd == "flame":
                node.inject_fault(FaultType.FLAME, 1)
            elif cmd == "clear":
                node.clear_fault()
            elif cmd == "status":
                node.status()
            elif cmd in ("quit", "exit", "q"):
                break
            elif cmd:
                print("Unknown: gas_warning | gas_critical | flame | clear | status | quit")
    except KeyboardInterrupt:
        pass
    finally:
        node.stop()


if __name__ == "__main__":
    main()
