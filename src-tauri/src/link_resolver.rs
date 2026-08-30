use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
pub struct ResolvedLink {
    pub source: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration_secs: Option<u64>,
    pub query: String,
}

#[derive(Debug, PartialEq, Clone, Copy)]
enum Provider {
    Spotify,
    AppleMusic,
    Deezer,
}

#[derive(Debug, PartialEq)]
enum EntityKind {
    Track,
    Album,
}

#[derive(Debug, PartialEq)]
struct ParsedLink {
    provider: Provider,
    kind: EntityKind,
    id: Option<String>,
    country: Option<String>,
    track_hint: Option<String>,
}

fn parse_external_link(raw: &str) -> Option<ParsedLink> {
    let url = reqwest::Url::parse(raw.trim()).ok()?;

    match url.host_str()? {
        "open.spotify.com" | "spotify.link" => {
            if url.host_str()? == "open.spotify.com" {
                let segs: Vec<&str> = url.path().split('/').filter(|s| !s.is_empty()).collect();
                let kind = segs.iter().find_map(|s| match *s {
                    "track" => Some(EntityKind::Track),
                    "album" => Some(EntityKind::Album),
                    _ => None,
                })?;
                Some(ParsedLink {
                    provider: Provider::Spotify,
                    kind,
                    id: None,
                    country: None,
                    track_hint: None,
                })
            } else {
                Some(ParsedLink {
                    provider: Provider::Spotify,
                    kind: EntityKind::Track,
                    id: None,
                    country: None,
                    track_hint: None,
                })
            }
        }
        "music.apple.com" => {
            let mut country = None;
            let mut kind = None;
            let mut id = None;
            for seg in url.path().split('/').filter(|s| !s.is_empty()) {
                if country.is_none() && seg.len() == 2 && seg.chars().all(|c| c.is_ascii_alphabetic())
                {
                    country = Some(seg.to_string());
                    continue;
                }
                if kind.is_none() {
                    kind = match seg {
                        "song" => Some(EntityKind::Track),
                        "album" => Some(EntityKind::Album),
                        _ => continue,
                    };
                    continue;
                }
                if seg.chars().all(|c| c.is_ascii_digit()) {
                    id = Some(seg.to_string());
                    break;
                }
            }
            let kind = kind?;
            let track_hint = url
                .query_pairs()
                .find(|(k, _)| k == "i")
                .map(|(_, v)| v.to_string());
            if id.is_none() && track_hint.is_none() {
                return None;
            }
            Some(ParsedLink {
                provider: Provider::AppleMusic,
                kind,
                id,
                country,
                track_hint,
            })
        }
        "www.deezer.com" | "deezer.com" => {
            let segs: Vec<&str> = url.path().split('/').filter(|s| !s.is_empty()).collect();
            let mut idx = 0;
            let mut country = None;
            if let Some(first) = segs.first() {
                if first.len() == 2 && first.chars().all(|c| c.is_ascii_alphabetic()) {
                    country = Some(first.to_string());
                    idx = 1;
                }
            }
            let kind = match segs.get(idx)? {
                &"track" => EntityKind::Track,
                &"album" => EntityKind::Album,
                _ => return None,
            };
            let id = segs.get(idx + 1)?;
            if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
                return None;
            }
            Some(ParsedLink {
                provider: Provider::Deezer,
                kind,
                id: Some(id.to_string()),
                country,
                track_hint: None,
            })
        }
        _ => None,
    }
}

async fn resolve_spotify(url: &str) -> Result<ResolvedLink, String> {
    let api = format!(
        "https://open.spotify.com/oembed?url={}",
        urlencoding::encode(url.trim())
    );
    let client = crate::get_http_client();
    let res = client
        .get(&api)
        .send()
        .await
        .map_err(|e| format!("Network request failed: {}", e))?;
    let status = res.status();
    if !status.is_success() {
        return Err(format!("Spotify oEmbed returned HTTP status: {}", status));
    }
    let json: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse Spotify response: {}", e))?;
    let title = json["title"]
        .as_str()
        .ok_or("Spotify response missing title")?
        .to_string();
    Ok(ResolvedLink {
        source: "spotify".to_string(),
        query: title.clone(),
        title,
        artist: None,
        album: None,
        duration_secs: None,
    })
}

async fn resolve_apple(parsed: &ParsedLink) -> Result<ResolvedLink, String> {
    let lookup_id = parsed
        .track_hint
        .as_ref()
        .or(parsed.id.as_ref())
        .ok_or("Apple Music link has no track or album id")?
        .clone();
    let country = parsed.country.as_deref().unwrap_or("us");
    let api = format!(
        "https://itunes.apple.com/lookup?id={}&country={}",
        lookup_id, country
    );
    let client = crate::get_http_client();
    let res = client
        .get(&api)
        .send()
        .await
        .map_err(|e| format!("Network request failed: {}", e))?;
    let status = res.status();
    if !status.is_success() {
        return Err(format!("iTunes lookup returned HTTP status: {}", status));
    }
    let json: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse iTunes response: {}", e))?;
    let results = json["results"]
        .as_array()
        .filter(|a| !a.is_empty())
        .ok_or("iTunes lookup returned no results")?;

    let want_track = parsed.track_hint.is_some() || parsed.kind == EntityKind::Track;
    let entry = results
        .iter()
        .find(|r| r["wrapperType"].as_str() == Some(if want_track { "track" } else { "collection" }))
        .or(results
            .iter()
            .find(|r| r["wrapperType"].as_str() == Some("track")))
        .unwrap_or(&results[0]);

    let title = entry["trackName"]
        .as_str()
        .or_else(|| entry["collectionName"].as_str())
        .ok_or("iTunes result missing title")?
        .to_string();
    let artist = entry["artistName"]
        .as_str()
        .map(|s| s.to_string());
    let album = entry["collectionName"]
        .as_str()
        .map(|s| s.to_string());
    let duration_secs = entry["trackTimeMillis"]
        .as_u64()
        .map(|ms| ms / 1000);

    let mut query = title.clone();
    if let Some(a) = artist.as_deref() {
        query.push(' ');
        query.push_str(a);
    }

    Ok(ResolvedLink {
        source: "apple_music".to_string(),
        query,
        title,
        artist,
        album,
        duration_secs,
    })
}

