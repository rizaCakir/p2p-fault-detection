#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "config.h"

// Callback signature: (nodeId, faultType string, sensor value)
using AlertCallback = void (*)(const char*, const char*, int);

class MqttTransceiver {
public:
    MqttTransceiver();
    void begin(AlertCallback cb);

    // Must be called every loop() – drives WiFi keep-alive, reconnect, and client.loop()
    void update();

    bool publish(const char* topic, const JsonDocument& doc, bool retained = false);
    bool isConnected() const;

private:
    WiFiClient    _wifiClient;
    PubSubClient  _client;
    AlertCallback _alertCb;

    bool          _usePrimary;
    unsigned long _lastReconnectAt;
    unsigned long _reconnectDelay;  // grows exponentially
    int           _failedAttempts;

    void connectWiFi();
    bool reconnectMqtt();
    void switchBroker();

    // Static trampoline required by PubSubClient callback signature
    static MqttTransceiver* _instance;
    static void onMqttMessage(char* topic, byte* payload, unsigned int len);
};
