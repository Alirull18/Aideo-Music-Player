use reqwest::Client;
use serde_json::Value;

const USER_AGENT: &str = "AideoMusicPlayer/0.4.5 ( https://github.com/Alirull18/Aideo-Music-Player )";

pub async fn search_recording(title: &str, artist: &str) -> Result<Value, String> {
    let client = Client::new();
    let query = format!("recording:\"{}\" AND artist:\"{}\"", title, artist);
    let url = format!("https://musicbrainz.org/ws/2/recording?query={}&fmt=json", urlencoding::encode(&query));

    let res = client.get(&url)
        .header("User-Agent", USER_AGENT)
        .send().await.map_err(|e| e.to_string())?;
    
    let json: Value = res.json().await.map_err(|e| e.to_string())?;
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
