use cpal::traits::{DeviceTrait, HostTrait};
use serde::{Deserialize, Serialize};
use souvlaki::{MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, PlatformConfig, MediaPosition};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State, Listener};

mod artwork;
mod db;
mod lyrics;
mod player;
use crate::player::PlayerCommand;
mod lastfm;
pub mod lastfm_api;
mod scanner;
mod musicbrainz;
mod discord;
pub mod youtube;
pub mod wasapi_engine;
pub mod tidal;
pub mod updater;
pub mod cloud;
pub mod dependencies;

// ── Shared application state ──────────────────────────────────────────────────
// ── Safe Lock Utility ────────────────────────────────────────────────────────
fn safe_lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            eprintln!("[system] Mutex poisoned! Recovering...");
            poisoned.into_inner()
        }
    }
}

pub struct AppState {
    pub player: Arc<Mutex<player::Player>>,
    pub db: Arc<Mutex<rusqlite::Connection>>,
    pub media_controls: Arc<Mutex<Option<MediaControls>>>,
    pub cached_devices: Arc<Mutex<Vec<String>>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub source: String,
    pub synced: bool,
    pub content_id: Option<String>,
    pub raw_lrc: Option<String>,
    pub cover_url: Option<String>,
}

// ── Translation command ─────────────────────────────────────────────────────
#[tauri::command]
async fn translate_lyric_line(text: String) -> Result<(String, String), String> {
    let url = format!(
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&dt=rm&q={}",
        urlencoding::encode(&text)
    );
    let client = reqwest::Client::new();
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let data = res
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;

    let translation = data.get(0)
        .and_then(|v| v.get(0))
        .and_then(|v| v.get(0))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let transliteration = data.get(0)
        .and_then(|v| v.get(1))
        .and_then(|v| v.get(3))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    Ok((translation, transliteration))
}

