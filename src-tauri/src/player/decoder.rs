use std::io::BufRead;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::thread;
use tauri::{Emitter, Manager};

use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::core::units::TimeBase;
pub use symphonia::default::{get_codecs, get_probe};

use crate::safe_lock;
use super::{
    canonicalize_youtube_url, is_youtube_url_or_id,
    ACTIVE_STREAM_BUFFERED_BYTES, ACTIVE_STREAM_TOTAL_BYTES,
    DSPState, PLAYBACK_GENERATION, SESSION_DOWNLOADED_BYTES,
};

#[allow(dead_code)]
pub enum ActiveStream {
    Cpal(cpal::Stream),
    Wasapi(crate::wasapi_engine::WasapiStream),
}

/// 📦 Grouped decoder state to simplify passing multiple arguments
pub struct DecoderInfo {
    pub format: Box<dyn symphonia::core::formats::FormatReader>,
    pub decoder: Box<dyn symphonia::core::codecs::Decoder>,
    pub track_id: u32,
    pub time_base: Option<TimeBase>,
    pub file_rate: usize,
    pub file_ch: usize,
    pub source_sample_format: Option<String>,
    pub source_bits_per_sample: Option<u16>,
    pub source_channel_mask: Option<u32>,
    pub resolved_path: String,
    pub _decrypted_process: DecryptedProcessGuard,
    pub _decrypted_file: Option<Arc<DecryptedPlaybackFile>>,
}

pub struct DecryptedPlaybackFile(pub std::path::PathBuf);

impl DecryptedPlaybackFile {
    pub fn create(bytes: &[u8], extension: &str) -> std::io::Result<Arc<Self>> {
        use std::io::Write;
        static NEXT_ID: AtomicU64 = AtomicU64::new(0);
        loop {
            let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!("aideo_cache_{}_{}.{}", std::process::id(), id, extension));
            let mut file = match std::fs::OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(file) => file,
                Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(err) => return Err(err),
            };
            let owner = Arc::new(Self(path));
            let result = file.write_all(bytes);
            drop(file);
            result?;
            return Ok(owner);
        }
    }
}

impl Drop for DecryptedPlaybackFile {
    fn drop(&mut self) {
        if let Err(err) = std::fs::remove_file(&self.0) {
            if err.kind() != std::io::ErrorKind::NotFound {
                eprintln!("[player] Could not remove owned decrypted playback file: {err}");
            }
        }
    }
}

pub struct DecryptedProcessGuard(pub Option<(Arc<Mutex<Option<std::process::Child>>>, u32)>);

impl Drop for DecryptedProcessGuard {
    fn drop(&mut self) {
        if let Some((process, owned_id)) = &self.0 {
            let child = {
                let mut slot = safe_lock(process);
                if slot.as_ref().is_some_and(|child| child.id() == *owned_id) { slot.take() } else { None }
            };
            if let Some(mut child) = child {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

lazy_static::lazy_static! {
    pub static ref YOUTUBE_URL_CACHE: std::sync::Mutex<std::collections::HashMap<String, YoutubeUrlCacheEntry>> = std::sync::Mutex::new(std::collections::HashMap::new());
    pub static ref ACTIVE_DOWNLOADS: std::sync::Mutex<std::collections::HashMap<String, Arc<AtomicBool>>> = std::sync::Mutex::new(std::collections::HashMap::new());
    pub static ref ACTIVE_DOWNLOAD_PROCS: std::sync::Mutex<std::collections::HashMap<String, Arc<std::sync::Mutex<Option<std::process::Child>>>>> = std::sync::Mutex::new(std::collections::HashMap::new());
    pub static ref ACTIVE_STREAM_DOWNLOADS: std::sync::Mutex<std::collections::HashMap<String, Arc<ActiveStreamDownload>>> = std::sync::Mutex::new(std::collections::HashMap::new());
}

static YTDLP_UPDATING: AtomicBool = AtomicBool::new(false);

pub(crate) const BUFFER_GATE_BYTES: u64 = 192 * 1024;
pub(crate) const RETRY_THRESHOLD_BYTES: u64 = 128 * 1024;


pub struct ActiveStreamDownload {
    pub url: String,
    pub canonical_url: Option<String>,
    pub stream_path: std::path::PathBuf,
    pub cache_path: std::path::PathBuf,
    pub total_bytes: Arc<AtomicU64>,
    pub downloaded_bytes: Arc<AtomicU64>,
    pub complete: Arc<AtomicBool>,
    pub abort: Arc<AtomicBool>,
}

pub fn abort_inactive_stream_downloads(current_url: Option<&str>) {
    if let Ok(mut downloads) = ACTIVE_STREAM_DOWNLOADS.lock() {
        downloads.retain(|url, dl| {
            let is_match = match current_url {
                Some(curr) => {
                    url == curr
                        || dl.canonical_url.as_deref() == Some(curr)
                        || (is_youtube_url_or_id(curr)
                            && dl.canonical_url.as_deref().map(canonicalize_youtube_url).as_deref() == Some(&canonicalize_youtube_url(curr)))
                }
                None => false,
            };
            if !is_match {
                dl.abort.store(true, Ordering::SeqCst);
                false
            } else {
                true
            }
        });
    }
}

/// Resolved googlevideo direct URLs expire server-side (~6h) and are IP-bound,
/// so a cached link must never be served past this TTL.
pub const YOUTUBE_URL_TTL: std::time::Duration = std::time::Duration::from_secs(5 * 60 * 60);

pub struct YoutubeUrlCacheEntry {
    pub url: String,
    pub inserted_at: std::time::Instant,
}

/// Returns the cached direct stream URL for `key` only if it is still within
/// the TTL; expired entries are pruned on access.
pub fn get_cached_youtube_url(key: &str, now: std::time::Instant) -> Option<String> {
    let mut cache = YOUTUBE_URL_CACHE.lock().ok()?;
    if let Some(entry) = cache.get(key) {
        if now.duration_since(entry.inserted_at) < YOUTUBE_URL_TTL {
            return Some(entry.url.clone());
        }
        cache.remove(key);
    }
    None
}

pub fn insert_cached_youtube_url(key: String, direct_url: String, now: std::time::Instant) {
    if let Ok(mut cache) = YOUTUBE_URL_CACHE.lock() {
        cache.insert(key, YoutubeUrlCacheEntry { url: direct_url, inserted_at: now });
    }
}

/// Evicts the entry for `key` only if it still holds `expected_dead_url`.
/// Conditional eviction prevents discarding a freshly re-resolved URL that a
/// background pre-resolve may have installed while playback was failing.
pub fn invalidate_youtube_url_if(key: &str, expected_dead_url: &str) -> bool {
    if let Ok(mut cache) = YOUTUBE_URL_CACHE.lock() {
        let matches = cache.get(key).map_or(false, |e| e.url == expected_dead_url);
        if matches {
            cache.remove(key);
            println!("[player] Evicted expired/dead YouTube stream URL from cache for track.");
        }
        return matches;
    }
    false
}

pub struct GrowingFileReader {
    pub file: std::fs::File,
    pub complete: Arc<AtomicBool>,
    pub hash: String,
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
                    let is_active = ACTIVE_DOWNLOADS.lock().map_or(false, |active| active.contains_key(&self.hash));
                    if !is_active {
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::UnexpectedEof,
                            "GrowingFileReader: Download terminated before completion",
                        ));
                    }
                    if start_wait.elapsed() > std::time::Duration::from_secs(120) {
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::TimedOut,
                            "GrowingFileReader: Download stalled for more than 120 seconds",
                        ));
                    }
                    std::thread::sleep(std::time::Duration::from_millis(10));
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

pub fn rendition_cache_key(namespace: &str, provider: &str, source_id: &str, rendition_format: &str) -> String {
    format!("{}:{}:{}:{}", namespace, provider, source_id, rendition_format)
}

pub fn get_rendition_cache_paths(
    namespace: &str,
    provider: &str,
    source_id: &str,
    rendition_format: &str,
) -> Option<(std::path::PathBuf, std::path::PathBuf)> {
    let key = rendition_cache_key(namespace, provider, source_id, rendition_format);
    let hash = format!("{:x}", md5::compute(key.as_bytes()));
    let data_dir = dirs::data_dir()?;
    let cache_dir = data_dir.join("Aideo").join("CloudCache");
    let _ = std::fs::create_dir_all(&cache_dir);
    let cache_path = cache_dir.join(format!("{}.cache", hash));
    let temp_path = cache_dir.join(format!("{}.tmp", hash));
    Some((cache_path, temp_path))
}

pub fn promote_temp_to_cache_atomic(
    temp_write_path: &std::path::Path,
    final_cache_path: &std::path::Path,
    min_bytes: u64,
) -> std::io::Result<()> {
    let metadata = std::fs::metadata(temp_write_path)?;
    if metadata.len() < min_bytes {
        let _ = std::fs::remove_file(temp_write_path);
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("Cache file truncated: {} bytes (minimum required {})", metadata.len(), min_bytes),
        ));
    }
    std::fs::rename(temp_write_path, final_cache_path)
}

