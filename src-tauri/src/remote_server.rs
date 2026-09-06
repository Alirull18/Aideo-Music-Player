use std::sync::Arc;
use std::net::SocketAddr;
use tokio::net::{TcpListener, TcpStream};
use tokio::io::AsyncWriteExt;
use futures::{StreamExt, SinkExt};
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use base64::Engine;

pub static ACTIVE_PORT: std::sync::OnceLock<u16> = std::sync::OnceLock::new();
pub static REMOTE_PIN: std::sync::OnceLock<String> = std::sync::OnceLock::new();

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ActiveRemoteMetadata {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: f64,
    pub cover_url: Option<String>,
}

pub static ACTIVE_METADATA: std::sync::RwLock<Option<ActiveRemoteMetadata>> = std::sync::RwLock::new(None);
pub static METADATA_VERSION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

pub fn set_active_metadata(title: &str, artist: &str, album: Option<&str>, duration: f64, cover_url: Option<&str>) {
    if let Ok(mut lock) = ACTIVE_METADATA.write() {
        *lock = Some(ActiveRemoteMetadata {
            title: title.to_string(),
            artist: artist.to_string(),
            album: album.unwrap_or("").to_string(),
            duration,
            cover_url: cover_url.map(|s| s.to_string()),
        });
        METADATA_VERSION.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    }
}

pub fn get_active_metadata() -> Option<ActiveRemoteMetadata> {
    ACTIVE_METADATA.read().ok().and_then(|lock| lock.clone())
}

/// Generates or retrieves a clean 6-digit PIN for simple mobile pairing.
pub fn get_or_init_pin() -> &'static str {
    REMOTE_PIN.get_or_init(|| {
        let pin_val: u32 = 100_000 + (rand::random::<u32>() % 900_000);
        pin_val.to_string()
    })
}

/// Constant-time string equality check to prevent timing attacks.
pub fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Robust local LAN IP resolver. Tests outbound routing against candidate targets
/// and ensures the returned address is valid, non-unspecified (not 0.0.0.0), and non-loopback.
pub fn get_local_ip() -> Option<String> {
    let probe_targets = [
        "8.8.8.8:80",
        "1.1.1.1:80",
        "192.168.0.1:80",
        "192.168.1.1:80",
        "10.0.0.1:80",
        "172.16.0.1:80",
    ];

    for target in probe_targets {
        if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
            if socket.connect(target).is_ok() {
                if let Ok(addr) = socket.local_addr() {
                    let ip = addr.ip();
                    if !ip.is_unspecified() && !ip.is_loopback() {
                        return Some(ip.to_string());
                    }
                }
            }
        }
    }
    None
}

pub fn extract_pin_from_query(query: &str) -> Option<&str> {
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        if let (Some(k), Some(v)) = (parts.next(), parts.next()) {
            if k == "pin" {
                return Some(v);
            }
        }
    }
    None
}

pub fn extract_pin_from_auth_header(header_val: &str) -> Option<&str> {
    let trimmed = header_val.trim();
    if let Some(token) = trimmed.strip_prefix("Bearer ") {
        return Some(token.trim());
    }
    if let Some(token) = trimmed.strip_prefix("bearer ") {
        return Some(token.trim());
    }
    None
}

pub fn extract_auth_header_from_raw_http(request_str: &str) -> Option<&str> {
    for line in request_str.lines() {
        let trimmed = line.trim();
        if let Some(val) = trimmed.strip_prefix("Authorization:")
            .or_else(|| trimmed.strip_prefix("authorization:")) {
            return Some(val.trim());
        }
    }
    None
}

pub fn parse_data_url(data_url: &str) -> Option<(&str, &str)> {
    if let Some(rest) = data_url.strip_prefix("data:") {
        if let Some((mime, b64_part)) = rest.split_once(";base64,") {
            return Some((mime, b64_part));
        }
    }
    None
}

pub async fn start_remote_server(app_handle: AppHandle, app_state: Arc<crate::AppState>) {
    // Ensure Token is initialized on startup
    let _ = get_or_init_pin();

    let bind_ip = [0, 0, 0, 0];

    let mut port = 38562;
    let listener = loop {
        let addr = SocketAddr::from((bind_ip, port));
        match TcpListener::bind(addr).await {
            Ok(l) => {
                println!("[Aideo Connect] Bound successfully to 0.0.0.0:{}", port);
                break l;
            }
            Err(_) => {
                println!("[Aideo Connect] Port {} in use, trying next...", port);
                port += 1;
                if port > 38580 {
                    eprintln!("[Aideo Connect] Failed to find an open port in range 38562-38580!");
                    return;
                }
            }
        }
    };

    let _ = ACTIVE_PORT.set(port);

    loop {
        match listener.accept().await {
            Ok((stream, addr)) => {
                let state_clone = app_state.clone();
                let handle_clone = app_handle.clone();
                tokio::spawn(async move {
                    handle_connection(stream, addr, handle_clone, state_clone).await;
                });
            }
            Err(e) => {
                eprintln!("[Aideo Connect] Connection accept error: {}", e);
            }
        }
    }
}

pub fn is_websocket_upgrade_request(request_str: &str) -> bool {
    let req_lower = request_str.to_ascii_lowercase();
    req_lower.contains("upgrade: websocket") || (req_lower.contains("upgrade:") && req_lower.contains("websocket"))
}

async fn handle_connection(stream: TcpStream, addr: SocketAddr, app_handle: AppHandle, state: Arc<crate::AppState>) {
    let mut buf = [0u8; 4096];
    let bytes_read = match stream.peek(&mut buf).await {
        Ok(n) => n,
        Err(_) => return,
    };
    
    let request_str = String::from_utf8_lossy(&buf[..bytes_read]);
    if is_websocket_upgrade_request(&request_str) {
        let mut pin_valid = false;
        #[allow(clippy::result_large_err)]
        let callback = |req: &tokio_tungstenite::tungstenite::handshake::server::Request, response: tokio_tungstenite::tungstenite::handshake::server::Response| {
            let expected_pin = get_or_init_pin();

            // 1. Check Authorization: Bearer <PIN> header
            let auth_header = req.headers().get("authorization")
                .or_else(|| req.headers().get("Authorization"))
                .and_then(|v| v.to_str().ok());

            if let Some(auth) = auth_header {
                if let Some(pin) = extract_pin_from_auth_header(auth) {
                    if constant_time_eq(pin, expected_pin) {
                        pin_valid = true;
                        return Ok(response);
                    }
                }
            }

            // 2. Fallback to query parameter ?pin=<PIN>
            let uri = req.uri();
            let query = uri.query().unwrap_or("");
            if let Some(pin) = extract_pin_from_query(query) {
                if constant_time_eq(pin, expected_pin) {
                    pin_valid = true;
                    return Ok(response);
                }
            }

            let err_response = tokio_tungstenite::tungstenite::http::Response::builder()
                .status(tokio_tungstenite::tungstenite::http::StatusCode::FORBIDDEN)
                .body(Some("Forbidden - Invalid or missing PIN".to_string()))
                .unwrap();
            Err(err_response)
        };

        let ws_stream = match tokio_tungstenite::accept_hdr_async(stream, callback).await {
            Ok(ws) => ws,
            Err(e) => {
                eprintln!("[Aideo Connect] WebSocket handshake rejected or failed: {}", e);
                return;
            }
        };
        
        if pin_valid {
            handle_websocket(ws_stream, addr, app_handle, state).await;
        }
    } else {
        handle_http(stream, &request_str, state).await;
    }
}

