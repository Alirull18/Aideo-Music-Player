use serde::{Deserialize, Serialize};
use tauri::State;
use crate::AppState;

#[derive(Serialize, Deserialize, Debug)]
pub struct YoutubeTrack {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub cover_url: Option<String>,
    pub duration_raw: String,
    pub url: String,
}

fn is_duration(s: &str) -> bool {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() < 2 || parts.len() > 3 {
        return false;
    }
    parts.iter().all(|p| {
        let trimmed = p.trim();
        !trimmed.is_empty() && trimmed.chars().all(|c| c.is_ascii_digit())
    })
}

fn extract_duration(val: &serde_json::Value) -> Option<String> {
    if let serde_json::Value::Object(obj) = val {
        if let Some(serde_json::Value::String(text)) = obj.get("text") {
            if is_duration(text) {
                return Some(text.trim().to_string());
            }
        }
        for (_, v) in obj {
            if let Some(dur) = extract_duration(v) {
                return Some(dur);
            }
        }
    } else if let serde_json::Value::Array(arr) = val {
        for v in arr {
            if let Some(dur) = extract_duration(v) {
                return Some(dur);
            }
        }
    }
    None
}

fn find_video_id(val: &serde_json::Value) -> Option<String> {
    if let serde_json::Value::Object(obj) = val {
        if let Some(serde_json::Value::String(vid)) = obj.get("videoId") {
            return Some(vid.clone());
        }
        for (_, v) in obj {
            if let Some(vid) = find_video_id(v) {
                return Some(vid);
            }
        }
    } else if let serde_json::Value::Array(arr) = val {
        for v in arr {
            if let Some(vid) = find_video_id(v) {
                return Some(vid);
            }
        }
    }
    None
}

fn find_list_items(val: &serde_json::Value, items: &mut Vec<serde_json::Value>) {
    if let serde_json::Value::Object(obj) = val {
        if let Some(renderer) = obj.get("musicResponsiveListItemRenderer") {
            items.push(renderer.clone());
        } else {
            for (_, v) in obj {
                find_list_items(v, items);
            }
        }
    } else if let serde_json::Value::Array(arr) = val {
        for v in arr {
            find_list_items(v, items);
        }
    }
}

async fn fetch_innertube_key() -> String {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build();

    let client = match client {
        Ok(c) => c,
        Err(_) => return "AIzaSyAO_Cq3eb5CuuaQSS9g-U37stSrb7Sg5gQ".to_string(),
    };

    let response = client.get("https://music.youtube.com/")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await;

    let html = match response {
        Ok(res) => res.text().await.unwrap_or_default(),
        Err(_) => return "AIzaSyAO_Cq3eb5CuuaQSS9g-U37stSrb7Sg5gQ".to_string(),
    };

    let re = regex::Regex::new(r#""INNERTUBE_API_KEY"\s*:\s*"([^"]+)""#).unwrap();
    if let Some(caps) = re.captures(&html) {
        return caps.get(1).unwrap().as_str().to_string();
    }

    let re2 = regex::Regex::new(r#""innertubeApiKey"\s*:\s*"([^"]+)""#).unwrap();
    if let Some(caps) = re2.captures(&html) {
        return caps.get(1).unwrap().as_str().to_string();
    }

    "AIzaSyAO_Cq3eb5CuuaQSS9g-U37stSrb7Sg5gQ".to_string()
}

async fn fetch_track_duration(client: &reqwest::Client, api_key: &str, video_id: &str) -> Option<String> {
    let url = format!("https://music.youtube.com/youtubei/v1/player?key={}&prettyPrint=false", api_key);
    let payload = serde_json::json!({
        "videoId": video_id,
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": "1.20240101.01.00",
                "hl": "en",
                "gl": "US"
            }
        }
    });

    let res = client.post(&url)
        .header("Content-Type", "application/json")
        .header("Referer", "https://music.youtube.com/")
        .json(&payload)
        .send()
        .await
        .ok()?;

    let json_res: serde_json::Value = res.json().await.ok()?;
    
    let length_seconds_str = json_res.get("videoDetails")
        .and_then(|details| details.get("lengthSeconds"))
        .and_then(|len| len.as_str());

    let length_seconds = if let Some(s) = length_seconds_str {
        s.parse::<u32>().ok()?
    } else {
        json_res.get("videoDetails")
            .and_then(|details| details.get("lengthSeconds"))
            .and_then(|len| len.as_u64())? as u32
    };

    if length_seconds == 0 {
        return None;
    }

    let seconds = length_seconds % 60;
    let minutes = (length_seconds / 60) % 60;
    let hours = length_seconds / 3600;

    if hours > 0 {
        Some(format!("{}:{}:{:02}", hours, minutes, seconds))
    } else {
        Some(format!("{}:{:02}", minutes, seconds))
    }
}

