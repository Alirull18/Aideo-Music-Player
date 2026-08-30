use serde_json::Value;

const USER_AGENT: &str = concat!("AideoMusicPlayer/", env!("CARGO_PKG_VERSION"), " ( https://github.com/Alirull18/Aideo-Music-Player )");

lazy_static::lazy_static! {
    static ref RE_TITLE_CLEAN: regex::Regex = regex::Regex::new(r"(?i)\[.*?\]|\(.*?\)|(\bofficial\s*(music\s*)?video\b)|(\baudio\b)|(\blyric\s*video\b)|(\blyrics\b)").unwrap();
}

pub fn clean_recording_title_and_artist(title: &str, artist: &str) -> (String, String) {
    let mut clean_t = RE_TITLE_CLEAN.replace_all(title, "").trim().to_string();
    let mut clean_a = artist.trim().to_string();

    if clean_a.is_empty() && clean_t.contains(" - ") {
        let parts: Vec<&str> = clean_t.splitn(2, " - ").collect();
        if parts.len() == 2 {
            clean_a = parts[0].trim().to_string();
            clean_t = parts[1].trim().to_string();
        }
    }

    (clean_t, clean_a)
}

pub async fn search_recording(title: &str, artist: &str) -> Result<Value, String> {
    let (clean_t, clean_a) = clean_recording_title_and_artist(title, artist);

    // Sanitize quotes and slashes for safe Lucene query construction
    let safe_t = clean_t.replace('"', " ").replace('\\', " ");
    let safe_a = clean_a.replace('"', " ").replace('\\', " ");

    let client = crate::get_http_client();
    let query = if safe_a.trim().is_empty() {
        format!("\"{}\"", safe_t.trim())
    } else {
        format!("recording:\"{}\" AND artist:\"{}\"", safe_t.trim(), safe_a.trim())
    };
    let url = format!("https://musicbrainz.org/ws/2/recording?query={}&fmt=json", urlencoding::encode(&query));

    let mut mbz_matched = false;
    let mut json = serde_json::json!({ "count": 0, "recordings": [] });

    // 1. Try MusicBrainz
    if let Ok(res) = client.get(&url).header("User-Agent", USER_AGENT).send().await {
        if res.status().is_success() {
            if let Ok(mbz_json) = res.json::<Value>().await {
                if let Some(recordings) = mbz_json.get("recordings").and_then(|r| r.as_array()) {
                    if !recordings.is_empty() {
                        json = mbz_json;
                        mbz_matched = true;
                    }
                }
            }
        }
    }

    // 2. iTunes Fallback (if MusicBrainz fails, rate-limits, or has no results)
    if !mbz_matched {
        let itunes_term = if clean_a.trim().is_empty() {
            clean_t.clone()
        } else {
            format!("{} {}", clean_t, clean_a)
        };
        let itunes_url = format!("https://itunes.apple.com/search?term={}&entity=song&limit=5", urlencoding::encode(&itunes_term));
        if let Ok(itunes_res) = client.get(&itunes_url).send().await {
            if itunes_res.status().is_success() {
                if let Ok(itunes_json) = itunes_res.json::<Value>().await {
                    if let Some(results) = itunes_json["results"].as_array() {
                        if !results.is_empty() {
                            let track = &results[0];
                            let itunes_title = track["trackName"].as_str().unwrap_or(&clean_t);
                            let itunes_artist = track["artistName"].as_str().unwrap_or(&clean_a);
                            let itunes_album = track["collectionName"].as_str().unwrap_or("");
                            let itunes_genre = track["primaryGenreName"].as_str().unwrap_or("");
                            let itunes_date = track["releaseDate"].as_str().unwrap_or("");
                            let itunes_year = if itunes_date.len() >= 4 { &itunes_date[..4] } else { "" };
                            let itunes_track_number = track["trackNumber"].as_u64();
                            let itunes_track_count = track["trackCount"].as_u64();
                            let itunes_disc_number = track["discNumber"].as_u64();
                            let itunes_disc_count = track["discCount"].as_u64();
                            let itunes_artwork = track["artworkUrl100"].as_str().map(|u| u.replace("100x100bb", "1000x1000bb"));

                            json = serde_json::json!({
                                "count": 1,
                                "recordings": [{
                                    "title": itunes_title,
                                    "artist-credit": [{ "name": itunes_artist }],
                                    "first-release-date": itunes_year,
                                    "genres": [{ "name": itunes_genre }],
                                    "releases": [{
                                        "id": "",
                                        "title": itunes_album,
                                        "date": itunes_year,
                                        "track_number": itunes_track_number,
                                        "track-count": itunes_track_count,
                                        "disc_number": itunes_disc_number,
                                        "disc_count": itunes_disc_count,
                                        "cover_url": itunes_artwork
                                    }]
                                }]
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(json)
}

pub async fn get_cover_art_url(release_id: &str) -> Result<String, String> {
    let url = format!("https://coverartarchive.org/release/{}", release_id);
    let client = crate::get_http_client();
    
    let res = client.get(&url)
        .header("User-Agent", USER_AGENT)
        .send().await.map_err(|e| e.to_string())?;
    
    if !res.status().is_success() {
        return Err("No cover art found".to_string());
    }

    let json: Value = res.json().await.map_err(|e| e.to_string())?;
    let image_url = json["images"][0]["image"].as_str()
        .ok_or("Invalid cover art data")?;
    
    Ok(image_url.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clean_recording_title_and_artist() {
        let (t, a) = clean_recording_title_and_artist("Hotel California (Official Video) [Remastered]", "Eagles");
        assert_eq!(t, "Hotel California");
        assert_eq!(a, "Eagles");

        let (t2, a2) = clean_recording_title_and_artist("Queen - Bohemian Rhapsody (Audio)", "");
        assert_eq!(t2, "Bohemian Rhapsody");
        assert_eq!(a2, "Queen");
    }
}
