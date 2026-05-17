#pragma once

// ── WiFi ─────────────────────────────────────────────────────────────
#define WIFI_SSID     "YOUR_SSID"
#define WIFI_PASSWORD "YOUR_PASSWORD"

// ── MQTT brokers (two Raspberry Pi SBCs) ─────────────────────────────
#define MQTT_BROKER_PRIMARY   "192.168.1.100"
#define MQTT_BROKER_SECONDARY "192.168.1.101"
#define MQTT_PORT      1883
#define MQTT_KEEPALIVE 60   // seconds

// ── Node identity ─────────────────────────────────────────────────────
#define NODE_ID "esp_01"
#define ZONE_ID "zone1"

// ── MQTT topic templates ──────────────────────────────────────────────
#define TOPIC_ALERTS    "facility/" ZONE_ID "/alerts"
#define TOPIC_TELEMETRY "facility/" ZONE_ID "/" NODE_ID "/telemetry"
#define TOPIC_SUBSCRIBE "facility/+/alerts"   // wildcard: listen to all zones

// ── GPIO pins ─────────────────────────────────────────────────────────
#define PIN_GAS_SENSOR   34   // ADC1_CH6  – MQ-2 analog output
#define PIN_FLAME_SENSOR 35   // Digital   – active LOW when flame present
#define PIN_BUZZER       25   // PWM via LEDC channel 0
#define PIN_LED_RED      26   // Fault / alarm indicator
#define PIN_LED_GREEN    27   // System healthy indicator

// ── Sensor thresholds (raw ADC 0-4095) ───────────────────────────────
#define GAS_THRESHOLD_WARNING  1500
#define GAS_THRESHOLD_CRITICAL 2500

// ── Timing ───────────────────────────────────────────────────────────
#define SENSOR_POLL_INTERVAL_MS  500
#define TELEMETRY_INTERVAL_MS   5000
#define RECONNECT_BASE_DELAY_MS 1000
#define RECONNECT_MAX_DELAY_MS 30000

// ── Sliding-window median filter ──────────────────────────────────────
#define FILTER_WINDOW_SIZE 7
