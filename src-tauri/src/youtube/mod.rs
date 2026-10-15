pub mod innertube;
pub mod matcher;
pub mod ytdlp;

pub use innertube::*;
pub use matcher::*;
pub use ytdlp::*;

use serde::{Deserialize, Serialize};
use tauri::State;
use crate::AppState;

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_context: Option<crate::db::RecordingSources>,
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

    let mut seen_tracks = std::collections::HashSet::new();
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

        let track_key = yt_track_signature(&track);
        if seen_tracks.insert(track_key) {
            verified_tracks.push(track);
        }
    }

    Ok(verified_tracks)
}

#[tauri::command]
pub async fn get_search_suggestions(query: String) -> Result<Vec<String>, String> {
    get_search_suggestions_internal(query).await
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
    download_track_internal(url, quality, title, artist, cover_url, state, app_handle).await
}

#[tauri::command]
pub async fn download_playlist_batch(
    items: serde_json::Value,
    quality: Option<String>,
    playlist_name: Option<String>,
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
) -> Result<usize, String> {
    download_playlist_batch_internal(items, quality, playlist_name, state, app_handle).await
}

#[tauri::command]
pub async fn get_aideo_recommendations(top_artists: Vec<String>, exclude_ids: Vec<String>) -> Result<Vec<YoutubeTrack>, String> {
    get_aideo_recommendations_internal(top_artists, exclude_ids).await
}

#[tauri::command]
pub async fn check_and_download_ytdlp(app_handle: tauri::AppHandle) -> Result<bool, String> {
    check_and_download_ytdlp_internal(app_handle).await
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
    get_youtube_autoplay_recommendations_internal(
        video_id,
        artist,
        title,
        top_artists,
        library_artists,
        discovery_level,
        state,
    ).await
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
    get_personalized_discovery_hub_internal(
        seed_artists,
        top_artists,
        library_artists,
        discovery_level,
        lastfm_connected,
        lastfm_top_artists,
        listenbrainz_connected,
        listenbrainz_recs,
        app_mode,
        is_online,
        app_handle,
        state,
    ).await
}