pub fn detect_url_rendition_format(url: &str) -> Option<&'static str> {
    let lower = url.to_lowercase();
    if lower.contains("mime=audio%2fwebm") || lower.contains("mime=audio/webm") || lower.contains("itag=251") || lower.contains("itag=250") || lower.contains("itag=249") || lower.contains(".webm") || lower.contains(".opus") || lower.contains("format=opus") {
        Some("opus")
    } else if lower.contains("mime=audio%2fmp4") || lower.contains("mime=audio/mp4") || lower.contains("itag=140") || lower.contains(".m4a") || lower.contains(".mp4") || lower.contains(".aac") || lower.contains("format=aac") || lower.contains("format=m4a") {
        Some("aac")
    } else if lower.contains(".flac") || lower.contains("format=flac") {
        Some("flac")
    } else if lower.contains(".mp3") || lower.contains("format=mp3") {
        Some("mp3")
    } else if lower.contains(".wav") || lower.contains("format=wav") {
        Some("wav")
    } else {
        None
    }
}

pub fn parse_url_provider_and_id(url: &str) -> (String, String) {
    if is_youtube_url_or_id(url) {
        let canonical = canonicalize_youtube_url(url);
        let id = crate::youtube::extract_video_id(&canonical).unwrap_or_else(|| canonical.clone());
        ("youtube".to_string(), id)
    } else if url.contains("tidal.com") || url.contains("tidal") {
        ("tidal".to_string(), format!("{:x}", md5::compute(url.as_bytes())))
    } else if url.contains("qobuz.com") || url.contains("qobuz") {
        ("qobuz".to_string(), format!("{:x}", md5::compute(url.as_bytes())))
    } else {
        ("cloud".to_string(), format!("{:x}", md5::compute(url.as_bytes())))
    }
}

pub(crate) fn get_cache_paths(url: &str) -> Option<(std::path::PathBuf, std::path::PathBuf)> {
    if url.contains(':') && !url.starts_with("http://") && !url.starts_with("https://") {
        let parts: Vec<&str> = url.split(':').collect();
        if parts.len() == 4 {
            return get_rendition_cache_paths(parts[0], parts[1], parts[2], parts[3]);
        }
    }

    if is_youtube_url_or_id(url) {
        let canonical = canonicalize_youtube_url(url);
        let id = crate::youtube::extract_video_id(&canonical).unwrap_or_else(|| canonical.clone());
        let format = detect_url_rendition_format(url).unwrap_or("audio");
        return get_rendition_cache_paths("aideo", "youtube", &id, format);
    }

    let format = detect_url_rendition_format(url).unwrap_or("audio");
    let (provider, id) = parse_url_provider_and_id(url);
    get_rendition_cache_paths("aideo", &provider, &id, format)
}

pub struct DownloadGuard {
    pub hash: String,
    pub complete: Arc<AtomicBool>,
    pub child_ref: Arc<Mutex<Option<std::process::Child>>>,
    pub success: bool,
}

impl DownloadGuard {
    pub fn mark_completed(&mut self) {
        self.success = true;
        self.complete.store(true, Ordering::SeqCst);
    }
}

impl Drop for DownloadGuard {
    fn drop(&mut self) {
        if self.success {
            self.complete.store(true, Ordering::SeqCst);
        }
        let mut active = safe_lock(&ACTIVE_DOWNLOADS);
        if active.get(&self.hash).is_some_and(|flag| Arc::ptr_eq(flag, &self.complete)) {
            active.remove(&self.hash);
        }
        drop(active);
        let mut processes = safe_lock(&ACTIVE_DOWNLOAD_PROCS);
        if processes.get(&self.hash).is_some_and(|child| Arc::ptr_eq(child, &self.child_ref)) {
            processes.remove(&self.hash);
        }
    }
}


pub const YT_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

pub fn youtube_stream_user_agent(url: &str) -> &'static str {
    if url::Url::parse(url).is_ok_and(|url| url.query_pairs().any(|(key, value)| key == "c" && value == "VISIONOS")) {
        crate::youtube::DIRECT_STREAM_USER_AGENT
    } else {
        YT_USER_AGENT
    }
}

pub fn wait_for_background_transcode(
    hash: &str,
    child_ref: &Arc<Mutex<Option<std::process::Child>>>,
) -> bool {
    let success = loop {
        if !safe_lock(&ACTIVE_DOWNLOAD_PROCS).get(hash).is_some_and(|child| Arc::ptr_eq(child, child_ref)) {
            break false;
        }
        let mut child = safe_lock(child_ref);
        match child.as_mut().map(std::process::Child::try_wait) {
            Some(Ok(None)) => {}
            Some(Ok(Some(status))) => break status.success(),
            Some(Err(error)) => {
                eprintln!("[player-bg] Error polling transcode process status: {}", error);
                break false;
            }
            None => break false,
        }
        drop(child);
        std::thread::sleep(std::time::Duration::from_millis(100));
    };
    // Registration belongs to the whole download; a failed attempt can still retry.
    success
}

pub fn run_stream_downloader(
    url: String,
    stream_path: std::path::PathBuf,
    cache_path: std::path::PathBuf,
    ua: String,
    is_youtube_stream: bool,
    total_bytes: Arc<AtomicU64>,
    downloaded_bytes: Arc<AtomicU64>,
    complete: Arc<AtomicBool>,
    abort: Arc<AtomicBool>,
) {
    use std::io::{Read, Write};
    let mut retry_count = 0;
    let max_retries = 15;
    let mut bytes_downloaded: u64 = 0;

    let _ = std::fs::remove_file(&stream_path);

    while retry_count < max_retries {
        if abort.load(Ordering::SeqCst) {
            println!("[player-stream] Stream download aborted before request: {}", url);
            break;
        }

        let client = reqwest::blocking::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(15))
            .tcp_keepalive(std::time::Duration::from_secs(15))
            .build()
            .unwrap_or_else(|_| reqwest::blocking::Client::new());

        let mut req = client.get(&url).header("User-Agent", &ua);
        if is_youtube_stream {
            req = req.header("Referer", "https://www.google.com/");
        }

        if bytes_downloaded > 0 {
            req = req.header("Range", format!("bytes={}-", bytes_downloaded));
            println!("[player-stream] Requesting HTTP Range resume from byte {}...", bytes_downloaded);
        }

        match req.send() {
            Ok(mut response) => {
                let status = response.status();
                if status.is_success() {
                    retry_count = 0;

                    if let Some(len) = response.content_length() {
                        let total = len + bytes_downloaded;
                        total_bytes.store(total, Ordering::Relaxed);
                        ACTIVE_STREAM_TOTAL_BYTES.store(total, Ordering::Relaxed);
                    }

                    let mut file = match std::fs::OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(&stream_path)
                    {
                        Ok(f) => f,
                        Err(e) => {
                            eprintln!("[player-stream] Failed to open stream file {:?}: {:?}", stream_path, e);
                            break;
                        }
                    };

                    if bytes_downloaded > 0 && status == reqwest::StatusCode::OK {
                        println!("[player-stream] Server ignored Range header. Resetting stream file...");
                        bytes_downloaded = 0;
                        downloaded_bytes.store(0, Ordering::Relaxed);
                        ACTIVE_STREAM_BUFFERED_BYTES.store(0, Ordering::Relaxed);
                        drop(file);
                        let _ = std::fs::remove_file(&stream_path);
                        file = match std::fs::File::create(&stream_path) {
                            Ok(f) => f,
                            Err(e) => {
                                eprintln!("[player-stream] Failed to recreate stream file {:?}: {:?}", stream_path, e);
                                break;
                            }
                        };
                    }

                    let mut buffer = [0u8; 32768];
                    let mut read_error = false;

                    loop {
                        if abort.load(Ordering::SeqCst) {
                            println!("[player-stream] Stream download aborted during transfer: {}", stream_path.display());
                            break;
                        }

                        match response.read(&mut buffer) {
                            Ok(0) => break, // EOF reached
                            Ok(n) => {
                                if file.write_all(&buffer[..n]).is_err() {
                                    eprintln!("[player-stream] Failed writing to stream file: {:?}", stream_path);
                                    read_error = true;
                                    break;
                                }
                                let _ = file.flush();
                                bytes_downloaded += n as u64;
                                downloaded_bytes.store(bytes_downloaded, Ordering::Relaxed);
                                SESSION_DOWNLOADED_BYTES.fetch_add(n as u64, Ordering::Relaxed);
                                ACTIVE_STREAM_BUFFERED_BYTES.store(bytes_downloaded, Ordering::Relaxed);
                            }
                            Err(e) => {
                                eprintln!("[player-stream] Read error after {} bytes: {:?}. Retrying...", bytes_downloaded, e);
                                read_error = true;
                                break;
                            }
                        }
                    }

                    let _ = file.flush();
                    drop(file);

                    if !read_error && !abort.load(Ordering::SeqCst) {
                        println!("[player-stream] Stream download finished: {} bytes written to {:?}", bytes_downloaded, stream_path);
                        complete.store(true, Ordering::SeqCst);

                        // Save encrypted copy to CloudCache for future offline playback if valid
                        if bytes_downloaded > 1024 && !cache_path.exists() {
                            let temp_cache_path = cache_path.with_extension("tmp_promote");
                            if let Ok(mut in_file) = std::fs::File::open(&stream_path) {
                                if let Ok(mut out_file) = std::fs::File::create(&temp_cache_path) {
                                    let key = b"AIDEO_OFFLINE_CACHE_KEY_2026";
                                    let mut enc_buf = [0u8; 32768];
                                    let mut enc_offset = 0usize;
                                    let mut enc_ok = true;
                                    while let Ok(n) = in_file.read(&mut enc_buf) {
                                        if n == 0 { break; }
                                        for i in 0..n {
                                            enc_buf[i] ^= key[(enc_offset + i) % key.len()];
                                        }
                                        if out_file.write_all(&enc_buf[..n]).is_err() {
                                            enc_ok = false;
                                            break;
                                        }
                                        enc_offset += n;
                                    }
                                    if enc_ok && out_file.flush().is_ok() {
                                        drop(out_file);
                                        drop(in_file);
                                        if let Err(e) = promote_temp_to_cache_atomic(&temp_cache_path, &cache_path, 1024) {
                                            eprintln!("[player-stream] Atomic promotion failed: {}", e);
                                        } else {
                                            println!("[player-stream] Stream saved to CloudCache: {:?}", cache_path);
                                        }
                                    } else {
                                        drop(out_file);
                                        drop(in_file);
                                        let _ = std::fs::remove_file(&temp_cache_path);
                                    }
                                }
                            }
                        }
                        return;
                    }
                } else {
                    eprintln!("[player-stream] HTTP status error: {}", status);
                    if status == reqwest::StatusCode::FORBIDDEN
                        || status == reqwest::StatusCode::UNAUTHORIZED
                        || status == reqwest::StatusCode::GONE
                    {
                        eprintln!("[player-stream] Stream URL expired or unauthorized (HTTP {}). Aborting stream downloader immediately.", status);
                        abort.store(true, Ordering::SeqCst);
                        break;
                    }
                    eprintln!("[player-stream] Retrying...");
                }
            }
            Err(e) => {
                eprintln!("[player-stream] Request error: {:?}. Retrying...", e);
            }
        }

        if abort.load(Ordering::SeqCst) {
            break;
        }

        retry_count += 1;
        let sleep_ms = std::cmp::min(500 * retry_count, 5000);
        std::thread::sleep(std::time::Duration::from_millis(sleep_ms));
    }

    if abort.load(Ordering::SeqCst) {
        let _ = std::fs::remove_file(&stream_path);
    }
}

