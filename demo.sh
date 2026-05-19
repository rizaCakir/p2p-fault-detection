#!/usr/bin/env bash
# demo.sh — launches the full P2P fault detection demo
#
# Layout (tmux windows):
#   infra     — brokers (left) | backend (right)
#   dashboard — npm run dev
#   zone1     — esp_01..esp_04  (2×2 pane grid)
#   zone2     — esp_05..esp_08  (2×2 pane grid)
#   zone3     — esp_09..esp_12  (2×2 pane grid)
#
# Usage:
#   ./demo.sh          start demo
#   ./demo.sh stop     tear everything down

set -euo pipefail

SESSION="p2p-demo"
ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
DASH="$ROOT/dashboard"
SIM="$ROOT/sim"
PYTHON="$SIM/.venv/bin/python"

# ── stop mode ─────────────────────────────────────────────────────────────
if [[ "${1:-}" == "stop" ]]; then
    echo "Stopping demo..."
    tmux kill-session -t "$SESSION" 2>/dev/null || true
    (cd "$SIM" && podman compose down --remove-orphans 2>/dev/null || true)
    echo "Done."
    exit 0
fi

# ── dependency checks ─────────────────────────────────────────────────────
need() {
    command -v "$1" >/dev/null 2>&1
}

if ! need tmux; then
    echo "tmux is required for this script."
    read -rp "Install now via pacman? [Y/n] " ans
    if [[ "${ans:-Y}" =~ ^[Yy]$ ]]; then
        sudo pacman -S --noconfirm tmux
    else
        echo "Aborting. Install tmux manually: sudo pacman -S tmux"
        exit 1
    fi
fi

need podman    || { echo "error: podman not found";    exit 1; }
need alacritty || { echo "error: alacritty not found"; exit 1; }

# ── one-time build / venv setup ───────────────────────────────────────────
if [[ ! -x "$PYTHON" ]]; then
    echo "Setting up Python venv..."
    (cd "$SIM" && python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt)
fi

if [[ ! -f "$BACKEND/p2pfault" ]]; then
    echo "Building backend..."
    (cd "$BACKEND" && go build -o p2pfault .)
fi

# ── kill any previous session ─────────────────────────────────────────────
tmux kill-session -t "$SESSION" 2>/dev/null && sleep 0.3 || true

# ── helpers ───────────────────────────────────────────────────────────────
send() { tmux send-keys -t "$1" "$2" Enter; }

# node_cmd <id> <zone> <primary-port> <secondary-port>
node_cmd() {
    echo "sleep 8 && cd '$SIM' && $PYTHON node_sim.py \
--node-id $1 --zone $2 \
--primary localhost --port $3 \
--secondary localhost --secondary-port $4"
}

# make_zone <zone-name> <id1> <id2> <id3> <id4>
# Creates a window with a 2×2 pane grid, one node per pane.
make_zone() {
    local zone=$1; shift
    local ids=("$@")
    tmux new-window -t "$SESSION" -n "$zone"

    # Build 2×2 grid
    #   .0 (top-left)    .2 (top-right)
    #   .1 (bot-left)    .3 (bot-right)
    tmux split-window   -t "$SESSION:$zone"    -v
    tmux split-window   -t "$SESSION:$zone.0"  -h
    tmux split-window   -t "$SESSION:$zone.1"  -h
    tmux select-layout  -t "$SESSION:$zone"    tiled

    send "$SESSION:$zone.0" "$(node_cmd "${ids[0]}" "$zone" 1883 1884)"
    send "$SESSION:$zone.1" "$(node_cmd "${ids[1]}" "$zone" 1884 1883)"
    send "$SESSION:$zone.2" "$(node_cmd "${ids[2]}" "$zone" 1883 1884)"
    send "$SESSION:$zone.3" "$(node_cmd "${ids[3]}" "$zone" 1884 1883)"
}

# ── infra window: brokers (left) | backend (right) ───────────────────────
tmux new-session -d -s "$SESSION" -n infra
send "$SESSION:infra" "cd '$SIM' && podman compose up"
tmux split-window -t "$SESSION:infra" -h
send "$SESSION:infra" \
    "sleep 5 && cd '$BACKEND' && mkdir -p data && \
MQTT_BROKER_1=tcp://localhost:1883 \
MQTT_BROKER_2=tcp://localhost:1884 \
SBC_NODE_ID=sbc-demo \
LISTEN_ADDR=:8080 \
DB_PATH=./data/events.db \
./p2pfault"

# ── dashboard window ──────────────────────────────────────────────────────
tmux new-window -t "$SESSION" -n dashboard
send "$SESSION:dashboard" "cd '$DASH' && npm run dev"

# ── zone windows (12 nodes total, 4 per zone) ─────────────────────────────
make_zone zone1  esp_01 esp_02 esp_03 esp_04
make_zone zone2  esp_05 esp_06 esp_07 esp_08
make_zone zone3  esp_09 esp_10 esp_11 esp_12

# ── focus infra and attach ────────────────────────────────────────────────
tmux select-window -t "$SESSION:infra"

echo ""
echo "  Demo session: $SESSION"
echo "  Windows:  infra | dashboard | zone1 | zone2 | zone3"
echo "  Nodes:    12 ESP nodes (4 per zone)"
echo "  Brokers:  localhost:1883 (SBC-1)  localhost:1884 (SBC-2)"
echo "  Dashboard: http://localhost:3000"
echo ""
echo "  Switch windows: Ctrl-b 1-5   |   Detach: Ctrl-b d"
echo "  To stop: ./demo.sh stop"
echo ""

exec tmux attach-session -t "$SESSION"
