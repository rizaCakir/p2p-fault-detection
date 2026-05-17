package mqtt

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	paho "github.com/eclipse/paho.mqtt.golang"
	"p2pfault/backend/api"
	"p2pfault/backend/db"
	"p2pfault/backend/models"
)

// Subscriber connects to MQTT brokers, logs all events to SQLite, and
// pushes real-time updates to the WebSocket hub.
type Subscriber struct {
	brokers []string
	db      *db.DB
	hub     *api.Hub
	nodeID  string
	client  paho.Client
}

func NewSubscriber(brokers []string, database *db.DB, hub *api.Hub, nodeID string) *Subscriber {
	return &Subscriber{
		brokers: brokers,
		db:      database,
		hub:     hub,
		nodeID:  nodeID,
	}
}

func (s *Subscriber) Connect() error {
	opts := paho.NewClientOptions()
	for _, b := range s.brokers {
		opts.AddBroker(b)
	}
	opts.SetClientID(fmt.Sprintf("backend-%s", s.nodeID))
	opts.SetAutoReconnect(true)
	opts.SetMaxReconnectInterval(30 * time.Second)
	opts.SetKeepAlive(60 * time.Second)
	opts.SetOnConnectHandler(s.onConnect)
	opts.SetConnectionLostHandler(func(_ paho.Client, err error) {
		log.Printf("[MQTT] connection lost: %v", err)
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
	log.Println("[MQTT] connected – subscribing to facility/# and sbc/heartbeat/#")
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
		s.handleAlert(parts[1], msg.Payload())
	case len(parts) == 4 && parts[3] == "telemetry":
		s.handleTelemetry(msg.Payload())
	}
}

func (s *Subscriber) handleAlert(zoneID string, raw []byte) {
	var alert models.AlertPayload
	if err := json.Unmarshal(raw, &alert); err != nil {
		log.Printf("[MQTT] bad alert payload: %v", err)
		return
	}

	severity := "WARNING"
	if alert.Type == models.FaultGasCritical || alert.Type == models.FaultFlame {
		severity = "CRITICAL"
	}

	event := &models.EventLog{
		Timestamp: time.Now(),
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

	node := &models.NodeHealth{
		NodeID:   t.NodeID,
		ZoneID:   t.ZoneID,
		LastSeen: time.Now(),
		GasVal:   t.GasVal,
		State:    state,
		Online:   true,
	}

	if err := s.db.UpsertNodeHealth(node); err != nil {
		log.Printf("[DB] upsert node failed: %v", err)
	}

	s.broadcast("telemetry", node)
}

func (s *Subscriber) onHeartbeat(_ paho.Client, msg paho.Message) {
	var hb models.SBCHeartbeat
	if err := json.Unmarshal(msg.Payload(), &hb); err != nil {
		return
	}
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