// ── Online Search commands ──────────────────────────────────────────────────
#[tauri::command]
async fn search_lyrics_online(query: String) -> Result<Vec<SearchResult>, String> {
    let mut results = Vec::new();
    let client = reqwest::Client::new();
    let encoded_query = urlencoding::encode(&query);

    // iTunes search for high-fidelity cover arts (extremely reliable for global / K-Pop releases)
    let itunes_url = format!(
        "https://itunes.apple.com/search?term={}&entity=song&limit=10",
        encoded_query
    );
    if let Ok(res) = client.get(&itunes_url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .send().await {
        if let Ok(data) = res.json::<serde_json::Value>().await {
            if let Some(list) = data["results"].as_array() {
                for item in list {
                    let cover_url = item["artworkUrl100"].as_str().map(|url| {
                        url.replace("100x100bb.jpg", "600x600bb.jpg")
                           .replace("100x100bb.png", "600x600bb.png")
                           .replace("100x100", "600x600")
                    });
                    let track_id = item["trackId"].as_i64()
                        .map(|i| i.to_string())
                        .unwrap_or_else(|| item["trackId"].to_string());
                    results.push(SearchResult {
                        id: track_id.clone(),
                        title: item["trackName"].as_str().unwrap_or("").to_string(),
                        artist: item["artistName"].as_str().unwrap_or("").to_string(),
                        source: "iTunes".to_string(),
                        synced: false,
                        content_id: Some(track_id),
                        raw_lrc: None,
                        cover_url,
                    });
                }
            }
        }
    }

    let lrc_url = format!("https://lrclib.net/api/search?q={}", encoded_query);
    if let Ok(res) = client.get(&lrc_url).send().await {
        if let Ok(data) = res.json::<serde_json::Value>().await {
            if let Some(list) = data.as_array() {
                for item in list.iter().take(5) {
                    results.push(SearchResult {
                        id: item["id"].to_string(),
                        title: item["trackName"].as_str().unwrap_or("").to_string(),
                        artist: item["artistName"].as_str().unwrap_or("").to_string(),
                        source: "LRCLIB".to_string(),
                        synced: !item["syncedLyrics"].is_null(),
                        content_id: None,
                        raw_lrc: item["syncedLyrics"]
                            .as_str()
                            .or(item["plainLyrics"].as_str())
                            .map(|s| s.to_string()),
                        cover_url: None,
                    });
                }
            }
        }
    }

    let ne_url = format!(
        "https://music.163.com/api/search/get?s={}&type=1&limit=5",
        encoded_query
    );
    if let Ok(res) = client.get(&ne_url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .header("Referer", "https://music.163.com")
        .send().await {
        if let Ok(data) = res.json::<serde_json::Value>().await {
            if let Some(songs) = data["result"]["songs"].as_array() {
                for item in songs {
                    let ne_id = item["id"].as_i64().map(|i| i.to_string())
                        .or_else(|| item["id"].as_str().map(|s| s.to_string()))
                        .unwrap_or_else(|| item["id"].to_string());
                        
                    results.push(SearchResult {
                        id: ne_id.clone(),
                        title: item["name"].as_str().unwrap_or("").to_string(),
                        artist: item["artists"]
                            .as_array()
                            .and_then(|arr| arr.first())
                            .and_then(|a| a["name"].as_str())
                            .unwrap_or("")
                            .to_string(),
                        source: "NetEase".to_string(),
                        synced: true,
                        content_id: Some(ne_id),
                        raw_lrc: None,
                        cover_url: item["al"]["picUrl"]
                            .as_str()
                            .or_else(|| item["album"]["picUrl"].as_str())
                            .map(|s| s.to_string()),
                    });
                }
            }
        }
    }

    let qq_url = format!(
        "https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=5&w={}&format=json",
        encoded_query
    );
    if let Ok(res) = client.get(&qq_url).send().await {
        if let Ok(data) = res.json::<serde_json::Value>().await {
            if let Some(songs) = data["data"]["song"]["list"].as_array() {
                for item in songs {
                    results.push(SearchResult {
                        id: item["songmid"].as_str().unwrap_or("").to_string(),
                        title: item["songname"].as_str().unwrap_or("").to_string(),
                        artist: item["singer"]
                            .as_array()
                            .and_then(|arr| arr.first())
                            .and_then(|s| s["name"].as_str())
                            .unwrap_or("")
                            .to_string(),
                        source: "QQMusic".to_string(),
                        synced: true,
                        content_id: Some(item["songmid"].as_str().unwrap_or("").to_string()),
                        raw_lrc: None,
                        cover_url: item["albummid"].as_str().map(|mid| {
                            format!(
                                "https://y.gtimg.cn/music/photo_new/T002R300x300M000{}.jpg",
                                mid
                            )
                        }),
                    });
                }
            }
        }
    }

    Ok(results)
}


#[tauri::command]
async fn get_netease_lrc(id: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!(
        "https://music.163.com/api/song/lyric?id={}&lv=1&kv=1&tv=-1&os=pc",
        id
    );
    let res = client.get(&url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .header("Referer", "https://music.163.com")
        .send().await.map_err(|e| e.to_string())?;
    let data = res
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;
    let lrc = data["lrc"]["lyric"]
        .as_str()
        .ok_or("No lyric found")?
        .to_string();
    Ok(lrc)
}

#[tauri::command]
async fn get_qqmusic_lrc(mid: String) -> Result<String, String> {
    let client = reqwest::Client::new();
    let url = format!("https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid={}&format=json&nobase64=1", mid);
    let res = client
        .get(&url)
        .header("Referer", "https://y.qq.com/portal/player.html")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let text = res.text().await.map_err(|e| e.to_string())?;
    let mut clean_json = text;
    if clean_json.contains("MusicJsonCallback(") {
        clean_json = clean_json.replace("MusicJsonCallback(", "");
        if clean_json.ends_with(')') {
            clean_json.pop();
        } else if clean_json.ends_with(");") {
            clean_json.truncate(clean_json.len() - 2);
        } else {
            clean_json = clean_json.trim_end_matches(')').trim_end_matches(';').trim_end_matches(' ').to_string();
        }
    }

    let data: serde_json::Value = serde_json::from_str(&clean_json).map_err(|e| e.to_string())?;
    let lrc = data["lyric"].as_str().ok_or("No lyric found")?.to_string();

    if !lrc.contains("[") && lrc.len() > 10 {
        use base64::{engine::general_purpose, Engine as _};
        if let Ok(decoded) = general_purpose::STANDARD.decode(lrc.trim()) {
            if let Ok(s) = String::from_utf8(decoded) {
                return Ok(s);
            }
        }
    }

    Ok(lrc)
}

// ── Last.fm Commands ───────────────────────────────────────────────────────
#[tauri::command]
async fn lastfm_get_token() -> Result<String, String> {
    lastfm::get_auth_token().await
}

#[tauri::command]
async fn lastfm_get_session(token: String) -> Result<String, String> {
    lastfm::get_session(&token).await
}

#[tauri::command]
async fn lastfm_scrobble(artist: String, track: String, timestamp: i64, session_key: String) -> Result<(), String> {
    lastfm::scrobble(&artist, &track, timestamp, &session_key).await
}

#[tauri::command]
async fn lastfm_get_user_info(session_key: String) -> Result<serde_json::Value, String> {
    lastfm::get_user_info(&session_key).await
}

#[tauri::command]
async fn lastfm_get_recent_tracks(username: String) -> Result<serde_json::Value, String> {
    lastfm::get_recent_tracks(&username).await
}

#[tauri::command]
async fn lastfm_get_top_artists(username: String) -> Result<serde_json::Value, String> {
    lastfm::get_top_artists(&username).await
}

// ── MusicBrainz Commands ──────────────────────────────────────────────────
#[tauri::command]
async fn mbz_search_recording(title: String, artist: String) -> Result<serde_json::Value, String> {
    musicbrainz::search_recording(&title, &artist).await
}

#[tauri::command]
async fn mbz_get_cover_art(release_id: String) -> Result<String, String> {
    musicbrainz::get_cover_art_url(&release_id).await
}

#[tauri::command]
fn update_discord_presence(details: String, state_str: String, is_playing: bool) {
    discord::update_presence(&details, &state_str, is_playing);
}

#[tauri::command]
fn clear_discord_presence() {
    discord::clear_presence();
}

// ── FX Commands ────────────────────────────────────────────────────────────
#[tauri::command]
fn set_dsp_state(state: State<'_, AppState>, dsp: player::DSPState) -> Result<(), String> {
    let player = safe_lock(&state.player);
    let mut current = safe_lock(&player.dsp_state);
    *current = dsp;
    Ok(())
}

#[tauri::command]
fn get_dsp_state(state: State<'_, AppState>) -> Result<player::DSPState, String> {
    let player = safe_lock(&state.player);
    let current = safe_lock(&player.dsp_state);
    Ok(current.clone())
}

// ── Bulk Queue & ListenBrainz Commands ───────────────────────────────────────────
#[tauri::command]
fn add_to_queue_bulk(paths: Vec<String>, state: State<'_, AppState>) -> Result<(), String> {
    let player = safe_lock(&state.player);
    for path in paths {
        player.cmd_tx.send(player::PlayerCommand::AppendQueue(path)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn listenbrainz_scrobble(artist: String, track: String, timestamp: i64, token: String) -> Result<(), String> {
    let client = reqwest::Client::new();
    let payload = serde_json::json!({
        "listen_type": "single",
        "payload": [
            {
                "listened_at": timestamp,
                "track_metadata": {
                    "artist_name": artist,
                    "track_name": track
                }
            }
        ]
    });

    let res = client.post("https://api.listenbrainz.org/1/submit-listens")
        .header("Authorization", format!("Token {}", token))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Network request failed: {}", e))?;

    let status = res.status();
    if status.is_success() {
        Ok(())
    } else {
        let body = res.text().await.unwrap_or_default();
        Err(format!("ListenBrainz scrobble returned status {}: {}", status, body))
    }
}

// ── Device Commands ────────────────────────────────────────────────────────
#[tauri::command]
fn get_audio_devices(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let is_playing = {
        let player = safe_lock(&state.player);
        let status = safe_lock(&player.status);
        *status != player::PlaybackStatus::Stopped
    };

    let mut cache = safe_lock(&state.cached_devices);

    let mut all_names = Vec::new();
    let host = cpal::default_host();
    if let Ok(devices) = host.output_devices() {
        for d in devices {
            #[allow(deprecated)]
            if let Ok(name) = d.name() {
                all_names.push(format!("[WASAPI] {}", name));
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        if !is_playing || cache.is_empty() {
            if let Ok(asio_host) = cpal::host_from_id(cpal::HostId::Asio) {
                if let Ok(devices) = asio_host.output_devices() {
                    for d in devices {
                        #[allow(deprecated)]
                        if let Ok(name) = d.name() {
                            all_names.push(format!("[ASIO] {}", name));
                        }
                    }
                }
            }
        } else {
            for name in cache.iter() {
                if name.starts_with("[ASIO]") && !all_names.contains(name) {
                    all_names.push(name.clone());
                }
            }
        }
    }

    *cache = all_names.clone();
    Ok(all_names)
}

#[tauri::command]
fn set_audio_device(state: State<'_, AppState>, name: String) -> Result<(), String> {
    let player = safe_lock(&state.player);
    let mut target_device = safe_lock(&player.target_device);
    *target_device = Some(name);
    let _ = player.cmd_tx.send(PlayerCommand::RestartStream);
    Ok(())
}

// ── Scanner commands ──────────────────────────────────────────────────────────
#[tauri::command]
async fn scan_and_save(dirs: Vec<String>, app_handle: AppHandle, state: State<'_, AppState>) -> Result<usize, String> {
    let mut all_scanned_tracks = Vec::new();
    for dir in &dirs {
        let tracks = scanner::scan_directory(dir, &app_handle);
        all_scanned_tracks.extend(tracks);
    }

    let mut conn = safe_lock(&state.db);
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    
    let mut db_tracks = Vec::new();
    {
        let mut stmt = tx.prepare("SELECT id, path FROM tracks").map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let id: i32 = row.get(0).map_err(|e| e.to_string())?;
            let path: String = row.get(1).map_err(|e| e.to_string())?;
            db_tracks.push((id, path));
        }
    }
    
    let db_paths: std::collections::HashSet<String> = db_tracks.iter().map(|(_, p)| p.clone()).collect();
    
    for track in all_scanned_tracks {
        if !db_paths.contains(&track.path) {
            tx.execute(
                "INSERT INTO tracks (path, title, artist, album, duration, format, lyric_offset)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    track.path,
                    track.title,
                    track.artist,
                    track.album,
                    track.duration,
                    track.format,
                    track.lyric_offset,
                ],
            ).map_err(|e| e.to_string())?;
        }
    }
    
    for (_id, path) in db_tracks {
        if !std::path::Path::new(&path).exists() {
            tx.execute("DELETE FROM tracks WHERE path = ?1", rusqlite::params![path]).map_err(|e| e.to_string())?;
        }
    }
    
    tx.commit().map_err(|e| e.to_string())?;
    
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM tracks", [], |row| row.get(0)).unwrap_or(0);
    Ok(count as usize)
}

#[tauri::command]
fn add_track_to_library(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let track = match scanner::extract_metadata(std::path::Path::new(&path)) {
        Some(t) => t,
        None => {
            // Fallback for raw streams (like yt-dlp native m4a downloads) that lack ID3 metadata
            let title = std::path::Path::new(&path)
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
                
            db::Track {
                id: 0,
                path: path.clone(),
                title: Some(title),
                artist: Some("Unknown Artist".to_string()),
                album: None,
                duration: None,
                format: std::path::Path::new(&path)
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|s| s.to_uppercase()),
                lyric_offset: 0,
                loved: Some(0),
            }
        }
    };
    
    let mut conn = safe_lock(&state.db);
    db::save_tracks(&mut conn, &mut [track]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_playlists(state: State<'_, AppState>) -> Result<Vec<db::Playlist>, String> {
    let conn = safe_lock(&state.db);
    db::get_playlists(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn create_playlist(name: String, state: State<'_, AppState>) -> Result<i32, String> {
    let conn = safe_lock(&state.db);
    db::create_playlist(&conn, &name).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_playlist(id: i32, state: State<'_, AppState>) -> Result<(), String> {
    let conn = safe_lock(&state.db);
    db::delete_playlist(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_to_playlist(playlist_id: i32, path: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = safe_lock(&state.db);
    db::add_to_playlist(&conn, playlist_id, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_from_playlist(playlist_id: i32, path: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = safe_lock(&state.db);
    db::remove_from_playlist(&conn, playlist_id, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_playlist_tracks(playlist_id: i32, state: State<'_, AppState>) -> Result<Vec<db::Track>, String> {
    let conn = safe_lock(&state.db);
    db::get_playlist_tracks(&conn, playlist_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_library(state: State<'_, AppState>) -> Result<Vec<db::Track>, String> {
    let conn = safe_lock(&state.db);
    db::get_all_tracks(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_track(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = safe_lock(&state.db);
    db::delete_track(&conn, &path).map_err(|e| e.to_string())?;
    
    // 1. Delete the main audio file
    let audio_path = std::path::Path::new(&path);
    let _ = std::fs::remove_file(audio_path);

    // 2. Delete sidecar files (.lrc, .jpg, .png)
    if let (Some(parent), Some(stem)) = (audio_path.parent(), audio_path.file_stem()) {
        if let Some(stem_str) = stem.to_str() {
            let lrc_path = parent.join(format!("{}.lrc", stem_str));
            let jpg_path = parent.join(format!("{}.jpg", stem_str));
            let png_path = parent.join(format!("{}.png", stem_str));

            let _ = std::fs::remove_file(lrc_path);
            let _ = std::fs::remove_file(jpg_path);
            let _ = std::fs::remove_file(png_path);
        }
    }

    Ok(())
}

// ── Metadata commands ─────────────────────────────────────────────────────────
#[tauri::command]
fn get_lyrics(path: String) -> Result<Vec<lyrics::LyricLine>, String> {
    Ok(lyrics::get_lyrics_for_track(&path))
}

#[tauri::command]
async fn get_cover_art(path: String) -> Result<Option<String>, String> {
    if path.starts_with("http://") || path.starts_with("https://") {
        let client = reqwest::Client::new();
        match client.get(&path).send().await {
            Ok(res) => {
                let status = res.status();
                if status.is_success() {
                    let mime = res.headers()
                        .get(reqwest::header::CONTENT_TYPE)
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("image/jpeg")
                        .to_string();
                    if let Ok(bytes) = res.bytes().await {
                        use base64::Engine;
                        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
                        return Ok(Some(format!("data:{};base64,{}", mime, encoded)));
                    }
                }
            }
            Err(_) => {}
        }
        return Ok(None);
    }
    
    Ok(artwork::get_cover_art(&path))
}

#[tauri::command]
fn save_lyrics_file(path: String, content: String) -> Result<(), String> {
    let lrc_path = lyrics::get_lrc_path(&path);
    std::fs::write(lrc_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn apply_online_cover(path: String, url: String) -> Result<(), String> {
    let client = reqwest::Client::new();
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;

    let audio_path = std::path::Path::new(&path);
    let parent = audio_path.parent().ok_or("Invalid path")?;
    let stem = audio_path.file_stem().ok_or("Invalid filename")?.to_str().ok_or("Invalid UTF-8 in stem")?;
    
    // Choose extension based on URL or keep it jpg
    let ext = if url.to_lowercase().contains(".png") { "png" } else { "jpg" };
    let cover_path = parent.join(format!("{}.{}", stem, ext));

    std::fs::write(&cover_path, bytes).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn apply_local_cover(path: String, base64_data: String) -> Result<(), String> {
    use base64::Engine;
    let clean_base64 = if let Some(pos) = base64_data.find(",") {
        &base64_data[pos + 1..]
    } else {
        &base64_data
    };

    let decoded = base64::engine::general_purpose::STANDARD.decode(clean_base64.trim().as_bytes()).map_err(|e| e.to_string())?;
    
    let audio_path = std::path::Path::new(&path);
    let parent = audio_path.parent().ok_or("Invalid path")?;
    let stem = audio_path.file_stem().ok_or("Invalid filename")?.to_str().ok_or("Invalid UTF-8 in stem")?;

    // Determine extension based on data URL mime type
    let ext = if base64_data.contains("image/png") { "png" } else { "jpg" };
    let cover_path = parent.join(format!("{}.{}", stem, ext));

    std::fs::write(&cover_path, decoded).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Exclusive Mode commands ──────────────────────────────────────────────────
#[tauri::command]
fn toggle_exclusive_mode(state: State<'_, AppState>) -> Result<bool, String> {
    let player = safe_lock(&state.player);
    let mut mode = safe_lock(&player.exclusive_mode);
    *mode = !*mode;
    let val = *mode;
    let _ = player.cmd_tx.send(PlayerCommand::RestartStream);
    Ok(val)
}

#[tauri::command]
fn get_exclusive_mode(state: State<'_, AppState>) -> Result<bool, String> {
    let player = safe_lock(&state.player);
    let val = *safe_lock(&player.exclusive_mode);
    Ok(val)
}

#[tauri::command]
fn toggle_bit_perfect_mode(state: State<'_, AppState>) -> Result<bool, String> {
    let player = safe_lock(&state.player);
    let mut mode = safe_lock(&player.bit_perfect);
    *mode = !*mode;
    let val = *mode;
    let _ = player.cmd_tx.send(PlayerCommand::RestartStream);
    Ok(val)
}

#[tauri::command]
fn get_bit_perfect_mode(state: State<'_, AppState>) -> Result<bool, String> {
    let player = safe_lock(&state.player);
    let val = *safe_lock(&player.bit_perfect);
    Ok(val)
}

// ── Playback commands ─────────────────────────────────────────────────────────
#[tauri::command]
fn update_media_metadata(
    title: String,
    artist: String,
    cover_url: Option<String>,
    duration: f64,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if let Some(controls) = safe_lock(&state.media_controls).as_mut() {
        controls
            .set_metadata(MediaMetadata {
                title: Some(&title),
                artist: Some(&artist),
                album: None,
                duration: Some(std::time::Duration::from_secs_f64(duration)),
                cover_url: cover_url.as_deref(),
            })
            .ok();
    }
    Ok(())
}

#[tauri::command]
fn update_media_playback(playing: bool, state: State<'_, AppState>) -> Result<(), String> {
    let player = safe_lock(&state.player);
    let pos_f64 = *safe_lock(&player.position_secs);
    let progress = Some(MediaPosition(std::time::Duration::from_secs_f64(pos_f64)));
    if let Some(controls) = safe_lock(&state.media_controls).as_mut() {
        controls
            .set_playback(if playing {
                MediaPlayback::Playing { progress }
            } else {
                MediaPlayback::Paused { progress }
            })
            .ok();
    }
    Ok(())
}

#[tauri::command]
fn log_playback_start(
    path: String,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<f64>,
    format: Option<String>,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    let conn = safe_lock(&state.db);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    
    conn.execute(
        "INSERT INTO playback_history (track_path, title, artist, album, duration, format, timestamp, duration_played, skipped)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0.0, 0)",
        rusqlite::params![path, title, artist, album, duration, format, now],
    ).map_err(|e| e.to_string())?;
    
    let id = conn.last_insert_rowid();
    Ok(id)
}

#[tauri::command]
fn log_playback_end(
    history_id: i64,
    duration_played: f64,
    skipped: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = safe_lock(&state.db);
    let skipped_val = if skipped { 1 } else { 0 };
    
    conn.execute(
        "UPDATE playback_history 
         SET duration_played = ?1, skipped = ?2 
         WHERE id = ?3",
        rusqlite::params![duration_played, skipped_val, history_id],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
fn play_track(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let player = safe_lock(&state.player);
    player
        .cmd_tx
        .send(player::PlayerCommand::Play(path, 0.0))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn queue_next(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let player = safe_lock(&state.player);
    player.cmd_tx.send(player::PlayerCommand::PushNext(path)).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn add_to_queue(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let player = safe_lock(&state.player);
    player.cmd_tx.send(player::PlayerCommand::AppendQueue(path)).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_queue(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let player = safe_lock(&state.player);
    let queue = safe_lock(&player.queue);
    let paths: Vec<String> = queue.iter().cloned().collect();
    Ok(paths)
}

#[tauri::command]
fn remove_from_queue(index: usize, state: State<'_, AppState>) -> Result<(), String> {
    let player = safe_lock(&state.player);
    let mut q = safe_lock(&player.queue);
    if index < q.len() {
        q.remove(index);
    }
    Ok(())
}

#[tauri::command]
fn remove_from_queue_bulk(count: usize, state: State<'_, AppState>) -> Result<(), String> {
    let player = safe_lock(&state.player);
    let mut q = safe_lock(&player.queue);
    for _ in 0..count {
        q.pop_front();
    }
    Ok(())
}

#[tauri::command]
fn clear_queue(state: State<'_, AppState>) -> Result<(), String> {
    let player = safe_lock(&state.player);
    let mut q = safe_lock(&player.queue);
    q.clear();
    Ok(())
}

#[tauri::command]
fn reorder_queue(from: usize, to: usize, state: State<'_, AppState>) -> Result<(), String> {
    let player = safe_lock(&state.player);
    let mut q = safe_lock(&player.queue);
    if from < q.len() && to <= q.len() {
        if let Some(item) = q.remove(from) {
            let insert_idx = to.min(q.len());
            q.insert(insert_idx, item);
        }
    }
    Ok(())
}

#[tauri::command]
fn pause_track(state: State<'_, AppState>) -> Result<(), String> {
    let player = safe_lock(&state.player);
    player
        .cmd_tx
        .send(player::PlayerCommand::Pause)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn resume_track(state: State<'_, AppState>) -> Result<(), String> {
    let player = safe_lock(&state.player);
    player
        .cmd_tx
        .send(player::PlayerCommand::Resume)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn stop_track(state: State<'_, AppState>) -> Result<(), String> {
    let player = safe_lock(&state.player);
    player
        .cmd_tx
        .send(player::PlayerCommand::Stop)
        .map_err(|e| e.to_string())?;
        
    // Unblock the player_loop instantly if it is stuck connecting to a stream
    if let Some(mut child) = safe_lock(&player.current_process).take() {
        let _ = child.kill();
    }
        
    Ok(())
}

#[tauri::command]
fn set_volume(volume: f32, state: State<'_, AppState>) -> Result<(), String> {
    let player = safe_lock(&state.player);
    *safe_lock(&player.volume) = volume;
    Ok(())
}

#[tauri::command]
fn seek_track(secs: f64, state: State<'_, AppState>) -> Result<(), String> {
    let player = safe_lock(&state.player);
    player
        .cmd_tx
        .send(player::PlayerCommand::Seek(secs))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn pre_resolve_youtube_url(url: String) {
    player::pre_resolve_youtube_url(url);
}

#[tauri::command]
fn update_track_metadata(path: String, title: String, artist: String, album: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = safe_lock(&state.db);
    db::update_track_metadata(&conn, &path, &title, &artist, &album).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn update_track_offset(path: String, offset: i32, state: State<'_, AppState>) -> Result<(), String> {
    let conn = safe_lock(&state.db);
    db::update_track_offset(&conn, &path, offset).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn toggle_love_track(path: String, loved: bool, state: State<'_, AppState>) -> Result<(), String> {
    let conn = safe_lock(&state.db);
    db::toggle_love_track(&conn, &path, loved).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_playback_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let player = safe_lock(&state.player);
    Ok(serde_json::json!({
        "status": *safe_lock(&player.status),
        "current_track": *safe_lock(&player.current_track),
        "position_secs": *safe_lock(&player.position_secs),
        "volume": *safe_lock(&player.volume),
        "exclusive": *safe_lock(&player.exclusive_mode),
        "bit_perfect": *safe_lock(&player.bit_perfect),
        "dev_rate": *safe_lock(&player.current_dev_rate),
        "dsp": *safe_lock(&player.dsp_state),
    }))
}

#[tauri::command]
fn log_error(msg: String) {
    println!("[frontend-error] {}", msg);
}

#[tauri::command]
fn toggle_keep_awake(enable: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED};
        if enable {
            let _ = SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED);
            println!("[system] Power Management: Keep Awake ENABLED");
        } else {
            let _ = SetThreadExecutionState(ES_CONTINUOUS);
            println!("[system] Power Management: Keep Awake DISABLED");
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenvy::dotenv().ok();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let _ = app.emit("deep-link", argv);
        }))
        .invoke_handler(tauri::generate_handler![
            log_error,
            scan_and_save,
            get_library,
            play_track,
            queue_next,
            pause_track,
            resume_track,
            stop_track,
            update_media_metadata,
            update_media_playback,
            get_playback_status,
            get_lyrics,
            get_cover_art,
            save_lyrics_file,
            set_volume,
            seek_track,
            pre_resolve_youtube_url,
            toggle_exclusive_mode,
            get_exclusive_mode,
            toggle_bit_perfect_mode,
            get_bit_perfect_mode,
            search_lyrics_online,
            get_netease_lrc,
            translate_lyric_line,
            get_qqmusic_lrc,
            set_dsp_state,
            get_dsp_state,
            get_audio_devices,
            set_audio_device,
            apply_online_cover,
            apply_local_cover,
            update_track_metadata,
            update_track_offset,
            toggle_love_track,
            add_to_queue,
            remove_from_queue,
            remove_from_queue_bulk,
            clear_queue,
            reorder_queue,
            get_queue,
            lastfm_get_token,
            lastfm_get_session,
            lastfm_scrobble,
            lastfm_get_user_info,
            lastfm_get_recent_tracks,
            lastfm_get_top_artists,
            mbz_search_recording,
            mbz_get_cover_art,
            update_discord_presence,
            clear_discord_presence,
            get_playlists,
            create_playlist,
            delete_playlist,
            add_to_playlist,
            remove_from_playlist,
            get_playlist_tracks,
            add_track_to_library,
            delete_track,
            log_playback_start,
            log_playback_end,
            youtube::search_youtube,
            youtube::download_track,
            youtube::get_aideo_recommendations,
            youtube::check_and_download_ytdlp,
            youtube::get_youtube_autoplay_recommendations,
            youtube::get_personalized_discovery_hub,
            tidal::tidal_login_start,
            tidal::tidal_login_poll_status,
            tidal::tidal_search,
            tidal::tidal_download,
            tidal::tidal_logout,
            tidal::tidal_get_stream_url,
            tidal::tidal_save_credentials,
            tidal::tidal_get_credentials,
            tidal::get_tidal_autoplay_recommendations,
            updater::check_update,
            updater::download_and_install,
            toggle_keep_awake,
            add_to_queue_bulk,
            listenbrainz_scrobble,
            dependencies::get_dependencies_status,
            dependencies::install_dependency,
            dependencies::uninstall_dependency,
            cloud::subsonic_ping,
            cloud::save_subsonic_password,
            cloud::get_subsonic_password,
            cloud::subsonic_search,
            cloud::subsonic_get_library,
            cloud::jellyfin_ping,
            cloud::jellyfin_search,
            cloud::jellyfin_get_library,
            cloud::cache_cloud_track,
            cloud::get_all_cached_cloud_hashes,
            cloud::get_url_hash,
        ])
        .setup(|app| {
            let tidal_state = std::sync::Arc::new(tidal::TidalState {
                session: std::sync::Mutex::new(None),
                logged_in: std::sync::Mutex::new(false),
            });
            if let Some(sess) = tidal::TidalState::load_cached_session(&app.handle()) {
                *tidal_state.session.lock().unwrap() = Some(sess);
                *tidal_state.logged_in.lock().unwrap() = true;
            }
            app.manage(tidal_state);

            discord::init_discord();
            
            // Clean up old decrypted cached temporary files
            if let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
                            if filename.starts_with("aideo_cache_") {
                                let _ = std::fs::remove_file(path);
                            }
                        }
                    }
                }
            }

            let app_data = app.path().app_data_dir().unwrap();
            let db_path = app_data.join("aideo.db");
            if let Some(parent) = db_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let db_path_str = db_path.to_str().unwrap();
            let conn = match db::init_db(db_path_str) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[system] SQLite initialization failed ({}). Falling back to safe in-memory database configuration.", e);
                    db::init_db(":memory:").expect("Failed to initialize in-memory database fallback")
                }
            };

            #[cfg(target_os = "windows")]
            {
                match cpal::host_from_id(cpal::HostId::Asio) {
                    Ok(asio_host) => {
                        let devices = asio_host.output_devices().map(|ds| ds.count()).unwrap_or(0);
                        if devices > 0 {
                            println!("[system] ASIO host initialized successfully. Found {} devices.", devices);
                        } else {
                            println!("[system] ASIO host initialized but NO devices found.");
                        }
                    },
                    Err(e) => {
                        println!("[system] ASIO host FAILED: {}", e);
                    }
                }
            }

            let mut controls_opt = None;
            let hwnd = {
                let main_window = app.get_webview_window("main").expect("main window not found");
                #[cfg(target_os = "windows")]
                {
                    let raw = main_window.hwnd().expect("Failed to get HWND");
                    Some(raw.0 as *mut std::ffi::c_void)
                }
                #[cfg(not(target_os = "windows"))]
                { None }
            };

            let config = PlatformConfig {
                dbus_name: "aideo",
                display_name: "Aideo Music Player",
                hwnd,
            };

            if let Ok(mut controls) = MediaControls::new(config) {
                let app_handle = app.handle().clone();
                controls
                    .attach(move |event| match event {
                        MediaControlEvent::Play => { let _ = app_handle.emit("media-play", ()); }
                        MediaControlEvent::Pause => { let _ = app_handle.emit("media-pause", ()); }
                        MediaControlEvent::Toggle => { let _ = app_handle.emit("media-toggle", ()); }
                        MediaControlEvent::Next => { let _ = app_handle.emit("media-next", ()); }
                        MediaControlEvent::Previous => { let _ = app_handle.emit("media-prev", ()); }
                        _ => {}
                    })
                    .ok();
                controls_opt = Some(controls);
            }

            app.manage(AppState {
                player: Arc::new(Mutex::new(player::Player::new(app.handle().clone()))),
                db: Arc::new(Mutex::new(conn)),
                media_controls: Arc::new(Mutex::new(controls_opt)),
                cached_devices: Arc::new(Mutex::new(Vec::new())),
            });

            app.listen_any("deep-link", move |event| {
                println!("Got deep link: {:?}", event.payload());
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
