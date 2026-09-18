use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use lazy_static::lazy_static;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CanvasResult {
    pub url: String,
    pub fallback_url: Option<String>,
    pub source: String,       // "local" | "tidal" | "apple"
    pub format: String,       // "mp4" | "hls"
    pub is_local: bool,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
}

lazy_static! {
    static ref CANVAS_CACHE: Mutex<HashMap<String, Option<CanvasResult>>> = Mutex::new(HashMap::new());
    static ref APPLE_TOKEN_CACHE: Mutex<Option<(String, u64)>> = Mutex::new(None);
}

const MAX_CACHE_SIZE: usize = 120;

/// Cleans strings for heuristic matching, removing parentheticals like `(feat. ...)`, `[remastered]`, punctuation, etc.
pub fn normalize_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut depth = 0;
    for c in s.chars() {
        if c == '(' || c == '[' {
            depth += 1;
        } else if (c == ')' || c == ']') && depth > 0 {
            depth -= 1;
        } else if depth == 0 {
            out.push(c);
        }
    }
    out.to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Checks if a local video file exists in the same directory as the track.
pub fn check_local_canvas(track_path: &str) -> Option<CanvasResult> {
    let p = Path::new(track_path);
    if !p.exists() || !p.is_file() {
        return None;
    }
    let parent = p.parent()?;
    let stem = p.file_stem()?.to_string_lossy();

    let candidates = [
        format!("{}.mp4", stem),
        format!("{}.webm", stem),
        "canvas.mp4".to_string(),
        "canvas.webm".to_string(),
        "cover.mp4".to_string(),
        "cover.webm".to_string(),
        "artwork.mp4".to_string(),
        "artwork.webm".to_string(),
        "backdrop.mp4".to_string(),
        "backdrop.webm".to_string(),
    ];

    for candidate in &candidates {
        let cand_path = parent.join(candidate);
        if cand_path.is_file() {
            let path_str = cand_path.to_string_lossy().to_string();
            let ext = cand_path.extension().and_then(|e| e.to_str()).unwrap_or("mp4").to_lowercase();
            return Some(CanvasResult {
                url: path_str,
                fallback_url: None,
                source: "local".to_string(),
                format: ext,
                is_local: true,
                title: None,
                artist: None,
                album: None,
            });
        }
    }
    None
}

/// Converts a 5-part dash-separated Tidal videoCover ID into a CDN URL.
pub fn format_tidal_cover_url(id: &str) -> Option<String> {
    let parts: Vec<&str> = id.split('-').collect();
    if parts.len() != 5 {
        return None;
    }
    Some(format!(
        "https://resources.tidal.com/videos/{}/1280x1280.mp4",
        parts.join("/")
    ))
}

