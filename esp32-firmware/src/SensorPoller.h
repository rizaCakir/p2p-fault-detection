#pragma once
#include <Arduino.h>
#include "config.h"

class SensorPoller {
public:
    SensorPoller(int gasPin, int flamePin);
    void begin();

    // Call every SENSOR_POLL_INTERVAL_MS; updates internal state.
    void update();

    int  getFilteredGasValue() const { return _filteredGas; }
    bool isFlameDetected()     const { return _flameDetected; }
    bool isGasWarning()        const { return _filteredGas >= GAS_THRESHOLD_WARNING  && _filteredGas < GAS_THRESHOLD_CRITICAL; }
    bool isGasCritical()       const { return _filteredGas >= GAS_THRESHOLD_CRITICAL; }

private:
    int  _gasPin;
    int  _flamePin;

    int  _window[FILTER_WINDOW_SIZE];
    int  _windowIdx;
    bool _windowFull;

    int  _filteredGas;
    bool _flameDetected;

    int medianFilter(int newVal);
    static int cmpInt(const void* a, const void* b);
};
