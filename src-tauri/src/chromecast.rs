use tauri::command;
use oxicast::{CastClient, CastApp, MediaInfo};
use std::time::Duration;
use tokio::sync::{Mutex, watch};
use tokio::net::TcpListener;
use tokio::io::{AsyncReadExt, AsyncWriteExt, AsyncSeekExt, SeekFrom};
use std::path::Path;
use lazy_static::lazy_static;

#[derive(serde::Serialize, Clone, Debug)]
pub struct DiscoveredDevice {
    pub name: String,
    pub ip: String,
    pub port: u16,
}

lazy_static! {
    static ref CAST_CLIENT: Mutex<Option<CastClient>> = Mutex::new(None);
    static ref LOCAL_SERVER_PORT: Mutex<Option<u16>> = Mutex::new(None);
    static ref LOCAL_SERVER_SHUTDOWN: Mutex<Option<watch::Sender<bool>>> = Mutex::new(None);
}

// Helper to determine the local machine's IP address by querying OS routing paths
fn get_local_ip() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    socket.local_addr().ok().map(|addr| addr.ip().to_string())
}

// Local HTTP server task to stream audio files to Chromecast devices
async fn run_http_server(listener: TcpListener, mut shutdown_rx: watch::Receiver<bool>) {
    loop {
        tokio::select! {
            accept_res = listener.accept() => {
                if let Ok((mut socket, addr)) = accept_res {
                    println!("[chromecast-http] Connection accepted from {}", addr);
                    tokio::spawn(async move {
                        let mut buf = [0u8; 4096];
                        let mut bytes_read = 0;
                        
                        // Read request headers
                        while bytes_read < buf.len() {
                            match socket.read(&mut buf[bytes_read..]).await {
                                Ok(0) => break,
                                Ok(n) => {
                                    bytes_read += n;
                                    let req_str = String::from_utf8_lossy(&buf[..bytes_read]);
                                    if req_str.contains("\r\n\r\n") || req_str.contains("\n\n") {
                                        break;
                                    }
                                }
                                Err(e) => {
                                    println!("[chromecast-http] Socket read error: {}", e);
                                    return;
                                }
                            }
                        }
                        
                        let request = String::from_utf8_lossy(&buf[..bytes_read]);
                        let lines: Vec<&str> = request.lines().collect();
                        if lines.is_empty() {
                            println!("[chromecast-http] Empty request received");
                            return;
                        }
                        
                        let first_line = lines[0];
                        println!("[chromecast-http] Request: {}", first_line);
                        let parts: Vec<&str> = first_line.split_whitespace().collect();
                        if parts.len() < 2 { return; }
                        
                        let method = parts[0];
                        let uri = parts[1];
                        
                        if (method == "GET" || method == "HEAD" || method == "OPTIONS") && uri.starts_with("/stream") {
                            if method == "OPTIONS" {
                                println!("[chromecast-http] Responding to CORS OPTIONS preflight request");
                                let headers = "HTTP/1.1 200 OK\r\n\
                                               Access-Control-Allow-Origin: *\r\n\
                                               Access-Control-Allow-Headers: *\r\n\
                                               Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n\
                                               Connection: close\r\n\r\n";
                                let _ = socket.write_all(headers.as_bytes()).await;
                                return;
                            }
                            
                            let mut filepath = None;
                            if let Some(pos) = uri.find("path=") {
                                let path_param = &uri[pos + 5..];
                                if let Ok(decoded) = urlencoding::decode(path_param) {
                                    filepath = Some(decoded.into_owned());
                                }
                            }
                            
                            let filepath = match filepath {
                                Some(p) => p,
                                None => {
                                    println!("[chromecast-http] 400 Bad Request: Missing path parameter");
                                    let _ = socket.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n").await;
                                    return;
                                }
                            };
                            
                            let file_path = Path::new(&filepath);
                            println!("[chromecast-http] Resolving file '{}', exists: {}", filepath, file_path.exists());
                            if !file_path.exists() {
                                println!("[chromecast-http] 404 Not Found: file does not exist");
                                let _ = socket.write_all(b"HTTP/1.1 404 Not Found\r\n\r\n").await;
                                return;
                            }
                            
                            let mut file = match tokio::fs::File::open(file_path).await {
                                Ok(f) => f,
                                Err(e) => {
                                    println!("[chromecast-http] 500 Internal Error: Failed to open file: {}", e);
                                    let _ = socket.write_all(b"HTTP/1.1 500 Internal Server Error\r\n\r\n").await;
                                    return;
                                }
                            };
                            
                            let file_size = match file.metadata().await {
                                Ok(m) => m.len(),
                                Err(_) => 0,
                            };
                            
                            // Parse Range header for seeking capability
                            let mut range_start = 0u64;
                            let mut is_partial = false;
                            
                            for line in &lines[1..] {
                                let line_lower = line.to_lowercase();
                                if line_lower.starts_with("range:") {
                                    println!("[chromecast-http] Range header found: {}", line);
                                    if let Some(pos) = line_lower.find("bytes=") {
                                        let range_val = &line_lower[pos + 6..];
                                        if let Some(hyphen_pos) = range_val.find('-') {
                                            let start_str = range_val[..hyphen_pos].trim();
                                            if let Ok(start) = start_str.parse::<u64>() {
                                                range_start = start;
                                                is_partial = true;
                                            }
                                        }
                                    }
                                }
                            }
                            
                            let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
                            let mime_type = match ext.as_str() {
                                "flac" => "audio/flac",
                                "m4a" => "audio/mp4",
                                "mp4" => "audio/mp4",
                                "wav" => "audio/wav",
                                "ogg" => "audio/ogg",
                                _ => "audio/mpeg",
                            };
                            
                            if is_partial && range_start < file_size {
                                println!("[chromecast-http] Serving Partial Content starting at {} bytes (MIME: {})", range_start, mime_type);
                                if file.seek(SeekFrom::Start(range_start)).await.is_err() {
                                    let _ = socket.write_all(b"HTTP/1.1 500 Internal Server Error\r\n\r\n").await;
                                    return;
                                }
                                
                                let content_length = file_size - range_start;
                                let headers = format!(
                                    "HTTP/1.1 206 Partial Content\r\n\
                                     Content-Type: {}\r\n\
                                     Content-Length: {}\r\n\
                                     Content-Range: bytes {}-{}/{}\r\n\
                                     Accept-Ranges: bytes\r\n\
                                     Access-Control-Allow-Origin: *\r\n\
                                     Access-Control-Allow-Headers: *\r\n\
                                     Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n\
                                     Connection: close\r\n\r\n",
                                    mime_type, content_length, range_start, file_size - 1, file_size
                                );
                                
                                if socket.write_all(headers.as_bytes()).await.is_err() { return; }
                                
                                if method == "GET" {
                                    let mut file_buf = vec![0u8; 64 * 1024];
                                    while let Ok(n) = file.read(&mut file_buf).await {
                                        if n == 0 { break; }
                                        if socket.write_all(&file_buf[..n]).await.is_err() { break; }
                                    }
                                }
                            } else {
                                println!("[chromecast-http] Serving full stream: {} bytes (MIME: {})", file_size, mime_type);
                                let headers = format!(
                                    "HTTP/1.1 200 OK\r\n\
                                     Content-Type: {}\r\n\
                                     Content-Length: {}\r\n\
                                     Accept-Ranges: bytes\r\n\
                                     Access-Control-Allow-Origin: *\r\n\
                                     Access-Control-Allow-Headers: *\r\n\
                                     Access-Control-Allow-Methods: GET, HEAD, OPTIONS\r\n\
                                     Connection: close\r\n\r\n",
                                    mime_type, file_size
                                );
                                
                                if socket.write_all(headers.as_bytes()).await.is_err() { return; }
                                
                                if method == "GET" {
                                    let mut file_buf = vec![0u8; 64 * 1024];
                                    while let Ok(n) = file.read(&mut file_buf).await {
                                        if n == 0 { break; }
                                        if socket.write_all(&file_buf[..n]).await.is_err() { break; }
                                    }
                                }
                            }
                        } else {
                            println!("[chromecast-http] URI mismatch (not GET/HEAD /stream): {}", uri);
                            let _ = socket.write_all(b"HTTP/1.1 404 Not Found\r\n\r\n").await;
                        }
                    });
                }
            }
            _ = shutdown_rx.changed() => {
                println!("[chromecast-http] Shutting down HTTP stream server");
                break;
            }
        }
    }
}

