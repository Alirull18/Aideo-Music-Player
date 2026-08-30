use serde::{Deserialize, Serialize};
use base64::Engine;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, State, Manager};
use tokio::time::{sleep, Duration};
use futures::StreamExt;

const BOLD: &str = "\x1b[1m";
const CYAN: &str = "\x1b[36m";
const GREEN: &str = "\x1b[32m";
const YELLOW: &str = "\x1b[33m";
const MAGENTA: &str = "\x1b[35m";
const RED: &str = "\x1b[31m";
const RESET: &str = "\x1b[0m";

// Default Fire TV Client credentials
const CLIENT_ID: &str = "4N3n6Q1x95LL5K7p";

fn get_fallback_client_secret() -> String {
    let p1 = "oKOXfJW371cX6xaZ0PyhgG";
    let p2 = "NBdNLlBZd4AKKYougMjik=";
    format!("{}{}", p1, p2)
}

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
    pub refresh_lock: tokio::sync::Mutex<()>,
}

impl Default for TidalState {
    fn default() -> Self {
        Self {
            session: Mutex::new(None),
            logged_in: Mutex::new(false),
            refresh_lock: tokio::sync::Mutex::new(()),
        }
    }
}

impl TidalState {
    // Load dynamic client credentials
    pub fn load_credentials(app_handle: &AppHandle) -> TidalCredentials {
        // First try to load from keyring
        if let Ok(entry) = open_keyring("tidal_credentials") {
            if let Ok(content) = entry.get_password() {
                if let Ok(cred) = serde_json::from_str::<TidalCredentials>(&content) {
                    if !cred.client_id.trim().is_empty() && !cred.client_secret.trim().is_empty() {
                        // Also cleanup old file if it exists
                        if let Ok(app_data) = app_handle.path().app_data_dir() {
                            let cred_file = app_data.join("tidal_credentials.json");
                            if cred_file.exists() {
                                let _ = std::fs::remove_file(cred_file);
                            }
                        }
                        return cred;
                    }
                }
            }
        }

        // If not in keyring, check if there is an old file to migrate
        if let Ok(app_data) = app_handle.path().app_data_dir() {
            let cred_file = app_data.join("tidal_credentials.json");
            if cred_file.exists() {
                if let Ok(content) = std::fs::read_to_string(&cred_file) {
                    if let Ok(cred) = serde_json::from_str::<TidalCredentials>(&content) {
                        if !cred.client_id.trim().is_empty() && !cred.client_secret.trim().is_empty() {
                            // Migrate to keyring
                            if let Ok(entry) = open_keyring("tidal_credentials") {
                                if keyring_write(&entry, &content) {
                                    let _ = std::fs::remove_file(cred_file);
                                }
                            }
                            return cred;
                        } else {
                            let _ = std::fs::remove_file(cred_file);
                        }
                    }
                }
            }
        }
        
        // Prioritize environment variables if available
        let env_id = std::env::var("TIDAL_CLIENT_ID").ok();
        let env_secret = std::env::var("TIDAL_CLIENT_SECRET").ok();
        if let (Some(id), Some(secret)) = (env_id, env_secret) {
            if !id.trim().is_empty() && !secret.trim().is_empty() {
                return TidalCredentials {
                    client_id: id,
                    client_secret: secret,
                };
            }
        }

        TidalCredentials {
            client_id: CLIENT_ID.to_string(),
            client_secret: get_fallback_client_secret(),
        }
    }

    pub fn save_credentials(app_handle: &AppHandle, client_id: &str, client_secret: &str) {
        let cred = TidalCredentials {
            client_id: client_id.to_string(),
            client_secret: client_secret.to_string(),
        };
        if let Ok(content) = serde_json::to_string_pretty(&cred) {
            if let Ok(entry) = open_keyring("tidal_credentials") {
                keyring_write(&entry, &content);
            }
        }
        
        // Cleanup old file if it exists
        if let Ok(app_data) = app_handle.path().app_data_dir() {
            let cred_file = app_data.join("tidal_credentials.json");
            if cred_file.exists() {
                let _ = std::fs::remove_file(cred_file);
            }
        }
    }

    // Check local session file on startup
    pub fn load_cached_session(app_handle: &AppHandle) -> Option<TidalSession> {
        // First try to load from keyring
        if let Ok(entry) = open_keyring("tidal_session") {
            if let Ok(content) = entry.get_password() {
                if let Ok(session) = serde_json::from_str::<TidalSession>(&content) {
                    // Cleanup old file if it exists
                    if let Ok(app_data) = app_handle.path().app_data_dir() {
                        let session_file = app_data.join("tidal_session.json");
                        if session_file.exists() {
                            let _ = std::fs::remove_file(session_file);
                        }
                    }
                    println!("{BOLD}{GREEN}✔ [TIDAL ENGINE] Loaded cached OAuth session from keyring successfully!{RESET}");
                    return Some(session);
                }
            }
        }

        // Migration from old file
        if let Ok(app_data) = app_handle.path().app_data_dir() {
            let session_file = app_data.join("tidal_session.json");
            if session_file.exists() {
                if let Ok(content) = std::fs::read_to_string(&session_file) {
                    if let Ok(session) = serde_json::from_str::<TidalSession>(&content) {
                        // Migrate to keyring
                        if let Ok(entry) = open_keyring("tidal_session") {
                            if keyring_write(&entry, &content) {
                                let _ = std::fs::remove_file(session_file);
                            }
                        }
                        println!("{BOLD}{GREEN}✔ [TIDAL ENGINE] Migrated and loaded cached OAuth session successfully!{RESET}");
                        return Some(session);
                    }
                }
            }
        }
        None
    }

    pub fn save_session(app_handle: &AppHandle, session: &TidalSession) {
        if let Ok(content) = serde_json::to_string_pretty(session) {
            if let Ok(entry) = open_keyring("tidal_session") {
                keyring_write(&entry, &content);
            }
        }

        // Cleanup old file if it exists
        if let Ok(app_data) = app_handle.path().app_data_dir() {
            let session_file = app_data.join("tidal_session.json");
            if session_file.exists() {
                let _ = std::fs::remove_file(session_file);
            }
        }
    }

