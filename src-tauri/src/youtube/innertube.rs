use tauri::{Manager, State};
use crate::AppState;
use crate::safe_lock;
use futures::StreamExt;
use super::matcher::*;
use super::{ChartEntry, ChartFallback, ChartPage, DiscoveryHubData, YoutubeMix, YoutubeTrack};

lazy_static::lazy_static! {
    static ref RE_INNERTUBE_1: regex::Regex = regex::Regex::new(r#""INNERTUBE_API_KEY"\s*:\s*"([^"]+)""#).unwrap();
    static ref RE_INNERTUBE_2: regex::Regex = regex::Regex::new(r#""innertubeApiKey"\s*:\s*"([^"]+)""#).unwrap();
    static ref RE_VIEWS: regex::Regex = regex::Regex::new(r"([\d\.]+)\s*([bmk])\s*(views|plays)").unwrap();
}

#[derive(Debug, Clone)]
pub(crate) struct ChartCandidate {
    pub(crate) rank: usize,
    pub(crate) title: String,
    pub(crate) artist: String,
    pub(crate) artwork_url: Option<String>,
    pub(crate) previous_rank: Option<usize>,
    pub(crate) weeks_on_chart: Option<usize>,
    pub(crate) listen_count: Option<u64>,
    pub(crate) recording_mbid: Option<String>,
}

#[derive(Debug)]
pub(crate) struct ListenBrainzChart {
    pub(crate) entries: Vec<ChartCandidate>,
    pub(crate) range: Option<String>,
    pub(crate) updated_at: Option<String>,
    pub(crate) total: Option<usize>,
}

pub(crate) fn chart_value_as_usize(value: Option<&serde_json::Value>) -> Option<usize> {
    value.and_then(|value| {
        value.as_u64().map(|number| number as usize).or_else(|| {
            value.as_str().and_then(|text| text.parse::<usize>().ok())
        })
    })
}

pub(crate) fn chart_value_as_u64(value: Option<&serde_json::Value>) -> Option<u64> {
    value.and_then(|value| {
        value.as_u64().or_else(|| value.as_str().and_then(|text| text.parse::<u64>().ok()))
    })
}

pub(crate) fn chart_mbid(value: Option<&serde_json::Value>) -> Option<String> {
    value
        .and_then(serde_json::Value::as_str)
        .filter(|mbid| {
            mbid.len() == 36
                && mbid
                    .chars()
                    .all(|character| character.is_ascii_hexdigit() || character == '-')
        })
        .map(str::to_string)
}

pub(crate) fn chart_slug(value: &str) -> String {
    let mut slug = String::with_capacity(value.len());
    let mut previous_separator = false;
    for character in value.chars().flat_map(char::to_lowercase) {
        if character.is_alphanumeric() {
            slug.push(character);
            previous_separator = false;
        } else if !previous_separator && !slug.is_empty() {
            slug.push('-');
            previous_separator = true;
        }
    }
    slug.trim_end_matches('-').chars().take(48).collect()
}

pub(crate) fn chart_entry_id(source: &str, candidate: &ChartCandidate) -> String {
    format!(
        "{}:{}:{}:{}",
        source,
        candidate.rank,
        chart_slug(&candidate.artist),
        chart_slug(&candidate.title)
    )
}

pub(crate) fn validate_chart_country(country: &str) -> Result<String, String> {
    let trimmed = country.trim();
    let lower = trimmed.to_lowercase();
    const NON_COUNTRY_SCOPES: [&str; 7] = [
        "asia",
        "europe",
        "north america",
        "south america",
        "africa",
        "oceania",
        "antarctica",
    ];

    if trimmed.is_empty()
        || trimmed.len() > 64
        || NON_COUNTRY_SCOPES.contains(&lower.as_str())
        || !trimmed
            .chars()
            .all(|character| character.is_alphabetic() || matches!(character, ' ' | '-' | '\''))
    {
        return Err("Choose a valid country for the Last.fm country chart.".to_string());
    }

    Ok(trimmed.to_string())
}

pub(crate) fn parse_billboard_candidates(
    json: &serde_json::Value,
    offset: usize,
    limit: usize,
) -> (Vec<ChartCandidate>, Option<String>) {
    let candidates = json
        .get("data")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .skip(offset)
        .take(limit)
        .enumerate()
        .filter_map(|(index, item)| {
            let title = item.get("song")?.as_str()?.trim();
            let artist = item.get("artist")?.as_str()?.trim();
            if title.is_empty() || artist.is_empty() {
                return None;
            }

            Some(ChartCandidate {
                rank: chart_value_as_usize(item.get("this_week")).unwrap_or(offset + index + 1),
                title: title.to_string(),
                artist: artist.to_string(),
                artwork_url: None,
                previous_rank: chart_value_as_usize(item.get("last_week")),
                weeks_on_chart: chart_value_as_usize(item.get("weeks_on_chart")),
                listen_count: None,
                recording_mbid: None,
            })
        })
        .collect();

    let date = json.get("date").and_then(serde_json::Value::as_str).map(str::to_string);
    (candidates, date)
}

pub(crate) fn parse_listenbrainz_candidates(json: &serde_json::Value) -> ListenBrainzChart {
    let payload = json.get("payload").unwrap_or(&serde_json::Value::Null);
    let offset = chart_value_as_usize(payload.get("offset")).unwrap_or(0);
    let entries = payload
        .get("recordings")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .filter_map(|(index, item)| {
            let title = item.get("track_name")?.as_str()?.trim();
            let artist = item.get("artist_name")?.as_str()?.trim();
            if title.is_empty() || artist.is_empty() {
                return None;
            }

            Some(ChartCandidate {
                rank: offset + index + 1,
                title: title.to_string(),
                artist: artist.to_string(),
                artwork_url: chart_mbid(item.get("caa_release_mbid")).map(|mbid| {
                    format!("https://coverartarchive.org/release/{mbid}/front-250")
                }),
                previous_rank: None,
                weeks_on_chart: None,
                listen_count: chart_value_as_u64(item.get("listen_count")),
                recording_mbid: chart_mbid(item.get("recording_mbid")),
            })
        })
        .collect();

    ListenBrainzChart {
        entries,
        range: payload.get("range").and_then(serde_json::Value::as_str).map(str::to_string),
        updated_at: payload.get("last_updated").map(|value| {
            value.as_str().map(str::to_string).unwrap_or_else(|| value.to_string())
        }),
        total: chart_value_as_usize(payload.get("total_recording_count")),
    }
}

fn is_duration(s: &str) -> bool {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() < 2 || parts.len() > 3 {
        return false;
    }
    parts.iter().all(|p| {
        let trimmed = p.trim();
        !trimmed.is_empty() && trimmed.chars().all(|c| c.is_ascii_digit())
    })
}

fn extract_duration(val: &serde_json::Value) -> Option<String> {
    if let serde_json::Value::Object(obj) = val {
        if let Some(serde_json::Value::String(text)) = obj.get("text") {
            if is_duration(text) {
                return Some(text.trim().to_string());
            }
        }
        for (_, v) in obj {
            if let Some(dur) = extract_duration(v) {
                return Some(dur);
            }
        }
    } else if let serde_json::Value::Array(arr) = val {
        for v in arr {
            if let Some(dur) = extract_duration(v) {
                return Some(dur);
            }
        }
    }
    None
}

fn extract_duration_safe(item: &serde_json::Value) -> Option<String> {
    if let Some(cols) = item.get("flexColumns").and_then(|c| c.as_array()) {
        for col in cols.iter().skip(1) {
            if let Some(dur) = extract_duration(col) {
                return Some(dur);
            }
        }
        None
    } else {
        extract_duration(item)
    }
}

fn find_video_id_safe(val: &serde_json::Value) -> Option<String> {
    if let serde_json::Value::Object(obj) = val {
        if let Some(serde_json::Value::String(vid)) = obj.get("videoId") {
            return Some(vid.clone());
        }
        for (k, v) in obj {
            if k == "menu" {
                continue;
            }
            if let Some(vid) = find_video_id_safe(v) {
                return Some(vid);
            }
        }
    } else if let serde_json::Value::Array(arr) = val {
        for v in arr {
            if let Some(vid) = find_video_id_safe(v) {
                return Some(vid);
            }
        }
    }
    None
}

fn find_list_items(val: &serde_json::Value, items: &mut Vec<serde_json::Value>) {
    if let serde_json::Value::Object(obj) = val {
        if let Some(renderer) = obj.get("musicResponsiveListItemRenderer") {
            items.push(renderer.clone());
        } else {
            for (_, v) in obj {
                find_list_items(v, items);
            }
        }
    } else if let serde_json::Value::Array(arr) = val {
        for v in arr {
            find_list_items(v, items);
        }
    }
}


fn get_fallback_innertube_key() -> String {
    let p1 = "AIzaSyAO_Cq3eb5Cu";
    let p2 = "uaQSS9g-U37stSrb7Sg5gQ";
    format!("{}{}", p1, p2)
}

lazy_static::lazy_static! {
    static ref INNERTUBE_KEY: tokio::sync::RwLock<Option<String>> = tokio::sync::RwLock::new(None);
    static ref VISITOR_DATA: tokio::sync::RwLock<Option<String>> = tokio::sync::RwLock::new(None);
    pub(crate) static ref RE_VISITOR_DATA: regex::Regex = regex::Regex::new(r#"Cgt[a-zA-Z0-9_%-]{20,}"#).unwrap();
}

pub async fn invalidate_innertube_key() {
    let mut w = INNERTUBE_KEY.write().await;
    *w = None;
    println!("[youtube] InnerTube API key invalidated.");
}

pub async fn invalidate_visitor_data() {
    let mut w = VISITOR_DATA.write().await;
    *w = None;
    println!("[youtube] InnerTube visitor data invalidated.");
}

pub async fn fetch_visitor_data() -> Option<String> {
    {
        let r = VISITOR_DATA.read().await;
        if let Some(ref cached) = *r {
            return Some(cached.clone());
        }
    }

    let mut w = VISITOR_DATA.write().await;
    if let Some(ref cached) = *w {
        return Some(cached.clone());
    }

    let client = crate::get_http_client();
    let res = client.get("https://www.youtube.com/sw.js_data")
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36")
        .send()
        .await
        .ok()?;

    let text = res.text().await.ok()?;
    if let Some(m) = RE_VISITOR_DATA.find(&text) {
        let val = m.as_str().to_string();
        *w = Some(val.clone());
        Some(val)
    } else {
        println!("[youtube] Could not extract visitor data regex match from sw.js_data response");
        None
    }
}

pub async fn fetch_innertube_key() -> String {
    {
        let r = INNERTUBE_KEY.read().await;
        if let Some(ref cached) = *r {
            return cached.clone();
        }
    }

    let mut w = INNERTUBE_KEY.write().await;
    if let Some(ref cached) = *w {
        return cached.clone();
    }

    let client = crate::get_http_client();

    let response = client.get("https://music.youtube.com/")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await;

    let html = match response {
        Ok(res) => res.text().await.unwrap_or_default(),
        Err(_) => {
            println!("⚠ [YOUTUBE ENGINE] Failed to connect to music.youtube.com. Using fallback InnerTube API key.");
            return get_fallback_innertube_key();
        }
    };

    let key = if let Some(caps) = RE_INNERTUBE_1.captures(&html) {
        caps.get(1).map(|m| m.as_str().to_string())
    } else if let Some(caps) = RE_INNERTUBE_2.captures(&html) {
        caps.get(1).map(|m| m.as_str().to_string())
    } else {
        None
    };

    let final_key = match key {
        Some(k) => k,
        None => {
            println!("⚠ [YOUTUBE ENGINE] Could not extract InnerTube API key from music.youtube.com HTML. Using fallback key.");
            get_fallback_innertube_key()
        }
    };

    *w = Some(final_key.clone());
    final_key
}

pub async fn fetch_track_duration(client: &reqwest::Client, api_key: &str, video_id: &str) -> Option<String> {
    let url = format!("https://music.youtube.com/youtubei/v1/player?key={}&prettyPrint=false", api_key);
    let payload = serde_json::json!({
        "videoId": video_id,
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": "1.20240101.01.00",
                "hl": "en",
                "gl": "US"
            }
        }
    });

    let res = client.post(&url)
        .header("Content-Type", "application/json")
        .header("Referer", "https://music.youtube.com/")
        .json(&payload)
        .send()
        .await
        .ok()?;

    let json_res: serde_json::Value = res.json().await.ok()?;

    let length_seconds_str = json_res.get("videoDetails")
        .and_then(|details| details.get("lengthSeconds"))
        .and_then(|len| len.as_str());

    let length_seconds = if let Some(s) = length_seconds_str {
        s.parse::<u32>().ok()?
    } else {
        json_res.get("videoDetails")
            .and_then(|details| details.get("lengthSeconds"))
            .and_then(|len| len.as_u64())? as u32
    };

    if length_seconds == 0 {
        return None;
    }

    let seconds = length_seconds % 60;
    let minutes = (length_seconds / 60) % 60;
    let hours = length_seconds / 3600;

    if hours > 0 {
        Some(format!("{}:{}:{:02}", hours, minutes, seconds))
    } else {
        Some(format!("{}:{:02}", minutes, seconds))
    }
}

pub const DIRECT_STREAM_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const DIRECT_CLIENT_VERSION: &str = "1.02";

/// Resolves and probes audio in-process before handing the URL to the downloader.
pub async fn resolve_innertube_stream_url(client: &reqwest::Client, api_key: &str, video_id: &str) -> Option<String> {
    match tokio::time::timeout(std::time::Duration::from_secs(15), resolve_direct_audio(client, api_key, video_id)).await {
        Ok(result) => result,
        Err(_) => {
            println!("[youtube] Direct resolution exceeded 15s; deferring to fallback.");
            None
        }
    }
}

async fn resolve_direct_audio(client: &reqwest::Client, api_key: &str, video_id: &str) -> Option<String> {
    let url = if api_key.is_empty() {
        "https://www.youtube.com/youtubei/v1/player?prettyPrint=false".to_string()
    } else {
        format!("https://www.youtube.com/youtubei/v1/player?key={}&prettyPrint=false", api_key)
    };

    let visitor_data = fetch_visitor_data().await;
    // ponytail: one maintained direct client; add another only after live failures justify it.
    // https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/youtube/_base.py
    let mut client_context = serde_json::json!({
        "clientName": "VISIONOS",
        "clientVersion": DIRECT_CLIENT_VERSION,
        "osName": "visionOS",
        "osVersion": "26.5.23O471",
        "deviceMake": "Apple",
        "deviceModel": "RealityDevice17,1",
        "userAgent": DIRECT_STREAM_USER_AGENT,
        "hl": "en",
        "gl": "US"
    });

    if let Some(ref vd) = visitor_data {
        if let Some(obj) = client_context.as_object_mut() {
            obj.insert("visitorData".to_string(), serde_json::Value::String(vd.clone()));
        }
    }

    let payload = serde_json::json!({
        "videoId": video_id,
        "context": {
            "client": client_context
        },
        "contentCheckOk": true,
        "racyCheckOk": true
    });

    let mut req = client.post(&url)
        .header("Content-Type", "application/json")
        .header("User-Agent", DIRECT_STREAM_USER_AGENT)
        .header("X-YouTube-Client-Name", "101")
        .header("X-YouTube-Client-Version", DIRECT_CLIENT_VERSION);

    if let Some(ref vd) = visitor_data {
        req = req.header("X-Goog-Visitor-Id", vd.as_str());
    }

    let res = req.json(&payload).send().await.ok()?.error_for_status().ok()?;
    let json_res: serde_json::Value = res.json().await.ok()?;

    let status = json_res.get("playabilityStatus")
        .and_then(|s| s.get("status"))
        .and_then(|s| s.as_str())
        .unwrap_or("");

    if status != "OK" {
        let reason = json_res.get("playabilityStatus")
            .and_then(|s| s.get("reason"))
            .and_then(|s| s.as_str())
            .unwrap_or("unknown reason");
        println!("[youtube] InnerTube playability status '{}' for video '{}': {}", status, video_id, reason);
        if status == "LOGIN_REQUIRED" || status == "UNPLAYABLE" {
            invalidate_visitor_data().await;
        }
        return None;
    }

    if json_res.pointer("/videoDetails/videoId").and_then(|id| id.as_str()) != Some(video_id) {
        return None;
    }
    probe_direct_candidates(client, direct_audio_candidates(&json_res)).await
}

pub(crate) async fn probe_direct_candidates(client: &reqwest::Client, candidates: Vec<String>) -> Option<String> {
    // ponytail: cap probes at three; add clients only when live evidence validates them.
    for (index, direct_url) in candidates.into_iter().take(3).enumerate() {
        if probe_direct_audio(client, &direct_url).await {
            if index > 0 {
                println!("[youtube] Direct audio recovered using format candidate {}.", index + 1);
            }
            return Some(direct_url);
        }
        println!("[youtube] Direct audio candidate {} failed its probe; trying next format.", index + 1);
    }
    println!("[youtube] No usable direct audio formats; deferring to fallback.");
    None
}

pub(crate) async fn probe_direct_audio(client: &reqwest::Client, url: &str) -> bool {
    let response = client.get(url)
        .header("User-Agent", DIRECT_STREAM_USER_AGENT)
        .header("Referer", "https://www.google.com/")
        .header("Range", "bytes=0-1023")
        .timeout(std::time::Duration::from_secs(5))
        .send().await;
    let Ok(mut response) = response else { return false; };
    if !matches!(response.status().as_u16(), 200 | 206) {
        return false;
    }
    let content_type = response.headers().get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok()).unwrap_or("");
    if !content_type.starts_with("audio/") && content_type != "application/octet-stream" {
        return false;
    }
    // Read one chunk only, even if the server ignores Range and offers the entire file.
    matches!(response.chunk().await, Ok(Some(bytes)) if !bytes.is_empty())
}

