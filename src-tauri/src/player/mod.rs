pub static SOURCE_QUEUE_MODE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
static STOP_ARMING: AtomicBool = AtomicBool::new(false);
static STOP_ARM_STATUS: AtomicU8 = AtomicU8::new(0);
static STOP_ARM_TIMED_OUT: AtomicBool = AtomicBool::new(false);
static STOP_ARM_GENERATION: AtomicU64 = AtomicU64::new(0);
static STOP_ARM_STOP_SENT: AtomicBool = AtomicBool::new(false);
static STOP_ARM_ACK: Mutex<Option<std::sync::mpsc::Sender<()>>> = Mutex::new(None);

fn silence_while_arming<T: Default + Copy>(arming: bool, data: &mut [T]) -> bool {
    if arming { data.fill(T::default()); }
    arming
}

fn acknowledge_stop_arm() {
    if let Some(ack) = safe_lock(&STOP_ARM_ACK).take() {
        if !STOP_ARM_TIMED_OUT.load(Ordering::SeqCst) {
            STOP_ARMING.store(false, Ordering::SeqCst);
        }
        let _ = ack.send(());
    }
}

struct StopArmAckOnDrop;
impl Drop for StopArmAckOnDrop {
    fn drop(&mut self) { acknowledge_stop_arm(); }
}

fn finish_stop_arm() {
    safe_lock(&STOP_ARM_ACK).take();
    STOP_ARM_STATUS.store(0, Ordering::SeqCst);
    STOP_ARM_TIMED_OUT.store(false, Ordering::SeqCst);
    STOP_ARMING.store(false, Ordering::SeqCst);
}

fn claim_stop_arm_purge(generation: Option<u64>) -> bool {
    let pending = safe_lock(&STOP_ARM_ACK);
    if pending.is_none() || generation.is_some_and(|generation| generation != STOP_ARM_GENERATION.load(Ordering::SeqCst))
        || STOP_ARM_STOP_SENT.swap(true, Ordering::SeqCst) { return false; }
    STOP_ARM_TIMED_OUT.store(true, Ordering::SeqCst);
    true
}

static STOP_AFTER_PATH: Mutex<Option<String>> = Mutex::new(None);

fn stop_boundary_matches(boundary: Option<&str>, path: &str) -> bool {
    boundary == Some(path)
}

fn stops_after(path: &str) -> bool {
    stop_boundary_matches(safe_lock(&STOP_AFTER_PATH).as_deref(), path)
}

#[tauri::command]
pub(crate) fn set_stop_after_path(path: Option<String>, state: tauri::State<'_, crate::AppState>) -> Result<(), String> {
    let player = safe_lock(&state.player);
    if path.is_none() {
        *safe_lock(&STOP_AFTER_PATH) = None;
        if claim_stop_arm_purge(None) {
            if let Err(error) = player.cmd_tx.send(PlayerCommand::Stop) {
                finish_stop_arm();
                return Err(error.to_string());
            }
        }
        return Ok(());
    }
    if STOP_ARMING.load(Ordering::SeqCst) { return Err("End stopping is already being armed".into()); }
    // The frontend captures the current logical track; retries replace its resolved native path.
    *safe_lock(&STOP_AFTER_PATH) = path;
    let status = player.status.load(Ordering::SeqCst);
    if status == 0 { return Ok(()); }
    let (ack_tx, ack_rx) = std::sync::mpsc::channel();
    if STOP_ARMING.load(Ordering::SeqCst) { return Err("End stopping is already being armed".into()); }
    let generation = STOP_ARM_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    STOP_ARMING.store(true, Ordering::SeqCst);
    STOP_ARM_TIMED_OUT.store(false, Ordering::SeqCst);
    STOP_ARM_STOP_SENT.store(false, Ordering::SeqCst);
    STOP_ARM_STATUS.store(status, Ordering::SeqCst);
    *safe_lock(&STOP_ARM_ACK) = Some(ack_tx);
    if let Err(error) = player.cmd_tx.send(PlayerCommand::RestartStream) {
        finish_stop_arm();
        return Err(error.to_string());
    }
    let stop_tx = player.cmd_tx.clone();
    drop(player);
    let result = ack_rx.recv_timeout(std::time::Duration::from_secs(5)).map_err(|_| "Player did not acknowledge end stopping; output remains muted".to_string());
    if result.is_err() && claim_stop_arm_purge(Some(generation)) {
        if stop_tx.send(PlayerCommand::Stop).is_err() { finish_stop_arm(); }
    }
    result
}

pub static LOCAL_QUEUE_GENERATION: AtomicU64 = AtomicU64::new(0);
use std::sync::{Arc, Mutex};

use std::thread;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, AtomicU64, Ordering};

pub mod audio_meter;
pub mod cache;
pub mod crossfade;
pub mod decoder;
pub mod dsp;
pub mod output;
pub mod telemetry;

pub use crossfade::*;
pub use decoder::*;
pub use dsp::*;
pub use output::*;
pub use self::telemetry::{SignalPathStage, SignalPathReport};

use ringbuf::RingBuffer;
use crossbeam_channel::{Receiver, Sender};

use rustfft::{FftPlanner, num_complex::Complex};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::{FormatOptions, SeekMode, SeekTo};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::units::TimeBase;
pub use symphonia::default::{get_codecs, get_probe};
use rubato::{Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction};
use tauri::{Emitter, Manager};


use crate::safe_lock;

pub static PLAYBACK_GENERATION: AtomicU64 = AtomicU64::new(0);

pub static SESSION_DOWNLOADED_BYTES: AtomicU64 = AtomicU64::new(0);
pub static CURRENT_DOWNLOAD_SPEED_BPS: AtomicU32 = AtomicU32::new(0);
pub static STREAM_LATENCY_MS: AtomicU32 = AtomicU32::new(0);
pub static ACTIVE_STREAM_BUFFERED_BYTES: AtomicU64 = AtomicU64::new(0);
pub static ACTIVE_STREAM_TOTAL_BYTES: AtomicU64 = AtomicU64::new(0);

pub fn feed_visualizer_fft(
    planar: &[Vec<f32>],
    fft_buffer: &mut Vec<f32>,
    fft_tx: &crossbeam_channel::Sender<(Vec<f32>, f32)>,
    sample_rate: f32,
    low_spec_mode: bool,
) {
    if low_spec_mode {
        if !fft_buffer.is_empty() {
            fft_buffer.clear();
        }
        return;
    }
    if planar.is_empty() || planar[0].is_empty() {
        return;
    }
    let pre_len = planar[0].len();
    let p_ch = planar.len();
    for idx in 0..pre_len {
        let mut m_sample = 0.0f32;
        for ch in 0..p_ch {
            m_sample += planar[ch][idx];
        }
        m_sample /= p_ch as f32;
        fft_buffer.push(m_sample);
        if fft_buffer.len() >= 2048 {
            let _ = fft_tx.try_send((fft_buffer.clone(), sample_rate));
            fft_buffer.clear();
        }
    }
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct NetworkTelemetry {
    pub session_downloaded_bytes: u64,
    pub current_download_rate_bps: u32,
    pub latency_ms: u32,
    pub active_stream_buffered_bytes: u64,
    pub active_stream_total_bytes: u64,
}

pub fn get_network_telemetry() -> NetworkTelemetry {
    NetworkTelemetry {
        session_downloaded_bytes: SESSION_DOWNLOADED_BYTES.load(Ordering::Relaxed),
        current_download_rate_bps: CURRENT_DOWNLOAD_SPEED_BPS.load(Ordering::Relaxed),
        latency_ms: STREAM_LATENCY_MS.load(Ordering::Relaxed),
        active_stream_buffered_bytes: ACTIVE_STREAM_BUFFERED_BYTES.load(Ordering::Relaxed),
        active_stream_total_bytes: ACTIVE_STREAM_TOTAL_BYTES.load(Ordering::Relaxed),
    }
}

/// Canonicalizes any YouTube URL or video ID into standard watch format.
pub fn canonicalize_youtube_url(url: &str) -> String {
    if let Some(id) = crate::youtube::extract_video_id(url) {
        format!("https://www.youtube.com/watch?v={}", id)
    } else {
        url.to_string()
    }
}

/// Checks if input is a YouTube URL, googlevideo link, or clean 11-char video ID.
pub fn is_youtube_url_or_id(input: &str) -> bool {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed.contains("googlevideo.com") {
        return true;
    }
    // Fast path for web URLs: avoid blocking filesystem syscalls for HTTP(S) links
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return crate::youtube::extract_video_id(trimmed).is_some()
            || trimmed.contains("youtube.com")
            || trimmed.contains("youtu.be");
    }
    // If it exists locally on disk, treat it as a local file, not a remote YouTube stream
    if std::path::Path::new(trimmed).exists() {
        return false;
    }
    crate::youtube::extract_video_id(trimmed).is_some()
        || trimmed.contains("youtube.com")
        || trimmed.contains("youtu.be")
}


#[derive(Debug)]
pub enum PlayerCommand {
    Play(String, f64, Option<String>),
    Pause,
    Resume,
    Stop,
    Seek(f64),
    PushNext(String),
    AppendQueue(String),
    RestartStream,
    Shutdown,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub enum PlaybackStatus { Stopped, Playing, Paused }

#[derive(Clone, serde::Serialize, serde::Deserialize, Debug, PartialEq, Default)]
#[serde(default)]
pub struct EQBand {
    pub freq: f32,
    pub gain: f32,
    pub q: f32,
    pub band_type: String, // "lowshelf", "peaking", "highshelf"
}

fn default_crossfeed_mode() -> String {
    "bs2b".to_string()
}

#[derive(Clone, serde::Serialize, serde::Deserialize, Debug, PartialEq)]
#[serde(default)]
pub struct DSPState {
    pub enabled: bool,
    pub low_spec_mode: bool,
    pub audio_profile: String,
    pub resampler_interpolation: String,
    pub resampler_sinc_len: u32,
    pub resampler_oversampling: u32,
    pub ffmpeg_transcode_quality: String,
    pub width: f32,
    pub upsample_rate: u32,
    pub dither: bool,
    pub exclusive_mode_timing: String,
    pub preamp_gain: f32,
    pub limiter_threshold: f32,
    pub resampler_phase_mode: String,

    // EQ
    pub eq_enabled: bool,
    pub eq_parametric: bool,
    pub eq_graphic_gains: Vec<f32>,
    pub eq_parametric_bands: Vec<EQBand>,

    // Crossfeed
    pub crossfeed_enabled: bool,
    pub crossfeed_level: f32,
    pub crossfeed_corner: f32,
    #[serde(default = "default_crossfeed_mode")]
    pub crossfeed_mode: String,

    // Soundstage
    pub spatial_enabled: bool,
    pub spatial_haas_delay: f32,
    pub spatial_wet: f32,
    pub convolution_enabled: bool,
    pub convolution_ir_path: String,
    pub convolution_wet: f32,

    // Dynamics
    pub subsonic_enabled: bool,
    pub night_mode_enabled: bool,
    pub r128_enabled: bool,
    pub track_replaygain_gain: f32,

    // Aideo Filter
    pub aideo_filter_enabled: bool,
    pub aideo_filter_room_size: f32,
    pub aideo_filter_bass_thump: f32,
    pub aideo_filter_dampening: f32,
    pub auto_headroom: bool,
    pub saturation_enabled: bool,
    pub saturation_drive: f32,
    pub crossfade_transition_enabled: bool,
    pub crossfade_transition_duration: f32,
    pub stream_engine: String,
    pub playback_rate: f64,
}

impl Default for DSPState {
    fn default() -> Self {
        Self {
            enabled: false,
            low_spec_mode: false,
            audio_profile: "normal".to_string(),
            resampler_interpolation: "linear".to_string(),
            resampler_sinc_len: 128,
            resampler_oversampling: 256,
            ffmpeg_transcode_quality: "native".to_string(),
            width: 1.0,
            upsample_rate: 0,
            dither: false,
            exclusive_mode_timing: "event".to_string(),
            preamp_gain: 0.0,
            limiter_threshold: -0.1,
            resampler_phase_mode: "linear".to_string(),
            eq_enabled: false,
            eq_parametric: false,
            eq_graphic_gains: vec![0.0; 10],
            eq_parametric_bands: vec![
                EQBand { freq: 80.0, gain: 0.0, q: 0.7, band_type: "lowshelf".to_string() },
                EQBand { freq: 120.0, gain: 0.0, q: 1.0, band_type: "peaking".to_string() },
                EQBand { freq: 240.0, gain: 0.0, q: 1.0, band_type: "peaking".to_string() },
                EQBand { freq: 400.0, gain: 0.0, q: 1.0, band_type: "peaking".to_string() },
                EQBand { freq: 750.0, gain: 0.0, q: 1.0, band_type: "peaking".to_string() },
                EQBand { freq: 1500.0, gain: 0.0, q: 1.0, band_type: "peaking".to_string() },
                EQBand { freq: 2200.0, gain: 0.0, q: 1.0, band_type: "peaking".to_string() },
                EQBand { freq: 4000.0, gain: 0.0, q: 1.0, band_type: "peaking".to_string() },
                EQBand { freq: 6000.0, gain: 0.0, q: 0.7, band_type: "highshelf".to_string() },
                EQBand { freq: 10000.0, gain: 0.0, q: 0.7, band_type: "peaking".to_string() },
            ],
            crossfeed_enabled: false,
            crossfeed_level: -6.0,
            crossfeed_corner: 700.0,
            crossfeed_mode: "bs2b".to_string(),
            spatial_enabled: false,
            spatial_haas_delay: 7.5,
            spatial_wet: 0.15,
            convolution_enabled: false,
            convolution_ir_path: String::new(),
            convolution_wet: 0.5,
            subsonic_enabled: false,
            night_mode_enabled: false,
            r128_enabled: false,
            track_replaygain_gain: 0.0,
            aideo_filter_enabled: false,
            aideo_filter_room_size: 0.85,
            aideo_filter_bass_thump: 6.0,
            aideo_filter_dampening: 0.5,
            auto_headroom: false,
            saturation_enabled: false,
            saturation_drive: 0.0,
            crossfade_transition_enabled: false,
            crossfade_transition_duration: 3.0,
            stream_engine: "auto".to_string(),
            playback_rate: 1.0,
        }
    }
}

impl DSPState {
    pub fn sanitize(&mut self) {
        if !self.width.is_finite() { self.width = 1.0; } else { self.width = self.width.clamp(0.0, 4.0); }
        if !self.preamp_gain.is_finite() { self.preamp_gain = 0.0; } else { self.preamp_gain = self.preamp_gain.clamp(-30.0, 30.0); }
        if !self.limiter_threshold.is_finite() { self.limiter_threshold = -0.1; } else { self.limiter_threshold = self.limiter_threshold.clamp(-30.0, 0.0); }
        if !self.crossfeed_level.is_finite() { self.crossfeed_level = -6.0; } else { self.crossfeed_level = self.crossfeed_level.clamp(-30.0, 0.0); }
        if !self.crossfeed_corner.is_finite() { self.crossfeed_corner = 700.0; } else { self.crossfeed_corner = self.crossfeed_corner.clamp(100.0, 5000.0); }
        if !self.spatial_haas_delay.is_finite() { self.spatial_haas_delay = 7.5; } else { self.spatial_haas_delay = self.spatial_haas_delay.clamp(0.0, 50.0); }
        if !self.spatial_wet.is_finite() { self.spatial_wet = 0.15; } else { self.spatial_wet = self.spatial_wet.clamp(0.0, 1.0); }
        if !self.convolution_wet.is_finite() { self.convolution_wet = 0.5; } else { self.convolution_wet = self.convolution_wet.clamp(0.0, 1.0); }
        if !self.track_replaygain_gain.is_finite() { self.track_replaygain_gain = 0.0; } else { self.track_replaygain_gain = self.track_replaygain_gain.clamp(-30.0, 30.0); }
        if !self.aideo_filter_room_size.is_finite() { self.aideo_filter_room_size = 0.85; } else { self.aideo_filter_room_size = self.aideo_filter_room_size.clamp(0.0, 1.0); }
        if !self.aideo_filter_bass_thump.is_finite() { self.aideo_filter_bass_thump = 6.0; } else { self.aideo_filter_bass_thump = self.aideo_filter_bass_thump.clamp(0.0, 24.0); }
        if !self.aideo_filter_dampening.is_finite() { self.aideo_filter_dampening = 0.5; } else { self.aideo_filter_dampening = self.aideo_filter_dampening.clamp(0.0, 1.0); }
        if !self.saturation_drive.is_finite() { self.saturation_drive = 0.0; } else { self.saturation_drive = self.saturation_drive.clamp(0.0, 1.0); }
        if !self.crossfade_transition_duration.is_finite() { self.crossfade_transition_duration = 3.0; } else { self.crossfade_transition_duration = self.crossfade_transition_duration.clamp(0.0, 30.0); }
        if !self.playback_rate.is_finite() { self.playback_rate = 1.0; } else { self.playback_rate = self.playback_rate.clamp(0.25, 4.0); }

        for g in &mut self.eq_graphic_gains {
            if !g.is_finite() { *g = 0.0; } else { *g = g.clamp(-36.0, 36.0); }
        }

        for band in &mut self.eq_parametric_bands {
            if !band.freq.is_finite() { band.freq = 1000.0; } else { band.freq = band.freq.clamp(10.0, 48000.0); }
            if !band.gain.is_finite() { band.gain = 0.0; } else { band.gain = band.gain.clamp(-36.0, 36.0); }
            if !band.q.is_finite() { band.q = 0.707; } else { band.q = band.q.clamp(0.01, 100.0); }
        }
    }
}


#[derive(Clone)]
pub struct CachedTrack {
    pub path: String,
    pub samples: Arc<Mutex<Vec<Vec<f32>>>>,
    pub complete: Arc<AtomicBool>,
    pub file_rate: usize,
    pub file_ch: usize,
    pub time_base: Option<TimeBase>,
}

pub struct Player {
    pub cmd_tx: std::sync::mpsc::Sender<PlayerCommand>,
    pub status: Arc<AtomicU8>,
    pub current_track: Arc<Mutex<Option<String>>>,
    pub position_secs: Arc<AtomicU64>,
    pub volume: Arc<AtomicU32>,
    pub exclusive_mode: Arc<AtomicBool>,
    pub dsp_state: Arc<Mutex<DSPState>>,
    pub target_device: Arc<Mutex<Option<String>>>,
    pub preferred_device: Arc<Mutex<Option<String>>>,
    pub queue: Arc<Mutex<VecDeque<String>>>,
    pub app_handle: tauri::AppHandle,
    pub current_process: Arc<Mutex<Option<std::process::Child>>>,
    pub ffmpeg_path: String,
    pub bit_perfect: Arc<AtomicBool>,
    pub current_dev_rate: Arc<AtomicU32>,
    pub cache: Arc<Mutex<Option<CachedTrack>>>,
    pub decode_shutdown: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    pub file_rate: Arc<AtomicU32>,
    pub file_ch: Arc<AtomicU8>,
    pub file_format: Arc<Mutex<Option<String>>>,
    pub effective_audio_path: Arc<EffectiveAudioPathState>,
}

fn analyzer_loop(rx: Receiver<(Vec<f32>, f32)>, app_handle: tauri::AppHandle) {
    let mut planner = FftPlanner::new();
    let fft = planner.plan_fft_forward(2048);
    let mut buffer = vec![Complex { re: 0.0, im: 0.0 }; 2048];

    // Hann window
    let mut window = vec![0.0; 2048];
    for (i, val) in window.iter_mut().enumerate() {
        *val = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / 2047.0).cos());
    }

    while let Ok((samples, sample_rate)) = rx.recv() {
        if samples.len() != 2048 { continue; }

        for i in 0..2048 {
            buffer[i] = Complex {
                re: samples[i] * window[i],
                im: 0.0,
            };
        }

        fft.process(&mut buffer);

        let mut magnitudes = vec![0.0; 1024];
        for i in 0..1024 {
            let mag = (buffer[i].re.powi(2) + buffer[i].im.powi(2)).sqrt() / 2048.0;

            // Convert to Decibels (-80dB floor) for human-accurate hearing perception
            let db = if mag > 1e-4 { 20.0 * mag.log10() } else { -80.0 };

            // Normalize dB to a 0.0 -> 1.0 scale
            let mut normalized = (db + 80.0) / 80.0;
            normalized = normalized.clamp(0.0, 1.0);

            // Apply exponential curve for dynamic visual "bounciness"
            let dynamic = normalized.powf(2.5);

            // High-frequency tilt (Pink noise compensation): Music naturally rolls off high frequencies.
            // We boost the upper bins so the right side of the visualizer is as active as the bass.
            let tilt = 1.0 + (i as f32 / 1024.0) * 2.0;

            magnitudes[i] = (dynamic * tilt).clamp(0.0, 1.0);
        }

        let num_bands = 64;
        let mut bands = vec![0.0; num_bands];

        let min_freq = 20.0f32;
        let max_freq = 20000.0f32;

        for (band, val) in bands.iter_mut().enumerate() {
            let start_freq = min_freq * (max_freq / min_freq).powf(band as f32 / num_bands as f32);
            let end_freq = min_freq * (max_freq / min_freq).powf((band + 1) as f32 / num_bands as f32);

            let mut start_bin = (start_freq * 2048.0 / sample_rate) as usize;
            let mut end_bin = (end_freq * 2048.0 / sample_rate) as usize;

            start_bin = start_bin.clamp(1, 1023);
            end_bin = end_bin.clamp(start_bin, 1023);

            let mut sum = 0.0;
            let mut count = 0;
            for &mag in magnitudes.iter().take(end_bin + 1).skip(start_bin) {
                sum += mag;
                count += 1;
            }
            if count > 0 {
                *val = sum / count as f32;
            }
        }

        let _ = app_handle.emit("audio-spectrum", bands);
    }
}


impl Drop for Player {
    fn drop(&mut self) {
        let _ = self.cmd_tx.send(PlayerCommand::Shutdown);
        kill_current_process(&self.current_process);
    }
}

impl Player {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        let (cmd_tx, cmd_rx) = std::sync::mpsc::channel::<PlayerCommand>();
        let status = Arc::new(AtomicU8::new(0)); // 0 = Stopped
        let current_track = Arc::new(Mutex::new(None::<String>));
        let position_secs = Arc::new(AtomicU64::new(0.0f64.to_bits()));
        let volume = Arc::new(AtomicU32::new(1.0f32.to_bits()));
        let exclusive_mode = Arc::new(AtomicBool::new(false));
        let dsp_state = Arc::new(Mutex::new(DSPState::default()));
        let target_device = Arc::new(Mutex::new(None::<String>));
        let preferred_device = Arc::new(Mutex::new(None::<String>));
        let queue = Arc::new(Mutex::new(VecDeque::new()));
        let current_process = Arc::new(Mutex::new(None::<std::process::Child>));
        let ffmpeg_path = find_ffmpeg_path();
        let bit_perfect = Arc::new(AtomicBool::new(false));
        let current_dev_rate = Arc::new(AtomicU32::new(0u32));
        let cache = Arc::new(Mutex::new(None::<CachedTrack>));
        let decode_shutdown = Arc::new(Mutex::new(None::<Arc<AtomicBool>>));
        let file_rate = Arc::new(AtomicU32::new(0));
        let file_ch = Arc::new(AtomicU8::new(0));
        let file_format = Arc::new(Mutex::new(None::<String>));
        let effective_audio_path = Arc::new(EffectiveAudioPathState::new());

        let cp = Arc::clone(&current_process);
        let s = Arc::clone(&status);
        let c = Arc::clone(&current_track);
        let p = Arc::clone(&position_secs);
        let v = Arc::clone(&volume);
        let exc = Arc::clone(&exclusive_mode);
        let bp = Arc::clone(&bit_perfect);
        let dsp = Arc::clone(&dsp_state);
        let dev = Arc::clone(&target_device);
        let qt = Arc::clone(&queue);
        let app = app_handle.clone();
        // ffmpeg_path is now resolved dynamically at each play_file() call

