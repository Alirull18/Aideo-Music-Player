use serde::{Deserialize, Serialize};
use tauri::State;
use crate::AppState;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub fn find_ytdlp_bin() -> std::path::PathBuf {
    let data_dir = dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    data_dir.join("Aideo").join("yt-dlp.exe")
}

fn parse_ytdlp_progress(line: &str) -> Option<(f64, f64, f64)> {
    if line.starts_with("[download]") {
        if let Some(of_idx) = line.find("of") {
            let percent_part = &line["[download]".len()..of_idx].trim();
            let percent_clean = percent_part.replace("%", "");
            if let Ok(percent) = percent_clean.parse::<f64>() {
                let remaining = &line[of_idx + 2..].trim();
                let size_part = if let Some(at_idx) = remaining.find("at") {
                    &remaining[..at_idx].trim()
                } else {
                    remaining
                };

                let is_mib = size_part.contains("MiB") || size_part.contains("mib");
                let is_kb = size_part.contains("KiB") || size_part.contains("KB") || size_part.contains("kib") || size_part.contains("kb");

                let size_clean = size_part
                    .replace("MiB", "")
                    .replace("MB", "")
                    .replace("mib", "")
                    .replace("mb", "")
                    .replace("KiB", "")
                    .replace("KB", "")
                    .replace("kib", "")
                    .replace("kb", "")
                    .trim()
                    .to_string();

                if let Ok(total_size) = size_clean.parse::<f64>() {
                    let total_mb = if is_mib {
                        total_size * 1.04858
                    } else if is_kb {
                        total_size / 1024.0
                    } else {
                        total_size
                    };

                    let downloaded_mb = total_mb * (percent / 100.0);
                    return Some((percent, downloaded_mb, total_mb));
                }
            }
        }
    }
    None
}

fn run_ytdlp_with_progress(
    ytdlp_path: &std::path::Path,
    args: &[String],
    url: &str,
    app_handle: &tauri::AppHandle,
    music_dir: &std::path::Path,
) -> Result<String, String> {
    use std::io::{BufRead, BufReader};
    use tauri::Emitter;

    let mut cmd = std::process::Command::new(ytdlp_path);
    cmd.args(args)
       .arg(url)
       .stdout(std::process::Stdio::piped())
       .stderr(std::process::Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn yt-dlp: {}", e))?;
    let stdout = child.stdout.take().ok_or("Failed to open stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to open stderr")?;

    // Drain stderr asynchronously to prevent subprocess deadlock from full OS pipe buffers
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for l in reader.lines().map_while(Result::ok) {
            eprintln!("[yt-dlp-err] {}", l);
        }
    });

    let reader = BufReader::new(stdout);
    let mut final_path_str = String::new();
    let mut last_emit_time = std::time::Instant::now();

    for l in reader.lines().map_while(Result::ok) {
        if let Some((percent, downloaded_mb, total_mb)) = parse_ytdlp_progress(&l) {
            if last_emit_time.elapsed() >= std::time::Duration::from_millis(150) {
                let _ = app_handle.emit("ytdlp-download-progress", serde_json::json!({
                    "url": url,
                    "percent": percent,
                    "downloaded_mb": downloaded_mb,
                    "total_mb": total_mb
                }));
                last_emit_time = std::time::Instant::now();
            }
        }

        let trimmed = l.trim();
        if !trimmed.is_empty() {
            let trimmed_lower = trimmed.to_lowercase();
            // Capture file path strings ending with audio extensions without verifying .exists() instantly
            if (trimmed.contains(":\\") || trimmed.contains(":/") || trimmed.starts_with('/') || trimmed.contains("Aideo Downloads"))
                && (trimmed_lower.ends_with(".m4a") || trimmed_lower.ends_with(".mp3") || trimmed_lower.ends_with(".webm") || trimmed_lower.ends_with(".mp4") || trimmed_lower.ends_with(".flac"))
            {
                final_path_str = trimmed.to_string();
            }
        }
    }

    let status = child.wait().map_err(|e| format!("Process wait failed: {}", e))?;
    if status.success() {
        // Validate and normalize the path since the process has exited completely
        let normalized_path = if !final_path_str.is_empty() {
            let p = std::path::Path::new(&final_path_str);
            if p.exists() {
                Some(final_path_str.clone())
            } else {
                let cleaned = final_path_str.replace("/", "\\").replace("\\\\", "\\");
                let cleaned_p = std::path::Path::new(&cleaned);
                if cleaned_p.exists() {
                    Some(cleaned)
                } else {
                    None
                }
            }
        } else {
            None
        };

        if let Some(valid_path) = normalized_path {
            let _ = app_handle.emit("ytdlp-download-progress", serde_json::json!({
                "url": url,
                "percent": 100.0,
                "downloaded_mb": 0.0,
                "total_mb": 0.0
            }));
            Ok(valid_path)
        } else {
            // Fallback: search music_dir for the newest file created in the last 15 seconds
            println!("[youtube] Path resolution failed. Initiating fallback directory scan...");
            if let Ok(entries) = std::fs::read_dir(music_dir) {
                let mut newest_file = None;
                let mut newest_time = std::time::SystemTime::UNIX_EPOCH;
                for entry in entries.flatten() {
                    if let Ok(meta) = entry.metadata() {
                        if meta.is_file() {
                            if let Ok(created) = meta.created() {
                                if created > newest_time {
                                    newest_time = created;
                                    newest_file = Some(entry.path());
                                }
                            }
                        }
                    }
                }
                if let Some(path) = newest_file {
                    if let Ok(elapsed) = std::time::SystemTime::now().duration_since(newest_time) {
                        if elapsed.as_secs() < 15 {
                            let path_str = path.to_string_lossy().to_string();
                            println!("[youtube] Fallback matched newest file: {}", path_str);
                            let _ = app_handle.emit("ytdlp-download-progress", serde_json::json!({
                                "url": url,
                                "percent": 100.0,
                                "downloaded_mb": 0.0,
                                "total_mb": 0.0
                            }));
                            return Ok(path_str);
                        }
                    }
                }
            }

            Err(format!(
                "yt-dlp completed successfully, but the downloaded file could not be resolved. Captured path was: '{}'",
                final_path_str
            ))
        }
    } else {
        Err("yt-dlp command exited with error status".to_string())
    }
}

