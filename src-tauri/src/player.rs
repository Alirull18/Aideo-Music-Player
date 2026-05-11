use std::sync::{Arc, Mutex};
use std::thread;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use ringbuf::RingBuffer;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
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
        }));
        let target_device = Arc::new(Mutex::new(None::<String>));
        let queued_track = Arc::new(Mutex::new(None::<String>));

        let s = Arc::clone(&status);
        let c = Arc::clone(&current_track);
        let p = Arc::clone(&position_secs);
        let v = Arc::clone(&volume);
        let exc = Arc::clone(&exclusive_mode);
        let dsp = Arc::clone(&dsp_state);
        let dev = Arc::clone(&target_device);
        let qt = Arc::clone(&queued_track);
        let app = app_handle.clone();

        thread::Builder::new()
            .name("player".into())
            .spawn(move || player_loop(cmd_rx, s, c, p, v, exc, dsp, dev, qt, app))
            .expect("Failed to spawn player thread");

        Player { cmd_tx, status, current_track, position_secs, volume, exclusive_mode, dsp_state, target_device, queued_track, app_handle }
    }
}

fn player_loop(
    rx: std::sync::mpsc::Receiver<PlayerCommand>,
    status: Arc<Mutex<PlaybackStatus>>,
    current_track: Arc<Mutex<Option<String>>>,
    position_secs: Arc<Mutex<f64>>,
    volume: Arc<Mutex<f32>>,
    exclusive_mode: Arc<Mutex<bool>>,
    dsp_state: Arc<Mutex<DSPState>>,
    target_device: Arc<Mutex<Option<String>>>,
    queued_track: Arc<Mutex<Option<String>>>,
    app_handle: tauri::AppHandle,
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

                next_track = play_file(&path, start_pos, Arc::clone(&status), Arc::clone(&current_track), Arc::clone(&position_secs), Arc::clone(&volume), Arc::clone(&exclusive_mode), Arc::clone(&dsp_state), Arc::clone(&target_device), Arc::clone(&queued_track), &rx, &app_handle);

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
fn soft_limit(sample: f32) -> f32 {
    let abs = sample.abs();
    if abs > 0.95 {
        let sign = if sample > 0.0 { 1.0 } else { -1.0 };
        sign * (0.95 + (abs - 0.95) / (1.0 + (abs - 0.95)))
    } else {
        sample
    }
}

fn play_file(
    path: &str,
    start_pos: f64,
    status: Arc<Mutex<PlaybackStatus>>,
    current_track: Arc<Mutex<Option<String>>>,
    position_secs: Arc<Mutex<f64>>,
    volume: Arc<Mutex<f32>>,
    exclusive_mode: Arc<Mutex<bool>>,
    dsp_state: Arc<Mutex<DSPState>>,
    target_device: Arc<Mutex<Option<String>>>,
    queued_track: Arc<Mutex<Option<String>>>,
    rx: &std::sync::mpsc::Receiver<PlayerCommand>,
    app_handle: &tauri::AppHandle,
) -> Option<(String, f64)> {
    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return None,
    };
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(path).extension() {
        hint.with_extension(&ext.to_string_lossy());
    }
    let probed = match get_probe().format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default()) {
        Ok(p) => p,
        Err(_) => return None,
    };
    let mut format = probed.format;
    let track = match format.default_track() {
        Some(t) => t.clone(),
        None => return None,
    };

    let mut track_id = track.id;
    let mut time_base = track.codec_params.time_base.or_else(|| {
        Some(symphonia::core::units::TimeBase { numer: 1, denom: track.codec_params.sample_rate.unwrap_or(44100) })
    });
    let file_rate = track.codec_params.sample_rate.unwrap_or(44100) as usize;
    let file_ch   = track.codec_params.channels.map(|c| c.count()).unwrap_or(2);

    let mut decoder = match get_codecs().make(&track.codec_params, &DecoderOptions::default()) {
        Ok(d) => d,
        Err(_) => return None,
    };

    if start_pos > 0.0 {
        if let Some(tb) = time_base {
            let seek_ts = (start_pos * tb.denom as f64 / tb.numer as f64) as u64;
            let _ = format.seek(symphonia::core::formats::SeekMode::Accurate, symphonia::core::formats::SeekTo::TimeStamp { ts: seek_ts, track_id });
        }
    }

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

    let is_exclusive = *exclusive_mode.lock().unwrap();
    let mut configs_to_try = Vec::new();

    if is_exclusive {
        if let Ok(supported) = device.supported_output_configs() {
            for c in supported {
                if c.channels() as usize == file_ch {
                    let min = c.min_sample_rate();
                    let max = c.max_sample_rate();
                    if min <= file_rate as u32 && max >= file_rate as u32 {
                        configs_to_try.push(c.with_sample_rate(file_rate as u32).config());
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
    let chunk_size = 512usize;

    let mut current_dsp = dsp_state.lock().unwrap().clone();

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

    while running {
        loop {
            match rx.try_recv() {
                Ok(PlayerCommand::Stop) => { running = false; break; }
                Ok(PlayerCommand::Pause) => { *status.lock().unwrap() = PlaybackStatus::Paused; }
                Ok(PlayerCommand::Resume) => { *status.lock().unwrap() = PlaybackStatus::Playing; }
                Ok(PlayerCommand::Play(p, pos)) => { running = false; next_track_info = Some((p, pos)); break; }
                Ok(PlayerCommand::Seek(secs)) => {
                    if let Some(tb) = time_base {
                        let seek_ts = (secs * tb.denom as f64 / tb.numer as f64) as u64;
                        let _ = format.seek(symphonia::core::formats::SeekMode::Accurate, symphonia::core::formats::SeekTo::TimeStamp { ts: seek_ts, track_id });
                    }
                    *position_secs.lock().unwrap() = secs;
                    // Signal the consumer to flush its buffer
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
        if exc_now != last_exclusive {
            stream.pause().ok(); // Prevent audio pop
            let current_pos = *position_secs.lock().unwrap();
            next_track_info = Some((path.to_string(), current_pos));
            break;
        }

        let now_dev = target_device.lock().unwrap().clone();
        if let Some(name) = now_dev {
            #[allow(deprecated)]
            let current_name = device.name().unwrap_or_default();
            if current_name != name {
                stream.pause().ok(); // Prevent audio pop
                let current_pos = *position_secs.lock().unwrap();
                next_track_info = Some((path.to_string(), current_pos));
                break;
            }
        }

        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(_) => {
                // EOF Reached! Check for queued track for gapless transition
                let next_queued = queued_track.lock().unwrap().take();
                if let Some(next_path) = next_queued {
                    if let Ok(file) = std::fs::File::open(&next_path) {
                        let mss = MediaSourceStream::new(Box::new(file), Default::default());
                        let mut hint = Hint::new();
                        if let Some(ext) = std::path::Path::new(&next_path).extension() {
                            hint.with_extension(&ext.to_string_lossy());
                        }
                        if let Ok(probed) = get_probe().format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default()) {
                            let new_format = probed.format;
                            let track_info = if let Some(t) = new_format.default_track() {
                                let new_rate = t.codec_params.sample_rate.unwrap_or(44100) as usize;
                                let new_ch = t.codec_params.channels.map(|c| c.count()).unwrap_or(2);
                                if new_rate == file_rate && new_ch == file_ch {
                                    if let Ok(sym_decoder) = get_codecs().make(&t.codec_params, &DecoderOptions::default()) {
                                        let tb = t.codec_params.time_base.or_else(|| {
                                            Some(symphonia::core::units::TimeBase { numer: 1, denom: t.codec_params.sample_rate.unwrap_or(44100) as u32 })
                                        });
                                        Some((sym_decoder, t.id, tb))
                                    } else { None }
                                } else { None }
                            } else { None };

                            if let Some((new_decoder, new_tid, new_tb)) = track_info {
                                // Gapless transition successful!
                                format = new_format;
                                decoder = new_decoder;
                                track_id = new_tid;
                                time_base = new_tb;
                                
                                *position_secs.lock().unwrap() = 0.0;
                                *current_track.lock().unwrap() = Some(next_path.clone());
                                let _ = app_handle.emit("track-changed", next_path);
                                continue;
                            } else {
                                // Non-gapless transition required
                                next_track_info = Some((next_path, 0.0));
                            }
                        }
                    }
                }
                break; 
            }
        };
        if packet.track_id() != track_id { continue; }

        if let Some(tb) = time_base {
            let t = tb.calc_time(packet.ts());
            let decode_pos = t.seconds as f64 + t.frac;
            
            // Compensate for the audio currently in the playback buffers
            let buffered_frames_prod = prod.len() as f64 / dev_ch as f64;
            let buffered_time_prod = buffered_frames_prod / dev_rate as f64;
            let pending_frames = pending[0].len() as f64;
            let buffered_time_pending = pending_frames / file_rate as f64;
            
            let mut true_pos = decode_pos - buffered_time_prod - buffered_time_pending;
            if true_pos.is_nan() || true_pos < 0.0 { true_pos = 0.0; }
            *position_secs.lock().unwrap() = true_pos;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(_) => continue,
        };

        let n_frames = decoded_frames(&decoded);
        if n_frames == 0 { continue; }
        let use_ch = file_ch.min(dev_ch);

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
            pending[ch].extend(src);
        }

        let dsp_now = dsp_state.lock().unwrap().clone();
        if dsp_now.enabled != current_dsp.enabled || dsp_now.width != current_dsp.width {
            current_dsp = dsp_now;
        }
        
        'resample: loop {
            if pending[0].len() < chunk_size { break 'resample; }
            
            let mut chunk_planar = vec![vec![0.0; chunk_size]; file_ch];
            for ch in 0..file_ch {
                for i in 0..chunk_size {
                    chunk_planar[ch][i] = pending[ch].pop_front().unwrap();
                }
            }

            let refs: Vec<&[f32]> = chunk_planar.iter().map(|v| v.as_slice()).collect();
            let mut out_planar = match resampler.process(&refs, None) {
                Ok(o) => o,
                Err(_) => break 'resample,
            };

            let final_gain = if current_dsp.enabled { 0.9 } else { 1.0 };

            if current_dsp.enabled && use_ch >= 2 {
                let width = current_dsp.width;
                for i in 0..out_planar[0].len() {
                    let l = out_planar[0][i];
                    let r = out_planar[1][i];
                    
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
                    
                    out_planar[0][i] = soft_limit(new_l * final_gain);
                    out_planar[1][i] = soft_limit(new_r * final_gain);
                }
            } else {
                for ch in 0..use_ch {
                    for i in 0..out_planar[ch].len() {
                        out_planar[ch][i] = soft_limit(out_planar[ch][i] * final_gain);
                    }
                }
            }

            let n_out = out_planar[0].len();
            let mut interleaved = Vec::with_capacity(n_out * dev_ch);
            for i in 0..n_out {
                for ch in 0..dev_ch {
                    let src_ch = if ch < use_ch { ch } else { 0 };
                    interleaved.push(out_planar[src_ch][i]);
                }
            }

            // Lock-free loop to wait for buffer space
            while prod.remaining() < interleaved.len() && running {
                std::thread::sleep(std::time::Duration::from_millis(5));
                
                match rx.try_recv() {
                    Ok(PlayerCommand::Stop) => { running = false; break; }
                    Ok(PlayerCommand::Pause) => { *status.lock().unwrap() = PlaybackStatus::Paused; }
                    Ok(PlayerCommand::Resume) => { *status.lock().unwrap() = PlaybackStatus::Playing; }
                    Ok(PlayerCommand::Play(p, pos)) => { running = false; next_track_info = Some((p, pos)); break; }
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
    }

    // Wait for the buffer to drain entirely before emitting track-ended
    if running && next_track_info.is_none() {
        while prod.len() > 0 && running {
            std::thread::sleep(std::time::Duration::from_millis(10));
            match rx.try_recv() {
                Ok(PlayerCommand::Stop) => { running = false; break; }
                Ok(PlayerCommand::Play(p, pos)) => { running = false; next_track_info = Some((p, pos)); break; }
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
