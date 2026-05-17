# P2P Fault Detection Protocol with Decentralized Reporting

BBM460 Senior Design Project — Orhun İnan & Rıza Çakır

A decentralized IoT monitoring and alarm system for industrial environments that detects gas leaks and flame events without relying on a central server.

---

## Table of Contents

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
│   └── src/
│       ├── config.h             # Wi-Fi, MQTT, GPIO, threshold values
│       ├── main.cpp             # Arduino setup/loop, FSM coordination
│       ├── SensorPoller.h/cpp   # ADC reading + sliding-window median filter
│       ├── AlertManager.h/cpp   # FSM states + buzzer/LED control
│       └── MqttTransceiver.h/cpp  # Wi-Fi + MQTT connection, exponential backoff
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
└── dashboard/               # React + Vite frontend
    ├── package.json
    ├── vite.config.js
    └── src/
        ├── App.jsx                  # Root layout
        ├── context/AppContext.jsx   # useReducer global state
        ├── hooks/useWebSocket.js    # WS connection + exponential backoff
        └── components/
            ├── NodeCard.jsx     # Node status card (blinking on fault)
            ├── AlertFeed.jsx    # Scrollable alert stream
            ├── GasChart.jsx     # Recharts gas concentration trend
            └── SBCStatus.jsx    # SBC cluster health widget
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

> A local fault (`FAULT_DETECTED`) always takes priority over a peer alarm (`PEER_ALARM_ACTIVE`).

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

`AppContext` (useReducer) global state shape:

```js
{
  nodes:        NodeHealth[],             // All known ESP32 nodes
  activeAlerts: EventLog[],              // Last 100 alerts (newest first)
  sbcStatus:    { [id]: SBCHeartbeat }  // Live SBC heartbeats
}
```

### Components

| Component | Description |
|---|---|
| `NodeCard` | Displays node ID, zone, state badge, gas ADC value, and online/offline status. Blinks at 600 ms on fault. |
| `SBCStatus` | Gateway cluster cards. Turns red when no heartbeat has been received for 90 seconds. |
| `GasChart` | Recharts `LineChart` with WARNING (1500) and CRITICAL (2500) reference lines. |
| `AlertFeed` | Infinite-scroll alert list with icon and severity badge. |

### WebSocket Reconnection

The `useWebSocket` hook reconnects automatically on disconnect using **exponential backoff** (1 s → 30 s).

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

| Component | Requirement |
|---|---|
| ESP32 Firmware | [PlatformIO](https://platformio.org/) CLI or VSCode extension |
| Go Backend | Go 1.21+, `gcc` (required by go-sqlite3 cgo) |
| React Dashboard | Node.js 18+, npm |
| MQTT Broker | Mosquitto (`apt install mosquitto`) |

---

### Step 1 — MQTT Broker (on each Raspberry Pi)

```bash
sudo apt install mosquitto mosquitto-clients
sudo systemctl enable --now mosquitto
```

Mosquitto configuration (`/etc/mosquitto/mosquitto.conf`):
```
listener 1883
allow_anonymous true
```

---

### Step 2 — ESP32 Firmware

```bash
cd esp32-firmware
```

Edit `src/config.h`:

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
pio run --target upload
pio device monitor   # serial monitor at 115200 baud
```

---

### Step 3 — Go Backend (on each Raspberry Pi)

```bash
cd backend
go build -o p2p-backend .
```

Run with environment variables:

```bash
# On SBC-1
MQTT_BROKER_1=tcp://192.168.1.100:1883 \
MQTT_BROKER_2=tcp://192.168.1.101:1883 \
SBC_NODE_ID=sbc-1 \
LISTEN_ADDR=:8080 \
DB_PATH=./data/events.db \
./p2p-backend

# On SBC-2 (separate terminal or systemd unit)
MQTT_BROKER_1=tcp://192.168.1.100:1883 \
MQTT_BROKER_2=tcp://192.168.1.101:1883 \
SBC_NODE_ID=sbc-2 \
LISTEN_ADDR=:8080 \
DB_PATH=./data/events.db \
./p2p-backend
```

#### As a systemd Service (Recommended)

```ini
# /etc/systemd/system/p2p-backend.service
[Unit]
Description=P2P Fault Detection Backend
After=network.target mosquitto.service

[Service]
ExecStart=/home/pi/p2p-backend
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
sudo systemctl enable --now p2p-backend
```

---

### Step 4 — React Dashboard

```bash
cd dashboard
npm install
```

Development server (with API proxy):
```bash
npm run dev
```

> Set the SBC IP in `vite.config.js` so that `/api/v1` and `/ws` requests are proxied to `http://192.168.1.100:8080`.

Production build:
```bash
npm run build   # outputs to dist/
# copy dist/ to the SBC's web server (nginx / caddy)
```

---

## 11. Configuration Reference

### ESP32 (`esp32-firmware/src/config.h`)

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
| Dashboard gas-history endpoint integration | Partial | `GasChart` currently uses `event_log` data; should be fed from the new `/gas-history` endpoint |