pub fn feed_file_to_stdin(
    stream_path: &std::path::Path,
    mut stdin: std::process::ChildStdin,
    complete: Arc<AtomicBool>,
    abort: Arc<AtomicBool>,
) {
    use std::io::{Read, Write, Seek, SeekFrom};

    let start_wait = std::time::Instant::now();
    let mut file = loop {
        if let Ok(f) = std::fs::File::open(stream_path) {
            break f;
        }
        if complete.load(Ordering::SeqCst) || abort.load(Ordering::SeqCst) || start_wait.elapsed() > std::time::Duration::from_secs(10) {
            eprintln!("[player-feed] Stream file {:?} was not created in time.", stream_path);
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    };

    let mut buffer = [0u8; 32768];
    let mut read_offset: u64 = 0;
    let mut stall_start = std::time::Instant::now();

    loop {
        if abort.load(Ordering::SeqCst) {
            break;
        }

        if file.seek(SeekFrom::Start(read_offset)).is_err() {
            eprintln!("[player-feed] Seek to offset {} failed.", read_offset);
            break;
        }

        match file.read(&mut buffer) {
            Ok(0) => {
                if complete.load(Ordering::SeqCst) {
                    println!("[player-feed] Feeder reached EOF ({} bytes fed). Closing stdin cleanly.", read_offset);
                    break;
                }
                if abort.load(Ordering::SeqCst) {
                    eprintln!("[player-feed] Stream feed aborted.");
                    break;
                }
                if stall_start.elapsed() > std::time::Duration::from_secs(60) {
                    eprintln!("[player-feed] Stream feed stalled for >60s. Aborting feed.");
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            Ok(n) => {
                stall_start = std::time::Instant::now();
                if stdin.write_all(&buffer[..n]).is_err() {
                    println!("[player-feed] FFmpeg stdin closed after feeding {} bytes. Exiting feed thread.", read_offset + n as u64);
                    break;
                }
                read_offset += n as u64;
            }
            Err(e) => {
                eprintln!("[player-feed] Error reading from stream file at offset {}: {:?}", read_offset, e);
                break;
            }
        }
    }
}

pub fn pipe_url_to_stdin(
    url: String,
    canonical_url: Option<String>,
    stdin: std::process::ChildStdin,
    is_youtube_stream: bool,
) -> Arc<ActiveStreamDownload> {
    let hash = format!("{:x}", md5::compute(url.as_bytes()));
    let (cache_path, stream_path) = match canonical_url.as_deref().and_then(get_cache_paths).or_else(|| get_cache_paths(&url)) {
        Some((c, _)) => {
            let s = c.with_extension("stream");
            (c, s)
        }
        None => {
            let temp_dir = std::env::temp_dir().join("Aideo");
            let _ = std::fs::create_dir_all(&temp_dir);
            (temp_dir.join(format!("{}.cache", hash)), temp_dir.join(format!("{}.stream", hash)))
        }
    };

    let mut existing_dl = None;
    if let Ok(downloads) = ACTIVE_STREAM_DOWNLOADS.lock() {
        if let Some(dl) = downloads.get(&url) {
            if !dl.abort.load(Ordering::SeqCst) {
                existing_dl = Some(Arc::clone(dl));
            }
        }
    }

    let active_dl = match existing_dl {
        Some(dl) => {
            println!("[player-pipe] Reusing existing active stream download for: {}", url);
            ACTIVE_STREAM_TOTAL_BYTES.store(dl.total_bytes.load(Ordering::Relaxed), Ordering::Relaxed);
            ACTIVE_STREAM_BUFFERED_BYTES.store(dl.downloaded_bytes.load(Ordering::Relaxed), Ordering::Relaxed);
            dl
        }
        None => {
            println!("[player-pipe] Starting high-speed decoupled stream download: {}", url);
            let total_bytes = Arc::new(AtomicU64::new(0));
            let downloaded_bytes = Arc::new(AtomicU64::new(0));
            let complete = Arc::new(AtomicBool::new(false));
            let abort = Arc::new(AtomicBool::new(false));

            let new_dl = Arc::new(ActiveStreamDownload {
                url: url.clone(),
                canonical_url,
                stream_path: stream_path.clone(),
                cache_path: cache_path.clone(),
                total_bytes: Arc::clone(&total_bytes),
                downloaded_bytes: Arc::clone(&downloaded_bytes),
                complete: Arc::clone(&complete),
                abort: Arc::clone(&abort),
            });

            if let Ok(mut downloads) = ACTIVE_STREAM_DOWNLOADS.lock() {
                downloads.insert(url.clone(), Arc::clone(&new_dl));
            }

            let dl_url = url.clone();
            let dl_stream_path = stream_path.clone();
            let dl_cache_path = cache_path.clone();
            let dl_total = Arc::clone(&total_bytes);
            let dl_downloaded = Arc::clone(&downloaded_bytes);
            let dl_complete = Arc::clone(&complete);
            let dl_abort = Arc::clone(&abort);
            let ua = youtube_stream_user_agent(&url).to_string();

            std::thread::spawn(move || {
                run_stream_downloader(
                    dl_url,
                    dl_stream_path,
                    dl_cache_path,
                    ua,
                    is_youtube_stream,
                    dl_total,
                    dl_downloaded,
                    dl_complete,
                    dl_abort,
                );
            });

            new_dl
        }
    };

    let feed_path = active_dl.stream_path.clone();
    let feed_complete = Arc::clone(&active_dl.complete);
    let feed_abort = Arc::clone(&active_dl.abort);

    std::thread::spawn(move || {
        feed_file_to_stdin(&feed_path, stdin, feed_complete, feed_abort);
    });

    active_dl
}

pub fn spawn_youtube_downloader(
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
    std::thread::spawn(move || {
        let mut guard = DownloadGuard {
            hash: hash_clone.clone(),
            complete: complete_clone,
            child_ref: child_ref_clone.clone(),
            success: false,
        };

        let stream_engine = {
            if let Some(state) = app_handle.try_state::<crate::AppState>() {
                let player = safe_lock(&state.player);
                let d = safe_lock(&player.dsp_state);
                d.stream_engine.clone()
            } else {
                "reqwest".to_string()
            }
        };

        let is_youtube_stream = is_youtube_url_or_id(&original_url);
        let is_hls = original_url.contains("hls_playlist") || original_url.contains(".m3u8");
        let has_direct_url = resolved_url.contains("googlevideo.com") || (resolved_url.starts_with("http") && resolved_url != original_url);

        // When a direct stream URL is already resolved, use instant Direct HTTP (reqwest) by default.
        // yt-dlp is only used when no direct URL is available, or as a fallback if direct streaming fails.
        let mut use_ytdlp = is_youtube_stream
            && !is_hls
            && std::path::Path::new(&ytdlp_path).exists()
            && (!has_direct_url || stream_engine == "yt-dlp")
            && !YTDLP_UPDATING.load(Ordering::SeqCst);
        let mut transcode_success;

        let canonical_target = canonicalize_youtube_url(&original_url);

        for attempt in 0..2 {
            if !safe_lock(&ACTIVE_DOWNLOAD_PROCS).get(&hash_clone).is_some_and(|child| Arc::ptr_eq(child, &child_ref_clone)) {
                break;
            }
            println!("[player-bg] YouTube background transcode attempt {} (use_ytdlp={}): {} -> {:?}", attempt, use_ytdlp, original_url, temp_path);

            let mut ytdlp_child = if use_ytdlp {
                let mut ytdlp_cmd = std::process::Command::new(&ytdlp_path);
                let cache_dir_str = temp_path.parent().unwrap().join("cache").to_string_lossy().to_string();
                ytdlp_cmd.args([
                    "-f", "251/140/bestaudio/best",
                    "--cache-dir", &cache_dir_str,
                    "--force-ipv4",
                    "--no-check-formats",
                    "--no-playlist",
                    "--sleep-interval", "0",
                    "--max-sleep-interval", "0",
                    "--sleep-requests", "0",
                    "-o", "-",
                    &canonical_target
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

            if let Some(stderr) = ytdlp_child.as_mut().and_then(|child| child.stderr.take()) {
                std::thread::spawn(move || {
                    use std::io::{BufRead, BufReader};
                    for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                        eprintln!("[yt-dlp-bg-err] {}", line);
                    }
                });
            }

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
                        let _ = ytdlp.wait();
                    }
                    if use_ytdlp {
                        use_ytdlp = false;
                        let _ = std::fs::remove_file(&temp_path);
                        continue;
                    } else if std::path::Path::new(&ytdlp_path).exists() {
                        use_ytdlp = true;
                        let _ = std::fs::remove_file(&temp_path);
                        continue;
                    }
                    return;
                }
            };

            let stdout = child.stdout.take();
            let stderr = child.stderr.take();

            let mut stream_dl = None;
            if !is_hls && ytdlp_child.is_none() {
                if let Some(stdin) = child.stdin.take() {
                    stream_dl = Some(pipe_url_to_stdin(
                        resolved_url.clone(),
                        Some(original_url.clone()),
                        stdin,
                        is_youtube_stream,
                    ));
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

            transcode_success = wait_for_background_transcode(&hash_clone, &child_ref_clone);

            // Clean up both processes
            kill_current_process(&child_ref_clone);
            let mut ytdlp_to_kill = ytdlp_child;
            if let Some(mut ytdlp) = ytdlp_to_kill.take() {
                let _ = ytdlp.kill();
                let _ = ytdlp.wait();
            }

            if !safe_lock(&ACTIVE_DOWNLOAD_PROCS).get(&hash_clone).is_some_and(|child| Arc::ptr_eq(child, &child_ref_clone)) {
                let _ = std::fs::remove_file(&temp_path);
                break;
            }

            let stream_ok = stream_dl.as_ref().map_or(true, |dl| dl.complete.load(Ordering::SeqCst) && !dl.abort.load(Ordering::SeqCst));
            if transcode_success && stream_ok {
                guard.mark_completed();
                println!("[player-bg] Transcode completed successfully for {}", hash_clone);
                // Encrypt the temp file to cache path via atomic staging
                if let Ok(bytes) = std::fs::read(&temp_path) {
                    let encrypted = crate::cloud::xor_cipher(&bytes);
                    let temp_write_path = cache_path.with_extension("tmp_promote");
                    if std::fs::write(&temp_write_path, encrypted).is_ok() {
                        if let Err(e) = promote_temp_to_cache_atomic(&temp_write_path, &cache_path, 1024) {
                            eprintln!("[player-bg] Atomic cache promotion failed: {}", e);
                        } else {
                            println!("[player-bg] Encrypted cache promoted successfully: {:?}", cache_path);
                            // Retain temp file during active stream playback to prevent I/O truncation on Windows;
                            // enforce_cache_size_limit() handles cleanup of aged .tmp files automatically.
                            enforce_cache_size_limit();
                        }
                    }
                }
                break; // Break the attempt loop on success!
            } else {
                let bytes_written = std::fs::metadata(&temp_path).map(|m| m.len()).unwrap_or(0);
                if attempt == 0 && !use_ytdlp && std::path::Path::new(&ytdlp_path).exists() && !YTDLP_UPDATING.load(Ordering::SeqCst) && bytes_written < RETRY_THRESHOLD_BYTES {
                    println!("[player-bg] Direct stream background transcode failed early (written {} bytes). Retrying with yt-dlp fallback...", bytes_written);
                    use_ytdlp = true;
                    let _ = std::fs::remove_file(&temp_path);
                    continue; // Retry with yt-dlp fallback
                } else if attempt == 0 && use_ytdlp && bytes_written < RETRY_THRESHOLD_BYTES {
                    println!("[player-bg] yt-dlp background transcode failed early (written {} bytes). Retrying with direct reqwest stream...", bytes_written);

                    use_ytdlp = false;
                    let _ = std::fs::remove_file(&temp_path);
                    continue; // Retry with reqwest fallback
                }

                eprintln!("[player-bg] FFmpeg background transcode failed or was interrupted.");
                // Clean up temp file
                let _ = std::fs::remove_file(&temp_path);
                break; // Break on complete failure
            }
        }
    });

    complete
}

pub const MAX_CACHE_BYTES: u64 = 5 * 1024 * 1024 * 1024; // 5.0 GB maximum cache storage limit

pub fn enforce_cache_size_limit() {
    let Some(data_dir) = dirs::data_dir() else { return; };
    let cloud_cache = data_dir.join("Aideo").join("CloudCache");
    let ytdlp_cache = data_dir.join("Aideo").join("cache");

    let mut total_size: u64 = 0;
    let mut files = Vec::new();

    // 1. Scan CloudCache
    if let Ok(entries) = std::fs::read_dir(&cloud_cache) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Ok(metadata) = path.metadata() {
                    let len = metadata.len();
                    let modified = metadata.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);

                    // Auto-delete orphaned .tmp, .stream, and .tmp_promote files older than 1 hour
                    let ext = path.extension().and_then(|e| e.to_str());
                    if ext == Some("tmp") || ext == Some("stream") || ext == Some("tmp_promote") {
                        if let Ok(elapsed) = modified.elapsed() {
                            if elapsed.as_secs() > 3600 {
                                let _ = std::fs::remove_file(&path);
                                continue;
                            }
                        }
                    }

                    total_size += len;
                    files.push((path, len, modified));
                }
            }
        }
    }

    // 2. Scan ytdlp_cache
    if let Ok(entries) = std::fs::read_dir(&ytdlp_cache) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Ok(metadata) = path.metadata() {
                    let len = metadata.len();
                    let modified = metadata.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                    total_size += len;
                    files.push((path, len, modified));
                }
            }
        }
    }

    // 3. Scan temp directory for aideo_cache_*
    if let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
                    if filename.starts_with("aideo_cache_") {
                        if let Ok(metadata) = path.metadata() {
                            let len = metadata.len();
                            let modified = metadata.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                            total_size += len;
                            files.push((path, len, modified));
                        }
                    }
                }
            }
        }
    }

    println!("[cache-manager] Current total cache size: {} MB (Strict limit: 5000 MB)", total_size / (1024 * 1024));

    // If total cache size exceeds 5.0 GB limit, perform LRU eviction down to 3.5 GB (70% target threshold)
    if total_size > MAX_CACHE_BYTES {
        let target_size = (MAX_CACHE_BYTES as f64 * 0.70) as u64; // 3.5 GB target

        // Sort files by modified time ascending (Least Recently Used first)
        files.sort_by_key(|(_, _, modified)| *modified);

        let mut bytes_deleted: u64 = 0;
        for (file_path, len, _) in files {
            if total_size <= target_size {
                break;
            }
            if std::fs::remove_file(&file_path).is_ok() {
                total_size = total_size.saturating_sub(len);
                bytes_deleted += len;
            }
        }
        println!("[cache-manager] Pruned {} MB of LRU cache to restrict storage strictly under 5.0 GB limit.", bytes_deleted / (1024 * 1024));
    }
}

