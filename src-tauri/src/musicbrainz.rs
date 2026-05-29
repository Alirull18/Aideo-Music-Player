use reqwest::Client;
use serde_json::Value;

const USER_AGENT: &str = concat!("AideoMusicPlayer/", env!("CARGO_PKG_VERSION"), " ( https://github.com/Alirull18/Aideo-Music-Player )");

pub async fn search_recording(title: &str, artist: &str) -> Result<Value, String> {
    let mut clean_t = title.to_string();
    let mut clean_a = artist.to_string();

    // 1. Sanitize the title using Regex
    if let Ok(re) = regex::Regex::new(r"(?i)\[.*?\]|\(.*?\)|(official\s*(music\s*)?video)|(audio)|(lyric\s*video)|(lyrics)") {
        clean_t = re.replace_all(&clean_t, "").trim().to_string();
    }

    // 2. Hyphen Splitting (if artist is empty but title contains ' - ')
    if clean_a.trim().is_empty() && clean_t.contains(" - ") {
        let parts: Vec<&str> = clean_t.splitn(2, " - ").collect();
        if parts.len() == 2 {
            clean_a = parts[0].trim().to_string();
            clean_t = parts[1].trim().to_string();
        }
    }

    let client = Client::new();
    let query = if clean_a.trim().is_empty() {
        // If we only have a title, do a loose general search across all fields
        format!("\"{}\"", clean_t)
    } else {
        format!("recording:\"{}\" AND artist:\"{}\"", clean_t, clean_a)
    };
    let url = format!("https://musicbrainz.org/ws/2/recording?query={}&fmt=json", urlencoding::encode(&query));

    let res = client.get(&url)
        .header("User-Agent", USER_AGENT)
        .send().await.map_err(|e| e.to_string())?;
    
    let mut json: Value = res.json().await.map_err(|e| e.to_string())?;

    // 3. The Waterfall: iTunes Fallback
    // If MusicBrainz finds nothing, hit the iTunes API which has a massive global catalog.
    let count = json["count"].as_u64().unwrap_or(0);
    if count == 0 {
        let itunes_term = if clean_a.trim().is_empty() {
            clean_t.clone()
        } else {
            format!("{} {}", clean_t, clean_a)
        };
        let itunes_url = format!("https://itunes.apple.com/search?term={}&entity=song&limit=1", urlencoding::encode(&itunes_term));
        if let Ok(itunes_res) = client.get(&itunes_url).send().await {
            if let Ok(itunes_json) = itunes_res.json::<Value>().await {
                if let Some(results) = itunes_json["results"].as_array() {
                    if !results.is_empty() {
                        let track = &results[0];
                        let itunes_title = track["trackName"].as_str().unwrap_or(&clean_t);
                        let itunes_artist = track["artistName"].as_str().unwrap_or(&clean_a);
                        let itunes_album = track["collectionName"].as_str().unwrap_or("");
                        
                        // Structure it like MusicBrainz so the frontend doesn't need to change
                        json = serde_json::json!({
                            "recordings": [{
                                "title": itunes_title,
                                "artist-credit": [{ "name": itunes_artist }],
                                "releases": [{ "title": itunes_album }]
                            }]
                        });
                    }
                }
            }
        }
    }

    Ok(json)
}

pub async fn get_cover_art_url(release_id: &str) -> Result<String, String> {
    let url = format!("https://coverartarchive.org/release/{}", release_id);
    let client = Client::new();
    
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
