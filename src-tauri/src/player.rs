use std::sync::{Arc, Mutex};
use std::io::BufRead;
use std::thread;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use ringbuf::RingBuffer;
use crossbeam_channel::{Receiver, Sender};
use rustfft::{FftPlanner, num_complex::Complex};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::{FormatOptions, SeekMode, SeekTo};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::units::TimeBase;
use symphonia::default::{get_codecs, get_probe};
use rubato::{Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction};
use tauri::Emitter;

#[allow(dead_code)]
pub enum ActiveStream {
    Cpal(cpal::Stream),
    Wasapi(crate::wasapi_engine::WasapiStream),
}

/// 🛡️ Safe Lock Pattern: Handles mutex poisoning by recovering the inner data instead of panicking.
fn safe_lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            eprintln!("[player] CRITICAL: Mutex poisoned! Attempting recovery...");
            poisoned.into_inner()
        }
    }
}

/// 📦 Grouped decoder state to simplify passing multiple arguments
struct DecoderInfo {
    pub format: Box<dyn symphonia::core::formats::FormatReader>,
    pub decoder: Box<dyn symphonia::core::codecs::Decoder>,
    pub track_id: u32,
    pub time_base: Option<TimeBase>,
    pub file_rate: usize,
    pub file_ch: usize,
}

/// 🎚️ Hardware Rate Switching & Config Selection
fn select_output_config(
    device: &cpal::Device,
    file_rate: usize,
    file_ch: usize,
    is_exclusive: bool,
    is_stream: bool,
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

    // Priority 2: Native Bit-Perfect Match
    if configs.is_empty() && is_exclusive && !is_stream {
        if let Ok(supported) = device.supported_output_configs() {
            let supported_configs: Vec<_> = supported.collect();
            
            // Priority 2a: High-Res Integer (I32/I24)
            for c in &supported_configs {
                if c.channels() as usize == file_ch && (c.sample_format() == cpal::SampleFormat::I32 || c.sample_format() == cpal::SampleFormat::I24) {
                    if c.min_sample_rate() <= (file_rate as u32) && c.max_sample_rate() >= (file_rate as u32) {
                        let cfg = c.with_sample_rate(file_rate as u32).config();
                        println!("AUDIOPHILE: Native Integer Match ({:?}): {}Hz", c.sample_format(), file_rate);
                        configs.push((cfg, c.sample_format()));
                    }
                }
            }
            
            // Priority 2b: I16
            if configs.is_empty() {
                for c in &supported_configs {
                    if c.channels() as usize == file_ch && c.sample_format() == cpal::SampleFormat::I16 {
                        if c.min_sample_rate() <= (file_rate as u32) && c.max_sample_rate() >= (file_rate as u32) {
                            let cfg = c.with_sample_rate(file_rate as u32).config();
                            println!("AUDIOPHILE: Native I16 Match: {}Hz", file_rate);
                            configs.push((cfg, c.sample_format()));
                        }
                    }
                }
            }

            // Priority 2c: F32
            if configs.is_empty() {
                for c in &supported_configs {
                    if c.channels() as usize == file_ch && c.sample_format() == cpal::SampleFormat::F32 {
                        if c.min_sample_rate() <= (file_rate as u32) && c.max_sample_rate() >= (file_rate as u32) {
                            let cfg = c.with_sample_rate(file_rate as u32).config();
                            println!("AUDIOPHILE: Native Float Match: {}Hz", file_rate);
                            configs.push((cfg, c.sample_format()));
                        }
                    }
                }
            }
        }
    }

    // Final Fallback: Default (Shared Mode)
    if configs.is_empty() {
        if let Ok(def) = device.default_output_config() {
            println!("AUDIOPHILE: Falling back to Default Shared Config: {}Hz", def.sample_rate());
            configs.push((def.config(), def.sample_format()));
        }
    }

    if configs.is_empty() {
        eprintln!("[player] ERROR: No valid audio configurations found for this device.");
    }

    configs
}