pub fn clear_youtube_url_cache() {
    if let Ok(mut cache) = YOUTUBE_URL_CACHE.lock() {
        cache.clear();
    }
}

pub fn run_ytdlp_resolve(ytdlp_path: &std::path::Path, args: &[String]) -> Option<String> {
    if YTDLP_UPDATING.load(Ordering::SeqCst) {
        println!("[player] Skipping yt-dlp execution: yt-dlp binary is currently updating.");
        return None;
    }

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
    let trimmed = url.trim();
    if !is_youtube_url_or_id(trimmed) {
        return url.to_string();
    }

    let canonical_url = canonicalize_youtube_url(trimmed);

    // Check cache first
    {
        if let Some(cached) = get_cached_youtube_url(url, std::time::Instant::now())
            .or_else(|| get_cached_youtube_url(&canonical_url, std::time::Instant::now()))
        {
            println!("[player] Using cached direct stream URL for YouTube video.");
            return cached;
        }
    }

    // 🚀 Fast-Path: In-process InnerTube stream resolution (~150-250ms)
    println!("[player] Attempting fast-path in-process InnerTube stream resolution...");
    if let Some(direct) = crate::youtube::resolve_youtube_stream_fast(trimmed) {
        if direct.contains("googlevideo.com") {
            println!("[player] 🚀 InnerTube fast-path succeeded! Extracted direct stream URL in-process.");
            insert_cached_youtube_url(url.to_string(), direct.clone(), std::time::Instant::now());
            insert_cached_youtube_url(canonical_url.clone(), direct.clone(), std::time::Instant::now());
            return direct;
        }
    }

    println!("[player] InnerTube fast-path unavailable or restricted. Attempting to extract direct stream URL via yt-dlp...");

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
        "--cache-dir".to_string(), cache_dir_str.clone(),
        "--force-ipv4".to_string(),
        "--no-check-formats".to_string(),
        "--no-playlist".to_string(),
        "--sleep-interval".to_string(), "0".to_string(),
        "--max-sleep-interval".to_string(), "0".to_string(),
        "--sleep-requests".to_string(), "0".to_string(),
        canonical_url.clone(),
    ];

    if let Some(direct) = run_ytdlp_resolve(&ytdlp_path, &args_1) {
        println!("[player] Successfully extracted YouTube direct stream URL on first attempt!");
        insert_cached_youtube_url(url.to_string(), direct.clone(), std::time::Instant::now());
        insert_cached_youtube_url(canonical_url.clone(), direct.clone(), std::time::Instant::now());
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
        "--sleep-interval".to_string(), "0".to_string(),
        "--max-sleep-interval".to_string(), "0".to_string(),
        "--sleep-requests".to_string(), "0".to_string(),
        "--extractor-args".to_string(), "youtube:player-client=mweb,android".to_string(),
        canonical_url.clone(),
    ];

    if let Some(direct) = run_ytdlp_resolve(&ytdlp_path, &args_3) {
        println!("[player] Successfully extracted YouTube direct stream URL with client bypass!");
        insert_cached_youtube_url(url.to_string(), direct.clone(), std::time::Instant::now());
        insert_cached_youtube_url(canonical_url.clone(), direct.clone(), std::time::Instant::now());
        return direct;
    }

    println!("[player] Failed to resolve YouTube stream URL through all attempts.");

    // Guard yt-dlp -U update execution and avoid running against a binary being replaced
    if YTDLP_UPDATING.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
        println!("[player] Scheduling non-blocking background yt-dlp update check...");
        let ytdlp_path_update = ytdlp_path.clone();
        std::thread::spawn(move || {
            struct UpdateGuard;
            impl Drop for UpdateGuard {
                fn drop(&mut self) {
                    YTDLP_UPDATING.store(false, Ordering::SeqCst);
                }
            }
            let _guard = UpdateGuard;
            let mut update_cmd = std::process::Command::new(&ytdlp_path_update);
            update_cmd.arg("-U");
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                update_cmd.creation_flags(0x08000000);
            }
            if let Ok(mut child) = update_cmd.spawn() {
                let start = std::time::Instant::now();
                let timeout = std::time::Duration::from_secs(45);
                loop {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            println!("[player] yt-dlp update check finished with status: {:?}", status);
                            break;
                        }
                        Ok(None) => {
                            if start.elapsed() > timeout {
                                println!("[player] yt-dlp update check timed out after 45s. Terminating to release update lock.");
                                let _ = child.kill();
                                let _ = child.wait();
                                break;
                            }
                            std::thread::sleep(std::time::Duration::from_millis(500));
                        }
                        Err(e) => {
                            println!("[player] Error waiting for yt-dlp update check: {}", e);
                            break;
                        }
                    }
                }
            }
        });
    }

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
    if !is_youtube_url_or_id(&url) {
        return;
    }

    let canonical_url = canonicalize_youtube_url(&url);

    let (cache_path, temp_path) = match get_cache_paths(&canonical_url) {
        Some(paths) => paths,
        None => return,
    };

    // If already fully cached, do nothing
    if cache_path.exists() {
        return;
    }

    let hash = temp_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();

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
        let mut resolved_url = get_cached_youtube_url(&url, std::time::Instant::now())
            .or_else(|| get_cached_youtube_url(&canonical_url, std::time::Instant::now()));

        if resolved_url.is_none() {
            println!("[player-bg] Pre-resolving direct stream URL in background for '{}'...", url);
            let direct = resolve_youtube_url(&url);
            if direct != url && direct.contains("googlevideo.com") {
                println!("[player-bg] Background pre-resolve successful! Caching direct stream URL.");
                insert_cached_youtube_url(url.clone(), direct.clone(), std::time::Instant::now());
                insert_cached_youtube_url(canonical_url.clone(), direct.clone(), std::time::Instant::now());
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

            if ffmpeg_path.exists() {
                println!("[player-bg] Pre-buffering YouTube track in background for '{}'...", url);
                success = true;
                spawn_youtube_downloader(
                    canonical_url,
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


pub fn resolve_playlist_url(url: &str) -> String {
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

pub fn detect_audio_extension(bytes: &[u8]) -> &'static str {
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

pub fn transcode_codec_and_rate(quality: &str, is_dsd: bool) -> (&'static str, Option<&'static str>) {
    if quality == "native" && !is_dsd {
        return ("pcm_s24le", None);
    }
    let quality = if quality == "native" { "hires" } else { quality };
    let (codec, rate) = match quality {
        "hires" => ("pcm_s24le", if is_dsd { "176400" } else { "96000" }),
        "studio" => ("pcm_s24le", if is_dsd { "88200" } else { "48000" }),
        _ => ("pcm_s16le", "44100"),
    };
    (codec, Some(rate))
}

pub fn cache_pcm_codec(source_format: Option<&str>, transcode_quality: &str) -> &'static str {
    match source_format {
        Some("pcm_s16") | Some("pcm_s16le") => "pcm_s16le",
        Some("pcm_s24") | Some("pcm_s24le") => "pcm_s24le",
        Some("pcm_s32") | Some("pcm_s32le") => "pcm_s32le",
        Some("pcm_f32") | Some("pcm_f32le") => "pcm_f32le",
        _ => transcode_codec_and_rate(transcode_quality, false).0,
    }
}

// (stream_allows_exclusive_mode is in output.rs)

pub fn build_ffmpeg_decoder_args(
    resolved_url: &str,
    start_pos: f64,
    use_ffmpeg_seek: bool,
    is_stream: bool,
    _is_youtube_stream: bool,
    ffmpeg_transcode_quality: &str,
    is_dsd: bool,
) -> Vec<String> {
    let mut args = Vec::new();

    args.extend([
        "-loglevel".to_string(), "warning".to_string(),
    ]);

    if is_stream {
        args.extend([
            "-probesize".to_string(), "65536".to_string(),
            "-analyzeduration".to_string(), "200000".to_string(),
            "-i".to_string(), "pipe:".to_string(),
        ]);
        // Fast output-position seeking for standard input streams (placing -ss AFTER -i pipe:
        // instructs FFmpeg to decode and skip output until start_pos, avoiding avformat_seek_file
        // on unseekable pipes which triggers "could not seek to position" and breaks FLAC frame synchronization).
        if use_ffmpeg_seek && start_pos > 0.0 {
            args.push("-ss".to_string());
            args.push(start_pos.to_string());
        }
    } else {
        // Fast input-position seeking for local files (placed before -i for instant container demuxer seeking)
        if use_ffmpeg_seek && start_pos > 0.0 {
            args.push("-ss".to_string());
            args.push(start_pos.to_string());
        }
        args.extend([
            "-probesize".to_string(), "32768".to_string(),
            "-analyzeduration".to_string(), "100000".to_string(),
            "-i".to_string(), resolved_url.to_string(),
        ]);
    }

    let (codec, rate) = transcode_codec_and_rate(ffmpeg_transcode_quality, is_dsd);

    args.extend([
        "-f".to_string(), "wav".to_string(),
        "-acodec".to_string(), codec.to_string(),
    ]);
    if let Some(rate) = rate {
        args.push("-ar".to_string());
        args.push(rate.to_string());
    }
    args.extend([
        "-ac".to_string(), "2".to_string(),
        "-".to_string(),
    ]);

    args
}

pub(crate) fn is_ffmpeg_available(ffmpeg_path: &str) -> bool {
    if std::path::Path::new(ffmpeg_path).exists() {
        return true;
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new(ffmpeg_path)
            .arg("-version")
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new(ffmpeg_path)
            .arg("-version")
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }
}

pub(crate) fn detect_aac_actual_sample_rate(extra_data: Option<&[u8]>, container_rate: usize) -> usize {
    if let Some(data) = extra_data {
        if data.len() >= 2 {
            let audio_object_type = (data[0] >> 3) & 0x1F;
            if audio_object_type == 5 || audio_object_type == 29 {
                let freq_idx = ((data[0] & 0x07) << 1) | ((data[1] >> 7) & 0x01);
                let core_rate = match freq_idx {
                    0 => 96000,
                    1 => 88200,
                    2 => 64000,
                    3 => 48000,
                    4 => 44100,
                    5 => 32000,
                    6 => 24000,
                    7 => 22050,
                    8 => 16000,
                    9 => 12000,
                    10 => 11025,
                    11 => 8000,
                    12 => 7350,
                    _ => 0,
                };
                if core_rate > 0 {
                    return core_rate;
                }
            } else if audio_object_type == 2 {
                let freq_idx = ((data[0] & 0x07) << 1) | ((data[1] >> 7) & 0x01);
                let core_rate = match freq_idx {
                    0 => 96000,
                    1 => 88200,
                    2 => 64000,
                    3 => 48000,
                    4 => 44100,
                    5 => 32000,
                    6 => 24000,
                    7 => 22050,
                    8 => 16000,
                    9 => 12000,
                    10 => 11025,
                    11 => 8000,
                    12 => 7350,
                    _ => 0,
                };
                if core_rate > 0 && container_rate > 0 && container_rate == core_rate * 2 {
                    return core_rate;
                }
            }
        }
    }
    container_rate
}

/// 🎵 Prepare the media source and decoder
pub fn prepare_decoder(
    path: &str,
    start_pos: f64,
    attempt_id: Option<&str>,
    app_handle: &tauri::AppHandle,
    ffmpeg_path: &str,
    current_process: &Arc<Mutex<Option<std::process::Child>>>,
    ffmpeg_transcode_quality: &str,
    _dsp_state: &DSPState,
    cancel_token: &Arc<AtomicBool>,
    generation: u64,
) -> Result<DecoderInfo, String> {
    if cancel_token.load(Ordering::SeqCst) || PLAYBACK_GENERATION.load(Ordering::SeqCst) != generation {
        return Err("Decoder preparation aborted: generation obsolete".to_string());
    }

    let mut resolved_path = path.to_string();
    let mut decrypted_file = None;

    // Intercept YouTube watch URLs and route them to growing Cache file
    let is_youtube_stream = is_youtube_url_or_id(path);
    if is_youtube_stream {
        let _ = app_handle.emit("stream-buffering-start", serde_json::json!({ "path": path, "attempt_id": attempt_id.unwrap_or("") }));

        let data_dir = match dirs::data_dir() {
            Some(d) => d,
            None => {
                let _ = app_handle.emit("stream-buffering-end", serde_json::json!({ "path": path, "attempt_id": attempt_id.unwrap_or("") }));
                return Err("Could not locate AppData directory".to_string());
            }
        };
        let aideo_dir = data_dir.join("Aideo");
        let ytdlp_path = aideo_dir.join("yt-dlp.exe");
        let ffmpeg_plugin_path = aideo_dir.join("ffmpeg.exe");
        if !ffmpeg_plugin_path.exists() {
            let _ = app_handle.emit("stream-buffering-end", serde_json::json!({ "path": path, "attempt_id": attempt_id.unwrap_or("") }));
            return Err("The FFmpeg transcoder is missing. Please install the FFmpeg Transcoder in Settings -> Plugins to stream YouTube tracks!".to_string());
        }

        let canonical_url = canonicalize_youtube_url(path);

        if let Some((cache_path, temp_path)) = get_cache_paths(&canonical_url) {
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
                        if let Ok(owner) = DecryptedPlaybackFile::create(&decrypted_bytes, "wav") {
                            resolved_path = owner.0.to_string_lossy().to_string();
                            decrypted_file = Some(owner);
                            println!("[player] INTERCEPT: Playing YouTube track from offline decrypted cache file!");
                            use_cache = true;
                            let _ = app_handle.emit("stream-buffering-end", serde_json::json!({ "path": path, "attempt_id": attempt_id.unwrap_or("") }));
                        }
                    }
                }
            }

            if !use_cache {
                if start_pos > 0.0 {
                    let _ = app_handle.emit("stream-buffering-end", serde_json::json!({ "path": path, "attempt_id": attempt_id.unwrap_or("") }));
                    // Mid-stream seek / source switch (start_pos > 0.0): bypass local GrowingFileReader
                    // buffering which starts from 0.00s and blocks ram_cursor until the seek target is decoded.
                    // Instead, fall through to the live stream FFmpeg transcode proxy below for instant -ss seek.
                } else {
                    let hash = temp_path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("")
                        .to_string();
                    let mut already_downloading = false;
                    let mut buffered_direct_url: Option<String> = None;
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
                        // Purge any stale/aborted partial .tmp file from a prior cancelled session
                        // so buffer gate check does not false-positive on stale bytes.
                        let _ = std::fs::remove_file(&temp_path);

                        let mut resolved_url = get_cached_youtube_url(path, std::time::Instant::now())
                            .or_else(|| get_cached_youtube_url(&canonical_url, std::time::Instant::now()));

                        if resolved_url.is_none() {
                            println!("[player] YouTube URL cache miss. Resolving direct stream URL first...");
                            let direct = resolve_youtube_url(path);
                            if direct != *path && direct.contains("googlevideo.com") {
                                insert_cached_youtube_url(path.to_string(), direct.clone(), std::time::Instant::now());
                                insert_cached_youtube_url(canonical_url.clone(), direct.clone(), std::time::Instant::now());
                                resolved_url = Some(direct);
                            } else {
                                let _ = app_handle.emit("stream-buffering-end", serde_json::json!({ "path": path, "attempt_id": attempt_id.unwrap_or("") }));
                                if let Ok(mut active) = ACTIVE_DOWNLOADS.lock() {
                                    active.remove(&hash);
                                }
                                if !ytdlp_path.exists() {
                                    return Err("The yt-dlp plugin is missing. Please install the yt-dlp plugin in Settings -> Plugins to play YouTube tracks!".to_string());
                                }
                                return Err("Could not extract the audio stream URL (YouTube may be throttling or temporarily unavailable). Please try again.".to_string());
                            }
                        }

                        if let Some(direct) = resolved_url {
                            // Remember which direct link this playback attempt relies on,
                            // so it can be evicted below if buffering never makes progress.
                            buffered_direct_url = Some(direct.clone());
                            println!("[player] Spawning background transcoder for YouTube stream...");
                            spawn_youtube_downloader(
                                canonical_url.clone(),
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

                    println!("[player] Buffering first 192KB of YouTube track to ensure stable high-res DAC streaming...");
                    let start_time = std::time::Instant::now();
                    loop {
                        if cancel_token.load(Ordering::SeqCst) || PLAYBACK_GENERATION.load(Ordering::SeqCst) != generation {
                            let _ = app_handle.emit("stream-buffering-end", serde_json::json!({ "path": path, "attempt_id": attempt_id.unwrap_or("") }));
                            return Err("Decoder preparation aborted: generation obsolete".to_string());
                        }
                        let file_size = std::fs::metadata(&temp_path).map(|m| m.len()).unwrap_or(0);
                        if file_size >= BUFFER_GATE_BYTES {
                            break;
                        }
                        if start_time.elapsed().as_secs() > 20 {
                            let _ = app_handle.emit("stream-buffering-end", serde_json::json!({ "path": path, "attempt_id": attempt_id.unwrap_or("") }));
                            if let Ok(mut active) = ACTIVE_DOWNLOADS.lock() {
                                active.remove(&hash);
                            }
                            // Nothing was written: the resolved googlevideo link is almost
                            // certainly expired/dead. Evict it so the very next attempt
                            // re-resolves a fresh URL instead of failing forever until restart.
                            if let Some(dead) = buffered_direct_url.take() {
                                invalidate_youtube_url_if(path, &dead);
                                if canonical_url != path {
                                    invalidate_youtube_url_if(&canonical_url, &dead);
                                }
                            }
                            return Err("Stream buffering timed out. The stream link may have expired or your connection dropped - try playing again.".to_string());
                        }
                        std::thread::sleep(std::time::Duration::from_millis(50));
                    }
                    let _ = app_handle.emit("stream-buffering-end", serde_json::json!({ "path": path, "attempt_id": attempt_id.unwrap_or("") }));
                    println!("[player] Buffering complete ({} bytes). Handing over to Symphonia decoding...", std::fs::metadata(&temp_path).map(|m| m.len()).unwrap_or(0));
                }
            }
        } else {
            let _ = app_handle.emit("stream-buffering-end", serde_json::json!({ "path": path, "attempt_id": attempt_id.unwrap_or("") }));
            return Err("Could not initialize local cache directory for YouTube stream".to_string());
        }
    } else if path.starts_with("http://") || path.starts_with("https://") {
        // Transparently load cached cloud stream tracks if available
        let hash = format!("{:x}", md5::compute(path.as_bytes()));
        let structured_cache = get_cache_paths(path).map(|(c, _)| c);
        let legacy_cache = dirs::data_dir().map(|d| d.join("Aideo").join("CloudCache").join(format!("{}.cache", hash)));
        let target_cache = structured_cache.filter(|p| p.exists()).or_else(|| legacy_cache.filter(|p| p.exists()));
        if let Some(cache_path) = target_cache {
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
                    if let Ok(owner) = DecryptedPlaybackFile::create(&decrypted_bytes, ext) {
                        resolved_path = owner.0.to_string_lossy().to_string();
                        decrypted_file = Some(owner);
                        println!("[player] INTERCEPT: Playing cloud track from offline decrypted cache file!");
                    }
                }
            }
        }
    }

    let path = resolved_path.as_str();

    let is_stream = path.starts_with("http://") || path.starts_with("https://");
    let mut decrypted_process = DecryptedProcessGuard(None);
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
    let mut use_ffmpeg = is_stream || is_dsd;

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
                    Ok(Box::new(GrowingFileReader { file, complete, hash: hash.clone() }))
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
                let mut format = probed.format;
                let mut selected_track = None;
                let mut decoder = None;
                let ffmpeg_ready = is_ffmpeg_available(ffmpeg_path);
                for t in format.tracks() {
                    if t.codec_params.codec == symphonia::core::codecs::CODEC_TYPE_AAC && ffmpeg_ready {
                        println!("[player] Detected AAC codec track. Delegating to FFmpeg for full HE-AAC / SBR compatibility.");
                        selected_track = None;
                        decoder = None;
                        break;
                    }
                    if let Ok(d) = get_codecs().make(&t.codec_params, &DecoderOptions::default()) {
                        selected_track = Some(t.clone());
                        decoder = Some(d);
                        break;
                    }
                }

                if let (Some(track), Some(mut dec)) = (selected_track, decoder) {
                    let mut rate = track.codec_params.sample_rate.unwrap_or(44100) as usize;
                    if track.codec_params.codec == symphonia::core::codecs::CODEC_TYPE_AAC {
                        let actual_rate = detect_aac_actual_sample_rate(track.codec_params.extra_data.as_deref(), rate);
                        if actual_rate != rate {
                            println!("[player] HE-AAC detected without FFmpeg: container claims {}Hz, Symphonia core produces {}Hz. Adjusting sample rate to {}Hz to prevent chipmunk speedup.", rate, actual_rate, actual_rate);
                            let _ = app_handle.emit("ui-toast", serde_json::json!({
                                "message": "Playing HE-AAC track in core mode. Install the FFmpeg plugin in Settings for full high-fidelity audio.",
                                "type": "info"
                            }));
                            rate = actual_rate;
                        }
                    }
                    let mut ch = track.codec_params.channels.map(|c| c.count()).unwrap_or(2);

                    // Peek first packet to lock in ground-truth decoded sample rate & channel count
                    if let Ok(packet) = format.next_packet() {
                        if packet.track_id() == track.id {
                            if let Ok(decoded) = dec.decode(&packet) {
                                let spec_rate = decoded.spec().rate as usize;
                                let spec_ch = decoded.spec().channels.count();
                                if spec_rate > 0 && spec_rate != rate {
                                    println!("[player] Symphonia core decoded rate {}Hz differs from container {}Hz. Adjusting sample rate to {}Hz.", spec_rate, rate, spec_rate);
                                    rate = spec_rate;
                                }
                                if spec_ch > 0 && spec_ch != ch {
                                    ch = spec_ch;
                                }
                            }
                        }
                        let _ = format.seek(
                            symphonia::core::formats::SeekMode::Accurate,
                            symphonia::core::formats::SeekTo::TimeStamp { ts: 0, track_id: track.id },
                        );
                        dec.reset();
                    }

                    let source_bits_per_sample = track.codec_params.bits_per_sample.map(|bits| bits as u16);
                    let source_channel_mask = track.codec_params.channels.map(|channels| channels.bits() as u32);
                    return Ok(DecoderInfo {
                        format,
                        decoder: dec,
                        track_id: track.id,
                        time_base: track.codec_params.time_base,
                        file_rate: rate,
                        file_ch: ch,
                        source_sample_format: source_bits_per_sample.map(|bits| format!("pcm_s{bits}")),
                        source_bits_per_sample,
                        source_channel_mask,
                        resolved_path: resolved_path.clone(),
                        _decrypted_process: decrypted_process,
                        _decrypted_file: decrypted_file,
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
        let is_youtube_stream = is_stream && is_youtube_url_or_id(path);
        let use_piped_ytdlp = is_youtube_stream && ytdlp_path.exists() && start_pos == 0.0;

        let mut cached_direct_url = None;
        if is_youtube_stream {
            let canonical_url = canonicalize_youtube_url(path);
            if path.contains("googlevideo.com") {
                cached_direct_url = Some(path.to_string());
            } else if let Some(direct_url) = get_cached_youtube_url(path, std::time::Instant::now())
                .or_else(|| get_cached_youtube_url(&canonical_url, std::time::Instant::now()))
            {
                println!("[player] YouTube URL cache hit! Using cached direct stream URL for seeking.");
                cached_direct_url = Some(direct_url);
            }

            if cached_direct_url.is_none() {
                println!("[player] YouTube URL cache miss. Resolving direct stream URL first...");
                let direct_url = resolve_youtube_url(path);
                if direct_url != *path && direct_url.contains("googlevideo.com") {
                    println!("[player] Caching resolved direct stream URL.");
                    insert_cached_youtube_url(path.to_string(), direct_url.clone(), std::time::Instant::now());
                    insert_cached_youtube_url(canonical_url.clone(), direct_url.clone(), std::time::Instant::now());
                    cached_direct_url = Some(direct_url);
                }
            }
        }

        // Validate if FFmpeg is installed before spawning, returning a helpful user-friendly guidance message if missing
        let ffmpeg_exists = is_ffmpeg_available(ffmpeg_path);
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

        let args = build_ffmpeg_decoder_args(
            &resolved_url,
            start_pos,
            use_ffmpeg_seek,
            is_stream,
            is_youtube_stream,
            ffmpeg_transcode_quality,
            is_dsd,
        );

        cmd.args(&args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        if is_stream {
            cmd.stdin(std::process::Stdio::piped());
        }

        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW

        // Kill existing process safely if this worker is still the active generation
        {
            let mut proc_lock = safe_lock(current_process);
            if cancel_token.load(Ordering::SeqCst) || PLAYBACK_GENERATION.load(Ordering::SeqCst) != generation {
                return Err("Decoder preparation aborted: generation obsolete".to_string());
            }
            if let Some(mut old_child) = proc_lock.take() {
                let _ = old_child.kill();
                let _ = old_child.wait(); // reap zombie immediately
            }
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

            if cancel_token.load(Ordering::SeqCst) || PLAYBACK_GENERATION.load(Ordering::SeqCst) != generation {
                let _ = ytdlp_child.kill();
                let _ = ytdlp_child.wait();
                return Err("Decoder preparation aborted: generation obsolete".to_string());
            }

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

            let (codec, rate) = transcode_codec_and_rate(ffmpeg_transcode_quality, is_dsd);

            args.extend([
                "-f".to_string(), "wav".to_string(),
                "-acodec".to_string(), codec.to_string(),
            ]);
            if let Some(rate) = rate {
                args.push("-ar".to_string());
                args.push(rate.to_string());
            }
            args.extend([
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
                    if cancel_token.load(Ordering::SeqCst) || PLAYBACK_GENERATION.load(Ordering::SeqCst) != generation {
                        let _ = child.kill();
                        let _ = child.wait();
                        let _ = ytdlp_child.kill();
                        let _ = ytdlp_child.wait();
                        return Err("Decoder preparation aborted: generation obsolete".to_string());
                    }
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
                    {
                        let mut proc_lock = safe_lock(current_process);
                        if cancel_token.load(Ordering::SeqCst) || PLAYBACK_GENERATION.load(Ordering::SeqCst) != generation {
                            let _ = child.kill();
                            let _ = child.wait();
                            return Err("Decoder preparation aborted: generation obsolete".to_string());
                        }
                        if decrypted_file.is_some() { decrypted_process.0 = Some((Arc::clone(current_process), child.id())); }
                        *proc_lock = Some(child);
                    }
                    let source = symphonia::core::io::ReadOnlySource::new(stdout);
                    MediaSourceStream::new(Box::new(source), Default::default())
                }
                Err(e) => {
                    let _ = ytdlp_child.kill();
                    let _ = ytdlp_child.wait();
                    return Err(format!("FFmpeg failed: {}", e));
                }
            }
        } else {
            match cmd.spawn() {
                Ok(mut child) => {
                    if cancel_token.load(Ordering::SeqCst) || PLAYBACK_GENERATION.load(Ordering::SeqCst) != generation {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err("Decoder preparation aborted: generation obsolete".to_string());
                    }
                    let stderr = child.stderr.take().ok_or("Failed to open FFmpeg stderr")?;
                    thread::spawn(move || {
                        let reader = std::io::BufReader::new(stderr);
                        for line in reader.lines().map_while(Result::ok) {
                            eprintln!("[ffmpeg-err] {}", line);
                        }
                    });

                    if is_stream {
                        if let Some(stdin) = child.stdin.take() {
                            let is_youtube = resolved_url.contains("youtube.com") || resolved_url.contains("googlevideo.com") || resolved_url.contains("youtu.be");
                            pipe_url_to_stdin(resolved_url.clone(), Some(path.to_string()), stdin, is_youtube);
                        }
                    }

                    let stdout = child.stdout.take().ok_or("Failed to open FFmpeg stdout")?;
                    {
                        let mut proc_lock = safe_lock(current_process);
                        if cancel_token.load(Ordering::SeqCst) || PLAYBACK_GENERATION.load(Ordering::SeqCst) != generation {
                            let _ = child.kill();
                            let _ = child.wait();
                            return Err("Decoder preparation aborted: generation obsolete".to_string());
                        }
                        if decrypted_file.is_some() { decrypted_process.0 = Some((Arc::clone(current_process), child.id())); }
                        *proc_lock = Some(child);
                    }
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
        let source_bits_per_sample = track.codec_params.bits_per_sample.map(|bits| bits as u16);
        let source_channel_mask = track.codec_params.channels.map(|channels| channels.bits() as u32);
        let source_sample_format = Some(
            transcode_codec_and_rate(ffmpeg_transcode_quality, is_dsd)
                .0
                .to_string(),
        );

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
            source_sample_format,
            source_bits_per_sample,
            source_channel_mask,
            resolved_path: resolved_path.clone(),
            _decrypted_process: decrypted_process,
            _decrypted_file: decrypted_file,
        })
    } else {
        Err("Invalid state: neither native nor FFmpeg decoder path executed".to_string())
    }
}

pub fn find_ffmpeg_path() -> String {

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

pub fn detect_format_from_path(path: &str) -> String {
    if is_youtube_url_or_id(path) {
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

pub fn kill_current_process(current_process: &Arc<Mutex<Option<std::process::Child>>>) {
    let child = safe_lock(current_process).take();
    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait(); // reap zombie process immediately
    }
}

pub fn abort_background_downloads() {
    abort_background_downloads_except(None);
}

pub fn abort_background_downloads_except(keep_hash: Option<&str>) {
    println!("[player] Aborting active background downloads (except: {:?})...", keep_hash);
    if let Ok(mut active_procs) = ACTIVE_DOWNLOAD_PROCS.lock() {
        active_procs.retain(|hash, child_ref| {
            if keep_hash == Some(hash.as_str()) {
                true
            } else {
                println!("[player] Killing background transcode process for hash: {}", hash);
                if let Ok(mut lock) = child_ref.lock() {
                    if let Some(mut child) = lock.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
                false
            }
        });
    }
}

pub fn append_f32_channel_data(buf: &AudioBufferRef<'_>, ch: usize, skip: usize, out: &mut impl Extend<f32>) {
    use symphonia::core::conv::FromSample;
    macro_rules! append {
        ($buffer:expr) => {
            out.extend($buffer.chan(ch).iter().skip(skip).map(|&sample| f32::from_sample(sample)))
        };
    }
    match buf {
        AudioBufferRef::U8(b) => append!(b),
        AudioBufferRef::U16(b) => append!(b),
        AudioBufferRef::U24(b) => append!(b),
        AudioBufferRef::U32(b) => append!(b),
        AudioBufferRef::S8(b) => append!(b),
        AudioBufferRef::S16(b) => append!(b),
        AudioBufferRef::S24(b) => append!(b),
        AudioBufferRef::S32(b) => append!(b),
        AudioBufferRef::F32(b) => append!(b),
        AudioBufferRef::F64(b) => append!(b),
    }
}

pub fn background_decode(
    path: String,
    samples: Arc<Mutex<Vec<Vec<f32>>>>,
    complete: Arc<AtomicBool>,
    shutdown: Arc<AtomicBool>,
    file_rate: usize,
    cache_codec: &'static str,
    _decrypted_file: Option<Arc<DecryptedPlaybackFile>>,
) {
    #[cfg(target_os = "windows")]
    unsafe {
        let _ = windows::Win32::System::Threading::SetThreadPriority(
            windows::Win32::System::Threading::GetCurrentThread(),
            windows::Win32::System::Threading::THREAD_PRIORITY_ABOVE_NORMAL,
        );
    }

    let mut use_ffmpeg = false;
    let mut format_opt = None;
    let mut decoder_opt = None;
    let mut track_id = 0;
    let mut encoder_delay = 0u32;
    let mut encoder_padding = 0u32;

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
                Ok(Box::new(GrowingFileReader { file, complete, hash: hash.clone() }))
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
            let bg_ffmpeg_path = find_ffmpeg_path();
            let ffmpeg_ready = is_ffmpeg_available(&bg_ffmpeg_path);
            for t in probed.format.tracks() {
                if t.codec_params.codec == symphonia::core::codecs::CODEC_TYPE_AAC && ffmpeg_ready {
                    println!("[player-bg] Detected AAC codec track. Delegating to FFmpeg for full HE-AAC / SBR compatibility.");
                    selected_track = None;
                    decoder = None;
                    break;
                }
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
                encoder_delay = track.codec_params.delay.unwrap_or(0);
                encoder_padding = track.codec_params.padding.unwrap_or(0);
            }
        }
    }

    // 2. Fall back to FFmpeg transcoder if native decoding failed
    let mut child_process = None;
    if format_opt.is_none() {
        println!("[player-bg] Native decoding failed. Spawning FFmpeg transcode cache for {}...", path);
        let ffmpeg_path = find_ffmpeg_path();
        let ffmpeg_exists = is_ffmpeg_available(&ffmpeg_path);
        if ffmpeg_exists {
            #[cfg(target_os = "windows")]
            use std::os::windows::process::CommandExt;

            let rate_str = file_rate.to_string();
            let mut cmd = std::process::Command::new(&ffmpeg_path);
            cmd.args([
                "-probesize", "32768",
                "-analyzeduration", "100000",
                "-i", &path,
                "-f", "wav",
                "-acodec", cache_codec,
                "-ar", &rate_str,
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
            if let Some(mut child) = child_process.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
            complete.store(true, Ordering::SeqCst); // Avoid hanging caller in waiting loop
            return;
        }
    };
    let mut decoder = decoder_opt.unwrap();

    let file_ch = {
        let lock = safe_lock(&samples);
        lock.len()
    };
    let mut remaining_delay = encoder_delay as usize;
    let mut local_buffers = vec![Vec::new(); file_ch];
    let mut packet_count = 0;
    let mut is_initial_batch = true;

    loop {
        if shutdown.load(Ordering::Relaxed) { break; }
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(_) => break,
        };

        if packet.track_id() != track_id { continue; }

        if let Ok(decoded) = decoder.decode(&packet) {
            let n_frames = decoded_frames(&decoded);
            if n_frames == 0 { continue; }

            let skip_frames = if remaining_delay > 0 {
                let skip = remaining_delay.min(n_frames);
                remaining_delay -= skip;
                skip
            } else {
                0
            };

            if skip_frames < n_frames {
                for (ch, buf) in local_buffers.iter_mut().enumerate().take(file_ch) {
                    append_f32_channel_data(&decoded, ch, skip_frames, buf);
                }

                packet_count += 1;
                let flush_threshold = if is_initial_batch { 2 } else { 8 };
                if packet_count >= flush_threshold {
                    let mut lock = safe_lock(&samples);
                    for ch in 0..file_ch {
                        lock[ch].append(&mut local_buffers[ch]);
                    }
                    packet_count = 0;
                    is_initial_batch = false;
                }
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

    if !should_mark_decode_complete(shutdown.load(Ordering::Relaxed)) {
        println!("[player-bg] Pre-decoding aborted by shutdown for {}. NOT marking complete.", path);
        return;
    }

    // Encoder delay was skipped at ingestion time, keeping samples strictly append-only.
    // At EOF, only trailing encoder padding is truncated from the tail, preserving ram_cursor.
    if encoder_padding > 0 {
        trim_encoder_padding(&mut safe_lock(&samples), encoder_padding as usize);
    }

    complete.store(true, Ordering::SeqCst);
    println!("[player-bg] Successfully completed pre-decoding RAM cache for {} (used_ffmpeg = {})!", path, use_ffmpeg);
}

pub fn should_mark_decode_complete(was_aborted_by_shutdown: bool) -> bool {
    !was_aborted_by_shutdown
}

pub fn can_reuse_cached_track(
    cached_path: &str,
    resolved_path: &str,
    cached_rate: usize,
    target_rate: usize,
    cached_ch: usize,
    target_ch: usize,
    is_complete: bool,
    decode_shutdown_active: bool,
) -> bool {
    if cached_path != resolved_path {
        return false;
    }
    if cached_rate != target_rate || cached_ch != target_ch {
        return false;
    }
    if is_complete {
        return true;
    }
    decode_shutdown_active
}

pub fn is_playable_local_path(path: &str) -> bool {
    !path.starts_with("http://") && !path.starts_with("https://") && std::path::Path::new(path).is_file()
}

pub fn should_bypass_ram_cache(file_bytes: u64, duration_secs: f64, file_rate: usize, file_ch: usize) -> bool {
    // Unknown duration has no safe compressed-size expansion bound: decode on demand.
    if !duration_secs.is_finite() || duration_secs <= 0.0 || file_ch > 2 || file_bytes > 150 * 1024 * 1024 || duration_secs > 900.0 {
        return true;
    }
    if duration_secs > 0.0 && file_rate > 0 && file_ch > 0 {
        let estimated_uncompressed_bytes = (duration_secs * file_rate as f64 * file_ch as f64 * 4.0) as u64;
        if estimated_uncompressed_bytes > 400 * 1024 * 1024 {
            return true;
        }
    }
    false
}

pub fn trim_encoder_padding(samples: &mut [Vec<f32>], padding: usize) {
    for channel in samples {
        channel.truncate(channel.len().saturating_sub(padding));
    }
}

pub fn decoded_frames(buf: &AudioBufferRef<'_>) -> usize {
    buf.frames()
}

