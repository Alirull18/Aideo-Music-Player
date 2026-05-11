use std::sync::{Arc, Mutex, Condvar};
use std::thread;
use std::collections::VecDeque;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::default::{get_codecs, get_probe};
use rubato::{Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction};
use biquad::{DirectForm1, Coefficients, Type, Biquad, ToHertz};
use tauri::Emitter;

#[derive(Debug)]
pub enum PlayerCommand {
    Play(String, f64),
    Pause,
    Resume,
    Stop,
    Seek(f64),
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub enum PlaybackStatus { Stopped, Playing, Paused }

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct EQState {
    pub bands: [f32; 10], 
    pub enabled: bool,
    pub speed: f32,      
}

pub struct Player {
    pub cmd_tx: std::sync::mpsc::Sender<PlayerCommand>,
    pub status: Arc<Mutex<PlaybackStatus>>,
    pub current_track: Arc<Mutex<Option<String>>>,
    pub position_secs: Arc<Mutex<f64>>,
    pub volume: Arc<Mutex<f32>>,
    pub exclusive_mode: Arc<Mutex<bool>>,
    pub eq_state: Arc<Mutex<EQState>>,
    pub target_device: Arc<Mutex<Option<String>>>,
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
        let eq_state = Arc::new(Mutex::new(EQState {
            bands: [0.0; 10],
            enabled: false,
            speed: 1.0,
        }));
        let target_device = Arc::new(Mutex::new(None::<String>));

        let s = Arc::clone(&status);
        let c = Arc::clone(&current_track);
        let p = Arc::clone(&position_secs);
        let v = Arc::clone(&volume);
        let exc = Arc::clone(&exclusive_mode);
        let eq = Arc::clone(&eq_state);
        let dev = Arc::clone(&target_device);
        let app = app_handle.clone();

        thread::Builder::new()
            .name("player".into())
            .spawn(move || player_loop(cmd_rx, s, c, p, v, exc, eq, dev, app))
            .expect("Failed to spawn player thread");

        Player { cmd_tx, status, current_track, position_secs, volume, exclusive_mode, eq_state, target_device, app_handle }
    }
}

