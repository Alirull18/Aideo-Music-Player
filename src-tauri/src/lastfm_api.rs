use reqwest::Client;
use serde_json::Value;
use std::env;

const API_URL: &str = "https://ws.audioscrobbler.com/2.0/";

fn get_api_key() -> String {
    env::var("LASTFM_API_KEY")
        .unwrap_or_else(|_| option_env!("LASTFM_API_KEY").unwrap_or("YOUR_LASTFM_API_KEY").to_string())
}

/// 🎵 Fetch similar tracks for a given track from Last.fm's collaborative scrobble database
pub async fn get_similar_tracks(artist: &str, track: &str) -> Result<Vec<Value>, String> {
    let client = Client::new();
    let api_key = get_api_key();
    
    let res = client.get(API_URL)
        .query(&[
            ("method", "track.getsimilar"),
            ("artist", artist),
            ("track", track),
            ("api_key", &api_key),
            ("format", "json"),
            ("limit", "15"),
            ("autocorrect", "1")
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: Value = res.json().await.map_err(|e| e.to_string())?;
    
    if let Some(err_code) = json.get("error") {
        let msg = json.get("message").and_then(|m| m.as_str()).unwrap_or("Unknown Last.fm error");
        return Err(format!("Last.fm API error {}: {}", err_code, msg));
    }

    let mut tracks = Vec::new();
    if let Some(sim_tracks) = json.get("similartracks").and_then(|st| st.get("track")).and_then(|t| t.as_array()) {
        for t in sim_tracks {
            tracks.push(t.clone());
        }
    }
    
    Ok(tracks)
}

/// 👥 Fetch similar artists for a seed artist from Last.fm
pub async fn get_similar_artists(artist: &str) -> Result<Vec<String>, String> {
    let client = Client::new();
    let api_key = get_api_key();
    
    let res = client.get(API_URL)
        .query(&[
            ("method", "artist.getsimilar"),
            ("artist", artist),
            ("api_key", &api_key),
            ("format", "json"),
            ("limit", "10"),
            ("autocorrect", "1")
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: Value = res.json().await.map_err(|e| e.to_string())?;
    
    if let Some(err_code) = json.get("error") {
        let msg = json.get("message").and_then(|m| m.as_str()).unwrap_or("Unknown Last.fm error");
        return Err(format!("Last.fm API error {}: {}", err_code, msg));
    }

    let mut artists = Vec::new();
    if let Some(sim_artists) = json.get("similarartists").and_then(|sa| sa.get("artist")).and_then(|a| a.as_array()) {
        for a in sim_artists {
            if let Some(name) = a.get("name").and_then(|n| n.as_str()) {
                artists.push(name.to_string());
            }
        }
    }
    
    Ok(artists)
}

/// 📈 Fetch the top tracks for a given artist
pub async fn get_artist_top_tracks(artist: &str) -> Result<Vec<Value>, String> {
    let client = Client::new();
    let api_key = get_api_key();
    
    let res = client.get(API_URL)
        .query(&[
            ("method", "artist.gettoptracks"),
            ("artist", artist),
            ("api_key", &api_key),
            ("format", "json"),
            ("limit", "5"),
            ("autocorrect", "1")
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: Value = res.json().await.map_err(|e| e.to_string())?;
    
    if let Some(err_code) = json.get("error") {
        let msg = json.get("message").and_then(|m| m.as_str()).unwrap_or("Unknown Last.fm error");
        return Err(format!("Last.fm API error {}: {}", err_code, msg));
    }

    let mut tracks = Vec::new();
    if let Some(top_tracks) = json.get("toptracks").and_then(|tt| tt.get("track")).and_then(|t| t.as_array()) {
        for t in top_tracks {
            tracks.push(t.clone());
        }
    }
    
    Ok(tracks)
}

/// 📈 Fetch global top tracks from Last.fm
pub async fn get_global_top_tracks() -> Result<Vec<Value>, String> {
    get_global_top_tracks_page(1).await
}

/// 📈 Fetch global top tracks from Last.fm with pagination for variety
pub async fn get_global_top_tracks_page(page: u32) -> Result<Vec<Value>, String> {
    let client = Client::new();
    let api_key = get_api_key();
    let page_str = page.to_string();

    let res = client.get(API_URL)
        .query(&[
            ("method", "chart.gettoptracks"),
            ("api_key", &api_key),
            ("format", "json"),
            ("limit", "50"),
            ("page", &page_str),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: Value = res.json().await.map_err(|e| e.to_string())?;

    if let Some(err_code) = json.get("error") {
        let msg = json.get("message").and_then(|m| m.as_str()).unwrap_or("Unknown Last.fm error");
        return Err(format!("Last.fm API error {}: {}", err_code, msg));
    }

    let mut tracks = Vec::new();
    if let Some(top_tracks) = json.get("tracks").and_then(|tt| tt.get("track")).and_then(|t| t.as_array()) {
        for t in top_tracks {
            tracks.push(t.clone());
        }
    }

    Ok(tracks)
}

/// 🎸 Fetch top tracks for a genre/tag from Last.fm (e.g. "pop", "hip-hop", "k-pop", "indie")
pub async fn get_tag_top_tracks(tag: &str) -> Result<Vec<Value>, String> {
    let client = Client::new();
    let api_key = get_api_key();

    let res = client.get(API_URL)
        .query(&[
            ("method", "tag.gettoptracks"),
            ("tag", tag),
            ("api_key", &api_key),
            ("format", "json"),
            ("limit", "30"),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: Value = res.json().await.map_err(|e| e.to_string())?;

    if let Some(err_code) = json.get("error") {
        let msg = json.get("message").and_then(|m| m.as_str()).unwrap_or("Unknown Last.fm error");
        return Err(format!("Last.fm API error {}: {}", err_code, msg));
    }

    let mut tracks = Vec::new();
    // tag.gettoptracks wraps differently: {"tracks": {"track": [...]}}
    if let Some(top_tracks) = json.get("tracks").and_then(|tt| tt.get("track")).and_then(|t| t.as_array()) {
        for t in top_tracks {
            // Normalise to the same shape as chart.gettoptracks
            // chart tracks have: {"name": ..., "artist": {"name": ...}}
            // tag tracks have:   {"name": ..., "artist": {"name": ...}} — same shape ✓
            tracks.push(t.clone());
        }
    }

    Ok(tracks)
}

/// 🏷️ Fetch top tags/genres for a given artist from Last.fm
pub async fn get_artist_top_tags(artist: &str) -> Result<Vec<String>, String> {
    let client = Client::new();
    let api_key = get_api_key();
    
    let res = client.get(API_URL)
        .query(&[
            ("method", "artist.gettoptags"),
            ("artist", artist),
            ("api_key", &api_key),
            ("format", "json"),
            ("autocorrect", "1")
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: Value = res.json().await.map_err(|e| e.to_string())?;
    
    if let Some(err_code) = json.get("error") {
        let msg = json.get("message").and_then(|m| m.as_str()).unwrap_or("Unknown Last.fm error");
        return Err(format!("Last.fm API error {}: {}", err_code, msg));
    }

    let mut tags = Vec::new();
    if let Some(toptags) = json.get("toptags").and_then(|tt| tt.get("tag")).and_then(|t| t.as_array()) {
        for tag in toptags {
            if let Some(name) = tag.get("name").and_then(|n| n.as_str()) {
                tags.push(name.to_string());
            }
        }
    }
    
    Ok(tags)
}