#[tauri::command]
pub fn get_cached_discovery_hub(app_handle: tauri::AppHandle) -> Result<Option<DiscoveryHubData>, String> {
    get_cached_discovery_hub_internal(app_handle)
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
    get_worldwide_leaderboard_internal(genre, country, source, offset, limit, range).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn direct_audio_tries_alternatives_and_caps_probes() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let server = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", server.local_addr().unwrap());
        let requests = tokio::spawn(async move {
            let mut paths = Vec::new();
            for status in [403, 206, 403, 403, 403] {
                let (mut socket, _) = server.accept().await.unwrap();
                let mut buffer = [0; 4096];
                let length = socket.read(&mut buffer).await.unwrap();
                paths.push(String::from_utf8_lossy(&buffer[..length]).split_whitespace().nth(1).unwrap().to_string());
                socket.write_all(format!("HTTP/1.1 {status} Test\r\nContent-Type: audio/webm\r\nContent-Length: 5\r\nConnection: close\r\n\r\naudio").as_bytes()).await.unwrap();
            }
            paths
        });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let candidates: Vec<String> = (0..5).map(|i| format!("{base}/{i}")).collect();
        assert_eq!(probe_direct_candidates(&client, candidates.clone()).await, Some(candidates[1].clone()));
        assert_eq!(probe_direct_candidates(&client, candidates).await, None);
        assert_eq!(tokio::time::timeout(std::time::Duration::from_secs(5), requests).await.unwrap().unwrap(), ["/0", "/1", "/0", "/1", "/2"]);
    }

    #[tokio::test]
    async fn direct_audio_probe_rejects_errors_html_and_empty_bodies() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        for (status, content_type, body, expected) in [
            (206, "audio/webm", "audio", true),
            (200, "application/octet-stream", "audio", true),
            (403, "audio/webm", "denied", false),
            (200, "text/html", "<html>blocked</html>", false),
            (206, "audio/webm", "", false),
        ] {
            let server = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("http://{}/audio", server.local_addr().unwrap());
            let request = tokio::spawn(async move {
                let (mut socket, _) = server.accept().await.unwrap();
                let mut buffer = [0; 4096];
                let length = socket.read(&mut buffer).await.unwrap();
                let request = String::from_utf8_lossy(&buffer[..length]).to_ascii_lowercase();
                let response = format!("HTTP/1.1 {status} Test\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
                socket.write_all(response.as_bytes()).await.unwrap();
                request
            });
            assert_eq!(probe_direct_audio(&client, &url).await, expected, "status={status} type={content_type}");
            let request = request.await.unwrap();
            assert!(request.contains("range: bytes=0-1023"));
            assert!(request.contains(&DIRECT_STREAM_USER_AGENT.to_ascii_lowercase()));
        }
    }

    #[tokio::test]
    #[ignore = "requires live YouTube access; does not invoke yt-dlp"]
    async fn direct_audio_live_three_tracks() {
        for video_id in ["oojgR4tkQCQ", "raTkmIMdInI", "7R-Ft2y_bIM"] {
            let start = std::time::Instant::now();
            let direct = resolve_innertube_stream_url(crate::get_http_client(), "", video_id)
                .await.expect("direct audio resolution/probe failed");
            let url = url::Url::parse(&direct).unwrap();
            assert!(url.query_pairs().any(|(key, value)| key == "c" && value == "VISIONOS"));
            let itag = url.query_pairs().find(|(key, _)| key == "itag").unwrap().1.into_owned();
            assert!(matches!(itag.as_str(), "251" | "140"), "preferred audio unavailable: {itag}");
            println!("Direct audio OK: video={video_id}, itag={itag}, elapsed={}ms", start.elapsed().as_millis());
        }
    }

    #[test]
    fn direct_audio_selection_prefers_opus_and_rejects_unsafe_urls() {
        let response = serde_json::json!({"streamingData": {"adaptiveFormats": [
            {"itag": 140, "mimeType": "audio/mp4", "url": "https://rr1.googlevideo.com/aac"},
            {"itag": 251, "mimeType": "audio/webm", "url": "https://rr1.googlevideo.com/opus"},
            {"itag": 250, "mimeType": "audio/webm", "url": "https://rr1.googlevideo.com/opus"},
            {"itag": 251, "mimeType": "video/webm", "url": "https://rr1.googlevideo.com/video"}
        ]}});
        assert_eq!(direct_audio_candidates(&response), ["https://rr1.googlevideo.com/opus", "https://rr1.googlevideo.com/aac"]);
        for url in ["http://rr1.googlevideo.com/audio", "https://googlevideo.com.evil.test/audio", "https://127.0.0.1/audio", "https://user:pass@rr1.googlevideo.com/audio"] {
            let unsafe_response = serde_json::json!({"streamingData": {"adaptiveFormats": [
                {"itag": 251, "mimeType": "audio/webm", "url": url}
            ]}});
            assert!(direct_audio_candidates(&unsafe_response).is_empty(), "accepted {url}");
        }
        assert!(direct_audio_candidates(&serde_json::json!({"streamingData": {"adaptiveFormats": [
            {"itag": 251, "mimeType": "audio/webm", "signatureCipher": "encrypted"}
        ]}})).is_empty());
    }

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
            source_context: None,
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
        assert!(is_duration_too_long("00:15:01"));

        // 3-part over 15 mins -> too long
        assert!(is_duration_too_long("00:18:00"));

        // 3-part 1 hour+ -> too long
        assert!(is_duration_too_long("01:00:00"));
        assert!(is_duration_too_long("01:02:00"));

        // 2-part normal: <= 15 mins -> not too long
        assert!(!is_duration_too_long("04:15"));
        assert!(!is_duration_too_long("15:00"));
        assert!(is_duration_too_long("15:01"));

        // 2-part long: > 15 mins -> too long
        assert!(is_duration_too_long("16:00"));
        assert!(is_duration_too_long("16:30"));

        // Malformed / invalid inputs -> false (safe non-panicking fallback)
        assert!(!is_duration_too_long("invalid:time"));
        assert!(!is_duration_too_long(""));
        assert!(!is_duration_too_long("invalid:time:format"));
    }

    #[test]
    fn discography_dedup_keeps_same_title_by_different_artists() {
        let tracks = vec![
            shelf_track("adele-hello", "Hello", "Adele", "Discography"),
            shelf_track("lionel-hello", "Hello", "Lionel Richie", "Discography"),
        ];
        let mut seen = std::collections::HashSet::new();
        let kept: Vec<_> = tracks
            .into_iter()
            .filter(|track| seen.insert(yt_track_signature(track)))
            .collect();

        assert_eq!(kept.len(), 2);
    }

    #[test]
    fn resolved_unknown_duration_is_not_allowed_into_recommendations() {
        assert!(!is_known_duration_within_limit("0:00"));
        assert!(!is_known_duration_within_limit(""));
        assert!(!is_known_duration_within_limit("unknown"));
        assert!(is_known_duration_within_limit("15:00"));
        assert!(!is_known_duration_within_limit("15:01"));
        assert!(!is_known_duration_within_limit("00:15:01"));
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
        assert!(!is_semantic_noise("Song - Instrumental", "Song"));
        assert!(is_semantic_noise("Song (Cover Version)", "Song"));
        assert!(!is_semantic_noise("Song (Official Audio)", "Song"));

        assert!(is_third_party_or_instrumental("Top 50 Hits Compilation 2024", "Unknown"));
        assert!(is_third_party_or_instrumental("Best Chill Songs 2023", "Chill Nation"));
        assert!(!is_third_party_or_instrumental("Blinding Lights", "The Weeknd"));
    }

    #[test]
    fn test_instrumentals_and_live_preserved() {
        // Genuine musical instrumentals MUST return false (not dropped)
        assert!(!is_third_party_or_instrumental("Clair de Lune (Instrumental)", "Claude Debussy"));
        assert!(!is_third_party_or_instrumental("Moonlight Sonata Piano Solo", "Beethoven"));
        assert!(!is_third_party_or_instrumental("Classical Guitar (Acoustic)", "Artist"));
        assert!(!is_third_party_or_instrumental("Interstellar Main Theme Soundtrack", "Hans Zimmer"));
        assert!(!is_third_party_or_instrumental("Theme (Instrumental)", "Artist"));
        assert!(!is_third_party_or_instrumental("Piano Version", "Artist"));
        assert!(!is_third_party_or_instrumental("Orchestral Version", "Artist"));

        // Genuine live music MUST return false (not dropped)
        assert!(!is_third_party_or_instrumental("Comfortably Numb (Live at Pompeii)", "David Gilmour"));
        assert!(!is_third_party_or_instrumental("Song (Live at Wembley)", "Queen"));
        assert!(!is_third_party_or_instrumental("Artist Live in Concert 2026", "Artist"));
        assert!(!is_third_party_or_instrumental("Tiny Desk Concert", "Dua Lipa"));
        assert!(!is_third_party_or_instrumental("Live Performance 2024", "Artist"));
        assert!(!is_third_party_or_instrumental("Live Session", "Artist"));
        assert!(!is_third_party_or_instrumental("Stripped Live", "Artist"));
        assert!(!is_third_party_or_instrumental("Song", "NPR Music"));
        assert!(!is_third_party_or_instrumental("Song", "Vevo Session"));

        // Non-music slop MUST return true (dropped)
        assert!(is_third_party_or_instrumental("Episode 42: A Great Podcast", "Podcaster"));
        assert!(is_third_party_or_instrumental("Daily Studio Vlog #12", "Vlogger"));
        assert!(is_third_party_or_instrumental("How to Play Piano Tutorial", "Teacher"));
        assert!(is_third_party_or_instrumental("Vinyl Unboxing Edition", "Reviewer"));
        assert!(is_third_party_or_instrumental("Vocal Coach Reacts to Song", "Coach"));
        assert!(is_third_party_or_instrumental("Karaoke Track", "Karaoke Channel"));
        assert!(is_third_party_or_instrumental("Backing Track in Am", "Backing Tracks"));
        assert!(is_third_party_or_instrumental("Kill Bill (Sped Up)", "SZA"));
        assert!(is_third_party_or_instrumental("Kill Bill - Speed Up", "SZA"));
        assert!(is_third_party_or_instrumental("Kill Bill (Piano Cover)", "Unknown"));
        assert!(is_third_party_or_instrumental("Song (Slowed + Reverb)", "Artist"));
    }

    #[test]
    fn test_youtube_title_multi_runs_extraction() {
        let json_item = serde_json::json!({
            "flexColumns": [
                {
                    "musicResponsiveListItemFlexColumnRenderer": {
                        "text": {
                            "runs": [
                                { "text": "Kill Bill" },
                                { "text": " (Sped Up Version)" }
                            ]
                        }
                    }
                }
            ]
        });

        let extracted_title = json_item.get("flexColumns")
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

        assert_eq!(extracted_title, "Kill Bill (Sped Up Version)");
        assert!(is_third_party_or_instrumental(&extracted_title, "SZA"));
    }

    #[test]
    fn test_dedupe_online_preserves_alternate_sources() {
        let mut local_shelf = vec![shelf_track("local_1", "Nightcall", "Kavinsky", "Recently Played")];
        local_shelf[0].source_context = Some(crate::db::RecordingSources {
            recording_id: "local_1".to_string(),
            sources: vec![crate::db::PlaybackSource {
                provider: crate::db::SourceProvider::Local,
                id: "C:/Music/Nightcall.flac".to_string(),
                catalog_quality: None,
                metadata: None,
            }],
            selection: crate::db::SourceSelection::Auto,
        });

        let mut signatures = std::collections::HashSet::new();
        signatures.insert(format!("{}::{}", normalize_artist_name("Kavinsky"), clean_title("Nightcall")));

        let online = vec![
            shelf_track("yt1", "Nightcall", "Kavinsky", "Recently Played"),
            shelf_track("yt2", "Outrun", "Kavinsky", "Recently Played"),
        ];

        let kept = dedupe_online_against_shelf(&mut local_shelf, online, &signatures);
        // yt1 is deduplicated from online shelf
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].id, "yt2");

        // BUT yt1 is preserved in local_shelf[0].source_context!
        let sources = &local_shelf[0].source_context.as_ref().unwrap().sources;
        assert_eq!(sources.len(), 2);
        assert_eq!(sources[0].provider, crate::db::SourceProvider::Local);
        assert_eq!(sources[1].provider, crate::db::SourceProvider::Youtube);
        assert_eq!(sources[1].id, "yt1");
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
            source_context: None,
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
            source_context: None,
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
    fn history_resolution_requires_recording_artist_and_version() {
        let mut track = YoutubeTrack { id: "x".into(), title: "Song".into(), artist: "Artist".into(), cover_url: None, duration_raw: "3:00".into(), url: String::new(), recommendation_source: None, source_context: None };
        assert!(recording_matches(&track, "Artist", "Song"));
        assert!(!recording_matches(&track, "Another", "Song"));
        assert!(!recording_matches(&track, "Artist", "Other Song"));
        track.title = "Song (Live)".into();
        assert!(!recording_matches(&track, "Artist", "Song"));
        assert!(recording_matches(&track, "Artist", "Song (Live)"));
        track.title = "Song (Live at Wembley)".into();
        assert!(!recording_matches(&track, "Artist", "Song (Live at Pompeii)"));
        track.title = "Song (Remastered 2024)".into();
        assert!(!recording_matches(&track, "Artist", "Song (Remastered 2009)"));
        track.title = "Song (Official Audio)".into();
        assert!(recording_matches(&track, "Artist", "Song"));
    }

    #[test]
    fn saved_stream_shelves_preserve_provider_and_catalog_id() {
        let conn = crate::db::init_db(":memory:").unwrap();
        conn.execute("INSERT INTO tracks (path, title, artist, format) VALUES ('12345', 'Song', 'Artist', 'Qobuz FLAC'), ('67890', 'Tidal Song', 'Artist', 'Tidal FLAC'), ('https://youtu.be/dQw4w9WgXcQ', 'Other', 'Artist', 'YOUTUBE')", []).unwrap();
        let tracks = crate::db::get_all_tracks(&conn).unwrap();
        for track in tracks {
            let mapped = map_local_to_youtube_track(&track, "Saved");
            let source = &mapped.source_context.unwrap().sources[0];
            if track.format.as_deref() == Some("Qobuz FLAC") {
                assert_eq!(source.provider, crate::db::SourceProvider::Qobuz);
                assert_eq!(source.id, "12345");
            } else if track.format.as_deref() == Some("Tidal FLAC") {
                assert_eq!(source.provider, crate::db::SourceProvider::Tidal);
                assert_eq!(source.id, "67890");
            } else {
                assert_eq!(source.provider, crate::db::SourceProvider::Youtube);
                assert_eq!(source.id, "dQw4w9WgXcQ");
            }
        }
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

        let fixture = std::env::temp_dir().join(format!("aideo-home-{}", std::process::id()));
        std::fs::create_dir_all(&fixture).unwrap();
        for index in 1..=6 {
            let path = fixture.join(format!("{}.mp3", index));
            std::fs::write(&path, []).unwrap();
            conn.execute("UPDATE tracks SET path = ?1 WHERE path = ?2", rusqlite::params![path.to_string_lossy(), format!("C:/{}.mp3", index)]).unwrap();
        }

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

        conn.execute("UPDATE playback_history SET signal_quality = 'qualified', end_reason = 'completed', listened_seconds = duration_played", []).unwrap();
        for index in [3, 4] {
            conn.execute("UPDATE playback_history SET track_path = ?1 WHERE track_path = ?2", rusqlite::params![fixture.join(format!("{}.mp3", index)).to_string_lossy(), format!("C:/{}.mp3", index)]).unwrap();
        }

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
        std::fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn test_extract_video_id_parses_various_formats() {
        assert_eq!(extract_video_id("dQw4w9WgXcQ"), Some("dQw4w9WgXcQ".to_string()));
        assert_eq!(extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), Some("dQw4w9WgXcQ".to_string()));
        assert_eq!(extract_video_id("https://music.youtube.com/watch?v=dQw4w9WgXcQ&feature=share"), Some("dQw4w9WgXcQ".to_string()));
        assert_eq!(extract_video_id("https://youtu.be/dQw4w9WgXcQ"), Some("dQw4w9WgXcQ".to_string()));
        assert_eq!(extract_video_id("https://youtu.be/dQw4w9WgXcQ?t=42"), Some("dQw4w9WgXcQ".to_string()));
        assert_eq!(extract_video_id("https://www.youtube.com/embed/dQw4w9WgXcQ"), Some("dQw4w9WgXcQ".to_string()));
        assert_eq!(extract_video_id("https://www.youtube.com/v/dQw4w9WgXcQ"), Some("dQw4w9WgXcQ".to_string()));
        assert_eq!(extract_video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ"), Some("dQw4w9WgXcQ".to_string()));
        assert_eq!(extract_video_id("https://www.youtube.com/live/dQw4w9WgXcQ"), Some("dQw4w9WgXcQ".to_string()));
        assert_eq!(extract_video_id("https://www.youtube.com/live/dQw4w9WgXcQ?feature=share"), Some("dQw4w9WgXcQ".to_string()));
        assert_eq!(extract_video_id("not-a-valid-id"), None);
        assert_eq!(extract_video_id(""), None);
    }

    #[test]
    fn test_visitor_data_regex_extracts_id() {
        let sample = r#"var data = [["yt.sw.adr",null,[[["ms","MY",null,"127.0.0.1",null,null,null,null,null,null,null,"Generic","Windows App","CgtWWDJIV19teE9PVSiOiY_VBjIKCgJNWRIEGgAgV2LfAgrcAjIxLllUPVEtSWRMOS1wVXRSWFJDTklwSzF5R183QWpjMEZDekZ4N2xVNk9vZ2IxRjgzVDVlUW9xVERtU3NvaHlwUzFTamt5d2FxLVQzcWFkX0c3UldoUWlGUUQxR1dKVFhWVC1FYVJERlplMFZzNnY4Qzk1ZXNCZVU5ZElXenVwdWQtMXNGTGNzeURVQ1ZrS2RjRDNJLWhLaFFGTlJaTV9YSDBsc2JBRWU3N0VvX1Y4clRmRG90T1NFdWlyUzlsaFBvUXpFNXo2WHN1Q08tM3J5dFBhdmdwOWtWcXFTMXNRd0Raem02NnVvOW02aGpYVTRxbXVCWGtaMG5tM2RJUmljbWlSRDdhV3FJTEJ1QjlRbVVGT3h3VEl0djZLZk5YbDVicWtPS0pLWlBhbzVtNXBKT0NvS1dCbjVtdEdZWnJGWC1TN3FOWmhfcEJ5QWUyS1lYX2w3MlVuM3M5UQ%3D%3D"]]]]];"#;
        let matched = RE_VISITOR_DATA.find(sample).map(|m| m.as_str());
        assert!(matched.is_some());
        let token = matched.unwrap();
        assert!(token.starts_with("Cgt"));
        assert!(token.len() > 30);
    }

    #[test]
    fn test_autoplay_radio_candidate_scoring_seed_affinity() {
        let top = vec!["IVE".to_string(), "NewJeans".to_string()];
        let library = vec!["IVE".to_string()];
        let empty_recent: std::collections::HashSet<String> = Default::default();
        let empty_skips: std::collections::HashMap<String, (i64, i64)> = Default::default();
        let empty_tokens: std::collections::HashMap<String, u32> = Default::default();

        let profile = autoplay_profile(&top, &library, "balanced", &empty_recent, &empty_skips, &empty_tokens);

        let seed_artist = "Wali";
        let candidate_same_artist = "Cari Jodoh";
        let candidate_other_artist = "Pergi Pagi Pulang Pagi";

        let mut score_same = score_autoplay_candidate(&profile, candidate_same_artist, "Wali");
        if artist_matches("Wali", seed_artist) {
            score_same += 0.40;
        }

        let mut score_other = score_autoplay_candidate(&profile, candidate_other_artist, "Armada");
        if artist_matches("Armada", seed_artist) {
            score_other += 0.40;
        }

        assert!(score_same > score_other, "Seed artist track must score higher than non-seed artist track");
    }
}


