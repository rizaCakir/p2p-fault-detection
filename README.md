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

Open **six terminals** in the project root before you start.

### Terminal 1 — MQTT broker cluster

```bash
cd sim
podman compose up
```

Wait until both containers print `mosquitto version 2.x.x running`.

### Terminal 2 — Go backend

```bash
cd backend
go build -o p2pfault .
mkdir -p data
MQTT_BROKER_1=tcp://localhost:1883 \
MQTT_BROKER_2=tcp://localhost:1884 \
SBC_NODE_ID=sbc-demo \
LISTEN_ADDR=:8080 \
DB_PATH=./data/events.db \
./p2pfault
```

### Terminal 3 — React dashboard

```bash
cd dashboard
npm install          # first time only
npm run dev
```

Open **http://localhost:3000** in a browser. The dashboard shows `reconnecting…` until at least one node comes online.

### Terminals 4–6 — simulated ESP32 nodes

```bash
# First time only (inside sim/)
cd sim && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

```bash
# Terminal 4 — esp_01, zone1
cd sim && .venv/bin/python node_sim.py --node-id esp_01 --zone zone1 \
    --primary localhost --port 1883 --secondary localhost --secondary-port 1884

# Terminal 5 — esp_02, zone1 (same zone, different broker)
cd sim && .venv/bin/python node_sim.py --node-id esp_02 --zone zone1 \
    --primary localhost --port 1884 --secondary localhost --secondary-port 1883

# Terminal 6 — esp_03, zone2 (different zone)
cd sim && .venv/bin/python node_sim.py --node-id esp_03 --zone zone2 \
    --primary localhost --port 1883 --secondary localhost --secondary-port 1884
```

The dashboard now shows three nodes as **online / NORMAL**.

---

### Demo scenario 1 — P2P alert propagation

In **Terminal 4** (`esp_01`), type and press Enter:
```
gas_critical
```

**What to show on the dashboard:**
- `esp_01` card turns red and blinks → `FAULT`
- `esp_02` card turns orange → `PEER ALARM` (received alert over MQTT without any central server)
- `esp_03` card stays green → unaffected (different zone)
- Critical alert count increments in the stat bar
- New entry appears at the top of the live alert feed

Then clear:
```
clear
```
- `esp_01` returns to `NORMAL`
- `esp_02` remains `PEER ALARM` and auto-clears after 30 s

---

### Demo scenario 2 — Local fault blocks peer alarm

In **Terminal 5** (`esp_02`):
```
flame
```
Then immediately in **Terminal 4** (`esp_01`):
```
gas_warning
```

**What to show:** `esp_02` stays in `FAULT` (flame) — it ignores the peer gas warning. Local fault always has priority.

---

### Demo scenario 3 — Broker failover

Kill SBC-1 while `esp_01` is connected to it:
```bash
podman compose stop sbc1
```

Watch **Terminal 4**: after 3 failed reconnect attempts (~3 s), `esp_01` switches to SBC-2 automatically and reconnects. No data loss. Restore:
```bash
podman compose start sbc1
```

---

### Demo scenario 4 — WiFi impairment

Install `iproute2` inside the containers (one-time):
```bash
podman exec mqtt-sbc1 apk add --no-cache iproute2
podman exec mqtt-sbc2 apk add --no-cache iproute2
```

Apply poor WiFi conditions:
```bash
cd sim && ./wifi_sim.sh --inside add 200 15   # 200 ms delay, 15% packet loss
```

Trigger an alert from `esp_01` and observe delayed delivery on `esp_02`. Restore:
```bash
./wifi_sim.sh --inside remove
```

---

### Tear down

```bash
cd sim && podman compose down
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

In this project the alarm logic is distributed across the ESP32 nodes themselves. When **Node A** detects a gas leak it publishes directly to MQTT; **Node B** and **Node C** receive the message as subscribers and trigger their own physical alarms (buzzer + LED) without requiring any central server. The Raspberry Pi cluster handles only logging and the remote dashboard — even if that layer is unavailable, on-site alarms continue to work.

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
    ├── mosquitto/           # Broker configs (sbc1.conf, sbc2.conf)
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

