use std::sync::{Arc, Mutex};
use std::io::BufRead;
use std::thread;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU32, AtomicU64, Ordering};

pub mod dsp;
pub use dsp::*;

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
use tauri::{Emitter, Manager};

#[allow(dead_code)]
pub enum ActiveStream {
    Cpal(cpal::Stream),
    Wasapi(crate::wasapi_engine::WasapiStream),
}

use crate::safe_lock;

/// 📦 Grouped decoder state to simplify passing multiple arguments
struct DecoderInfo {
    pub format: Box<dyn symphonia::core::formats::FormatReader>,
    pub decoder: Box<dyn symphonia::core::codecs::Decoder>,
    pub track_id: u32,
    pub time_base: Option<TimeBase>,
    pub file_rate: usize,
    pub file_ch: usize,
    pub resolved_path: String,
}

pub static SESSION_DOWNLOADED_BYTES: AtomicU64 = AtomicU64::new(0);
pub static CURRENT_DOWNLOAD_SPEED_BPS: AtomicU32 = AtomicU32::new(0);
pub static STREAM_LATENCY_MS: AtomicU32 = AtomicU32::new(0);
pub static ACTIVE_STREAM_BUFFERED_BYTES: AtomicU64 = AtomicU64::new(0);
pub static ACTIVE_STREAM_TOTAL_BYTES: AtomicU64 = AtomicU64::new(0);

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
                if c.channels() as usize == file_ch
                    && (c.sample_format() == cpal::SampleFormat::I32 || c.sample_format() == cpal::SampleFormat::I24)
                    && c.min_sample_rate() <= (file_rate as u32)
                    && c.max_sample_rate() >= (file_rate as u32)
                {
                    let cfg = c.with_sample_rate(file_rate as u32).config();
                    println!("AUDIOPHILE: Native Integer Match ({:?}): {}Hz", c.sample_format(), file_rate);
                    configs.push((cfg, c.sample_format()));
                }
            }
            
            // Priority 2b: I16
            if configs.is_empty() {
                for c in &supported_configs {
                    if c.channels() as usize == file_ch
                        && c.sample_format() == cpal::SampleFormat::I16
                        && c.min_sample_rate() <= (file_rate as u32)
                        && c.max_sample_rate() >= (file_rate as u32)
                    {
                        let cfg = c.with_sample_rate(file_rate as u32).config();
                        println!("AUDIOPHILE: Native I16 Match: {}Hz", file_rate);
                        configs.push((cfg, c.sample_format()));
                    }
                }
            }

            // Priority 2c: F32
            if configs.is_empty() {
                for c in &supported_configs {
                    if c.channels() as usize == file_ch
                        && c.sample_format() == cpal::SampleFormat::F32
                        && c.min_sample_rate() <= (file_rate as u32)
                        && c.max_sample_rate() >= (file_rate as u32)
                    {
                        let cfg = c.with_sample_rate(file_rate as u32).config();
                        println!("AUDIOPHILE: Native Float Match: {}Hz", file_rate);
                        configs.push((cfg, c.sample_format()));
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

lazy_static::lazy_static! {
    static ref YOUTUBE_URL_CACHE: std::sync::Mutex<std::collections::HashMap<String, String>> = std::sync::Mutex::new(std::collections::HashMap::new());
    static ref ACTIVE_DOWNLOADS: std::sync::Mutex<std::collections::HashMap<String, Arc<AtomicBool>>> = std::sync::Mutex::new(std::collections::HashMap::new());
    static ref ACTIVE_DOWNLOAD_PROCS: std::sync::Mutex<std::collections::HashMap<String, Arc<std::sync::Mutex<Option<std::process::Child>>>>> = std::sync::Mutex::new(std::collections::HashMap::new());
}

struct GrowingFileReader {
    file: std::fs::File,
    complete: Arc<AtomicBool>,
}

impl std::io::Read for GrowingFileReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let start_wait = std::time::Instant::now();
        loop {
            match self.file.read(buf) {
                Ok(0) => {
                    if self.complete.load(Ordering::SeqCst) {
                        return Ok(0);
                    }
                    if start_wait.elapsed() > std::time::Duration::from_secs(120) {
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::TimedOut,
                            "GrowingFileReader: Download stalled for more than 120 seconds",
                        ));
                    }
                    std::thread::sleep(std::time::Duration::from_millis(50));
                }
                res => return res,
            }
        }
    }
}

impl std::io::Seek for GrowingFileReader {
    fn seek(&mut self, pos: std::io::SeekFrom) -> std::io::Result<u64> {
        self.file.seek(pos)
    }
}

impl symphonia::core::io::MediaSource for GrowingFileReader {
    fn is_seekable(&self) -> bool {
        true
    }
    fn byte_len(&self) -> Option<u64> {
        None
    }
}

fn get_cache_paths(url: &str) -> Option<(std::path::PathBuf, std::path::PathBuf)> {
    let hash = format!("{:x}", md5::compute(url.as_bytes()));
    let data_dir = dirs::data_dir()?;
    let cache_dir = data_dir.join("Aideo").join("CloudCache");
    let _ = std::fs::create_dir_all(&cache_dir);
    let cache_path = cache_dir.join(format!("{}.cache", hash));
    let temp_path = cache_dir.join(format!("{}.tmp", hash));
    Some((cache_path, temp_path))
}

struct DownloadGuard {
    hash: String,
    complete: Arc<AtomicBool>,
}

impl Drop for DownloadGuard {
    fn drop(&mut self) {
        self.complete.store(true, Ordering::SeqCst);
        if let Ok(mut active) = ACTIVE_DOWNLOADS.lock() {
            active.remove(&self.hash);
        }
    }
}


const YT_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

fn pipe_url_to_stdin(
    url: String,
    mut stdin: std::process::ChildStdin,
    is_youtube_stream: bool,
) {
    let ua = YT_USER_AGENT.to_string();
    
    std::thread::spawn(move || {
        use std::io::{Read, Write};
        let mut bytes_written: u64 = 0;
        let mut retry_count = 0;
        let max_retries = 15; // Allow ample retries to recover from long system sleep / wakeup WiFi delay

        while retry_count < max_retries {
            let client = reqwest::blocking::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(15))
                .tcp_keepalive(std::time::Duration::from_secs(15))
                .build()
                .unwrap_or_else(|_| reqwest::blocking::Client::new());

            let mut req = client.get(&url).header("User-Agent", &ua);
            if is_youtube_stream {
                req = req.header("Referer", "https://www.google.com/");
            }

            if bytes_written > 0 {
                req = req.header("Range", format!("bytes={}-", bytes_written));
                println!("[player-pipe] Requesting HTTP Range resume from byte {}...", bytes_written);
            }

            match req.send() {
                Ok(mut response) => {
                    let status = response.status();
                    if status.is_success() {
                        retry_count = 0; // Reset retry counter on successful connection

                        if let Some(len) = response.content_length() {
                            ACTIVE_STREAM_TOTAL_BYTES.store(len + bytes_written, Ordering::Relaxed);
                        } else {
                            ACTIVE_STREAM_TOTAL_BYTES.store(0, Ordering::Relaxed);
                        }

                        if bytes_written > 0 && status == reqwest::StatusCode::OK {
                            println!("[player-pipe] Server ignored Range header. Skipping first {} bytes...", bytes_written);
                            let mut to_skip = bytes_written;
                            let mut skip_buf = [0; 16384];
                            let mut skip_failed = false;
                            while to_skip > 0 {
                                let chunk_size = std::cmp::min(to_skip, skip_buf.len() as u64) as usize;
                                match response.read(&mut skip_buf[..chunk_size]) {
                                    Ok(0) => {
                                        eprintln!("[player-pipe] Server sent premature EOF while skipping.");
                                        skip_failed = true;
                                        break;
                                    }
                                    Ok(n) => to_skip -= n as u64,
                                    Err(e) => {
                                        eprintln!("[player-pipe] Error skipping bytes: {:?}", e);
                                        skip_failed = true;
                                        break;
                                    }
                                }
                            }
                            if skip_failed {
                                retry_count += 1;
                                std::thread::sleep(std::time::Duration::from_millis(500 * retry_count));
                                continue;
                            }
                        }

                        let mut buffer = [0; 16384];
                        let mut read_error = false;
                        loop {
                            match response.read(&mut buffer) {
                                Ok(0) => break, // EOF reached
                                Ok(n) => {
                                    if stdin.write_all(&buffer[..n]).is_err() {
                                        // stdin is closed (FFmpeg stopped reading). Exit thread immediately.
                                        println!("[player-pipe] FFmpeg stdin closed. Terminating pipe thread.");
                                        return;
                                    }
                                    bytes_written += n as u64;
                                    SESSION_DOWNLOADED_BYTES.fetch_add(n as u64, Ordering::Relaxed);
                                    ACTIVE_STREAM_BUFFERED_BYTES.store(bytes_written, Ordering::Relaxed);
                                }
                                Err(e) => {
                                    eprintln!("[player-pipe] Read error after {} bytes: {:?}. Attempting resume...", bytes_written, e);
                                    read_error = true;
                                    break;
                                }
                            }
                        }

                        if !read_error {
                            // Streamed to EOF successfully!
                            return;
                        }
                    } else {
                        eprintln!("[player-pipe] HTTP status error: {}. Retrying...", status);
                    }
                }
                Err(e) => {
                    eprintln!("[player-pipe] Request error: {:?}. Retrying...", e);
                }
            }

            retry_count += 1;
            // Sleep with backoff before retrying
            let sleep_ms = std::cmp::min(500 * retry_count, 5000);
            std::thread::sleep(std::time::Duration::from_millis(sleep_ms));
        }

        eprintln!("[player-pipe] Max retries reached. Stream pipe thread failed.");
    });
}

