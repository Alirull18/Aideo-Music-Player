#![allow(
    clippy::too_many_arguments,
    clippy::needless_range_loop,
    clippy::manual_flatten,
    clippy::type_complexity,
    clippy::collapsible_if,
    clippy::collapsible_match,
    clippy::missing_const_for_thread_local
)]

use cpal::traits::{DeviceTrait, HostTrait};
use serde::{Deserialize, Serialize};
use souvlaki::{MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, PlatformConfig, MediaPosition};
use std::sync::{Arc, Mutex};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager, State, Listener};

mod artwork;
mod db;
mod lyrics;
mod player;
mod taskbar;
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
pub mod chromecast;
pub mod sonic_analyzer;
pub mod remote_server;

// ── Shared application state ──────────────────────────────────────────────────
// ── Safe Lock Utility ────────────────────────────────────────────────────────
pub fn safe_lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    match mutex.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            eprintln!("[system] Mutex poisoned! Recovering...");
            poisoned.into_inner()
        }
    }
}

static HTTP_CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();

pub(crate) fn get_http_client() -> &'static reqwest::Client {
    HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build()
            .unwrap_or_default()
    })
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
    pub duration: Option<f64>,
}

// ── Translation command ─────────────────────────────────────────────────────
#[tauri::command]
async fn translate_lyric_line(text: String) -> Result<(String, String), String> {
    let url = format!(
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&dt=rm&q={}",
        urlencoding::encode(&text)
    );
    let client = get_http_client();
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

#[tauri::command]
async fn open_oauth_window(app_handle: tauri::AppHandle, url: String, provider: String) -> Result<(), String> {
    let title = format!("Sign in with {}", if provider == "google" { "Google" } else { "GitHub" });
    
    if let Some(existing_win) = app_handle.get_webview_window("supabase-login") {
        let _ = existing_win.close();
    }

    let parsed_url = url.parse::<tauri::Url>().map_err(|e| e.to_string())?;
    
    let app_handle_clone = app_handle.clone();
    let _login_win = tauri::WebviewWindowBuilder::new(
        &app_handle,
        "supabase-login",
        tauri::WebviewUrl::External(parsed_url),
    )
    .title(title)
    .inner_size(500.0, 650.0)
    .resizable(true)
    .on_navigation(move |nav_url| {
        let nav_str = nav_url.to_string();
        let is_callback = nav_str.contains("localhost:1420") || nav_str.contains("alirull18.github.io");
        
        if is_callback && (nav_str.contains("access_token=") || nav_str.contains("code=")) {
            let _ = app_handle_clone.emit("oauth-callback-url", nav_str.clone());
            
            let app_handle_inner = app_handle_clone.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(350)).await;
                if let Some(w) = app_handle_inner.get_webview_window("supabase-login") {
                    let _ = w.close();
                }
            });
            return false; 
        }
        true
    })
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

// ── Online Search commands ──────────────────────────────────────────────────
#[tauri::command]
async fn search_lyrics_online(query: String) -> Result<Vec<SearchResult>, String> {
    let client = get_http_client();
    let encoded_query = urlencoding::encode(&query);

    let lrc_fut = async {
        let mut results = Vec::new();
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
                            duration: item["duration"].as_f64(),
                        });
                    }
                }
            }
        }
        results
    };

    let ne_fut = async {
        let mut results = Vec::new();
        let ne_url = format!(
            "https://music.163.com/api/search/get?s={}&type=1&limit=5",
            encoded_query
        );
        if let Ok(res) = client.get(&ne_url)
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
                            duration: item["duration"].as_f64().map(|ms| ms / 1000.0)
                                .or_else(|| item["dt"].as_f64().map(|ms| ms / 1000.0)),
                        });
                    }
                }
            }
        }
        results
    };

    let qq_fut = async {
        let mut results = Vec::new();
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
                            duration: item["interval"].as_f64()
                                .or_else(|| item["duration"].as_f64()),
                        });
                    }
                }
            }
        }
        results
    };

    let (lrc_res, ne_res, qq_res) = tokio::join!(lrc_fut, ne_fut, qq_fut);
    
    let mut results = Vec::new();
    results.extend(lrc_res);
    results.extend(ne_res);
    results.extend(qq_res);

    Ok(results)
}


