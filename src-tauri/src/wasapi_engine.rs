#[cfg(target_os = "windows")]
use wasapi::{
    initialize_mta, DeviceEnumerator, Direction, SampleType, ShareMode, StreamMode,
    WaveFormat,
};
#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU64, Ordering};
#[cfg(target_os = "windows")]
use std::sync::Arc;
#[cfg(target_os = "windows")]
use std::thread;

pub struct WasapiStream {
    shutdown: Arc<AtomicBool>,
    handle: Option<thread::JoinHandle<()>>,
    drain_nanos: Arc<AtomicU64>,
}

impl WasapiStream {
    pub fn drain_duration(&self) -> std::time::Duration {
        std::time::Duration::from_nanos(self.drain_nanos.load(Ordering::Acquire))
    }
}

fn buffer_duration(frames: u32, sample_rate: u32) -> std::time::Duration {
    std::time::Duration::from_nanos(u64::from(frames) * 1_000_000_000 / u64::from(sample_rate))
}

fn release_endpoint<T>(endpoint: &mut Option<T>) {
    drop(endpoint.take());
}

fn record_start_failure(attempts: &mut u32) -> bool {
    *attempts += 1;
    *attempts >= MAX_START_FAILURES
}

#[cfg(target_os = "windows")]
struct ExclusiveEndpoint {
    render_client: wasapi::AudioRenderClient,
    event: Option<wasapi::Handle>,
    client: wasapi::AudioClient,
    buffer_size: u32,
    num_frames: usize,
}

#[cfg(target_os = "windows")]
fn prepare_endpoint(client: wasapi::AudioClient, is_polling: bool) -> Result<ExclusiveEndpoint, String> {
    let event = if is_polling {
        None
    } else {
        Some(client.set_get_eventhandle().map_err(|e| format!("Failed to set event handle: {e}"))?)
    };
    let render_client = client.get_audiorenderclient()
        .map_err(|e| format!("Failed to get render client: {e}"))?;
    let buffer_size = client.get_buffer_size()
        .map_err(|e| format!("Failed to get exclusive buffer size: {e}"))?;
    if buffer_size == 0 {
        return Err("Exclusive buffer size is 0, aborting".to_string());
    }
    let num_frames = if is_polling { (buffer_size / 4).max(1) } else { buffer_size } as usize;
    Ok(ExclusiveEndpoint { render_client, event, client, buffer_size, num_frames })
}

#[cfg(target_os = "windows")]
fn reacquire_endpoint(device: &wasapi::Device, format: &WaveFormat, mode: &StreamMode, is_polling: bool)
    -> Result<ExclusiveEndpoint, String>
{
    let mut client = device.get_iaudioclient().map_err(|e| format!("WASAPI reacquire activation failed: {e}"))?;
    client.initialize_client(format, &Direction::Render, mode)
        .map_err(|e| format!("WASAPI reacquire initialization failed: {e}"))?;
    prepare_endpoint(client, is_polling)
}

#[cfg(target_os = "windows")]
fn prefill_endpoint(endpoint: &ExclusiveEndpoint, output_bytes: &[u8], is_polling: bool) -> Result<(), String> {
    for _ in 0..if is_polling { 4 } else { 1 } {
        endpoint.render_client.write_to_device(endpoint.num_frames, output_bytes, None)
            .map_err(|e| format!("WASAPI exclusive prefill failed: {e}"))?;
    }
    Ok(())
}