fn spawn_youtube_downloader(
    original_url: String,
    resolved_url: String,
    hash: String,
    temp_path: std::path::PathBuf,
    cache_path: std::path::PathBuf,
    ffmpeg_path: String,
    ytdlp_path: String,
    app_handle: tauri::AppHandle,
) -> Arc<AtomicBool> {
    let complete = Arc::new(AtomicBool::new(false));
    let complete_clone = complete.clone();
    
    if let Ok(mut active) = ACTIVE_DOWNLOADS.lock() {
        active.insert(hash.clone(), complete.clone());
    }
    
    let child_ref = Arc::new(std::sync::Mutex::new(None));
    let child_ref_clone = Arc::clone(&child_ref);
    if let Ok(mut active_procs) = ACTIVE_DOWNLOAD_PROCS.lock() {
        active_procs.insert(hash.clone(), child_ref.clone());
    }
    
    let hash_clone = hash.clone();
    let app_handle_clone = app_handle.clone();
    std::thread::spawn(move || {
        let _guard = DownloadGuard {
            hash: hash_clone.clone(),
            complete: complete_clone,
        };
        
        let stream_engine = {
            if let Some(state) = app_handle.try_state::<crate::AppState>() {
                let player = safe_lock(&state.player);
                let d = safe_lock(&player.dsp_state);
                d.stream_engine.clone()
            } else {
                "yt-dlp".to_string()
            }
        };

        let is_youtube_stream = original_url.contains("youtube.com") || original_url.contains("googlevideo.com") || original_url.contains("youtu.be");
        let is_hls = original_url.contains("hls_playlist") || original_url.contains(".m3u8");
        
        let mut use_ytdlp = is_youtube_stream && !is_hls && std::path::Path::new(&ytdlp_path).exists() && stream_engine == "yt-dlp";
        let mut transcode_success;

        for attempt in 0..2 {
            println!("[player-bg] YouTube background transcode attempt {} (use_ytdlp={}): {} -> {:?}", attempt, use_ytdlp, original_url, temp_path);

            let mut ytdlp_child = if use_ytdlp {
                let mut ytdlp_cmd = std::process::Command::new(&ytdlp_path);
                let cache_dir_str = temp_path.parent().unwrap().join("cache").to_string_lossy().to_string();
                ytdlp_cmd.args([
                    "-f", "251/140/bestaudio/best",
                    "--user-agent", YT_USER_AGENT,
                    "--cache-dir", &cache_dir_str,
                    "--force-ipv4",
                    "--no-check-formats",
                    "--no-playlist",
                    "--no-check-certificate",
                    "--sleep-interval", "0",
                    "--max-sleep-interval", "0",
                    "--sleep-requests", "0",
                    "--extractor-args", "youtube:player-client=mweb,android",
                    "-o", "-",
                    &original_url
                ]);
                
                #[cfg(target_os = "windows")]
                use std::os::windows::process::CommandExt;
                #[cfg(target_os = "windows")]
                ytdlp_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
                
                ytdlp_cmd
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped())
                    .spawn()
                    .ok()
            } else {
                None
            };
            
            let mut cmd = std::process::Command::new(&ffmpeg_path);
            
            let mut args = Vec::new();
            args.extend([
                "-loglevel".to_string(), "warning".to_string(),
                "-probesize".to_string(), "32768".to_string(),
                "-analyzeduration".to_string(), "100000".to_string(),
            ]);
            
            if is_hls {
                let ua = if is_youtube_stream {
                    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36"
                } else {
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
                };
                args.extend([
                    "-protocol_whitelist".to_string(), "file,http,https,tcp,tls,dns".to_string(),
                    "-user_agent".to_string(), ua.to_string(),
                ]);
                if is_youtube_stream {
                    args.extend([
                        "-headers".to_string(), "Referer: https://www.google.com/\r\n".to_string(),
                    ]);
                }
                args.extend([
                    "-i".to_string(), resolved_url.clone(),
                ]);
            } else {
                args.extend([
                    "-i".to_string(), "pipe:".to_string(),
                ]);
            }
            
            args.extend([
                "-y".to_string(),
                "-f".to_string(), "wav".to_string(),
                "-acodec".to_string(), "pcm_s16le".to_string(),
                "-ar".to_string(), "44100".to_string(),
                "-ac".to_string(), "2".to_string(),
                temp_path.to_string_lossy().to_string(),
            ]);
            
            cmd.args(&args);
            
            if is_hls {
                cmd.stdin(std::process::Stdio::null());
            } else if let Some(ref mut ytdlp) = ytdlp_child {
                let stdout_pipe = ytdlp.stdout.take().unwrap();
                cmd.stdin(std::process::Stdio::from(stdout_pipe));
            } else {
                cmd.stdin(std::process::Stdio::piped());
            }
            
            cmd.stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());
            
            #[cfg(target_os = "windows")]
            use std::os::windows::process::CommandExt;
            #[cfg(target_os = "windows")]
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            
            let mut child = match cmd.spawn() {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[player-bg] FFmpeg background transcode failed to spawn on attempt {}: {:?}", attempt, e);
                    if let Some(mut ytdlp) = ytdlp_child {
                        let _ = ytdlp.kill();
                    }
                    if use_ytdlp {
                        use_ytdlp = false;
                        let _ = std::fs::remove_file(&temp_path);
                        continue;
                    }
                    if let Ok(mut active_procs) = ACTIVE_DOWNLOAD_PROCS.lock() {
                        active_procs.remove(&hash_clone);
                    }
                    return;
                }
            };
            
            let stdout = child.stdout.take();
            let stderr = child.stderr.take();
            
            if !is_hls && ytdlp_child.is_none() {
                if let Some(stdin) = child.stdin.take() {
                    pipe_url_to_stdin(resolved_url.clone(), stdin, is_youtube_stream);
                }
            }
            
            // Put the child in the child_ref mutex
            {
                if let Ok(mut lock) = child_ref_clone.lock() {
                    *lock = Some(child);
                }
            }
            
            // Spawn a thread to read and discard stdout to prevent pipe buffer blocking
            if let Some(mut out) = stdout {
                std::thread::spawn(move || {
                    use std::io::Read;
                    let mut buf = [0u8; 4096];
                    while let Ok(n) = out.read(&mut buf) {
                        if n == 0 { break; }
                    }
                });
            }
            
            // Spawn a thread to read and print stderr to prevent pipe buffer blocking and aid in debugging
            if let Some(err) = stderr {
                std::thread::spawn(move || {
                    use std::io::{BufRead, BufReader};
                    let reader = BufReader::new(err);
                    for line in reader.lines().map_while(Result::ok) {
                        eprintln!("[ffmpeg-bg-err] {}", line);
                    }
                });
            }
            
            // Wait for transcoding completion using non-blocking try_wait loop
            transcode_success = false;
            loop {
                // Check if the process has been aborted (drained from ACTIVE_DOWNLOAD_PROCS)
                let is_aborted = {
                    if let Ok(active_procs) = ACTIVE_DOWNLOAD_PROCS.lock() {
                        !active_procs.contains_key(&hash_clone)
                    } else {
                        false
                    }
                };
                if is_aborted {
                    break;
                }
                
                let mut lock = child_ref_clone.lock().unwrap();
                if let Some(ref mut child_proc) = *lock {
                    match child_proc.try_wait() {
                        Ok(None) => {
                            // Still running. Drop lock and sleep.
                        }
                        Ok(Some(status)) => {
                            transcode_success = status.success();
                            break;
                        }
                        Err(e) => {
                            eprintln!("[player-bg] Error polling transcode process status: {:?}", e);
                            break;
                        }
                    }
                } else {
                    // Child has been taken out by abort thread
                    break;
                }
                drop(lock);
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            
            // Ensure we remove it from ACTIVE_DOWNLOAD_PROCS if it exited naturally
            if let Ok(mut active_procs) = ACTIVE_DOWNLOAD_PROCS.lock() {
                active_procs.remove(&hash_clone);
            }
            
            // Clean up both processes
            let mut ytdlp_to_kill = ytdlp_child;
            if let Some(mut ytdlp) = ytdlp_to_kill.take() {
                let _ = ytdlp.kill();
                let _ = ytdlp.wait();
            }
            
            if transcode_success {
                println!("[player-bg] Transcode completed successfully for {}", hash_clone);
                // Encrypt the temp file to cache path
                if let Ok(bytes) = std::fs::read(&temp_path) {
                    let encrypted = crate::cloud::xor_cipher(&bytes);
                    if std::fs::write(&cache_path, encrypted).is_ok() {
                        println!("[player-bg] Encrypted cache written successfully: {:?}", cache_path);
                        // Clean up temp file
                        let _ = std::fs::remove_file(&temp_path);
                    }
                }
                break; // Break the attempt loop on success!
            } else {
                let bytes_written = std::fs::metadata(&temp_path).map(|m| m.len()).unwrap_or(0);
                if use_ytdlp && bytes_written < 256 * 1024 {
                    println!("[player-bg] yt-dlp background transcode failed early (written {} bytes). Retrying with direct reqwest stream...", bytes_written);
                    
                    let _ = app_handle_clone.emit("ui-toast", serde_json::json!({
                        "message": "⚠ YouTube fast-buffering failed; falling back to standard stream.",
                        "type": "warning"
                    }));
                    
                    use_ytdlp = false;
                    let _ = std::fs::remove_file(&temp_path);
                    continue; // Retry with reqwest fallback
                }
                
                eprintln!("[player-bg] FFmpeg background transcode failed or was interrupted.");
                // Kill and wait for child process to guarantee termination
                {
                    if let Ok(mut lock) = child_ref_clone.lock() {
                        if let Some(mut child_proc) = lock.take() {
                            let _ = child_proc.kill();
                            let _ = child_proc.wait();
                        }
                    }
                }
                // Clean up temp file
                let _ = std::fs::remove_file(&temp_path);
                break; // Break on complete failure
            }
        }
    });
    
    complete
}

pub fn clear_youtube_url_cache() {
    if let Ok(mut cache) = YOUTUBE_URL_CACHE.lock() {
        cache.clear();
    }
}

fn run_ytdlp_resolve(ytdlp_path: &std::path::Path, args: &[String]) -> Option<String> {
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;

    let mut cmd = std::process::Command::new(ytdlp_path);
    cmd.args(args);

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[player] Failed to spawn yt-dlp resolve: {}", e);
            return None;
        }
    };

    let timeout = std::time::Duration::from_secs(10);
    let start = std::time::Instant::now();

    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                break Some(status);
            }
            Ok(None) => {
                if start.elapsed() >= timeout {
                    println!("[player] yt-dlp resolve timed out after 10s. Killing process...");
                    let _ = child.kill();
                    let _ = child.wait();
                    break None;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => {
                eprintln!("[player] Error waiting for yt-dlp resolve process: {}", e);
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    }?;
    if status.success() {
        let mut stdout_str = String::new();
        if let Some(mut stdout) = child.stdout {
            let _ = std::io::Read::read_to_string(&mut stdout, &mut stdout_str);
        }
        let direct_url = stdout_str.trim().to_string();
        if direct_url.starts_with("http") {
            return Some(direct_url);
        }
    } else {
        let mut stderr_str = String::new();
        if let Some(mut stderr) = child.stderr {
            let _ = std::io::Read::read_to_string(&mut stderr, &mut stderr_str);
        }
        eprintln!("[player] yt-dlp resolve failed: {}", stderr_str.trim());
    }
    None
}

pub fn resolve_youtube_url(url: &str) -> String {
    if !url.contains("youtube.com") && !url.contains("youtu.be") {
        return url.to_string();
    }
    
    // Check cache first
    {
        let cache = safe_lock(&YOUTUBE_URL_CACHE);
        if let Some(cached) = cache.get(url) {
            println!("[player] Using cached direct stream URL for YouTube video.");
            return cached.clone();
        }
    }
    
    println!("[player] YouTube URL detected. Attempting to extract direct stream URL via yt-dlp...");
    
    let data_dir = dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let aideo_dir = data_dir.join("Aideo");
    let ytdlp_path = aideo_dir.join("yt-dlp.exe");
    
    if !ytdlp_path.exists() {
        println!("[player] Warning: yt-dlp.exe not found. Cannot resolve direct stream URL.");
        return url.to_string();
    }
    
    let cache_dir_str = aideo_dir.join("cache").to_string_lossy().to_string();
    
    let args_1 = vec![
        "-g".to_string(),
        "-f".to_string(), "251/140/bestaudio/best".to_string(),
        "--user-agent".to_string(), YT_USER_AGENT.to_string(),
        "--cache-dir".to_string(), cache_dir_str.clone(),
        "--force-ipv4".to_string(),
        "--no-check-formats".to_string(),
        "--no-playlist".to_string(),
        "--no-check-certificate".to_string(),
        "--sleep-interval".to_string(), "0".to_string(),
        "--max-sleep-interval".to_string(), "0".to_string(),
        "--sleep-requests".to_string(), "0".to_string(),
        url.to_string(),
    ];
    
    if let Some(direct) = run_ytdlp_resolve(&ytdlp_path, &args_1) {
        println!("[player] Successfully extracted YouTube direct stream URL on first attempt!");
        let mut cache = safe_lock(&YOUTUBE_URL_CACHE);
        cache.insert(url.to_string(), direct.clone());
        return direct;
    }
    
    // Attempt 2: Self-update and retry
    println!("[player] Initial resolve failed. Attempting to self-update yt-dlp...");
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut update_cmd = std::process::Command::new(&ytdlp_path);
        update_cmd.arg("-U");
        update_cmd.creation_flags(0x08000000);
        let _ = update_cmd.status();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut update_cmd = std::process::Command::new(&ytdlp_path);
        update_cmd.arg("-U");
        let _ = update_cmd.status();
    }
        
    if let Some(direct) = run_ytdlp_resolve(&ytdlp_path, &args_1) {
        println!("[player] Successfully extracted YouTube direct stream URL after update!");
        let mut cache = safe_lock(&YOUTUBE_URL_CACHE);
        cache.insert(url.to_string(), direct.clone());
        return direct;
    }
    
    let args_3 = vec![
        "-g".to_string(),
        "-f".to_string(), "251/140/bestaudio/best".to_string(),
        "--user-agent".to_string(), YT_USER_AGENT.to_string(),
        "--cache-dir".to_string(), cache_dir_str.clone(),
        "--force-ipv4".to_string(),
        "--no-check-formats".to_string(),
        "--no-playlist".to_string(),
        "--no-check-certificate".to_string(),
        "--sleep-interval".to_string(), "0".to_string(),
        "--max-sleep-interval".to_string(), "0".to_string(),
        "--sleep-requests".to_string(), "0".to_string(),
        "--extractor-args".to_string(), "youtube:player-client=mweb,android".to_string(),
        url.to_string(),
    ];
    
    if let Some(direct) = run_ytdlp_resolve(&ytdlp_path, &args_3) {
        println!("[player] Successfully extracted YouTube direct stream URL with client bypass!");
        let mut cache = safe_lock(&YOUTUBE_URL_CACHE);
        cache.insert(url.to_string(), direct.clone());
        return direct;
    }
    
    println!("[player] Failed to resolve YouTube stream URL through all attempts.");
    // Invalidate the cached YouTube InnerTube API key so it will be re-fetched on next attempt/request
    if let Ok(handle) = tokio::runtime::Handle::try_current() {
        handle.spawn(crate::youtube::invalidate_innertube_key());
    } else {
        std::thread::spawn(|| {
            if let Ok(rt) = tokio::runtime::Builder::new_current_thread().enable_all().build() {
                rt.block_on(crate::youtube::invalidate_innertube_key());
            }
        });
    }
    url.to_string()
}

/// 🚀 Pre-resolve and pre-buffer a YouTube watch URL in the background to eliminate initial play/transition latency.
pub fn pre_resolve_youtube_url(url: String, app_handle: tauri::AppHandle) {
    if !url.contains("youtube.com") && !url.contains("youtu.be") {
        return;
    }

    let (cache_path, temp_path) = match get_cache_paths(&url) {
        Some(paths) => paths,
        None => return,
    };

    // If already fully cached, do nothing
    if cache_path.exists() {
        return;
    }

    let hash = format!("{:x}", md5::compute(url.as_bytes()));

    // If already downloading, do nothing
    {
        if let Ok(mut active) = ACTIVE_DOWNLOADS.lock() {
            if active.contains_key(&hash) {
                return;
            }
            // Mark as active immediately to prevent race conditions during URL resolution!
            active.insert(hash.clone(), Arc::new(AtomicBool::new(false)));
        }
    }
    
    std::thread::spawn(move || {
        let mut success = false;
        // Resolve the direct URL
        let mut resolved_url = {
            let cache = safe_lock(&YOUTUBE_URL_CACHE);
            cache.get(&url).cloned()
        };
        
        if resolved_url.is_none() {
            println!("[player-bg] Pre-resolving direct stream URL in background for '{}'...", url);
            let direct = resolve_youtube_url(&url);
            if direct != url && direct.contains("googlevideo.com") {
                println!("[player-bg] Background pre-resolve successful! Caching direct stream URL.");
                let mut cache = safe_lock(&YOUTUBE_URL_CACHE);
                cache.insert(url.clone(), direct.clone());
                resolved_url = Some(direct);
            }
        }

        if let Some(direct) = resolved_url {
            let data_dir = match dirs::data_dir() {
                Some(d) => d,
                None => {
                    if let Ok(mut active) = ACTIVE_DOWNLOADS.lock() {
                        active.remove(&hash);
                    }
                    return;
                }
            };
            let aideo_dir = data_dir.join("Aideo");
            let ytdlp_path = aideo_dir.join("yt-dlp.exe");
            let ffmpeg_path = aideo_dir.join("ffmpeg.exe");

            if ytdlp_path.exists() && ffmpeg_path.exists() {
                println!("[player-bg] Pre-buffering YouTube track in background for '{}'...", url);
                success = true;
                spawn_youtube_downloader(
                    url,
                    direct,
                    hash.clone(),
                    temp_path,
                    cache_path,
                    ffmpeg_path.to_string_lossy().to_string(),
                    ytdlp_path.to_string_lossy().to_string(),
                    app_handle.clone(),
                );
            }
        }
        
        if !success {
            if let Ok(mut active) = ACTIVE_DOWNLOADS.lock() {
                active.remove(&hash);
            }
        }
    });
}


