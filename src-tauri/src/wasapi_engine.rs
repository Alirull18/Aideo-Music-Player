#[cfg(target_os = "windows")]
use wasapi::{
    initialize_mta, DeviceEnumerator, Direction, SampleType, ShareMode, StreamMode,
    WaveFormat,
};
#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "windows")]
use std::sync::Arc;
#[cfg(target_os = "windows")]
use std::thread;

pub struct WasapiStream {
    shutdown: Arc<AtomicBool>,
    handle: Option<thread::JoinHandle<()>>,
}

impl Drop for WasapiStream {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

#[cfg(target_os = "windows")]
pub fn start_exclusive_stream<F>(
    device_name: &str,
    sample_rate: u32,
    channels: u16,
    mut callback: F,
) -> Result<WasapiStream, String>
where
    F: FnMut(&mut [f32]) + Send + 'static,
{
    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = Arc::clone(&shutdown);
    let dev_name = device_name.to_string();

    let (tx, rx) = std::sync::mpsc::sync_channel(1);

    let handle = thread::spawn(move || {
        let _ = initialize_mta();

        // ELEVATE THREAD TO REAL-TIME PRO AUDIO PRIORITY
        unsafe {
            let _ = windows::Win32::System::Threading::SetThreadPriority(
                windows::Win32::System::Threading::GetCurrentThread(),
                windows::Win32::System::Threading::THREAD_PRIORITY_TIME_CRITICAL,
            );
        }

        let enumerator = match DeviceEnumerator::new() {
            Ok(e) => e,
            Err(_) => {
                let _ = tx.send(Err("Failed to get DeviceEnumerator".to_string()));
                return;
            }
        };

        let collection = match enumerator.get_device_collection(&Direction::Render) {
            Ok(c) => c,
            Err(_) => {
                let _ = tx.send(Err("Failed to get device collection".to_string()));
                return;
            }
        };

        let mut target_device = None;

        if dev_name == "Default Device" || dev_name.is_empty() {
            target_device = enumerator.get_default_device(&Direction::Render).ok();
        } else {
            let count = collection.get_nbr_devices().unwrap_or(0);
            for i in 0..count {
                if let Ok(dev) = collection.get_device_at_index(i) {
                    if let Ok(name) = dev.get_friendlyname() {
                        if name.contains(&dev_name) || dev_name.contains(&name) {
                            target_device = Some(dev);
                            break;
                        }
                    }
                }
            }
        }

        let device = match target_device {
            Some(d) => d,
            None => {
                let _ = tx.send(Err(format!("Target device not found: {}", dev_name)));
                return;
            }
        };

        let test_formats = [
            (32, 32, true),  // 32-bit Float
            (32, 32, false), // 32-bit Int
            (32, 24, false), // 24-bit Int padded to 32 bits
            (24, 24, false), // 24-bit Int packed (3 bytes)
            (16, 16, false), // 16-bit Int
        ];

        let mut successful_client = None;
        let mut negotiated_format = None;

        for &(bits, valid_bits, is_float) in &test_formats {
            let mut test_client = match device.get_iaudioclient() {
                Ok(c) => c,
                Err(_) => continue,
            };

            let sample_type = if is_float { SampleType::Float } else { SampleType::Int };
            let format = WaveFormat::new(
                bits,
                valid_bits,
                &sample_type,
                sample_rate as usize,
                channels as usize,
                None,
            );

            if test_client.is_supported(&format, &ShareMode::Exclusive).is_ok() {
                let (def_period, _) = test_client.get_device_period().unwrap_or((100000, 30000));
                let mode = StreamMode::EventsExclusive { period_hns: def_period };
                if test_client.initialize_client(&format, &Direction::Render, &mode).is_ok() {
                    successful_client = Some(test_client);
                    negotiated_format = Some((format, bits, valid_bits, is_float));
                    break;
                }
            }
        }

        let (_format, bits, valid_bits, is_float) = match negotiated_format {
            Some(f) => f,
            None => {
                let _ = tx.send(Err(format!("Device does not support Exclusive Mode at {}Hz", sample_rate)));
                return;
            }
        };

        let client = successful_client.unwrap();

        let event = match client.set_get_eventhandle() {
            Ok(e) => e,
            Err(_) => {
                let _ = tx.send(Err("Failed to set event handle".to_string()));
                return;
            }
        };

        let render_client = match client.get_audiorenderclient() {
            Ok(r) => r,
            Err(_) => {
                let _ = tx.send(Err("Failed to get render client".to_string()));
                return;
            }
        };

        let buffer_size = client.get_buffer_size().unwrap_or(0);
        if buffer_size == 0 {
            let _ = tx.send(Err("Exclusive buffer size is 0, aborting".to_string()));
            return;
        }

        let num_frames = buffer_size as usize;
        let num_samples = num_frames * channels as usize;
        let mut f32_data = vec![0.0f32; num_samples];
        
        let bytes_per_sample = bits / 8;
        let mut output_bytes = vec![0u8; num_samples * bytes_per_sample];

        // PRE-FILL FIRST BUFFER WITH SILENCE BEFORE STARTING STREAM
        let _ = render_client.write_to_device(
            num_frames,
            &output_bytes,
            None,
        );

        if client.start_stream().is_err() {
            let _ = tx.send(Err("Failed to start stream".to_string()));
            return;
        }

        // Notify main thread of success
        if tx.send(Ok(())).is_err() {
            // Main thread dropped the receiver, abort
            return;
        }

        let format_desc = if is_float { "Float32" } else { if valid_bits == 24 { "Int24" } else if bits == 32 { "Int32" } else { "Int16" } };
        println!("[wasapi] Exclusive Mode STARTED: {}Hz {}ch [{}]", sample_rate, channels, format_desc);

        while !shutdown_clone.load(Ordering::Relaxed) {
            if event.wait_for_event(2000).is_err() {
                break;
            }
            
            callback(&mut f32_data);
            
            // Quantize and format conversion
            if is_float {
                for sample in f32_data.iter_mut() {
                    *sample = if *sample > 1.0 { 1.0 } else if *sample < -1.0 { -1.0 } else { *sample };
                }
                let byte_slice = unsafe {
                    std::slice::from_raw_parts(
                        f32_data.as_ptr() as *const u8,
                        f32_data.len() * 4,
                    )
                };
                output_bytes.copy_from_slice(byte_slice);
            } else if bits == 32 {
                // 32-bit container: Int32 or Int24
                // WASAPI expects 24-bit valid data to be left-justified in the 32-bit container.
                // Multiplying by i32::MAX automatically aligns it to the most significant bits.
                let multiplier = 2147483647.0; 
                let mask = if valid_bits == 24 { !0xFF } else { !0 };
                for (i, &sample) in f32_data.iter().enumerate() {
                    let clamped = if sample > 1.0 { 1.0 } else if sample < -1.0 { -1.0 } else { sample };
                    let quantized = ((clamped * multiplier) as i32) & mask;
                    let bytes = quantized.to_ne_bytes();
                    let offset = i * 4;
                    output_bytes[offset] = bytes[0];
                    output_bytes[offset + 1] = bytes[1];
                    output_bytes[offset + 2] = bytes[2];
                    output_bytes[offset + 3] = bytes[3];
                }
            } else if bits == 24 {
                // 24-bit container: Int24 packed (3 bytes per sample)
                let multiplier = 8388607.0; // 2^23 - 1
                for (i, &sample) in f32_data.iter().enumerate() {
                    let clamped = if sample > 1.0 { 1.0 } else if sample < -1.0 { -1.0 } else { sample };
                    let quantized = (clamped * multiplier) as i32;
                    let bytes = quantized.to_ne_bytes();
                    let offset = i * 3;
                    // Write the lowest 3 bytes (little-endian)
                    output_bytes[offset] = bytes[0];
                    output_bytes[offset + 1] = bytes[1];
                    output_bytes[offset + 2] = bytes[2];
                }
            } else if bits == 16 {
                // 16-bit container: Int16
                let multiplier = 32767.0; // i16::MAX
                for (i, &sample) in f32_data.iter().enumerate() {
                    let clamped = if sample > 1.0 { 1.0 } else if sample < -1.0 { -1.0 } else { sample };
                    let quantized = (clamped * multiplier) as i16;
                    let bytes = quantized.to_ne_bytes();
                    let offset = i * 2;
                    output_bytes[offset] = bytes[0];
                    output_bytes[offset + 1] = bytes[1];
                }
            }
            
            if render_client.write_to_device(
                num_frames,
                &output_bytes,
                None,
            ).is_err() {
                break;
            }
        }

        let _ = client.stop_stream();
    });

    match rx.recv() {
        Ok(Ok(())) => Ok(WasapiStream {
            shutdown,
            handle: Some(handle),
        }),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("WASAPI initialization thread panicked".to_string()),
    }
}

#[cfg(not(target_os = "windows"))]
pub fn start_exclusive_stream<F>(
    _device_name: &str,
    _sample_rate: u32,
    _channels: u16,
    _callback: F,
) -> Result<WasapiStream, String>
where
    F: FnMut(&mut [f32]) + Send + 'static,
{
    Err("Exclusive mode only supported on Windows".to_string())
}
