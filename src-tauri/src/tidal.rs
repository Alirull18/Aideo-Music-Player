use serde::{Deserialize, Serialize};
use base64::Engine;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State, Manager};
use tokio::time::{sleep, Duration};

const BOLD: &str = "\x1b[1m";
const CYAN: &str = "\x1b[36m";
const GREEN: &str = "\x1b[32m";
const YELLOW: &str = "\x1b[33m";
const MAGENTA: &str = "\x1b[35m";
const RED: &str = "\x1b[31m";
const RESET: &str = "\x1b[0m";

// Default Fire TV Client credentials
const CLIENT_ID: &str = "4N3n6Q1x95LL5K7p";
const CLIENT_SECRET: &str = "oKOXfJW371cX6xaZ0PyhgGNBdNLlBZd4AKKYougMjik=";

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct TidalTrackResult {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: u32,
    pub cover_url: String,
    pub quality: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TidalSession {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: u64, // Unix timestamp in seconds
    pub country_code: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TidalCredentials {
    pub client_id: String,
    pub client_secret: String,
}

pub struct TidalState {
    pub session: Mutex<Option<TidalSession>>,
    pub logged_in: Mutex<bool>,
}

impl TidalState {
    // Load dynamic client credentials
    pub fn load_credentials(app_handle: &AppHandle) -> TidalCredentials {
        if let Ok(app_data) = app_handle.path().app_data_dir() {
            let cred_file = app_data.join("tidal_credentials.json");
            if cred_file.exists() {
                if let Ok(content) = std::fs::read_to_string(&cred_file) {
                    if let Ok(cred) = serde_json::from_str::<TidalCredentials>(&content) {
                        if !cred.client_id.trim().is_empty() && !cred.client_secret.trim().is_empty() {
                            return cred;
                        } else {
                            let _ = std::fs::remove_file(cred_file);
                        }
                    }
                }
            }
        }
        TidalCredentials {
            client_id: CLIENT_ID.to_string(),
            client_secret: CLIENT_SECRET.to_string(),
        }
    }

    pub fn save_credentials(app_handle: &AppHandle, client_id: &str, client_secret: &str) {
        if let Ok(app_data) = app_handle.path().app_data_dir() {
            let cred_file = app_data.join("tidal_credentials.json");
            let _ = std::fs::create_dir_all(&app_data);
            let cred = TidalCredentials {
                client_id: client_id.to_string(),
                client_secret: client_secret.to_string(),
            };
            if let Ok(content) = serde_json::to_string_pretty(&cred) {
                let _ = std::fs::write(cred_file, content);
            }
        }
    }

    // Check local session file on startup
    pub fn load_cached_session(app_handle: &AppHandle) -> Option<TidalSession> {
        let app_data = app_handle.path().app_data_dir().ok()?;
        let session_file = app_data.join("tidal_session.json");
        if session_file.exists() {
            if let Ok(content) = std::fs::read_to_string(session_file) {
                if let Ok(session) = serde_json::from_str::<TidalSession>(&content) {
                    println!("{BOLD}{GREEN}✔ [TIDAL ENGINE] Loaded cached OAuth session successfully!{RESET}");
                    return Some(session);
                }
            }
        }
        None
    }

    pub fn save_session(app_handle: &AppHandle, session: &TidalSession) {
        if let Ok(app_data) = app_handle.path().app_data_dir() {
            let session_file = app_data.join("tidal_session.json");
            let _ = std::fs::create_dir_all(&app_data);
            if let Ok(content) = serde_json::to_string_pretty(session) {
                let _ = std::fs::write(session_file, content);
            }
        }
    }

    pub fn clear_session(app_handle: &AppHandle) {
        if let Ok(app_data) = app_handle.path().app_data_dir() {
            let session_file = app_data.join("tidal_session.json");
            let _ = std::fs::remove_file(session_file);
        }
    }
}

#[tauri::command]
pub async fn tidal_save_credentials(
    app_handle: AppHandle,
    client_id: String,
    client_secret: String,
) -> Result<bool, String> {
    let id_trimmed = client_id.trim();
    let secret_trimmed = client_secret.trim();

    if id_trimmed.is_empty() || secret_trimmed.is_empty() {
        if let Ok(app_data) = app_handle.path().app_data_dir() {
            let cred_file = app_data.join("tidal_credentials.json");
            if cred_file.exists() {
                let _ = std::fs::remove_file(cred_file);
            }
        }
        println!("{BOLD}{YELLOW}⚠ [TIDAL ENGINE] Reset custom client credentials to default keys!{RESET}");
    } else {
        TidalState::save_credentials(&app_handle, id_trimmed, secret_trimmed);
        println!("{BOLD}{GREEN}✔ [TIDAL ENGINE] Updated custom client credentials successfully!{RESET}");
    }
    Ok(true)
}

#[tauri::command]
pub async fn tidal_get_credentials(
    app_handle: AppHandle,
) -> Result<TidalCredentials, String> {
    Ok(TidalState::load_credentials(&app_handle))
}

// Token refresher
fn get_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

async fn ensure_valid_token(app_handle: &AppHandle, state: &TidalState) -> Result<String, String> {
    let current_sess = state.session.lock().unwrap().clone();
    
    if let Some(mut sess) = current_sess {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        // If the token expires in less than 5 minutes, try to refresh it
        if sess.expires_at < now + 300 {
            println!("{BOLD}{YELLOW}[TIDAL ENGINE] Access token near expiration. Refreshing...{RESET}");
            
            let creds = TidalState::load_credentials(app_handle);
            let client = get_client();
            let body = [
                ("client_id", creds.client_id.as_str()),
                ("client_secret", creds.client_secret.as_str()),
                ("grant_type", "refresh_token"),
                ("refresh_token", sess.refresh_token.as_str()),
            ];

            match client.post("https://auth.tidal.com/v1/oauth2/token")
                .form(&body)
                .send()
                .await 
            {
                Ok(res) => {
                    if res.status().is_success() {
                        if let Ok(token_info) = res.json::<serde_json::Value>().await {
                            let access_token = token_info["access_token"].as_str().ok_or_else(|| "No access token returned".to_string())?.to_string();
                            let refresh_token = token_info["refresh_token"].as_str().unwrap_or(&sess.refresh_token).to_string();
                            let expires_in = token_info["expires_in"].as_u64().unwrap_or(3600);
                            
                            sess.access_token = access_token.clone();
                            sess.refresh_token = refresh_token;
                            sess.expires_at = now + expires_in;

                            TidalState::save_session(app_handle, &sess);
                            *state.session.lock().unwrap() = Some(sess);
                            println!("{BOLD}{GREEN}✔ [TIDAL ENGINE] Token refreshed successfully!{RESET}");
                            return Ok(access_token);
                        }
                    } else {
                        let status = res.status();
                        println!("{BOLD}{RED}✘ [TIDAL ENGINE] Refresh rejected ({}). Falling back to existing token.{RESET}", status);
                        // Fall through — if existing token hasn't hard-expired, still use it
                        return Ok(sess.access_token);
                    }
                }
                Err(e) => {
                    println!("{BOLD}{RED}✘ [TIDAL ENGINE] Token refresh network error: {:?}. Using existing token.{RESET}", e);
                    return Ok(sess.access_token);
                }
            }
        } else {
            return Ok(sess.access_token);
        }
    }
    
    Err("User is not authenticated with Tidal".to_string())
}

#[tauri::command]
pub async fn tidal_login_start(
    state: State<'_, Arc<TidalState>>,
    app_handle: AppHandle,
) -> Result<serde_json::Value, String> {
    println!("\n{BOLD}{CYAN}┌────────────────────────────────────────────────────────┐{RESET}");
    println!("{BOLD}{CYAN}│  [TIDAL ENGINE] Starting Device Flow OAuth Login...    │{RESET}");
    println!("{BOLD}{CYAN}└────────────────────────────────────────────────────────┘{RESET}");

    let creds = TidalState::load_credentials(&app_handle);
    let client = get_client();
    
    // Fire TV + legacy Android Auto clients both use the standard Tidal user scopes
    let scope = "r_usr w_usr w_sub";

    let body = [
        ("client_id", creds.client_id.as_str()),
        ("client_secret", creds.client_secret.as_str()),
        ("scope", scope),
    ];

    let res = client.post("https://auth.tidal.com/v1/oauth2/device_authorization")
        .form(&body)
        .send()
        .await
        .map_err(|e| format!("Network request failed: {:?}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let err_text = res.text().await.unwrap_or_else(|_| "Empty error".to_string());
        println!("{BOLD}{RED}✘ [TIDAL ENGINE] Authorization request failed: {} - {}{RESET}", status, err_text);
        return Err(format!("Tidal authorization rejection ({}): {}", status, err_text));
    }

    let auth_info = res.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
    
    let device_code = auth_info["deviceCode"].as_str().ok_or("No device code")?.to_string();
    let user_code = auth_info["userCode"].as_str().ok_or("No user code")?.to_string();
    let _verification_uri = auth_info["verificationUri"].as_str().unwrap_or("link.tidal.com").to_string();
    let mut verification_uri_complete = auth_info["verificationUriComplete"].as_str()
        .unwrap_or("https://link.tidal.com")
        .to_string();

    if !verification_uri_complete.starts_with("http://") && !verification_uri_complete.starts_with("https://") {
        verification_uri_complete = format!("https://{}", verification_uri_complete);
    }
    let interval = auth_info["interval"].as_u64().unwrap_or(5);

    println!("[TIDAL ENGINE] User Code to display: {}", user_code);
    println!("[TIDAL ENGINE] Complete validation URL: {}", verification_uri_complete);

    let app_handle_clone = app_handle.clone();
    let state_clone = state.inner().clone();
    let creds_clone = creds.clone();

    // Spawn polling checker thread
    tokio::spawn(async move {
        let client = get_client();
        let body = [
            ("client_id", creds_clone.client_id.as_str()),
            ("client_secret", creds_clone.client_secret.as_str()),
            ("device_code", device_code.as_str()),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("scope", "r_usr w_usr w_sub"),
        ];

        for _ in 0..(300 / interval) {
            sleep(Duration::from_secs(interval)).await;

            let poll_res = client.post("https://auth.tidal.com/v1/oauth2/token")
                .form(&body)
                .send()
                .await;

            if let Ok(res) = poll_res {
                let status = res.status();
                if status.is_success() {
                    if let Ok(token_info) = res.json::<serde_json::Value>().await {
                        let access_token = token_info["access_token"].as_str().unwrap_or("").to_string();
                        let refresh_token = token_info["refresh_token"].as_str().unwrap_or("").to_string();
                        let expires_in = token_info["expires_in"].as_u64().unwrap_or(3600);
                        let country_code = token_info["user"]["countryCode"].as_str().map(|s| s.to_string());
                        
                        let now = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap()
                            .as_secs();

                        let session = TidalSession {
                            access_token,
                            refresh_token,
                            expires_at: now + expires_in,
                            country_code,
                        };

                        TidalState::save_session(&app_handle_clone, &session);
                        *state_clone.session.lock().unwrap() = Some(session);
                        *state_clone.logged_in.lock().unwrap() = true;

                        println!("{BOLD}{GREEN}✔ [TIDAL ENGINE] User logged in successfully!{RESET}");
                        let _ = app_handle_clone.emit("tidal-login-success", ());
                        break;
                    }
                } else {
                    if let Ok(err_body) = res.json::<serde_json::Value>().await {
                        let error_msg = err_body["error"].as_str().unwrap_or("");
                        if error_msg == "expired_token" {
                            println!("{BOLD}{RED}✘ [TIDAL ENGINE] Device flow pairing expired.{RESET}");
                            let _ = app_handle_clone.emit("tidal-login-expired", ());
                            break;
                        }
                    }
                }
            }
        }
    });

    Ok(serde_json::json!({
        "userCode": user_code,
        "verificationUriComplete": verification_uri_complete
    }))
}

#[tauri::command]
pub async fn tidal_login_poll_status(
    state: State<'_, Arc<TidalState>>,
    app_handle: AppHandle,
) -> Result<bool, String> {
    // Check if memory state says logged in
    if *state.logged_in.lock().unwrap() {
        return Ok(true);
    }

    // Try loading from session cache
    if let Some(sess) = TidalState::load_cached_session(&app_handle) {
        *state.session.lock().unwrap() = Some(sess);
        *state.logged_in.lock().unwrap() = true;
        return Ok(true);
    }

    Ok(false)
}

#[tauri::command]
pub async fn tidal_search(
    state: State<'_, Arc<TidalState>>,
    app_handle: AppHandle,
    query: String,
    region: Option<String>,
) -> Result<Vec<TidalTrackResult>, String> {
    let token = ensure_valid_token(&app_handle, &state).await?;
    let _creds = TidalState::load_credentials(&app_handle);

    let mut country = region.filter(|r| !r.trim().is_empty());

    if country.is_none() {
        let guard = state.session.lock().unwrap();
        if let Some(ref s) = *guard {
            country = s.country_code.clone();
        }
    }

    if country.is_none() {
        println!("{BOLD}{YELLOW}[TIDAL ENGINE] Dynamic region resolution initiated...{RESET}");
        let client = get_client();
        if let Ok(res) = client.get("https://api.tidal.com/v1/sessions")
            .bearer_auth(&token)
            .send()
            .await
        {
            if res.status().is_success() {
                if let Ok(sess_info) = res.json::<serde_json::Value>().await {
                    if let Some(code) = sess_info["countryCode"].as_str() {
                        let country_str = code.to_string();
                        let mut guard = state.session.lock().unwrap();
                        if let Some(ref mut sess) = *guard {
                            sess.country_code = Some(country_str.clone());
                            TidalState::save_session(&app_handle, sess);
                            println!("{BOLD}{GREEN}✔ [TIDAL ENGINE] Successfully resolved dynamic region to: {}{RESET}", country_str);
                        }
                        country = Some(country_str);
                    }
                }
            }
        }
    }

    let country_str = country.unwrap_or_else(|| "MY".to_string());

    let search_url = format!("https://api.tidal.com/v1/search?query={}&limit=25&types=TRACKS&countryCode={}", urlencoding::encode(&query), country_str);

    println!("\n{BOLD}{MAGENTA}┌────────────────────────────────────────────────────────┐{RESET}");
    println!("{BOLD}{MAGENTA}│  [TIDAL ENGINE] Searching Tidal catalog...             │{RESET}");
    println!("{BOLD}{MAGENTA}│  Query: {:<47}│{RESET}", query);
    println!("{BOLD}{MAGENTA}│  Country: {:<45}│{RESET}", country_str);
    println!("{BOLD}{MAGENTA}└────────────────────────────────────────────────────────┘{RESET}");

    let client = get_client();
    let res = client.get(&search_url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed to search Tidal: {:?}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        println!("{BOLD}{RED}✘ [TIDAL ENGINE] Search failed ({}) — body: {}{RESET}", status, body);
        
        if status.as_u16() == 403 && body.contains("r_usr") {
            return Err("Token missing 'r_usr' scope. If you entered Custom API Credentials, they do not support Lossless downloads. Please clear your custom credentials, Logout, and Login again.".to_string());
        }
        
        return Err(format!("Tidal search failed ({}): {}", status, body));
    }

    let search_results = res.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;

    // Check if Tidal returned an error payload in the JSON
    if let Some(err_desc) = search_results["error_description"].as_str() {
        return Err(format!("Tidal API Error: {}", err_desc));
    }
    if let Some(err_msg) = search_results["message"].as_str() {
        return Err(format!("Tidal API Error: {}", err_msg));
    }

    let mut tracks = Vec::new();

    if let Some(items) = search_results["tracks"]["items"].as_array() {
        for item in items {
            let id = item["id"].as_u64().or_else(|| item["id"].as_str().map(|s| s.parse().unwrap_or(0))).unwrap_or(0).to_string();
            let title = item["title"].as_str().unwrap_or("").to_string();
            let artist = item["artist"]["name"].as_str()
                .or_else(|| item["artists"][0]["name"].as_str())
                .unwrap_or("Unknown Artist")
                .to_string();
            let album = item["album"]["title"].as_str().unwrap_or("Unknown Album").to_string();
            let duration = item["duration"].as_u64().unwrap_or(0) as u32;
            
            // Format album cover url
            let cover_uuid = item["album"]["cover"].as_str().unwrap_or("");
            let cover_url = if !cover_uuid.is_empty() {
                let uuid_slashed = cover_uuid.replace("-", "/");
                format!("https://resources.tidal.com/images/{}/320x320.jpg", uuid_slashed)
            } else {
                "".to_string()
            };

            let quality = item["audioQuality"].as_str().unwrap_or("LOSSLESS").to_string();

            tracks.push(TidalTrackResult {
                id,
                title,
                artist,
                album,
                duration,
                cover_url,
                quality,
            });
        }
    } else {
        let raw_str = serde_json::to_string(&search_results).unwrap_or_default();
        println!("{BOLD}{RED}✘ [TIDAL ENGINE] Unexpected search response schema: {}{RESET}", raw_str);
        return Err(format!("Unexpected Tidal API response schema: {}", raw_str));
    }

    println!("{BOLD}{GREEN}✔ [TIDAL ENGINE] Search completed! Found {} tracks.{RESET}\n", tracks.len());
    Ok(tracks)
}

#[derive(Deserialize, Debug)]
struct DecodedManifest {
    #[serde(rename = "mimeType")]
    mime_type: String,
    urls: Vec<String>,
}

#[tauri::command]
pub async fn tidal_download(
    state: State<'_, Arc<TidalState>>,
    app_handle: AppHandle,
    app_state: State<'_, crate::AppState>,
    track_id: String,
    filename: String,
    title: String,
    artist: String,
    album: String,
    duration: u32,
) -> Result<bool, String> {
    let token = ensure_valid_token(&app_handle, &state).await?;
    let play_url = format!("https://api.tidal.com/v1/tracks/{}/playbackinfopostpaywall?playbackmode=STREAM&audioquality=LOSSLESS&assetpresentation=FULL", track_id);

    println!("\n{BOLD}{YELLOW}┌────────────────────────────────────────────────────────┐{RESET}");
    println!("{BOLD}{YELLOW}│  [TIDAL ENGINE] Initiating Lossless FLAC stream...     │{RESET}");
    println!("{BOLD}{YELLOW}│  Track ID: {:<44}│{RESET}", track_id);
    println!("{BOLD}{YELLOW}└────────────────────────────────────────────────────────┘{RESET}");

    let _creds = TidalState::load_credentials(&app_handle);
    let client = get_client();
    let res = client.get(&play_url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed to get stream: {:?}", e))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Tidal stream failed ({}): {}", status, body));
    }

    let playback_info = res.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
    
    // 1. Get base64 encoded manifest
    let manifest_b64 = playback_info["manifest"].as_str()
        .ok_or_else(|| "Playback info did not contain manifest".to_string())?;

    // 2. Decode base64 manifest
    let decoded_bytes = base64::engine::general_purpose::STANDARD.decode(manifest_b64)
        .map_err(|e| format!("Base64 decoding failed: {:?}", e))?;

    let decoded_str = String::from_utf8(decoded_bytes)
        .map_err(|e| format!("Invalid manifest encoding: {:?}", e))?;

    let manifest_json: DecodedManifest = serde_json::from_str(&decoded_str)
        .map_err(|e| format!("Parsing decoded manifest failed: {:?}", e))?;

    if manifest_json.urls.is_empty() {
        return Err("Decoded manifest contained zero direct audio links".to_string());
    }

    let direct_url = &manifest_json.urls[0];
    let is_flac = manifest_json.mime_type.contains("flac");

    println!("[TIDAL ENGINE] Stream details: MimeType = {}, Codec = FLAC", manifest_json.mime_type);
    println!("[TIDAL ENGINE] Direct CDN Stream URL acquired.");

    // Setup Target Path inside user's Music folder
    let user_music = dirs::audio_dir().unwrap_or_else(|| {
        app_handle.path().audio_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
    });
    
    let tidal_dir = user_music.join("Aideo_Tidal");
    let _ = std::fs::create_dir_all(&tidal_dir);

    // Filter file name to be fully safe
    let safe_filename = filename.replace(|c: char| !c.is_alphanumeric() && c != ' ' && c != '-' && c != '_', "");
    let extension = if is_flac { "flac" } else { "m4a" };
    let file_path = tidal_dir.join(format!("{}.{}", safe_filename, extension));

    println!("[TIDAL MONITOR] Downloading track stream to disk: {:?}", file_path);

    let app_handle_clone = app_handle.clone();
    let filename_clone = safe_filename.clone();
    let direct_url_clone = direct_url.clone();
    let db_clone = app_state.db.clone();
    let title_clone = title.clone();
    let artist_clone = artist.clone();
    let album_clone = album.clone();

    // Spawn downloader in background to keep UI fully responsive
    tokio::spawn(async move {
        let client = get_client();
        if let Ok(dl_res) = client.get(&direct_url_clone).send().await {
            let status = dl_res.status();
            if status.is_success() {
                if let Ok(bytes) = dl_res.bytes().await {
                    if std::fs::write(&file_path, bytes).is_ok() {
                        println!("{BOLD}{GREEN}✔ [TIDAL MONITOR] Direct download completed!{RESET}");
                        
                        // Auto-import completed file into library
                        if file_path.exists() {
                            let new_track = crate::db::Track {
                                id: 0,
                                path: file_path.to_string_lossy().to_string(),
                                title: Some(title_clone.clone()),
                                artist: Some(artist_clone.clone()),
                                album: Some(album_clone.clone()),
                                duration: Some(duration as f64),
                                format: Some(extension.to_uppercase()),
                                lyric_offset: 0,
                            };
                            let mut tracks = vec![new_track];
                            let mut conn = crate::safe_lock(&db_clone);
                            let _ = crate::db::save_tracks(&mut conn, &mut tracks);
                        }
                        let _ = app_handle_clone.emit("tidal-download-complete", filename_clone.clone());
                        return;
                    }
                }
            }
        }
        let _ = app_handle_clone.emit("tidal-download-error", filename_clone.clone());
    });

    Ok(true)
}

#[tauri::command]
pub async fn tidal_logout(
    state: State<'_, Arc<TidalState>>,
    app_handle: AppHandle,
) -> Result<bool, String> {
    TidalState::clear_session(&app_handle);
    *state.session.lock().unwrap() = None;
    *state.logged_in.lock().unwrap() = false;
    println!("{BOLD}{YELLOW}[TIDAL ENGINE] Logged out of Tidal successfully.{RESET}");
    Ok(true)
}
