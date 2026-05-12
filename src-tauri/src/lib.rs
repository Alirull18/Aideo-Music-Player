use cpal::traits::{DeviceTrait, HostTrait};
use serde::{Deserialize, Serialize};
use souvlaki::{MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, PlatformConfig};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State};

mod artwork;
mod db;
mod lyrics;
mod player;
mod scanner;
mod lastfm;

// ── Shared application state ──────────────────────────────────────────────────
pub struct AppState {
    pub player: Arc<Mutex<player::Player>>,
    pub db: Arc<Mutex<rusqlite::Connection>>,
    pub media_controls: Arc<Mutex<Option<MediaControls>>>,
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

    let translation = data[0][0][0].as_str().unwrap_or("").to_string();
    let transliteration = data[0][1][3].as_str().unwrap_or("").to_string();

    Ok((translation, transliteration))
}

// ── Online Search commands ──────────────────────────────────────────────────
#[tauri::command]
async fn search_lyrics_online(artist: String, title: String) -> Result<Vec<SearchResult>, String> {
    let mut results = Vec::new();
    let client = reqwest::Client::new();
    let query = format!("{} {}", artist, title);
    let encoded_query = urlencoding::encode(&query);

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
    if let Ok(res) = client.get(&ne_url).send().await {
        if let Ok(data) = res.json::<serde_json::Value>().await {
            if let Some(songs) = data["result"]["songs"].as_array() {
                for item in songs {
                    results.push(SearchResult {
                        id: item["id"].to_string(),
                        title: item["name"].as_str().unwrap_or("").to_string(),
                        artist: item["artists"][0]["name"]
                            .as_str()
                            .unwrap_or("")
                            .to_string(),
                        source: "NetEase".to_string(),
                        synced: true,
                        content_id: Some(item["id"].to_string()),
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
                        artist: item["singer"][0]["name"].as_str().unwrap_or("").to_string(),
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
        "https://music.163.com/api/song/lyric?id={}&lv=1&kv=1&tv=1",
        id
    );
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
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
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let text = res.text().await.map_err(|e| e.to_string())?;
    let clean_json = if text.contains("MusicJsonCallback(") {
        text.replace("MusicJsonCallback(", "").replace(")", "")
    } else {
        text
    };

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

// ── FX Commands ────────────────────────────────────────────────────────────
#[tauri::command]
fn set_dsp_state(state: State<'_, AppState>, dsp: player::DSPState) -> Result<(), String> {
    let player = state
        .player
        .lock()
        .or_else(|e| Ok(e.into_inner()))
        .map_err(|e: String| e)?;
    let mut current = player.dsp_state.lock().unwrap();
    *current = dsp;
    Ok(())
}

#[tauri::command]
fn get_dsp_state(state: State<'_, AppState>) -> Result<player::DSPState, String> {
    let player = state
        .player
        .lock()
        .or_else(|e| Ok(e.into_inner()))
        .map_err(|e: String| e)?;
    let current = player.dsp_state.lock().unwrap();
    Ok(current.clone())
}

// ── Device Commands ────────────────────────────────────────────────────────
#[tauri::command]
fn get_audio_devices() -> Result<Vec<String>, String> {
    let host = cpal::default_host();
    let devices = host.output_devices().map_err(|e| e.to_string())?;
    #[allow(deprecated)]
    let names: Vec<String> = devices
        .map(|d| d.name().unwrap_or("Unknown".to_string()))
        .collect();
    Ok(names)
}

#[tauri::command]
fn set_audio_device(state: State<'_, AppState>, name: String) -> Result<(), String> {
    let player = state
        .player
        .lock()
        .or_else(|e| Ok(e.into_inner()))
        .map_err(|e: String| e)?;
    let mut target = player.target_device.lock().unwrap();
    *target = Some(name);
    Ok(())
}

// ── Scanner commands ──────────────────────────────────────────────────────────
#[tauri::command]
async fn scan_and_save(dirs: Vec<String>, state: State<'_, AppState>) -> Result<usize, String> {
    let mut all_tracks_to_save = Vec::new();
    let mut total_tracks = 0;

    for dir in dirs {
        let tracks = scanner::scan_directory(&dir);
        total_tracks += tracks.len();
        all_tracks_to_save.extend(tracks);
    }

    let conn = state
        .db
        .lock()
        .or_else(|e| Ok(e.into_inner()))
        .map_err(|e: String| e)?;
    let _ = conn.execute("DELETE FROM tracks", []);
    db::save_tracks(&conn, &mut all_tracks_to_save).map_err(|e| e.to_string())?;
    Ok(total_tracks)
}

#[tauri::command]
fn get_library(state: State<'_, AppState>) -> Result<Vec<db::Track>, String> {
    let conn = state
        .db
        .lock()
        .or_else(|e| Ok(e.into_inner()))
        .map_err(|e: String| e)?;
    db::get_all_tracks(&conn).map_err(|e| e.to_string())
}

// ── Metadata commands ─────────────────────────────────────────────────────────
#[tauri::command]
fn get_lyrics(path: String) -> Result<Vec<lyrics::LyricLine>, String> {
    Ok(lyrics::get_lyrics_for_track(&path))
}

#[tauri::command]
fn get_cover_art(path: String) -> Result<Option<String>, String> {
    Ok(artwork::get_cover_art(&path))
}

#[tauri::command]
fn save_lyrics_file(path: String, content: String) -> Result<(), String> {
    let lrc_path = std::path::Path::new(&path).with_extension("lrc");
    std::fs::write(lrc_path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn apply_online_cover(path: String, url: String) -> Result<(), String> {
    let client = reqwest::Client::new();
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;

    let audio_path = std::path::Path::new(&path);
    let stem = audio_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("cover");
    let parent = audio_path.parent().ok_or("Invalid path")?;
    let cover_path = parent.join(format!("{}.jpg", stem));

    std::fs::write(&cover_path, bytes).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Exclusive Mode commands ──────────────────────────────────────────────────
#[tauri::command]
fn toggle_exclusive_mode(state: State<'_, AppState>) -> Result<bool, String> {
    let player = state
        .player
        .lock()
        .or_else(|e| Ok(e.into_inner()))
        .map_err(|e: String| e)?;
    let mut mode = player.exclusive_mode.lock().unwrap();
    *mode = !*mode;
    let current_mode = *mode;
    Ok(current_mode)
}

#[tauri::command]
fn get_exclusive_mode(state: State<'_, AppState>) -> Result<bool, String> {
    let player = state
        .player
        .lock()
        .or_else(|e| Ok(e.into_inner()))
        .map_err(|e: String| e)?;
    let mode = *player.exclusive_mode.lock().unwrap();
    Ok(mode)
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
    if let Some(controls) = state.media_controls.lock().unwrap().as_mut() {
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
    if let Some(controls) = state.media_controls.lock().unwrap().as_mut() {
        controls
            .set_playback(if playing {
                MediaPlayback::Playing { progress: None }
            } else {
                MediaPlayback::Paused { progress: None }
            })
            .ok();
    }
    Ok(())
}

#[tauri::command]
fn play_track(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let player = state
        .player
        .lock()
        .or_else(|e| Ok(e.into_inner()))
        .map_err(|e: String| e)?;
    player
        .cmd_tx
        .send(player::PlayerCommand::Play(path, 0.0))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn queue_next(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let player = state.player.lock().or_else(|e| Ok(e.into_inner())).map_err(|e: String| e)?;
    player.cmd_tx.send(player::PlayerCommand::QueueNext(path)).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn pause_track(state: State<'_, AppState>) -> Result<(), String> {
    let player = state
        .player
        .lock()
        .or_else(|e| Ok(e.into_inner()))
        .map_err(|e: String| e)?;
    player
        .cmd_tx
        .send(player::PlayerCommand::Pause)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn resume_track(state: State<'_, AppState>) -> Result<(), String> {
    let player = state
        .player
        .lock()
        .or_else(|e| Ok(e.into_inner()))
        .map_err(|e: String| e)?;
    player
        .cmd_tx
        .send(player::PlayerCommand::Resume)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn stop_track(state: State<'_, AppState>) -> Result<(), String> {
    let player = state
        .player
        .lock()
        .or_else(|e| Ok(e.into_inner()))
        .map_err(|e: String| e)?;
    player
        .cmd_tx
        .send(player::PlayerCommand::Stop)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn set_volume(volume: f32, state: State<'_, AppState>) -> Result<(), String> {
    let player = state
        .player
        .lock()
        .or_else(|e| Ok(e.into_inner()))
        .map_err(|e: String| e)?;
    *player.volume.lock().unwrap() = volume;
    Ok(())
}

#[tauri::command]
fn seek_track(secs: f64, state: State<'_, AppState>) -> Result<(), String> {
    let player = state
        .player
        .lock()
        .or_else(|e| Ok(e.into_inner()))
        .map_err(|e: String| e)?;
    player
        .cmd_tx
        .send(player::PlayerCommand::Seek(secs))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn update_track_offset(path: String, offset: i32, state: State<'_, AppState>) -> Result<(), String> {
    let conn = state.db.lock().unwrap();
    db::update_track_offset(&conn, &path, offset).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_playback_status(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let player = state
        .player
        .lock()
        .or_else(|e| Ok(e.into_inner()))
        .map_err(|e: String| e)?;
    Ok(serde_json::json!({
        "status": *player.status.lock().unwrap(),
        "current_track": *player.current_track.lock().unwrap(),
        "position_secs": *player.position_secs.lock().unwrap(),
        "volume": *player.volume.lock().unwrap(),
        "exclusive": *player.exclusive_mode.lock().unwrap(),
    }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let db_path = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."))
                .join("library.db");
            if let Some(parent) = db_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let db_path_str = db_path.to_str().unwrap();
            let conn = db::init_db(db_path_str).map_err(|e| e.to_string())?;

            let mut controls_opt = None;

            // Get the real HWND from the Tauri window — required by souvlaki on Windows
            let hwnd = {
                let main_window = app.get_webview_window("main").expect("main window not found");
                #[cfg(target_os = "windows")]
                {
                    // Tauri 2 WebviewWindow has .hwnd() on Windows
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
                        MediaControlEvent::Play => {
                            let _ = app_handle.emit("media-play", ());
                        }
                        MediaControlEvent::Pause => {
                            let _ = app_handle.emit("media-pause", ());
                        }
                        MediaControlEvent::Toggle => {
                            let _ = app_handle.emit("media-toggle", ());
                        }
                        MediaControlEvent::Next => {
                            let _ = app_handle.emit("media-next", ());
                        }
                        MediaControlEvent::Previous => {
                            let _ = app_handle.emit("media-prev", ());
                        }
                        _ => {}
                    })
                    .ok();
                controls_opt = Some(controls);
            }

            app.manage(AppState {
                player: Arc::new(Mutex::new(player::Player::new(app.handle().clone()))),
                db: Arc::new(Mutex::new(conn)),
                media_controls: Arc::new(Mutex::new(controls_opt)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
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
            toggle_exclusive_mode,
            get_exclusive_mode,
            search_lyrics_online,
            get_netease_lrc,
            translate_lyric_line,
            get_qqmusic_lrc,
            set_dsp_state,
            get_dsp_state,
            get_audio_devices,
            set_audio_device,
            apply_online_cover,
            update_track_offset,
            lastfm_get_token,
            lastfm_get_session,
            lastfm_scrobble,
        ])
        .plugin(tauri_plugin_updater::Builder::new().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
