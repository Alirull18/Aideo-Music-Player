use wasapi::*;

pub fn test() {
    initialize_mta().unwrap();
    let devices = DeviceCollection::new(&Direction::Render).unwrap();
    let device = devices.get_device_at_index(0).unwrap();
    let mut client = device.get_iaudioclient().unwrap();
    let format = WaveFormat::new(32, 32, &SampleType::Float, 44100, 2, None);
    client.initialize_client(&format, 300000, &Direction::Render, &ShareMode::Exclusive, false).unwrap();
    let event = client.set_get_eventhandle().unwrap();
    let render_client = client.get_audiorenderclient().unwrap();
    client.start_stream().unwrap();
}