async fn start_local_server() -> Option<(u16, watch::Sender<bool>)> {
    let listener = TcpListener::bind("0.0.0.0:0").await.ok()?;
    let port = listener.local_addr().ok()?.port();
    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    
    tokio::spawn(async move {
        run_http_server(listener, shutdown_rx).await;
    });
    
    Some((port, shutdown_tx))
}

#[command]
pub async fn chromecast_discover() -> Result<Vec<DiscoveredDevice>, String> {
    println!("[chromecast] Scanning network for Google Cast devices...");
    let devices = oxicast::discovery::discover_devices(Duration::from_secs(3))
        .await
        .map_err(|e| format!("mDNS discovery failed: {}", e))?;
    
    let list = devices.into_iter().map(|d| DiscoveredDevice {
        name: d.name,
        ip: d.ip.to_string(),
        port: d.port,
    }).collect();
    
    Ok(list)
}

#[command]
pub async fn chromecast_connect(ip: String, port: u16) -> Result<(), String> {
    println!("[chromecast] Connecting to device at {}:{}...", ip, port);
    let client = CastClient::connect(&ip, port)
        .await
        .map_err(|e| format!("Failed to connect to Chromecast: {}", e))?;
    
    println!("[chromecast] Launching Default Media Receiver application...");
    client.launch_app(&CastApp::DefaultMediaReceiver)
        .await
        .map_err(|e| format!("Failed to launch Media Receiver: {}", e))?;
    
    let mut client_lock = CAST_CLIENT.lock().await;
    *client_lock = Some(client);
    
    // Start local server if not already running
    let mut port_lock = LOCAL_SERVER_PORT.lock().await;
    if port_lock.is_none() {
        if let Some((port, shutdown_tx)) = start_local_server().await {
            *port_lock = Some(port);
            let mut shutdown_lock = LOCAL_SERVER_SHUTDOWN.lock().await;
            *shutdown_lock = Some(shutdown_tx);
            println!("[chromecast] Local HTTP stream server started on port {}", port);
        }
    }
    
    Ok(())
}

