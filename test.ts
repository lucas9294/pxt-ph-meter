// Default estimates require a 10k/10k divider. Replace with your calibration for accurate readings.
phMeter.setup(PHAnalogPin.P1, PHTemperaturePin.P2);
phMeter.setTemperatureCompensation(false);
phMeter.setParameters(false, "");
input.onButtonPressed(Button.A, function () {
    basic.showNumber(phMeter.readPH());
});
input.onButtonPressed(Button.B, function () {
    basic.showNumber(phMeter.readWaterTemperature());
});
input.onButtonPressed(Button.AB, function () {
    serial.writeValue("pH_ADC", phMeter.readRawADC());
    serial.writeValue("temperature_raw", phMeter.readRawTemperature());
});
