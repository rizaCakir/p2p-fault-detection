package models

import "time"

type FaultType string

const (
	FaultGasWarning  FaultType = "gas_warning"
	FaultGasCritical FaultType = "gas_critical"
	FaultFlame       FaultType = "flame"
)

// TelemetryPayload is what an ESP32 publishes to facility/{zone}/{node}/telemetry
type TelemetryPayload struct {
	NodeID    string `json:"node_id"`
	ZoneID    string `json:"zone_id"`
	GasVal    int    `json:"gas_val"`
	Flame     bool   `json:"flame"`
	State     int    `json:"state"` // 0=IDLE 1=FAULT_DETECTED 2=PEER_ALARM_ACTIVE
	Timestamp int64  `json:"timestamp"`
}

// AlertPayload is what an ESP32 publishes to facility/{zone}/alerts
type AlertPayload struct {
	NodeID    string    `json:"node_id"`
	ZoneID    string    `json:"zone_id"`
	Type      FaultType `json:"type"`
	Val       int       `json:"val"`
	Timestamp int64     `json:"timestamp"`
}

// EventLog is a row in the event_log SQLite table
type EventLog struct {
	EventID   int64     `json:"event_id"`
	Timestamp time.Time `json:"timestamp"`
	NodeID    string    `json:"node_id"`
	ZoneID    string    `json:"zone_id"`
	FaultType FaultType `json:"fault_type"`
	Severity  string    `json:"severity"` // "WARNING" or "CRITICAL"
	Value     int       `json:"value"`
}

// NodeHealth is a row in the node_health SQLite table
type NodeHealth struct {
	NodeID   string    `json:"node_id"`
	ZoneID   string    `json:"zone_id"`
	LastSeen time.Time `json:"last_seen"`
	GasVal   int       `json:"gas_val"`
	State    string    `json:"state"`
	Online   bool      `json:"online"` // computed, not stored
}

// SBCHeartbeat is published by each backend instance to sbc/heartbeat/{id}
type SBCHeartbeat struct {
	NodeID    string    `json:"node_id"`
	Timestamp time.Time `json:"timestamp"`
	Online    bool      `json:"online"`
}

// WSMessage wraps all WebSocket push messages with a discriminating type field
type WSMessage struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}
