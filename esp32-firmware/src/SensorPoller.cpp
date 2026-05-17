#include "SensorPoller.h"

SensorPoller::SensorPoller(int gasPin, int flamePin)
    : _gasPin(gasPin), _flamePin(flamePin),
      _windowIdx(0), _windowFull(false),
      _filteredGas(0), _flameDetected(false)
{
    memset(_window, 0, sizeof(_window));
}

void SensorPoller::begin() {
    pinMode(_gasPin,   INPUT);
    pinMode(_flamePin, INPUT_PULLUP); // active LOW sensor
}

void SensorPoller::update() {
    _filteredGas  = medianFilter(analogRead(_gasPin));
    // Flame sensor pulls the pin LOW when fire is detected
    _flameDetected = (digitalRead(_flamePin) == LOW);
}

// Sliding-window median — eliminates ADC spike noise without lag
int SensorPoller::medianFilter(int newVal) {
    _window[_windowIdx] = newVal;
    _windowIdx = (_windowIdx + 1) % FILTER_WINDOW_SIZE;
    if (_windowIdx == 0) _windowFull = true;

    int count = _windowFull ? FILTER_WINDOW_SIZE : _windowIdx;
    int sorted[FILTER_WINDOW_SIZE];
    memcpy(sorted, _window, count * sizeof(int));
    qsort(sorted, count, sizeof(int), cmpInt);
    return sorted[count / 2];
}

int SensorPoller::cmpInt(const void* a, const void* b) {
    return (*(const int*)a - *(const int*)b);
}
