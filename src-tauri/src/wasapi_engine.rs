#[cfg(target_os = "windows")]
use wasapi::{
    initialize_mta, DeviceEnumerator, Direction, SampleType, ShareMode, StreamMode,
    WaveFormat,
};
#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
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

/// Hardware action derived from the player's playing/paused state and whether
/// the exclusive device lock is currently held. Stopping the stream releases
/// WASAPI's exclusive-mode lock so other apps can play while we are paused.
#[derive(Debug, PartialEq, Eq)]
pub enum HwAction {
    /// Playing and lock held — run the normal render loop iteration.
    Run,
    /// Paused while holding the lock — call stop_stream() to release it.
    Stop,
    /// Resumed without the lock — call start_stream() to reacquire it.
    Start,
    /// Paused and lock already released — idle until playback resumes.
    Idle,
}

pub fn decide_hw_action(is_playing: bool, hw_running: bool) -> HwAction {
    match (is_playing, hw_running) {
        (true, true) => HwAction::Run,
        (false, true) => HwAction::Stop,
        (true, false) => HwAction::Start,
        (false, false) => HwAction::Idle,
    }
}

pub fn build_exclusive_rate_candidates(
    requested_rate: u32,
    default_rate: Option<u32>,
    upsample_target: u32,
) -> Vec<u32> {
    let mut rates = Vec::with_capacity(8);
    if upsample_target > 0 {
        rates.push(upsample_target);
    }
    if requested_rate > 0 {
        rates.push(requested_rate);
    }
    if let Some(def) = default_rate {
        if def > 0 {
            rates.push(def);
        }
    }
    for &std_rate in &[48000, 44100, 96000, 88200, 192000, 176400, 384000, 352800] {
        rates.push(std_rate);
    }
    let mut unique = Vec::new();
    for r in rates {
        if !unique.contains(&r) {
            unique.push(r);
        }
    }
    unique
}

const HW_RESTART_DELAY_MS: u64 = 20;
const MAX_START_FAILURES: u32 = 10;

/// Consecutive failed exclusive attempts (negotiation failure, start failure,
/// or runtime stream error) allowed before exclusive mode gives up for the
/// current track and stays on the shared engine. Bounds the teardown/rebuild
/// storm a misbehaving driver would otherwise cause.
pub const MAX_EXCLUSIVE_FAILURES: u32 = 3;

#[derive(Debug, PartialEq, Eq)]
pub enum ExclusiveRecovery {
    /// Wait the given number of milliseconds, then try exclusive again.
    RetryAfterMs(u64),
    /// Stop retrying exclusive for this track; run shared until it ends.
    StayShared,
}

/// Pure backoff policy for exclusive-stream failures. First retry is quick,
/// later retries wait longer, and past [`MAX_EXCLUSIVE_FAILURES`] the shared
/// engine takes over for the rest of the track.
pub fn decide_exclusive_recovery(consecutive_failures: u32) -> ExclusiveRecovery {
    if consecutive_failures < MAX_EXCLUSIVE_FAILURES {
        ExclusiveRecovery::RetryAfterMs(250u64 * u64::from(consecutive_failures.max(1)))
    } else {
        ExclusiveRecovery::StayShared
    }
}

