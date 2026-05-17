#include "MqttTransceiver.h"

MqttTransceiver* MqttTransceiver::_instance = nullptr;

MqttTransceiver::MqttTransceiver()
    : _alertCb(nullptr), _usePrimary(true),
      _lastReconnectAt(0),
      _reconnectDelay(RECONNECT_BASE_DELAY_MS),
      _failedAttempts(0)
{
    _instance = this;
}

void MqttTransceiver::begin(AlertCallback cb) {
    _alertCb = cb;
    connectWiFi();
    _client.setClient(_wifiClient);
    _client.setCallback(onMqttMessage);
    _client.setKeepAlive(MQTT_KEEPALIVE);
    reconnectMqtt();
}

// ── Private ───────────────────────────────────────────────────────────

void MqttTransceiver::connectWiFi() {
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.print("[WiFi] connecting");
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print('.');
    }
    Serial.printf("\n[WiFi] connected – IP: %s\n", WiFi.localIP().toString().c_str());
}

bool MqttTransceiver::reconnectMqtt() {
    const char* broker = _usePrimary ? MQTT_BROKER_PRIMARY : MQTT_BROKER_SECONDARY;
    _client.setServer(broker, MQTT_PORT);

    String clientId = String("esp32-") + NODE_ID;
    if (_client.connect(clientId.c_str())) {
        _client.subscribe(TOPIC_SUBSCRIBE, 1); // QoS 1 for critical alerts
        _reconnectDelay = RECONNECT_BASE_DELAY_MS;
        _failedAttempts = 0;
        Serial.printf("[MQTT] connected to %s\n", broker);
        return true;
    }

    _failedAttempts++;
    Serial.printf("[MQTT] connect failed (rc=%d) attempt=%d\n", _client.state(), _failedAttempts);

    // After 3 consecutive failures, try the other broker
    if (_failedAttempts >= 3) {
        switchBroker();
        _failedAttempts = 0;
    }

    // Exponential backoff capped at RECONNECT_MAX_DELAY_MS
    _reconnectDelay = min(_reconnectDelay * 2UL, (unsigned long)RECONNECT_MAX_DELAY_MS);
    return false;
}

void MqttTransceiver::switchBroker() {
    _usePrimary = !_usePrimary;
    Serial.printf("[MQTT] switching to %s broker\n", _usePrimary ? "primary" : "secondary");
}

// ── Public ────────────────────────────────────────────────────────────

void MqttTransceiver::update() {
    if (WiFi.status() != WL_CONNECTED) {
        connectWiFi();
        return;
    }

    if (_client.connected()) {
        _client.loop();
    } else {
        unsigned long now = millis();
        if (now - _lastReconnectAt >= _reconnectDelay) {
            _lastReconnectAt = now;
            reconnectMqtt();
        }
    }
}

bool MqttTransceiver::publish(const char* topic, const JsonDocument& doc, bool retained) {
    if (!_client.connected()) return false;
    char buf[256];
    size_t len = serializeJson(doc, buf);
    return _client.publish(topic, (uint8_t*)buf, len, retained);
}

bool MqttTransceiver::isConnected() const {
    return _client.connected();
}

// ── Static MQTT callback ──────────────────────────────────────────────

void MqttTransceiver::onMqttMessage(char* /*topic*/, byte* payload, unsigned int len) {
    if (!_instance || !_instance->_alertCb) return;

    StaticJsonDocument<256> doc;
    if (deserializeJson(doc, payload, len) != DeserializationError::Ok) return;

    const char* nodeId    = doc["node_id"] | "unknown";
    const char* faultType = doc["type"]    | "unknown";
    int         val       = doc["val"]     | 0;

    // Ignore messages that this node itself published
    if (strcmp(nodeId, NODE_ID) == 0) return;

    _instance->_alertCb(nodeId, faultType, val);
}