        let dr = Arc::clone(&current_dev_rate);
        let ca = Arc::clone(&cache);
        let ds = Arc::clone(&decode_shutdown);
        let fr = Arc::clone(&file_rate);
        let fc = Arc::clone(&file_ch);
        let fmt = Arc::clone(&file_format);
        let audio_path = Arc::clone(&effective_audio_path);

        // Enforce strict 5.0 GB cache limit & cleanup orphaned temp files on startup
        enforce_cache_size_limit();

        // Spawn network telemetry speed & latency monitor thread
        let current_track_clone = Arc::clone(&current_track);
        thread::Builder::new()
            .name("network-monitor".into())
            .spawn(move || {
                let mut last_bytes = 0;
                loop {
                    thread::sleep(std::time::Duration::from_millis(1000));

                    // 1. Calculate download speed
                    let current_bytes = SESSION_DOWNLOADED_BYTES.load(Ordering::Relaxed);
                    let delta = current_bytes.saturating_sub(last_bytes);
                    CURRENT_DOWNLOAD_SPEED_BPS.store(delta as u32, Ordering::Relaxed);
                    last_bytes = current_bytes;

                    // 2. Measure ping latency if playing a stream
                    let path_opt = {
                        let track_lock = current_track_clone.lock().ok();
                        track_lock.and_then(|t| t.clone())
                    };

                    if let Some(path) = path_opt {
                        if path.starts_with("http://") || path.starts_with("https://") {
                            if let Some(latency) = measure_latency(&path) {
                                STREAM_LATENCY_MS.store(latency, Ordering::Relaxed);
                            }
                        } else {
                            STREAM_LATENCY_MS.store(0, Ordering::Relaxed);
                            ACTIVE_STREAM_BUFFERED_BYTES.store(0, Ordering::Relaxed);
                            ACTIVE_STREAM_TOTAL_BYTES.store(0, Ordering::Relaxed);
                        }
                    } else {
                        STREAM_LATENCY_MS.store(0, Ordering::Relaxed);
                        ACTIVE_STREAM_BUFFERED_BYTES.store(0, Ordering::Relaxed);
                        ACTIVE_STREAM_TOTAL_BYTES.store(0, Ordering::Relaxed);
                    }
                }
            })
            .expect("Failed to spawn network-monitor thread");

        let (fft_tx, fft_rx) = crossbeam_channel::bounded::<(Vec<f32>, f32)>(2);

        let analyzer_app = app_handle.clone();
        thread::Builder::new()
            .name("analyzer".into())
            .spawn(move || analyzer_loop(fft_rx, analyzer_app))
            .expect("Failed to spawn analyzer thread");

        let cmd_tx_clone = cmd_tx.clone();
        thread::Builder::new()
            .name("player".into())
            .spawn(move || player_loop(cmd_rx, cmd_tx_clone, s, c, p, v, exc, bp, dr, ca, dsp, dev, qt, cp, app, fft_tx, ds, fr, fc, fmt, audio_path))
            .expect("Failed to spawn player thread");

        Player { cmd_tx, status, current_track, position_secs, volume, exclusive_mode, dsp_state, target_device, preferred_device, queue, app_handle, current_process, ffmpeg_path, bit_perfect, current_dev_rate, cache, decode_shutdown, file_rate, file_ch, file_format, effective_audio_path }
    }

    pub fn is_bit_perfect_verified(&self) -> bool {
        if self.status.load(Ordering::Relaxed) != 1 {
            return false;
        }
        if !self.exclusive_mode.load(Ordering::Relaxed) {
            return false;
        }
        if !self.bit_perfect.load(Ordering::Relaxed) {
            return false;
        }
        let vol = f32::from_bits(self.volume.load(Ordering::Relaxed));
        if (vol - 1.0).abs() > 0.001 {
            return false;
        }
        let dev_rate = self.current_dev_rate.load(Ordering::Relaxed);
        let src_rate = self.file_rate.load(Ordering::Relaxed);
        if dev_rate == 0 || src_rate == 0 || dev_rate != src_rate {
            return false;
        }
        if let Ok(dsp) = self.dsp_state.lock() {
            if dsp.enabled
                || dsp.eq_enabled
                || dsp.convolution_enabled
                || dsp.crossfeed_enabled
                || dsp.spatial_enabled
                || dsp.r128_enabled
                || dsp.crossfade_transition_enabled
                || dsp.crossfade_transition_duration > 0.0
            {
                return false;
            }
        } else {
            return false;
        }
        true
    }

    pub fn get_signal_path_report(&self) -> SignalPathReport {
        let volume_val = f32::from_bits(self.volume.load(Ordering::Relaxed));
        let requested_exclusive = self.exclusive_mode.load(Ordering::Relaxed);
        let requested_bit_perfect = self.bit_perfect.load(Ordering::Relaxed) && requested_exclusive;
        let dsp = safe_lock(&self.dsp_state).clone();
        let effective_path = self.effective_audio_path.snapshot(
            &dsp,
            requested_exclusive,
            requested_bit_perfect,
            volume_val,
        );
        let is_bit_perfect = self.is_bit_perfect_verified();

        let src_rate = self.file_rate.load(Ordering::Relaxed);
        let src_ch = self.file_ch.load(Ordering::Relaxed);
        let out_rate = self.current_dev_rate.load(Ordering::Relaxed);

        let device_name = safe_lock(&self.target_device)
            .clone()
            .or_else(|| safe_lock(&self.preferred_device).clone())
            .unwrap_or_else(|| "Default Audio Endpoint".to_string());

        let share_mode = if requested_exclusive {
            if effective_path.share_mode == "exclusive" || effective_path.share_mode == "direct" {
                "Exclusive"
            } else {
                "Shared (Fallback)"
            }
        } else {
            "Shared"
        };

        // Stage 1: Source Format
        let format_name = safe_lock(&self.file_format)
            .as_ref()
            .cloned()
            .unwrap_or_else(|| "Source Stream".to_string());
        let bit_depth_str = effective_path.source.bits_per_sample
            .or(effective_path.source.valid_bits_per_sample)
            .map(|b| format!("{}-bit", b))
            .unwrap_or_else(|| "16/24-bit".to_string());
        let stage1 = SignalPathStage {
            stage_id: "source".to_string(),
            title: "Source Format".to_string(),
            subtitle: format_name,
            status: if is_bit_perfect { "bit-perfect".to_string() } else { "lossless".to_string() },
            details: vec![
                ("Sample Rate".to_string(), if src_rate > 0 { format!("{} Hz", src_rate) } else { "Unknown".to_string() }),
                ("Channels".to_string(), if src_ch == 1 { "1 (Mono)".to_string() } else if src_ch == 2 { "2 (Stereo)".to_string() } else if src_ch > 0 { format!("{} Channels", src_ch) } else { "Stereo (2.0)".to_string() }),
                ("Bit Depth".to_string(), bit_depth_str),
            ],
        };

        // Stage 2: Decoder
        let stage2 = SignalPathStage {
            stage_id: "decoder".to_string(),
            title: "Symphonia Audio Decoder".to_string(),
            subtitle: "f32 PCM Internal Bus".to_string(),
            status: "lossless".to_string(),
            details: vec![
                ("Engine".to_string(), "Symphonia Core".to_string()),
                ("Internal Precision".to_string(), "32-bit Floating Point (f32)".to_string()),
                ("Sample Integrity".to_string(), if is_bit_perfect { "Bit-Perfect Passthrough".to_string() } else { "Lossless PCM".to_string() }),
            ],
        };

        // Stage 3: Volume & Leveling
        let volume_pct = (volume_val * 100.0).round() as u32;
        let volume_active = effective_path.volume_applied || (volume_val - 1.0).abs() > 0.001;
        let leveling_active = dsp.r128_enabled || dsp.track_replaygain_gain.abs() > 0.01;
        let stage3_status = if is_bit_perfect || (!volume_active && !leveling_active) {
            "bypassed".to_string()
        } else {
            "enhanced".to_string()
        };
        let stage3 = SignalPathStage {
            stage_id: "volume_leveling".to_string(),
            title: "ReplayGain / LUFS".to_string(),
            subtitle: "Volume & Peak Normalization".to_string(),
            status: stage3_status,
            details: vec![
                ("Volume".to_string(), format!("{}%", volume_pct)),
                ("ReplayGain".to_string(), if dsp.r128_enabled { format!("{:.1} dB", dsp.track_replaygain_gain) } else { "Bypassed / Off".to_string() }),
            ],
        };

        // Stage 4: Parametric EQ
        let active_bands = if dsp.eq_enabled {
            if dsp.eq_parametric {
                dsp.eq_parametric_bands.iter().filter(|b| b.gain.abs() > 0.01).count()
            } else {
                dsp.eq_graphic_gains.iter().filter(|g| g.abs() > 0.01).count()
            }
        } else {
            0
        };
        let stage4 = SignalPathStage {
            stage_id: "parametric_eq".to_string(),
            title: "Biquad Parametric EQ".to_string(),
            subtitle: "10-Band Precision EQ".to_string(),
            status: if dsp.eq_enabled { "enhanced".to_string() } else { "bypassed".to_string() },
            details: vec![
                ("Active Bands".to_string(), format!("{}", active_bands)),
                ("Status".to_string(), if dsp.eq_enabled { "Active (Biquad Filtered)".to_string() } else { "Bypassed".to_string() }),
            ],
        };

        // Stage 5: Acoustics & Spatial
        let spatial_active = dsp.convolution_enabled || dsp.crossfeed_enabled || dsp.spatial_enabled || (dsp.width - 1.0).abs() > 0.01;
        let stage5 = SignalPathStage {
            stage_id: "acoustics_spatial".to_string(),
            title: "Acoustics & Spatial Processing".to_string(),
            subtitle: "Convolution & Crossfeed".to_string(),
            status: if spatial_active { "enhanced".to_string() } else { "bypassed".to_string() },
            details: vec![
                ("Convolution".to_string(), if dsp.convolution_enabled { format!("Active (Wet: {:.0}%)", dsp.convolution_wet * 100.0) } else { "Disabled".to_string() }),
                ("Crossfeed".to_string(), if dsp.crossfeed_enabled { format!("Active (Level: {:.1})", dsp.crossfeed_level) } else { "Disabled".to_string() }),
                ("Width".to_string(), format!("{:.0}%", dsp.width * 100.0)),
            ],
        };

        // Stage 6: Resampler
        let is_resampled = src_rate > 0 && out_rate > 0 && src_rate != out_rate;
        let stage6_status = if is_resampled {
            if out_rate < src_rate { "resampled".to_string() } else { "enhanced".to_string() }
        } else if is_bit_perfect {
            "bit-perfect".to_string()
        } else {
            "bypassed".to_string()
        };
        let stage6 = SignalPathStage {
            stage_id: "resampler".to_string(),
            title: "Rubato Sinc Resampler".to_string(),
            subtitle: "Sample Rate Conversion".to_string(),
            status: stage6_status,
            details: vec![
                ("Input Rate".to_string(), if src_rate > 0 { format!("{} Hz", src_rate) } else { "Source Rate".to_string() }),
                ("Output Rate".to_string(), if out_rate > 0 { format!("{} Hz", out_rate) } else { "Hardware Rate".to_string() }),
                ("Status".to_string(), if is_resampled { format!("Sinc Interpolation ({})", dsp.resampler_interpolation) } else { "1:1 Native Bit-Stream (Bypassed)".to_string() }),
            ],
        };

        // Stage 7: Output Endpoint
        let stage7 = SignalPathStage {
            stage_id: "output_endpoint".to_string(),
            title: "Hardware Endpoint".to_string(),
            subtitle: format!("{} ({})", device_name, share_mode),
            status: if is_bit_perfect { "bit-perfect".to_string() } else { "lossless".to_string() },
            details: vec![
                ("Driver".to_string(), format!("WASAPI ({})", share_mode)),
                ("Latency".to_string(), format!("{} ms", crate::player::telemetry::STREAM_LATENCY_MS.load(Ordering::Relaxed))),
            ],
        };

        let stages = vec![stage1, stage2, stage3, stage4, stage5, stage6, stage7];

        let is_downsampled = src_rate > 0 && out_rate > 0 && out_rate < src_rate;
        let has_dsp_enhancements = dsp.enabled
            || dsp.eq_enabled
            || dsp.convolution_enabled
            || dsp.crossfeed_enabled
            || dsp.spatial_enabled
            || dsp.r128_enabled
            || (dsp.upsample_rate > 0 && out_rate > src_rate)
            || (!is_bit_perfect && effective_path.volume_applied);

        let (overall_fidelity, color_tone) = if is_bit_perfect {
            ("Bit-Perfect".to_string(), "cyan".to_string())
        } else if is_downsampled {
            ("Resampled".to_string(), "amber".to_string())
        } else if has_dsp_enhancements {
            ("Enhanced".to_string(), "purple".to_string())
        } else {
            ("Lossless".to_string(), "green".to_string())
        };

        SignalPathReport {
            overall_fidelity,
            color_tone,
            stages,
        }
    }
}

pub const MAX_CONSECUTIVE_STREAM_RESTARTS: u32 = 3;

#[derive(Debug, PartialEq, Eq)]
pub enum RestartAction {
    Retry { delay_ms: u64, next_count: u32 },
    Halt,
}

pub fn decide_stream_restart(consecutive_restarts: u32, secs_since_last: u64) -> RestartAction {
    let next_count = if secs_since_last < 5 {
        consecutive_restarts + 1
    } else {
        1
    };

    if next_count > MAX_CONSECUTIVE_STREAM_RESTARTS {
        RestartAction::Halt
    } else {
        RestartAction::Retry {
            delay_ms: 250 * u64::from(next_count),
            next_count,
        }
    }
}

fn player_loop(
    rx: std::sync::mpsc::Receiver<PlayerCommand>,
    cmd_tx: std::sync::mpsc::Sender<PlayerCommand>,
    status: Arc<AtomicU8>,
    current_track: Arc<Mutex<Option<String>>>,
    position_secs: Arc<AtomicU64>,
    volume: Arc<AtomicU32>,
    exclusive_mode: Arc<AtomicBool>,
    bit_perfect: Arc<AtomicBool>,
    current_dev_rate: Arc<AtomicU32>,
    cache: Arc<Mutex<Option<CachedTrack>>>,
    dsp_state: Arc<Mutex<DSPState>>,
    target_device: Arc<Mutex<Option<String>>>,
    queue: Arc<Mutex<VecDeque<String>>>,
    current_process: Arc<Mutex<Option<std::process::Child>>>,
    app_handle: tauri::AppHandle,
    fft_tx: Sender<(Vec<f32>, f32)>,
    decode_shutdown: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    file_rate: Arc<AtomicU32>,
    file_ch: Arc<AtomicU8>,
    file_format: Arc<Mutex<Option<String>>>,
    effective_audio_path: Arc<EffectiveAudioPathState>,
) {
    let mut next_track: Option<(String, f64, Option<String>)> = None;
    let mut stream_session: Option<ActiveStreamSession> = None;
    let mut consecutive_stream_restarts = 0u32;
    let mut last_stream_restart = std::time::Instant::now();

    loop {
        let cmd = if let Some((path, pos, attempt_id)) = next_track.take() {
            PlayerCommand::Play(path, pos, attempt_id)
        } else {
            match rx.recv() {
                Ok(c) => c,
                Err(_) => break,
            }
        };

        match cmd {
            PlayerCommand::Play(mut path, mut start_pos, mut attempt_id) => {
                // 🚀 DRAIN / DEBOUNCE QUEUE: If the user spammed 'Next', grab the absolute latest track
                // and skip the intermediate ones to save CPU, disk IO, and prevent UI bouncing.
                let mut abort_play = false;
                let mut deferred_commands = Vec::new();
                while let Ok(next_cmd) = rx.try_recv() {
                    match next_cmd {
                        PlayerCommand::Play(p, pos, a_id) => {
                            crate::log_debug!("AUDIO", "Rapid skip detected: Dropping '{}', jumping straight to '{}'", path, p);
                            let _ = app_handle.emit("playback-cancelled", serde_json::json!({
                                "attempt_id": attempt_id.as_deref().unwrap_or(""),
                                "path": path,
                            }));
                            path = p;
                            start_pos = pos;
                            attempt_id = a_id;
                        }
                        PlayerCommand::Stop => {
                            let _ = app_handle.emit("playback-cancelled", serde_json::json!({
                                "attempt_id": attempt_id.as_deref().unwrap_or(""),
                                "path": path,
                            }));
                            abort_play = true;
                            break;
                        }
                        PlayerCommand::RestartStream => {
                            crate::log_debug!("AUDIO", "Dropping redundant RestartStream command during play start");
                            drop(stream_session.take());
                            acknowledge_stop_arm();
                        }
                        other => {
                            deferred_commands.push(other);
                        }
                    }
                }

                if abort_play {
                    abort_background_downloads();
                    abort_inactive_stream_downloads(None);
                    stream_session = None;
                    effective_audio_path.reset();
                    status.store(0, Ordering::Relaxed); // 0 = Stopped
                    let mut ct = safe_lock(&current_track);
                    *ct = None;
                    finish_stop_arm();
                    continue;
                }

                // Re-inject deferred commands back into the channel so they get processed in order
                for deferred in deferred_commands {
                    let _ = cmd_tx.send(deferred);
                }

                {
                    // A different track re-arms the exclusive failure budget;
                    // same-track rebuilds (toggle/seek/error) must NOT reset it.
                    let prev_path = safe_lock(&current_track).clone();
                    if prev_path.as_deref() != Some(path.as_str()) {
                        EXCLUSIVE_STREAM_FAILURES.store(0, Ordering::SeqCst);
                        EXCLUSIVE_FALLBACK_NOTIFIED.store(false, Ordering::SeqCst);
                        abort_inactive_stream_downloads(Some(&path));
                    }
                    status.store(if STOP_ARM_STATUS.swap(0, Ordering::SeqCst) == 2 { 2 } else { 1 }, Ordering::Relaxed); // Preserve pause while flushing a stop boundary.
                    let mut ct = safe_lock(&current_track);
                    *ct = Some(path.clone());
                    position_secs.store(start_pos.to_bits(), Ordering::Relaxed);
                }

                crate::log_info!("AUDIO", "Beginning playback: '{}' (start_pos: {:.2}s)", path, start_pos);
                effective_audio_path.reset();

                let ffmpeg_path = find_ffmpeg_path();
                let (next, session) = play_file(&path, start_pos, attempt_id.clone(), Arc::clone(&status), Arc::clone(&current_track), Arc::clone(&position_secs), Arc::clone(&volume), Arc::clone(&exclusive_mode), Arc::clone(&bit_perfect), Arc::clone(&current_dev_rate), Arc::clone(&cache), Arc::clone(&dsp_state), Arc::clone(&target_device), Arc::clone(&queue), Arc::clone(&current_process), cmd_tx.clone(), &rx, &app_handle, &fft_tx, &ffmpeg_path, Arc::clone(&decode_shutdown), Arc::clone(&file_rate), Arc::clone(&file_ch), Arc::clone(&file_format), Arc::clone(&effective_audio_path), stream_session.take());
                next_track = next;
                acknowledge_stop_arm();
                stream_session = session;

                if next_track.is_none() {
                    finish_stop_arm();
                    stream_session = None;
                    effective_audio_path.reset();
                    status.store(0, Ordering::Relaxed); // 0 = Stopped
                    let mut ct = safe_lock(&current_track);
                    *ct = None;
                    position_secs.store(0.0f64.to_bits(), Ordering::Relaxed);
                    consecutive_stream_restarts = 0;
                }
            }
            PlayerCommand::Stop => {
                abort_background_downloads();
                abort_inactive_stream_downloads(None);
                stream_session = None;
                effective_audio_path.reset();
                status.store(0, Ordering::Relaxed);
                let mut ct = safe_lock(&current_track);
                *ct = None;
                position_secs.store(0.0f64.to_bits(), Ordering::Relaxed);
                consecutive_stream_restarts = 0;
                finish_stop_arm();
            }
            PlayerCommand::RestartStream => {
                stream_session = None;
                let (path, pos) = {
                    let ct = safe_lock(&current_track);
                    let ps = f64::from_bits(position_secs.load(Ordering::Relaxed));
                    if let Some(p) = ct.clone() { (p, ps) } else { finish_stop_arm(); continue; }
                };

                let now = std::time::Instant::now();
                let secs_since_last = now.duration_since(last_stream_restart).as_secs();
                last_stream_restart = now;

                match decide_stream_restart(consecutive_stream_restarts, secs_since_last) {
                    RestartAction::Halt => {
                        crate::log_error!(
                            "AUDIO",
                            "Consecutive stream restarts exceeded limit ({}). Halting stream recovery to protect audio drivers.",
                            consecutive_stream_restarts + 1
                        );
                        let _ = app_handle.emit("ui-toast", serde_json::json!({
                            "message": "Playback halted: Audio device disconnected or repeatedly failing.",
                            "type": "error"
                        }));
                        abort_background_downloads();
                        effective_audio_path.reset();
                        status.store(0, Ordering::Relaxed);
                        let mut ct = safe_lock(&current_track);
                        *ct = None;
                        position_secs.store(0.0f64.to_bits(), Ordering::Relaxed);
                        consecutive_stream_restarts = 0;
                        continue;
                    }
                    RestartAction::Retry { delay_ms, next_count } => {
                        consecutive_stream_restarts = next_count;
                        std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                        next_track = Some((path, pos, None));
                    }
                }
            }
            PlayerCommand::PushNext(path) => {
                if !SOURCE_QUEUE_MODE.load(Ordering::SeqCst) { safe_lock(&queue).push_front(path); }
            }
            PlayerCommand::AppendQueue(path) => {
                if !SOURCE_QUEUE_MODE.load(Ordering::SeqCst) { safe_lock(&queue).push_back(path); }
            }
            PlayerCommand::Shutdown => {
                abort_background_downloads();
                drop(stream_session.take());
                effective_audio_path.reset();
                status.store(0, Ordering::Relaxed);
                break;
            }
            _ => {}
        }
    }
}



/// Soft lookahead limiter — prevents digital clipping on heavy boosts.
pub struct LookaheadLimiter {
    delay_buffers: Vec<VecDeque<f32>>,
    // Monotonic deque of (sample_index, |sample|) per channel: front is the max
    // of the current lookahead window, giving O(1) peak detection per frame
    // instead of rescanning the whole window.
    peak_windows: Vec<VecDeque<(u64, f32)>>,
    sample_counter: u64,
    window_len: usize,
    gain_envelope: f32, // Current gain attenuation (0.0 to 1.0)
    attack_coeff: f32,
    release_coeff: f32,
}

impl LookaheadLimiter {
    pub fn new(channels: usize, lookahead_ms: f32, sample_rate: f32) -> Self {
        let lookahead_samples = ((lookahead_ms * 0.001 * sample_rate).round() as usize).max(1);
        let mut delay_buffers = Vec::with_capacity(channels);
        for _ in 0..channels {
            let mut q = VecDeque::with_capacity(lookahead_samples);
            q.resize(lookahead_samples, 0.0);
            delay_buffers.push(q);
        }

        let attack_time = lookahead_ms * 0.001;
        let release_time = 0.080f32; // 80ms release

        let attack_coeff = (-1.0 / (attack_time * sample_rate)).exp();
        let release_coeff = (-1.0 / (release_time * sample_rate)).exp();

        Self {
            delay_buffers,
            peak_windows: (0..channels).map(|_| VecDeque::new()).collect(),
            sample_counter: 0,
            window_len: lookahead_samples,
            gain_envelope: 1.0,
            attack_coeff,
            release_coeff,
        }
    }