async fn handle_http(mut stream: TcpStream, request_str: &str, state: Arc<crate::AppState>) {
    let expected_pin = get_or_init_pin();

    // Parse HTTP request line
    let first_line = request_str.lines().next().unwrap_or("");
    let path_and_query = first_line.split_whitespace().nth(1).unwrap_or("/");
    let (path, query) = match path_and_query.split_once('?') {
        Some((p, q)) => (p, q),
        None => (path_and_query, ""),
    };

    // 1. Check Authorization header
    let pin_from_header = extract_auth_header_from_raw_http(request_str)
        .and_then(extract_pin_from_auth_header);

    // 2. Check query parameter ?pin=...
    let pin_from_query = extract_pin_from_query(query);

    let has_valid_pin = match (pin_from_header, pin_from_query) {
        (Some(pin), _) => constant_time_eq(pin, expected_pin),
        (None, Some(pin)) => constant_time_eq(pin, expected_pin),
        (None, None) => false,
    };

    // Route: /cover (Dedicated high-speed cached artwork endpoint)
    if path == "/cover" {
        if !has_valid_pin {
            let resp = "HTTP/1.1 403 FORBIDDEN\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\nForbidden - Invalid or missing PIN";
            let _ = stream.write_all(resp.as_bytes()).await;
            let _ = stream.flush().await;
            let _ = stream.shutdown().await;
            return;
        }

        // 1. Try active metadata cover URL (e.g. YouTube, Subsonic, or tagged track)
        let active_cover = get_active_metadata().and_then(|m| m.cover_url);
        if let Some(ref cover_url) = active_cover {
            if cover_url.starts_with("http://") || cover_url.starts_with("https://") {
                let resp = format!(
                    "HTTP/1.1 302 Found\r\nLocation: {}\r\nCache-Control: public, max-age=3600\r\nConnection: close\r\n\r\n",
                    cover_url
                );
                let _ = stream.write_all(resp.as_bytes()).await;
                let _ = stream.flush().await;
                let _ = stream.shutdown().await;
                return;
            } else if let Some((mime, b64)) = parse_data_url(cover_url) {
                if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(b64.trim()) {
                    let header = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nCache-Control: public, max-age=3600\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        mime,
                        bytes.len()
                    );
                    let _ = stream.write_all(header.as_bytes()).await;
                    let _ = stream.write_all(&bytes).await;
                    let _ = stream.flush().await;
                    let _ = stream.shutdown().await;
                    return;
                }
            }
        }

        // 2. Try current playing local audio file
        let track_path_opt = {
            let player = crate::safe_lock(&state.player);
            let track = crate::safe_lock(&player.current_track).clone();
            track
        };

        if let Some(ref track_path) = track_path_opt {
            if !track_path.starts_with("http") {
                if let Some(data_url) = crate::artwork::get_cover_art(track_path) {
                    if let Some((mime, b64)) = parse_data_url(&data_url) {
                        if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(b64.trim()) {
                            let header = format!(
                                "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nCache-Control: public, max-age=3600\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                                mime,
                                bytes.len()
                            );
                            let _ = stream.write_all(header.as_bytes()).await;
                            let _ = stream.write_all(&bytes).await;
                            let _ = stream.flush().await;
                            let _ = stream.shutdown().await;
                            return;
                        }
                    }
                }
            }

            // 3. Fallback: Query SQLite database for cover_url
            let db_cover_url: Option<String> = {
                let alt_path = if track_path.contains('\\') {
                    track_path.replace('\\', "/")
                } else {
                    track_path.replace('/', "\\")
                };
                let conn = crate::safe_lock(&state.db);
                let mut res = None;
                if let Ok(mut stmt) = conn.prepare("SELECT cover_url FROM tracks WHERE path = ?1 OR path = ?2 LIMIT 1") {
                    if let Ok(mut rows) = stmt.query(rusqlite::params![track_path, alt_path]) {
                        if let Ok(Some(row)) = rows.next() {
                            res = row.get::<_, Option<String>>(0).ok().flatten();
                        }
                    }
                }
                res
            };

            if let Some(c_url) = db_cover_url {
                if c_url.starts_with("http://") || c_url.starts_with("https://") {
                    let resp = format!(
                        "HTTP/1.1 302 Found\r\nLocation: {}\r\nCache-Control: public, max-age=3600\r\nConnection: close\r\n\r\n",
                        c_url
                    );
                    let _ = stream.write_all(resp.as_bytes()).await;
                    let _ = stream.flush().await;
                    let _ = stream.shutdown().await;
                    return;
                } else if let Some((mime, b64)) = parse_data_url(&c_url) {
                    if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(b64.trim()) {
                        let header = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nCache-Control: public, max-age=3600\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            mime,
                            bytes.len()
                        );
                        let _ = stream.write_all(header.as_bytes()).await;
                        let _ = stream.write_all(&bytes).await;
                        let _ = stream.flush().await;
                        let _ = stream.shutdown().await;
                        return;
                    }
                }
            }
        }

        // Fallback: 404 Not Found if track has no embedded/linked art
        let resp = "HTTP/1.1 404 NOT FOUND\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        let _ = stream.write_all(resp.as_bytes()).await;
        let _ = stream.flush().await;
        let _ = stream.shutdown().await;
        return;
    }

    // Route: Root / Index
    if path == "/" || path == "/index.html" {
        let (status_line, content) = if has_valid_pin {
            ("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n", get_remote_html())
        } else {
            // Render pairing PIN keypad when unauthenticated
            ("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n", get_pin_entry_html())
        };

        let response = format!(
            "{}Content-Length: {}\r\nConnection: close\r\n\r\n{}",
            status_line,
            content.len(),
            content
        );

        let _ = stream.write_all(response.as_bytes()).await;
        let _ = stream.flush().await;
        let _ = stream.shutdown().await;
        return;
    }

    // Route: 404 for unhandled paths (e.g. /favicon.ico)
    let resp = "HTTP/1.1 404 NOT FOUND\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
    let _ = stream.write_all(resp.as_bytes()).await;
    let _ = stream.flush().await;
    let _ = stream.shutdown().await;
}

