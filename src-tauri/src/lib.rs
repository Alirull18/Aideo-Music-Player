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
use tauri::{AppHandle, Emitter, Manager, State, Listener, Window};
use base64::Engine;

mod artwork;
mod db;
#[cfg(test)]
mod db_tests;
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
pub mod qobuz;
pub mod updater;
pub mod cloud;
pub mod link_resolver;
pub mod dependencies;
pub mod chromecast;
pub mod sonic_analyzer;
pub mod remote_server;
mod hotkeys;
mod m3u;
pub mod watcher;
pub mod tag_editor;
pub mod upnp;
pub mod logger;

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

fn clean_translated_text(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .trim()
        .to_string()
}

// ── Translation command ─────────────────────────────────────────────────────
#[tauri::command]
async fn translate_lyric_line(text: String) -> Result<(String, String), String> {
    if text.trim().is_empty() {
        return Ok((String::new(), String::new()));
    }
    let client = get_http_client();

    // 1. Try Google Translate API (JSON with transliteration dt=rm)
    let api_url = format!(
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&dt=rm&q={}",
        urlencoding::encode(&text)
    );

    if let Ok(res) = client
        .get(&api_url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .send()
        .await
    {
        if res.status().is_success() {
            if let Ok(data) = res.json::<serde_json::Value>().await {
                let translation = data.get(0)
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|item| item.get(0).and_then(|t| t.as_str()))
                            .collect::<Vec<_>>()
                            .join("")
                    })
                    .unwrap_or_default();
                
                let transliteration = data.get(0)
                    .and_then(|v| v.as_array())
                    .and_then(|arr| arr.iter().rev().find_map(|item| {
                        item.get(3).and_then(|t| t.as_str())
                            .or_else(|| item.get(2).and_then(|t| t.as_str()))
                    }))
                    .unwrap_or("")
                    .to_string();

                if !translation.is_empty() || !transliteration.is_empty() {
                    return Ok((clean_translated_text(&translation), transliteration));
                }
            }
        }
    }

    // 2. Fallback: Google Mobile Translate Web Scraper
    let mobile_url = format!(
        "https://translate.google.com/m?sl=auto&tl=en&q={}",
        urlencoding::encode(&text)
    );

    if let Ok(res) = client
        .get(&mobile_url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .send()
        .await
    {
        if let Ok(html) = res.text().await {
            if let Some(start) = html.find("<div class=\"result-container\">") {
                let rest = &html[start + 30..];
                if let Some(end) = rest.find("</div>") {
                    let trans = clean_translated_text(&rest[..end]);
                    return Ok((trans, String::new()));
                }
            }
        }
    }

    // 3. Fallback: MyMemory API
    let mymemory_url = format!(
        "https://api.mymemory.translated.net/get?q={}&langpair=auto|en",
        urlencoding::encode(&text)
    );

    if let Ok(res) = client.get(&mymemory_url).send().await {
        if let Ok(data) = res.json::<serde_json::Value>().await {
            if let Some(trans) = data["responseData"]["translatedText"].as_str() {
                let trans = clean_translated_text(trans);
                if !trans.starts_with("MYMEMORY WARNING:") {
                    return Ok((trans, String::new()));
                }
            }
        }
    }

    Ok((String::new(), String::new()))
}

async fn process_lyric_line_translation(line: String) -> (String, String) {
    if line.trim().is_empty() {
        (String::new(), String::new())
    } else {
        translate_lyric_line(line).await.unwrap_or_default()
    }
}

#[tauri::command]
async fn translate_lyrics_batch(lines: Vec<String>) -> Result<Vec<(String, String)>, String> {
    if lines.is_empty() {
        return Ok(Vec::new());
    }

    let tasks: Vec<_> = lines.into_iter().map(process_lyric_line_translation).collect();
    let results = futures::future::join_all(tasks).await;
    Ok(results)
}

pub fn is_trusted_oauth_host(host: &str) -> bool {
    let host = host.to_lowercase();
    let exact_hosts = [
        "accounts.google.com",
        "github.com",
        "last.fm",
        "www.last.fm",
        "auth.tidal.com",
        "login.tidal.com",
        "listenbrainz.org",
        "www.listenbrainz.org",
        "localhost",
        "127.0.0.1",
    ];
    if exact_hosts.contains(&host.as_str()) {
        return true;
    }
    let suffix_hosts = [
        ".supabase.co",
        ".tidal.com",
        ".last.fm",
        ".listenbrainz.org",
        ".google.com",
        ".github.com",
    ];
    for suffix in suffix_hosts {
        if host.ends_with(suffix) {
            return true;
        }
    }
    false
}

