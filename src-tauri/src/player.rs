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

#[derive(Debug)]
pub enum PlayerCommand {
    Play(String, f64),
    Pause,
    Resume,
    Stop,
    Seek(f64),
    QueueNext(String),
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub enum PlaybackStatus { Stopped, Playing, Paused }

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct DSPState {
    pub width: f32,  // 0.0 to 2.0 (1.0 = normal, <1.0 = crossfeed, >1.0 = spatial)
    pub enabled: bool,
    pub upsample_rate: u32, // 0 = off, else target Hz (e.g. 192000)
    pub dither: bool,
}

fn find_ffmpeg_path() -> String {
    if let Some(local_appdata) = std::env::var_os("LOCALAPPDATA") {
        let base_path = std::path::PathBuf::from(local_appdata).join("Microsoft").join("WinGet").join("Packages");
        if let Ok(entries) = std::fs::read_dir(&base_path) {
            for entry in entries.filter_map(|e| e.ok()) {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if name.contains("ffmpeg") {
                    if let Ok(sub_entries) = std::fs::read_dir(entry.path()) {
                        for sub in sub_entries.filter_map(|e| e.ok()) {
                            let bin_path = sub.path().join("bin").join("ffmpeg.exe");
                            if bin_path.exists() { return bin_path.to_string_lossy().to_string(); }
                            let direct_path = sub.path().join("ffmpeg.exe");
                            if direct_path.exists() { return direct_path.to_string_lossy().to_string(); }
                        }
                    }
                }
            }
        }
    }
    "ffmpeg".to_string()
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
    pub queued_track: Arc<Mutex<Option<String>>>,
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
            // Boost higher frequencies so it looks more balanced (pink noise compensation)
            magnitudes[i] = mag * (1.0 + (i as f32 * 0.02)); 
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
            width: 1.0,
            enabled: false,
            upsample_rate: 0,
            dither: false,
        }));
        let target_device = Arc::new(Mutex::new(None::<String>));
        let queued_track = Arc::new(Mutex::new(None::<String>));
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
        let qt = Arc::clone(&queued_track);
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
        
        thread::Builder::new()
            .name("player".into())
            .spawn(move || player_loop(cmd_rx, s, c, p, v, exc, bp, dr, ca, dsp, dev, qt, cp, app, fft_tx, ff))
            .expect("Failed to spawn player thread");

        Player { cmd_tx, status, current_track, position_secs, volume, exclusive_mode, dsp_state, target_device, queued_track, app_handle, current_process, ffmpeg_path, bit_perfect, current_dev_rate, cache }
    }
}

fn player_loop(
    rx: std::sync::mpsc::Receiver<PlayerCommand>,
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
    queued_track: Arc<Mutex<Option<String>>>,
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
            PlayerCommand::Play(path, start_pos) => {
                {
                    let mut s = status.lock().unwrap();
                    *s = PlaybackStatus::Playing;
                    let mut ct = current_track.lock().unwrap();
                    *ct = Some(path.clone());
                    let mut pos = position_secs.lock().unwrap();
                    *pos = start_pos;
                }

                next_track = play_file(&path, start_pos, Arc::clone(&status), Arc::clone(&current_track), Arc::clone(&position_secs), Arc::clone(&volume), Arc::clone(&exclusive_mode), Arc::clone(&bit_perfect), Arc::clone(&current_dev_rate), Arc::clone(&cache), Arc::clone(&dsp_state), Arc::clone(&target_device), Arc::clone(&queued_track), Arc::clone(&current_process), &rx, &app_handle, &fft_tx, &ffmpeg_path);

                if next_track.is_none() {
                    let mut s = status.lock().unwrap();
                    *s = PlaybackStatus::Stopped;
                    let mut ct = current_track.lock().unwrap();
                    *ct = None;
                }
            }
            _ => {} 
        }
    }
}


/// Soft limiter — prevents digital clipping on heavy boosts
fn kill_current_process(current_process: &Arc<Mutex<Option<std::process::Child>>>) {
    if let Some(mut child) = current_process.lock().unwrap().take() {
        let _ = child.kill();
    }
}