async fn handle_websocket(
    ws_stream: tokio_tungstenite::WebSocketStream<TcpStream>,
    _addr: SocketAddr,
    app_handle: AppHandle,
    state: Arc<crate::AppState>,
) {
    let (mut ws_sender, mut ws_receiver) = ws_stream.split();
    let (tx_close, mut rx_close) = tokio::sync::oneshot::channel::<()>();
    let state_clone = state.clone();

    // Spawn task to push periodic playback updates to the remote client
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_millis(500));
        let mut last_track_path: Option<String> = None;
        let mut last_meta_version: u64 = 0;
        let mut cached_meta: Option<(String, String, String, f64, bool)> = None;
        let mut cached_lyrics: Option<Vec<crate::lyrics::LyricLine>> = None;
        let mut is_first_tick = true;

        loop {
            tokio::select! {
                _ = &mut rx_close => {
                    break;
                }
                _ = interval.tick() => {
                    let pin = get_or_init_pin();
                    let current_meta_version = METADATA_VERSION.load(std::sync::atomic::Ordering::Relaxed);
                    let (status_u8, position, volume, current_track_opt) = {
                        let player = crate::safe_lock(&state_clone.player);
                        let s = player.status.load(std::sync::atomic::Ordering::Relaxed);
                        let pos = f64::from_bits(player.position_secs.load(std::sync::atomic::Ordering::Relaxed));
                        let vol_bits = player.volume.load(std::sync::atomic::Ordering::Relaxed);
                        let vol = f32::from_bits(vol_bits);
                        let track = crate::safe_lock(&player.current_track).clone();
                        (s, pos, vol, track)
                    };

                    let is_playing = status_u8 == 1;

                    let path_changed = match (&last_track_path, &current_track_opt) {
                        (Some(last), Some(curr)) => last != curr,
                        (None, Some(_)) => true,
                        (Some(_), None) => true,
                        (None, None) => false,
                    };
                    let version_changed = current_meta_version != last_meta_version;

                    let track_changed = is_first_tick || path_changed || version_changed;

                    if track_changed {
                        last_meta_version = current_meta_version;
                        last_track_path = current_track_opt.clone();

                        let mut title = "Not Playing".to_string();
                        let mut artist = "".to_string();
                        let mut album = "".to_string();
                        let mut duration = 0.0;
                        let mut has_cover = false;

                        // 1. Check active metadata first (pushed from frontend)
                        if let Some(meta) = get_active_metadata() {
                            if !meta.title.trim().is_empty() && meta.title != "Not Playing" && meta.title != "Stopped" {
                                title = meta.title;
                                artist = meta.artist;
                                album = meta.album;
                                duration = meta.duration;
                                has_cover = meta.cover_url.is_some();
                            }
                        }

                        // 2. If title is still missing or default, inspect current track path
                        if let Some(ref track_path) = current_track_opt {
                            if title == "Not Playing" || title.trim().is_empty() {
                                let alt_path = if track_path.contains('\\') {
                                    track_path.replace('\\', "/")
                                } else {
                                    track_path.replace('/', "\\")
                                };

                                let conn = crate::safe_lock(&state_clone.db);
                                if let Ok(mut stmt) = conn.prepare(
                                    "SELECT title, artist, album, duration, cover_url FROM tracks WHERE path = ?1 OR path = ?2 LIMIT 1"
                                ) {
                                    if let Ok(mut rows) = stmt.query(rusqlite::params![track_path, alt_path]) {
                                        if let Ok(Some(row)) = rows.next() {
                                            if let Some(t) = row.get::<_, Option<String>>(0).ok().flatten() {
                                                if !t.trim().is_empty() { title = t; }
                                            }
                                            if let Some(a) = row.get::<_, Option<String>>(1).ok().flatten() {
                                                if !a.trim().is_empty() { artist = a; }
                                            }
                                            if let Some(alb) = row.get::<_, Option<String>>(2).ok().flatten() {
                                                album = alb;
                                            }
                                            if let Some(d) = row.get::<_, Option<f64>>(3).ok().flatten() {
                                                if d > 0.0 { duration = d; }
                                            }
                                            if row.get::<_, Option<String>>(4).ok().flatten().is_some() {
                                                has_cover = true;
                                            }
                                        }
                                    }
                                };
                            }

                            // 3. Fallback: file stem if title is still empty
                            if title == "Not Playing" || title.trim().is_empty() {
                                if let Some(stem) = std::path::Path::new(track_path).file_stem().and_then(|s| s.to_str()) {
                                    if !stem.trim().is_empty() && !stem.starts_with("http") {
                                        title = stem.to_string();
                                    }
                                }
                            }

                            // 4. Check local artwork presence
                            if !has_cover && !track_path.starts_with("http") {
                                has_cover = crate::artwork::get_cover_art(track_path).is_some();
                            }

                            cached_lyrics = Some(crate::lyrics::get_lyrics_for_track(track_path));
                        }

                        cached_meta = Some((title, artist, album, duration, has_cover));
                    }

                    let cover_url = format!("/cover?pin={}&v={}", pin, current_meta_version);

                    let payload = if track_changed {
                        is_first_tick = false;
                        let (title, artist, album, duration, has_cover) = cached_meta.clone().unwrap_or_else(|| {
                            ("Not Playing".to_string(), "".to_string(), "".to_string(), 0.0, false)
                        });
                        let empty_lyrics = Vec::new();
                        let lyrics_ref = cached_lyrics.as_ref().unwrap_or(&empty_lyrics);

                        // Broadcast full track metadata, lyrics, and cover endpoint ONLY on track change
                        serde_json::json!({
                            "type": "track_change",
                            "title": title,
                            "artist": artist,
                            "album": album,
                            "duration": duration,
                            "position": position,
                            "volume": volume,
                            "is_playing": is_playing,
                            "has_cover": has_cover,
                            "cover_url": if has_cover { Some(&cover_url) } else { None },
                            "lyrics": lyrics_ref,
                            "pin": pin,
                        })
                    } else {
                        // Lightweight telemetry tick with cover endpoint kept in sync
                        let (title, artist, album, duration, has_cover) = cached_meta.clone().unwrap_or_else(|| {
                            ("Not Playing".to_string(), "".to_string(), "".to_string(), 0.0, false)
                        });
                        serde_json::json!({
                            "type": "tick",
                            "title": title,
                            "artist": artist,
                            "album": album,
                            "duration": duration,
                            "position": position,
                            "volume": volume,
                            "is_playing": is_playing,
                            "has_cover": has_cover,
                            "cover_url": if has_cover { Some(&cover_url) } else { None },
                        })
                    };

                    if let Ok(msg_str) = serde_json::to_string(&payload) {
                        if ws_sender.send(tokio_tungstenite::tungstenite::Message::Text(msg_str.into())).await.is_err() {
                            break;
                        }
                    }
                }
            }
        }
    });

    // Listen for incoming commands from remote client
    while let Some(msg_res) = ws_receiver.next().await {
        let msg = match msg_res {
            Ok(m) => m,
            Err(_) => break,
        };
        
        if let tokio_tungstenite::tungstenite::Message::Text(txt) = msg {
            if let Ok(val) = serde_json::from_str::<Value>(&txt) {
                if let Some(action) = val.get("action").and_then(|a| a.as_str()) {
                    match action {
                        "play" => {
                            let _ = app_handle.emit("media-play", ());
                        }
                        "pause" => {
                            let _ = app_handle.emit("media-pause", ());
                        }
                        "next" => {
                            let _ = app_handle.emit("media-next", ());
                        }
                        "prev" => {
                            let _ = app_handle.emit("media-prev", ());
                        }
                        "seek" => {
                            if let Some(pos) = val.get("value").and_then(|v| v.as_f64()) {
                                let player = crate::safe_lock(&state.player);
                                let _ = player.cmd_tx.send(crate::player::PlayerCommand::Seek(pos));
                                let _ = app_handle.emit("media-seek", pos);
                            }
                        }
                        "volume" => {
                            if let Some(vol) = val.get("value").and_then(|v| v.as_f64()) {
                                if vol.is_finite() {
                                    let clamped = (vol as f32).clamp(0.0, 1.0);
                                    let player = crate::safe_lock(&state.player);
                                    player.volume.store(clamped.to_bits(), std::sync::atomic::Ordering::Relaxed);
                                    let _ = app_handle.emit("media-volume", clamped);
                                }
                            }
                        }
                        "shuffle" => {
                            let _ = app_handle.emit("media-shuffle", ());
                        }
                        "repeat" => {
                            let _ = app_handle.emit("media-repeat", ());
                        }
                        _ => {}
                    }
                }
            }
        }
    }
    
    let _ = tx_close.send(());
}