impl Drop for WasapiStream {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

/// Actions depend on ownership of the initialized endpoint, not whether its
/// stream is running: Stop alone leaves an exclusive IAudioClient alive.
#[derive(Debug, PartialEq, Eq)]
pub enum HwAction {
    Run,
    Release,
    Acquire,
    Idle,
}

pub fn decide_hw_action(is_playing: bool, endpoint_held: bool) -> HwAction {
    match (is_playing, endpoint_held) {
        (true, true) => HwAction::Run,
        (false, true) => HwAction::Release,
        (true, false) => HwAction::Acquire,
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

#[derive(Clone, Debug, PartialEq)]
pub struct WasapiOutputFormat {
    pub sample_rate: u32,
    pub channels: u16,
    pub container_bits: u16,
    pub valid_bits: u16,
    pub is_float: bool,
    pub channel_mask: Option<u32>,
}

#[cfg(target_os = "windows")]
struct ComMtaGuard {
    initialized: bool,
}

#[cfg(target_os = "windows")]
impl ComMtaGuard {
    fn new() -> Self {
        let ok = initialize_mta().is_ok();
        Self { initialized: ok }
    }
}

#[cfg(target_os = "windows")]
impl Drop for ComMtaGuard {
    fn drop(&mut self) {
        if self.initialized {
            unsafe {
                windows::Win32::System::Com::CoUninitialize();
            }
        }
    }
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

fn quantize_pcm(sample: f32, valid_bits: u32, dither_lsb: f32) -> i32 {
    let scale = (1u64 << (valid_bits - 1)) as f64;
    (sample.clamp(-1.0, 1.0) as f64 * scale + dither_lsb as f64)
        .round()
        .clamp(-scale, scale - 1.0) as i32
}
fn encode_pcm(sample: f32, valid_bits: u32, container_bits: u32, dither_lsb: f32, output: &mut [u8]) {
    let quantized = quantize_pcm(sample, valid_bits, dither_lsb);
    let container_sample = if container_bits == 32 && valid_bits == 24 { quantized << 8 } else { quantized };
    output.copy_from_slice(&container_sample.to_le_bytes()[..output.len()]);
}


#[cfg(target_os = "windows")]
pub fn start_exclusive_stream<F, E>(
    device_name: &str,
    sample_rate: u32,
    channels: u16,
    timing_mode: &str,
    playing_flag: Arc<AtomicU8>,
    flush_signal: Arc<AtomicBool>,
    dither_enabled: bool,
    mut callback: F,
    mut on_error: E,
) -> Result<(WasapiStream, WasapiOutputFormat), String>
where
    F: FnMut(&mut [f32]) + Send + 'static,
    E: FnMut(String) + Send + 'static,
{
    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = Arc::clone(&shutdown);
    let drain_nanos = Arc::new(AtomicU64::new(0));
    let drain_nanos_clone = Arc::clone(&drain_nanos);
    let flush_signal_clone = Arc::clone(&flush_signal);
    let dev_name = device_name.to_string();
    let timing_str = timing_mode.to_string();

    let (tx, rx) = std::sync::mpsc::sync_channel::<Result<WasapiOutputFormat, String>>(1);

    let handle = thread::spawn(move || {
        let _com_guard = ComMtaGuard::new();

        // Give audiosrv a brief moment to finish tearing down any previous endpoint handle
        std::thread::sleep(std::time::Duration::from_millis(60));

        let prev_priority = unsafe {
            windows::Win32::System::Threading::GetThreadPriority(
                windows::Win32::System::Threading::GetCurrentThread(),
            )
        };

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
                    Err(_) => {
                        std::thread::sleep(std::time::Duration::from_millis(50));
                        match device.get_iaudioclient() {
                            Ok(c) => c,
                            Err(_) => continue,
                        }
                    }
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
                    let mut mode = if is_polling {
                        StreamMode::PollingExclusive { 
                            period_hns: 0,
                            buffer_duration_hns: 4 * aligned_period, 
                        }
                    } else {
                        StreamMode::EventsExclusive { period_hns: aligned_period }
                    };

                    let mut init_res = test_client.initialize_client(&format, &Direction::Render, &mode);

                    // Handle AUDCLNT_E_DEVICE_IN_USE recovery:
                    // When transitioning from Shared to Exclusive mode (or between exclusive streams),
                    // Windows audiosrv can take 50-250ms to finish releasing the previous endpoint handle.
                    if let Err(wasapi::WasapiError::Windows(ref werr)) = init_res {
                        if werr.code().0 == windows::Win32::Media::Audio::AUDCLNT_E_DEVICE_IN_USE.0 {
                            for _ in 1..=4 {
                                std::thread::sleep(std::time::Duration::from_millis(60));
                                if let Ok(mut fresh_client) = device.get_iaudioclient() {
                                    let retry_res = fresh_client.initialize_client(&format, &Direction::Render, &mode);
                                    if retry_res.is_ok() {
                                        test_client = fresh_client;
                                        init_res = Ok(());
                                        break;
                                    } else {
                                        init_res = retry_res;
                                    }
                                }
                            }
                        }
                    }
                    
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
                                        mode = recovery_mode;
                                        init_res = Ok(());
                                    }
                                }
                            }
                        }
                    }

                    if init_res.is_ok() {
                        successful_client = Some(test_client);
                        negotiated_format = Some((format, mode, bits, valid_bits, is_float, cand_rate));
                        break 'rate_loop;
                    }
                }
            }
        }

        let (format, mode, bits, valid_bits, is_float, negotiated_rate) = match negotiated_format {
            Some(f) => f,
            None => {
                let err_msg = format!("Device does not support Exclusive Mode (attempted rates: {:?})", candidate_rates);
                crate::log_warn!("WASAPI", "Exclusive Mode negotiation failed on '{}': {}", dev_name, err_msg);
                let _ = tx.send(Err(err_msg));
                return;
            }
        };

        let client = successful_client.unwrap();

        crate::log_info!(
            "WASAPI",
            "Exclusive Mode stream established on '{}' @ {}Hz ({}bit, float: {}, buffer: {} frames, timing: {})",
            dev_name,
            negotiated_rate,
            valid_bits,
            is_float,
            client.get_buffer_size().unwrap_or(0),
            timing_str
        );

        let is_polling = timing_str == "polling";
        let initial_endpoint = match prepare_endpoint(client, is_polling) {
            Ok(endpoint) => endpoint,
            Err(err) => {
                let _ = tx.send(Err(err));
                return;
            }
        };
        let mut num_frames = initial_endpoint.num_frames;
        drain_nanos_clone.store(buffer_duration(initial_endpoint.buffer_size, negotiated_rate).as_nanos() as u64, Ordering::Release);
        let num_samples = num_frames * negotiated_channels as usize;
        let mut f32_data = vec![0.0f32; num_samples];
        
        let bytes_per_sample = bits / 8;
        let mut output_bytes = vec![0u8; num_samples * bytes_per_sample];

        if let Err(err) = prefill_endpoint(&initial_endpoint, &output_bytes, is_polling)
            .and_then(|_| initial_endpoint.client.start_stream()
                .map_err(|e| format!("WASAPI exclusive initial start failed: {e}")))
        {
            let _ = tx.send(Err(err));
            return;
        }

        // Notify main thread of success FIRST (including negotiated_rate)
        if tx.send(Ok(WasapiOutputFormat {
            sample_rate: negotiated_rate,
            channels: negotiated_channels,
            container_bits: bits as u16,
            valid_bits: valid_bits as u16,
            is_float,
            channel_mask: Some(format.get_dwchannelmask()),
        })).is_err() {
            // Main thread dropped the receiver, abort
            return;
        }

        let mut clock = initial_endpoint.client.get_audioclock().ok();
        let mut clock_start = clock.as_ref().and_then(|c| c.get_position().ok().map(|(position, _)| position));
        let mut clock_frequency = clock.as_ref().and_then(|c| c.get_frequency().ok());
        let mut rate_window = std::time::Instant::now();
        let mut frames_written = 0u64;
        let (rate_tx, rate_rx) = std::sync::mpsc::sync_channel::<(u64, f64, Option<u64>, Option<u64>, Option<u64>)>(4);
        let log_device = dev_name.clone();
        let log_timing = timing_str.clone();
        let rate_logger = thread::spawn(move || {
            while let Ok((frames, elapsed, start, end, frequency)) = rate_rx.recv() {
                crate::log_info!(
                    "WASAPI",
                    "Exclusive rate window: device='{}' negotiated={}Hz timing={} frames_written={} elapsed={:.3}s clock_start={:?} clock_end={:?} clock_frequency={:?}",
                    log_device, negotiated_rate, log_timing, frames, elapsed, start, end, frequency,
                );
            }
        });
        let mut xor_state = rand::random::<u32>().max(1);
        macro_rules! next_dither {
            () => {{
                xor_state ^= xor_state << 13;
                xor_state ^= xor_state >> 17;
                xor_state ^= xor_state << 5;
                (xor_state as f32 / 4294967295.0) - 0.5
            }};
        }

        // Keep callback state and its ring consumer alive, but drop every COM
        // interface derived from the initialized AudioClient while paused.
        let mut endpoint = Some(initial_endpoint);
        let mut start_failures = 0u32;
        let mut poll_stall_count = 0u32;

        while !shutdown_clone.load(Ordering::Relaxed) {
            match decide_hw_action(playing_flag.load(Ordering::Relaxed) == 1, endpoint.is_some()) {
                HwAction::Release => {
                    if let Some(ep) = &endpoint {
                        let _ = ep.client.stop_stream();
                    }
                    clock = None;
                    clock_start = None;
                    release_endpoint(&mut endpoint);
                    std::thread::sleep(std::time::Duration::from_millis(HW_RESTART_DELAY_MS));
                    continue;
                }
                HwAction::Acquire => {
                    // A new IAudioClient is mandatory: Stop does not release an
                    // initialized exclusive session on some endpoints.
                    let acquired = reacquire_endpoint(&device, &format, &mode, is_polling)
                        .and_then(|ep| {
                            if ep.num_frames != num_frames {
                                num_frames = ep.num_frames;
                                f32_data.resize(num_frames * negotiated_channels as usize, 0.0);
                                output_bytes.resize(num_frames * negotiated_channels as usize * bytes_per_sample, 0);
                            }
                            output_bytes.fill(0);
                            prefill_endpoint(&ep, &output_bytes, is_polling)?;
                            ep.client.start_stream()
                                .map_err(|e| format!("WASAPI exclusive resume start failed: {e}"))?;
                            Ok(ep)
                        });
                    match acquired {
                        Ok(ep) => {
                            drain_nanos_clone.store(buffer_duration(ep.buffer_size, negotiated_rate).as_nanos() as u64, Ordering::Release);
                            clock = ep.client.get_audioclock().ok();
                            clock_start = clock.as_ref().and_then(|c| c.get_position().ok().map(|(position, _)| position));
                            clock_frequency = clock.as_ref().and_then(|c| c.get_frequency().ok());
                            rate_window = std::time::Instant::now();
                            frames_written = 0;
                            endpoint = Some(ep);
                            start_failures = 0;
                            poll_stall_count = 0;
                        }
                        Err(err) => {
                            if record_start_failure(&mut start_failures) {
                                if !shutdown_clone.load(Ordering::Relaxed) {
                                    on_error(format!("WASAPI exclusive resume failed after {start_failures} attempts: {err}"));
                                }
                                break;
                            }
                            std::thread::sleep(std::time::Duration::from_millis(HW_RESTART_DELAY_MS * u64::from(start_failures)));
                        }
                    }
                    continue;
                }
                HwAction::Idle => {
                    if flush_signal_clone.load(Ordering::SeqCst) {
                        f32_data.fill(0.0);
                        callback(&mut f32_data);
                    }
                    std::thread::sleep(std::time::Duration::from_millis(HW_RESTART_DELAY_MS));
                    continue;
                }
                HwAction::Run => {}
            }

            let ep = endpoint.as_ref().unwrap();
            if flush_signal_clone.load(Ordering::SeqCst) {
                if let Err(err) = ep.client.stop_stream()
                    .and_then(|_| ep.client.reset_stream())
                    .and_then(|_| {
                        output_bytes.fill(0);
                        ep.render_client.write_to_device(num_frames, &output_bytes, None)
                    })
                    .and_then(|_| ep.client.start_stream())
                {
                    on_error(format!("WASAPI exclusive seek reset failed: {err}"));
                    break;
                }
                f32_data.fill(0.0);
                callback(&mut f32_data);
                continue;
            }
            if is_polling {
                // In Polling mode, sleep for half of the buffer period duration, then query available space
                let sleep_ms = ((num_frames as f32 / negotiated_rate as f32) * 500.0) as u64;
                std::thread::sleep(std::time::Duration::from_millis(std::cmp::max(sleep_ms, 2)));

                let avail_frames = match ep.client.get_available_space_in_frames() {
                    Ok(f) => f,
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
                // A short wait lets pause drop the COM endpoint promptly; only
                // two seconds without an event while playing is a stream fault.
                if let Some(ev) = &ep.event {
                    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
                    let mut signaled = false;
                    while playing_flag.load(Ordering::Relaxed) == 1
                        && !shutdown_clone.load(Ordering::Relaxed)
                    {
                        if ev.wait_for_event(50).is_ok() {
                            signaled = true;
                            break;
                        }
                        if std::time::Instant::now() >= deadline {
                            break;
                        }
                    }
                    if !signaled {
                        if playing_flag.load(Ordering::Relaxed) == 1
                            && !shutdown_clone.load(Ordering::Relaxed)
                        {
                            on_error("WASAPI exclusive stream timed out".to_string());
                            break;
                        }
                        continue;
                    }
                }
            }
            
            if playing_flag.load(Ordering::Relaxed) != 1
                || shutdown_clone.load(Ordering::Relaxed)
            {
                continue;
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
                        f32_data.len() * std::mem::size_of::<f32>(),
                    )
                };
                let copy_len = output_bytes.len().min(byte_slice.len());
                output_bytes[..copy_len].copy_from_slice(&byte_slice[..copy_len]);
            } else {
                let bytes_per_sample = bits / 8;
                for (sample, output) in f32_data.iter().zip(output_bytes.chunks_exact_mut(bytes_per_sample)) {
                    let dither_lsb = if dither_enabled { next_dither!() + next_dither!() } else { 0.0 };
                    encode_pcm(*sample, valid_bits as u32, bits as u32, dither_lsb, output);
                }
            }
            
            if let Err(e) = ep.render_client.write_to_device(num_frames, &output_bytes, None) {
                if !shutdown_clone.load(Ordering::Relaxed) {
                    on_error(format!("WASAPI exclusive write failed: {}", e));
                }
                break;
            }
            frames_written += num_frames as u64;
            if rate_window.elapsed() >= std::time::Duration::from_secs(5) {
                let elapsed = rate_window.elapsed().as_secs_f64();
                let clock_end = clock.as_ref().and_then(|c| c.get_position().ok().map(|(position, _)| position));
                let _ = rate_tx.try_send((frames_written, elapsed, clock_start, clock_end, clock_frequency));
                rate_window = std::time::Instant::now();
                frames_written = 0;
                clock_start = clock_end;
            }
        }

        if let Some(ep) = &endpoint {
            let _ = ep.client.stop_stream();
        }
        drop(clock);
        release_endpoint(&mut endpoint);
        drop(rate_tx);
        let _ = rate_logger.join();
        if let Ok(h) = mmcss_handle {
            unsafe {
                let _ = windows::Win32::System::Threading::AvRevertMmThreadCharacteristics(h);
            }
        }
        unsafe {
            let _ = windows::Win32::System::Threading::SetThreadPriority(
                windows::Win32::System::Threading::GetCurrentThread(),
                windows::Win32::System::Threading::THREAD_PRIORITY(prev_priority),
            );
        }
    });

    match rx.recv() {
        Ok(Ok(format)) => Ok((
            WasapiStream {
                shutdown,
                handle: Some(handle),
                drain_nanos,
            },
            format,
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
    _flush_signal: std::sync::Arc<std::sync::atomic::AtomicBool>,
    _dither_enabled: bool,
    _callback: F,
    _on_error: E,
) -> Result<(WasapiStream, WasapiOutputFormat), String>
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
    fn integer_pcm_preserves_signed_boundaries_and_alignment() {
        let cases: &[(u32, u32, f32, &[u8])] = &[
            (16, 16, -1.0, &[0x00, 0x80]),
            (16, 16, 1.0, &[0xff, 0x7f]),
            (24, 24, -1.0, &[0x00, 0x00, 0x80]),
            (24, 24, 1.0, &[0xff, 0xff, 0x7f]),
            (24, 32, -1.0, &[0x00, 0x00, 0x00, 0x80]),
            (24, 32, 1.0, &[0x00, 0xff, 0xff, 0x7f]),
            (32, 32, -1.0, &[0x00, 0x00, 0x00, 0x80]),
            (32, 32, 1.0, &[0xff, 0xff, 0xff, 0x7f]),
        ];
        for &(valid_bits, container_bits, sample, expected) in cases {
            let mut bytes = [0; 4];
            let output = &mut bytes[..(container_bits / 8) as usize];
            encode_pcm(sample, valid_bits, container_bits, 0.0, output);
            assert_eq!(output, expected, "{valid_bits} valid bits in {container_bits} container");
        }
    }


    #[test]
    fn keeps_hardware_running_while_playing() {
        assert!(matches!(decide_hw_action(true, true), HwAction::Run));
    }

    #[test]
    fn pause_drops_endpoint_and_resume_requests_fresh_one() {
        use std::sync::atomic::AtomicUsize;

        struct Lease(Arc<AtomicUsize>);
        impl Drop for Lease {
            fn drop(&mut self) { self.0.fetch_add(1, Ordering::SeqCst); }
        }

        let releases = Arc::new(AtomicUsize::new(0));
        let mut endpoint = Some(Lease(Arc::clone(&releases)));
        assert_eq!(decide_hw_action(false, endpoint.is_some()), HwAction::Release);
        release_endpoint(&mut endpoint);
        assert_eq!(releases.load(Ordering::SeqCst), 1);
        assert_eq!(decide_hw_action(false, endpoint.is_some()), HwAction::Idle);
        assert_eq!(decide_hw_action(true, endpoint.is_some()), HwAction::Acquire);
        endpoint = Some(Lease(Arc::clone(&releases)));
        assert_eq!(decide_hw_action(true, endpoint.is_some()), HwAction::Run);
        drop(endpoint);
        assert_eq!(releases.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn reacquire_failures_are_bounded() {
        let mut attempts = 0;
        for _ in 1..MAX_START_FAILURES {
            assert!(!record_start_failure(&mut attempts));
        }
        assert!(record_start_failure(&mut attempts));
        assert_eq!(attempts, MAX_START_FAILURES);
    }

    #[test]
    fn drain_duration_uses_negotiated_frames() {
        assert_eq!(buffer_duration(480, 48000), std::time::Duration::from_millis(10));
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
            drain_nanos: Arc::new(AtomicU64::new(0)),
        };
        assert!(!shutdown.load(Ordering::SeqCst));
        drop(stream);
        assert!(shutdown.load(Ordering::SeqCst));
    }
}