fn soft_limit(sample: f32) -> f32 {
    let abs = sample.abs();
    if abs > 0.95 {
        let sign = if sample > 0.0 { 1.0 } else { -1.0 };
        sign * (0.95 + (abs - 0.95) / (1.0 + (abs - 0.95)))
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
    let track = match format.default_track() {
        Some(t) => t.clone(),
        None => return,
    };
    let track_id = track.id;
    let mut decoder = match get_codecs().make(&track.codec_params, &DecoderOptions::default()) {
        Ok(d) => d,
        Err(_) => return,
    };

    loop {
        if shutdown.load(Ordering::Relaxed) { break; }
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(_) => break,
        };

        if packet.track_id() != track_id { continue; }

        if let Ok(decoded) = decoder.decode(&packet) {
            let n_frames = decoded_frames(&decoded);
            let mut lock = samples.lock().unwrap();
            let file_ch = lock.len();
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
                lock[ch].extend(src);
            }
        }
    }
    complete.store(true, Ordering::SeqCst);
}

fn get_track_metadata(path: &str) -> Result<(usize, usize, Option<TimeBase>), String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(path).extension() {
        hint.with_extension(&ext.to_string_lossy());
    }

    let probed = get_probe().format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default()).map_err(|e| e.to_string())?;
    let track = probed.format.default_track().ok_or("No default track")?.clone();
    let time_base = track.codec_params.time_base.or_else(|| {
        Some(symphonia::core::units::TimeBase { numer: 1, denom: track.codec_params.sample_rate.unwrap_or(44100) })
    });
    let file_rate = track.codec_params.sample_rate.unwrap_or(44100) as usize;
    let file_ch   = track.codec_params.channels.map(|c| c.count()).unwrap_or(2);

    Ok((file_rate, file_ch, time_base))
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
    queued_track: Arc<Mutex<Option<String>>>,
    current_process: Arc<Mutex<Option<std::process::Child>>>,
    rx: &std::sync::mpsc::Receiver<PlayerCommand>,
    app_handle: &tauri::AppHandle,
    fft_tx: &Sender<Vec<f32>>,
    ffmpeg_path: &str,
) -> Option<(String, f64)> {
    *current_track.lock().unwrap() = Some(path.to_string());
    let mut stream_content_type: Option<String> = None;
    println!("[player] Using FFmpeg path: {}", ffmpeg_path);

    let mss = if path.starts_with("http://") || path.starts_with("https://") {
        println!("[player] Detected HTTP stream, attempting FFmpeg proxy...");
        
        let mut cmd = std::process::Command::new(&ffmpeg_path);
        cmd.args([
            "-headers", "Referer: https://www.hotfm.audio/\r\nOrigin: https://www.hotfm.audio/\r\n",
            "-user_agent", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
            "-reconnect", "1",
            "-reconnect_at_eof", "1",
            "-reconnect_streamed", "1",
            "-reconnect_delay_max", "2",
            "-i", path,
            "-f", "wav",
            "-acodec", "pcm_s16le",
            "-ar", "44100",
            "-ac", "2",
            "-"
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

        // Kill existing process if any
        if let Some(mut old_child) = current_process.lock().unwrap().take() {
            let _ = old_child.kill();
        }

        match cmd.spawn() {
            Ok(mut child) => {
                println!("[player] FFmpeg proxy spawned successfully.");
                
                // Monitor stderr in a thread
                let stderr = child.stderr.take().unwrap();
                std::thread::spawn(move || {
                    let reader = std::io::BufReader::new(stderr);
                    for line in reader.lines().filter_map(|l| l.ok()) {
                        println!("[ffmpeg] {}", line);
                    }
                });

                let stdout = child.stdout.take().unwrap();
                
                // Store child for future termination
                *current_process.lock().unwrap() = Some(child);

                let source = symphonia::core::io::ReadOnlySource::new(stdout);
                stream_content_type = Some("audio/wav".to_string());
                MediaSourceStream::new(Box::new(source), Default::default())
            },
            Err(_) => {
                let client = reqwest::blocking::Client::builder()
                    .user_agent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
                    .timeout(std::time::Duration::from_secs(15))
                    .build()
                    .ok()?;
                let resp = client.get(path).send().ok()?;
                let source = symphonia::core::io::ReadOnlySource::new(resp);
                MediaSourceStream::new(Box::new(source), Default::default())
            }
        }
    } else {
        let file = match std::fs::File::open(path) {
            Ok(f) => f,
            Err(e) => { 
                let msg = format!("File open error: {}", e);
                let _ = app_handle.emit("playback-error", msg);
                return None; 
            }
        };
        MediaSourceStream::new(Box::new(file), Default::default())
    };
    let mut hint = Hint::new();
    let mut hint_set = false;
    if path.starts_with("http://") || path.starts_with("https://") {
        // Fallback to extension from URL
        let url_path = path.split('?').next().unwrap_or(path);
        if let Some(ext) = std::path::Path::new(url_path).extension() {
            hint.with_extension(&ext.to_string_lossy());
            hint_set = true;
        }
    } else if let Some(ext) = std::path::Path::new(path).extension() {
        hint.with_extension(&ext.to_string_lossy());
        hint_set = true;
    }
    
    // If we have a response from a stream, try to use Content-Type header as a better hint
    if let Some(ct) = stream_content_type {
        if ct.contains("mpeg") || ct.contains("mp3") {
            hint.with_extension("mp3");
            hint_set = true;
        } else if ct.contains("aac") || ct.contains("audio/x-aac") {
            hint.with_extension("aac");
            hint_set = true;
        } else if ct.contains("ogg") || ct.contains("opus") {
            hint.with_extension("ogg");
            hint_set = true;
        } else if ct.contains("flac") {
            hint.with_extension("flac");
            hint_set = true;
        } else if ct.contains("wav") {
            hint.with_extension("wav");
            hint_set = true;
        }
    } 
    
    if (path.starts_with("http") || path.starts_with("https")) && !hint_set {
        // Absolute fallback for streams without extensions or headers
        hint.with_extension("mp3");
    }
    
    println!("[player] Probing media format...");
    let probed = match get_probe().format(&hint, mss, &FormatOptions::default(), &MetadataOptions { 
        limit_metadata_bytes: symphonia::core::meta::Limit::Maximum(1024 * 16),
        limit_visual_bytes: symphonia::core::meta::Limit::Maximum(1) 
    }) {
        Ok(p) => {
            println!("[player] Format probed successfully.");
            if path.starts_with("http://") || path.starts_with("https://") {
                // We don't have the response here easily, but we can assume success if we got here
                // However, if it was a 403, it would have failed probe anyway.
                let _ = app_handle.emit("playback-success", path.to_string());
            }
            p
        },
        Err(e) => { 
            let msg = format!("Codec probe error: {}", e);
            eprintln!("[player] {}", msg);
            let _ = app_handle.emit("playback-error", msg);
            return None; 
        }
    };
    let mut format = probed.format;
    let track = match format.default_track() {
        Some(t) => t.clone(),
        None => { 
            let msg = "No default track found in media".to_string();
            let _ = app_handle.emit("playback-error", msg);
            return None; 
        }
    };

    let track_id = track.id;
    let mut decoder = match get_codecs().make(&track.codec_params, &DecoderOptions::default()) {
        Ok(d) => d,
        Err(_) => return None,
    };

    let is_exclusive = *exclusive_mode.lock().unwrap();

    // 1. PRE-DECODE INTO RAM (if not a stream)
    let is_stream = path.starts_with("http://") || path.starts_with("https://");
    
    let decode_shutdown = Arc::new(AtomicBool::new(false));
    let (decoded_samples, file_rate, file_ch, time_base, is_complete) = if !is_stream {
        let mut cache_lock = cache.lock().unwrap();
        let use_cached = if let Some(cached) = &*cache_lock {
            if cached.path == path { Some(cached.clone()) } else { None }
        } else { None };

        if let Some(cached) = use_cached {
            (Some(cached.samples), cached.file_rate, cached.file_ch, cached.time_base, Some(cached.complete))
        } else {
            match get_track_metadata(path) {
                Ok((rate, ch, tb)) => {
                    let samples = Arc::new(Mutex::new(vec![Vec::new(); ch]));
                    let complete = Arc::new(AtomicBool::new(false));
                    let cached = CachedTrack {
                        path: path.to_string(),
                        samples: Arc::clone(&samples),
                        complete: Arc::clone(&complete),
                        file_rate: rate,
                        file_ch: ch,
                        time_base: tb,
                    };
                    *cache_lock = Some(cached);
                    
                    let path_str = path.to_string();
                    let s_clone = Arc::clone(&samples);
                    let c_clone = Arc::clone(&complete);
                    let sd_clone = Arc::clone(&decode_shutdown);
                    thread::spawn(move || {
                        background_decode(path_str, s_clone, c_clone, sd_clone);
                    });
                    
                    (Some(samples), rate, ch, tb, Some(complete))
                }
                Err(e) => {
                    let _ = app_handle.emit("playback-error", format!("Metadata failed: {}", e));
                    return None;
                }
            }
        }
    } else {
        (None, 44100, 2, None, None)
    };

    let host = cpal::default_host();
    let device = {
        let target = target_device.lock().unwrap().clone();
        let dev = if let Some(name) = target {
            #[allow(deprecated)]
            host.output_devices().ok().and_then(|mut ds| ds.find(|d| d.name().unwrap_or_default() == name))
        } else {
            None
        };
        dev.or_else(|| host.default_output_device()).expect("No output device found")
    };

    let upsample_target = dsp_state.lock().unwrap().upsample_rate;

    // 2. HARDWARE RATE SWITCHING
    let mut configs_to_try = Vec::new();

    // Priority 1: Upsampling Target (if enabled)
    if upsample_target > 0 && !is_stream {
        if let Ok(supported) = device.supported_output_configs() {
            for c in supported {
                if c.channels() as usize == file_ch {
                    let min = c.min_sample_rate();
                    let max = c.max_sample_rate();
                    if min <= upsample_target && max >= upsample_target {
                        let cfg = c.with_sample_rate(upsample_target).config();
                        println!("AUDIOPHILE: Upsampling target rate found: {}Hz", upsample_target);
                        configs_to_try.push(cfg);
                    }
                }
            }
        }
    }

    // Priority 2: Native Bit-Perfect Match
    if configs_to_try.is_empty() && is_exclusive && !is_stream {
        if let Ok(supported) = device.supported_output_configs() {
            for c in supported {
                if c.channels() as usize == file_ch {
                    let min = c.min_sample_rate();
                    let max = c.max_sample_rate();
                    if min <= file_rate as u32 && max >= file_rate as u32 {
                        let cfg = c.with_sample_rate(file_rate as u32).config();
                        println!("AUDIOPHILE: Matching hardware rate found: {}Hz", file_rate);
                        configs_to_try.push(cfg);
                    }
                }
            }
        }
    }
    if let Ok(def) = device.default_output_config() {
        configs_to_try.push(def.config());
    }

    if configs_to_try.is_empty() { return None; }

    let mut stream_info: Option<(cpal::Stream, cpal::StreamConfig)> = None;
    let mut prod_opt = None;
    let flush_signal = Arc::new(AtomicBool::new(false));

    for config in configs_to_try {
        let status_cb = Arc::clone(&status);
        let volume_cb = Arc::clone(&volume);
        let flush_cb = Arc::clone(&flush_signal);
        
        // Compute max ring size (2 seconds of audio at target rate)
        let rate = config.sample_rate as usize;
        let channels = config.channels as usize;
        let max_ring = rate * channels * 2;
        
        let rb = RingBuffer::<f32>::new(max_ring);
        let (prod, mut cons) = rb.split();

        let stream_res = device.build_output_stream(
            &config,
            move |out: &mut [f32], _| {
                let is_paused = *status_cb.lock().unwrap() == PlaybackStatus::Paused;
                if is_paused { 
                    out.fill(0.0); 
                    return; 
                }
                
                // Handle seek/flush signal lock-free
                if flush_cb.swap(false, Ordering::SeqCst) {
                    let len = cons.len();
                    cons.discard(len);
                }
                
                let vol = *volume_cb.lock().unwrap();
                let n = cons.pop_slice(out);
                
                for i in 0..n { 
                    out[i] *= vol; 
                }
                if n < out.len() { 
                    out[n..].fill(0.0); 
                }
            },
            |e| eprintln!("[player] stream error: {e}"),
            None,
        );

        if let Ok(s) = stream_res {
            let _ = s.play();
            stream_info = Some((s, config));
            prod_opt = Some(prod);
            break;
        }
    }

    let (stream, config) = match stream_info {
        Some(i) => i,
        None => return None,
    };
    
    let mut prod = prod_opt.unwrap();

    let dev_rate = config.sample_rate as usize;
    let dev_ch   = config.channels as usize;
    let use_ch   = file_ch.min(dev_ch);
    
    // REPORT ACTUAL HARDWARE RATE
    *current_dev_rate.lock().unwrap() = dev_rate as u32;

    let chunk_size = 512usize;

    let mut current_dsp = dsp_state.lock().unwrap().clone();
    let mut fft_buffer = Vec::with_capacity(2048);

    let mut resampler: SincFixedIn<f32> = SincFixedIn::<f32>::new(
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
    ).unwrap();

    let mut pending: Vec<VecDeque<f32>> = vec![VecDeque::new(); file_ch];
    let mut running = true;
    let mut next_track_info: Option<(String, f64)> = None;
    let last_exclusive = is_exclusive;
    let last_upsample_rate = upsample_target;
    let is_stream = path.starts_with("http://") || path.starts_with("https://");

    // RAM BUFFER CURSOR
    let mut ram_cursor = (start_pos * file_rate as f64) as usize;

    while running {
        loop {
            match rx.try_recv() {
                Ok(PlayerCommand::Stop) => { running = false; break; }
                Ok(PlayerCommand::Pause) => { *status.lock().unwrap() = PlaybackStatus::Paused; }
                Ok(PlayerCommand::Resume) => { *status.lock().unwrap() = PlaybackStatus::Playing; }
                Ok(PlayerCommand::Play(p, pos)) => { running = false; next_track_info = Some((p, pos)); break; }
                Ok(PlayerCommand::Seek(secs)) => {
                    if let Some(samples_arc) = &decoded_samples {
                        let lock = samples_arc.lock().unwrap();
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
                    *position_secs.lock().unwrap() = secs;
                    flush_signal.store(true, Ordering::SeqCst);
                    pending.iter_mut().for_each(|ch| ch.clear());
                }
                Ok(PlayerCommand::QueueNext(path)) => {
                    *queued_track.lock().unwrap() = Some(path);
                }
                Err(_) => break,
            }
        }
        if !running { break; }
        let exc_now = *exclusive_mode.lock().unwrap();
        let dsp_now = dsp_state.lock().unwrap().clone();
        
        if exc_now != last_exclusive || dsp_now.upsample_rate != last_upsample_rate {
            stream.pause().ok();
            let current_pos = *position_secs.lock().unwrap();
            next_track_info = Some((path.to_string(), current_pos));
            break;
        }

        let bp_now = *bit_perfect.lock().unwrap();
        // BIT-PERFECT toggle is now handled inside the loop without stream restart

        // FILL PENDING BUFFER
        if pending[0].len() < chunk_size * 4 {
            if let Some(samples_arc) = &decoded_samples {
                // READ FROM RAM (Possibly still loading)
                let lock = samples_arc.lock().unwrap();
                if ram_cursor < lock[0].len() {
                    let to_read = (lock[0].len() - ram_cursor).min(chunk_size * 8);
                    for ch in 0..file_ch {
                        pending[ch].extend(&lock[ch][ram_cursor..ram_cursor+to_read]);
                    }
                    ram_cursor += to_read;
                    // Position update moved to end of loop for better accuracy
                } else if is_complete.as_ref().map(|c| c.load(Ordering::SeqCst)).unwrap_or(true) {
                    // RAM EOF - Check queue
                    let next_queued = queued_track.lock().unwrap().take();
                    if let Some(npath) = next_queued {
                        next_track_info = Some((npath, 0.0));
                    }
                    break;
                } else {
                    // STILL LOADING - Wait a bit
                    std::thread::sleep(std::time::Duration::from_millis(50));
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

        let dsp_now = dsp_state.lock().unwrap().clone();
        if dsp_now.enabled != current_dsp.enabled || dsp_now.width != current_dsp.width {
            current_dsp = dsp_now.clone();
        }
        
        'resample: loop {
            if pending[0].len() < chunk_size { break 'resample; }
            
            let mut chunk_planar = vec![vec![0.0; chunk_size]; file_ch];
            for ch in 0..file_ch {
                for i in 0..chunk_size {
                    chunk_planar[ch][i] = pending[ch].pop_front().unwrap();
                }
            }

            let is_bp = bp_now && file_rate == dev_rate && file_ch == dev_ch && !current_dsp.enabled;
            
            let (out_planar, n_out) = if is_bp {
                // BIT-PERFECT BYPASS PATH
                (chunk_planar, chunk_size)
            } else {
                let refs: Vec<&[f32]> = chunk_planar.iter().map(|v| v.as_slice()).collect();
                let mut processed = match resampler.process(&refs, None) {
                    Ok(o) => o,
                    Err(_) => break 'resample,
                };
                
                let final_gain = if current_dsp.enabled { 0.9 } else { 1.0 };

                if current_dsp.enabled && use_ch >= 2 {
                    let width = current_dsp.width;
                    for i in 0..processed[0].len() {
                        let l = processed[0][i];
                        let r = processed[1][i];
                        
                        let mut new_l = l;
                        let mut new_r = r;
                        
                        if width < 1.0 {
                            // Pure M/S Crossfeed (No Delay)
                            let blend = 1.0 - width; // 0.0 to 1.0
                            new_l = l * (1.0 - blend * 0.4) + r * (blend * 0.4);
                            new_r = r * (1.0 - blend * 0.4) + l * (blend * 0.4);
                            
                        } else if width > 1.0 {
                            // Aggressive Mid/Side Spatial Widener (No Delay)
                            let intensity = width - 1.0; // 0.0 to 2.0
                            
                            let mid = (l + r) * 0.5;
                            let side = (l - r) * 0.5;
                            
                            // Drastically boost the side channel, slightly dip the mid
                            let mid_gain = (1.0 - intensity * 0.15).max(0.6);
                            let side_gain = 1.0 + (intensity * 1.5);
                            
                            new_l = mid * mid_gain + side * side_gain;
                            new_r = mid * mid_gain - side * side_gain;
                        }
                        
                        processed[0][i] = soft_limit(new_l * final_gain);
                        processed[1][i] = soft_limit(new_r * final_gain);
                    }
                } else {
                    for ch in 0..use_ch {
                        for i in 0..processed[ch].len() {
                            processed[ch][i] = soft_limit(processed[ch][i] * final_gain);
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
                        const LSB: f32 = 1.0 / 8_388_608.0;
                        let d = (rng.random::<f32>() - rng.random::<f32>()) * LSB;
                        sample += d;
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
                
                match rx.try_recv() {
                    Ok(PlayerCommand::Stop) => { 
                        decode_shutdown.store(true, Ordering::SeqCst);
                        kill_current_process(&current_process);
                        running = false; 
                        break; 
                    }
                    Ok(PlayerCommand::Pause) => { *status.lock().unwrap() = PlaybackStatus::Paused; }
                    Ok(PlayerCommand::Resume) => { *status.lock().unwrap() = PlaybackStatus::Playing; }
                    Ok(PlayerCommand::Play(p, pos)) => { 
                        decode_shutdown.store(true, Ordering::SeqCst);
                        kill_current_process(&current_process);
                        running = false; 
                        next_track_info = Some((p, pos)); 
                        break; 
                    }
                    Ok(PlayerCommand::Seek(secs)) => {
                        if let Some(tb) = time_base {
                            let seek_ts = (secs * tb.denom as f64 / tb.numer as f64) as u64;
                            let _ = format.seek(symphonia::core::formats::SeekMode::Accurate, symphonia::core::formats::SeekTo::TimeStamp { ts: seek_ts, track_id });
                        }
                        *position_secs.lock().unwrap() = secs;
                        
                        // Signal the consumer to flush its buffer
                        flush_signal.store(true, Ordering::SeqCst);
                        pending.iter_mut().for_each(|ch| ch.clear());
                        break;
                    }
                Ok(PlayerCommand::QueueNext(path)) => {
                    *queued_track.lock().unwrap() = Some(path);
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
            let r_len = prod.len() as f64 / (dev_ch as f64);
            let delay_secs = (p_len / file_rate as f64) + (r_len / dev_rate as f64);
            let true_pos = (ram_cursor as f64 / file_rate as f64) - delay_secs;
            *position_secs.lock().unwrap() = true_pos.max(0.0);
        }

        std::thread::sleep(std::time::Duration::from_millis(10));
    }

    // Wait for the buffer to drain entirely before emitting track-ended
    if running && next_track_info.is_none() {
        while prod.len() > 0 && running {
            std::thread::sleep(std::time::Duration::from_millis(10));
            match rx.try_recv() {
                Ok(PlayerCommand::Stop) => { 
                    kill_current_process(&current_process);
                    running = false; 
                    break; 
                }
                Ok(PlayerCommand::Play(p, pos)) => { 
                    kill_current_process(&current_process);
                    running = false; 
                    next_track_info = Some((p, pos)); 
                    break; 
                }
                Ok(PlayerCommand::Pause) => { *status.lock().unwrap() = PlaybackStatus::Paused; }
                Ok(PlayerCommand::Resume) => { *status.lock().unwrap() = PlaybackStatus::Playing; }
                Ok(PlayerCommand::QueueNext(path)) => { *queued_track.lock().unwrap() = Some(path); }
                _ => {}
            }
        }
        
        if running && next_track_info.is_none() {
            let _ = app_handle.emit("track-ended", ());
        }
    }

    stream.pause().ok(); // Prevent audio pop at end of track
    drop(stream);
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