fn get_pin_entry_html() -> String {
    r###"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="theme-color" content="#09090e">
    <title>Aideo Connect — Pairing</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap" rel="stylesheet">
    <style>
        :root {
            --accent: #a855f7;
            --accent-glow: rgba(168, 85, 247, 0.45);
            --bg-dark: #09090e;
            --panel-bg: rgba(255, 255, 255, 0.04);
            --border: rgba(255, 255, 255, 0.1);
            --text-main: #f3f4f6;
            --text-dim: #9ca3af;
        }

        * {
            box-sizing: border-box;
            user-select: none;
            -webkit-user-select: none;
            margin: 0;
            padding: 0;
        }

        body {
            background-color: var(--bg-dark);
            color: var(--text-main);
            font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            position: relative;
            overflow: hidden;
        }

        body::before {
            content: '';
            position: absolute;
            width: 320px;
            height: 320px;
            border-radius: 50%;
            background: radial-gradient(circle, var(--accent-glow) 0%, transparent 70%);
            top: -60px;
            left: -60px;
            filter: blur(60px);
            opacity: 0.35;
            pointer-events: none;
        }

        .auth-card {
            width: 100%;
            max-width: 380px;
            background: rgba(18, 18, 30, 0.88);
            backdrop-filter: blur(32px);
            -webkit-backdrop-filter: blur(32px);
            border: 1px solid var(--border);
            border-radius: 28px;
            padding: 36px 28px;
            display: flex;
            flex-direction: column;
            align-items: center;
            box-shadow: 0 24px 64px rgba(0, 0, 0, 0.8);
            z-index: 10;
            text-align: center;
        }

        .brand-badge {
            width: 54px;
            height: 54px;
            border-radius: 16px;
            background: linear-gradient(135deg, #a855f7 0%, #ec4899 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 20px;
            box-shadow: 0 8px 24px var(--accent-glow);
        }

        .brand-badge svg {
            width: 28px;
            height: 28px;
            color: #fff;
        }

        h1 {
            font-size: 22px;
            font-weight: 800;
            margin-bottom: 8px;
            letter-spacing: -0.5px;
            background: linear-gradient(135deg, #fff 30%, #c084fc 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        p {
            font-size: 13px;
            color: var(--text-dim);
            line-height: 1.5;
            margin-bottom: 28px;
        }

        .input-group {
            width: 100%;
            margin-bottom: 20px;
        }

        .pin-input {
            width: 100%;
            padding: 14px 16px;
            background: rgba(0, 0, 0, 0.4);
            border: 1.5px solid var(--border);
            border-radius: 14px;
            font-size: 24px;
            font-weight: 700;
            letter-spacing: 12px;
            text-align: center;
            color: #fff;
            outline: none;
            transition: all 0.2s ease;
            font-family: inherit;
        }

        .pin-input:focus {
            border-color: var(--accent);
            box-shadow: 0 0 16px var(--accent-glow);
        }

        .btn-connect {
            width: 100%;
            padding: 14px;
            border: none;
            border-radius: 14px;
            background: linear-gradient(135deg, #a855f7 0%, #9333ea 100%);
            color: #fff;
            font-size: 14px;
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 4px 20px var(--accent-glow);
            transition: all 0.2s ease;
            font-family: inherit;
        }

        .btn-connect:active {
            transform: scale(0.97);
        }

        .hint {
            margin-top: 20px;
            font-size: 11px;
            color: rgba(255, 255, 255, 0.4);
        }
    </style>
</head>
<body>
    <div class="auth-card">
        <div class="brand-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
                <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
                <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
            </svg>
        </div>
        <h1>Aideo Connect</h1>
        <p>Enter the 6-digit PIN displayed on your Aideo desktop player to connect.</p>

        <form id="pin-form" class="input-group" onsubmit="handlePinSubmit(event)">
            <input 
                type="text" 
                id="pin-input" 
                class="pin-input" 
                maxlength="6" 
                placeholder="••••••" 
                inputmode="numeric" 
                pattern="[0-9]*" 
                autocomplete="one-time-code"
                autofocus
            />
            <button type="submit" class="btn-connect" style="margin-top: 16px;">Connect Player</button>
        </form>

        <div class="hint">Check Aideo Settings &rarr; System &rarr; Aideo Connect Remote for your PIN.</div>
    </div>

    <script>
        // Check if PIN was previously saved in localStorage
        const savedPin = localStorage.getItem('aideo_remote_pin');
        if (savedPin && savedPin.length >= 4) {
            window.location.search = '?pin=' + encodeURIComponent(savedPin);
        }

        function handlePinSubmit(e) {
            e.preventDefault();
            const val = document.getElementById('pin-input').value.trim();
            if (!val) return;
            localStorage.setItem('aideo_remote_pin', val);
            window.location.search = '?pin=' + encodeURIComponent(val);
        }
    </script>
</body>
</html>
"###
    .to_string()
}

fn get_remote_html() -> String {
    r###"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="theme-color" content="#09090e">
    <title>Aideo Connect Remote</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700;800&display=swap" rel="stylesheet">
    <style>
        :root {
            --accent: #a855f7;
            --accent-glow: rgba(168, 85, 247, 0.45);
            --bg-dark: #09090e;
            --panel-bg: rgba(255, 255, 255, 0.04);
            --border: rgba(255, 255, 255, 0.08);
            --text-main: #f3f4f6;
            --text-dim: #9ca3af;
        }

        * {
            box-sizing: border-box;
            user-select: none;
            -webkit-user-select: none;
            margin: 0;
            padding: 0;
            -webkit-tap-highlight-color: transparent;
        }

        body {
            background-color: var(--bg-dark);
            color: var(--text-main);
            font-family: 'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            min-height: 100vh;
            min-height: -webkit-fill-available;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            padding: 16px;
            position: relative;
        }

        /* Abstract ambient background glows */
        body::before, body::after {
            content: '';
            position: absolute;
            width: 340px;
            height: 340px;
            border-radius: 50%;
            background: radial-gradient(circle, var(--accent-glow) 0%, transparent 70%);
            z-index: 0;
            filter: blur(65px);
            opacity: 0.35;
            pointer-events: none;
        }

        body::before { top: -60px; left: -60px; }
        body::after { bottom: -60px; right: -60px; }

        .container {
            width: 100%;
            max-width: 420px;
            height: 92vh;
            max-height: 840px;
            background: rgba(15, 15, 26, 0.88);
            backdrop-filter: blur(32px);
            -webkit-backdrop-filter: blur(32px);
            border: 1px solid var(--border);
            border-radius: 30px;
            padding: 20px 24px;
            display: flex;
            flex-direction: column;
            box-shadow: 0 24px 64px rgba(0, 0, 0, 0.75);
            z-index: 10;
            overflow: hidden;
        }

        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 14px;
            flex-shrink: 0;
        }

        .logo-wrap {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .logo {
            font-weight: 800;
            font-size: 18px;
            background: linear-gradient(135deg, #fff 20%, #c084fc 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            letter-spacing: -0.3px;
        }

        .header-actions {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .status-badge {
            font-size: 10px;
            font-weight: 700;
            padding: 4px 10px;
            border-radius: 100px;
            background: rgba(239, 68, 68, 0.15);
            color: #ef4444;
            border: 1px solid rgba(239, 68, 68, 0.3);
            transition: all 0.3s ease;
        }

        .status-badge.connected {
            background: rgba(16, 185, 129, 0.15);
            color: #10b981;
            border: 1px solid rgba(16, 185, 129, 0.3);
        }

        /* Mode Switcher Tabs */
        .tab-bar {
            display: flex;
            background: rgba(0, 0, 0, 0.4);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 3px;
            margin-bottom: 16px;
            gap: 4px;
            flex-shrink: 0;
        }

        .tab-btn {
            flex: 1;
            padding: 8px 12px;
            border: none;
            border-radius: 9px;
            background: transparent;
            color: var(--text-dim);
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
            transition: all 0.2s ease;
            font-family: inherit;
        }

        .tab-btn.active {
            background: rgba(168, 85, 247, 0.22);
            color: #fff;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }

        .view-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            position: relative;
        }

        .tab-pane {
            display: none;
            flex: 1;
            flex-direction: column;
            overflow: hidden;
            width: 100%;
            height: 100%;
        }

        .tab-pane.active {
            display: flex;
        }

        /* Player View Elements */
        .album-art-container {
            width: 190px;
            height: 190px;
            margin: 0 auto 16px;
            border-radius: 20px;
            background: linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.01) 100%);
            border: 1px solid var(--border);
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            box-shadow: 0 16px 36px rgba(0, 0, 0, 0.6);
            overflow: hidden;
            flex-shrink: 0;
        }

        .album-art-img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            opacity: 0;
            transition: opacity 0.3s ease;
        }

        .album-art-img.loaded {
            opacity: 1;
        }

        .album-art-fallback {
            width: 60px;
            height: 60px;
            opacity: 0.3;
            color: #fff;
            position: absolute;
        }

        .track-info {
            text-align: center;
            margin-bottom: 16px;
            flex-shrink: 0;
        }

        .track-title {
            font-size: 18px;
            font-weight: 700;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            margin-bottom: 4px;
        }

        .track-artist {
            font-size: 13px;
            color: var(--text-dim);
            font-weight: 400;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .slider-container {
            margin-bottom: 18px;
            flex-shrink: 0;
        }

        .time-slider {
            width: 100%;
            -webkit-appearance: none;
            background: rgba(255,255,255,0.12);
            height: 6px;
            border-radius: 100px;
            outline: none;
            cursor: pointer;
            margin-bottom: 6px;
        }

        .time-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background: var(--accent);
            box-shadow: 0 0 10px var(--accent);
        }

        .time-labels {
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            color: var(--text-dim);
            font-weight: 600;
        }

        .controls {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 16px;
            margin-bottom: 20px;
            flex-shrink: 0;
        }

        .btn {
            background: transparent;
            border: none;
            color: var(--text-main);
            cursor: pointer;
            outline: none;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
        }

        .btn-side {
            opacity: 0.75;
            padding: 8px;
            border-radius: 12px;
        }

        .btn-side:active {
            opacity: 1;
            transform: scale(0.9);
        }

        .btn-side.active {
            color: var(--accent);
            opacity: 1;
            background: rgba(168, 85, 247, 0.15);
        }

        .btn-play {
            width: 62px;
            height: 62px;
            border-radius: 50%;
            background: linear-gradient(135deg, #a855f7 0%, #9333ea 100%);
            box-shadow: 0 6px 22px var(--accent-glow);
            color: #fff;
        }

        .btn-play:active {
            transform: scale(0.93);
        }

        .volume-container {
            display: flex;
            align-items: center;
            gap: 10px;
            background: var(--panel-bg);
            border: 1px solid var(--border);
            border-radius: 100px;
            padding: 8px 16px;
            flex-shrink: 0;
        }

        .volume-btn {
            background: transparent;
            border: none;
            color: var(--text-dim);
            cursor: pointer;
            display: flex;
            align-items: center;
        }

        .volume-slider {
            flex: 1;
            -webkit-appearance: none;
            background: rgba(255,255,255,0.12);
            height: 4px;
            border-radius: 100px;
            outline: none;
        }

        .volume-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: var(--text-main);
        }

        /* Lyrics View Elements */
        .lyrics-header {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 8px 12px;
            background: rgba(0,0,0,0.3);
            border: 1px solid var(--border);
            border-radius: 14px;
            margin-bottom: 12px;
            flex-shrink: 0;
        }

        .lyrics-thumb {
            width: 36px;
            height: 36px;
            border-radius: 8px;
            object-fit: cover;
            background: rgba(255,255,255,0.05);
        }

        .lyrics-meta {
            flex: 1;
            min-width: 0;
            text-align: left;
        }

        .lyrics-meta-title {
            font-size: 13px;
            font-weight: 700;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .lyrics-meta-artist {
            font-size: 11px;
            color: var(--text-dim);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .lyrics-scroll-box {
            flex: 1;
            overflow-y: auto;
            scroll-behavior: smooth;
            padding: 60px 8px;
            display: flex;
            flex-direction: column;
            gap: 16px;
            text-align: center;
            -webkit-mask-image: linear-gradient(to bottom, transparent, black 15%, black 85%, transparent);
            mask-image: linear-gradient(to bottom, transparent, black 15%, black 85%, transparent);
            position: relative;
        }

        .lyric-line {
            font-size: 16px;
            font-weight: 600;
            color: var(--text-dim);
            opacity: 0.4;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            cursor: pointer;
            padding: 8px 12px;
            border-radius: 12px;
            line-height: 1.4;
        }

        .lyric-line:active {
            background: rgba(255,255,255,0.06);
        }

        .lyric-line.active {
            color: #fff;
            opacity: 1;
            font-size: 20px;
            font-weight: 800;
            transform: scale(1.04);
            text-shadow: 0 0 20px var(--accent-glow);
        }

        .resume-sync-pill {
            position: absolute;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--accent);
            color: #fff;
            font-size: 11px;
            font-weight: 700;
            padding: 6px 14px;
            border-radius: 100px;
            border: none;
            box-shadow: 0 4px 16px var(--accent-glow);
            cursor: pointer;
            display: none;
            z-index: 20;
        }

        .no-lyrics {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100%;
            color: var(--text-dim);
            font-size: 14px;
            font-style: italic;
            gap: 12px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="logo-wrap">
                <span class="logo">Aideo Connect</span>
            </div>
            <div class="header-actions">
                <span id="status" class="status-badge">Connecting...</span>
            </div>
        </div>

        <div class="tab-bar">
            <button id="tab-player" class="tab-btn active" onclick="switchTab('player')">🎵 Now Playing</button>
            <button id="tab-lyrics" class="tab-btn" onclick="switchTab('lyrics')">📜 Live Lyrics</button>
        </div>

        <div class="view-content">
            <!-- Tab 1: Player View -->
            <div id="pane-player" class="tab-pane active">
                <div class="album-art-container">
                    <img id="album-art-img" class="album-art-img" alt="Artwork" />
                    <svg id="album-art-fallback" class="album-art-fallback" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M9 18V5l12-2v13" stroke-linecap="round" stroke-linejoin="round"/>
                        <circle cx="6" cy="18" r="3"/>
                        <circle cx="18" cy="16" r="3"/>
                    </svg>
                </div>

                <div class="track-info">
                    <div id="title" class="track-title">Not Playing</div>
                    <div id="artist" class="track-artist">Connecting to desktop player...</div>
                </div>

                <div class="slider-container">
                    <input type="range" id="time-slider" class="time-slider" min="0" max="100" value="0">
                    <div class="time-labels">
                        <span id="time-current">0:00</span>
                        <span id="time-total">0:00</span>
                    </div>
                </div>

                <div class="controls">
                    <!-- Shuffle -->
                    <button id="btn-shuffle" class="btn btn-side" title="Shuffle">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="16 3 21 3 21 8"></polyline>
                            <line x1="4" y1="20" x2="21" y2="3"></line>
                            <polyline points="21 16 21 21 16 21"></polyline>
                            <line x1="15" y1="15" x2="21" y2="21"></line>
                            <line x1="4" y1="4" x2="9" y2="9"></line>
                        </svg>
                    </button>

                    <!-- Previous -->
                    <button id="btn-prev" class="btn btn-side" title="Previous">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polygon points="19 20 9 12 19 4 19 20"/>
                            <line x1="5" y1="19" x2="5" y2="5"/>
                        </svg>
                    </button>

                    <!-- Play / Pause -->
                    <button id="btn-play" class="btn btn-play" title="Play/Pause">
                        <svg id="play-icon" width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="5 3 19 12 5 21 5 3"/>
                        </svg>
                    </button>

                    <!-- Next -->
                    <button id="btn-next" class="btn btn-side" title="Next">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polygon points="5 4 15 12 5 20 5 4"/>
                            <line x1="19" y1="5" x2="19" y2="19"/>
                        </svg>
                    </button>

                    <!-- Repeat -->
                    <button id="btn-repeat" class="btn btn-side" title="Repeat">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="17 1 21 5 17 9"></polyline>
                            <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
                            <polyline points="7 23 3 19 7 15"></polyline>
                            <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
                        </svg>
                    </button>
                </div>

                <div class="volume-container">
                    <button id="btn-mute" class="volume-btn" title="Mute">
                        <svg id="vol-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
                        </svg>
                    </button>
                    <input type="range" id="volume-slider" class="volume-slider" min="0" max="100" value="80">
                </div>
            </div>

            <!-- Tab 2: Lyrics View -->
            <div id="pane-lyrics" class="tab-pane">
                <div class="lyrics-header">
                    <img id="lyrics-thumb-img" class="lyrics-thumb" src="" style="display:none;" />
                    <div class="lyrics-meta">
                        <div id="lyrics-title" class="lyrics-meta-title">Not Playing</div>
                        <div id="lyrics-artist" class="lyrics-meta-artist">Aideo Companion</div>
                    </div>
                </div>

                <div id="lyrics-scroll-box" class="lyrics-scroll-box">
                    <div class="no-lyrics">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M9 18V5l12-2v13" stroke-linecap="round" stroke-linejoin="round"/>
                            <circle cx="6" cy="18" r="3"/>
                            <circle cx="18" cy="16" r="3"/>
                        </svg>
                        <span>No synchronized lyrics available</span>
                    </div>
                </div>

                <button id="btn-resume-sync" class="resume-sync-pill" onclick="resumeSync()">
                    Resume Sync &darr;
                </button>
            </div>
        </div>
    </div>

    <script>
        const statusBadge = document.getElementById('status');
        const titleEl = document.getElementById('title');
        const artistEl = document.getElementById('artist');
        const btnPlay = document.getElementById('btn-play');
        const playIcon = document.getElementById('play-icon');
        const btnPrev = document.getElementById('btn-prev');
        const btnNext = document.getElementById('btn-next');
        const btnShuffle = document.getElementById('btn-shuffle');
        const btnRepeat = document.getElementById('btn-repeat');
        const btnMute = document.getElementById('btn-mute');
        const timeSlider = document.getElementById('time-slider');
        const timeCurrent = document.getElementById('time-current');
        const timeTotal = document.getElementById('time-total');
        const volumeSlider = document.getElementById('volume-slider');
        const albumArtImg = document.getElementById('album-art-img');
        const albumArtFallback = document.getElementById('album-art-fallback');

        // Lyrics elements
        const lyricsScrollBox = document.getElementById('lyrics-scroll-box');
        const lyricsTitle = document.getElementById('lyrics-title');
        const lyricsArtist = document.getElementById('lyrics-artist');
        const lyricsThumbImg = document.getElementById('lyrics-thumb-img');
        const btnResumeSync = document.getElementById('btn-resume-sync');

        let ws;
        let isPlaying = false;
        let duration = 0;
        let userInteractingWithTime = false;
        let userInteractingWithVolume = false;
        let userIsScrollingLyrics = false;
        let lyricsScrollTimer = null;
        let currentLyrics = [];
        let activeLyricIdx = -1;
        let activeTabName = 'player';
        let currentCoverUrl = '';

        function switchTab(tab) {
            activeTabName = tab;
            document.getElementById('tab-player').className = tab === 'player' ? 'tab-btn active' : 'tab-btn';
            document.getElementById('tab-lyrics').className = tab === 'lyrics' ? 'tab-btn active' : 'tab-btn';
            document.getElementById('pane-player').className = tab === 'player' ? 'tab-pane active' : 'tab-pane';
            document.getElementById('pane-lyrics').className = tab === 'lyrics' ? 'tab-pane active' : 'tab-pane';

            if (tab === 'lyrics' && activeLyricIdx >= 0) {
                scrollToActiveLyric(activeLyricIdx);
            }
        }

        function formatTime(secs) {
            if (isNaN(secs) || secs < 0) return '0:00';
            const m = Math.floor(secs / 60);
            const s = Math.floor(secs % 60);
            return `${m}:${s.toString().padStart(2, '0')}`;
        }

        function renderLyrics(lyrics) {
            currentLyrics = lyrics || [];
            lyricsScrollBox.innerHTML = '';

            if (!currentLyrics.length) {
                lyricsScrollBox.innerHTML = `
                    <div class="no-lyrics">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M9 18V5l12-2v13" stroke-linecap="round" stroke-linejoin="round"/>
                            <circle cx="6" cy="18" r="3"/>
                            <circle cx="18" cy="16" r="3"/>
                        </svg>
                        <span>Instrumental or No Synced Lyrics</span>
                    </div>
                `;
                return;
            }

            currentLyrics.forEach((line, i) => {
                const lineDiv = document.createElement('div');
                lineDiv.className = 'lyric-line';
                lineDiv.dataset.idx = i;
                lineDiv.dataset.time = line.time_secs;
                lineDiv.textContent = line.text || '♪';
                lineDiv.onclick = () => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ action: 'seek', value: line.time_secs }));
                    }
                };
                lyricsScrollBox.appendChild(lineDiv);
            });
        }

        function updateActiveLyric(position) {
            if (!currentLyrics.length) return;
            let idx = -1;
            for (let i = 0; i < currentLyrics.length; i++) {
                if (currentLyrics[i].time_secs <= position) {
                    idx = i;
                } else {
                    break;
                }
            }

            if (idx !== activeLyricIdx) {
                activeLyricIdx = idx;
                const lines = lyricsScrollBox.querySelectorAll('.lyric-line');
                lines.forEach((l, i) => {
                    if (i === idx) {
                        l.classList.add('active');
                    } else {
                        l.classList.remove('active');
                    }
                });

                if (idx >= 0 && activeTabName === 'lyrics' && !userIsScrollingLyrics) {
                    scrollToActiveLyric(idx);
                }
            }
        }

        function scrollToActiveLyric(idx) {
            const el = lyricsScrollBox.querySelector(`[data-idx="${idx}"]`);
            if (el) {
                const targetTop = el.offsetTop - (lyricsScrollBox.clientHeight / 2) + (el.clientHeight / 2);
                lyricsScrollBox.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
            }
        }

        function resumeSync() {
            userIsScrollingLyrics = false;
            btnResumeSync.style.display = 'none';
            if (activeLyricIdx >= 0) {
                scrollToActiveLyric(activeLyricIdx);
            }
        }

        // Detect user manual scroll in lyrics tab
        lyricsScrollBox.addEventListener('touchstart', () => {
            userIsScrollingLyrics = true;
            btnResumeSync.style.display = 'block';
            clearTimeout(lyricsScrollTimer);
        }, { passive: true });

        lyricsScrollBox.addEventListener('wheel', () => {
            userIsScrollingLyrics = true;
            btnResumeSync.style.display = 'block';
            clearTimeout(lyricsScrollTimer);
            lyricsScrollTimer = setTimeout(() => {
                userIsScrollingLyrics = false;
                btnResumeSync.style.display = 'none';
            }, 5000);
        }, { passive: true });

        function updateCoverArt(url) {
            if (url && url !== currentCoverUrl) {
                currentCoverUrl = url;
                albumArtImg.onload = () => {
                    albumArtImg.classList.add('loaded');
                    albumArtFallback.style.display = 'none';
                };
                albumArtImg.onerror = () => {
                    albumArtImg.classList.remove('loaded');
                    albumArtFallback.style.display = 'block';
                };
                albumArtImg.src = url;
                lyricsThumbImg.src = url;
                lyricsThumbImg.style.display = 'block';
            } else if (!url) {
                currentCoverUrl = '';
                albumArtImg.src = '';
                albumArtImg.classList.remove('loaded');
                albumArtFallback.style.display = 'block';
                lyricsThumbImg.style.display = 'none';
            }
        }

        function connect() {
            // Retrieve PIN from URL query or localStorage
            const urlParams = new URLSearchParams(window.location.search);
            let pin = urlParams.get('pin');
            if (pin) {
                localStorage.setItem('aideo_remote_pin', pin);
            } else {
                pin = localStorage.getItem('aideo_remote_pin') || '';
            }

            const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const host = window.location.host;
            const wsUrl = `${proto}//${host}/?pin=${encodeURIComponent(pin)}`;
            
            statusBadge.textContent = 'Connecting...';
            statusBadge.className = 'status-badge';

            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                statusBadge.textContent = 'Connected';
                statusBadge.className = 'status-badge connected';
            };

            ws.onclose = () => {
                statusBadge.textContent = 'Offline';
                statusBadge.className = 'status-badge';
                setTimeout(connect, 2000);
            };

            ws.onerror = (e) => {
                console.error('[Aideo Connect] WebSocket Error', e);
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    // Track change or initial sync: full metadata & lyrics
                    if (data.type === 'track_change') {
                        titleEl.textContent = data.title || 'Not Playing';
                        artistEl.textContent = data.artist || (data.album ? data.album : 'Aideo Player');
                        lyricsTitle.textContent = data.title || 'Not Playing';
                        lyricsArtist.textContent = data.artist || 'Aideo Companion';

                        duration = data.duration || 0;
                        updateCoverArt(data.cover_url);
                        renderLyrics(data.lyrics);
                    } else {
                        // Regular tick: keep title, artist, and artwork dynamically updated
                        if (data.title && data.title !== 'Not Playing' && data.title !== titleEl.textContent) {
                            titleEl.textContent = data.title;
                            artistEl.textContent = data.artist || (data.album ? data.album : 'Aideo Player');
                            lyricsTitle.textContent = data.title;
                            lyricsArtist.textContent = data.artist || 'Aideo Companion';
                        }
                        if (data.cover_url && data.cover_url !== currentCoverUrl) {
                            updateCoverArt(data.cover_url);
                        }
                    }

                    // Shared state sync (runs every tick)
                    isPlaying = !!data.is_playing;
                    if (data.duration) duration = data.duration;

                    updateActiveLyric(data.position || 0);

                    // Play/Pause icon
                    if (isPlaying) {
                        playIcon.innerHTML = `<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>`;
                    } else {
                        playIcon.innerHTML = `<polygon points="5 3 19 12 5 21 5 3"></polygon>`;
                    }

                    // Time slider
                    timeTotal.textContent = formatTime(duration);
                    if (!userInteractingWithTime) {
                        timeSlider.max = duration || 100;
                        timeSlider.value = data.position || 0;
                        timeCurrent.textContent = formatTime(data.position);
                    }

                    // Volume slider (with drag protection)
                    if (!userInteractingWithVolume && data.volume !== undefined) {
                        volumeSlider.value = Math.round(data.volume * 100);
                    }
                } catch (err) {
                    console.error('[Aideo Connect] Parse error', err);
                }
            };
        }

        // Control button listeners
        btnPlay.addEventListener('click', () => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ action: isPlaying ? 'pause' : 'play' }));
            }
        });

        btnPrev.addEventListener('click', () => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ action: 'prev' }));
            }
        });

        btnNext.addEventListener('click', () => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ action: 'next' }));
            }
        });

        btnShuffle.addEventListener('click', () => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ action: 'shuffle' }));
            }
        });

        btnRepeat.addEventListener('click', () => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ action: 'repeat' }));
            }
        });

        btnMute.addEventListener('click', () => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                const cur = parseInt(volumeSlider.value);
                const next = cur > 0 ? 0 : 80;
                volumeSlider.value = next;
                ws.send(JSON.stringify({ action: 'volume', value: next / 100 }));
            }
        });

        // Time slider scrub handling
        let timeDragTimer = null;
        timeSlider.addEventListener('input', () => {
            userInteractingWithTime = true;
            clearTimeout(timeDragTimer);
            timeCurrent.textContent = formatTime(timeSlider.value);
        });

        timeSlider.addEventListener('change', () => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ action: 'seek', value: parseFloat(timeSlider.value) }));
            }
            timeDragTimer = setTimeout(() => {
                userInteractingWithTime = false;
            }, 400);
        });

        // Volume slider drag handling
        let volDragTimer = null;
        volumeSlider.addEventListener('input', () => {
            userInteractingWithVolume = true;
            clearTimeout(volDragTimer);
        });

        volumeSlider.addEventListener('change', () => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ action: 'volume', value: parseFloat(volumeSlider.value) / 100 }));
            }
            volDragTimer = setTimeout(() => {
                userInteractingWithVolume = false;
            }, 400);
        });

        connect();
    </script>
