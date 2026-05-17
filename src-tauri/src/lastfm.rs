use reqwest::Client;
use std::collections::BTreeMap;
use serde_json::Value;

// IMPORTANT: You MUST replace these with your actual Last.fm API Key and Secret
// Get them here: https://www.last.fm/api/account/create
// Trigger Rebuild
const API_KEY: &str = match option_env!("LASTFM_API_KEY") { Some(v) => v, None => "YOUR_LASTFM_API_KEY" };
const API_SECRET: &str = match option_env!("LASTFM_API_SECRET") { Some(v) => v, None => "YOUR_LASTFM_API_SECRET" };
const API_URL: &str = "https://ws.audioscrobbler.com/2.0/";

fn sign_request(params: &mut BTreeMap<String, String>) {
    let mut sig_string = String::new();
    for (k, v) in params.iter() {
        if k != "format" && k != "callback" {
            sig_string.push_str(k);
            sig_string.push_str(v);
        }
    }
    sig_string.push_str(API_SECRET);
    let digest = md5::compute(sig_string);
    params.insert("api_sig".to_string(), format!("{:x}", digest));
}

fn encode_params(params: &BTreeMap<String, String>) -> String {
    let mut encoded = String::new();
    for (k, v) in params {
        if !encoded.is_empty() {
            encoded.push('&');
        }
        encoded.push_str(&urlencoding::encode(k));
        encoded.push('=');
        encoded.push_str(&urlencoding::encode(v));
    }
    encoded
}

// Phase 1: Get a temporary request token
pub async fn get_auth_token() -> Result<String, String> {
    let mut params = BTreeMap::new();
    params.insert("method".to_string(), "auth.getToken".to_string());
    params.insert("api_key".to_string(), API_KEY.to_string());

    sign_request(&mut params); // auth.getToken requires a signature
    params.insert("format".to_string(), "json".to_string());

    let client = Client::new();
    let res = client.get(format!("{}?{}", API_URL, encode_params(&params)))
        .send().await.map_err(|e| e.to_string())?;
    
    let json: Value = res.json().await.map_err(|e| e.to_string())?;

    if let Some(err_code) = json.get("error") {
        let msg = json.get("message").and_then(|m| m.as_str()).unwrap_or("Unknown Last.fm error");
        return Err(format!("Last.fm error {}: {}", err_code, msg));
    }
    
    if let Some(token) = json.get("token") {
        if let Some(s) = token.as_str() {
            return Ok(s.to_string());
        }
    }
    
    Err(format!("Unexpected Last.fm response: {}", json))
}

// Phase 2: Exchange token for a permanent session key
pub async fn get_session(token: &str) -> Result<String, String> {
    let mut params = BTreeMap::new();
    params.insert("method".to_string(), "auth.getSession".to_string());
    params.insert("token".to_string(), token.to_string());
    params.insert("api_key".to_string(), API_KEY.to_string());
    
    sign_request(&mut params);
    params.insert("format".to_string(), "json".to_string());

    let body_str = encode_params(&params);
    let client = Client::new();
    let res = client.post(API_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body_str)
        .send().await.map_err(|e| e.to_string())?;
    
    let json: Value = res.json().await.map_err(|e| e.to_string())?;
    
    if let Some(session) = json.get("session") {
        return Ok(session["key"].as_str().ok_or("No session key")?.to_string());
    }
    
    Err(json["message"].as_str().unwrap_or("Session exchange failed").to_string())
}

pub async fn scrobble(artist: &str, track: &str, timestamp: i64, session_key: &str) -> Result<(), String> {
    let mut params = BTreeMap::new();
    params.insert("method".to_string(), "track.scrobble".to_string());
    params.insert("artist".to_string(), artist.to_string());
    params.insert("track".to_string(), track.to_string());
    params.insert("timestamp".to_string(), timestamp.to_string());
    params.insert("api_key".to_string(), API_KEY.to_string());
    params.insert("sk".to_string(), session_key.to_string());
    
    sign_request(&mut params);
    params.insert("format".to_string(), "json".to_string());

    let body_str = encode_params(&params);
    let client = Client::new();
    let res = client.post(API_URL)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body_str)
        .send().await.map_err(|e| e.to_string())?;
    
    let json: Value = res.json().await.map_err(|e| e.to_string())?;

    // Check for API-level errors first
    if let Some(err_code) = json.get("error") {
        let msg = json.get("message").and_then(|m| m.as_str()).unwrap_or("Unknown Last.fm error");
        return Err(format!("Last.fm error {}: {}", err_code, msg));
    }

    if json.get("scrobbles").is_some() {
        Ok(())
    } else {
        Err(format!("Unexpected Last.fm response: {}", json))
    }
}

pub async fn get_user_info(session_key: &str) -> Result<Value, String> {
    let mut params = BTreeMap::new();
    params.insert("method".to_string(), "user.getInfo".to_string());
    params.insert("api_key".to_string(), API_KEY.to_string());
    params.insert("sk".to_string(), session_key.to_string());
    
    sign_request(&mut params);
    params.insert("format".to_string(), "json".to_string());

    let client = Client::new();
    let res = client.get(format!("{}?{}", API_URL, encode_params(&params)))
        .send().await.map_err(|e| e.to_string())?;
    
    let json: Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(json)
}

pub async fn get_recent_tracks(username: &str) -> Result<Value, String> {
    let mut params = BTreeMap::new();
    params.insert("method".to_string(), "user.getRecentTracks".to_string());
    params.insert("user".to_string(), username.to_string());
    params.insert("api_key".to_string(), API_KEY.to_string());
    params.insert("limit".to_string(), "10".to_string());
    
    params.insert("format".to_string(), "json".to_string());

    let client = Client::new();
    let res = client.get(format!("{}?{}", API_URL, encode_params(&params)))
        .send().await.map_err(|e| e.to_string())?;
    
    let json: Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(json)
}

pub async fn get_top_artists(username: &str) -> Result<Value, String> {
    let mut params = BTreeMap::new();
    params.insert("method".to_string(), "user.getTopArtists".to_string());
    params.insert("user".to_string(), username.to_string());
    params.insert("api_key".to_string(), API_KEY.to_string());
    params.insert("limit".to_string(), "10".to_string());
    params.insert("period".to_string(), "7day".to_string());
    
    params.insert("format".to_string(), "json".to_string());

    let client = Client::new();
    let res = client.get(format!("{}?{}", API_URL, encode_params(&params)))
        .send().await.map_err(|e| e.to_string())?;
    
    let json: Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(json)
}
