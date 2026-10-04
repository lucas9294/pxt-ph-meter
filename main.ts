enum PHAnalogPin {
    //% block="P1"
    P1 = 101,
    //% block="P2"
    P2 = 102,
    //% block="P3"
    P3 = 103,
    //% block="P4"
    P4 = 104,
    //% block="P10"
    P10 = 110
}

enum PHTemperaturePin {
    //% block="P1"
    P1 = 101,
    //% block="P2"
    P2 = 102,
    //% block="P8"
    P8 = 108,
    //% block="P12"
    P12 = 112,
    //% block="P13"
    P13 = 113,
    //% block="P14"
    P14 = 114,
    //% block="P15"
    P15 = 115
}

enum PHCalibrationPoint {
    //% block="第一點"
    First = 0,
    //% block="第二點"
    Second = 1,
    //% block="第三點"
    Third = 2
}

enum PHStatus {
    //% block="正常"
    OK = 0,
    //% block="尚未量度"
    NoReading = 1,
    //% block="未完成校準"
    NotCalibrated = 2,
    //% block="ADC 接近上下限"
    ADCClipped = 3,
    //% block="訊號不穩定"
    Unstable = 4,
    //% block="校準資料無效"
    BadCalibration = 5,
    //% block="找不到 DS18B20"
    NoTemperatureSensor = 6,
    //% block="溫度資料校驗失敗"
    TemperatureCRC = 7,
    //% block="溫度通訊或供電錯誤"
    TemperatureBus = 8,
    //% block="超出模組範圍"
    OutOfRange = 9,
    //% block="腳位設定錯誤"
    BadPins = 10
}

/** A single calibrated pH module and one externally powered DS18B20. */
//% color="#087F8C" icon="\uf0c3" block="pH 水質計"
//% groups='["設定", "校準", "量度", "讀數", "診斷"]'
namespace phMeter {
    let phPin = AnalogPin.P1;
    let tempPin = DigitalPin.P2;
    let configured = true;
    let busy = false;
    let compensation = false;
    let useCustom = false;
    let parameterError = false;
    let xs: number[] = [];
    let ys: number[] = [];
    let ts: number[] = [];
    let lastPH = -1000;
    let lastT = -1000;
    let lastADC = -1000;
    let spread = 0;
    let phState = PHStatus.NoReading;
    let tempState = PHStatus.NoReading;
    let calState = PHStatus.NotCalibrated;

    // Simulator deliberately reports no sensor; never invent a water temperature.
    //% shim=phMeter::_startTemperature
    function _startTemperature(pin: number): number { return -1; }
    //% shim=phMeter::_finishTemperature
    function _finishTemperature(pin: number): number { return -16001; }

    function lock(): void {
        while (busy) basic.pause(5);
        busy = true;
    }
    function bounded(v: number, lo: number, hi: number): boolean {
        return v >= lo && v <= hi;
    }
    function invalidate(): void {
        lastPH = -1000;
        phState = PHStatus.NoReading;
    }
    function validPins(a: number, d: number): boolean {
        if (a == d) return false;
        return (a == AnalogPin.P1 || a == AnalogPin.P2 || a == AnalogPin.P3 || a == AnalogPin.P4 || a == AnalogPin.P10)
            && (d == DigitalPin.P1 || d == DigitalPin.P2
                || d == DigitalPin.P8 || d == DigitalPin.P12 || d == DigitalPin.P13
                || d == DigitalPin.P14 || d == DigitalPin.P15);
    }

    /** Changing pins clears calibration. P1 and P2 avoid Robotbit's P0 buzzer. */
    //% blockId=phm_setup block="設定 pH 類比腳 %analogPin 水溫腳 %temperaturePin"
    //% analogPin.defl=PHAnalogPin.P1 temperaturePin.defl=PHTemperaturePin.P2
    //% group="設定" weight=100
    export function setup(analogPin: PHAnalogPin, temperaturePin: PHTemperaturePin): void {
        lock();
        phPin = <AnalogPin><number>analogPin;
        tempPin = <DigitalPin><number>temperaturePin;
        configured = validPins(analogPin, temperaturePin);
        // These analog pins share the LED matrix. Leave it disabled until the user explicitly re-enables it.
        if (configured && (analogPin == PHAnalogPin.P3 || analogPin == PHAnalogPin.P4 || analogPin == PHAnalogPin.P10)) led.enable(false);
        xs = []; ys = []; ts = [];
        useCustom = false; parameterError = false;
        calState = PHStatus.NotCalibrated;
        lastADC = -1000; lastT = -1000;
        tempState = PHStatus.NoReading;
        invalidate();
        if (!configured) phState = PHStatus.BadPins;
        busy = false;
    }