#[tauri::command]
async fn open_oauth_window(app_handle: tauri::AppHandle, url: String, provider: String) -> Result<(), String> {
    let parsed_url = url.parse::<tauri::Url>().map_err(|e| format!("Invalid OAuth URL: {}", e))?;
    
    // Validate host allowlist
    let host = parsed_url.host_str().ok_or_else(|| "Missing host in OAuth URL".to_string())?;
    if !is_trusted_oauth_host(host) {
        return Err(format!("Security violation: Target domain '{}' is not permitted for authentication", host));
    }

    // Validate scheme: HTTPS required for external providers; HTTP permitted only for local dev (localhost/127.0.0.1)
    let scheme = parsed_url.scheme();
    let is_local = host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1";
    if scheme != "https" && !(scheme == "http" && is_local) {
        return Err("Security violation: OAuth URL must use HTTPS".to_string());
    }

    let title = format!("Sign in with {}", if provider == "google" { "Google" } else { "GitHub" });
    
    if let Some(existing_win) = app_handle.get_webview_window("supabase-login") {
        let _ = existing_win.close();
    }

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
        let is_callback = if let Some(nav_host) = nav_url.host_str() {
            (nav_host.eq_ignore_ascii_case("localhost") && nav_url.port() == Some(1420))
                || nav_host.eq_ignore_ascii_case("alirull18.github.io")
        } else {
            false
        };
        let nav_str = nav_url.to_string();
        
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
async fn get_unison_ttml(
    song: String,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<f64>,
) -> Result<String, String> {
    let client = get_http_client();
    let timeout_dur = std::time::Duration::from_millis(3500);

    let art_param = artist.as_deref().unwrap_or("").trim();
    let song_param = song.trim();
    let query_str = format!("{} {}", art_param, song_param).trim().to_string();

    let req_fut = async {
        // 1. First attempt: BiniLyrics (Apple Music Word-Level TTML CDN)
        let bini_url = format!(
            "https://lyrics-api.binimum.org/getLyrics?q={}",
            urlencoding::encode(&query_str)
        );
        if let Ok(resp) = client
            .get(&bini_url)
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Aideo/0.9.7")
            .send()
            .await
        {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                if let Some(list) = data["results"].as_array() {
                    let mut sorted = list.clone();
                    sorted.sort_by_key(|item| {
                        if item["timing_type"].as_str() == Some("word") { 0 } else { 1 }
                    });
                    if let Some(first) = sorted.first() {
                        if let Some(url) = first["lyricsUrl"].as_str() {
                            if let Ok(ttml_res) = client.get(url).send().await {
                                if let Ok(body) = ttml_res.text().await {
                                    let trimmed = body.trim();
                                    if trimmed.starts_with('<') {
                                        return Ok(trimmed.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // 2. Second attempt: Better Lyrics / Unison (Crowdsourced TTML)
        let mut urls = vec![
            format!(
                "https://lyrics-api.boidu.dev/getLyrics?s={}&a={}",
                urlencoding::encode(song_param),
                urlencoding::encode(art_param)
            ),
            format!(
                "https://lyrics.boidu.dev/getLyrics?s={}&a={}",
                urlencoding::encode(song_param),
                urlencoding::encode(art_param)
            ),
        ];
        if let Some(ref alb) = album {
            if !alb.trim().is_empty() {
                urls[0].push_str(&format!("&album={}", urlencoding::encode(alb)));
            }
        }
        if let Some(dur) = duration {
            if dur > 0.0 {
                urls[0].push_str(&format!("&duration={:.1}", dur));
            }
        }

        for url in urls {
            if let Ok(resp) = client
                .get(&url)
                .header("Accept", "application/json, text/xml, */*")
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Aideo/0.9.7")
                .send()
                .await
            {
                if resp.status().is_success() {
                    if let Ok(body) = resp.text().await {
                        let trimmed = body.trim();
                        if trimmed.starts_with('<') {
                            return Ok(trimmed.to_string());
                        }
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(trimmed) {
                            if let Some(ttml) = json["ttml"].as_str()
                                .or_else(|| json["lyrics"].as_str())
                                .or_else(|| json["data"]["ttml"].as_str())
                                .or_else(|| json["data"]["lyrics"].as_str())
                            {
                                if !ttml.trim().is_empty() {
                                    return Ok(ttml.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }

        Err("No TTML lyrics found in BiniLyrics or Better Lyrics".to_string())
    };

    match tokio::time::timeout(timeout_dur, req_fut).await {
        Ok(res) => res,
        Err(_) => Err("TTML lyrics request timed out after 3.5s".to_string()),
    }
}

#[tauri::command]
async fn get_kugou_krc(id: String, accesskey: String) -> Result<String, String> {
    let client = get_http_client();
    let timeout_dur = std::time::Duration::from_millis(3500);
    let url = format!(
        "https://lyrics.kugou.com/download?ver=1&client=pc&id={}&accesskey={}&fmt=krc&charset=utf8",
        urlencoding::encode(&id),
        urlencoding::encode(&accesskey)
    );

    let fetch_fut = async {
        let resp = client
            .get(&url)
            .header("User-Agent", "KuGou/10000")
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        if let Some(content_b64) = data["content"].as_str() {
            if let Some(decoded) = lyrics::decode_krc(content_b64) {
                return Ok(decoded);
            }
        }
        Err("Failed to decode Kugou KRC lyrics".to_string())
    };

    match tokio::time::timeout(timeout_dur, fetch_fut).await {
        Ok(res) => res,
        Err(_) => Err("Kugou download request timed out after 3.5s".to_string()),
    }
}

#[tauri::command]
async fn search_lyrics_online(
    query: String,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<f64>,
) -> Result<Vec<SearchResult>, String> {
    let client = get_http_client();
    let timeout_dur = std::time::Duration::from_millis(3500);

    let explicit_title = title.as_deref().unwrap_or("").trim();
    let explicit_artist = artist.as_deref().unwrap_or("").trim();

    let (song, artist_opt) = if !explicit_title.is_empty() {
        (
            explicit_title.to_string(),
            if explicit_artist.is_empty() {
                None
            } else {
                Some(explicit_artist.to_string())
            },
        )
    } else if let Some(pos) = query.find(" - ") {
        let art = query[..pos].trim();
        let sng = query[pos + 3..].trim();
        (sng.to_string(), Some(art.to_string()))
    } else {
        (query.trim().to_string(), None)
    };

    let full_search_str = if let Some(ref art) = artist_opt {
        format!("{} {}", art, song)
    } else {
        query.clone()
    };
    let encoded_query = urlencoding::encode(&full_search_str);

    // 1. BiniLyrics (Apple Music Official Word-Sync TTML)
    let bini_query = full_search_str.clone();
    let bini_song_fallback = song.clone();
    let bini_fut = async {
        let mut results = Vec::new();
        let bini_url = format!(
            "https://lyrics-api.binimum.org/getLyrics?q={}",
            urlencoding::encode(&bini_query)
        );
        if let Ok(res) = client
            .get(&bini_url)
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Aideo/0.9.7")
            .send()
            .await
        {
            if let Ok(data) = res.json::<serde_json::Value>().await {
                if let Some(list) = data["results"].as_array() {
                    let mut sorted = list.clone();
                    sorted.sort_by_key(|item| {
                        if item["timing_type"].as_str() == Some("word") { 0 } else { 1 }
                    });

                    for item in sorted.iter().take(2) {
                        let track_name = item["track_name"].as_str().unwrap_or("").to_string();
                        let artist_name = item["artist_name"].as_str().unwrap_or("").to_string();
                        let dur = item["duration"].as_f64();
                        let timing = item["timing_type"].as_str().unwrap_or("").to_string();
                        let lyrics_url = item["lyricsUrl"].as_str().unwrap_or("").to_string();

                        if !lyrics_url.is_empty() {
                            let mut raw_ttml = None;
                            if let Ok(lyr_res) = client.get(&lyrics_url).send().await {
                                if let Ok(lyr_text) = lyr_res.text().await {
                                    if lyr_text.trim().starts_with('<') {
                                        raw_ttml = Some(lyr_text);
                                    }
                                }
                            }

                            results.push(SearchResult {
                                id: format!("binilyrics-{}", item["id"].as_str().unwrap_or("item")),
                                title: if track_name.is_empty() { bini_song_fallback.clone() } else { track_name },
                                artist: artist_name,
                                source: "BiniLyrics".to_string(),
                                synced: true,
                                content_id: Some(lyrics_url),
                                raw_lrc: raw_ttml,
                                duration: dur,
                            });
                            if timing == "word" {
                                break;
                            }
                        }
                    }
                }
            }
        }
        results
    };

    // 2. Better Lyrics / Unison API (Syllable-level TTML)
    let boidu_song = song.clone();
    let boidu_art = artist_opt.clone();
    let boidu_dur = duration;
    let boidu_alb = album.clone();
    let boidu_fut = async {
        let mut results = Vec::new();
        let art_str = boidu_art.as_deref().unwrap_or("");
        let mut urls = vec![
            format!(
                "https://lyrics-api.boidu.dev/getLyrics?s={}&a={}",
                urlencoding::encode(&boidu_song),
                urlencoding::encode(art_str)
            ),
            format!(
                "https://lyrics.boidu.dev/getLyrics?s={}&a={}",
                urlencoding::encode(&boidu_song),
                urlencoding::encode(art_str)
            ),
        ];
        if let Some(ref alb) = boidu_alb {
            if !alb.trim().is_empty() {
                urls[0].push_str(&format!("&album={}", urlencoding::encode(alb)));
            }
        }
        if let Some(dur) = boidu_dur {
            if dur > 0.0 {
                urls[0].push_str(&format!("&duration={:.1}", dur));
            }
        }

        for u in urls {
            if let Ok(res) = client.get(&u)
                .header("Accept", "application/json, text/xml, */*")
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Aideo/0.9.7")
                .send()
                .await
            {
                if res.status().is_success() {
                    if let Ok(body) = res.text().await {
                        let trimmed = body.trim();
                        let mut ttml_str = None;
                        if trimmed.starts_with('<') {
                            ttml_str = Some(trimmed.to_string());
                        } else if let Ok(json) = serde_json::from_str::<serde_json::Value>(trimmed) {
                            if let Some(s) = json["ttml"].as_str()
                                .or_else(|| json["lyrics"].as_str())
                                .or_else(|| json["data"]["ttml"].as_str())
                                .or_else(|| json["data"]["lyrics"].as_str())
                            {
                                if !s.trim().is_empty() {
                                    ttml_str = Some(s.to_string());
                                }
                            }
                        }

                        if let Some(ttml) = ttml_str {
                            let title_str = boidu_song.clone();
                            let art_name = art_str.to_string();
                            results.push(SearchResult {
                                id: format!("betterlyrics-{:x}", md5::compute(format!("{}-{}", title_str, art_name).as_bytes())),
                                title: title_str,
                                artist: art_name,
                                source: "Better Lyrics".to_string(),
                                synced: true,
                                content_id: Some(boidu_song.clone()),
                                raw_lrc: Some(ttml),
                                duration: boidu_dur,
                            });
                            break;
                        }
                    }
                }
            }
        }
        results
    };

    // 3. NetEase Cloud Music (YRC Word-Sync & KLyric Karaoke)
    let ne_fut = async {
        let mut results = Vec::new();
        let ne_url = format!(
            "https://music.163.com/api/search/get?s={}&type=1&limit=3",
            encoded_query
        );
        if let Ok(res) = client.get(&ne_url)
            .header("Referer", "https://music.163.com")
            .send().await
        {
            if let Ok(data) = res.json::<serde_json::Value>().await {
                if let Some(songs) = data["result"]["songs"].as_array() {
                    for item in songs.iter().take(2) {
                        let ne_id = item["id"].as_i64().map(|i| i.to_string())
                            .or_else(|| item["id"].as_str().map(|s| s.to_string()))
                            .unwrap_or_else(|| item["id"].to_string());

                        let mut raw_yrc = None;
                        let lyr_url = format!(
                            "https://music.163.com/api/song/lyric?id={}&lv=1&kv=1&tv=-1&os=pc&yv=1",
                            ne_id
                        );
                        if let Ok(lyr_res) = client.get(&lyr_url).header("Referer", "https://music.163.com").send().await {
                            if let Ok(lyr_data) = lyr_res.json::<serde_json::Value>().await {
                                if let Some(yrc_text) = lyr_data["yrc"]["lyric"].as_str()
                                    .or_else(|| lyr_data["klyric"]["lyric"].as_str())
                                    .or_else(|| lyr_data["lrc"]["lyric"].as_str())
                                {
                                    if !yrc_text.trim().is_empty() {
                                        raw_yrc = Some(yrc_text.to_string());
                                    }
                                }
                            }
                        }

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
                            raw_lrc: raw_yrc,
                            duration: item["duration"].as_f64().map(|ms| ms / 1000.0)
                                .or_else(|| item["dt"].as_f64().map(|ms| ms / 1000.0)),
                        });
                    }
                }
            }
        }
        results
    };

    // 4. Kugou (KRC Word-by-Word Sync)
    let kugou_search_query = full_search_str.clone();
    let kugou_song_fallback = song.clone();
    let kugou_fut = async {
        let mut results = Vec::new();
        let kugou_url = format!(
            "http://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword={}&duration=&hash=",
            urlencoding::encode(&kugou_search_query)
        );
        if let Ok(res) = client.get(&kugou_url)
            .header("User-Agent", "KuGou/10000")
            .send()
            .await
        {
            if let Ok(data) = res.json::<serde_json::Value>().await {
                if let Some(candidates) = data["candidates"].as_array() {
                    for cand in candidates.iter().take(2) {
                        let id = cand["id"].to_string();
                        let accesskey = cand["accesskey"].as_str().unwrap_or("").to_string();
                        let song_title = cand["song"].as_str().unwrap_or("").to_string();
                        let singer = cand["singer"].as_str().unwrap_or("").to_string();
                        let dur = cand["duration"].as_f64().map(|ms| ms / 1000.0);

                        if !accesskey.is_empty() {
                            let d_url = format!(
                                "http://lyrics.kugou.com/download?ver=1&client=pc&id={}&accesskey={}&fmt=krc&charset=utf8",
                                urlencoding::encode(&id),
                                urlencoding::encode(&accesskey)
                            );
                            if let Ok(d_res) = client.get(&d_url).header("User-Agent", "KuGou/10000").send().await {
                                if let Ok(d_data) = d_res.json::<serde_json::Value>().await {
                                    if let Some(content_b64) = d_data["content"].as_str() {
                                        if let Some(decoded_krc) = lyrics::decode_krc(content_b64) {
                                            results.push(SearchResult {
                                                id: format!("kugou-{}", id),
                                                title: if song_title.is_empty() { kugou_song_fallback.clone() } else { song_title },
                                                artist: singer,
                                                source: "Kugou".to_string(),
                                                synced: true,
                                                content_id: Some(id),
                                                raw_lrc: Some(decoded_krc),
                                                duration: dur,
                                            });
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        results
    };

    // 5. QQ Music (qrc word sync & lrc)
    let qq_fut = async {
        let mut results = Vec::new();
        let qq_url = format!(
            "https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=3&w={}&format=json",
            encoded_query
        );
        if let Ok(res) = client.get(&qq_url).send().await {
            if let Ok(data) = res.json::<serde_json::Value>().await {
                if let Some(songs) = data["data"]["song"]["list"].as_array() {
                    for item in songs.iter().take(2) {
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

    // 6. LRCLIB (Exact Match & Search)
    let lrc_song = song.clone();
    let lrc_art = artist_opt.clone();
    let lrc_fut = async {
        let mut results = Vec::new();

        // Exact match attempt if artist is known
        if let Some(ref art) = lrc_art {
            let get_url = format!(
                "https://lrclib.net/api/get?track_name={}&artist_name={}",
                urlencoding::encode(&lrc_song),
                urlencoding::encode(art)
            );
            if let Ok(res) = client.get(&get_url).send().await {
                if let Ok(item) = res.json::<serde_json::Value>().await {
                    if let Some(synced) = item["syncedLyrics"].as_str().or_else(|| item["plainLyrics"].as_str()) {
                        results.push(SearchResult {
                            id: item["id"].to_string(),
                            title: item["trackName"].as_str().unwrap_or(&lrc_song).to_string(),
                            artist: item["artistName"].as_str().unwrap_or(art).to_string(),
                            source: "LRCLIB".to_string(),
                            synced: !item["syncedLyrics"].is_null(),
                            content_id: None,
                            raw_lrc: Some(synced.to_string()),
                            duration: item["duration"].as_f64(),
                        });
                    }
                }
            }
        }

        // Search attempt
        let search_url = format!("https://lrclib.net/api/search?q={}", encoded_query);
        if let Ok(res) = client.get(&search_url).send().await {
            if let Ok(data) = res.json::<serde_json::Value>().await {
                if let Some(list) = data.as_array() {
                    for item in list.iter().take(3) {
                        let id_str = item["id"].to_string();
                        if !results.iter().any(|r| r.id == id_str) {
                            results.push(SearchResult {
                                id: id_str,
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
        }
        results
    };

    // Join all 6 providers concurrently with timeout
    let (bini_res, boidu_res, ne_res, kugou_res, qq_res, lrc_res) = tokio::join!(
        tokio::time::timeout(timeout_dur, bini_fut),
        tokio::time::timeout(timeout_dur, boidu_fut),
        tokio::time::timeout(timeout_dur, ne_fut),
        tokio::time::timeout(timeout_dur, kugou_fut),
        tokio::time::timeout(timeout_dur, qq_fut),
        tokio::time::timeout(timeout_dur, lrc_fut)
    );

    let mut results = Vec::new();
    if let Ok(r) = bini_res { results.extend(r); }
    if let Ok(r) = boidu_res { results.extend(r); }
    if let Ok(r) = ne_res { results.extend(r); }
    if let Ok(r) = kugou_res { results.extend(r); }
    if let Ok(r) = qq_res { results.extend(r); }
    if let Ok(r) = lrc_res { results.extend(r); }

    Ok(results)
}

#[tauri::command]
async fn get_netease_lrc(id: String) -> Result<String, String> {
    let client = get_http_client();
    let timeout_dur = std::time::Duration::from_millis(3500);
    let url = format!(
        "https://music.163.com/api/song/lyric?id={}&lv=1&kv=1&tv=-1&os=pc&yv=1",
        id
    );

    let fetch_fut = async {
        let res = client.get(&url)
            .header("Referer", "https://music.163.com")
            .send().await.map_err(|e| e.to_string())?;
        let data = res
            .json::<serde_json::Value>()
            .await
            .map_err(|e| e.to_string())?;
        let lrc = data["yrc"]["lyric"]
            .as_str()
            .or_else(|| data["klyric"]["lyric"].as_str())
            .or_else(|| data["lrc"]["lyric"].as_str())
            .ok_or("No lyric found")?
            .to_string();
        Ok(lrc)
    };

    match tokio::time::timeout(timeout_dur, fetch_fut).await {
        Ok(res) => res,
        Err(_) => Err("NetEase lyric request timed out after 3.5s".to_string()),
    }
}

#[tauri::command]
async fn get_qqmusic_lrc(mid: String) -> Result<String, String> {
    let client = get_http_client();
    let timeout_dur = std::time::Duration::from_millis(3500);
    let url = format!("https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid={}&format=json&nobase64=1", mid);

    let fetch_fut = async {
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
        let lrc = data["lyric"].as_str()
            .or_else(|| data["qrc"].as_str())
            .ok_or("No lyric found")?.to_string();

        if !lrc.contains('[') && lrc.len() > 10 {
            use base64::{engine::general_purpose, Engine as _};
            if let Ok(decoded) = general_purpose::STANDARD.decode(lrc.trim()) {
                if let Ok(s) = String::from_utf8(decoded) {
                    return Ok(s);
                }
            }
        }

        Ok(lrc)
    };

    match tokio::time::timeout(timeout_dur, fetch_fut).await {
        Ok(res) => res,
        Err(_) => Err("QQ Music lyric request timed out after 3.5s".to_string()),
    }
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
fn set_discord_enabled(enabled: bool) {
    discord::set_enabled(enabled);
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
    let _is_playing = {
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

    #[cfg(feature = "asio")]
    #[cfg(target_os = "windows")]
    {
        if !_is_playing || cache.is_empty() {
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

    // Deduplicate identical device names so every dropdown item has a unique string key
    let mut unique_names = Vec::new();
    let mut name_counts = std::collections::HashMap::new();

    for name in all_names {
        let count = name_counts.entry(name.clone()).or_insert(0);
        *count += 1;
        if *count > 1 {
            unique_names.push(format!("{} #{}", name, count));
        } else {
            unique_names.push(name);
        }
    }

    let mut final_devices = vec!["[System Default Device]".to_string()];
    for u in unique_names {
        if u != "[System Default Device]" {
            final_devices.push(u);
        }
    }

    *cache = final_devices.clone();
    Ok(final_devices)
}

#[tauri::command]
fn set_audio_device(state: State<'_, AppState>, name: String) -> Result<(), String> {
    let player = safe_lock(&state.player);
    let mut target_device = safe_lock(&player.target_device);
    if name == "[System Default Device]" || name.is_empty() || name == "Default Device" || name == "System Default Device" {
        *target_device = None;
    } else {
        *target_device = Some(name);
    }
    let _ = player.cmd_tx.send(PlayerCommand::RestartStream);
    Ok(())
}

// ── Scanner commands ──────────────────────────────────────────────────────────
#[tauri::command]
async fn scan_and_save(dirs: Vec<String>, app_handle: AppHandle, state: State<'_, AppState>) -> Result<usize, String> {
    let db_conn_arc = Arc::clone(&state.db);
    let app_handle_clone = app_handle.clone();
    
    tokio::task::spawn_blocking(move || {
        // Save registered library directories (SEC-01)
        {
            let conn = safe_lock(&db_conn_arc);
            let _ = db::save_library_directories(&conn, &dirs);
        }

        let mut total_saved = 0;

        for dir in &dirs {
            scanner::scan_directory_chunked(dir, &app_handle_clone, |chunk| {
                if chunk.is_empty() {
                    return;
                }
                let mut conn = safe_lock(&db_conn_arc);
                if let Ok(tx) = conn.transaction() {
                    for track in &chunk {
                        let _ = tx.execute(
                            "INSERT INTO tracks (path, title, artist, album, duration, format, lyric_offset, track_number, disc_number)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                             ON CONFLICT(path) DO UPDATE SET 
                                 title = COALESCE(NULLIF(excluded.title, ''), tracks.title),
                                 artist = COALESCE(NULLIF(excluded.artist, ''), tracks.artist),
                                 album = COALESCE(NULLIF(excluded.album, ''), tracks.album),
                                 duration = COALESCE(excluded.duration, tracks.duration),
                                 format = COALESCE(excluded.format, tracks.format),
                                 track_number = COALESCE(excluded.track_number, tracks.track_number),
                                 disc_number = COALESCE(excluded.disc_number, tracks.disc_number)",
                            rusqlite::params![
                                track.path,
                                track.title,
                                track.artist,
                                track.album,
                                track.duration,
                                track.format,
                                track.lyric_offset,
                                track.track_number,
                                track.disc_number,
                            ],
                        );
                    }
                    if tx.commit().is_ok() {
                        total_saved += chunk.len();
                    }
                };
            });
        }

        let conn = safe_lock(&db_conn_arc);
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM tracks", [], |row| row.get(0)).unwrap_or(0);
        Ok(count as usize)
    }).await.map_err(|e| format!("Scanning task panicked: {}", e))?
}

#[tauri::command]
async fn clean_missing_tracks(state: State<'_, AppState>) -> Result<usize, String> {
    let db_conn_arc = Arc::clone(&state.db);
    tokio::task::spawn_blocking(move || {
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

        let deleted_count = paths_to_delete.len();
        if deleted_count > 0 {
            let mut conn = safe_lock(&db_conn_arc);
            let tx = conn.transaction().map_err(|e| e.to_string())?;
            for path in paths_to_delete {
                tx.execute("DELETE FROM tracks WHERE path = ?1", rusqlite::params![path]).map_err(|e| e.to_string())?;
                tx.execute("DELETE FROM playlist_tracks WHERE track_path = ?1", rusqlite::params![path]).map_err(|e| e.to_string())?;
            }
            tx.commit().map_err(|e| e.to_string())?;
        }

        Ok(deleted_count)
    }).await.map_err(|e| format!("Clean task panicked: {}", e))?
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
                replaygain_gain: None,
                track_number: None,
                disc_number: None,
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
    let mut conn = safe_lock(&state.db);
    let (loved, disliked): (i32, i32) = conn.query_row(
        "SELECT COALESCE(loved, 0), COALESCE(disliked, 0) FROM tracks WHERE path = ?1",
        rusqlite::params![stream_url],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).unwrap_or((0, 0));
    if loved == 0 && disliked == 0 {
        let _ = db::delete_track(&mut conn, &stream_url);
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
    let mut conn = safe_lock(&state.db);
    db::add_to_playlist(&mut conn, playlist_id, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_from_playlist(playlist_id: i32, path: String, state: State<'_, AppState>) -> Result<(), String> {
    let conn = safe_lock(&state.db);
    db::remove_from_playlist(&conn, playlist_id, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn reorder_playlist(playlist_id: i32, track_paths: Vec<String>, state: State<'_, AppState>) -> Result<(), String> {
    let mut conn = safe_lock(&state.db);
    db::reorder_playlist(&mut conn, playlist_id, &track_paths).map_err(|e| e.to_string())
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

pub fn verify_authorized_library_track(conn: &rusqlite::Connection, path: &str) -> Result<std::path::PathBuf, String> {
    let audio_path = std::path::Path::new(path);
    if !audio_path.exists() {
        return Err("File does not exist on disk".to_string());
    }
    let canonical_target = dunce::canonicalize(audio_path)
        .map_err(|e| format!("Invalid track path: {}", e))?;

    let registered_dirs = db::get_library_directories(conn).unwrap_or_default();
    let mut is_contained = false;

    for dir in &registered_dirs {
        if let Ok(canon_dir) = dunce::canonicalize(dir) {
            if canonical_target.starts_with(&canon_dir) {
                is_contained = true;
                break;
            }
        }
    }

    if !is_contained && registered_dirs.is_empty() {
        if let Some(audio_dir) = dirs::audio_dir() {
            if let Ok(canon_audio) = dunce::canonicalize(&audio_dir) {
                if canonical_target.starts_with(&canon_audio) {
                    is_contained = true;
                }
            }
        }
    }

    if !registered_dirs.is_empty() && !is_contained {
        let track_in_db: bool = conn
            .query_row(
                "SELECT 1 FROM tracks WHERE path = ?1 LIMIT 1",
                rusqlite::params![path],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if !track_in_db {
            return Err("Security violation: Track path is outside authorized music library directories".to_string());
        }
    }

    Ok(canonical_target)
}

#[tauri::command]
fn delete_track(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let mut conn = safe_lock(&state.db);

    // 1. Handle online/cloud tracks
    let is_online = {
        let mut stmt = conn.prepare_cached("SELECT format FROM tracks WHERE path = ?1")
            .map_err(|e| e.to_string())?;
        let format: Option<String> = stmt.query_row(rusqlite::params![&path], |row| row.get(0)).ok();
        format.map(|f| f == "Tidal FLAC" || f == "YouTube Direct" || f == "Subsonic" || f == "Jellyfin" || f == "Direct Stream").unwrap_or(false)
            || path.starts_with("http://") 
            || path.starts_with("https://") 
            || path.starts_with("subsonic:") 
            || path.starts_with("jellyfin:")
            || (path.len() == 11 && !path.contains('/') && !path.contains('\\'))
    };

    if is_online {
        db::delete_track(&mut conn, &path).map_err(|e| e.to_string())?;
        let _ = conn.execute("DELETE FROM playlist_tracks WHERE track_path = ?1", rusqlite::params![&path]);
        
        let hash = format!("{:x}", md5::compute(path.as_bytes()));
        if let Some(data_dir) = dirs::data_dir() {
            let cache_dir = data_dir.join("Aideo").join("CloudCache");
            let _ = std::fs::remove_file(cache_dir.join(format!("{}.cache", hash)));
            let _ = std::fs::remove_file(cache_dir.join(format!("{}.tmp", hash)));
        }
        let _ = std::fs::remove_file(lyrics::get_lyrics_cache_path(&path, "ttml"));
        let _ = std::fs::remove_file(lyrics::get_lyrics_cache_path(&path, "lrc"));
        return Ok(());
    }

    // 2. Verify track metadata exists in SQLite database
    let track_exists: bool = conn
        .query_row(
            "SELECT 1 FROM tracks WHERE path = ?1 LIMIT 1",
            rusqlite::params![&path],
            |_| Ok(true),
        )
        .unwrap_or(false);

    if !track_exists {
        return Err("Track not found in library database".to_string());
    }

    // 3. Canonicalize path and verify containment within library directories
    let audio_path = std::path::Path::new(&path);
    if audio_path.exists() {
        let canonical_target = verify_authorized_library_track(&conn, &path)?;

        // 4. Atomic database transaction with filesystem deletion rollback
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM tracks WHERE path = ?1", rusqlite::params![&path])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM playlist_tracks WHERE track_path = ?1", rusqlite::params![&path])
            .map_err(|e| e.to_string())?;

        // Delete primary audio file
        if let Err(e) = std::fs::remove_file(&canonical_target) {
            // Drop tx without committing -> automatically rolls back DB changes!
            return Err(format!("Failed to delete audio file: {}", e));
        }

        // Delete sidecar images (.jpg, .png)
        if let (Some(parent), Some(stem)) = (canonical_target.parent(), canonical_target.file_stem()) {
            if let Some(stem_str) = stem.to_str() {
                let _ = std::fs::remove_file(parent.join(format!("{}.jpg", stem_str)));
                let _ = std::fs::remove_file(parent.join(format!("{}.png", stem_str)));
            }
        }

        // Delete lyrics
        let _ = std::fs::remove_file(lyrics::get_lyrics_file_path(&path, "ttml"));
        let _ = std::fs::remove_file(lyrics::get_lyrics_file_path(&path, "lrc"));
        let _ = std::fs::remove_file(lyrics::get_lyrics_cache_path(&path, "ttml"));
        let _ = std::fs::remove_file(lyrics::get_lyrics_cache_path(&path, "lrc"));

        // Commit transaction after successful filesystem operations
        tx.commit().map_err(|e| e.to_string())?;
    } else {
        // File already missing from disk -> clean up database record
        db::delete_track(&mut conn, &path).map_err(|e| e.to_string())?;
    }

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
        if let Ok(parsed) = url::Url::parse(&path) {
            if parsed.scheme() != "http" && parsed.scheme() != "https" {
                return Ok(None);
            }
        } else {
            return Ok(None);
        }

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
                        if bytes.len() <= 15 * 1024 * 1024 {
                            use base64::Engine;
                            let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
                            return Ok(Some(format!("data:{content_type};base64,{encoded}")));
                        }
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
    let save_path = lyrics::get_lyrics_save_path(&path, &content);
    std::fs::write(save_path, content).map_err(|e| e.to_string())
}

pub fn is_valid_text_file_extension(path: &str) -> bool {
    let p = std::path::Path::new(path);
    p.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let lower = ext.to_ascii_lowercase();
            lower == "m3u" || lower == "m3u8" || lower == "txt" || lower == "json"
        })
        .unwrap_or(false)
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    if !is_valid_text_file_extension(&path) {
        return Err("Invalid file extension: only .m3u, .m3u8, .txt, and .json files are permitted".to_string());
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoverSearchResult {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub source: String,
    pub cover_url: String,
}

#[tauri::command]
async fn search_covers_online(query: String) -> Result<Vec<CoverSearchResult>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }

    let client = get_http_client();
    let mut results: Vec<CoverSearchResult> = Vec::new();
    let mut seen_urls: std::collections::HashSet<String> = std::collections::HashSet::new();

    // 1. iTunes Albums & Songs Search (High Resolution 1000x1000)
    let itunes_query = urlencoding::encode(q);
    let itunes_url = format!("https://itunes.apple.com/search?term={}&entity=song&limit=10", itunes_query);
    if let Ok(res) = client.get(&itunes_url).send().await {
        if res.status().is_success() {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(items) = json["results"].as_array() {
                    for item in items {
                        if let Some(art_100) = item["artworkUrl100"].as_str() {
                            let high_res_url = art_100.replace("100x100bb", "1000x1000bb");
                            if seen_urls.insert(high_res_url.clone()) {
                                results.push(CoverSearchResult {
                                    id: format!("itunes-{}", item["trackId"].as_u64().unwrap_or(0)),
                                    title: item["trackName"].as_str().unwrap_or(q).to_string(),
                                    artist: item["artistName"].as_str().unwrap_or("").to_string(),
                                    album: item["collectionName"].as_str().map(|s| s.to_string()),
                                    source: "iTunes".to_string(),
                                    cover_url: high_res_url,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // 2. MusicBrainz & Cover Art Archive
    let mbz_url = format!("https://musicbrainz.org/ws/2/recording?query={}&fmt=json&limit=5", itunes_query);
    let mbz_ua = concat!("AideoMusicPlayer/", env!("CARGO_PKG_VERSION"), " ( https://github.com/Alirull18/Aideo-Music-Player )");
    if let Ok(res) = client.get(&mbz_url).header("User-Agent", mbz_ua).send().await {
        if res.status().is_success() {
            if let Ok(json) = res.json::<serde_json::Value>().await {
                if let Some(recs) = json["recordings"].as_array() {
                    for rec in recs.iter().take(4) {
                        if let Some(rel) = rec["releases"].as_array().and_then(|r| r.first()) {
                            if let Some(rel_id) = rel["id"].as_str() {
                                let caa_front = format!("https://coverartarchive.org/release/{}/front-500", rel_id);
                                if seen_urls.insert(caa_front.clone()) {
                                    let rec_title = rec["title"].as_str().unwrap_or(q).to_string();
                                    let rec_artist = rec["artist-credit"].as_array()
                                        .and_then(|a| a.first())
                                        .and_then(|a| a["name"].as_str())
                                        .unwrap_or("").to_string();
                                    let rel_title = rel["title"].as_str().map(|s| s.to_string());
                                    results.push(CoverSearchResult {
                                        id: format!("mbz-{}", rel_id),
                                        title: rec_title,
                                        artist: rec_artist,
                                        album: rel_title,
                                        source: "MusicBrainz".to_string(),
                                        cover_url: caa_front,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // 3. YouTube Music InnerTube Fallback
    if results.len() < 4 {
        if let Ok(yt_tracks) = youtube::search_youtube(q.to_string()).await {
            for (idx, t) in yt_tracks.into_iter().take(6).enumerate() {
                if let Some(cover) = t.cover_url {
                    if !cover.trim().is_empty() && seen_urls.insert(cover.clone()) {
                        results.push(CoverSearchResult {
                            id: format!("yt-{}-{}", idx, t.id),
                            title: t.title,
                            artist: t.artist,
                            album: None,
                            source: "YouTube Music".to_string(),
                            cover_url: cover,
                        });
                    }
                }
            }
        }
    }

    Ok(results)
}

#[tauri::command]
async fn fetch_image_as_data_url(url: String) -> Result<String, String> {
    if let Ok(parsed) = url::Url::parse(&url) {
        if parsed.scheme() != "http" && parsed.scheme() != "https" {
            return Err("Invalid image URL scheme".to_string());
        }
    } else {
        return Err("Invalid image URL".to_string());
    }

    let client = get_http_client();
    let res = client.get(&url).send().await.map_err(|e| format!("Failed to download image: {}", e))?;
    if !res.status().is_success() {
        return Err(format!("Image download returned status HTTP {}", res.status()));
    }

    let mime = res.headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_string();

    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > 15 * 1024 * 1024 {
        return Err("Image exceeds 15MB size limit".to_string());
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{};base64,{}", mime, b64))
}

#[tauri::command]
async fn apply_online_cover(state: State<'_, AppState>, path: String, url: String) -> Result<(), String> {
    if let Ok(parsed) = url::Url::parse(&url) {
        if parsed.scheme() != "http" && parsed.scheme() != "https" {
            return Err("Invalid image URL scheme".to_string());
        }
    } else {
        return Err("Invalid image URL".to_string());
    }

    let canonical_target = {
        let conn = safe_lock(&state.db);
        verify_authorized_library_track(&conn, &path)?
    };

    let client = get_http_client();
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Failed to download cover image: HTTP {}", res.status()));
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() > 15 * 1024 * 1024 {
        return Err("Cover image exceeds 15MB size limit".to_string());
    }

    let parent = canonical_target.parent().ok_or("Invalid path")?;
    let stem = canonical_target.file_stem().ok_or("Invalid filename")?.to_str().ok_or("Invalid UTF-8 in stem")?;
    
    // Choose extension based on URL or keep it jpg
    let ext = if url.to_lowercase().contains(".png") { "png" } else { "jpg" };
    let cover_path = parent.join(format!("{}.{}", stem, ext));

    std::fs::write(&cover_path, &bytes).map_err(|e| e.to_string())?;

    // Also embed directly into audio container tags
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let mime = if ext == "png" { "image/png" } else { "image/jpeg" };
    let data_url = format!("data:{};base64,{}", mime, b64);
    let path_clone = path.clone();
    let _ = tokio::task::spawn_blocking(move || {
        tag_editor::write_tags(&path_clone, &tag_editor::AudioTagUpdate {
            cover_base64: Some(data_url),
            ..Default::default()
        })
    }).await;

    artwork::invalidate_cover_cache(&path);
    Ok(())
}

#[tauri::command]
async fn apply_local_cover(state: State<'_, AppState>, path: String, base64_data: String) -> Result<(), String> {
    use base64::Engine;
    let clean_base64 = if let Some(pos) = base64_data.find(',') {
        &base64_data[pos + 1..]
    } else {
        &base64_data
    };

    let decoded = base64::engine::general_purpose::STANDARD.decode(clean_base64.trim().as_bytes()).map_err(|e| e.to_string())?;
    
    let canonical_target = {
        let conn = safe_lock(&state.db);
        verify_authorized_library_track(&conn, &path)?
    };

    let parent = canonical_target.parent().ok_or("Invalid path")?;
    let stem = canonical_target.file_stem().ok_or("Invalid filename")?.to_str().ok_or("Invalid UTF-8 in stem")?;

    // Determine extension based on data URL mime type
    let ext = if base64_data.contains("image/png") { "png" } else { "jpg" };
    let cover_path = parent.join(format!("{}.{}", stem, ext));

    std::fs::write(&cover_path, &decoded).map_err(|e| e.to_string())?;

    // Also embed directly into audio container tags
    let path_clone = path.clone();
    let b64_clone = base64_data.clone();
    let _ = tokio::task::spawn_blocking(move || {
        tag_editor::write_tags(&path_clone, &tag_editor::AudioTagUpdate {
            cover_base64: Some(b64_clone),
            ..Default::default()
        })
    }).await;

    artwork::invalidate_cover_cache(&path);
    Ok(())
}

// ── Exclusive Mode commands ──────────────────────────────────────────────────
#[tauri::command]
fn toggle_exclusive_mode(state: State<'_, AppState>) -> Result<bool, String> {
    let player = safe_lock(&state.player);
    let current = player.exclusive_mode.load(Ordering::Relaxed);
    let next_mode = !current;
    player.exclusive_mode.store(next_mode, Ordering::Relaxed);
    // A manual toggle is explicit user intent: re-arm the exclusive failure
    // budget so a previously wedged device gets fresh retry attempts.
    player::EXCLUSIVE_STREAM_FAILURES.store(0, Ordering::Relaxed);
    player::EXCLUSIVE_FALLBACK_NOTIFIED.store(false, Ordering::Relaxed);
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
    let mut conn = safe_lock(&state.db);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO playback_history (track_path, title, artist, album, duration, format, timestamp, duration_played, skipped, synced, genre, playback_source)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0.0, 0, 0, ?8, ?9)",
        rusqlite::params![path, title, artist, album, duration, format, now, genre, playback_source],
    ).map_err(|e| e.to_string())?;
    
    let id = tx.last_insert_rowid();

    // Bound unsynced offline scrobble entries to 1,000 max (MIN-08)
    let _ = tx.execute(
        "DELETE FROM playback_history 
         WHERE synced = 0 AND id NOT IN (
             SELECT id FROM playback_history WHERE synced = 0 ORDER BY timestamp DESC LIMIT 1000
         )",
        [],
    );

    tx.commit().map_err(|e| e.to_string())?;
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
         WHERE synced = 0
         ORDER BY timestamp ASC
         LIMIT 1000"
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

#[derive(Serialize, Clone, Debug)]
pub struct TopSong {
    pub title: String,
    pub artist: String,
    pub track_path: String,
    pub play_count: i64,
}

#[derive(Serialize, Clone, Debug)]
pub struct TopArtist {
    pub artist: String,
    pub play_count: i64,
}

#[derive(Serialize, Clone, Debug)]
pub struct TopGenre {
    pub genre: String,
    pub play_count: i64,
}

#[derive(Serialize, Clone, Debug)]
pub struct HourActivity {
    pub hour: i32,
    pub play_count: i64,
}

#[derive(Serialize, Clone, Debug)]
pub struct DayActivity {
    pub day: i32,
    pub play_count: i64,
}

#[derive(Serialize, Clone, Debug)]
pub struct ListeningInsightsPayload {
    pub total_listening_time_secs: f64,
    pub total_plays: i64,
    pub skip_count: i64,
    pub skip_rate: f64,
    pub top_songs: Vec<TopSong>,
    pub top_artists: Vec<TopArtist>,
    pub top_genres: Vec<TopGenre>,
    pub hourly_activity: Vec<HourActivity>,
    pub daily_activity: Vec<DayActivity>,
}

#[tauri::command]
fn get_listening_insights(range: String, state: State<'_, AppState>) -> Result<ListeningInsightsPayload, String> {
    let conn = safe_lock(&state.db);
    
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let filter_timestamp = match range.as_str() {
        "today" => now - 86400,
        "last_7_days" => now - 7 * 86400,
        "last_30_days" => now - 30 * 86400,
        _ => 0, // all_time
    };

    // 1. Fetch total time, plays, and skips
    let mut stmt = conn.prepare(
        "SELECT 
            COALESCE(SUM(duration_played), 0.0),
            COUNT(id),
            COALESCE(SUM(CASE WHEN skipped = 1 THEN 1 ELSE 0 END), 0)
         FROM playback_history
         WHERE timestamp >= ?1"
    ).map_err(|e| e.to_string())?;

    let mut rows = stmt.query(rusqlite::params![filter_timestamp]).map_err(|e| e.to_string())?;
    
    let mut total_listening_time_secs = 0.0;
    let mut total_plays = 0;
    let mut skip_count = 0;
    
    if let Some(row) = rows.next().map_err(|e| e.to_string())? {
        total_listening_time_secs = row.get(0).map_err(|e| e.to_string())?;
        total_plays = row.get(1).map_err(|e| e.to_string())?;
        skip_count = row.get(2).map_err(|e| e.to_string())?;
    }
    
    let skip_rate = if total_plays > 0 {
        (skip_count as f64 / total_plays as f64) * 100.0
    } else {
        0.0
    };

    // 2. Fetch top songs
    let mut stmt = conn.prepare(
        "SELECT 
            COALESCE(title, ''),
            COALESCE(artist, ''),
            track_path,
            COUNT(*) as play_count
         FROM playback_history
         WHERE timestamp >= ?1
         GROUP BY track_path, title, artist
         ORDER BY play_count DESC
         LIMIT 10"
    ).map_err(|e| e.to_string())?;
    
    let song_rows = stmt.query_map(rusqlite::params![filter_timestamp], |row| {
        Ok(TopSong {
            title: row.get(0)?,
            artist: row.get(1)?,
            track_path: row.get(2)?,
            play_count: row.get(3)?,
        })
    }).map_err(|e| e.to_string())?;
    
    let mut top_songs = Vec::new();
    for r in song_rows {
        if let Ok(item) = r {
            top_songs.push(item);
        }
    }

    // 3. Fetch top artists
    let mut stmt = conn.prepare(
        "SELECT 
            COALESCE(artist, ''),
            COUNT(*) as play_count
         FROM playback_history
         WHERE timestamp >= ?1 AND artist IS NOT NULL AND artist != ''
         GROUP BY artist
         ORDER BY play_count DESC
         LIMIT 10"
    ).map_err(|e| e.to_string())?;
    
    let artist_rows = stmt.query_map(rusqlite::params![filter_timestamp], |row| {
        Ok(TopArtist {
            artist: row.get(0)?,
            play_count: row.get(1)?,
        })
    }).map_err(|e| e.to_string())?;
    
    let mut top_artists = Vec::new();
    for r in artist_rows {
        if let Ok(item) = r {
            top_artists.push(item);
        }
    }

    // 4. Fetch top genres
    let mut stmt = conn.prepare(
        "SELECT 
            COALESCE(genre, ''),
            COUNT(*) as play_count
         FROM playback_history
         WHERE timestamp >= ?1 AND genre IS NOT NULL AND genre != ''
         GROUP BY genre
         ORDER BY play_count DESC
         LIMIT 10"
    ).map_err(|e| e.to_string())?;
    
    let genre_rows = stmt.query_map(rusqlite::params![filter_timestamp], |row| {
        Ok(TopGenre {
            genre: row.get(0)?,
            play_count: row.get(1)?,
        })
    }).map_err(|e| e.to_string())?;
    
    let mut top_genres = Vec::new();
    for r in genre_rows {
        if let Ok(item) = r {
            top_genres.push(item);
        }
    }

    // 5. Fetch hourly activity
    let mut stmt = conn.prepare(
        "SELECT 
            CAST(strftime('%H', datetime(timestamp, 'unixepoch', 'localtime')) as INTEGER) as hr,
            COUNT(*)
         FROM playback_history
         WHERE timestamp >= ?1
         GROUP BY hr
         ORDER BY hr ASC"
    ).map_err(|e| e.to_string())?;
    
    let hour_rows = stmt.query_map(rusqlite::params![filter_timestamp], |row| {
        Ok(HourActivity {
            hour: row.get(0)?,
            play_count: row.get(1)?,
        })
    }).map_err(|e| e.to_string())?;
    
    let mut hourly_activity = Vec::new();
    for r in hour_rows {
        if let Ok(item) = r {
            hourly_activity.push(item);
        }
    }

    // 6. Fetch daily activity
    let mut stmt = conn.prepare(
        "SELECT 
            CAST(strftime('%w', datetime(timestamp, 'unixepoch', 'localtime')) as INTEGER) as dy,
            COUNT(*)
         FROM playback_history
         WHERE timestamp >= ?1
         GROUP BY dy
         ORDER BY dy ASC"
    ).map_err(|e| e.to_string())?;
    
    let day_rows = stmt.query_map(rusqlite::params![filter_timestamp], |row| {
        Ok(DayActivity {
            day: row.get(0)?,
            play_count: row.get(1)?,
        })
    }).map_err(|e| e.to_string())?;
    
    let mut daily_activity = Vec::new();
    for r in day_rows {
        if let Ok(item) = r {
            daily_activity.push(item);
        }
    }

    Ok(ListeningInsightsPayload {
        total_listening_time_secs,
        total_plays,
        skip_count,
        skip_rate,
        top_songs,
        top_artists,
        top_genres,
        hourly_activity,
        daily_activity,
    })
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
    let clamped = if volume.is_finite() {
        volume.clamp(0.0, 1.0)
    } else {
        1.0
    };
    let player = safe_lock(&state.player);
    player.volume.store(clamped.to_bits(), Ordering::Relaxed);
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
fn set_playback_rate(rate: f64, state: State<'_, AppState>) -> Result<(), String> {
    let clamped = if rate.is_finite() { rate.clamp(0.5, 2.0) } else { 1.0 };
    let player = safe_lock(&state.player);
    let mut dsp = safe_lock(&player.dsp_state);
    dsp.playback_rate = clamped;
    Ok(())
}

#[tauri::command]
fn create_smart_playlist(name: String, rules_json: String, state: State<'_, AppState>) -> Result<i32, String> {
    let conn = safe_lock(&state.db);
    db::create_smart_playlist(&conn, &name, &rules_json).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_smart_playlists(state: State<'_, AppState>) -> Result<Vec<db::SmartPlaylist>, String> {
    let conn = safe_lock(&state.db);
    db::get_smart_playlists(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_smart_playlist(id: i32, state: State<'_, AppState>) -> Result<(), String> {
    let conn = safe_lock(&state.db);
    db::delete_smart_playlist(&conn, id).map_err(|e| e.to_string())
}

#[tauri::command]
fn execute_smart_playlist(rules_json: String, state: State<'_, AppState>) -> Result<Vec<db::Track>, String> {
    let conn = safe_lock(&state.db);
    db::execute_smart_rules(&conn, &rules_json).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_global_shortcuts(
    bindings: std::collections::HashMap<String, Option<String>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let list: Vec<(String, Option<String>)> = bindings.into_iter().collect();
    hotkeys::apply_shortcuts(&app_handle, &list)
}

#[tauri::command]
fn export_playlist_m3u(playlist_id: i32, dest_path: String, state: State<'_, AppState>) -> Result<usize, String> {
    let conn = safe_lock(&state.db);
    m3u::export_playlist_m3u(&conn, playlist_id, &dest_path)
}

#[tauri::command]
fn import_playlist_m3u(src_path: String, playlist_name: Option<String>, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let mut conn = safe_lock(&state.db);
    let name = playlist_name.unwrap_or_else(|| {
        std::path::Path::new(&src_path)
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Imported Playlist".to_string())
    });
    let result = m3u::import_playlist_m3u(&mut conn, &src_path, &name)?;
    Ok(serde_json::json!({ "resolved": result.resolved, "skipped": result.skipped }))
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
    let mut conn = safe_lock(&state.db);
    db::toggle_love_track(
        &mut conn,
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
    let mut conn = safe_lock(&state.db);
    db::toggle_dislike_track(
        &mut conn,
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
    crate::logger::log_msg(crate::logger::LogLevel::Error, "FRONTEND", &msg, None);
}

#[tauri::command]
fn log_message(level: String, tag: String, message: String, details: Option<String>) {
    let log_level = crate::logger::LogLevel::from_str(&level);
    crate::logger::log_msg(log_level, &tag, &message, details.as_deref());
}

#[tauri::command]
fn log_crash(report: crate::logger::FrontendCrashReport) -> Result<String, String> {
    let logger = crate::logger::get_logger().ok_or_else(|| "Logger not initialized".to_string())?;

    let mut extra_info = String::new();
    if let Some(view) = &report.view {
        extra_info.push_str(&format!("Active View: {}\n", view));
    }
    if let Some(url) = &report.url {
        extra_info.push_str(&format!("Location URL: {}\n", url));
    }
    if let Some(comp_stack) = &report.component_stack {
        extra_info.push_str(&format!("React Component Stack:\n{}\n", comp_stack));
    }
    if let Some(breadcrumbs) = &report.breadcrumbs {
        extra_info.push_str("Recent Frontend Actions:\n");
        for b in breadcrumbs {
            extra_info.push_str(&format!(" - {}\n", b));
        }
    }
    if let Some(extra) = &report.extra {
        extra_info.push_str(&format!("Extra State: {}\n", extra));
    }

    let path = logger.write_crash_dump(
        "frontend",
        &report.message,
        report.stack.as_deref(),
        if extra_info.is_empty() { None } else { Some(&extra_info) }
    )?;

    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_debug_system_info(app: AppHandle) -> Result<crate::logger::SystemDiagnosticInfo, String> {
    let logs_dir = match app.path().app_data_dir() {
        Ok(d) => d.join("logs"),
        Err(_) => dirs::data_dir()
            .map(|d| d.join("com.alirul.music-player").join("logs"))
            .unwrap_or_else(|| std::path::PathBuf::from("logs")),
    };
    let log_file = logs_dir.join("aideo.log");
    Ok(crate::logger::AppLogger::collect_system_info(&logs_dir, &log_file))
}

#[tauri::command]
fn get_recent_logs(limit: Option<usize>) -> Vec<crate::logger::LogEntry> {
    if let Some(logger) = crate::logger::get_logger() {
        logger.get_recent_entries(limit)
    } else {
        Vec::new()
    }
}

#[tauri::command]
fn open_logs_folder(app: AppHandle) -> Result<(), String> {
    let logs_dir = match app.path().app_data_dir() {
        Ok(d) => d.join("logs"),
        Err(_) => dirs::data_dir()
            .map(|d| d.join("com.alirul.music-player").join("logs"))
            .unwrap_or_else(|| std::path::PathBuf::from("logs")),
    };
    let _ = std::fs::create_dir_all(&logs_dir);

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(logs_dir.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(logs_dir.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(logs_dir.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn export_debug_report(app: AppHandle) -> Result<String, String> {
    let logs_dir = match app.path().app_data_dir() {
        Ok(d) => d.join("logs"),
        Err(_) => dirs::data_dir()
            .map(|d| d.join("com.alirul.music-player").join("logs"))
            .unwrap_or_else(|| std::path::PathBuf::from("logs")),
    };
    let log_file = logs_dir.join("aideo.log");
    let sys_info = crate::logger::AppLogger::collect_system_info(&logs_dir, &log_file);

    let mut report = String::new();
    report.push_str("================================================================================\n");
    report.push_str(" AIDEO MUSIC PLAYER - DIAGNOSTIC SYSTEM REPORT\n");
    report.push_str("================================================================================\n\n");
    report.push_str(&format!("Generated:       {}\n", sys_info.timestamp));
    report.push_str(&format!("Application:     {} v{}\n", sys_info.app_name, sys_info.app_version));
    report.push_str(&format!("OS / Platform:   {}\n", sys_info.os_version));
    report.push_str(&format!("Architecture:    {}\n", sys_info.arch));
    report.push_str(&format!("CPU Cores:       {}\n", sys_info.cpu_count));
    report.push_str(&format!("Process ID:      {}\n", sys_info.process_id));
    report.push_str(&format!("Audio Backend:   {}\n", sys_info.active_audio_backend));
    report.push_str(&format!("Logs Directory:  {}\n", sys_info.log_dir));
    report.push_str(&format!("Main Log File:   {}\n\n", sys_info.log_file));

    report.push_str("--------------------------------------------------------------------------------\n");
    report.push_str("RECENT LOG ENTRIES (Last 150 Records)\n");
    report.push_str("--------------------------------------------------------------------------------\n");
    if let Some(logger) = crate::logger::get_logger() {
        let entries = logger.get_recent_entries(Some(150));
        for entry in entries {
            report.push_str(&format!("[{}] [{: <5}] [{: <9}] {}\n", entry.timestamp, entry.level, entry.tag, entry.message));
            if let Some(d) = entry.details {
                report.push_str(&format!("    Details: {}\n", d));
            }
        }
    } else {
        report.push_str("No active logger instance found.\n");
    }
    report.push_str("\n================================================================================\n");
    report.push_str(" END OF REPORT\n");
    report.push_str("================================================================================\n");

    Ok(report)
}

#[tauri::command]
fn clear_log_files() -> Result<(), String> {
    if let Some(logger) = crate::logger::get_logger() {
        logger.clear_logs()
    } else {
        Ok(())
    }
}

#[tauri::command]
fn start_dragging(window: Window) -> Result<(), String> {
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_window_resizable(window: Window, resizable: bool) -> Result<(), String> {
    window.set_resizable(resizable).map_err(|e| e.to_string())
}

#[tauri::command]
fn move_window_by(window: Window, dx: i32, dy: i32) -> Result<(), String> {
    if let Ok(pos) = window.outer_position() {
        let new_pos = tauri::PhysicalPosition::new(pos.x + dx, pos.y + dy);
        let _ = window.set_position(tauri::Position::Physical(new_pos));
    }
    Ok(())
}

#[tauri::command]
fn center_window(window: Window) -> Result<(), String> {
    window.center().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_window_always_on_top(window: Window, always_on_top: bool) -> Result<(), String> {
    window.set_always_on_top(always_on_top).map_err(|e| e.to_string())
}

#[tauri::command]
fn enter_borderless_fullscreen(window: Window, fullscreen: bool) -> Result<(), String> {
    window.set_fullscreen(fullscreen).map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_mini_player_mode(window: Window, mini: bool) -> Result<(), String> {
    if mini {
        window.set_decorations(false).map_err(|e| e.to_string())?;
        window.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize::new(260.0, 130.0)))).map_err(|e| e.to_string())?;
        window.set_max_size(Some(tauri::Size::Logical(tauri::LogicalSize::new(650.0, 360.0)))).map_err(|e| e.to_string())?;
        window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(340.0, 180.0))).map_err(|e| e.to_string())?;
        window.set_always_on_top(true).map_err(|e| e.to_string())?;
        window.set_resizable(true).map_err(|e| e.to_string())?;
    } else {
        window.set_decorations(true).map_err(|e| e.to_string())?;
        window.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize::new(800.0, 600.0)))).map_err(|e| e.to_string())?;
        window.set_max_size::<tauri::Size>(None).map_err(|e| e.to_string())?;
        window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(1000.0, 700.0))).map_err(|e| e.to_string())?;
        window.set_always_on_top(false).map_err(|e| e.to_string())?;
        window.set_resizable(true).map_err(|e| e.to_string())?;
        let _ = window.center();
    }
    Ok(())
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
            Some(profile.lufs_gain_db),
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
    Ok(format!("http://{}:{}/?pin={}", ip, port, pin))
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
fn get_cache_size_info() -> Result<serde_json::Value, String> {
    let mut total_bytes: u64 = 0;
    let mut file_count: usize = 0;

    if let Some(data_dir) = dirs::data_dir() {
        let cloud_cache = data_dir.join("Aideo").join("CloudCache");
        if let Ok(entries) = std::fs::read_dir(&cloud_cache) {
            for entry in entries.flatten() {
                if let Ok(m) = entry.metadata() {
                    if m.is_file() {
                        total_bytes += m.len();
                        file_count += 1;
                    }
                }
            }
        }

        let ytdlp_cache = data_dir.join("Aideo").join("cache");
        if let Ok(entries) = std::fs::read_dir(&ytdlp_cache) {
            for entry in entries.flatten() {
                if let Ok(m) = entry.metadata() {
                    if m.is_file() {
                        total_bytes += m.len();
                        file_count += 1;
                    }
                }
            }
        }
    }

    if let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
                    if filename.starts_with("aideo_cache_") {
                        if let Ok(m) = path.metadata() {
                            total_bytes += m.len();
                            file_count += 1;
                        }
                    }
                }
            }
        }
    }

    let gb = total_bytes as f64 / (1024.0 * 1024.0 * 1024.0);
    let mb = total_bytes as f64 / (1024.0 * 1024.0);
    let formatted = if gb >= 1.0 {
        format!("{:.2} GB", gb)
    } else {
        format!("{:.1} MB", mb)
    };

    Ok(serde_json::json!({
        "bytes": total_bytes,
        "formatted": formatted,
        "count": file_count,
        "limit_gb": 5.0
    }))
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
static CLOSE_TO_TRAY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

#[tauri::command]
fn set_close_to_tray(enabled: bool) {
    CLOSE_TO_TRAY.store(enabled, std::sync::atomic::Ordering::Relaxed);
}

#[tauri::command]
fn get_close_to_tray() -> bool {
    CLOSE_TO_TRAY.load(std::sync::atomic::Ordering::Relaxed)
}

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

#[tauri::command]
fn get_track_by_path(path: String, state: State<'_, AppState>) -> Result<db::Track, String> {
    let conn = safe_lock(&state.db);
    db::get_track_by_path(&conn, &path).map_err(|e| e.to_string())
}

// ── Tag Editor Commands ───────────────────────────────────────────────────
#[tauri::command]
async fn read_audio_tags(path: String) -> Result<tag_editor::AudioTagData, String> {
    tokio::task::spawn_blocking(move || {
        tag_editor::read_tags(&path)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn write_audio_tags(
    path: String,
    update: tag_editor::AudioTagUpdate,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<db::Track, String> {
    let path_clone = path.clone();
    let update_clone = update.clone();

    tokio::task::spawn_blocking(move || {
        tag_editor::write_tags(&path_clone, &update_clone)
    }).await.map_err(|e| e.to_string())??;

    artwork::invalidate_cover_cache(&path);

    let conn = safe_lock(&state.db);
    let updated_track = db::update_track_tags(
        &conn,
        &path,
        update.title.as_deref(),
        update.artist.as_deref(),
        update.album.as_deref(),
        update.track_number.map(|n| n as i32),
        update.disc_number.map(|n| n as i32),
    ).map_err(|e| e.to_string())?;

    let _ = app_handle.emit("track-metadata-updated", serde_json::json!({
        "path": path,
        "track": updated_track,
    }));

    Ok(updated_track)
}

#[tauri::command]
async fn batch_update_tags(
    paths: Vec<String>,
    update: tag_editor::AudioTagBatchUpdate,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let paths_clone = paths.clone();
    let update_clone = update.clone();

    let updated_count = tokio::task::spawn_blocking(move || {
        tag_editor::batch_write_tags(&paths_clone, &update_clone)
    }).await.map_err(|e| e.to_string())??;

    let mut conn = safe_lock(&state.db);
    if let Ok(tx) = conn.transaction() {
        for p in &paths {
            artwork::invalidate_cover_cache(p);
            let _ = tx.execute(
                "UPDATE tracks SET 
                    artist = COALESCE(?1, artist),
                    album = COALESCE(?2, album)
                 WHERE path = ?3",
                rusqlite::params![update.artist.as_deref(), update.album.as_deref(), p],
            );
        }
        let _ = tx.commit();
    }

    let _ = app_handle.emit("library-updated", ());
    Ok(updated_count)
}

// ── Desktop Lyrics Window Commands ─────────────────────────────────────────
#[tauri::command]
async fn toggle_desktop_lyrics(show: bool, app_handle: AppHandle) -> Result<bool, String> {
    if show {
        if let Some(win) = app_handle.get_webview_window("desktop-lyrics") {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        } else {
            let win_builder = tauri::WebviewWindowBuilder::new(
                &app_handle,
                "desktop-lyrics",
                tauri::WebviewUrl::App("index.html?window=desktop-lyrics".into()),
            )
            .title("Aideo Desktop Lyrics")
            .inner_size(880.0, 140.0)
            .transparent(true)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .resizable(true);

            let win = win_builder.build().map_err(|e| e.to_string())?;
            let _ = win.show();
        }
        Ok(true)
    } else {
        if let Some(win) = app_handle.get_webview_window("desktop-lyrics") {
            let _ = win.hide();
        }
        Ok(false)
    }
}

#[tauri::command]
fn set_desktop_lyrics_ignore_cursor(ignore: bool, app_handle: AppHandle) -> Result<(), String> {
    if let Some(win) = app_handle.get_webview_window("desktop-lyrics") {
        win.set_ignore_cursor_events(ignore).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn get_desktop_lyrics_status(app_handle: AppHandle) -> Result<bool, String> {
    if let Some(win) = app_handle.get_webview_window("desktop-lyrics") {
        Ok(win.is_visible().unwrap_or(false))
    } else {
        Ok(false)
    }
}

// ── UPnP / DLNA Commands ──────────────────────────────────────────────────
#[tauri::command]
async fn upnp_discover() -> Result<Vec<upnp::UpnpDevice>, String> {
    upnp::discover_upnp_devices().await
}

#[tauri::command]
fn upnp_connect(device_id: String) -> Result<(), String> {
    upnp::connect_upnp_device(&device_id)
}

#[tauri::command]
async fn upnp_disconnect() -> Result<(), String> {
    upnp::disconnect_upnp_device().await
}

#[tauri::command]
async fn upnp_play(
    path: String,
    title: String,
    artist: String,
    album: String,
    cover_url: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("flac")
        .to_lowercase();

    let mime = match ext.as_str() {
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "m4a" | "aac" => "audio/mp4",
        "ogg" | "opus" => "audio/ogg",
        _ => "audio/flac",
    };

    let local_port = chromecast::ensure_local_stream_server(&state).await.unwrap_or(8080);
    let local_ip = chromecast::get_local_ip().unwrap_or_else(|| "127.0.0.1".to_string());
    let stream_url = format!("http://{}:{}/stream?path={}", local_ip, local_port, urlencoding::encode(&path));

    upnp::upnp_play_stream(&stream_url, &title, &artist, &album, cover_url.as_deref(), mime).await
}

#[tauri::command]
async fn upnp_control(action: String, value: Option<f64>) -> Result<(), String> {
    upnp::upnp_control_action(&action, value).await
}

#[tauri::command]
async fn upnp_get_status() -> Result<upnp::UpnpStatus, String> {
    upnp::upnp_query_status().await
}

pub fn run() {
    dotenvy::dotenv().ok();

    let logs_dir = dirs::data_dir()
        .map(|d| d.join("com.alirul.music-player").join("logs"))
        .unwrap_or_else(|| std::path::PathBuf::from("logs"));
    let _ = std::fs::create_dir_all(&logs_dir);

    logger::init_logger(logs_dir.clone());
    logger::install_panic_hook();

    log_info!("SYSTEM", "=== Aideo Music Player v{} Startup ===", env!("CARGO_PKG_VERSION"));
    log_info!(
        "SYSTEM",
        "Platform: {} ({}) | Architecture: {} | CPUs: {}",
        std::env::consts::OS,
        std::env::consts::FAMILY,
        std::env::consts::ARCH,
        std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1)
    );
    log_info!("SYSTEM", "Logs Directory: {:?}", logs_dir);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            let _ = app.emit("deep-link", argv);
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_skip_taskbar(false);
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.center();
                let _ = w.set_focus();
            }
        }))
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "show" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.set_skip_taskbar(false);
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.center();
                        let _ = window.set_focus();
                    }
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|app, event| {
            use tauri::tray::{TrayIconEvent, MouseButton};
            match event {
                TrayIconEvent::Click { button: MouseButton::Left, .. } |
                TrayIconEvent::DoubleClick { button: MouseButton::Left, .. } => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.set_skip_taskbar(false);
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.center();
                        let _ = window.set_focus();
                    }
                }
                _ => {}
            }
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && CLOSE_TO_TRAY.load(std::sync::atomic::Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            center_window,
            set_window_always_on_top,
            enter_borderless_fullscreen,
            set_close_to_tray,
            get_close_to_tray,
            open_oauth_window,
            log_error,
            log_message,
            log_crash,
            get_debug_system_info,
            get_recent_logs,
            open_logs_folder,
            export_debug_report,
            clear_log_files,
            start_dragging,
            set_window_resizable,
            move_window_by,
            set_mini_player_mode,
            scan_and_save,
            clean_missing_tracks,
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
            write_text_file,
            set_volume,
            seek_track,
            set_playback_rate,
            set_global_shortcuts,
            export_playlist_m3u,
            import_playlist_m3u,
            watcher::sync_watch_folders,
            create_smart_playlist,
            get_smart_playlists,
            delete_smart_playlist,
            execute_smart_playlist,
            pre_resolve_youtube_url,
            toggle_exclusive_mode,
            get_exclusive_mode,
            toggle_bit_perfect_mode,
            get_bit_perfect_mode,
            get_network_telemetry,
            search_lyrics_online,
            get_unison_ttml,
            get_kugou_krc,
            get_netease_lrc,
            translate_lyric_line,
            translate_lyrics_batch,
            get_qqmusic_lrc,
            set_dsp_state,
            get_dsp_state,
            get_audio_devices,
            set_audio_device,
            apply_online_cover,
            apply_local_cover,
            search_covers_online,
            fetch_image_as_data_url,
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
            lastfm::lastfm_get_auth_url,
            cloud::save_keyring_secret,
            cloud::get_keyring_secret,
            cloud::delete_keyring_secret,
            get_artist_profile,
            mbz_search_recording,
            mbz_get_cover_art,
            set_discord_enabled,
            update_discord_presence,
            clear_discord_presence,
            get_playlists,
            create_playlist,
            delete_playlist,
            add_to_playlist,
            remove_from_playlist,
            reorder_playlist,
            get_playlist_tracks,
            add_track_to_library,
            add_track,
            delete_cached_track,
            delete_track,
            log_playback_start,
            log_playback_end,
            get_unsynced_history,
            mark_history_synced,
            get_listening_insights,
            youtube::search_youtube,
            youtube::get_artist_discography,
            youtube::get_search_suggestions,
            youtube::download_track,
            youtube::get_aideo_recommendations,
            youtube::check_and_download_ytdlp,
            youtube::get_youtube_autoplay_recommendations,
            youtube::get_personalized_discovery_hub,
            youtube::get_cached_discovery_hub,
            youtube::get_worldwide_leaderboard,
            tidal::tidal_login_start,
            tidal::tidal_login_poll_status,
            tidal::tidal_search,
            tidal::tidal_download,
            tidal::tidal_logout,
            tidal::tidal_get_stream_url,
            tidal::tidal_save_credentials,
            tidal::tidal_get_credentials,
            tidal::get_tidal_autoplay_recommendations,
            tidal::get_tidal_hub_recommendations,
            qobuz::qobuz_connect,
            qobuz::qobuz_status,
            qobuz::qobuz_logout,
            qobuz::qobuz_search,
            qobuz::qobuz_get_stream_url,
            qobuz::qobuz_download,
            qobuz::get_qobuz_autoplay_recommendations,
            updater::check_update,
            updater::download_and_install,
            toggle_keep_awake,
            add_to_queue_bulk,
            listenbrainz_scrobble,
            dependencies::get_dependencies_status,
            dependencies::install_dependency,
            dependencies::uninstall_dependency,
            dependencies::check_update_ytdlp,
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
            link_resolver::resolve_external_link,
            get_windows_accent_color,
            clear_application_cache,
            get_cache_size_info,
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
            get_track_by_path,
            read_audio_tags,
            write_audio_tags,
            batch_update_tags,
            toggle_desktop_lyrics,
            set_desktop_lyrics_ignore_cursor,
            get_desktop_lyrics_status,
            upnp_discover,
            upnp_connect,
            upnp_disconnect,
            upnp_play,
            upnp_control,
            upnp_get_status,
        ])
        .setup(|app| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_skip_taskbar(false);
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.center();
                let _ = w.set_focus();
            }

            let _ = (|| -> Result<(), Box<dyn std::error::Error>> {
                use tauri::menu::{Menu, MenuItem};

                let show_i = MenuItem::with_id(app, "show", "Show Aideo", true, None::<&str>)?;
                let quit_i = MenuItem::with_id(app, "quit", "Quit Aideo", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

                if let Some(tray) = app.tray_by_id("main-tray") {
                    let _ = tray.set_menu(Some(menu));
                    let _ = tray.set_show_menu_on_left_click(false);
                    let _ = tray.set_tooltip(Some("Aideo Music Player"));
                }

                Ok(())
            })();

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
                refresh_lock: tokio::sync::Mutex::new(()),
            });
            if let Some(sess) = tidal::TidalState::load_cached_session(app.handle()) {
                *safe_lock(&tidal_state.session) = Some(sess);
                *safe_lock(&tidal_state.logged_in) = true;
            }
            app.manage(tidal_state);

            let qobuz_state = std::sync::Arc::new(qobuz::QobuzState {
                session: std::sync::Mutex::new(None),
                logged_in: std::sync::Mutex::new(false),
                app_creds: std::sync::Mutex::new(None),
            });
            if let Some(sess) = qobuz::QobuzState::load_cached_session() {
                *safe_lock(&qobuz_state.session) = Some(sess);
                *safe_lock(&qobuz_state.logged_in) = true;
            }
            app.manage(qobuz_state);

            dependencies::spawn_background_ytdlp_updater(app.handle().clone());
            
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



            #[cfg(feature = "asio")]
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

                    let mut healed_count = 0;
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
                                    healed_count += 1;
                                }
                            }
                        }
                        // Small sleep to avoid throttling
                        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                    }
                    if healed_count > 0 {
                        let _ = app_handle_clone.emit("library-updated", ());
                    }
                }
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

#[cfg(test)]
mod write_text_file_tests {
    use super::*;

    #[test]
    fn test_valid_text_file_extensions() {
        assert!(is_valid_text_file_extension("playlist.m3u"));
        assert!(is_valid_text_file_extension("playlist.m3u8"));
        assert!(is_valid_text_file_extension("PLAYLIST.M3U8"));
        assert!(is_valid_text_file_extension("notes.txt"));
        assert!(is_valid_text_file_extension("data.json"));
        assert!(is_valid_text_file_extension("C:\\Users\\Music\\aideo-queue.m3u8"));
        assert!(is_valid_text_file_extension("/home/user/playlist.m3u"));
    }

    #[test]
    fn test_invalid_text_file_extensions() {
        assert!(!is_valid_text_file_extension("malicious.exe"));
        assert!(!is_valid_text_file_extension("script.bat"));
        assert!(!is_valid_text_file_extension("script.sh"));
        assert!(!is_valid_text_file_extension("no_extension"));
        assert!(!is_valid_text_file_extension(""));
        assert!(!is_valid_text_file_extension("playlist.m3u8.exe"));
        assert!(!is_valid_text_file_extension("image.png"));
    }

    #[test]
    fn test_trusted_oauth_hosts() {
        assert!(is_trusted_oauth_host("accounts.google.com"));
        assert!(is_trusted_oauth_host("github.com"));
        assert!(is_trusted_oauth_host("api.github.com"));
        assert!(is_trusted_oauth_host("auth.tidal.com"));
        assert!(is_trusted_oauth_host("login.tidal.com"));
        assert!(is_trusted_oauth_host("last.fm"));
        assert!(is_trusted_oauth_host("www.last.fm"));
        assert!(is_trusted_oauth_host("listenbrainz.org"));
        assert!(is_trusted_oauth_host("my-project.supabase.co"));
        assert!(is_trusted_oauth_host("localhost"));
        assert!(is_trusted_oauth_host("127.0.0.1"));
    }

    #[test]
    fn test_untrusted_oauth_hosts() {
        assert!(!is_trusted_oauth_host("evil.com"));
        assert!(!is_trusted_oauth_host("supabase.co.evil.com"));
        assert!(!is_trusted_oauth_host("phishing-google.com"));
        assert!(!is_trusted_oauth_host(""));
    }
}