fn resolve_playlist_url(url: &str) -> String {
    let url_lower = url.to_lowercase();
    if url_lower.ends_with(".pls") || url_lower.ends_with(".m3u") {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .connect_timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap_or_else(|_| reqwest::blocking::Client::new());
        if let Ok(res) = client.get(url).send() {
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

fn detect_audio_extension(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(b"fLaC") {
        "flac"
    } else if bytes.starts_with(b"ID3") || (bytes.len() >= 2 && bytes[0] == 0xFF && (bytes[1] & 0xE0) == 0xE0) {
        "mp3"
    } else if bytes.starts_with(&[0x1A, 0x45, 0xDF, 0xA3]) {
        "webm"
    } else if bytes.starts_with(b"OggS") {
        "ogg"
    } else if bytes.starts_with(b"RIFF") && bytes.len() >= 12 && &bytes[8..12] == b"WAVE" {
        "wav"
    } else if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        "m4a"
    } else {
        "mp3"
    }
}

/// 🎵 Prepare the media source and decoder
fn prepare_decoder(
    path: &str,
    start_pos: f64,
    app_handle: &tauri::AppHandle,
    ffmpeg_path: &str,
    current_process: &Arc<Mutex<Option<std::process::Child>>>,
    ffmpeg_transcode_quality: &str,
    dsp_state: &DSPState,
) -> Result<DecoderInfo, String> {
    let mut resolved_path = path.to_string();
    
    // Intercept YouTube watch URLs and route them to growing Cache file
    let is_youtube_stream = path.contains("youtube.com") || path.contains("youtu.be") || path.contains("googlevideo.com");
    if is_youtube_stream {
        let data_dir = dirs::data_dir().ok_or("Could not locate AppData directory")?;
        let aideo_dir = data_dir.join("Aideo");
        let ytdlp_path = aideo_dir.join("yt-dlp.exe");
        let ffmpeg_plugin_path = aideo_dir.join("ffmpeg.exe");
        if !ytdlp_path.exists() {
            return Err("The yt-dlp plugin is missing. Please install the yt-dlp plugin in Settings -> Plugins to play YouTube tracks!".to_string());
        }
        if !ffmpeg_plugin_path.exists() {
            return Err("The FFmpeg transcoder is missing. Please install the FFmpeg Transcoder in Settings -> Plugins to stream YouTube tracks!".to_string());
        }

        if let Some((cache_path, temp_path)) = get_cache_paths(path) {
            let mut use_cache = false;
            if cache_path.exists() {
                if let Ok(encrypted_bytes) = std::fs::read(&cache_path) {
                    let decrypted_bytes = crate::cloud::xor_cipher(&encrypted_bytes);
                    let is_corrupted = decrypted_bytes.len() < 1024 || 
                        (decrypted_bytes.len() > 10 && 
                         (decrypted_bytes[0] == b'<' || 
                          decrypted_bytes.starts_with(b"<!DOCTYPE") || 
                          decrypted_bytes.starts_with(b"<!doctype") || 
                          decrypted_bytes.starts_with(b"<html")));
                          
                    if is_corrupted {
                        println!("[player] Warning: Cached file for '{}' is corrupted (HTML/invalid bytes). Deleting and forcing online stream fallback...", path);
                        let _ = std::fs::remove_file(&cache_path);
                    } else {
                        let ext = "wav";
                        let temp_dir = std::env::temp_dir();
                        let hash = format!("{:x}", md5::compute(path.as_bytes()));
                        let decrypted_temp_path = temp_dir.join(format!("aideo_cache_{}.{}", hash, ext));
                        if std::fs::write(&decrypted_temp_path, decrypted_bytes).is_ok() {
                            resolved_path = decrypted_temp_path.to_string_lossy().to_string();
                            println!("[player] INTERCEPT: Playing YouTube track from offline decrypted cache file!");
                            use_cache = true;
                        }
                    }
                }
            }
            
            if !use_cache {
                let hash = format!("{:x}", md5::compute(path.as_bytes()));
                let mut already_downloading = false;
                {
                    if let Ok(mut active) = ACTIVE_DOWNLOADS.lock() {
                        if active.contains_key(&hash) {
                            already_downloading = true;
                        } else {
                            active.insert(hash.clone(), Arc::new(AtomicBool::new(false)));
                        }
                    }
                }

                if !already_downloading {
                    let mut resolved_url = {
                        let cache = safe_lock(&YOUTUBE_URL_CACHE);
                        cache.get(path).cloned()
                    };

                    if resolved_url.is_none() {
                        println!("[player] YouTube URL cache miss. Resolving direct stream URL first...");
                        let direct = resolve_youtube_url(path);
                        if direct != *path && direct.contains("googlevideo.com") {
                            let mut cache = safe_lock(&YOUTUBE_URL_CACHE);
                            cache.insert(path.to_string(), direct.clone());
                            resolved_url = Some(direct);
                        } else {
                            if let Ok(mut active) = ACTIVE_DOWNLOADS.lock() {
                                active.remove(&hash);
                            }
                            return Err("Failed to resolve YouTube stream URL. Please check your internet connection.".to_string());
                        }
                    }

                    if let Some(direct) = resolved_url {
                        println!("[player] Spawning background transcoder for YouTube stream...");
                        spawn_youtube_downloader(
                            path.to_string(),
                            direct,
                            hash.clone(),
                            temp_path.clone(),
                            cache_path.clone(),
                            ffmpeg_path.to_string(),
                            ytdlp_path.to_string_lossy().to_string(),
                            app_handle.clone(),
                        );
                    }
                }

                resolved_path = temp_path.to_string_lossy().to_string();

                println!("[player] Buffering first 256KB of YouTube track to ensure stable probing...");
                let start_time = std::time::Instant::now();
                loop {
                    let file_size = std::fs::metadata(&temp_path).map(|m| m.len()).unwrap_or(0);
                    if file_size >= 256 * 1024 {
                        break;
                    }
                    if start_time.elapsed().as_secs() > 20 {
                        return Err("Buffering timed out. Please check your internet connection and verify that the yt-dlp plugin is working.".to_string());
                    }
                    std::thread::sleep(std::time::Duration::from_millis(100));
                }
                println!("[player] Buffering complete ({} bytes). Handing over to Symphonia decoding...", std::fs::metadata(&temp_path).map(|m| m.len()).unwrap_or(0));
            }
        }
    } else if path.starts_with("http://") || path.starts_with("https://") {
        // Transparently load cached cloud stream tracks if available
        let hash = format!("{:x}", md5::compute(path.as_bytes()));
        if let Some(data_dir) = dirs::data_dir() {
            let cache_path = data_dir.join("Aideo").join("CloudCache").join(format!("{}.cache", hash));
            if cache_path.exists() {
                if let Ok(encrypted_bytes) = std::fs::read(&cache_path) {
                    let decrypted_bytes = crate::cloud::xor_cipher(&encrypted_bytes);
                    let is_corrupted = decrypted_bytes.len() < 1024 || 
                        (decrypted_bytes.len() > 10 && 
                         (decrypted_bytes[0] == b'<' || 
                          decrypted_bytes.starts_with(b"<!DOCTYPE") || 
                          decrypted_bytes.starts_with(b"<!doctype") || 
                          decrypted_bytes.starts_with(b"<html")));
                          
                    if is_corrupted {
                        println!("[player] Warning: Cached cloud file for '{}' is corrupted (HTML/invalid bytes). Deleting cache...", path);
                        let _ = std::fs::remove_file(&cache_path);
                    } else {
                        let ext = detect_audio_extension(&decrypted_bytes);
                        let temp_dir = std::env::temp_dir();
                        let temp_path = temp_dir.join(format!("aideo_cache_{}.{}", hash, ext));
                        if std::fs::write(&temp_path, decrypted_bytes).is_ok() {
                            resolved_path = temp_path.to_string_lossy().to_string();
                            println!("[player] INTERCEPT: Playing cloud track from offline decrypted cache file!");
                        }
                    }
                }
            }
        }
    }
    
    let path = resolved_path.as_str();

    let is_stream = path.starts_with("http://") || path.starts_with("https://");
    let is_dsd = if !is_stream {
        if let Some(ext) = std::path::Path::new(path).extension() {
            let ext_str = ext.to_string_lossy().to_lowercase();
            ext_str == "dsf" || ext_str == "dff"
        } else {
            false
        }
    } else {
        false
    };
    let mut use_ffmpeg = is_stream || is_dsd || dsp_state.aideo_filter_enabled;

    if !is_stream && !is_dsd {
        // Try native Symphonia probing and decoding first for maximum quality/bit-perfect local playback
        let file_res: Result<Box<dyn symphonia::core::io::MediaSource>, _> = if path.contains(".tmp") {
            let hash = std::path::Path::new(path).file_name().and_then(|s| s.to_str()).unwrap_or("").replace(".tmp", "");
            let mut complete_flag = None;
            {
                if let Ok(active) = ACTIVE_DOWNLOADS.lock() {
                    if let Some(flag) = active.get(&hash) {
                        complete_flag = Some(flag.clone());
                    }
                }
            }
            if let Some(complete) = complete_flag {
                if let Ok(file) = std::fs::File::open(path) {
                    println!("[player] Opening GrowingFileReader for YouTube track: {}", path);
                    Ok(Box::new(GrowingFileReader { file, complete }))
                } else {
                    Err(std::io::Error::new(std::io::ErrorKind::NotFound, "File not found"))
                }
            } else {
                std::fs::File::open(path).map(|f| Box::new(f) as Box<dyn symphonia::core::io::MediaSource>)
            }
        } else {
            std::fs::File::open(path).map(|f| Box::new(f) as Box<dyn symphonia::core::io::MediaSource>)
        };

        if let Ok(media_source) = file_res {
            let mss = MediaSourceStream::new(media_source, Default::default());
            let mut hint = Hint::new();
            if let Some(ext) = std::path::Path::new(path).extension() {
                hint.with_extension(&ext.to_string_lossy());
            }
            
            let probe_res = get_probe().format(&hint, mss, &FormatOptions::default(), &MetadataOptions { 
                limit_metadata_bytes: symphonia::core::meta::Limit::Maximum(1024 * 8),
                limit_visual_bytes: symphonia::core::meta::Limit::Maximum(1) 
            });
            
            if let Ok(probed) = probe_res {
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
                
                if let (Some(track), Some(dec)) = (selected_track, decoder) {
                    let rate = track.codec_params.sample_rate.unwrap_or(44100) as usize;
                    let ch = track.codec_params.channels.map(|c| c.count()).unwrap_or(2);
                    return Ok(DecoderInfo {
                        format,
                        decoder: dec,
                        track_id: track.id,
                        time_base: track.codec_params.time_base,
                        file_rate: rate,
                        file_ch: ch,
                        resolved_path: resolved_path.clone(),
                    });
                }
            }
        }
        
        // If native decoding failed, fall back to FFmpeg transcoder proxy
        println!("[player] Symphonia native decoding failed or unsupported codec (e.g. Dolby E-AC3/Atmos). Falling back to high-performance FFmpeg transcoder...");
        use_ffmpeg = true;
    }

    if use_ffmpeg {
        let data_dir = dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
        let aideo_dir = data_dir.join("Aideo");
        let ytdlp_path = aideo_dir.join("yt-dlp.exe");
        let is_youtube_stream = is_stream && (path.contains("youtube.com") || path.contains("youtu.be") || path.contains("googlevideo.com"));
        let use_piped_ytdlp = is_youtube_stream && ytdlp_path.exists() && start_pos == 0.0;

        let mut cached_direct_url = None;
        if is_youtube_stream {
            if path.contains("googlevideo.com") {
                cached_direct_url = Some(path.to_string());
            } else {
                let cache = safe_lock(&YOUTUBE_URL_CACHE);
                if let Some(direct_url) = cache.get(path) {
                    println!("[player] YouTube URL cache hit! Using cached direct stream URL for seeking.");
                    cached_direct_url = Some(direct_url.clone());
                }
            }

            if cached_direct_url.is_none() {
                println!("[player] YouTube URL cache miss. Resolving direct stream URL first...");
                let direct_url = resolve_youtube_url(path);
                if direct_url != *path && direct_url.contains("googlevideo.com") {
                    println!("[player] Caching resolved direct stream URL.");
                    let mut cache = safe_lock(&YOUTUBE_URL_CACHE);
                    cache.insert(path.to_string(), direct_url.clone());
                    cached_direct_url = Some(direct_url);
                }
            }
        }

        // Validate if FFmpeg is installed before spawning, returning a helpful user-friendly guidance message if missing
        let mut ffmpeg_exists = std::path::Path::new(ffmpeg_path).exists();
        if !ffmpeg_exists {
            #[cfg(target_os = "windows")]
            {
                ffmpeg_exists = std::process::Command::new(ffmpeg_path)
                    .arg("-version")
                    .creation_flags(0x08000000) // CREATE_NO_WINDOW
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false);
            }
            #[cfg(not(target_os = "windows"))]
            {
                ffmpeg_exists = std::process::Command::new(ffmpeg_path)
                    .arg("-version")
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false);
            }
        }
        
        if !ffmpeg_exists {
            let msg = if is_stream {
                "The FFmpeg transcoder is required for playing online web streams. Please install the FFmpeg Transcoder in Settings -> Plugins to start playback!".to_string()
            } else {
                "This audio track is encoded in a format that requires external transcoding (e.g. Dolby Atmos / DTS). Please install the FFmpeg Transcoder in the Settings tab to play it!".to_string()
            };
            return Err(msg);
        }

        println!("[player] Preparing FFmpeg transcode proxy for {} (seek position: {}s)...", path, start_pos);
        
        #[cfg(target_os = "windows")]
        use std::os::windows::process::CommandExt;
        
        let mut cmd = std::process::Command::new(ffmpeg_path);
        
        let mut resolved_url = if is_stream {
            if use_piped_ytdlp {
                cached_direct_url.clone().unwrap_or_else(|| path.to_string())
            } else if is_youtube_stream {
                cached_direct_url.clone().unwrap_or_else(|| resolve_youtube_url(&resolve_playlist_url(path)))
            } else {
                resolve_youtube_url(&resolve_playlist_url(path))
            }
        } else {
            path.to_string()
        };
        let is_hls = is_stream && (resolved_url.contains("hls_playlist") || resolved_url.contains(".m3u8"));
        let mut use_ffmpeg_seek = true;

        if is_stream && start_pos > 0.0 {
            if resolved_url.contains("/rest/stream") || resolved_url.contains("/rest/stream.view") {
                // Subsonic: Append timeOffset query parameter
                let separator = if resolved_url.contains('?') { "&" } else { "?" };
                resolved_url = format!("{}{}timeOffset={}", resolved_url, separator, start_pos.round() as u64);
                use_ffmpeg_seek = false;
                println!("[player] Detected Subsonic stream. Injected server-side seek: timeOffset={}s", start_pos.round() as u64);
            } else if resolved_url.contains("/Audio/") && resolved_url.contains("/stream") {
                // Jellyfin: Append StartTimeTicks query parameter (1 tick = 100ns = 1/10,000,000th of a second)
                let separator = if resolved_url.contains('?') { "&" } else { "?" };
                let ticks = (start_pos * 10_000_000.0).round() as u64;
                resolved_url = format!("{}{}StartTimeTicks={}", resolved_url, separator, ticks);
                use_ffmpeg_seek = false;
                println!("[player] Detected Jellyfin stream. Injected server-side seek: StartTimeTicks={}", ticks);
            }
        }

        let mut args = Vec::new();
        
        // Insert -ss BEFORE -i for input-position seeking (avoids decoding entire stream from byte 0)
        if use_ffmpeg_seek && start_pos > 0.0 {
            args.push("-ss".to_string());
            args.push(start_pos.to_string());
        }

        if is_stream {
            args.extend([
                "-loglevel".to_string(), "warning".to_string(),
                "-probesize".to_string(), "32768".to_string(),
                "-analyzeduration".to_string(), "100000".to_string(),
            ]);
            if is_hls {
                let ua = if is_youtube_stream {
                    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36"
                } else {
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
                };
                args.extend([
                    "-protocol_whitelist".to_string(), "file,http,https,tcp,tls,dns".to_string(),
                    "-user_agent".to_string(), ua.to_string(),
                ]);
                if is_youtube_stream {
                    args.extend([
                        "-headers".to_string(), "Referer: https://www.google.com/\r\n".to_string(),
                    ]);
                }
                args.extend([
                    "-i".to_string(), resolved_url.clone(),
                ]);
            } else {
                args.extend([
                    "-i".to_string(), "pipe:".to_string(),
                ]);
            }
        } else {
            // Local file inputs only need basic probing options
            args.extend([
                "-loglevel".to_string(), "warning".to_string(),
                "-probesize".to_string(), "32768".to_string(),
                "-analyzeduration".to_string(), "100000".to_string(),
                "-i".to_string(), resolved_url.clone(),
            ]);
        }
        
        if dsp_state.aideo_filter_enabled {
            let delay1 = (dsp_state.aideo_filter_room_size * 50.0).round() as u32;
            let delay2 = (dsp_state.aideo_filter_room_size * 80.0).round() as u32;
            let lowshelf_db = dsp_state.aideo_filter_bass_thump * 0.7; // add warmth
            let af_filter = format!(
                "aecho=0.8:0.88:{}|{}:0.4|0.3, extrastereo=m=1.6, lowshelf=f=120:g={:.1}, equalizer=f=55:width_type=h:w=30:g={:.1}, freeverb=roomsize={:.2}:damp={:.2}:wet=0.35:dry=0.75, highshelf=f=10000:g=-5:t=1",
                delay1, delay2, lowshelf_db, dsp_state.aideo_filter_bass_thump, dsp_state.aideo_filter_room_size, dsp_state.aideo_filter_dampening
            );
            args.push("-af".to_string());
            args.push(af_filter);
        }
        
        let (codec, rate) = match ffmpeg_transcode_quality {
            "hires" => ("pcm_s24le", if is_dsd { "176400" } else { "96000" }),
            "studio" => ("pcm_s24le", if is_dsd { "88200" } else { "48000" }),
            _ => ("pcm_s16le", "44100"),
        };

        args.extend([
            "-f".to_string(), "wav".to_string(),
            "-acodec".to_string(), codec.to_string(),
            "-ar".to_string(), rate.to_string(),
            "-ac".to_string(), "2".to_string(),
            "-".to_string()
        ]);
        
        cmd.args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

        if is_stream {
            if is_hls {
                cmd.stdin(std::process::Stdio::null());
            } else {
                cmd.stdin(std::process::Stdio::piped());
            }
        }
        
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        // Kill existing process safely
        if let Some(mut old_child) = safe_lock(current_process).take() {
            let _ = old_child.kill();
            let _ = old_child.wait(); // reap zombie immediately
        }

        let mss = if use_piped_ytdlp {
            let mut ytdlp_cmd = std::process::Command::new(&ytdlp_path);
            let cache_dir_str = aideo_dir.join("cache").to_string_lossy().to_string();
            ytdlp_cmd.args([
                "-f", "251/140/bestaudio/best",
                "--cache-dir", &cache_dir_str,
                "--force-ipv4",
                "--no-check-formats",
                "--no-playlist",
                "--no-check-certificate",
                "--sleep-interval", "0",
                "--max-sleep-interval", "0",
                "--sleep-requests", "0",
                "-o", "-",
                path
            ]);

            #[cfg(target_os = "windows")]
            ytdlp_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

            let mut ytdlp_child = match ytdlp_cmd
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn() 
            {
                Ok(c) => c,
                Err(e) => return Err(format!("Failed to spawn yt-dlp: {}", e)),
            };

            let ytdlp_stdout = ytdlp_child.stdout.take().ok_or("Failed to open yt-dlp stdout")?;
            let ytdlp_stderr = ytdlp_child.stderr.take().ok_or("Failed to open yt-dlp stderr")?;

            // Spawn stderr reader for yt-dlp to aid in debugging
            thread::spawn(move || {
                let reader = std::io::BufReader::new(ytdlp_stderr);
                for line in reader.lines().map_while(Result::ok) {
                    eprintln!("[yt-dlp-err] {}", line);
                }
            });

            let mut ffmpeg_cmd = std::process::Command::new(ffmpeg_path);
            let mut args = Vec::new();
            args.extend([
                "-probesize".to_string(), "1048576".to_string(),
                "-analyzeduration".to_string(), "5000000".to_string(),
                "-i".to_string(), "pipe:".to_string(),
            ]);

            if start_pos > 0.0 {
                args.push("-ss".to_string());
                args.push(start_pos.to_string());
            }
            
            if dsp_state.aideo_filter_enabled {
                let delay1 = (dsp_state.aideo_filter_room_size * 50.0).round() as u32;
                let delay2 = (dsp_state.aideo_filter_room_size * 80.0).round() as u32;
                let lowshelf_db = dsp_state.aideo_filter_bass_thump * 0.7; // add warmth
                let af_filter = format!(
                    "aecho=0.8:0.88:{}|{}:0.4|0.3, extrastereo=m=1.6, lowshelf=f=120:g={:.1}, equalizer=f=55:width_type=h:w=30:g={:.1}, freeverb=roomsize={:.2}:damp={:.2}:wet=0.35:dry=0.75, highshelf=f=10000:g=-5:t=1",
                    delay1, delay2, lowshelf_db, dsp_state.aideo_filter_bass_thump, dsp_state.aideo_filter_room_size, dsp_state.aideo_filter_dampening
                );
                args.push("-af".to_string());
                args.push(af_filter);
            }

            let (codec, rate) = match ffmpeg_transcode_quality {
                "hires" => ("pcm_s24le", "96000"),
                "studio" => ("pcm_s24le", "48000"),
                _ => ("pcm_s16le", "44100"),
            };

            args.extend([
                "-f".to_string(), "wav".to_string(),
                "-acodec".to_string(), codec.to_string(),
                "-ar".to_string(), rate.to_string(),
                "-ac".to_string(), "2".to_string(),
                "-".to_string()
            ]);

            ffmpeg_cmd.args(&args)
                .stdin(std::process::Stdio::from(ytdlp_stdout))
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());

            #[cfg(target_os = "windows")]
            ffmpeg_cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

            match ffmpeg_cmd.spawn() {
                Ok(mut child) => {
                    let stderr = child.stderr.take().ok_or("Failed to open FFmpeg stderr")?;
                    thread::spawn(move || {
                        let reader = std::io::BufReader::new(stderr);
                        for line in reader.lines().map_while(Result::ok) {
                            eprintln!("[ffmpeg-err] {}", line);
                        }
                        // Kill yt-dlp when ffmpeg exits to prevent orphan processes
                        let _ = ytdlp_child.kill();
                        let _ = ytdlp_child.wait();
                        println!("[player] Piped yt-dlp process cleaned up successfully.");
                    });
                    let stdout = child.stdout.take().ok_or("Failed to open FFmpeg stdout")?;
                    *safe_lock(current_process) = Some(child);
                    let source = symphonia::core::io::ReadOnlySource::new(stdout);
                    MediaSourceStream::new(Box::new(source), Default::default())
                }
                Err(e) => return Err(format!("FFmpeg failed: {}", e)),
            }
        } else {
            match cmd.spawn() {
                Ok(mut child) => {
                    let stderr = child.stderr.take().ok_or("Failed to open FFmpeg stderr")?;
                    thread::spawn(move || {
                        let reader = std::io::BufReader::new(stderr);
                        for line in reader.lines().map_while(Result::ok) {
                            eprintln!("[ffmpeg-err] {}", line);
                        }
                    });
                    
                    if is_stream {
                        if !is_hls {
                            if let Some(stdin) = child.stdin.take() {
                                let is_youtube = resolved_url.contains("youtube.com") || resolved_url.contains("googlevideo.com") || resolved_url.contains("youtu.be");
                                pipe_url_to_stdin(resolved_url.clone(), stdin, is_youtube);
                            }
                        }
                    }
                    
                    let stdout = child.stdout.take().ok_or("Failed to open FFmpeg stdout")?;
                    *safe_lock(current_process) = Some(child);
                    let source = symphonia::core::io::ReadOnlySource::new(stdout);
                    MediaSourceStream::new(Box::new(source), Default::default())
                },
                Err(e) => return Err(format!("FFmpeg failed: {}", e)),
            }
        };

        let mut hint = Hint::new();
        hint.with_extension("wav"); // FFmpeg outputs WAV stream

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
            let _ = app_handle.emit("playback-success", path.to_string());
        }

        Ok(DecoderInfo {
            format,
            decoder,
            track_id,
            time_base: track.codec_params.time_base,
            file_rate: rate,
            file_ch: ch,
            resolved_path: resolved_path.clone(),
        })
    } else {
        Err("Invalid state: neither native nor FFmpeg decoder path executed".to_string())
    }
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

    // Soundstage
    pub spatial_enabled: bool,
    pub spatial_haas_delay: f32,
    pub spatial_wet: f32,

    // Dynamics
    pub subsonic_enabled: bool,
    pub night_mode_enabled: bool,
    pub r128_enabled: bool,

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
    pub lookahead_prebuffer_enabled: bool,
}
fn find_ffmpeg_path() -> String {

    // 1. Check Aideo AppData directory (where dynamic installs are placed)
    let data_dir = dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let aideo_dir = data_dir.join("Aideo");
    let appdata_path = aideo_dir.join("ffmpeg.exe");
    if appdata_path.exists() {
        return appdata_path.to_string_lossy().to_string();
    }

    // 2. Check current executable folder dynamically (portable fallback)
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let path = exe_dir.join("ffmpeg.exe");
            if path.exists() {
                return path.to_string_lossy().to_string();
            }
        }
    }

    // 3. Fallback to system environment PATH
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
    pub status: Arc<AtomicU8>,
    pub current_track: Arc<Mutex<Option<String>>>,
    pub position_secs: Arc<AtomicU64>,
    pub volume: Arc<AtomicU32>,
    pub exclusive_mode: Arc<AtomicBool>,
    pub dsp_state: Arc<Mutex<DSPState>>,
    pub target_device: Arc<Mutex<Option<String>>>,
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

