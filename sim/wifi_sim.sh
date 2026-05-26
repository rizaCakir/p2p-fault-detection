#!/usr/bin/env bash
# wifi_sim.sh — inject / remove WiFi-like impairments on the simulation network
#
# Uses Linux tc(8) + netem on the Podman bridge that backs facility_lan.
# Requires: iproute2 (tc), podman (running), sudo for tc.
#
# Rootful Podman:  bridge is in the root network namespace → sudo tc works.
# Rootless Podman: bridge lives in the user network namespace; sudo tc won't
#   see it. Either run the whole compose as root (sudo podman compose up -d)
#   or apply impairments inside the containers (see --inside flag below).
#
# Usage:
#   ./wifi_sim.sh status                       show current qdisc on bridge
#   ./wifi_sim.sh add [delay_ms] [loss_%]      apply (defaults: 40ms, 2%)
#   ./wifi_sim.sh preset <name>                apply a named scenario
#   ./wifi_sim.sh remove                       restore clean network
#   ./wifi_sim.sh --inside add [delay] [loss]  apply tc inside containers
#                                              (works with rootless Podman)
#
# Presets:
#   good        150ms  ±37ms,  1% loss  – normal indoor WiFi
#   congested   500ms ±125ms,  5% loss  – crowded 2.4 GHz
#   poor       1000ms ±250ms, 15% loss  – edge of coverage
#   critical   2000ms ±500ms, 30% loss  – nearly-disconnected link

set -euo pipefail

COMPOSE_PROJECT="sim"
NETWORK_NAME="${COMPOSE_PROJECT}_facility_lan"
CONTAINERS=("mqtt-sbc1" "mqtt-sbc2" "mqtt-sbc3")

# ── Find the Podman bridge interface ──────────────────────────────────────────
# podman network inspect exposes the interface name directly via NetworkInterface.
# This is different from Docker which uses the network ID prefix.

get_bridge() {
    podman network inspect "$NETWORK_NAME" \
        --format '{{.NetworkInterface}}' 2>/dev/null || {
        echo "ERROR: network '$NETWORK_NAME' not found." >&2
        echo "  Run: podman compose up -d" >&2
        exit 1
    }
}

# ── Apply tc on the host bridge (rootful Podman) ──────────────────────────────

apply_host() {
    local iface="$1" delay_ms="$2" loss_pct="$3"
    local jitter_ms=$(( delay_ms / 4 ))
    sudo tc qdisc del dev "$iface" root 2>/dev/null || true
    sudo tc qdisc add dev "$iface" root netem \
        delay "${delay_ms}ms" "${jitter_ms}ms" distribution normal \
        loss "${loss_pct}%"
    echo "✔ Bridge $iface  delay=${delay_ms}ms ±${jitter_ms}ms  loss=${loss_pct}%"
}

remove_host() {
    local iface="$1"
    sudo tc qdisc del dev "$iface" root 2>/dev/null && \
        echo "✔ Impairment removed from $iface" || \
        echo "  Nothing to remove on $iface"
}

# ── Apply tc inside containers (rootless Podman) ──────────────────────────────
# Requires cap_add: NET_ADMIN and iproute2 inside the container image.
# eclipse-mosquitto:2 is Alpine-based; install iproute2 with:
#   podman exec mqtt-sbc1 apk add --no-cache iproute2

apply_inside() {
    local delay_ms="$1" loss_pct="$2"
    local jitter_ms=$(( delay_ms / 4 ))
    for c in "${CONTAINERS[@]}"; do
        podman exec "$c" sh -c \
            "tc qdisc del dev eth0 root 2>/dev/null; \
             tc qdisc add dev eth0 root netem \
                 delay ${delay_ms}ms ${jitter_ms}ms distribution normal \
                 loss ${loss_pct}%" && \
        echo "✔ $c  delay=${delay_ms}ms ±${jitter_ms}ms  loss=${loss_pct}%"
    done
}

remove_inside() {
    for c in "${CONTAINERS[@]}"; do
        podman exec "$c" tc qdisc del dev eth0 root 2>/dev/null && \
            echo "✔ $c impairment removed" || echo "  $c: nothing to remove"
    done
}

# ── Preset table ──────────────────────────────────────────────────────────────

resolve_preset() {
    case "$1" in
        good)      echo "150  1"  ;;
        congested) echo "500  5"  ;;
        poor)      echo "1000 15" ;;
        critical)  echo "2000 30" ;;
        *)
            echo "Unknown preset '$1'. Choose: good | congested | poor | critical" >&2
            exit 1
            ;;
    esac
}

# ── Entry point ───────────────────────────────────────────────────────────────

INSIDE=false
if [[ "${1:-}" == "--inside" ]]; then
    INSIDE=true
    shift
fi

CMD="${1:-status}"

case "$CMD" in

    add)
        DELAY="${2:-500}"
        LOSS="${3:-5}"
        if $INSIDE; then
            apply_inside "$DELAY" "$LOSS"
        else
            IFACE=$(get_bridge)
            apply_host "$IFACE" "$DELAY" "$LOSS"
        fi
        ;;

    preset)
        read -r DELAY LOSS <<< "$(resolve_preset "${2:-}")"
        if $INSIDE; then
            apply_inside "$DELAY" "$LOSS"
        else
            IFACE=$(get_bridge)
            apply_host "$IFACE" "$DELAY" "$LOSS"
        fi
        ;;

    remove)
        if $INSIDE; then
            remove_inside
        else
            IFACE=$(get_bridge)
            remove_host "$IFACE"
        fi
        ;;

    status)
        if $INSIDE; then
            for c in "${CONTAINERS[@]}"; do
                echo "=== $c (eth0) ==="
                podman exec "$c" tc qdisc show dev eth0 2>/dev/null || echo "  (container not running)"
            done
        else
            IFACE=$(get_bridge)
            echo "Bridge: $IFACE"
            tc qdisc show dev "$IFACE"
        fi
        ;;

    *)
        echo "Usage: $0 [--inside] {status | add [ms] [%] | preset <name> | remove}"
        exit 1
        ;;
esac
