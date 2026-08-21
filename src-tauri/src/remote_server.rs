use std::sync::Arc;
use std::net::SocketAddr;
use tokio::net::{TcpListener, TcpStream};
use tokio::io::AsyncWriteExt;
use futures::{StreamExt, SinkExt};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

pub static ACTIVE_PORT: std::sync::OnceLock<u16> = std::sync::OnceLock::new();
pub static REMOTE_PIN: std::sync::OnceLock<String> = std::sync::OnceLock::new();

pub fn get_or_init_pin() -> &'static str {
    REMOTE_PIN.get_or_init(|| {
        format!("{:032x}", rand::random::<u128>())
    })
}

fn constant_time_eq(a: &str, b: &str) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn extract_pin_from_query(query: &str) -> Option<&str> {
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

async fn handle_connection(stream: TcpStream, addr: SocketAddr, app_handle: AppHandle, state: Arc<crate::AppState>) {
    let mut buf = [0u8; 1024];
    let bytes_read = match stream.peek(&mut buf).await {
        Ok(n) => n,
        Err(_) => return,
    };
    
    let request_str = String::from_utf8_lossy(&buf[..bytes_read]);
    if request_str.contains("Upgrade: websocket") {
        let mut pin_valid = false;
        #[allow(clippy::result_large_err)]
        let callback = |req: &tokio_tungstenite::tungstenite::handshake::server::Request, response: tokio_tungstenite::tungstenite::handshake::server::Response| {
            let uri = req.uri();
            let query = uri.query().unwrap_or("");
            let expected_pin = get_or_init_pin();
            
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
        handle_http(stream, request_str).await;
    }
}

async fn handle_http(mut stream: TcpStream, request_str: std::borrow::Cow<'_, str>) {
    // Validate the PIN from the request line
    let expected_pin = get_or_init_pin();
    let first_line = request_str.lines().next().unwrap_or("");
    let path_and_query = first_line.split_whitespace().nth(1).unwrap_or("");
    let query_str = path_and_query.splitn(2, '?').nth(1).unwrap_or("");

    let has_valid_pin = extract_pin_from_query(query_str)
        .map(|pin| constant_time_eq(pin, expected_pin))
        .unwrap_or(false);

    let (status_line, content) = if !has_valid_pin {
        ("HTTP/1.1 403 FORBIDDEN\r\nContent-Type: text/html; charset=utf-8\r\n",
         "<!DOCTYPE html><html><head><title>403 Forbidden</title></head>\
         <body style=\"background-color:#09090e;color:#f3f4f6;font-family:sans-serif;text-align:center;padding:50px;\">\
         <h1>403 Forbidden</h1><p>Invalid or missing PIN. Please scan the QR code in Aideo Settings.</p>\
         </body></html>".to_string())
    } else if path_and_query.starts_with('/') {
        ("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n", get_remote_html())
    } else {
        ("HTTP/1.1 404 NOT FOUND\r\n", "Not Found".to_string())
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
        let mut cached_meta: Option<(String, String, String, f64, Option<String>)> = None;
        let mut cached_cover_art: Option<String> = None;
        let mut cached_lyrics: Option<Vec<crate::lyrics::LyricLine>> = None;

        loop {
            tokio::select! {
                _ = &mut rx_close => {
                    break;
                }
                _ = interval.tick() => {
                    let status = {
                        let player = crate::safe_lock(&state_clone.player);
                        let status_u8 = player.status.load(std::sync::atomic::Ordering::Relaxed);
                        let is_playing = status_u8 == 1;
                        let position = f64::from_bits(player.position_secs.load(std::sync::atomic::Ordering::Relaxed));
                        
                        let volume_bits = player.volume.load(std::sync::atomic::Ordering::Relaxed);
                        let volume = f32::from_bits(volume_bits);
                        
                        let mut title = "Stopped".to_string();
                        let mut artist = "".to_string();
                        let mut album = "".to_string();
                        let mut duration = 0.0;
                        let mut cover_art = None;
                        
                        let current_track_opt = crate::safe_lock(&player.current_track).clone();
                        if let Some(ref track_path) = current_track_opt {
                            let track_changed = match last_track_path {
                                Some(ref last_path) => last_path != track_path,
                                None => true,
                            };

                            if track_changed {
                                last_track_path = Some(track_path.clone());
                                let mut fetched_meta = ("Unknown Title".to_string(), "Unknown Artist".to_string(), "".to_string(), 0.0, None);
                                let conn = crate::safe_lock(&state_clone.db);
                                if let Ok(mut stmt) = conn.prepare("SELECT title, artist, album, duration, cover_url FROM tracks WHERE path = ?1 LIMIT 1") {
                                    if let Ok(mut rows) = stmt.query([track_path]) {
                                        if let Ok(Some(row)) = rows.next() {
                                            let t = row.get::<_, Option<String>>(0).ok().flatten().unwrap_or_else(|| "Unknown Title".to_string());
                                            let a = row.get::<_, Option<String>>(1).ok().flatten().unwrap_or_else(|| "Unknown Artist".to_string());
                                            let alb = row.get::<_, Option<String>>(2).ok().flatten().unwrap_or_default();
                                            let d = row.get::<_, Option<f64>>(3).ok().flatten().unwrap_or(0.0);
                                            let c_url = row.get::<_, Option<String>>(4).ok().flatten();
                                            fetched_meta = (t, a, alb, d, c_url);
                                        }
                                    }
                                }
                                cached_meta = Some(fetched_meta);

                                if !track_path.starts_with("http") {
                                    cached_cover_art = crate::artwork::get_cover_art(track_path);
                                } else {
                                    cached_cover_art = None;
                                }

                                // Load synchronized lyrics for the track
                                cached_lyrics = Some(crate::lyrics::get_lyrics_for_track(track_path));
                            }

                            if let Some((ref t, ref a, ref alb, d, ref c_url)) = cached_meta {
                                title = t.clone();
                                artist = a.clone();
                                album = alb.clone();
                                duration = d;
                                if track_path.starts_with("http://") || track_path.starts_with("https://") {
                                    cover_art = c_url.clone();
                                } else {
                                    cover_art = cached_cover_art.clone();
                                }
                            }
                        } else {
                            last_track_path = None;
                            cached_meta = None;
                            cached_cover_art = None;
                            cached_lyrics = None;
                        }
                        
                        let empty_lyrics: Vec<crate::lyrics::LyricLine> = Vec::new();
                        let lyrics_ref = cached_lyrics.as_ref().unwrap_or(&empty_lyrics);

                        serde_json::json!({
                            "title": title,
                            "artist": artist,
                            "album": album,
                            "duration": duration,
                            "position": position,
                            "volume": volume,
                            "is_playing": is_playing,
                            "cover_art": cover_art,
                            "lyrics": lyrics_ref,
                        })
                    };
                    
                    if let Ok(msg_str) = serde_json::to_string(&status) {
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
                        "volume" => {
                            if let Some(vol) = val.get("value").and_then(|v| v.as_f64()) {
                                if vol.is_finite() {
                                    let clamped = (vol as f32).clamp(0.0, 1.0);
                                    let player = crate::safe_lock(&state.player);
                                    player.volume.store(clamped.to_bits(), std::sync::atomic::Ordering::Relaxed);
                                }
                            }
                        }
                        "seek" => {
                            if let Some(pos) = val.get("value").and_then(|v| v.as_f64()) {
                                let player = crate::safe_lock(&state.player);
                                let _ = player.cmd_tx.send(crate::player::PlayerCommand::Seek(pos));
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }
    
    let _ = tx_close.send(());
}

fn get_remote_html() -> String {
    r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>Aideo Connect</title>
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
        }

        body {
            background-color: var(--bg-dark);
            color: var(--text-main);
            font-family: 'Outfit', sans-serif;
            min-height: 100vh;
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
            width: 320px;
            height: 320px;
            border-radius: 50%;
            background: radial-gradient(circle, var(--accent-glow) 0%, transparent 70%);
            z-index: 0;
            filter: blur(60px);
            opacity: 0.4;
            pointer-events: none;
        }

        body::before { top: -60px; left: -60px; }
        body::after { bottom: -60px; right: -60px; }

        .container {
            width: 100%;
            max-width: 420px;
            height: 90vh;
            max-height: 820px;
            background: rgba(15, 15, 25, 0.85);
            backdrop-filter: blur(32px);
            -webkit-backdrop-filter: blur(32px);
            border: 1px solid var(--border);
            border-radius: 28px;
            padding: 20px 24px;
            display: flex;
            flex-direction: column;
            box-shadow: 0 24px 64px rgba(0,0,0,0.7);
            z-index: 10;
            overflow: hidden;
        }

        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
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
            background: linear-gradient(135deg, #fff 0%, #a855f7 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
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

        /* Segmented Mode Switch */
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
            background: rgba(168, 85, 247, 0.2);
            color: #fff;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }

        /* Views */
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
            background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%);
            border: 1px solid var(--border);
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            box-shadow: 0 16px 32px rgba(0,0,0,0.5);
            overflow: hidden;
            flex-shrink: 0;
        }

        .album-art-fallback {
            width: 60px;
            height: 60px;
            opacity: 0.3;
            color: #fff;
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
            margin-bottom: 20px;
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
            gap: 24px;
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
            opacity: 0.7;
        }
        .btn-side:active {
            opacity: 1;
            transform: scale(0.88);
        }

        .btn-play {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            background: var(--accent);
            box-shadow: 0 6px 20px var(--accent-glow);
            color: #fff;
        }

        .btn-play:active {
            transform: scale(0.92);
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

        .volume-icon {
            opacity: 0.6;
            width: 16px;
            height: 16px;
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
            width: 10px;
            height: 10px;
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
        }

        .lyric-line {
            font-size: 16px;
            font-weight: 600;
            color: var(--text-dim);
            opacity: 0.45;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            cursor: pointer;
            padding: 8px 12px;
            border-radius: 12px;
            line-height: 1.4;
        }

        .lyric-line:active {
            background: rgba(255,255,255,0.05);
        }

        .lyric-line.active {
            color: #fff;
            opacity: 1;
            font-size: 20px;
            font-weight: 800;
            transform: scale(1.04);
            text-shadow: 0 0 20px var(--accent-glow);
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
            <span id="status" class="status-badge">Offline</span>
        </div>

        <div class="tab-bar">
            <button id="tab-player" class="tab-btn active" onclick="switchTab('player')">🎵 Now Playing</button>
            <button id="tab-lyrics" class="tab-btn" onclick="switchTab('lyrics')">📜 Live Lyrics</button>
        </div>

        <div class="view-content">
            <!-- Tab 1: Player View -->
            <div id="pane-player" class="tab-pane active">
                <div class="album-art-container">
                    <img id="album-art-img" style="width: 100%; height: 100%; object-fit: cover; display: none;" />
                    <svg id="album-art-fallback" class="album-art-fallback" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M9 18V5l12-2v13" stroke-linecap="round" stroke-linejoin="round"/>
                        <circle cx="6" cy="18" r="3"/>
                        <circle cx="18" cy="16" r="3"/>
                    </svg>
                </div>

                <div class="track-info">
                    <div id="title" class="track-title">Not Playing</div>
                    <div id="artist" class="track-artist">Connect to desktop player</div>
                </div>

                <div class="slider-container">
                    <input type="range" id="time-slider" class="time-slider" min="0" max="100" value="0">
                    <div class="time-labels">
                        <span id="time-current">0:00</span>
                        <span id="time-total">0:00</span>
                    </div>
                </div>

                <div class="controls">
                    <button id="btn-prev" class="btn btn-side">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polygon points="19 20 9 12 19 4 19 20"/>
                            <line x1="5" y1="19" x2="5" y2="5"/>
                        </svg>
                    </button>
                    <button id="btn-play" class="btn btn-play">
                        <svg id="play-icon" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                            <polygon points="5 3 19 12 5 21 5 3"/>
                        </svg>
                    </button>
                    <button id="btn-next" class="btn btn-side">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polygon points="5 4 15 12 5 20 5 4"/>
                            <line x1="19" y1="5" x2="19" y2="19"/>
                        </svg>
                    </button>
                </div>

                <div class="volume-container">
                    <svg class="volume-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/>
                    </svg>
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
        const timeSlider = document.getElementById('time-slider');
        const timeCurrent = document.getElementById('time-current');
        const timeTotal = document.getElementById('time-total');
        const volumeSlider = document.getElementById('volume-slider');

        // Lyrics elements
        const lyricsScrollBox = document.getElementById('lyrics-scroll-box');
        const lyricsTitle = document.getElementById('lyrics-title');
        const lyricsArtist = document.getElementById('lyrics-artist');
        const lyricsThumbImg = document.getElementById('lyrics-thumb-img');

        let ws;
        let isPlaying = false;
        let duration = 0;
        let userInteractingWithTime = false;
        let currentLyrics = [];
        let activeLyricIdx = -1;
        let activeTabName = 'player';

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
                        <span>Instrumental or No Lyrics Available</span>
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

                if (idx >= 0 && activeTabName === 'lyrics') {
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

        function connect() {
            const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const host = window.location.host;
            const search = window.location.search || '';
            const wsUrl = `${proto}//${host}/${search.startsWith('?') ? search : (search ? '?' + search : '')}`;
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
                console.error(e);
            };

            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                
                titleEl.textContent = data.title;
                artistEl.textContent = data.artist || (data.album ? data.album : 'Aideo Stream Client');
                lyricsTitle.textContent = data.title;
                lyricsArtist.textContent = data.artist || 'Aideo Companion';

                isPlaying = data.is_playing;
                duration = data.duration;

                // Sync lyrics if payload contains them and list changed
                if (data.lyrics && JSON.stringify(data.lyrics) !== JSON.stringify(currentLyrics)) {
                    renderLyrics(data.lyrics);
                }

                updateActiveLyric(data.position || 0);

                // Play/Pause icon sync
                if (isPlaying) {
                    playIcon.innerHTML = `<rect x="5" y="4" width="4" height="16"></rect><rect x="15" y="4" width="4" height="16"></rect>`;
                } else {
                    playIcon.innerHTML = `<polygon points="5 3 19 12 5 21 5 3"></polygon>`;
                }

                // Time slider sync
                timeTotal.textContent = formatTime(duration);
                if (!userInteractingWithTime) {
                    timeSlider.max = duration || 100;
                    timeSlider.value = data.position || 0;
                    timeCurrent.textContent = formatTime(data.position);
                }

                // Volume slider sync
                volumeSlider.value = Math.round(data.volume * 100);

                // Album art sync
                const imgEl = document.getElementById('album-art-img');
                const fallbackEl = document.getElementById('album-art-fallback');
                if (data.cover_art) {
                    imgEl.src = data.cover_art;
                    imgEl.style.display = 'block';
                    fallbackEl.style.display = 'none';
                    lyricsThumbImg.src = data.cover_art;
                    lyricsThumbImg.style.display = 'block';
                } else {
                    imgEl.src = '';
                    imgEl.style.display = 'none';
                    fallbackEl.style.display = 'block';
                    lyricsThumbImg.style.display = 'none';
                }
            };
        }

        btnPlay.addEventListener('click', () => {
            if (isPlaying) {
                ws.send(JSON.stringify({ action: 'pause' }));
            } else {
                ws.send(JSON.stringify({ action: 'play' }));
            }
        });

        btnPrev.addEventListener('click', () => {
            ws.send(JSON.stringify({ action: 'prev' }));
        });

        btnNext.addEventListener('click', () => {
            ws.send(JSON.stringify({ action: 'next' }));
        });

        timeSlider.addEventListener('input', () => {
            userInteractingWithTime = true;
            timeCurrent.textContent = formatTime(timeSlider.value);
        });

        timeSlider.addEventListener('change', () => {
            ws.send(JSON.stringify({ action: 'seek', value: parseFloat(timeSlider.value) }));
            userInteractingWithTime = false;
        });

        volumeSlider.addEventListener('change', () => {
            ws.send(JSON.stringify({ action: 'volume', value: parseFloat(volumeSlider.value) / 100 }));
        });

        connect();
    </script>
</body>
</html>
"#
    .to_string()
}
