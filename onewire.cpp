#include "pxt.h"

// Original minimal 1-Wire driver. One DS18B20, external VDD only.
// Release = input, never actively drive a high level on the shared bus.
namespace phMeter {
static void releaseLine(MicroBitPin *p) { p->getDigitalValue(); }
static void low(MicroBitPin *p) { p->setDigitalValue(0); }
static void restoreIRQ(uint32_t mask) { if (!mask) __enable_irq(); }

static bool resetBus(MicroBitPin *p) {
#if MICROBIT_CODAL
    p->setPull(codal::PullMode::None);
#else
    p->setPull(PullNone);
#endif
    releaseLine(p);
    sleep_us(10);
    if (!p->getDigitalValue()) return false;
    low(p);
    sleep_us(480);
    uint32_t mask = __get_PRIMASK();
    __disable_irq();
    releaseLine(p);
    sleep_us(70);
    bool present = !p->getDigitalValue();
    restoreIRQ(mask);
    sleep_us(410);
    return present && p->getDigitalValue();
}
static void writeBit(MicroBitPin *p, bool b) {
    uint32_t mask = __get_PRIMASK();
    __disable_irq();
    low(p);
    sleep_us(b ? 6 : 60);
    releaseLine(p);
    restoreIRQ(mask);
    sleep_us(b ? 64 : 10);
}
static int readBit(MicroBitPin *p) {
    uint32_t mask = __get_PRIMASK();
    __disable_irq();
    low(p);
    sleep_us(3);
    releaseLine(p);
    sleep_us(7);
    int b = p->getDigitalValue();
    restoreIRQ(mask);
    sleep_us(60);
    return b;
}
static void writeByte(MicroBitPin *p, uint8_t b) {
    for (int i = 0; i < 8; ++i) { writeBit(p, b & 1); b >>= 1; }
}
static uint8_t readByte(MicroBitPin *p) {
    uint8_t b = 0;
    for (int i = 0; i < 8; ++i) b |= readBit(p) << i;
    return b;
}
static uint8_t crc8(const uint8_t *data, int n) {
    uint8_t crc = 0;
    for (int i = 0; i < n; ++i) {
        uint8_t value = data[i];
        for (int bit = 0; bit < 8; ++bit) {
            bool mix = (crc ^ value) & 1;
            crc >>= 1;
            if (mix) crc ^= 0x8c;
            value >>= 1;
        }
    }
    return crc;
}

//% 
int _startTemperature(int pin) {
    MicroBitPin *p = getPin(pin);
    if (!p || !resetBus(p)) return -1;
    writeByte(p, 0x33); // Read ROM: bus must contain exactly one device.
    uint8_t rom[8];
    for (int i = 0; i < 8; ++i) rom[i] = readByte(p);
    if (crc8(rom, 7) != rom[7]) return -2;
    if (rom[0] != 0x28) return -3;
    if (!resetBus(p)) return -1;
    writeByte(p, 0xcc);
    writeByte(p, 0xb4); // Reject parasite power; no strong pull-up is provided.
    if (!readBit(p)) return -3;
    if (!resetBus(p)) return -1;
    writeByte(p, 0xcc);
    writeByte(p, 0x44);
    return 0;
}

//% 
int _finishTemperature(int pin) {
    MicroBitPin *p = getPin(pin);
    if (!p) return -16001;
    if (!readBit(p)) return -16003;
    if (!resetBus(p)) return -16001;
    writeByte(p, 0xcc);
    writeByte(p, 0xbe);
    uint8_t data[9];
    bool nonzero = false;
    for (int i = 0; i < 9; ++i) { data[i] = readByte(p); nonzero |= data[i] != 0; }
    if (!nonzero) return -16003;
    if (crc8(data, 8) != data[8]) return -16002;
    if ((data[4] & 0x9f) != 0x1f) return -16003;
    int raw = (int16_t)((data[1] << 8) | data[0]);
    int resolution = (data[4] >> 5) & 3;
    if (resolution == 0) raw &= ~7;
    if (resolution == 1) raw &= ~3;
    if (resolution == 2) raw &= ~1;
    if (raw < -55 * 16 || raw > 125 * 16) return -16003;
    return raw;
}
}
