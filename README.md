# P2P Fault Detection Protocol with Decentralized Reporting

BBM460 Senior Design Project — Orhun İnan & Rıza Çakır

A decentralized IoT monitoring and alarm system for industrial environments that detects gas leaks and flame events without relying on a central server.

---

## Table of Contents

- [**Demo**](#demo) ← start here for the presentation
1. [System Architecture](#1-system-architecture)
2. [Hardware Components](#2-hardware-components)
3. [Project Directory Structure](#3-project-directory-structure)
4. [ESP32 Firmware](#4-esp32-firmware)
5. [Go Backend](#5-go-backend)
6. [React Dashboard](#6-react-dashboard)
7. [MQTT Topic Structure](#7-mqtt-topic-structure)
8. [REST API Reference](#8-rest-api-reference)
9. [WebSocket Message Formats](#9-websocket-message-formats)
10. [Setup and Running](#10-setup-and-running)
11. [Configuration Reference](#11-configuration-reference)
12. [Known Gaps and Next Steps](#12-known-gaps-and-next-steps)

---

## Demo

Full end-to-end demo on a single Linux machine — no ESP32 hardware needed.  
**12 sensor nodes · 3 zones · 3 SBC brokers · live dashboard.**

### Node layout

12 nodes across 3 zones. Each node connects to its nearest SBC broker; if that broker fails it switches to its secondary and changes its alert publish topic to match the secondary broker's zone.

Cross-broker alert delivery uses **per-zone `in`-only Mosquitto bridges**: each SBC subscribes to the other two zones' alert topics from their respective brokers. Because bridges are unidirectional (`in` only), no message loops are possible.

| Node | Zone | Primary broker | Secondary broker | Secondary zone |
|------|------|----------------|------------------|----------------|
| esp_01–esp_04 | zone1 | SBC-1 :1883 | SBC-2 :1884 | zone2 |
| esp_05–esp_08 | zone2 | SBC-2 :1884 | SBC-3 :1885 | zone3 |
| esp_09–esp_12 | zone3 | SBC-3 :1885 | SBC-1 :1883 | zone1 |

### Terminal 1 — MQTT broker cluster (3 SBCs)

```bash
cd sim && podman compose up
```

| Container | Simulates | Port |
|-----------|-----------|------|
| `mqtt-sbc1` | Raspberry Pi SBC-1 | 1883 |
| `mqtt-sbc2` | Raspberry Pi SBC-2 | 1884 |
| `mqtt-sbc3` | Raspberry Pi SBC-3 | 1885 |

### Terminal 2 — Go backend

```bash
cd backend && go build -o p2pfault . && mkdir -p data
MQTT_BROKER_1=tcp://localhost:1883 \
MQTT_BROKER_2=tcp://localhost:1884 \
MQTT_BROKER_3=tcp://localhost:1885 \
SBC_NODE_ID=sbc-demo LISTEN_ADDR=:8080 DB_PATH=./data/events.db \
./p2pfault
```

### Terminal 3 — Dashboard

```bash
cd dashboard && npm install && npm run dev
```

Open **http://localhost:3000**.

### Terminals 4–15 — ESP32 nodes (one per terminal)

```bash
# First time only
cd sim && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

```bash
cd sim
# zone1 — primary SBC-1, failover to SBC-2 (publishes to zone2/alerts on failover)
.venv/bin/python node_sim.py --node-id esp_01 --zone zone1 --primary localhost --port 1883 --secondary localhost --secondary-port 1884 --secondary-zone zone2
.venv/bin/python node_sim.py --node-id esp_02 --zone zone1 --primary localhost --port 1883 --secondary localhost --secondary-port 1884 --secondary-zone zone2
.venv/bin/python node_sim.py --node-id esp_03 --zone zone1 --primary localhost --port 1883 --secondary localhost --secondary-port 1884 --secondary-zone zone2
.venv/bin/python node_sim.py --node-id esp_04 --zone zone1 --primary localhost --port 1883 --secondary localhost --secondary-port 1884 --secondary-zone zone2
# zone2 — primary SBC-2, failover to SBC-3 (publishes to zone3/alerts on failover)
.venv/bin/python node_sim.py --node-id esp_05 --zone zone2 --primary localhost --port 1884 --secondary localhost --secondary-port 1885 --secondary-zone zone3
.venv/bin/python node_sim.py --node-id esp_06 --zone zone2 --primary localhost --port 1884 --secondary localhost --secondary-port 1885 --secondary-zone zone3
.venv/bin/python node_sim.py --node-id esp_07 --zone zone2 --primary localhost --port 1884 --secondary localhost --secondary-port 1885 --secondary-zone zone3
.venv/bin/python node_sim.py --node-id esp_08 --zone zone2 --primary localhost --port 1884 --secondary localhost --secondary-port 1885 --secondary-zone zone3
# zone3 — primary SBC-3, failover to SBC-1 (publishes to zone1/alerts on failover)
.venv/bin/python node_sim.py --node-id esp_09 --zone zone3 --primary localhost --port 1885 --secondary localhost --secondary-port 1883 --secondary-zone zone1
.venv/bin/python node_sim.py --node-id esp_10 --zone zone3 --primary localhost --port 1885 --secondary localhost --secondary-port 1883 --secondary-zone zone1
.venv/bin/python node_sim.py --node-id esp_11 --zone zone3 --primary localhost --port 1885 --secondary localhost --secondary-port 1883 --secondary-zone zone1
.venv/bin/python node_sim.py --node-id esp_12 --zone zone3 --primary localhost --port 1885 --secondary localhost --secondary-port 1883 --secondary-zone zone1
```

Dashboard shows **12 nodes** across 3 zones, all **NORMAL**.

---

### Demo scenario 1 — P2P alert propagation (facility-wide)

In the `esp_01` terminal (zone1, on SBC-1):
```
gas_critical
```

**Dashboard:**
- `esp_01` → red, blinking → `FAULT`
- All other 11 nodes → orange, blinking → `PEER ALARM`  
  (SBC-2 and SBC-3 pull `facility/zone1/alerts` from SBC-1 via their `in` bridges — no central server involved in the alarm logic)
- Critical counter increments; alert appears at the top of the live feed

Clear:
```
clear
```
`esp_01` → NORMAL. All 11 peers receive the clear immediately and return to NORMAL. (If a peer hasn't received the clear within 30 s it auto-expires.)

---

### Demo scenario 2 — Simultaneous independent faults

Two nodes in different zones fault at the same time.

In the `esp_01` terminal: `flame`  
In the `esp_05` terminal: `gas_critical`

**Dashboard:** both `esp_01` and `esp_05` show `FAULT` (red). The remaining 10 nodes show `PEER ALARM` (orange). Two separate critical events appear in the alert feed. This shows the backend correctly distinguishes independently faulted nodes from nodes in peer-alarm state.

Clear both when done.

---

### Demo scenario 3 — Local fault blocks peer alarm

In the `esp_02` terminal: `flame` ← local fault  
Then the `esp_01` terminal: `gas_warning` ← peer alert arrives

**Dashboard:** `esp_02` stays `FAULT` (flame) — ignores the incoming peer gas warning.  
Local fault always takes priority.

---

### Demo scenario 4 — Broker failover

Kill SBC-1 while nodes connected to it lose their primary broker.

Option A — from the `sim/` directory (uses the compose service name):
```bash
cd sim
podman compose stop sbc1
```

Option B — from anywhere (uses the container name directly):
```bash
podman stop mqtt-sbc1
```

Watch the terminals for `esp_01`–`esp_04` (zone1) — after 3 failed reconnect attempts each switches to its secondary broker (SBC-2 :1884) and changes its publish topic from `facility/zone1/alerts` to `facility/zone2/alerts`. SBC-1 and SBC-3 already pull `zone2/alerts` from SBC-2 via their `in` bridges, so cross-zone alarm propagation continues uninterrupted. The other 8 nodes (zone2 on SBC-2, zone3 on SBC-3) are unaffected. Dashboard keeps all 12 nodes visible.

Restore:
```bash
# from sim/ directory
podman compose start sbc1
# or from anywhere
podman start mqtt-sbc1
```

---

### Demo scenario 5 — WiFi impairment

Install `iproute2` in the containers (one-time):
```bash
podman exec mqtt-sbc1 apk add --no-cache iproute2
podman exec mqtt-sbc2 apk add --no-cache iproute2
podman exec mqtt-sbc3 apk add --no-cache iproute2
```

Apply congested WiFi:
```bash
cd sim && ./wifi_sim.sh --inside add 200 15   # 200 ms delay, 15% loss
```

Trigger `gas_critical` from `esp_01`. Observe delayed delivery to peers on SBC-2 and SBC-3 (bridge latency adds on top of the link impairment). Restore:
```bash
./wifi_sim.sh --inside remove
```

---

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                       Industrial Facility LAN (Wi-Fi)               │
│                                                                     │
│  ┌──────────┐    facility/zone1/alerts (QoS 1, retained)            │
│  │  ESP32   │──────────────────────────────────────────┐            │
│  │  Node A  │◄─────────────── P2P Alert ───────────────┤            │
│  │ (MQ-2 + │                                           │            │
│  │  Flame) │   facility/zone1/esp_01/telemetry         │            │
│  └──────────┘──────────────────────────┐               │            │
│                                        │               │            │
│  ┌──────────┐                          ▼               ▼            │
│  │  ESP32   │            ┌─────────────────────────────────────┐    │
│  │  Node B  │◄──alert────│     Mosquitto MQTT Broker           │    │
│  └──────────┘            │  ┌─────────────┐ ┌─────────────┐   │    │
│                          │  │  SBC-1 (Pi) │ │  SBC-2 (Pi) │   │    │
│  ┌──────────┐            │  │  :1883      │ │  :1883      │   │    │
│  │  ESP32   │◄──alert────│  │  (Primary)  │ │ (Secondary) │   │    │
│  │  Node C  │            │  └─────────────┘ └─────────────┘   │    │
│  └──────────┘            └─────────────────────────────────────┘    │
│                                        │                            │
│                              ┌─────────┴──────────┐                 │
│                              │   Go Backend        │                 │
│                              │  (systemd daemon)   │                 │
│                              │  SQLite (WAL mode)  │                 │
│                              │  REST + WebSocket   │                 │
│                              └─────────┬──────────┘                 │
└────────────────────────────────────────┼────────────────────────────┘
                                         │ HTTP / WebSocket
                                         ▼
                              ┌─────────────────────┐
                              │   React Dashboard   │
                              │  (Vite + Recharts)  │
                              │  Remote Admin PC    │
                              └─────────────────────┘
```

### Why Decentralized?

Traditional systems route all sensor data through a central server. If that server goes down, both monitoring and alarming capabilities are lost entirely.

In this project the alarm logic is distributed across the ESP32 nodes themselves. When **Node A** detects a gas leak it publishes directly to MQTT; every other node in the facility — regardless of zone or which SBC it is connected to — receives the alert via the broker mesh and triggers its own physical alarm (buzzer + LED) without requiring any central server.

Cross-broker delivery uses **per-zone `in`-only Mosquitto bridges**: each SBC subscribes to the other two zones' alert topics directly from their source brokers. Because the subscription is unidirectional (`in` only), messages are never re-forwarded — no loops, no duplicates. If an ESP's primary broker goes offline it fails over to a secondary broker and switches its publish topic to that broker's zone, maintaining full cross-zone alarm propagation.

The Raspberry Pi cluster handles only logging and the remote dashboard — even if that layer is unavailable, on-site alarms continue to work.

---

## 2. Hardware Components

| Component | Model | Qty | Description |
|---|---|---|---|
| Sensor Node | ESP32 DevKit v1 | ≥ 2 | Wi-Fi integrated microcontroller |
| Reporting Node | Raspberry Pi 4B | 2 | MQTT broker + Go backend host |
| Gas Sensor | MQ-2 | 1 per ESP32 | LPG/propane detection, analog 0–4095 ADC |
| Flame Sensor | YL-39 / IR module | 1 per ESP32 | Digital output, active LOW |
| Buzzer | Piezoelectric | 1 per ESP32 | PWM-driven at different tone frequencies |
| Red LED | 5 mm | 1 per ESP32 | Fault / alarm indicator |
| Green LED | 5 mm | 1 per ESP32 | System healthy indicator |

### GPIO Pin Map (ESP32)

| Signal | GPIO | Type | Connection |
|---|---|---|---|
| Gas Sensor | GPIO 34 (ADC1_CH6) | Analog Input | MQ-2 analog output |
| Flame Sensor | GPIO 35 | Digital Input (pull-up) | IR flame sensor, active LOW |
| Buzzer | GPIO 25 | PWM (LEDC CH0) | Piezoelectric buzzer |
| Red LED | GPIO 26 | Digital Output | Fault LED |
| Green LED | GPIO 27 | Digital Output | Normal status LED |

---

## 3. Project Directory Structure

```
p2p-fault-detection/
├── esp32-firmware/          # PlatformIO C++ firmware
│   ├── platformio.ini
│   ├── include/             # Header files (PlatformIO convention)
│   │   ├── config.h             # Wi-Fi, MQTT, GPIO, threshold values
│   │   ├── SensorPoller.h
│   │   ├── AlertManager.h
│   │   └── MqttTransceiver.h
│   └── src/
│       ├── main.cpp             # Arduino setup/loop, FSM coordination
│       ├── SensorPoller.cpp     # ADC reading + sliding-window median filter
│       ├── AlertManager.cpp     # FSM states + buzzer/LED control
│       └── MqttTransceiver.cpp  # Wi-Fi + MQTT connection, exponential backoff
│
├── backend/                 # Go backend service
│   ├── go.mod
│   ├── main.go              # Application entry point
│   ├── models/
│   │   └── models.go        # Shared data structures
│   ├── db/
│   │   └── sqlite.go        # SQLite schema, CRUD, queries
│   ├── mqtt/
│   │   └── subscriber.go    # MQTT subscriber + heartbeat publisher
│   ├── api/
│   │   ├── handlers.go      # HTTP route handlers
│   │   └── websocket.go     # WebSocket hub + ping/pong keepalive
│   └── registry/
│       └── sbc.go           # In-memory SBC health tracker
│
├── dashboard/               # React + Vite frontend (dark theme)
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── App.jsx                   # Root layout + useReducer state
│       ├── hooks/useWebSocket.js     # WS connection + exponential backoff
│       └── components/
│           ├── NodeCard.jsx      # Node status card (blinking on fault)
│           ├── SBCRow.jsx        # SBC cluster health row
│           ├── AlertList.jsx     # Live alert feed with severity filter
│           ├── GasChart.jsx      # Recharts gas concentration trend
│           └── AlertHistory.jsx  # Paginated, filterable alert history table
│
└── sim/                     # Linux simulation environment
    ├── docker-compose.yml   # Two Mosquitto broker containers (Podman)
    ├── mosquitto/           # Broker configs (sbc1.conf, sbc2.conf, sbc3.conf)
    ├── node_sim.py          # Interactive ESP32 simulator
    ├── wifi_sim.sh          # tc netem WiFi impairment script
    └── requirements.txt
```

---

## 4. ESP32 Firmware

### Class Architecture

```
main.cpp
  ├── SensorPoller    – Raw ADC → filtered value → threshold decision
  ├── AlertManager    – FSM state + physical output control
  └── MqttTransceiver – Network layer, broker connection management
```

### Finite State Machine (FSM)

```
              gas/flame threshold exceeded
   ┌─────────────────────────────────────┐
   │                                     ▼
IDLE ◄──── sensor readings safe ──── FAULT_DETECTED
   │                                   (buzzer high tone)
   │   peer alert received             (red LED blinking)
   └─────────────────────────────────────►
                                    PEER_ALARM_ACTIVE
                                     (buzzer low tone)
```

| State | Buzzer | Red LED | Green LED | MQTT |
|---|---|---|---|---|
| `IDLE` | Off | Off | On | Publishes telemetry |
| `FAULT_DETECTED` | 1200 Hz | Blinking | Off | Publishes alert (retained) |
| `PEER_ALARM_ACTIVE` | 600 Hz | Blinking | Off | — |

> A local fault (`FAULT_DETECTED`) always takes priority over a peer alarm (`PEER_ALARM_ACTIVE`). Peer alarms auto-expire 30 seconds after the last received peer alert (`PEER_ALARM_TIMEOUT_MS`).

### Sensor Filter

`SensorPoller` applies a **7-element sliding-window median filter** to eliminate raw ADC noise. A new reading is added to the window every 500 ms; the window is sorted and the median value is used. This approach prevents one-off ADC spikes from triggering false alarms.

```
Raw ADC:   120, 118, 2800, 115, 121, 119, 122   ← single spike
Sorted:    115, 118, 119, 120, 121, 122, 2800
Median:    120   ✓  (spike eliminated)
```

### Threshold Values

| Threshold | ADC Value | Approx. PPM | Triggered State |
|---|---|---|---|
| `GAS_THRESHOLD_WARNING` | 1500 | ~300 ppm | `FAULT_DETECTED` (WARNING) |
| `GAS_THRESHOLD_CRITICAL` | 2500 | ~500 ppm | `FAULT_DETECTED` (CRITICAL) |

### MQTT Reconnection Strategy

`MqttTransceiver` uses **exponential backoff** when a Wi-Fi or MQTT connection is lost:

- Initial delay: 1000 ms
- Doubles on each failed attempt
- Capped at: 30 000 ms
- After 3 consecutive failures, switches between the primary and secondary broker

---

## 5. Go Backend

### Components

#### `db/sqlite.go` — Data Layer

The SQLite database is opened in **WAL** (Write-Ahead Logging) mode so concurrent reads never block write operations.

**Tables:**

```sql
-- Every gas / flame alert event
event_log (event_id, timestamp, node_id, zone_id, fault_type, severity, value)

-- Latest state of each ESP32 (updated via UPSERT on every telemetry message)
node_health (node_id, zone_id, last_seen, gas_val, state)

-- Time-series for the gas trend chart (one row per telemetry message)
telemetry_log (id, timestamp, node_id, zone_id, gas_val, flame, state)
```

#### `mqtt/subscriber.go` — MQTT Layer

- Connects to three broker addresses (`MQTT_BROKER_1`, `MQTT_BROKER_2`, `MQTT_BROKER_3`), one paho client per broker
- Subscribes to `facility/#` and `sbc/heartbeat/#`
- Incoming `alert` messages → written to `event_log`
- Incoming `telemetry` messages → `node_health` (UPSERT) + `telemetry_log` (INSERT)
- Publishes its own heartbeat to `sbc/heartbeat/{id}` every 30 seconds

#### `registry/sbc.go` — SBC Health Tracker

Keeps each SBC's last heartbeat timestamp in memory. If no heartbeat is received within 90 seconds (3 × the 30-second publish interval), that SBC is marked `offline`.

#### `api/handlers.go` — HTTP Layer

All responses carry `Content-Type: application/json` and `Access-Control-Allow-Origin: *` headers.

#### `api/websocket.go` — Real-Time Push

The Hub broadcasts messages to all connected dashboard clients. Dead-connection detection:
- A WebSocket **Ping** frame is sent every **54 seconds**
- If a **Pong** is not received within **60 seconds**, the connection is closed

---

## 6. React Dashboard

### State Management

Global state is managed with a plain `useReducer` inside `App.jsx` — no separate context file.

```js
// state shape
{
  nodes:     NodeHealth[],            // All known ESP32 nodes
  alerts:    EventLog[],             // Last 200 alerts (newest first)
  sbcStatus: { [node_id]: SBC }     // Live SBC heartbeats
}
```

### Components

| Component | Description |
|---|---|
| `NodeCard` | Displays node ID, zone, state badge, gas ADC value, and online/offline status. Border and background blink at 600 ms on fault. |
| `SBCRow` | Gateway cluster cards. Turns red when last heartbeat is older than 90 seconds. |
| `AlertList` | Live alert feed with ALL / CRITICAL / WARNING filter buttons. |
| `GasChart` | Recharts `LineChart` fed from `/api/v1/nodes/{id}/gas-history` with WARNING (1500) and CRITICAL (2500) reference lines. |
| `AlertHistory` | Paginated table, filterable by node ID and severity, with previous/next pagination. |

### WebSocket Reconnection

The `useWebSocket` hook reconnects automatically on disconnect using **exponential backoff** (1 s → 2 s → 4 s → … → 30 s ceiling).

---

## 7. MQTT Topic Structure

```
facility/
  {zone}/
    alerts                           ← ESP32 publishes its own alert here
                                       (QoS 1, retain=false)
                                       topic matches the currently connected broker's zone
    {nodeId}/
      telemetry                      ← Periodic sensor telemetry (QoS 0)

sbc/
  heartbeat/
    {sbcNodeId}                      ← Backend liveness heartbeat (QoS 1)
```

### Payload Structures

**Alert** (`facility/zone1/alerts`):
```json
{
  "node_id":   "esp_01",
  "zone_id":   "zone1",
  "type":      "gas_critical",
  "val":       2850,
  "timestamp": 1716800000
}
```

**Telemetry** (`facility/zone1/esp_01/telemetry`):
```json
{
  "node_id":   "esp_01",
  "zone_id":   "zone1",
  "gas_val":   1240,
  "flame":     false,
  "state":     1,
  "timestamp": 1716800005000
}
```
> `state` field: `0` = IDLE, `1` = FAULT_DETECTED, `2` = PEER_ALARM_ACTIVE

**SBC Heartbeat** (`sbc/heartbeat/sbc-1`):
```json
{
  "node_id":   "sbc-1",
  "timestamp": "2025-05-27T10:30:00Z",
  "online":    true
}
```

---

## 8. REST API Reference

All endpoints are prefixed with `/api/v1`.

### `GET /api/v1/nodes/status`

Returns the current state of all known ESP32 nodes. Nodes that have not sent telemetry within the last 2 minutes are marked `online: false`.

**Response:**
```json
[
  {
    "node_id":   "esp_01",
    "zone_id":   "zone1",
    "last_seen": "2025-05-27T10:30:00Z",
    "gas_val":   1240,
    "state":     "IDLE",
    "online":    true
  }
]
```

---

### `GET /api/v1/alerts/history`

Paginated alert history with optional filters.

**Query Parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | int | 50 | Page size (max 500) |
| `offset` | int | 0 | Number of records to skip |
| `node_id` | string | — | Filter by a specific node |
| `severity` | string | — | `WARNING` or `CRITICAL` |

**Response:**
```json
{
  "data": [
    {
      "event_id":   42,
      "timestamp":  "2025-05-27T10:28:00Z",
      "node_id":    "esp_01",
      "zone_id":    "zone1",
      "fault_type": "gas_critical",
      "severity":   "CRITICAL",
      "value":      2850
    }
  ],
  "total":  157,
  "limit":  50,
  "offset": 0
}
```

---

### `GET /api/v1/nodes/{nodeId}/telemetry`

Alert-log history for a specific node.

**Query Parameters:** `limit` (default 100, max 200)

---

### `GET /api/v1/nodes/{nodeId}/gas-history`

Time-series telemetry records for the dashboard gas trend chart.

**Query Parameters:** `limit` (default 100, max 500)

**Response:**
```json
[
  {
    "id":        1001,
    "timestamp": "2025-05-27T10:30:00Z",
    "node_id":   "esp_01",
    "zone_id":   "zone1",
    "gas_val":   1240,
    "flame":     false,
    "state":     "IDLE"
  }
]
```

---

### `GET /api/v1/sbc/status`

Live online/offline status of every SBC instance that has sent at least one heartbeat since this backend started.

**Response:**
```json
[
  {
    "node_id":   "sbc-1",
    "last_seen": "2025-05-27T10:30:00Z",
    "online":    true
  },
  {
    "node_id":   "sbc-2",
    "last_seen": "2025-05-27T10:29:45Z",
    "online":    true
  }
]
```

---

### `GET /health`

Load-balancer health probe. Always returns `200 OK`.

```json
{ "status": "ok" }
```

---

## 9. WebSocket Message Formats

**Connection:** `ws://{sbc-ip}:8080/ws/realtime`

All messages follow the envelope `{"type": "...", "payload": {...}}`.

| `type` | Triggering Event | `payload` |
|---|---|---|
| `alert` | A new alert event arrived from MQTT | `EventLog` object |
| `telemetry` | ESP32 telemetry update | `NodeHealth` object |
| `sbc_heartbeat` | SBC heartbeat message received | `SBCHeartbeat` object |

---

## 10. Setup and Running

### Prerequisites

| Tool | Purpose |
|------|---------|
| [PlatformIO CLI](https://docs.platformio.org/en/latest/core/installation/) | Build & flash ESP32 firmware |
| [Podman](https://podman.io/docs/installation) + [podman-compose](https://github.com/containers/podman-compose) | Run simulated MQTT brokers |
| Python ≥ 3.11 | Node simulator |
| Go ≥ 1.21 + `gcc` | Backend (go-sqlite3 requires cgo) |
| Node.js ≥ 18 | Dashboard |

---

## Option A — Linux Simulation (no hardware needed)

Runs 12 simulated ESP32 nodes and three Mosquitto broker containers on your machine. Tests P2P alerting, broker failover, and WiFi impairment with real TCP/IP. See the [Demo](#demo) section for the full walkthrough.

### Quick start

```bash
# 1. Start brokers
cd sim && podman compose up -d

# 2. Backend
cd backend && go build -o p2pfault . && mkdir -p data
MQTT_BROKER_1=tcp://localhost:1883 MQTT_BROKER_2=tcp://localhost:1884 MQTT_BROKER_3=tcp://localhost:1885 \
SBC_NODE_ID=sbc-demo LISTEN_ADDR=:8080 DB_PATH=./data/events.db ./p2pfault &

# 3. Dashboard
cd dashboard && npm install && npm run dev &

# 4. Python venv (first time)
cd sim && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt

# 5. Launch nodes (one terminal each; --secondary-zone tells the node which topic to use on failover)
.venv/bin/python node_sim.py --node-id esp_01 --zone zone1 --primary localhost --port 1883 --secondary localhost --secondary-port 1884 --secondary-zone zone2
```

> **Rootful Podman:** bridge IPs are routable — use `--primary 192.168.1.100 --secondary 192.168.1.101` without port flags.

### Stop the simulation

```bash
cd sim && podman compose down
```

---

## Option B — Real Hardware Deployment

### Step 1 — MQTT Broker (on each Raspberry Pi)

```bash
sudo apt install mosquitto mosquitto-clients
sudo systemctl enable --now mosquitto
```

`/etc/mosquitto/mosquitto.conf` (example for SBC-1 at 192.168.1.100):
```
listener 1883
allow_anonymous true
persistence false

# Pull zone2 alerts from SBC-2 and zone3 alerts from SBC-3 (in-only = no loops)
connection bridge-from-sbc2
address 192.168.1.101:1883
topic facility/zone2/alerts in 0
restart_timeout 5

connection bridge-from-sbc3
address 192.168.1.102:1883
topic facility/zone3/alerts in 0
restart_timeout 5
```

SBC-2 (`192.168.1.101`) bridges in `zone1` from SBC-1 and `zone3` from SBC-3. SBC-3 (`192.168.1.102`) bridges in `zone1` from SBC-1 and `zone2` from SBC-2. Each SBC only bridges in the zones it does not own.

---

### Step 2 — ESP32 Firmware

Edit `esp32-firmware/include/config.h`:

```c
#define WIFI_SSID     "YourNetworkName"
#define WIFI_PASSWORD "YourNetworkPassword"

#define MQTT_BROKER_PRIMARY   "192.168.1.100"  // SBC-1 IP
#define MQTT_BROKER_SECONDARY "192.168.1.101"  // SBC-2 IP

#define NODE_ID "esp_01"   // Must be unique per node
#define ZONE_ID "zone1"
```

Build and flash:
```bash
cd esp32-firmware
pio run --target upload
pio device monitor   # serial monitor at 115200 baud
```

---

### Step 3 — Go Backend (on each Raspberry Pi)

```bash
cd backend
go build -o p2pfault .
```

```bash
# SBC-1
MQTT_BROKER_1=tcp://192.168.1.100:1883 \
MQTT_BROKER_2=tcp://192.168.1.101:1883 \
SBC_NODE_ID=sbc-1 \
LISTEN_ADDR=:8080 \
DB_PATH=./data/events.db \
./p2pfault

# SBC-2
MQTT_BROKER_1=tcp://192.168.1.100:1883 \
MQTT_BROKER_2=tcp://192.168.1.101:1883 \
SBC_NODE_ID=sbc-2 \
LISTEN_ADDR=:8080 \
DB_PATH=./data/events.db \
./p2pfault
```

#### As a systemd Service

```ini
# /etc/systemd/system/p2pfault.service
[Unit]
Description=P2P Fault Detection Backend
After=network.target mosquitto.service

[Service]
ExecStart=/home/pi/p2pfault
WorkingDirectory=/home/pi
Environment=MQTT_BROKER_1=tcp://192.168.1.100:1883
Environment=MQTT_BROKER_2=tcp://192.168.1.101:1883
Environment=SBC_NODE_ID=sbc-1
Environment=LISTEN_ADDR=:8080
Environment=DB_PATH=/home/pi/data/events.db
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now p2pfault
```

---

### Step 4 — React Dashboard

```bash
cd dashboard
npm install
npm run dev      # development server on :3000
npm run build    # production build → dist/
```

For production, copy `dist/` to the SBC and serve with nginx or any static file server. Update `vite.config.js` proxy target to the SBC's IP before building.

---

## 11. Configuration Reference

### ESP32 (`esp32-firmware/include/config.h`)

| Constant | Default | Description |
|---|---|---|
| `WIFI_SSID` | `"YOUR_SSID"` | Network name |
| `WIFI_PASSWORD` | `"YOUR_PASSWORD"` | Network password |
| `MQTT_BROKER_PRIMARY` | `"192.168.1.100"` | SBC-1 IP address |
| `MQTT_BROKER_SECONDARY` | `"192.168.1.101"` | SBC-2 IP address |
| `MQTT_PORT` | `1883` | Standard MQTT port |
| `MQTT_KEEPALIVE` | `60` | Keep-alive interval (seconds) |
| `NODE_ID` | `"esp_01"` | Unique node identifier |
| `ZONE_ID` | `"zone1"` | Zone identifier |
| `GAS_THRESHOLD_WARNING` | `1500` | Warning threshold (ADC) |
| `GAS_THRESHOLD_CRITICAL` | `2500` | Critical threshold (ADC) |
| `SENSOR_POLL_INTERVAL_MS` | `500` | Sensor read period (ms) |
| `TELEMETRY_INTERVAL_MS` | `5000` | Telemetry publish period (ms) |
| `RECONNECT_BASE_DELAY_MS` | `1000` | Initial reconnection delay (ms) |
| `RECONNECT_MAX_DELAY_MS` | `30000` | Maximum reconnection delay (ms) |
| `WIFI_RETRY_INTERVAL_MS` | `5000` | Non-blocking WiFi retry cadence (ms) |
| `PEER_ALARM_TIMEOUT_MS` | `30000` | Auto-clear peer alarm if no repeat within this window (ms) |
| `FILTER_WINDOW_SIZE` | `7` | Median filter window size |

### Go Backend (Environment Variables)

| Variable | Default | Description |
|---|---|---|
| `MQTT_BROKER_1` | `tcp://192.168.1.100:1883` | SBC-1 broker address |
| `MQTT_BROKER_2` | `tcp://192.168.1.101:1883` | SBC-2 broker address |
| `MQTT_BROKER_3` | `tcp://192.168.1.102:1883` | SBC-3 broker address |
| `SBC_NODE_ID` | `sbc-1` | Identity of this SBC instance |
| `LISTEN_ADDR` | `:8080` | HTTP + WebSocket listen address |
| `DB_PATH` | `./data/events.db` | SQLite database file path |

---

## 12. Known Gaps and Next Steps

| Item | Status | Description |
|---|---|---|
| SBC active-active load balancing | Planned | Distribute frontend traffic across both SBCs via DNS round-robin or HAProxy |
| SBC database synchronization | Design phase | Decision pending: MQTT-based replication vs. shared NFS volume |
| Go backend unit tests | Not started | Target ≥ 80% coverage for `db/` and `mqtt/` packages |
| 48-hour stress test | Not started | Verify zero QoS 1 message drops across 6 ESP32 nodes |
| NTP time synchronization | Missing | ESP32 `timestamp` field currently uses `millis()`; SNTP needed for real epoch time |
| Dashboard gas-history endpoint integration | Done | `GasChart` fetches from `/api/v1/nodes/{id}/gas-history` |
