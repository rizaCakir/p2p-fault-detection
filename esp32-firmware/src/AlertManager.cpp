#include "AlertManager.h"
#include "config.h"

static constexpr unsigned long BLINK_INTERVAL_MS = 500;

AlertManager::AlertManager(int buzzerPin, int ledRedPin, int ledGreenPin)
    : _buzzerPin(buzzerPin), _ledRedPin(ledRedPin), _ledGreenPin(ledGreenPin),
      _state(NodeState::IDLE), _currentFault(FaultType::NONE),
      _lastBlink(0), _blinkOn(false), _peerAlarmSetAt(0)
{}

void AlertManager::begin() {
    pinMode(_ledRedPin,   OUTPUT);
    pinMode(_ledGreenPin, OUTPUT);
    ledcAttach(_buzzerPin, 2000, 8);
    deactivateAlarm();
    digitalWrite(_ledGreenPin, HIGH);
}

void AlertManager::onLocalFault(FaultType fault) {
    _currentFault = fault;
    _state        = NodeState::FAULT_DETECTED;
    digitalWrite(_ledGreenPin, LOW);
    bool critical = (fault == FaultType::GAS_CRITICAL || fault == FaultType::FLAME);
    activateAlarm(critical);
}

void AlertManager::onPeerAlert(const char* peerId, FaultType fault) {
    _alertingPeers.insert(String(peerId));
    if (_state == NodeState::FAULT_DETECTED) return; // local fault has priority

    _peerAlarmSetAt = millis();
    _currentFault   = fault;
    if (_state != NodeState::PEER_ALARM_ACTIVE) {
        _state = NodeState::PEER_ALARM_ACTIVE;
        digitalWrite(_ledGreenPin, LOW);
        activateAlarm(false);
    }
}

void AlertManager::onPeerClear(const char* peerId) {
    _alertingPeers.erase(String(peerId));
    // Only clear the peer alarm once every alerting peer has recovered
    if (_state != NodeState::PEER_ALARM_ACTIVE || !_alertingPeers.empty()) return;
    Serial.printf("[ALERT] peer clear from %s — all peers recovered, returning to IDLE\n", peerId);
    onClear();
}

void AlertManager::onClear() {
    _alertingPeers.clear();
    _state        = NodeState::IDLE;
    _currentFault = FaultType::NONE;
    deactivateAlarm();
    digitalWrite(_ledGreenPin, HIGH);
}

void AlertManager::update() {
    if (_state == NodeState::IDLE) return;

    // Auto-expire peer alarm if the peer stops sending within the timeout window
    if (_state == NodeState::PEER_ALARM_ACTIVE &&
        millis() - _peerAlarmSetAt >= PEER_ALARM_TIMEOUT_MS) {
        Serial.println("[ALERT] peer alarm timeout — returning to IDLE");
        onClear();
        return;
    }

    unsigned long now = millis();
    if (now - _lastBlink >= BLINK_INTERVAL_MS) {
        _lastBlink = now;
        _blinkOn   = !_blinkOn;
        digitalWrite(_ledRedPin, _blinkOn ? HIGH : LOW);
    }
}

void AlertManager::activateAlarm(bool critical) {
    uint32_t freq = critical ? 1200 : 600;
    ledcWriteTone(_buzzerPin, freq);
}

void AlertManager::deactivateAlarm() {
    ledcWrite(_buzzerPin, 0);
    digitalWrite(_ledRedPin,   LOW);
    digitalWrite(_ledGreenPin, LOW);
}