fn resolve_youtube_url(url: &str) -> String {
    if !url.contains("youtube.com") && !url.contains("youtu.be") {
        return url.to_string();
    }
    
    println!("[player] YouTube URL detected. Attempting to extract direct stream URL via yt-dlp...");
    
    let data_dir = dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let aideo_dir = data_dir.join("Aideo");
    let ytdlp_path = aideo_dir.join("yt-dlp.exe");
    
    if !aideo_dir.exists() {
        let _ = std::fs::create_dir_all(&aideo_dir);
    }
    
    if !ytdlp_path.exists() {
        println!("[player] yt-dlp.exe not found. Downloading latest version synchronously...");
        match reqwest::blocking::get("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe") {
            Ok(res) => {
                if let Ok(bytes) = res.bytes() {
                    if let Ok(mut file) = std::fs::File::create(&ytdlp_path) {
                        use std::io::Write;
                        if file.write_all(&bytes).is_ok() {
                            println!("[player] Successfully downloaded yt-dlp.exe synchronously!");
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("[player] Failed to download yt-dlp: {}", e);
            }
        }
    }
    
    if ytdlp_path.exists() {
        #[cfg(target_os = "windows")]
        use std::os::windows::process::CommandExt;
        
        let mut cmd = std::process::Command::new(&ytdlp_path);
        cmd.args(["-g", "-f", "140/bestaudio/best", url]);
        
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        
        match cmd.output() {
            Ok(out) => {
                if out.status.success() {
                    let stdout_str = String::from_utf8_lossy(&out.stdout);
                    let direct_url = stdout_str.trim().to_string();
                    if direct_url.starts_with("http") {
                        println!("[player] Successfully extracted YouTube direct stream URL!");
                        return direct_url;
                    }
                } else {
                    let stderr_str = String::from_utf8_lossy(&out.stderr);
                    eprintln!("[player] yt-dlp extraction failed: {}", stderr_str.trim());
                }
            }
            Err(e) => {
                eprintln!("[player] Failed to execute yt-dlp: {}", e);
            }
        }
    } else {
        println!("[player] Warning: yt-dlp.exe not found. Cannot resolve direct stream URL.");
    }
    
    url.to_string()
}

fn resolve_playlist_url(url: &str) -> String {
    let url_lower = url.to_lowercase();
    if url_lower.ends_with(".pls") || url_lower.ends_with(".m3u") {
        if let Ok(res) = reqwest::blocking::get(url) {
            if let Ok(text) = res.text() {
                if url_lower.ends_with(".pls") {
                    for line in text.lines() {
                        if line.to_lowercase().starts_with("file1=") {
                            return line[6..].trim().to_string();
                        }
                    }
                } else {
                    for line in text.lines() {
                        let trimmed = line.trim();
                        if trimmed.starts_with("http") {
                            return trimmed.to_string();
                        }
                    }
                }
            }
        }
    }
    url.to_string()
}

/// 🎵 Prepare the media source and decoder
fn prepare_decoder(
    path: &str,
    _app_handle: &tauri::AppHandle,
    ffmpeg_path: &str,
    current_process: &Arc<Mutex<Option<std::process::Child>>>,
) -> Result<DecoderInfo, String> {
    let is_stream = path.starts_with("http://") || path.starts_with("https://");

    let mss = if is_stream {
        println!("[player] Preparing URL stream proxy...");
        
        #[cfg(target_os = "windows")]
        use std::os::windows::process::CommandExt;
        
        let mut cmd = std::process::Command::new(ffmpeg_path);
        
        let resolved_url = resolve_youtube_url(&resolve_playlist_url(path));
        
        cmd.args([
            "-headers", "Referer: https://www.google.com/\r\nOrigin: https://www.google.com/\r\n",
            "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
            "-reconnect", "1",
            "-reconnect_at_eof", "1",
            "-reconnect_streamed", "1",
            "-reconnect_delay_max", "4",
            "-rw_timeout", "10000000",
            "-probesize", "32768",
            "-analyzeduration", "100000",
            "-i", &resolved_url,
            "-f", "wav",
            "-acodec", "pcm_s16le",
            "-ar", "44100",
            "-ac", "2",
            "-"
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
        
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        // Kill existing process safely
        if let Some(mut old_child) = safe_lock(current_process).take() {
            let _ = old_child.kill();
            let _ = old_child.wait(); // reap zombie immediately
        }

        match cmd.spawn() {
            Ok(mut child) => {
                let stderr = child.stderr.take().unwrap();
                thread::spawn(move || {
                    let reader = std::io::BufReader::new(stderr);
                    for line in reader.lines().filter_map(|l| l.ok()) {
                        if line.contains("Error") { eprintln!("[ffmpeg-err] {}", line); }
                    }
                });
                let stdout = child.stdout.take().unwrap();
                *safe_lock(current_process) = Some(child);
                let source = symphonia::core::io::ReadOnlySource::new(stdout);
                MediaSourceStream::new(Box::new(source), Default::default())
            },
            Err(e) => return Err(format!("FFmpeg failed: {}", e)),
        }
    } else {
        let file = std::fs::File::open(path).map_err(|e| format!("File error: {}", e))?;
        MediaSourceStream::new(Box::new(file), Default::default())
    };

    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(path).extension() {
        hint.with_extension(&ext.to_string_lossy());
    } else if is_stream {
        hint.with_extension("mp3"); // Default for streams
    }

    let probed = get_probe().format(&hint, mss, &FormatOptions::default(), &MetadataOptions { 
        limit_metadata_bytes: symphonia::core::meta::Limit::Maximum(1024 * 8),
        limit_visual_bytes: symphonia::core::meta::Limit::Maximum(1) 
    }).map_err(|e| format!("Probe error: {}", e))?;

    let format = probed.format;
    
    let mut selected_track = None;
    let mut decoder = None;
    for t in format.tracks() {
        if let Ok(d) = get_codecs().make(&t.codec_params, &DecoderOptions::default()) {
            selected_track = Some(t.clone());
            decoder = Some(d);
            break;
        }
    }
    
    let track = selected_track.ok_or("No supported audio track found")?;
    let decoder = decoder.unwrap();
    let track_id = track.id;

    let rate = track.codec_params.sample_rate.unwrap_or(44100) as usize;
    let ch = track.codec_params.channels.map(|c| c.count()).unwrap_or(2);

    if is_stream {
        let _ = _app_handle.emit("playback-success", path.to_string());
    }

    Ok(DecoderInfo {
        format,
        decoder,
        track_id,
        time_base: track.codec_params.time_base,
        file_rate: rate,
        file_ch: ch,
    })
}

#[derive(Debug)]
pub enum PlayerCommand {
    Play(String, f64),
    Pause,
    Resume,
    Stop,
    Seek(f64),
    PushNext(String),
    AppendQueue(String),
    RestartStream,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub enum PlaybackStatus { Stopped, Playing, Paused }

#[derive(Clone, serde::Serialize, serde::Deserialize, Debug, PartialEq)]
pub struct EQBand {
    pub freq: f32,
    pub gain: f32,
    pub q: f32,
    pub band_type: String, // "lowshelf", "peaking", "highshelf"
}

#[derive(Clone, serde::Serialize, serde::Deserialize, Debug, PartialEq)]
pub struct DSPState {
    pub enabled: bool,
    pub width: f32,
    pub upsample_rate: u32,
    pub dither: bool,

    // EQ
    pub eq_enabled: bool,
    pub eq_parametric: bool,
    pub eq_graphic_gains: Vec<f32>,
    pub eq_parametric_bands: Vec<EQBand>,

    // Crossfeed
    pub crossfeed_enabled: bool,
    pub crossfeed_level: f32,
    pub crossfeed_corner: f32,

    // Soundstage
    pub spatial_enabled: bool,
    pub spatial_haas_delay: f32,
    pub spatial_wet: f32,

    // Dynamics
    pub subsonic_enabled: bool,
    pub night_mode_enabled: bool,
    pub r128_enabled: bool,
}

#[derive(Clone, Debug, Default)]
pub struct BiquadFilter {
    pub b0: f32,
    pub b1: f32,
    pub b2: f32,
    pub a1: f32,
    pub a2: f32,
    pub x1: f32,
    pub x2: f32,
    pub y1: f32,
    pub y2: f32,
}

impl BiquadFilter {
    pub fn new() -> Self {
        Self {
            b0: 1.0, b1: 0.0, b2: 0.0,
            a1: 0.0, a2: 0.0,
            x1: 0.0, x2: 0.0,
            y1: 0.0, y2: 0.0,
        }
    }

    #[allow(dead_code)]
    pub fn reset_state(&mut self) {
        self.x1 = 0.0;
        self.x2 = 0.0;
        self.y1 = 0.0;
        self.y2 = 0.0;
    }

    pub fn set_peaking(&mut self, fs: f32, f0: f32, gain_db: f32, q: f32) {
        let f0 = f0.clamp(10.0, fs * 0.49);
        let q = q.max(0.01);
        let a = 10.0f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * f0 / fs;
        let cos_w0 = w0.cos();
        let alpha = w0.sin() / (2.0 * q);

        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * cos_w0;
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha / a;

        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }

    pub fn set_lowshelf(&mut self, fs: f32, f0: f32, gain_db: f32, q: f32) {
        let f0 = f0.clamp(10.0, fs * 0.49);
        let q = q.max(0.01);
        let a = 10.0f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * f0 / fs;
        let cos_w0 = w0.cos();
        let alpha = w0.sin() / (2.0 * q);
        let sqrt_a = a.sqrt();

        let b0 = a * ((a + 1.0) - (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha);
        let b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0);
        let b2 = a * ((a + 1.0) - (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha);
        let a0 = (a + 1.0) + (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha;
        let a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos_w0);
        let a2 = (a + 1.0) + (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha;

        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }

    pub fn set_highshelf(&mut self, fs: f32, f0: f32, gain_db: f32, q: f32) {
        let f0 = f0.clamp(10.0, fs * 0.49);
        let q = q.max(0.01);
        let a = 10.0f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * f0 / fs;
        let cos_w0 = w0.cos();
        let alpha = w0.sin() / (2.0 * q);
        let sqrt_a = a.sqrt();

        let b0 = a * ((a + 1.0) + (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha);
        let b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0);
        let b2 = a * ((a + 1.0) + (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha);
        let a0 = (a + 1.0) - (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha;
        let a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cos_w0);
        let a2 = (a + 1.0) - (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha;

        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }

    pub fn set_highpass(&mut self, fs: f32, f0: f32, q: f32) {
        let f0 = f0.clamp(10.0, fs * 0.49);
        let q = q.max(0.01);
        let w0 = 2.0 * std::f32::consts::PI * f0 / fs;
        let cos_w0 = w0.cos();
        let alpha = w0.sin() / (2.0 * q);

        let b0 = (1.0 + cos_w0) / 2.0;
        let b1 = -(1.0 + cos_w0);
        let b2 = (1.0 + cos_w0) / 2.0;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha;

        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }

    pub fn set_lowpass(&mut self, fs: f32, f0: f32, q: f32) {
        let f0 = f0.clamp(10.0, fs * 0.49);
        let q = q.max(0.01);
        let w0 = 2.0 * std::f32::consts::PI * f0 / fs;
        let cos_w0 = w0.cos();
        let alpha = w0.sin() / (2.0 * q);

        let b0 = (1.0 - cos_w0) / 2.0;
        let b1 = 1.0 - cos_w0;
        let b2 = (1.0 - cos_w0) / 2.0;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha;

        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }

    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2 - self.a1 * self.y1 - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }
}

#[derive(Clone, Debug)]
pub struct CircularDelayLine {
    buffer: Vec<f32>,
    write_ptr: usize,
}

impl CircularDelayLine {
    pub fn new(max_delay_samples: usize) -> Self {
        Self {
            buffer: vec![0.0; max_delay_samples.max(16)],
            write_ptr: 0,
        }
    }

    pub fn push(&mut self, sample: f32) {
        self.buffer[self.write_ptr] = sample;
        self.write_ptr = (self.write_ptr + 1) % self.buffer.len();
    }

    pub fn read_delayed(&self, delay_samples: usize) -> f32 {
        let len = self.buffer.len();
        let delay_samples = delay_samples.clamp(0, len - 1);
        let read_ptr = (self.write_ptr + len - delay_samples) % len;
        self.buffer[read_ptr]
    }
}

fn find_ffmpeg_path() -> String {
    let local_path = r"C:\Users\Alirul\Downloads\Aideo_Music_Player\ffmpeg.exe";
    if std::path::Path::new(local_path).exists() { return local_path.to_string(); }
    "ffmpeg.exe".to_string()
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
    pub status: Arc<Mutex<PlaybackStatus>>,
    pub current_track: Arc<Mutex<Option<String>>>,
    pub position_secs: Arc<Mutex<f64>>,
    pub volume: Arc<Mutex<f32>>,
    pub exclusive_mode: Arc<Mutex<bool>>,
    pub dsp_state: Arc<Mutex<DSPState>>,
    pub target_device: Arc<Mutex<Option<String>>>,
    pub queue: Arc<Mutex<VecDeque<String>>>,
    pub app_handle: tauri::AppHandle,
    pub current_process: Arc<Mutex<Option<std::process::Child>>>,
    pub ffmpeg_path: String,
    pub bit_perfect: Arc<Mutex<bool>>,
    pub current_dev_rate: Arc<Mutex<u32>>,
    pub cache: Arc<Mutex<Option<CachedTrack>>>,
}

fn analyzer_loop(rx: Receiver<Vec<f32>>, app_handle: tauri::AppHandle) {
    let mut planner = FftPlanner::new();
    let fft = planner.plan_fft_forward(2048);
    let mut buffer = vec![Complex { re: 0.0, im: 0.0 }; 2048];

    // Hann window
    let mut window = vec![0.0; 2048];
    for i in 0..2048 {
        window[i] = 0.5 * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / 2047.0).cos());
    }

    while let Ok(samples) = rx.recv() {
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
        let sample_rate = 44100.0f32; // Approximation for binning
        
        for band in 0..num_bands {
            let start_freq = min_freq * (max_freq / min_freq).powf(band as f32 / num_bands as f32);
            let end_freq = min_freq * (max_freq / min_freq).powf((band + 1) as f32 / num_bands as f32);
            
            let mut start_bin = (start_freq * 2048.0 / sample_rate) as usize;
            let mut end_bin = (end_freq * 2048.0 / sample_rate) as usize;
            
            start_bin = start_bin.clamp(1, 1023);
            end_bin = end_bin.clamp(start_bin, 1023);
            
            let mut sum = 0.0;
            let mut count = 0;
            for bin in start_bin..=end_bin {
                sum += magnitudes[bin];
                count += 1;
            }
            if count > 0 {
                bands[band] = sum / count as f32;
            }
        }
        
        let _ = app_handle.emit("audio-spectrum", bands);
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        kill_current_process(&self.current_process);
    }
}

impl Player {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        let (cmd_tx, cmd_rx) = std::sync::mpsc::channel::<PlayerCommand>();
        let status = Arc::new(Mutex::new(PlaybackStatus::Stopped));
        let current_track = Arc::new(Mutex::new(None::<String>));
        let position_secs = Arc::new(Mutex::new(0.0f64));
        let volume = Arc::new(Mutex::new(1.0f32));
        let exclusive_mode = Arc::new(Mutex::new(false));
        let dsp_state = Arc::new(Mutex::new(DSPState {
            enabled: false,
            width: 1.0,
            upsample_rate: 0,
            dither: false,

            // EQ
            eq_enabled: false,
            eq_parametric: false,
            eq_graphic_gains: vec![0.0; 10],
            eq_parametric_bands: vec![
                EQBand { freq: 80.0, gain: 0.0, q: 0.7, band_type: "lowshelf".to_string() },
                EQBand { freq: 240.0, gain: 0.0, q: 1.0, band_type: "peaking".to_string() },
                EQBand { freq: 750.0, gain: 0.0, q: 1.0, band_type: "peaking".to_string() },
                EQBand { freq: 2200.0, gain: 0.0, q: 1.0, band_type: "peaking".to_string() },
                EQBand { freq: 6000.0, gain: 0.0, q: 0.7, band_type: "highshelf".to_string() },
            ],

            // Crossfeed
            crossfeed_enabled: false,
            crossfeed_level: -6.0,
            crossfeed_corner: 700.0,

            // Soundstage
            spatial_enabled: false,
            spatial_haas_delay: 7.5,
            spatial_wet: 0.15,

            // Dynamics
            subsonic_enabled: false,
            night_mode_enabled: false,
            r128_enabled: false,
        }));
        let target_device = Arc::new(Mutex::new(None::<String>));
        let queue = Arc::new(Mutex::new(VecDeque::new()));
        let current_process = Arc::new(Mutex::new(None::<std::process::Child>));
        let ffmpeg_path = find_ffmpeg_path();
        let bit_perfect = Arc::new(Mutex::new(false));
        let current_dev_rate = Arc::new(Mutex::new(0u32));
        let cache = Arc::new(Mutex::new(None::<CachedTrack>));
        
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
        let ff = ffmpeg_path.clone();

        let dr = Arc::clone(&current_dev_rate);
        let ca = Arc::clone(&cache);

        let (fft_tx, fft_rx) = crossbeam_channel::bounded::<Vec<f32>>(2);
        
        let analyzer_app = app_handle.clone();
        thread::Builder::new()
            .name("analyzer".into())
            .spawn(move || analyzer_loop(fft_rx, analyzer_app))
            .expect("Failed to spawn analyzer thread");
        
        let cmd_tx_clone = cmd_tx.clone();
        thread::Builder::new()
            .name("player".into())
            .spawn(move || player_loop(cmd_rx, cmd_tx_clone, s, c, p, v, exc, bp, dr, ca, dsp, dev, qt, cp, app, fft_tx, ff))
            .expect("Failed to spawn player thread");

        Player { cmd_tx, status, current_track, position_secs, volume, exclusive_mode, dsp_state, target_device, queue, app_handle, current_process, ffmpeg_path, bit_perfect, current_dev_rate, cache }
    }
}

fn player_loop(
    rx: std::sync::mpsc::Receiver<PlayerCommand>,
    cmd_tx: std::sync::mpsc::Sender<PlayerCommand>,
    status: Arc<Mutex<PlaybackStatus>>,
    current_track: Arc<Mutex<Option<String>>>,
    position_secs: Arc<Mutex<f64>>,
    volume: Arc<Mutex<f32>>,
    exclusive_mode: Arc<Mutex<bool>>,
    bit_perfect: Arc<Mutex<bool>>,
    current_dev_rate: Arc<Mutex<u32>>,
    cache: Arc<Mutex<Option<CachedTrack>>>,
    dsp_state: Arc<Mutex<DSPState>>,
    target_device: Arc<Mutex<Option<String>>>,
    queue: Arc<Mutex<VecDeque<String>>>,
    current_process: Arc<Mutex<Option<std::process::Child>>>,
    app_handle: tauri::AppHandle,
    fft_tx: Sender<Vec<f32>>,
    ffmpeg_path: String,
) {
    let mut next_track: Option<(String, f64)> = None;

    loop {
        let cmd = if let Some((path, pos)) = next_track.take() {
            PlayerCommand::Play(path, pos)
        } else {
            match rx.recv() {
                Ok(c) => c,
                Err(_) => break,
            }
        };

        match cmd {
            PlayerCommand::Play(mut path, mut start_pos) => {
                // 🚀 DRAIN / DEBOUNCE QUEUE: If the user spammed 'Next', grab the absolute latest track
                // and skip the intermediate ones to save CPU, disk IO, and prevent UI bouncing.
                let mut abort_play = false;
                let mut deferred_commands = Vec::new();
                while let Ok(next_cmd) = rx.try_recv() {
                    match next_cmd {
                        PlayerCommand::Play(p, pos) => {
                            println!("[player] Rapid skip detected: Dropping '{}', jumping straight to '{}'", path, p);
                            path = p;
                            start_pos = pos;
                        }
                        PlayerCommand::Stop => {
                            abort_play = true;
                            break;
                        }
                        other => {
                            deferred_commands.push(other);
                        }
                    }
                }

                if abort_play {
                    let mut s = safe_lock(&status);
                    *s = PlaybackStatus::Stopped;
                    let mut ct = safe_lock(&current_track);
                    *ct = None;
                    continue;
                }

                // Re-inject deferred commands back into the channel so they get processed in order
                for deferred in deferred_commands {
                    let _ = cmd_tx.send(deferred);
                }

                {
                    let mut s = safe_lock(&status);
                    *s = PlaybackStatus::Playing;
                    let mut ct = safe_lock(&current_track);
                    *ct = Some(path.clone());
                    let mut pos = safe_lock(&position_secs);
                    *pos = start_pos;
                }

                next_track = play_file(&path, start_pos, Arc::clone(&status), Arc::clone(&current_track), Arc::clone(&position_secs), Arc::clone(&volume), Arc::clone(&exclusive_mode), Arc::clone(&bit_perfect), Arc::clone(&current_dev_rate), Arc::clone(&cache), Arc::clone(&dsp_state), Arc::clone(&target_device), Arc::clone(&queue), Arc::clone(&current_process), cmd_tx.clone(), &rx, &app_handle, &fft_tx, &ffmpeg_path);

                if next_track.is_none() {
                    let mut s = safe_lock(&status);
                    *s = PlaybackStatus::Stopped;
                    let mut ct = safe_lock(&current_track);
                    *ct = None;
                    *safe_lock(&position_secs) = 0.0;
                }
            }
            PlayerCommand::RestartStream => {
                let (path, pos) = {
                    let ct = safe_lock(&current_track);
                    let ps = safe_lock(&position_secs);
                    if let Some(p) = ct.clone() { (p, *ps) } else { continue; }
                };
                // Throttle restarts slightly to avoid spamming the CPU/audio drivers in case of hard failure
                std::thread::sleep(std::time::Duration::from_millis(250));
                next_track = Some((path, pos));
            }
            PlayerCommand::PushNext(path) => {
                safe_lock(&queue).push_front(path);
            }
            PlayerCommand::AppendQueue(path) => {
                safe_lock(&queue).push_back(path);
            }
            _ => {} 
        }
    }
}


/// Soft limiter — prevents digital clipping on heavy boosts
fn kill_current_process(current_process: &Arc<Mutex<Option<std::process::Child>>>) {
    if let Some(mut child) = safe_lock(&current_process).take() {
        let _ = child.kill();
        let _ = child.wait(); // reap zombie process immediately
    }
}

fn soft_limit(sample: f32) -> f32 {
    let abs = sample.abs();
    if abs > 0.90 {
        let sign = if sample > 0.0 { 1.0 } else { -1.0 };
        let over = abs - 0.90;
        // Asymptotically approach 1.0 (limit overage to max 0.1)
        let compressed = over / (1.0 + over * 10.0);
        sign * (0.90 + compressed)
    } else {
        sample
    }
}

fn background_decode(
    path: String,
    samples: Arc<Mutex<Vec<Vec<f32>>>>,
    complete: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
) {
    let file = match std::fs::File::open(&path) {
        Ok(f) => f,
        Err(_) => return,
    };
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(&path).extension() {
        hint.with_extension(&ext.to_string_lossy());
    }

    let probed = match get_probe().format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default()) {
        Ok(p) => p,
        Err(_) => return,
    };
    let mut format = probed.format;
    
    let mut selected_track = None;
    let mut decoder = None;
    for t in format.tracks() {
        if let Ok(d) = get_codecs().make(&t.codec_params, &DecoderOptions::default()) {
            selected_track = Some(t.clone());
            decoder = Some(d);
            break;
        }
    }
    
    let track = match selected_track {
        Some(t) => t,
        None => return,
    };
    let track_id = track.id;
    let mut decoder = decoder.unwrap();

    let file_ch = {
        let lock = safe_lock(&samples);
        lock.len()
    };
    let mut local_buffers = vec![Vec::new(); file_ch];
    let mut packet_count = 0;

    loop {
        if shutdown.load(Ordering::Relaxed) { break; }
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(_) => break,
        };

        if packet.track_id() != track_id { continue; }

        if let Ok(decoded) = decoder.decode(&packet) {
            let n_frames = decoded_frames(&decoded);
            for ch in 0..file_ch {
                let src: Vec<f32> = match &decoded {
                    AudioBufferRef::F32(b) => b.chan(ch).to_vec(),
                    AudioBufferRef::S16(b) => b.chan(ch).iter().map(|&s| s as f32 / i16::MAX as f32).collect(),
                    AudioBufferRef::S32(b) => b.chan(ch).iter().map(|&s| s as f32 / i32::MAX as f32).collect(),
                    AudioBufferRef::U8(b)  => b.chan(ch).iter().map(|&s| (s as f32 - 128.0) / 128.0).collect(),
                    AudioBufferRef::S24(b) => b.chan(ch).iter().map(|&s| s.inner() as f32 / 8_388_607.0).collect(),
                    AudioBufferRef::F64(b) => b.chan(ch).iter().map(|&s| s as f32).collect(),
                    _ => vec![0.0; n_frames],
                };
                local_buffers[ch].extend(src);
            }
            
            packet_count += 1;
            if packet_count >= 64 {
                let mut lock = safe_lock(&samples);
                for ch in 0..file_ch {
                    lock[ch].extend(local_buffers[ch].drain(..));
                }
                packet_count = 0;
            }
        }
    }

    if packet_count > 0 {
        let mut lock = safe_lock(&samples);
        for ch in 0..file_ch {
            lock[ch].extend(local_buffers[ch].drain(..));
        }
    }
    complete.store(true, Ordering::SeqCst);
}


fn play_file(
    path: &str,
    start_pos: f64,
    status: Arc<Mutex<PlaybackStatus>>,
    current_track: Arc<Mutex<Option<String>>>,
    position_secs: Arc<Mutex<f64>>,
    volume: Arc<Mutex<f32>>,
    exclusive_mode: Arc<Mutex<bool>>,
    bit_perfect: Arc<Mutex<bool>>,
    current_dev_rate: Arc<Mutex<u32>>,
    cache: Arc<Mutex<Option<CachedTrack>>>,
    dsp_state: Arc<Mutex<DSPState>>,
    target_device: Arc<Mutex<Option<String>>>,
    queue: Arc<Mutex<VecDeque<String>>>,
    current_process: Arc<Mutex<Option<std::process::Child>>>,
    cmd_tx: std::sync::mpsc::Sender<PlayerCommand>,
    rx: &std::sync::mpsc::Receiver<PlayerCommand>,
    app_handle: &tauri::AppHandle,
    fft_tx: &Sender<Vec<f32>>,
    ffmpeg_path: &str,
) -> Option<(String, f64)> {
    // ELEVATE AUDIO PUMP THREAD PRIORITY
    #[cfg(target_os = "windows")]
    unsafe {
        let _ = windows::Win32::System::Threading::SetThreadPriority(
            windows::Win32::System::Threading::GetCurrentThread(),
            windows::Win32::System::Threading::THREAD_PRIORITY_TIME_CRITICAL,
        );
    }

    *safe_lock(&current_track) = Some(path.to_string());
    
    // 1. Initialize Decoder
    let info = match prepare_decoder(path, app_handle, ffmpeg_path, &current_process) {
        Ok(i) => i,
        Err(e) => {
            kill_current_process(&current_process); // Ensure dead process is reaped immediately
            let _ = app_handle.emit("playback-error", e);
            return None;
        }
    };

    let file_rate = info.file_rate;
    let file_ch = info.file_ch;
    let track_id = info.track_id;
    let mut format = info.format;
    let mut decoder = info.decoder;
    let time_base = info.time_base;

    let is_exclusive = *safe_lock(&exclusive_mode);
    let is_stream = path.starts_with("http://") || path.starts_with("https://");

    // 2. PRE-DECODE INTO RAM (if not a stream)
    let decode_shutdown = Arc::new(AtomicBool::new(false));
    let (decoded_samples, is_complete) = if !is_stream {
        let mut cache_lock = safe_lock(&cache);
        let use_cached = if let Some(cached) = &*cache_lock {
            if cached.path == path { Some(cached.clone()) } else { None }
        } else { None };

        if let Some(cached) = use_cached {
            (Some(cached.samples), Some(cached.complete))
        } else {
            let samples = Arc::new(Mutex::new(vec![Vec::new(); file_ch]));
            let complete = Arc::new(AtomicBool::new(false));
            let cached = CachedTrack {
                path: path.to_string(),
                samples: Arc::clone(&samples),
                complete: Arc::clone(&complete),
                file_rate,
                file_ch,
                time_base,
            };
            *cache_lock = Some(cached);
            
            let path_str = path.to_string();
            let s_clone = Arc::clone(&samples);
            let c_clone = Arc::clone(&complete);
            let sd_clone = Arc::clone(&decode_shutdown);
            thread::spawn(move || {
                background_decode(path_str, s_clone, c_clone, sd_clone);
            });
            
            (Some(samples), Some(complete))
        }
    } else {
        (None, None)
    };

    let mut target = safe_lock(&target_device).clone();

    let host = if let Some(ref name) = target {
        if name.starts_with("[ASIO]") {
            #[cfg(target_os = "windows")]
            { cpal::host_from_id(cpal::HostId::Asio).unwrap_or(cpal::default_host()) }
            #[cfg(not(target_os = "windows"))]
            { cpal::default_host() }
        } else {
            cpal::default_host()
        }
    } else {
        cpal::default_host()
    };

    let device = {
        let (dev, tried_target) = if let Some(ref full_name) = target {
            let actual_name = if full_name.starts_with("[ASIO] ") {
                full_name.trim_start_matches("[ASIO] ").to_string()
            } else if full_name.starts_with("[WASAPI] ") {
                full_name.trim_start_matches("[WASAPI] ").to_string()
            } else {
                full_name.clone()
            };
            
            #[allow(deprecated)]
            let found_dev = match host.output_devices() {
                Ok(mut ds) => ds.find(|d| d.name().unwrap_or_default() == actual_name),
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
            *safe_lock(&target_device) = None;
            target = None;
            let _ = app_handle.emit("ui-toast", serde_json::json!({
                "message": "Audio device disconnected. Falling back to default.",
                "type": "warning"
            }));
        }
        
        match dev.or_else(|| host.default_output_device()) {
            Some(d) => d,
            None => {
                cpal::default_host().default_output_device().expect("No audio device available at all")
            }
        }
    };

    let device_display_name = target.clone().unwrap_or_else(|| "Default Device".to_string());
    
    let upsample_target = safe_lock(&dsp_state).upsample_rate;
    let configs_to_try = select_output_config(
        &device,
        file_rate,
        file_ch,
        is_exclusive,
        is_stream,
        upsample_target,
        &device_display_name,
    );

    let mut stream_info: Option<(ActiveStream, cpal::StreamConfig)> = None;
    let mut output_bits = 32;
    let mut is_float = true;
    let mut prod_opt = None;
    let flush_signal = Arc::new(AtomicBool::new(false));

    // Determine if we should attempt EXCLUSIVE mode
    // (Only for local files and when Bit-Perfect/Upsampling is requested)
    let request_exclusive = is_exclusive && !is_stream;

    let stream_paused = Arc::new(AtomicBool::new(false));
    let stream_volume = Arc::new(std::sync::atomic::AtomicU32::new(1.0f32.to_bits()));

    if request_exclusive && !device_display_name.starts_with("[ASIO]") {
        if let Some((config, _)) = configs_to_try.first() {
            let rate = config.sample_rate;
            let channels = config.channels;
            
            let max_ring = rate as usize * channels as usize * 3;
            let rb = RingBuffer::<f32>::new(max_ring);
            let (prod, mut cons) = rb.split();
            
            let paused_cb = Arc::clone(&stream_paused);
            let volume_cb = Arc::clone(&stream_volume);
            let flush_cb = Arc::clone(&flush_signal);

            let actual_dev_name = if device_display_name.starts_with("[WASAPI] ") {
                device_display_name.trim_start_matches("[WASAPI] ").to_string()
            } else {
                device_display_name.clone()
            };

            let cmd_tx_cb = cmd_tx.clone();
            let app_handle_cb = app_handle.clone();
            if let Ok((wasapi_stream, bits, float)) = crate::wasapi_engine::start_exclusive_stream(
                &actual_dev_name,
                rate,
                channels,
                move |data: &mut [f32]| {
                    if paused_cb.load(Ordering::Relaxed) { data.fill(0.0); return; }
                    if flush_cb.swap(false, Ordering::SeqCst) { let l = cons.len(); cons.discard(l); }
                    let vol = f32::from_bits(volume_cb.load(Ordering::Relaxed));
                    let mut n = cons.pop_slice(data);
                    if n < data.len() {
                        n += cons.pop_slice(&mut data[n..]);
                    }
                    for i in 0..n { data[i] *= vol; }
                    if n < data.len() { data[n..].fill(0.0); }
                },
                move |err| {
                    eprintln!("[player] WASAPI Exclusive stream error: {err}");
                    let _ = app_handle_cb.emit("ui-toast", serde_json::json!({
                        "message": format!("Exclusive device error: {}. Recovering...", err),
                        "type": "error"
                    }));
                    let _ = cmd_tx_cb.send(PlayerCommand::RestartStream);
                }
            ) {
                println!("[player] Successfully locked TRUE WASAPI Exclusive Mode!");
                let _ = app_handle.emit("playback-success", "WASAPI Exclusive Mode Active");
                stream_info = Some((ActiveStream::Wasapi(wasapi_stream), config.clone()));
                prod_opt = Some(prod);
                output_bits = bits;
                is_float = float;
            } else {
                println!("[player] TRUE WASAPI Exclusive Mode failed. Falling back to CPAL Shared Mode.");
                let _ = app_handle.emit("playback-error", "Device does not support WASAPI Exclusive Mode. Falling back to Shared Mode.");
                *safe_lock(&exclusive_mode) = false;
            }
        }
    }

    if stream_info.is_none() {
        for (config, sample_format) in configs_to_try {
        let paused_cb = Arc::clone(&stream_paused);
        let volume_cb = Arc::clone(&stream_volume);
        let flush_cb = Arc::clone(&flush_signal);
        
        // Compute max ring size (3 seconds of audio at target rate)
        let rate = config.sample_rate as usize;
        let channels = config.channels as usize;
        let max_ring = rate * channels * 3;
        
        let rb = RingBuffer::<f32>::new(max_ring);
        let (prod, mut cons) = rb.split();

        let config_inner = config.clone();

        let mut buf = vec![0.0f32; 8192];
        
        // 🛡️ TRUTH: For strict ASIO drivers, we must match the hardware's expected format exactly.
        let stream_res = match sample_format {
            cpal::SampleFormat::F32 => {
                let cmd_tx_cb = cmd_tx.clone();
                let app_handle_cb = app_handle.clone();
                device.build_output_stream(
                    &config_inner,
                    move |data: &mut [f32], _| {
                        if paused_cb.load(Ordering::Relaxed) { data.fill(0.0); return; }
                        if flush_cb.swap(false, Ordering::SeqCst) { let l = cons.len(); cons.discard(l); }
                        let vol = f32::from_bits(volume_cb.load(Ordering::Relaxed));
                        let mut n = cons.pop_slice(data);
                        if n < data.len() {
                            n += cons.pop_slice(&mut data[n..]);
                        }
                        for i in 0..n { 
                            let s = data[i] * vol;
                            data[i] = if s > 1.0 { 1.0 } else if s < -1.0 { -1.0 } else { s };
                        }
                        if n < data.len() { data[n..].fill(0.0); }
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
                device.build_output_stream(
                    &config_inner,
                    move |data: &mut [i16], _| {
                        if paused_cb.load(Ordering::Relaxed) { data.fill(0); return; }
                        if flush_cb.swap(false, Ordering::SeqCst) { let l = cons.len(); cons.discard(l); }
                        let vol = f32::from_bits(volume_cb.load(Ordering::Relaxed));
                        if buf.len() < data.len() { buf.resize(data.len(), 0.0); }
                        let mut n = cons.pop_slice(&mut buf[..data.len()]);
                        if n < data.len() {
                            n += cons.pop_slice(&mut buf[n..data.len()]);
                        }
                        for i in 0..n { 
                            let s = buf[i] * vol;
                            let clamped = if s > 1.0 { 1.0 } else if s < -1.0 { -1.0 } else { s };
                            data[i] = (clamped * i16::MAX as f32) as i16; 
                        }
                        if n < data.len() { data[n..].fill(0); }
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
                device.build_output_stream(
                    &config_inner,
                    move |data: &mut [i32], _| {
                        if paused_cb.load(Ordering::Relaxed) { data.fill(0); return; }
                        if flush_cb.swap(false, Ordering::SeqCst) { let l = cons.len(); cons.discard(l); }
                        let vol = f32::from_bits(volume_cb.load(Ordering::Relaxed));
                        if buf.len() < data.len() { buf.resize(data.len(), 0.0); }
                        let mut n = cons.pop_slice(&mut buf[..data.len()]);
                        if n < data.len() {
                            n += cons.pop_slice(&mut buf[n..data.len()]);
                        }
                        
                        // Handle I32/I24 (padded)
                        for i in 0..n { 
                            let s = buf[i] * vol;
                            let clamped = if s > 1.0 { 1.0 } else if s < -1.0 { -1.0 } else { s };
                            data[i] = (clamped * i32::MAX as f32) as i32; 
                        }
                        if n < data.len() { data[n..].fill(0); }
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
            let _ = s.play();
            println!("[player] AUDIOPHILE: Exclusive hardware stream established!");
            println!("         -> Host: {:?}", host.id());
            println!("         -> Rate: {}Hz", config.sample_rate);
            stream_info = Some((ActiveStream::Cpal(s), config));
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
            break;
        } else if let Err(e) = stream_res {
            eprintln!("[player] Could not establish exclusive stream: {}.", e);
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
        let _ = app_handle.emit("playback-error", msg);

        // EMERGENCY FALLBACK: Try Default Host and Default Device
        let host = cpal::default_host();
        if let Some(dev) = host.default_output_device() {
            if let Ok(def_cfg) = dev.default_output_config() {
                let cfg = def_cfg.config();
                let fmt = def_cfg.sample_format();
                let paused_cb = Arc::clone(&stream_paused);
                let volume_cb = Arc::clone(&stream_volume);
                let flush_cb = Arc::clone(&flush_signal);
                let rb = RingBuffer::<f32>::new(cfg.sample_rate as usize * cfg.channels as usize * 3);
                let (prod, mut cons) = rb.split();
                
                let mut buf = vec![0.0f32; 8192];
                let stream_res = match fmt {
                    cpal::SampleFormat::F32 => {
                        let cmd_tx_cb = cmd_tx.clone();
                        let app_handle_cb = app_handle.clone();
                        dev.build_output_stream(&cfg, move |d: &mut [f32], _| {
                            if paused_cb.load(Ordering::Relaxed) { d.fill(0.0); return; }
                            if flush_cb.swap(false, Ordering::SeqCst) { let l = cons.len(); cons.discard(l); }
                            let vol = f32::from_bits(volume_cb.load(Ordering::Relaxed));
                            let mut n = cons.pop_slice(d);
                            if n < d.len() {
                                n += cons.pop_slice(&mut d[n..]);
                            }
                            for i in 0..n { d[i] *= vol; }
                            if n < d.len() { d[n..].fill(0.0); }
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
                        dev.build_output_stream(&cfg, move |d: &mut [i16], _| {
                            if paused_cb.load(Ordering::Relaxed) { d.fill(0); return; }
                            if flush_cb.swap(false, Ordering::SeqCst) { let l = cons.len(); cons.discard(l); }
                            let vol = f32::from_bits(volume_cb.load(Ordering::Relaxed));
                            if buf.len() < d.len() { buf.resize(d.len(), 0.0); }
                            let mut n = cons.pop_slice(&mut buf[..d.len()]);
                            if n < d.len() {
                                n += cons.pop_slice(&mut buf[n..d.len()]);
                            }
                            for i in 0..n { d[i] = (buf[i] * vol * i16::MAX as f32) as i16; }
                            if n < d.len() { d[n..].fill(0); }
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
                    let _ = s.play();
                    stream_info = Some((ActiveStream::Cpal(s), cfg));
                    prod_opt = Some(prod);
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
                }
            }
        }
    }

    let (stream, config) = match stream_info {
        Some(i) => i,
        None => {
            let _ = app_handle.emit("playback-error", "Total audio system failure. Please restart app.");
            return None;
        }
    };
    
    let mut prod = prod_opt.unwrap();

    let dev_rate = config.sample_rate as usize;
    let dev_ch   = config.channels as usize;
    let use_ch   = file_ch.min(dev_ch);
    
    // REPORT ACTUAL HARDWARE RATE
    *safe_lock(&current_dev_rate) = dev_rate as u32;

    let chunk_size = 8192usize;

    // Create persistent DSP filter and delay line instances
    let mut graphic_eq_l = vec![BiquadFilter::new(); 10];
    let mut graphic_eq_r = vec![BiquadFilter::new(); 10];
    let mut parametric_eq_l = vec![BiquadFilter::new(); 5];
    let mut parametric_eq_r = vec![BiquadFilter::new(); 5];

    let mut subsonic_l = BiquadFilter::new();
    let mut subsonic_r = BiquadFilter::new();

    let mut crossfeed_lp_l = BiquadFilter::new();
    let mut crossfeed_lp_r = BiquadFilter::new();
    let mut crossfeed_delay_l = CircularDelayLine::new(192000);
    let mut crossfeed_delay_r = CircularDelayLine::new(192000);

    let mut spatial_delay_side = CircularDelayLine::new(192000);

    let mut compressor_envelope = 0.0f32;
    let mut r128_slow_rms = 0.0001f32;
    let mut r128_agc_gain = 1.0f32;

    let mut last_calculated_rate = 0usize;
    let mut last_dsp_params: Option<DSPState> = None;

    let mut current_dsp = safe_lock(&dsp_state).clone();
    let mut fft_buffer = Vec::with_capacity(2048);

    let mut resampler = match SincFixedIn::<f32>::new(
        dev_rate as f64 / file_rate as f64,
        2.0,
        SincInterpolationParameters {
            sinc_len: 256,
            f_cutoff: 0.98,
            interpolation: SincInterpolationType::Linear,
            oversampling_factor: 256,
            window: WindowFunction::BlackmanHarris2,
        },
        chunk_size,
        file_ch
    ) {
        Ok(r) => r,
        Err(e) => {
            let msg = format!("Resampler error: {}. Hardware rate {}Hz might be incompatible.", e, dev_rate);
            eprintln!("[player] {}", msg);
            let _ = app_handle.emit("playback-error", msg);
            return None;
        }
    };

    let mut pending: Vec<VecDeque<f32>> = vec![VecDeque::new(); file_ch];
    let mut running = true;
    let mut next_track_info: Option<(String, f64)> = None;
    let last_exclusive = is_exclusive;
    let bp_now = *safe_lock(&bit_perfect);
    let last_bit_perfect = bp_now;
    let last_upsample_rate = upsample_target;
    let is_stream = path.starts_with("http://") || path.starts_with("https://");

    // RAM BUFFER CURSOR
    let mut ram_cursor = (start_pos * file_rate as f64) as usize;

    while running {
        loop {
            match rx.try_recv() {
                Ok(PlayerCommand::Stop) => { running = false; break; }
                Ok(PlayerCommand::Pause) => { *safe_lock(&status) = PlaybackStatus::Paused; }
                Ok(PlayerCommand::Resume) => { *safe_lock(&status) = PlaybackStatus::Playing; }
                Ok(PlayerCommand::Play(p, pos)) => { running = false; next_track_info = Some((p, pos)); break; }
                Ok(PlayerCommand::Seek(secs)) => {
                    if let Some(samples_arc) = &decoded_samples {
                        let lock = safe_lock(&samples_arc);
                        ram_cursor = (secs * file_rate as f64) as usize;
                        if ram_cursor >= lock[0].len() { 
                            if is_complete.as_ref().map(|c| c.load(Ordering::SeqCst)).unwrap_or(true) {
                                ram_cursor = lock[0].len().saturating_sub(1); 
                            }
                        }
                    } else if !is_stream {
                        if let Some(tb) = time_base {
                            let seek_ts = (secs * tb.denom as f64 / tb.numer as f64) as u64;
                            let _ = format.seek(SeekMode::Accurate, SeekTo::TimeStamp { ts: seek_ts, track_id });
                        }
                    }
                    *safe_lock(&position_secs) = secs;
                    flush_signal.store(true, Ordering::SeqCst);
                    pending.iter_mut().for_each(|ch| ch.clear());
                }
                Ok(PlayerCommand::PushNext(path)) => {
                    safe_lock(&queue).push_front(path);
                }
                Ok(PlayerCommand::AppendQueue(path)) => {
                    safe_lock(&queue).push_back(path);
                }
                Ok(PlayerCommand::RestartStream) => {
                    let current_pos = *safe_lock(&position_secs);
                    running = false;
                    next_track_info = Some((path.to_string(), current_pos));
                    break;
                }
                Err(_) => break,
            }
        }
        if !running { break; }
        let exc_now = *safe_lock(&exclusive_mode);
        let bp_now = *safe_lock(&bit_perfect);
        let dsp_now = safe_lock(&dsp_state).clone();
        
        // ONLY restart if values actually changed from what we started with
        if exc_now != last_exclusive || bp_now != last_bit_perfect || dsp_now.upsample_rate != last_upsample_rate {
            println!("[player] Hardware/DSP change detected (Bit-Perfect: {}). Restarting stream...", bp_now);
            let current_pos = *safe_lock(&position_secs);
            next_track_info = Some((path.to_string(), current_pos));
            break;
        }
        // UPDATE ATOMICS FOR STREAM
        let is_paused = *safe_lock(&status) == PlaybackStatus::Paused;
        stream_paused.store(is_paused, Ordering::Relaxed);
        let current_vol = *safe_lock(&volume);
        stream_volume.store(current_vol.to_bits(), Ordering::Relaxed);

        // FILL PENDING BUFFER
        if pending[0].len() < chunk_size * 4 {
            if let Some(samples_arc) = &decoded_samples {
                // READ FROM RAM (Possibly still loading)
                let lock = safe_lock(&samples_arc);
                if ram_cursor < lock[0].len() {
                    let to_read = (lock[0].len() - ram_cursor).min(chunk_size * 8);
                    for ch in 0..file_ch {
                        pending[ch].extend(&lock[ch][ram_cursor..ram_cursor+to_read]);
                    }
                    ram_cursor += to_read;
                    // Position update moved to end of loop for better accuracy
                } else if is_complete.as_ref().map(|c| c.load(Ordering::SeqCst)).unwrap_or(true) {
                    // Only break the loop if there are no more samples in pending to resample!
                    if pending[0].len() < chunk_size {
                        // RAM EOF - Check queue
                        let next_queued = safe_lock(&queue).pop_front();
                        if let Some(npath) = next_queued {
                            next_track_info = Some((npath, 0.0));
                        }
                        break;
                    }
                } else {
                    // STILL LOADING
                    if pending[0].len() < chunk_size {
                        std::thread::sleep(std::time::Duration::from_millis(15));
                    }
                }
            } else {
                // FALLBACK TO CHUNKED (STREAMS)
                let packet = match format.next_packet() {
                    Ok(p) => p,
                    Err(_) => break,
                };
                if packet.track_id() == track_id {
                    if let Some(_tb) = time_base {
                        // Position update moved to end of loop
                    }
                    if let Ok(decoded) = decoder.decode(&packet) {
                        for ch in 0..file_ch {
                            let src: Vec<f32> = match &decoded {
                                AudioBufferRef::F32(b) => b.chan(ch).to_vec(),
                                AudioBufferRef::S16(b) => b.chan(ch).iter().map(|&s| s as f32 / i16::MAX as f32).collect(),
                                AudioBufferRef::S32(b) => b.chan(ch).iter().map(|&s| s as f32 / i32::MAX as f32).collect(),
                                _ => vec![0.0; decoded_frames(&decoded)],
                            };
                            pending[ch].extend(src);
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

        if dsp_dirty && current_dsp.enabled {
            let fs = dev_rate as f32;

            // 1. Graphic EQ (10 bands)
            let graphic_freqs = [31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0];
            for j in 0..10 {
                let gain_db = current_dsp.eq_graphic_gains.get(j).cloned().unwrap_or(0.0);
                graphic_eq_l[j].set_peaking(fs, graphic_freqs[j], gain_db, 1.0);
                graphic_eq_r[j].set_peaking(fs, graphic_freqs[j], gain_db, 1.0);
            }

            // 2. Parametric EQ (5 bands)
            for j in 0..5 {
                if let Some(band) = current_dsp.eq_parametric_bands.get(j) {
                    match band.band_type.as_str() {
                        "lowshelf" => {
                            parametric_eq_l[j].set_lowshelf(fs, band.freq, band.gain, band.q);
                            parametric_eq_r[j].set_lowshelf(fs, band.freq, band.gain, band.q);
                        }
                        "highshelf" => {
                            parametric_eq_l[j].set_highshelf(fs, band.freq, band.gain, band.q);
                            parametric_eq_r[j].set_highshelf(fs, band.freq, band.gain, band.q);
                        }
                        _ => {
                            parametric_eq_l[j].set_peaking(fs, band.freq, band.gain, band.q);
                            parametric_eq_r[j].set_peaking(fs, band.freq, band.gain, band.q);
                        }
                    }
                }
            }

            // 3. Subsonic High-Pass Filter (Q=0.707 Butterworth)
            subsonic_l.set_highpass(fs, 18.0, 0.707);
            subsonic_r.set_highpass(fs, 18.0, 0.707);

            // 4. Headphone Crossfeed Corner Low-Pass
            crossfeed_lp_l.set_lowpass(fs, current_dsp.crossfeed_corner, 0.5);
            crossfeed_lp_r.set_lowpass(fs, current_dsp.crossfeed_corner, 0.5);
        }
        
        'resample: loop {
            if pending[0].len() < chunk_size { break 'resample; }
            
            let mut chunk_planar = vec![vec![0.0; chunk_size]; file_ch];
            for ch in 0..file_ch {
                for i in 0..chunk_size {
                    if let Some(s) = pending[ch].pop_front() {
                        chunk_planar[ch][i] = s;
                    }
                }
            }

            let is_bp = bp_now && file_rate == dev_rate && file_ch == dev_ch && !current_dsp.enabled;
            
            let (out_planar, n_out) = if is_bp {
                (chunk_planar, chunk_size)
            } else {
                let refs: Vec<&[f32]> = chunk_planar.iter().map(|v| v.as_slice()).collect();
                let mut processed = match resampler.process(&refs, None) {
                    Ok(o) => o,
                    Err(_) => break 'resample,
                };
                
                let final_gain = if current_dsp.enabled { 0.95 } else { 1.0 };

                if current_dsp.enabled && use_ch >= 2 {
                    for i in 0..processed[0].len() {
                        let mut l = processed[0][i];
                        let mut r = processed[1][i];

                        // 1. Equalizers
                        if current_dsp.eq_enabled {
                            if current_dsp.eq_parametric {
                                for j in 0..5 {
                                    l = parametric_eq_l[j].process(l);
                                    r = parametric_eq_r[j].process(r);
                                }
                            } else {
                                for j in 0..10 {
                                    l = graphic_eq_l[j].process(l);
                                    r = graphic_eq_r[j].process(r);
                                }
                            }
                        }

                        // 2. High-Pass Subsonic Rumble Filter (Cut below 18Hz)
                        if current_dsp.subsonic_enabled {
                            l = subsonic_l.process(l);
                            r = subsonic_r.process(r);
                        }

                        // 3. Headphone Crossfeed (Linkwitz/Chu Moy)
                        if current_dsp.crossfeed_enabled {
                            let lp_l = crossfeed_lp_l.process(l);
                            let lp_r = crossfeed_lp_r.process(r);

                            crossfeed_delay_l.push(lp_l);
                            crossfeed_delay_r.push(lp_r);

                            let delay_samples = ((0.000300 * dev_rate as f64).round() as usize).clamp(1, 1000);
                            let delayed_l = crossfeed_delay_l.read_delayed(delay_samples);
                            let delayed_r = crossfeed_delay_r.read_delayed(delay_samples);

                            let feed_gain = 10.0f32.powf(current_dsp.crossfeed_level / 20.0);
                            l = l + delayed_r * feed_gain;
                            r = r + delayed_l * feed_gain;
                        }

                        // 4. Haas Spatializer & Reflections soundstage
                        if current_dsp.spatial_enabled {
                            let mid = (l + r) * 0.5;
                            let side = (l - r) * 0.5;

                            spatial_delay_side.push(side);

                            let ref1_samples = ((0.0030 * dev_rate as f64).round() as usize).clamp(1, 2047);
                            let ref2_samples = ((0.0055 * dev_rate as f64).round() as usize).clamp(1, 2047);
                            let ref3_samples = ((0.0082 * dev_rate as f64).round() as usize).clamp(1, 2047);
                            let ref4_samples = ((0.0110 * dev_rate as f64).round() as usize).clamp(1, 2047);

                            let ref1 = spatial_delay_side.read_delayed(ref1_samples) * 0.08;
                            let ref2 = spatial_delay_side.read_delayed(ref2_samples) * -0.06;
                            let ref3 = spatial_delay_side.read_delayed(ref3_samples) * 0.04;
                            let ref4 = spatial_delay_side.read_delayed(ref4_samples) * -0.03;

                            let reflections = (ref1 + ref2 + ref3 + ref4) * current_dsp.spatial_wet;

                            let haas_samples = ((current_dsp.spatial_haas_delay * 0.001 * dev_rate as f32).round() as usize).clamp(1, 2047);
                            let side_delayed = spatial_delay_side.read_delayed(haas_samples);
                            let side_room = side_delayed + reflections;

                            let intensity = current_dsp.spatial_wet;
                            let theta = (intensity * std::f32::consts::FRAC_PI_4).clamp(0.0, std::f32::consts::FRAC_PI_2);
                            let cos_t = theta.cos();
                            let sin_t = theta.sin();

                            l = mid * cos_t + side_room * sin_t;
                            r = mid * cos_t - side_room * sin_t;
                        }

                        // 5. Dynamics Night Mode Compressor (2.5:1 ratio)
                        if current_dsp.night_mode_enabled {
                            let rectified = l.abs().max(r.abs());
                            let attack_coef = (-1.0f32 / (0.010 * dev_rate as f32)).exp();  // 10ms
                            let release_coef = (-1.0f32 / (0.100 * dev_rate as f32)).exp(); // 100ms
                            
                            compressor_envelope = if rectified > compressor_envelope {
                                compressor_envelope * attack_coef + rectified * (1.0 - attack_coef)
                            } else {
                                compressor_envelope * release_coef + rectified * (1.0 - release_coef)
                            };

                            let threshold = 0.063f32; // -24dBFS
                            let ratio = 2.5f32;
                            if compressor_envelope > threshold {
                                let env_db = 20.0 * compressor_envelope.log10().max(-100.0);
                                let thresh_db = -24.0f32;
                                let overshoot = env_db - thresh_db;
                                let target_gain_db = -overshoot * (1.0 - 1.0 / ratio);
                                let gain = 10.0f32.powf(target_gain_db / 20.0);
                                l *= gain;
                                r *= gain;
                            }
                        }

                        // 6. EBU R128 Loudness Match slow AGC
                        if current_dsp.r128_enabled {
                            let rectified = (l * l).max(r * r);
                            let rms_alpha = (-1.0f32 / (3.0 * dev_rate as f32)).exp();
                            r128_slow_rms = r128_slow_rms * rms_alpha + rectified * (1.0 - rms_alpha);

                            let cur_lufs = 10.0 * r128_slow_rms.log10().max(-100.0) - 0.69;
                            let target_lufs = -14.0f32;
                            let diff = target_lufs - cur_lufs;

                            let target_gain = 10.0f32.powf(diff / 20.0).clamp(0.25, 2.0);
                            let step = 0.5 / dev_rate as f32;
                            if r128_agc_gain < target_gain {
                                r128_agc_gain = (r128_agc_gain + step).min(target_gain);
                            } else if r128_agc_gain > target_gain {
                                r128_agc_gain = (r128_agc_gain - step).max(target_gain);
                            }

                            l *= r128_agc_gain;
                            r *= r128_agc_gain;
                        }

                        processed[0][i] = soft_limit(l * final_gain);
                        processed[1][i] = soft_limit(r * final_gain);
                    }
                } else {
                    for ch in 0..use_ch {
                        for i in 0..processed[ch].len() {
                            let mut sample = processed[ch][i];
                            if current_dsp.enabled && current_dsp.subsonic_enabled {
                                if ch == 0 {
                                    sample = subsonic_l.process(sample);
                                } else {
                                    sample = subsonic_r.process(sample);
                                }
                            }
                            processed[ch][i] = soft_limit(sample * final_gain);
                        }
                    }
                }
                let len = processed[0].len();
                (processed, len)
            };

            let mut interleaved = Vec::with_capacity(n_out * dev_ch);
            let mut out_idx = 0;
            let mut dither_rng = if dsp_now.dither { Some(rand::rng()) } else { None };
            use rand::Rng;

            while out_idx < n_out {
                let mut mono_sample = 0.0;
                for ch in 0..dev_ch {
                    let src_ch = if ch < use_ch { ch } else { 0 };
                    let mut sample = out_planar[src_ch][out_idx];
                    
                    // Final Gain & Dither
                    if let Some(rng) = &mut dither_rng {
                        if !is_float {
                            let lsb = match output_bits {
                                16 => 1.0 / 32768.0,
                                24 => 1.0 / 8388608.0,
                                32 => 1.0 / 2147483648.0,
                                _ => 1.0 / 8388608.0,
                            };
                            let d = (rng.random::<f32>() - rng.random::<f32>()) * lsb;
                            sample += d;
                        }
                    }

                    interleaved.push(sample);
                    if ch < use_ch {
                        mono_sample += sample;
                    }
                }
                
                // FFT Extraction
                mono_sample /= use_ch as f32;
                fft_buffer.push(mono_sample);
                if fft_buffer.len() >= 2048 {
                    let _ = fft_tx.try_send(fft_buffer.clone());
                    fft_buffer.clear();
                }
                out_idx += 1;
            }

            // Lock-free loop to wait for buffer space
            while prod.remaining() < interleaved.len() && running {
                std::thread::sleep(std::time::Duration::from_millis(5));

                // Smooth out UI timer updates while waiting for hardware to play
                if !is_stream {
                    let p_len = pending[0].len() as f64;
                    let mut r_len = prod.len() as f64 / (dev_ch as f64);
                    if flush_signal.load(Ordering::Relaxed) { r_len = 0.0; }
                    let delay_secs = (p_len / file_rate as f64) + (r_len / dev_rate as f64);
                    let true_pos = (ram_cursor as f64 / file_rate as f64) - delay_secs;
                    *safe_lock(&position_secs) = true_pos.max(0.0);
                }
                
                match rx.try_recv() {
                    Ok(PlayerCommand::Stop) => { 
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
                        *safe_lock(&status) = PlaybackStatus::Paused; 
                        stream_paused.store(true, Ordering::Relaxed);
                    }
                    Ok(PlayerCommand::Resume) => { 
                        *safe_lock(&status) = PlaybackStatus::Playing; 
                        stream_paused.store(false, Ordering::Relaxed);
                    }
                    Ok(PlayerCommand::Play(p, pos)) => { 
                        decode_shutdown.store(true, Ordering::SeqCst);
                        kill_current_process(&current_process);
                        
                        let mut c = safe_lock(&cache);
                        if let Some(ct) = c.as_ref() {
                            if !ct.complete.load(Ordering::SeqCst) { *c = None; }
                        }
                        
                        running = false; 
                        next_track_info = Some((p, pos)); 
                        break; 
                    }
                    Ok(PlayerCommand::Seek(secs)) => {
                        if let Some(samples_arc) = &decoded_samples {
                            let lock = safe_lock(&samples_arc);
                            ram_cursor = (secs * file_rate as f64) as usize;
                            if ram_cursor >= lock[0].len() { 
                                if is_complete.as_ref().map(|c| c.load(Ordering::SeqCst)).unwrap_or(true) {
                                    ram_cursor = lock[0].len().saturating_sub(1); 
                                }
                            }
                        } else if !is_stream {
                            if let Some(tb) = time_base {
                                let seek_ts = (secs * tb.denom as f64 / tb.numer as f64) as u64;
                                let _ = format.seek(symphonia::core::formats::SeekMode::Accurate, symphonia::core::formats::SeekTo::TimeStamp { ts: seek_ts, track_id });
                            }
                        }
                        *safe_lock(&position_secs) = secs;
                        flush_signal.store(true, Ordering::SeqCst);
                        pending.iter_mut().for_each(|ch| ch.clear());
                        interleaved.clear(); // ⚡ Clear stale data immediately
                        break; // ⚡ Break wait loop to process new position
                    }
                    Ok(PlayerCommand::RestartStream) => {
                        let current_p = { safe_lock(&current_track).clone() };
                        let current_pos = *safe_lock(&position_secs);
                        if let Some(p) = current_p {
                            decode_shutdown.store(true, Ordering::SeqCst);
                            kill_current_process(&current_process);
                            
                            let mut c = safe_lock(&cache);
                            if let Some(ct) = c.as_ref() {
                                if !ct.complete.load(Ordering::SeqCst) { *c = None; }
                            }
                            
                            running = false;
                            next_track_info = Some((p, current_pos));
                        }
                        break;
                    }
                    Ok(PlayerCommand::PushNext(path)) => {
                        safe_lock(&queue).push_front(path);
                    }
                    Ok(PlayerCommand::AppendQueue(path)) => {
                        safe_lock(&queue).push_back(path);
                    }
                    Err(_) => {}
                }
            }
            if running && interleaved.len() > 0 {
                prod.push_slice(&interleaved);
            }
        }

        // ACCURATE POSITION TRACKING (Subtract buffer delays)
        if !is_stream {
            let p_len = pending[0].len() as f64;
            let mut r_len = prod.len() as f64 / (dev_ch as f64);
            if flush_signal.load(Ordering::Relaxed) {
                r_len = 0.0;
            }
            let delay_secs = (p_len / file_rate as f64) + (r_len / dev_rate as f64);
            let true_pos = (ram_cursor as f64 / file_rate as f64) - delay_secs;
            *safe_lock(&position_secs) = true_pos.max(0.0);
        }
    }

    // 5. WAIT FOR BUFFER TO DRAIN ENTIRELY
    // This prevents cutting off the last second of audio when the ringbuffer is full at EOF.
    while running && prod.len() > 0 {
        std::thread::sleep(std::time::Duration::from_millis(20));

        // Keep updating position so UI timer completes
        if !is_stream {
            let p_len = pending[0].len() as f64;
            let mut r_len = prod.len() as f64 / (dev_ch as f64);
            if flush_signal.load(Ordering::Relaxed) { r_len = 0.0; }
            let delay_secs = (p_len / file_rate as f64) + (r_len / dev_rate as f64);
            let true_pos = (ram_cursor as f64 / file_rate as f64) - delay_secs;
            *safe_lock(&position_secs) = true_pos.max(0.0);
        }

        while let Ok(cmd) = rx.try_recv() {
            match cmd {
                PlayerCommand::Stop => { running = false; break; }
                PlayerCommand::Pause => { 
                    *safe_lock(&status) = PlaybackStatus::Paused; 
                    stream_paused.store(true, Ordering::Relaxed);
                }
                PlayerCommand::Resume => { 
                    *safe_lock(&status) = PlaybackStatus::Playing; 
                    stream_paused.store(false, Ordering::Relaxed);
                }
                PlayerCommand::Play(p, pos) => { 
                    running = false; 
                    next_track_info = Some((p, pos)); 
                    break; 
                }
                _ => {}
            }
        }
    }

    if running && next_track_info.is_none() {
        let _ = app_handle.emit("track-ended", ());
    }

    drop(stream);
    
    // Give drivers a moment to fully release the hardware before the next stream starts
    if next_track_info.is_some() {
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    
    next_track_info
}

fn decoded_frames(buf: &AudioBufferRef<'_>) -> usize {
    match buf {
        AudioBufferRef::F32(b) => b.frames(),
        AudioBufferRef::S16(b) => b.frames(),
        AudioBufferRef::S32(b) => b.frames(),
        AudioBufferRef::U8(b)  => b.frames(),
        AudioBufferRef::S24(b) => b.frames(),
        AudioBufferRef::F64(b) => b.frames(),
        _ => 0,
    }
}