    /** Optional Nernst slope correction about assumed isopotential pH 7. */
    //% blockId=phm_atc block="啟用電極溫度補償 %enabled"
    //% group="設定" weight=95
    export function setTemperatureCompensation(enabled: boolean): void {
        lock(); compensation = enabled; invalidate(); busy = false;
    }

    /** Disabled: use nominal defaults for a 1/2 divider and 3.3V ADC. Enabled: load your PH1 text; invalid input fails closed. */
    //% blockId=phm_parameters block="採用調試參數 %enabled 校準文字 %data"
    //% enabled.defl=false
    //% group="設定" weight=94
    export function setParameters(enabled: boolean, data: string): void {
        if (!enabled) {
            lock(); useCustom = false; parameterError = false; invalidate(); busy = false;
        } else {
            let ok = restoreCalibration(data);
            lock(); useCustom = true; parameterError = !ok; invalidate(); busy = false;
        }
    }

    /** Fresh DS18B20 signed reading in units of 1/16 degree C; -1000 indicates failure. */
    //% blockId=phm_raw_temperature block="讀取溫度原始數據（1/16 °C）"
    //% group="量度" weight=66
    export function readRawTemperature(): number {
        lock(); temperatureInternal();
        let result = tempState == PHStatus.OK ? lastT * 16 : -1000;
        busy = false; return result;
    }

    function sample(): PHStatus {
        lastADC = -1000;
        if (!configured) return PHStatus.BadPins;
        let v: number[] = [];
        // Discard first conversion after any previous digital use.
        pins.analogReadPin(phPin);
        basic.pause(5);
        for (let i = 0; i < 21; i++) {
            v.push(pins.analogReadPin(phPin));
            basic.pause(10);
        }
        for (let i = 1; i < v.length; i++) {
            let value = v[i];
            let j = i - 1;
            while (j >= 0 && v[j] > value) {
                v[j + 1] = v[j]; j--;
            }
            v[j + 1] = value;
        }
        // Median rejects spikes; spread excludes only the two extreme samples.
        lastADC = v[10];
        spread = v[19] - v[1];
        if (v[0] <= 2 || v[20] >= 1021) return PHStatus.ADCClipped;
        if (spread > 12) return PHStatus.Unstable;
        return PHStatus.OK;
    }