#[command]
pub async fn chromecast_disconnect() -> Result<(), String> {
    println!("[chromecast] Disconnecting from Cast session...");
    
    let mut client_lock = CAST_CLIENT.lock().await;
    if let Some(ref mut client) = *client_lock {
        let _ = client.stop_media().await;
    }
    *client_lock = None;
    
    let mut shutdown_lock = LOCAL_SERVER_SHUTDOWN.lock().await;
    if let Some(tx) = shutdown_lock.take() {
        let _ = tx.send(true);
    }
    
    let mut port_lock = LOCAL_SERVER_PORT.lock().await;
    *port_lock = None;
    
    Ok(())
}

async fn resolve_remote_content_type(url: &str, fallback: &str) -> String {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build() {
            Ok(c) => c,
            Err(_) => return fallback.to_string(),
        };
    
    // Try HEAD first
    if let Ok(res) = client.head(url).send().await {
        if res.status().is_success() {
            if let Some(ct) = res.headers().get(reqwest::header::CONTENT_TYPE) {
                if let Ok(ct_str) = ct.to_str() {
                    let clean = ct_str.split(';').next().unwrap_or(ct_str).trim();
                    if !clean.is_empty() {
                        println!("[chromecast] Remote Content-Type resolved via HEAD: {}", clean);
                        return clean.to_string();
                    }
                }
            }
        }
    }
    
    // Fallback: Try GET with Range header (bytes=0-0) to get headers without downloading body
    if let Ok(res) = client.get(url).header("Range", "bytes=0-0").send().await {
        let status = res.status();
        if status.is_success() || status == reqwest::StatusCode::PARTIAL_CONTENT {
            if let Some(ct) = res.headers().get(reqwest::header::CONTENT_TYPE) {
                if let Ok(ct_str) = ct.to_str() {
                    let clean = ct_str.split(';').next().unwrap_or(ct_str).trim();
                    if !clean.is_empty() {
                        println!("[chromecast] Remote Content-Type resolved via GET (range): {}", clean);
                        return clean.to_string();
                    }
                }
            }
        }
    }
    
    println!("[chromecast] Remote Content-Type fallback: {}", fallback);
    fallback.to_string()
}

