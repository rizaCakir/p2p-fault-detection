#include <Arduino.h>
#include "config.h"
#include "SensorPoller.h"
#include "AlertManager.h"
#include "MqttTransceiver.h"

static SensorPoller    sensorPoller(PIN_GAS_SENSOR, PIN_FLAME_SENSOR);
static AlertManager    alertManager(PIN_BUZZER, PIN_LED_RED, PIN_LED_GREEN);
static MqttTransceiver mqttTransceiver;

static unsigned long lastSensorPoll = 0;
static unsigned long lastTelemetry  = 0;

// ── Helpers ───────────────────────────────────────────────────────────

static const char* faultTypeName(FaultType ft) {
    switch (ft) {
        case FaultType::GAS_WARNING:  return "gas_warning";
        case FaultType::GAS_CRITICAL: return "gas_critical";
        case FaultType::FLAME:        return "flame";
        default:                      return "none";
    }
}

static void publishAlert(FaultType fault, int val) {
    StaticJsonDocument<256> doc;
    doc["node_id"]   = NODE_ID;
    doc["zone_id"]   = ZONE_ID;
    doc["type"]      = faultTypeName(fault);
    doc["val"]       = val;
    doc["timestamp"] = millis(); // replace with NTP epoch if a time sync is added
    // retained=true so late-joining subscribers know the current alert state
    mqttTransceiver.publish(TOPIC_ALERTS, doc, true);
}

static void publishTelemetry() {
    StaticJsonDocument<256> doc;
    doc["node_id"]   = NODE_ID;
    doc["zone_id"]   = ZONE_ID;
    doc["gas_val"]   = sensorPoller.getFilteredGasValue();
    doc["flame"]     = sensorPoller.isFlameDetected();
    doc["state"]     = (int)alertManager.getState();
    doc["timestamp"] = millis();
    mqttTransceiver.publish(TOPIC_TELEMETRY, doc);
}

// ── Peer alert callback ───────────────────────────────────────────────

static void onPeerAlert(const char* nodeId, const char* faultType, int val) {
    Serial.printf("[PEER] alert from %s  type=%s  val=%d\n", nodeId, faultType, val);

    FaultType ft = FaultType::NONE;
    if      (strcmp(faultType, "gas_warning")  == 0) ft = FaultType::GAS_WARNING;
    else if (strcmp(faultType, "gas_critical") == 0) ft = FaultType::GAS_CRITICAL;
    else if (strcmp(faultType, "flame")        == 0) ft = FaultType::FLAME;

    if (ft != FaultType::NONE) {
        alertManager.onPeerAlert(nodeId, ft);
    }
}

// ── Arduino entry points ──────────────────────────────────────────────

void setup() {
    Serial.begin(115200);

    sensorPoller.begin();
    alertManager.begin();
    mqttTransceiver.begin(onPeerAlert);

    Serial.printf("[BOOT] Node %s / Zone %s ready\n", NODE_ID, ZONE_ID);
}

void loop() {
    mqttTransceiver.update(); // WiFi keep-alive + MQTT reconnect + client.loop()
    alertManager.update();    // LED blink timing

    unsigned long now = millis();

    // ── Sensor polling ────────────────────────────────────────────────
    if (now - lastSensorPoll >= SENSOR_POLL_INTERVAL_MS) {
        lastSensorPoll = now;
        sensorPoller.update();

        int       gasVal    = sensorPoller.getFilteredGasValue();
        bool      flame     = sensorPoller.isFlameDetected();
        NodeState prevState = alertManager.getState();

        if (flame) {
            if (prevState != NodeState::FAULT_DETECTED || alertManager.getCurrentFault() != FaultType::FLAME)
                alertManager.onLocalFault(FaultType::FLAME);
            publishAlert(FaultType::FLAME, 1);
        } else if (sensorPoller.isGasCritical()) {
            if (prevState != NodeState::FAULT_DETECTED || alertManager.getCurrentFault() != FaultType::GAS_CRITICAL)
                alertManager.onLocalFault(FaultType::GAS_CRITICAL);
            publishAlert(FaultType::GAS_CRITICAL, gasVal);
        } else if (sensorPoller.isGasWarning()) {
            if (prevState != NodeState::FAULT_DETECTED || alertManager.getCurrentFault() != FaultType::GAS_WARNING)
                alertManager.onLocalFault(FaultType::GAS_WARNING);
            publishAlert(FaultType::GAS_WARNING, gasVal);
        } else {
            // Sensor readings are safe
            if (prevState == NodeState::FAULT_DETECTED) {
                alertManager.onClear();
            }
        }
    }

    // ── Periodic telemetry ────────────────────────────────────────────
    if (now - lastTelemetry >= TELEMETRY_INTERVAL_MS) {
        lastTelemetry = now;
        if (mqttTransceiver.isConnected()) {
            publishTelemetry();
        }
    }
}