async fn resolve_deezer(parsed: &ParsedLink) -> Result<ResolvedLink, String> {
    let id = parsed.id.as_ref().ok_or("Deezer link has no id")?;
    let api = match parsed.kind {
        EntityKind::Track => format!("https://api.deezer.com/track/{}", id),
        EntityKind::Album => format!("https://api.deezer.com/album/{}", id),
    };
    let client = crate::get_http_client();
    let res = client
        .get(&api)
        .send()
        .await
        .map_err(|e| format!("Network request failed: {}", e))?;
    let status = res.status();
    if !status.is_success() {
        return Err(format!("Deezer API returned HTTP status: {}", status));
    }
    let json: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse Deezer response: {}", e))?;
    if !json["error"]["message"].is_null() {
        return Err(format!(
            "Deezer API error: {}",
            json["error"]["message"].as_str().unwrap_or("unknown")
        ));
    }

    let title = json["title_short"]
        .as_str()
        .or_else(|| json["title"].as_str())
        .ok_or("Deezer response missing title")?
        .to_string();
    let artist = json["artist"]["name"].as_str().map(|s| s.to_string());
    let album = json["album"]["title"].as_str().map(|s| s.to_string());
    let duration_secs = json["duration"].as_u64();

    let mut query = title.clone();
    if let Some(a) = artist.as_deref() {
        query.push(' ');
        query.push_str(a);
    }

    Ok(ResolvedLink {
        source: "deezer".to_string(),
        query,
        title,
        artist,
        album,
        duration_secs,
    })
}

#[tauri::command]
pub async fn resolve_external_link(url: String) -> Result<ResolvedLink, String> {
    let parsed =
        parse_external_link(&url).ok_or("Not a supported music link (Spotify, Apple Music, Deezer)")?;
    match parsed.provider {
        Provider::Spotify => resolve_spotify(&url).await,
        Provider::AppleMusic => resolve_apple(&parsed).await,
        Provider::Deezer => resolve_deezer(&parsed).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(s: &str) -> ParsedLink {
        parse_external_link(s).expect("should parse")
    }

    #[test]
    fn spotify_track_and_album_parse() {
        let p = parse("https://open.spotify.com/track/4Km5HrUvYTaSUfiSGPJeQR?si=abc");
        assert_eq!(p.provider, Provider::Spotify);
        assert_eq!(p.kind, EntityKind::Track);

        let p = parse("https://open.spotify.com/intl-de/album/1A2B3C4D5E6F7G8H9I0JkL");
        assert_eq!(p.kind, EntityKind::Album);
    }

    #[test]
    fn spotify_artist_link_rejected() {
        assert!(parse_external_link("https://open.spotify.com/artist/4Km5HrUvYTaSUfiSGPJeQR").is_none());
    }

    #[test]
    fn spotify_short_link_accepted_without_id() {
        let p = parse("https://spotify.link/xY9zAbC");
        assert_eq!(p.provider, Provider::Spotify);
        assert_eq!(p.id, None);
    }

    #[test]
    fn apple_song_with_country() {
        let p = parse("https://music.apple.com/us/song/never-gonna-give-you-up/1170679038");
        assert_eq!(p.provider, Provider::AppleMusic);
        assert_eq!(p.country.as_deref(), Some("us"));
        assert_eq!(p.id.as_deref(), Some("1170679038"));
        assert_eq!(p.kind, EntityKind::Track);
    }

    #[test]
    fn apple_album_with_track_hint() {
        let p = parse(
            "https://music.apple.com/de/album/believe/1440833098?i=1440833106",
        );
        assert_eq!(p.kind, EntityKind::Album);
        assert_eq!(p.track_hint.as_deref(), Some("1440833106"));
        assert_eq!(p.id.as_deref(), Some("1440833098"));
        assert_eq!(p.country.as_deref(), Some("de"));
    }

    #[test]
    fn apple_album_id_only() {
        let p = parse("https://music.apple.com/us/album/1440833098");
        assert_eq!(p.kind, EntityKind::Album);
        assert_eq!(p.id.as_deref(), Some("1440833098"));
    }

    #[test]
    fn apple_song_without_any_id_rejected() {
        assert!(parse_external_link("https://music.apple.com/us/song").is_none());
    }

    #[test]
    fn deezer_track_variants() {
        let p = parse("https://www.deezer.com/track/3135556");
        assert_eq!(p.provider, Provider::Deezer);
        assert_eq!(p.id.as_deref(), Some("3135556"));

        let p = parse("https://deezer.com/fr/album/302127");
        assert_eq!(p.country.as_deref(), Some("fr"));
        assert_eq!(p.kind, EntityKind::Album);
        assert_eq!(p.id.as_deref(), Some("302127"));
    }

    #[test]
    fn deezer_playlist_rejected() {
        assert!(parse_external_link("https://www.deezer.com/playlist/123456").is_none());
    }

    #[test]
    fn unsupported_hosts_and_text_rejected() {
        assert!(parse_external_link("https://youtube.com/watch?v=abc").is_none());
        assert!(parse_external_link("just some text").is_none());
        assert!(parse_external_link("https://open.spotify.com/episode/xyz").is_none());
    }
}
