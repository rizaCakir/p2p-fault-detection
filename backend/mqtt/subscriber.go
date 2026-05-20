package mqtt

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	paho "github.com/eclipse/paho.mqtt.golang"
	"p2pfault/backend/api"
	"p2pfault/backend/db"
	"p2pfault/backend/models"
	"p2pfault/backend/registry"
)

// Subscriber connects to a single MQTT broker, logs all events to SQLite,
// and pushes real-time updates to the WebSocket hub.
// Instantiate one Subscriber per broker to receive messages from all brokers
// simultaneously (paho connects to exactly one broker per client).
type Subscriber struct {
	broker     string
	db         *db.DB
	hub        *api.Hub
	nodeID     string
	tracker    *registry.SBCTracker
	client     paho.Client
	alertDedup *sync.Map // shared across all Subscriber instances; prevents triple DB writes from bridge delivery
}

func NewSubscriber(broker string, database *db.DB, hub *api.Hub, nodeID string, tracker *registry.SBCTracker, alertDedup *sync.Map) *Subscriber {
	return &Subscriber{
		broker:     broker,
		db:         database,
		hub:        hub,
		nodeID:     nodeID,
		tracker:    tracker,
		alertDedup: alertDedup,
	}
}

func (s *Subscriber) Connect() error {
	opts := paho.NewClientOptions()
	opts.AddBroker(s.broker)
	// Client IDs must be unique per broker connection; include broker address
	// so two Subscribers for different brokers don't collide.
	opts.SetClientID(fmt.Sprintf("backend-%s-%s", s.nodeID, s.broker))
	opts.SetAutoReconnect(true)
	opts.SetMaxReconnectInterval(30 * time.Second)
	opts.SetKeepAlive(60 * time.Second)
	opts.SetOnConnectHandler(s.onConnect)
	opts.SetConnectionLostHandler(func(_ paho.Client, err error) {
		log.Printf("[MQTT] connection lost to %s: %v", s.broker, err)
	})

	s.client = paho.NewClient(opts)
	tok := s.client.Connect()
	tok.Wait()
	return tok.Error()
}

func (s *Subscriber) Disconnect() {
	s.client.Disconnect(500)
}

func (s *Subscriber) onConnect(c paho.Client) {
	log.Printf("[MQTT] connected to %s – subscribing to facility/# and sbc/heartbeat/#", s.broker)
	c.Subscribe("facility/#",      1, s.onFacilityMessage)
	c.Subscribe("sbc/heartbeat/#", 1, s.onHeartbeat)
}

// ── Message handlers ──────────────────────────────────────────────────

func (s *Subscriber) onFacilityMessage(_ paho.Client, msg paho.Message) {
	// topic patterns:
	//   facility/{zone}/alerts
	//   facility/{zone}/{node}/telemetry
	parts := strings.Split(msg.Topic(), "/")
	switch {
	case len(parts) == 3 && parts[2] == "alerts":
		s.handleAlert(msg.Topic(), parts[1], msg.Payload())
	case len(parts) == 4 && parts[3] == "telemetry":
		s.handleTelemetry(msg.Payload())
	}
}

func (s *Subscriber) handleAlert(topic, zoneID string, raw []byte) {
	var alert models.AlertPayload
	if err := json.Unmarshal(raw, &alert); err != nil {
		log.Printf("[MQTT] bad alert payload: %v", err)
		return
	}

	// Deduplicate: after forwarding below, the other broker subscribers will also
	// receive this message. The shared alertDedup map ensures only the first
	// subscriber to process each alert/clear actually acts on it.
	key := alert.NodeID + "|" + string(alert.Type)
	now := time.Now()
	if prev, loaded := s.alertDedup.LoadOrStore(key, now); loaded {
		if now.Sub(prev.(time.Time)) < 5*time.Second {
			return
		}
		s.alertDedup.Store(key, now)
	}

	// Clear messages are bridged by Mosquitto; nothing to log.
	if alert.Type == "" || alert.Type == "none" {
		return
	}

	severity := "WARNING"
	if alert.Type == models.FaultGasCritical || alert.Type == models.FaultFlame {
		severity = "CRITICAL"
	}

	event := &models.EventLog{
		Timestamp: now,
		NodeID:    alert.NodeID,
		ZoneID:    zoneID,
		FaultType: alert.Type,
		Severity:  severity,
		Value:     alert.Val,
	}

	if err := s.db.InsertEvent(event); err != nil {
		log.Printf("[DB] insert event failed: %v", err)
	}

	s.broadcast("alert", event)
}

func (s *Subscriber) handleTelemetry(raw []byte) {
	var t models.TelemetryPayload
	if err := json.Unmarshal(raw, &t); err != nil {
		log.Printf("[MQTT] bad telemetry payload: %v", err)
		return
	}

	stateNames := []string{"IDLE", "FAULT_DETECTED", "PEER_ALARM_ACTIVE"}
	state := "IDLE"
	if t.State >= 0 && t.State < len(stateNames) {
		state = stateNames[t.State]
	}

	now := time.Now()

	node := &models.NodeHealth{
		NodeID:   t.NodeID,
		ZoneID:   t.ZoneID,
		LastSeen: now,
		GasVal:   t.GasVal,
		State:    state,
		Online:   true,
	}
	if err := s.db.UpsertNodeHealth(node); err != nil {
		log.Printf("[DB] upsert node failed: %v", err)
	}

	tlog := &models.TelemetryLog{
		Timestamp: now,
		NodeID:    t.NodeID,
		ZoneID:    t.ZoneID,
		GasVal:    t.GasVal,
		Flame:     t.Flame,
		State:     state,
	}
	if err := s.db.InsertTelemetryLog(tlog); err != nil {
		log.Printf("[DB] insert telemetry failed: %v", err)
	}

	s.broadcast("telemetry", node)
}

func (s *Subscriber) onHeartbeat(_ paho.Client, msg paho.Message) {
	var hb models.SBCHeartbeat
	if err := json.Unmarshal(msg.Payload(), &hb); err != nil {
		return
	}
	s.tracker.Heartbeat(hb.NodeID)
	s.broadcast("sbc_heartbeat", hb)
}

// ── Heartbeat publisher ───────────────────────────────────────────────

// StartHeartbeat publishes this SBC's liveness on a fixed interval.
// Run in a goroutine; returns when the process exits.
func (s *Subscriber) StartHeartbeat(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	topic := fmt.Sprintf("sbc/heartbeat/%s", s.nodeID)
	for range ticker.C {
		hb := models.SBCHeartbeat{
			NodeID:    s.nodeID,
			Timestamp: time.Now(),
			Online:    true,
		}
		data, _ := json.Marshal(hb)
		s.client.Publish(topic, 1, false, data)
	}
}

// ── Helper ────────────────────────────────────────────────────────────

func (s *Subscriber) broadcast(msgType string, payload interface{}) {
	data, err := json.Marshal(models.WSMessage{Type: msgType, Payload: payload})
	if err != nil {
		return
	}
	s.hub.Broadcast(data)
}