</body>
</html>
"###
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_pin_from_auth_header_valid_bearer() {
        assert_eq!(extract_pin_from_auth_header("Bearer test_pin_123"), Some("test_pin_123"));
        assert_eq!(extract_pin_from_auth_header("bearer abcdef456"), Some("abcdef456"));
        assert_eq!(extract_pin_from_auth_header("  Bearer   padded_pin  "), Some("padded_pin"));
    }

    #[test]
    fn test_extract_pin_from_auth_header_invalid() {
        assert_eq!(extract_pin_from_auth_header("Basic dXNlcjpwYXNz"), None);
        assert_eq!(extract_pin_from_auth_header("test_pin_only"), None);
        assert_eq!(extract_pin_from_auth_header(""), None);
    }

    #[test]
    fn test_extract_pin_from_query() {
        assert_eq!(extract_pin_from_query("pin=my_secret_pin"), Some("my_secret_pin"));
        assert_eq!(extract_pin_from_query("other=123&pin=my_secret_pin&foo=bar"), Some("my_secret_pin"));
        assert_eq!(extract_pin_from_query("other=123&foo=bar"), None);
        assert_eq!(extract_pin_from_query(""), None);
    }

    #[test]
    fn test_constant_time_eq() {
        assert!(constant_time_eq("secret123", "secret123"));
        assert!(!constant_time_eq("secret123", "secret124"));
        assert!(!constant_time_eq("secret", "secret123"));
    }

    #[test]
    fn test_extract_auth_header_from_raw_http() {
        let req = "GET / HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer my_token\r\n\r\n";
        assert_eq!(extract_auth_header_from_raw_http(req), Some("Bearer my_token"));
    }

    #[test]
    fn test_is_websocket_upgrade_request() {
        let standard_req = "GET / HTTP/1.1\r\nHost: localhost:38562\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n";
        assert!(is_websocket_upgrade_request(standard_req));

        let mixed_case_req = "GET / HTTP/1.1\r\nHost: localhost:38562\r\nUpgrade: WebSocket\r\nConnection: Upgrade\r\n\r\n";
        assert!(is_websocket_upgrade_request(mixed_case_req));

        let http_req = "GET /?pin=123 HTTP/1.1\r\nHost: localhost:38562\r\nAccept: text/html\r\n\r\n";
        assert!(!is_websocket_upgrade_request(http_req));
    }

    #[test]
    fn test_pin_is_six_digits() {
        let pin = get_or_init_pin();
        assert_eq!(pin.len(), 6);
        assert!(pin.chars().all(|c| c.is_ascii_digit()));
    }

    #[test]
    fn test_get_local_ip_never_returns_unspecified_or_loopback() {
        if let Some(ip) = get_local_ip() {
            assert_ne!(ip, "0.0.0.0");
            assert_ne!(ip, "127.0.0.1");
            assert!(!ip.starts_with("127."));
        }
    }

    #[test]
    fn test_set_and_get_active_metadata() {
        set_active_metadata("Supermassive Black Hole", "Muse", Some("Black Holes and Revelations"), 209.0, Some("https://example.com/cover.jpg"));
        let meta = get_active_metadata().expect("Active metadata should be present");
        assert_eq!(meta.title, "Supermassive Black Hole");
        assert_eq!(meta.artist, "Muse");
        assert_eq!(meta.album, "Black Holes and Revelations");
        assert_eq!(meta.duration, 209.0);
        assert_eq!(meta.cover_url, Some("https://example.com/cover.jpg".to_string()));
    }

    #[test]
    fn test_metadata_version_increments() {
        let v1 = METADATA_VERSION.load(std::sync::atomic::Ordering::SeqCst);
        set_active_metadata("Hysteria", "Muse", Some("Absolution"), 227.0, None);
        let v2 = METADATA_VERSION.load(std::sync::atomic::Ordering::SeqCst);
        assert!(v2 > v1);
    }

    #[test]
    fn test_parse_data_url() {
        let data_url = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
        let parsed = parse_data_url(data_url);
        assert_eq!(parsed, Some(("image/jpeg", "/9j/4AAQSkZJRg==")));

        assert_eq!(parse_data_url("http://example.com/art.jpg"), None);
        assert_eq!(parse_data_url("data:image/png"), None);
    }
}