    pub fn clear_session(app_handle: &AppHandle) {
        if let Ok(entry) = open_keyring("tidal_session") {
            keyring_delete(&entry);
        }

        // Cleanup old file if it exists
        if let Ok(app_data) = app_handle.path().app_data_dir() {
            let session_file = app_data.join("tidal_session.json");
            if session_file.exists() {
                let _ = std::fs::remove_file(session_file);
            }
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
        if let Ok(entry) = open_keyring("tidal_credentials") {
            keyring_delete(&entry);
        }
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

const FORCED_REFRESH_COOLDOWN_SECS: u64 = 120;
static LAST_FORCED_REFRESH_SECS: AtomicU64 = AtomicU64::new(0);

fn try_begin_forced_refresh() -> bool {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let last = LAST_FORCED_REFRESH_SECS.load(Ordering::Relaxed);
    if now < last.saturating_add(FORCED_REFRESH_COOLDOWN_SECS) {
        return false;
    }
    LAST_FORCED_REFRESH_SECS.store(now, Ordering::Relaxed);
    true
}

const SUBSCRIPTION_BLOCKED_ERROR: &str = "Tidal playback unauthorized even after a fresh token. Your account likely has no active subscription for on-demand streaming, or this track is not entitled on your plan.";

fn stream_quality_ladder() -> Vec<&'static str> {
    vec!["HI_RES_LOSSLESS", "HI_RES", "LOSSLESS", "HIGH", "LOW"]
}

fn open_keyring(storage: &str) -> Result<keyring::Entry, ()> {
    match keyring::Entry::new("AideoMusicPlayer", storage) {
        Ok(entry) => Ok(entry),
        Err(e) => {
            println!("{BOLD}{RED}✘ [TIDAL ENGINE] OS keyring unavailable for '{}': {:?}. Tidal sessions will NOT persist across restarts!{RESET}", storage, e);
            Err(())
        }
    }
}

pub(crate) fn open_shared_keyring(storage: &str) -> Result<keyring::Entry, ()> {
    match keyring::Entry::new("AideoMusicPlayer", storage) {
        Ok(entry) => Ok(entry),
        Err(e) => {
            println!("{BOLD}{RED}✘ OS keyring unavailable for '{}': {:?}. Sessions will NOT persist across restarts!{RESET}", storage, e);
            Err(())
        }
    }
}

pub(crate) fn shared_keyring_write(entry: &keyring::Entry, content: &str) -> bool {
    match entry.set_password(content) {
        Ok(_) => true,
        Err(e) => {
            println!("{BOLD}{RED}✘ Keyring write failed: {:?}. Session persistence is broken!{RESET}", e);
            false
        }
    }
}

pub(crate) fn shared_keyring_delete(entry: &keyring::Entry) {
    if let Err(e) = entry.delete_credential() {
        println!("{BOLD}{YELLOW}⚠ Keyring delete failed: {:?}.{RESET}", e);
    }
}

fn keyring_write(entry: &keyring::Entry, content: &str) -> bool {
    match entry.set_password(content) {
        Ok(_) => true,
        Err(e) => {
            println!("{BOLD}{RED}✘ [TIDAL ENGINE] Keyring write failed: {:?}. Tidal session persistence is broken!{RESET}", e);
            false
        }
    }
}

fn keyring_delete(entry: &keyring::Entry) {
    if let Err(e) = entry.delete_credential() {
        println!("{BOLD}{YELLOW}⚠ [TIDAL ENGINE] Keyring delete failed: {:?}.{RESET}", e);
    }
}

async fn ensure_valid_token(app_handle: &AppHandle, state: &TidalState, force: bool) -> Result<String, String> {    // Acquire async deduplication lock to serialize concurrent token refresh calls
    let _guard = state.refresh_lock.lock().await;

    let current_sess = crate::safe_lock(&state.session).clone();
    
    if let Some(mut sess) = current_sess {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        // If force is true, or the token expires in less than 5 minutes, try to refresh it
        if force || sess.expires_at < now + 300 {
            println!("{BOLD}{YELLOW}[TIDAL ENGINE] Access token refresh triggered (force={})...{RESET}", force);
            
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
                    let status = res.status();
                    if status.is_success() {
                        if let Ok(token_info) = res.json::<serde_json::Value>().await {
                            let access_token = token_info["access_token"].as_str().ok_or_else(|| "No access token returned".to_string())?.to_string();
                            let refresh_token = token_info["refresh_token"].as_str().unwrap_or(&sess.refresh_token).to_string();
                            let expires_in = token_info["expires_in"].as_u64().unwrap_or(3600);
                            
                            sess.access_token = access_token.clone();
                            sess.refresh_token = refresh_token;
                            sess.expires_at = now + expires_in;

                            TidalState::save_session(app_handle, &sess);
                            *crate::safe_lock(&state.session) = Some(sess);
                            *crate::safe_lock(&state.logged_in) = true;
                            println!("{BOLD}{GREEN}✔ [TIDAL ENGINE] Token refreshed successfully!{RESET}");
                            return Ok(access_token);
                        }
                    } else {
                        let err_text = res.text().await.unwrap_or_default();
                        println!("{BOLD}{RED}✘ [TIDAL ENGINE] Refresh rejected ({}) — body: {}{RESET}", status, err_text);
                        if is_permanent_auth_failure(status, Some(&err_text)) {
                            TidalState::clear_session(app_handle);
                            *crate::safe_lock(&state.logged_in) = false;
                            *crate::safe_lock(&state.session) = None;
                            return Err("Tidal session has expired. Please logout and connect again under Settings/Search panel.".to_string());
                        }
                        return Err(format!("Tidal token refresh temporary failure ({}). Session preserved.", status));
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
    let raw_interval = auth_info["interval"].as_u64().unwrap_or(5);
    let (interval, iterations) = compute_poll_params(raw_interval);

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

        for _ in 0..iterations {
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
                            .unwrap_or_default()
                            .as_secs();

                        let session = TidalSession {
                            access_token,
                            refresh_token,
                            expires_at: now + expires_in,
                            country_code,
                        };

                        TidalState::save_session(&app_handle_clone, &session);
                        *crate::safe_lock(&state_clone.session) = Some(session);
                        *crate::safe_lock(&state_clone.logged_in) = true;

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
    if *crate::safe_lock(&state.logged_in) {
        return Ok(true);
    }

    // Try loading from session cache
    if let Some(sess) = TidalState::load_cached_session(&app_handle) {
        *crate::safe_lock(&state.session) = Some(sess);
        *crate::safe_lock(&state.logged_in) = true;
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
    let mut token = ensure_valid_token(&app_handle, &state, false).await?;
    let _creds = TidalState::load_credentials(&app_handle);

    let mut country = region.filter(|r| !r.trim().is_empty());

    if country.is_none() {
        let guard = crate::safe_lock(&state.session);
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
                        let mut guard = crate::safe_lock(&state.session);
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
    let mut res = client.get(&search_url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Failed to search Tidal: {:?}", e))?;

    if res.status().as_u16() == 401 {
        println!("{BOLD}{YELLOW}⚠ [TIDAL ENGINE] Search unauthorized (401). Forcing token refresh...{RESET}");
        token = ensure_valid_token(&app_handle, &state, true).await?;
        res = client.get(&search_url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| format!("Failed to search Tidal retry: {:?}", e))?;
    }

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
#[allow(dead_code)]
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
    let mut token = ensure_valid_token(&app_handle, &state, false).await?;
    let qualities = stream_quality_ladder();
    let mut playback_info = None;
    let mut last_error = "Failed to fetch any stream".to_string();
    let client = get_client();
    let mut token_refreshed = false;

    for q in qualities {
        let play_url = format!(
            "https://api.tidal.com/v1/tracks/{}/playbackinfopostpaywall?playbackmode=STREAM&audioquality={}&assetpresentation=FULL",
            track_id, q
        );
        println!("[TIDAL ENGINE] Requesting stream quality: {}", q);
        let mut res = match client.get(&play_url).bearer_auth(&token).send().await {
            Ok(r) => r,
            Err(e) => {
                last_error = format!("Network error for quality {}: {:?}", q, e);
                continue;
            }
        };

        if res.status().as_u16() == 401 {
            if !token_refreshed && try_begin_forced_refresh() {
                println!("{BOLD}{YELLOW}⚠ [TIDAL ENGINE] Request unauthorized (401). Forcing token refresh...{RESET}");
                token_refreshed = true;
                match ensure_valid_token(&app_handle, &state, true).await {
                    Ok(new_token) => {
                        token = new_token;
                        match client.get(&play_url).bearer_auth(&token).send().await {
                            Ok(r) => res = r,
                            Err(e) => {
                                last_error = format!("Network error after retry for quality {}: {:?}", q, e);
                                continue;
                            }
                        }
                    }
                    Err(err) => {
                        last_error = format!("Forced token refresh failed: {}", err);
                        break;
                    }
                }
            }
            if res.status().as_u16() == 401 {
                println!("{BOLD}{RED}✘ [TIDAL ENGINE] Still 401 with fresh/cooldown token at quality {}. Stopping quality ladder.{RESET}", q);
                last_error = SUBSCRIPTION_BLOCKED_ERROR.to_string();
                break;
            }
        }

        let status = res.status();
        if status.is_success() {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if json["manifest"].as_str().is_some() {
                    playback_info = Some(json);
                    break;
                } else {
                    let err_msg = json["message"].as_str().unwrap_or("No manifest in success payload");
                    last_error = format!("Quality {} rejected: {}", q, err_msg);
                    println!("{BOLD}{YELLOW}[TIDAL ENGINE] Quality {} payload error: {}{RESET}", q, err_msg);
                }
            } else {
                last_error = format!("Quality {} returned invalid JSON", q);
            }
        } else {
            let err_body = res.text().await.unwrap_or_default();
            last_error = format!("Quality {} returned HTTP {}: {}", q, status, err_body);
            println!("{BOLD}{YELLOW}[TIDAL ENGINE] Quality {} rejected ({}): {}{RESET}", q, status, err_body);
        }
    }

    let playback_info = playback_info.ok_or(last_error)?;
    
    // 1. Get base64 encoded manifest
    let manifest_b64 = playback_info["manifest"].as_str()
        .ok_or_else(|| "Playback info did not contain manifest".to_string())?;

    // 2. Decode base64 manifest robustly (trying both standard and URL-safe encodings)
    let decoded_bytes = base64::engine::general_purpose::STANDARD.decode(manifest_b64)
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(manifest_b64))
        .map_err(|e| format!("Base64 decoding failed: {:?}", e))?;

    let decoded_str = String::from_utf8(decoded_bytes)
        .map_err(|e| format!("Invalid manifest encoding: {:?}", e))?;

    // 3. Robustly parse the direct stream URL (supporting both JSON and MPEG-DASH XML formats)
    let direct_url = if decoded_str.trim().starts_with('{') {
        // Parse JSON manifest
        let manifest_json: DecodedManifest = serde_json::from_str(&decoded_str)
            .map_err(|e| format!("Parsing decoded JSON manifest failed: {:?}", e))?;
        if manifest_json.urls.is_empty() {
            return Err("Decoded JSON manifest contained zero direct audio links".to_string());
        }
        manifest_json.urls[0].clone()
    } else if decoded_str.contains("<BaseURL>") {
        // Parse XML manifest by extracting BaseURL
        let start_tag = "<BaseURL>";
        let end_tag = "</BaseURL>";
        if let Some(start_idx) = decoded_str.find(start_tag) {
            if let Some(end_idx) = decoded_str.find(end_tag) {
                let url_content = &decoded_str[start_idx + start_tag.len()..end_idx];
                url_content.replace("&amp;", "&").trim().to_string()
            } else {
                return Err("Decoded XML manifest was malformed (missing </BaseURL>)".to_string());
            }
        } else {
            return Err("Decoded XML manifest did not contain a <BaseURL>".to_string());
        }
    } else {
        return Err("Unknown manifest format (neither JSON nor XML with BaseURL)".to_string());
    };

    let is_flac = decoded_str.to_lowercase().contains("flac");
    let is_dolby = decoded_str.to_lowercase().contains("ec-3")
        || decoded_str.to_lowercase().contains("ec3")
        || decoded_str.to_lowercase().contains("eac3")
        || decoded_str.to_lowercase().contains("atmos");

    let format_str = if is_flac {
        "FLAC".to_string()
    } else if is_dolby {
        "DOLBY ATMOS".to_string()
    } else {
        "M4A".to_string()
    };

    println!("[TIDAL ENGINE] Stream details: Codec = {}, Mime = {}", if is_flac { "FLAC" } else if is_dolby { "DOLBY ATMOS (E-AC-3)" } else { "AAC" }, if is_flac { "audio/flac" } else if is_dolby { "audio/eac3" } else { "audio/mp4" });
    println!("[TIDAL ENGINE] Direct CDN Stream URL acquired.");

    // Setup Target Path inside user's Music folder
    let user_music = dirs::audio_dir().unwrap_or_else(|| {
        app_handle.path().audio_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
    });
    
    let tidal_dir = user_music.join("Aideo Downloads");
    let _ = std::fs::create_dir_all(&tidal_dir);

    // Filter file name to be fully safe
    let safe_filename = filename.replace(|c: char| !c.is_alphanumeric() && c != ' ' && c != '-' && c != '_', "");
    let extension = if is_flac { "flac" } else { "m4a" };
    let file_path = tidal_dir.join(format!("{}.{}", safe_filename, extension));

    println!("[TIDAL MONITOR] Downloading track stream to disk: {:?}", file_path);

    let app_handle_clone = app_handle.clone();
    let filename_clone = safe_filename.clone();
    let track_id_clone = track_id.clone();
    let direct_url_clone = direct_url.clone();
    let db_clone = app_state.db.clone();
    let title_clone = title.clone();
    let artist_clone = artist.clone();
    let album_clone = album.clone();
    let format_str_clone = format_str.clone();

    // Spawn downloader in background to keep UI fully responsive
    tokio::spawn(async move {
        let client = get_client();
        if let Ok(dl_res) = client.get(&direct_url_clone).send().await {
            let status = dl_res.status();
            if status.is_success() {
                let total_size = dl_res.content_length().unwrap_or(0);
                let mut downloaded: u64 = 0;

                if let Ok(mut file) = std::fs::File::create(&file_path) {
                     use std::io::Write;
                     let mut stream = dl_res.bytes_stream();
                     let mut last_emit_time = std::time::Instant::now();
                     let mut failed = false;

                     while let Some(chunk_res) = stream.next().await {
                        match chunk_res {
                            Ok(chunk) => {
                                if file.write_all(&chunk).is_err() {
                                    failed = true;
                                    break;
                                }
                                downloaded += chunk.len() as u64;

                                // Throttle progress events to prevent flooding (max once every 150ms)
                                if last_emit_time.elapsed() >= std::time::Duration::from_millis(150) {
                                    let percent = if total_size > 0 {
                                        (downloaded as f64 / total_size as f64) * 100.0
                                    } else {
                                        0.0
                                    };
                                    let downloaded_mb = downloaded as f64 / (1024.0 * 1024.0);
                                    let total_mb = total_size as f64 / (1024.0 * 1024.0);

                                    let _ = app_handle_clone.emit("tidal-download-progress", serde_json::json!({
                                        "filename": filename_clone.clone(),
                                        "track_id": track_id_clone.clone(),
                                        "percent": percent,
                                        "downloaded_mb": downloaded_mb,
                                        "total_mb": total_mb
                                    }));
                                    last_emit_time = std::time::Instant::now();
                                }
                            }
                            Err(_) => {
                                failed = true;
                                break;
                            }
                        }
                     }

                     if !failed {
                        let _ = file.flush();
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
                                format: Some(format_str_clone),
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
                            };
                            let mut tracks = vec![new_track];
                            let mut conn = crate::safe_lock(&db_clone);
                            let _ = crate::db::save_tracks(&mut conn, &mut tracks);
                        }

                        // Emit final 100% progress
                        let downloaded_mb = downloaded as f64 / (1024.0 * 1024.0);
                        let _ = app_handle_clone.emit("tidal-download-progress", serde_json::json!({
                            "filename": filename_clone.clone(),
                            "track_id": track_id_clone.clone(),
                            "percent": 100.0,
                            "downloaded_mb": downloaded_mb,
                            "total_mb": downloaded_mb
                        }));

                        let _ = app_handle_clone.emit("tidal-download-complete", serde_json::json!({
                            "filename": filename_clone.clone(),
                            "track_id": track_id_clone.clone()
                        }));
                        return;
                     }
                }
            }
        }
        let _ = app_handle_clone.emit("tidal-download-error", serde_json::json!({
            "filename": filename_clone.clone(),
            "track_id": track_id_clone.clone()
        }));
    });

    Ok(true)
}


#[tauri::command]
pub async fn tidal_get_stream_url(
    state: State<'_, Arc<TidalState>>,
    app_handle: AppHandle,
    track_id: String,
) -> Result<String, String> {
    let mut token = ensure_valid_token(&app_handle, &state, false).await?;
    let qualities = stream_quality_ladder();
    let mut playback_info = None;
    let mut last_error = "Failed to fetch any stream".to_string();
    let client = get_client();
    let mut token_refreshed = false;

    for q in qualities {
        let play_url = format!(
            "https://api.tidal.com/v1/tracks/{}/playbackinfopostpaywall?playbackmode=STREAM&audioquality={}&assetpresentation=FULL",
            track_id, q
        );
        println!("[TIDAL ENGINE] Requesting stream quality for preview: {}", q);
        let mut res = match client.get(&play_url).bearer_auth(&token).send().await {
            Ok(r) => r,
            Err(e) => {
                last_error = format!("Network error for quality {}: {:?}", q, e);
                continue;
            }
        };

        if res.status().as_u16() == 401 {
            if !token_refreshed && try_begin_forced_refresh() {
                println!("{BOLD}{YELLOW}⚠ [TIDAL ENGINE] Preview unauthorized (401). Forcing token refresh...{RESET}");
                token_refreshed = true;
                match ensure_valid_token(&app_handle, &state, true).await {
                    Ok(new_token) => {
                        token = new_token;
                        match client.get(&play_url).bearer_auth(&token).send().await {
                            Ok(r) => res = r,
                            Err(e) => {
                                last_error = format!("Network error after retry for quality {}: {:?}", q, e);
                                continue;
                            }
                        }
                    }
                    Err(err) => {
                        last_error = format!("Forced token refresh failed: {}", err);
                        break;
                    }
                }
            }
            if res.status().as_u16() == 401 {
                println!("{BOLD}{RED}✘ [TIDAL ENGINE] Still 401 with fresh/cooldown token at quality {}. Stopping quality ladder.{RESET}", q);
                last_error = SUBSCRIPTION_BLOCKED_ERROR.to_string();
                break;
            }
        }

        let status = res.status();
        if status.is_success() {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if json["manifest"].as_str().is_some() {
                    playback_info = Some(json);
                    break;
                } else {
                    let err_msg = json["message"].as_str().unwrap_or("No manifest in success payload");
                    last_error = format!("Quality {} rejected: {}", q, err_msg);
                }
            } else {
                last_error = format!("Quality {} returned invalid JSON", q);
            }
        } else {
            let err_body = res.text().await.unwrap_or_default();
            last_error = format!("Quality {} returned HTTP {}: {}", q, status, err_body);
        }
    }

    let playback_info = playback_info.ok_or(last_error)?;
    
    // 1. Get base64 encoded manifest
    let manifest_b64 = playback_info["manifest"].as_str()
        .ok_or_else(|| "Playback info did not contain manifest".to_string())?;

    // 2. Decode base64 manifest robustly (trying both standard and URL-safe encodings)
    let decoded_bytes = base64::engine::general_purpose::STANDARD.decode(manifest_b64)
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(manifest_b64))
        .map_err(|e| format!("Base64 decoding failed: {:?}", e))?;

    let decoded_str = String::from_utf8(decoded_bytes)
        .map_err(|e| format!("Invalid manifest encoding: {:?}", e))?;

    // 3. Robustly parse the direct stream URL (supporting both JSON and MPEG-DASH XML formats)
    let direct_url = if decoded_str.trim().starts_with('{') {
        // Parse JSON manifest
        let manifest_json: DecodedManifest = serde_json::from_str(&decoded_str)
            .map_err(|e| format!("Parsing decoded JSON manifest failed: {:?}", e))?;
        if manifest_json.urls.is_empty() {
            return Err("Decoded JSON manifest contained zero direct audio links".to_string());
        }
        manifest_json.urls[0].clone()
    } else if decoded_str.contains("<BaseURL>") {
        // Parse XML manifest by extracting BaseURL
        let start_tag = "<BaseURL>";
        let end_tag = "</BaseURL>";
        if let Some(start_idx) = decoded_str.find(start_tag) {
            if let Some(end_idx) = decoded_str.find(end_tag) {
                let url_content = &decoded_str[start_idx + start_tag.len()..end_idx];
                url_content.replace("&amp;", "&").trim().to_string()
            } else {
                return Err("Decoded XML manifest was malformed (missing </BaseURL>)".to_string());
            }
        } else {
            return Err("Decoded XML manifest did not contain a <BaseURL>".to_string());
        }
    } else {
        return Err("Unknown manifest format (neither JSON nor XML with BaseURL)".to_string());
    };

    Ok(direct_url)
}

#[tauri::command]
pub async fn tidal_logout(
    state: State<'_, Arc<TidalState>>,
    app_handle: AppHandle,
) -> Result<bool, String> {
    TidalState::clear_session(&app_handle);
    *crate::safe_lock(&state.session) = None;
    *crate::safe_lock(&state.logged_in) = false;
    println!("{BOLD}{YELLOW}[TIDAL ENGINE] Logged out of Tidal successfully.{RESET}");
    Ok(true)
}

fn clean_title(title: &str) -> String {
    let mut title_lower = title.to_lowercase();
    if let Ok(re) = regex::Regex::new(r"[\(\[][^\)\]]+[\)\]]") {
        title_lower = re.replace_all(&title_lower, "").into_owned();
    }
    if let Some(idx) = title_lower.find(" feat.") { title_lower.truncate(idx); }
    if let Some(idx) = title_lower.find(" ft.") { title_lower.truncate(idx); }
    if let Some(idx) = title_lower.find(" featuring") { title_lower.truncate(idx); }
    if let Some(idx) = title_lower.find(" official audio") { title_lower.truncate(idx); }
    if let Some(idx) = title_lower.find(" official video") { title_lower.truncate(idx); }
    title_lower.trim().to_string()
}

fn is_semantic_noise(title: &str, seed_title: &str) -> bool {
    let title_lower = title.to_lowercase();
    let seed_lower = seed_title.to_lowercase();
    let noise_words = ["instrumental", "karaoke", "backing track", "tribute", "cover", "acapella", "8d"];
    for &word in &noise_words {
        if title_lower.contains(word) && !seed_lower.contains(word) {
            return true;
        }
    }
    false
}

fn fuzzy_title_similarity(s1: &str, s2: &str) -> f64 {
    let s1_clean = clean_title(s1);
    let s2_clean = clean_title(s2);
    if s1_clean == s2_clean {
        return 1.0;
    }
    let s1_chars: Vec<char> = s1_clean.chars().collect();
    let s2_chars: Vec<char> = s2_clean.chars().collect();
    if s1_chars.len() < 2 || s2_chars.len() < 2 {
        return if s1_clean == s2_clean { 1.0 } else { 0.0 };
    }

    let mut s1_bigrams = std::collections::HashSet::new();
    for i in 0..s1_chars.len() - 1 {
        s1_bigrams.insert((s1_chars[i], s1_chars[i+1]));
    }

    let mut s2_bigrams = std::collections::HashSet::new();
    for i in 0..s2_chars.len() - 1 {
        s2_bigrams.insert((s2_chars[i], s2_chars[i+1]));
    }

    let intersection = s1_bigrams.intersection(&s2_bigrams).count();
    let total = s1_bigrams.len() + s2_bigrams.len();
    if total == 0 {
        return 0.0;
    }
    (2.0 * intersection as f64) / total as f64
}

/// Minimal access to any streaming-provider track result so the autoplay
/// radio pipeline can be shared between Tidal and other providers.
pub trait RadioCandidate {
    fn radio_title(&self) -> &str;
    fn radio_artist(&self) -> &str;
    fn radio_duration(&self) -> u32;
}

impl RadioCandidate for TidalTrackResult {
    fn radio_title(&self) -> &str { &self.title }
    fn radio_artist(&self) -> &str { &self.artist }
    fn radio_duration(&self) -> u32 { self.duration }
}

/// Shared autoplay radio pipeline: filters instrumental/third-party noise,
/// drops duplicates of the seed track, caps duration, de-duplicates the
/// candidate list itself, then interleaves same-artist and discovery picks.
pub(crate) fn build_radio_queue<T: RadioCandidate + Clone>(
    tracks: Vec<T>,
    artist: &str,
    title: &str,
) -> Vec<T> {
    let artist_lower = artist.to_lowercase();
    let clean_seed_title = clean_title(title);

    let mut filtered_tracks = Vec::new();
    let mut seen_titles = std::collections::HashSet::new();

    for track in tracks {
        // 0. Instrumental/Third-Party Filter
        if crate::youtube::is_third_party_or_instrumental(track.radio_title(), track.radio_artist()) {
            println!("[autoplay-filter] Drop instrumental/third-party track: '{}' by '{}'", track.radio_title(), track.radio_artist());
            continue;
        }

        // 1. Semantic Noise Filter
        if is_semantic_noise(track.radio_title(), title) {
            println!("[autoplay-filter] Drop semantic noise: '{}' by '{}'", track.radio_title(), track.radio_artist());
            continue;
        }

        // 2. Precise Deduplication against Seed
        let is_same_artist = crate::youtube::artist_matches(track.radio_artist(), artist);
        let clean_cand = clean_title(track.radio_title());
        let is_same_title = clean_seed_title == clean_cand && !clean_cand.is_empty();
        let sim = fuzzy_title_similarity(track.radio_title(), title);

        if (is_same_artist && (sim > 0.65 || is_same_title)) || (is_same_title && is_same_artist) {
            println!("[autoplay-filter] Drop duplicate song: '{}' (Similarity: {:.2}%)", track.radio_title(), sim * 100.0);
            continue;
        }

        // 3. Track Duration Filter (Drop >15 mins / 900s)
        if track.radio_duration() > 900 {
            println!("[autoplay-filter] Drop long-duration track: '{}' ({}s)", track.radio_title(), track.radio_duration());
            continue;
        }

        // 4. De-duplicate clean titles inside the recommended list itself
        if seen_titles.contains(&clean_cand) {
            continue;
        }
        seen_titles.insert(clean_cand);

        filtered_tracks.push(track);
    }

    // 5. Segregate same-artist vs discovery pools
    let mut same_artist_pool = Vec::new();
    let mut discovery_pool = Vec::new();

    for track in filtered_tracks {
        let candidate_artist_lower = track.radio_artist().to_lowercase();
        if candidate_artist_lower.contains(&artist_lower) || artist_lower.contains(&candidate_artist_lower) {
            same_artist_pool.push(track);
        } else {
            discovery_pool.push(track);
        }
    }

    // 6. Interleave and build the final queue (limiting same-artist consecutive repetition)
    let mut final_queue = Vec::new();

    // Smooth transition: Start with 1 same-artist track if available
    if let Some(first_same) = same_artist_pool.pop() {
        final_queue.push(first_same);
    }

    // Interleave remaining tracks (capping same artist representation in the first few tracks)
    let mut same_artist_count = final_queue.len();

    let mut discovery_iter = discovery_pool.into_iter();
    let mut same_artist_iter = same_artist_pool.into_iter();

    while final_queue.len() < 8 {
        let mut added = false;
        if let Some(disc_track) = discovery_iter.next() {
            final_queue.push(disc_track);
            added = true;
        }

        let same_artist_limit = if discovery_iter.len() == 0 { 8 } else { 4 };
        if final_queue.len() < 8 && same_artist_count < same_artist_limit {
            if let Some(same_track) = same_artist_iter.next() {
                final_queue.push(same_track);
                same_artist_count += 1;
                added = true;
            }
        }

        if !added {
            break;
        }
    }

    final_queue
}

#[tauri::command]
pub async fn get_tidal_autoplay_recommendations(
    state: State<'_, Arc<TidalState>>,
    app_handle: AppHandle,
    artist: String,
    title: String,
) -> Result<Vec<TidalTrackResult>, String> {
    println!("[tidal] Aideo Autoplay Engine v2: Resolving Tidal Radio for '{}' by '{}'", title, artist);
    
    let query = if !artist.is_empty() && artist != "Unknown Artist" {
        format!("{} Radio", artist)
    } else if !title.is_empty() && title != "Unknown Title" {
        title.clone()
    } else {
        "Top Tracks".to_string()
    };

    let mut search_results = tidal_search(state.clone(), app_handle.clone(), query, None).await;
    if search_results.as_ref().map(|t| t.is_empty()).unwrap_or(true) && !artist.is_empty() && artist != "Unknown Artist" {
        search_results = tidal_search(state, app_handle, artist.clone(), None).await;
    }

    match search_results {
        Ok(tracks) => {
            let final_queue = build_radio_queue(tracks, &artist, &title);
            println!("[autoplay] Engine v2 finalized Tidal queue with {} highly matching tracks.", final_queue.len());
            Ok(final_queue)
        }
        Err(e) => {
            eprintln!("[tidal] Autoplay search failed: {}", e);
            Err(e)
        }
    }
}

/// Clamps polling interval to safe bounds (1..=60) and computes iteration count for 300-second timeout.
pub fn compute_poll_params(raw_interval: u64) -> (u64, u64) {
    let interval = raw_interval.clamp(1, 60);
    let iterations = 300 / interval;
    (interval, iterations)
}

/// Determines whether a token refresh HTTP status code indicates permanent authentication failure
/// (requiring session purge) vs transient errors (rate limit 429, server errors 5xx).
pub fn is_permanent_auth_failure(status: reqwest::StatusCode, error_body: Option<&str>) -> bool {
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return true;
    }
    if status == reqwest::StatusCode::BAD_REQUEST {
        if let Some(body) = error_body {
            let body_lower = body.to_lowercase();
            return body_lower.contains("invalid_grant")
                || body_lower.contains("invalid_client")
                || body_lower.contains("unauthorized_client");
        }
        return false;
    }
    false
}

// ---------- Discovery Hub: Tidal HiFi recommendations ----------

const HUB_MAX_SEEDS: usize = 6;
const HUB_MAX_TRACK_DURATION_SECS: u32 = 900;

/// Signature compatible with the discovery hub's library dedupe format
/// (`normalize_artist_name + clean_title`, see youtube/mod.rs).
fn tidal_track_signature(artist: &str, title: &str) -> String {
    format!(
        "{}::{}",
        crate::youtube::normalize_artist_name(artist),
        clean_title(title)
    )
}

/// Map hub seed artists to Tidal search queries. Falls back to a generic
/// "Top Tracks" search when no usable seed exists (cold start).
fn hub_seed_queries(seed_artists: Vec<String>) -> Vec<String> {
    let mut queries = Vec::new();
    for artist in seed_artists {
        let trimmed = artist.trim();
        if trimmed.is_empty() {
            continue;
        }
        queries.push(format!("{} Radio", trimmed));
        if queries.len() >= HUB_MAX_SEEDS {
            break;
        }
    }
    if queries.is_empty() {
        queries.push("Top Tracks".to_string());
    }
    queries
}

/// Filter + cross-seed dedupe of raw search candidates:
/// drops marathon tracks (>15min), third-party/instrumental entries, tracks
/// already known to the library or other rec sources, and duplicates found
/// via multiple seed searches. First occurrence wins, order preserved.
fn dedupe_hub_candidates(
    candidates: Vec<TidalTrackResult>,
    exclude_signatures: &std::collections::HashSet<String>,
) -> Vec<TidalTrackResult> {
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut out = Vec::new();
    for track in candidates {
        if track.duration > HUB_MAX_TRACK_DURATION_SECS {
            continue;
        }
        if crate::youtube::is_third_party_or_instrumental(&track.title, &track.artist) {
            continue;
        }
        if track.title.trim().is_empty() || track.artist.trim().is_empty() {
            continue;
        }
        let sig = tidal_track_signature(&track.artist, &track.title);
        if exclude_signatures.contains(&sig) {
            continue;
        }
        if !seen.insert(sig) {
            continue;
        }
        out.push(track);
    }
    out
}

/// Discovery Hub command: resolves Tidal HiFi picks for the given seed artists.
/// Seed failures are silently skipped so the hub renders without this section
/// rather than erroring.
#[tauri::command]
pub async fn get_tidal_hub_recommendations(
    state: State<'_, Arc<TidalState>>,
    app_handle: AppHandle,
    seed_artists: Vec<String>,
    exclude_signatures: Option<Vec<String>>,
) -> Result<Vec<TidalTrackResult>, String> {
    let queries = hub_seed_queries(seed_artists);
    println!("[tidal-hub] Fetching HiFi recommendations from {} search(es)", queries.len());

    let searches: Vec<_> = queries
        .iter()
        .map(|q| tidal_search(state.clone(), app_handle.clone(), q.clone(), None))
        .collect();
    let results = futures::future::join_all(searches).await;

    let mut candidates = Vec::new();
    for res in results {
        match res {
            Ok(tracks) => candidates.extend(tracks),
            Err(e) => println!("[tidal-hub] Skipping failed seed search: {}", e),
        }
    }

    let exclude: std::collections::HashSet<String> =
        exclude_signatures.unwrap_or_default().into_iter().collect();
    let deduped = dedupe_hub_candidates(candidates, &exclude);
    println!("[tidal-hub] Resolved {} unique HiFi recommendations", deduped.len());
    Ok(deduped)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tidal_poll_interval_zero_clamps_to_1() {
        let (interval, iterations) = compute_poll_params(0);
        assert_eq!(interval, 1);
        assert_eq!(iterations, 300);
    }

    #[test]
    fn test_tidal_poll_interval_standard_5() {
        let (interval, iterations) = compute_poll_params(5);
        assert_eq!(interval, 5);
        assert_eq!(iterations, 60);
    }

    #[test]
    fn test_tidal_poll_interval_large_clamps_to_60() {
        let (interval, iterations) = compute_poll_params(120);
        assert_eq!(interval, 60);
        assert_eq!(iterations, 5);
    }

    #[test]
    fn test_forced_refresh_cooldown_gate() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        LAST_FORCED_REFRESH_SECS.store(0, Ordering::Relaxed);
        assert!(try_begin_forced_refresh(), "first-ever forced refresh must be allowed");

        LAST_FORCED_REFRESH_SECS.store(now, Ordering::Relaxed);
        assert!(!try_begin_forced_refresh(), "refresh within cooldown window must be blocked");

        LAST_FORCED_REFRESH_SECS.store(now - FORCED_REFRESH_COOLDOWN_SECS - 1, Ordering::Relaxed);
        assert!(try_begin_forced_refresh(), "refresh after cooldown expiry must be allowed");
    }

    #[test]
    fn test_subscription_blocked_error_is_not_classified_as_session_auth_failure() {
        let lower = SUBSCRIPTION_BLOCKED_ERROR.to_lowercase();
        assert!(!lower.contains("not authenticated"), "must not trigger frontend auth-nudge");
        assert!(!lower.contains("expired"), "must not trigger frontend logout flow");
    }

    #[test]
    fn test_stream_quality_ladder_prefers_hires_lossless() {
        let ladder = stream_quality_ladder();
        assert_eq!(ladder.first(), Some(&"HI_RES_LOSSLESS"));
        assert!(ladder.contains(&"HI_RES"));
        assert!(ladder.contains(&"LOSSLESS"));
        assert!(ladder.contains(&"HIGH"));
        assert_eq!(ladder.last(), Some(&"LOW"));
    }

    #[test]
    fn test_tidal_refresh_status_code_classification() {
        // Permanent 401 Unauthorized -> clears session regardless of body
        assert!(is_permanent_auth_failure(reqwest::StatusCode::UNAUTHORIZED, None));
        assert!(is_permanent_auth_failure(reqwest::StatusCode::UNAUTHORIZED, Some("invalid token")));

        // 400 Bad Request -> only permanent if body indicates revoked/invalid grant or client
        assert!(is_permanent_auth_failure(reqwest::StatusCode::BAD_REQUEST, Some("{\"error\":\"invalid_grant\"}")));
        assert!(is_permanent_auth_failure(reqwest::StatusCode::BAD_REQUEST, Some("{\"error\":\"invalid_client\"}")));
        assert!(is_permanent_auth_failure(reqwest::StatusCode::BAD_REQUEST, Some("{\"error\":\"unauthorized_client\"}")));

        // 400 Bad Request with non-fatal or missing error body -> preserve session
        assert!(!is_permanent_auth_failure(reqwest::StatusCode::BAD_REQUEST, None));
        assert!(!is_permanent_auth_failure(reqwest::StatusCode::BAD_REQUEST, Some("{\"error\":\"temporary_error\"}")));
        assert!(!is_permanent_auth_failure(reqwest::StatusCode::BAD_REQUEST, Some("Bad Request syntax")));

        // Transient errors and rate limits -> preserve session
        assert!(!is_permanent_auth_failure(reqwest::StatusCode::TOO_MANY_REQUESTS, Some("rate limit")));
        assert!(!is_permanent_auth_failure(reqwest::StatusCode::INTERNAL_SERVER_ERROR, None));
        assert!(!is_permanent_auth_failure(reqwest::StatusCode::BAD_GATEWAY, None));
        assert!(!is_permanent_auth_failure(reqwest::StatusCode::SERVICE_UNAVAILABLE, None));
        assert!(!is_permanent_auth_failure(reqwest::StatusCode::GATEWAY_TIMEOUT, None));
        assert!(!is_permanent_auth_failure(reqwest::StatusCode::FORBIDDEN, None));
    }

    fn hub_track(id: &str, title: &str, artist: &str, duration: u32) -> TidalTrackResult {
        TidalTrackResult {
            id: id.to_string(),
            title: title.to_string(),
            artist: artist.to_string(),
            album: "Album".to_string(),
            duration,
            cover_url: String::new(),
            quality: "LOSSLESS".to_string(),
        }
    }

    #[test]
    fn test_hub_seed_queries_empty_falls_back_to_top_tracks() {
        let queries = hub_seed_queries(vec![]);
        assert_eq!(queries, vec!["Top Tracks".to_string()]);
    }

    #[test]
    fn test_hub_seed_queries_maps_artists_to_radio_searches() {
        let queries = hub_seed_queries(vec!["Aurora".to_string(), "Sigur Rós".to_string()]);
        assert_eq!(queries, vec!["Aurora Radio".to_string(), "Sigur Rós Radio".to_string()]);
    }

    #[test]
    fn test_hub_seed_queries_caps_at_six_and_skips_blank_seeds() {
        let seeds: Vec<String> = ["A", "B", "C", "D", "E", "F", "G", "  ", ""]
            .iter()
            .map(|s| s.to_string())
            .collect();
        let queries = hub_seed_queries(seeds);
        assert_eq!(queries.len(), 6);
        assert_eq!(queries[0], "A Radio");
        assert_eq!(queries[5], "F Radio");
    }

    #[test]
    fn test_tidal_track_signature_matches_library_normalization() {
        // Must mirror youtube's library signature format: normalize_artist_name + clean_title
        let sig = tidal_track_signature("The Beatles", "Let It Be (Remastered 2009)");
        assert_eq!(sig, format!("{}::{}", crate::youtube::normalize_artist_name("The Beatles"), clean_title("Let It Be (Remastered 2009)")));
    }

    #[test]
    fn test_dedupe_hub_candidates_drops_cross_seed_duplicates() {
        let candidates = vec![
            hub_track("1", "Ocean Eyes", "Wanderer", 210),
            hub_track("2", "Ocean Eyes", "wanderer!", 215),
        ];
        let out = dedupe_hub_candidates(candidates, &std::collections::HashSet::new());
        assert_eq!(out.len(), 1, "same song found via two seed searches must collapse to one pick");
        assert_eq!(out[0].id, "1", "first occurrence wins");
    }

    #[test]
    fn test_dedupe_hub_candidates_excludes_library_and_other_sources() {
        let mut exclude = std::collections::HashSet::new();
        exclude.insert(tidal_track_signature("Wanderer", "Ocean Eyes"));
        let candidates = vec![
            hub_track("1", "Ocean Eyes", "Wanderer", 210),
            hub_track("2", "Northern Lights", "Aurora", 240),
        ];
        let out = dedupe_hub_candidates(candidates, &exclude);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].id, "2");
    }

    #[test]
    fn test_dedupe_hub_candidates_filters_marathon_and_instrumental_tracks() {
        let candidates = vec![
            hub_track("1", "Epic Suite", "Orchestra", 901),
            hub_track("2", "My Song (Instrumental Version)", "Cover Band", 300),
            hub_track("3", "Real Song", "Real Artist", 400),
        ];
        let out = dedupe_hub_candidates(candidates, &std::collections::HashSet::new());
        assert_eq!(out.len(), 1, ">15min and third-party/instrumental entries must be dropped");
        assert_eq!(out[0].id, "3");
    }
}