- Connects to two broker addresses (`MQTT_BROKER_1`, `MQTT_BROKER_2`)
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
                                       (QoS 1, retained = true)
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

Runs multiple simulated ESP32 nodes and two Mosquitto broker containers on your machine. Tests P2P alerting, broker failover, and WiFi impairment with real TCP/IP.

### 1. Start the broker cluster

```bash
cd sim
podman compose up -d
```

| Container | Simulates | Host port |
|-----------|-----------|-----------|
| `mqtt-sbc1` | Raspberry Pi SBC-1 | `1883` |
| `mqtt-sbc2` | Raspberry Pi SBC-2 | `1884` |

### 2. Set up the Python environment

```bash
cd sim
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

### 3. Launch nodes (one terminal each)

```bash
# Terminal 1 — esp_01, zone1, primary broker = SBC-1
.venv/bin/python node_sim.py --node-id esp_01 --zone zone1 \
    --primary localhost --port 1883 \
    --secondary localhost --secondary-port 1884

# Terminal 2 — esp_02, zone1, primary broker = SBC-2
.venv/bin/python node_sim.py --node-id esp_02 --zone zone1 \
    --primary localhost --port 1884 \
    --secondary localhost --secondary-port 1883

# Terminal 3 — esp_03, zone2 (different zone — will not receive zone1 alerts)
.venv/bin/python node_sim.py --node-id esp_03 --zone zone2 \
    --primary localhost --port 1883 \
    --secondary localhost --secondary-port 1884
```

> **Rootful Podman:** if running as root, the bridge IPs are routable directly — use `--primary 192.168.1.100 --secondary 192.168.1.101` and omit the port flags.

### 4. Demo scenarios

Type commands into each node terminal and press Enter.

#### Scenario 1 — P2P alert propagation

In **Terminal 1** (`esp_01`): `gas_critical`
- `esp_01` → `IDLE → FAULT_DETECTED`, publishes **one** retained alert
- `esp_02` → `PEER_ALARM_ACTIVE`
- `esp_03` → **no reaction** (different zone)

Then `clear` → `esp_01` returns to IDLE; `esp_02` auto-expires after 30 s.

#### Scenario 2 — Local fault priority

In `esp_02`: `flame` (local fault).  
Then in `esp_01`: `gas_warning` (peer alert toward `esp_02`).  
`esp_02` ignores the peer alert — local fault always wins.

#### Scenario 3 — Broker failover

```bash
podman compose stop sbc1   # kill primary broker
```
After 3 failed attempts, `esp_01` switches to SBC-2 automatically.  
```bash
podman compose start sbc1  # restore
```

#### Scenario 4 — WiFi impairment

```bash
# Apply tc netem inside broker containers (rootless Podman)
podman exec mqtt-sbc1 apk add --no-cache iproute2
podman exec mqtt-sbc2 apk add --no-cache iproute2

./wifi_sim.sh --inside add 120 5    # 120 ms delay, 5% loss (congested)
./wifi_sim.sh preset poor           # 200 ms / 15% loss (edge of coverage)
./wifi_sim.sh --inside status       # show current impairment
./wifi_sim.sh --inside remove       # restore clean network
```

### 5. Start the backend and dashboard

```bash
# Terminal 4 — Go backend (points at simulated brokers)
cd backend
go build -o p2pfault .
MQTT_BROKER_1=tcp://localhost:1883 \
MQTT_BROKER_2=tcp://localhost:1884 \
SBC_NODE_ID=sbc-1 \
LISTEN_ADDR=:8080 \
DB_PATH=./data/events.db \
./p2pfault
```

```bash
# Terminal 5 — Dashboard (Vite dev server on :3000)
cd dashboard
npm install
npm run dev
```

Open `http://localhost:3000`.

### 6. Stop the simulation

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

`/etc/mosquitto/mosquitto.conf`:
```
listener 1883
allow_anonymous true
```

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
| `MQTT_BROKER_1` | `tcp://192.168.1.100:1883` | Primary broker address |
| `MQTT_BROKER_2` | `tcp://192.168.1.101:1883` | Secondary broker address |
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
