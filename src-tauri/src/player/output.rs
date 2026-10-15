use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use cpal::traits::DeviceTrait;

use crate::safe_lock;
use super::audio_meter;
use super::decoder::ActiveStream;
use super::DSPState;

/// Consecutive WASAPI Exclusive failures for the CURRENT track (negotiation
/// and start failures plus runtime stream errors). Reset on success, on a new
/// track, and when the user re-toggles Exclusive Mode. Without this budget a
/// misbehaving driver causes an unbounded teardown/rebuild storm that sounds
/// like the song being stuck.
pub static EXCLUSIVE_STREAM_FAILURES: AtomicU32 = AtomicU32::new(0);
/// Ensures the "staying in Shared Mode" toast fires once per budget, not on
/// every subsequent restart.
pub static EXCLUSIVE_FALLBACK_NOTIFIED: AtomicBool = AtomicBool::new(false);

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq)]
pub struct AudioFormatSnapshot {
    pub sample_rate: u32,
    pub channels: u16,
    pub sample_format: Option<String>,
    pub bits_per_sample: Option<u16>,
    pub valid_bits_per_sample: Option<u16>,
    pub channel_mask: Option<u32>,
}

impl Default for AudioFormatSnapshot {
    fn default() -> Self {
        Self {
            sample_rate: 0,
            channels: 0,
            sample_format: None,
            bits_per_sample: None,
            valid_bits_per_sample: None,
            channel_mask: None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct AudioRouteSnapshot {
    pub active: bool,
    pub engine: String,
    pub share_mode: String,
    pub source: AudioFormatSnapshot,
    pub pipeline_sample_format: String,
    pub output: AudioFormatSnapshot,
    pub fallback_reason: Option<String>,
    pub gain_ramp: bool,
    pub volume_bypass_in_bit_perfect: bool,
    pub dither_enabled: bool,
    pub sample_integrity_verified: bool,
}

impl Default for AudioRouteSnapshot {
    fn default() -> Self {
        Self {
            active: false,
            engine: "none".to_string(),
            share_mode: "unavailable".to_string(),
            source: AudioFormatSnapshot::default(),
            pipeline_sample_format: "unknown".to_string(),
            output: AudioFormatSnapshot::default(),
            fallback_reason: None,
            gain_ramp: false,
            volume_bypass_in_bit_perfect: false,
            dither_enabled: false,
            sample_integrity_verified: false,
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq)]
pub struct EffectiveAudioPath {
    pub active: bool,
    pub engine: String,
    pub share_mode: String,
    pub source: AudioFormatSnapshot,
    pub pipeline_sample_format: String,
    pub output: AudioFormatSnapshot,
    pub requested_exclusive: bool,
    pub requested_bit_perfect: bool,
    pub resampling: bool,
    pub volume_applied: bool,
    pub active_transforms: Vec<String>,
    pub underruns: u64,
    pub strict_bit_perfect: bool,
    pub strict_failure_reasons: Vec<String>,
    pub fallback_reason: Option<String>,
}

pub fn evaluate_audio_path(
    route: &AudioRouteSnapshot,
    dsp: &DSPState,
    requested_exclusive: bool,
    requested_bit_perfect: bool,
    volume: f32,
    underruns: u64,
) -> EffectiveAudioPath {
    let playback_rate = dsp.playback_rate.clamp(0.5, 2.0);
    let rate_changed = route.source.sample_rate > 0
        && route.output.sample_rate > 0
        && route.source.sample_rate != route.output.sample_rate;
    let playback_rate_changed = (playback_rate - 1.0).abs() >= 0.001;
    let resampling = rate_changed || playback_rate_changed;
    let channel_mixing = route.source.channels > 0
        && route.output.channels > 0
        && route.source.channels != route.output.channels;
    let sample_format_conversion = route.source.sample_format.is_some()
        && route.output.sample_format.is_some()
        && (route.source.sample_format != route.output.sample_format
            || route.source.valid_bits_per_sample != route.output.valid_bits_per_sample);
    let processor_bit_perfect_bypass = requested_bit_perfect
        && !resampling
        && !channel_mixing;
    let volume_applied = volume < 0.999
        && (!requested_bit_perfect || !route.volume_bypass_in_bit_perfect);

    let mut active_transforms = Vec::new();
    if resampling {
        active_transforms.push("resampling".to_string());
    }
    if playback_rate_changed {
        active_transforms.push("playback_rate".to_string());
    }
    if channel_mixing {
        active_transforms.push("channel_mixing".to_string());
    }
    if sample_format_conversion {
        active_transforms.push("sample_format_conversion".to_string());
    }
    if route.gain_ramp {
        active_transforms.push("gain_ramp".to_string());
    }
    if volume_applied {
        active_transforms.push("volume".to_string());
    }
    if route.dither_enabled {
        active_transforms.push("dither".to_string());
    }
    if !processor_bit_perfect_bypass && dsp.enabled {
        active_transforms.push("dsp".to_string());
    }
    if !processor_bit_perfect_bypass && dsp.crossfade_transition_enabled {
        active_transforms.push("crossfade".to_string());
    }

    let mut strict_failure_reasons = Vec::new();
    if !route.active {
        strict_failure_reasons.push("no_active_stream".to_string());
    }
    if !requested_bit_perfect {
        strict_failure_reasons.push("bit_perfect_not_requested".to_string());
    }
    if route.share_mode != "exclusive" && route.share_mode != "direct" {
        strict_failure_reasons.push("shared_output".to_string());
    }
    for transform in &active_transforms {
        strict_failure_reasons.push(format!("{transform}_active"));
    }
    if !route.sample_integrity_verified {
        strict_failure_reasons.push("sample_integrity_unverified".to_string());
    }
    if route.source.sample_format.is_none() || route.source.valid_bits_per_sample.is_none() {
        strict_failure_reasons.push("source_format_unknown".to_string());
    }
    if underruns > 0 {
        strict_failure_reasons.push("underruns_detected".to_string());
    }

    EffectiveAudioPath {
        active: route.active,
        engine: route.engine.clone(),
        share_mode: route.share_mode.clone(),
        source: route.source.clone(),
        pipeline_sample_format: route.pipeline_sample_format.clone(),
        output: route.output.clone(),
        requested_exclusive,
        requested_bit_perfect,
        resampling,
        volume_applied,
        active_transforms,
        underruns,
        strict_bit_perfect: strict_failure_reasons.is_empty(),
        strict_failure_reasons,
        fallback_reason: route.fallback_reason.clone(),
    }
}

pub struct EffectiveAudioPathState {
    route: Mutex<AudioRouteSnapshot>,
    underruns: AtomicU64,
    pub meter: audio_meter::AudioMeter,
}

impl EffectiveAudioPathState {
    pub fn new() -> Self {
        Self {
            route: Mutex::new(AudioRouteSnapshot::default()),
            underruns: AtomicU64::new(0),
            meter: audio_meter::AudioMeter::new(),
        }
    }

    pub fn set_route(&self, route: AudioRouteSnapshot) {
        *safe_lock(&self.route) = route;
    }

    pub fn reset(&self) {
        *safe_lock(&self.route) = AudioRouteSnapshot::default();
        self.underruns.store(0, Ordering::Relaxed);
        self.meter.clear();
    }

    pub fn record_underrun(&self) {
        self.underruns.fetch_add(1, Ordering::Relaxed);
    }

    pub fn snapshot(
        &self,
        dsp: &DSPState,
        requested_exclusive: bool,
        requested_bit_perfect: bool,
        volume: f32,
    ) -> EffectiveAudioPath {
        evaluate_audio_path(
            &safe_lock(&self.route),
            dsp,
            requested_exclusive,
            requested_bit_perfect,
            volume,
            self.underruns.load(Ordering::Relaxed),
        )
    }
}

impl Default for EffectiveAudioPathState {
    fn default() -> Self {
        Self::new()
    }
}

/// RAII guard to enforce high-resolution 1ms system timer during active playback.
/// Windows default timer granularity drops to 15.6ms (or 31ms on Battery Saver),
/// which inflates sleep(1ms)/sleep(5ms) and starves the audio ring buffer.
pub struct TimePeriodGuard {
    #[allow(dead_code)]
    active: bool,
}

impl TimePeriodGuard {
    pub fn new() -> Self {
        #[cfg(target_os = "windows")]
        {
            let res = unsafe { windows::Win32::Media::timeBeginPeriod(1) };
            Self { active: res == 0 }
        }
        #[cfg(not(target_os = "windows"))]
        {
            Self { active: false }
        }
    }

    #[allow(dead_code)]
    pub fn is_active(&self) -> bool {
        self.active
    }
}

impl Drop for TimePeriodGuard {
    fn drop(&mut self) {
        #[cfg(target_os = "windows")]
        if self.active {
            unsafe {
                let _ = windows::Win32::Media::timeEndPeriod(1);
            }
        }
    }
}

#[cfg(target_os = "windows")]
pub struct WindowsAudioThreadGuard {
    mmcss_handle: Option<windows::Win32::Foundation::HANDLE>,
    prev_priority: i32,
}

#[cfg(target_os = "windows")]
impl WindowsAudioThreadGuard {
    pub fn activate() -> Self {
        unsafe {
            // Save original priority so we can restore it on drop
            let prev_priority = windows::Win32::System::Threading::GetThreadPriority(
                windows::Win32::System::Threading::GetCurrentThread(),
            );

            // 1. Elevate Win32 thread priority to TIME_CRITICAL
            let _ = windows::Win32::System::Threading::SetThreadPriority(
                windows::Win32::System::Threading::GetCurrentThread(),
                windows::Win32::System::Threading::THREAD_PRIORITY_TIME_CRITICAL,
            );

            // 2. Opt-out from Windows 10/11 EcoQoS (Power Throttling).
            // Under Battery Saver, Windows deprioritizes standard threads onto E-cores
            // and aggressively frequency-caps them unless opted out.
            let throttle_state = windows::Win32::System::Threading::THREAD_POWER_THROTTLING_STATE {
                Version: windows::Win32::System::Threading::THREAD_POWER_THROTTLING_CURRENT_VERSION,
                ControlMask: windows::Win32::System::Threading::THREAD_POWER_THROTTLING_EXECUTION_SPEED,
                StateMask: 0, // Turn OFF power throttling
            };
            let _ = windows::Win32::System::Threading::SetThreadInformation(
                windows::Win32::System::Threading::GetCurrentThread(),
                windows::Win32::System::Threading::ThreadPowerThrottling,
                &throttle_state as *const _ as *const std::ffi::c_void,
                std::mem::size_of::<windows::Win32::System::Threading::THREAD_POWER_THROTTLING_STATE>() as u32,
            );

            // 3. Register thread with Multimedia Class Scheduler Service (MMCSS)
            let mut task_index = 0u32;
            let mmcss_handle = windows::Win32::System::Threading::AvSetMmThreadCharacteristicsW(
                windows::core::w!("Audio"),
                &mut task_index,
            ).ok();

            Self { mmcss_handle, prev_priority }
        }
    }
}

#[cfg(target_os = "windows")]
impl Drop for WindowsAudioThreadGuard {
    fn drop(&mut self) {
        unsafe {
            if let Some(h) = self.mmcss_handle.take() {
                let _ = windows::Win32::System::Threading::AvRevertMmThreadCharacteristics(h);
            }
            // Restore previous thread priority so player loop / worker thread does not starve system threads
            let _ = windows::Win32::System::Threading::SetThreadPriority(
                windows::Win32::System::Threading::GetCurrentThread(),
                windows::Win32::System::Threading::THREAD_PRIORITY(self.prev_priority),
            );
        }
    }
}

#[cfg(not(target_os = "windows"))]
pub struct WindowsAudioThreadGuard;

#[cfg(not(target_os = "windows"))]
impl WindowsAudioThreadGuard {
    pub fn activate() -> Self {
        Self
    }
}

pub fn resolve_exclusive_target_rate(file_rate: usize, upsample_target: u32) -> u32 {
    if upsample_target > 0 {
        upsample_target
    } else {
        file_rate as u32
    }
}

/// 🎚️ Hardware Rate Switching & Config Selection
pub fn select_output_config(
    device: &cpal::Device,
    file_rate: usize,
    file_ch: usize,
    is_exclusive: bool,
    is_stream: bool,
    stream_allows_exclusive: bool,
    upsample_target: u32,
    device_display_name: &str,
) -> Vec<(cpal::StreamConfig, cpal::SampleFormat)> {
    let mut configs = Vec::new();

    // Priority 1: Upsampling Target (if enabled)
    if upsample_target > 0 && !is_stream {
        if let Ok(supported) = device.supported_output_configs() {
            for c in supported {
                if c.channels() as usize == file_ch {
                    let min = c.min_sample_rate();
                    let max = c.max_sample_rate();
                    if min <= upsample_target && max >= upsample_target {
                        let cfg = c.with_sample_rate(upsample_target).config();
                        let host_name = if device_display_name.starts_with("[ASIO]") { "ASIO" } else { "WASAPI" };
                        println!("AUDIOPHILE: {} -> Upsampling to {}Hz ({:?})", host_name, upsample_target, c.sample_format());
                        configs.push((cfg, c.sample_format()));
                        break; // Found our best upsample match
                    }
                }
            }
        }
    }

    // Priority 2: Native Track Match (Matches file sample rate in Exclusive Mode only)
    if configs.is_empty() && is_exclusive && (!is_stream || stream_allows_exclusive) {
        if let Ok(supported) = device.supported_output_configs() {
            let supported_configs: Vec<_> = supported.collect();
            let target_ch = file_ch.max(2);

            // In exclusive mode, integer formats (I32/I24/I16) are preferred over float
            let prioritized_formats: [Vec<cpal::SampleFormat>; 3] = [
                vec![cpal::SampleFormat::I32, cpal::SampleFormat::I24],
                vec![cpal::SampleFormat::I16],
                vec![cpal::SampleFormat::F32],
            ];

            for format_group in &prioritized_formats {
                if !configs.is_empty() {
                    break;
                }
                for c in &supported_configs {
                    if (c.channels() as usize == file_ch || c.channels() as usize == target_ch)
                        && format_group.contains(&c.sample_format())
                        && c.min_sample_rate() <= (file_rate as u32)
                        && c.max_sample_rate() >= (file_rate as u32)
                    {
                        let cfg = c.with_sample_rate(file_rate as u32).config();
                        println!("AUDIOPHILE: Native Rate Match ({:?}): {}Hz", c.sample_format(), file_rate);
                        configs.push((cfg, c.sample_format()));
                        break;
                    }
                }
            }
        }
    }

    // Final Fallback: Default (Shared Mode) - Always append if not already in configs
    if let Ok(def) = device.default_output_config() {
        let def_cfg = def.config();
        let def_fmt = def.sample_format();
        let already_present = configs.iter().any(|(c, f)| {
            c.sample_rate == def_cfg.sample_rate && c.channels == def_cfg.channels && *f == def_fmt
        });
        if !already_present {
            println!("AUDIOPHILE: Adding Default Shared Config fallback: {}Hz ({:?})", def.sample_rate(), def_fmt);
            configs.push((def_cfg, def_fmt));
        }
    }

    if configs.is_empty() {
        eprintln!("[player] ERROR: No valid audio configurations found for this device.");
    }

    configs
}

pub fn find_best_matching_device_name<'a>(
    target: &str,
    candidates: &'a [String],
) -> Option<&'a String> {
    if target.is_empty() || candidates.is_empty() {
        return None;
    }

    // 1. Exact match
    if let Some(c) = candidates.iter().find(|&n| n == target) {
        return Some(c);
    }

    // 2. Case-insensitive exact match
    if let Some(c) = candidates.iter().find(|&n| n.eq_ignore_ascii_case(target)) {
        return Some(c);
    }

    let generic_words = [
        "headphone", "headphones", "speaker", "speakers", "audio", "device",
        "realtek", "high", "definition", "out", "line", "sound"
    ];

    // 3. Model token match (all non-generic tokens must match)
    let model_tokens: Vec<&str> = target
        .split(|c: char| !c.is_alphanumeric())
        .filter(|token| {
            let t = token.to_lowercase();
            !t.is_empty() && !generic_words.contains(&t.as_str())
        })
        .collect();

    if !model_tokens.is_empty() {
        let mut matching: Vec<&String> = candidates
            .iter()
            .filter(|n| {
                let n_lower = n.to_lowercase();
                model_tokens.iter().all(|token| n_lower.contains(&token.to_lowercase()))
            })
            .collect();

        if !matching.is_empty() {
            matching.sort_by_key(|n| (n.len() as isize - target.len() as isize).abs());
            return Some(matching[0]);
        }
    }

    // 4. Substring fallback ONLY if target has distinctive non-generic content
    let target_lower = target.to_lowercase();
    let is_generic = generic_words.iter().any(|&g| target_lower.trim() == g);
    if !is_generic && target.trim().len() >= 6 {
        let mut substring_matches: Vec<&String> = candidates
            .iter()
            .filter(|n| {
                let n_lower = n.to_lowercase();
                n_lower.contains(&target_lower) || target_lower.contains(&n_lower)
            })
            .collect();

        if !substring_matches.is_empty() {
            substring_matches.sort_by_key(|n| (n.len() as isize - target.len() as isize).abs());
            return Some(substring_matches[0]);
        }
    }

    None
}

pub fn should_restore_preferred_device(
    preferred: Option<&str>,
    current_target: Option<&str>,
    available_devices: &[String],
) -> Option<String> {
    let pref = preferred?;
    if pref.is_empty()
        || pref == "[System Default Device]"
        || pref == "Default Device"
        || pref == "System Default Device"
    {
        return None;
    }

    // Only restore if current_target is None (i.e. currently in fallback mode)
    if current_target.is_some() {
        return None;
    }

    // 1. Direct exact match in available_devices
    if available_devices.iter().any(|d| d == pref) {
        return Some(pref.to_string());
    }

    // 2. Strip [WASAPI] / [ASIO] prefix and match using find_best_matching_device_name
    let clean_pref = pref
        .trim_start_matches("[WASAPI] ")
        .trim_start_matches("[ASIO] ");

    let clean_candidates: Vec<String> = available_devices
        .iter()
        .map(|d| {
            d.trim_start_matches("[WASAPI] ")
                .trim_start_matches("[ASIO] ")
                .to_string()
        })
        .collect();

    if let Some(matched_clean) = find_best_matching_device_name(clean_pref, &clean_candidates) {
        if let Some(full) = available_devices.iter().find(|d| {
            d.trim_start_matches("[WASAPI] ")
                .trim_start_matches("[ASIO] ")
                == matched_clean
        }) {
            return Some(full.clone());
        }
    }

    None
}

pub fn should_switch_default_device(
    preferred: Option<&str>,
    last_default: Option<&str>,
    current_default: Option<&str>,
) -> bool {
    let is_system_default = match preferred {
        None => true,
        Some(p) => {
            p.is_empty()
                || p == "[System Default Device]"
                || p == "Default Device"
                || p == "System Default Device"
        }
    };

    if !is_system_default {
        return false;
    }

    let cur = match current_default {
        Some(c) if !c.is_empty() => c,
        _ => return false,
    };

    match last_default {
        Some(last) => last != cur,
        None => false, // Initial state, don't trigger switch on startup
    }
}

pub fn resolve_hardware_upsample_and_dither(
    is_bit_perfect: bool,
    requested_upsample: u32,
    requested_dither: bool,
) -> (u32, bool) {
    if is_bit_perfect {
        (0, false)
    } else {
        (requested_upsample, requested_dither)
    }
}

pub fn hardware_upsample_changed(
    started_target: u32, exclusive: bool, bit_perfect: bool, dsp: &DSPState,
) -> bool {
    resolve_hardware_upsample_and_dither(exclusive && bit_perfect, dsp.upsample_rate, dsp.dither).0
        != started_target
}

pub fn describe_cpal_sample_format(sample_format: cpal::SampleFormat) -> (String, usize, bool) {
    match sample_format {
        cpal::SampleFormat::F32 => ("pcm_f32".to_string(), 32, true),
        cpal::SampleFormat::I16 => ("pcm_s16".to_string(), 16, false),
        cpal::SampleFormat::I24 => ("pcm_s24".to_string(), 24, false),
        cpal::SampleFormat::I32 => ("pcm_s32".to_string(), 32, false),
        other => (format!("{other:?}").to_lowercase(), 0, false),
    }
}

pub struct ActiveStreamSession {
    pub stream: ActiveStream,
    pub config: cpal::StreamConfig,
    pub prod: ringbuf::Producer<f32>,
    pub flush_signal: Arc<AtomicBool>,
    pub output_bits: usize,
    pub is_float: bool,
    pub route: AudioRouteSnapshot,
    pub target_device: Option<String>,
    pub is_exclusive: bool,
    pub sample_rate: usize,
    pub channels: usize,
    pub is_manual_change: bool,
}

pub fn can_reuse_stream_session(
    session_device: &Option<String>,
    session_is_exclusive: bool,
    session_sample_rate: usize,
    session_channels: usize,
    target_device: &Option<String>,
    is_exclusive: bool,
    file_rate: usize,
    file_ch: usize,
    upsample_target: u32,
) -> bool {
    if session_device != target_device {
        return false;
    }
    if session_is_exclusive != is_exclusive {
        return false;
    }
    let target_rate = resolve_exclusive_target_rate(file_rate, upsample_target) as usize;
    session_sample_rate == target_rate && session_channels == file_ch
}

pub fn stream_allows_exclusive_mode(resolved_path: &str) -> bool {
    let p = resolved_path.to_lowercase();
    !(p.contains(".m3u8") || p.contains("hls_playlist") || p.contains("/hls/") || p.ends_with(".m3u8"))
}
