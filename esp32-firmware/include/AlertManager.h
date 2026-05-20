#pragma once
#include <Arduino.h>
#include <set>

enum class NodeState : uint8_t {
    IDLE              = 0,
    FAULT_DETECTED    = 1,
    PEER_ALARM_ACTIVE = 2,
};

enum class FaultType : uint8_t {
    NONE         = 0,
    GAS_WARNING  = 1,
    GAS_CRITICAL = 2,
    FLAME        = 3,
};

class AlertManager {
public:
    AlertManager(int buzzerPin, int ledRedPin, int ledGreenPin);
    void begin();

    // Called when this node itself detects a fault
    void onLocalFault(FaultType fault);

    // Called when an MQTT alert arrives from a peer node
    void onPeerAlert(const char* peerId, FaultType fault);

    // Called when a peer sends a clear message (type="none")
    // Clears PEER_ALARM only when every alerting peer has recovered
    void onPeerClear(const char* peerId);

    // Called when local sensor readings return to safe levels
    void onClear();

    // Must be called every loop() iteration for LED blink timing and peer alarm timeout
    void update();

    NodeState getState()        const { return _state; }
    FaultType getCurrentFault() const { return _currentFault; }

private:
    int _buzzerPin;
    int _ledRedPin;
    int _ledGreenPin;

    NodeState        _state;
    FaultType        _currentFault;
    unsigned long    _lastBlink;
    bool             _blinkOn;
    unsigned long    _peerAlarmSetAt;
    std::set<String> _alertingPeers; // tracks which peers are currently faulting

    void activateAlarm(bool critical);
    void deactivateAlarm();
};