    pub fn process(&mut self, samples: &mut [f32], threshold_db: f32) {
        let threshold = 10.0f32.powf(threshold_db / 20.0);
        let chs = samples.len();

        while self.delay_buffers.len() < chs {
            let cap = self.delay_buffers.first().map(|b| b.capacity()).unwrap_or(self.window_len);
            let mut q = std::collections::VecDeque::with_capacity(cap.max(self.window_len));
            q.resize(self.window_len, 0.0);
            self.delay_buffers.push(q);
        }
        while self.peak_windows.len() < chs {
            self.peak_windows.push(VecDeque::new());
        }

        self.sample_counter += 1;
        let current_idx = self.sample_counter;
        let oldest_valid = current_idx.saturating_sub(self.window_len as u64 - 1);

        // 1. Push input samples into the delay lines, maintain the sliding maxima
        let mut peak = 0.0f32;
        for ch in 0..chs {
            self.delay_buffers[ch].push_back(samples[ch]);

            let v = samples[ch].abs();
            let w = &mut self.peak_windows[ch];
            while let Some(&(_, back_v)) = w.back() {
                if back_v <= v {
                    w.pop_back();
                } else {
                    break;
                }
            }
            w.push_back((current_idx, v));
            while let Some(&(front_idx, _)) = w.front() {
                if front_idx < oldest_valid {
                    w.pop_front();
                } else {
                    break;
                }
            }
            if let Some(&(_, front_v)) = w.front() {
                peak = peak.max(front_v);
            }
        }

        // 2. Calculate target gain for this frame
        let target_gain = if peak > threshold {
            threshold / peak
        } else {
            1.0
        };

        // 3. Smooth gain envelope (ballistics)
        if target_gain < self.gain_envelope {
            self.gain_envelope = self.gain_envelope * self.attack_coeff + target_gain * (1.0 - self.attack_coeff);
        } else {
            self.gain_envelope = self.gain_envelope * self.release_coeff + target_gain * (1.0 - self.release_coeff);
        }

        // 4. Pop delayed samples and apply gain envelope
        for ch in 0..chs {
            if let Some(delayed_sample) = self.delay_buffers[ch].pop_front() {
                samples[ch] = delayed_sample * self.gain_envelope;
            }
        }
    }
}#[derive(Clone, Debug)]
pub struct AllPassFilter {
    a: f32,
    x1: f32,
    y1: f32,
}

impl AllPassFilter {
    pub fn new(a: f32) -> Self {
        Self { a, x1: 0.0, y1: 0.0 }
    }

    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        let y = self.a * x + self.x1 - self.a * self.y1;
        self.x1 = x;
        self.y1 = y;
        y
    }
}

pub struct PhaseResponseNode {
    enabled: bool,
    mode: String,
    filters_per_ch: Vec<Vec<AllPassFilter>>,
}

impl PhaseResponseNode {
    pub fn new() -> Self {
        Self {
            enabled: false,
            mode: "linear".to_string(),
            filters_per_ch: Vec::new(),
        }
    }
}

impl AudioNode for PhaseResponseNode {
    fn process(&mut self, samples: &mut [Vec<f32>], _sample_rate: f32) {
        if !self.enabled || self.mode == "linear" || samples.is_empty() {
            return;
        }
        let channels = samples.len();
        let num_filters = match self.mode.as_str() {
            "minimum" => 6,
            "intermediate" => 3,
            _ => 0,
        };
        let coeff = match self.mode.as_str() {
            "minimum" => 0.6f32,
            "intermediate" => 0.4f32,
            _ => 0.0f32,
        };

        while self.filters_per_ch.len() < channels {
            let filters: Vec<AllPassFilter> = (0..num_filters).map(|_| AllPassFilter::new(coeff)).collect();
            self.filters_per_ch.push(filters);
        }

        for ch in 0..channels {
            for val in samples[ch].iter_mut() {
                let mut s = *val;
                for f in &mut self.filters_per_ch[ch] {
                    s = f.process(s);
                }
                *val = s;
            }
        }
    }
    fn update_params(&mut self, dsp: &DSPState, _sample_rate: f32) {
        self.enabled = dsp.enabled;
        let new_mode = dsp.resampler_phase_mode.clone();
        if new_mode != self.mode {
            self.mode = new_mode;
            let num_filters = match self.mode.as_str() {
                "minimum" => 6,
                "intermediate" => 3,
                _ => 0,
            };
            let coeff = match self.mode.as_str() {
                "minimum" => 0.6f32,
                "intermediate" => 0.4f32,
                _ => 0.0f32,
            };
            for ch_filters in &mut self.filters_per_ch {
                *ch_filters = (0..num_filters).map(|_| AllPassFilter::new(coeff)).collect();
            }
        }
    }
}

pub trait AudioNode {
    fn process(&mut self, samples: &mut [Vec<f32>], sample_rate: f32);
    fn update_params(&mut self, dsp: &DSPState, sample_rate: f32);
}

pub struct PreampNode {
    enabled: bool,
    gain_linear: f32,
}

impl PreampNode {
    pub fn new() -> Self {
        Self { enabled: false, gain_linear: 1.0 }
    }
}

impl AudioNode for PreampNode {
    fn process(&mut self, samples: &mut [Vec<f32>], _sample_rate: f32) {
        if !self.enabled || samples.is_empty() {
            return;
        }
        for ch in 0..samples.len() {
            for sample in samples[ch].iter_mut() {
                *sample *= self.gain_linear;
            }
        }
    }
    fn update_params(&mut self, dsp: &DSPState, _sample_rate: f32) {
        self.enabled = dsp.enabled;
        let mut gain_db = dsp.preamp_gain;
        if dsp.r128_enabled {
            gain_db += dsp.track_replaygain_gain;
        }
        if dsp.auto_headroom && dsp.eq_enabled {
            let mut max_boost = 0.0f32;
            if dsp.eq_parametric {
                for band in &dsp.eq_parametric_bands {
                    if band.gain > 0.0 {
                        max_boost = max_boost.max(band.gain);
                    }
                }
            } else {
                for &g in &dsp.eq_graphic_gains {
                    if g > 0.0 {
                        max_boost = max_boost.max(g);
                    }
                }
            }
            gain_db -= max_boost;
        }
        self.gain_linear = 10.0f32.powf(gain_db / 20.0);
    }
}

pub struct SaturationNode {
    enabled: bool,
    drive: f32,
}

impl SaturationNode {
    pub fn new() -> Self {
        Self { enabled: false, drive: 0.0 }
    }
}

impl AudioNode for SaturationNode {
    fn process(&mut self, samples: &mut [Vec<f32>], _sample_rate: f32) {
        if !self.enabled || self.drive <= 0.01 || samples.is_empty() {
            return;
        }
        let drive = self.drive;
        let bias = 0.05 * drive;
        let drive_factor = 1.0 + drive * 2.0;
        let bias_out = (bias * drive_factor) / (1.0 + (bias * drive_factor).abs());

        for ch in 0..samples.len() {
            for sample in samples[ch].iter_mut() {
                let x = *sample + bias;
                let x_driven = x * drive_factor;
                let saturated = x_driven / (1.0 + x_driven.abs());
                *sample = saturated - bias_out;
            }
        }
    }
    fn update_params(&mut self, dsp: &DSPState, _sample_rate: f32) {
        self.enabled = dsp.enabled && dsp.saturation_enabled;
        self.drive = dsp.saturation_drive;
    }
}

pub struct EqNode {
    enabled: bool,
    is_parametric: bool,
    graphic_eq_l: Vec<BiquadFilter>,
    graphic_eq_r: Vec<BiquadFilter>,
    parametric_eq_l: Vec<BiquadFilter>,
    parametric_eq_r: Vec<BiquadFilter>,
}

impl EqNode {
    pub fn new() -> Self {
        Self {
            enabled: false,
            is_parametric: false,
            graphic_eq_l: vec![BiquadFilter::new(); 10],
            graphic_eq_r: vec![BiquadFilter::new(); 10],
            parametric_eq_l: vec![BiquadFilter::new(); 10],
            parametric_eq_r: vec![BiquadFilter::new(); 10],
        }
    }
}

impl AudioNode for EqNode {
    fn process(&mut self, samples: &mut [Vec<f32>], _sample_rate: f32) {
        if !self.enabled || samples.is_empty() {
            return;
        }
        let channels = samples.len();
        if self.is_parametric {
            if channels >= 1 {
                for val in samples[0].iter_mut() {
                    let mut s = *val;
                    for j in 0..10 {
                        s = self.parametric_eq_l[j].process(s);
                    }
                    *val = s;
                }
            }
            if channels >= 2 {
                for val in samples[1].iter_mut() {
                    let mut s = *val;
                    for j in 0..10 {
                        s = self.parametric_eq_r[j].process(s);
                    }
                    *val = s;
                }
            }
        } else {
            if channels >= 1 {
                for val in samples[0].iter_mut() {
                    let mut s = *val;
                    for j in 0..10 {
                        s = self.graphic_eq_l[j].process(s);
                    }
                    *val = s;
                }
            }
            if channels >= 2 {
                for val in samples[1].iter_mut() {
                    let mut s = *val;
                    for j in 0..10 {
                        s = self.graphic_eq_r[j].process(s);
                    }
                    *val = s;
                }
            }
        }
    }
    fn update_params(&mut self, dsp: &DSPState, sample_rate: f32) {
        self.enabled = dsp.enabled && dsp.eq_enabled;
        self.is_parametric = dsp.eq_parametric;
        if self.enabled {
            let fs = sample_rate;
            let graphic_freqs = [31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0];
            for j in 0..10 {
                let gain_db = dsp.eq_graphic_gains.get(j).cloned().unwrap_or(0.0);
                self.graphic_eq_l[j].set_peaking(fs, graphic_freqs[j], gain_db, 1.0);
                self.graphic_eq_r[j].set_peaking(fs, graphic_freqs[j], gain_db, 1.0);
            }
            for j in 0..10 {
                if let Some(band) = dsp.eq_parametric_bands.get(j) {
                    match band.band_type.as_str() {
                        "lowshelf" => {
                            self.parametric_eq_l[j].set_lowshelf(fs, band.freq, band.gain, band.q);
                            self.parametric_eq_r[j].set_lowshelf(fs, band.freq, band.gain, band.q);
                        }
                        "highshelf" => {
                            self.parametric_eq_l[j].set_highshelf(fs, band.freq, band.gain, band.q);
                            self.parametric_eq_r[j].set_highshelf(fs, band.freq, band.gain, band.q);
                        }
                        _ => {
                            self.parametric_eq_l[j].set_peaking(fs, band.freq, band.gain, band.q);
                            self.parametric_eq_r[j].set_peaking(fs, band.freq, band.gain, band.q);
                        }
                    }
                }
            }
        }
    }
}

pub struct AideoFilterNode {
    enabled: bool,
    bass_shelf_l: BiquadFilter,
    bass_shelf_r: BiquadFilter,
    room_delay_l: CircularDelayLine,
    room_delay_r: CircularDelayLine,
    room_size: f32,
    bass_thump: f32,
    dampening: f32,
}

impl AideoFilterNode {
    pub fn new() -> Self {
        Self {
            enabled: false,
            bass_shelf_l: BiquadFilter::new(),
            bass_shelf_r: BiquadFilter::new(),
            room_delay_l: CircularDelayLine::new(192000),
            room_delay_r: CircularDelayLine::new(192000),
            room_size: 0.85,
            bass_thump: 6.0,
            dampening: 0.5,
        }
    }
}

impl AudioNode for AideoFilterNode {
    fn process(&mut self, samples: &mut [Vec<f32>], sample_rate: f32) {
        if !self.enabled || samples.is_empty() {
            return;
        }

        let channels = samples.len();
        let len = samples[0].len();

        // 1. Bass thump warmth (lowshelf filter around 90Hz)
        if self.bass_thump.abs() > 0.05 {
            if channels >= 1 {
                for s in samples[0].iter_mut() {
                    *s = self.bass_shelf_l.process(*s);
                }
            }
            if channels >= 2 {
                for s in samples[1].iter_mut() {
                    *s = self.bass_shelf_r.process(*s);
                }
            }
        }

        // 2. Acoustic Room Size & Reflections with Dampening
        if self.room_size > 0.05 && channels >= 2 {
            let delay1_samples = ((self.room_size * 0.035 * sample_rate).round() as usize).clamp(1, 191999);
            let delay2_samples = ((self.room_size * 0.055 * sample_rate).round() as usize).clamp(1, 191999);
            let damp = (1.0 - self.dampening * 0.5).clamp(0.1, 1.0);
            let reflection_mix = (self.room_size * 0.25).clamp(0.0, 0.4);

            let (left, right) = samples.split_at_mut(1);
            let l_channel = &mut left[0];
            let r_channel = &mut right[0];

            for i in 0..len {
                let l = l_channel[i];
                let r = r_channel[i];

                self.room_delay_l.push(l);
                self.room_delay_r.push(r);

                let ref_l = self.room_delay_r.read_delayed(delay1_samples) * damp;
                let ref_r = self.room_delay_l.read_delayed(delay2_samples) * damp;

                l_channel[i] = l * (1.0 - reflection_mix * 0.5) + ref_l * reflection_mix;
                r_channel[i] = r * (1.0 - reflection_mix * 0.5) + ref_r * reflection_mix;
            }
        }
    }

    fn update_params(&mut self, dsp: &DSPState, sample_rate: f32) {
        self.enabled = dsp.enabled && dsp.aideo_filter_enabled;
        self.room_size = dsp.aideo_filter_room_size;
        self.bass_thump = dsp.aideo_filter_bass_thump;
        self.dampening = dsp.aideo_filter_dampening;

        if self.enabled {
            let lowshelf_db = self.bass_thump * 0.7; // warmth boost
            self.bass_shelf_l.set_lowshelf(sample_rate, 90.0, lowshelf_db, 0.707);
            self.bass_shelf_r.set_lowshelf(sample_rate, 90.0, lowshelf_db, 0.707);
        }
    }
}

pub struct SubsonicNode {
    enabled: bool,
    subsonic_l: BiquadFilter,
    subsonic_r: BiquadFilter,
}

impl SubsonicNode {
    pub fn new() -> Self {
        Self {
            enabled: false,
            subsonic_l: BiquadFilter::new(),
            subsonic_r: BiquadFilter::new(),
        }
    }
}

impl AudioNode for SubsonicNode {
    fn process(&mut self, samples: &mut [Vec<f32>], _sample_rate: f32) {
        if !self.enabled || samples.is_empty() {
            return;
        }
        let channels = samples.len();
        if channels >= 1 {
            for val in samples[0].iter_mut() {
                *val = self.subsonic_l.process(*val);
            }
        }
        if channels >= 2 {
            for val in samples[1].iter_mut() {
                *val = self.subsonic_r.process(*val);
            }
        }
    }
    fn update_params(&mut self, dsp: &DSPState, sample_rate: f32) {
        self.enabled = dsp.enabled && dsp.subsonic_enabled;
        if self.enabled {
            self.subsonic_l.set_highpass(sample_rate, 18.0, 0.707);
            self.subsonic_r.set_highpass(sample_rate, 18.0, 0.707);
        }
    }
}

pub struct CrossfeedNode {
    pub enabled: bool,
    pub crossfeed_lp_l: BiquadFilter,
    pub crossfeed_lp_r: BiquadFilter,
    pub crossfeed_delay_l: CircularDelayLine,
    pub crossfeed_delay_r: CircularDelayLine,
    pub crossfeed_level: f32,
    pub crossfeed_corner: f32,
    pub crossfeed_mode: String,
}

impl CrossfeedNode {
    pub fn new() -> Self {
        Self {
            enabled: false,
            crossfeed_lp_l: BiquadFilter::new(),
            crossfeed_lp_r: BiquadFilter::new(),
            crossfeed_delay_l: CircularDelayLine::new(192000),
            crossfeed_delay_r: CircularDelayLine::new(192000),
            crossfeed_level: -6.0,
            crossfeed_corner: 700.0,
            crossfeed_mode: "bs2b".to_string(),
        }
    }
}

impl AudioNode for CrossfeedNode {
    fn process(&mut self, samples: &mut [Vec<f32>], sample_rate: f32) {
        if !self.enabled || samples.len() < 2 {
            return;
        }
        let delay_sec = if self.crossfeed_mode == "meier" {
            0.000250
        } else {
            0.000300
        };
        let delay_samples = ((delay_sec * sample_rate as f64).round() as usize).clamp(1, 1000);
        let feed_gain = 10.0f32.powf(self.crossfeed_level / 20.0);

        let (left, right) = samples.split_at_mut(1);
        let l_channel = &mut left[0];
        let r_channel = &mut right[0];

        for i in 0..l_channel.len() {
            let l = l_channel[i];
            let r = r_channel[i];

            let lp_l = self.crossfeed_lp_l.process(l);
            let lp_r = self.crossfeed_lp_r.process(r);

            self.crossfeed_delay_l.push(lp_l);
            self.crossfeed_delay_r.push(lp_r);

            let delayed_l = self.crossfeed_delay_l.read_delayed(delay_samples);
            let delayed_r = self.crossfeed_delay_r.read_delayed(delay_samples);

            l_channel[i] = l + delayed_r * feed_gain;
            r_channel[i] = r + delayed_l * feed_gain;
        }
    }
    fn update_params(&mut self, dsp: &DSPState, sample_rate: f32) {
        self.enabled = dsp.enabled && dsp.crossfeed_enabled;
        self.crossfeed_mode = dsp.crossfeed_mode.clone();
        if self.crossfeed_mode == "bs2b" {
            self.crossfeed_level = -6.0;
            self.crossfeed_corner = 700.0;
        } else if self.crossfeed_mode == "meier" {
            self.crossfeed_level = -7.5;
            self.crossfeed_corner = 650.0;
        } else {
            self.crossfeed_level = dsp.crossfeed_level;
            self.crossfeed_corner = dsp.crossfeed_corner;
        }
        if self.enabled {
            self.crossfeed_lp_l.set_lowpass(sample_rate, self.crossfeed_corner, 0.5);
            self.crossfeed_lp_r.set_lowpass(sample_rate, self.crossfeed_corner, 0.5);
        }
    }
}

pub struct SpatializerNode {
    enabled: bool,
    spatial_delay_side: CircularDelayLine,
    spatial_wet: f32,
    spatial_haas_delay: f32,
}

impl SpatializerNode {
    pub fn new() -> Self {
        Self {
            enabled: false,
            spatial_delay_side: CircularDelayLine::new(192000),
            spatial_wet: 0.15,
            spatial_haas_delay: 7.5,
        }
    }
}

impl AudioNode for SpatializerNode {
    fn process(&mut self, samples: &mut [Vec<f32>], sample_rate: f32) {
        if !self.enabled || samples.len() < 2 {
            return;
        }
        let wet = self.spatial_wet.clamp(0.0, 1.0);
        if wet <= 0.0001 {
            return;
        }

        let (left, right) = samples.split_at_mut(1);
        let l_channel = &mut left[0];
        let r_channel = &mut right[0];

        for i in 0..l_channel.len() {
            let l_dry = l_channel[i];
            let r_dry = r_channel[i];

            let mid = (l_dry + r_dry) * 0.5;
            let side = (l_dry - r_dry) * 0.5;

            self.spatial_delay_side.push(side);

            let ref1_samples = ((0.0030 * sample_rate as f64).round() as usize).clamp(1, 2047);
            let ref2_samples = ((0.0055 * sample_rate as f64).round() as usize).clamp(1, 2047);
            let ref3_samples = ((0.0082 * sample_rate as f64).round() as usize).clamp(1, 2047);
            let ref4_samples = ((0.0110 * sample_rate as f64).round() as usize).clamp(1, 2047);

            let ref1 = self.spatial_delay_side.read_delayed(ref1_samples) * 0.08;
            let ref2 = self.spatial_delay_side.read_delayed(ref2_samples) * -0.06;
            let ref3 = self.spatial_delay_side.read_delayed(ref3_samples) * 0.04;
            let ref4 = self.spatial_delay_side.read_delayed(ref4_samples) * -0.03;

            let reflections = (ref1 + ref2 + ref3 + ref4) * wet;

            let haas_samples = ((self.spatial_haas_delay * 0.001 * sample_rate).round() as usize).clamp(1, 2047);
            let side_delayed = self.spatial_delay_side.read_delayed(haas_samples);
            let side_room = side_delayed + reflections;

            let theta = (wet * std::f32::consts::FRAC_PI_4).clamp(0.0, std::f32::consts::FRAC_PI_2);
            let cos_t = theta.cos();
            let sin_t = theta.sin();

            let l_spat = mid * cos_t + side_room * sin_t;
            let r_spat = mid * cos_t - side_room * sin_t;

            l_channel[i] = l_dry * (1.0 - wet) + l_spat * wet;
            r_channel[i] = r_dry * (1.0 - wet) + r_spat * wet;
        }
    }
    fn update_params(&mut self, dsp: &DSPState, _sample_rate: f32) {
        self.enabled = dsp.enabled && dsp.spatial_enabled;
        self.spatial_wet = dsp.spatial_wet;
        self.spatial_haas_delay = dsp.spatial_haas_delay;
    }
}

pub struct ConvolutionNode {
    enabled: bool,
    filter_left: ConvolutionFilter,
    filter_right: ConvolutionFilter,
    current_ir_path: String,
}

impl ConvolutionNode {
    pub fn new() -> Self {
        Self {
            enabled: false,
            filter_left: ConvolutionFilter::new(),
            filter_right: ConvolutionFilter::new(),
            current_ir_path: String::new(),
        }
    }

    fn load_ir_file(&mut self, path: &str) {
        self.current_ir_path = path.to_string();

        if path.is_empty() || !std::path::Path::new(path).exists() {
            self.filter_left.load_ir_samples(Vec::new());
            self.filter_right.load_ir_samples(Vec::new());
            return;
        }

        if let Ok(file) = std::fs::File::open(path) {
            let mss = MediaSourceStream::new(Box::new(file), Default::default());
            let mut hint = Hint::new();
            if let Some(ext) = std::path::Path::new(path).extension() {
                hint.with_extension(&ext.to_string_lossy());
            }

            if let Ok(probed) = get_probe().format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default()) {
                let mut format = probed.format;
                if let Some(track) = format.tracks().first().cloned() {
                    if let Ok(mut decoder) = get_codecs().make(&track.codec_params, &DecoderOptions::default()) {
                        let mut left_samples = Vec::new();
                        let mut right_samples = Vec::new();
                        while let Ok(packet) = format.next_packet() {
                            if packet.track_id() == track.id {
                                if let Ok(decoded) = decoder.decode(&packet) {
                                    let ch_count = decoded.spec().channels.count();
                                    append_f32_channel_data(&decoded, 0, 0, &mut left_samples);
                                    append_f32_channel_data(&decoded, usize::from(ch_count > 1), 0, &mut right_samples);
                                }
                            }
                        }
                        let max_l = left_samples.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
                        let max_r = right_samples.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
                        let global_max = max_l.max(max_r).max(1e-6);

                        self.filter_left.load_ir_samples_scaled(left_samples, global_max);
                        self.filter_right.load_ir_samples_scaled(right_samples, global_max);
                    }
                }
            }
        }
    }
}



impl AudioNode for ConvolutionNode {
    fn process(&mut self, samples: &mut [Vec<f32>], _sample_rate: f32) {
        if !self.enabled || samples.is_empty() {
            return;
        }
        let len = samples[0].len();
        if samples.len() >= 2 {
            let (left, right) = samples.split_at_mut(1);
            let l_chan = &mut left[0];
            let r_chan = &mut right[0];
            for i in 0..len {
                l_chan[i] = self.filter_left.process(l_chan[i]);
                r_chan[i] = self.filter_right.process(r_chan[i]);
            }
        } else {
            let l_chan = &mut samples[0];
            for i in 0..len {
                l_chan[i] = self.filter_left.process(l_chan[i]);
            }
        }
    }

    fn update_params(&mut self, dsp: &DSPState, _sample_rate: f32) {
        self.enabled = dsp.enabled && dsp.convolution_enabled;
        self.filter_left.enabled = self.enabled;
        self.filter_right.enabled = self.enabled;
        self.filter_left.wet = dsp.convolution_wet;
        self.filter_right.wet = dsp.convolution_wet;

        if dsp.convolution_ir_path != self.current_ir_path {
            self.load_ir_file(&dsp.convolution_ir_path);
        }
    }
}