async fn add_downloaded_track_to_library(
    path: String,
    title: Option<String>,
    artist: Option<String>,
    cover_url: Option<String>,
    state: &State<'_, AppState>,
) -> Result<(), String> {
    // 1. Download cover art if provided
    if let Some(ref url) = cover_url {
        if !url.is_empty() {
            let path_obj = std::path::Path::new(&path);
            if let Some(parent) = path_obj.parent() {
                if let Some(stem) = path_obj.file_stem() {
                    let ext = if url.contains(".png") { "png" } else { "jpg" };
                    let img_path = parent.join(format!("{}.{}", stem.to_string_lossy(), ext));
                    println!("[youtube] Attempting to download cover art to: {:?}", img_path);

                    let client = crate::get_http_client();
                    match client.get(url).send().await {
                        Ok(res) => {
                            match res.bytes().await {
                                Ok(bytes) => {
                                    if let Err(e) = std::fs::write(&img_path, bytes) {
                                        eprintln!("[youtube] Failed to write downloaded cover art to {:?}: {}", img_path, e);
                                    } else {
                                        println!("[youtube] Successfully cached cover art locally.");
                                    }
                                }
                                Err(e) => {
                                    eprintln!("[youtube] Failed to read cover art bytes from URL: {}", e);
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("[youtube] Failed to fetch cover art from URL: {}", e);
                        }
                    }
                }
            }
        }
    }

    // 2. Extract metadata or fallback
    let mut track = match crate::scanner::extract_metadata(std::path::Path::new(&path)) {
        Some(t) => t,
        None => {
            let fallback_title = std::path::Path::new(&path)
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();

            crate::db::Track {
                id: 0,
                path: path.clone(),
                title: Some(fallback_title),
                artist: Some("Unknown Artist".to_string()),
                album: None,
                duration: None,
                format: std::path::Path::new(&path)
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|s| s.to_uppercase()),
                lyric_offset: 0,
                loved: Some(0),
                disliked: Some(0),
                cover_url: None,
                path_hash: None,
                bpm: None,
                energy: None,
                bass_ratio: None,
                treble_ratio: None,
                replaygain_gain: None,
                track_number: None,
                disc_number: None,
                genre: None,
            }
        }
    };

    // 3. Override extracted metadata with provided metadata if they are present
    if let Some(t) = title {
        if !t.is_empty() {
            track.title = Some(t);
        }
    }
    if let Some(a) = artist {
        if !a.is_empty() {
            track.artist = Some(a);
        }
    }
    if let Some(c) = cover_url {
        if !c.is_empty() {
            track.cover_url = Some(c);
        }
    }

    // 4. Save track to library DB
    let mut conn = crate::safe_lock(&state.db);
    crate::db::save_tracks(&mut conn, &mut [track]).map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn download_track_internal(
    url: String,
    quality: String,
    title: Option<String>,
    artist: Option<String>,
    cover_url: Option<String>,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    println!("[youtube] Initiating robust invisible yt-dlp download for URL: {} at quality: {}", url, quality);

    // 1. Auto-Installer setup
    let data_dir = dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let aideo_data_dir = data_dir.join("Aideo");
    if !aideo_data_dir.exists() {
        std::fs::create_dir_all(&aideo_data_dir).map_err(|e| e.to_string())?;
    }

    let ytdlp_path = find_ytdlp_bin();

    // Download yt-dlp.exe if it doesn't exist
    if !ytdlp_path.exists() {
        println!("[youtube] yt-dlp.exe not found. Downloading latest version...");
        let response = reqwest::get("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe")
            .await.map_err(|e| format!("Failed to download yt-dlp: {}", e))?;
        if !response.status().is_success() {
            return Err(format!("Failed to download yt-dlp: HTTP status {}", response.status()));
        }
        let bytes = response.bytes().await.map_err(|e| e.to_string())?;
        if bytes.len() < 1_000_000 {
            return Err("Downloaded yt-dlp.exe is invalid or too small.".to_string());
        }

        let mut file = std::fs::File::create(&ytdlp_path).map_err(|e| format!("Failed to create yt-dlp.exe: {}", e))?;
        use std::io::Write;
        file.write_all(&bytes).map_err(|e| format!("Failed to write yt-dlp.exe: {}", e))?;
        println!("[youtube] Successfully downloaded yt-dlp.exe!");
    }

    // 2. Prepare the music output directory
    let music_dir = dirs::audio_dir()
        .unwrap_or_else(|| dirs::document_dir().unwrap_or_else(|| std::path::PathBuf::from(".")))
        .join("Aideo Downloads");

    std::fs::create_dir_all(&music_dir).map_err(|e| e.to_string())?;

    // Build the output template to write directly to "Aideo Downloads" using native path joining for absolute backslash structure
    let output_template = music_dir.join("%(title)s.%(ext)s").to_string_lossy().to_string();

    // Check if ffmpeg.exe exists to pass --ffmpeg-location
    let ffmpeg_path = aideo_data_dir.join("ffmpeg.exe");
    let has_ffmpeg = ffmpeg_path.exists();
    let ffmpeg_loc_str = aideo_data_dir.to_string_lossy().to_string();

    // Determine format string based on quality selection
    // Note: We prefer m4a to avoid needing ffmpeg for format conversion, ensuring smooth playback.
    // Format 141 is YouTube Music's high-fidelity 256kbps AAC stream, and Format 140 is standard 128kbps AAC.
    let format_str = match quality.as_str() {
        "high" => "141/bestaudio[ext=m4a]/bestaudio/best", // Prioritize premium 256kbps AAC YouTube Music stream
        "low" => "worstaudio[ext=m4a]/worstaudio/worst", // Lowest data usage
        _ => "141/140/bestaudio[ext=m4a]/best", // Standard high quality
    };

    println!("[youtube] Extracting audio stream (Format: {}) via invisible yt-dlp using template: {}", format_str, output_template);

    // Attempt 1: default client sequence without forcing client args (letting yt-dlp use its highly optimized self-updating sequence)
    let mut args_1 = vec![
        "-f".to_string(),
        format_str.to_string(),
        "--cache-dir".to_string(),
        aideo_data_dir.join("cache").to_string_lossy().to_string(),
        "--force-ipv4".to_string(),
        "--no-check-formats".to_string(),
        "--no-playlist".to_string(),
        "--sleep-interval".to_string(),
        "0".to_string(),
        "--max-sleep-interval".to_string(),
        "0".to_string(),
        "--sleep-requests".to_string(),
        "0".to_string(),
        "--print".to_string(),
        "after_move:filepath".to_string(),
        "-o".to_string(),
        output_template.clone(),
    ];
    if has_ffmpeg {
        args_1.push("--ffmpeg-location".to_string());
        args_1.push(ffmpeg_loc_str.clone());
    }

    let ytdlp_path_c = ytdlp_path.clone();
    let args_1_c = args_1.clone();
    let url_c = url.clone();
    let app_handle_c = app_handle.clone();
    let music_dir_c = music_dir.clone();

    let run_res = tokio::task::spawn_blocking(move || {
        run_ytdlp_with_progress(&ytdlp_path_c, &args_1_c, &url_c, &app_handle_c, &music_dir_c)
    }).await.map_err(|e| format!("yt-dlp task panicked: {}", e))?;

    if let Ok(final_path_str) = run_res {
        println!("[youtube] Download SUCCESS! Final file: {}", final_path_str);
        add_downloaded_track_to_library(final_path_str.clone(), title.clone(), artist.clone(), cover_url.clone(), &state).await?;
        return Ok(final_path_str);
    }

    // Attempt self-update of yt-dlp
    println!("[youtube] Initial attempt failed. Attempting to self-update yt-dlp...");
    let ytdlp_path_c = ytdlp_path.clone();
    let _ = tokio::task::spawn_blocking(move || {
        std::process::Command::new(&ytdlp_path_c)
            .arg("-U")
            .creation_flags(CREATE_NO_WINDOW)
            .status()
    }).await;

    // Retry 1: updated yt-dlp with default adaptive arguments
    let ytdlp_path_c = ytdlp_path.clone();
    let args_1_c = args_1.clone();
    let url_c = url.clone();
    let app_handle_c = app_handle.clone();
    let music_dir_c = music_dir.clone();

    let run_res = tokio::task::spawn_blocking(move || {
        run_ytdlp_with_progress(&ytdlp_path_c, &args_1_c, &url_c, &app_handle_c, &music_dir_c)
    }).await.map_err(|e| format!("yt-dlp task panicked: {}", e))?;

    if let Ok(final_path_str) = run_res {
        println!("[youtube] Retry 1 SUCCESS! Final file: {}", final_path_str);
        add_downloaded_track_to_library(final_path_str.clone(), title.clone(), artist.clone(), cover_url.clone(), &state).await?;
        return Ok(final_path_str);
    }

    // Retry 2: with forced PO-Token / client bypass arguments (mweb & android are less rate-limited)
    println!("[youtube] Retry 1 failed. Attempting with forced mweb,android client parameters...");
    let mut args_retry_2 = vec![
        "-f".to_string(),
        format_str.to_string(),
        "--cache-dir".to_string(),
        aideo_data_dir.join("cache").to_string_lossy().to_string(),
        "--force-ipv4".to_string(),
        "--no-check-formats".to_string(),
        "--no-playlist".to_string(),
        "--sleep-interval".to_string(),
        "0".to_string(),
        "--max-sleep-interval".to_string(),
        "0".to_string(),
        "--sleep-requests".to_string(),
        "0".to_string(),
        "--extractor-args".to_string(),
        "youtube:player-client=mweb,android".to_string(),
        "--print".to_string(),
        "after_move:filepath".to_string(),
        "-o".to_string(),
        output_template.clone(),
    ];
    if has_ffmpeg {
        args_retry_2.push("--ffmpeg-location".to_string());
        args_retry_2.push(ffmpeg_loc_str.clone());
    }

    let ytdlp_path_c = ytdlp_path.clone();
    let args_retry_2_c = args_retry_2.clone();
    let url_c = url.clone();
    let app_handle_c = app_handle.clone();
    let music_dir_c = music_dir.clone();

    let run_res = tokio::task::spawn_blocking(move || {
        run_ytdlp_with_progress(&ytdlp_path_c, &args_retry_2_c, &url_c, &app_handle_c, &music_dir_c)
    }).await.map_err(|e| format!("yt-dlp task panicked: {}", e))?;

    match run_res {
        Ok(final_path_str) => {
            println!("[youtube] Retry 2 SUCCESS! Final file: {}", final_path_str);
            add_downloaded_track_to_library(final_path_str.clone(), title.clone(), artist.clone(), cover_url.clone(), &state).await?;
            Ok(final_path_str)
        }
        Err(e) => {
            println!("[youtube] All yt-dlp attempts failed. Error: {}", e);
            Err("YouTube rate-limited or blocked this request (HTTP 429 / PO-Token). Please use the Lucida or Squid web bypass options on the track cards to download manually in 1 click!".to_string())
        }
    }
}

fn deserialize_artist_flexible<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;
    let val: Option<serde_json::Value> = Option::deserialize(deserializer)?;
    match val {
        Some(serde_json::Value::String(s)) => Ok(if s.trim().is_empty() { None } else { Some(s.trim().to_string()) }),
        Some(serde_json::Value::Object(obj)) => {
            if let Some(name) = obj.get("name").and_then(|n| n.as_str()) {
                Ok(if name.trim().is_empty() { None } else { Some(name.trim().to_string()) })
            } else {
                Ok(None)
            }
        }
        _ => Ok(None),
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct BatchDownloadItem {
    #[serde(default, alias = "url", alias = "stream_url", alias = "path")]
    pub url: Option<String>,
    #[serde(default, alias = "title", alias = "name", alias = "track")]
    pub title: Option<String>,
    #[serde(default, alias = "artist", alias = "artist_name", deserialize_with = "deserialize_artist_flexible")]
    pub artist: Option<String>,
    #[serde(default, alias = "album", alias = "album_title")]
    pub album: Option<String>,
    #[serde(default, alias = "cover_url", alias = "coverUrl")]
    pub cover_url: Option<String>,
    #[serde(default, alias = "track_number", alias = "trackNumber")]
    pub track_number: Option<u32>,
    #[serde(default, alias = "duration_raw", alias = "durationRaw")]
    pub duration_raw: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BatchDownloadProgress {
    pub completed: usize,
    pub total: usize,
    pub current_title: String,
    pub percent: f64,
    pub is_done: bool,
    pub error: Option<String>,
}

pub async fn download_playlist_batch_internal(
    items: serde_json::Value,
    quality: Option<String>,
    playlist_name: Option<String>,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<usize, String> {
    use tauri::Emitter;
    use base64::Engine;

    let parsed_items: Vec<BatchDownloadItem> = if let Ok(list) = serde_json::from_value::<Vec<BatchDownloadItem>>(items.clone()) {
        list
    } else if let serde_json::Value::Array(arr) = &items {
        arr.iter().map(|val| {
            if let Ok(item) = serde_json::from_value::<BatchDownloadItem>(val.clone()) {
                item
            } else if let serde_json::Value::String(s) = val {
                BatchDownloadItem {
                    url: Some(s.clone()),
                    title: Some(s.clone()),
                    ..Default::default()
                }
            } else {
                Default::default()
            }
        }).collect()
    } else if let serde_json::Value::String(s) = &items {
        if let Ok(list) = serde_json::from_str::<Vec<BatchDownloadItem>>(s) {
            list
        } else {
            vec![BatchDownloadItem { url: Some(s.clone()), title: Some(s.clone()), ..Default::default() }]
        }
    } else {
        Vec::new()
    };

    let total = parsed_items.len();
    if total == 0 {
        return Ok(0);
    }

    println!("[youtube] Starting batch download of {} items for playlist: {:?}", total, playlist_name);

    let quality_str = quality.unwrap_or_else(|| "high".to_string());
    let mut successful_count = 0;

    for (index, item) in parsed_items.into_iter().enumerate() {
        let title_str = item.title.unwrap_or_else(|| "Untitled Track".to_string());
        let artist_str = item.artist.unwrap_or_else(|| "Unknown Artist".to_string());

        let progress = BatchDownloadProgress {
            completed: index,
            total,
            current_title: title_str.clone(),
            percent: (index as f64 / total as f64) * 100.0,
            is_done: false,
            error: None,
        };
        let _ = app_handle.emit("download_batch_progress", &progress);

        // Resolve clean direct URL & cover if not already direct
        let raw_url = item.url.unwrap_or_default().trim().to_string();
        let mut download_url = raw_url.clone();
        let mut final_cover_url = item.cover_url.clone();

        if !download_url.starts_with("http://") && !download_url.starts_with("https://") {
            let query = format!("{} - {}", artist_str, title_str);
            if let Ok(search_res) = super::search_youtube(query).await {
                if let Some(best) = search_res.into_iter().next() {
                    download_url = best.url;
                    if final_cover_url.is_none() || final_cover_url.as_deref() == Some("") {
                        final_cover_url = best.cover_url;
                    }
                }
            }
        }

        let dl_res = download_track_internal(
            download_url,
            quality_str.clone(),
            Some(title_str.clone()),
            Some(artist_str.clone()),
            final_cover_url.clone(),
            state.clone(),
            app_handle.clone(),
        ).await;

        match dl_res {
            Ok(saved_path) => {
                successful_count += 1;
                let mut update = crate::tag_editor::AudioTagUpdate {
                    title: Some(title_str.clone()),
                    artist: Some(artist_str.clone()),
                    album: item.album.clone(),
                    track_number: item.track_number,
                    ..Default::default()
                };

                if let Some(ref c_url) = final_cover_url {
                    if c_url.starts_with("http://") || c_url.starts_with("https://") {
                        if let Ok(resp) = reqwest::get(c_url).await {
                            if let Ok(bytes) = resp.bytes().await {
                                let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                                update.cover_base64 = Some(b64);
                            }
                        }
                    }
                }

                let _ = crate::tag_editor::write_tags(&saved_path, &update);

                // Re-sync updated tags with library database
                let _ = add_downloaded_track_to_library(
                    saved_path,
                    Some(title_str.clone()),
                    Some(artist_str.clone()),
                    final_cover_url.clone(),
                    &state,
                ).await;
            }
            Err(e) => {
                eprintln!("[youtube] Batch download error for '{}': {}", title_str, e);
                let err_progress = BatchDownloadProgress {
                    completed: index,
                    total,
                    current_title: title_str.clone(),
                    percent: (index as f64 / total as f64) * 100.0,
                    is_done: false,
                    error: Some(format!("Could not download '{}': {}", title_str, e)),
                };
                let _ = app_handle.emit("download_batch_progress", &err_progress);
            }
        }
    }

    let final_progress = BatchDownloadProgress {
        completed: total,
        total,
        current_title: "Completed".to_string(),
        percent: 100.0,
        is_done: true,
        error: None,
    };
    let _ = app_handle.emit("download_batch_progress", &final_progress);

    Ok(successful_count)
}

pub async fn check_and_download_ytdlp_internal(app_handle: tauri::AppHandle) -> Result<bool, String> {
    use tauri::Emitter;
    let data_dir = dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let aideo_dir = data_dir.join("Aideo");
    let ytdlp_path = find_ytdlp_bin();

    if ytdlp_path.exists() {
        return Ok(true);
    }

    println!("[dependencies] yt-dlp.exe not found. Downloading asynchronously...");
    let _ = app_handle.emit("ui-toast", serde_json::json!({
        "message": "First-time setup: Downloading high-performance audio decoder in background...",
        "type": "info"
    }));

    let response = reqwest::get("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe")
        .await
        .map_err(|e| format!("Failed to download yt-dlp: {}", e))?;

    let bytes = response.bytes().await.map_err(|e| format!("Failed to read yt-dlp bytes: {}", e))?;

    if !aideo_dir.exists() {
        std::fs::create_dir_all(&aideo_dir).map_err(|e| format!("Failed to create Aideo directory: {}", e))?;
    }

    let mut file = std::fs::File::create(&ytdlp_path).map_err(|e| format!("Failed to create yt-dlp.exe: {}", e))?;
    use std::io::Write;
    file.write_all(&bytes).map_err(|e| format!("Failed to write yt-dlp.exe: {}", e))?;

    println!("[dependencies] Successfully downloaded yt-dlp.exe!");
    let _ = app_handle.emit("ui-toast", serde_json::json!({
        "message": "Audio decoder setup complete! Ready for YouTube streaming.",
        "type": "success"
    }));

    Ok(true)
}
