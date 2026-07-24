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
pub fn start_exclusive_stream<F, E>(
    device_name: &str,
    sample_rate: u32,
    channels: u16,
    timing_mode: &str,
    dither_enabled: bool,
    mut callback: F,
    mut on_error: E,
) -> Result<(WasapiStream, u16, bool), String>
where
    F: FnMut(&mut [f32]) + Send + 'static,
    E: FnMut(String) + Send + 'static,
{
    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = Arc::clone(&shutdown);
    let dev_name = device_name.to_string();
    let timing_str = timing_mode.to_string();

    let (tx, rx) = std::sync::mpsc::sync_channel::<Result<(u16, bool), String>>(1);

    let handle = thread::spawn(move || {
        let _ = initialize_mta();

        // ELEVATE THREAD TO REAL-TIME PRO AUDIO PRIORITY WITH MMCSS
        let mut task_index = 0u32;
        let mmcss_handle = unsafe {
            windows::Win32::System::Threading::AvSetMmThreadCharacteristicsW(
                windows::core::w!("Pro Audio"),
                &mut task_index,
            )
        };

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
            let mut candidates = Vec::new();
            for i in 0..count {
                if let Ok(dev) = collection.get_device_at_index(i) {
                    if let Ok(name) = dev.get_friendlyname() {
                        candidates.push((i, name));
                    }
                }
            }

            let mut matched_idx = None;

            // Tier 1: Exact Match
            for (idx, name) in &candidates {
                if name == &dev_name {
                    matched_idx = Some(*idx);
                    break;
                }
            }

            // Tier 2: Case-Insensitive Exact Match
            if matched_idx.is_none() {
                let dev_name_lower = dev_name.to_lowercase();
                for (idx, name) in &candidates {
                    if name.to_lowercase() == dev_name_lower {
                        matched_idx = Some(*idx);
                        break;
                    }
                }
            }

            // Tier 3: Model-Specific Match (filtering out generic terms)
            if matched_idx.is_none() {
                let generic_words = ["headphone", "headphones", "speaker", "speakers", "audio", "device", "realtek", "high", "definition", "out", "line", "sound"];
                
                let model_tokens: Vec<&str> = dev_name
                    .split(|c: char| !c.is_alphanumeric())
                    .filter(|token| {
                        let t = token.to_lowercase();
                        !t.is_empty() && !generic_words.contains(&t.as_str())
                    })
                    .collect();

                if !model_tokens.is_empty() {
                    for (idx, name) in &candidates {
                        let name_lower = name.to_lowercase();
                        if model_tokens.iter().all(|token| name_lower.contains(&token.to_lowercase())) {
                            matched_idx = Some(*idx);
                            break;
                        }
                    }
                }
            }

            // Tier 4: Fallback Substring Match
            if matched_idx.is_none() {
                for (idx, name) in &candidates {
                    if name.contains(&dev_name) {
                        matched_idx = Some(*idx);
                        break;
                    }
                }
            }

            if let Some(idx) = matched_idx {
                target_device = collection.get_device_at_index(idx).ok();
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
                let is_polling = timing_str == "polling";
                let (def_period, min_period) = test_client.get_device_period().unwrap_or((100000, 30000));
                // Enforce a stable period of at least 10ms (100,000 hns) to prevent starvation on low-latency DACs
                let target_period = std::cmp::max(def_period, 100000).max(min_period);
                
                let mode = if is_polling {
                    StreamMode::PollingExclusive { 
                        buffer_duration_hns: target_period * 3, // Request 3 periods of buffer duration for safety margin
                        period_hns: target_period 
                    }
                } else {
                    StreamMode::EventsExclusive { period_hns: target_period }
                };

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

        let is_polling = timing_str == "polling";
        let event = if !is_polling {
            match client.set_get_eventhandle() {
                Ok(e) => Some(e),
                Err(_) => {
                    let _ = tx.send(Err("Failed to set event handle".to_string()));
                    return;
                }
            }
        } else {
            None
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

        let num_frames = if is_polling {
            (buffer_size / 3) as usize
        } else {
            buffer_size as usize
        };
        let num_samples = num_frames * channels as usize;
        let mut f32_data = vec![0.0f32; num_samples];
        
        let bytes_per_sample = bits / 8;
        let mut output_bytes = vec![0u8; num_samples * bytes_per_sample];

        // PRE-FILL FIRST BUFFER WITH SILENCE BEFORE STARTING STREAM
        if is_polling {
            // Pre-fill all 3 buffer periods with silence
            for _ in 0..3 {
                let _ = render_client.write_to_device(
                    num_frames,
                    &output_bytes,
                    None,
                );
            }
        } else {
            let _ = render_client.write_to_device(
                num_frames,
                &output_bytes,
                None,
            );
        }

        // Notify main thread of success FIRST
        if tx.send(Ok((valid_bits as u16, is_float))).is_err() {
            // Main thread dropped the receiver, abort
            return;
        }

        // Give the main thread a brief head start (50ms) to fill the ringbuffer
        std::thread::sleep(std::time::Duration::from_millis(50));

        if client.start_stream().is_err() {
            return;
        }

        let mut xor_state = rand::random::<u32>().max(1);
        macro_rules! next_dither {
            () => {{
                xor_state ^= xor_state << 13;
                xor_state ^= xor_state >> 17;
                xor_state ^= xor_state << 5;
                (xor_state as f32 / 4294967295.0) - 0.5
            }};
        }

        while !shutdown_clone.load(Ordering::Relaxed) {
            if is_polling {
                // In Polling mode, sleep for half of the buffer period duration, then query padding
                let sleep_ms = ((num_frames as f32 / sample_rate as f32) * 500.0) as u64;
                std::thread::sleep(std::time::Duration::from_millis(std::cmp::max(sleep_ms, 2)));

                let padding = match client.get_current_padding() {
                    Ok(p) => p,
                    Err(_) => {
                        if !shutdown_clone.load(Ordering::Relaxed) {
                            on_error("WASAPI exclusive polling error".to_string());
                        }
                        break;
                    }
                };

                let available_frames = buffer_size - padding;
                if available_frames < num_frames as u32 {
                    // Not enough space to write a full chunk yet, sleep and wait
                    continue;
                }
            } else {
                // In Event-driven mode, wait for event handle signals
                if let Some(ref ev) = event {
                    if ev.wait_for_event(2000).is_err() {
                        if !shutdown_clone.load(Ordering::Relaxed) {
                            on_error("WASAPI exclusive stream timed out".to_string());
                        }
                        break;
                    }
                }
            }
            
            callback(&mut f32_data);
            
            // Quantize and format conversion
            if is_float {
                for sample in f32_data.iter_mut() {
                    *sample = (*sample).clamp(-1.0, 1.0);
                }
                let byte_slice = unsafe {
                    std::slice::from_raw_parts(
                        f32_data.as_ptr() as *const u8,
                        f32_data.len() * 4,
                    )
                };
                if output_bytes.len() == byte_slice.len() {
                    output_bytes.copy_from_slice(byte_slice);
                }
            } else if bits == 32 {
                // 32-bit container: Int32 or Int24
                // WASAPI expects 24-bit valid data to be left-justified in the 32-bit container.
                let mask = if valid_bits == 24 { !0xFF } else { !0 };
                if valid_bits == 24 {
                    let multiplier = 8388607.0; // 2^23 - 1
                    for (i, &sample) in f32_data.iter().enumerate() {
                        let clamped = sample.clamp(-1.0, 1.0);
                        let val = if dither_enabled {
                            let r1 = next_dither!();
                            let r2 = next_dither!();
                            clamped * multiplier + r1 + r2
                        } else {
                            clamped * multiplier
                        };
                        let quantized = ((val.clamp(-multiplier, multiplier).round() as i32) << 8) & mask;
                        let bytes = quantized.to_ne_bytes();
                        let offset = i * 4;
                        output_bytes[offset] = bytes[0];
                        output_bytes[offset + 1] = bytes[1];
                        output_bytes[offset + 2] = bytes[2];
                        output_bytes[offset + 3] = bytes[3];
                    }
                } else {
                    let multiplier = 2147483647.0; 
                    for (i, &sample) in f32_data.iter().enumerate() {
                        let clamped = sample.clamp(-1.0, 1.0);
                        let val = if dither_enabled {
                            let r1 = next_dither!();
                            let r2 = next_dither!();
                            clamped * multiplier + r1 + r2
                        } else {
                            clamped * multiplier
                        };
                        let quantized = (val.clamp(-multiplier, multiplier).round() as i32) & mask;
                        let bytes = quantized.to_ne_bytes();
                        let offset = i * 4;
                        output_bytes[offset] = bytes[0];
                        output_bytes[offset + 1] = bytes[1];
                        output_bytes[offset + 2] = bytes[2];
                        output_bytes[offset + 3] = bytes[3];
                    }
                }
            } else if bits == 24 {
                // 24-bit container: Int24 packed (3 bytes per sample)
                let multiplier = 8388607.0; // 2^23 - 1
                for (i, &sample) in f32_data.iter().enumerate() {
                    let clamped = sample.clamp(-1.0, 1.0);
                    let val = if dither_enabled {
                        let r1 = next_dither!();
                        let r2 = next_dither!();
                        clamped * multiplier + r1 + r2
                    } else {
                        clamped * multiplier
                    };
                    let quantized = val.clamp(-multiplier, multiplier).round() as i32;
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
                    let clamped = sample.clamp(-1.0, 1.0);
                    let val = if dither_enabled {
                        let r1 = next_dither!();
                        let r2 = next_dither!();
                        clamped * multiplier + r1 + r2
                    } else {
                        clamped * multiplier
                    };
                    let quantized = val.clamp(-multiplier, multiplier).round() as i16;
                    let bytes = quantized.to_ne_bytes();
                    let offset = i * 2;
                    output_bytes[offset] = bytes[0];
                    output_bytes[offset + 1] = bytes[1];
                }
            }
            
            if let Err(e) = render_client.write_to_device(
                num_frames,
                &output_bytes,
                None,
            ) {
                if !shutdown_clone.load(Ordering::Relaxed) {
                    on_error(format!("WASAPI exclusive write failed: {}", e));
                }
                break;
            }
        }

        let _ = client.stop_stream();
        if let Ok(h) = mmcss_handle {
            unsafe {
                let _ = windows::Win32::System::Threading::AvRevertMmThreadCharacteristics(h);
            }
        }
    });

    match rx.recv() {
        Ok(Ok((bits, is_float))) => Ok((
            WasapiStream {
                shutdown,
                handle: Some(handle),
            },
            bits,
            is_float,
        )),
        Ok(Err(e)) => Err(e),
        Err(_) => Err("WASAPI initialization thread panicked".to_string()),
    }
}

#[cfg(not(target_os = "windows"))]
pub fn start_exclusive_stream<F, E>(
    _device_name: &str,
    _sample_rate: u32,
    _channels: u16,
    _timing_mode: &str,
    _dither_enabled: bool,
    _callback: F,
    _on_error: E,
) -> Result<(WasapiStream, u16, bool), String>
where
    F: FnMut(&mut [f32]) + Send + 'static,
    E: FnMut(String) + Send + 'static,
{
    Err("Exclusive mode only supported on Windows".to_string())
}