#[tauri::command]
async fn get_netease_lrc(id: String) -> Result<String, String> {
    let client = get_http_client();
    let url = format!(
        "https://music.163.com/api/song/lyric?id={}&lv=1&kv=1&tv=-1&os=pc",
        id
    );
    let res = client.get(&url)
        .header("Referer", "https://music.163.com")
        .send().await.map_err(|e| e.to_string())?;
    let data = res
        .json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())?;
    let lrc = data["klyric"]["lyric"]
        .as_str()
        .or_else(|| data["lrc"]["lyric"].as_str())
        .ok_or("No lyric found")?
        .to_string();
    Ok(lrc)
}

#[tauri::command]
async fn get_qqmusic_lrc(mid: String) -> Result<String, String> {
    let client = get_http_client();
    let url = format!("https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid={}&format=json&nobase64=1", mid);
    let res = client
        .get(&url)
        .header("Referer", "https://y.qq.com/portal/player.html")
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

#[tauri::command]
async fn get_artist_profile(artist: String) -> Result<serde_json::Value, String> {
    let info = lastfm_api::get_artist_info(&artist).await?;
    let top_tracks = lastfm_api::get_artist_top_tracks(&artist).await?;
    
    Ok(serde_json::json!({
        "name": info.get("name"),
        "bio": info.get("bio").and_then(|b| b.get("summary")),
        "listeners": info.get("stats").and_then(|s| s.get("listeners")),
        "playcount": info.get("stats").and_then(|s| s.get("playcount")),
        "top_tracks": top_tracks,
    }))
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
    let client = get_http_client();
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
        player.status.load(Ordering::Relaxed) != 0
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
    let db_conn_arc = Arc::clone(&state.db);
    let app_handle_clone = app_handle.clone();
    
    tokio::task::spawn_blocking(move || {
        let mut all_scanned_tracks = Vec::new();
        for dir in &dirs {
            let tracks = scanner::scan_directory(dir, &app_handle_clone);
            all_scanned_tracks.extend(tracks);
        }

        let db_tracks = {
            let conn = safe_lock(&db_conn_arc);
            let mut stmt = conn.prepare("SELECT id, path FROM tracks").map_err(|e| e.to_string())?;
            let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
            let mut list = Vec::new();
            while let Some(row) = rows.next().map_err(|e| e.to_string())? {
                let id: i32 = row.get(0).map_err(|e| e.to_string())?;
                let path: String = row.get(1).map_err(|e| e.to_string())?;
                list.push((id, path));
            }
            list
        };

        let mut paths_to_delete = Vec::new();
        for (_, path) in &db_tracks {
            if !path.starts_with("http://") && !path.starts_with("https://") {
                if !std::path::Path::new(path).exists() {
                    paths_to_delete.push(path.clone());
                }
            }
        }

        let mut conn = safe_lock(&db_conn_arc);
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        
        let db_paths: std::collections::HashSet<String> = db_tracks.into_iter().map(|(_, p)| p).collect();
        
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
        
        for path in paths_to_delete {
            tx.execute("DELETE FROM tracks WHERE path = ?1", rusqlite::params![path]).map_err(|e| e.to_string())?;
        }
        
        tx.commit().map_err(|e| e.to_string())?;
        
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM tracks", [], |row| row.get(0)).unwrap_or(0);
        Ok(count as usize)
    }).await.map_err(|e| format!("Scanning task panicked: {}", e))?
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
                disliked: Some(0),
                cover_url: None,
                path_hash: None,
                bpm: None,
                energy: None,
                bass_ratio: None,
                treble_ratio: None,
            }
        }
    };
    
    let mut conn = safe_lock(&state.db);
    db::save_tracks(&mut conn, &mut [track]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn add_track(
    path: String,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<f64>,
    format: Option<String>,
    cover_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = safe_lock(&state.db);
    conn.execute(
        "INSERT OR IGNORE INTO tracks (path, title, artist, album, duration, format, loved, cover_url)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![path, title, artist, album, duration, format, 0, cover_url],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_cached_track(stream_url: String, state: State<'_, AppState>) -> Result<(), String> {
    let hash = format!("{:x}", md5::compute(stream_url.as_bytes()));
    let Some(data_dir) = dirs::data_dir() else {
        return Err("Failed to resolve data directory".to_string());
    };
    let cache_dir = data_dir.join("Aideo").join("CloudCache");
    let cache_path = cache_dir.join(format!("{}.cache", hash));
    let temp_path = cache_dir.join(format!("{}.tmp", hash));
    
    if cache_path.exists() {
        std::fs::remove_file(cache_path).map_err(|e| format!("Failed to delete cache file: {}", e))?;
    }
    if temp_path.exists() {
        let _ = std::fs::remove_file(temp_path);
    }

    // Only delete from DB if loved is 0 and disliked is 0
    let conn = safe_lock(&state.db);
    let (loved, disliked): (i32, i32) = conn.query_row(
        "SELECT COALESCE(loved, 0), COALESCE(disliked, 0) FROM tracks WHERE path = ?1",
        rusqlite::params![stream_url],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).unwrap_or((0, 0));
    if loved == 0 && disliked == 0 {
        let _ = db::delete_track(&conn, &stream_url);
    }
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
    
    // 1. Delete the main audio file (if local)
    if !path.starts_with("http://") && !path.starts_with("https://") {
        let audio_path = std::path::Path::new(&path);
        let _ = std::fs::remove_file(audio_path);

        // 2. Delete sidecar files (.jpg, .png next to the file)
        if let (Some(parent), Some(stem)) = (audio_path.parent(), audio_path.file_stem()) {
            if let Some(stem_str) = stem.to_str() {
                let jpg_path = parent.join(format!("{}.jpg", stem_str));
                let png_path = parent.join(format!("{}.png", stem_str));
                let _ = std::fs::remove_file(jpg_path);
                let _ = std::fs::remove_file(png_path);
            }
        }
    } else {
        // Delete Cloud Cache files if it's an online track
        let hash = format!("{:x}", md5::compute(path.as_bytes()));
        if let Some(data_dir) = dirs::data_dir() {
            let cache_dir = data_dir.join("Aideo").join("CloudCache");
            let cache_path = cache_dir.join(format!("{}.cache", hash));
            let temp_path = cache_dir.join(format!("{}.tmp", hash));
            let _ = std::fs::remove_file(cache_path);
            let _ = std::fs::remove_file(temp_path);
        }
    }

    // 3. Delete the lyric file (covers both local and remote)
    let lrc_path = lyrics::get_lrc_path(&path);
    let _ = std::fs::remove_file(lrc_path);

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
        let client = get_http_client();
        match client.get(&path)
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .send().await {
            Ok(res) => {
                if res.status().is_success() {
                    let content_type = res.headers()
                        .get(reqwest::header::CONTENT_TYPE)
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("image/jpeg")
                        .to_string();
                    if let Ok(bytes) = res.bytes().await {
                        use base64::Engine;
                        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
                        return Ok(Some(format!("data:{content_type};base64,{encoded}")));
                    }
                }
            }
            Err(e) => {
                eprintln!("[get_cover_art] Failed to fetch remote cover art: {}", e);
            }
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
    let client = get_http_client();
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
    let current = player.exclusive_mode.load(Ordering::Relaxed);
    let next_mode = !current;
    player.exclusive_mode.store(next_mode, Ordering::Relaxed);
    let _ = player.cmd_tx.send(PlayerCommand::RestartStream);
    Ok(next_mode)
}

#[tauri::command]
fn get_exclusive_mode(state: State<'_, AppState>) -> Result<bool, String> {
    let player = safe_lock(&state.player);
    Ok(player.exclusive_mode.load(Ordering::Relaxed))
}

#[tauri::command]
fn toggle_bit_perfect_mode(state: State<'_, AppState>) -> Result<bool, String> {
    let player = safe_lock(&state.player);
    let current = player.bit_perfect.load(Ordering::Relaxed);
    let next_mode = !current;
    player.bit_perfect.store(next_mode, Ordering::Relaxed);
    let _ = player.cmd_tx.send(PlayerCommand::RestartStream);
    Ok(next_mode)
}

#[tauri::command]
fn get_bit_perfect_mode(state: State<'_, AppState>) -> Result<bool, String> {
    let player = safe_lock(&state.player);
    Ok(player.bit_perfect.load(Ordering::Relaxed))
}

#[tauri::command]
fn get_network_telemetry() -> player::NetworkTelemetry {
    player::get_network_telemetry()
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
    let app_handle = player.app_handle.clone();
    let pos_f64 = f64::from_bits(player.position_secs.load(Ordering::Relaxed));
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

    #[cfg(target_os = "windows")]
    {
        if let Some(main_window) = app_handle.get_webview_window("main") {
            if let Ok(raw) = main_window.hwnd() {
                taskbar::update_taskbar_playback_state(raw.0, playing);
            }
        }
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
    genre: Option<String>,
    playback_source: Option<String>,
    state: State<'_, AppState>,
) -> Result<i64, String> {
    let conn = safe_lock(&state.db);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    
    conn.execute(
        "INSERT INTO playback_history (track_path, title, artist, album, duration, format, timestamp, duration_played, skipped, synced, genre, playback_source)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0.0, 0, 0, ?8, ?9)",
        rusqlite::params![path, title, artist, album, duration, format, now, genre, playback_source],
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

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PlaybackHistoryRow {
    pub id: i64,
    pub track_path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration: Option<f64>,
    pub format: Option<String>,
    pub timestamp: i64,
    pub duration_played: f64,
    pub skipped: i64,
    pub genre: Option<String>,
    pub playback_source: Option<String>,
}

#[tauri::command]
fn get_unsynced_history(state: State<'_, AppState>) -> Result<Vec<PlaybackHistoryRow>, String> {
    let conn = safe_lock(&state.db);
    let mut stmt = conn.prepare(
        "SELECT id, track_path, title, artist, album, duration, format, timestamp, duration_played, skipped, genre, playback_source 
         FROM playback_history 
         WHERE synced = 0"
    ).map_err(|e| e.to_string())?;
    
    let rows = stmt.query_map([], |row| {
        Ok(PlaybackHistoryRow {
            id: row.get(0)?,
            track_path: row.get(1)?,
            title: row.get(2)?,
            artist: row.get(3)?,
            album: row.get(4)?,
            duration: row.get(5)?,
            format: row.get(6)?,
            timestamp: row.get(7)?,
            duration_played: row.get(8)?,
            skipped: row.get(9)?,
            genre: row.get(10)?,
            playback_source: row.get(11)?,
        })
    }).map_err(|e| e.to_string())?;
    
    let mut results = Vec::new();
    for r in rows {
        if let Ok(row) = r {
            results.push(row);
        }
    }
    Ok(results)
}

#[tauri::command]
fn mark_history_synced(ids: Vec<i64>, state: State<'_, AppState>) -> Result<(), String> {
    let conn = safe_lock(&state.db);
    for id in ids {
        let _ = conn.execute(
            "UPDATE playback_history SET synced = 1 WHERE id = ?1",
            rusqlite::params![id],
        );
    }
    Ok(())
}

#[tauri::command]
fn play_track(path: String, start_pos: Option<f64>, state: State<'_, AppState>) -> Result<(), String> {
    let player = safe_lock(&state.player);
    player
        .cmd_tx
        .send(player::PlayerCommand::Play(path, start_pos.unwrap_or(0.0)))
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
    player::abort_background_downloads();
        
    // Unblock the player_loop instantly if it is stuck connecting to a stream
    if let Some(mut child) = safe_lock(&player.current_process).take() {
        let _ = child.kill();
        let _ = child.wait();
    }
        
    Ok(())
}

#[tauri::command]
fn set_volume(volume: f32, state: State<'_, AppState>) -> Result<(), String> {
    let player = safe_lock(&state.player);
    player.volume.store(volume.to_bits(), Ordering::Relaxed);
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
fn pre_resolve_youtube_url(url: String, app_handle: tauri::AppHandle) {
    player::pre_resolve_youtube_url(url, app_handle);
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
fn toggle_love_track(
    path: String,
    loved: bool,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<f64>,
    format: Option<String>,
    cover_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = safe_lock(&state.db);
    db::toggle_love_track(
        &conn,
        &path,
        loved,
        title.as_deref(),
        artist.as_deref(),
        album.as_deref(),
        duration,
        format.as_deref(),
        cover_url.as_deref(),
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn toggle_dislike_track(
    path: String,
    disliked: bool,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<f64>,
    format: Option<String>,
    cover_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let conn = safe_lock(&state.db);
    db::toggle_dislike_track(
        &conn,
        &path,
        disliked,
        title.as_deref(),
        artist.as_deref(),
        album.as_deref(),
        duration,
        format.as_deref(),
        cover_url.as_deref(),
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn reset_disliked_tracks(state: State<'_, AppState>) -> Result<(), String> {
    let conn = safe_lock(&state.db);
    db::reset_disliked_tracks(&conn).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_playback_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let player = safe_lock(&state.player);
    let is_asio = safe_lock(&player.target_device)
        .as_deref()
        .map(|d| d.starts_with("[ASIO]"))
        .unwrap_or(false);
        
    let status_u8 = player.status.load(Ordering::Relaxed);
    let status_enum = match status_u8 {
        1 => player::PlaybackStatus::Playing,
        2 => player::PlaybackStatus::Paused,
        _ => player::PlaybackStatus::Stopped,
    };
    
    let position_val = f64::from_bits(player.position_secs.load(Ordering::Relaxed));
    let volume_val = f32::from_bits(player.volume.load(Ordering::Relaxed));
    let telemetry = player::get_network_telemetry();
    
    Ok(serde_json::json!({
        "status": status_enum,
        "current_track": *safe_lock(&player.current_track),
        "position_secs": position_val,
        "volume": volume_val,
        "exclusive": player.exclusive_mode.load(Ordering::Relaxed),
        "bit_perfect": player.bit_perfect.load(Ordering::Relaxed),
        "dev_rate": player.current_dev_rate.load(Ordering::Relaxed),
        "dsp": *safe_lock(&player.dsp_state),
        "driver_type": if is_asio { "ASIO" } else { "WASAPI" },
        "file_rate": player.file_rate.load(Ordering::Relaxed),
        "file_ch": player.file_ch.load(Ordering::Relaxed),
        "file_format": *safe_lock(&player.file_format),
        "network_telemetry": telemetry,
    }))
}

#[tauri::command]
fn log_error(msg: String) {
    println!("[frontend-error] {}", msg);
}

#[tauri::command]
async fn acoustid_identify_track(state: State<'_, AppState>, path: String) -> Result<serde_json::Value, String> {
    let path_str = path.clone();
    let (fingerprint, duration, profile) = tokio::task::spawn_blocking(move || {
        crate::sonic_analyzer::analyze_audio_file(&path_str)
    }).await.map_err(|e| e.to_string())??;

    {
        let conn = safe_lock(&state.db);
        let _ = crate::db::update_track_sonic_profile(
            &conn,
            &path,
            profile.bpm,
            profile.energy,
            profile.bass_ratio,
            profile.treble_ratio,
        );
    }

    let client = crate::get_http_client();
    let client_key = "8Wa374EF"; 
    let duration_sec = duration.round() as u32;

    let url = format!(
        "https://api.acoustid.org/v2/lookup?client={}&meta=recordings+releasegroups+compress&duration={}&fingerprint={}",
        client_key,
        duration_sec,
        urlencoding::encode(&fingerprint)
    );

    let res = client.get(&url)
        .send()
        .await
        .map_err(|e| format!("Acoustid lookup network request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Acoustid API returned error status: {}", res.status()));
    }

    let body = res.text().await.map_err(|e| format!("Failed to read Acoustid response: {}", e))?;
    let json: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse Acoustid response JSON: {}", e))?;

    Ok(serde_json::json!({
        "acoustid": json,
        "profile": profile
    }))
}

#[tauri::command]
async fn get_similar_tracks(state: State<'_, AppState>, path: String) -> Result<Vec<crate::db::Track>, String> {
    let conn = safe_lock(&state.db);
    let all_tracks = crate::db::get_all_tracks(&conn).map_err(|e| e.to_string())?;
    
    let seed = all_tracks.iter().find(|t| t.path == path)
        .ok_or_else(|| "Seed track not found in database".to_string())?;
        
    let seed_bpm = seed.bpm.unwrap_or(120.0);
    let seed_energy = seed.energy.unwrap_or(0.5);
    let seed_bass = seed.bass_ratio.unwrap_or(0.33);
    let seed_treble = seed.treble_ratio.unwrap_or(0.33);
    
    let mut scored_tracks = Vec::new();
    
    for track in all_tracks {
        if track.path == path {
            continue;
        }
        
        let t_bpm = track.bpm.unwrap_or(120.0);
        let t_energy = track.energy.unwrap_or(0.5);
        let t_bass = track.bass_ratio.unwrap_or(0.33);
        let t_treble = track.treble_ratio.unwrap_or(0.33);
        
        let bpm_diff = (seed_bpm - t_bpm) / 60.0;
        let energy_diff = seed_energy - t_energy;
        let bass_diff = seed_bass - t_bass;
        let treble_diff = seed_treble - t_treble;
        
        let distance = (
            1.5 * bpm_diff * bpm_diff +
            1.0 * energy_diff * energy_diff +
            1.2 * bass_diff * bass_diff +
            0.8 * treble_diff * treble_diff
        ).sqrt();
        
        scored_tracks.push((track, distance));
    }
    
    scored_tracks.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    
    let result: Vec<crate::db::Track> = scored_tracks.into_iter()
        .take(15)
        .map(|(t, _)| t)
        .collect();
        
    Ok(result)
}

fn get_local_ip() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    let _ = socket.connect("8.8.8.8:80");
    socket.local_addr().ok().map(|addr| addr.ip().to_string())
}

#[tauri::command]
fn get_remote_connection_url() -> Result<String, String> {
    let port = crate::remote_server::ACTIVE_PORT.get().copied().ok_or_else(|| "Remote server not active".to_string())?;
    let ip = get_local_ip().unwrap_or_else(|| "127.0.0.1".to_string());
    let pin = crate::remote_server::get_or_init_pin();
    Ok(format!("http://{}:{}?pin={}", ip, port, pin))
}

#[tauri::command]
fn clear_application_cache() -> Result<(), String> {
    // 1. Delete Cloud Stream Cache
    if let Some(data_dir) = dirs::data_dir() {
        let cache_dir = data_dir.join("Aideo").join("CloudCache");
        if cache_dir.exists() {
            let _ = std::fs::remove_dir_all(&cache_dir);
        }
        
        // 2. Delete yt-dlp temporary cache
        let ytdlp_cache = data_dir.join("Aideo").join("cache");
        if ytdlp_cache.exists() {
            let _ = std::fs::remove_dir_all(&ytdlp_cache);
        }
    }

    // 3. Clear temporary decrypted cache files in temp_dir
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

    // 4. Clear in-memory YouTube URL cache
    player::clear_youtube_url_cache();

    Ok(())
}

#[tauri::command]
fn open_cache_folder() -> Result<(), String> {
    let data_dir = dirs::data_dir().ok_or("Could not locate AppData directory")?;
    let cache_dir = data_dir.join("Aideo").join("CloudCache");
    let _ = std::fs::create_dir_all(&cache_dir);
    
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("explorer")
            .arg(&cache_dir)
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn();
    }
    
    Ok(())
}

#[tauri::command]
fn check_files_exist(paths: Vec<String>) -> Vec<bool> {
    paths.into_iter().map(|p| std::path::Path::new(&p).exists()).collect()
}

#[tauri::command]
fn get_windows_accent_color() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::core::w;
        use windows::Win32::System::Registry::{
            HKEY_CURRENT_USER, RegCloseKey, RegOpenKeyExW, RegQueryValueExW, KEY_READ, HKEY,
        };

        unsafe {
            let mut hkey: HKEY = HKEY::default();
            let subkey = w!("Software\\Microsoft\\Windows\\DWM");
            let res = RegOpenKeyExW(
                HKEY_CURRENT_USER,
                subkey,
                0,
                KEY_READ,
                &mut hkey,
            );

            if res.is_err() {
                return Err("Failed to open registry key".to_string());
            }

            let mut value_data: u32 = 0;
            let mut data_size: u32 = std::mem::size_of::<u32>() as u32;

            let value_name = w!("ColorizationColor");
            let res = RegQueryValueExW(
                hkey,
                value_name,
                None,
                None,
                Some(&mut value_data as *mut u32 as *mut u8),
                Some(&mut data_size),
            );

            let _ = RegCloseKey(hkey);

            if res.is_err() {
                return Err("Failed to query registry value".to_string());
            }

            // The value_data is in ARGB format: 0xAARRGGBB
            let r = (value_data >> 16) & 0xFF;
            let g = (value_data >> 8) & 0xFF;
            let b = value_data & 0xFF;

            Ok(format!("#{:02x}{:02x}{:02x}", r, g, b))
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("Unsupported operating system".to_string())
    }
}

static KEEP_AWAKE_TX: std::sync::OnceLock<std::sync::mpsc::Sender<bool>> = std::sync::OnceLock::new();

#[tauri::command]
fn toggle_keep_awake(enable: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if let Some(tx) = KEEP_AWAKE_TX.get() {
            let _ = tx.send(enable);
        }
    }
    Ok(())
}

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
            open_oauth_window,
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
            get_network_telemetry,
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
            toggle_dislike_track,
            reset_disliked_tracks,
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
            get_artist_profile,
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
            add_track,
            delete_cached_track,
            delete_track,
            log_playback_start,
            log_playback_end,
            get_unsynced_history,
            mark_history_synced,
            youtube::search_youtube,
            youtube::get_search_suggestions,
            youtube::download_track,
            youtube::get_aideo_recommendations,
            youtube::check_and_download_ytdlp,
            youtube::get_youtube_autoplay_recommendations,
            youtube::get_personalized_discovery_hub,
            youtube::get_cached_discovery_hub,
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
            cloud::prune_cache_to_limit,
            cloud::get_all_cached_cloud_hashes,
            cloud::check_url_is_cached,
            cloud::get_url_hash,
            get_windows_accent_color,
            clear_application_cache,
            acoustid_identify_track,
            get_similar_tracks,
            get_remote_connection_url,
            open_cache_folder,
            check_files_exist,
            chromecast::chromecast_discover,
            chromecast::chromecast_connect,
            chromecast::chromecast_disconnect,
            chromecast::chromecast_play,
            chromecast::chromecast_control,
            chromecast::chromecast_get_status,
        ])
        .setup(|app| {
            #[cfg(target_os = "windows")]
            {
                let (tx, rx) = std::sync::mpsc::channel::<bool>();
                let _ = KEEP_AWAKE_TX.set(tx);
                std::thread::spawn(move || {
                    while let Ok(enable) = rx.recv() {
                        unsafe {
                            use windows::Win32::System::Power::{SetThreadExecutionState, ES_CONTINUOUS, ES_SYSTEM_REQUIRED, ES_DISPLAY_REQUIRED};
                            if enable {
                                let _ = SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED);
                                println!("[system] Persistent Keep Awake ENABLED");
                            } else {
                                let _ = SetThreadExecutionState(ES_CONTINUOUS);
                                println!("[system] Persistent Keep Awake DISABLED");
                            }
                        }
                    }
                });
            }

            let tidal_state = std::sync::Arc::new(tidal::TidalState {
                session: std::sync::Mutex::new(None),
                logged_in: std::sync::Mutex::new(false),
            });
            if let Some(sess) = tidal::TidalState::load_cached_session(app.handle()) {
                *safe_lock(&tidal_state.session) = Some(sess);
                *safe_lock(&tidal_state.logged_in) = true;
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

            let db_path = match app.path().app_data_dir() {
                Ok(dir) => dir.join("aideo.db"),
                Err(_) => {
                    eprintln!("[system] WARNING: Failed to resolve AppData directory. Falling back to current directory.");
                    std::env::current_dir()
                        .unwrap_or_else(|_| std::path::PathBuf::from("."))
                        .join("aideo.db")
                }
            };
            if let Some(parent) = db_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let db_path_lossy = db_path.to_string_lossy();
            let conn = match db::init_db(&db_path_lossy) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("[system] SQLite initialization failed ({}). Falling back to safe in-memory database configuration.", e);
                    db::init_db(":memory:").expect("Failed to initialize in-memory database fallback")
                }
            };

            // Spawn background task to heal cover art for YouTube/online tracks with high-res square thumbnails
            let app_handle_clone = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                use tauri::Manager;
                let state = app_handle_clone.state::<AppState>();
                let tracks_to_heal = {
                    let conn = crate::safe_lock(&state.db);
                    let mut stmt = match conn.prepare(
                        "SELECT path, title, artist 
                         FROM tracks 
                         WHERE (cover_url IS NULL OR cover_url LIKE '%ytimg.com%') 
                           AND (path LIKE 'http%' OR format = 'YouTube Direct')"
                    ) {
                        Ok(s) => s,
                        Err(_) => return,
                    };
                    let rows = stmt.query_map([], |row| {
                        let path: String = row.get(0)?;
                        let title: Option<String> = row.get(1)?;
                        let artist: Option<String> = row.get(2)?;
                        Ok((path, title, artist))
                    });
                    match rows {
                        Ok(r) => r.filter_map(|x| x.ok()).collect::<Vec<_>>(),
                        Err(_) => return,
                    }
                };

                if !tracks_to_heal.is_empty() {
                    println!("[system] Found {} online tracks with missing or low-res cover art. Healing in the background...", tracks_to_heal.len());
                    let api_key = crate::youtube::fetch_innertube_key().await;
                    let client = reqwest::Client::builder()
                        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
                        .connect_timeout(std::time::Duration::from_secs(10))
                        .timeout(std::time::Duration::from_secs(30))
                        .build()
                        .unwrap_or_default();

                    for (path, title_opt, artist_opt) in tracks_to_heal {
                        let title = title_opt.unwrap_or_default();
                        let artist = artist_opt.unwrap_or_default();
                        if title.is_empty() {
                            continue;
                        }
                        let query = format!("{} {}", title, artist);
                        if let Ok(results) = crate::youtube::search_youtube_internal(&client, &api_key, &query, false).await {
                            if let Some(matched_track) = results.first() {
                                if let Some(ref cover) = matched_track.cover_url {
                                    let conn = crate::safe_lock(&state.db);
                                    let _ = conn.execute(
                                        "UPDATE tracks SET cover_url = ?1 WHERE path = ?2",
                                        rusqlite::params![cover, path]
                                    );
                                    println!("[system] Successfully healed cover art for '{}' by '{}' with high-res square URL.", title, artist);
                                    
                                    // Proactively notify the frontend to reload the library so changes reflect immediately!
                                    let _ = app_handle_clone.emit("library-updated", ());
                                }
                            }
                        }
                        // Small sleep to avoid throttling
                        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                    }
                }
            });

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

                // Detect if Windows Audio Service is missing/disabled (common on Atlas OS)
                let has_audio_devices = cpal::default_host()
                    .output_devices()
                    .map(|mut d| d.next().is_some())
                    .unwrap_or(false);
                if !has_audio_devices {
                    eprintln!("[system] WARNING: No audio output devices detected! Windows Audio Service may be disabled.");
                    let _ = app.emit("ui-toast", serde_json::json!({
                        "message": "⚠️ No audio devices detected. If you're on Atlas OS or a debloated Windows, please enable the Windows Audio Service (AudioSrv) and restart.",
                        "type": "warning"
                    }));
                }
            }

            let mut controls_opt = None;
            let hwnd = {
                let main_window = app.get_webview_window("main").expect("main window not found");
                #[cfg(target_os = "windows")]
                {
                    let raw = main_window.hwnd().expect("Failed to get HWND");
                    Some(raw.0)
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

            let player_arc = Arc::new(Mutex::new(player::Player::new(app.handle().clone())));
            let db_arc = Arc::new(Mutex::new(conn));
            let media_controls_arc = Arc::new(Mutex::new(controls_opt));
            let cached_devices_arc = Arc::new(Mutex::new(Vec::new()));

            app.manage(AppState {
                player: player_arc.clone(),
                db: db_arc.clone(),
                media_controls: media_controls_arc.clone(),
                cached_devices: cached_devices_arc.clone(),
            });

            let app_state_clone = Arc::new(AppState {
                player: player_arc,
                db: db_arc,
                media_controls: media_controls_arc,
                cached_devices: cached_devices_arc,
            });

            let app_handle_for_server = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                crate::remote_server::start_remote_server(app_handle_for_server, app_state_clone).await;
            });

            #[cfg(target_os = "windows")]
            if let Some(hwnd_raw) = hwnd {
                taskbar::initialize_taskbar_buttons(hwnd_raw, app.handle().clone());
            }

            app.listen_any("deep-link", move |event| {
                println!("Got deep link: {:?}", event.payload());
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[allow(dead_code)]
fn test_chromaprint_api() {
    let mut fp = chromaprint::Fingerprinter::new(chromaprint::Algorithm::default());
    let _ = fp.start(44100, 2);
    let chunk: Vec<i16> = vec![0; 1024];
    let _ = fp.feed(&chunk);
    let _ = fp.finish();
    let _encoded: String = fp.encode();
}