#[command]
pub async fn chromecast_play(
    path: String,
    title: String,
    artist: String,
    content_type: String,
    cover_url: Option<String>,
    duration: Option<f64>,
    start_time: Option<f64>,
) -> Result<(), String> {
    let mut client_lock = CAST_CLIENT.lock().await;
    let client = client_lock.as_mut().ok_or("No active Chromecast session")?;
    
    // If it's a YouTube link, resolve it to a direct audio stream URL using ytdlp
    let resolved_path = if path.contains("youtube.com") || path.contains("youtu.be") {
        println!("[chromecast] YouTube URL detected. Extracting direct audio stream...");
        crate::player::resolve_youtube_url(&path)
    } else {
        path.clone()
    };
    
    let is_remote = resolved_path.starts_with("http://") || resolved_path.starts_with("https://");
    
    let stream_url = if is_remote {
        resolved_path.clone()
    } else {
        let local_ip = get_local_ip().ok_or("Could not resolve local interface IP address")?;
        let port_lock = LOCAL_SERVER_PORT.lock().await;
        let port = port_lock.ok_or("Local stream server is not running")?;
        let encoded_path = urlencoding::encode(&resolved_path);
        format!("http://{}:{}/stream?path={}", local_ip, port, encoded_path)
    };
    
    // Resolve clean MIME type
    let resolved_mime = if is_remote {
        resolve_remote_content_type(&stream_url, &content_type).await
    } else {
        content_type.clone()
    };
    
    // Build metadata and images vector
    let mut images = Vec::new();
    if let Some(ref cover) = cover_url {
        if !cover.is_empty() {
            let img_url = if cover.starts_with("http://") || cover.starts_with("https://") {
                cover.clone()
            } else {
                let local_ip = get_local_ip().ok_or("Could not resolve local interface IP address")?;
                let port_lock = LOCAL_SERVER_PORT.lock().await;
                let port = port_lock.ok_or("Local stream server is not running")?;
                let encoded_path = urlencoding::encode(cover);
                format!("http://{}:{}/stream?path={}", local_ip, port, encoded_path)
            };
            images.push(oxicast::Image {
                url: img_url,
                width: None,
                height: None,
            });
        }
    }
    
    let metadata = oxicast::MediaMetadata::MusicTrack {
        title: Some(title.clone()),
        artist: Some(artist.clone()),
        album_name: None,
        composer: None,
        track_number: None,
        disc_number: None,
        images,
    };
    
    println!("[chromecast] Casting media to receiver: {} - {} (URL: {}, MIME: {})", title, artist, stream_url, resolved_mime);
    let mut media = MediaInfo::new(&stream_url, &resolved_mime)
        .metadata(metadata);
        
    if let Some(dur) = duration {
        if dur > 0.0 {
            media = media.duration(dur);
        }
    }
    
    let start_pos = start_time.unwrap_or(0.0);
    client.load_media(&media, true, start_pos)
        .await
        .map_err(|e| format!("Failed to load media on Chromecast: {}", e))?;
    
    Ok(())
}

#[command]
pub async fn chromecast_control(action: String, value: Option<f64>) -> Result<(), String> {
    let mut client_lock = CAST_CLIENT.lock().await;
    let client = client_lock.as_mut().ok_or("No active Chromecast session")?;
    
    match action.as_str() {
        "play" | "resume" => {
            client.play()
                .await
                .map_err(|e| format!("Play command failed: {}", e))?;
        }
        "pause" => {
            client.pause()
                .await
                .map_err(|e| format!("Pause command failed: {}", e))?;
        }
        "seek" => {
            if let Some(pos) = value {
                client.seek(pos)
                    .await
                    .map_err(|e| format!("Seek command failed: {}", e))?;
            } else {
                return Err("Seek position value missing".to_string());
            }
        }
        "stop" => {
            client.stop_media()
                .await
                .map_err(|e| format!("Stop command failed: {}", e))?;
        }
        _ => return Err(format!("Unknown control action: {}", action)),
    }
    
    Ok(())
}

#[command]
pub async fn chromecast_get_status() -> Result<serde_json::Value, String> {
    let mut client_lock = CAST_CLIENT.lock().await;
    let client = client_lock.as_mut().ok_or("No active Chromecast session")?;
    
    match client.media_status().await {
        Ok(Some(status)) => {
            let state_str = match status.player_state {
                oxicast::PlayerState::Playing => "Playing",
                oxicast::PlayerState::Paused => "Paused",
                oxicast::PlayerState::Buffering => "Playing", // keep UI in active playback mode during buffering
                oxicast::PlayerState::Idle => {
                    // Check if the stream finished naturally
                    if status.idle_reason == Some(oxicast::IdleReason::Finished) {
                        "Stopped"
                    } else {
                        "Stopped"
                    }
                }
                _ => "Stopped",
            };
            Ok(serde_json::json!({
                "status": state_str,
                "position_secs": status.current_time,
                "duration": status.duration.unwrap_or(0.0),
                "volume": status.volume.level,
            }))
        }
        Ok(None) => {
            Ok(serde_json::json!({
                "status": "Stopped",
                "position_secs": 0.0,
                "duration": 0.0,
                "volume": 1.0,
            }))
        }
        Err(e) => Err(format!("Failed to query media status: {}", e)),
    }
}