    function validCalibration(a: number[], p: number[], t: number[]): boolean {
        if (a.length < 2 || a.length > 3 || p.length != a.length || t.length != a.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!bounded(a[i], 3, 1020) || !bounded(p[i], 0, 14) || !bounded(t[i], 0, 60)) return false;
            for (let j = 0; j < i; j++) {
                if (Math.abs(a[i] - a[j]) < 16 || Math.abs(p[i] - p[j]) < 0.5 || Math.abs(t[i] - t[j]) > 1) return false;
                // This module's output decreases as pH increases.
                if ((a[i] - a[j]) * (p[i] - p[j]) >= 0) return false;
            }
        }
        return true;
    }

    /** Capture only after the electrode has settled. Enter buffer pH at its actual temperature. */
    //% blockId=phm_calibrate block="校準 %point 緩衝液 pH %bufferPH 溫度 °C %temperature"
    //% bufferPH.defl=6.86 bufferPH.min=0 bufferPH.max=14 temperature.defl=25
    //% group="校準" weight=90 advanced=true
    export function calibrate(point: PHCalibrationPoint, bufferPH: number, temperature: number): boolean {
        lock();
        invalidate();
        useCustom = true; parameterError = false;
        if (!bounded(point, 0, 2) || point != Math.floor(point) || point > xs.length
            || !bounded(bufferPH, 0, 14) || !bounded(temperature, 0, 60)) {
            calState = PHStatus.BadCalibration; busy = false; return false;
        }
        calState = sample();
        if (calState != PHStatus.OK) { busy = false; return false; }
        let a = xs.slice(); let p = ys.slice(); let t = ts.slice();
        a[point] = lastADC; p[point] = bufferPH; t[point] = temperature;
        if (a.length > 1 && !validCalibration(a, p, t)) {
            calState = PHStatus.BadCalibration; busy = false; return false;
        }
        xs = a; ys = p; ts = t;
        calState = PHStatus.OK;
        busy = false;
        return true;
    }

    //% blockId=phm_clear block="清除 pH 校準"
    //% group="校準" weight=80 advanced=true
    export function clearCalibration(): void {
        lock(); useCustom = true; parameterError = false; xs = []; ys = []; ts = []; calState = PHStatus.NotCalibrated;
        invalidate(); busy = false;
    }

    //% blockId=phm_calibrated block="pH 已完成校準"
    //% group="校準" weight=79 advanced=true
    export function isCalibrated(): boolean { return validCalibration(xs, ys, ts); }

    //% blockId=phm_calcount block="已記錄校準點數"
    //% group="校準" weight=78 advanced=true
    export function calibrationCount(): number { return xs.length; }

    /** Copy this text to restoreCalibration in on-start to retain it after power-off. */
    //% blockId=phm_export block="pH 校準參數"
    //% group="校準" weight=77 advanced=true
    export function exportCalibration(): string {
        if (!isCalibrated()) return "";
        let s = "PH1";
        for (let i = 0; i < xs.length; i++) s = s + "," + xs[i] + "," + ys[i] + "," + ts[i];
        return s;
    }

    /** Print one complete parameter string to the USB serial console. */
    //% blockId=phm_output_calibration block="輸出 pH 校準參數到 USB 串列"
    //% group="校準" weight=77 advanced=true
    export function outputCalibration(): void {
        let data = exportCalibration();
        if (data.length > 0) serial.writeLine(data);
        else serial.writeLine("CAL ERR: need at least two valid calibration points");
    }

    //% blockId=phm_restore block="載入 pH 校準參數 %data"
    //% group="校準" weight=76 advanced=true
    export function restoreCalibration(data: string): boolean {
        lock();
        let parts = data.split(",");
        let a: number[] = []; let p: number[] = []; let t: number[] = [];
        let valid = (parts.length == 7 || parts.length == 10) && parts[0] == "PH1";
        for (let i = 1; valid && i < parts.length; i++) {
            // Strict decimal format; reject partial parse, whitespace, NaN and Infinity.
            let dots = 0; let digits = 0;
            for (let k = 0; k < parts[i].length; k++) {
                let c = parts[i].charAt(k);
                if (c == ".") dots++;
                else if (c >= "0" && c <= "9") digits++;
                else valid = false;
            }
            if (dots > 1 || digits == 0) valid = false;
        }
        if (valid) {
            for (let i = 1; i < parts.length; i += 3) {
                a.push(parseFloat(parts[i])); p.push(parseFloat(parts[i + 1])); t.push(parseFloat(parts[i + 2]));
            }
            valid = validCalibration(a, p, t);
        }
        calState = valid ? PHStatus.OK : PHStatus.BadCalibration;
        if (valid) { useCustom = true; parameterError = false; xs = a; ys = p; ts = t; invalidate(); }
        busy = false;
        return valid;
    }

    function temperatureInternal(): void {
        lastT = -1000;
        if (!configured) { tempState = PHStatus.BadPins; return; }
        let result = _startTemperature(tempPin);
        if (result < 0) {
            tempState = result == -1 ? PHStatus.NoTemperatureSensor : result == -2 ? PHStatus.TemperatureCRC : PHStatus.TemperatureBus;
            return;
        }
        basic.pause(800);
        result = _finishTemperature(tempPin);
        if (result < -16000) {
            tempState = result == -16001 ? PHStatus.NoTemperatureSensor : result == -16002 ? PHStatus.TemperatureCRC : PHStatus.TemperatureBus;
            return;
        }
        lastT = result / 16;
        tempState = bounded(lastT, 0, 60) ? PHStatus.OK : PHStatus.OutOfRange;
    }

    function calculate(): void {
        lastPH = -1000;
        phState = sample();
        if (phState != PHStatus.OK) return;
        if (useCustom && parameterError) { phState = PHStatus.BadCalibration; return; }
        if (useCustom && !isCalibrated()) { phState = PHStatus.NotCalibrated; return; }
        if (compensation && tempState != PHStatus.OK) { phState = tempState; return; }
        // Sort copies by pH so calibration may be done in any pH order.
        let a = useCustom ? xs.slice() : [390.6, 465, 328.6];
        let p = useCustom ? ys.slice() : [6.86, 4, 9.18];
        for (let i = 0; i < p.length; i++) {
            for (let j = i + 1; j < p.length; j++) {
                if (p[i] > p[j]) {
                    let v = p[i]; p[i] = p[j]; p[j] = v;
                    v = a[i]; a[i] = a[j]; a[j] = v;
                }
            }
        }
        let segment = 0;
        if (p.length == 3 && lastADC < a[1]) segment = 1;
        let m = (p[segment + 1] - p[segment]) / (a[segment + 1] - a[segment]);
        let ph = p[segment] + (lastADC - a[segment]) * m;
        if (compensation) {
            let calT = 0;
            for (let i = 0; i < ts.length; i++) calT += ts[i];
            calT = useCustom ? calT / ts.length : 25;
            ph = 7 + (ph - 7) * (calT + 273.15) / (lastT + 273.15);
        }
        if (!bounded(ph, 0, 14)) { phState = PHStatus.OutOfRange; return; }
        lastPH = ph;
    }

    /** Fresh temperature and pH, about one second. Inspect both status blocks. */
    //% blockId=phm_measure block="量度一次（水溫及 pH）"
    //% group="量度" weight=70 advanced=true
    export function measure(): void {
        lock(); temperatureInternal(); calculate(); busy = false;
    }

    /** Fresh ADC measurement; also takes a fresh temperature if compensation is enabled. */
    //% blockId=phm_readph block="量度 pH 值"
    //% group="量度" weight=69
    export function readPH(): number {
        lock();
        if (compensation) temperatureInternal();
        calculate(); busy = false; return lastPH;
    }

    //% blockId=phm_readtemp block="量度水溫 °C"
    //% group="量度" weight=68
    export function readWaterTemperature(): number {
        lock(); temperatureInternal(); busy = false; return lastT;
    }

    /** Fresh filtered raw ADC; does not require calibration. Invalidates previous pH. */
    //% blockId=phm_readraw block="讀取 pH 原始數據 ADC"
    //% group="量度" weight=67
    export function readRawADC(): number {
        lock(); invalidate(); phState = sample(); busy = false; return lastADC;
    }

    //% blockId=phm_ph block="上次 pH 值"
    //% group="讀數" weight=60 advanced=true
    export function ph(): number { return lastPH; }
    //% blockId=phm_temp block="上次水溫 °C"
    //% group="讀數" weight=59 advanced=true
    export function waterTemperature(): number { return lastT; }
    //% blockId=phm_adc block="上次原始 ADC"
    //% group="讀數" weight=58 advanced=true
    export function rawADC(): number { return lastADC; }
    //% blockId=phm_spread block="上次 ADC 波動幅度"
    //% group="診斷" weight=50 advanced=true
    export function adcSpread(): number { return spread; }
    //% blockId=phm_phstatus block="pH 狀態"
    //% group="診斷" weight=49 advanced=true
    export function phStatus(): PHStatus { return phState; }
    //% blockId=phm_tempstatus block="水溫狀態"
    //% group="診斷" weight=48 advanced=true
    export function temperatureStatus(): PHStatus { return tempState; }
    //% blockId=phm_calstatus block="上次校準操作狀態"
    //% group="診斷" weight=47 advanced=true
    export function calibrationStatus(): PHStatus { return calState; }

    //% blockId=phm_statuscode block="狀態 %status"
    //% group="診斷" weight=46 advanced=true
    export function statusCode(status: PHStatus): PHStatus { return status; }
}
