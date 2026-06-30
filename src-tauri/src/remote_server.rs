use std::sync::Arc;
use std::net::SocketAddr;
use tokio::net::{TcpListener, TcpStream};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use futures::{StreamExt, SinkExt};
use serde_json::Value;
use tauri::{AppHandle, Emitter};

pub static ACTIVE_PORT: std::sync::OnceLock<u16> = std::sync::OnceLock::new();

pub async fn start_remote_server(app_handle: AppHandle, app_state: Arc<crate::AppState>) {
    let mut port = 38562;
    let listener = loop {
        let addr = SocketAddr::from(([0, 0, 0, 0], port));
        match TcpListener::bind(addr).await {
            Ok(l) => {
                println!("[Aideo Connect] Bound successfully to port {}", port);
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
        let ws_stream = match tokio_tungstenite::accept_async(stream).await {
            Ok(ws) => ws,
            Err(e) => {
                eprintln!("[Aideo Connect] WebSocket handshake failed: {}", e);
                return;
            }
        };
        handle_websocket(ws_stream, addr, app_handle, state).await;
    } else {
        handle_http(stream, request_str).await;
    }
}

async fn handle_http(mut stream: TcpStream, request: std::borrow::Cow<'_, str>) {
    let mut buffer = vec![0; 4096];
    let _ = stream.read(&mut buffer).await;

    let (status_line, content) = if request.starts_with("GET /") {
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
        let mut cached_cover_art: Option<String> = None;

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
                            let conn = crate::safe_lock(&state_clone.db);
                            if let Ok(tracks) = crate::db::get_all_tracks(&conn) {
                                if let Some(t) = tracks.iter().find(|tr| &tr.path == track_path) {
                                    title = t.title.clone().unwrap_or_else(|| "Unknown Title".to_string());
                                    artist = t.artist.clone().unwrap_or_else(|| "Unknown Artist".to_string());
                                    album = t.album.clone().unwrap_or_default();
                                    duration = t.duration.unwrap_or(0.0);
                                    
                                    if track_path.starts_with("http://") || track_path.starts_with("https://") {
                                        cover_art = t.cover_url.clone();
                                    }
                                }
                            }
                            
                            if cover_art.is_none() && !track_path.starts_with("http") {
                                let changed = match last_track_path {
                                    Some(ref last_path) => last_path != track_path,
                                    None => true,
                                };
                                if changed {
                                    last_track_path = Some(track_path.clone());
                                    cached_cover_art = crate::artwork::get_cover_art(track_path);
                                }
                                cover_art = cached_cover_art.clone();
                            }
                        } else {
                            last_track_path = None;
                            cached_cover_art = None;
                        }
                        
                        serde_json::json!({
                            "title": title,
                            "artist": artist,
                            "album": album,
                            "duration": duration,
                            "position": position,
                            "volume": volume,
                            "is_playing": is_playing,
                            "cover_art": cover_art,
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
                                let player = crate::safe_lock(&state.player);
                                player.volume.store((vol as f32).to_bits(), std::sync::atomic::Ordering::Relaxed);
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
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
    <style>
        :root {
            --accent: #a855f7;
            --accent-glow: rgba(168, 85, 247, 0.4);
            --bg-dark: #09090e;
            --panel-bg: rgba(255, 255, 255, 0.03);
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
            padding: 24px;
            position: relative;
        }

        /* Abstract ambient background glows */
        body::before, body::after {
            content: '';
            position: absolute;
            width: 300px;
            height: 300px;
            border-radius: 50%;
            background: radial-gradient(circle, var(--accent-glow) 0%, transparent 70%);
            z-index: 0;
            filter: blur(50px);
            opacity: 0.5;
            pointer-events: none;
        }

        body::before { top: -50px; left: -50px; }
        body::after { bottom: -50px; right: -50px; }

        .container {
            width: 100%;
            max-width: 400px;
            background: rgba(15, 15, 25, 0.7);
            backdrop-filter: blur(30px);
            -webkit-backdrop-filter: blur(30px);
            border: 1px solid var(--border);
            border-radius: 32px;
            padding: 32px;
            text-align: center;
            box-shadow: 0 24px 64px rgba(0,0,0,0.6);
            z-index: 10;
        }

        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 32px;
        }

        .logo {
            font-weight: 800;
            font-size: 20px;
            background: linear-gradient(135deg, #fff 0%, #a855f7 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .status-badge {
            font-size: 11px;
            font-weight: 600;
            padding: 6px 12px;
            border-radius: 100px;
            background: rgba(239, 68, 68, 0.1);
            color: #ef4444;
            border: 1px solid rgba(239, 68, 68, 0.2);
            transition: all 0.3s ease;
        }

        .status-badge.connected {
            background: rgba(16, 185, 129, 0.1);
            color: #10b981;
            border: 1px solid rgba(16, 185, 129, 0.2);
        }

        .album-art-container {
            width: 220px;
            height: 220px;
            margin: 0 auto 32px;
            border-radius: 24px;
            background: linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%);
            border: 1px solid var(--border);
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            box-shadow: 0 16px 32px rgba(0,0,0,0.4);
            overflow: hidden;
        }

        .album-art-fallback {
            width: 70px;
            height: 70px;
            opacity: 0.3;
            color: #fff;
        }

        .track-info {
            margin-bottom: 32px;
        }

        .track-title {
            font-size: 22px;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            margin-bottom: 6px;
        }

        .track-artist {
            font-size: 14px;
            color: var(--text-dim);
            font-weight: 400;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        /* Seek slider style */
        .slider-container {
            margin-bottom: 32px;
        }

        .time-slider {
            width: 100%;
            -webkit-appearance: none;
            background: rgba(255,255,255,0.1);
            height: 6px;
            border-radius: 100px;
            outline: none;
            cursor: pointer;
            margin-bottom: 8px;
        }

        .time-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background: var(--accent);
            box-shadow: 0 0 10px var(--accent);
            transition: transform 0.1s;
        }

        .time-labels {
            display: flex;
            justify-content: space-between;
            font-size: 12px;
            color: var(--text-dim);
        }

        /* Controls design */
        .controls {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 28px;
            margin-bottom: 32px;
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
            opacity: 0.6;
        }
        .btn-side:active {
            opacity: 1;
            transform: scale(0.85);
        }

        .btn-play {
            width: 72px;
            height: 72px;
            border-radius: 50%;
            background: var(--accent);
            box-shadow: 0 8px 24px var(--accent-glow);
            color: #fff;
        }

        .btn-play:active {
            transform: scale(0.92);
            box-shadow: 0 4px 12px var(--accent-glow);
        }

        /* Volume slider design */
        .volume-container {
            display: flex;
            align-items: center;
            gap: 12px;
            background: var(--panel-bg);
            border: 1px solid var(--border);
            border-radius: 100px;
            padding: 10px 18px;
        }

        .volume-icon {
            opacity: 0.6;
            width: 18px;
            height: 18px;
        }

        .volume-slider {
            flex: 1;
            -webkit-appearance: none;
            background: rgba(255,255,255,0.1);
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
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <span class="logo">Aideo Connect</span>
            <span id="status" class="status-badge">Offline</span>
        </div>

        <div class="album-art-container">
            <!-- Image element -->
            <img id="album-art-img" style="width: 100%; height: 100%; object-fit: cover; display: none;" />
            <!-- Glassmorphic music icon fallback -->
            <svg id="album-art-fallback" class="album-art-fallback" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M9 18V5l12-2v13" stroke-linecap="round" stroke-linejoin="round"/>
                <circle cx="6" cy="18" r="3"/>
                <circle cx="18" cy="16" r="3"/>
            </svg>
        </div>

        <div class="track-info">
            <div id="title" class="track-title">Not Playing</div>
            <div id="artist" class="track-artist">Connect to player to stream controls</div>
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
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="19 20 9 12 19 4 19 20"/>
                    <line x1="5" y1="19" x2="5" y2="5"/>
                </svg>
            </button>
            <button id="btn-play" class="btn btn-play">
                <svg id="play-icon" width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
            </button>
            <button id="btn-next" class="btn btn-side">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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

        let ws;
        let isPlaying = false;
        let duration = 0;
        let userInteractingWithTime = false;

        function formatTime(secs) {
            if (isNaN(secs) || secs < 0) return '0:00';
            const m = Math.floor(secs / 60);
            const s = Math.floor(secs % 60);
            return `${m}:${s.toString().padStart(2, '0')}`;
        }

        function connect() {
            const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const host = window.location.host;
            ws = new WebSocket(`${proto}//${host}`);

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
                isPlaying = data.is_playing;
                duration = data.duration;

                // Play/Pause icon sync
                if (isPlaying) {
                    playIcon.innerHTML = `<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>`;
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
                } else {
                    imgEl.src = '';
                    imgEl.style.display = 'none';
                    fallbackEl.style.display = 'block';
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
