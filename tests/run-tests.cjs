// Host-side behavioral tests. Hardware IO is mocked; these do not test wire timing.
// Run with TypeScript 5.8.3 installed: node tests/run-tests.cjs
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../main.ts'), 'utf8');
let checks = 0;
function check(v, label) { assert.ok(v, label); checks++; }
function near(a, b, label) { check(Math.abs(a-b) < 1e-7, label); }
function meter(native = false) {
    let values = [500], cursor = 0;
    const pinsEnum = {P0:100, P1:101, P2:102, P3:103, P4:104, P10:110, P8:108, P12:112, P13:113, P14:114, P15:115};
    const ctx = { Math, parseFloat, AnalogPin:pinsEnum, DigitalPin:pinsEnum,
        basic:{pause(){}}, pins:{analogReadPin(){return values[(cursor++) % values.length];}},
        __start:0, __finish:400, output:[] };
    ctx.led = {enable(value){ctx.ledEnabled=value;}};
    ctx.serial = {writeLine(text){ctx.output.push(text);}};
    // Substitute only the two native simulator fallback bodies to inject driver results.
    let code = source;
    if (native) code = code.replace('return -1; }','return __start; }')
        .replace('return -16001; }','return __finish; }');
    vm.createContext(ctx);
    vm.runInContext(ts.transpileModule(code, {compilerOptions:{target:ts.ScriptTarget.ES2017}}).outputText, ctx);
    return {ctx, m:ctx.phMeter, s:ctx.PHStatus, adc(v){values = Array.isArray(v)?v:[v];cursor=0;}};
}

let h = meter(); let {m,s} = h;
check(m.ph() === -1000, 'no fabricated initial pH');
m.clearCalibration();
check(m.readPH() === -1000 && m.phStatus() === s.NotCalibrated, 'requires calibration');
h.adc(500);
check(m.calibrate(0,7,25), 'first point');
check(!m.isCalibrated(), 'one point insufficient');
m.outputCalibration();
check(h.ctx.output[0].indexOf('CAL ERR:') === 0, 'incomplete calibration outputs error');
h.adc(650);
check(m.calibrate(1,4,25), 'second point');
check(m.isCalibrated(), 'two points valid');
near(m.readPH(),4,'acid anchor');
h.adc(575);near(m.readPH(),5.5,'linear midpoint');
const two=m.exportCalibration();
check(two==='PH1,500,7,25,650,4,25','export exact');
m.outputCalibration();
check(h.ctx.output[1] === two, 'serial parameter is exactly the restorable text');
const reboot = meter();
check(reboot.m.restoreCalibration(h.ctx.output[1]), 'parameter restores after restart');
reboot.adc(575);
near(reboot.m.readPH(), 5.5, 'restored parameter reproduces measurement');
h.adc(400);check(m.calibrate(2,9,25),'third point');
h.adc(450);near(m.readPH(),8,'alkaline segment');
h.adc(575);near(m.readPH(),5.5,'acid segment');
h.adc(350);near(m.readPH(),10,'extrapolation');
const three=m.exportCalibration();
h.adc(505);check(!m.calibrate(1,4,25),'nearly identical ADC rejected');
check(m.exportCalibration()===three,'failed calibration atomic');
h.adc(650);check(!m.calibrate(1,4,27),'temperature mismatch rejected');
check(m.calibrate(1,4.1,25) && m.isCalibrated(),'valid replacement allowed');
check(m.restoreCalibration(three),'restore three');
for (const bad of ['', 'PH1,0,7,25,650,4,25','PH1,500,7,25,650,9,25',
    'PH1,500,7,25,650,7.1,25','PH1,500,7,25,650,4,27','PH1,500x,7,25,650,4,25',
    'PH1,NaN,7,25,650,4,25','PH1,Infinity,7,25,650,4,25','PH1,,7,25,650,4,25',
    'PH1,500,7,25,650,4,25,600,10,25','PH1,500,7,25,650,4,25,',
    'PH1,500,7,25,650,4,25,400,9,-10']) {
    check(!m.restoreCalibration(bad), 'invalid import: '+bad);
    check(m.exportCalibration()===three,'import is transactional');
}
h.adc(0);check(m.readPH()===-1000 && m.phStatus()===s.ADCClipped,'low rail');
h.adc(1023);check(m.readPH()===-1000 && m.phStatus()===s.ADCClipped,'high rail');
h.adc([500,540]);check(m.readPH()===-1000 && m.phStatus()===s.Unstable,'unstable signal');
h.adc([500,500,500,500,500,500,500,500,500,500,700]);
check(m.readPH()===-1000,'frequent spikes rejected');
h.adc(500);near(m.readPH(),7,'recovery after failure');
check(m.readWaterTemperature()===-1000 && m.temperatureStatus()===s.NoTemperatureSensor,'simulator no sensor');
m.setTemperatureCompensation(true);
check(m.readPH()===-1000 && m.phStatus()===s.NoTemperatureSensor,'ATC cannot silently use stale/default temperature');
m.setTemperatureCompensation(false);near(m.readPH(),7,'pH without sensor');
check(m.readRawADC()===500 && m.ph()===-1000,'raw read invalidates old pH');
m.setup(101,101);check(m.readPH()===-1000 && m.phStatus()===s.BadPins,'pin collision');
m.setup(108,102);check(m.readPH()===-1000 && m.phStatus()===s.BadPins,'non-analog Robotbit pin');
m.setup(101,102);check(!m.isCalibrated(),'setup resets calibration');
check(!m.calibrate(2,9,25),'cannot skip calibration slots');
check(!m.calibrate(0,-1,25),'pH validation');
check(!m.calibrate(0,7,61),'temperature validation');
check(m.restoreCalibration(two),'restore after setup');
m.clearCalibration();check(!m.isCalibrated() && m.exportCalibration()==='','clear');