async fn search_youtube_internal(client: &reqwest::Client, api_key: &str, query: &str) -> Result<Vec<YoutubeTrack>, String> {
    let search_url = format!("https://music.youtube.com/youtubei/v1/search?key={}&prettyPrint=false", api_key);

    let payload = serde_json::json!({
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": "1.20240101.01.00",
                "hl": "en",
                "gl": "US"
            }
        },
        "query": query
    });

    let res = client.post(&search_url)
        .header("Content-Type", "application/json")
        .header("Referer", "https://music.youtube.com/")
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json_res: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

    let mut items = Vec::new();
    find_list_items(&json_res, &mut items);

    let mut tracks = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();

    for item in items {
        let runs = item.get("flexColumns")
            .and_then(|cols| cols.as_array())
            .and_then(|cols| cols.get(1))
            .and_then(|col| col.get("musicResponsiveListItemFlexColumnRenderer"))
            .and_then(|renderer| renderer.get("text"))
            .and_then(|text| text.get("runs"))
            .and_then(|runs| runs.as_array());

        let mut is_track = false;
        let mut artist = "Unknown Artist".to_string();

        if let Some(runs_arr) = runs {
            if let Some(first_run_text) = runs_arr.first().and_then(|r| r.get("text")).and_then(|t| t.as_str()) {
                if first_run_text == "Song" || first_run_text == "Video" {
                    is_track = true;
                    let mut artist_parts = Vec::new();
                    // Skip type prefix ("Song"/"Video") and separator bullet " • " (first 2 runs)
                    for run in runs_arr.iter().skip(2) {
                        if let Some(text) = run.get("text").and_then(|t| t.as_str()) {
                            if text == " • " {
                                break;
                            }
                            artist_parts.push(text);
                        }
                    }
                    if !artist_parts.is_empty() {
                        artist = artist_parts.join("");
                    }
                }
            }
        }

        if !is_track {
            continue;
        }

        // Get video_id prioritizing direct, robust paths
        let video_id = item.get("playlistItemData")
            .and_then(|d| d.get("videoId"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| {
                item.get("overlay")
                    .and_then(|o| o.get("musicItemThumbnailOverlayRenderer"))
                    .and_then(|o| o.get("content"))
                    .and_then(|c| c.get("musicPlayButtonRenderer"))
                    .and_then(|p| p.get("playNavigationEndpoint"))
                    .and_then(|e| e.get("watchEndpoint"))
                    .and_then(|w| w.get("videoId"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            })
            .or_else(|| find_video_id(&item));

        let video_id = match video_id {
            Some(id) => id,
            None => continue,
        };

        if seen_ids.contains(&video_id) {
            continue;
        }

        let title = item.get("flexColumns")
            .and_then(|cols| cols.as_array())
            .and_then(|cols| cols.first())
            .and_then(|col| col.get("musicResponsiveListItemFlexColumnRenderer"))
            .and_then(|renderer| renderer.get("text"))
            .and_then(|text| text.get("runs"))
            .and_then(|runs| runs.as_array())
            .and_then(|runs| runs.first())
            .and_then(|run| run.get("text"))
            .and_then(|t| t.as_str())
            .unwrap_or("Unknown Title")
            .to_string();

        let duration_raw = extract_duration(&item).unwrap_or_else(|| "0:00".to_string());

        let thumbnail_url = item.get("thumbnail")
            .and_then(|t| t.get("musicThumbnailRenderer"))
            .and_then(|mt| mt.get("thumbnail"))
            .and_then(|t| t.get("thumbnails"))
            .and_then(|arr| arr.as_array())
            .and_then(|arr| arr.last())
            .and_then(|t| t.get("url"))
            .and_then(|u| u.as_str());

        let cover_url = thumbnail_url.map(|url| {
            if let Some(pos) = url.find("=w") {
                format!("{}=w500-h500-l90-rj", &url[..pos])
            } else if let Some(pos) = url.find("=s") {
                format!("{}=w500-h500-l90-rj", &url[..pos])
            } else {
                url.to_string()
            }
        });

        let url = format!("https://www.youtube.com/watch?v={}", video_id);

        seen_ids.insert(video_id.clone());

        tracks.push(YoutubeTrack {
            id: video_id,
            title,
            artist,
            cover_url,
            duration_raw,
            url,
        });
    }

    println!("[youtube] Found {} unique tracks on YTM for query: {}", tracks.len(), query);

    let mut duration_tasks = Vec::new();
    for (i, track) in tracks.iter().enumerate() {
        if track.duration_raw == "0:00" {
            let client = client.clone();
            let api_key = api_key.to_string();
            let video_id = track.id.clone();
            duration_tasks.push(async move {
                if let Some(dur) = fetch_track_duration(&client, &api_key, &video_id).await {
                    (i, dur)
                } else {
                    (i, "0:00".to_string())
                }
            });
        }
    }

    if !duration_tasks.is_empty() {
        println!("[youtube] Resolving {} missing track durations concurrently...", duration_tasks.len());
        let results = futures::future::join_all(duration_tasks).await;
        for (i, dur) in results {
            if dur != "0:00" {
                tracks[i].duration_raw = dur;
            }
        }
    }

    Ok(tracks)
}

#[tauri::command]
pub async fn search_youtube(query: String) -> Result<Vec<YoutubeTrack>, String> {
    let api_key = fetch_innertube_key().await;
    println!("[youtube] Searching YouTube Music via InnerTube with key: {}", api_key);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    search_youtube_internal(&client, &api_key, &query).await
}

fn is_one_hour_or_longer(duration_raw: &str) -> bool {
    let parts: Vec<&str> = duration_raw.split(':').collect();
    if parts.len() >= 3 {
        if let Ok(hours) = parts[0].trim().parse::<u32>() {
            return hours >= 1;
        }
        return true;
    }
    false
}

#[tauri::command]
pub async fn get_aideo_recommendations(top_artists: Vec<String>, exclude_ids: Vec<String>) -> Result<Vec<YoutubeTrack>, String> {
    let api_key = fetch_innertube_key().await;
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let (queries, is_empty_fallback) = if top_artists.is_empty() {
        (
            vec![
                "Lofi Chill beats".to_string(),
                "Synthwave Retro".to_string(),
                "Chill Vibes".to_string(),
                "Acoustic Pop".to_string(),
            ],
            true,
        )
    } else {
        let artist_queries: Vec<String> = top_artists
            .iter()
            .take(5)
            .map(|artist| format!("{} songs", artist))
            .collect();
        (artist_queries, false)
    };

    println!(
        "[youtube] Generating recommendations (fallback={}) for queries: {:?}",
        is_empty_fallback, queries
    );

    let mut tasks = Vec::new();
    for query in queries {
        let client = client.clone();
        let api_key = api_key.clone();
        tasks.push(async move {
            search_youtube_internal(&client, &api_key, &query).await
        });
    }

    let search_results = futures::future::join_all(tasks).await;
    let mut results = Vec::new();
    for res in search_results {
        match res {
            Ok(tracks) => results.push(tracks),
            Err(e) => println!("[youtube] Recommendation query search failed: {}", e),
        }
    }

    let mut final_tracks = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for id in exclude_ids {
        seen.insert(id);
    }

    let mut iterators: Vec<_> = results.into_iter().map(|v| v.into_iter()).collect();
    let mut active = true;

    while active && final_tracks.len() < 15 {
        active = false;
        for it in &mut iterators {
            if let Some(track) = it.next() {
                active = true;
                if !seen.contains(&track.id) {
                    seen.insert(track.id.clone());
                    if is_one_hour_or_longer(&track.duration_raw) {
                        println!(
                            "[youtube] Filtering out recommended track '{}' because duration is 1 hour++ ({})",
                            track.title, track.duration_raw
                        );
                        continue;
                    }
                    final_tracks.push(track);
                    if final_tracks.len() >= 15 {
                        break;
                    }
                }
            }
        }
    }

    println!(
        "[youtube] Generated {} recommendations successfully.",
        final_tracks.len()
    );

    Ok(final_tracks)
}

use std::os::windows::process::CommandExt;
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[tauri::command]
pub async fn download_track(url: String, quality: String, state: State<'_, AppState>) -> Result<String, String> {
    println!("[youtube] Initiating robust invisible yt-dlp download for URL: {} at quality: {}", url, quality);
    
    // 1. Auto-Installer setup
    let data_dir = dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let aideo_data_dir = data_dir.join("Aideo");
    if !aideo_data_dir.exists() {
        std::fs::create_dir_all(&aideo_data_dir).map_err(|e| e.to_string())?;
    }
    
    let ytdlp_path = aideo_data_dir.join("yt-dlp.exe");
    
    // Download yt-dlp.exe if it doesn't exist
    if !ytdlp_path.exists() {
        println!("[youtube] yt-dlp.exe not found. Downloading latest version...");
        let response = reqwest::get("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe")
            .await.map_err(|e| format!("Failed to download yt-dlp: {}", e))?;
        let bytes = response.bytes().await.map_err(|e| e.to_string())?;
        
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
    
    // Build the output template to write directly to "Aideo Downloads" using yt-dlp's native naming template
    let output_template = format!("{}/%(title)s.%(ext)s", music_dir.to_string_lossy());
    
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
    let output = std::process::Command::new(&ytdlp_path)
        .arg("-f")
        .arg(format_str)
        .arg("--no-cache-dir")
        .arg("--print")
        .arg("after_move:filepath")
        .arg("-o")
        .arg(&output_template)
        .arg(&url)
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    match output {
        Ok(out) if out.status.success() => {
            let stdout_str = String::from_utf8_lossy(&out.stdout);
            let final_path_str = stdout_str
                .lines()
                .map(|l| l.trim())
                .filter(|l| !l.is_empty())
                .last()
                .unwrap_or("")
                .to_string();
                
            if !final_path_str.is_empty() && std::path::Path::new(&final_path_str).exists() {
                println!("[youtube] Download SUCCESS! Final file: {}", final_path_str);
                crate::add_track_to_library(final_path_str.clone(), state)?;
                return Ok(final_path_str);
            }
        }
        _ => {}
    }

    // Attempt self-update of yt-dlp
    println!("[youtube] Initial attempt failed. Attempting to self-update yt-dlp...");
    let _ = std::process::Command::new(&ytdlp_path)
        .arg("-U")
        .creation_flags(CREATE_NO_WINDOW)
        .status();

    // Retry 1: updated yt-dlp with default adaptive arguments
    let retry_1 = std::process::Command::new(&ytdlp_path)
        .arg("-f")
        .arg(format_str)
        .arg("--no-cache-dir")
        .arg("--print")
        .arg("after_move:filepath")
        .arg("-o")
        .arg(&output_template)
        .arg(&url)
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    match retry_1 {
        Ok(out) if out.status.success() => {
            let stdout_str = String::from_utf8_lossy(&out.stdout);
            let final_path_str = stdout_str
                .lines()
                .map(|l| l.trim())
                .filter(|l| !l.is_empty())
                .last()
                .unwrap_or("")
                .to_string();
                
            if !final_path_str.is_empty() && std::path::Path::new(&final_path_str).exists() {
                println!("[youtube] Retry 1 SUCCESS! Final file: {}", final_path_str);
                crate::add_track_to_library(final_path_str.clone(), state)?;
                return Ok(final_path_str);
            }
        }
        _ => {}
    }

    // Retry 2: with forced PO-Token / client bypass arguments (mweb & android are less rate-limited)
    println!("[youtube] Retry 1 failed. Attempting with forced mweb,android client parameters...");
    let retry_2 = std::process::Command::new(&ytdlp_path)
        .arg("-f")
        .arg(format_str)
        .arg("--no-cache-dir")
        .arg("--extractor-args")
        .arg("youtube:player-client=mweb,android")
        .arg("--print")
        .arg("after_move:filepath")
        .arg("-o")
        .arg(&output_template)
        .arg(&url)
        .creation_flags(CREATE_NO_WINDOW)
        .output();

    match retry_2 {
        Ok(out) if out.status.success() => {
            let stdout_str = String::from_utf8_lossy(&out.stdout);
            let final_path_str = stdout_str
                .lines()
                .map(|l| l.trim())
                .filter(|l| !l.is_empty())
                .last()
                .unwrap_or("")
                .to_string();
                
            if !final_path_str.is_empty() && std::path::Path::new(&final_path_str).exists() {
                println!("[youtube] Retry 2 SUCCESS! Final file: {}", final_path_str);
                crate::add_track_to_library(final_path_str.clone(), state)?;
                return Ok(final_path_str);
            }
        }
        Ok(out) => {
            let err_msg = String::from_utf8_lossy(&out.stderr);
            println!("[youtube] All yt-dlp attempts failed. Stderr: {}", err_msg);
            return Err(format!(
                "YouTube rate-limited or blocked this request (HTTP 429 / PO-Token). Please use the Lucida or Squid web bypass options on the track cards to download manually in 1 click!",
            ));
        }
        Err(e) => {
            return Err(format!("Failed to execute updated yt-dlp: {}", e));
        }
    }

    Err("YouTube download failed. Google rate-limited this request. Please click Lucida or Squid on the track card to download lossless FLAC manually in 1 click!".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_ytm_search() {
        let api_key = fetch_innertube_key().await;
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build()
            .unwrap();

        let search_url = format!("https://music.youtube.com/youtubei/v1/search?key={}&prettyPrint=false", api_key);
        let payload = serde_json::json!({
            "context": {
                "client": {
                    "clientName": "WEB_REMIX",
                    "clientVersion": "1.20240101.01.00",
                    "hl": "en",
                    "gl": "US"
                }
            },
            "query": "roar"
        });

        let res = client.post(&search_url)
            .header("Content-Type", "application/json")
            .header("Referer", "https://music.youtube.com/")
            .json(&payload)
            .send()
            .await
            .unwrap();

        let json_res: serde_json::Value = res.json().await.unwrap();
        let mut items = Vec::new();
        find_list_items(&json_res, &mut items);

        let mut matches = Vec::new();
        for item in &items {
            let title = item.get("flexColumns")
                .and_then(|cols| cols.as_array())
                .and_then(|cols| cols.first())
                .and_then(|col| col.get("musicResponsiveListItemFlexColumnRenderer"))
                .and_then(|renderer| renderer.get("text"))
                .and_then(|text| text.get("runs"))
                .and_then(|runs| runs.as_array())
                .and_then(|runs| runs.first())
                .and_then(|run| run.get("text"))
                .and_then(|t| t.as_str())
                .unwrap_or("");
            if title.eq_ignore_ascii_case("Roar") {
                matches.push(item.clone());
            }
        }
        
        let path = std::path::Path::new("c:\\Users\\Alirul\\Aideo-Music-Player\\scratch\\roar_items.json");
        std::fs::write(path, serde_json::to_string_pretty(&matches).unwrap()).unwrap();
        println!("SAVED {} MATCHES TO SCRATCH FILE", matches.len());
    }

    #[tokio::test]
    async fn test_search_youtube_integration() {
        let results = search_youtube("roar".to_string()).await.unwrap();
        println!("TOTAL PARSED TRACKS: {}", results.len());
        for (i, t) in results.iter().enumerate() {
            println!("Track {}: ID={}, Title='{}', Artist='{}', Duration='{}', Cover='{:?}'",
                i, t.id, t.title, t.artist, t.duration_raw, t.cover_url);
        }
    }
}