pub struct WidthNode {
    enabled: bool,
    width: f32,
}

impl WidthNode {
    pub fn new() -> Self {
        Self { enabled: false, width: 1.0 }
    }
}

impl AudioNode for WidthNode {
    fn process(&mut self, samples: &mut [Vec<f32>], _sample_rate: f32) {
        if !self.enabled || samples.len() < 2 || self.width == 1.0 {
            return;
        }
        let (left, right) = samples.split_at_mut(1);
        let l_channel = &mut left[0];
        let r_channel = &mut right[0];

        for i in 0..l_channel.len() {
            let l = l_channel[i];
            let r = r_channel[i];
            let mid = (l + r) * 0.5;
            let side = (l - r) * 0.5;
            let side_scaled = side * self.width;
            l_channel[i] = mid + side_scaled;
            r_channel[i] = mid - side_scaled;
        }
    }
    fn update_params(&mut self, dsp: &DSPState, _sample_rate: f32) {
        self.enabled = dsp.enabled;
        self.width = dsp.width;
    }
}

pub struct CompressorNode {
    enabled: bool,
    compressor_envelope: f32,
}

impl CompressorNode {
    pub fn new() -> Self {
        Self { enabled: false, compressor_envelope: 0.0 }
    }
}

impl AudioNode for CompressorNode {
    fn process(&mut self, samples: &mut [Vec<f32>], sample_rate: f32) {
        if !self.enabled || samples.is_empty() {
            return;
        }
        let channels = samples.len();
        let attack_coef = (-1.0f32 / (0.010 * sample_rate)).exp();  // 10ms
        let release_coef = (-1.0f32 / (0.100 * sample_rate)).exp(); // 100ms
        let threshold = 0.063f32; // -24dBFS
        let ratio = 2.5f32;

        let len = samples[0].len();
        for i in 0..len {
            let mut max_val = 0.0f32;
            for ch in 0..channels {
                max_val = max_val.max(samples[ch][i].abs());
            }

            self.compressor_envelope = if max_val > self.compressor_envelope {
                self.compressor_envelope * attack_coef + max_val * (1.0 - attack_coef)
            } else {
                self.compressor_envelope * release_coef + max_val * (1.0 - release_coef)
            };

            if self.compressor_envelope > threshold {
                let env_db = 20.0 * self.compressor_envelope.log10().max(-100.0);
                let thresh_db = -24.0f32;
                let overshoot = env_db - thresh_db;
                let target_gain_db = -overshoot * (1.0 - 1.0 / ratio);
                let gain = 10.0f32.powf(target_gain_db / 20.0);
                for ch in 0..channels {
                    samples[ch][i] *= gain;
                }
            }
        }
    }
    fn update_params(&mut self, dsp: &DSPState, _sample_rate: f32) {
        self.enabled = dsp.enabled && dsp.night_mode_enabled;
    }
}

pub struct NormalizerNode {
    enabled: bool,
    r128_slow_rms: f32,
    r128_agc_gain: f32,
}

impl NormalizerNode {
    pub fn new() -> Self {
        Self {
            enabled: false,
            r128_slow_rms: 0.0001f32,
            r128_agc_gain: 1.0f32,
        }
    }
}

impl AudioNode for NormalizerNode {
    fn process(&mut self, samples: &mut [Vec<f32>], sample_rate: f32) {
        if !self.enabled || samples.is_empty() {
            return;
        }
        let channels = samples.len();
        let rms_alpha = (-1.0f32 / (3.0 * sample_rate)).exp();
        let target_lufs = -14.0f32;
        let step = 0.5 / sample_rate;

        let len = samples[0].len();
        for i in 0..len {
            let mut max_sq = 0.0f32;
            for ch in 0..channels {
                let s = samples[ch][i];
                max_sq = max_sq.max(s * s);
            }

            self.r128_slow_rms = self.r128_slow_rms * rms_alpha + max_sq * (1.0 - rms_alpha);

            let is_silent = max_sq < 1e-6;
            let cur_lufs = 10.0 * self.r128_slow_rms.log10().max(-100.0) - 0.69;
            let diff = target_lufs - cur_lufs;

            let target_gain = if is_silent || cur_lufs < -50.0 {
                1.0f32
            } else {
                10.0f32.powf(diff / 20.0).clamp(0.25, 2.0)
            };
            if self.r128_agc_gain < target_gain {
                self.r128_agc_gain = (self.r128_agc_gain + step).min(target_gain);
            } else if self.r128_agc_gain > target_gain {
                self.r128_agc_gain = (self.r128_agc_gain - step).max(target_gain);
            }

            for ch in 0..channels {
                samples[ch][i] *= self.r128_agc_gain;
            }
        }
    }
    fn update_params(&mut self, dsp: &DSPState, _sample_rate: f32) {
        // Single-path loudness rule: when the track has a static ReplayGain/R128
        // tag, PreampNode applies it exactly once and this dynamic AGC must stay
        // out of the signal path. The AGC only engages for tracks without a tag
        // so every track still gets normalized to target loudness.
        let has_static_gain = dsp.track_replaygain_gain.abs() > f32::EPSILON;
        self.enabled = dsp.enabled && dsp.r128_enabled && !has_static_gain;
    }
}

pub struct LimiterNode {
    enabled: bool,
    limiter: LookaheadLimiter,
    threshold_db: f32,
}

impl LimiterNode {
    pub fn new(channels: usize, lookahead_ms: f32, sample_rate: f32) -> Self {
        Self {
            enabled: false,
            limiter: LookaheadLimiter::new(channels, lookahead_ms, sample_rate),
            threshold_db: -0.1,
        }
    }
}

impl AudioNode for LimiterNode {
    fn process(&mut self, samples: &mut [Vec<f32>], _sample_rate: f32) {
        if !self.enabled || samples.is_empty() {
            return;
        }
        let channels = samples.len();
        let len = samples[0].len();
        let mut frame = vec![0.0f32; channels];
        for i in 0..len {
            for ch in 0..channels {
                frame[ch] = samples[ch][i];
            }
            self.limiter.process(&mut frame, self.threshold_db);
            for ch in 0..channels {
                samples[ch][i] = frame[ch];
            }
        }
    }
    fn update_params(&mut self, dsp: &DSPState, _sample_rate: f32) {
        self.enabled = dsp.enabled;
        self.threshold_db = dsp.limiter_threshold;
    }
}


#[derive(Default)]
struct ResamplerOutputTimeline {
    expected_frames: f64,
    emitted_frames: usize,
    startup_delay: usize,
    started: bool,
}

impl ResamplerOutputTimeline {
    fn add_input(&mut self, frames: usize, previous_ratio: f64, target_ratio: f64) {
        // Rubato ramps inverse ratios over its approximate output block. Solve
        // the integrated input position for the actual output-frame estimate.
        let ratio = if (previous_ratio - target_ratio).abs() < 1e-10 {
            target_ratio
        } else {
            let inverse = 1.0 / previous_ratio;
            let delta = 1.0 / target_ratio - inverse;
            let mean = (previous_ratio + target_ratio) * 0.5;
            2.0 / (inverse + (inverse * inverse + 2.0 * delta / mean).sqrt())
        };
        self.expected_frames += frames as f64 * ratio;
    }

    fn output_frames(&self) -> usize {
        self.expected_frames.ceil() as usize
    }

    fn remaining(&self) -> usize {
        self.output_frames().saturating_sub(self.emitted_frames)
    }

    fn trim(&mut self, output: &mut [Vec<f32>]) {
        if output.is_empty() { return; }
        let skipped = self.startup_delay.min(output[0].len());
        self.startup_delay -= skipped;
        for channel in output.iter_mut() { channel.drain(..skipped); }
        let count = output[0].len().min(self.remaining());
        for channel in output.iter_mut() { channel.truncate(count); }
        self.emitted_frames += count;
    }
}


fn ram_seek_cursor(seconds: f64, sample_rate: usize, samples_len: usize, complete: bool) -> usize {
    let requested = (seconds * sample_rate as f64) as usize;
    if complete { requested.min(samples_len) } else { requested }
}

pub fn is_stream_prebuffer_ready(
    samples_len: usize,
    min_watermark: usize,
    is_complete: bool,
) -> bool {
    samples_len >= min_watermark || is_complete
}

pub fn should_bypass_dsp_for_bit_perfect(is_bit_perfect: bool, dsp_enabled: bool) -> bool {
    is_bit_perfect || !dsp_enabled
}

pub fn should_bypass_resampler(file_rate: usize, dev_rate: usize, playback_rate: f64) -> bool {
    file_rate == dev_rate && (playback_rate - 1.0).abs() < 0.001
}


pub fn downmix_to_stereo(planar: &mut [Vec<f32>], frames: usize) {
    let num_ch = planar.len();
    if num_ch <= 2 || frames == 0 {
        return;
    }

    const INV_SQRT2: f32 = 0.70710678;

    if num_ch == 3 {
        // 3.0: L, R, C
        let norm = 1.0 / (1.0 + INV_SQRT2);
        for i in 0..frames {
            let l = planar[0][i];
            let r = planar[1][i];
            let c = planar[2][i];
            planar[0][i] = (l + c * INV_SQRT2) * norm;
            planar[1][i] = (r + c * INV_SQRT2) * norm;
        }
    } else if num_ch == 6 {
        // 5.1: 0:L, 1:R, 2:C, 3:LFE, 4:Ls, 5:Rs
        let norm = 1.0 / (1.0 + INV_SQRT2 + INV_SQRT2 + 0.5 * INV_SQRT2);
        for i in 0..frames {
            let l = planar[0][i];
            let r = planar[1][i];
            let c = planar[2][i];
            let lfe = planar[3][i] * 0.5; // LFE attenuated to prevent distortion
            let ls = planar[4][i];
            let rs = planar[5][i];
            planar[0][i] = (l + (c + ls + lfe) * INV_SQRT2) * norm;
            planar[1][i] = (r + (c + rs + lfe) * INV_SQRT2) * norm;
        }
    } else if num_ch >= 8 {
        // 7.1: 0:L, 1:R, 2:C, 3:LFE, 4:Ls, 5:Rs, 6:Rls, 7:Rrs
        let norm = 1.0 / (1.0 + INV_SQRT2 * 3.0);
        for i in 0..frames {
            let l = planar[0][i];
            let r = planar[1][i];
            let c = planar[2][i];
            let lfe = planar[3][i] * 0.5;
            let ls = planar[4][i];
            let rs = planar[5][i];
            let rls = planar[6][i];
            let rrs = planar[7][i];
            planar[0][i] = (l + (c + lfe) * INV_SQRT2 + (ls + rls) * 0.5) * norm;
            planar[1][i] = (r + (c + lfe) * INV_SQRT2 + (rs + rrs) * 0.5) * norm;
        }
    } else {
        // Generic 4-channel (Quad) or 5-channel
        let norm = 1.0 / (num_ch as f32).sqrt();
        for i in 0..frames {
            let mut sum_l = planar[0][i];
            let mut sum_r = planar[1][i];
            if num_ch == 5 {
                // 5.0: L, R, C, Ls, Rs
                let c = planar[2][i];
                let ls = planar[3][i];
                let rs = planar[4][i];
                sum_l += (c + ls) * INV_SQRT2;
                sum_r += (c + rs) * INV_SQRT2;
            } else {
                // Quad: L, R, Ls, Rs
                sum_l += planar[2][i] * INV_SQRT2;
                sum_r += planar[3][i] * INV_SQRT2;
            }
            planar[0][i] = sum_l * norm;
            planar[1][i] = sum_r * norm;
        }
    }
}

fn fold_for_stereo_output(planar: &mut Vec<Vec<f32>>, output_channels: usize) {
    if output_channels == 2 && planar.len() > 2 {
        let frames = planar[0].len();
        downmix_to_stereo(planar, frames);
        planar.truncate(2);
    }
}

pub fn resolve_stream_volume(is_bit_perfect: bool, paused: bool, user_vol: f32) -> f32 {
    if paused || user_vol <= 0.0 {
        0.0
    } else if is_bit_perfect {
        1.0
    } else {
        user_vol.clamp(0.0, 1.0)
    }
}


fn update_playback_ratio(resampler: &mut SincFixedIn<f32>, last_ratio: &mut f64, rate: f64) {
    let ratio = 1.0 / rate.clamp(0.5, 2.0);
    if (*last_ratio - ratio).abs() > 0.0001
        && resampler.set_resample_ratio_relative(ratio, true).is_ok()
    {
        *last_ratio = ratio;
    }
}


pub fn generate_handoff_attempt_id() -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let gen = PLAYBACK_GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    format!("handoff_{}_{}", ts, gen)
}