fn detect_format_from_path(path: &str) -> String {
    if path.contains("youtube.com") || path.contains("youtu.be") || path.contains("googlevideo.com") {
        "YouTube".to_string()
    } else if path.contains("tidal.com") || path.contains("api.tidal.com") {
        "Tidal Lossless".to_string()
    } else if path.contains("/rest/stream") || path.contains("/rest/stream.view") {
        "Subsonic Cloud".to_string()
    } else if path.contains("/Audio/") && path.contains("/stream") {
        "Jellyfin Cloud".to_string()
    } else if path.starts_with("http") {
        "HTTP Stream".to_string()
    } else {
        std::path::Path::new(path)
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_uppercase())
            .unwrap_or_else(|| "Unknown".to_string())
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
        let status = Arc::new(AtomicU8::new(0)); // 0 = Stopped
        let current_track = Arc::new(Mutex::new(None::<String>));
        let position_secs = Arc::new(AtomicU64::new(0.0f64.to_bits()));
        let volume = Arc::new(AtomicU32::new(1.0f32.to_bits()));
        let exclusive_mode = Arc::new(AtomicBool::new(false));
        let dsp_state = Arc::new(Mutex::new(DSPState {
            enabled: false,
            low_spec_mode: false,
            audio_profile: "normal".to_string(),
            resampler_interpolation: "linear".to_string(),
            resampler_sinc_len: 128,
            resampler_oversampling: 256,
            ffmpeg_transcode_quality: "studio".to_string(),
            width: 1.0,
            upsample_rate: 0,
            dither: false,
            exclusive_mode_timing: "polling".to_string(),
            preamp_gain: 0.0,
            limiter_threshold: -0.1,
            resampler_phase_mode: "linear".to_string(),

            // EQ
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

            // Aideo Filter
            aideo_filter_enabled: false,
            aideo_filter_room_size: 0.85,
            aideo_filter_bass_thump: 6.0,
            aideo_filter_dampening: 0.5,
            auto_headroom: false,
            saturation_enabled: false,
            saturation_drive: 0.0,
            crossfade_transition_enabled: false,
            crossfade_transition_duration: 5.0,
            stream_engine: "yt-dlp".to_string(),
            lookahead_prebuffer_enabled: true,
        }));
        let target_device = Arc::new(Mutex::new(None::<String>));
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

        // Cleanup orphaned .tmp files in CloudCache on startup
        if let Some(data_dir) = dirs::data_dir() {
            let cache_dir = data_dir.join("Aideo").join("CloudCache");
            if let Ok(entries) = std::fs::read_dir(&cache_dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_file() {
                        if let Some(ext) = p.extension() {
                            if ext == "tmp" {
                                let _ = std::fs::remove_file(p);
                            }
                        }
                    }
                }
            }
        }

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
            .spawn(move || player_loop(cmd_rx, cmd_tx_clone, s, c, p, v, exc, bp, dr, ca, dsp, dev, qt, cp, app, fft_tx, ds, fr, fc, fmt))
            .expect("Failed to spawn player thread");

        Player { cmd_tx, status, current_track, position_secs, volume, exclusive_mode, dsp_state, target_device, queue, app_handle, current_process, ffmpeg_path, bit_perfect, current_dev_rate, cache, decode_shutdown, file_rate, file_ch, file_format }
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
                    abort_background_downloads();
                    status.store(0, Ordering::Relaxed); // 0 = Stopped
                    let mut ct = safe_lock(&current_track);
                    *ct = None;
                    continue;
                }

                // Re-inject deferred commands back into the channel so they get processed in order
                for deferred in deferred_commands {
                    let _ = cmd_tx.send(deferred);
                }

                {
                    status.store(1, Ordering::Relaxed); // 1 = Playing
                    let mut ct = safe_lock(&current_track);
                    *ct = Some(path.clone());
                    position_secs.store(start_pos.to_bits(), Ordering::Relaxed);
                }

                let ffmpeg_path = find_ffmpeg_path();
                next_track = play_file(&path, start_pos, Arc::clone(&status), Arc::clone(&current_track), Arc::clone(&position_secs), Arc::clone(&volume), Arc::clone(&exclusive_mode), Arc::clone(&bit_perfect), Arc::clone(&current_dev_rate), Arc::clone(&cache), Arc::clone(&dsp_state), Arc::clone(&target_device), Arc::clone(&queue), Arc::clone(&current_process), cmd_tx.clone(), &rx, &app_handle, &fft_tx, &ffmpeg_path, Arc::clone(&decode_shutdown), Arc::clone(&file_rate), Arc::clone(&file_ch), Arc::clone(&file_format));

                if next_track.is_none() {
                    status.store(0, Ordering::Relaxed); // 0 = Stopped
                    let mut ct = safe_lock(&current_track);
                    *ct = None;
                    position_secs.store(0.0f64.to_bits(), Ordering::Relaxed);
                }
            }
            PlayerCommand::RestartStream => {
                let (path, pos) = {
                    let ct = safe_lock(&current_track);
                    let ps = f64::from_bits(position_secs.load(Ordering::Relaxed));
                    if let Some(p) = ct.clone() { (p, ps) } else { continue; }
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
    if let Some(mut child) = safe_lock(current_process).take() {
        let _ = child.kill();
        let _ = child.wait(); // reap zombie process immediately
    }
}

pub fn abort_background_downloads() {
    println!("[player] Aborting all active background downloads...");
    if let Ok(active) = ACTIVE_DOWNLOADS.lock() {
        for flag in active.values() {
            flag.store(true, Ordering::SeqCst);
        }
    }
    if let Ok(mut active_procs) = ACTIVE_DOWNLOAD_PROCS.lock() {
        for (hash, child_ref) in active_procs.drain() {
            println!("[player] Killing background transcode process for hash: {}", hash);
            if let Ok(mut lock) = child_ref.lock() {
                if let Some(mut child) = lock.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    }
}

pub struct LookaheadLimiter {
    delay_buffers: Vec<VecDeque<f32>>,
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
            gain_envelope: 1.0,
            attack_coeff,
            release_coeff,
        }
    }

    pub fn process(&mut self, samples: &mut [f32], threshold_db: f32) {
        let threshold = 10.0f32.powf(threshold_db / 20.0);
        let chs = samples.len();
        
        // 1. Push input samples to delay lines
        for ch in 0..chs {
            self.delay_buffers[ch].push_back(samples[ch]);
        }

        // 2. Look ahead: detect the peak in the delay buffers
        let mut peak = 0.0f32;
        for ch in 0..chs {
            for &s in self.delay_buffers[ch].iter() {
                peak = peak.max(s.abs());
            }
        }

        // 3. Calculate target gain for this frame
        let target_gain = if peak > threshold {
            threshold / peak
        } else {
            1.0
        };

        // 4. Smooth gain envelope (ballistics)
        if target_gain < self.gain_envelope {
            self.gain_envelope = self.gain_envelope * self.attack_coeff + target_gain * (1.0 - self.attack_coeff);
        } else {
            self.gain_envelope = self.gain_envelope * self.release_coeff + target_gain * (1.0 - self.release_coeff);
        }

        // 5. Pop delayed samples and apply gain envelope
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
    filters_l: Vec<AllPassFilter>,
    filters_r: Vec<AllPassFilter>,
}

impl PhaseResponseNode {
    pub fn new() -> Self {
        Self {
            enabled: false,
            mode: "linear".to_string(),
            filters_l: Vec::new(),
            filters_r: Vec::new(),
        }
    }
}

impl AudioNode for PhaseResponseNode {
    fn process(&mut self, samples: &mut [Vec<f32>], _sample_rate: f32) {
        if !self.enabled || self.mode == "linear" || samples.is_empty() {
            return;
        }
        let channels = samples.len();
        if channels >= 1 {
            for val in samples[0].iter_mut() {
                let mut s = *val;
                for f in &mut self.filters_l {
                    s = f.process(s);
                }
                *val = s;
            }
        }
        if channels >= 2 {
            for val in samples[1].iter_mut() {
                let mut s = *val;
                for f in &mut self.filters_r {
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
            self.filters_l = (0..num_filters).map(|_| AllPassFilter::new(coeff)).collect();
            self.filters_r = (0..num_filters).map(|_| AllPassFilter::new(coeff)).collect();
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
    enabled: bool,
    crossfeed_lp_l: BiquadFilter,
    crossfeed_lp_r: BiquadFilter,
    crossfeed_delay_l: CircularDelayLine,
    crossfeed_delay_r: CircularDelayLine,
    crossfeed_level: f32,
    crossfeed_corner: f32,
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
        }
    }
}

impl AudioNode for CrossfeedNode {
    fn process(&mut self, samples: &mut [Vec<f32>], sample_rate: f32) {
        if !self.enabled || samples.len() < 2 {
            return;
        }
        let delay_samples = ((0.000300 * sample_rate as f64).round() as usize).clamp(1, 1000);
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
        self.crossfeed_level = dsp.crossfeed_level;
        self.crossfeed_corner = dsp.crossfeed_corner;
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
        let (left, right) = samples.split_at_mut(1);
        let l_channel = &mut left[0];
        let r_channel = &mut right[0];

        for i in 0..l_channel.len() {
            let mut l = l_channel[i];
            let mut r = r_channel[i];

            let mid = (l + r) * 0.5;
            let side = (l - r) * 0.5;

            self.spatial_delay_side.push(side);

            let ref1_samples = ((0.0030 * sample_rate as f64).round() as usize).clamp(1, 2047);
            let ref2_samples = ((0.0055 * sample_rate as f64).round() as usize).clamp(1, 2047);
            let ref3_samples = ((0.0082 * sample_rate as f64).round() as usize).clamp(1, 2047);
            let ref4_samples = ((0.0110 * sample_rate as f64).round() as usize).clamp(1, 2047);

            let ref1 = self.spatial_delay_side.read_delayed(ref1_samples) * 0.08;
            let ref2 = self.spatial_delay_side.read_delayed(ref2_samples) * -0.06;
            let ref3 = self.spatial_delay_side.read_delayed(ref3_samples) * 0.04;
            let ref4 = self.spatial_delay_side.read_delayed(ref4_samples) * -0.03;

            let reflections = (ref1 + ref2 + ref3 + ref4) * self.spatial_wet;

            let haas_samples = ((self.spatial_haas_delay * 0.001 * sample_rate).round() as usize).clamp(1, 2047);
            let side_delayed = self.spatial_delay_side.read_delayed(haas_samples);
            let side_room = side_delayed + reflections;

            let intensity = self.spatial_wet;
            let theta = (intensity * std::f32::consts::FRAC_PI_4).clamp(0.0, std::f32::consts::FRAC_PI_2);
            let cos_t = theta.cos();
            let sin_t = theta.sin();

            l = mid * cos_t + side_room * sin_t;
            r = mid * cos_t - side_room * sin_t;

            l_channel[i] = l;
            r_channel[i] = r;
        }
    }
    fn update_params(&mut self, dsp: &DSPState, _sample_rate: f32) {
        self.enabled = dsp.enabled && dsp.spatial_enabled;
        self.spatial_wet = dsp.spatial_wet;
        self.spatial_haas_delay = dsp.spatial_haas_delay;
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

            let cur_lufs = 10.0 * self.r128_slow_rms.log10().max(-100.0) - 0.69;
            let diff = target_lufs - cur_lufs;

            let target_gain = 10.0f32.powf(diff / 20.0).clamp(0.25, 2.0);
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
        self.enabled = dsp.enabled && dsp.r128_enabled;
    }
}

pub struct LimiterNode {
    enabled: bool,
    limiter: LookaheadLimiter,
    threshold_db: f32,
    final_gain: f32,
}

impl LimiterNode {
    pub fn new(channels: usize, lookahead_ms: f32, sample_rate: f32) -> Self {
        Self {
            enabled: false,
            limiter: LookaheadLimiter::new(channels, lookahead_ms, sample_rate),
            threshold_db: -0.1,
            final_gain: 1.0,
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
                frame[ch] = samples[ch][i] * self.final_gain;
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
        self.final_gain = if dsp.enabled { 0.95 } else { 1.0 };
    }
}

fn background_decode(
    path: String,
    samples: Arc<Mutex<Vec<Vec<f32>>>>,
    complete: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
) {
    let mut use_ffmpeg = false;
    let mut format_opt = None;
    let mut decoder_opt = None;
    let mut track_id = 0;

    // 1. Try native Symphonia decoding first
    let file_res: Result<Box<dyn symphonia::core::io::MediaSource>, _> = if path.contains(".tmp") {
        let hash = std::path::Path::new(&path).file_name().and_then(|s| s.to_str()).unwrap_or("").replace(".tmp", "");
        let mut complete_flag = None;
        {
            if let Ok(active) = ACTIVE_DOWNLOADS.lock() {
                if let Some(flag) = active.get(&hash) {
                    complete_flag = Some(flag.clone());
                }
            }
        }
        if let Some(complete) = complete_flag {
            if let Ok(file) = std::fs::File::open(&path) {
                println!("[player-bg] Opening GrowingFileReader in background_decode for: {}", path);
                Ok(Box::new(GrowingFileReader { file, complete }))
            } else {
                Err(std::io::Error::new(std::io::ErrorKind::NotFound, "File not found"))
            }
        } else {
            std::fs::File::open(&path).map(|f| Box::new(f) as Box<dyn symphonia::core::io::MediaSource>)
        }
    } else {
        std::fs::File::open(&path).map(|f| Box::new(f) as Box<dyn symphonia::core::io::MediaSource>)
    };

    if let Ok(media_source) = file_res {
        let mss = MediaSourceStream::new(media_source, Default::default());
        let mut hint = Hint::new();
        if let Some(ext) = std::path::Path::new(&path).extension() {
            hint.with_extension(&ext.to_string_lossy());
        }

        if let Ok(probed) = get_probe().format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default()) {
            let mut selected_track = None;
            let mut decoder = None;
            for t in probed.format.tracks() {
                if let Ok(d) = get_codecs().make(&t.codec_params, &DecoderOptions::default()) {
                    selected_track = Some(t.clone());
                    decoder = Some(d);
                    break;
                }
            }

            if let (Some(track), Some(dec)) = (selected_track, decoder) {
                format_opt = Some(probed.format);
                decoder_opt = Some(dec);
                track_id = track.id;
            }
        }
    }

    // 2. Fall back to FFmpeg transcoder if native decoding failed
    let mut child_process = None;
    if format_opt.is_none() {
        println!("[player-bg] Native decoding failed. Spawning FFmpeg transcode cache for {}...", path);
        let ffmpeg_path = find_ffmpeg_path();
        
        let mut ffmpeg_exists = std::path::Path::new(&ffmpeg_path).exists();
        if !ffmpeg_exists {
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                ffmpeg_exists = std::process::Command::new(&ffmpeg_path)
                    .arg("-version")
                    .creation_flags(0x08000000) // CREATE_NO_WINDOW
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false);
            }
            #[cfg(not(target_os = "windows"))]
            {
                ffmpeg_exists = std::process::Command::new(&ffmpeg_path)
                    .arg("-version")
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false);
            }
        }

        if ffmpeg_exists {
            #[cfg(target_os = "windows")]
            use std::os::windows::process::CommandExt;
            
            let mut cmd = std::process::Command::new(&ffmpeg_path);
            cmd.args([
                "-probesize", "32768",
                "-analyzeduration", "100000",
                "-i", &path,
                "-f", "wav",
                "-acodec", "pcm_s16le",
                "-ar", "44100",
                "-ac", "2",
                "-"
            ])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null());

            #[cfg(target_os = "windows")]
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

            if let Ok(mut child) = cmd.spawn() {
                let stdout = child.stdout.take().unwrap();
                child_process = Some(child);
                
                let source = symphonia::core::io::ReadOnlySource::new(stdout);
                let mss_ffmpeg = MediaSourceStream::new(Box::new(source), Default::default());
                let mut hint_ffmpeg = Hint::new();
                hint_ffmpeg.with_extension("wav");

                let metadata_opts = MetadataOptions {
                    limit_metadata_bytes: symphonia::core::meta::Limit::Maximum(1024 * 8),
                    limit_visual_bytes: symphonia::core::meta::Limit::Maximum(1)
                };
                if let Ok(probed) = get_probe().format(&hint_ffmpeg, mss_ffmpeg, &FormatOptions::default(), &metadata_opts) {
                    let mut selected_track = None;
                    let mut decoder = None;
                    for t in probed.format.tracks() {
                        if let Ok(d) = get_codecs().make(&t.codec_params, &DecoderOptions::default()) {
                            selected_track = Some(t.clone());
                            decoder = Some(d);
                            break;
                        }
                    }

                    if let (Some(track), Some(dec)) = (selected_track, decoder) {
                        format_opt = Some(probed.format);
                        decoder_opt = Some(dec);
                        track_id = track.id;
                        use_ffmpeg = true;
                    }
                }
            }
        }
    }

    let mut format = match format_opt {
        Some(f) => f,
        None => {
            println!("[player-bg] Error: All decoding methods failed for {}.", path);
            complete.store(true, Ordering::SeqCst); // Avoid hanging caller in waiting loop
            return;
        }
    };
    let mut decoder = decoder_opt.unwrap();

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
            for (ch, buf) in local_buffers.iter_mut().enumerate().take(file_ch) {
                let src: Vec<f32> = match &decoded {
                    AudioBufferRef::F32(b) => b.chan(ch).to_vec(),
                    AudioBufferRef::S16(b) => b.chan(ch).iter().map(|&s| s as f32 / i16::MAX as f32).collect(),
                    AudioBufferRef::S32(b) => b.chan(ch).iter().map(|&s| s as f32 / i32::MAX as f32).collect(),
                    AudioBufferRef::U8(b)  => b.chan(ch).iter().map(|&s| (s as f32 - 128.0) / 128.0).collect(),
                    AudioBufferRef::S24(b) => b.chan(ch).iter().map(|&s| s.inner() as f32 / 8_388_607.0).collect(),
                    AudioBufferRef::F64(b) => b.chan(ch).iter().map(|&s| s as f32).collect(),
                    _ => vec![0.0; n_frames],
                };
                buf.extend(src);
            }
            
            packet_count += 1;
            if packet_count >= 64 {
                let mut lock = safe_lock(&samples);
                for ch in 0..file_ch {
                    lock[ch].append(&mut local_buffers[ch]);
                }
                packet_count = 0;
            }
        }
    }

    if packet_count > 0 {
        let mut lock = safe_lock(&samples);
        for ch in 0..file_ch {
            lock[ch].append(&mut local_buffers[ch]);
        }
    }

    if let Some(mut child) = child_process {
        let _ = child.kill();
        let _ = child.wait();
    }

    complete.store(true, Ordering::SeqCst);
    println!("[player-bg] Successfully completed pre-decoding RAM cache for {} (used_ffmpeg = {})!", path, use_ffmpeg);
}


