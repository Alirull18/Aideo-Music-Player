use serde::{Deserialize, Serialize};
use tauri::{State, Manager};
use crate::AppState;
use crate::safe_lock;
use futures::StreamExt;

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
        // Remix/edit patterns
        regex::Regex::new(r"[\(\[][^)]*\bremix\b[^)]*[\)\]]").unwrap(),
        regex::Regex::new(r"\s+-\s+remix\b").unwrap(),
        regex::Regex::new(r"\bsped[- ]up\b").unwrap(),
        regex::Regex::new(r"\bslowed[- ](?:reverb|down|\+\s*reverb)\b").unwrap(),
        regex::Regex::new(r"\bnightcore\s+version\b").unwrap(),
        regex::Regex::new(r"\b8d\s+(?:audio|version|mix)\b").unwrap(),
        // Compilation/playlist patterns
        regex::Regex::new(r"\bbest\s+of\b").unwrap(),
        regex::Regex::new(r"\btop\s+\d+\s+songs\b").unwrap(),
        regex::Regex::new(r"\bnonstop\s+mix\b").unwrap(),
        regex::Regex::new(r"\bfull\s+playlist\b").unwrap(),
        regex::Regex::new(r"\bgreatest\s+hits\b").unwrap(),
    ];
    static ref ARTIST_REGEXES: Vec<regex::Regex> = vec![
        regex::Regex::new(r"\bcovers\b").unwrap(),
        regex::Regex::new(r"\bcover\s+nation\b").unwrap(),
        regex::Regex::new(r"\bcover\s+channel\b").unwrap(),
        regex::Regex::new(r"\bcover\s+band\b").unwrap(),
        regex::Regex::new(r"\btribute\s+band\b").unwrap(),
        regex::Regex::new(r"\bpiano\s+tribute\b").unwrap(),
        regex::Regex::new(r"\btribute\s+orchestra\b").unwrap(),
        // Compilation/playlist channel patterns
        regex::Regex::new(r"\bmusic\s+(?:hits|vibes|collection|zone)\b").unwrap(),
        regex::Regex::new(r"\bbest\s+of\b").unwrap(),
        regex::Regex::new(r"\bplaylist\b").unwrap(),
        regex::Regex::new(r"\bcompilation\b").unwrap(),
        regex::Regex::new(r"\btop\s+(?:hits|songs|tracks)\b").unwrap(),
        regex::Regex::new(r"\bremix\s+(?:channel|music|official)\b").unwrap(),
        regex::Regex::new(r"\bnightcore\b").unwrap(),
        regex::Regex::new(r"\bsped[- ]up\b").unwrap(),
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

#[derive(Serialize, Debug, Clone)]
pub struct ChartEntry {
    pub chart_id: String,
    pub rank: usize,
    pub title: String,
    pub artist: String,
    pub artwork_url: Option<String>,
    pub previous_rank: Option<usize>,
    pub weeks_on_chart: Option<usize>,
    pub listen_count: Option<u64>,
    pub recording_mbid: Option<String>,
    pub playback_track: Option<YoutubeTrack>,
}

#[derive(Serialize, Debug, Clone)]
pub struct ChartFallback {
    pub requested_source: String,
    pub actual_source: String,
    pub message: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct ChartPage {
    pub source: String,
    pub source_label: String,
    pub scope_label: String,
    pub period_label: String,
    pub updated_at: Option<String>,
    pub entries: Vec<ChartEntry>,
    pub offset: usize,
    pub limit: usize,
    pub total: Option<usize>,
    pub has_more: bool,
    pub fallback: Option<ChartFallback>,
}

#[derive(Debug, Clone)]
struct ChartCandidate {
    rank: usize,
    title: String,
    artist: String,
    artwork_url: Option<String>,
    previous_rank: Option<usize>,
    weeks_on_chart: Option<usize>,
    listen_count: Option<u64>,
    recording_mbid: Option<String>,
}

#[derive(Debug)]
struct ListenBrainzChart {
    entries: Vec<ChartCandidate>,
    range: Option<String>,
    updated_at: Option<String>,
    total: Option<usize>,
}

fn chart_value_as_usize(value: Option<&serde_json::Value>) -> Option<usize> {
    value.and_then(|value| {
        value.as_u64().map(|number| number as usize).or_else(|| {
            value.as_str().and_then(|text| text.parse::<usize>().ok())
        })
    })
}

fn chart_value_as_u64(value: Option<&serde_json::Value>) -> Option<u64> {
    value.and_then(|value| {
        value.as_u64().or_else(|| value.as_str().and_then(|text| text.parse::<u64>().ok()))
    })
}

fn chart_mbid(value: Option<&serde_json::Value>) -> Option<String> {
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

fn chart_slug(value: &str) -> String {
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

fn chart_entry_id(source: &str, candidate: &ChartCandidate) -> String {
    format!(
        "{}:{}:{}:{}",
        source,
        candidate.rank,
        chart_slug(&candidate.artist),
        chart_slug(&candidate.title)
    )
}

fn validate_chart_country(country: &str) -> Result<String, String> {
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

fn parse_billboard_candidates(
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

fn parse_listenbrainz_candidates(json: &serde_json::Value) -> ListenBrainzChart {
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
}

pub async fn invalidate_innertube_key() {
    let mut w = INNERTUBE_KEY.write().await;
    *w = None;
    println!("[youtube] InnerTube API key invalidated.");
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
            .and_then(|runs| runs.first())
            .and_then(|run| run.get("text"))
            .and_then(|t| t.as_str())
            .unwrap_or("Unknown Title")
            .to_string();

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
                "karaoke", "instrumental", "reaction", "cover", "remix", "fancam", "slowed", "nightcore", "tutorial", "lesson"
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

#[tauri::command]
pub async fn search_youtube(query: String) -> Result<Vec<YoutubeTrack>, String> {
    let api_key = fetch_innertube_key().await;
    println!("[youtube] Searching YouTube Music via InnerTube with key: {}", api_key);

    let client = crate::get_http_client();

    let query_lower = query.to_lowercase();
    let clean_query = query_lower.trim();

    let is_simple_query = !clean_query.contains("song")
        && !clean_query.contains("video")
        && !clean_query.contains("live")
        && !clean_query.contains("cover")
        && !clean_query.contains("remix")
        && !clean_query.contains("mv")
        && !clean_query.contains("m/v")
        && !clean_query.contains("official")
        && !clean_query.contains("karaoke");

    let final_query = if is_simple_query {
        format!("{} song", query)
    } else {
        query
    };

    search_youtube_internal_impl(client, &api_key, &final_query, true, false).await
}

#[tauri::command]
pub async fn get_artist_discography(artist: String) -> Result<Vec<YoutubeTrack>, String> {
    let api_key = fetch_innertube_key().await;
    let client = crate::get_http_client();
    let artist_clean = artist.trim();

    // Query 1: Official Topic Channel (Direct official studio releases & b-sides)
    let q1 = format!("{} - Topic", artist_clean);
    // Query 2: Official Audio Tracks
    let q2 = format!("{} official audio", artist_clean);
    // Query 3: Official Music / Discography
    let q3 = format!("{} official", artist_clean);

    let client_c1 = client.clone();
    let client_c2 = client.clone();
    let client_c3 = client.clone();
    let api_key_c1 = api_key.clone();
    let api_key_c2 = api_key.clone();
    let api_key_c3 = api_key.clone();

    let (res1, res2, res3) = futures::join!(
        search_youtube_internal_impl(&client_c1, &api_key_c1, &q1, true, true),
        search_youtube_internal_impl(&client_c2, &api_key_c2, &q2, true, true),
        search_youtube_internal_impl(&client_c3, &api_key_c3, &q3, true, false),
    );

    let mut combined_tracks = Vec::new();
    if let Ok(t1) = res1 { combined_tracks.extend(t1); }
    if let Ok(t2) = res2 { combined_tracks.extend(t2); }
    if let Ok(t3) = res3 { combined_tracks.extend(t3); }

    let mut seen_titles = std::collections::HashSet::new();
    let mut seen_ids = std::collections::HashSet::new();
    let mut verified_tracks = Vec::new();

    for track in combined_tracks {
        if !seen_ids.insert(track.id.clone()) {
            continue;
        }

        // Strict Artist Check: Ensure result actually belongs to the searched artist
        if !artist_matches(&track.artist, artist_clean) {
            continue;
        }

        // Strict Slop Filter: Reject reaction videos, fancams, karaoke, tutorials, etc.
        if is_third_party_or_instrumental(&track.title, &track.artist) || is_compilation_channel(&track.artist) {
            continue;
        }

        let title_key = clean_title(&track.title);
        if seen_titles.insert(title_key) {
            verified_tracks.push(track);
        }
    }

    Ok(verified_tracks)
}

#[tauri::command]
pub async fn get_search_suggestions(query: String) -> Result<Vec<String>, String> {
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
        println!("[youtube] Resolving {} missing track durations for final recommendations in batches of 4...", duration_tasks.len());
        let mut stream = futures::stream::iter(duration_tasks).buffer_unordered(4);
        while let Some((i, dur)) = stream.next().await {
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
        // Remix/edit variants
        "sped up",
        "sped-up",
        "speed up",
        "slowed reverb",
        "slowed + reverb",
        "slowed+reverb",
        "slowed down",
        "nightcore",
        "8d audio",
        // Promotional/Live/Performance show filters
        "studio choom",
        "스튜디오 춤",
        "fancam",
        "직캠",
        "dance practice",
        "choreography",
        "choreo",
        "stage mix",
        "special stage",
        "comeback stage",
        "line distribution",
        "color coded",
        "color-coded",
        "m countdown",
        "mcountdown",
        "music bank",
        "inkigayo",
        "show champion",
        "kbs kpop",
        "sbs kpop",
        "mnet",
        "m2",
        // Generic Western/Global Live & Promo filters
        "live performance",
        "live session",
        "live sessions",
        "acoustic live",
        "stripped live",
        "stripped session",
        "live at ", // e.g. "Live at Wembley"
        "tiny desk",
        "coachella",
        "glastonbury",
        "lollapalooza",
        "official teaser",
        "music video teaser",
        "official trailer",
        "behind the scenes",
        "reaction video",
        "reaction",
        "reacts",
        "reacting",
        "react to",
        "first time hearing",
        "first time listening",
        "honest review",
        "mv reaction",
        "live reaction",
        "vocal coach",
        "vocal analysis",
        "breakdown",
        "relay dance",
        "dance cover",
        "unboxing",
        "live stream",
        "livestream",
        "full concert",
        "lyric video",
        "lyrics video",
        "visualizer video",
        "tiktok compilation",
        "status video",
        "whatsapp status",
        "shorts",
        "#shorts",
        "interview",
        "vlog",
        "challenge",
        // Compilation signals in title
        "greatest hits",
        "best of",
        "nonstop mix",
        "non-stop mix",
        "full playlist",
        "top hits",
        "top songs",
        "lagu viral",
        "viral tiktok",
        "tiktok viral",
        "full album",
        "album mp3",
        "compilation",
        "mashup",
        "fanmade",
        "fan-made",
    ];

    for &kw in &title_keywords {
        if title_lower.contains(kw) {
            return true;
        }
    }

    // 2. Specific regex patterns for covers/remixes in title
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
        "nightcore",
        "sped up",
        "sped-up",
        "lirik",
        "lyrics channel",
        "lagu terbaik",
        "reaction",
        "reacts",
        "vocal coach",
        // Promotional/Live/Performance channels
        "studio choom",
        "스튜디오 춤",
        "kbs kpop",
        "sbs kpop",
        "m countdown",
        "mnet",
        "m2",
        "line distribution",
        "fancam",
        // Generic Western/Global Curators & Promoters
        "npr music",
        "vevo control",
        "vevo lift",
        "vevo session",
        "vevo sessions",
        "live sessions",
        "music sessions",
        "studio sessions",
        "curator",
        "promotion",
        "promotions",
        "promo",
        "network",
        "lyrics channel",
        "lyric channel",
        "7clouds",
        "cloudkid",
        "proximity",
        "trap nation",
        "chill nation",
        "house nation",
        "bass nation",
        "rap nation",
        "indie nation",
        "syrebralvibes",
        "taj tracks",
        "music blog",
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

/// Returns true if the artist/channel name looks like a third-party playlist
/// or compilation channel rather than an actual music artist.
pub fn is_compilation_channel(artist: &str) -> bool {
    let a = artist.to_lowercase();
    // Known junk channel patterns
    let patterns = [
        "playlist", "compilation", "best of", "top hits", "top songs",
        "music hits", "hit music", "music collection", "music zone",
        "music vibes", "viral hits", "trending music", "nonstop", "non-stop",
        "lagu terbaik", "lagu viral", "koleksi lagu", "full album",
        "greatest hits", "official lyric", "lyric video", "lyrics channel",
        "remix official", "remix channel",
        // Curators/Blogs
        "curator", "promotion", "promotions", "music blog", "lyric channel",
        "7clouds", "cloudkid", "proximity", "trap nation", "chill nation",
        "house nation", "bass nation", "rap nation", "indie nation",
        "syrebralvibes", "taj tracks",
    ];
    for &pat in &patterns {
        if a.contains(pat) {
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

/// Normalizes artist name by stripping noise like brackets, topic suffixes, VEVO, and special characters.
pub fn normalize_artist_name(name: &str) -> String {
    let mut s = name.to_lowercase();
    if let Ok(re) = regex::Regex::new(r"[\(\[][^\)\]]+[\)\]]") {
        s = re.replace_all(&s, "").into_owned();
    }
    s = s.replace("- topic", "")
        .replace(" - topic", "")
        .replace("official", "")
        .replace("vevo", "")
        .replace("records", "")
        .replace("entertainment", "");
    s.chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Checks if a candidate artist matches an expected target artist (handling official channels, transliterations, and acronyms).
pub fn artist_matches(candidate: &str, expected: &str) -> bool {
    let cand_norm = normalize_artist_name(candidate);
    let exp_norm = normalize_artist_name(expected);

    if cand_norm.is_empty() || exp_norm.is_empty() {
        return false;
    }
    if cand_norm == exp_norm || cand_norm.contains(&exp_norm) || exp_norm.contains(&cand_norm) {
        return true;
    }
    // Token overlap comparison
    let exp_tokens: Vec<&str> = exp_norm.split_whitespace().filter(|w| w.len() >= 2).collect();
    let cand_tokens: Vec<&str> = cand_norm.split_whitespace().filter(|w| w.len() >= 2).collect();
    if !exp_tokens.is_empty() {
        let matches = exp_tokens.iter().any(|et| cand_tokens.contains(et));
        if matches {
            return true;
        }
    }
    false
}

struct AutoplayTasteProfile<'a> {
    top_artists: &'a [String],
    library_artists: &'a [String],
    discovery_level: &'a str,
    recently_played: &'a std::collections::HashSet<String>,
    artist_skip_stats: &'a std::collections::HashMap<String, (i64, i64)>,
    loved_tokens: &'a std::collections::HashMap<String, u32>,
}

fn score_autoplay_candidate(profile: &AutoplayTasteProfile, title: &str, artist: &str) -> f64 {
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

struct DiscoveryTasteProfile<'a> {
    loved_artists: &'a [String],
    top_artists: &'a [String],
    library_artists: &'a [String],
    discovery_level: &'a str,
    artist_skip_stats: &'a std::collections::HashMap<String, (i64, i64)>,
}

fn score_discovery_candidate(profile: &DiscoveryTasteProfile, base_score: f64, artist: &str) -> f64 {
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

#[tauri::command]
pub async fn get_youtube_autoplay_recommendations(
    video_id: String,
    artist: String,
    title: String,
    top_artists: Vec<String>,
    library_artists: Vec<String>,
    discovery_level: String,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<YoutubeTrack>, String> {
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
            "videoId": resolved_video_id
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
                        recommendation_source: None,
                    });
                }
            }
        }
    }

    // --- CANDIDATE GENERATION SOURCE 2: Hybrid Collaborative Loved Seeds & Current Track (Last.fm) ---
    // Only query loved streams that share some context (same artist or matching text tokens) with the current song
    // to prevent unrelated genres/languages from hijacking the radio.
    let extra_seeds: Vec<(String, String)> = {
        let mut seeds = Vec::new();
        let conn = crate::safe_lock(&state.db);

        // Step 1: Look for loved streams by the exact same artist
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

        // Step 2: If we need more seeds, look for loved streams sharing name tokens
        if seeds.len() < 2 {
            let mut words: Vec<String> = artist.split_whitespace()
                .chain(title.split_whitespace())
                .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase())
                .filter(|w| w.len() > 3 && w != "feat" && w != "featuring" && w != "live" && w != "remix" && w != "version" && w != "official" && w != "audio" && w != "video")
                .collect();

            words.sort();
            words.dedup();

            for word in words {
                if seeds.len() >= 2 {
                    break;
                }
                let search_pattern = format!("%{}%", word);
                if let Ok(mut stmt) = conn.prepare(
                    "SELECT title, artist FROM tracks
                     WHERE loved = 1
                       AND (LOWER(title) LIKE ?1 OR LOWER(artist) LIKE ?1)
                       AND (path LIKE 'http%' OR format IN ('YouTube Direct', 'Tidal FLAC', 'SUBSONIC', 'JELLYFIN'))
                     ORDER BY RANDOM() LIMIT 2"
                ) {
                    if let Ok(mut rows) = stmt.query(rusqlite::params![search_pattern]) {
                        while let Some(row) = rows.next().unwrap_or(None) {
                            if seeds.len() >= 2 {
                                break;
                            }
                            if let (Ok(t_title), Ok(t_artist)) = (row.get::<_, String>(0), row.get::<_, String>(1)) {
                                if !seeds.iter().any(|(st, sa)| st == &t_title && sa == &t_artist) {
                                    seeds.push((t_title, t_artist));
                                }
                            }
                        }
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

    // Seed 2 & 3: Random loved streams
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
    let mut seen_titles = std::collections::HashSet::new();

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

        // 5. De-duplicate clean titles inside the recommended list itself
        if seen_titles.contains(&clean_cand) {
            continue;
        }
        seen_titles.insert(clean_cand);

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

    for track in filtered_tracks {
        let score = score_autoplay_candidate(&taste_profile, &track.title, &track.artist);
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

async fn add_downloaded_track_to_library(
    path: String,
    title: Option<String>,
    artist: Option<String>,
    cover_url: Option<String>,
    state: &State<'_, AppState>,
) -> Result<(), String> {
    // 1. Download cover art if provided
    if let Some(ref url) = cover_url {
        if !url.is_empty() {
            let path_obj = std::path::Path::new(&path);
            if let Some(parent) = path_obj.parent() {
                if let Some(stem) = path_obj.file_stem() {
                    let ext = if url.contains(".png") { "png" } else { "jpg" };
                    let img_path = parent.join(format!("{}.{}", stem.to_string_lossy(), ext));
                    println!("[youtube] Attempting to download cover art to: {:?}", img_path);

                    let client = crate::get_http_client();
                    match client.get(url).send().await {
                        Ok(res) => {
                            match res.bytes().await {
                                Ok(bytes) => {
                                    if let Err(e) = std::fs::write(&img_path, bytes) {
                                        eprintln!("[youtube] Failed to write downloaded cover art to {:?}: {}", img_path, e);
                                    } else {
                                        println!("[youtube] Successfully cached cover art locally.");
                                    }
                                }
                                Err(e) => {
                                    eprintln!("[youtube] Failed to read cover art bytes from URL: {}", e);
                                }
                            }
                        }
                        Err(e) => {
                            eprintln!("[youtube] Failed to fetch cover art from URL: {}", e);
                        }
                    }
                }
            }
        }
    }

    // 2. Extract metadata or fallback
    let mut track = match crate::scanner::extract_metadata(std::path::Path::new(&path)) {
        Some(t) => t,
        None => {
            let fallback_title = std::path::Path::new(&path)
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();

            crate::db::Track {
                id: 0,
                path: path.clone(),
                title: Some(fallback_title),
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

    // 3. Override extracted metadata with provided metadata if they are present
    if let Some(t) = title {
        if !t.is_empty() {
            track.title = Some(t);
        }
    }
    if let Some(a) = artist {
        if !a.is_empty() {
            track.artist = Some(a);
        }
    }
    if let Some(c) = cover_url {
        if !c.is_empty() {
            track.cover_url = Some(c);
        }
    }

    // 4. Save track to library DB
    let mut conn = crate::safe_lock(&state.db);
    crate::db::save_tracks(&mut conn, &mut [track]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn download_track(
    url: String,
    quality: String,
    title: Option<String>,
    artist: Option<String>,
    cover_url: Option<String>,
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
        if !response.status().is_success() {
            return Err(format!("Failed to download yt-dlp: HTTP status {}", response.status()));
        }
        let bytes = response.bytes().await.map_err(|e| e.to_string())?;
        if bytes.len() < 1_000_000 {
            return Err("Downloaded yt-dlp.exe is invalid or too small.".to_string());
        }

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

    let ytdlp_path_c = ytdlp_path.clone();
    let args_1_c = args_1.clone();
    let url_c = url.clone();
    let app_handle_c = app_handle.clone();
    let music_dir_c = music_dir.clone();

    let run_res = tokio::task::spawn_blocking(move || {
        run_ytdlp_with_progress(&ytdlp_path_c, &args_1_c, &url_c, &app_handle_c, &music_dir_c)
    }).await.map_err(|e| format!("yt-dlp task panicked: {}", e))?;

    if let Ok(final_path_str) = run_res {
        println!("[youtube] Download SUCCESS! Final file: {}", final_path_str);
        add_downloaded_track_to_library(final_path_str.clone(), title.clone(), artist.clone(), cover_url.clone(), &state).await?;
        return Ok(final_path_str);
    }

    // Attempt self-update of yt-dlp
    println!("[youtube] Initial attempt failed. Attempting to self-update yt-dlp...");
    let ytdlp_path_c = ytdlp_path.clone();
    let _ = tokio::task::spawn_blocking(move || {
        std::process::Command::new(&ytdlp_path_c)
            .arg("-U")
            .creation_flags(CREATE_NO_WINDOW)
            .status()
    }).await;

    // Retry 1: updated yt-dlp with default adaptive arguments
    let ytdlp_path_c = ytdlp_path.clone();
    let args_1_c = args_1.clone();
    let url_c = url.clone();
    let app_handle_c = app_handle.clone();
    let music_dir_c = music_dir.clone();

    let run_res = tokio::task::spawn_blocking(move || {
        run_ytdlp_with_progress(&ytdlp_path_c, &args_1_c, &url_c, &app_handle_c, &music_dir_c)
    }).await.map_err(|e| format!("yt-dlp task panicked: {}", e))?;

    if let Ok(final_path_str) = run_res {
        println!("[youtube] Retry 1 SUCCESS! Final file: {}", final_path_str);
        add_downloaded_track_to_library(final_path_str.clone(), title.clone(), artist.clone(), cover_url.clone(), &state).await?;
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

    let ytdlp_path_c = ytdlp_path.clone();
    let args_retry_2_c = args_retry_2.clone();
    let url_c = url.clone();
    let app_handle_c = app_handle.clone();
    let music_dir_c = music_dir.clone();

    let run_res = tokio::task::spawn_blocking(move || {
        run_ytdlp_with_progress(&ytdlp_path_c, &args_retry_2_c, &url_c, &app_handle_c, &music_dir_c)
    }).await.map_err(|e| format!("yt-dlp task panicked: {}", e))?;

    match run_res {
        Ok(final_path_str) => {
            println!("[youtube] Retry 2 SUCCESS! Final file: {}", final_path_str);
            add_downloaded_track_to_library(final_path_str.clone(), title.clone(), artist.clone(), cover_url.clone(), &state).await?;
            Ok(final_path_str)
        }
        Err(e) => {
            println!("[youtube] All yt-dlp attempts failed. Error: {}", e);
            Err("YouTube rate-limited or blocked this request (HTTP 429 / PO-Token). Please use the Lucida or Squid web bypass options on the track cards to download manually in 1 click!".to_string())
        }
    }
}

fn deserialize_artist_flexible<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;
    let val: Option<serde_json::Value> = Option::deserialize(deserializer)?;
    match val {
        Some(serde_json::Value::String(s)) => Ok(if s.trim().is_empty() { None } else { Some(s.trim().to_string()) }),
        Some(serde_json::Value::Object(obj)) => {
            if let Some(name) = obj.get("name").and_then(|n| n.as_str()) {
                Ok(if name.trim().is_empty() { None } else { Some(name.trim().to_string()) })
            } else {
                Ok(None)
            }
        }
        _ => Ok(None),
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct BatchDownloadItem {
    #[serde(default, alias = "url", alias = "stream_url", alias = "path")]
    pub url: Option<String>,
    #[serde(default, alias = "title", alias = "name", alias = "track")]
    pub title: Option<String>,
    #[serde(default, alias = "artist", alias = "artist_name", deserialize_with = "deserialize_artist_flexible")]
    pub artist: Option<String>,
    #[serde(default, alias = "album", alias = "album_title")]
    pub album: Option<String>,
    #[serde(default, alias = "cover_url", alias = "coverUrl")]
    pub cover_url: Option<String>,
    #[serde(default, alias = "track_number", alias = "trackNumber")]
    pub track_number: Option<u32>,
    #[serde(default, alias = "duration_raw", alias = "durationRaw")]
    pub duration_raw: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BatchDownloadProgress {
    pub completed: usize,
    pub total: usize,
    pub current_title: String,
    pub percent: f64,
    pub is_done: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn download_playlist_batch(
    items: serde_json::Value,
    quality: Option<String>,
    playlist_name: Option<String>,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<usize, String> {
    use tauri::Emitter;
    use base64::Engine;

    let parsed_items: Vec<BatchDownloadItem> = if let Ok(list) = serde_json::from_value::<Vec<BatchDownloadItem>>(items.clone()) {
        list
    } else if let serde_json::Value::Array(arr) = &items {
        arr.iter().map(|val| {
            if let Ok(item) = serde_json::from_value::<BatchDownloadItem>(val.clone()) {
                item
            } else if let serde_json::Value::String(s) = val {
                BatchDownloadItem {
                    url: Some(s.clone()),
                    title: Some(s.clone()),
                    ..Default::default()
                }
            } else {
                Default::default()
            }
        }).collect()
    } else if let serde_json::Value::String(s) = &items {
        if let Ok(list) = serde_json::from_str::<Vec<BatchDownloadItem>>(s) {
            list
        } else {
            vec![BatchDownloadItem { url: Some(s.clone()), title: Some(s.clone()), ..Default::default() }]
        }
    } else {
        Vec::new()
    };

    let total = parsed_items.len();
    if total == 0 {
        return Ok(0);
    }

    println!("[youtube] Starting batch download of {} items for playlist: {:?}", total, playlist_name);

    let quality_str = quality.unwrap_or_else(|| "high".to_string());
    let mut successful_count = 0;

    for (index, item) in parsed_items.into_iter().enumerate() {
        let title_str = item.title.unwrap_or_else(|| "Untitled Track".to_string());
        let artist_str = item.artist.unwrap_or_else(|| "Unknown Artist".to_string());

        let progress = BatchDownloadProgress {
            completed: index,
            total,
            current_title: title_str.clone(),
            percent: (index as f64 / total as f64) * 100.0,
            is_done: false,
            error: None,
        };
        let _ = app_handle.emit("download_batch_progress", &progress);

        // Resolve clean direct URL & cover if not already direct
        let raw_url = item.url.unwrap_or_default().trim().to_string();
        let mut download_url = raw_url.clone();
        let mut final_cover_url = item.cover_url.clone();

        if !download_url.starts_with("http://") && !download_url.starts_with("https://") {
            let query = format!("{} - {}", artist_str, title_str);
            if let Ok(search_res) = search_youtube(query).await {
                if let Some(best) = search_res.into_iter().next() {
                    download_url = best.url;
                    if final_cover_url.is_none() || final_cover_url.as_deref() == Some("") {
                        final_cover_url = best.cover_url;
                    }
                }
            }
        }

        let dl_res = download_track(
            download_url,
            quality_str.clone(),
            Some(title_str.clone()),
            Some(artist_str.clone()),
            final_cover_url.clone(),
            state.clone(),
            app_handle.clone(),
        ).await;

        match dl_res {
            Ok(saved_path) => {
                successful_count += 1;
                let mut update = crate::tag_editor::AudioTagUpdate {
                    title: Some(title_str.clone()),
                    artist: Some(artist_str.clone()),
                    album: item.album.clone(),
                    track_number: item.track_number,
                    ..Default::default()
                };

                if let Some(ref c_url) = final_cover_url {
                    if c_url.starts_with("http://") || c_url.starts_with("https://") {
                        if let Ok(resp) = reqwest::get(c_url).await {
                            if let Ok(bytes) = resp.bytes().await {
                                let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                                update.cover_base64 = Some(b64);
                            }
                        }
                    }
                }

                let _ = crate::tag_editor::write_tags(&saved_path, &update);

                // Re-sync updated tags with library database
                let _ = add_downloaded_track_to_library(
                    saved_path,
                    Some(title_str.clone()),
                    Some(artist_str.clone()),
                    final_cover_url.clone(),
                    &state,
                ).await;
            }
            Err(e) => {
                eprintln!("[youtube] Batch download error for '{}': {}", title_str, e);
                let err_progress = BatchDownloadProgress {
                    completed: index,
                    total,
                    current_title: title_str.clone(),
                    percent: (index as f64 / total as f64) * 100.0,
                    is_done: false,
                    error: Some(format!("Could not download '{}': {}", title_str, e)),
                };
                let _ = app_handle.emit("download_batch_progress", &err_progress);
            }
        }
    }

    let final_progress = BatchDownloadProgress {
        completed: total,
        total,
        current_title: "Completed".to_string(),
        percent: 100.0,
        is_done: true,
        error: None,
    };
    let _ = app_handle.emit("download_batch_progress", &final_progress);

    Ok(successful_count)
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
pub struct YoutubeMix {
    pub id: String,
    pub title: String,
    pub description: String,
    pub cover_url: Option<String>,
    pub tracks: Vec<YoutubeTrack>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DiscoveryHubData {
    pub recommendations: Vec<YoutubeTrack>,
    pub global_charts: Vec<YoutubeTrack>,
    pub mixed_for_you: Vec<YoutubeMix>,
    #[serde(default)]
    pub recently_played: Vec<YoutubeTrack>,
    #[serde(default)]
    pub heavy_rotation: Vec<YoutubeTrack>,
    #[serde(default)]
    pub forgotten_gems: Vec<YoutubeTrack>,
    #[serde(default)]
    pub playlist_mixes: Vec<YoutubeMix>,
}

/// Capitalises the first character of a string slice (used for genre labels).
fn capitalize_first(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        None => String::new(),
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
    }
}

fn interleave_tracks(online: Vec<YoutubeTrack>, local: Vec<YoutubeTrack>, limit: usize) -> Vec<YoutubeTrack> {
    let mut interleaved = Vec::new();
    let mut online_iter = online.into_iter();
    let mut local_iter = local.into_iter();

    while interleaved.len() < limit {
        match (local_iter.next(), online_iter.next()) {
            (Some(l), Some(o)) => {
                interleaved.push(l);
                if interleaved.len() < limit {
                    interleaved.push(o);
                }
            }
            (Some(l), None) => {
                interleaved.push(l);
            }
            (None, Some(o)) => {
                interleaved.push(o);
            }
            (None, None) => {
                break;
            }
        }
    }
    interleaved
}

/// Normalized identity key for a track, aligned with the library-signature
/// format used by the discovery hub (normalize_artist_name + clean_title).
fn yt_track_signature(t: &YoutubeTrack) -> String {
    format!("{}::{}", normalize_artist_name(&t.artist), clean_title(&t.title))
}

/// Drops online tracks whose artist+title signature already exists in the
/// local library, so blended shelves never show the same song twice.
fn dedupe_online_against_library(
    online: Vec<YoutubeTrack>,
    library_signatures: &std::collections::HashSet<String>,
) -> Vec<YoutubeTrack> {
    if library_signatures.is_empty() {
        return online;
    }
    online
        .into_iter()
        .filter(|t| !library_signatures.contains(&yt_track_signature(t)))
        .collect()
}

/// Blends online tracks into an ordered local shelf without an obvious
/// local/online/local/online cadence: each online track is inserted at a
/// random position, preserving the relative order of the local list.
fn blend_shelf_naturally(
    local: Vec<YoutubeTrack>,
    online: Vec<YoutubeTrack>,
    cap: usize,
) -> Vec<YoutubeTrack> {
    use rand::Rng;
    let mut rng = rand::rng();

    let mut blended: Vec<YoutubeTrack> = local;
    for track in online {
        if blended.len() >= cap {
            break;
        }
        let insert_at = rng.random_range(0..=blended.len());
        blended.insert(insert_at, track);
    }
    blended.truncate(cap);
    blended
}

/// Splits leftover non-library history entries between the Heavy Rotation and
/// Forgotten Gems shelves without reusing any entry in both pools.
fn split_unmatched_for_shelves(
    pairs: Vec<(String, String)>,
    rotation_cap: usize,
    gems_cap: usize,
) -> (Vec<(String, String)>, Vec<(String, String)>) {
    let mut rotation = Vec::new();
    let mut gems = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for pair in pairs {
        let key = format!("{}::{}", pair.1.to_lowercase(), pair.0.to_lowercase());
        if !seen.insert(key) {
            continue;
        }
        if rotation.len() < rotation_cap {
            rotation.push(pair);
        } else if gems.len() < gems_cap {
            gems.push(pair);
        } else {
            break;
        }
    }
    (rotation, gems)
}

/// Resolves non-library listening-history (title, artist) pairs to playable
/// YouTube tracks, one concurrent search per pair, keeping only clean hits.
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
                    !is_third_party_or_instrumental(&t.title, &t.artist)
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
) -> (
    Vec<YoutubeTrack>,
    Vec<YoutubeTrack>,
    Vec<YoutubeTrack>,
    Vec<YoutubeMix>,
    Vec<(String, String)>,
    Vec<(String, String)>,
) {
    use rand::seq::SliceRandom;
    let mut rng = rand::rng();

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

        YoutubeTrack {
            id: format!("local_{}", t.id),
            title: t.title.clone().unwrap_or_else(|| "Unknown Title".to_string()),
            artist: t.artist.clone().unwrap_or_else(|| "Unknown Artist".to_string()),
            cover_url: t.cover_url.clone(),
            duration_raw,
            url: t.path.clone(),
            recommendation_source: Some(source.to_string()),
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
                    let yt_tracks: Vec<YoutubeTrack> = tracks.iter().map(|t| map_local(t, &p.name)).collect();
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

fn generate_local_mixes(
    conn: &rusqlite::Connection,
    seed_artists: &[String],
    top_artists: &[String],
) -> Vec<YoutubeMix> {
    use rand::seq::SliceRandom;
    let mut rng = rand::rng();

    let lib_tracks = crate::db::get_all_tracks(conn).unwrap_or_default();
    if lib_tracks.is_empty() {
        return Vec::new();
    }

    // History stats per track: (play_count, skip_count, last_played_timestamp)
    let mut track_history: std::collections::HashMap<String, (i64, i64, i64)> = std::collections::HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT track_path, COUNT(*), COALESCE(SUM(skipped), 0), COALESCE(MAX(timestamp), 0) FROM playback_history GROUP BY track_path") {
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
    if let Ok(mut stmt) = conn.prepare("SELECT artist, COUNT(*), COALESCE(SUM(skipped), 0) FROM playback_history WHERE artist IS NOT NULL AND artist != '' AND artist != 'Unknown Artist' GROUP BY artist") {
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

        YoutubeTrack {
            id: format!("local_{}", track.id),
            title: track.title.clone().unwrap_or_else(|| "Unknown Title".to_string()),
            artist: track.artist.clone().unwrap_or_else(|| "Unknown Artist".to_string()),
            cover_url: track.cover_url.clone(),
            duration_raw,
            url: track.path.clone(),
            recommendation_source: Some(source.to_string()),
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
    let mut recent_repeats = lib_tracks.clone();
    recent_repeats.sort_by(|a, b| {
        let (cnt_a, skip_a, ts_a) = track_history.get(&a.path).cloned().unwrap_or((0, 0, 0));
        let (cnt_b, skip_b, ts_b) = track_history.get(&b.path).cloned().unwrap_or((0, 0, 0));
        let recency_bonus_a = if ts_a >= thirty_days_ago { 5 } else { 0 };
        let recency_bonus_b = if ts_b >= thirty_days_ago { 5 } else { 0 };
        let score_a = (cnt_a - skip_a) * 2 + recency_bonus_a;
        let score_b = (cnt_b - skip_b) * 2 + recency_bonus_b;
        score_b.cmp(&score_a)
    });

    let mut on_repeat_candidates: Vec<crate::db::Track> = recent_repeats.into_iter()
        .take(25)
        .collect();

    if on_repeat_candidates.is_empty() {
        on_repeat_candidates = lib_tracks.iter().take(20).cloned().collect();
    }

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

        YoutubeTrack {
            id: format!("local_{}", track.id),
            title: track.title.clone().unwrap_or_else(|| "Unknown Title".to_string()),
            artist: track.artist.clone().unwrap_or_else(|| "Unknown Artist".to_string()),
            cover_url: track.cover_url.clone(),
            duration_raw,
            url: track.path.clone(),
            recommendation_source: Some("Offline Library".to_string()),
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

    let q4 = if !artist_1.is_empty() {
        format!("{} latest trending hits official audio", artist_1)
    } else if !top_genre.is_empty() {
        format!("{} top trending hits official audio", top_genre)
    } else {
        "top trending hits official audio".to_string()
    };

    let queries = vec![
        (q1, "supermix"),
        (q2, "spotlight"),
        (q3, "forgotten"),
        (q4, "on_repeat"),
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

    let mut rng = rand::rng();
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
                    "slowed", "reverb", "nightcore", "10 hours", "10 hrs", "loop", "cover", "remix", "karaoke", "instrumental"
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
            "on_repeat" => {
                let mut top_played = lib_tracks.to_vec();
                top_played.sort_by(|a, b| {
                    let count_a = play_counts.get(&a.path).unwrap_or(&0);
                    let count_b = play_counts.get(&b.path).unwrap_or(&0);
                    count_b.cmp(count_a)
                });
                for t in top_played.iter().take(20) {
                    local_matches.push(map_local_to_youtube_track(t));
                }
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
                    format!("A deep dive into {}'s greatest songs, hits, and deep cuts.", artist_1)
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

    Ok(mixes)
}

fn is_valid_chart_artwork_url(url: &str) -> bool {
    let trimmed = url.trim();
    !trimmed.is_empty()
        && !trimmed.contains("2a96cbd8b46e442fc41c2b86b821562f")
        && (trimmed.starts_with("http://") || trimmed.starts_with("https://"))
}

fn lastfm_artwork(track: &serde_json::Value) -> Option<String> {
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

#[tauri::command]
pub async fn get_worldwide_leaderboard(
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

fn map_local_to_youtube_track(track: &crate::db::Track, source: &str) -> YoutubeTrack {
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

    YoutubeTrack {
        id: format!("local_{}", track.id),
        title: track.title.clone().unwrap_or_else(|| "Unknown Title".to_string()),
        artist: track.artist.clone().unwrap_or_else(|| "Unknown Artist".to_string()),
        cover_url: track.cover_url.clone(),
        duration_raw,
        url: track.path.clone(),
        recommendation_source: Some(source.to_string()),
    }
}

fn generate_local_discovery_fallback(
    lib_tracks: &[crate::db::Track],
    play_counts: &std::collections::HashMap<String, i64>,
) -> (Vec<YoutubeTrack>, Vec<YoutubeTrack>) {
    use rand::seq::SliceRandom;
    let mut recs = Vec::new();
    let mut seen_local = std::collections::HashSet::new();

    for t in lib_tracks {
        if t.loved.unwrap_or(0) == 1 {
            seen_local.insert(t.path.clone());
            recs.push(map_local_to_youtube_track(t, "Loved Local Track"));
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

    let mut rng = rand::rng();
    let mut rest_tracks: Vec<_> = lib_tracks.iter().filter(|t| !seen_local.contains(&t.path)).collect();
    rest_tracks.shuffle(&mut rng);
    for t in rest_tracks.into_iter().take(30) {
        recs.push(map_local_to_youtube_track(t, "Library Discovery"));
    }

    let mut charts = Vec::new();
    for t in sorted_tracks.iter().take(15) {
        charts.push(map_local_to_youtube_track(t, "Local Top Hits"));
    }

    (recs, charts)
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
    app_mode: String,
    is_online: bool,
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<DiscoveryHubData, String> {
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
             WHERE genre IS NOT NULL AND genre != '' AND genre != 'Unknown'
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
        let tracks = crate::db::get_all_tracks(&conn).unwrap_or_default();
        let mut sigs = std::collections::HashSet::new();
        for t in &tracks {
            if let (Some(ref title), Some(ref artist)) = (&t.title, &t.artist) {
                let sig = format!("{}::{}", normalize_artist_name(artist), clean_title(title));
                sigs.insert(sig);
            }
        }

        // C. Play counts
        let mut p_counts = std::collections::HashMap::new();
        if let Ok(mut stmt) = conn.prepare("SELECT track_path, COUNT(*) FROM playback_history GROUP BY track_path") {
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
             WHERE title IS NOT NULL AND artist IS NOT NULL AND title != '' AND artist != '' AND artist != 'Unknown Artist' AND artist != 'YouTube Audio' AND skipped = 0
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
             WHERE title IS NOT NULL AND artist IS NOT NULL AND title != '' AND artist != '' AND artist != 'Unknown Artist' AND artist != 'YouTube Audio'
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
        let (recs, charts) = generate_local_discovery_fallback(&lib_tracks, &play_counts);
        let (mixed_for_you, recently_played, heavy_rotation, forgotten_gems, playlist_mixes) = {
            let conn = safe_lock(&state.db);
            let mixes = generate_local_mixes(&conn, &seed_artists, &top_artists);
            let (rec_p, heavy_r, forgot_g, p_mixes, unmatched_r, unmatched_t) =
                extract_library_shelves(&conn, &lib_tracks, &play_counts, &recently_played_tracks, &top_listened_tracks);
            let _ = (unmatched_r, unmatched_t); // Offline: no network to resolve online counterparts
            (mixes, rec_p, heavy_r, forgot_g, p_mixes)
        };
        return Ok(DiscoveryHubData {
            recommendations: recs,
            global_charts: charts,
            mixed_for_you,
            recently_played,
            heavy_rotation,
            forgotten_gems,
            playlist_mixes,
        });
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
    let charts_task = tokio::spawn(async move {
        let chart_page = rand::rng().random_range(1u32..=3u32);
        let genre_pool = ["pop", "hip-hop", "indie", "k-pop", "r&b", "rock", "electronic", "latin", "soul", "alternative", "dance"];
        let mut genre_indices: Vec<usize> = (0..genre_pool.len()).collect();
        genre_indices.shuffle(&mut rand::rng());
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

        chart_candidates.shuffle(&mut rand::rng());

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
                        if !is_third_party_or_instrumental(&t.title, &t.artist) && !is_compilation_channel(&t.artist) && seen_ids.insert(t.id.clone()) {
                            t.recommendation_source = Some(source.clone());
                            global_charts.push(t);
                        }
                    }
                }
            }
        } else {
            let fallback_queries = ["trending songs worldwide 2024", "viral hits global", "top pop songs right now"];
            let pick = rand::rng().random_range(0..fallback_queries.len());
            if let Ok(tracks) = search_youtube_internal(&client_charts, &api_key_charts, fallback_queries[pick], false).await {
                for mut t in tracks.into_iter().take(12) {
                    if !is_third_party_or_instrumental(&t.title, &t.artist) && !is_compilation_channel(&t.artist) && seen_ids.insert(t.id.clone()) {
                        t.recommendation_source = Some("Global Top Hits".to_string());
                        global_charts.push(t);
                    }
                }
            }
        }
        global_charts
    });

    // ── TASK 2: PERSONALIZED RECOMMENDATIONS (Parallel) ──────────────────────
    let client_recs = client.clone();
    let api_key_recs = api_key.clone();
    let priority_artists_c = priority_loved_artists.clone();
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

    let recs_task = tokio::spawn(async move {
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
            track_seeds.shuffle(&mut rand::rng());

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
                    sim_copy.shuffle(&mut rand::rng());
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
            artist_seeds.shuffle(&mut rand::rng());
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
                    arts_copy.shuffle(&mut rand::rng());
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
                    tr_copy.shuffle(&mut rand::rng());
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

        // 3. Deep cuts from favorite artists
        if !priority_artists_c.is_empty() {
            let mut fav_artists = priority_artists_c.clone();
            fav_artists.shuffle(&mut rand::rng());
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
                    tr_copy.shuffle(&mut rand::rng());
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
                tag_copy.shuffle(&mut rand::rng());
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
            lb_copy.shuffle(&mut rand::rng());
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
        candidate_targets.shuffle(&mut rand::rng());

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
                    if !artist_matches(&track.artist, &target.target_artist) {
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
                    let has_unofficial = ["lyrics", "lyric", "가사", "color coded", "color-coded", "translation", "sub", "subbed", "fancam", "live in", "live at", "tour", "compilation", "playlist", "nonstop", "non-stop"]
                        .iter().any(|&kw| title_lower.contains(kw));
                    if has_unofficial {
                        continue;
                    }
                    track.recommendation_source = Some(target.source_label.clone());
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
            loved_artists: &priority_artists_c,
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
    });

    // ── TASK 3: MIXES (Parallel) ──────────────────────────────────────────────
    let client_mixes = client.clone();
    let api_key_mixes = api_key.clone();
    let seed_artists_mix = seed_artists.clone();
    let top_artists_mix = top_artists.clone();
    let top_genre_mix = top_genre.clone();
    let lib_tracks_mix = lib_tracks.clone();
    let play_counts_mix = play_counts.clone();

    let mixes_task = tokio::spawn(async move {
        match generate_hybrid_mixes(&client_mixes, &api_key_mixes, &seed_artists_mix, &top_artists_mix, &top_genre_mix, &lib_tracks_mix, &play_counts_mix).await {
            Ok(mixes) if !mixes.is_empty() => mixes,
            _ => Vec::new()
        }
    });

    // ── JOIN ALL CONCURRENT TASKS ─────────────────────────────────────────────
    let (charts_res, recs_res, mixes_res) = tokio::join!(charts_task, recs_task, mixes_task);

    let mut global_charts = charts_res.unwrap_or_default();
    let mut recommendations = recs_res.unwrap_or_default();
    let mut mixed_for_you = mixes_res.unwrap_or_default();

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
        extract_library_shelves(&conn, &lib_tracks, &play_counts, &recently_played_tracks, &top_listened_tracks)
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

        (
            blend_shelf_naturally(
                recently_played,
                dedupe_online_against_library(tag_source(resolved_recent, "Recently Played"), &library_signatures),
                20,
            ),
            blend_shelf_naturally(
                heavy_rotation,
                dedupe_online_against_library(tag_source(resolved_rotation, "Heavy Rotation"), &library_signatures),
                20,
            ),
            blend_shelf_naturally(
                forgotten_gems,
                dedupe_online_against_library(tag_source(resolved_gems, "Time Capsule"), &library_signatures),
                20,
            ),
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
}

#[tauri::command]
pub fn get_cached_discovery_hub(app_handle: tauri::AppHandle) -> Result<Option<DiscoveryHubData>, String> {
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

pub fn is_duration_too_long(duration_raw: &str) -> bool {
    let parts: Vec<&str> = duration_raw.split(':').collect();
    if parts.len() >= 3 {
        if let (Ok(hours), Ok(minutes)) = (parts[0].trim().parse::<u32>(), parts[1].trim().parse::<u32>()) {
            hours > 0 || minutes > 15
        } else {
            false
        }
    } else if parts.len() == 2 {
        if let Ok(minutes) = parts[0].trim().parse::<u32>() {
            minutes > 15
        } else {
            false
        }
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chart_country_validation_rejects_non_country_scopes() {
        assert_eq!(validate_chart_country("Malaysia").unwrap(), "Malaysia");
        assert!(validate_chart_country("Asia").is_err());
        assert!(validate_chart_country("North America").is_err());
        assert!(validate_chart_country("<script>").is_err());
    }

    #[test]
    fn lastfm_artwork_rejects_placeholder_hash_and_accepts_real_url() {
        let placeholder_track = serde_json::json!({
            "name": "Song",
            "image": [
                { "#text": "https://lastfm-img.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png", "size": "extralarge" }
            ]
        });
        assert_eq!(lastfm_artwork(&placeholder_track), None);

        let real_track = serde_json::json!({
            "name": "Song",
            "image": [
                { "#text": "https://lastfm-img.freetls.fastly.net/i/u/300x300/e5774f0568f39e0465059a095646316f.png", "size": "extralarge" }
            ]
        });
        assert_eq!(
            lastfm_artwork(&real_track),
            Some("https://lastfm-img.freetls.fastly.net/i/u/300x300/e5774f0568f39e0465059a095646316f.png".to_string())
        );
    }

    #[test]
    fn billboard_parser_preserves_published_ranks() {
        let json = serde_json::json!({
            "date": "2026-08-29",
            "data": [
                { "song": "First", "artist": "Artist A", "this_week": 1, "last_week": 2, "weeks_on_chart": 8 },
                { "song": "Second", "artist": "Artist B", "last_week": null, "weeks_on_chart": 1 }
            ]
        });

        let (entries, date) = parse_billboard_candidates(&json, 0, 10);
        assert_eq!(date.as_deref(), Some("2026-08-29"));
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].rank, 1);
        assert_eq!(entries[0].previous_rank, Some(2));
        assert_eq!(entries[0].weeks_on_chart, Some(8));
        assert_eq!(entries[1].rank, 2);
    }

    #[test]
    fn listenbrainz_parser_uses_offset_and_listen_counts() {
        let json = serde_json::json!({
            "payload": {
                "count": 1,
                "offset": 20,
                "range": "month",
                "last_updated": 1_788_134_400,
                "total_recording_count": 1234,
                "recordings": [{
                    "track_name": "Open Song",
                    "artist_name": "Open Artist",
                    "listen_count": 98765,
                    "recording_mbid": "7c66c8a8-2f15-4f23-b5c6-8b7c680a4d73",
                    "caa_release_mbid": "1ef5d2d3-feca-4c32-81c6-0c2897ebed13"
                }]
            }
        });

        let parsed = parse_listenbrainz_candidates(&json);
        assert_eq!(parsed.entries[0].rank, 21);
        assert_eq!(parsed.entries[0].listen_count, Some(98765));
        assert_eq!(parsed.entries[0].artwork_url.as_deref(), Some("https://coverartarchive.org/release/1ef5d2d3-feca-4c32-81c6-0c2897ebed13/front-250"));
        assert_eq!(parsed.total, Some(1234));
        assert_eq!(parsed.range.as_deref(), Some("month"));
    }

    #[tokio::test]
    async fn test_ytm_search() {
        if let Ok(results) = search_youtube("heavy serenade".to_string()).await {
            let has_nmixx_heavy_serenade = results.iter().any(|t| {
                t.title.to_lowercase() == "heavy serenade" && t.artist.to_lowercase().contains("nmixx")
            });

            assert!(
                has_nmixx_heavy_serenade,
                "Should find NMIXX's 'Heavy Serenade' track in the search results using fallback general search"
            );
        }
    }

    #[tokio::test]
    async fn test_search_youtube_integration() {
        if let Ok(results) = search_youtube("heavy serenade".to_string()).await {
            println!("TOTAL PARSED TRACKS: {}", results.len());
            for (i, t) in results.iter().enumerate() {
                println!("Track {}: ID={}, Title='{}', Artist='{}', Duration='{}', Cover='{:?}'",
                    i, t.id, t.title, t.artist, t.duration_raw, t.cover_url);
            }
        }
    }

    #[test]
    fn test_capitalize_first() {
        assert_eq!(capitalize_first(""), "");
        assert_eq!(capitalize_first("a"), "A");
        assert_eq!(capitalize_first("A"), "A");
        assert_eq!(capitalize_first("hello"), "Hello");
        assert_eq!(capitalize_first("hELLO"), "HELLO");
        assert_eq!(capitalize_first("chill focus"), "Chill focus");
        assert_eq!(capitalize_first("ünder"), "Ünder");
    }

    #[test]
    fn test_interleave_tracks() {
        let create_track = |id: &str| YoutubeTrack {
            id: id.to_string(),
            title: format!("Title {}", id),
            artist: format!("Artist {}", id),
            cover_url: None,
            duration_raw: "3:00".to_string(),
            url: format!("url_{}", id),
            recommendation_source: None,
        };

        let online = vec![create_track("o1"), create_track("o2"), create_track("o3")];
        let local = vec![create_track("l1"), create_track("l2")];

        // limit 4 -> l1, o1, l2, o2
        let res = interleave_tracks(online.clone(), local.clone(), 4);
        assert_eq!(res.len(), 4);
        assert_eq!(res[0].id, "l1");
        assert_eq!(res[1].id, "o1");
        assert_eq!(res[2].id, "l2");
        assert_eq!(res[3].id, "o2");

        // limit 5 -> l1, o1, l2, o2, o3 (local runs out, online fills the rest)
        let res2 = interleave_tracks(online.clone(), local.clone(), 5);
        assert_eq!(res2.len(), 5);
        assert_eq!(res2[4].id, "o3");

        // limit 10 -> truncates at actual total length (5)
        let res3 = interleave_tracks(online, local, 10);
        assert_eq!(res3.len(), 5);
    }

    #[test]
    fn test_normalize_artist_name() {
        assert_eq!(normalize_artist_name("IVE - Topic"), "ive");
        assert_eq!(normalize_artist_name("IVE (아이브)"), "ive");
        assert_eq!(normalize_artist_name("Taylor Swift Official"), "taylor swift");
        assert_eq!(normalize_artist_name("The Weeknd VEVO"), "the weeknd");
    }

    #[test]
    fn test_artist_matches() {
        assert!(artist_matches("IVE - Topic", "IVE"));
        assert!(artist_matches("IVE (아이브)", "IVE"));
        assert!(artist_matches("aespa - Topic", "aespa"));
        assert!(artist_matches("LE SSERAFIM", "LE SSERAFIM"));
        assert!(artist_matches("Taylor Swift", "Taylor Swift"));

        // Negative matches (must reject unrelated artists)
        assert!(!artist_matches("Chris Stapleton", "IVE"));
        assert!(!artist_matches("Wilco", "IVE"));
        assert!(!artist_matches("Fetty Wap", "IVE"));
        assert!(!artist_matches("Drake", "Taylor Swift"));
    }

    #[test]
    fn test_duration_filtering() {
        // 3-part short duration: <= 15 mins -> not too long
        assert!(!is_duration_too_long("00:00:05"));
        assert!(!is_duration_too_long("00:03:45"));
        assert!(!is_duration_too_long("00:14:59"));
        assert!(!is_duration_too_long("00:15:00"));
        assert!(!is_duration_too_long("00:15:01"));

        // 3-part over 15 mins -> too long
        assert!(is_duration_too_long("00:18:00"));

        // 3-part 1 hour+ -> too long
        assert!(is_duration_too_long("01:00:00"));
        assert!(is_duration_too_long("01:02:00"));

        // 2-part normal: <= 15 mins -> not too long
        assert!(!is_duration_too_long("04:15"));
        assert!(!is_duration_too_long("15:00"));
        assert!(!is_duration_too_long("15:01"));

        // 2-part long: > 15 mins -> too long
        assert!(is_duration_too_long("16:00"));
        assert!(is_duration_too_long("16:30"));

        // Malformed / invalid inputs -> false (safe non-panicking fallback)
        assert!(!is_duration_too_long("invalid:time"));
        assert!(!is_duration_too_long(""));
        assert!(!is_duration_too_long("invalid:time:format"));
    }

    #[test]
    fn test_clean_title_and_similarity() {
        assert_eq!(clean_title("Blinding Lights (Official Video)"), "blinding lights");
        assert_eq!(clean_title("Stay feat. Justin Bieber"), "stay");
        assert_eq!(clean_title("Save Your Tears [Live]"), "save your tears");

        // High similarity for same song title variants
        let sim1 = fuzzy_title_similarity("Blinding Lights", "Blinding Lights (Official Audio)");
        assert!(sim1 > 0.80);

        // Different songs with same title should not be dropped without artist match
        assert_eq!(clean_title("Hello"), "hello");
        assert!(!artist_matches("Adele", "Lionel Richie"));
    }

    #[test]
    fn test_semantic_noise_and_third_party_filtering() {
        assert!(is_semantic_noise("Song (Karaoke Version)", "Song"));
        assert!(is_semantic_noise("Song - Instrumental", "Song"));
        assert!(!is_semantic_noise("Song (Official Audio)", "Song"));

        assert!(is_third_party_or_instrumental("Top 50 Hits Compilation 2024", "Unknown"));
        assert!(is_third_party_or_instrumental("Best Chill Songs 2023", "Chill Nation"));
        assert!(!is_third_party_or_instrumental("Blinding Lights", "The Weeknd"));
    }

    #[test]
    fn test_discovery_hub_data_serialization_and_shelves() {
        let sample_track = YoutubeTrack {
            id: "local_101".to_string(),
            title: "Midnight City".to_string(),
            artist: "M83".to_string(),
            cover_url: Some("https://example.com/m83.jpg".to_string()),
            duration_raw: "4:03".to_string(),
            url: "C:/Music/M83/Midnight City.flac".to_string(),
            recommendation_source: Some("Recently Played".to_string()),
        };

        let sample_mix = YoutubeMix {
            id: "local_mix_energy".to_string(),
            title: "High Energy Flow (Local)".to_string(),
            description: "High tempo workout beats".to_string(),
            cover_url: None,
            tracks: vec![sample_track.clone()],
        };

        let hub_data = DiscoveryHubData {
            recommendations: vec![sample_track.clone()],
            global_charts: vec![sample_track.clone()],
            mixed_for_you: vec![sample_mix.clone()],
            recently_played: vec![sample_track.clone()],
            heavy_rotation: vec![sample_track.clone()],
            forgotten_gems: vec![sample_track.clone()],
            playlist_mixes: vec![sample_mix.clone()],
        };

        let json = serde_json::to_string(&hub_data).expect("Failed to serialize DiscoveryHubData");
        assert!(json.contains("recently_played"));
        assert!(json.contains("heavy_rotation"));
        assert!(json.contains("forgotten_gems"));
        assert!(json.contains("playlist_mixes"));

        let deserialized: DiscoveryHubData = serde_json::from_str(&json).expect("Failed to deserialize DiscoveryHubData");
        assert_eq!(deserialized.recommendations.len(), 1);
        assert_eq!(deserialized.mixed_for_you.len(), 1);
        assert_eq!(deserialized.recently_played.len(), 1);
        assert_eq!(deserialized.heavy_rotation.len(), 1);
        assert_eq!(deserialized.forgotten_gems.len(), 1);
        assert_eq!(deserialized.playlist_mixes.len(), 1);
    }

    fn shelf_track(id: &str, title: &str, artist: &str, source: &str) -> YoutubeTrack {
        YoutubeTrack {
            id: id.to_string(),
            title: title.to_string(),
            artist: artist.to_string(),
            cover_url: None,
            duration_raw: "3:30".to_string(),
            url: format!("https://youtu.be/{}", id),
            recommendation_source: Some(source.to_string()),
        }
    }

    #[test]
    fn test_dedupe_online_against_library_drops_local_matches() {
        let mut library_signatures = std::collections::HashSet::new();
        library_signatures.insert(format!(
            "{}::{}",
            normalize_artist_name("Kavinsky"),
            clean_title("Nightcall")
        ));

        let online = vec![
            shelf_track("yt1", "Nightcall", "Kavinsky", "Recently Played"),
            shelf_track("yt2", "Outrun", "Kavinsky", "Recently Played"),
        ];

        let kept = dedupe_online_against_library(online, &library_signatures);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].id, "yt2");
    }

    #[test]
    fn test_dedupe_online_against_library_handles_empty_inputs() {
        let signatures = std::collections::HashSet::new();
        assert!(dedupe_online_against_library(Vec::new(), &signatures).is_empty());

        let online = vec![shelf_track("yt1", "Solo", "Artist", "Heavy Rotation")];
        assert_eq!(dedupe_online_against_library(online.clone(), &signatures).len(), 1);

        let mut full = std::collections::HashSet::new();
        full.insert(format!("{}::{}", normalize_artist_name("artist"), clean_title("solo")));
        assert!(dedupe_online_against_library(online, &full).is_empty());
    }

    #[test]
    fn test_blend_shelf_naturally_preserves_local_order_and_caps() {
        let local: Vec<YoutubeTrack> = (0..8)
            .map(|i| shelf_track(&format!("l{}", i), &format!("Local {}", i), "A", "Heavy Rotation"))
            .collect();
        let online: Vec<YoutubeTrack> = (0..4)
            .map(|i| shelf_track(&format!("o{}", i), &format!("Online {}", i), "B", "Heavy Rotation"))
            .collect();

        let blended = blend_shelf_naturally(local.clone(), online, 20);

        assert_eq!(blended.len(), 12);

        // Local relative order must survive the blend
        let local_positions: Vec<usize> = blended
            .iter()
            .enumerate()
            .filter(|(_, t)| t.id.starts_with('l'))
            .map(|(i, _)| i)
            .collect();
        let mut sorted = local_positions.clone();
        sorted.sort_unstable();
        assert_eq!(local_positions, sorted, "local order must be preserved");

        // All online tracks must be present
        for i in 0..4 {
            assert!(blended.iter().any(|t| t.id == format!("o{}", i)));
        }
    }

    #[test]
    fn test_blend_shelf_naturally_respects_cap_and_empty_sides() {
        let local: Vec<YoutubeTrack> = (0..6)
            .map(|i| shelf_track(&format!("l{}", i), &format!("Local {}", i), "A", "Recently Played"))
            .collect();
        let online: Vec<YoutubeTrack> = (0..10)
            .map(|i| shelf_track(&format!("o{}", i), &format!("Online {}", i), "B", "Recently Played"))
            .collect();

        let blended = blend_shelf_naturally(local, online, 12);
        assert!(blended.len() <= 12);

        // Empty online side: passthrough
        let locals_only = vec![shelf_track("l0", "Only", "A", "Time Capsule")];
        assert_eq!(blend_shelf_naturally(locals_only.clone(), Vec::new(), 20).len(), 1);

        // Empty local side: online fills
        let filled = blend_shelf_naturally(Vec::new(), vec![shelf_track("o0", "Web", "B", "Time Capsule")], 20);
        assert_eq!(filled.len(), 1);
        assert_eq!(filled[0].id, "o0");
    }

    #[test]
    fn test_split_unmatched_for_shelves_splits_without_reuse() {
        let pairs: Vec<(String, String)> = (0..5)
            .map(|i| (format!("Song {}", i), format!("Artist {}", i)))
            .collect();

        let (rotation, gems) = split_unmatched_for_shelves(pairs, 3, 4);

        assert_eq!(rotation.len(), 3);
        assert_eq!(gems.len(), 2);
        // No track may appear in both pools
        for (t, a) in &rotation {
            assert!(!gems.iter().any(|(gt, ga)| gt == t && ga == a));
        }
    }

    fn autoplay_profile<'a>(
        top: &'a [String],
        library: &'a [String],
        level: &'a str,
        recent: &'a std::collections::HashSet<String>,
        skips: &'a std::collections::HashMap<String, (i64, i64)>,
        tokens: &'a std::collections::HashMap<String, u32>,
    ) -> AutoplayTasteProfile<'a> {
        AutoplayTasteProfile {
            top_artists: top,
            library_artists: library,
            discovery_level: level,
            recently_played: recent,
            artist_skip_stats: skips,
            loved_tokens: tokens,
        }
    }

    #[test]
    fn test_autoplay_discovery_level_spread_widened() {
        let top = vec!["Drake".to_string()];
        let library = vec!["Radiohead".to_string()];
        let empty: std::collections::HashSet<String> = Default::default();
        let empty_skips: std::collections::HashMap<String, (i64, i64)> = Default::default();
        let empty_tokens: std::collections::HashMap<String, u32> = Default::default();

        // Unknown artist: familiarity must demote below base, discovery must promote above it
        let p_fam = autoplay_profile(&top, &library, "familiarity", &empty, &empty_skips, &empty_tokens);
        let p_disc = autoplay_profile(&top, &library, "discovery", &empty, &empty_skips, &empty_tokens);
        let fam_unknown = score_autoplay_candidate(&p_fam, "Some Song", "Totally New Band");
        let disc_unknown = score_autoplay_candidate(&p_disc, "Some Song", "Totally New Band");
        assert!((fam_unknown - 0.4).abs() < 1e-9);   // 1.0 - 0.6
        assert!((disc_unknown - 1.55).abs() < 1e-9); // 1.0 + 0.55

        // Top artist: discovery must push below a neutral unknown's floor
        let disc_top = score_autoplay_candidate(&p_disc, "Some Song", "Drake");
        assert!(disc_top < 0.4, "top artist in discovery mode ({}) must sink below unknown in familiarity mode", disc_top);
    }

    #[test]
    fn test_autoplay_recently_played_penalty_outweighs_max_token_boost() {
        let top: Vec<String> = Vec::new();
        let library: Vec<String> = Vec::new();
        let mut recent = std::collections::HashSet::new();
        recent.insert("taylor swift - love story".to_string());
        let empty_skips: std::collections::HashMap<String, (i64, i64)> = Default::default();
        let mut tokens = std::collections::HashMap::new();
        tokens.insert("love".to_string(), 50u32);
        tokens.insert("story".to_string(), 50u32);

        let p = autoplay_profile(&top, &library, "balanced", &recent, &empty_skips, &tokens);

        // Recently played track whose title maxes out the loved-token boost:
        // clean_title strips "(Taylor's Version)", so the penalty must apply.
        let replayed_hit = score_autoplay_candidate(&p, "Love Story (Taylor's Version)", "Taylor Swift");
        assert!((replayed_hit - 0.7).abs() < 1e-9); // 1.0 - 0.5 + 0.20 capped

        // A never-played candidate with zero token overlap must outrank it
        let fresh = score_autoplay_candidate(&p, "Brand New Song", "Unknown Artist");
        assert!(fresh > replayed_hit);
    }

    #[test]
    fn test_autoplay_skip_penalty_outweighs_max_token_boost() {
        let top: Vec<String> = Vec::new();
        let library: Vec<String> = Vec::new();
        let empty: std::collections::HashSet<String> = Default::default();
        let mut skips = std::collections::HashMap::new();
        skips.insert("bad artist".to_string(), (10i64, 10i64)); // skipped every time
        let mut tokens = std::collections::HashMap::new();
        tokens.insert("love".to_string(), 99u32);

        let p = autoplay_profile(&top, &library, "balanced", &empty, &skips, &tokens);

        let boosted = score_autoplay_candidate(&p, "love love love", "Nice Artist");
        assert!((boosted - 1.20).abs() < 1e-9, "token boost must cap at +0.20, got {}", boosted);

        let penalized = score_autoplay_candidate(&p, "love love love", "Bad Artist");
        assert!(penalized < boosted && penalized < 0.6, "always-skipped artist must lose to any healthy candidate, got {}", penalized);
    }

    #[test]
    fn test_discovery_hub_unknown_can_outrank_high_base_source_in_discovery_mode() {
        let top = vec!["Famous".to_string()];
        let empty_skips: std::collections::HashMap<String, (i64, i64)> = Default::default();
        let profile = DiscoveryTasteProfile {
            loved_artists: &[],
            top_artists: &top,
            library_artists: &[],
            discovery_level: "discovery",
            artist_skip_stats: &empty_skips,
        };

        // Genre-tag find (base 1.8, unknown artist) vs Last.fm similar-to-seed
        // (base 3.5) pointing back at a familiar top artist.
        let unknown_pick = score_discovery_candidate(&profile, 1.8, "Brand New Band");
        let familiar_repeat = score_discovery_candidate(&profile, 3.5, "Famous");
        assert!(unknown_pick > familiar_repeat,
            "discovery mode must promote unknown candidates over high-source familiar ones ({} vs {})", unknown_pick, familiar_repeat);
    }

    #[test]
    fn test_discovery_hub_familiarity_mode_inverts_the_order() {
        let top = vec!["Famous".to_string()];
        let empty_skips: std::collections::HashMap<String, (i64, i64)> = Default::default();
        let profile = DiscoveryTasteProfile {
            loved_artists: &[],
            top_artists: &top,
            library_artists: &[],
            discovery_level: "familiarity",
            artist_skip_stats: &empty_skips,
        };

        let unknown_pick = score_discovery_candidate(&profile, 1.8, "Brand New Band");
        let familiar_repeat = score_discovery_candidate(&profile, 3.5, "Famous");
        assert!(familiar_repeat > unknown_pick,
            "familiarity mode must strongly favor known artists ({} vs {})", familiar_repeat, unknown_pick);
    }

    #[test]
    fn test_discovery_hub_loved_artist_and_skip_stats_apply() {
        let loved = vec!["Beloved".to_string()];
        let mut skips = std::collections::HashMap::new();
        skips.insert("skipped one".to_string(), (4i64, 4i64));
        let profile = DiscoveryTasteProfile {
            loved_artists: &loved,
            top_artists: &[],
            library_artists: &[],
            discovery_level: "balanced",
            artist_skip_stats: &skips,
        };

        let loved_boost = score_discovery_candidate(&profile, 2.0, "Beloved");
        assert!((loved_boost - 3.5).abs() < 1e-9); // 2.0 + 1.5

        let skip_hit = score_discovery_candidate(&profile, 3.0, "Skipped One");
        assert!((skip_hit - (3.0 - 0.80)).abs() < 1e-9); // ratio 1.0 -> -0.80
    }

    #[test]
    fn test_generate_local_mixes_returns_four_curated_places() {
        let conn = crate::db::init_db(":memory:").expect("In-memory SQLite database should initialize");
        conn.execute(
            "INSERT INTO tracks (path, title, artist, album, duration, format, loved) VALUES
            ('C:/1.mp3', 'Hymn for the Weekend', 'Coldplay', 'A Head Full of Dreams', 260.0, 'MP3', 1),
            ('C:/2.mp3', 'Viva La Vida', 'Coldplay', 'Viva la Vida', 242.0, 'MP3', 1),
            ('C:/3.mp3', 'Fix You', 'Coldplay', 'X&Y', 295.0, 'MP3', 0),
            ('C:/4.mp3', 'Starboy', 'The Weeknd', 'Starboy', 230.0, 'MP3', 1),
            ('C:/5.mp3', 'Blinding Lights', 'The Weeknd', 'After Hours', 200.0, 'MP3', 0),
            ('C:/6.mp3', 'Yellow', 'Coldplay', 'Parachutes', 269.0, 'MP3', 0)",
            [],
        )
        .unwrap();

        let now_ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let sixty_days_ago = now_ts.saturating_sub(60 * 86400);

        conn.execute(
            "INSERT INTO playback_history (track_path, title, artist, album, duration, format, timestamp, duration_played, skipped)
             VALUES ('C:/4.mp3', 'Starboy', 'The Weeknd', 'Starboy', 230.0, 'MP3', ?1, 230.0, 0)",
            rusqlite::params![now_ts],
        ).unwrap();
        conn.execute(
            "INSERT INTO playback_history (track_path, title, artist, album, duration, format, timestamp, duration_played, skipped)
             VALUES ('C:/4.mp3', 'Starboy', 'The Weeknd', 'Starboy', 230.0, 'MP3', ?1, 230.0, 0)",
            rusqlite::params![now_ts],
        ).unwrap();

        conn.execute(
            "INSERT INTO playback_history (track_path, title, artist, album, duration, format, timestamp, duration_played, skipped)
             VALUES ('C:/3.mp3', 'Fix You', 'Coldplay', 'X&Y', 295.0, 'MP3', ?1, 295.0, 0)",
            rusqlite::params![sixty_days_ago],
        ).unwrap();

        let seed_artists = vec!["Coldplay".to_string()];
        let top_artists = vec!["Coldplay".to_string()];

        let mixes = generate_local_mixes(&conn, &seed_artists, &top_artists);

        assert_eq!(mixes.len(), 4, "Expected exactly 4 mixes in local mode");

        let mix_ids: Vec<String> = mixes.iter().map(|m| m.id.clone()).collect();
        assert_eq!(mix_ids, vec![
            "local_mix_supermix",
            "local_mix_spotlight",
            "local_mix_forgotten",
            "local_mix_on_repeat",
        ]);

        assert_eq!(mixes[0].title, "My Supermix");
        assert!(mixes[1].title.contains("Coldplay Spotlight"));
        assert_eq!(mixes[2].title, "Forgotten Favorites");
        assert_eq!(mixes[3].title, "On Repeat");

        for m in &mixes {
            assert!(!m.tracks.is_empty(), "Mix {} should not be empty", m.id);
        }
    }
}
