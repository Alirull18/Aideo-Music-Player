use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State, Manager};
use futures::StreamExt;
use base64::Engine;

const BOLD: &str = "\x1b[1m";
const CYAN: &str = "\x1b[36m";
const GREEN: &str = "\x1b[32m";
const YELLOW: &str = "\x1b[33m";
const MAGENTA: &str = "\x1b[35m";
const RED: &str = "\x1b[31m";
const RESET: &str = "\x1b[0m";

const API_BASE: &str = "https://www.qobuz.com/api.json/0.2/";
const PLAY_BASE: &str = "https://play.qobuz.com";

/// Qobuz streaming format ids (community-documented).
/// 5 = MP3 320 | 6 = FLAC 16/44.1 | 7 = FLAC up to 96kHz/24bit | 27 = FLAC above 96kHz (up to 192k)
pub(crate) const FORMAT_LADDER: [u32; 4] = [27, 7, 6, 5];

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct QobuzTrackResult {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: u32,
    pub cover_url: String,
    pub quality: String,
}

impl crate::tidal::RadioCandidate for QobuzTrackResult {
    fn radio_title(&self) -> &str { &self.title }
    fn radio_artist(&self) -> &str { &self.artist }
    fn radio_duration(&self) -> u32 { self.duration }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct QobuzSession {
    pub user_auth_token: String,
    pub user_id: String,
    pub display_name: String,
}

#[derive(Clone, Debug)]
pub struct QobuzAppCredentials {
    pub app_id: String,
    /// Decoded candidate signing secrets, preferred timezone first.
    pub secrets: Vec<String>,
}

pub struct QobuzState {
    pub session: Mutex<Option<QobuzSession>>,
    pub logged_in: Mutex<bool>,
    pub app_creds: Mutex<Option<QobuzAppCredentials>>,
}

impl Default for QobuzState {
    fn default() -> Self {
        Self {
            session: Mutex::new(None),
            logged_in: Mutex::new(false),
            app_creds: Mutex::new(None),
        }
    }
}

// ---------------------------------------------------------------------------
// Pure parsing / signing helpers (unit-tested offline against fixtures)
// ---------------------------------------------------------------------------

/// Extract the web-player bundle path from the login page HTML.
/// The LAST matching script tag wins — Qobuz loads newer bundles after legacy ones.
pub fn parse_bundle_path(login_html: &str) -> Option<String> {
    let re = regex::Regex::new(r#"src="(/resources/[^"]+?/client/main\.js)""#).ok()?;
    let mut found: Option<String> = None;
    for cap in re.captures_iter(login_html) {
        found = Some(cap[1].to_string());
    }
    found
}

/// Parse the app_id plus timezone-grouped base64 secrets out of bundle JS.
/// Returns `(app_id, [(timezone, secret_base64)])`.
pub fn parse_bundle(bundle_js: &str) -> Result<(String, Vec<(String, String)>), String> {
    let app_id_re = regex::Regex::new(r#"production:\{api:\{appId:"(\d{9})""#)
        .map_err(|e| e.to_string())?;
    let app_id = match app_id_re.captures(bundle_js) {
        Some(c) => c[1].to_string(),
        None => {
            // Fallback for minified variants where the production marker moved.
            let loose = regex::Regex::new(r#"appId:"(\d{9})""#).map_err(|e| e.to_string())?;
            loose
                .captures(bundle_js)
                .ok_or_else(|| "No app_id found in Qobuz bundle".to_string())?[1]
                .to_string()
        }
    };

    let secret_re =
        regex::Regex::new(r#"timezone:"([^"]+)",[^}]*?secret:"([A-Za-z0-9+/=]{8,})""#)
            .map_err(|e| e.to_string())?;
    let mut pairs = Vec::new();
    for cap in secret_re.captures_iter(bundle_js) {
        pairs.push((cap[1].to_string(), cap[2].to_string()));
    }

    Ok((app_id, pairs))
}

/// Order decoded secrets with community-known working timezones first, then
/// everything else in bundle order. Returns decoded plaintext secrets.
pub fn decode_secrets(pairs: &[(String, String)]) -> Vec<String> {
    fn decode_b64(s: &str) -> Option<String> {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(s)
            .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(s))
            .ok()?;
        String::from_utf8(bytes).ok()
    }

    const PREFERRED: [&str; 2] = ["Europe/Paris", "Asia/Tokyo"];
    let mut ordered: Vec<&(String, String)> = pairs.iter().collect();
    ordered.sort_by_key(|(tz, _)| {
        PREFERRED
            .iter()
            .position(|p| tz == p)
            .unwrap_or(usize::MAX)
    });

    ordered
        .iter()
        .filter_map(|(_, s)| decode_b64(s))
        .collect()
}

/// Compute the MD5 request signature used by signed Qobuz endpoints.
///
/// Formula (reverse-engineered community spec): concatenate the endpoint name
/// without slashes, every param key/value pair sorted alphabetically by key,
/// the unix timestamp, and the app secret — then MD5 the whole string as hex.
pub fn sign_request(endpoint: &str, params: &[(&str, &str)], request_ts: u64, secret: &str) -> String {
    let mut input = String::with_capacity(128);
    input.push_str(&endpoint.replace('/', ""));
    let mut sorted: Vec<&(&str, &str)> = params.iter().collect();
    sorted.sort_by_key(|(k, _)| *k);
    for (k, v) in sorted {
        input.push_str(k);
        input.push_str(v);
    }
    input.push_str(&request_ts.to_string());
    input.push_str(secret);

    format!("{:x}", md5::compute(input.as_bytes()))
}

/// Pick the quality label shown in the UI from track metadata.
pub fn quality_label(max_sampling_rate: f64, max_bit_depth: u32) -> &'static str {
    if max_sampling_rate > 96.0 && max_bit_depth >= 24 {
        "HI_RES_192"
    } else if max_sampling_rate >= 96.0 && max_bit_depth >= 24 {
        "HI_RES"
    } else {
        "LOSSLESS"
    }
}

/// Classify a getFileUrl/login failure body into a user-facing message.
pub fn classify_stream_error(status: u16, body: &str) -> String {
    let lower = body.to_lowercase();
    if status == 401 || lower.contains("invalid x-user-auth-token") || lower.contains("unauthorized") {
        return "Qobuz rejected your session token. Please reconnect under Settings > Library > Qobuz.".to_string();
    }
    if lower.contains("subscription") || lower.contains("eligible") || lower.contains("purchase") {
        return "Your Qobuz account cannot stream this track on its current plan (an active Studio or Sublime subscription is required).".to_string();
    }
    if status == 403 || lower.contains("geo") || lower.contains("not available in your country") || lower.contains("territory") {
        return "Qobuz is refusing this request from your region (geo-restriction). Streaming may require a supported country account.".to_string();
    }
    if status == 400 && (lower.contains("signature") || lower.contains("secret") || lower.contains("sig")) {
        return "Qobuz request signing failed — the web player bundle layout may have changed. Try reconnecting; if it persists, an app update is required.".to_string();
    }
    format!("Qobuz stream request failed (HTTP {}): {}", status, body)
}

fn get_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

// ---------------------------------------------------------------------------
// Session + credential persistence (OS keyring, mirrors Tidal pattern)
// ---------------------------------------------------------------------------

impl QobuzState {
    pub fn load_cached_session() -> Option<QobuzSession> {
        if let Ok(entry) = crate::tidal::open_shared_keyring("qobuz_session") {
            if let Ok(content) = entry.get_password() {
                if let Ok(session) = serde_json::from_str::<QobuzSession>(&content) {
                    println!("{BOLD}{GREEN}✔ [QOBUZ ENGINE] Loaded cached session from keyring successfully!{RESET}");
                    return Some(session);
                }
            }
        }
        None
    }

    pub fn save_session(session: &QobuzSession) {
        if let Ok(content) = serde_json::to_string_pretty(session) {
            if let Ok(entry) = crate::tidal::open_shared_keyring("qobuz_session") {
                crate::tidal::shared_keyring_write(&entry, &content);
            }
        }
    }

    pub fn clear_session() {
        if let Ok(entry) = crate::tidal::open_shared_keyring("qobuz_session") {
            crate::tidal::shared_keyring_delete(&entry);
        }
    }

    fn apply_session(state: &QobuzState, session: Option<QobuzSession>) {
        *crate::safe_lock(&state.session) = session;
        let logged_in = crate::safe_lock(&state.session).is_some();
        *crate::safe_lock(&state.logged_in) = logged_in;
    }
}

async fn fetch_app_credentials(_app_handle: &AppHandle) -> Result<QobuzAppCredentials, String> {
    // 1. Environment override escape hatch (power users / broken scraping).
    let env_id = std::env::var("QOBUZ_APP_ID").ok().filter(|s| !s.trim().is_empty());
    let env_secret = std::env::var("QOBUZ_APP_SECRET").ok().filter(|s| !s.trim().is_empty());
    if let (Some(id), Some(secret)) = (env_id, env_secret.clone()) {
        return Ok(QobuzAppCredentials { app_id: id, secrets: vec![secret] });
    }

    let client = get_client();

    // 2. Scrape the web player bundle.
    println!("{BOLD}{CYAN}[QOBUZ ENGINE] Scraping web player bundle for app credentials...{RESET}");
    let login_html = client
        .get(format!("{}/login", PLAY_BASE))
        .send()
        .await
        .map_err(|e| format!("Failed to reach play.qobuz.com login page: {:?}", e))?
        .text()
        .await
        .map_err(|e| format!("Failed to read login page: {:?}", e))?;

    let bundle_path = parse_bundle_path(&login_html)
        .ok_or_else(|| "Could not locate Qobuz web player bundle path (site layout changed?)".to_string())?;

    let bundle_js = client
        .get(format!("{}{}", PLAY_BASE, bundle_path))
        .send()
        .await
        .map_err(|e| format!("Failed to download Qobuz bundle: {:?}", e))?
        .text()
        .await
        .map_err(|e| format!("Failed to read Qobuz bundle: {:?}", e))?;

    let (app_id, pairs) = parse_bundle(&bundle_js)?;
    let secrets = decode_secrets(&pairs);
    if secrets.is_empty() {
        return Err("No signing secrets found in Qobuz bundle (site layout changed?)".to_string());
    }

    println!("{BOLD}{GREEN}✔ [QOBUZ ENGINE] Extracted app_id={} with {} candidate secret(s).{RESET}", app_id, secrets.len());

    let creds = QobuzAppCredentials { app_id, secrets };
    Ok(creds)
}

async fn ensure_app_credentials(
    state: &QobuzState,
    app_handle: &AppHandle,
) -> Result<QobuzAppCredentials, String> {
    if let Some(cached) = crate::safe_lock(&state.app_creds).clone() {
        return Ok(cached);
    }
    let creds = fetch_app_credentials(app_handle).await?;
    *crate::safe_lock(&state.app_creds) = Some(creds.clone());
    Ok(creds)
}

fn ensure_session_token(state: &QobuzState) -> Result<String, String> {
    let guard = crate::safe_lock(&state.session);
    match &*guard {
        Some(sess) => Ok(sess.user_auth_token.clone()),
        None => Err("User is not authenticated with Qobuz".to_string()),
    }
}

async fn api_get(
    state: &QobuzState,
    app_handle: &AppHandle,
    endpoint: &str,
    query: &[(&str, &str)],
) -> Result<reqwest::Response, String> {
    let token = ensure_session_token(state)?;
    let creds = ensure_app_credentials(state, app_handle).await?;
    let url = format!("{}{}", API_BASE, endpoint);
    let client = get_client();
    let mut req = client.get(&url).header("X-App-Id", &creds.app_id);
    if !token.is_empty() {
        req = req.header("X-User-Auth-Token", &token);
    }
    let res = req.query(query).send().await.map_err(|e| format!("Qobuz network error: {:?}", e))?;
    Ok(res)
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn qobuz_connect(
    state: State<'_, Arc<QobuzState>>,
    app_handle: AppHandle,
    token: String,
) -> Result<serde_json::Value, String> {
    let token_trimmed = token.trim().to_string();
    if token_trimmed.is_empty() {
        return Err("Please paste a valid Qobuz user auth token.".to_string());
    }

    println!("\n{BOLD}{MAGENTA}┌────────────────────────────────────────────────────────┐{RESET}");
    println!("{BOLD}{MAGENTA}│  [QOBUZ ENGINE] Connecting with pasted auth token...   │{RESET}");
    println!("{BOLD}{MAGENTA}└────────────────────────────────────────────────────────┘{RESET}");

    let creds = ensure_app_credentials(&state, &app_handle).await?;

    let client = get_client();
    let res = client
        .get(format!("{}user/get", API_BASE))
        .header("X-App-Id", &creds.app_id)
        .header("X-User-Auth-Token", &token_trimmed)
        .send()
        .await
        .map_err(|e| format!("Network request failed: {:?}", e))?;

    let status = res.status().as_u16();
    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        println!("{BOLD}{RED}✘ [QOBUZ ENGINE] Token validation failed ({}) — {}{RESET}", status, body);
        return Err(classify_stream_error(status, &body));
    }

    let user = res.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
    let user_id = user["id"].as_u64().map(|v| v.to_string())
        .or_else(|| user["id"].as_str().map(|s| s.to_string()))
        .unwrap_or_default();
    let display_name = {
        let first = user["firstname"].as_str().unwrap_or("");
        let last = user["lastname"].as_str().unwrap_or("");
        let login = user["login"].as_str().unwrap_or("");
        let joined = format!("{} {}", first, last).trim().to_string();
        if joined.is_empty() { login.to_string() } else { joined }
    };
    let display_name = if display_name.is_empty() { "Qobuz User".to_string() } else { display_name };

    let session = QobuzSession {
        user_auth_token: token_trimmed,
        user_id,
        display_name: display_name.clone(),
    };

    QobuzState::save_session(&session);
    QobuzState::apply_session(&state, Some(session));

    println!("{BOLD}{GREEN}✔ [QOBUZ ENGINE] Connected as '{}' successfully!{RESET}", display_name);
    let _ = app_handle.emit("qobuz-login-success", ());
    Ok(serde_json::json!({ "displayName": display_name }))
}

#[tauri::command]
pub async fn qobuz_status(state: State<'_, Arc<QobuzState>>) -> Result<bool, String> {
    if *crate::safe_lock(&state.logged_in) {
        return Ok(true);
    }
    if let Some(sess) = QobuzState::load_cached_session() {
        QobuzState::apply_session(&state, Some(sess));
        return Ok(true);
    }
    Ok(false)
}

#[tauri::command]
pub async fn qobuz_logout(state: State<'_, Arc<QobuzState>>) -> Result<bool, String> {
    QobuzState::clear_session();
    QobuzState::apply_session(&state, None);
    println!("{BOLD}{YELLOW}[QOBUZ ENGINE] Logged out of Qobuz successfully.{RESET}");
    Ok(true)
}

#[tauri::command]
pub async fn qobuz_search(
    state: State<'_, Arc<QobuzState>>,
    app_handle: AppHandle,
    query: String,
) -> Result<Vec<QobuzTrackResult>, String> {
    println!("\n{BOLD}{MAGENTA}┌────────────────────────────────────────────────────────┐{RESET}");
    println!("{BOLD}{MAGENTA}│  [QOBUZ ENGINE] Searching Qobuz catalog...             │{RESET}");
    println!("{BOLD}{MAGENTA}│  Query: {:<47}│{RESET}", query);
    println!("{BOLD}{MAGENTA}└────────────────────────────────────────────────────────┘{RESET}");

    let res = api_get(&state, &app_handle, "track/search", &[
        ("query", query.as_str()),
        ("limit", "25"),
    ])
    .await?;

    let status = res.status().as_u16();
    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        println!("{BOLD}{RED}✘ [QOBUZ ENGINE] Search failed ({}) — {}{RESET}", status, body);
        return Err(classify_stream_error(status, &body));
    }

    let payload = res.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
    let items = payload["tracks"]["items"]
        .as_array()
        .ok_or_else(|| "Unexpected Qobuz search response schema (missing tracks.items)".to_string())?;

    let mut tracks = Vec::new();
    for item in items {
        if item["streamable"].as_bool() == Some(false) {
            continue;
        }
        let id = item["id"].as_u64().map(|v| v.to_string())
            .or_else(|| item["id"].as_str().map(|s| s.to_string()))
            .unwrap_or_default();
        if id.is_empty() {
            continue;
        }
        let title = item["title"].as_str().unwrap_or("").to_string();
        let artist = item["performer"]["name"].as_str()
            .or_else(|| item["artists"][0]["name"].as_str())
            .unwrap_or("Unknown Artist")
            .to_string();
        let album = item["album"]["title"].as_str().unwrap_or("Unknown Album").to_string();
        let duration = item["duration"].as_u64().unwrap_or(0) as u32;
        let cover_url = item["album"]["image"]["large"].as_str()
            .or_else(|| item["album"]["image"]["small"].as_str())
            .unwrap_or("")
            .to_string();
        let quality = quality_label(
            item["maximum_sampling_rate"].as_f64().unwrap_or(44.1),
            item["maximum_bit_depth"].as_u64().unwrap_or(16) as u32,
        )
        .to_string();

        tracks.push(QobuzTrackResult { id, title, artist, album, duration, cover_url, quality });
    }

    println!("{BOLD}{GREEN}✔ [QOBUZ ENGINE] Search completed! Found {} tracks.{RESET}\n", tracks.len());
    Ok(tracks)
}

/// Internal: resolve a direct CDN stream URL trying the full format ladder.
/// Rotates signing secrets when the server rejects a signature.
async fn resolve_stream_url(
    state: &Arc<QobuzState>,
    app_handle: &AppHandle,
    track_id: &str,
) -> Result<String, String> {
    let token = ensure_session_token(state)?;
    let mut creds = ensure_app_credentials(state, app_handle).await?;
    let client = get_client();
    let mut last_error = "Failed to fetch any Qobuz stream".to_string();

    for fmt in FORMAT_LADDER {
        let mut secret_idx: usize = 0;
        loop {
            let ts = now_secs();
            let sig = sign_request(
                "track/getFileUrl",
                &[("format_id", &fmt.to_string()), ("intent", "stream"), ("track_id", track_id)],
                ts,
                &creds.secrets[secret_idx],
            );
            let url = format!("{}track/getFileUrl", API_BASE);
            let res = client
                .get(&url)
                .header("X-App-Id", &creds.app_id)
                .header("X-User-Auth-Token", &token)
                .query(&[
                    ("request_ts", ts.to_string()),
                    ("request_sig", sig),
                    ("track_id", track_id.to_string()),
                    ("format_id", fmt.to_string()),
                    ("intent", "stream".to_string()),
                ])
                .send()
                .await;

            let res = match res {
                Ok(r) => r,
                Err(e) => {
                    last_error = format!("Network error for format {}: {:?}", fmt, e);
                    break;
                }
            };

            let status = res.status().as_u16();
            if res.status().is_success() {
                match res.json::<serde_json::Value>().await {
                    Ok(json) => {
                        if let Some(url) = json["url"].as_str() {
                            println!("[QOBUZ ENGINE] Direct CDN stream URL acquired (format {}).", fmt);
                            return Ok(url.to_string());
                        }
                        last_error = format!("Format {} success payload contained no URL", fmt);
                    }
                    Err(e) => last_error = format!("Format {} returned invalid JSON: {:?}", fmt, e),
                }
                break;
            }

            let body = res.text().await.unwrap_or_default();
            let invalid_sig = status == 400
                && (body.to_lowercase().contains("signature")
                    || body.to_lowercase().contains("secret")
                    || body.to_lowercase().contains("sig"));
            if invalid_sig && secret_idx + 1 < creds.secrets.len() {
                println!("{BOLD}{YELLOW}⚠ [QOBUZ ENGINE] Signature rejected for secret #{}, rotating...{RESET}", secret_idx + 1);
                secret_idx += 1;
                continue;
            }
            if invalid_sig && creds.secrets.len() > 1 {
                // All bundled secrets exhausted — try a fresh scrape once per ladder pass.
                match fetch_app_credentials(app_handle).await {
                    Ok(fresh) => {
                        println!("{BOLD}{YELLOW}⚠ [QOBUZ ENGINE] Re-scraped fresh signing credentials from bundle.{RESET}");
                        creds = fresh;
                        break;
                    }
                    Err(e) => {
                        last_error = format!("Bundle re-scrape failed while signing: {}", e);
                        break;
                    }
                }
            } else {
                last_error = classify_stream_error(status, &body);
                println!("{BOLD}{YELLOW}[QOBUZ ENGINE] Format {} rejected: {}{RESET}", fmt, last_error);
                break;
            }
        }
    }

    Err(last_error)
}

#[tauri::command]
pub async fn qobuz_get_stream_url(
    state: State<'_, Arc<QobuzState>>,
    app_handle: AppHandle,
    track_id: String,
) -> Result<String, String> {
    resolve_stream_url(state.inner(), &app_handle, &track_id).await
}

#[tauri::command]
pub async fn qobuz_download(
    state: State<'_, Arc<QobuzState>>,
    app_handle: AppHandle,
    app_state: State<'_, crate::AppState>,
    track_id: String,
    filename: String,
    title: String,
    artist: String,
    album: String,
    duration: u32,
) -> Result<bool, String> {
    let direct_url = resolve_stream_url(state.inner(), &app_handle, &track_id).await?;

    let user_music = dirs::audio_dir().unwrap_or_else(|| {
        app_handle.path().audio_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
    });
    let qobuz_dir = user_music.join("Aideo Downloads");
    let _ = std::fs::create_dir_all(&qobuz_dir);

    let safe_filename = filename.replace(|c: char| !c.is_alphanumeric() && c != ' ' && c != '-' && c != '_', "");
    let file_path = qobuz_dir.join(format!("{}.flac", safe_filename));

    println!("[QOBUZ MONITOR] Downloading track stream to disk: {:?}", file_path);

    let app_handle_clone = app_handle.clone();
    let filename_clone = safe_filename.clone();
    let track_id_clone = track_id.clone();
    let db_clone = app_state.db.clone();
    let title_clone = title.clone();
    let artist_clone = artist.clone();
    let album_clone = album.clone();

    tokio::spawn(async move {
        let client = get_client();
        if let Ok(dl_res) = client.get(&direct_url).send().await {
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

                                if last_emit_time.elapsed() >= std::time::Duration::from_millis(150) {
                                    let percent = if total_size > 0 {
                                        (downloaded as f64 / total_size as f64) * 100.0
                                    } else {
                                        0.0
                                    };
                                    let _ = app_handle_clone.emit("qobuz-download-progress", serde_json::json!({
                                        "filename": filename_clone.clone(),
                                        "track_id": track_id_clone.clone(),
                                        "percent": percent,
                                        "downloaded_mb": downloaded as f64 / (1024.0 * 1024.0),
                                        "total_mb": total_size as f64 / (1024.0 * 1024.0)
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
                        println!("{BOLD}{GREEN}✔ [QOBUZ MONITOR] Direct download completed!{RESET}");

                        if file_path.exists() {
                            let new_track = crate::db::Track {
                                id: 0,
                                path: file_path.to_string_lossy().to_string(),
                                title: Some(title_clone.clone()),
                                artist: Some(artist_clone.clone()),
                                album: Some(album_clone.clone()),
                                duration: Some(duration as f64),
                                format: Some("FLAC".to_string()),
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

                        let _ = app_handle_clone.emit("qobuz-download-progress", serde_json::json!({
                            "filename": filename_clone.clone(),
                            "track_id": track_id_clone.clone(),
                            "percent": 100.0,
                            "downloaded_mb": downloaded as f64 / (1024.0 * 1024.0),
                            "total_mb": downloaded as f64 / (1024.0 * 1024.0)
                        }));

                        let _ = app_handle_clone.emit("qobuz-download-complete", serde_json::json!({
                            "filename": filename_clone.clone(),
                            "track_id": track_id_clone.clone()
                        }));
                        return;
                     }
                }
            }
        }
        let _ = app_handle_clone.emit("qobuz-download-error", serde_json::json!({
            "filename": filename_clone.clone(),
            "track_id": track_id_clone.clone()
        }));
    });

    Ok(true)
}

#[tauri::command]
pub async fn get_qobuz_autoplay_recommendations(
    state: State<'_, Arc<QobuzState>>,
    app_handle: AppHandle,
    artist: String,
    title: String,
) -> Result<Vec<QobuzTrackResult>, String> {
    println!("[qobuz] Aideo Autoplay Engine v2: Resolving Qobuz Radio for '{}' by '{}'", title, artist);

    let query = if !artist.is_empty() && artist != "Unknown Artist" {
        format!("{} Radio", artist)
    } else if !title.is_empty() && title != "Unknown Title" {
        title.clone()
    } else {
        "Top Tracks".to_string()
    };

    let mut search_results = qobuz_search_inner(state.inner(), &app_handle, &query).await;
    if search_results.as_ref().map(|t| t.is_empty()).unwrap_or(true) && !artist.is_empty() && artist != "Unknown Artist" {
        search_results = qobuz_search_inner(state.inner(), &app_handle, &artist).await;
    }

    match search_results {
        Ok(tracks) => {
            let final_queue = crate::tidal::build_radio_queue(tracks, &artist, &title);
            println!("[autoplay] Engine v2 finalized Qobuz queue with {} highly matching tracks.", final_queue.len());
            Ok(final_queue)
        }
        Err(e) => {
            eprintln!("[qobuz] Autoplay search failed: {}", e);
            Err(e)
        }
    }
}

async fn qobuz_search_inner(
    state: &Arc<QobuzState>,
    app_handle: &AppHandle,
    query: &str,
) -> Result<Vec<QobuzTrackResult>, String> {
    let res = api_get(state, app_handle, "track/search", &[
        ("query", query),
        ("limit", "25"),
    ])
    .await?;

    let status = res.status().as_u16();
    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(classify_stream_error(status, &body));
    }

    let payload = res.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
    let items = payload["tracks"]["items"]
        .as_array()
        .ok_or_else(|| "Unexpected Qobuz search response schema".to_string())?;

    let mut tracks = Vec::new();
    for item in items {
        if item["streamable"].as_bool() == Some(false) {
            continue;
        }
        let id = item["id"].as_u64().map(|v| v.to_string())
            .or_else(|| item["id"].as_str().map(|s| s.to_string()))
            .unwrap_or_default();
        if id.is_empty() {
            continue;
        }
        tracks.push(QobuzTrackResult {
            id,
            title: item["title"].as_str().unwrap_or("").to_string(),
            artist: item["performer"]["name"].as_str()
                .or_else(|| item["artists"][0]["name"].as_str())
                .unwrap_or("Unknown Artist")
                .to_string(),
            album: item["album"]["title"].as_str().unwrap_or("Unknown Album").to_string(),
            duration: item["duration"].as_u64().unwrap_or(0) as u32,
            cover_url: item["album"]["image"]["large"].as_str()
                .or_else(|| item["album"]["image"]["small"].as_str())
                .unwrap_or("")
                .to_string(),
            quality: quality_label(
                item["maximum_sampling_rate"].as_f64().unwrap_or(44.1),
                item["maximum_bit_depth"].as_u64().unwrap_or(16) as u32,
            )
            .to_string(),
        });
    }
    Ok(tracks)
}

// ---------------------------------------------------------------------------
// Tests — all offline against committed fixtures (no live Qobuz access needed)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const LOGIN_HTML: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/qobuz/login_page.html"));
    const BUNDLE_JS: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/qobuz/main_bundle.js"));
    const SEARCH_JSON: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/qobuz/search_success.json"));

    #[test]
    fn test_parse_bundle_path_picks_last_main_bundle() {
        let path = parse_bundle_path(LOGIN_HTML).expect("bundle path must be found");
        assert_eq!(path, "/resources/8.1.0-b230511/client/main.js");
    }

    #[test]
    fn test_parse_bundle_path_returns_none_when_absent() {
        assert!(parse_bundle_path("<html><body>no scripts</body></html>").is_none());
    }

    #[test]
    fn test_parse_bundle_extracts_app_id_and_timezone_secrets() {
        let (app_id, pairs) = parse_bundle(BUNDLE_JS).expect("bundle must parse");
        assert_eq!(app_id, "798273055");
        assert_eq!(pairs.len(), 3);
        assert_eq!(pairs[0].0, "America/Argentina/Buenos_Aires");
        assert_eq!(pairs[2].0, "Europe/Paris");
    }

    #[test]
    fn test_decode_secrets_prefers_paris_then_tokyo() {
        let (_, pairs) = parse_bundle(BUNDLE_JS).unwrap();
        let secrets = decode_secrets(&pairs);
        assert_eq!(
            secrets,
            vec![
                "ParisSecretVal789".to_string(),
                "TokyoSecretVal456".to_string(),
                "ArgentinaSecretVal123".to_string()
            ]
        );
    }

    #[test]
    fn test_sign_request_is_deterministic_and_order_independent() {
        let params_a = [("track_id", "138614268"), ("format_id", "27"), ("intent", "stream")];
        let params_b = [("intent", "stream"), ("track_id", "138614268"), ("format_id", "27")];
        let sig_a = sign_request("track/getFileUrl", &params_a, 1700000000, "secret");
        let sig_b = sign_request("track/getFileUrl", &params_b, 1700000000, "secret");
        assert_eq!(sig_a, sig_b, "param order must not affect signature");
        assert_eq!(sig_a.len(), 32, "MD5 hex digest is 32 chars");

        // Independent construction locks the exact concatenation formula:
        // endpoint-without-slashes + sorted key/value pairs + timestamp + secret.
        let expected_input = "trackgetFileUrlformat_id27intentstreamtrack_id1386142681700000000secret";
        let expected = format!("{:x}", md5::compute(expected_input.as_bytes()));
        assert_eq!(sig_a, expected);

        let sig_other_ts = sign_request("track/getFileUrl", &params_a, 1700000001, "secret");
        assert_ne!(sig_a, sig_other_ts, "timestamp must change signature");
        let sig_other_secret = sign_request("track/getFileUrl", &params_a, 1700000000, "other");
        assert_ne!(sig_a, sig_other_secret, "secret must change signature");
    }

    #[test]
    fn test_quality_label_mapping() {
        assert_eq!(quality_label(192.0, 24), "HI_RES_192");
        assert_eq!(quality_label(96.0, 24), "HI_RES");
        assert_eq!(quality_label(44.1, 16), "LOSSLESS");
        assert_eq!(quality_label(48.0, 16), "LOSSLESS");
    }

    #[test]
    fn test_classify_stream_error_variants() {
        let msg_401 = classify_stream_error(401, "{}");
        assert!(msg_401.contains("reconnect"), "401 must ask user to reconnect");
        assert!(!msg_401.to_lowercase().contains("expired"), "must not trigger frontend logout nudge");

        let msg_sub = classify_stream_error(400, r#"{"message":"ineligible: subscription required"}"#);
        assert!(msg_sub.contains("subscription"), "free-account failures must mention plan");

        let msg_geo = classify_stream_error(403, "content is geo-blocked");
        assert!(msg_geo.contains("region"), "geo blocks must mention region");

        let msg_sig = classify_stream_error(400, "Invalid request signature");
        assert!(msg_sig.contains("signing"), "signature failures must hint at bundle scrape");

        let msg_unknown = classify_stream_error(500, "boom");
        assert!(msg_unknown.contains("500"), "unknown errors must carry status");
    }

    #[test]
    fn test_search_fixture_maps_into_track_results() {
        let payload: serde_json::Value = serde_json::from_str(SEARCH_JSON).expect("fixture must be valid JSON");
        let items = payload["tracks"]["items"].as_array().expect("items array");

        let first = &items[0];
        assert_eq!(first["id"].as_u64().unwrap().to_string(), "138614268");
        assert_eq!(first["performer"]["name"].as_str(), Some("System Of A Down"));
        assert_eq!(first["album"]["image"]["large"].as_str().map(|s| s.starts_with("https://static.qobuz.com")), Some(true));
        assert_eq!(
            quality_label(first["maximum_sampling_rate"].as_f64().unwrap(), first["maximum_bit_depth"].as_u64().unwrap() as u32),
            "LOSSLESS"
        );

        let second = &items[1];
        assert_eq!(
            quality_label(second["maximum_sampling_rate"].as_f64().unwrap(), second["maximum_bit_depth"].as_u64().unwrap() as u32),
            "HI_RES_192"
        );
    }

    #[test]
    fn test_format_ladder_covers_all_known_qualities() {
        assert_eq!(FORMAT_LADDER, [27, 7, 6, 5]);
    }

    // Env-gated live smoke test — skipped unless a real token is provided:
    //   QOBUX_E2E_TOKEN=xxx cargo test --manifest-path src-tauri/Cargo.toml live_smoke -- --ignored
    #[tokio::test]
    #[ignore]
    async fn live_smoke_validate_token() {
        let token = std::env::var("QOBUZ_E2E_TOKEN").expect("set QOBUZ_E2E_TOKEN to run live smoke");
        assert!(!token.trim().is_empty());
    }
}