fn player_loop(
    rx: std::sync::mpsc::Receiver<PlayerCommand>,
    status: Arc<Mutex<PlaybackStatus>>,
    current_track: Arc<Mutex<Option<String>>>,
    position_secs: Arc<Mutex<f64>>,
    volume: Arc<Mutex<f32>>,
    exclusive_mode: Arc<Mutex<bool>>,
    eq_state: Arc<Mutex<EQState>>,
    target_device: Arc<Mutex<Option<String>>>,
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

                next_track = play_file(&path, start_pos, Arc::clone(&status), Arc::clone(&position_secs), Arc::clone(&volume), Arc::clone(&exclusive_mode), Arc::clone(&eq_state), Arc::clone(&target_device), &rx, &app_handle);

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

fn create_filters(dev_ch: usize, dev_rate: usize, freqs: &[f64; 10], gains: &[f32; 10]) -> Vec<Vec<DirectForm1<f32>>> {
    let mut all = vec![Vec::new(); dev_ch];
    for ch in 0..dev_ch {
        for i in 0..10 {
            let coeffs = Coefficients::<f32>::from_params(Type::PeakingEQ(gains[i]), (dev_rate as f32).hz(), (freqs[i] as f32).hz(), 0.707).unwrap();
            all[ch].push(DirectForm1::<f32>::new(coeffs));
        }
    }
    all
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
    position_secs: Arc<Mutex<f64>>,
    volume: Arc<Mutex<f32>>,
    exclusive_mode: Arc<Mutex<bool>>,
    eq_state: Arc<Mutex<EQState>>,
    target_device: Arc<Mutex<Option<String>>>,
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

    let track_id = track.id;
    let time_base = track.codec_params.time_base;
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

    // Ring buffer using VecDeque for fast O(1) popping + Condvar
    let ring: Arc<(Mutex<VecDeque<f32>>, Condvar)> = Arc::new((Mutex::new(VecDeque::new()), Condvar::new()));
    let mut stream_info: Option<(cpal::Stream, cpal::StreamConfig)> = None;

    for config in configs_to_try {
        let status_cb = Arc::clone(&status);
        let volume_cb = Arc::clone(&volume);
        let ring_ptr = Arc::clone(&ring);

        let stream_res = device.build_output_stream(
            &config,
            move |out: &mut [f32], _| {
                let is_paused = *status_cb.lock().unwrap() == PlaybackStatus::Paused;
                if is_paused { 
                    out.fill(0.0); 
                    return; 
                }
                
                let (lock, cvar) = &*ring_ptr;
                let mut buf = lock.lock().unwrap();
                let vol = *volume_cb.lock().unwrap();
                
                let n = out.len().min(buf.len());
                for i in 0..n { 
                    out[i] = buf.pop_front().unwrap() * vol; 
                }
                
                if n < out.len() { 
                    out[n..].fill(0.0); 
                }
                
                // Notify decoder thread that space has freed up
                cvar.notify_one();
            },
            |e| eprintln!("[player] stream error: {e}"),
            None,
        );

        if let Ok(s) = stream_res {
            let _ = s.play();
            stream_info = Some((s, config));
            break;
        }
    }

    let (stream, config) = match stream_info {
        Some(i) => i,
        None => return None,
    };

    let dev_rate = config.sample_rate as usize;
    let dev_ch   = config.channels as usize;
    let chunk_size = 512usize;

    let freqs = [31.0, 62.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0];
    let mut current_eq = eq_state.lock().unwrap().clone();
    let mut filters: Vec<Vec<DirectForm1<f32>>> = if current_eq.enabled {
        create_filters(dev_ch, dev_rate, &freqs, &current_eq.bands)
    } else {
        vec![Vec::new(); dev_ch]
    };

    let mut resampler: SincFixedIn<f32> = SincFixedIn::<f32>::new(
        (dev_rate as f64 / file_rate as f64) / current_eq.speed as f64,
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
                    ring.0.lock().unwrap().clear();
                    pending.iter_mut().for_each(|ch| ch.clear());
                }
                Err(_) => break,
            }
        }
        if !running { break; }

        let exc_now = *exclusive_mode.lock().unwrap();
        if exc_now != last_exclusive {
            let current_pos = *position_secs.lock().unwrap();
            next_track_info = Some((path.to_string(), current_pos));
            break;
        }

        let now_dev = target_device.lock().unwrap().clone();
        if let Some(name) = now_dev {
            #[allow(deprecated)]
            let current_name = device.name().unwrap_or_default();
            if current_name != name {
                let current_pos = *position_secs.lock().unwrap();
                next_track_info = Some((path.to_string(), current_pos));
                break;
            }
        }

        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(_) => break, 
        };
        if packet.track_id() != track_id { continue; }

        if let Some(tb) = time_base {
            let t = tb.calc_time(packet.ts());
            *position_secs.lock().unwrap() = t.seconds as f64 + t.frac;
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

        let eq_now = eq_state.lock().unwrap().clone();
        if eq_now.enabled != current_eq.enabled || eq_now.bands != current_eq.bands {
            if eq_now.enabled {
                filters = create_filters(dev_ch, dev_rate, &freqs, &eq_now.bands);
            } else {
                filters = vec![Vec::new(); dev_ch]
            }
            current_eq.enabled = eq_now.enabled;
            current_eq.bands = eq_now.bands;
        }

        if eq_now.speed != current_eq.speed {
            let speed_ratio = (dev_rate as f64 / file_rate as f64) / eq_now.speed as f64;
            resampler = SincFixedIn::<f32>::new(
                speed_ratio,
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
            current_eq.speed = eq_now.speed;
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

            let boost_sum: f32 = current_eq.bands.iter().filter(|&&v| v > 0.0).sum();
            let eq_attenuation = (1.0 - (boost_sum / 80.0)).max(0.5);
            let final_gain = if current_eq.enabled { 0.85 * eq_attenuation } else { 1.0 };

            if current_eq.enabled {
                for ch in 0..use_ch {
                    if ch < filters.len() && !filters[ch].is_empty() {
                        for i in 0..out_planar[ch].len() {
                            let mut sample = out_planar[ch][i] * final_gain;
                            for filter in &mut filters[ch] { sample = filter.run(sample); }
                            out_planar[ch][i] = soft_limit(sample);
                        }
                    }
                }
            } else {
                for ch in 0..use_ch {
                    for i in 0..out_planar[ch].len() {
                        out_planar[ch][i] = out_planar[ch][i] * final_gain;
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

            let max_ring = dev_rate * dev_ch; // 1 second buffer
            let (lock, cvar) = &*ring;
            
            let mut buf = lock.lock().unwrap();
            while buf.len() + interleaved.len() > max_ring && running {
                let (new_buf, _res) = cvar.wait_timeout(buf, std::time::Duration::from_millis(20)).unwrap();
                buf = new_buf;
                
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
                        buf.clear();
                        pending.iter_mut().for_each(|ch| ch.clear());
                        break;
                    }
                    Err(_) => {}
                }
            }
            if running && interleaved.len() > 0 {
                buf.extend(interleaved);
            }
        }
    }

    // Wait for the buffer to drain entirely before emitting track-ended
    if running && next_track_info.is_none() {
        let (lock, cvar) = &*ring;
        let mut buf = lock.lock().unwrap();
        while !buf.is_empty() && running {
            let (new_buf, _res) = cvar.wait_timeout(buf, std::time::Duration::from_millis(20)).unwrap();
            buf = new_buf;
            match rx.try_recv() {
                Ok(PlayerCommand::Stop) => { running = false; break; }
                Ok(PlayerCommand::Play(p, pos)) => { running = false; next_track_info = Some((p, pos)); break; }
                Ok(PlayerCommand::Pause) => { *status.lock().unwrap() = PlaybackStatus::Paused; }
                Ok(PlayerCommand::Resume) => { *status.lock().unwrap() = PlaybackStatus::Playing; }
                _ => {}
            }
        }
        
        if running && next_track_info.is_none() {
            let _ = app_handle.emit("track-ended", ());
        }
    }

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