fn play_file(
    path: &str,
    start_pos: f64,
    attempt_id: Option<String>,
    status: Arc<AtomicU8>,
    current_track: Arc<Mutex<Option<String>>>,
    position_secs: Arc<AtomicU64>,
    volume: Arc<AtomicU32>,
    exclusive_mode: Arc<AtomicBool>,
    bit_perfect: Arc<AtomicBool>,
    current_dev_rate: Arc<AtomicU32>,
    cache: Arc<Mutex<Option<CachedTrack>>>,
    dsp_state: Arc<Mutex<DSPState>>,
    target_device: Arc<Mutex<Option<String>>>,
    queue: Arc<Mutex<VecDeque<String>>>,
    current_process: Arc<Mutex<Option<std::process::Child>>>,
    cmd_tx: std::sync::mpsc::Sender<PlayerCommand>,
    rx: &std::sync::mpsc::Receiver<PlayerCommand>,
    app_handle: &tauri::AppHandle,
    fft_tx: &Sender<(Vec<f32>, f32)>,
    ffmpeg_path: &str,
    player_decode_shutdown: Arc<Mutex<Option<Arc<AtomicBool>>>>,
    file_rate_out: Arc<AtomicU32>,
    file_ch_out: Arc<AtomicU8>,
    file_format_out: Arc<Mutex<Option<String>>>,
    effective_audio_path: Arc<EffectiveAudioPathState>,
    mut existing_session: Option<ActiveStreamSession>,
) -> (Option<(String, f64, Option<String>)>, Option<ActiveStreamSession>) {
    let _stop_arm_ack = StopArmAckOnDrop;
    // Enforce 1ms timer resolution and elevate audio pump thread priority, MMCSS, and EcoQoS opt-out
    let _timer_guard = TimePeriodGuard::new();
    #[cfg(target_os = "windows")]
    let _audio_thread_guard = WindowsAudioThreadGuard::activate();

    *safe_lock(&current_track) = Some(path.to_string());

    let resolved_path = path.to_string();
    let mut is_manual_change = false;

    let track_rg_gain: f32 = if let Some(app_state) = app_handle.try_state::<crate::AppState>() {
        let conn = safe_lock(&app_state.db);
        conn.query_row(
            "SELECT replaygain_gain FROM tracks WHERE path = ?1",
            rusqlite::params![path],
            |r| r.get::<_, Option<f64>>(0),
        )
        .unwrap_or(None)
        .unwrap_or(0.0) as f32
    } else {
        0.0f32
    };

    {
        let mut dsp = safe_lock(&dsp_state);
        dsp.track_replaygain_gain = track_rg_gain;
    }

    let dsp_now = safe_lock(&dsp_state).clone();
    let transcode_quality = dsp_now.ffmpeg_transcode_quality.clone();

    let (tx, rx_decoder) = std::sync::mpsc::channel();
    let path_clone = resolved_path.clone();
    let app_handle_clone = app_handle.clone();
    let ffmpeg_clone = ffmpeg_path.to_string();
    let process_clone = Arc::clone(&current_process);
    let quality_clone = transcode_quality.clone();
    let dsp_clone = dsp_now.clone();
    let generation = PLAYBACK_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let cancel_token = Arc::new(AtomicBool::new(false));
    let cancel_token_clone = Arc::clone(&cancel_token);
    let decoder_attempt_id = attempt_id.clone();

    std::thread::spawn(move || {
        let res = prepare_decoder(
            &path_clone,
            start_pos,
            decoder_attempt_id.as_deref(),
            &app_handle_clone,
            &ffmpeg_clone,
            &process_clone,
            &quality_clone,
            &dsp_clone,
            &cancel_token_clone,
            generation,
        );
        let _ = tx.send(res);
    });

    let info = loop {
        // 1. Check if decoder is ready
        if let Ok(res) = rx_decoder.try_recv() {
            match res {
                Ok(i) => {
                    file_rate_out.store(i.file_rate as u32, Ordering::Relaxed);
                    file_ch_out.store(i.file_ch as u8, Ordering::Relaxed);
                    *safe_lock(&file_format_out) = Some(detect_format_from_path(path));
                    break i;
                }
                Err(e) => {
                    cancel_token.store(true, Ordering::SeqCst);
                    PLAYBACK_GENERATION.fetch_add(1, Ordering::SeqCst);
                    kill_current_process(&current_process); // Ensure dead process is reaped immediately
                    if let Some(attempt_id) = attempt_id.as_deref() {
                        let _ = app_handle.emit("source-playback-error", serde_json::json!({
                            "path": path, "error": &e, "attempt_id": attempt_id,
                        }));
                    } else {
                        let _ = app_handle.emit("playback-error", serde_json::json!({
                            "path": path, "error": &e,
                        }));
                    }
                    return (None, None);
                }
            }
        }

        // 2. Poll commands channel to abort preparation instantly if new player command arrives
        if let Ok(cmd) = rx.try_recv() {
            match cmd {
                PlayerCommand::Stop => {
                    cancel_token.store(true, Ordering::SeqCst);
                    PLAYBACK_GENERATION.fetch_add(1, Ordering::SeqCst);
                    abort_background_downloads();
                    abort_inactive_stream_downloads(None);
                    kill_current_process(&current_process);
                    let _ = app_handle.emit("playback-cancelled", serde_json::json!({
                        "attempt_id": attempt_id.as_deref().unwrap_or(""),
                        "path": path,
                    }));
                    return (None, None);
                }
                PlayerCommand::Play(p, pos, a_id) => {
                    cancel_token.store(true, Ordering::SeqCst);
                    PLAYBACK_GENERATION.fetch_add(1, Ordering::SeqCst);
                    abort_background_downloads();
                    abort_inactive_stream_downloads(Some(&p));
                    kill_current_process(&current_process);
                    let _ = app_handle.emit("playback-cancelled", serde_json::json!({
                        "attempt_id": attempt_id.as_deref().unwrap_or(""),
                        "path": path,
                    }));
                    return (Some((p, pos, a_id)), None);
                }
                PlayerCommand::Seek(secs) => {
                    cancel_token.store(true, Ordering::SeqCst);
                    PLAYBACK_GENERATION.fetch_add(1, Ordering::SeqCst);
                    abort_background_downloads();
                    kill_current_process(&current_process);
                    return (Some((path.to_string(), secs, attempt_id.clone())), None);
                }
                PlayerCommand::Pause => {
                    status.store(2, Ordering::Relaxed);
                }
                PlayerCommand::Resume => {
                    status.store(1, Ordering::Relaxed);
                }
                PlayerCommand::RestartStream => {
                    cancel_token.store(true, Ordering::SeqCst);
                    PLAYBACK_GENERATION.fetch_add(1, Ordering::SeqCst);
                    abort_background_downloads();
                    kill_current_process(&current_process);
                    return (Some((path.to_string(), start_pos, attempt_id.clone())), None);
                }
                PlayerCommand::PushNext(path) => {
                    if !SOURCE_QUEUE_MODE.load(Ordering::SeqCst) { safe_lock(&queue).push_front(path); }
                }
                PlayerCommand::AppendQueue(path) => {
                    if !SOURCE_QUEUE_MODE.load(Ordering::SeqCst) { safe_lock(&queue).push_back(path); }
                }
                PlayerCommand::Shutdown => {
                    cancel_token.store(true, Ordering::SeqCst);
                    PLAYBACK_GENERATION.fetch_add(1, Ordering::SeqCst);
                    abort_background_downloads();
                    kill_current_process(&current_process);
                    return (None, None);
                }
            }
        }

        std::thread::sleep(std::time::Duration::from_millis(50));
    };

    let resolved_path = info.resolved_path.clone();
    let decrypted_file = info._decrypted_file;
    let _decrypted_process = info._decrypted_process;

    let mut file_rate = info.file_rate;
    let mut file_ch = info.file_ch;
    let source_sample_format = info.source_sample_format.clone();
    let source_bits_per_sample = info.source_bits_per_sample;
    let source_channel_mask = info.source_channel_mask;
    let track_id = info.track_id;
    let mut format = info.format;
    let mut decoder = info.decoder;
    let mut time_base = info.time_base;



    let is_exclusive = exclusive_mode.load(Ordering::Relaxed);
    let is_stream = resolved_path.starts_with("http://") || resolved_path.starts_with("https://");

    // 1b. Safety RAM cache check: Bypass cache for large files (>150MB or >15 minutes duration)
    let duration_secs = format.tracks().first().and_then(|t| {
        t.codec_params.n_frames.and_then(|frames| {
            t.codec_params.time_base.map(|tb| frames as f64 * tb.numer as f64 / tb.denom as f64)
        })
    }).unwrap_or(0.0);

    let is_too_large = if !is_stream {
        {
            let file_bytes = std::fs::metadata(&resolved_path).map(|m| m.len()).unwrap_or(0);
            let too_large = should_bypass_ram_cache(file_bytes, duration_secs, file_rate, file_ch);
            if too_large {
                println!(
                    "[player] Track is too large ({}MB / {}s / {}ch @ {}Hz). Bypassing RAM cache to prevent excessive memory usage.",
                    file_bytes / (1024 * 1024),
                    duration_secs.round(),
                    file_ch,
                    file_rate
                );
                let _ = app_handle.emit("ui-toast", serde_json::json!({
                    "message": "Large or high-res audio: Streaming directly from disk to save RAM.",
                    "type": "info"
                }));
            }
            too_large
        }
    } else {
        false
    };

    // 2. PRE-DECODE INTO RAM (if not a stream and not too large)
    let mut old_shutdown = safe_lock(&player_decode_shutdown);
    let (decoded_samples, is_complete, decode_shutdown) = if !is_stream && !is_too_large {
        let mut cache_lock = safe_lock(&cache);

        let can_reuse = if let Some(cached) = &*cache_lock {
            let is_complete = cached.complete.load(Ordering::SeqCst);
            let decode_shutdown_active = match &*old_shutdown {
                Some(sd) => !sd.load(Ordering::SeqCst),
                None => false,
            };
            can_reuse_cached_track(
                &cached.path,
                &resolved_path,
                cached.file_rate,
                file_rate,
                cached.file_ch,
                file_ch,
                is_complete,
                decode_shutdown_active,
            )
        } else {
            false
        };

        if can_reuse {
            let cached = cache_lock.as_ref().unwrap();
            file_rate = cached.file_rate;
            file_ch = cached.file_ch;
            time_base = cached.time_base;
            file_rate_out.store(file_rate as u32, Ordering::Relaxed);
            file_ch_out.store(file_ch as u8, Ordering::Relaxed);
            kill_current_process(&current_process);
            let sd = match &*old_shutdown {
                Some(s) => Arc::clone(s),
                None => Arc::new(AtomicBool::new(false)),
            };
            (Some(Arc::clone(&cached.samples)), Some(Arc::clone(&cached.complete)), sd)
        } else {
            if let Some(old) = old_shutdown.take() {
                old.store(true, Ordering::SeqCst);
            }

            let decode_shutdown = Arc::new(AtomicBool::new(false));
            *old_shutdown = Some(Arc::clone(&decode_shutdown));

            let samples = Arc::new(Mutex::new(vec![Vec::new(); file_ch]));
            let complete = Arc::new(AtomicBool::new(false));
            let cached = CachedTrack {
                path: resolved_path.clone(),
                samples: Arc::clone(&samples),
                complete: Arc::clone(&complete),
                file_rate,
                file_ch,
                time_base,
            };
            *cache_lock = Some(cached);

            let path_str = resolved_path.clone();
            let s_clone = Arc::clone(&samples);
            let c_clone = Arc::clone(&complete);
            let sd_clone = Arc::clone(&decode_shutdown);
            let cache_codec = cache_pcm_codec(source_sample_format.as_deref(), &transcode_quality);
            let decrypted_file = decrypted_file.clone();
            thread::spawn(move || {
                background_decode(path_str, s_clone, c_clone, sd_clone, file_rate, cache_codec, decrypted_file);
            });

            // Wait for initial pre-buffer cushion if it's an actively growing stream (.tmp)
            // to ensure the audio engine starts with a healthy safety margin against CDN throttling.
            if resolved_path.contains(".tmp") {
                let min_prebuffer_frames = file_rate * 2; // 2 seconds of audio
                let wait_start = std::time::Instant::now();
                while wait_start.elapsed() < std::time::Duration::from_secs(3) {
                    let (len, is_done) = {
                        let lock = safe_lock(&samples);
                        (if lock.is_empty() { 0 } else { lock[0].len() }, complete.load(Ordering::SeqCst))
                    };
                    if is_stream_prebuffer_ready(len, min_prebuffer_frames, is_done) || decode_shutdown.load(Ordering::SeqCst) {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(25));
                }
            }

            (Some(samples), Some(complete), decode_shutdown)
        }
    } else {
        if let Some(old) = old_shutdown.take() {
            old.store(true, Ordering::SeqCst);
        }
        let sd = Arc::new(AtomicBool::new(false));
        *old_shutdown = Some(Arc::clone(&sd));
        (None, None, sd)
    };
    drop(old_shutdown);

    // 1c. Startup demuxer seek for bypassed cache/streams (skip for HTTP streams because the transcoder/server already seeked)
    if start_pos > 0.0 && decoded_samples.is_none() && !is_stream {
        if let Some(tb) = time_base {
            let seek_ts = (start_pos * tb.denom as f64 / tb.numer as f64) as u64;
            let _ = format.seek(symphonia::core::formats::SeekMode::Accurate, symphonia::core::formats::SeekTo::TimeStamp { ts: seek_ts, track_id });
            decoder.reset();
        }
    }

    let mut target = safe_lock(&target_device).clone();
    let mut output_fallback_reason: Option<String> = None;

    let host = if let Some(ref name) = target {
        if name.starts_with("[ASIO]") {
            #[cfg(all(feature = "asio", target_os = "windows"))]
            { cpal::host_from_id(cpal::HostId::Asio).unwrap_or_else(|_| cpal::default_host()) }
            #[cfg(not(all(feature = "asio", target_os = "windows")))]
            { cpal::default_host() }
        } else {
            cpal::default_host()
        }
    } else {
        cpal::default_host()
    };

    #[cfg(all(feature = "asio", target_os = "windows"))]
    let is_asio_host = host.id() == cpal::HostId::Asio;
    #[cfg(not(all(feature = "asio", target_os = "windows")))]
    let is_asio_host = false;

    let device = {
        let (dev, tried_target) = if let Some(ref full_name) = target {
            let actual_name = if full_name.starts_with("[ASIO] ") {
                full_name.trim_start_matches("[ASIO] ").to_string()
            } else if full_name.starts_with("[WASAPI] ") {
                full_name.trim_start_matches("[WASAPI] ").to_string()
            } else {
                full_name.clone()
            };

            let found_dev = match host.output_devices() {
                Ok(ds) => {
                    let mut candidate_list = Vec::new();
                    for d in ds {
                        #[allow(deprecated)]
                        if let Ok(n) = d.name() {
                            candidate_list.push((d, n));
                        }
                    }

                    let names: Vec<String> = candidate_list.iter().map(|(_, n)| n.clone()).collect();
                    let best_name = find_best_matching_device_name(&actual_name, &names);
                    best_name.and_then(|target_n| {
                        candidate_list.into_iter().find(|(_, n)| n == target_n).map(|(d, _)| d)
                    })
                }
                Err(e) => {
                    eprintln!("[player] Could not list host devices: {}", e);
                    None
                }
            };
            (found_dev, true)
        } else {
            (None, false)
        };

        if dev.is_none() && tried_target {
            volume.store(0.0f32.to_bits(), Ordering::SeqCst);
            output_fallback_reason = Some("selected_device_unavailable".to_string());
            *safe_lock(&target_device) = None;
            target = None;
            let _ = app_handle.emit("ui-toast", serde_json::json!({
                "message": "Audio device disconnected. Falling back to default.",
                "type": "warning"
            }));
            let _ = app_handle.emit("audio-device-fallback", serde_json::json!({
                "fallback": true,
                "device": "[System Default Device]"
            }));
        }

        match dev.or_else(|| host.default_output_device()).or_else(|| cpal::default_host().default_output_device()) {
            Some(d) => d,
            None => {
                let _ = app_handle.emit("playback-error", serde_json::json!({
                    "path": path, "attempt_id": attempt_id.as_deref().unwrap_or(""),
                    "error": "No audio output device detected. Please connect headphones or speakers.",
                }));
                return (None, None);
            }
        }
    };

    let device_display_name = target.clone().unwrap_or_else(|| "Default Device".to_string());

    let is_bp_mode = is_exclusive && bit_perfect.load(Ordering::SeqCst);
    let (upsample_target, exclusive_timing, dither_enabled) = {
        let d = safe_lock(&dsp_state);
        let (u, dit) = resolve_hardware_upsample_and_dither(is_bp_mode, d.upsample_rate, d.dither);
        (u, d.exclusive_mode_timing.clone(), dit)
    };

    let is_exclusive_effective = is_exclusive;
    let target_name = target.clone();
    let can_reuse = if let Some(ref session) = existing_session {
        can_reuse_stream_session(
            &session.target_device,
            session.is_exclusive,
            session.sample_rate,
            session.channels,
            &target_name,
            is_exclusive_effective,
            file_rate,
            file_ch,
            upsample_target,
        )
    } else {
        false
    };

    let source_format_snapshot = AudioFormatSnapshot {
        sample_rate: file_rate as u32,
        channels: file_ch as u16,
        sample_format: source_sample_format,
        bits_per_sample: source_bits_per_sample,
        valid_bits_per_sample: source_bits_per_sample,
        channel_mask: source_channel_mask,
    };

    let (mut stream_info, mut output_bits, mut is_float, mut route, mut prod_opt, flush_signal) = if can_reuse {
        let session = existing_session.take().unwrap();
        if session.is_manual_change {
            session.flush_signal.store(true, Ordering::SeqCst);
            let flush_wait_start = std::time::Instant::now();
            while session.flush_signal.load(Ordering::SeqCst) && flush_wait_start.elapsed().as_millis() < 60 {
                std::thread::sleep(std::time::Duration::from_millis(1));
            }
            println!("[player-gapless] Reusing active audio stream session on manual skip; flushed old track audio at {}Hz.", session.sample_rate);
        } else {
            println!("[player-gapless] Reusing active audio stream session at {}Hz for next track.", session.sample_rate);
        }
        (
            Some((session.stream, session.config)),
            session.output_bits,
            session.is_float,
            session.route,
            Some(session.prod),
            session.flush_signal,
        )
    } else {
        drop(existing_session);
        (
            None,
            32,
            true,
            AudioRouteSnapshot::default(),
            None,
            Arc::new(AtomicBool::new(false)),
        )
    };
    route.source = source_format_snapshot.clone();

    if stream_info.is_none() {
        let stream_allows_exclusive = stream_allows_exclusive_mode(&resolved_path);
        let configs_to_try = select_output_config(
            &device,
            file_rate,
            file_ch,
            is_exclusive,
            is_stream,
            stream_allows_exclusive,
            upsample_target,
            &device_display_name,
        );

    // Determine if we should attempt EXCLUSIVE mode
    // (Only for local files and when Bit-Perfect/Upsampling is requested)
    let exclusive_failures = EXCLUSIVE_STREAM_FAILURES.load(Ordering::SeqCst);
    let exclusive_permitted = !is_stream || stream_allows_exclusive;
    let request_exclusive = is_exclusive_effective
        && exclusive_permitted
        && exclusive_failures < crate::wasapi_engine::MAX_EXCLUSIVE_FAILURES;

    if is_exclusive_effective && !exclusive_permitted {
        output_fallback_reason = Some("exclusive_unavailable_for_stream".to_string());
    } else if is_exclusive_effective && exclusive_permitted && !request_exclusive {
        output_fallback_reason = Some("exclusive_failure_budget_exhausted".to_string());
    }

    // Budget exhausted: stop hammering the driver and finish the track on the
    // shared engine instead of looping teardown/rebuild forever.
    if is_exclusive_effective && exclusive_permitted && !request_exclusive
        && !EXCLUSIVE_FALLBACK_NOTIFIED.swap(true, Ordering::SeqCst)
    {
        println!("[player] Exclusive Mode gave up after {} failed attempt(s) this track; staying on Shared Mode.", exclusive_failures);
        let _ = app_handle.emit("ui-toast", serde_json::json!({
            "message": "Exclusive Mode keeps failing on this device — staying in Shared Mode for this track.",
            "type": "warning"
        }));
    } else if request_exclusive && exclusive_failures > 0 {
        if let crate::wasapi_engine::ExclusiveRecovery::RetryAfterMs(delay_ms) =
            crate::wasapi_engine::decide_exclusive_recovery(exclusive_failures)
        {
            println!("[player] Retrying WASAPI Exclusive in {} ms ({} prior failure(s))...", delay_ms, exclusive_failures);
            std::thread::sleep(std::time::Duration::from_millis(delay_ms));
        }
    }

    let stream_paused = Arc::clone(&status);
    let stream_volume = Arc::clone(&volume);

    if request_exclusive && !device_display_name.starts_with("[ASIO]") {
        if let Some((config, _)) = configs_to_try.first() {
            let target_rate = resolve_exclusive_target_rate(file_rate, upsample_target);
            let target_channels = (file_ch.max(2)) as u16;
            let max_ring = (target_rate.max(192000) as usize) * (target_channels as usize) * 3;
            let rb = RingBuffer::<f32>::new(max_ring);
            let (mut prod, mut cons) = rb.split();

            // Pre-fill ringbuffer with 200ms of silence to guarantee startup stability and eliminate initial click
            let silence = vec![0.0f32; (target_rate.max(44100) as usize) * (target_channels as usize) / 5];
            let _ = prod.push_slice(&silence);

            let paused_cb = Arc::clone(&stream_paused);
            let volume_cb = Arc::clone(&stream_volume);
            let flush_cb = Arc::clone(&flush_signal);
            let bp_cb = Arc::clone(&bit_perfect);
            let audio_path_cb = Arc::clone(&effective_audio_path);

            let actual_dev_name = if device_display_name.starts_with("[WASAPI] ") {
                device_display_name.trim_start_matches("[WASAPI] ").to_string()
            } else {
                device_display_name.clone()
            };

            let cmd_tx_cb = cmd_tx.clone();
            let app_handle_cb = app_handle.clone();
            let mut current_gain = 0.0f32;
            if let Ok((wasapi_stream, wasapi_format)) = crate::wasapi_engine::start_exclusive_stream(
                &actual_dev_name,
                target_rate,
                target_channels,
                &exclusive_timing,
                Arc::clone(&stream_paused),
                Arc::clone(&flush_signal),
                dither_enabled,
                move |data: &mut [f32]| {
                    if silence_while_arming(STOP_ARMING.load(Ordering::SeqCst), data) { return; }
                    let ch_count = target_channels as usize;
                    if flush_cb.swap(false, Ordering::SeqCst) {
                        let l = cons.len();
                        let frames = l / ch_count;
                        cons.discard(frames * ch_count);
                    }

                    let paused = paused_cb.load(Ordering::Relaxed) != 1;
                    let is_bp = bp_cb.load(Ordering::Relaxed);
                    let user_vol = f32::from_bits(volume_cb.load(Ordering::Relaxed));
                    let target_gain = resolve_stream_volume(is_bp, paused, user_vol);

                    if current_gain == 0.0 && target_gain == 0.0 {
                        if !paused {
                            let frames = cons.len() / ch_count;
                            cons.discard(frames.min(data.len() / ch_count) * ch_count);
                        }
                        data.fill(0.0);
                        audio_path_cb.meter.record(std::iter::once(0.0));
                        return;
                    }

                    let mut n = cons.pop_slice(data);
                    if n < data.len() {
                        n += cons.pop_slice(&mut data[n..]);
                    }
                    if n < data.len() {
                        audio_path_cb.record_underrun();
                    }

                    let frames_count = data.len() / ch_count;
                    let fade_step = 1.0 / 256.0;

                    for f in 0..frames_count {
                        if current_gain < target_gain {
                            current_gain = (current_gain + fade_step).min(target_gain);
                        } else if current_gain > target_gain {
                            current_gain = (current_gain - fade_step).max(target_gain);
                        }

                        for ch in 0..ch_count {
                            let idx = f * ch_count + ch;
                            if idx < n {
                                if !is_bp || current_gain != 1.0 {
                                    data[idx] *= current_gain;
                                }
                            } else {
                                data[idx] = 0.0;
                            }
                        }
                    }
                    audio_path_cb.meter.record(data.iter().copied());
                },
                move |err| {
                    EXCLUSIVE_STREAM_FAILURES.fetch_add(1, Ordering::SeqCst);
                    eprintln!("[player] WASAPI Exclusive stream error: {err}");
                    let _ = app_handle_cb.emit("ui-toast", serde_json::json!({
                        "message": format!("Exclusive device error: {}. Recovering...", err),
                        "type": "error"
                    }));
                    let _ = cmd_tx_cb.send(PlayerCommand::RestartStream);
                }
            ) {
                println!("[player] Successfully locked TRUE WASAPI Exclusive Mode at {}Hz ({} valid bits)!", wasapi_format.sample_rate, wasapi_format.valid_bits);
                let _ = app_handle.emit("playback-success", format!("WASAPI Exclusive Mode Active ({}Hz)", wasapi_format.sample_rate));
                let mut exclusive_cfg = config.clone();
                exclusive_cfg.sample_rate = wasapi_format.sample_rate;
                exclusive_cfg.channels = wasapi_format.channels;
                stream_info = Some((ActiveStream::Wasapi(wasapi_stream), exclusive_cfg));
                prod_opt = Some(prod);
                output_bits = wasapi_format.valid_bits as usize;
                is_float = wasapi_format.is_float;
                let output_sample_format = if wasapi_format.is_float {
                    "pcm_f32".to_string()
                } else if wasapi_format.container_bits == 32 && wasapi_format.valid_bits == 24 {
                    "pcm_s24_in_32".to_string()
                } else {
                    format!("pcm_s{}", wasapi_format.valid_bits)
                };
                let bit_perfect_verified = is_bp_mode && !dither_enabled;
                route = AudioRouteSnapshot {
                    active: true,
                    engine: "wasapi".to_string(),
                    share_mode: "exclusive".to_string(),
                    source: source_format_snapshot.clone(),
                    pipeline_sample_format: "f32_planar".to_string(),
                    output: AudioFormatSnapshot {
                        sample_rate: wasapi_format.sample_rate,
                        channels: wasapi_format.channels,
                        sample_format: Some(output_sample_format),
                        bits_per_sample: Some(wasapi_format.container_bits),
                        valid_bits_per_sample: Some(wasapi_format.valid_bits),
                        channel_mask: wasapi_format.channel_mask,
                    },
                    fallback_reason: None,
                    gain_ramp: !bit_perfect_verified,
                    volume_bypass_in_bit_perfect: true,
                    dither_enabled,
                    sample_integrity_verified: bit_perfect_verified,
                };
            } else {
                EXCLUSIVE_STREAM_FAILURES.fetch_add(1, Ordering::SeqCst);
                output_fallback_reason = Some("wasapi_exclusive_unavailable".to_string());
                println!("[player] TRUE WASAPI Exclusive Mode failed. Falling back to CPAL Shared Mode.");
                // Keep the user's Exclusive preference ON — only this session falls
                // back to shared mode, so the next track/rebuild retries exclusive.
                let _ = app_handle.emit("ui-toast", serde_json::json!({
                    "message": "Exclusive Mode not supported on this device — playing in Shared Mode (preference stays ON).",
                    "type": "warning"
                }));
            }
        }
    }

    if stream_info.is_none() {
        for (config, sample_format) in configs_to_try {
        let paused_cb = Arc::clone(&stream_paused);
        let volume_cb = Arc::clone(&stream_volume);
        let flush_cb = Arc::clone(&flush_signal);
        let bp_cb = Arc::clone(&bit_perfect);
        let audio_path_cb = Arc::clone(&effective_audio_path);

        // Compute max ring size (3 seconds of audio at target rate)
        let rate = config.sample_rate as usize;
        let channels = config.channels as usize;
        let max_ring = rate * channels * 3;

        let rb = RingBuffer::<f32>::new(max_ring);
        let (mut prod, mut cons) = rb.split();

        let config_inner = config.clone();

        let mut buf = vec![0.0f32; 8192];

        // 🛡️ TRUTH: For strict ASIO drivers, we must match the hardware's expected format exactly.
        let stream_res = match sample_format {
            cpal::SampleFormat::F32 => {
                let cmd_tx_cb = cmd_tx.clone();
                let app_handle_cb = app_handle.clone();
                let mut current_gain = 0.0f32;
                let ch_count = config_inner.channels as usize;
                let bp_cb_f32 = Arc::clone(&bp_cb);
                let underruns_cb = Arc::clone(&audio_path_cb);
                device.build_output_stream(
                    &config_inner,
                    move |data: &mut [f32], _| {
                    if silence_while_arming(STOP_ARMING.load(Ordering::SeqCst), data) { return; }
                        #[cfg(target_os = "windows")]
                        {
                            thread_local! {
                                static MMCSS_HANDLE: std::cell::RefCell<Option<windows::Win32::Foundation::HANDLE>> = std::cell::RefCell::new(None);
                            }
                            MMCSS_HANDLE.with(|cell| {
                                if cell.borrow().is_none() {
                                    let mut task_index = 0u32;
                                    unsafe {
                                        if let Ok(h) = windows::Win32::System::Threading::AvSetMmThreadCharacteristicsW(
                                            windows::core::w!("Pro Audio"),
                                            &mut task_index,
                                        ) {
                                            *cell.borrow_mut() = Some(h);
                                        }
                                    }
                                }
                            });
                        }
                        if flush_cb.swap(false, Ordering::SeqCst) {
                            let l = cons.len();
                            let frames = l / ch_count;
                            cons.discard(frames * ch_count);
                        }

                        let paused = paused_cb.load(Ordering::Relaxed) != 1;
                        let is_bp = bp_cb_f32.load(Ordering::Relaxed);
                        let user_vol = f32::from_bits(volume_cb.load(Ordering::Relaxed));
                        let target_gain = resolve_stream_volume(is_bp, paused, user_vol);

                        if current_gain == 0.0 && target_gain == 0.0 {
                            data.fill(0.0);
                            underruns_cb.meter.record(std::iter::once(0.0));
                            return;
                        }

                        let mut n = cons.pop_slice(data);
                        if n < data.len() {
                            n += cons.pop_slice(&mut data[n..]);
                        }
                        if n < data.len() {
                            underruns_cb.record_underrun();
                        }

                        let frames_count = data.len() / ch_count;
                        let fade_step = 1.0 / 256.0;

                        for f in 0..frames_count {
                            if current_gain < target_gain {
                                current_gain = (current_gain + fade_step).min(target_gain);
                            } else if current_gain > target_gain {
                                current_gain = (current_gain - fade_step).max(target_gain);
                            }

                            for ch in 0..ch_count {
                                let idx = f * ch_count + ch;
                                if idx < n {
                                    let s = if !is_bp || current_gain != 1.0 {
                                        (data[idx] * current_gain).clamp(-1.0, 1.0)
                                    } else {
                                        data[idx]
                                    };
                                    data[idx] = s;
                                } else {
                                    data[idx] = 0.0;
                                }
                            }
                        }
                        underruns_cb.meter.record(data.iter().copied());
                    },
                    move |e| {
                        eprintln!("[player] stream error: {e}");
                        let _ = app_handle_cb.emit("ui-toast", serde_json::json!({
                            "message": format!("Audio device error: {}. Recovering...", e),
                            "type": "error"
                        }));
                        let _ = cmd_tx_cb.send(PlayerCommand::RestartStream);
                    },
                    None,
                )
            },
            cpal::SampleFormat::I16 => {
                let cmd_tx_cb = cmd_tx.clone();
                let app_handle_cb = app_handle.clone();
                let mut current_gain = 0.0f32;
                let ch_count = config_inner.channels as usize;
                let bp_cb_i16 = Arc::clone(&bp_cb);
                let underruns_cb = Arc::clone(&audio_path_cb);
                device.build_output_stream(
                    &config_inner,
                    move |data: &mut [i16], _| {
                    if silence_while_arming(STOP_ARMING.load(Ordering::SeqCst), data) { return; }
                        thread_local! {
                            static MMCSS_INITIALIZED: std::cell::Cell<bool> = std::cell::Cell::new(false);
                        }
                        MMCSS_INITIALIZED.with(|initialized| {
                            if !initialized.get() {
                                let mut task_index = 0u32;
                                unsafe {
                                    let _ = windows::Win32::System::Threading::AvSetMmThreadCharacteristicsW(
                                        windows::core::w!("Pro Audio"),
                                        &mut task_index,
                                    );
                                }
                                initialized.set(true);
                            }
                        });
                        if flush_cb.swap(false, Ordering::SeqCst) {
                            let l = cons.len();
                            let frames = l / ch_count;
                            cons.discard(frames * ch_count);
                        }

                        let paused = paused_cb.load(Ordering::Relaxed) != 1;
                        let is_bp = bp_cb_i16.load(Ordering::Relaxed);
                        let user_vol = f32::from_bits(volume_cb.load(Ordering::Relaxed));
                        let target_gain = resolve_stream_volume(is_bp, paused, user_vol);

                        if current_gain == 0.0 && target_gain == 0.0 {
                            data.fill(0);
                            underruns_cb.meter.record(std::iter::once(0.0));
                            return;
                        }

                        if buf.len() < data.len() { buf.resize(data.len(), 0.0); }
                        let mut n = cons.pop_slice(&mut buf[..data.len()]);
                        if n < data.len() {
                            n += cons.pop_slice(&mut buf[n..data.len()]);
                        }
                        if n < data.len() {
                            underruns_cb.record_underrun();
                        }

                        let frames_count = data.len() / ch_count;
                        let fade_step = 1.0 / 256.0;

                        for f in 0..frames_count {
                            if current_gain < target_gain {
                                current_gain = (current_gain + fade_step).min(target_gain);
                            } else if current_gain > target_gain {
                                current_gain = (current_gain - fade_step).max(target_gain);
                            }

                            for ch in 0..ch_count {
                                let idx = f * ch_count + ch;
                                if idx < n {
                                    let s = if !is_bp || current_gain != 1.0 {
                                        buf[idx] * current_gain
                                    } else {
                                        buf[idx]
                                    };
                                    let clamped = s.clamp(-1.0, 1.0);
                                    let multiplier = 32767.0; // i16::MAX
                                    let val = if dither_enabled && !is_bp {
                                        let r1 = rand::random::<f32>() - 0.5;
                                        let r2 = rand::random::<f32>() - 0.5;
                                        clamped * multiplier + r1 + r2
                                    } else {
                                        clamped * multiplier
                                    };
                                    data[idx] = val.clamp(-multiplier, multiplier).round() as i16;
                                } else {
                                    data[idx] = 0;
                                }
                            }
                        }
                        underruns_cb.meter.record(data.iter().map(|&sample| sample as f32 / 32768.0));
                    },
                    move |e| {
                        eprintln!("[player] stream error: {e}");
                        let _ = app_handle_cb.emit("ui-toast", serde_json::json!({
                            "message": format!("Audio device error: {}. Recovering...", e),
                            "type": "error"
                        }));
                        let _ = cmd_tx_cb.send(PlayerCommand::RestartStream);
                    },
                    None,
                )
            },
            _ => {
                let cmd_tx_cb = cmd_tx.clone();
                let app_handle_cb = app_handle.clone();
                let mut current_gain = 0.0f32;
                let ch_count = config_inner.channels as usize;
                let underruns_cb = Arc::clone(&audio_path_cb);
                device.build_output_stream(
                    &config_inner,
                    move |data: &mut [i32], _| {
                    if silence_while_arming(STOP_ARMING.load(Ordering::SeqCst), data) { return; }
                        thread_local! {
                            static MMCSS_INITIALIZED: std::cell::Cell<bool> = std::cell::Cell::new(false);
                        }
                        MMCSS_INITIALIZED.with(|initialized| {
                            if !initialized.get() {
                                let mut task_index = 0u32;
                                unsafe {
                                    let _ = windows::Win32::System::Threading::AvSetMmThreadCharacteristicsW(
                                        windows::core::w!("Pro Audio"),
                                        &mut task_index,
                                    );
                                }
                                initialized.set(true);
                            }
                        });
                        if flush_cb.swap(false, Ordering::SeqCst) {
                            let l = cons.len();
                            let frames = l / ch_count;
                            cons.discard(frames * ch_count);
                        }

                        let paused = paused_cb.load(Ordering::Relaxed) != 1;
                        let vol = f32::from_bits(volume_cb.load(Ordering::Relaxed));
                        let target_gain = if paused { 0.0 } else { vol };

                        if current_gain == 0.0 && target_gain == 0.0 {
                            data.fill(0);
                            underruns_cb.meter.record(std::iter::once(0.0));
                            return;
                        }

                        if buf.len() < data.len() { buf.resize(data.len(), 0.0); }
                        let mut n = cons.pop_slice(&mut buf[..data.len()]);
                        if n < data.len() {
                            n += cons.pop_slice(&mut buf[n..data.len()]);
                        }
                        if n < data.len() {
                            underruns_cb.record_underrun();
                        }

                        let frames_count = data.len() / ch_count;
                        let fade_step = 1.0 / 256.0;

                        for f in 0..frames_count {
                            if current_gain < target_gain {
                                current_gain = (current_gain + fade_step).min(target_gain);
                            } else if current_gain > target_gain {
                                current_gain = (current_gain - fade_step).max(target_gain);
                            }

                            for ch in 0..ch_count {
                                let idx = f * ch_count + ch;
                                if idx < n {
                                    let s = buf[idx] * current_gain;
                                    let clamped = s.clamp(-1.0, 1.0);
                                    let multiplier = 2147483647.0; // i32::MAX
                                    let val = if dither_enabled {
                                        let r1 = rand::random::<f32>() - 0.5;
                                        let r2 = rand::random::<f32>() - 0.5;
                                        clamped * multiplier + r1 + r2
                                    } else {
                                        clamped * multiplier
                                    };
                                    data[idx] = val.clamp(-multiplier, multiplier).round() as i32;
                                } else {
                                    data[idx] = 0;
                                }
                            }
                        }
                        underruns_cb.meter.record(data.iter().map(|&sample| sample as f32 / 2147483648.0));
                    },
                    move |e| {
                        eprintln!("[player] stream error: {e}");
                        let _ = app_handle_cb.emit("ui-toast", serde_json::json!({
                            "message": format!("Audio device error: {}. Recovering...", e),
                            "type": "error"
                        }));
                        let _ = cmd_tx_cb.send(PlayerCommand::RestartStream);
                    },
                    None,
                )
            },
        };

        if let Ok(s) = stream_res {
            // Pre-fill ringbuffer with 200ms of silence to guarantee absolute startup stability and shield from DPC latency spikes
            let silence = vec![0.0f32; rate * channels / 5];
            let _ = prod.push_slice(&silence);

            let _ = s.play();
            if request_exclusive {
                println!("[player] AUDIOPHILE: Shared fallback stream established (exclusive unavailable).");
            } else {
                println!("[player] AUDIOPHILE: Shared stream established.");
            }
            println!("         -> Host: {:?}", host.id());
            println!("         -> Rate: {}Hz", config.sample_rate);
            stream_info = Some((ActiveStream::Cpal(s), config.clone()));
            prod_opt = Some(prod);
            match sample_format {
                cpal::SampleFormat::F32 => {
                    output_bits = 32;
                    is_float = true;
                }
                cpal::SampleFormat::I16 => {
                    output_bits = 16;
                    is_float = false;
                }
                _ => {
                    output_bits = 32;
                    is_float = false;
                }
            }
            let (output_sample_format, container_bits, _) = describe_cpal_sample_format(sample_format);
            let bit_perfect_verified = is_bp_mode && !dither_enabled && is_asio_host;
            route = AudioRouteSnapshot {
                active: true,
                engine: if is_asio_host { "asio" } else { "cpal" }.to_string(),
                share_mode: if is_asio_host { "direct" } else { "shared" }.to_string(),
                source: source_format_snapshot.clone(),
                pipeline_sample_format: "f32_planar".to_string(),
                output: AudioFormatSnapshot {
                    sample_rate: config.sample_rate,
                    channels: config.channels,
                    sample_format: Some(output_sample_format),
                    bits_per_sample: (container_bits > 0).then_some(container_bits as u16),
                    valid_bits_per_sample: (container_bits > 0).then_some(container_bits as u16),
                    channel_mask: None,
                },
                fallback_reason: output_fallback_reason.clone(),
                gain_ramp: !bit_perfect_verified,
                volume_bypass_in_bit_perfect: matches!(sample_format, cpal::SampleFormat::F32 | cpal::SampleFormat::I16),
                dither_enabled,
                sample_integrity_verified: bit_perfect_verified,
            };
            break;
        } else if let Err(e) = stream_res {
            eprintln!("[player] Could not establish output stream: {}.", e);
            if let Ok(supported) = device.supported_output_configs() {
                println!("[player] Probing device capabilities for \"{}\":", device_display_name);
                for (idx, c) in supported.enumerate() {
                    println!("         -> Config {}: {:?} ({}Hz - {}Hz)", idx, c.sample_format(), c.min_sample_rate(), c.max_sample_rate());
                }
            }
            println!("[player] Trying next config...");
        }
    }
    }

    if stream_info.is_none() {
        let msg = format!("Device \"{}\" failed. Falling back to System Default.", device_display_name);
        println!("[player] CRITICAL: {}", msg);
        let _ = app_handle.emit("ui-toast", serde_json::json!({ "message": msg, "type": "warning" }));
        output_fallback_reason = Some("system_default_fallback".to_string());

        // EMERGENCY FALLBACK: Try Default Host and Default Device
        let host = cpal::default_host();
        if let Some(dev) = host.default_output_device() {
            if let Ok(def_cfg) = dev.default_output_config() {
                let cfg = def_cfg.config();
                let fmt = def_cfg.sample_format();
                let paused_cb = Arc::clone(&stream_paused);
                let volume_cb = Arc::clone(&stream_volume);
                let flush_cb = Arc::clone(&flush_signal);
                let audio_path_cb = Arc::clone(&effective_audio_path);
                let rb = RingBuffer::<f32>::new(cfg.sample_rate as usize * cfg.channels as usize * 3);
                let (mut prod, mut cons) = rb.split();

                let mut buf = vec![0.0f32; 8192];
                let stream_res = match fmt {
                    cpal::SampleFormat::F32 => {
                        let cmd_tx_cb = cmd_tx.clone();
                        let app_handle_cb = app_handle.clone();
                        let mut current_gain = 0.0f32;
                        let ch_count = cfg.channels as usize;
                        let underruns_cb = Arc::clone(&audio_path_cb);
                        dev.build_output_stream(&cfg, move |d: &mut [f32], _| {
                            thread_local! {
                                static MMCSS_INITIALIZED: std::cell::Cell<bool> = std::cell::Cell::new(false);
                            }
                            MMCSS_INITIALIZED.with(|initialized| {
                                if !initialized.get() {
                                    let mut task_index = 0u32;
                                    unsafe {
                                        let _ = windows::Win32::System::Threading::AvSetMmThreadCharacteristicsW(
                                            windows::core::w!("Pro Audio"),
                                            &mut task_index,
                                        );
                                    }
                                    initialized.set(true);
                                }
                            });
                            if flush_cb.swap(false, Ordering::SeqCst) {
                                let l = cons.len();
                                let frames = l / ch_count;
                                cons.discard(frames * ch_count);
                            }

                            let paused = paused_cb.load(Ordering::Relaxed) != 1;
                            let vol = f32::from_bits(volume_cb.load(Ordering::Relaxed));
                            let target_gain = if paused { 0.0 } else { vol };

                            if current_gain == 0.0 && target_gain == 0.0 {
                                d.fill(0.0);
                                underruns_cb.meter.record(std::iter::once(0.0));
                                return;
                            }

                            let mut n = cons.pop_slice(d);
                            if n < d.len() {
                                n += cons.pop_slice(&mut d[n..]);
                            }
                            if n < d.len() {
                                underruns_cb.record_underrun();
                            }

                            let frames_count = d.len() / ch_count;
                            let fade_step = 1.0 / 256.0;

                            for f in 0..frames_count {
                                if current_gain < target_gain {
                                    current_gain = (current_gain + fade_step).min(target_gain);
                                } else if current_gain > target_gain {
                                    current_gain = (current_gain - fade_step).max(target_gain);
                                }

                                for ch in 0..ch_count {
                                    let idx = f * ch_count + ch;
                                    if idx < n {
                                        d[idx] *= current_gain;
                                    } else {
                                        d[idx] = 0.0;
                                    }
                                }
                            }
                            underruns_cb.meter.record(d.iter().copied());
                        }, move |e| {
                            eprintln!("[player] emergency stream error: {e}");
                            let _ = app_handle_cb.emit("ui-toast", serde_json::json!({
                                "message": format!("Emergency audio error: {}. Recovering...", e),
                                "type": "error"
                            }));
                            let _ = cmd_tx_cb.send(PlayerCommand::RestartStream);
                        }, None)
                    },
                    _ => {
                        let cmd_tx_cb = cmd_tx.clone();
                        let app_handle_cb = app_handle.clone();
                        let mut current_gain = 0.0f32;
                        let ch_count = cfg.channels as usize;
                        let underruns_cb = Arc::clone(&audio_path_cb);
                        dev.build_output_stream(&cfg, move |d: &mut [i16], _| {
                            thread_local! {
                                static MMCSS_INITIALIZED: std::cell::Cell<bool> = std::cell::Cell::new(false);
                            }
                            MMCSS_INITIALIZED.with(|initialized| {
                                if !initialized.get() {
                                    let mut task_index = 0u32;
                                    unsafe {
                                        let _ = windows::Win32::System::Threading::AvSetMmThreadCharacteristicsW(
                                            windows::core::w!("Pro Audio"),
                                            &mut task_index,
                                        );
                                    }
                                    initialized.set(true);
                                }
                            });
                            if flush_cb.swap(false, Ordering::SeqCst) {
                                let l = cons.len();
                                let frames = l / ch_count;
                                cons.discard(frames * ch_count);
                            }

                            let paused = paused_cb.load(Ordering::Relaxed) != 1;
                            let vol = f32::from_bits(volume_cb.load(Ordering::Relaxed));
                            let target_gain = if paused { 0.0 } else { vol };

                            if current_gain == 0.0 && target_gain == 0.0 {
                                d.fill(0);
                                underruns_cb.meter.record(std::iter::once(0.0));
                                return;
                            }

                            if buf.len() < d.len() { buf.resize(d.len(), 0.0); }
                            let mut n = cons.pop_slice(&mut buf[..d.len()]);
                            if n < d.len() {
                                n += cons.pop_slice(&mut buf[n..d.len()]);
                            }
                            if n < d.len() {
                                underruns_cb.record_underrun();
                            }

                            let frames_count = d.len() / ch_count;
                            let fade_step = 1.0 / 256.0;

                            for f in 0..frames_count {
                                if current_gain < target_gain {
                                    current_gain = (current_gain + fade_step).min(target_gain);
                                } else if current_gain > target_gain {
                                    current_gain = (current_gain - fade_step).max(target_gain);
                                }

                                for ch in 0..ch_count {
                                    let idx = f * ch_count + ch;
                                    if idx < n {
                                        let clamped = (buf[idx] * current_gain).clamp(-1.0, 1.0);
                                        let multiplier = 32767.0; // i16::MAX
                                        let val = if dither_enabled {
                                            let r1 = rand::random::<f32>() - 0.5;
                                            let r2 = rand::random::<f32>() - 0.5;
                                            clamped * multiplier + r1 + r2
                                        } else {
                                            clamped * multiplier
                                        };
                                        d[idx] = val.clamp(-multiplier, multiplier).round() as i16;
                                    } else {
                                        d[idx] = 0;
                                    }
                                }
                            }
                            underruns_cb.meter.record(d.iter().map(|&sample| sample as f32 / 32768.0));
                        }, move |e| {
                            eprintln!("[player] emergency stream error: {e}");
                            let _ = app_handle_cb.emit("ui-toast", serde_json::json!({
                                "message": format!("Emergency audio error: {}. Recovering...", e),
                                "type": "error"
                            }));
                            let _ = cmd_tx_cb.send(PlayerCommand::RestartStream);
                        }, None)
                    },
                };

                if let Ok(s) = stream_res {
                    // Pre-fill fallback ringbuffer with 200ms of silence
                    let silence = vec![0.0f32; cfg.sample_rate as usize * cfg.channels as usize / 5];
                    let _ = prod.push_slice(&silence);

                    let _ = s.play();
                    match fmt {
                        cpal::SampleFormat::F32 => {
                            output_bits = 32;
                            is_float = true;
                        }
                        cpal::SampleFormat::I16 => {
                            output_bits = 16;
                            is_float = false;
                        }
                        _ => {
                            output_bits = 32;
                            is_float = false;
                        }
                    }
                    let (output_sample_format, container_bits, _) = describe_cpal_sample_format(fmt);
                    route = AudioRouteSnapshot {
                        active: true,
                        engine: "cpal".to_string(),
                        share_mode: "shared".to_string(),
                        source: source_format_snapshot.clone(),
                        pipeline_sample_format: "f32_planar".to_string(),
                        output: AudioFormatSnapshot {
                            sample_rate: cfg.sample_rate,
                            channels: cfg.channels,
                            sample_format: Some(output_sample_format),
                            bits_per_sample: (container_bits > 0).then_some(container_bits as u16),
                            valid_bits_per_sample: (container_bits > 0).then_some(container_bits as u16),
                            channel_mask: None,
                        },
                        fallback_reason: output_fallback_reason.clone(),
                        gain_ramp: true,
                        volume_bypass_in_bit_perfect: false,
                        dither_enabled,
                        sample_integrity_verified: false,
                    };
                    stream_info = Some((ActiveStream::Cpal(s), cfg));
                    prod_opt = Some(prod);
                }
            }
        }
    }
    }

    let (stream, config) = match stream_info {
        Some(i) => i,
        None => {
            let _ = app_handle.emit("playback-error", serde_json::json!({
                "path": path, "attempt_id": attempt_id.as_deref().unwrap_or(""),
                "error": "Total audio system failure. Please restart app.",
            }));
            return (None, None);
        }
    };

    let mut prod = prod_opt.unwrap();

    let dev_rate = config.sample_rate as usize;
    let dev_ch   = config.channels as usize;
    let use_ch   = file_ch.min(dev_ch);

    route.active = true;
    route.source = source_format_snapshot;
    route.output.sample_rate = dev_rate as u32;
    route.output.channels = dev_ch as u16;
    effective_audio_path.set_route(route.clone());

    // This is the configured rate; WASAPI logs submitted frame cadence separately.
    current_dev_rate.store(dev_rate as u32, Ordering::Relaxed);

    if is_bp_mode && dev_rate != file_rate {
        println!("[player] Bit-Perfect Notice: Device running at {}Hz while file is {}Hz (resampling required)", dev_rate, file_rate);
        let _ = app_handle.emit("ui-toast", serde_json::json!({
            "message": format!("Audio device does not support native {}Hz for Bit-Perfect. Resampling to {}Hz.", file_rate, dev_rate),
            "type": "warning"
        }));
    }

    let chunk_size = 1024usize;

    let mut current_dsp = safe_lock(&dsp_state).clone();
    crate::log_info!(
        "AUDIO",
        "Output route: attempt={:?} engine={} share_mode={} source={}Hz output={}Hz playback_rate={:.3} resample_ratio={:.6} requested_bit_perfect={} fallback={:?}",
        attempt_id, route.engine, route.share_mode, file_rate, dev_rate,
        current_dsp.playback_rate,
        if is_bp_mode && file_rate == dev_rate && file_ch == dev_ch {
            1.0
        } else {
            dev_rate as f64 / file_rate as f64 / current_dsp.playback_rate.clamp(0.5, 2.0)
        },
        is_bp_mode, route.fallback_reason,
    );

    // Create persistent DSP filter and delay line instances
    let mut nodes: Vec<Box<dyn AudioNode + Send>> = vec![
        Box::new(PreampNode::new()),
        Box::new(SaturationNode::new()),
        Box::new(PhaseResponseNode::new()),
        Box::new(EqNode::new()),
        Box::new(AideoFilterNode::new()),
        Box::new(SubsonicNode::new()),
        Box::new(CrossfeedNode::new()),
        Box::new(SpatializerNode::new()),
        Box::new(ConvolutionNode::new()),
        Box::new(WidthNode::new()),
        Box::new(CompressorNode::new()),
        Box::new(NormalizerNode::new()),
        Box::new(LimiterNode::new(use_ch, 2.0, dev_rate as f32)),
    ];

    for node in &mut nodes {
        node.update_params(&current_dsp, dev_rate as f32);
    }

    let mut last_calculated_rate = dev_rate;
    let mut last_dsp_params: Option<DSPState> = Some(current_dsp.clone());
    let mut fft_buffer = Vec::with_capacity(2048);

    let sinc_len = current_dsp.resampler_sinc_len as usize;
    let oversampling = current_dsp.resampler_oversampling as usize;
    let interp_type = match current_dsp.resampler_interpolation.as_str() {
        "linear" => SincInterpolationType::Linear,
        _ => SincInterpolationType::Cubic,
    };
    let f_cutoff = if sinc_len <= 64 { 0.96f32 } else { 0.985f32 };

    println!("[player] Initializing resampler with dynamic settings (sinc_len: {}, f_cutoff: {}, interpolation: {:?}, oversampling: {})",
             sinc_len, f_cutoff, interp_type, oversampling);

    let mut resampler = match SincFixedIn::<f32>::new(
        dev_rate as f64 / file_rate as f64,
        2.0,
        SincInterpolationParameters {
            sinc_len,
            f_cutoff,
            interpolation: interp_type,
            oversampling_factor: oversampling,
            window: WindowFunction::BlackmanHarris2,
        },
        chunk_size,
        file_ch
    ) {
        Ok(r) => r,
        Err(e) => {
            let msg = format!("Resampler error: {}. Hardware rate {}Hz might be incompatible.", e, dev_rate);
            eprintln!("[player] {}", msg);
            let _ = app_handle.emit("playback-error", serde_json::json!({
                "path": path, "attempt_id": attempt_id.as_deref().unwrap_or(""), "error": msg,
            }));
            return (None, None);
        }
    };
    let mut last_resample_ratio = 1.0f64;

    let mut pending: Vec<VecDeque<f32>> = vec![VecDeque::new(); file_ch];
    let mut running = true;
    let mut is_restart_stream = false;
    let mut next_track_info: Option<(String, f64, Option<String>)> = None;
    let mut playback_ready_emitted = false;
    let last_exclusive = is_exclusive;
    let bp_now = bit_perfect.load(Ordering::Relaxed);
    let last_bit_perfect = bp_now;
    let last_upsample_rate = upsample_target;
    let last_interpolation = current_dsp.resampler_interpolation.clone();
    let last_sinc_len = current_dsp.resampler_sinc_len;
    let last_oversampling = current_dsp.resampler_oversampling;
    let last_ffmpeg_quality = current_dsp.ffmpeg_transcode_quality.clone();
    let last_exclusive_timing = current_dsp.exclusive_mode_timing.clone();
    let is_stream = resolved_path.starts_with("http://") || resolved_path.starts_with("https://");
    let mut stream_eof = false;
    let mut eof_pending_frames = None::<usize>;
    let mut output_timeline = ResamplerOutputTimeline::default();
    let mut eof_draining = false;
    let mut eof_drained = false;
    let mut crossfade_handoff = false;

    // RAM BUFFER CURSOR
    let mut ram_cursor = if let Some(samples_arc) = &decoded_samples {
        let lock = safe_lock(samples_arc);
        ram_seek_cursor(
            start_pos,
            file_rate,
            lock[0].len(),
            is_complete.as_ref().map(|c| c.load(Ordering::SeqCst)).unwrap_or(true),
        )
    } else {
        (start_pos * file_rate as f64) as usize
    };

    // Crossfade State Variables
    let mut next_child_process = Arc::new(Mutex::new(None::<std::process::Child>));
    let mut next_track_path: Option<String> = None;
    let mut next_decoder_rx: Option<std::sync::mpsc::Receiver<Result<DecoderInfo, String>>> = None;
    let mut next_decoder_info: Option<DecoderInfo> = None;
    let mut next_resampler: Option<SincFixedIn<f32>> = None;
    let mut next_pending: Vec<VecDeque<f32>> = Vec::new();
    let mut next_output: Vec<VecDeque<f32>> = Vec::new();
    let mut next_resample_ratio = 1.0f64;
    let mut crossfade_frame_counter = 0usize;
    let mut crossfade_triggered = false;
    let mut next_reservation: Option<CrossfadeReservation> = None;
    let mut fade_frames = 0usize;
    let mut crossfade_loudness_scales: (f32, f32) = (1.0, 1.0);

    while running {
        loop {
            match rx.try_recv() {
                Ok(PlayerCommand::Stop) => {
                    abort_background_downloads();
                    abort_inactive_stream_downloads(None);
                    kill_current_process(&next_child_process);
                    let _ = app_handle.emit("playback-cancelled", serde_json::json!({
                        "attempt_id": attempt_id.as_deref().unwrap_or(""),
                        "path": path,
                    }));
                    running = false;
                    break;
                }
                Ok(PlayerCommand::Pause) => { status.store(2, Ordering::Relaxed); }
                Ok(PlayerCommand::Resume) => { status.store(1, Ordering::Relaxed); }
                Ok(PlayerCommand::Play(p, pos, a_id)) => {
                    abort_background_downloads();
                    abort_inactive_stream_downloads(Some(&p));
                    kill_current_process(&next_child_process);
                    let _ = app_handle.emit("playback-cancelled", serde_json::json!({
                        "attempt_id": attempt_id.as_deref().unwrap_or(""),
                        "path": path,
                    }));
                    running = false;
                    next_track_info = Some((p, pos, a_id));
                    is_manual_change = true;
                    flush_signal.store(true, Ordering::SeqCst);
                    pending.iter_mut().for_each(|ch| ch.clear());
                    break;
                }
                Ok(PlayerCommand::Seek(secs)) => {
                    // Reset crossfade transition states to prevent stale next-track bleed
                    cancel_crossfade_handoff(&mut next_reservation, &mut crossfade_handoff, &mut next_track_info);
                    kill_current_process(&next_child_process);
                    crossfade_frame_counter = 0;
                    crossfade_triggered = false;
                    crossfade_loudness_scales = (1.0, 1.0);
                    next_track_path = None;
                    next_decoder_rx = None;
                    next_decoder_info = None;
                    next_resampler = None;
                    next_pending.iter_mut().for_each(|ch| ch.clear());
                    resampler.reset();
                    last_resample_ratio = 1.0;
                    stream_eof = false;
                    eof_pending_frames = None;
                    output_timeline = ResamplerOutputTimeline::default();
                    eof_draining = false;
                    eof_drained = false;
                    next_output.iter_mut().for_each(VecDeque::clear);
                    next_resample_ratio = 1.0;

                    if let Some(samples_arc) = &decoded_samples {
                        let lock = safe_lock(samples_arc);
                        ram_cursor = ram_seek_cursor(
                            secs, file_rate, lock[0].len(),
                            is_complete.as_ref().map(|c| c.load(Ordering::SeqCst)).unwrap_or(true),
                        );
                        position_secs.store(secs.to_bits(), Ordering::Relaxed);
                        flush_signal.store(true, Ordering::SeqCst);
                        pending.iter_mut().for_each(|ch| ch.clear());
                        let flush_wait = std::time::Instant::now();
                        while flush_signal.load(Ordering::SeqCst) && flush_wait.elapsed().as_millis() < 60 {
                            std::thread::sleep(std::time::Duration::from_millis(1));
                        }
                    } else if !is_stream {
                        if let Some(tb) = time_base {
                            let seek_ts = (secs * tb.denom as f64 / tb.numer as f64) as u64;
                            let _ = format.seek(SeekMode::Accurate, SeekTo::TimeStamp { ts: seek_ts, track_id });
                        }
                        decoder.reset();
                        ram_cursor = (secs * file_rate as f64) as usize;
                        position_secs.store(secs.to_bits(), Ordering::Relaxed);
                        flush_signal.store(true, Ordering::SeqCst);
                        pending.iter_mut().for_each(|ch| ch.clear());
                        let flush_wait = std::time::Instant::now();
                        while flush_signal.load(Ordering::SeqCst) && flush_wait.elapsed().as_millis() < 60 {
                            std::thread::sleep(std::time::Duration::from_millis(1));
                        }
                    } else {
                        // HTTP Stream: Restart FFmpeg starting at target offset!
                        abort_background_downloads();
                        decode_shutdown.store(true, Ordering::SeqCst);
                        kill_current_process(&current_process);
                        kill_current_process(&next_child_process);
                        running = false;
                        next_track_info = Some((path.to_string(), secs, attempt_id.clone()));
                        position_secs.store(secs.to_bits(), Ordering::Relaxed);
                        break;
                    }
                }
                Ok(PlayerCommand::PushNext(path)) => {
                    if !SOURCE_QUEUE_MODE.load(Ordering::SeqCst) { safe_lock(&queue).push_front(path); }
                }
                Ok(PlayerCommand::AppendQueue(path)) => {
                    if !SOURCE_QUEUE_MODE.load(Ordering::SeqCst) { safe_lock(&queue).push_back(path); }
                }
                Ok(PlayerCommand::RestartStream) => {
                    abort_background_downloads();
                    let current_pos = f64::from_bits(position_secs.load(Ordering::Relaxed));
                    running = false;
                    is_restart_stream = true;
                    next_track_info = Some((path.to_string(), current_pos, attempt_id.clone()));
                    break;
                }
                Ok(PlayerCommand::Shutdown) => {
                    abort_background_downloads();
                    kill_current_process(&next_child_process);
                    running = false;
                    break;
                }
                Err(_) => break,
            }
        }
        if !running { break; }

        // Dynamic DSP parameter updating without audio glitches:
        if let Ok(dsp_guard) = dsp_state.try_lock() {
            if let Some(prev) = &last_dsp_params {
                if *prev != *dsp_guard {
                    current_dsp = dsp_guard.clone();
                    for node in &mut nodes {
                        node.update_params(&current_dsp, dev_rate as f32);
                    }
                    last_dsp_params = Some(current_dsp.clone());
                }
            } else {
                current_dsp = dsp_guard.clone();
                for node in &mut nodes {
                    node.update_params(&current_dsp, dev_rate as f32);
                }
                last_dsp_params = Some(current_dsp.clone());
            }
        }

        // HOT RELOAD DSP/RESAMPLER/OUTPUT STREAM PARAMETERS IF CHANGED
        let exc_now = exclusive_mode.load(Ordering::Relaxed);
        let bp_now = bit_perfect.load(Ordering::Relaxed);

        // ONLY restart if values actually changed from what we started with
        if exc_now != last_exclusive
            || bp_now != last_bit_perfect
            || hardware_upsample_changed(last_upsample_rate, exc_now, bp_now, &current_dsp)
            || current_dsp.resampler_interpolation != last_interpolation
            || current_dsp.resampler_sinc_len != last_sinc_len
            || current_dsp.resampler_oversampling != last_oversampling
            || current_dsp.ffmpeg_transcode_quality != last_ffmpeg_quality
            || current_dsp.exclusive_mode_timing != last_exclusive_timing
        {
            println!("[player] Hardware/DSP/Parameters change detected. Restarting stream...");
            let current_pos = f64::from_bits(position_secs.load(Ordering::Relaxed));
            running = false;
            is_restart_stream = true;
            next_track_info = Some((path.to_string(), current_pos, attempt_id.clone()));
            break;
        }

        // Calculate true position
        let p_len = pending[0].len() as f64;
        let mut r_len = prod.len() as f64 / (dev_ch as f64);
        if flush_signal.load(Ordering::Relaxed) {
            r_len = 0.0;
        }
        let delay_secs = (p_len / file_rate as f64) + (r_len / dev_rate as f64);
        let true_pos = (ram_cursor as f64 / file_rate as f64) - delay_secs;
        let true_pos = true_pos.max(0.0);

        let source_mode = SOURCE_QUEUE_MODE.load(Ordering::SeqCst);
        let stop_at_end = stops_after(path);
        let trigger = crossfade_trigger_position(&current_dsp, duration_secs, bp_now, source_mode || stop_at_end);
        if crossfade_triggered && (!current_dsp.crossfade_transition_enabled
            || current_dsp.crossfade_transition_duration <= 0.0 || bp_now || source_mode || stop_at_end) {
            drop(next_decoder_info.take());
            drop(next_decoder_rx.take());
            drop(next_reservation.take());
            kill_current_process(&next_child_process);
            crossfade_triggered = false;
            crossfade_frame_counter = 0;
            crossfade_loudness_scales = (1.0, 1.0);
            next_track_path = None;
            next_decoder_rx = None;
            next_decoder_info = None;
            next_resampler = None;
            next_pending.clear();
            next_output.clear();
        }
        if let Some(crossfade_trigger_pos) = trigger {
            if true_pos >= crossfade_trigger_pos && !crossfade_triggered {
                let is_local_next = !stops_after(path) && !SOURCE_QUEUE_MODE.load(Ordering::SeqCst) && safe_lock(&queue).front().map(|p| is_playable_local_path(p)).unwrap_or(false);
                if is_local_next {
                    crossfade_triggered = true;
                    let (next_path_opt, queue_generation) = {
                        let mut q = safe_lock(&queue);
                        let generation = LOCAL_QUEUE_GENERATION.load(Ordering::SeqCst);
                        let path = if SOURCE_QUEUE_MODE.load(Ordering::SeqCst) { None } else { q.pop_front() };
                        (path, generation)
                    };
                    if let Some(next_path) = next_path_opt {
                        next_child_process = Arc::new(Mutex::new(None));
                        fade_frames = (current_dsp.crossfade_transition_duration as f64 * dev_rate as f64) as usize;
                        if current_dsp.crossfade_transition_duration > 0.0 {
                            let out_meta = get_track_perceived_gain_db(&app_handle, path);
                            let in_meta = get_track_perceived_gain_db(&app_handle, &next_path);
                            if let (Some(g_out), Some(g_in)) = (out_meta, in_meta) {
                                let diff_db = (g_in - g_out).clamp(-12.0, 12.0);
                                crossfade_loudness_scales = (1.0f32, 10.0f32.powf(diff_db / 20.0));
                            } else {
                                crossfade_loudness_scales = (1.0f32, 1.0f32);
                            }
                        } else {
                            crossfade_loudness_scales = (1.0f32, 1.0f32);
                        }
                        println!("[player-crossfade] Triggering crossfade to next track: {}", next_path);
                        let app_h = app_handle.clone();
                        let ffmpeg_p = ffmpeg_path.to_string();
                        let process_c = Arc::clone(&next_child_process);
                        let quality = last_ffmpeg_quality.clone();
                        let dsp_c = current_dsp.clone();
                        let next_path_c = next_path.clone();

                        let (tx, rx_next_decoder) = std::sync::mpsc::channel();
                        let next_cancel_token = Arc::new(AtomicBool::new(false));
                        let next_cancel_clone = Arc::clone(&next_cancel_token);
                        let next_gen = PLAYBACK_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
                        let worker = std::thread::spawn(move || {
                            let res = prepare_decoder(
                                &next_path_c,
                                0.0,
                                None,
                                &app_h,
                                &ffmpeg_p,
                                &process_c,
                                &quality,
                                &dsp_c,
                                &next_cancel_clone,
                                next_gen,
                            );
                            let _ = tx.send(res);
                        });
                        next_reservation = Some(CrossfadeReservation {
                            path: Some(next_path.clone()), queue: Arc::clone(&queue),
                            queue_generation,
                            cancel: next_cancel_token, process: Arc::clone(&next_child_process), worker: Some(worker),
                        });
                        next_decoder_rx = Some(rx_next_decoder);
                        next_track_path = Some(next_path);
                    }
                }
            }
        }

        // Poll for next track decoder
        if let Some(ref rx_chan) = next_decoder_rx {
            if let Ok(res) = rx_chan.try_recv() {
                match res {
                    Ok(info) => {
                        println!("[player-crossfade] Next track decoder prepared successfully for: {}", info.resolved_path);
                        next_pending = vec![VecDeque::new(); info.file_ch];

                        let sinc_len = current_dsp.resampler_sinc_len as usize;
                        let oversampling = current_dsp.resampler_oversampling as usize;
                        let interp_type = match current_dsp.resampler_interpolation.as_str() {
                            "linear" => rubato::SincInterpolationType::Linear,
                            _ => rubato::SincInterpolationType::Cubic,
                        };
                        let f_cutoff = if sinc_len <= 64 { 0.96f32 } else { 0.985f32 };

                        match SincFixedIn::<f32>::new(
                            dev_rate as f64 / info.file_rate as f64,
                            2.0,
                            SincInterpolationParameters {
                                sinc_len,
                                f_cutoff,
                                interpolation: interp_type,
                                oversampling_factor: oversampling,
                                window: rubato::WindowFunction::BlackmanHarris2,
                            },
                            chunk_size,
                            info.file_ch
                        ) {
                            Ok(r) => {
                                next_resampler = Some(r);
                                next_decoder_info = Some(info);
                            }
                            Err(e) => {
                                eprintln!("[player-crossfade] Failed to create resampler for next track: {}", e);
                                next_track_path = None;
                                drop(next_reservation.take());
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("[player-crossfade] Failed to prepare next track decoder: {}", e);
                        next_track_path = None;
                        drop(next_reservation.take());
                    }
                }
                next_decoder_rx = None;
            }
        }

        // FILL PENDING BUFFER
        if pending[0].len() < chunk_size * 4 {
            if let Some(samples_arc) = &decoded_samples {
                // READ FROM RAM (Possibly still loading)
                let lock = safe_lock(samples_arc);
                if ram_cursor < lock[0].len() {
                    let to_read = (lock[0].len() - ram_cursor).min(chunk_size * 8);
                    for ch in 0..file_ch {
                        pending[ch].extend(&lock[ch][ram_cursor..ram_cursor+to_read]);
                    }
                    ram_cursor += to_read;
                    // Position update moved to end of loop for better accuracy
                } else if is_complete.as_ref().map(|c| c.load(Ordering::SeqCst)).unwrap_or(true) {
                    // Only break the loop if there are no more samples in pending to resample!
                    if pending[0].is_empty() && !eof_draining && !eof_drained
                        && output_timeline.remaining() > 0
                    {
                        eof_draining = true;
                    }
                    if pending[0].is_empty() && !eof_draining {
                        if !stops_after(path) && crossfade_triggered && next_track_path.is_some() {
                            let played_secs = crossfade_frame_counter as f64 / dev_rate as f64;
                            let npath = next_track_path.take().unwrap();
                            let next_attempt_id = generate_handoff_attempt_id();
                            let _ = app_handle.emit("track-transitioned", serde_json::json!({
                                "previous_path": path,
                                "previous_attempt_id": attempt_id.as_deref().unwrap_or(""),
                                "path": &npath,
                                "attempt_id": &next_attempt_id,
                            }));
                            next_track_info = Some((npath, played_secs, Some(next_attempt_id)));
                        } else {
                            let is_local_next = !stops_after(path) && !SOURCE_QUEUE_MODE.load(Ordering::SeqCst) && safe_lock(&queue).front().map(|p| is_playable_local_path(p)).unwrap_or(false);
                            if is_local_next {
                                let next_queued = safe_lock(&queue).pop_front();
                                if let Some(npath) = next_queued {
                                    let next_attempt_id = generate_handoff_attempt_id();
                                    let _ = app_handle.emit("track-transitioned", serde_json::json!({
                                        "previous_path": path,
                                        "previous_attempt_id": attempt_id.as_deref().unwrap_or(""),
                                        "path": &npath,
                                        "attempt_id": &next_attempt_id,
                                    }));
                                    next_track_info = Some((npath, 0.0, Some(next_attempt_id)));
                                }
                            }
                        }
                        break;
                    } else if pending[0].len() < chunk_size && !pending[0].is_empty() {
                        eof_pending_frames = Some(pending[0].len());
                    }
                } else {
                    // STILL LOADING
                    if pending[0].len() < chunk_size {
                        std::thread::sleep(std::time::Duration::from_millis(2));
                    }
                }
            } else {
                // FALLBACK TO CHUNKED (STREAMS)
                if !stream_eof {
                    while pending[0].len() < chunk_size * 4 {
                        let packet = match format.next_packet() {
                            Ok(p) => p,
                            Err(_) => {
                                println!("[player] Stream decoder reached EOF.");
                                stream_eof = true;
                                break;
                            }
                        };
                        if packet.track_id() == track_id {
                            if let Ok(decoded) = decoder.decode(&packet) {
                                let frames = decoded_frames(&decoded);
                                ram_cursor += frames;
                                for (ch, buf) in pending.iter_mut().enumerate().take(file_ch) {
                                    append_f32_channel_data(&decoded, ch, 0, buf);
                                }
                            }
                        }
                    }
                }

                if stream_eof {
                    if pending[0].is_empty() && !eof_draining && !eof_drained
                        && output_timeline.remaining() > 0
                    {
                        eof_draining = true;
                    }
                    if pending[0].is_empty() && !eof_draining {
                        println!("[player] Stream pending samples drained completely at EOF. Exiting decode loop.");
                        if !stops_after(path) && crossfade_triggered && next_track_path.is_some() {
                            let played_secs = crossfade_frame_counter as f64 / dev_rate as f64;
                            let npath = next_track_path.take().unwrap();
                            let next_attempt_id = generate_handoff_attempt_id();
                            let _ = app_handle.emit("track-transitioned", serde_json::json!({
                                "previous_path": path,
                                "previous_attempt_id": attempt_id.as_deref().unwrap_or(""),
                                "path": &npath,
                                "attempt_id": &next_attempt_id,
                            }));
                            next_track_info = Some((npath, played_secs, Some(next_attempt_id)));
                        } else {
                            let is_local_next = !stops_after(path) && !SOURCE_QUEUE_MODE.load(Ordering::SeqCst) && safe_lock(&queue).front().map(|p| is_playable_local_path(p)).unwrap_or(false);
                            if is_local_next {
                                let next_queued = safe_lock(&queue).pop_front();
                                if let Some(npath) = next_queued {
                                    let next_attempt_id = generate_handoff_attempt_id();
                                    let _ = app_handle.emit("track-transitioned", serde_json::json!({
                                        "previous_path": path,
                                        "previous_attempt_id": attempt_id.as_deref().unwrap_or(""),
                                        "path": &npath,
                                        "attempt_id": &next_attempt_id,
                                    }));
                                    next_track_info = Some((npath, 0.0, Some(next_attempt_id)));
                                }
                            }
                        }
                        break;
                    } else if pending[0].len() < chunk_size && !pending[0].is_empty() {
                        eof_pending_frames = Some(pending[0].len());
                    }
                }
            }
        }

        // EMIT GATED READINESS EVENT: Decoder has verified audio frames available for output
        if !playback_ready_emitted && !pending[0].is_empty() {
            playback_ready_emitted = true;
            let _ = app_handle.emit("playback-ready", serde_json::json!({
                "attempt_id": attempt_id.as_deref().unwrap_or(""),
                "path": path,
            }));
        }

        // FILL PENDING BUFFER FOR NEXT TRACK
        if let Some(ref mut info) = next_decoder_info {
            while next_pending[0].len() < chunk_size * 4 {
                let packet = match info.format.next_packet() {
                    Ok(p) => p,
                    Err(_) => break, // Next track EOF
                };
                if packet.track_id() == info.track_id {
                    if let Ok(decoded) = info.decoder.decode(&packet) {
                        for ch in 0..info.file_ch {
                            append_f32_channel_data(&decoded, ch, 0, &mut next_pending[ch]);
                        }
                    }
                }
            }
        }

        let dsp_now = safe_lock(&dsp_state).clone();

        let mut dsp_dirty = false;
        if last_dsp_params.is_none()
            || last_dsp_params.as_ref().unwrap() != &dsp_now
            || dev_rate != last_calculated_rate
        {
            dsp_dirty = true;
            last_dsp_params = Some(dsp_now.clone());
            last_calculated_rate = dev_rate;
            current_dsp = dsp_now.clone();
        }

        if dsp_dirty {
            for node in &mut nodes {
                node.update_params(&current_dsp, dev_rate as f32);
            }
        }

        'resample: loop {
            if pending[0].len() < chunk_size && !eof_draining && eof_pending_frames.is_none() { break 'resample; }
            let valid_input_frames = if eof_draining { 0 } else { eof_pending_frames.take().unwrap_or(chunk_size) };

            let mut chunk_planar = vec![vec![0.0; if eof_draining { 0 } else { valid_input_frames }]; file_ch];
            if !eof_draining {
                for ch in 0..file_ch {
                    for val in &mut chunk_planar[ch] {
                        *val = pending[ch].pop_front().unwrap();
                    }
                }
            }

            let is_bp = bp_now && file_rate == dev_rate && file_ch == dev_ch;

            let (out_planar, n_out) = if is_bp {
                feed_visualizer_fft(&chunk_planar, &mut fft_buffer, fft_tx, dev_rate as f32, current_dsp.low_spec_mode);
                (chunk_planar, valid_input_frames)
            } else {
                let mut processed = if should_bypass_resampler(file_rate, dev_rate, dsp_now.playback_rate)
                    && !output_timeline.started
                {
                    chunk_planar
                } else {
                    let previous_ratio = dev_rate as f64 / file_rate as f64 * last_resample_ratio;
                    update_playback_ratio(&mut resampler, &mut last_resample_ratio, dsp_now.playback_rate);
                    let target_ratio = dev_rate as f64 / file_rate as f64 * last_resample_ratio;
                    if !eof_draining {
                        output_timeline.add_input(valid_input_frames, previous_ratio, target_ratio);
                    }
                    if !output_timeline.started {
                        output_timeline.startup_delay = resampler.output_delay();
                        output_timeline.started = true;
                    }

                    let refs: Vec<&[f32]> = chunk_planar.iter().map(Vec::as_slice).collect();
                    match if eof_draining {
                        resampler.process_partial::<&[f32]>(None, None)
                    } else if valid_input_frames < chunk_size {
                        resampler.process_partial(Some(&refs), None)
                    } else {
                        resampler.process(&refs, None)
                    } {
                        Ok(o) => o,
                        Err(_) => break 'resample,
                    }
                };
                if output_timeline.started {
                    output_timeline.trim(&mut processed);
                    if eof_draining && output_timeline.remaining() == 0 {
                        eof_draining = false;
                        eof_drained = true;
                    }
                }

                feed_visualizer_fft(&processed, &mut fft_buffer, fft_tx, dev_rate as f32, current_dsp.low_spec_mode);
                fold_for_stereo_output(&mut processed, dev_ch);
                if let (Some(next_res), Some(info)) = (&mut next_resampler, &next_decoder_info) {
                    if next_output.is_empty() {
                        next_output = vec![VecDeque::new(); if dev_ch == 2 { info.file_ch.min(2) } else { info.file_ch }];
                    }
                    while next_output[0].len() < processed[0].len() && next_pending[0].len() >= chunk_size {
                        let mut next_chunk_planar = vec![vec![0.0; chunk_size]; info.file_ch];
                        for ch in 0..info.file_ch {
                            for sample in &mut next_chunk_planar[ch] {
                                *sample = next_pending[ch].pop_front().unwrap();
                            }
                        }
                        update_playback_ratio(next_res, &mut next_resample_ratio, dsp_now.playback_rate);
                        let refs_next: Vec<&[f32]> = next_chunk_planar.iter().map(Vec::as_slice).collect();
                        match next_res.process(&refs_next, None) {
                            Ok(mut next_processed) => {
                                fold_for_stereo_output(&mut next_processed, dev_ch);
                                for (pending, output) in next_output.iter_mut().zip(next_processed) {
                                    pending.extend(output);
                                }
                            }
                            Err(err) => {
                                eprintln!("[player-crossfade] Next-track resampling failed: {err}");
                                break;
                            }
                        }
                    }

                    // Duration is latched when preparation starts; disable cancels immediately.
                    let crossfade_frames = fade_frames;
                    let remaining = crossfade_frames.saturating_sub(crossfade_frame_counter);
                    if !stops_after(path) && remaining > 0 && !next_output[0].is_empty() {
                        let mixed = mix_crossfade_frames_scaled(&mut processed, &mut next_output, crossfade_frame_counter, crossfade_frames, crossfade_loudness_scales.0, crossfade_loudness_scales.1);
                        crossfade_frame_counter += mixed;
                        if !stops_after(path) && crossfade_frame_counter >= crossfade_frames {
                            processed.iter_mut().for_each(|channel| channel.truncate(mixed));
                            let played_secs = crossfade_frame_counter as f64 / dev_rate as f64;
                            let npath = next_track_path.take().unwrap();
                            let next_attempt_id = generate_handoff_attempt_id();
                            let _ = app_handle.emit("track-transitioned", serde_json::json!({
                                "previous_path": path,
                                "previous_attempt_id": attempt_id.as_deref().unwrap_or(""),
                                "path": &npath,
                                "attempt_id": &next_attempt_id,
                            }));
                            next_track_info = Some((npath, played_secs, Some(next_attempt_id)));
                            crossfade_handoff = true;
                        }
                    }
                }


                if !should_bypass_dsp_for_bit_perfect(is_bp, current_dsp.enabled) {
                    for node in &mut nodes {
                        node.process(&mut processed, dev_rate as f32);
                    }
                }
                let len = processed[0].len();
                (processed, len)
            };


            let mut interleaved = Vec::with_capacity(n_out * dev_ch);
            let mut out_idx = 0;

            while out_idx < n_out {
                for ch in 0..dev_ch {
                    let sample = mix_output_channel_sample(&out_planar, out_idx, ch, file_ch);
                    interleaved.push(sample);
                }
                out_idx += 1;
            }

            // Lock-free loop to wait for buffer space
            let mut prod_stall_count = 0u32;
            let mut last_remaining = prod.remaining();
            while prod.remaining() < interleaved.len() && running {
                std::thread::sleep(std::time::Duration::from_millis(5));

                let cur_rem = prod.remaining();
                if cur_rem != last_remaining {
                    // Consumer is actively making progress reading audio from ring buffer
                    prod_stall_count = 0;
                    last_remaining = cur_rem;
                } else if status.load(Ordering::Relaxed) == 1 {
                    prod_stall_count += 1;
                    if prod_stall_count >= 2000 {
                        eprintln!("[player] Audio consumer stall detected (10s zero consumption). Triggering stream restart/recovery...");
                        let _ = cmd_tx.send(PlayerCommand::RestartStream);
                        prod_stall_count = 0;
                    }
                } else {
                    prod_stall_count = 0;
                }

                // Smooth out UI timer updates while waiting for hardware to play
                let p_len = pending[0].len() as f64;
                let mut r_len = prod.len() as f64 / (dev_ch as f64);
                if flush_signal.load(Ordering::Relaxed) { r_len = 0.0; }
                let delay_secs = (p_len / file_rate as f64) + (r_len / dev_rate as f64);
                let true_pos = (ram_cursor as f64 / file_rate as f64) - delay_secs;
                position_secs.store(true_pos.max(0.0).to_bits(), Ordering::Relaxed);

                match rx.try_recv() {
                    Ok(PlayerCommand::Stop) => {
                        abort_background_downloads();
                        abort_inactive_stream_downloads(None);
                        decode_shutdown.store(true, Ordering::SeqCst);
                        kill_current_process(&current_process);

                        // EVADE DEADLOCK: Clear incomplete cache if stopped prematurely
                        let mut c = safe_lock(&cache);
                        if let Some(ct) = c.as_ref() {
                            if !ct.complete.load(Ordering::SeqCst) { *c = None; }
                        }

                        running = false;
                        break;
                    }
                    Ok(PlayerCommand::Pause) => {
                        status.store(2, Ordering::Relaxed);
                    }
                    Ok(PlayerCommand::Resume) => {
                        status.store(1, Ordering::Relaxed);
                    }
                    Ok(PlayerCommand::Play(p, pos, a_id)) => {
                        abort_background_downloads();
                        abort_inactive_stream_downloads(Some(&p));
                        decode_shutdown.store(true, Ordering::SeqCst);
                        kill_current_process(&current_process);
                        let _ = app_handle.emit("playback-cancelled", serde_json::json!({
                            "attempt_id": attempt_id.as_deref().unwrap_or(""),
                            "path": path,
                        }));

                        let mut c = safe_lock(&cache);
                        if let Some(ct) = c.as_ref() {
                            if !ct.complete.load(Ordering::SeqCst) { *c = None; }
                        }

                        running = false;
                        next_track_info = Some((p, pos, a_id));
                        is_manual_change = true;
                        flush_signal.store(true, Ordering::SeqCst);
                        pending.iter_mut().for_each(|ch| ch.clear());
                        interleaved.clear();
                        break;
                    }
                    Ok(PlayerCommand::Seek(secs)) => {
                        // Reset crossfade transition states to prevent stale next-track bleed
                        cancel_crossfade_handoff(&mut next_reservation, &mut crossfade_handoff, &mut next_track_info);
                        kill_current_process(&next_child_process);
                        crossfade_frame_counter = 0;
                        crossfade_triggered = false;
                        crossfade_loudness_scales = (1.0, 1.0);
                        next_track_path = None;
                        next_decoder_rx = None;
                        next_decoder_info = None;
                        next_resampler = None;
                        next_pending.iter_mut().for_each(|ch| ch.clear());
                        resampler.reset();
                        last_resample_ratio = 1.0;
                        stream_eof = false;
                        eof_pending_frames = None;
                        output_timeline = ResamplerOutputTimeline::default();
                        eof_draining = false;
                        eof_drained = false;
                        next_output.iter_mut().for_each(VecDeque::clear);
                        next_resample_ratio = 1.0;

                        if let Some(samples_arc) = &decoded_samples {
                            let lock = safe_lock(samples_arc);
                            ram_cursor = ram_seek_cursor(
                                secs, file_rate, lock[0].len(),
                                is_complete.as_ref().map(|c| c.load(Ordering::SeqCst)).unwrap_or(true),
                            );
                            position_secs.store(secs.to_bits(), Ordering::Relaxed);
                            flush_signal.store(true, Ordering::SeqCst);
                            pending.iter_mut().for_each(|ch| ch.clear());
                            interleaved.clear();
                            let flush_wait = std::time::Instant::now();
                            while flush_signal.load(Ordering::SeqCst) && flush_wait.elapsed().as_millis() < 60 {
                                std::thread::sleep(std::time::Duration::from_millis(1));
                            }
                        } else if !is_stream {
                            if let Some(tb) = time_base {
                                let seek_ts = (secs * tb.denom as f64 / tb.numer as f64) as u64;
                                let _ = format.seek(symphonia::core::formats::SeekMode::Accurate, symphonia::core::formats::SeekTo::TimeStamp { ts: seek_ts, track_id });
                            }
                            decoder.reset();
                            ram_cursor = (secs * file_rate as f64) as usize;
                            position_secs.store(secs.to_bits(), Ordering::Relaxed);
                            flush_signal.store(true, Ordering::SeqCst);
                            pending.iter_mut().for_each(|ch| ch.clear());
                            interleaved.clear();
                            let flush_wait = std::time::Instant::now();
                            while flush_signal.load(Ordering::SeqCst) && flush_wait.elapsed().as_millis() < 60 {
                                std::thread::sleep(std::time::Duration::from_millis(1));
                            }
                        } else {
                            // HTTP Stream: Restart FFmpeg starting at target offset!
                            abort_background_downloads();
                            decode_shutdown.store(true, Ordering::SeqCst);
                            kill_current_process(&current_process);
                            running = false;
                            next_track_info = Some((path.to_string(), secs, attempt_id.clone()));
                            position_secs.store(secs.to_bits(), Ordering::Relaxed);
                            break;
                        }
                        break; // ⚡ Break wait loop to process new position
                    }
                    Ok(PlayerCommand::RestartStream) => {
                        let current_p = { safe_lock(&current_track).clone() };
                        let current_pos = f64::from_bits(position_secs.load(Ordering::Relaxed));
                        if let Some(p) = current_p {
                            abort_background_downloads();
                            kill_current_process(&current_process);

                            running = false;
                            is_restart_stream = true;
                            next_track_info = Some((p, current_pos, attempt_id.clone()));
                        }
                        break;
                    }
                    Ok(PlayerCommand::PushNext(path)) => {
                        if !SOURCE_QUEUE_MODE.load(Ordering::SeqCst) { safe_lock(&queue).push_front(path); }
                    }
                    Ok(PlayerCommand::AppendQueue(path)) => {
                        if !SOURCE_QUEUE_MODE.load(Ordering::SeqCst) { safe_lock(&queue).push_back(path); }
                    }
                    Ok(PlayerCommand::Shutdown) => {
                        abort_background_downloads();
                        decode_shutdown.store(true, Ordering::SeqCst);
                        kill_current_process(&current_process);
                        running = false;
                        break;
                    }
                    Err(_) => {}
                }
            }

            if running && !interleaved.is_empty() {
                let mut pushed = prod.push_slice(&interleaved);
                while pushed < interleaved.len() && running {
                    let n = prod.push_slice(&interleaved[pushed..]);
                    if n > 0 {
                        pushed += n;
                    } else {
                        std::thread::sleep(std::time::Duration::from_millis(1));
                    }
                }
            }
            if crossfade_handoff { break 'resample; }
        }
        if crossfade_handoff { break; }

        // ACCURATE POSITION TRACKING (Subtract buffer delays)
        let p_len = pending[0].len() as f64;
        let mut r_len = prod.len() as f64 / (dev_ch as f64);
        if flush_signal.load(Ordering::Relaxed) {
            r_len = 0.0;
        }
        let delay_secs = (p_len / file_rate as f64) + (r_len / dev_rate as f64);
        let true_pos = (ram_cursor as f64 / file_rate as f64) - delay_secs;
        position_secs.store(true_pos.max(0.0).to_bits(), Ordering::Relaxed);
    }

    // 5. WAIT FOR BUFFER TO DRAIN ENTIRELY
    // This prevents cutting off audio when the ringbuffer is full at EOF,
    // ensuring the track plays to 100% completion before advancing to the next track.
    drop(next_decoder_info.take());
    drop(next_decoder_rx.take());
    if let Some(reservation) = next_reservation.as_mut() { reservation.cancel_preparation(); }
    let endpoint_drain = if crossfade_handoff {
        std::time::Duration::ZERO
    } else if let ActiveStream::Wasapi(wasapi) = &stream {
        wasapi.drain_duration()
    } else {
        std::time::Duration::ZERO
    };
    let mut endpoint_empty_since = if prod.is_empty() && status.load(Ordering::Relaxed) == 1 {
        Some(std::time::Instant::now())
    } else {
        None
    };
    let mut drain_progress_start = std::time::Instant::now();
    let mut last_prod_len = prod.len();
    while running && (!prod.is_empty() || (endpoint_drain > std::time::Duration::ZERO
        && endpoint_empty_since.map_or(true, |since| since.elapsed() < endpoint_drain))) {
        std::thread::sleep(std::time::Duration::from_millis(20));

        let cur_len = prod.len();
        if cur_len == 0 && status.load(Ordering::Relaxed) == 1 {
            endpoint_empty_since.get_or_insert_with(std::time::Instant::now);
        } else {
            endpoint_empty_since = None;
        }
        if cur_len != last_prod_len {
            last_prod_len = cur_len;
            drain_progress_start = std::time::Instant::now();
        } else if cur_len > 0 && status.load(Ordering::Relaxed) == 1 && drain_progress_start.elapsed() > std::time::Duration::from_secs(4) {
            eprintln!("[player] Warning: Audio buffer drain stalled for 4s at EOF. Continuing to next track.");
            break;
        }

        // Keep updating position so UI timer completes smoothly
        let p_len = pending[0].len() as f64;
        let mut r_len = prod.len() as f64 / (dev_ch as f64);
        if flush_signal.load(Ordering::Relaxed) { r_len = 0.0; }
        let delay_secs = (p_len / file_rate as f64) + (r_len / dev_rate as f64);
        let true_pos = (ram_cursor as f64 / file_rate as f64) - delay_secs;
        let true_pos = if duration_secs > 0.0 {
            true_pos.max(0.0).min(duration_secs)
        } else {
            true_pos.max(0.0)
        };
        position_secs.store(true_pos.to_bits(), Ordering::Relaxed);

        while let Ok(cmd) = rx.try_recv() {
            match cmd {
                PlayerCommand::Stop => {
                    abort_background_downloads();
                    abort_inactive_stream_downloads(None);
                    let _ = app_handle.emit("playback-cancelled", serde_json::json!({
                        "attempt_id": attempt_id.as_deref().unwrap_or(""),
                        "path": path,
                    }));
                    running = false;
                    next_track_info = None;
                    flush_signal.store(true, Ordering::SeqCst);
                    break;
                }
                PlayerCommand::Pause => {
                    status.store(2, Ordering::Relaxed);
                }
                PlayerCommand::Resume => {
                    status.store(1, Ordering::Relaxed);
                }
                PlayerCommand::Play(p, pos, a_id) => {
                    abort_background_downloads();
                    abort_inactive_stream_downloads(Some(&p));
                    let _ = app_handle.emit("playback-cancelled", serde_json::json!({
                        "attempt_id": attempt_id.as_deref().unwrap_or(""),
                        "path": path,
                    }));
                    running = false;
                    next_track_info = Some((p, pos, a_id));
                    is_manual_change = true;
                    flush_signal.store(true, Ordering::SeqCst);
                    pending.iter_mut().for_each(|ch| ch.clear());
                    break;
                }
                PlayerCommand::Seek(secs) => {
                    abort_background_downloads();
                    running = false;
                    next_track_info = Some((path.to_string(), secs, attempt_id.clone()));
                    position_secs.store(secs.to_bits(), Ordering::Relaxed);
                    flush_signal.store(true, Ordering::SeqCst);
                    break;
                }
                PlayerCommand::RestartStream => {
                    let current_p = { safe_lock(&current_track).clone() };
                    let current_pos = f64::from_bits(position_secs.load(Ordering::Relaxed));
                    if let Some(p) = current_p {
                        abort_background_downloads();
                        kill_current_process(&current_process);
                        running = false;
                        is_restart_stream = true;
                        next_track_info = Some((p, current_pos, attempt_id.clone()));
                    }
                    break;
                }
                PlayerCommand::PushNext(path) => {
                    if !SOURCE_QUEUE_MODE.load(Ordering::SeqCst) { safe_lock(&queue).push_front(path); }
                }
                PlayerCommand::AppendQueue(path) => {
                    if !SOURCE_QUEUE_MODE.load(Ordering::SeqCst) { safe_lock(&queue).push_back(path); }
                }
                PlayerCommand::Shutdown => {
                    abort_background_downloads();
                    running = false;
                    next_track_info = None;
                    break;
                }
            }
        }
    }
    if running && !is_restart_stream && !is_manual_change {
        if let Some(reservation) = next_reservation.as_mut() {
            if next_track_info.as_ref().map(|next| &next.0) == reservation.path.as_ref() {
                reservation.path = None;
            }
        }
    }
    drop(next_reservation.take());

    if running && next_track_info.is_none() {
        let is_local_next = !stops_after(path) && !SOURCE_QUEUE_MODE.load(Ordering::SeqCst) && safe_lock(&queue).front().map(|p| is_playable_local_path(p)).unwrap_or(false);
        if is_local_next {
            let next_queued = safe_lock(&queue).pop_front();
            if let Some(npath) = next_queued {
                let next_attempt_id = generate_handoff_attempt_id();
                let _ = app_handle.emit("track-transitioned", serde_json::json!({
                    "previous_path": path,
                    "previous_attempt_id": attempt_id.as_deref().unwrap_or(""),
                    "path": &npath,
                    "attempt_id": &next_attempt_id,
                }));
                next_track_info = Some((npath, 0.0, Some(next_attempt_id)));
            }
        }
    }

    if running && next_track_info.is_none() {
        if playback_ready_emitted {
            println!("[player] Track ended naturally with no local track queued. Emitting track-ended event to frontend.");
            let _ = app_handle.emit("track-ended", serde_json::json!({
                "attempt_id": attempt_id.as_deref().unwrap_or(""),
                "path": path,
            }));
        } else {
            println!("[player] Track ended before decoding audio frames. Emitting failure for the active playback route.");
            let err_msg = "Decoder reached end of stream without producing audio frames";
            if let Some(attempt_id) = attempt_id.as_deref() {
                let _ = app_handle.emit("source-playback-error", serde_json::json!({
                    "path": path, "error": err_msg, "attempt_id": attempt_id,
                }));
            } else {
                let _ = app_handle.emit("playback-error", serde_json::json!({
                    "path": path, "error": err_msg,
                }));
            }
        }
    }

    if next_track_info.is_none() {
        drop(stream);
        kill_current_process(&next_child_process);
        acknowledge_stop_arm();
        return (None, None);
    }

    if is_restart_stream {
        drop(stream);
        acknowledge_stop_arm();
        kill_current_process(&next_child_process);
        return (next_track_info, None);
    }

    // The next play prepares its own decoder; cancel and reap the speculative one.
    drop(next_decoder_info.take());
    drop(next_decoder_rx.take());
    drop(next_reservation.take());

    let actual_is_exclusive = matches!(stream, ActiveStream::Wasapi(_))
        || route.share_mode == "exclusive"
        || route.share_mode == "direct";

    let session = ActiveStreamSession {
        stream,
        config,
        prod,
        flush_signal,
        output_bits,
        is_float,
        route,
        target_device: target.clone(),
        is_exclusive: actual_is_exclusive,
        sample_rate: dev_rate,
        channels: dev_ch,
        is_manual_change,
    };

    (next_track_info, Some(session))
}


/// Pick the sample for one output channel from planar frames.
///
/// Mono sources are duplicated to every output channel (a mono file must not
/// play hard-left on stereo hardware); source channels beyond the planar data
/// (e.g. a stereo file feeding a 4-channel device) produce silence.
fn mix_output_channel_sample(
    planar: &[Vec<f32>],
    frame_idx: usize,
    out_channel: usize,
    source_channels: usize,
) -> f32 {
    if planar.is_empty() || planar[0].len() <= frame_idx {
        return 0.0;
    }
    let src_ch = if source_channels == 1 { 0 } else { out_channel };
    if src_ch < planar.len() {
        planar[src_ch][frame_idx]
    } else {
        0.0
    }
}

fn measure_latency(url_str: &str) -> Option<u32> {
    use std::net::ToSocketAddrs;
    use std::time::Instant;

    let url = url::Url::parse(url_str).ok()?;
    let host = url.host_str()?;
    let port = url.port_or_known_default()?;

    let addr_str = format!("{}:{}", host, port);
    let start = Instant::now();

    if let Ok(mut addrs) = addr_str.to_socket_addrs() {
        if let Some(addr) = addrs.next() {
            if std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(1000)).is_ok() {
                return Some(start.elapsed().as_millis() as u32);
            }
        }
    }
    None
}


mod dsp_tests;

#[cfg(test)]
mod effective_audio_path_tests;

mod url_cache_tests;
mod playback_lifecycle_tests;

#[cfg(test)]
mod transcode_tests {
    use super::{stream_allows_exclusive_mode, transcode_codec_and_rate};

    #[test]
    fn direct_stream_keeps_its_client_user_agent() {
        assert_eq!(super::youtube_stream_user_agent("https://rr1.googlevideo.com/videoplayback?c=VISIONOS&itag=251"), crate::youtube::DIRECT_STREAM_USER_AGENT);
        assert_eq!(super::youtube_stream_user_agent("https://rr1.googlevideo.com/videoplayback?c=ANDROID"), super::YT_USER_AGENT);
    }

    #[test]
    fn background_transcode_registration_survives_retry() {
        use super::*;
        let hash = "test-background-transcode-retry".to_string();
        let child_ref = Arc::new(Mutex::new(None));
        let complete = Arc::new(AtomicBool::new(false));
        let guard = DownloadGuard {
            hash: hash.clone(),
            complete: complete.clone(),
            child_ref: child_ref.clone(),
            success: true,
        };
        safe_lock(&ACTIVE_DOWNLOADS).insert(hash.clone(), complete.clone());
        safe_lock(&ACTIVE_DOWNLOAD_PROCS).insert(hash.clone(), child_ref.clone());

        // Run a real, harmless child twice: a failed direct attempt then a successful fallback.
        for (argument, expected_success) in [("--invalid-test-argument", false), ("--list", true)] {
            let mut command = std::process::Command::new(std::env::current_exe().unwrap());
            command.arg(argument).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            *safe_lock(&child_ref) = Some(command.spawn().unwrap());
            assert_eq!(wait_for_background_transcode(&hash, &child_ref), expected_success);
            kill_current_process(&child_ref);
            assert!(safe_lock(&ACTIVE_DOWNLOAD_PROCS).contains_key(&hash), "a completed attempt must not cancel its fallback");
        }
        drop(guard);
        assert!(complete.load(Ordering::SeqCst));
        assert!(!safe_lock(&ACTIVE_DOWNLOADS).contains_key(&hash));
        assert!(!safe_lock(&ACTIVE_DOWNLOAD_PROCS).contains_key(&hash));
        assert!(!wait_for_background_transcode(&hash, &child_ref), "cancellation must stop waiting");
    }

    #[test]
    fn aborted_download_guard_does_not_mark_complete_on_drop() {
        use super::*;
        let hash = "test-aborted-download-guard".to_string();
        let child_ref = Arc::new(Mutex::new(None));
        let complete = Arc::new(AtomicBool::new(false));
        let guard = DownloadGuard {
            hash: hash.clone(),
            complete: complete.clone(),
            child_ref: child_ref.clone(),
            success: false,
        };
        safe_lock(&ACTIVE_DOWNLOADS).insert(hash.clone(), complete.clone());
        safe_lock(&ACTIVE_DOWNLOAD_PROCS).insert(hash.clone(), child_ref.clone());

        drop(guard);
        assert!(!complete.load(Ordering::SeqCst), "aborted download must NOT mark complete = true");
    }

    #[test]
    fn test_growing_file_reader_handles_abortion_and_completion() {
        use super::*;
        use std::io::{Read, Write};

        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join("test_growing_reader.tmp");
        {
            let mut f = std::fs::File::create(&file_path).unwrap();
            f.write_all(&[42u8; 100]).unwrap();
        }

        let hash = "test_growing_reader_hash".to_string();
        let complete = Arc::new(AtomicBool::new(false));
        safe_lock(&ACTIVE_DOWNLOADS).insert(hash.clone(), complete.clone());

        let file = std::fs::File::open(&file_path).unwrap();
        let mut reader = GrowingFileReader {
            file,
            complete: complete.clone(),
            hash: hash.clone(),
        };

        let mut buf = [0u8; 100];
        assert_eq!(reader.read(&mut buf).unwrap(), 100);

        // Case 1: Inactive + incomplete must return UnexpectedEof
        safe_lock(&ACTIVE_DOWNLOADS).remove(&hash);
        let err = reader.read(&mut buf).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::UnexpectedEof);

        // Case 2: Complete must return Ok(0)
        complete.store(true, Ordering::SeqCst);
        assert_eq!(reader.read(&mut buf).unwrap(), 0);

        let _ = std::fs::remove_file(&file_path);
    }

    #[test]
    fn test_native_tier_preserves_source_rate_for_pcm() {
        assert_eq!(transcode_codec_and_rate("native", false), ("pcm_s24le", None));
    }

    #[test]
    fn test_native_tier_resamples_dsd() {
        assert_eq!(transcode_codec_and_rate("native", true).1, Some("176400"));
    }

    #[test]
    fn test_hires_tier_unchanged() {
        assert_eq!(transcode_codec_and_rate("hires", false).1, Some("96000"));
    }

    #[test]
    fn test_studio_tier_unchanged() {
        assert_eq!(transcode_codec_and_rate("studio", true).1, Some("88200"));
    }

    #[test]
    fn test_unknown_quality_defaults_to_standard() {
        assert_eq!(transcode_codec_and_rate("whatever", false), ("pcm_s16le", Some("44100")));
    }

    #[test]
    fn signed_pcm_endpoint_conversion_exposes_32_bit_precision_loss() {
        use symphonia::core::conv::FromSample;
        assert_eq!(f32::from_sample(i16::MIN), -1.0);
        assert_eq!(f32::from_sample(i16::MAX), 32767.0 / 32768.0);
        // The production f32 ring cannot distinguish adjacent high-resolution PCM words.
        assert_eq!(f32::from_sample(i32::MAX), f32::from_sample(i32::MAX - 1));
        assert_ne!((f32::from_sample(i32::MAX) as f64 * 2_147_483_648.0) as i64, i32::MAX as i64);
    }

    #[test]
    fn cache_codec_preserves_negotiated_precision() {
        assert_eq!(super::cache_pcm_codec(Some("pcm_s16"), "hires"), "pcm_s16le");
        assert_eq!(super::cache_pcm_codec(Some("pcm_s24"), "native"), "pcm_s24le");
        assert_eq!(super::cache_pcm_codec(Some("pcm_s32"), "native"), "pcm_s32le");
        assert_eq!(super::cache_pcm_codec(Some("pcm_f32"), "native"), "pcm_f32le");
        assert_eq!(super::cache_pcm_codec(None, "hires"), "pcm_s24le");
        assert_eq!(super::cache_pcm_codec(None, "standard"), "pcm_s16le");
    }

    #[test]
    fn test_hls_streams_reject_exclusive_mode() {
        assert!(!stream_allows_exclusive_mode("https://host/live/stream.m3u8"));
        assert!(!stream_allows_exclusive_mode("https://host/hls_playlist?id=1"));
        assert!(!stream_allows_exclusive_mode("https://host/hls/segment"));
        assert!(!stream_allows_exclusive_mode("HTTPS://HOST/LIVE/STREAM.M3U8"));
    }

    #[test]
    fn test_direct_media_urls_allow_exclusive_mode() {
        assert!(stream_allows_exclusive_mode("https://api.tidal.com/tracks/123.flac?token=x"));
        assert!(stream_allows_exclusive_mode("http://subsonic.local/rest/stream.view?id=5"));
        assert!(stream_allows_exclusive_mode("C:\\Music\\album\\song.flac"));
    }
}