fn play_file(
    path: &str,
    start_pos: f64,
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
    
    let resolved_path = path.to_string();

    let dsp_now = safe_lock(&dsp_state).clone();
    let transcode_quality = dsp_now.ffmpeg_transcode_quality.clone();

    let (tx, rx_decoder) = std::sync::mpsc::channel();
    let path_clone = resolved_path.clone();
    let app_handle_clone = app_handle.clone();
    let ffmpeg_clone = ffmpeg_path.to_string();
    let process_clone = Arc::clone(&current_process);
    let quality_clone = transcode_quality.clone();
    let dsp_clone = dsp_now.clone();

    std::thread::spawn(move || {
        let res = prepare_decoder(
            &path_clone,
            start_pos,
            &app_handle_clone,
            &ffmpeg_clone,
            &process_clone,
            &quality_clone,
            &dsp_clone,
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
                    kill_current_process(&current_process); // Ensure dead process is reaped immediately
                    let _ = app_handle.emit("playback-error", e);
                    return None;
                }
            }
        }

        // 2. Poll commands channel to abort preparation instantly if new player command arrives
        if let Ok(cmd) = rx.try_recv() {
            match cmd {
                PlayerCommand::Stop => {
                    abort_background_downloads();
                    kill_current_process(&current_process);
                    return None;
                }
                PlayerCommand::Play(p, pos) => {
                    abort_background_downloads();
                    kill_current_process(&current_process);
                    return Some((p, pos));
                }
                PlayerCommand::Seek(secs) => {
                    abort_background_downloads();
                    kill_current_process(&current_process);
                    return Some((path.to_string(), secs));
                }
                PlayerCommand::Pause => {
                    status.store(2, Ordering::Relaxed);
                }
                PlayerCommand::Resume => {
                    status.store(1, Ordering::Relaxed);
                }
                PlayerCommand::RestartStream => {
                    abort_background_downloads();
                    kill_current_process(&current_process);
                    return Some((path.to_string(), start_pos));
                }
                PlayerCommand::PushNext(path) => {
                    safe_lock(&queue).push_front(path);
                }
                PlayerCommand::AppendQueue(path) => {
                    safe_lock(&queue).push_back(path);
                }
            }
        }

        std::thread::sleep(std::time::Duration::from_millis(50));
    };

    let resolved_path = info.resolved_path.clone();

    let file_rate = info.file_rate;
    let file_ch = info.file_ch;
    let track_id = info.track_id;
    let mut format = info.format;
    let mut decoder = info.decoder;
    let time_base = info.time_base;

    let is_stream = resolved_path.starts_with("http://") || resolved_path.starts_with("https://");
    if is_stream {
        let hash = format!("{:x}", md5::compute(path.as_bytes()));
        let mut already_cached = false;
        if let Some(data_dir) = dirs::data_dir() {
            let cache_path = data_dir.join("Aideo").join("CloudCache").join(format!("{}.cache", hash));
            if cache_path.exists() {
                already_cached = true;
            }
        }
        if !already_cached {
            let stream_url = path.to_string();
            let is_youtube = stream_url.contains("youtube.com") || stream_url.contains("youtu.be");
            
            if !is_youtube {
                let app = app_handle.clone();
                std::thread::spawn(move || {
                    println!("[player-bg-cache] Automatically caching stream in background: {}", stream_url);
                    let resolved_url = resolve_playlist_url(&stream_url);
                    let hash = format!("{:x}", md5::compute(stream_url.as_bytes()));
                    if let Some(data_dir) = dirs::data_dir() {
                        let cache_dir = data_dir.join("Aideo").join("CloudCache");
                        if std::fs::create_dir_all(&cache_dir).is_ok() {
                            let cache_path = cache_dir.join(format!("{}.cache", hash));
                            let temp_path = cache_dir.join(format!("{}.tmp", hash));
                            if !cache_path.exists() {
                                const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";
                                let client = reqwest::blocking::Client::builder()
                                    .timeout(std::time::Duration::from_secs(600))
                                    .connect_timeout(std::time::Duration::from_secs(10))
                                    .build()
                                    .unwrap_or_else(|_| reqwest::blocking::Client::new());
                                let mut req = client.get(&resolved_url);
                                req = req.header("User-Agent", USER_AGENT);

                                if let Ok(mut res) = req.send() {
                                    if res.status().is_success() {
                                        let is_infinite = res.content_length().is_none();
                                        let is_too_large = res.content_length().map(|len| len > 150 * 1024 * 1024).unwrap_or(false);

                                        if is_infinite {
                                            println!("[player-bg-cache] Aborting cache: Infinite stream detected (missing Content-Length).");
                                        } else if is_too_large {
                                            println!("[player-bg-cache] Aborting cache: File size exceeds 150MB limit ({} bytes).", res.content_length().unwrap_or(0));
                                        } else if let Ok(mut temp_file) = std::fs::File::create(&temp_path) {
                                            let mut temp_buf = vec![0u8; 16384];
                                            let mut download_failed = false;
                                            let mut bytes_written = 0;
                                            let key = b"AIDEO_OFFLINE_CACHE_KEY_2026";
                                            
                                            use std::io::{Read, Write};
                                            loop {
                                                match res.read(&mut temp_buf) {
                                                    Ok(0) => break,
                                                    Ok(n) => {
                                                        for idx in 0..n {
                                                            let global_pos = bytes_written + idx;
                                                            temp_buf[idx] ^= key[global_pos % key.len()];
                                                        }
                                                        if temp_file.write_all(&temp_buf[..n]).is_err() {
                                                            download_failed = true;
                                                            break;
                                                        }
                                                        bytes_written += n;
                                                    }
                                                    Err(_) => {
                                                        download_failed = true;
                                                        break;
                                                    }
                                                }
                                            }
                                            
                                            if !download_failed && bytes_written > 0 {
                                                let _ = temp_file.flush();
                                                drop(temp_file);
                                                if std::fs::rename(&temp_path, &cache_path).is_ok() {
                                                    println!("[player-bg-cache] Stream successfully cached to disk!");
                                                    let _ = crate::cloud::prune_cache_to_limit_internal(&app);
                                                }
                                            }
                                        }
                                    }
                                }
                                let _ = std::fs::remove_file(&temp_path);
                            }
                        }
                    }
                });
            }
        }
    }

    let is_exclusive = exclusive_mode.load(Ordering::Relaxed);
    let is_stream = resolved_path.starts_with("http://") || resolved_path.starts_with("https://");

    // 1b. Safety RAM cache check: Bypass cache for large files (>150MB or >15 minutes duration)
    let duration_secs = format.tracks().first().and_then(|t| {
        t.codec_params.n_frames.and_then(|frames| {
            t.codec_params.time_base.map(|tb| frames as f64 * tb.numer as f64 / tb.denom as f64)
        })
    }).unwrap_or(0.0);

    let is_too_large = if !is_stream {
        if resolved_path.contains(".tmp") {
            false
        } else {
            let file_bytes = std::fs::metadata(&resolved_path).map(|m| m.len()).unwrap_or(0);
            let too_large = file_bytes > 150 * 1024 * 1024 || duration_secs > 900.0;
            if too_large {
                println!("[player] Track is too large ({}MB / {}s). Bypassing RAM cache to prevent massive memory usage.", file_bytes / (1024 * 1024), duration_secs.round());
                let _ = app_handle.emit("ui-toast", serde_json::json!({
                    "message": "Large file detected: Streaming directly from disk to save RAM.",
                    "type": "info"
                }));
            }
            too_large
        }
    } else {
        false
    };

    // 2. PRE-DECODE INTO RAM (if not a stream and not too large)
    let decode_shutdown = Arc::new(AtomicBool::new(false));
    {
        let mut old_shutdown = safe_lock(&player_decode_shutdown);
        if let Some(old) = old_shutdown.take() {
            old.store(true, Ordering::SeqCst);
        }
        *old_shutdown = Some(Arc::clone(&decode_shutdown));
    }
    let (decoded_samples, is_complete) = if !is_stream && !is_too_large {
        let mut cache_lock = safe_lock(&cache);
        let use_cached = if let Some(cached) = &*cache_lock {
            if cached.path == resolved_path { Some(cached.clone()) } else { None }
        } else { None };

        if let Some(cached) = use_cached {
            (Some(cached.samples), Some(cached.complete))
        } else {
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
            thread::spawn(move || {
                background_decode(path_str, s_clone, c_clone, sd_clone);
            });
            
            (Some(samples), Some(complete))
        }
    } else {
        (None, None)
    };

    // 1c. Startup demuxer seek for bypassed cache/streams (skip for HTTP streams because the transcoder/server already seeked)
    if start_pos > 0.0 && decoded_samples.is_none() && !is_stream {
        if let Some(tb) = time_base {
            let seek_ts = (start_pos * tb.denom as f64 / tb.numer as f64) as u64;
            let _ = format.seek(symphonia::core::formats::SeekMode::Accurate, symphonia::core::formats::SeekTo::TimeStamp { ts: seek_ts, track_id });
        }
    }

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
        
        match dev.or_else(|| host.default_output_device()).or_else(|| cpal::default_host().default_output_device()) {
            Some(d) => d,
            None => {
                let _ = app_handle.emit("playback-error", "No audio output device detected. Please connect headphones or speakers.");
                return None;
            }
        }
    };

    let device_display_name = target.clone().unwrap_or_else(|| "Default Device".to_string());
    
    let (upsample_target, exclusive_timing, dither_enabled) = {
        let d = safe_lock(&dsp_state);
        (d.upsample_rate, d.exclusive_mode_timing.clone(), d.dither)
    };
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

    let stream_paused = Arc::clone(&status);
    let stream_volume = Arc::clone(&volume);

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
            let mut current_gain = 0.0f32;
            if let Ok((wasapi_stream, bits, float)) = crate::wasapi_engine::start_exclusive_stream(
                &actual_dev_name,
                rate,
                channels,
                &exclusive_timing,
                dither_enabled,
                move |data: &mut [f32]| {
                    let paused = paused_cb.load(Ordering::Relaxed) != 1;
                    let vol = f32::from_bits(volume_cb.load(Ordering::Relaxed));
                    let target_gain = if paused { 0.0 } else { vol };
                    
                    if current_gain == 0.0 && target_gain == 0.0 {
                        data.fill(0.0);
                        return;
                    }
                    
                    if flush_cb.swap(false, Ordering::SeqCst) { let l = cons.len(); cons.discard(l); }
                    
                    let mut n = cons.pop_slice(data);
                    if n < data.len() {
                        n += cons.pop_slice(&mut data[n..]);
                    }
                    
                    let ch_count = channels as usize;
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
                                data[idx] *= current_gain;
                            } else {
                                data[idx] = 0.0;
                            }
                        }
                    }
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
                exclusive_mode.store(false, Ordering::Relaxed);
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
                device.build_output_stream(
                    &config_inner,
                    move |data: &mut [f32], _| {
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
                        let paused = paused_cb.load(Ordering::Relaxed) != 1;
                        let vol = f32::from_bits(volume_cb.load(Ordering::Relaxed));
                        let target_gain = if paused { 0.0 } else { vol };
                        
                        if current_gain == 0.0 && target_gain == 0.0 {
                            data.fill(0.0);
                            return;
                        }
                        
                        if flush_cb.swap(false, Ordering::SeqCst) { let l = cons.len(); cons.discard(l); }
                        
                        let mut n = cons.pop_slice(data);
                        if n < data.len() {
                            n += cons.pop_slice(&mut data[n..]);
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
                                    let s = data[idx] * current_gain;
                                    data[idx] = s.clamp(-1.0, 1.0);
                                } else {
                                    data[idx] = 0.0;
                                }
                            }
                        }
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
                device.build_output_stream(
                    &config_inner,
                    move |data: &mut [i16], _| {
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
                        let paused = paused_cb.load(Ordering::Relaxed) != 1;
                        let vol = f32::from_bits(volume_cb.load(Ordering::Relaxed));
                        let target_gain = if paused { 0.0 } else { vol };
                        
                        if current_gain == 0.0 && target_gain == 0.0 {
                            data.fill(0);
                            return;
                        }
                        
                        if flush_cb.swap(false, Ordering::SeqCst) { let l = cons.len(); cons.discard(l); }
                        
                        if buf.len() < data.len() { buf.resize(data.len(), 0.0); }
                        let mut n = cons.pop_slice(&mut buf[..data.len()]);
                        if n < data.len() {
                            n += cons.pop_slice(&mut buf[n..data.len()]);
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
                                    let multiplier = 32767.0; // i16::MAX
                                    let val = if dither_enabled {
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
                device.build_output_stream(
                    &config_inner,
                    move |data: &mut [i32], _| {
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
                        let paused = paused_cb.load(Ordering::Relaxed) != 1;
                        let vol = f32::from_bits(volume_cb.load(Ordering::Relaxed));
                        let target_gain = if paused { 0.0 } else { vol };
                        
                        if current_gain == 0.0 && target_gain == 0.0 {
                            data.fill(0);
                            return;
                        }
                        
                        if flush_cb.swap(false, Ordering::SeqCst) { let l = cons.len(); cons.discard(l); }
                        
                        if buf.len() < data.len() { buf.resize(data.len(), 0.0); }
                        let mut n = cons.pop_slice(&mut buf[..data.len()]);
                        if n < data.len() {
                            n += cons.pop_slice(&mut buf[n..data.len()]);
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
                let (mut prod, mut cons) = rb.split();
                
                let mut buf = vec![0.0f32; 8192];
                let stream_res = match fmt {
                    cpal::SampleFormat::F32 => {
                        let cmd_tx_cb = cmd_tx.clone();
                        let app_handle_cb = app_handle.clone();
                        let mut current_gain = 0.0f32;
                        let ch_count = cfg.channels as usize;
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
                            let paused = paused_cb.load(Ordering::Relaxed) != 1;
                            let vol = f32::from_bits(volume_cb.load(Ordering::Relaxed));
                            let target_gain = if paused { 0.0 } else { vol };
                            
                            if current_gain == 0.0 && target_gain == 0.0 {
                                d.fill(0.0);
                                return;
                            }
                            
                            if flush_cb.swap(false, Ordering::SeqCst) { let l = cons.len(); cons.discard(l); }
                            
                            let mut n = cons.pop_slice(d);
                            if n < d.len() {
                                n += cons.pop_slice(&mut d[n..]);
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
                            let paused = paused_cb.load(Ordering::Relaxed) != 1;
                            let vol = f32::from_bits(volume_cb.load(Ordering::Relaxed));
                            let target_gain = if paused { 0.0 } else { vol };
                            
                            if current_gain == 0.0 && target_gain == 0.0 {
                                d.fill(0);
                                return;
                            }
                            
                            if flush_cb.swap(false, Ordering::SeqCst) { let l = cons.len(); cons.discard(l); }
                            
                            if buf.len() < d.len() { buf.resize(d.len(), 0.0); }
                            let mut n = cons.pop_slice(&mut buf[..d.len()]);
                            if n < d.len() {
                                n += cons.pop_slice(&mut buf[n..d.len()]);
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
    current_dev_rate.store(dev_rate as u32, Ordering::Relaxed);

    let chunk_size = 1024usize;

    let mut current_dsp = safe_lock(&dsp_state).clone();

    // Create persistent DSP filter and delay line instances
    let mut nodes: Vec<Box<dyn AudioNode>> = vec![
        Box::new(PreampNode::new()),
        Box::new(SaturationNode::new()),
        Box::new(PhaseResponseNode::new()),
        Box::new(EqNode::new()),
        Box::new(SubsonicNode::new()),
        Box::new(CrossfeedNode::new()),
        Box::new(SpatializerNode::new()),
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
            let _ = app_handle.emit("playback-error", msg);
            return None;
        }
    };

    let mut pending: Vec<VecDeque<f32>> = vec![VecDeque::new(); file_ch];
    let mut running = true;
    let mut next_track_info: Option<(String, f64)> = None;
    let last_exclusive = is_exclusive;
    let bp_now = bit_perfect.load(Ordering::Relaxed);
    let last_bit_perfect = bp_now;
    let last_upsample_rate = upsample_target;
    let last_interpolation = current_dsp.resampler_interpolation.clone();
    let last_sinc_len = current_dsp.resampler_sinc_len;
    let last_oversampling = current_dsp.resampler_oversampling;
    let last_ffmpeg_quality = current_dsp.ffmpeg_transcode_quality.clone();
    let last_exclusive_timing = current_dsp.exclusive_mode_timing.clone();
    let last_aideo_filter_enabled = current_dsp.aideo_filter_enabled;
    let last_aideo_filter_room_size = current_dsp.aideo_filter_room_size;
    let last_aideo_filter_bass_thump = current_dsp.aideo_filter_bass_thump;
    let last_aideo_filter_dampening = current_dsp.aideo_filter_dampening;
    let is_stream = resolved_path.starts_with("http://") || resolved_path.starts_with("https://");

    // RAM BUFFER CURSOR
    let mut ram_cursor = (start_pos * file_rate as f64) as usize;

    // Crossfade State Variables
    let mut next_track_path: Option<String> = None;
    let mut next_decoder_rx: Option<std::sync::mpsc::Receiver<Result<DecoderInfo, String>>> = None;
    let mut next_decoder_info: Option<DecoderInfo> = None;
    let mut next_resampler: Option<SincFixedIn<f32>> = None;
    let mut next_pending: Vec<VecDeque<f32>> = Vec::new();
    let mut crossfade_frame_counter = 0usize;
    let mut crossfade_triggered = false;

    while running {
        loop {
            match rx.try_recv() {
                Ok(PlayerCommand::Stop) => { abort_background_downloads(); running = false; break; }
                Ok(PlayerCommand::Pause) => { status.store(2, Ordering::Relaxed); }
                Ok(PlayerCommand::Resume) => { status.store(1, Ordering::Relaxed); }
                Ok(PlayerCommand::Play(p, pos)) => { abort_background_downloads(); running = false; next_track_info = Some((p, pos)); break; }
                Ok(PlayerCommand::Seek(secs)) => {
                    if let Some(samples_arc) = &decoded_samples {
                        let lock = safe_lock(samples_arc);
                        ram_cursor = (secs * file_rate as f64) as usize;
                        if ram_cursor >= lock[0].len() && is_complete.as_ref().map(|c| c.load(Ordering::SeqCst)).unwrap_or(true) {
                            ram_cursor = lock[0].len().saturating_sub(1); 
                        }
                        position_secs.store(secs.to_bits(), Ordering::Relaxed);
                        flush_signal.store(true, Ordering::SeqCst);
                        pending.iter_mut().for_each(|ch| ch.clear());
                    } else if !is_stream {
                        if let Some(tb) = time_base {
                            let seek_ts = (secs * tb.denom as f64 / tb.numer as f64) as u64;
                            let _ = format.seek(SeekMode::Accurate, SeekTo::TimeStamp { ts: seek_ts, track_id });
                        }
                        position_secs.store(secs.to_bits(), Ordering::Relaxed);
                        flush_signal.store(true, Ordering::SeqCst);
                        pending.iter_mut().for_each(|ch| ch.clear());
                    } else {
                        // HTTP Stream: Restart FFmpeg starting at target offset!
                        abort_background_downloads();
                        decode_shutdown.store(true, Ordering::SeqCst);
                        kill_current_process(&current_process);
                        running = false;
                        next_track_info = Some((path.to_string(), secs));
                        position_secs.store(secs.to_bits(), Ordering::Relaxed);
                        break;
                    }
                }
                Ok(PlayerCommand::PushNext(path)) => {
                    safe_lock(&queue).push_front(path);
                }
                Ok(PlayerCommand::AppendQueue(path)) => {
                    safe_lock(&queue).push_back(path);
                }
                Ok(PlayerCommand::RestartStream) => {
                    abort_background_downloads();
                    let current_pos = f64::from_bits(position_secs.load(Ordering::Relaxed));
                    running = false;
                    next_track_info = Some((path.to_string(), current_pos));
                    break;
                }
                Err(_) => break,
            }
        }
        if !running { break; }
        let exc_now = exclusive_mode.load(Ordering::Relaxed);
        let bp_now = bit_perfect.load(Ordering::Relaxed);
        let dsp_now = safe_lock(&dsp_state).clone();
        
        // ONLY restart if values actually changed from what we started with
        if exc_now != last_exclusive 
            || bp_now != last_bit_perfect 
            || dsp_now.upsample_rate != last_upsample_rate 
            || dsp_now.resampler_interpolation != last_interpolation
            || dsp_now.resampler_sinc_len != last_sinc_len
            || dsp_now.resampler_oversampling != last_oversampling
            || dsp_now.ffmpeg_transcode_quality != last_ffmpeg_quality
            || dsp_now.exclusive_mode_timing != last_exclusive_timing
            || dsp_now.aideo_filter_enabled != last_aideo_filter_enabled
            || dsp_now.aideo_filter_room_size != last_aideo_filter_room_size
            || dsp_now.aideo_filter_bass_thump != last_aideo_filter_bass_thump
            || dsp_now.aideo_filter_dampening != last_aideo_filter_dampening
        {
            println!("[player] Hardware/DSP/Parameters change detected. Restarting stream...");
            let current_pos = f64::from_bits(position_secs.load(Ordering::Relaxed));
            next_track_info = Some((path.to_string(), current_pos));
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

        if dsp_now.crossfade_transition_enabled && duration_secs > dsp_now.crossfade_transition_duration as f64 {
            let crossfade_trigger_pos = duration_secs - dsp_now.crossfade_transition_duration as f64;
            if true_pos >= crossfade_trigger_pos && !crossfade_triggered {
                crossfade_triggered = true;
                let next_path_opt = {
                    let mut q = safe_lock(&queue);
                    q.pop_front()
                };
                if let Some(next_path) = next_path_opt {
                    println!("[player-crossfade] Triggering crossfade to next track: {}", next_path);
                    let app_h = app_handle.clone();
                    let ffmpeg_p = ffmpeg_path.to_string();
                    let process_c = Arc::clone(&current_process);
                    let quality = last_ffmpeg_quality.clone();
                    let dsp_c = dsp_now.clone();
                    let next_path_c = next_path.clone();

                    let (tx, rx_next_decoder) = std::sync::mpsc::channel();
                    std::thread::spawn(move || {
                        let res = prepare_decoder(
                            &next_path_c,
                            0.0,
                            &app_h,
                            &ffmpeg_p,
                            &process_c,
                            &quality,
                            &dsp_c,
                        );
                        let _ = tx.send(res);
                    });
                    next_decoder_rx = Some(rx_next_decoder);
                    next_track_path = Some(next_path);
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
                        
                        let sinc_len = dsp_now.resampler_sinc_len as usize;
                        let oversampling = dsp_now.resampler_oversampling as usize;
                        let interp_type = match dsp_now.resampler_interpolation.as_str() {
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
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("[player-crossfade] Failed to prepare next track decoder: {}", e);
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
                    if pending[0].len() < chunk_size {
                        if crossfade_triggered && next_track_path.is_some() {
                            let played_secs = crossfade_frame_counter as f64 / dev_rate as f64;
                            next_track_info = Some((next_track_path.take().unwrap(), played_secs));
                        } else {
                            let next_queued = safe_lock(&queue).pop_front();
                            if let Some(npath) = next_queued {
                                next_track_info = Some((npath, 0.0));
                            }
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
                    Err(_) => {
                        if crossfade_triggered && next_track_path.is_some() {
                            let played_secs = crossfade_frame_counter as f64 / dev_rate as f64;
                            next_track_info = Some((next_track_path.take().unwrap(), played_secs));
                            running = false;
                        }
                        break;
                    }
                };
                if packet.track_id() == track_id {
                    if let Some(_tb) = time_base {
                        // Position update moved to end of loop
                    }
                    if let Ok(decoded) = decoder.decode(&packet) {
                        let frames = decoded_frames(&decoded);
                        ram_cursor += frames;
                        for (ch, buf) in pending.iter_mut().enumerate().take(file_ch) {
                            let src: Vec<f32> = match &decoded {
                                 AudioBufferRef::F32(b) => b.chan(ch).to_vec(),
                                 AudioBufferRef::S16(b) => b.chan(ch).iter().map(|&s| s as f32 / i16::MAX as f32).collect(),
                                 AudioBufferRef::S32(b) => b.chan(ch).iter().map(|&s| s as f32 / i32::MAX as f32).collect(),
                                 AudioBufferRef::U8(b)  => b.chan(ch).iter().map(|&s| (s as f32 - 128.0) / 128.0).collect(),
                                 AudioBufferRef::S24(b) => b.chan(ch).iter().map(|&s| s.inner() as f32 / 8_388_607.0).collect(),
                                 AudioBufferRef::F64(b) => b.chan(ch).iter().map(|&s| s as f32).collect(),
                                 _ => vec![0.0; decoded_frames(&decoded)],
                             };
                            buf.extend(src);
                        }
                    }
                }
            }
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
                            let src: Vec<f32> = match &decoded {
                                 AudioBufferRef::F32(b) => b.chan(ch).to_vec(),
                                 AudioBufferRef::S16(b) => b.chan(ch).iter().map(|&s| s as f32 / i16::MAX as f32).collect(),
                                 AudioBufferRef::S32(b) => b.chan(ch).iter().map(|&s| s as f32 / i32::MAX as f32).collect(),
                                 AudioBufferRef::U8(b)  => b.chan(ch).iter().map(|&s| (s as f32 - 128.0) / 128.0).collect(),
                                 AudioBufferRef::S24(b) => b.chan(ch).iter().map(|&s| s.inner() as f32 / 8_388_607.0).collect(),
                                 AudioBufferRef::F64(b) => b.chan(ch).iter().map(|&s| s as f32).collect(),
                                 _ => vec![0.0; decoded_frames(&decoded)],
                            };
                            next_pending[ch].extend(src);
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
            if pending[0].len() < chunk_size { break 'resample; }
            
            let mut chunk_planar = vec![vec![0.0; chunk_size]; file_ch];
            for ch in 0..file_ch {
                for val in chunk_planar[ch].iter_mut().take(chunk_size) {
                    if let Some(s) = pending[ch].pop_front() {
                        *val = s;
                    }
                }
            }

            let is_bp = bp_now && file_rate == dev_rate && file_ch == dev_ch && !current_dsp.enabled;
            
            let (mut out_planar, n_out) = if is_bp {
                (chunk_planar, chunk_size)
            } else {
                let mut processed = if file_rate == dev_rate {
                    chunk_planar
                } else {
                    // Dynamic Clock Drift Correction (Milestone 5)
                    // In Exclusive Mode, there is only one hardware clock, so drift is impossible.
                    // In Shared Mode, apply a 5% deadband to prevent constant micro-fluctuations from updating Rubato.
                    let rel_ratio = if is_exclusive {
                        1.0
                    } else {
                        let capacity = prod.capacity() as f64;
                        let current_fill = prod.len() as f64;
                        let fill_ratio = current_fill / capacity;
                        let error = 0.5 - fill_ratio; // Positive if underfilled, negative if overfilled
                        if error.abs() > 0.05 {
                            let adjustment = error * 0.002; // Max ±0.1% adjustment
                            1.0 + adjustment.clamp(-0.001, 0.001)
                        } else {
                            1.0
                        }
                    };

                    // Thread-local cache to only call set_resample_ratio_relative when ratio changes significantly
                    thread_local! {
                        static LAST_RATIO: std::cell::Cell<f64> = std::cell::Cell::new(1.0);
                    }
                    let changed = LAST_RATIO.with(|last| {
                        if (last.get() - rel_ratio).abs() > 0.0001 {
                            last.set(rel_ratio);
                            true
                        } else {
                            false
                        }
                    });

                    if changed {
                        let _ = resampler.set_resample_ratio_relative(rel_ratio, true);
                    }

                    let refs: Vec<&[f32]> = chunk_planar.iter().map(|v| v.as_slice()).collect();
                    match resampler.process(&refs, None) {
                        Ok(o) => o,
                        Err(_) => break 'resample,
                    }
                };
                
                if let (Some(ref mut next_res), Some(ref info)) = (&mut next_resampler, &next_decoder_info) {
                    if next_pending[0].len() >= chunk_size {
                        let mut next_chunk_planar = vec![vec![0.0; chunk_size]; info.file_ch];
                        for ch in 0..info.file_ch {
                            for val in next_chunk_planar[ch].iter_mut().take(chunk_size) {
                                if let Some(s) = next_pending[ch].pop_front() {
                                    *val = s;
                                }
                            }
                        }
                        
                        let refs_next: Vec<&[f32]> = next_chunk_planar.iter().map(|v| v.as_slice()).collect();
                        let next_processed = match next_res.process(&refs_next, None) {
                            Ok(o) => o,
                            Err(_) => vec![vec![0.0; chunk_size]; dev_ch],
                        };
                        
                        let crossfade_duration_secs = current_dsp.crossfade_transition_duration as f64;
                        let crossfade_frames = (crossfade_duration_secs * dev_rate as f64) as usize;
                        
                        let len = processed[0].len();
                        let next_len = next_processed[0].len();
                        let mix_len = len.min(next_len);
                        
                        for i in 0..mix_len {
                            let global_idx = crossfade_frame_counter + i;
                            let next_gain = (global_idx as f32 / crossfade_frames as f32).clamp(0.0, 1.0);
                            let current_gain = 1.0 - next_gain;
                            
                            for ch in 0..processed.len() {
                                let current_sample = processed[ch][i];
                                let next_sample = if ch < next_processed.len() { next_processed[ch][i] } else { 0.0 };
                                processed[ch][i] = current_sample * current_gain + next_sample * next_gain;
                            }
                        }
                        crossfade_frame_counter += mix_len;
                        
                        if crossfade_frame_counter >= crossfade_frames {
                            let played_secs = crossfade_frame_counter as f64 / dev_rate as f64;
                            next_track_info = Some((next_track_path.clone().unwrap_or_default(), played_secs));
                            running = false;
                            break 'resample;
                        }
                    }
                }
                
                if current_dsp.enabled {
                    for node in &mut nodes {
                        node.process(&mut processed, dev_rate as f32);
                    }
                }
                let len = processed[0].len();
                (processed, len)
            };

            // Subtle +1.15x (+1.2dB) gain boost in Exclusive Mode to psychoacoustically enhance detail perception.
            if is_exclusive {
                for ch in 0..out_planar.len() {
                    for val in out_planar[ch].iter_mut().take(n_out) {
                        *val *= 1.15;
                    }
                }
            }

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
                if !dsp_now.low_spec_mode {
                    mono_sample /= use_ch as f32;
                    fft_buffer.push(mono_sample);
                    if fft_buffer.len() >= 2048 {
                        let _ = fft_tx.try_send((fft_buffer.clone(), dev_rate as f32));
                        fft_buffer.clear();
                    }
                } else if !fft_buffer.is_empty() {
                    fft_buffer.clear();
                }
                out_idx += 1;
            }

            // Lock-free loop to wait for buffer space
            while prod.remaining() < interleaved.len() && running {
                std::thread::sleep(std::time::Duration::from_millis(5));

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
                    Ok(PlayerCommand::Play(p, pos)) => { 
                        abort_background_downloads();
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
                            let lock = safe_lock(samples_arc);
                            ram_cursor = (secs * file_rate as f64) as usize;
                            if ram_cursor >= lock[0].len()
                                && is_complete.as_ref().map(|c| c.load(Ordering::SeqCst)).unwrap_or(true)
                            {
                                ram_cursor = lock[0].len().saturating_sub(1); 
                            }
                            position_secs.store(secs.to_bits(), Ordering::Relaxed);
                            flush_signal.store(true, Ordering::SeqCst);
                            pending.iter_mut().for_each(|ch| ch.clear());
                            interleaved.clear();
                        } else if !is_stream {
                            if let Some(tb) = time_base {
                                let seek_ts = (secs * tb.denom as f64 / tb.numer as f64) as u64;
                                  let _ = format.seek(symphonia::core::formats::SeekMode::Accurate, symphonia::core::formats::SeekTo::TimeStamp { ts: seek_ts, track_id });
                            }
                            position_secs.store(secs.to_bits(), Ordering::Relaxed);
                            flush_signal.store(true, Ordering::SeqCst);
                            pending.iter_mut().for_each(|ch| ch.clear());
                            interleaved.clear();
                        } else {
                            // HTTP Stream: Restart FFmpeg starting at target offset!
                            abort_background_downloads();
                            decode_shutdown.store(true, Ordering::SeqCst);
                            kill_current_process(&current_process);
                            running = false;
                            next_track_info = Some((path.to_string(), secs));
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
            if running && !interleaved.is_empty() {
                prod.push_slice(&interleaved);
            }
        }

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
    // This prevents cutting off the last second of audio when the ringbuffer is full at EOF.
    while running && !prod.is_empty() {
        std::thread::sleep(std::time::Duration::from_millis(20));

        // Keep updating position so UI timer completes
        let p_len = pending[0].len() as f64;
        let mut r_len = prod.len() as f64 / (dev_ch as f64);
        if flush_signal.load(Ordering::Relaxed) { r_len = 0.0; }
        let delay_secs = (p_len / file_rate as f64) + (r_len / dev_rate as f64);
        let true_pos = (ram_cursor as f64 / file_rate as f64) - delay_secs;
        position_secs.store(true_pos.max(0.0).to_bits(), Ordering::Relaxed);

        while let Ok(cmd) = rx.try_recv() {
            match cmd {
                PlayerCommand::Stop => { abort_background_downloads(); running = false; break; }
                PlayerCommand::Pause => { 
                    status.store(2, Ordering::Relaxed); 
                }
                PlayerCommand::Resume => { 
                    status.store(1, Ordering::Relaxed); 
                }
                PlayerCommand::Play(p, pos) => { 
                    abort_background_downloads();
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

