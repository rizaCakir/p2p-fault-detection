#pragma once
#include <Arduino.h>

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

    // Call when sensor readings return to safe levels
    void onClear();

    // Must be called every loop() iteration for LED blink timing
    void update();

    NodeState getState()        const { return _state; }
    FaultType getCurrentFault() const { return _currentFault; }

private:
    int _buzzerPin;
    int _ledRedPin;
    int _ledGreenPin;

    NodeState     _state;
    FaultType     _currentFault;
    unsigned long _lastBlink;
    bool          _blinkOn;
    unsigned long _peerAlarmSetAt;

    void activateAlarm(bool critical);
    void deactivateAlarm();
};