pub(crate) fn direct_audio_candidates(json_res: &serde_json::Value) -> Vec<String> {
    let Some(adaptive_formats) = json_res.get("streamingData")
        .and_then(|sd| sd.get("adaptiveFormats"))
        .and_then(|af| af.as_array()) else { return Vec::new(); };

    let mut candidates = Vec::new();

    for fmt in adaptive_formats {
        let mime = fmt.get("mimeType").and_then(|m| m.as_str()).unwrap_or("");
        if !mime.starts_with("audio/") {
            continue;
        }

        let direct_url = match fmt.get("url").and_then(|u| u.as_str()) {
            Some(u) if u.starts_with("http") => u,
            _ => continue,
        };
        let Ok(parsed) = url::Url::parse(direct_url) else { continue; };
        if parsed.scheme() != "https"
            || !parsed.host_str().is_some_and(|host| host == "googlevideo.com" || host.ends_with(".googlevideo.com"))
            || !parsed.username().is_empty() || parsed.password().is_some()
            || parsed.port_or_known_default() != Some(443)
        {
            continue;
        }

        let itag = fmt.get("itag").and_then(|i| i.as_u64()).unwrap_or(0);
        let score = match itag {
            251 => 100, // Opus 160kbps
            140 => 80,  // AAC 128kbps
            250 => 60,  // Opus 70kbps
            249 => 40,  // Opus 50kbps
            139 => 30,  // AAC 48kbps
            _ => 10,
        };

        candidates.push((score, direct_url.to_string()));
    }

    candidates.sort_by_key(|(score, _)| std::cmp::Reverse(*score));
    let mut seen = std::collections::HashSet::new();
    candidates.into_iter().map(|(_, url)| url).filter(|url| seen.insert(url.clone())).collect()
}

pub async fn resolve_youtube_stream_fast_async(url_or_id: &str) -> Option<String> {
    let video_id = extract_video_id(url_or_id)?;
    let client = crate::get_http_client();
    let api_key = fetch_innertube_key().await;
    resolve_innertube_stream_url(client, &api_key, &video_id).await
}

/// Synchronously resolves a direct stream URL via InnerTube.
/// NOTE: Spawns and blocks on a scoped OS thread if called from an active Tokio runtime thread.
/// Prefer `resolve_youtube_stream_fast_async` when calling from an async context.
pub fn resolve_youtube_stream_fast(url_or_id: &str) -> Option<String> {
    if let Ok(_handle) = tokio::runtime::Handle::try_current() {
        std::thread::scope(|s| {
            s.spawn(|| {
                if let Ok(rt) = tokio::runtime::Builder::new_current_thread().enable_all().build() {
                    rt.block_on(resolve_youtube_stream_fast_async(url_or_id))
                } else {
                    None
                }
            }).join().unwrap_or(None)
        })
    } else if let Ok(rt) = tokio::runtime::Builder::new_current_thread().enable_all().build() {
        rt.block_on(resolve_youtube_stream_fast_async(url_or_id))
    } else {
        None
    }
}

pub async fn search_youtube_internal(
    client: &reqwest::Client,
    api_key: &str,
    query: &str,
    resolve_durations: bool,
) -> Result<Vec<YoutubeTrack>, String> {
    search_youtube_internal_impl(client, api_key, query, resolve_durations, true).await
}