/// Searches Tidal's public embed API for track motion artwork.
pub async fn search_tidal_canvas(
    client: &reqwest::Client,
    title: &str,
    artist: &str,
    album: Option<&str>,
) -> Option<CanvasResult> {
    let query = if let Some(alb) = album {
        if !alb.is_empty() {
            format!("{} {} {}", alb, artist, title)
        } else {
            format!("{} {}", artist, title)
        }
    } else {
        format!("{} {}", artist, title)
    };

    let url = format!(
        "https://api.tidal.com/v1/search?query={}&limit=10&types=TRACKS,ALBUMS&countryCode=US",
        urlencoding::encode(&query)
    );

    let resp = client
        .get(&url)
        .header("X-Tidal-Token", "vNVdglQOjFJJGG2U")
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    let json: serde_json::Value = resp.json().await.ok()?;
    let norm_title = normalize_string(title);
    let norm_artist = normalize_string(artist);

    // 1. Check topHit first (Tidal often populates videoCover in topHit even when omitted from tracks array)
    if let Some(top_hit) = json.get("topHit") {
        if let Some(val) = top_hit.get("value") {
            let hit_type = top_hit.get("type").and_then(|t| t.as_str()).unwrap_or("");
            if hit_type == "TRACKS" {
                if let Some(album_obj) = val.get("album") {
                    if let Some(video_cover) = album_obj.get("videoCover").and_then(|vc| vc.as_str()) {
                        if let Some(video_url) = format_tidal_cover_url(video_cover) {
                            return Some(CanvasResult {
                                url: video_url,
                                fallback_url: None,
                                source: "tidal".to_string(),
                                format: "mp4".to_string(),
                                is_local: false,
                                title: val.get("title").and_then(|t| t.as_str()).map(|s| s.to_string()),
                                artist: Some(artist.to_string()),
                                album: album_obj.get("title").and_then(|t| t.as_str()).map(|s| s.to_string()),
                            });
                        }
                    }
                }
            } else if hit_type == "ALBUMS" {
                if let Some(video_cover) = val.get("videoCover").and_then(|vc| vc.as_str()) {
                    if let Some(video_url) = format_tidal_cover_url(video_cover) {
                        return Some(CanvasResult {
                            url: video_url,
                            fallback_url: None,
                            source: "tidal".to_string(),
                            format: "mp4".to_string(),
                            is_local: false,
                            title: Some(title.to_string()),
                            artist: Some(artist.to_string()),
                            album: val.get("title").and_then(|t| t.as_str()).map(|s| s.to_string()),
                        });
                    }
                }
            }
        }
    }

    // 2. Iterate tracks items
    if let Some(items) = json.get("tracks").and_then(|t| t.get("items")).and_then(|i| i.as_array()) {
        for item in items {
            let item_title = match item.get("title").and_then(|t| t.as_str()) {
                Some(t) => t,
                None => continue,
            };
            let norm_item_title = normalize_string(item_title);

            let artists = match item.get("artists").and_then(|a| a.as_array()) {
                Some(a) => a,
                None => continue,
            };
            let mut artist_match = false;
            let mut artist_names = Vec::new();

            for art in artists {
                if let Some(name) = art.get("name").and_then(|n| n.as_str()) {
                    let norm_name = normalize_string(name);
                    if norm_artist.contains(&norm_name) || norm_name.contains(&norm_artist) {
                        artist_match = true;
                    }
                    artist_names.push(name.to_string());
                }
            }

            if !artist_match && !norm_artist.is_empty() {
                continue;
            }

            if norm_item_title != norm_title
                && !norm_title.contains(&norm_item_title)
                && !norm_item_title.contains(&norm_title)
            {
                continue;
            }

            if let Some(album_obj) = item.get("album") {
                if let Some(video_cover) = album_obj.get("videoCover").and_then(|vc| vc.as_str()) {
                    if let Some(video_url) = format_tidal_cover_url(video_cover) {
                        return Some(CanvasResult {
                            url: video_url,
                            fallback_url: None,
                            source: "tidal".to_string(),
                            format: "mp4".to_string(),
                            is_local: false,
                            title: Some(item_title.to_string()),
                            artist: Some(artist_names.join(", ")),
                            album: album_obj.get("title").and_then(|t| t.as_str()).map(|s| s.to_string()),
                        });
                    }
                }
            }
        }
    }

    // 3. Fallback: check albums items
    if let Some(albums) = json.get("albums").and_then(|a| a.get("items")).and_then(|i| i.as_array()) {
        for alb in albums {
            if let Some(video_cover) = alb.get("videoCover").and_then(|vc| vc.as_str()) {
                if let Some(video_url) = format_tidal_cover_url(video_cover) {
                    return Some(CanvasResult {
                        url: video_url,
                        fallback_url: None,
                        source: "tidal".to_string(),
                        format: "mp4".to_string(),
                        is_local: false,
                        title: Some(title.to_string()),
                        artist: Some(artist.to_string()),
                        album: alb.get("title").and_then(|t| t.as_str()).map(|s| s.to_string()),
                    });
                }
            }
        }
    }

    None
}

