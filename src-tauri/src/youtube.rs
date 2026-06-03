use serde::{Deserialize, Serialize};
use tauri::State;
use crate::AppState;
use crate::safe_lock;

lazy_static::lazy_static! {
    static ref RE_INNERTUBE_1: regex::Regex = regex::Regex::new(r#""INNERTUBE_API_KEY"\s*:\s*"([^"]+)""#).unwrap();
    static ref RE_INNERTUBE_2: regex::Regex = regex::Regex::new(r#""innertubeApiKey"\s*:\s*"([^"]+)""#).unwrap();
    static ref RE_VIEWS: regex::Regex = regex::Regex::new(r"([\d\.]+)\s*([bmk])\s*(views|plays)").unwrap();
    static ref COVER_REGEXES: Vec<regex::Regex> = vec![
        regex::Regex::new(r"\bcover\s+by\b").unwrap(),
        regex::Regex::new(r"\bcover\s+version\b").unwrap(),
        regex::Regex::new(r"[\(\[][^)]*\bcover\b[^)]*[\)\]]").unwrap(),
        regex::Regex::new(r"\s+-\s+cover\b").unwrap(),
        regex::Regex::new(r"\bcover\s+of\b").unwrap(),
        regex::Regex::new(r"\bacoustic\s+cover\b").unwrap(),
        regex::Regex::new(r"\bpiano\s+cover\b").unwrap(),
        regex::Regex::new(r"\bguitar\s+cover\b").unwrap(),
        regex::Regex::new(r"\bviolin\s+cover\b").unwrap(),
        regex::Regex::new(r"\bmetal\s+cover\b").unwrap(),
        regex::Regex::new(r"\bdrum\s+cover\b").unwrap(),
        regex::Regex::new(r"\bcell\s+cover\b").unwrap(),
        regex::Regex::new(r"\bflute\s+cover\b").unwrap(),
        regex::Regex::new(r"\bharp\s+cover\b").unwrap(),
    ];
    static ref ARTIST_REGEXES: Vec<regex::Regex> = vec![
        regex::Regex::new(r"\bcovers\b").unwrap(),
        regex::Regex::new(r"\bcover\s+nation\b").unwrap(),
        regex::Regex::new(r"\bcover\s+channel\b").unwrap(),
        regex::Regex::new(r"\bcover\s+band\b").unwrap(),
        regex::Regex::new(r"\btribute\s+band\b").unwrap(),
        regex::Regex::new(r"\bpiano\s+tribute\b").unwrap(),
        regex::Regex::new(r"\btribute\s+orchestra\b").unwrap(),
    ];
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct YoutubeTrack {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub cover_url: Option<String>,
    pub duration_raw: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recommendation_source: Option<String>,
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

fn find_video_id(val: &serde_json::Value) -> Option<String> {
    if let serde_json::Value::Object(obj) = val {
        if let Some(serde_json::Value::String(vid)) = obj.get("videoId") {
            return Some(vid.clone());
        }
        for (_, v) in obj {
            if let Some(vid) = find_video_id(v) {
                return Some(vid);
            }
        }
    } else if let serde_json::Value::Array(arr) = val {
        for v in arr {
            if let Some(vid) = find_video_id(v) {
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

async fn fetch_innertube_key() -> String {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .build();

    let client = match client {
        Ok(c) => c,
        Err(_) => {
            println!("⚠ [YOUTUBE ENGINE] Failed to build reqwest client. Using fallback InnerTube API key.");
            return get_fallback_innertube_key();
        }
    };

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

    if let Some(caps) = RE_INNERTUBE_1.captures(&html) {
        if let Some(m) = caps.get(1) {
            return m.as_str().to_string();
        }
    }

    if let Some(caps) = RE_INNERTUBE_2.captures(&html) {
        if let Some(m) = caps.get(1) {
            return m.as_str().to_string();
        }
    }

    println!("⚠ [YOUTUBE ENGINE] Could not extract InnerTube API key from music.youtube.com HTML. Using fallback key.");
    get_fallback_innertube_key()
}

async fn fetch_track_duration(client: &reqwest::Client, api_key: &str, video_id: &str) -> Option<String> {
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

async fn search_youtube_internal(
    client: &reqwest::Client,
    api_key: &str,
    query: &str,
    resolve_durations: bool,
) -> Result<Vec<YoutubeTrack>, String> {
    let search_url = format!("https://music.youtube.com/youtubei/v1/search?key={}&prettyPrint=false", api_key);

    let payload = serde_json::json!({
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": "1.20240101.01.00",
                "hl": "en",
                "gl": "US"
            }
        },
        "query": query
    });

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
                }
            }
            for run in runs_arr {
                if let Some(text) = run.get("text").and_then(|t| t.as_str()) {
                    let text_lower = text.to_lowercase();
                    if text_lower.contains("topic") {
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
            .or_else(|| find_video_id(&item));
 
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
            .and_then(|runs| runs.first())
            .and_then(|run| run.get("text"))
            .and_then(|t| t.as_str())
            .unwrap_or("Unknown Title")
            .to_string();
 
        let duration_raw = extract_duration(&item).unwrap_or_else(|| "0:00".to_string());
 
        let thumbnail_url = item.get("thumbnail")
            .and_then(|t| t.get("musicThumbnailRenderer"))
            .and_then(|mt| mt.get("thumbnail"))
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
        });
 
        let url = format!("https://www.youtube.com/watch?v={}", video_id);
 
        seen_ids.insert(video_id.clone());
 
        let mut title_score = 0.0;
        let title_lower = title.to_lowercase();
        let query_lower = query.to_lowercase();
 
        // Penalize unofficial versions unless query specifically asked for them
        let negative_terms = vec![
            ("cover", -6.0),
            ("remix", -4.0),
            ("live", -3.0),
            ("karaoke", -6.0),
            ("instrumental", -5.0),
            ("slowed", -5.0),
            ("reverb", -5.0),
            ("tribute", -5.0),
            ("10 hours", -6.0),
            ("10 hrs", -6.0),
            ("loop", -5.0),
            ("nightcore", -6.0),
            ("fanmade", -6.0),
            ("cover art", -4.0),
        ];
 
        for (term, penalty) in negative_terms {
            if title_lower.contains(term) && !query_lower.contains(term) {
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
        println!("[youtube] Resolving {} missing track durations concurrently...", duration_tasks.len());
        let results = futures::future::join_all(duration_tasks).await;
        for (i, dur) in results {
            if dur != "0:00" {
                tracks[i].duration_raw = dur;
            }
        }
    }

    Ok(tracks)
}

#[tauri::command]
pub async fn search_youtube(query: String) -> Result<Vec<YoutubeTrack>, String> {
    let api_key = fetch_innertube_key().await;
    println!("[youtube] Searching YouTube Music via InnerTube with key: {}", api_key);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    search_youtube_internal(&client, &api_key, &query, true).await
}

fn is_one_hour_or_longer(duration_raw: &str) -> bool {
    let parts: Vec<&str> = duration_raw.split(':').collect();
    if parts.len() >= 3 {
        if let Ok(hours) = parts[0].trim().parse::<u32>() {
            return hours >= 1;
        }
    }
    false
}

#[tauri::command]
pub async fn get_aideo_recommendations(top_artists: Vec<String>, exclude_ids: Vec<String>) -> Result<Vec<YoutubeTrack>, String> {
    let api_key = fetch_innertube_key().await;
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

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
                    if is_one_hour_or_longer(&track.duration_raw) {
                        println!(
                            "[youtube] Filtering out recommended track '{}' because duration is 1 hour++ ({})",
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
        println!("[youtube] Resolving {} missing track durations for final recommendations concurrently...", duration_tasks.len());
        let results = futures::future::join_all(duration_tasks).await;
        for (i, dur) in results {
            if dur != "0:00" {
                final_tracks[i].duration_raw = dur;
            }
        }
    }

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

pub fn is_third_party_or_instrumental(title: &str, artist: &str) -> bool {
    let title_lower = title.to_lowercase();
    let artist_lower = artist.to_lowercase();

    // 1. Direct title keyword contains
    let title_keywords = [
        "instrumental",
        "karaoke",
        "backing track",
        "backing tracks",
        "piano version",
        "guitar version",
        "synthesia",
        "music box version",
        "music box cover",
        "tribute version",
        "8-bit",
        "8bit",
        "midi",
        "cgbspins",
        "singalong",
        "sing along",
        "tutorials",
        "piano tutorial",
        "karaoke version",
        "karaoke track",
        "karaoke mix",
        "instrumental version",
        "instrumental cover",
        "instrumental mix",
        "instrumental edit",
        "instrumental track",
        "8-bit cover",
        "8bit cover",
        "lofi cover",
        "lo-fi cover",
        "orchestral version",
        "orchestral cover",
    ];

    for &kw in &title_keywords {
        if title_lower.contains(kw) {
            return true;
        }
    }

    // 2. Specific regex patterns for covers in title
    for re in COVER_REGEXES.iter() {
        if re.is_match(&title_lower) {
            return true;
        }
    }

    // 3. Direct artist/channel keywords
    let artist_keywords = [
        "karaoke",
        "instrumental",
        "tribute",
        "synthesia",
        "music box",
        "sing king",
        "backing tracks",
        "karaoke academy",
        "karaoke tracks",
        "backing track",
    ];

    for &kw in &artist_keywords {
        if artist_lower.contains(kw) {
            return true;
        }
    }

    // 4. Specific regex patterns for artist/channel names
    for re in ARTIST_REGEXES.iter() {
        if re.is_match(&artist_lower) {
            return true;
        }
    }

    false
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

#[tauri::command]
pub async fn get_youtube_autoplay_recommendations(
    video_id: String,
    artist: String,
    title: String,
    top_artists: Vec<String>,
    library_artists: Vec<String>,
    discovery_level: String,
) -> Result<Vec<YoutubeTrack>, String> {
    let api_key = fetch_innertube_key().await;
    println!("[youtube] Aideo Autoplay Engine v2: Resolving Watch Next Radio for '{}' by '{}' (Discovery Level: {})", title, artist, discovery_level);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    // --- CANDIDATE GENERATION SOURCE 1: YouTube Music Watch Next ---
    let mut tracks = Vec::new();
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
        "videoId": video_id
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
            seen_ids.insert(video_id.clone());

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

                let track_artist = item.get("longBylineText")
                    .and_then(|b| b.get("runs"))
                    .and_then(|r| r.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|first| first.get("text"))
                    .and_then(|t| t.as_str())
                    .unwrap_or("Unknown Artist")
                    .to_string();

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
                    recommendation_source: None,
                });
            }
        }
    }

    // --- CANDIDATE GENERATION SOURCE 2: Last.fm Collaborative similar tracks (Concurrent) ---
    let mut lastfm_candidates = Vec::new();
    if let Ok(sim_tracks) = crate::lastfm_api::get_similar_tracks(&artist, &title).await {
        for t in sim_tracks {
            let track_title = t.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string();
            let track_artist = t.get("artist").and_then(|a| a.get("name")).and_then(|n| n.as_str()).unwrap_or("").to_string();
            if !track_title.is_empty() && !track_artist.is_empty() {
                lastfm_candidates.push((track_title, track_artist));
            }
        }
    }

    if lastfm_candidates.is_empty() {
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

    if tracks.is_empty() {
        println!("[youtube] Autoplay endpoint returned no recommendations. Executing fallback search recommendations for artist: {}", artist);
        let search_query = format!("{} similar songs recommendations", artist);
        if let Ok(fallback_tracks) = search_youtube_internal(&client, &api_key, &search_query, false).await {
            tracks = fallback_tracks;
        }
    }

    // ── AIDEO AUTOPLAY ENGINE V2 FILTER PIPELINE ──
    let _artist_lower = artist.to_lowercase();
    let mut filtered_tracks = Vec::new();
    let mut seen_titles = std::collections::HashSet::new();

    for track in tracks {
        // 0. Instrumental/Third-Party Filter
        if is_third_party_or_instrumental(&track.title, &track.artist) {
            println!("[autoplay-filter] Drop instrumental/third-party track: '{}' by '{}'", track.title, track.artist);
            continue;
        }

        // 1. Semantic Noise Filter
        if is_semantic_noise(&track.title, &title) {
            println!("[autoplay-filter] Drop semantic noise: '{}' by '{}'", track.title, track.artist);
            continue;
        }

        // 2. Fuzzy Title De-duplication (Similarity >70% against seed title)
        let sim = fuzzy_title_similarity(&track.title, &title);
        if sim > 0.70 {
            println!("[autoplay-filter] Drop duplicate song: '{}' (Similarity: {:.2}%)", track.title, sim * 100.0);
            continue;
        }

        // 3. Track Duration Filter (Drop >15 mins / 900s)
        let parts: Vec<&str> = track.duration_raw.split(':').collect();
        let is_too_long = if parts.len() >= 3 {
            true // 1 hour or more
        } else if parts.len() == 2 {
            if let Ok(minutes) = parts[0].trim().parse::<u32>() {
                minutes > 15
            } else {
                false
            }
        } else {
            false
        };

        if is_too_long {
            println!("[autoplay-filter] Drop long-duration track: '{}' ({})", track.title, track.duration_raw);
            continue;
        }

        // 4. De-duplicate clean titles inside the recommended list itself
        let clean = clean_title(&track.title);
        if seen_titles.contains(&clean) {
            continue;
        }
        seen_titles.insert(clean);

        filtered_tracks.push(track);
    }

    // ── TASTE-WEIGHTED SCORING PIPELINE ──
    let mut scored_tracks: Vec<(YoutubeTrack, f64)> = Vec::new();

    for track in filtered_tracks {
        let mut score = 1.0;
        let candidate_artist_lower = track.artist.to_lowercase();
        
        let is_top_artist = top_artists.iter().any(|ta| {
            let ta_lower = ta.to_lowercase();
            candidate_artist_lower.contains(&ta_lower) || ta_lower.contains(&candidate_artist_lower)
        });
        
        let is_library_artist = library_artists.iter().any(|la| {
            let la_lower = la.to_lowercase();
            candidate_artist_lower.contains(&la_lower) || la_lower.contains(&candidate_artist_lower)
        });

        match discovery_level.as_str() {
            "familiarity" => {
                if is_top_artist {
                    score += 0.75;
                } else if is_library_artist {
                    score += 0.3;
                } else {
                    score -= 0.4;
                }
            }
            "discovery" => {
                if is_top_artist {
                    score -= 0.5;
                } else if is_library_artist {
                    score += 0.55;
                } else {
                    score += 0.4;
                }
            }
            _ => { // "balanced"
                if is_top_artist {
                    score += 0.25;
                }
                if is_library_artist && !is_top_artist {
                    score += 0.35;
                }
            }
        }

        scored_tracks.push((track, score));
    }

    // Sort by Personalized Taste Score in descending order
    scored_tracks.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    // Curate queue with artist diversity constraints
    let mut final_queue = Vec::new();
    let mut artist_counts = std::collections::HashMap::new();

    for (track, score) in scored_tracks {
        if final_queue.len() >= 8 {
            break;
        }

        let cand_artist = track.artist.clone();
        let current_count = *artist_counts.get(&cand_artist).unwrap_or(&0);
        let same_artist_limit = if discovery_level == "familiarity" { 4 } else { 2 };

        if current_count < same_artist_limit {
            artist_counts.insert(cand_artist, current_count + 1);
            println!("[autoplay-scorer] Accepted '{}' by '{}' (Score: {:.2})", track.title, track.artist, score);
            final_queue.push(track);
        } else {
            println!("[autoplay-scorer] Capped artist repetitions for '{}' by '{}'", track.title, track.artist);
        }
    }

    // Resolve durations for final curated 8 tracks concurrently!
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

    Ok(final_queue)
}

fn parse_ytdlp_progress(line: &str) -> Option<(f64, f64, f64)> {
    if line.starts_with("[download]") {
        if let Some(of_idx) = line.find("of") {
            let percent_part = &line["[download]".len()..of_idx].trim();
            let percent_clean = percent_part.replace("%", "");
            if let Ok(percent) = percent_clean.parse::<f64>() {
                let remaining = &line[of_idx + 2..].trim();
                let size_part = if let Some(at_idx) = remaining.find("at") {
                    &remaining[..at_idx].trim()
                } else {
                    remaining
                };
                
                let is_mib = size_part.contains("MiB") || size_part.contains("mib");
                let is_kb = size_part.contains("KiB") || size_part.contains("KB") || size_part.contains("kib") || size_part.contains("kb");
                
                let size_clean = size_part
                    .replace("MiB", "")
                    .replace("MB", "")
                    .replace("mib", "")
                    .replace("mb", "")
                    .replace("KiB", "")
                    .replace("KB", "")
                    .replace("kib", "")
                    .replace("kb", "")
                    .trim()
                    .to_string();
                
                if let Ok(total_size) = size_clean.parse::<f64>() {
                    let total_mb = if is_mib {
                        total_size * 1.04858
                    } else if is_kb {
                        total_size / 1024.0
                    } else {
                        total_size
                    };
                    
                    let downloaded_mb = total_mb * (percent / 100.0);
                    return Some((percent, downloaded_mb, total_mb));
                }
            }
        }
    }
    None
}

fn run_ytdlp_with_progress(
    ytdlp_path: &std::path::Path,
    args: &[String],
    url: &str,
    app_handle: &tauri::AppHandle,
    music_dir: &std::path::Path,
) -> Result<String, String> {
    use std::io::{BufRead, BufReader};
    use tauri::Emitter;

    let mut cmd = std::process::Command::new(ytdlp_path);
    cmd.args(args)
       .arg(url)
       .stdout(std::process::Stdio::piped())
       .stderr(std::process::Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn yt-dlp: {}", e))?;
    let stdout = child.stdout.take().ok_or("Failed to open stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to open stderr")?;

    // Drain stderr asynchronously to prevent subprocess deadlock from full OS pipe buffers
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for l in reader.lines().map_while(Result::ok) {
            eprintln!("[yt-dlp-err] {}", l);
        }
    });

    let reader = BufReader::new(stdout);
    let mut final_path_str = String::new();
    let mut last_emit_time = std::time::Instant::now();

    for l in reader.lines().map_while(Result::ok) {
        if let Some((percent, downloaded_mb, total_mb)) = parse_ytdlp_progress(&l) {
            if last_emit_time.elapsed() >= std::time::Duration::from_millis(150) {
                let _ = app_handle.emit("ytdlp-download-progress", serde_json::json!({
                    "url": url,
                    "percent": percent,
                    "downloaded_mb": downloaded_mb,
                    "total_mb": total_mb
                }));
                last_emit_time = std::time::Instant::now();
            }
        }
        
        let trimmed = l.trim();
        if !trimmed.is_empty() {
            let trimmed_lower = trimmed.to_lowercase();
            // Capture file path strings ending with audio extensions without verifying .exists() instantly
            if (trimmed.contains(":\\") || trimmed.contains(":/") || trimmed.starts_with('/') || trimmed.contains("Aideo Downloads"))
                && (trimmed_lower.ends_with(".m4a") || trimmed_lower.ends_with(".mp3") || trimmed_lower.ends_with(".webm") || trimmed_lower.ends_with(".mp4") || trimmed_lower.ends_with(".flac")) 
            {
                final_path_str = trimmed.to_string();
            }
        }
    }

    let status = child.wait().map_err(|e| format!("Process wait failed: {}", e))?;
    if status.success() {
        // Validate and normalize the path since the process has exited completely
        let normalized_path = if !final_path_str.is_empty() {
            let p = std::path::Path::new(&final_path_str);
            if p.exists() {
                Some(final_path_str.clone())
            } else {
                let cleaned = final_path_str.replace("/", "\\").replace("\\\\", "\\");
                let cleaned_p = std::path::Path::new(&cleaned);
                if cleaned_p.exists() {
                    Some(cleaned)
                } else {
                    None
                }
            }
        } else {
            None
        };

        if let Some(valid_path) = normalized_path {
            let _ = app_handle.emit("ytdlp-download-progress", serde_json::json!({
                "url": url,
                "percent": 100.0,
                "downloaded_mb": 0.0,
                "total_mb": 0.0
            }));
            Ok(valid_path)
        } else {
            // Fallback: search music_dir for the newest file created in the last 15 seconds
            println!("[youtube] Path resolution failed. Initiating fallback directory scan...");
            if let Ok(entries) = std::fs::read_dir(music_dir) {
                let mut newest_file = None;
                let mut newest_time = std::time::SystemTime::UNIX_EPOCH;
                for entry in entries.flatten() {
                    if let Ok(meta) = entry.metadata() {
                        if meta.is_file() {
                            if let Ok(created) = meta.created() {
                                if created > newest_time {
                                    newest_time = created;
                                    newest_file = Some(entry.path());
                                }
                            }
                        }
                    }
                }
                if let Some(path) = newest_file {
                    if let Ok(elapsed) = std::time::SystemTime::now().duration_since(newest_time) {
                        if elapsed.as_secs() < 15 {
                            let path_str = path.to_string_lossy().to_string();
                            println!("[youtube] Fallback matched newest file: {}", path_str);
                            let _ = app_handle.emit("ytdlp-download-progress", serde_json::json!({
                                "url": url,
                                "percent": 100.0,
                                "downloaded_mb": 0.0,
                                "total_mb": 0.0
                            }));
                            return Ok(path_str);
                        }
                    }
                }
            }

            Err(format!(
                "yt-dlp completed successfully, but the downloaded file could not be resolved. Captured path was: '{}'",
                final_path_str
            ))
        }
    } else {
        Err("yt-dlp command exited with error status".to_string())
    }
}

use std::os::windows::process::CommandExt;
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[tauri::command]
pub async fn download_track(
    url: String,
    quality: String,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    println!("[youtube] Initiating robust invisible yt-dlp download for URL: {} at quality: {}", url, quality);
    
    // 1. Auto-Installer setup
    let data_dir = dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let aideo_data_dir = data_dir.join("Aideo");
    if !aideo_data_dir.exists() {
        std::fs::create_dir_all(&aideo_data_dir).map_err(|e| e.to_string())?;
    }
    
    let ytdlp_path = aideo_data_dir.join("yt-dlp.exe");
    
    // Download yt-dlp.exe if it doesn't exist
    if !ytdlp_path.exists() {
        println!("[youtube] yt-dlp.exe not found. Downloading latest version...");
        let response = reqwest::get("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe")
            .await.map_err(|e| format!("Failed to download yt-dlp: {}", e))?;
        let bytes = response.bytes().await.map_err(|e| e.to_string())?;
        
        let mut file = std::fs::File::create(&ytdlp_path).map_err(|e| format!("Failed to create yt-dlp.exe: {}", e))?;
        use std::io::Write;
        file.write_all(&bytes).map_err(|e| format!("Failed to write yt-dlp.exe: {}", e))?;
        println!("[youtube] Successfully downloaded yt-dlp.exe!");
    }
    
    // 2. Prepare the music output directory
    let music_dir = dirs::audio_dir()
        .unwrap_or_else(|| dirs::document_dir().unwrap_or_else(|| std::path::PathBuf::from(".")))
        .join("Aideo Downloads");
        
    std::fs::create_dir_all(&music_dir).map_err(|e| e.to_string())?;
    
    // Build the output template to write directly to "Aideo Downloads" using native path joining for absolute backslash structure
    let output_template = music_dir.join("%(title)s.%(ext)s").to_string_lossy().to_string();
    
    // Check if ffmpeg.exe exists to pass --ffmpeg-location
    let ffmpeg_path = aideo_data_dir.join("ffmpeg.exe");
    let has_ffmpeg = ffmpeg_path.exists();
    let ffmpeg_loc_str = aideo_data_dir.to_string_lossy().to_string();

    // Determine format string based on quality selection
    // Note: We prefer m4a to avoid needing ffmpeg for format conversion, ensuring smooth playback.
    // Format 141 is YouTube Music's high-fidelity 256kbps AAC stream, and Format 140 is standard 128kbps AAC.
    let format_str = match quality.as_str() {
        "high" => "141/bestaudio[ext=m4a]/bestaudio/best", // Prioritize premium 256kbps AAC YouTube Music stream
        "low" => "worstaudio[ext=m4a]/worstaudio/worst", // Lowest data usage
        _ => "141/140/bestaudio[ext=m4a]/best", // Standard high quality
    };

    println!("[youtube] Extracting audio stream (Format: {}) via invisible yt-dlp using template: {}", format_str, output_template);
    
    // Attempt 1: default client sequence without forcing client args (letting yt-dlp use its highly optimized self-updating sequence)
    let mut args_1 = vec![
        "-f".to_string(),
        format_str.to_string(),
        "--cache-dir".to_string(),
        aideo_data_dir.join("cache").to_string_lossy().to_string(),
        "--force-ipv4".to_string(),
        "--no-check-formats".to_string(),
        "--no-playlist".to_string(),
        "--no-check-certificate".to_string(),
        "--sleep-interval".to_string(),
        "0".to_string(),
        "--max-sleep-interval".to_string(),
        "0".to_string(),
        "--sleep-requests".to_string(),
        "0".to_string(),
        "--print".to_string(),
        "after_move:filepath".to_string(),
        "-o".to_string(),
        output_template.clone(),
    ];
    if has_ffmpeg {
        args_1.push("--ffmpeg-location".to_string());
        args_1.push(ffmpeg_loc_str.clone());
    }
    
    if let Ok(final_path_str) = run_ytdlp_with_progress(&ytdlp_path, &args_1, &url, &app_handle, &music_dir) {
        println!("[youtube] Download SUCCESS! Final file: {}", final_path_str);
        crate::add_track_to_library(final_path_str.clone(), state)?;
        return Ok(final_path_str);
    }

    // Attempt self-update of yt-dlp
    println!("[youtube] Initial attempt failed. Attempting to self-update yt-dlp...");
    let _ = std::process::Command::new(&ytdlp_path)
        .arg("-U")
        .creation_flags(CREATE_NO_WINDOW)
        .status();

    // Retry 1: updated yt-dlp with default adaptive arguments
    if let Ok(final_path_str) = run_ytdlp_with_progress(&ytdlp_path, &args_1, &url, &app_handle, &music_dir) {
        println!("[youtube] Retry 1 SUCCESS! Final file: {}", final_path_str);
        crate::add_track_to_library(final_path_str.clone(), state)?;
        return Ok(final_path_str);
    }

    // Retry 2: with forced PO-Token / client bypass arguments (mweb & android are less rate-limited)
    println!("[youtube] Retry 1 failed. Attempting with forced mweb,android client parameters...");
    let mut args_retry_2 = vec![
        "-f".to_string(),
        format_str.to_string(),
        "--cache-dir".to_string(),
        aideo_data_dir.join("cache").to_string_lossy().to_string(),
        "--force-ipv4".to_string(),
        "--no-check-formats".to_string(),
        "--no-playlist".to_string(),
        "--no-check-certificate".to_string(),
        "--sleep-interval".to_string(),
        "0".to_string(),
        "--max-sleep-interval".to_string(),
        "0".to_string(),
        "--sleep-requests".to_string(),
        "0".to_string(),
        "--extractor-args".to_string(),
        "youtube:player-client=mweb,android".to_string(),
        "--print".to_string(),
        "after_move:filepath".to_string(),
        "-o".to_string(),
        output_template.clone(),
    ];
    if has_ffmpeg {
        args_retry_2.push("--ffmpeg-location".to_string());
        args_retry_2.push(ffmpeg_loc_str.clone());
    }

    match run_ytdlp_with_progress(&ytdlp_path, &args_retry_2, &url, &app_handle, &music_dir) {
        Ok(final_path_str) => {
            println!("[youtube] Retry 2 SUCCESS! Final file: {}", final_path_str);
            crate::add_track_to_library(final_path_str.clone(), state)?;
            Ok(final_path_str)
        }
        Err(e) => {
            println!("[youtube] All yt-dlp attempts failed. Error: {}", e);
            Err("YouTube rate-limited or blocked this request (HTTP 429 / PO-Token). Please use the Lucida or Squid web bypass options on the track cards to download manually in 1 click!".to_string())
        }
    }
}

#[tauri::command]
pub async fn check_and_download_ytdlp(app_handle: tauri::AppHandle) -> Result<bool, String> {
    use tauri::Emitter;
    let data_dir = dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let aideo_dir = data_dir.join("Aideo");
    let ytdlp_path = aideo_dir.join("yt-dlp.exe");

    if ytdlp_path.exists() {
        return Ok(true);
    }

    println!("[dependencies] yt-dlp.exe not found. Downloading asynchronously...");
    let _ = app_handle.emit("ui-toast", serde_json::json!({
        "message": "First-time setup: Downloading high-performance audio decoder in background...",
        "type": "info"
    }));

    let response = reqwest::get("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe")
        .await
        .map_err(|e| format!("Failed to download yt-dlp: {}", e))?;

    let bytes = response.bytes().await.map_err(|e| format!("Failed to read yt-dlp bytes: {}", e))?;

    if !aideo_dir.exists() {
        std::fs::create_dir_all(&aideo_dir).map_err(|e| format!("Failed to create Aideo directory: {}", e))?;
    }

    let mut file = std::fs::File::create(&ytdlp_path).map_err(|e| format!("Failed to create yt-dlp.exe: {}", e))?;
    use std::io::Write;
    file.write_all(&bytes).map_err(|e| format!("Failed to write yt-dlp.exe: {}", e))?;

    println!("[dependencies] Successfully downloaded yt-dlp.exe!");
    let _ = app_handle.emit("ui-toast", serde_json::json!({
        "message": "Audio decoder setup complete! Ready for YouTube streaming.",
        "type": "success"
    }));

    Ok(true)
}



#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DiscoveryHubData {
    pub recommendations: Vec<YoutubeTrack>,
    pub global_charts: Vec<YoutubeTrack>,
}

#[tauri::command]
pub async fn get_personalized_discovery_hub(
    seed_artists: Vec<String>,
    top_artists: Vec<String>,
    library_artists: Vec<String>,
    discovery_level: String,
    lastfm_connected: bool,
    lastfm_top_artists: Vec<String>,
    listenbrainz_connected: bool,
    listenbrainz_recs: Vec<String>,
    state: State<'_, AppState>,
) -> Result<DiscoveryHubData, String> {
    let api_key = fetch_innertube_key().await;
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    // 1. Unified track tracking to avoid duplicates across all shelves
    let mut seen_ids = std::collections::HashSet::new();

    // A. FETCH GLOBAL CHARTS (Trending worldwide top hits)
    let mut global_charts = Vec::new();
    let mut chart_loaded = false;
    
    if lastfm_connected {
        if let Ok(lfm_chart) = crate::lastfm_api::get_global_top_tracks().await {
            let mut chart_candidates = Vec::new();
            for track_val in lfm_chart.iter().take(10) {
                let title = track_val.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let artist = track_val.get("artist").and_then(|v| v.get("name")).and_then(|v| v.as_str()).unwrap_or("");
                if !title.is_empty() && !artist.is_empty() {
                    chart_candidates.push((title.to_string(), artist.to_string()));
                }
            }
            if !chart_candidates.is_empty() {
                let mut chart_search_tasks = Vec::new();
                for (title, artist) in chart_candidates.iter().take(8) {
                    let query = format!("{} {}", artist, title);
                    let client_c = client.clone();
                    let api_key_c = api_key.clone();
                    chart_search_tasks.push(async move {
                        search_youtube_internal(&client_c, &api_key_c, &query, false).await
                    });
                }
                let chart_search_results = futures::future::join_all(chart_search_tasks).await;
                for tracks in chart_search_results.into_iter().flatten() {
                    if let Some(mut t) = tracks.into_iter().next() {
                        t.recommendation_source = Some("Global Top 50 Hits".to_string());
                        if !seen_ids.contains(&t.id) {
                            seen_ids.insert(t.id.clone());
                            global_charts.push(t);
                        }
                    }
                }
                chart_loaded = true;
            }
        }
    }
    
    if !chart_loaded {
        // Query YouTube Music directly for trending songs to ensure it is 100% dynamic and live!
        if let Ok(tracks) = search_youtube_internal(&client, &api_key, "trending songs worldwide", false).await {
            for mut t in tracks.into_iter().take(8) {
                t.recommendation_source = Some("Global Top Hits".to_string());
                if !seen_ids.contains(&t.id) {
                    seen_ids.insert(t.id.clone());
                    global_charts.push(t);
                }
            }
        }
    }

    // B. PERSONALIZED PICKS / RECOMMENDATIONS
    let mut loved_artists = Vec::new();
    {
        let conn = safe_lock(&state.db);
        if let Ok(lib_tracks) = crate::db::get_all_tracks(&conn) {
            for t in lib_tracks {
                if t.loved.unwrap_or(0) == 1 {
                    if let Some(artist) = t.artist {
                        if artist != "Unknown Artist" && artist != "YouTube Audio" && !artist.is_empty() {
                            loved_artists.push(artist);
                        }
                    }
                }
            }
        }
    }
    
    let mut unique_loved = std::collections::HashSet::new();
    let mut priority_loved_artists = Vec::new();
    for artist in loved_artists {
        if unique_loved.insert(artist.to_lowercase()) {
            priority_loved_artists.push(artist);
        }
    }

    // Query top 10 most played tracks from playback_history
    let mut top_listened_tracks = Vec::new();
    {
        let conn = safe_lock(&state.db);
        let prepared = conn.prepare(
            "SELECT title, artist, COUNT(*) as play_count 
             FROM playback_history 
             WHERE title IS NOT NULL AND artist IS NOT NULL AND title != '' AND artist != '' AND artist != 'Unknown Artist' AND artist != 'YouTube Audio'
             GROUP BY title, artist 
             ORDER BY play_count DESC 
             LIMIT 10"
        );
        if let Ok(mut stmt) = prepared {
            let track_iter = stmt.query_map([], |row| {
                let title: String = row.get(0)?;
                let artist: String = row.get(1)?;
                Ok((title, artist))
            });
            if let Ok(iter) = track_iter {
                for (title, artist) in iter.flatten() {
                    if !title.is_empty() && !artist.is_empty() {
                        top_listened_tracks.push((title, artist));
                    }
                }
            }
        } else {
            eprintln!("[youtube] Failed to prepare statement to fetch top listened tracks from playback history");
        }
    }

    let mut search_queries = Vec::new();

    if top_listened_tracks.is_empty() && seed_artists.is_empty() && priority_loved_artists.is_empty() && lastfm_top_artists.is_empty() {
        // High quality seed lists for new users to jumpstart the experience
        let new_user_seeds = vec![
            ("Taylor Swift songs", "Trending Mainstream"),
            ("The Weeknd songs", "Trending Pop"),
            ("LiSA songs", "Trending J-Pop"),
            ("Billie Eilish songs", "Trending Indie"),
            ("Daft Punk songs", "Trending Electronic"),
        ];
        for (q, src) in new_user_seeds {
            search_queries.push((q.to_string(), src.to_string()));
        }
    } else {
        // 1. Direct search queries for the top 10 played tracks so they are mixed in the tailored mix!
        for (title, artist) in top_listened_tracks.iter().take(10) {
            search_queries.push((format!("{} {}", artist, title), "Your Top Played Track".to_string()));
        }

        // 2. Last.fm Similar Tracks (collaborative recommendations) for top played tracks
        if lastfm_connected && !top_listened_tracks.is_empty() {
            // Fetch similar tracks for top 3 tracks to avoid huge load times, 3 similar tracks each
            let mut sim_track_futures = Vec::new();
            for (title, artist) in top_listened_tracks.iter().take(3) {
                sim_track_futures.push(crate::lastfm_api::get_similar_tracks(artist, title));
            }
            let sim_results = futures::future::join_all(sim_track_futures).await;
            for similar in sim_results.into_iter().flatten() {
                for track_val in similar.iter().take(3) {
                    let sim_title = track_val.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    let sim_artist = track_val.get("artist").and_then(|v| v.get("name")).and_then(|v| v.as_str()).unwrap_or("");
                    if !sim_title.is_empty() && !sim_artist.is_empty() {
                        search_queries.push((format!("{} {}", sim_artist, sim_title), "Recommended Similar Track".to_string()));
                    }
                }
            }
        }

        // 3. Favorite/seed/top artists & ListenBrainz collaborative recs
        for artist in priority_loved_artists.iter().take(2) {
            search_queries.push((format!("{} songs", artist), "Based on your Favorites".to_string()));
        }
        for artist in seed_artists.iter().take(2) {
            if !unique_loved.contains(&artist.to_lowercase()) {
                search_queries.push((format!("{} songs", artist), "YouTube Music Taste".to_string()));
            }
        }
        if lastfm_connected && !lastfm_top_artists.is_empty() {
            let mut lfm_futures = Vec::new();
            for artist in lastfm_top_artists.iter().take(2) {
                lfm_futures.push(crate::lastfm_api::get_similar_artists(artist));
            }
            let results = futures::future::join_all(lfm_futures).await;
            let mut seen_similar = std::collections::HashSet::new();
            for artists in results.into_iter().flatten() {
                for art in artists {
                    if seen_similar.insert(art.clone()) {
                        search_queries.push((format!("{} songs", art), "Last.fm Similar Taste".to_string()));
                    }
                }
            }
        }
        if listenbrainz_connected {
            for query in listenbrainz_recs.iter().take(3) {
                search_queries.push((query.clone(), "ListenBrainz Collaborative Rec".to_string()));
            }
        }
    }
    
    let mut search_tasks = Vec::new();
    for (query, source) in search_queries.iter().take(15) {
        let client_c = client.clone();
        let api_key_c = api_key.clone();
        let source_c = source.clone();
        search_tasks.push(async move {
            (search_youtube_internal(&client_c, &api_key_c, query, false).await, source_c)
        });
    }
    let search_results = futures::future::join_all(search_tasks).await;
    
    let mut cand_tracks = Vec::new();
    for (res, source) in search_results {
        if let Ok(tracks) = res {
            for mut track in tracks {
                track.recommendation_source = Some(source.clone());
                if !seen_ids.contains(&track.id) {
                    seen_ids.insert(track.id.clone());
                    cand_tracks.push(track);
                }
            }
        }
    }
    
    // Cross-reference with DB to exclude tracks already in the library
    let mut library_titles = std::collections::HashSet::new();
    {
        let conn = safe_lock(&state.db);
        if let Ok(lib_tracks) = crate::db::get_all_tracks(&conn) {
            for t in lib_tracks {
                if let Some(title) = t.title {
                    library_titles.insert(title.to_lowercase().trim().to_string());
                }
            }
        }
    }
    
    let mut filtered_pool = Vec::new();
    for track in cand_tracks {
        let clean_t = track.title.to_lowercase().trim().to_string();
        if library_titles.contains(&clean_t) {
            continue;
        }
        
        let parts: Vec<&str> = track.duration_raw.split(':').collect();
        let is_too_long = if parts.len() >= 3 {
            true
        } else if parts.len() == 2 {
            if let Ok(minutes) = parts[0].trim().parse::<u32>() {
                minutes > 15
            } else {
                false
            }
        } else {
            false
        };
        if is_too_long {
            continue;
        }
        filtered_pool.push(track);
    }
    
    let mut scored_tracks = Vec::new();
    for track in filtered_pool {
        let mut score = 1.0;
        let candidate_artist_lower = track.artist.to_lowercase();
        
        let is_loved_artist = priority_loved_artists.iter().any(|la| {
            let la_lower = la.to_lowercase();
            candidate_artist_lower.contains(&la_lower) || la_lower.contains(&candidate_artist_lower)
        });

        let is_top_artist = top_artists.iter().any(|ta| {
            let ta_lower = ta.to_lowercase();
            candidate_artist_lower.contains(&ta_lower) || ta_lower.contains(&candidate_artist_lower)
        });
        
        let is_library_artist = library_artists.iter().any(|la| {
            let la_lower = la.to_lowercase();
            candidate_artist_lower.contains(&la_lower) || la_lower.contains(&candidate_artist_lower)
        });

        if is_loved_artist {
            score += 2.0;
        }

        match discovery_level.as_str() {
            "familiarity" => {
                if is_top_artist {
                    score += 0.75;
                } else if is_library_artist {
                    score += 0.3;
                } else {
                    score -= 0.4;
                }
            }
            "discovery" => {
                if is_top_artist {
                    score -= 0.5;
                } else if is_library_artist {
                    score += 0.55;
                } else {
                    score += 0.4;
                }
            }
            _ => { // "balanced"
                if is_top_artist {
                    score += 0.25;
                }
                if is_library_artist && !is_top_artist {
                    score += 0.35;
                }
            }
        }
        scored_tracks.push((track, score));
    }
    scored_tracks.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    
    let mut final_recs = Vec::new();
    let mut artist_counts = std::collections::HashMap::new();
    for (track, score) in scored_tracks {
        if final_recs.len() >= 15 {
            break;
        }
        let cand_artist = track.artist.clone();
        let current_count = *artist_counts.get(&cand_artist).unwrap_or(&0);
        let same_artist_limit = if discovery_level == "familiarity" { 4 } else { 2 };

        if current_count < same_artist_limit {
            artist_counts.insert(cand_artist, current_count + 1);
            println!("[discovery-hub] Curated recommendation: '{}' by '{}' (Score: {:.2})", track.title, track.artist, score);
            final_recs.push(track);
        }
    }
    
    // Concurrent missing duration resolves
    let mut duration_tasks = Vec::new();
    for (i, track) in final_recs.iter().enumerate() {
        if track.duration_raw == "0:00" {
            let client_c = client.clone();
            let api_key_c = api_key.clone();
            let video_id = track.id.clone();
            duration_tasks.push(async move {
                if let Some(dur) = fetch_track_duration(&client_c, &api_key_c, &video_id).await {
                    (i, dur)
                } else {
                    (i, "0:00".to_string())
                }
            });
        }
    }
    if !duration_tasks.is_empty() {
        let results = futures::future::join_all(duration_tasks).await;
        for (i, dur) in results {
            if dur != "0:00" {
                final_recs[i].duration_raw = dur;
            }
        }
    }

    // Concurrent missing duration resolves for global_charts
    let mut chart_duration_tasks = Vec::new();
    for (i, track) in global_charts.iter().enumerate() {
        if track.duration_raw == "0:00" {
            let client_c = client.clone();
            let api_key_c = api_key.clone();
            let video_id = track.id.clone();
            chart_duration_tasks.push(async move {
                if let Some(dur) = fetch_track_duration(&client_c, &api_key_c, &video_id).await {
                    (i, dur)
                } else {
                    (i, "0:00".to_string())
                }
            });
        }
    }
    if !chart_duration_tasks.is_empty() {
        let results = futures::future::join_all(chart_duration_tasks).await;
        for (i, dur) in results {
            if dur != "0:00" {
                global_charts[i].duration_raw = dur;
            }
        }
    }

    Ok(DiscoveryHubData {
        recommendations: final_recs,
        global_charts,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_ytm_search() {
        let api_key = fetch_innertube_key().await;
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap();

        let search_url = format!("https://music.youtube.com/youtubei/v1/search?key={}&prettyPrint=false", api_key);
        let payload = serde_json::json!({
            "context": {
                "client": {
                    "clientName": "WEB_REMIX",
                    "clientVersion": "1.20240101.01.00",
                    "hl": "en",
                    "gl": "US"
                }
            },
            "query": "roar"
        });

        let res = client.post(&search_url)
            .header("Content-Type", "application/json")
            .header("Referer", "https://music.youtube.com/")
            .json(&payload)
            .send()
            .await
            .unwrap();

        let json_res: serde_json::Value = res.json().await.unwrap();
        let mut items = Vec::new();
        find_list_items(&json_res, &mut items);

        let mut matches = Vec::new();
        for item in &items {
            let title = item.get("flexColumns")
                .and_then(|cols| cols.as_array())
                .and_then(|cols| cols.first())
                .and_then(|col| col.get("musicResponsiveListItemFlexColumnRenderer"))
                .and_then(|renderer| renderer.get("text"))
                .and_then(|text| text.get("runs"))
                .and_then(|runs| runs.as_array())
                .and_then(|runs| runs.first())
                .and_then(|run| run.get("text"))
                .and_then(|t| t.as_str())
                .unwrap_or("");
            if title.eq_ignore_ascii_case("Roar") {
                matches.push(item.clone());
            }
        }
        
        let path = std::path::Path::new("c:\\Users\\Alirul\\Aideo-Music-Player\\scratch\\roar_items.json");
        std::fs::write(path, serde_json::to_string_pretty(&matches).unwrap()).unwrap();
        println!("SAVED {} MATCHES TO SCRATCH FILE", matches.len());
    }

    #[tokio::test]
    async fn test_search_youtube_integration() {
        let results = search_youtube("roar".to_string()).await.unwrap();
        println!("TOTAL PARSED TRACKS: {}", results.len());
        for (i, t) in results.iter().enumerate() {
            println!("Track {}: ID={}, Title='{}', Artist='{}', Duration='{}', Cover='{:?}'",
                i, t.id, t.title, t.artist, t.duration_raw, t.cover_url);
        }
    }
}