#[cfg(target_os = "windows")]
pub fn start_exclusive_stream<F, E>(
    device_name: &str,
    sample_rate: u32,
    channels: u16,
    timing_mode: &str,
    playing_flag: Arc<AtomicU8>,
    dither_enabled: bool,
    mut callback: F,
    mut on_error: E,
) -> Result<(WasapiStream, u16, bool, u32), String>
where
    F: FnMut(&mut [f32]) + Send + 'static,
    E: FnMut(String) + Send + 'static,
{
    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = Arc::clone(&shutdown);
    let dev_name = device_name.to_string();
    let timing_str = timing_mode.to_string();

    let (tx, rx) = std::sync::mpsc::sync_channel::<Result<(u16, bool, u32), String>>(1);

    let handle = thread::spawn(move || {
        let _ = initialize_mta();

        // Give audiosrv a brief moment to finish tearing down any previous endpoint handle
        std::thread::sleep(std::time::Duration::from_millis(60));

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
                windows::Win32::System::Threading::THREAD_PRIORITY_HIGHEST,
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

        let default_device_rate = device.get_device_format().ok().map(|f| f.get_samplespersec() as u32);
        let candidate_rates = build_exclusive_rate_candidates(sample_rate, default_device_rate, 0);
        let negotiated_channels = channels.max(2);

        let test_formats = [
            (32, 32, true),  // 32-bit Float
            (32, 32, false), // 32-bit Int
            (32, 24, false), // 24-bit Int padded to 32 bits
            (24, 24, false), // 24-bit Int packed (3 bytes)
            (16, 16, false), // 16-bit Int
        ];

        let mut successful_client = None;
        let mut negotiated_format = None;

        'rate_loop: for &cand_rate in &candidate_rates {
            for &(bits, valid_bits, is_float) in &test_formats {
                let mut test_client = match device.get_iaudioclient() {
                    Ok(c) => c,
                    Err(_) => continue,
                };

                let sample_type = if is_float { SampleType::Float } else { SampleType::Int };
                let raw_format = WaveFormat::new(
                    bits,
                    valid_bits,
                    &sample_type,
                    cand_rate as usize,
                    negotiated_channels as usize,
                    None,
                );

                // Use is_supported_exclusive_with_quirks for comprehensive format checking
                let supported_format = test_client
                    .is_supported_exclusive_with_quirks(&raw_format)
                    .or_else(|_| test_client.is_supported(&raw_format, &ShareMode::Exclusive).map(|_| raw_format.clone()));

                if let Ok(format) = supported_format {
                    let is_polling = timing_str == "polling";
                    let (def_period, min_period) = test_client.get_device_period().unwrap_or((100000, 30000));
                    
                    // Align period to 128-byte frame boundary (satisfies Intel HDA, Realtek, and USB DACs)
                    let aligned_period = test_client
                        .calculate_aligned_period_near(def_period, Some(128), &format)
                        .unwrap_or(std::cmp::max(def_period, min_period));
                    
                    // Note: Microsoft WASAPI specifies that non-event exclusive streams (polling) require period_hns == 0.
                    let mode = if is_polling {
                        StreamMode::PollingExclusive { 
                            period_hns: 0,
                            buffer_duration_hns: 4 * aligned_period, 
                        }
                    } else {
                        StreamMode::EventsExclusive { period_hns: aligned_period }
                    };

                    let mut init_res = test_client.initialize_client(&format, &Direction::Render, &mode);
                    
                    // Handle AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED recovery
                    if let Err(wasapi::WasapiError::Windows(ref werr)) = init_res {
                        if werr.code().0 == windows::Win32::Media::Audio::AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED.0 {
                            if let Ok(buf_size) = test_client.get_buffer_size() {
                                let recovery_period = wasapi::calculate_period_100ns(
                                    buf_size as i64,
                                    format.get_samplespersec() as i64,
                                );
                                if let Ok(mut fresh_client) = device.get_iaudioclient() {
                                    let recovery_mode = if is_polling {
                                        StreamMode::PollingExclusive { 
                                            period_hns: 0,
                                            buffer_duration_hns: 4 * recovery_period, 
                                        }
                                    } else {
                                        StreamMode::EventsExclusive { period_hns: recovery_period }
                                    };
                                    if fresh_client.initialize_client(&format, &Direction::Render, &recovery_mode).is_ok() {
                                        test_client = fresh_client;
                                        init_res = Ok(());
                                    }
                                }
                            }
                        }
                    }

                    if init_res.is_ok() {
                        successful_client = Some(test_client);
                        negotiated_format = Some((format, bits, valid_bits, is_float, cand_rate));
                        break 'rate_loop;
                    }
                }
            }
        }

        let (_format, bits, valid_bits, is_float, negotiated_rate) = match negotiated_format {
            Some(f) => f,
            None => {
                let _ = tx.send(Err(format!("Device does not support Exclusive Mode (attempted rates: {:?})", candidate_rates)));
                return;
            }
        };

        let client = match successful_client {
            Some(c) => c,
            None => {
                let _ = tx.send(Err("Failed to acquire valid exclusive audio client".to_string()));
                return;
            }
        };

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
            (buffer_size / 4).max(1) as usize
        } else {
            buffer_size as usize
        };
        let num_samples = num_frames * negotiated_channels as usize;
        let mut f32_data = vec![0.0f32; num_samples];
        
        let bytes_per_sample = bits / 8;
        let mut output_bytes = vec![0u8; num_samples * bytes_per_sample];

        // PRE-FILL FIRST BUFFER WITH SILENCE BEFORE STARTING STREAM
        if is_polling {
            for _ in 0..4 {
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

        // Notify main thread of success FIRST (including negotiated_rate)
        if tx.send(Ok((valid_bits as u16, is_float, negotiated_rate))).is_err() {
            // Main thread dropped the receiver, abort
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

        // The exclusive device lock is only held while the stream is running.
        // Pause -> stop_stream() releases it so Windows apps regain audio;
        // Resume -> start_stream() reacquires it.
        let mut hw_running = false;
        let mut start_failures = 0u32;
        let mut poll_stall_count = 0u32;

        while !shutdown_clone.load(Ordering::Relaxed) {
            match decide_hw_action(
                playing_flag.load(Ordering::Relaxed) == 1,
                hw_running,
            ) {
                HwAction::Stop => {
                    let _ = client.stop_stream();
                    hw_running = false;
                    std::thread::sleep(std::time::Duration::from_millis(HW_RESTART_DELAY_MS));
                    continue;
                }
                HwAction::Start => {
                    // Brief head start so the producer can fill the ring buffer
                    std::thread::sleep(std::time::Duration::from_millis(50));
                    if client.start_stream().is_ok() {
                        hw_running = true;
                        start_failures = 0;
                        poll_stall_count = 0;
                    } else {
                        start_failures += 1;
                        if start_failures >= MAX_START_FAILURES {
                            on_error("WASAPI exclusive start_stream failed".to_string());
                            break;
                        }
                    }
                    continue;
                }
                HwAction::Idle => {
                    std::thread::sleep(std::time::Duration::from_millis(HW_RESTART_DELAY_MS));
                    continue;
                }
                HwAction::Run => {}
            }

            if is_polling {
                // In Polling mode, sleep for half of the buffer period duration, then query available space
                let sleep_ms = ((num_frames as f32 / negotiated_rate as f32) * 500.0) as u64;
                std::thread::sleep(std::time::Duration::from_millis(std::cmp::max(sleep_ms, 2)));

                let avail_frames = match client.get_current_padding() {
                    Ok(p) => buffer_size.saturating_sub(p),
                    Err(_) => {
                        if !shutdown_clone.load(Ordering::Relaxed) {
                            on_error("WASAPI exclusive polling error".to_string());
                        }
                        break;
                    }
                };

                if avail_frames < num_frames as u32 {
                    poll_stall_count += 1;
                    if poll_stall_count >= 100 {
                        if !shutdown_clone.load(Ordering::Relaxed) {
                            on_error("WASAPI exclusive polling buffer stalled".to_string());
                        }
                        break;
                    }
                    // Not enough space to write a full chunk yet, sleep and wait
                    continue;
                }
                poll_stall_count = 0;
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
        Ok(Ok((bits, is_float, negotiated_rate))) => Ok((
            WasapiStream {
                shutdown,
                handle: Some(handle),
            },
            bits,
            is_float,
            negotiated_rate,
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
    _playing_flag: std::sync::Arc<std::sync::atomic::AtomicU8>,
    _dither_enabled: bool,
    _callback: F,
    _on_error: E,
) -> Result<(WasapiStream, u16, bool, u32), String>
where
    F: FnMut(&mut [f32]) + Send + 'static,
    E: FnMut(String) + Send + 'static,
{
    Err("Exclusive mode only supported on Windows".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_exclusive_rate_candidates_prioritizes_requested() {
        let candidates = build_exclusive_rate_candidates(44100, Some(48000), 0);
        assert_eq!(candidates[0], 44100);
        assert_eq!(candidates[1], 48000);
        assert!(candidates.contains(&96000));
        assert!(candidates.contains(&192000));
    }

    #[test]
    fn test_build_exclusive_rate_candidates_prioritizes_upsample_target() {
        let candidates = build_exclusive_rate_candidates(44100, Some(48000), 96000);
        assert_eq!(candidates[0], 96000);
        assert_eq!(candidates[1], 44100);
        assert_eq!(candidates[2], 48000);
    }

    #[test]
    fn keeps_hardware_running_while_playing() {
        assert!(matches!(decide_hw_action(true, true), HwAction::Run));
    }

    #[test]
    fn stops_hardware_when_paused_to_release_device_lock() {
        // Pausing must stop the exclusive stream so Windows regains the endpoint
        // and other apps' audio resumes while Aideo is paused.
        assert!(matches!(decide_hw_action(false, true), HwAction::Stop));
    }

    #[test]
    fn restarts_hardware_on_resume() {
        assert!(matches!(decide_hw_action(true, false), HwAction::Start));
    }

    #[test]
    fn stays_idle_when_paused_and_already_stopped() {
        assert!(matches!(decide_hw_action(false, false), HwAction::Idle));
    }

    #[test]
    fn exclusive_recovery_retries_with_backoff_below_failure_cap() {
        assert_eq!(decide_exclusive_recovery(1), ExclusiveRecovery::RetryAfterMs(250));
        assert_eq!(decide_exclusive_recovery(2), ExclusiveRecovery::RetryAfterMs(500));
    }

    #[test]
    fn exclusive_recovery_gives_up_at_failure_cap() {
        assert_eq!(decide_exclusive_recovery(MAX_EXCLUSIVE_FAILURES), ExclusiveRecovery::StayShared);
        assert_eq!(decide_exclusive_recovery(MAX_EXCLUSIVE_FAILURES + 5), ExclusiveRecovery::StayShared);
    }

    #[test]
    fn drop_signals_shutdown_without_joined_thread() {
        let shutdown = Arc::new(AtomicBool::new(false));
        let stream = WasapiStream {
            shutdown: Arc::clone(&shutdown),
            handle: None,
        };
        assert!(!shutdown.load(Ordering::SeqCst));
        drop(stream);
        assert!(shutdown.load(Ordering::SeqCst));
    }
}