h=meter(true);m=h.m;s=h.s;
check(m.restoreCalibration(two),'ATC fixture');
h.adc(650);m.setTemperatureCompensation(true);
near(m.readPH(),4,'ATC identity at calibration temperature');
h.ctx.__finish=560;
near(m.readPH(),7-3*298.15/308.15,'Nernst slope at 35 C');
near(m.waterTemperature(),35,'sixteenths converted');
for(const [code,state] of [[-1,s.NoTemperatureSensor],[-2,s.TemperatureCRC],[-3,s.TemperatureBus]]) {
    h.ctx.__start=code;
    check(m.readWaterTemperature()===-1000 && m.temperatureStatus()===state,'start error '+code);
}
h.ctx.__start=0;
for(const [code,state] of [[-16001,s.NoTemperatureSensor],[-16002,s.TemperatureCRC],[-16003,s.TemperatureBus]]) {
    h.ctx.__finish=code;
    check(m.readWaterTemperature()===-1000 && m.temperatureStatus()===state,'finish error '+code);
}
for(const raw of [-160,1360]) {
    h.ctx.__finish=raw;
    near(m.readWaterTemperature(),raw/16,'out-of-range temperature retained for diagnostics');
    check(m.temperatureStatus()===s.OutOfRange,'application temperature range');
    check(m.readPH()===-1000 && m.phStatus()===s.OutOfRange,'ATC rejects temperature range');
}
h.ctx.__finish=400;h.adc(5);m.setTemperatureCompensation(false);
check(m.readPH()===-1000 && m.phStatus()===s.OutOfRange,'pH not clamped');
h=meter(true);m=h.m;s=h.s;
h.adc(465);near(m.readPH(),4,'default mode without calibration');
check(!m.isCalibrated() && m.exportCalibration()==='', 'defaults are not exported as real calibration');
m.setParameters(true,two);h.adc(500);near(m.readPH(),7,'custom mode');
m.setParameters(true,'bad');check(m.readPH()===-1000 && m.phStatus()===s.BadCalibration,'bad selected parameters fail closed');
m.setParameters(false,'bad');h.adc(465);near(m.readPH(),4,'disabled ignores text and uses defaults');
m.setTemperatureCompensation(true);near(m.readPH(),4,'defaults ATC at 25 C');
check(m.readRawTemperature()===400,'fresh raw temperature');
h.ctx.__finish=480;check(m.readRawTemperature()===480,'raw temperature refreshes');
h.ctx.__finish=-16002;check(m.readRawTemperature()===-1000 && m.temperatureStatus()===s.TemperatureCRC,'raw CRC error no stale value');
m.setup(101,102);h.adc(465);m.setTemperatureCompensation(false);near(m.readPH(),4,'setup returns to defaults');
const primary=source.split('\n').filter(x=>x.includes('//% group=')).filter(x=>!x.includes('advanced=true'));
check(primary.length===7,'exactly seven primary blocks');
for (const pin of [101,102,103,104,110]) {
    h=meter();m=h.m;s=h.s;m.setup(pin,pin===102?101:102);h.adc(465);
    near(m.readPH(),4,'allowed analog pin '+pin);
    check(h.ctx.ledEnabled === ([103,104,110].includes(pin)?false:undefined),'LED sharing '+pin);
}
m.setup(100,102);check(m.readPH()===-1000 && m.phStatus()===s.BadPins,'P0 analog rejected');
m.setup(101,100);check(m.readPH()===-1000 && m.phStatus()===s.BadPins,'P0 temperature rejected');
console.log(`PASS: ${checks} behavioral checks (mock IO; native timing untested).`);
