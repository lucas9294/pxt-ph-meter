// Paste the complete PH1,... parameter from your own calibration here.
// Empty text deliberately prevents measurement until a valid parameter is supplied.
phMeter.setup(PHAnalogPin.P1, PHTemperaturePin.P2);
phMeter.setTemperatureCompensation(false);
if (phMeter.restoreCalibration("")) {
    basic.showString("OK");
} else {
    basic.showString("CAL ERR");
}
input.onButtonPressed(Button.B, function () {
    let value = phMeter.readPH();
    if (phMeter.phStatus() == phMeter.statusCode(PHStatus.OK)) {
        serial.writeValue("pH", value);
        basic.showNumber(Math.round(value * 100) / 100);
    } else {
        basic.showString("PH ERR");
    }
});