pub async fn search_youtube_internal_impl(
    client: &reqwest::Client,
    api_key: &str,
    query: &str,
    resolve_durations: bool,
    use_params: bool,
) -> Result<Vec<YoutubeTrack>, String> {
    let search_url = format!("https://music.youtube.com/youtubei/v1/search?key={}&prettyPrint=false", api_key);

    let mut payload = serde_json::json!({
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": "1.20240101.01.00",
                "hl": "en",
                "gl": "US"
            }
        },
        "query": query,
    });

    if use_params {
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("params".to_string(), serde_json::json!("EgWKAQIIAWoKEAkQChADEAQQCg=="));
        }
    }

    let res = client.post(&search_url)
        .header("Content-Type", "application/json")
        .header("Referer", "https://music.youtube.com/")
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json_res: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

    let mut items = Vec::new();
    find_list_items(&json_res, &mut items);

    let mut scored_tracks = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();

    for item in items {
        let runs = item.get("flexColumns")
            .and_then(|cols| cols.as_array())
            .and_then(|cols| cols.get(1))
            .and_then(|col| col.get("musicResponsiveListItemFlexColumnRenderer"))
            .and_then(|renderer| renderer.get("text"))
            .and_then(|text| text.get("runs"))
            .and_then(|runs| runs.as_array());

        let mut is_track = false;
        let mut artist = "Unknown Artist".to_string();

        let mut views_score = 0.0;
        let mut is_official_topic = false;
        let mut is_song_type = false;

        if let Some(runs_arr) = runs {
            if let Some(first_run_text) = runs_arr.first().and_then(|r| r.get("text")).and_then(|t| t.as_str()) {
                if first_run_text == "Song" || first_run_text == "Video" {
                    is_track = true;
                    if first_run_text == "Song" {
                        is_song_type = true;
                    }
                    let mut artist_parts = Vec::new();
                    // Skip type prefix ("Song"/"Video") and separator bullet " • " (first 2 runs)
                    for run in runs_arr.iter().skip(2) {
                        if let Some(text) = run.get("text").and_then(|t| t.as_str()) {
                            if text == " • " {
                                break;
                            }
                            artist_parts.push(text);
                        }
                    }
                    if !artist_parts.is_empty() {
                        artist = artist_parts.join("");
                    }
                } else if first_run_text != "Album" && first_run_text != "Artist" && first_run_text != "Playlist" && first_run_text != "Station" && first_run_text != "EP" && first_run_text != "Single" {
                    // Filtered Songs search format: starts directly with Artist name!
                    // Since it has no prefix, we are guaranteed it's a song because of the query params filter.
                    is_track = true;
                    is_song_type = true;

                    let mut artist_parts = Vec::new();
                    for run in runs_arr {
                        if let Some(text) = run.get("text").and_then(|t| t.as_str()) {
                            if text == " • " {
                                break;
                            }
                            artist_parts.push(text);
                        }
                    }
                    if !artist_parts.is_empty() {
                        artist = artist_parts.join("");
                    }
                }
            }
            for run in runs_arr {
                if let Some(text) = run.get("text").and_then(|t| t.as_str()) {
                    let text_lower = text.to_lowercase();
                    if text_lower.ends_with(" - topic") || (text_lower == "topic" && artist != "Topic") {
                        is_official_topic = true;
                    }
                    if let Some(caps) = RE_VIEWS.captures(&text_lower) {
                        if let Some(suffix) = caps.get(2).map(|m| m.as_str()) {
                            match suffix {
                                "b" => views_score = 5.0,
                                "m" => views_score = 3.0,
                                "k" => views_score = 1.0,
                                _ => {}
                            }
                        }
                    }
                }
            }
        }

        if !is_track {
            continue;
        }

        // Get video_id prioritizing direct, robust paths
        let video_id = item.get("playlistItemData")
            .and_then(|d| d.get("videoId"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| {
                item.get("overlay")
                    .and_then(|o| o.get("musicItemThumbnailOverlayRenderer"))
                    .and_then(|o| o.get("content"))
                    .and_then(|c| c.get("musicPlayButtonRenderer"))
                    .and_then(|p| p.get("playNavigationEndpoint"))
                    .and_then(|e| e.get("watchEndpoint"))
                    .and_then(|w| w.get("videoId"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            })
            .or_else(|| find_video_id_safe(&item));

        let video_id = match video_id {
            Some(id) => id,
            None => continue,
        };

        if seen_ids.contains(&video_id) {
            continue;
        }

        let title = item.get("flexColumns")
            .and_then(|cols| cols.as_array())
            .and_then(|cols| cols.first())
            .and_then(|col| col.get("musicResponsiveListItemFlexColumnRenderer"))
            .and_then(|renderer| renderer.get("text"))
            .and_then(|text| text.get("runs"))
            .and_then(|runs| runs.as_array())
            .map(|runs| {
                runs.iter()
                    .filter_map(|r| r.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join("")
            })
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| "Unknown Title".to_string());

        let duration_raw = extract_duration_safe(&item).unwrap_or_else(|| "0:00".to_string());

        // Primary path: musicThumbnailRenderer
        let thumbnail_url = item.get("thumbnail")
            .and_then(|t| t.get("musicThumbnailRenderer"))
            .and_then(|mt| mt.get("thumbnail"))
            .and_then(|t| t.get("thumbnails"))
            .and_then(|arr| arr.as_array())
            .and_then(|arr| arr.last())
            .and_then(|t| t.get("url"))
            .and_then(|u| u.as_str())
            // Fallback: croppedSquareThumbnailRenderer
            .or_else(|| {
                item.get("thumbnail")
                    .and_then(|t| t.get("croppedSquareThumbnailRenderer"))
                    .and_then(|mt| mt.get("thumbnail"))
                    .and_then(|t| t.get("thumbnails"))
                    .and_then(|arr| arr.as_array())
                    .and_then(|arr| arr.last())
                    .and_then(|t| t.get("url"))
                    .and_then(|u| u.as_str())
            });

        let cover_url = thumbnail_url.map(|url| {
            if let Some(pos) = url.find("=w") {
                url.get(..pos).map(|prefix| format!("{}=w500-h500-l90-rj", prefix)).unwrap_or_else(|| url.to_string())
            } else if let Some(pos) = url.find("=s") {
                url.get(..pos).map(|prefix| format!("{}=w500-h500-l90-rj", prefix)).unwrap_or_else(|| url.to_string())
            } else {
                url.to_string()
            }
        }).or_else(|| {
            // Ultimate fallback: use YouTube video thumbnail via videoId
            Some(format!("https://i.ytimg.com/vi/{}/mqdefault.jpg", video_id))
        });

        let url = format!("https://www.youtube.com/watch?v={}", video_id);

        seen_ids.insert(video_id.clone());

        let mut title_score = 0.0;
        let title_lower = title.to_lowercase();
        let query_lower = query.to_lowercase();

        // Reject third-party slop (reactions, fancams, karaoke, tutorials, etc.) unless user explicitly searched for them
        if is_third_party_or_instrumental(&title, &artist) {
            let explicitly_requested = [
                "karaoke", "reaction", "cover", "remix", "fancam", "slowed", "nightcore", "tutorial", "lesson",
                "sped up", "speed up", "spedup", "speedup", "piano", "tribute",
            ].iter().any(|&term| query_lower.contains(term));

            if !explicitly_requested {
                continue;
            }
        }

        // Penalize unofficial versions unless query specifically asked for them
        let negative_terms = vec![
            ("cover", -6.0),
            ("remix", -4.0),
            ("live", -3.0),
            ("karaoke", -6.0),
            ("slowed", -5.0),
            ("reverb", -5.0),
            ("tribute", -5.0),
            ("10 hours", -6.0),
            ("10 hrs", -6.0),
            ("loop", -5.0),
            ("nightcore", -6.0),
            ("fanmade", -6.0),
            ("cover art", -4.0),
            ("sped up", -6.0),
            ("speed up", -6.0),
            ("spedup", -6.0),
            ("speedup", -6.0),
            ("piano cover", -6.0),
            ("piano version", -6.0),
        ];

        let artist_lower = artist.to_lowercase();
        for (term, penalty) in negative_terms {
            let in_title = title_lower.contains(term);
            let in_artist = artist_lower.contains(term);
            if (in_title || in_artist) && !query_lower.contains(term) {
                title_score += penalty;
            }
        }

        // Boost official title tags
        let positive_terms = vec![
            ("official audio", 2.0),
            ("official video", 1.5),
            ("official music video", 2.0),
            ("original mix", 1.5),
            ("original", 1.0),
        ];

        for (term, boost) in positive_terms {
            if title_lower.contains(term) {
                title_score += boost;
            }
        }

        let query_cleaned = query_lower.replace(" song", "")
            .replace(" audio", "")
            .replace(" video", "")
            .replace(" mv", "")
            .replace(" m/v", "")
            .trim()
            .to_string();

        if title_lower == query_cleaned {
            title_score += 6.0;
        } else if title_lower.starts_with(&query_cleaned) && title_lower.len() <= query_cleaned.len() + 5 {
            title_score += 4.0;
        } else if query_cleaned.contains(&title_lower) && title_lower.len() >= 4 {
            title_score += 2.0;
        }

        let mut priority_score = 0.0;
        if is_song_type {
            priority_score += 4.0; // Huge boost for standard Song audio
        }
        if is_official_topic {
            priority_score += 5.0; // Massive boost for Artist - Topic releases
        }
        priority_score += views_score;
        priority_score += title_score;

        scored_tracks.push((YoutubeTrack {
            id: video_id,
            title,
            artist,
            cover_url,
            duration_raw,
            url,
            recommendation_source: None,
            source_context: None,
        }, priority_score));
    }

    // Sort by priority_score descending to rank official releases & high views first
    scored_tracks.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let mut tracks = Vec::new();
    for (track, _) in scored_tracks {
        tracks.push(track);
    }

    println!("[youtube] Found {} unique tracks on YTM for query: {}", tracks.len(), query);

    let mut duration_tasks = Vec::new();
    for (i, track) in tracks.iter().enumerate() {
        if track.duration_raw == "0:00" {
            let client = client.clone();
            let api_key = api_key.to_string();
            let video_id = track.id.clone();
            duration_tasks.push(async move {
                if let Some(dur) = fetch_track_duration(&client, &api_key, &video_id).await {
                    (i, dur)
                } else {
                    (i, "0:00".to_string())
                }
            });
        }
    }

    if resolve_durations && !duration_tasks.is_empty() {
        println!("[youtube] Resolving {} missing track durations in batches of 4...", duration_tasks.len());
        let mut stream = futures::stream::iter(duration_tasks).buffer_unordered(4);
        while let Some((i, dur)) = stream.next().await {
            if dur != "0:00" {
                tracks[i].duration_raw = dur;
            }
        }
    }

    Ok(tracks)
}

pub async fn get_search_suggestions_internal(query: String) -> Result<Vec<String>, String> {
    let url = format!(
        "https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q={}",
        urlencoding::encode(&query)
    );
    let client = crate::get_http_client();
    let res = client.get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let body = res.text().await.map_err(|e| e.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let mut suggestions = Vec::new();
    if let Some(arr) = json.get(1).and_then(|v| v.as_array()) {
        for item in arr {
            if let Some(s) = item.as_str() {
                suggestions.push(s.to_string());
            }
        }
    }
    Ok(suggestions)
}

pub async fn get_aideo_recommendations_internal(top_artists: Vec<String>, exclude_ids: Vec<String>) -> Result<Vec<YoutubeTrack>, String> {
    let api_key = fetch_innertube_key().await;
    let client = crate::get_http_client();

    let (queries, is_empty_fallback) = if top_artists.is_empty() {
        (
            vec![
                "Lofi Chill beats".to_string(),
                "Synthwave Retro".to_string(),
                "Chill Vibes".to_string(),
                "Acoustic Pop".to_string(),
            ],
            true,
        )
    } else {
        let mut seen = std::collections::HashSet::new();
        let mut artist_queries = Vec::new();
        for artist in top_artists.iter().take(5) {
            let q = format!("{} songs", artist);
            if seen.insert(q.to_lowercase()) {
                artist_queries.push(q);
            }
        }
        (artist_queries, false)
    };

    println!(
        "[youtube] Generating recommendations (fallback={}) for queries: {:?}",
        is_empty_fallback, queries
    );

    let mut tasks = Vec::new();
    for query in queries {
        let client = client.clone();
        let api_key = api_key.clone();
        tasks.push(async move {
            search_youtube_internal(&client, &api_key, &query, false).await
        });
    }

    let search_results = futures::future::join_all(tasks).await;
    let mut results = Vec::new();
    for res in search_results {
        match res {
            Ok(tracks) => results.push(tracks),
            Err(e) => println!("[youtube] Recommendation query search failed: {}", e),
        }
    }

    let mut final_tracks = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for id in exclude_ids {
        seen.insert(id);
    }

    let mut iterators: Vec<_> = results.into_iter().map(|v| v.into_iter()).collect();
    let mut active = true;

    while active && final_tracks.len() < 15 {
        active = false;
        for it in &mut iterators {
            if let Some(track) = it.next() {
                active = true;
                if !seen.contains(&track.id) {
                    seen.insert(track.id.clone());
                    if is_duration_too_long(&track.duration_raw) {
                        println!(
                            "[youtube] Filtering out recommended track '{}' because duration exceeds 20 minutes ({})",
                            track.title, track.duration_raw
                        );
                        continue;
                    }
                    if is_third_party_or_instrumental(&track.title, &track.artist) {
                        println!(
                            "[youtube] Filtering out recommended track '{}' by '{}' because it is instrumental or third-party",
                            track.title, track.artist
                        );
                        continue;
                    }
                    final_tracks.push(track);
                    if final_tracks.len() >= 15 {
                        break;
                    }
                }
            }
        }
    }

    println!(
        "[youtube] Generated {} recommendations successfully.",
        final_tracks.len()
    );

    // Resolve durations for final selected 15 tracks concurrently!
    let mut duration_tasks = Vec::new();
    for (i, track) in final_tracks.iter().enumerate() {
        if track.duration_raw == "0:00" {
            let client = client.clone();
            let api_key = api_key.to_string();
            let video_id = track.id.clone();
            duration_tasks.push(async move {
                if let Some(dur) = fetch_track_duration(&client, &api_key, &video_id).await {
                    (i, dur)
                } else {
                    (i, "0:00".to_string())
                }
            });
        }
    }

    if !duration_tasks.is_empty() {
        println!("[youtube] Resolving {} missing track durations for final recommendations in batches of 4...", duration_tasks.len());
        let mut stream = futures::stream::iter(duration_tasks).buffer_unordered(4);
        while let Some((i, dur)) = stream.next().await {
            if dur != "0:00" {
                final_tracks[i].duration_raw = dur;
            }
        }
    }

    final_tracks.retain(|track| is_known_duration_within_limit(&track.duration_raw));

    Ok(final_tracks)
}

fn find_playlist_panel_videos(val: &serde_json::Value, items: &mut Vec<serde_json::Value>) {
    if let serde_json::Value::Object(obj) = val {
        if let Some(renderer) = obj.get("playlistPanelVideoRenderer") {
            items.push(renderer.clone());
        } else {
            for (_, v) in obj {
                find_playlist_panel_videos(v, items);
            }
        }
    } else if let serde_json::Value::Array(arr) = val {
        for v in arr {
            find_playlist_panel_videos(v, items);
        }
    }
}

pub(crate) struct AutoplayTasteProfile<'a> {
    pub(crate) top_artists: &'a [String],
    pub(crate) library_artists: &'a [String],
    pub(crate) discovery_level: &'a str,
    pub(crate) recently_played: &'a std::collections::HashSet<String>,
    pub(crate) artist_skip_stats: &'a std::collections::HashMap<String, (i64, i64)>,
    pub(crate) loved_tokens: &'a std::collections::HashMap<String, u32>,
}

pub(crate) fn score_autoplay_candidate(profile: &AutoplayTasteProfile, title: &str, artist: &str) -> f64 {
    let mut score = 1.0;
    let candidate_artist_lower = artist.to_lowercase();

    let is_top_artist = profile.top_artists.iter().any(|ta| {
        let ta_lower = ta.to_lowercase();
        candidate_artist_lower.contains(&ta_lower) || ta_lower.contains(&candidate_artist_lower)
    });

    let is_library_artist = profile.library_artists.iter().any(|la| {
        let la_lower = la.to_lowercase();
        candidate_artist_lower.contains(&la_lower) || la_lower.contains(&candidate_artist_lower)
    });

    match profile.discovery_level {
        "familiarity" => {
            if is_top_artist {
                score += 0.85;
            } else if is_library_artist {
                score += 0.35;
            } else {
                score -= 0.6;
            }
        }
        "discovery" => {
            if is_top_artist {
                score -= 0.7;
            } else if is_library_artist {
                score += 0.55;
            } else {
                score += 0.55;
            }
        }
        _ => {
            if is_top_artist {
                score += 0.25;
            }
            if is_library_artist && !is_top_artist {
                score += 0.35;
            }
        }
    }

    let clean_t = clean_title(title);
    let clean_a = candidate_artist_lower.trim().to_string();
    let track_key = format!("{} - {}", clean_a, clean_t);
    if profile.recently_played.contains(&track_key) {
        score -= 0.50;
    }

    if let Some(&(total, skipped)) = profile.artist_skip_stats.get(&candidate_artist_lower) {
        if total >= 3 {
            let skip_ratio = skipped as f64 / total as f64;
            if skip_ratio > 0.6 {
                score -= 0.70 * skip_ratio;
            } else if skip_ratio < 0.2 {
                score += 0.25 * (1.0 - skip_ratio);
            }
        }
    }

    let mut token_match_count = 0.0;
    for word in title.split_whitespace() {
        let clean_word = word.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase();
        if let Some(&freq) = profile.loved_tokens.get(&clean_word) {
            token_match_count += 0.05 * (freq as f64).min(5.0);
        }
    }
    score += token_match_count.min(0.20);

    score
}

pub(crate) struct DiscoveryTasteProfile<'a> {
    pub(crate) loved_artists: &'a [String],
    pub(crate) top_artists: &'a [String],
    pub(crate) library_artists: &'a [String],
    pub(crate) discovery_level: &'a str,
    pub(crate) artist_skip_stats: &'a std::collections::HashMap<String, (i64, i64)>,
}

pub(crate) fn score_discovery_candidate(profile: &DiscoveryTasteProfile, base_score: f64, artist: &str) -> f64 {
    let mut score = base_score;
    let candidate_artist_lower = artist.to_lowercase();

    let is_loved_artist = profile.loved_artists.iter().any(|la| {
        let la_lower = la.to_lowercase();
        candidate_artist_lower.contains(&la_lower) || la_lower.contains(&candidate_artist_lower)
    });
    let is_top_artist = profile.top_artists.iter().any(|ta| {
        let ta_lower = ta.to_lowercase();
        candidate_artist_lower.contains(&ta_lower) || ta_lower.contains(&candidate_artist_lower)
    });
    let is_library_artist = profile.library_artists.iter().any(|la| {
        let la_lower = la.to_lowercase();
        candidate_artist_lower.contains(&la_lower) || la_lower.contains(&candidate_artist_lower)
    });

    if is_loved_artist { score += 1.5; }

    match profile.discovery_level {
        "familiarity" => {
            if is_top_artist { score += 1.00; }
            else if is_library_artist { score += 0.40; }
            else { score -= 0.90; }
        }
        "discovery" => {
            if is_top_artist { score -= 1.00; }
            else if is_library_artist { score += 0.50; }
            else { score += 1.30; }
        }
        _ => {
            if is_top_artist { score += 0.25; }
            if is_library_artist && !is_top_artist { score += 0.35; }
        }
    }

    if let Some(&(total, skipped)) = profile.artist_skip_stats.get(&candidate_artist_lower) {
        if total >= 3 {
            let skip_ratio = skipped as f64 / total as f64;
            if skip_ratio > 0.5 { score -= 0.80 * skip_ratio; }
            else if skip_ratio < 0.2 { score += 0.35 * (1.0 - skip_ratio); }
        }
    }

    score
}

pub async fn get_youtube_autoplay_recommendations_internal(
    video_id: String,
    artist: String,
    title: String,
    top_artists: Vec<String>,
    library_artists: Vec<String>,
    discovery_level: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<YoutubeTrack>, String> {
    crate::tidal::bounded_recommendation(async {

    let api_key = fetch_innertube_key().await;
    println!("[youtube] Aideo Autoplay Engine v2: Resolving Watch Next Radio for '{}' by '{}' (Discovery Level: {})", title, artist, discovery_level);

    let client = crate::get_http_client();

    // If video_id is not a clean 11-char ID and we have artist/title, resolve the seed video_id via YouTube search
    let mut resolved_video_id = video_id.trim().to_string();
    if (resolved_video_id.len() != 11 || resolved_video_id.contains('/') || resolved_video_id.contains('&') || resolved_video_id.contains('?'))
        && (!artist.is_empty() || !title.is_empty())
    {
        let query = if !artist.is_empty() && !title.is_empty() && artist != "Unknown Artist" {
            format!("{} {}", artist, title)
        } else if !title.is_empty() && title != "Unknown Title" {
            title.clone()
        } else {
            artist.clone()
        };
        if let Ok(search_results) = search_youtube_internal(&client, &api_key, &query, false).await {
            if let Some(first) = search_results.into_iter().next() {
                resolved_video_id = first.id;
                println!("[youtube] Resolved seed video_id for autoplay: '{}'", resolved_video_id);
            }
        }
    }

    // --- CANDIDATE GENERATION SOURCE 1: YouTube Music Watch Next ---
    let mut tracks = Vec::new();
    if resolved_video_id.len() == 11 {
        let search_url = format!("https://music.youtube.com/youtubei/v1/next?key={}&prettyPrint=false", api_key);
        let payload = serde_json::json!({
            "context": {
                "client": {
                    "clientName": "WEB_REMIX",
                    "clientVersion": "1.20240101.01.00",
                    "hl": "en",
                    "gl": "US"
                }
            },
            "videoId": resolved_video_id,
            "playlistId": format!("RDAMVM{}", resolved_video_id)
        });

        if let Ok(res) = client.post(&search_url)
            .header("Content-Type", "application/json")
            .header("Referer", "https://music.youtube.com/")
            .json(&payload)
            .send()
            .await
        {
            if let Ok(json_res) = res.json::<serde_json::Value>().await {
                let mut items = Vec::new();
                find_playlist_panel_videos(&json_res, &mut items);

                let mut seen_ids = std::collections::HashSet::new();
                seen_ids.insert(resolved_video_id.clone());

                for item in items {
                    let id = match item.get("videoId").and_then(|v| v.as_str()) {
                        Some(s) => s.to_string(),
                        None => continue,
                    };

                    if seen_ids.contains(&id) {
                        continue;
                    }

                    let track_title = item.get("title")
                        .and_then(|t| t.get("runs"))
                        .and_then(|r| r.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(|first| first.get("text"))
                        .and_then(|t| t.as_str())
                        .unwrap_or("Unknown Title")
                        .to_string();

                    let mut track_artist = item.get("longBylineText")
                        .or_else(|| item.get("shortBylineText"))
                        .and_then(|b| b.get("runs"))
                        .and_then(|r| r.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(|first| first.get("text"))
                        .and_then(|t| t.as_str())
                        .unwrap_or("Unknown Artist")
                        .to_string();

                    if (track_artist == "Unknown Artist" || track_artist.contains("Radio") || track_artist.contains("Official") || track_artist.contains("Records") || track_artist.contains("Channel"))
                        && track_title.contains(" - ")
                    {
                        let parts: Vec<&str> = track_title.splitn(2, " - ").collect();
                        if parts.len() == 2 && !parts[0].trim().is_empty() {
                            track_artist = parts[0].trim().to_string();
                        }
                    }

                    let thumbnail_url = item.get("thumbnail")
                        .and_then(|t| t.get("thumbnails"))
                        .and_then(|arr| arr.as_array())
                        .and_then(|arr| arr.last())
                        .and_then(|t| t.get("url"))
                        .and_then(|u| u.as_str());

                    let cover_url = thumbnail_url.map(|url| {
                        if let Some(pos) = url.find("=w") {
                            url.get(..pos).map(|prefix| format!("{}=w500-h500-l90-rj", prefix)).unwrap_or_else(|| url.to_string())
                        } else if let Some(pos) = url.find("=s") {
                            url.get(..pos).map(|prefix| format!("{}=w500-h500-l90-rj", prefix)).unwrap_or_else(|| url.to_string())
                        } else {
                            url.to_string()
                        }
                    }).or_else(|| {
                        Some(format!("https://i.ytimg.com/vi/{}/mqdefault.jpg", id))
                    });

                    let duration_raw = item.get("lengthText")
                        .and_then(|l| l.get("runs"))
                        .and_then(|r| r.as_array())
                        .and_then(|arr| arr.first())
                        .and_then(|first| first.get("text"))
                        .and_then(|t| t.as_str())
                        .unwrap_or("0:00")
                        .to_string();

                    let url = format!("https://www.youtube.com/watch?v={}", id);
                    seen_ids.insert(id.clone());

                    tracks.push(YoutubeTrack {
                        id,
                        title: track_title,
                        artist: track_artist,
                        cover_url,
                        duration_raw,
                        url,
                        recommendation_source: Some("youtube_radio".to_string()),
                        source_context: None,
                    });
                }
            }
        }
    }

    // --- CANDIDATE GENERATION SOURCE 2: Hybrid Collaborative Loved Seeds & Current Track (Last.fm) ---
    // Only query Last.fm / loved seeds if Source 1 returned fewer than 10 tracks to prevent cross-genre contamination
    if tracks.len() < 10 {
        let extra_seeds: Vec<(String, String)> = {
            let mut seeds = Vec::new();
            let conn = crate::safe_lock(&state.db);

            // Look for loved streams by the exact same artist
            if let Ok(mut stmt) = conn.prepare(
                "SELECT title, artist FROM tracks
                 WHERE loved = 1
                   AND LOWER(artist) = LOWER(?1)
                   AND (path LIKE 'http%' OR format IN ('YouTube Direct', 'Tidal FLAC', 'SUBSONIC', 'JELLYFIN'))
                 ORDER BY RANDOM() LIMIT 2"
            ) {
                if let Ok(mut rows) = stmt.query(rusqlite::params![artist]) {
                    while let Some(row) = rows.next().unwrap_or(None) {
                        if let (Ok(t_title), Ok(t_artist)) = (row.get::<_, String>(0), row.get::<_, String>(1)) {
                            seeds.push((t_title, t_artist));
                        }
                    }
                }
            }
            seeds
        };

        use futures::FutureExt;
        let mut lastfm_candidates = Vec::new();
        let mut collaborative_tasks = Vec::new();

        // Seed 1: Current track
        let seed_artist = artist.clone();
        let seed_title = title.clone();
        collaborative_tasks.push(async move {
            crate::lastfm_api::get_similar_tracks(&seed_artist, &seed_title).await
        }.boxed());

        // Seed 2 & 3: Random loved streams by the same artist
        for (s_title, s_artist) in extra_seeds {
            collaborative_tasks.push(async move {
                crate::lastfm_api::get_similar_tracks(&s_artist, &s_title).await
            }.boxed());
        }

        let collaborative_results = futures::future::join_all(collaborative_tasks).await;
        for res in collaborative_results {
            if let Ok(sim_tracks) = res {
                for t in sim_tracks {
                    let track_title = t.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
                    let track_artist = t.get("artist").and_then(|a| a.get("name")).and_then(|n| n.as_str()).unwrap_or("").to_string();
                    if !track_title.is_empty() && !track_artist.is_empty() {
                        lastfm_candidates.push((track_title, track_artist));
                    }
                }
            }
        }

        if lastfm_candidates.is_empty() && !artist.is_empty() && artist != "Unknown Artist" {
            if let Ok(sim_artists) = crate::lastfm_api::get_similar_artists(&artist).await {
                for sim_art in sim_artists.iter().take(3) {
                    if let Ok(top_tracks) = crate::lastfm_api::get_artist_top_tracks(sim_art).await {
                        for t in top_tracks {
                            let track_title = t.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
                            if !track_title.is_empty() {
                                lastfm_candidates.push((track_title, sim_art.clone()));
                            }
                        }
                    }
                }
            }
        }

        // Resolve top 3 Last.fm candidates concurrently in parallel
        if !lastfm_candidates.is_empty() {
            let mut lastfm_futures = Vec::new();
            for (t_title, t_artist) in lastfm_candidates.into_iter().take(3) {
                let client_clone = client.clone();
                let api_key_clone = api_key.clone();
                lastfm_futures.push(async move {
                    let query = format!("{} {}", t_artist, t_title);
                    if let Ok(results) = search_youtube_internal(&client_clone, &api_key_clone, &query, false).await {
                        if let Some(first) = results.into_iter().next() {
                            return Some(first);
                        }
                    }
                    None
                });
            }

            let resolved_lastfm: Vec<YoutubeTrack> = futures::future::join_all(lastfm_futures)
                .await
                .into_iter()
                .flatten()
                .collect();

            println!("[youtube] Successfully integrated {} collaborative candidates from Last.fm!", resolved_lastfm.len());

            for tr in resolved_lastfm {
                if !tracks.iter().any(|t| t.id == tr.id) {
                    tracks.push(tr);
                }
            }
        }
    }

    // Fallback if candidate generation returned very few tracks
    if tracks.len() < 5 && !artist.is_empty() && artist != "Unknown Artist" {
        println!("[youtube] Autoplay candidates under threshold. Executing targeted fallback search for artist: {}", artist);
        let search_query = format!("{} official audio", artist);
        if let Ok(fallback_tracks) = search_youtube_internal(&client, &api_key, &search_query, false).await {
            for fb_track in fallback_tracks {
                if !tracks.iter().any(|t| t.id == fb_track.id) {
                    tracks.push(fb_track);
                }
            }
        }
    }

    // Query recently played track titles/artists from db for taste weighting (not hard dropping)
    let recently_played: std::collections::HashSet<String> = {
        let mut plays = std::collections::HashSet::new();
        let conn = crate::safe_lock(&state.db);
        if let Ok(mut stmt) = conn.prepare(
            "SELECT title, artist FROM playback_history
             WHERE title IS NOT NULL AND artist IS NOT NULL AND title != '' AND artist != ''
             ORDER BY timestamp DESC LIMIT 100"
        ) {
            if let Ok(mut rows) = stmt.query([]) {
                while let Some(row) = rows.next().unwrap_or(None) {
                    if let (Ok(t), Ok(a)) = (row.get::<_, String>(0), row.get::<_, String>(1)) {
                        let clean_t = clean_title(&t);
                        let clean_a = a.to_lowercase().trim().to_string();
                        plays.insert(format!("{} - {}", clean_a, clean_t));
                    }
                }
            }
        }
        plays
    };

    // ── AIDEO AUTOPLAY ENGINE V2 FILTER PIPELINE ──
    let _artist_lower = artist.to_lowercase();
    let clean_seed_title = clean_title(&title);
    let mut filtered_tracks = Vec::new();
    let mut seen_tracks: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();

    for track in tracks {
        // 0. Skip exact seed video ID
        if track.id == resolved_video_id {
            continue;
        }

        // 1. Instrumental/Third-Party Filter
        if is_third_party_or_instrumental(&track.title, &track.artist) {
            println!("[autoplay-filter] Drop instrumental/third-party track: '{}' by '{}'", track.title, track.artist);
            continue;
        }

        // 2. Semantic Noise Filter
        if is_semantic_noise(&track.title, &title) {
            println!("[autoplay-filter] Drop semantic noise: '{}' by '{}'", track.title, track.artist);
            continue;
        }

        // 3. Precise Deduplication against Seed:
        // Only drop if candidate is the exact same song by matching artist, or identical clean title with matching artist
        let is_same_artist = artist_matches(&track.artist, &artist);
        let clean_cand = clean_title(&track.title);
        let is_same_title = clean_seed_title == clean_cand && !clean_cand.is_empty();
        let sim = fuzzy_title_similarity(&track.title, &title);

        if (is_same_artist && (sim > 0.65 || is_same_title)) || (is_same_title && is_same_artist) {
            println!("[autoplay-filter] Drop duplicate seed song: '{}' by '{}' (Similarity: {:.2}%)", track.title, track.artist, sim * 100.0);
            continue;
        }

        // 4. Track Duration Filter (Drop >15 mins / 900s)
        let is_too_long = is_duration_too_long(&track.duration_raw);
        if is_too_long {
            println!("[autoplay-filter] Drop long-duration track: '{}' ({})", track.title, track.duration_raw);
            continue;
        }

        // 5. De-duplicate clean titles and artists inside the recommended list itself
        let artist_key = track.artist.trim().to_lowercase();
        let track_key = (artist_key, clean_cand);
        if seen_tracks.contains(&track_key) {
            continue;
        }
        seen_tracks.insert(track_key);

        filtered_tracks.push(track);
    }

    // ── TASTE-WEIGHTED SCORING PIPELINE ──
    let artist_skip_stats: std::collections::HashMap<String, (i64, i64)> = {
        let mut stats = std::collections::HashMap::new();
        let conn = crate::safe_lock(&state.db);
        if let Ok(mut stmt) = conn.prepare(
            "SELECT artist, COUNT(*), SUM(skipped) FROM playback_history GROUP BY artist"
        ) {
            if let Ok(mut rows) = stmt.query([]) {
                while let Some(row) = rows.next().unwrap_or(None) {
                    if let (Ok(art), Ok(total), Ok(skipped)) = (row.get::<_, String>(0), row.get::<_, i64>(1), row.get::<_, i64>(2)) {
                        stats.insert(art.to_lowercase(), (total, skipped));
                    }
                }
            }
        }
        stats
    };

    let loved_tokens: std::collections::HashMap<String, u32> = {
        let mut tokens = std::collections::HashMap::new();
        let conn = crate::safe_lock(&state.db);
        if let Ok(mut stmt) = conn.prepare(
            "SELECT title FROM playback_history WHERE skipped = 0"
        ) {
            if let Ok(mut rows) = stmt.query([]) {
                while let Some(row) = rows.next().unwrap_or(None) {
                    if let Ok(title) = row.get::<_, String>(0) {
                        for word in title.split_whitespace() {
                            let clean_word = word.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase();
                            if clean_word.len() > 3 {
                                *tokens.entry(clean_word).or_insert(0) += 1;
                            }
                        }
                    }
                }
            }
        }
        tokens
    };

    let taste_profile = AutoplayTasteProfile {
        top_artists: &top_artists,
        library_artists: &library_artists,
        discovery_level: &discovery_level,
        recently_played: &recently_played,
        artist_skip_stats: &artist_skip_stats,
        loved_tokens: &loved_tokens,
    };

    let mut scored_tracks: Vec<(YoutubeTrack, f64)> = Vec::new();

    for (idx, track) in filtered_tracks.into_iter().enumerate() {
        let mut score = score_autoplay_candidate(&taste_profile, &track.title, &track.artist);
        // Boost tracks by the same artist as the seed track so the user gets more hits by the chosen artist
        if artist_matches(&track.artist, &artist) {
            score += 0.40;
        }
        // Preserve YouTube Music Radio's natural high quality ranking for top results
        if idx < 50 {
            score += (50 - idx) as f64 * 0.01;
        }
        scored_tracks.push((track, score));
    }

    // Sort by Personalized Taste Score in descending order
    scored_tracks.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    // Curate queue with artist diversity constraints
    let mut final_queue = Vec::new();
    let mut artist_counts = std::collections::HashMap::new();
    let same_artist_limit = match discovery_level.as_str() {
        "familiarity" => 4,
        "discovery" => 2,
        _ => 3,
    };

    for (track, score) in &scored_tracks {
        if final_queue.len() >= 8 {
            break;
        }

        let cand_artist = track.artist.clone();
        let current_count = *artist_counts.get(&cand_artist).unwrap_or(&0);

        if current_count < same_artist_limit {
            artist_counts.insert(cand_artist, current_count + 1);
            println!("[autoplay-scorer] Accepted '{}' by '{}' (Score: {:.2})", track.title, track.artist, score);
            final_queue.push(track.clone());
        } else {
            println!("[autoplay-scorer] Capped artist repetitions for '{}' by '{}'", track.title, track.artist);
        }
    }

    // If final queue has fewer than 5 tracks, relax artist limit to backfill
    if final_queue.len() < 5 {
        for (track, _score) in &scored_tracks {
            if final_queue.len() >= 8 {
                break;
            }
            if !final_queue.iter().any(|t| t.id == track.id) {
                final_queue.push(track.clone());
            }
        }
    }

    // Resolve durations for final curated tracks concurrently
    let mut duration_tasks = Vec::new();
    for (i, track) in final_queue.iter().enumerate() {
        if track.duration_raw == "0:00" {
            let client = client.clone();
            let api_key = api_key.to_string();
            let video_id = track.id.clone();
            duration_tasks.push(async move {
                if let Some(dur) = fetch_track_duration(&client, &api_key, &video_id).await {
                    (i, dur)
                } else {
                    (i, "0:00".to_string())
                }
            });
        }
    }

    if !duration_tasks.is_empty() {
        println!("[youtube] Resolving {} missing track durations for final autoplay queue concurrently...", duration_tasks.len());
        let results = futures::future::join_all(duration_tasks).await;
        for (i, dur) in results {
            if dur != "0:00" {
                final_queue[i].duration_raw = dur;
            }
        }
    }

    final_queue.retain(|track| is_known_duration_within_limit(&track.duration_raw));

    Ok(final_queue)

    }).await
}

async fn resolve_history_pairs_to_tracks(
    client: &reqwest::Client,
    api_key: &str,
    pairs: Vec<(String, String)>,
) -> Vec<YoutubeTrack> {
    use futures::future::join_all;

    let searches = pairs.into_iter().map(|(title, artist)| {
        let query = format!("{} {}", artist, title);
        let cl = client.clone();
        let ak = api_key.to_string();
        async move {
            match search_youtube_internal(&cl, &ak, &query, false).await {
                Ok(tracks) => tracks.into_iter().find(|t| {
                    recording_matches(t, &artist, &title)
                        && !is_third_party_or_instrumental(&t.title, &t.artist)
                        && !is_compilation_channel(&t.artist)
                        && !is_duration_too_long(&t.duration_raw)
                }),
                Err(_) => None,
            }
        }
    });

    join_all(searches).await.into_iter().flatten().collect()
}

fn extract_library_shelves(
    conn: &rusqlite::Connection,
    lib_tracks: &[crate::db::Track],
    play_counts: &std::collections::HashMap<String, i64>,
    recent_tracks: &[(String, String)],
    top_listened: &[(String, String)],
    local_only: bool,
) -> (
    Vec<YoutubeTrack>,
    Vec<YoutubeTrack>,
    Vec<YoutubeTrack>,
    Vec<YoutubeMix>,
    Vec<(String, String)>,
    Vec<(String, String)>,
) {
    use rand::seq::SliceRandom;
    let mut rng = daily_recommendation_rng();

    let map_local = |t: &crate::db::Track, source: &str| -> YoutubeTrack {
        let duration_raw = if let Some(d) = t.duration {
            let length_seconds = d as u32;
            let seconds = length_seconds % 60;
            let minutes = (length_seconds / 60) % 60;
            let hours = length_seconds / 3600;
            if hours > 0 {
                format!("{}:{}:{:02}", hours, minutes, seconds)
            } else {
                format!("{}:{:02}", minutes, seconds)
            }
        } else {
            "0:00".to_string()
        };

        let local_source = crate::db::PlaybackSource {
            provider: saved_track_provider(t),
            id: saved_track_source_id(t),
            catalog_quality: None,
            metadata: Some(crate::db::SourceMetadata {
                title: t.title.clone(),
                artist: t.artist.clone(),
                album: t.album.clone(),
                duration: t.duration,
                duration_raw: Some(duration_raw.clone()),
                cover_url: t.cover_url.clone(),
                track_number: t.track_number,
                disc_number: t.disc_number,
            }),
        };
        let source_context = Some(crate::db::RecordingSources {
            recording_id: format!("local_{}", t.id),
            sources: vec![local_source],
            selection: crate::db::SourceSelection::Auto,
        });

        YoutubeTrack {
            id: format!("local_{}", t.id),
            title: t.title.clone().unwrap_or_else(|| "Unknown Title".to_string()),
            artist: t.artist.clone().unwrap_or_else(|| "Unknown Artist".to_string()),
            cover_url: t.cover_url.clone(),
            duration_raw,
            url: t.path.clone(),
            recommendation_source: Some(source.to_string()),
            source_context,
        }
    };

    // 1. Recently Played (from playback_history)
    let mut recently_played = Vec::new();
    let mut seen_recent = std::collections::HashSet::new();
    let mut unmatched_recent: Vec<(String, String)> = Vec::new();
    let mut seen_unmatched_keys = std::collections::HashSet::new();
    for (title, artist) in recent_tracks {
        let t_clean = title.to_lowercase();
        let a_clean = artist.to_lowercase();
        if let Some(t) = lib_tracks.iter().find(|lt| {
            lt.title.as_deref().unwrap_or("").to_lowercase() == t_clean &&
            lt.artist.as_deref().unwrap_or("").to_lowercase() == a_clean
        }) {
            if seen_recent.insert(t.path.clone()) {
                recently_played.push(map_local(t, "Recently Played"));
            }
        } else if !t_clean.is_empty() && !a_clean.is_empty() {
            // Played recently but not present in the local library — a candidate
            // for resolving to its online (YouTube) counterpart.
            if seen_unmatched_keys.insert(format!("{}::{}", a_clean, t_clean)) {
                unmatched_recent.push((title.clone(), artist.clone()));
            }
        }
    }

    // 2. Heavy Rotation (Top played tracks)
    let mut heavy_rotation_candidates = lib_tracks.to_vec();
    heavy_rotation_candidates.sort_by(|a, b| {
        let count_a = play_counts.get(&a.path).unwrap_or(&0);
        let count_b = play_counts.get(&b.path).unwrap_or(&0);
        count_b.cmp(&count_a)
    });
    let heavy_rotation: Vec<YoutubeTrack> = heavy_rotation_candidates.into_iter()
        .filter(|t| *play_counts.get(&t.path).unwrap_or(&0) > 0)
        .take(20)
        .map(|t| map_local(&t, "Heavy Rotation"))
        .collect();

    // 2b. Top-listened entries with no library file are blended online:
    //     most-played ones join Heavy Rotation, older ones join Forgotten Gems.
    let mut unmatched_top: Vec<(String, String)> = Vec::new();
    for (title, artist) in top_listened {
        let t_clean = title.to_lowercase();
        let a_clean = artist.to_lowercase();
        let in_library = lib_tracks.iter().any(|lt| {
            lt.title.as_deref().unwrap_or("").to_lowercase() == t_clean &&
            lt.artist.as_deref().unwrap_or("").to_lowercase() == a_clean
        });
        if !in_library && !t_clean.is_empty() && !a_clean.is_empty()
            && seen_unmatched_keys.insert(format!("{}::{}", a_clean, t_clean)) {
            unmatched_top.push((title.clone(), artist.clone()));
        }
    }

    // 3. Forgotten Gems / Time Capsule (Loved or played >= 2 times, but not recently played)
    let mut forgotten_gems = Vec::new();
    for t in lib_tracks {
        let is_loved = t.loved.unwrap_or(0) == 1;
        let count = *play_counts.get(&t.path).unwrap_or(&0);
        if (is_loved || count >= 2) && !seen_recent.contains(&t.path) {
            forgotten_gems.push(map_local(t, "Time Capsule"));
        }
    }
    forgotten_gems.shuffle(&mut rng);
    forgotten_gems.truncate(20);

    // 4. Playlist Mixes
    let mut playlist_mixes = Vec::new();
    if let Ok(playlists) = crate::db::get_playlists(conn) {
        for p in playlists {
            if let Ok(tracks) = crate::db::get_playlist_tracks(conn, p.id) {
                if !tracks.is_empty() {
                    let cover = tracks.iter().find_map(|t| t.cover_url.clone());
                    let yt_tracks: Vec<YoutubeTrack> = tracks.iter().filter(|t| t.disliked.unwrap_or(0) != 1 && (!local_only || (saved_track_provider(t) == crate::db::SourceProvider::Local && std::path::Path::new(&t.path).is_file()))).map(|t| map_local(t, &p.name)).collect();
                    playlist_mixes.push(YoutubeMix {
                        id: format!("local_playlist_{}", p.id),
                        title: p.name.clone(),
                        description: format!("Playlist • {} tracks", tracks.len()),
                        cover_url: cover,
                        tracks: yt_tracks,
                    });
                }
            }
        }
    }

    (recently_played, heavy_rotation, forgotten_gems, playlist_mixes, unmatched_recent, unmatched_top)
}

pub(crate) fn generate_local_mixes(
    conn: &rusqlite::Connection,
    seed_artists: &[String],
    top_artists: &[String],
) -> Vec<YoutubeMix> {
    use rand::seq::SliceRandom;
    let mut rng = daily_recommendation_rng();

    let lib_tracks: Vec<_> = crate::db::get_all_tracks(conn).unwrap_or_default().into_iter().filter(|t| t.disliked.unwrap_or(0) != 1 && saved_track_provider(t) == crate::db::SourceProvider::Local && std::path::Path::new(&t.path).is_file()).collect();
    if lib_tracks.is_empty() {
        return Vec::new();
    }

    // History stats per track: (play_count, skip_count, last_played_timestamp)
    let mut track_history: std::collections::HashMap<String, (i64, i64, i64)> = std::collections::HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT track_path, COUNT(*), COALESCE(SUM(skipped), 0), COALESCE(MAX(timestamp), 0) FROM playback_history WHERE signal_quality = 'qualified' AND listened_seconds >= MIN(120.0, duration * 0.5) GROUP BY track_path") {
        if let Ok(mut rows) = stmt.query([]) {
            while let Some(row) = rows.next().unwrap_or(None) {
                if let (Ok(path), Ok(cnt), Ok(skip), Ok(last_ts)) = (
                    row.get::<_, String>(0),
                    row.get::<_, i64>(1),
                    row.get::<_, i64>(2),
                    row.get::<_, i64>(3),
                ) {
                    track_history.insert(path, (cnt, skip, last_ts));
                }
            }
        }
    }

    // Artist stats from history: artist -> net plays (completed - skipped)
    let mut artist_scores: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT artist, COUNT(*), COALESCE(SUM(skipped), 0) FROM playback_history WHERE signal_quality = 'qualified' AND listened_seconds >= MIN(120.0, duration * 0.5) AND artist IS NOT NULL AND artist != '' AND artist != 'Unknown Artist' GROUP BY artist") {
        if let Ok(mut rows) = stmt.query([]) {
            while let Some(row) = rows.next().unwrap_or(None) {
                if let (Ok(art), Ok(cnt), Ok(skp)) = (row.get::<_, String>(0), row.get::<_, i64>(1), row.get::<_, i64>(2)) {
                    artist_scores.insert(art, cnt.saturating_sub(skp));
                }
            }
        }
    }

    // Also factor in library loved tracks per artist
    for t in &lib_tracks {
        if let Some(ref art) = t.artist {
            if !art.is_empty() && art != "Unknown Artist" {
                let entry = artist_scores.entry(art.clone()).or_insert(0);
                if t.loved.unwrap_or(0) == 1 {
                    *entry += 3;
                }
            }
        }
    }

    let now_ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let thirty_days_ago = now_ts.saturating_sub(30 * 86400);

    let map_local_to_youtube_track = |track: &crate::db::Track, source: &str| -> YoutubeTrack {
        let duration_raw = if let Some(d) = track.duration {
            let length_seconds = d as u32;
            let seconds = length_seconds % 60;
            let minutes = (length_seconds / 60) % 60;
            let hours = length_seconds / 3600;
            if hours > 0 {
                format!("{}:{}:{:02}", hours, minutes, seconds)
            } else {
                format!("{}:{:02}", minutes, seconds)
            }
        } else {
            "0:00".to_string()
        };

        let local_source = crate::db::PlaybackSource {
            provider: saved_track_provider(track),
            id: saved_track_source_id(track),
            catalog_quality: None,
            metadata: Some(crate::db::SourceMetadata {
                title: track.title.clone(),
                artist: track.artist.clone(),
                album: track.album.clone(),
                duration: track.duration,
                duration_raw: Some(duration_raw.clone()),
                cover_url: track.cover_url.clone(),
                track_number: track.track_number,
                disc_number: track.disc_number,
            }),
        };
        let source_context = Some(crate::db::RecordingSources {
            recording_id: format!("local_{}", track.id),
            sources: vec![local_source],
            selection: crate::db::SourceSelection::Auto,
        });

        YoutubeTrack {
            id: format!("local_{}", track.id),
            title: track.title.clone().unwrap_or_else(|| "Unknown Title".to_string()),
            artist: track.artist.clone().unwrap_or_else(|| "Unknown Artist".to_string()),
            cover_url: track.cover_url.clone(),
            duration_raw,
            url: track.path.clone(),
            recommendation_source: Some(source.to_string()),
            source_context,
        }
    };

    let mut mixes = Vec::with_capacity(4);

    // ─────────────────────────────────────────────────────────────────────────
    // 1. My Supermix (Local)
    // ─────────────────────────────────────────────────────────────────────────
    let mut loved_and_top: Vec<crate::db::Track> = Vec::new();
    for t in &lib_tracks {
        if t.loved.unwrap_or(0) == 1 {
            loved_and_top.push(t.clone());
        }
    }
    let mut sorted_by_plays = lib_tracks.clone();
    sorted_by_plays.sort_by(|a, b| {
        let count_a = track_history.get(&a.path).map(|h| h.0).unwrap_or(0);
        let count_b = track_history.get(&b.path).map(|h| h.0).unwrap_or(0);
        count_b.cmp(&count_a)
    });
    for t in sorted_by_plays.iter().take(15) {
        if !loved_and_top.iter().any(|st| st.path == t.path) {
            loved_and_top.push(t.clone());
        }
    }
    loved_and_top.shuffle(&mut rng);

    let mut rest_tracks: Vec<crate::db::Track> = lib_tracks.iter()
        .filter(|t| !loved_and_top.iter().any(|st| st.path == t.path))
        .cloned()
        .collect();
    rest_tracks.shuffle(&mut rng);

    let mut supermix_candidates = loved_and_top;
    let needed = 25usize.saturating_sub(supermix_candidates.len());
    supermix_candidates.extend(rest_tracks.into_iter().take(needed));

    mixes.push(YoutubeMix {
        id: "local_mix_supermix".to_string(),
        title: "My Supermix".to_string(),
        description: "Your favorite local tracks mixed with hidden library gems.".to_string(),
        cover_url: None,
        tracks: supermix_candidates.iter().map(|t| map_local_to_youtube_track(t, "My Supermix")).collect(),
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Top Artist Spotlight (Local)
    // ─────────────────────────────────────────────────────────────────────────
    let mut ranked_artists: Vec<(&String, &i64)> = artist_scores.iter().collect();
    ranked_artists.sort_by(|a, b| b.1.cmp(a.1));

    let target_artist = top_artists.first()
        .filter(|a| !a.is_empty() && *a != "Unknown Artist")
        .cloned()
        .or_else(|| {
            ranked_artists.first().map(|(art, _)| (*art).clone())
        })
        .or_else(|| {
            seed_artists.first().filter(|a| !a.is_empty() && *a != "Unknown Artist").cloned()
        })
        .unwrap_or_else(|| {
            lib_tracks.first().and_then(|t| t.artist.clone()).unwrap_or_else(|| "Featured Artist".to_string())
        });

    let target_clean = target_artist.to_lowercase();
    let mut spotlight_tracks: Vec<crate::db::Track> = lib_tracks.iter()
        .filter(|t| t.artist.as_deref().unwrap_or("").to_lowercase().contains(&target_clean))
        .cloned()
        .collect();

    spotlight_tracks.sort_by(|a, b| {
        let loved_a = a.loved.unwrap_or(0);
        let loved_b = b.loved.unwrap_or(0);
        if loved_a != loved_b {
            return loved_b.cmp(&loved_a);
        }
        let count_a = track_history.get(&a.path).map(|h| h.0).unwrap_or(0);
        let count_b = track_history.get(&b.path).map(|h| h.0).unwrap_or(0);
        count_b.cmp(&count_a)
    });

    if spotlight_tracks.len() < 5 {
        for t in &lib_tracks {
            if !spotlight_tracks.iter().any(|st| st.path == t.path) {
                spotlight_tracks.push(t.clone());
                if spotlight_tracks.len() >= 20 {
                    break;
                }
            }
        }
    }
    spotlight_tracks.truncate(25);

    mixes.push(YoutubeMix {
        id: "local_mix_spotlight".to_string(),
        title: format!("{} Spotlight", target_artist),
        description: format!("A deep dive into {}'s greatest tracks and library cuts.", target_artist),
        cover_url: None,
        tracks: spotlight_tracks.iter().map(|t| map_local_to_youtube_track(t, &format!("{} Spotlight", target_artist))).collect(),
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Forgotten Favorites (Local)
    // ─────────────────────────────────────────────────────────────────────────
    let mut forgotten_candidates: Vec<crate::db::Track> = lib_tracks.iter()
        .filter(|t| {
            if let Some(&(cnt, skip, last_ts)) = track_history.get(&t.path) {
                cnt >= 1 && skip <= cnt / 2 && last_ts > 0 && last_ts < thirty_days_ago
            } else {
                t.loved.unwrap_or(0) == 1
            }
        })
        .cloned()
        .collect();

    if forgotten_candidates.len() < 5 {
        let mut older_played = lib_tracks.clone();
        older_played.sort_by(|a, b| {
            let ts_a = track_history.get(&a.path).map(|h| h.2).unwrap_or(0);
            let ts_b = track_history.get(&b.path).map(|h| h.2).unwrap_or(0);
            ts_a.cmp(&ts_b)
        });
        for t in older_played {
            if !forgotten_candidates.iter().any(|ft| ft.path == t.path) {
                forgotten_candidates.push(t);
                if forgotten_candidates.len() >= 20 {
                    break;
                }
            }
        }
    }
    forgotten_candidates.shuffle(&mut rng);
    forgotten_candidates.truncate(25);

    mixes.push(YoutubeMix {
        id: "local_mix_forgotten".to_string(),
        title: "Forgotten Favorites".to_string(),
        description: "Rediscover beloved tracks and past favorites you haven't played in a while.".to_string(),
        cover_url: None,
        tracks: forgotten_candidates.iter().map(|t| map_local_to_youtube_track(t, "Forgotten Favorites")).collect(),
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 4. On Repeat (Local)
    // ─────────────────────────────────────────────────────────────────────────
    let mut recent_counts = std::collections::HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT track_path, COUNT(*) FROM playback_history WHERE timestamp >= ?1 AND signal_quality = 'qualified' AND listened_seconds >= MIN(120.0, duration * 0.5) GROUP BY track_path HAVING COUNT(*) >= 2") {
        if let Ok(rows) = stmt.query_map([std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0) - 7 * 86_400], |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))) {
            for row in rows.flatten() { recent_counts.insert(row.0, row.1); }
        }
    }
    let mut on_repeat_candidates: Vec<_> = lib_tracks.iter().filter(|track| recent_counts.contains_key(&track.path)).cloned().collect();
    on_repeat_candidates.sort_by(|a, b| recent_counts[&b.path].cmp(&recent_counts[&a.path]).then_with(|| a.path.cmp(&b.path)));
    on_repeat_candidates.truncate(25);

    mixes.push(YoutubeMix {
        id: "local_mix_on_repeat".to_string(),
        title: "On Repeat".to_string(),
        description: "Your current obsessions and most repeated tracks right now.".to_string(),
        cover_url: None,
        tracks: on_repeat_candidates.iter().map(|t| map_local_to_youtube_track(t, "On Repeat")).collect(),
    });

    mixes
}

pub async fn generate_hybrid_mixes(
    client: &reqwest::Client,
    api_key: &str,
    seed_artists: &[String],
    top_artists: &[String],
    top_genre: &str,
    lib_tracks: &[crate::db::Track],
    play_counts: &std::collections::HashMap<String, i64>,
    recent_repeats: &[(String, String, String)],
) -> Result<Vec<YoutubeMix>, String> {
    use rand::seq::SliceRandom;

    let map_local_to_youtube_track = |track: &crate::db::Track| -> YoutubeTrack {
        let duration_raw = if let Some(d) = track.duration {
            let length_seconds = d as u32;
            let seconds = length_seconds % 60;
            let minutes = (length_seconds / 60) % 60;
            let hours = length_seconds / 3600;
            if hours > 0 {
                format!("{}:{}:{:02}", hours, minutes, seconds)
            } else {
                format!("{}:{:02}", minutes, seconds)
            }
        } else {
            "0:00".to_string()
        };

        let local_source = crate::db::PlaybackSource {
            provider: saved_track_provider(track),
            id: saved_track_source_id(track),
            catalog_quality: None,
            metadata: Some(crate::db::SourceMetadata {
                title: track.title.clone(),
                artist: track.artist.clone(),
                album: track.album.clone(),
                duration: track.duration,
                duration_raw: Some(duration_raw.clone()),
                cover_url: track.cover_url.clone(),
                track_number: track.track_number,
                disc_number: track.disc_number,
            }),
        };
        let source_context = Some(crate::db::RecordingSources {
            recording_id: format!("local_{}", track.id),
            sources: vec![local_source],
            selection: crate::db::SourceSelection::Auto,
        });

        YoutubeTrack {
            id: format!("local_{}", track.id),
            title: track.title.clone().unwrap_or_else(|| "Unknown Title".to_string()),
            artist: track.artist.clone().unwrap_or_else(|| "Unknown Artist".to_string()),
            cover_url: track.cover_url.clone(),
            duration_raw,
            url: track.path.clone(),
            recommendation_source: Some("Offline Library".to_string()),
            source_context,
        }
    };

    let mut top_artist_pool = Vec::new();
    for ta in top_artists {
        if !ta.is_empty() && !top_artist_pool.contains(ta) {
            top_artist_pool.push(ta.clone());
        }
    }
    for sa in seed_artists {
        if !sa.is_empty() && !top_artist_pool.contains(sa) {
            top_artist_pool.push(sa.clone());
        }
    }
    if top_artist_pool.is_empty() {
        let mut top_played_lib = lib_tracks.to_vec();
        top_played_lib.sort_by(|a, b| {
            let count_a = play_counts.get(&a.path).unwrap_or(&0);
            let count_b = play_counts.get(&b.path).unwrap_or(&0);
            count_b.cmp(count_a)
        });
        for t in top_played_lib {
            if let Some(ref art) = t.artist {
                if !art.is_empty() && !top_artist_pool.contains(art) {
                    top_artist_pool.push(art.clone());
                }
            }
        }
    }

    let artist_1 = top_artist_pool.first().cloned().unwrap_or_default();

    // Identify forgotten tracks from library and play counts
    let mut top_played_sorted = lib_tracks.to_vec();
    top_played_sorted.sort_by(|a, b| {
        let count_a = play_counts.get(&a.path).unwrap_or(&0);
        let count_b = play_counts.get(&b.path).unwrap_or(&0);
        count_b.cmp(count_a)
    });
    let top_15_paths: std::collections::HashSet<String> = top_played_sorted.iter().take(15).map(|t| t.path.clone()).collect();

    let mut forgotten_local_tracks: Vec<crate::db::Track> = lib_tracks.iter()
        .filter(|t| {
            let count = *play_counts.get(&t.path).unwrap_or(&0);
            let is_loved = t.loved.unwrap_or(0) == 1;
            (count >= 1 || is_loved) && !top_15_paths.contains(&t.path)
        })
        .cloned()
        .collect();
    if forgotten_local_tracks.is_empty() {
        forgotten_local_tracks = lib_tracks.iter().filter(|t| !top_15_paths.contains(&t.path)).cloned().collect();
    }

    let forgotten_artist = forgotten_local_tracks.first()
        .and_then(|t| t.artist.clone())
        .filter(|a| !a.is_empty() && a != "Unknown Artist")
        .unwrap_or_default();

    let q1 = if !artist_1.is_empty() {
        format!("{} official audio greatest hits", artist_1)
    } else {
        "popular hits official audio".to_string()
    };

    let q2 = if !artist_1.is_empty() {
        format!("{} official music essentials greatest hits", artist_1)
    } else {
        "greatest hits essential tracks official audio".to_string()
    };

    let q3 = if !forgotten_artist.is_empty() {
        format!("{} classics official audio", forgotten_artist)
    } else if !top_genre.is_empty() && top_genre != "Chill" {
        format!("{} classic hits official audio", top_genre)
    } else {
        "timeless classic hits official audio".to_string()
    };

    let queries = vec![
        (q1, "supermix"),
        (q2, "spotlight"),
        (q3, "forgotten"),
    ];

    let mut search_tasks = Vec::new();
    for (query, mix_type) in queries {
        let client_c = client.clone();
        let api_key_c = api_key.to_string();
        let mix_type_c = mix_type.to_string();
        search_tasks.push(async move {
            (search_youtube_internal(&client_c, &api_key_c, &query, false).await, mix_type_c)
        });
    }

    let search_results = futures::future::join_all(search_tasks).await;

    let mut rng = daily_recommendation_rng();
    let mut mixes = Vec::new();

    for (res, mix_type) in search_results {
        let mut online_tracks = Vec::new();
        if let Ok(tracks) = res {
            for mut track in tracks {
                let title_lower = track.title.to_lowercase();
                let artist_lower = track.artist.to_lowercase();

                let has_unofficial_keywords = [
                    "lyrics", "lyric", "가사", "color coded", "color-coded", "translation", "sub", "subbed", "mv lyric",
                    "fancam", "concert", "live in", "live at", "live [", "[live", "live performance", "live at",
                    "tour", "compilation", "playlist", "nonstop", "non-stop", "lagu viral", "viral hits", "trending hits",
                    "full album", "album mp3", "full version", "||", "mashup", "tribute", "fanmade", "fan-made", "fmv",
                    "slowed", "reverb", "nightcore", "10 hours", "10 hrs", "loop", "cover", "remix", "karaoke"
                ].iter().any(|&term| title_lower.contains(term));

                let is_junk_artist = [
                    "lyrics", "lirik", "playlist", "compilation", "tribute", "cover", "karaoke", "fanmade", "official lirik",
                    "7clouds", "cloudkid", "proximity", "trap nation", "chill nation", "house nation", "bass nation", "rap nation", "indie nation"
                ].iter().any(|&term| artist_lower.contains(term));

                if has_unofficial_keywords || is_junk_artist {
                    continue;
                }

                if is_third_party_or_instrumental(&track.title, &track.artist) {
                    continue;
                }
                if is_compilation_channel(&track.artist) {
                    continue;
                }

                track.recommendation_source = Some("Online Mix".to_string());
                online_tracks.push(track);
            }
        }

        // Get local tracks matching the criteria
        let mut local_matches = Vec::new();
        match mix_type.as_str() {
            "supermix" => {
                for t in lib_tracks {
                    if t.loved.unwrap_or(0) == 1 {
                        local_matches.push(map_local_to_youtube_track(t));
                    }
                }
                let mut top_played = lib_tracks.to_vec();
                top_played.sort_by(|a, b| {
                    let count_a = play_counts.get(&a.path).unwrap_or(&0);
                    let count_b = play_counts.get(&b.path).unwrap_or(&0);
                    count_b.cmp(count_a)
                });
                for t in top_played.iter().take(15) {
                    let yt = map_local_to_youtube_track(t);
                    if !local_matches.iter().any(|lm| lm.url == yt.url) {
                        local_matches.push(yt);
                    }
                }
                local_matches.shuffle(&mut rng);
            }
            "spotlight" => {
                let target_clean = artist_1.to_lowercase();
                let mut artist_lib: Vec<crate::db::Track> = lib_tracks.iter()
                    .filter(|t| t.artist.as_deref().unwrap_or("").to_lowercase().contains(&target_clean))
                    .cloned()
                    .collect();
                artist_lib.sort_by(|a, b| {
                    let loved_a = a.loved.unwrap_or(0);
                    let loved_b = b.loved.unwrap_or(0);
                    if loved_a != loved_b {
                        return loved_b.cmp(&loved_a);
                    }
                    let count_a = play_counts.get(&a.path).unwrap_or(&0);
                    let count_b = play_counts.get(&b.path).unwrap_or(&0);
                    count_b.cmp(count_a)
                });
                if artist_lib.len() < 5 {
                    for t in lib_tracks {
                        if !artist_lib.iter().any(|at| at.path == t.path) {
                            artist_lib.push(t.clone());
                            if artist_lib.len() >= 15 { break; }
                        }
                    }
                }
                for t in &artist_lib {
                    local_matches.push(map_local_to_youtube_track(t));
                }
            }
            "forgotten" => {
                for t in &forgotten_local_tracks {
                    local_matches.push(map_local_to_youtube_track(t));
                }
                local_matches.shuffle(&mut rng);
            }
            _ => {}
        }

        // Interleave the tracks
        let limit = 20;
        let interleaved = interleave_tracks(online_tracks, local_matches, limit);

        let (title, description) = match mix_type.as_str() {
            "supermix" => (
                "My Supermix".to_string(),
                "Your top local favorites blended with fresh online recommendations.".to_string(),
            ),
            "spotlight" => (
                if !artist_1.is_empty() {
                    format!("{} Spotlight", artist_1)
                } else {
                    "Artist Spotlight".to_string()
                },
                if !artist_1.is_empty() {
                    format!("Popular songs and library favorites from {}.", artist_1)
                } else {
                    "A deep dive into your top artist's greatest songs and hits.".to_string()
                },
            ),
            "forgotten" => (
                "Forgotten Favorites".to_string(),
                "Rediscover beloved tracks and past favorites you haven't played in a while.".to_string(),
            ),
            "on_repeat" => (
                "On Repeat".to_string(),
                "Your current obsessions and most repeated tracks right now.".to_string(),
            ),
            _ => ("Custom Mix".to_string(), "Personalized mix.".to_string()),
        };

        mixes.push(YoutubeMix {
            id: format!("hybrid_mix_{}", mix_type),
            title,
            description,
            cover_url: None,
            tracks: interleaved,
        });
    }

    let mut repeat_tracks = Vec::new();
    let mut unresolved = Vec::new();
    for (path, title, artist) in recent_repeats {
        if let Some(track) = lib_tracks.iter().find(|track| &track.path == path) {
            repeat_tracks.push(map_local_to_youtube_track(track));
        } else { unresolved.push((title.clone(), artist.clone())); }
    }
    repeat_tracks.extend(resolve_history_pairs_to_tracks(client, api_key, unresolved).await);
    for track in &mut repeat_tracks { track.recommendation_source = Some("Repeated this week".to_string()); }
    repeat_tracks.truncate(20);
    if !repeat_tracks.is_empty() {
        mixes.push(YoutubeMix {
            id: "hybrid_mix_on_repeat".to_string(), title: "On Repeat".to_string(),
            description: "Recordings you listened to repeatedly in the past seven days.".to_string(),
            cover_url: None, tracks: repeat_tracks,
        });
    }

    Ok(mixes)
}

fn is_valid_chart_artwork_url(url: &str) -> bool {
    let trimmed = url.trim();
    !trimmed.is_empty()
        && !trimmed.contains("2a96cbd8b46e442fc41c2b86b821562f")
        && (trimmed.starts_with("http://") || trimmed.starts_with("https://"))
}

pub(crate) fn lastfm_artwork(track: &serde_json::Value) -> Option<String> {
    track
        .get("image")
        .and_then(serde_json::Value::as_array)
        .and_then(|images| {
            images.iter().rev().find_map(|image| {
                image
                    .get("#text")
                    .and_then(serde_json::Value::as_str)
                    .filter(|url| is_valid_chart_artwork_url(url))
                    .map(str::to_string)
            })
        })
}

fn parse_lastfm_candidates(
    tracks: &[serde_json::Value],
    rank_offset: usize,
) -> Vec<ChartCandidate> {
    tracks
        .iter()
        .enumerate()
        .filter_map(|(index, track)| {
            let title = track.get("name")?.as_str()?.trim();
            let artist = track
                .get("artist")?
                .get("name")?
                .as_str()?
                .trim();
            if title.is_empty() || artist.is_empty() || artist.eq_ignore_ascii_case("unknown artist") {
                return None;
            }

            Some(ChartCandidate {
                rank: rank_offset + index + 1,
                title: title.to_string(),
                artist: artist.to_string(),
                artwork_url: lastfm_artwork(track),
                previous_rank: None,
                weeks_on_chart: None,
                listen_count: chart_value_as_u64(track.get("playcount")),
                recording_mbid: track
                    .get("mbid")
                    .and_then(serde_json::Value::as_str)
                    .filter(|mbid| !mbid.is_empty())
                    .map(str::to_string),
            })
        })
        .collect()
}

async fn fetch_lastfm_chart(
    genre: &str,
    country: Option<&str>,
    offset: usize,
    limit: usize,
) -> Result<(Vec<ChartCandidate>, bool, String, String), String> {
    let requested_count = offset.saturating_add(limit).saturating_add(1).min(200);

    if let Some(country) = country {
        let country = validate_chart_country(country)?;
        let tracks = crate::lastfm_api::get_geo_top_tracks_page(&country, requested_count as u32).await?;
        let has_more = tracks.len() > offset + limit;
        let page = tracks.into_iter().skip(offset).take(limit).collect::<Vec<_>>();
        return Ok((
            parse_lastfm_candidates(&page, offset),
            has_more,
            country,
            "Previous week".to_string(),
        ));
    }

    if !genre.is_empty() {
        if genre.len() > 48
            || !genre
                .chars()
                .all(|character| character.is_alphanumeric() || matches!(character, ' ' | '-' | '&'))
        {
            return Err("Choose a valid Last.fm genre.".to_string());
        }
        let tracks = crate::lastfm_api::get_genre_top_tracks_page(genre, requested_count as u32).await?;
        let has_more = tracks.len() > offset + limit;
        let page = tracks.into_iter().skip(offset).take(limit).collect::<Vec<_>>();
        return Ok((
            parse_lastfm_candidates(&page, offset),
            has_more,
            capitalize_first(genre),
            "Current popularity".to_string(),
        ));
    }

    const LASTFM_PAGE_SIZE: usize = 50;
    let page_number = (offset / LASTFM_PAGE_SIZE) + 1;
    let within_page = offset % LASTFM_PAGE_SIZE;
    let mut tracks = crate::lastfm_api::get_global_top_tracks_page(page_number as u32).await?;
    if within_page + limit >= tracks.len() && tracks.len() == LASTFM_PAGE_SIZE {
        let next_page = crate::lastfm_api::get_global_top_tracks_page((page_number + 1) as u32).await?;
        tracks.extend(next_page);
    }
    let has_more = tracks.len() > within_page + limit;
    let page = tracks
        .into_iter()
        .skip(within_page)
        .take(limit)
        .collect::<Vec<_>>();
    Ok((
        parse_lastfm_candidates(&page, offset),
        has_more,
        "Worldwide".to_string(),
        "Current popularity".to_string(),
    ))
}

async fn fetch_billboard_chart(
    client: &reqwest::Client,
    offset: usize,
    limit: usize,
) -> Result<(Vec<ChartCandidate>, Option<String>, usize, bool), String> {
    let response = client
        .get("https://raw.githubusercontent.com/mhollingshead/billboard-hot-100/main/recent.json")
        .send()
        .await
        .map_err(|error| format!("Billboard chart request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("Billboard chart returned HTTP {}.", response.status()));
    }
    let json = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("Billboard chart response was invalid: {error}"))?;
    let total = json
        .get("data")
        .and_then(serde_json::Value::as_array)
        .map(Vec::len)
        .unwrap_or(0);
    let (entries, date) = parse_billboard_candidates(&json, offset, limit);
    Ok((entries, date, total, offset + limit < total))
}

async fn fetch_listenbrainz_chart(
    client: &reqwest::Client,
    offset: usize,
    limit: usize,
    range: &str,
) -> Result<ListenBrainzChart, String> {
    let response = client
        .get("https://api.listenbrainz.org/1/stats/sitewide/recordings")
        .query(&[
            ("count", limit.to_string()),
            ("offset", offset.to_string()),
            ("range", range.to_string()),
        ])
        .send()
        .await
        .map_err(|error| format!("ListenBrainz chart request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("ListenBrainz chart returned HTTP {}.", response.status()));
    }
    let json = response
        .json::<serde_json::Value>()
        .await
        .map_err(|error| format!("ListenBrainz chart response was invalid: {error}"))?;
    let parsed = parse_listenbrainz_candidates(&json);
    if parsed.entries.is_empty() {
        return Err("ListenBrainz returned no ranked recordings.".to_string());
    }
    Ok(parsed)
}

async fn fetch_itunes_cover(
    client: &reqwest::Client,
    title: &str,
    artist: &str,
) -> Option<String> {
    let clean_title = title.trim();
    let clean_artist = artist.trim();
    if clean_title.is_empty() {
        return None;
    }
    let term = if clean_artist.is_empty() {
        clean_title.to_string()
    } else {
        format!("{clean_artist} {clean_title}")
    };
    let url = format!(
        "https://itunes.apple.com/search?term={}&entity=song&limit=1",
        urlencoding::encode(&term)
    );
    let res = client.get(&url).send().await.ok()?;
    if !res.status().is_success() {
        return None;
    }
    let json: serde_json::Value = res.json().await.ok()?;
    json.get("results")?
        .as_array()?
        .first()?
        .get("artworkUrl100")?
        .as_str()
        .map(|u| u.replace("100x100bb", "600x600bb"))
}

async fn attach_chart_playback(
    candidates: Vec<ChartCandidate>,
    source: &str,
) -> Vec<ChartEntry> {
    if candidates.is_empty() {
        return Vec::new();
    }

    let client = crate::get_http_client();
    let api_key = fetch_innertube_key().await;
    let tasks = candidates.into_iter().map(|candidate| {
        let query = format!("{} {} official audio", candidate.artist, candidate.title);
        let api_key = api_key.clone();
        let source = source.to_string();
        async move {
            let playback_track = search_youtube_internal(client, &api_key, &query, false)
                .await
                .ok()
                .and_then(|tracks| {
                    tracks.into_iter().find(|track| {
                        !is_third_party_or_instrumental(&track.title, &track.artist)
                            && !is_compilation_channel(&track.artist)
                            && artist_matches(&track.artist, &candidate.artist)
                    })
                })
                .map(|mut track| {
                    track.recommendation_source = Some(format!("{} chart", source));
                    track
                });

            let chart_id = chart_entry_id(&source, &candidate);

            let mut artwork_url = candidate
                .artwork_url
                .filter(|url| is_valid_chart_artwork_url(url));

            if artwork_url.is_none() {
                if let Some(yt_art) = playback_track
                    .as_ref()
                    .and_then(|track| track.cover_url.as_deref())
                    .filter(|url| is_valid_chart_artwork_url(url))
                {
                    artwork_url = Some(yt_art.to_string());
                }
            }

            if artwork_url.is_none() {
                if let Some(itunes_art) = fetch_itunes_cover(client, &candidate.title, &candidate.artist).await {
                    artwork_url = Some(itunes_art);
                }
            }

            ChartEntry {
                chart_id,
                rank: candidate.rank,
                title: candidate.title,
                artist: candidate.artist,
                artwork_url,
                previous_rank: candidate.previous_rank,
                weeks_on_chart: candidate.weeks_on_chart,
                listen_count: candidate.listen_count,
                recording_mbid: candidate.recording_mbid,
                playback_track,
            }
        }
    });

    futures::future::join_all(tasks).await
}

fn listenbrainz_range_label(range: &str) -> &'static str {
    match range {
        "week" => "Past week",
        "month" => "Past month",
        "quarter" => "Past quarter",
        "year" => "Past year",
        "all_time" => "All time",
        _ => "Past week",
    }
}

pub async fn get_worldwide_leaderboard_internal(
    genre: String,
    country: Option<String>,
    source: Option<String>,
    offset: Option<usize>,
    limit: Option<usize>,
    range: Option<String>,
) -> Result<ChartPage, String> {
    let requested_source = source
        .unwrap_or_else(|| "lastfm".to_string())
        .trim()
        .to_lowercase();
    if !matches!(requested_source.as_str(), "lastfm" | "billboard" | "listenbrainz") {
        return Err("Unknown chart source.".to_string());
    }

    let offset = offset.unwrap_or(0).min(500);
    let limit = limit.unwrap_or(20).clamp(1, 50);
    let genre = genre.trim().to_lowercase();
    let country = country.filter(|value| !value.trim().is_empty());
    let range = range.unwrap_or_else(|| "week".to_string()).trim().to_lowercase();
    if requested_source == "listenbrainz"
        && !matches!(range.as_str(), "week" | "month" | "quarter" | "year" | "all_time")
    {
        return Err("Choose a valid ListenBrainz time range.".to_string());
    }

    let client = crate::get_http_client();
    let mut fallback = None;
    let (actual_source, source_label, scope_label, period_label, updated_at, candidates, total, has_more) =
        match requested_source.as_str() {
            "billboard" => match fetch_billboard_chart(client, offset, limit).await {
                Ok((entries, date, total, has_more)) if !entries.is_empty() => {
                    let period = date
                        .as_ref()
                        .map(|date| format!("Hot 100 · week of {date}"))
                        .unwrap_or_else(|| "Hot 100 · current week".to_string());
                    (
                        "billboard".to_string(),
                        "Billboard Hot 100".to_string(),
                        "United States".to_string(),
                        period,
                        date,
                        entries,
                        Some(total),
                        has_more,
                    )
                }
                Ok(_) | Err(_) => {
                    let (entries, has_more, scope, period) =
                        fetch_lastfm_chart("", None, offset, limit).await?;
                    fallback = Some(ChartFallback {
                        requested_source: "billboard".to_string(),
                        actual_source: "lastfm".to_string(),
                        message: "Billboard is temporarily unavailable. Showing Last.fm worldwide ranks instead.".to_string(),
                    });
                    (
                        "lastfm".to_string(),
                        "Last.fm".to_string(),
                        scope,
                        period,
                        None,
                        entries,
                        None,
                        has_more,
                    )
                }
            },
            "listenbrainz" => match fetch_listenbrainz_chart(client, offset, limit, &range).await {
                Ok(parsed) => {
                    let total = parsed.total;
                    let has_more = total
                        .map(|total| offset + parsed.entries.len() < total)
                        .unwrap_or(parsed.entries.len() == limit);
                    (
                        "listenbrainz".to_string(),
                        "ListenBrainz".to_string(),
                        "Worldwide".to_string(),
                        listenbrainz_range_label(parsed.range.as_deref().unwrap_or(&range)).to_string(),
                        parsed.updated_at,
                        parsed.entries,
                        total,
                        has_more,
                    )
                }
                Err(_) => {
                    let (entries, has_more, scope, period) =
                        fetch_lastfm_chart("", None, offset, limit).await?;
                    fallback = Some(ChartFallback {
                        requested_source: "listenbrainz".to_string(),
                        actual_source: "lastfm".to_string(),
                        message: "ListenBrainz is temporarily unavailable. Showing Last.fm worldwide ranks instead.".to_string(),
                    });
                    (
                        "lastfm".to_string(),
                        "Last.fm".to_string(),
                        scope,
                        period,
                        None,
                        entries,
                        None,
                        has_more,
                    )
                }
            },
            _ => {
                let (entries, has_more, scope, period) =
                    fetch_lastfm_chart(&genre, country.as_deref(), offset, limit).await?;
                (
                    "lastfm".to_string(),
                    "Last.fm".to_string(),
                    scope,
                    period,
                    None,
                    entries,
                    None,
                    has_more,
                )
            }
        };

    let entries = attach_chart_playback(candidates, &source_label).await;
    Ok(ChartPage {
        source: actual_source,
        source_label,
        scope_label,
        period_label,
        updated_at,
        entries,
        offset,
        limit,
        total,
        has_more,
        fallback,
    })
}

pub(crate) fn map_local_to_youtube_track(track: &crate::db::Track, source: &str) -> YoutubeTrack {
    let duration_raw = if let Some(d) = track.duration {
        let length_seconds = d as u32;
        let seconds = length_seconds % 60;
        let minutes = (length_seconds / 60) % 60;
        let hours = length_seconds / 3600;
        if hours > 0 {
            format!("{}:{}:{:02}", hours, minutes, seconds)
        } else {
            format!("{}:{:02}", minutes, seconds)
        }
    } else {
        "0:00".to_string()
    };

    let local_source = crate::db::PlaybackSource {
        provider: saved_track_provider(track),
        id: saved_track_source_id(track),
        catalog_quality: None,
        metadata: Some(crate::db::SourceMetadata {
            title: track.title.clone(),
            artist: track.artist.clone(),
            album: track.album.clone(),
            duration: track.duration,
            duration_raw: Some(duration_raw.clone()),
            cover_url: track.cover_url.clone(),
            track_number: track.track_number,
            disc_number: track.disc_number,
        }),
    };
    let source_context = Some(crate::db::RecordingSources {
        recording_id: format!("local_{}", track.id),
        sources: vec![local_source],
        selection: crate::db::SourceSelection::Auto,
    });

    YoutubeTrack {
        id: format!("local_{}", track.id),
        title: track.title.clone().unwrap_or_else(|| "Unknown Title".to_string()),
        artist: track.artist.clone().unwrap_or_else(|| "Unknown Artist".to_string()),
        cover_url: track.cover_url.clone(),
        duration_raw,
        url: track.path.clone(),
        recommendation_source: Some(source.to_string()),
        source_context,
    }
}

pub(crate) fn generate_local_discovery_fallback(
    lib_tracks: &[crate::db::Track],
    play_counts: &std::collections::HashMap<String, i64>,
) -> (Vec<YoutubeTrack>, Vec<YoutubeTrack>) {
    use rand::seq::SliceRandom;
    let mut recs = Vec::new();
    let mut seen_local = std::collections::HashSet::new();

    for t in lib_tracks {
        if t.loved.unwrap_or(0) == 1 {
            seen_local.insert(t.path.clone());
            recs.push(map_local_to_youtube_track(t, "Loved Saved Track"));
        }
    }

    let mut sorted_tracks = lib_tracks.to_vec();
    sorted_tracks.sort_by(|a, b| {
        let count_a = play_counts.get(&a.path).unwrap_or(&0);
        let count_b = play_counts.get(&b.path).unwrap_or(&0);
        count_b.cmp(count_a)
    });

    for t in sorted_tracks.iter().take(20) {
        if seen_local.insert(t.path.clone()) {
            recs.push(map_local_to_youtube_track(t, "Highly Played"));
        }
    }

    let mut rng = daily_recommendation_rng();
    let mut rest_tracks: Vec<_> = lib_tracks.iter().filter(|t| !seen_local.contains(&t.path)).collect();
    rest_tracks.shuffle(&mut rng);
    for t in rest_tracks.into_iter().take(30) {
        recs.push(map_local_to_youtube_track(t, "Library Discovery"));
    }

    let mut charts = Vec::new();
    for t in sorted_tracks.iter().take(15) {
        charts.push(map_local_to_youtube_track(t, "Saved Favorites"));
    }

    (recs, charts)
}

pub async fn get_personalized_discovery_hub_internal(
    seed_artists: Vec<String>,
    top_artists: Vec<String>,
    library_artists: Vec<String>,
    discovery_level: String,
    lastfm_connected: bool,
    lastfm_top_artists: Vec<String>,
    listenbrainz_connected: bool,
    listenbrainz_recs: Vec<String>,
    app_mode: String,
    is_online: bool,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<DiscoveryHubData, String> {
    crate::tidal::bounded_recommendation(async {

    use rand::Rng;
    use rand::seq::SliceRandom;

    // 1. Gather all required DB context upfront in one quick lock
    let (top_genre, lib_tracks, play_counts, recently_loved_tracks, recently_played_tracks, top_listened_tracks, artist_skip_stats, library_signatures) = {
        let conn = safe_lock(&state.db);

        // A. Top genre
        let mut top_genre_val = "Chill".to_string();
        if let Ok(mut stmt) = conn.prepare(
            "SELECT genre, COUNT(*) as c
             FROM playback_history
             WHERE signal_quality = 'qualified' AND listened_seconds >= MIN(120.0, duration * 0.5) AND genre IS NOT NULL AND genre != '' AND genre != 'Unknown'
             GROUP BY genre
             ORDER BY c DESC
             LIMIT 1"
        ) {
            if let Ok(mut rows) = stmt.query([]) {
                if let Some(row) = rows.next().unwrap_or(None) {
                    if let Ok(g) = row.get::<_, String>(0) {
                        top_genre_val = g;
                    }
                }
            }
        }

        // B. All library tracks & signatures
        let all_tracks = crate::db::get_all_tracks(&conn).unwrap_or_default();
        let tracks: Vec<_> = all_tracks.iter().filter(|t| t.disliked.unwrap_or(0) != 1).cloned().collect();
        let mut sigs = std::collections::HashSet::new();
        for t in &all_tracks {
            if let (Some(ref title), Some(ref artist)) = (&t.title, &t.artist) {
                let sig = format!("{}::{}", normalize_artist_name(artist), clean_title(title));
                sigs.insert(sig);
            }
        }

        // C. Play counts
        let mut p_counts = std::collections::HashMap::new();
        if let Ok(mut stmt) = conn.prepare("SELECT track_path, COUNT(*) FROM playback_history WHERE signal_quality = 'qualified' AND listened_seconds >= MIN(120.0, duration * 0.5) GROUP BY track_path") {
            if let Ok(mut rows) = stmt.query([]) {
                while let Some(row) = rows.next().unwrap_or(None) {
                    if let (Ok(path), Ok(count)) = (row.get::<_, String>(0), row.get::<_, i64>(1)) {
                        p_counts.insert(path, count);
                    }
                }
            }
        }

        // D. Recently loved tracks
        let mut loved_tracks = Vec::new();
        if let Ok(mut stmt) = conn.prepare(
            "SELECT title, artist, path FROM tracks
             WHERE loved = 1 AND title IS NOT NULL AND artist IS NOT NULL AND title != '' AND artist != '' AND artist != 'Unknown Artist' AND artist != 'YouTube Audio'
             ORDER BY id DESC
             LIMIT 25"
        ) {
            if let Ok(iter) = stmt.query_map([], |row| {
                let title: String = row.get(0)?;
                let artist: String = row.get(1)?;
                let path: String = row.get(2)?;
                Ok((title, artist, path))
            }) {
                for (title, artist, path) in iter.flatten() {
                    if !title.is_empty() && !artist.is_empty() {
                        loved_tracks.push((title, artist, path));
                    }
                }
            }
        }

        // E. Recently played tracks
        let mut recent_tracks = Vec::new();
        if let Ok(mut stmt) = conn.prepare(
            "SELECT DISTINCT title, artist FROM playback_history
             WHERE signal_quality = 'qualified' AND listened_seconds >= MIN(120.0, duration * 0.5) AND title IS NOT NULL AND artist IS NOT NULL AND title != '' AND artist != '' AND artist != 'Unknown Artist' AND artist != 'YouTube Audio' AND NOT EXISTS (SELECT 1 FROM tracks d WHERE d.disliked = 1 AND (d.path = playback_history.track_path OR (lower(d.title) = lower(playback_history.title) AND lower(d.artist) = lower(playback_history.artist)))) AND skipped = 0
             ORDER BY timestamp DESC
             LIMIT 20"
        ) {
            if let Ok(iter) = stmt.query_map([], |row| {
                let title: String = row.get(0)?;
                let artist: String = row.get(1)?;
                Ok((title, artist))
            }) {
                for (title, artist) in iter.flatten() {
                    if !title.is_empty() && !artist.is_empty() {
                        recent_tracks.push((title, artist));
                    }
                }
            }
        }

        // F. Top listened tracks
        let mut top_listened = Vec::new();
        if let Ok(mut stmt) = conn.prepare(
            "SELECT title, artist, COUNT(*) as play_count
             FROM playback_history
             WHERE signal_quality = 'qualified' AND listened_seconds >= MIN(120.0, duration * 0.5) AND title IS NOT NULL AND artist IS NOT NULL AND title != '' AND artist != '' AND artist != 'Unknown Artist' AND artist != 'YouTube Audio' AND NOT EXISTS (SELECT 1 FROM tracks d WHERE d.disliked = 1 AND (d.path = playback_history.track_path OR (lower(d.title) = lower(playback_history.title) AND lower(d.artist) = lower(playback_history.artist))))
             GROUP BY title, artist
             ORDER BY play_count DESC
             LIMIT 20"
        ) {
            if let Ok(iter) = stmt.query_map([], |row| {
                let title: String = row.get(0)?;
                let artist: String = row.get(1)?;
                Ok((title, artist))
            }) {
                for (title, artist) in iter.flatten() {
                    if !title.is_empty() && !artist.is_empty() {
                        top_listened.push((title, artist));
                    }
                }
            }
        }

        // G. Artist skip stats
        let mut skip_stats = std::collections::HashMap::new();
        let thirty_days_ago = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64 - 2_592_000)
            .unwrap_or(0);
        if let Ok(mut stmt) = conn.prepare(
            "SELECT artist, COUNT(*), SUM(skipped) FROM playback_history WHERE timestamp >= ?1 GROUP BY artist"
        ) {
            if let Ok(mut rows) = stmt.query(rusqlite::params![thirty_days_ago]) {
                while let Some(row) = rows.next().unwrap_or(None) {
                    if let (Ok(art), Ok(total), Ok(skipped)) = (row.get::<_, String>(0), row.get::<_, i64>(1), row.get::<_, i64>(2)) {
                        skip_stats.insert(art.to_lowercase(), (total, skipped));
                    }
                }
            }
        }

        (top_genre_val, tracks, p_counts, loved_tracks, recent_tracks, top_listened, skip_stats, sigs)
    };

    // Fast return if offline or in local mode
    if app_mode == "local" || !is_online {
        println!("[discovery-hub] Generating offline/local discovery hub data.");
        let lib_tracks: Vec<_> = lib_tracks.into_iter().filter(|track| saved_track_provider(track) == crate::db::SourceProvider::Local && std::path::Path::new(&track.path).is_file()).collect();
        let (recs, charts) = generate_local_discovery_fallback(&lib_tracks, &play_counts);
        let (mixed_for_you, recently_played, heavy_rotation, forgotten_gems, playlist_mixes) = {
            let conn = safe_lock(&state.db);
            let mixes = generate_local_mixes(&conn, &seed_artists, &top_artists);
            let (rec_p, heavy_r, forgot_g, p_mixes, unmatched_r, unmatched_t) =
                extract_library_shelves(&conn, &lib_tracks, &play_counts, &recently_played_tracks, &top_listened_tracks, true);
            let _ = (unmatched_r, unmatched_t); // Offline: no network to resolve online counterparts
            (mixes, rec_p, heavy_r, forgot_g, p_mixes)
        };
        let hub_data = DiscoveryHubData {
            recommendations: recs,
            global_charts: charts,
            mixed_for_you,
            recently_played,
            heavy_rotation,
            forgotten_gems,
            playlist_mixes,
        };
        if let Ok(app_data) = app_handle.path().app_data_dir() {
            let cache_file = app_data.join("discovery_cache.json");
            if let Ok(json_str) = serde_json::to_string(&hub_data) {
                let _ = std::fs::create_dir_all(&app_data);
                let _ = std::fs::write(cache_file, json_str);
            }
        }
        return Ok(hub_data);
    }

    let api_key = fetch_innertube_key().await;
    let client = crate::get_http_client();

    // Priority artists list
    let mut priority_loved_artists = Vec::new();
    let mut unique_loved = std::collections::HashSet::new();
    for (_, artist, _) in &recently_loved_tracks {
        if unique_loved.insert(artist.to_lowercase()) {
            priority_loved_artists.push(artist.clone());
        }
    }
    let genuine_loved_artists = priority_loved_artists.clone();
    for ta in &top_artists {
        if !ta.is_empty() && unique_loved.insert(ta.to_lowercase()) {
            priority_loved_artists.push(ta.clone());
        }
    }
    for lta in &lastfm_top_artists {
        if !lta.is_empty() && unique_loved.insert(lta.to_lowercase()) {
            priority_loved_artists.push(lta.clone());
        }
    }
    for sa in &seed_artists {
        if !sa.is_empty() && unique_loved.insert(sa.to_lowercase()) {
            priority_loved_artists.push(sa.clone());
        }
    }

    // ── TASK 1: GLOBAL CHARTS (Parallel) ──────────────────────────────────────
    let client_charts = client.clone();
    let api_key_charts = api_key.clone();
    let charts_task = async move {
        let chart_page = daily_recommendation_rng().random_range(1u32..=3u32);
        let genre_pool = ["pop", "hip-hop", "indie", "k-pop", "r&b", "rock", "electronic", "latin", "soul", "alternative", "dance"];
        let mut genre_indices: Vec<usize> = (0..genre_pool.len()).collect();
        genre_indices.shuffle(&mut daily_recommendation_rng());
        let picked_genres: Vec<&str> = genre_indices.into_iter().take(2).map(|i| genre_pool[i]).collect();

        let (chart_res, genre_res_a, genre_res_b) = futures::future::join3(
            crate::lastfm_api::get_global_top_tracks_page(chart_page),
            crate::lastfm_api::get_tag_top_tracks(picked_genres[0]),
            crate::lastfm_api::get_tag_top_tracks(picked_genres[1]),
        ).await;

        let mut chart_candidates: Vec<(String, String, String)> = Vec::new();
        let parse_tracks = |tracks: &[serde_json::Value], source: &str, out: &mut Vec<(String, String, String)>| {
            for t in tracks {
                let title = t.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let artist = t.get("artist").and_then(|a| a.get("name")).and_then(|n| n.as_str()).unwrap_or("").to_string();
                if !title.is_empty() && !artist.is_empty() && artist != "Unknown Artist" && !is_third_party_or_instrumental(&title, &artist) && !is_compilation_channel(&artist) {
                    out.push((title, artist, source.to_string()));
                }
            }
        };

        if let Ok(ref tracks) = chart_res { parse_tracks(tracks, "Global Top Hits", &mut chart_candidates); }
        if let Ok(ref tracks) = genre_res_a { parse_tracks(tracks, &format!("Trending {}", capitalize_first(picked_genres[0])), &mut chart_candidates); }
        if let Ok(ref tracks) = genre_res_b { parse_tracks(tracks, &format!("Trending {}", capitalize_first(picked_genres[1])), &mut chart_candidates); }

        chart_candidates.shuffle(&mut daily_recommendation_rng());

        let mut global_charts = Vec::new();
        let mut seen_ids = std::collections::HashSet::new();

        if !chart_candidates.is_empty() {
            let mut search_tasks = Vec::new();
            for (title, artist, source) in chart_candidates.iter().take(5) {
                let query = format!("{} {}", artist, title);
                let cl = client_charts.clone();
                let ak = api_key_charts.clone();
                let src = source.clone();
                search_tasks.push(async move {
                    (search_youtube_internal(&cl, &ak, &query, false).await, src)
                });
            }
            let results = futures::future::join_all(search_tasks).await;
            for (res, source) in results {
                if let Ok(tracks) = res {
                    for mut t in tracks.into_iter().take(4) {
                        if !is_duration_too_long(&t.duration_raw) && !is_third_party_or_instrumental(&t.title, &t.artist) && !is_compilation_channel(&t.artist) && seen_ids.insert(t.id.clone()) {
                            t.recommendation_source = Some(source.clone());
                            global_charts.push(t);
                        }
                    }
                }
            }
        } else {
            let fallback_queries = ["trending songs worldwide 2024", "viral hits global", "top pop songs right now"];
            let pick = daily_recommendation_rng().random_range(0..fallback_queries.len());
            if let Ok(tracks) = search_youtube_internal(&client_charts, &api_key_charts, fallback_queries[pick], false).await {
                for mut t in tracks.into_iter().take(12) {
                    if !is_duration_too_long(&t.duration_raw) && !is_third_party_or_instrumental(&t.title, &t.artist) && !is_compilation_channel(&t.artist) && seen_ids.insert(t.id.clone()) {
                        t.recommendation_source = Some("Global Top Hits".to_string());
                        global_charts.push(t);
                    }
                }
            }
        }
        global_charts
    };

    // ── TASK 2: PERSONALIZED RECOMMENDATIONS (Parallel) ──────────────────────
    let client_recs = client.clone();
    let api_key_recs = api_key.clone();
    let priority_artists_c = priority_loved_artists.clone();
    let genuine_loved_c = genuine_loved_artists.clone();
    let top_artists_c = top_artists.clone();
    let library_artists_c = library_artists.clone();
    let discovery_level_c = discovery_level.clone();
    let top_genre_c = top_genre.clone();
    let recently_loved_c = recently_loved_tracks.clone();
    let recently_played_c = recently_played_tracks.clone();
    let top_listened_c = top_listened_tracks.clone();
    let listenbrainz_recs_c = listenbrainz_recs.clone();
    let library_sigs_c = library_signatures.clone();
    let skip_stats_c = artist_skip_stats.clone();

    let recs_task = async move {
        #[derive(Debug, Clone)]
        struct CandidateTarget {
            target_artist: String,
            target_title: String,
            source_label: String,
            base_score: f64,
        }

        let mut candidate_targets: Vec<CandidateTarget> = Vec::new();

        // 1. Last.fm Similar Tracks
        if lastfm_connected || !recently_loved_c.is_empty() || !recently_played_c.is_empty() || !top_listened_c.is_empty() {
            let mut track_seeds: Vec<(String, String)> = Vec::new();
            for (t, a, _) in &recently_loved_c { track_seeds.push((t.clone(), a.clone())); }
            for (t, a) in &recently_played_c {
                if !track_seeds.iter().any(|(st, sa)| st == t && sa == a) { track_seeds.push((t.clone(), a.clone())); }
            }
            for (t, a) in &top_listened_c {
                if !track_seeds.iter().any(|(st, sa)| st == t && sa == a) { track_seeds.push((t.clone(), a.clone())); }
            }
            track_seeds.shuffle(&mut daily_recommendation_rng());

            let mut sim_futures = Vec::new();
            for (t_title, t_artist) in track_seeds.into_iter().take(3) {
                let title_c = t_title.clone();
                let artist_c = t_artist.clone();
                sim_futures.push(async move {
                    let res = crate::lastfm_api::get_similar_tracks(&artist_c, &title_c).await;
                    (title_c, res)
                });
            }
            let sim_results = futures::future::join_all(sim_futures).await;
            for (seed_title, res) in sim_results {
                if let Ok(similar_list) = res {
                    let mut sim_copy = similar_list;
                    sim_copy.shuffle(&mut daily_recommendation_rng());
                    for item in sim_copy.into_iter().take(3) {
                        let s_title = item.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        let s_artist = item.get("artist").and_then(|a| a.get("name")).and_then(|n| n.as_str()).unwrap_or("").to_string();
                        if !s_title.is_empty() && !s_artist.is_empty() && s_artist != "Unknown Artist" {
                            candidate_targets.push(CandidateTarget {
                                target_artist: s_artist,
                                target_title: s_title,
                                source_label: format!("Similar to '{}'", seed_title),
                                base_score: 3.5,
                            });
                        }
                    }
                }
            }
        }

        // 2. Similar Artists
        if !priority_artists_c.is_empty() {
            let mut artist_seeds = priority_artists_c.clone();
            artist_seeds.shuffle(&mut daily_recommendation_rng());
            let mut sim_artist_futures = Vec::new();
            for seed_art in artist_seeds.into_iter().take(3) {
                let seed_c = seed_art.clone();
                sim_artist_futures.push(async move {
                    let res = crate::lastfm_api::get_similar_artists(&seed_c).await;
                    (seed_c, res)
                });
            }
            let sim_artist_results = futures::future::join_all(sim_artist_futures).await;
            let mut top_track_futures = Vec::new();
            for (seed_art, res) in sim_artist_results {
                if let Ok(sim_artists) = res {
                    let mut arts_copy = sim_artists;
                    arts_copy.shuffle(&mut daily_recommendation_rng());
                    for sim_art in arts_copy.into_iter().take(2) {
                        let seed_label = format!("Fans of {} also like", seed_art);
                        let sim_art_c = sim_art.clone();
                        top_track_futures.push(async move {
                            let top_res = crate::lastfm_api::get_artist_top_tracks(&sim_art_c).await;
                            (sim_art_c, seed_label, top_res)
                        });
                    }
                }
            }
            let top_track_results = futures::future::join_all(top_track_futures).await;
            for (sim_art, seed_label, top_res) in top_track_results {
                if let Ok(tracks) = top_res {
                    let mut tr_copy = tracks;
                    tr_copy.shuffle(&mut daily_recommendation_rng());
                    for t in tr_copy.into_iter().take(2) {
                        let t_name = t.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        if !t_name.is_empty() {
                            candidate_targets.push(CandidateTarget {
                                target_artist: sim_art.clone(),
                                target_title: t_name,
                                source_label: seed_label.clone(),
                                base_score: 2.8,
                            });
                        }
                    }
                }
            }
        }

        // 3. Popular tracks from favorite artists
        if !priority_artists_c.is_empty() {
            let mut fav_artists = priority_artists_c.clone();
            fav_artists.shuffle(&mut daily_recommendation_rng());
            let mut fav_futures = Vec::new();
            for fav_art in fav_artists.into_iter().take(2) {
                let fav_c = fav_art.clone();
                fav_futures.push(async move {
                    let res = crate::lastfm_api::get_artist_top_tracks(&fav_c).await;
                    (fav_c, res)
                });
            }
            let fav_results = futures::future::join_all(fav_futures).await;
            for (fav_art, res) in fav_results {
                if let Ok(tracks) = res {
                    let mut tr_copy = tracks;
                    tr_copy.shuffle(&mut daily_recommendation_rng());
                    for t in tr_copy.into_iter().take(2) {
                        let t_name = t.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                        if !t_name.is_empty() {
                            candidate_targets.push(CandidateTarget {
                                target_artist: fav_art.clone(),
                                target_title: t_name,
                                source_label: format!("From {}", fav_art),
                                base_score: 2.2,
                            });
                        }
                    }
                }
            }
        }

        // 4. Genre Tag Cloud
        if !top_genre_c.is_empty() && top_genre_c != "Unknown" {
            if let Ok(tag_tracks) = crate::lastfm_api::get_tag_top_tracks(&top_genre_c).await {
                let mut tag_copy = tag_tracks;
                tag_copy.shuffle(&mut daily_recommendation_rng());
                for t in tag_copy.into_iter().take(4) {
                    let title = t.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let artist = t.get("artist").and_then(|a| a.get("name")).and_then(|n| n.as_str()).unwrap_or("").to_string();
                    if !title.is_empty() && !artist.is_empty() && artist != "Unknown Artist" {
                        candidate_targets.push(CandidateTarget {
                            target_artist: artist,
                            target_title: title,
                            source_label: format!("Top {} Discovery", capitalize_first(&top_genre_c)),
                            base_score: 1.8,
                        });
                    }
                }
            }
        }

        // 5. ListenBrainz
        if listenbrainz_connected && !listenbrainz_recs_c.is_empty() {
            let mut lb_copy = listenbrainz_recs_c;
            lb_copy.shuffle(&mut daily_recommendation_rng());
            for rec_str in lb_copy.into_iter().take(4) {
                let parts: Vec<&str> = rec_str.split(" - ").collect();
                if parts.len() >= 2 {
                    let lb_artist = parts[0].trim().to_string();
                    let lb_title = parts[1..].join(" - ").trim().to_string();
                    if !lb_artist.is_empty() && !lb_title.is_empty() {
                        candidate_targets.push(CandidateTarget {
                            target_artist: lb_artist,
                            target_title: lb_title,
                            source_label: "ListenBrainz Collaborative".to_string(),
                            base_score: 2.5,
                        });
                    }
                }
            }
        }

        // 6. Starter seeds if empty
        if candidate_targets.is_empty() {
            let starter_seeds = vec![
                ("Taylor Swift", "Cruel Summer", "Trending Pop"),
                ("The Weeknd", "Blinding Lights", "Trending R&B"),
                ("Billie Eilish", "Birds of a Feather", "Trending Indie"),
                ("Daft Punk", "Get Lucky", "Trending Electronic"),
                ("Coldplay", "Yellow", "Trending Rock"),
                ("IVE", "I AM", "Trending K-Pop"),
                ("Fujii Kaze", "Shinunoga E-Wa", "Trending J-Pop"),
                ("Sabrina Carpenter", "Espresso", "Trending Pop"),
                ("Post Malone", "Circles", "Trending Pop"),
                ("Bruno Mars", "Die With A Smile", "Trending Pop"),
            ];
            for (art, tit, src) in starter_seeds {
                candidate_targets.push(CandidateTarget {
                    target_artist: art.to_string(),
                    target_title: tit.to_string(),
                    source_label: src.to_string(),
                    base_score: 1.5,
                });
            }
        }

        // Deduplicate candidate targets & cap to 14 parallel searches
        let mut unique_targets = Vec::new();
        let mut seen_target_keys = std::collections::HashSet::new();
        candidate_targets.shuffle(&mut daily_recommendation_rng());

        for cand in candidate_targets {
            let key = format!("{}::{}", normalize_artist_name(&cand.target_artist), clean_title(&cand.target_title));
            if seen_target_keys.insert(key) {
                unique_targets.push(cand);
            }
        }

        let search_pool: Vec<CandidateTarget> = unique_targets.into_iter().take(14).collect();
        let mut candidate_search_tasks = Vec::new();
        for target in search_pool {
            let query = format!("{} {}", target.target_artist, target.target_title);
            let cl = client_recs.clone();
            let ak = api_key_recs.clone();
            candidate_search_tasks.push(async move {
                let res = search_youtube_internal(&cl, &ak, &query, false).await;
                (target, res)
            });
        }
        let search_results = futures::future::join_all(candidate_search_tasks).await;

        let mut raw_candidates: Vec<(YoutubeTrack, f64)> = Vec::new();
        let mut seen_cand_ids = std::collections::HashSet::new();

        for (target, res) in search_results {
            if let Ok(tracks) = res {
                let mut added_for_target = 0;
                for mut track in tracks.into_iter().take(4) {
                    if !artist_matches(&track.artist, &target.target_artist) || (!target.target_title.trim().is_empty() && !recording_matches(&track, &target.target_artist, &target.target_title)) {
                        continue;
                    }
                    if is_duration_too_long(&track.duration_raw) {
                        continue;
                    }
                    if is_third_party_or_instrumental(&track.title, &track.artist) || is_compilation_channel(&track.artist) {
                        continue;
                    }
                    let sig = format!("{}::{}", normalize_artist_name(&track.artist), clean_title(&track.title));
                    if library_sigs_c.contains(&sig) {
                        continue;
                    }
                    let title_lower = track.title.to_lowercase();
                    let has_unofficial = ["lyrics", "lyric", "가사", "color coded", "color-coded", "translation", "sub", "subbed", "fancam", "compilation", "playlist", "nonstop", "non-stop"]
                        .iter().any(|&kw| title_lower.contains(kw));
                    if has_unofficial {
                        continue;
                    }
                    track.recommendation_source = Some(if target.target_title.trim().is_empty() { format!("From {}", target.target_artist) } else { target.source_label.clone() });
                    if seen_cand_ids.insert(track.id.clone()) {
                        raw_candidates.push((track, target.base_score));
                        added_for_target += 1;
                        if added_for_target >= 2 {
                            break;
                        }
                    }
                }
            }
        }

        let hub_profile = DiscoveryTasteProfile {
            loved_artists: &genuine_loved_c,
            top_artists: &top_artists_c,
            library_artists: &library_artists_c,
            discovery_level: &discovery_level_c,
            artist_skip_stats: &skip_stats_c,
        };

        let mut scored_tracks = Vec::new();
        for (track, base_score) in raw_candidates {
            let score = score_discovery_candidate(&hub_profile, base_score, &track.artist);
            scored_tracks.push((track, score));
        }

        scored_tracks.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

        let mut final_recs = Vec::new();
        let mut artist_counts = std::collections::HashMap::new();
        for (track, _) in scored_tracks {
            if final_recs.len() >= 50 { break; }
            let cand_artist = track.artist.clone();
            let current_count = *artist_counts.get(&cand_artist).unwrap_or(&0);
            let same_artist_limit = if discovery_level_c == "familiarity" { 3 } else { 2 };
            if current_count < same_artist_limit {
                artist_counts.insert(cand_artist, current_count + 1);
                final_recs.push(track);
            }
        }
        final_recs
    };

    // ── TASK 3: MIXES (Parallel) ──────────────────────────────────────────────
    let client_mixes = client.clone();
    let api_key_mixes = api_key.clone();
    let seed_artists_mix = seed_artists.clone();
    let top_artists_mix = top_artists.clone();
    let top_genre_mix = top_genre.clone();
    let recent_repeats_mix = {
        let conn = safe_lock(&state.db);
        let cutoff = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64 - 7 * 86_400).unwrap_or(0);
        let mut repeats = Vec::new();
        if let Ok(mut stmt) = conn.prepare("SELECT track_path, title, artist FROM playback_history WHERE timestamp >= ?1 AND signal_quality = 'qualified' AND listened_seconds >= MIN(120.0, duration * 0.5) AND title IS NOT NULL AND artist IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tracks d WHERE d.disliked = 1 AND (d.path = playback_history.track_path OR (lower(d.title) = lower(playback_history.title) AND lower(d.artist) = lower(playback_history.artist)))) GROUP BY track_path, title, artist HAVING COUNT(*) >= 2 ORDER BY COUNT(*) DESC, MAX(timestamp) DESC LIMIT 20") {
            if let Ok(rows) = stmt.query_map([cutoff], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))) {
                repeats.extend(rows.flatten());
            }
        }
        repeats
    };
    let lib_tracks_mix = lib_tracks.clone();
    let play_counts_mix = play_counts.clone();

    let mixes_task = async move {
        match generate_hybrid_mixes(&client_mixes, &api_key_mixes, &seed_artists_mix, &top_artists_mix, &top_genre_mix, &lib_tracks_mix, &play_counts_mix, &recent_repeats_mix).await {
            Ok(mixes) if !mixes.is_empty() => mixes,
            _ => Vec::new()
        }
    };

    // ── JOIN ALL CONCURRENT TASKS ─────────────────────────────────────────────
    let (charts_res, recs_res, mixes_res) = tokio::join!(charts_task, recs_task, mixes_task);

    let mut global_charts = charts_res;
    let mut recommendations = recs_res;
    let mut mixed_for_you = mixes_res;

    // Guaranteed fallbacks if any online source was empty or errored
    let (local_recs, local_charts) = generate_local_discovery_fallback(&lib_tracks, &play_counts);

    if recommendations.is_empty() {
        recommendations = local_recs;
    }
    if global_charts.is_empty() {
        global_charts = local_charts;
    }
    if mixed_for_you.is_empty() {
        let conn = safe_lock(&state.db);
        mixed_for_you = generate_local_mixes(&conn, &seed_artists, &top_artists);
    }

    let (recently_played, heavy_rotation, forgotten_gems, playlist_mixes, unmatched_recent, unmatched_top) = {
        let conn = safe_lock(&state.db);
        extract_library_shelves(&conn, &lib_tracks, &play_counts, &recently_played_tracks, &top_listened_tracks, false)
    };

    // ── BLEND ONLINE COUNTERPARTS INTO PERSONAL SHELVES ─────────────────────
    // Listening-history songs that have no local file get their YouTube
    // version resolved and woven into the shelves (natural mix, no strict
    // local/online alternation). Search budget stays small for latency.
    let (recently_played, heavy_rotation, forgotten_gems) = {
        let recent_pairs: Vec<(String, String)> = unmatched_recent.into_iter().take(4).collect();
        let (rotation_pairs, gem_pairs) = split_unmatched_for_shelves(unmatched_top, 4, 3);

        let (resolved_recent, resolved_rotation, resolved_gems) = tokio::join!(
            resolve_history_pairs_to_tracks(&client, &api_key, recent_pairs),
            resolve_history_pairs_to_tracks(&client, &api_key, rotation_pairs),
            resolve_history_pairs_to_tracks(&client, &api_key, gem_pairs),
        );

        let tag_source = |mut tracks: Vec<YoutubeTrack>, source: &str| {
            for t in tracks.iter_mut() { t.recommendation_source = Some(source.to_string()); }
            tracks
        };

        let dedupe_and_blend = |mut local: Vec<YoutubeTrack>, online: Vec<YoutubeTrack>, sigs: &std::collections::HashSet<String>| {
            let filtered_online = dedupe_online_against_shelf(&mut local, online, sigs);
            blend_shelf_naturally(local, filtered_online, 20)
        };

        (
            dedupe_and_blend(recently_played, tag_source(resolved_recent, "Recently Played"), &library_signatures),
            dedupe_and_blend(heavy_rotation, tag_source(resolved_rotation, "Heavy Rotation"), &library_signatures),
            dedupe_and_blend(forgotten_gems, tag_source(resolved_gems, "Time Capsule"), &library_signatures),
        )
    };

    let hub_data = DiscoveryHubData {
        recommendations,
        global_charts,
        mixed_for_you,
        recently_played,
        heavy_rotation,
        forgotten_gems,
        playlist_mixes,
    };

    // Cache the resolved discovery hub data to disk for offline-first instant loading!
    if let Ok(app_data) = app_handle.path().app_data_dir() {
        let cache_file = app_data.join("discovery_cache.json");
        if let Ok(json_str) = serde_json::to_string(&hub_data) {
            let _ = std::fs::create_dir_all(&app_data);
            let _ = std::fs::write(cache_file, json_str);
        }
    }

    Ok(hub_data)

    }).await
}

pub fn get_cached_discovery_hub_internal(app_handle: tauri::AppHandle) -> Result<Option<DiscoveryHubData>, String> {
    if let Ok(app_data) = app_handle.path().app_data_dir() {
        let cache_file = app_data.join("discovery_cache.json");
        if cache_file.exists() {
            if let Ok(data_str) = std::fs::read_to_string(cache_file) {
                if let Ok(cached) = serde_json::from_str::<DiscoveryHubData>(&data_str) {
                    return Ok(Some(cached));
                }
            }
        }
    }
    Ok(None)
}