/// Helper to get or scrape an anonymous Apple Music web catalog token.
async fn get_apple_token(client: &reqwest::Client) -> Option<String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    {
        let cache = APPLE_TOKEN_CACHE.lock().ok()?;
        if let Some((token, expires_at)) = &*cache {
            if now + 120 < *expires_at {
                return Some(token.clone());
            }
        }
    }

    let browse_url = "https://music.apple.com/us/browse";
    let html = client.get(browse_url).send().await.ok()?.text().await.ok()?;

    let script_regex = regex::Regex::new(r#"/assets/index(?:-legacy)?[~-][A-Za-z0-9_-]+\.js"#).ok()?;
    let script_path = script_regex.find(&html)?.as_str();
    let full_script_url = format!("https://music.apple.com{}", script_path);

    let script = client.get(&full_script_url).send().await.ok()?.text().await.ok()?;

    let jwt_regex = regex::Regex::new(r#"ey[A-Za-z0-9_-]+\.ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"#).ok()?;
    for mat in jwt_regex.find_iter(&script) {
        let candidate = mat.as_str();
        let parts: Vec<&str> = candidate.split('.').collect();
        if parts.len() == 3 {
            use base64::Engine;
            if let Ok(decoded) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(parts[1]) {
                if let Ok(val) = serde_json::from_slice::<serde_json::Value>(&decoded) {
                    if let Some(exp) = val.get("exp").and_then(|e| e.as_u64()) {
                        if exp > now {
                            let mut cache = APPLE_TOKEN_CACHE.lock().ok()?;
                            *cache = Some((candidate.to_string(), exp));
                            return Some(candidate.to_string());
                        }
                    }
                }
            }
        }
    }

    None
}

/// Searches Apple Music catalog API for editorial video motion artwork.
pub async fn search_apple_canvas(
    client: &reqwest::Client,
    title: &str,
    artist: &str,
    album: Option<&str>,
) -> Option<CanvasResult> {
    let token = get_apple_token(client).await?;

    let term = if let Some(alb) = album {
        if !alb.is_empty() {
            format!("{} {} {}", artist, title, alb)
        } else {
            format!("{} {}", artist, title)
        }
    } else {
        format!("{} {}", artist, title)
    };

    let url = format!(
        "https://amp-api.music.apple.com/v1/catalog/us/search?term={}&types=songs&limit=10&extend=editorialVideo&include=albums",
        urlencoding::encode(&term)
    );

    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .header("Origin", "https://music.apple.com")
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    let json: serde_json::Value = resp.json().await.ok()?;
    let songs = json.get("results")?.get("songs")?.get("data")?.as_array()?;

    let norm_title = normalize_string(title);
    let norm_artist = normalize_string(artist);

    for song in songs {
        let attrs = song.get("attributes")?;
        let song_name = attrs.get("name").and_then(|n| n.as_str()).unwrap_or_default();
        let song_artist = attrs.get("artistName").and_then(|n| n.as_str()).unwrap_or_default();
        let song_album = attrs.get("albumName").and_then(|n| n.as_str());

        let norm_s_title = normalize_string(song_name);
        let norm_s_artist = normalize_string(song_artist);

        if !norm_s_artist.contains(&norm_artist) && !norm_artist.contains(&norm_s_artist) {
            continue;
        }
        if norm_s_title != norm_title && !norm_title.contains(&norm_s_title) && !norm_s_title.contains(&norm_title) {
            continue;
        }

        if let Some(editorial_video) = attrs.get("editorialVideo") {
            let primary = editorial_video.get("motionDetailSquare")
                .or_else(|| editorial_video.get("motionSquareVideo1x1"))
                .or_else(|| editorial_video.get("motionDetailRaw"))
                .or_else(|| editorial_video.get("motionDetailTall"))
                .and_then(|obj| {
                    obj.get("video")
                        .or_else(|| obj.get("videoUrl"))
                        .or_else(|| obj.get("hlsUrl"))
                        .or_else(|| obj.get("url"))
                })
                .and_then(|v| v.as_str());

            if let Some(video_url) = primary {
                return Some(CanvasResult {
                    url: video_url.to_string(),
                    fallback_url: None,
                    source: "apple".to_string(),
                    format: if video_url.contains(".m3u8") { "hls".to_string() } else { "mp4".to_string() },
                    is_local: false,
                    title: Some(song_name.to_string()),
                    artist: Some(song_artist.to_string()),
                    album: song_album.map(|s| s.to_string()),
                });
            }
        }
    }

    None
}

/// Unified resolver function that queries local files first, then online sources (Tidal -> Apple Music).
pub async fn resolve_track_canvas(
    client: &reqwest::Client,
    title: &str,
    artist: &str,
    album: Option<&str>,
    track_path: Option<&str>,
    allow_online: bool,
) -> Option<CanvasResult> {
    // 1. Check local file first (fastest, private, zero-network)
    if let Some(path) = track_path {
        if let Some(local) = check_local_canvas(path) {
            return Some(local);
        }
    }

    if !allow_online {
        return None;
    }

    let cache_key = format!("{}|{}|{}", normalize_string(title), normalize_string(artist), album.unwrap_or(""));

    // Check memory cache
    {
        if let Ok(cache) = CANVAS_CACHE.lock() {
            if let Some(cached) = cache.get(&cache_key) {
                return cached.clone();
            }
        }
    }

    // 2. Try Tidal (MP4, square 1280x1280)
    if let Some(tidal) = search_tidal_canvas(client, title, artist, album).await {
        if let Ok(mut cache) = CANVAS_CACHE.lock() {
            if cache.len() >= MAX_CACHE_SIZE {
                cache.clear();
            }
            cache.insert(cache_key, Some(tidal.clone()));
        }
        return Some(tidal);
    }

    // 3. Try Apple Music (HLS / MP4 editorial motion artwork)
    if let Some(apple) = search_apple_canvas(client, title, artist, album).await {
        if let Ok(mut cache) = CANVAS_CACHE.lock() {
            if cache.len() >= MAX_CACHE_SIZE {
                cache.clear();
            }
            cache.insert(cache_key, Some(apple.clone()));
        }
        return Some(apple);
    }

    // Negative caching to prevent repeat misses from hitting the network
    if let Ok(mut cache) = CANVAS_CACHE.lock() {
        if cache.len() >= MAX_CACHE_SIZE {
            cache.clear();
        }
        cache.insert(cache_key, None);
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_string() {
        assert_eq!(normalize_string("Starboy (feat. Daft Punk)"), "starboy");
        assert_eq!(normalize_string("In The End [Live Edition]"), "in the end");
        assert_eq!(normalize_string("  Blinding   Lights!  "), "blinding lights");
    }

    #[test]
    fn test_format_tidal_cover_url() {
        let valid_id = "12345678-abcd-1234-5678-abcdef123456";
        assert_eq!(
            format_tidal_cover_url(valid_id),
            Some("https://resources.tidal.com/videos/12345678/abcd/1234/5678/abcdef123456/1280x1280.mp4".to_string())
        );

        let invalid_id = "12345678-abcd-1234";
        assert_eq!(format_tidal_cover_url(invalid_id), None);
    }

    #[test]
    fn test_check_local_canvas_missing() {
        assert_eq!(check_local_canvas("C:/non_existent_folder/song.mp3"), None);
    }
}
