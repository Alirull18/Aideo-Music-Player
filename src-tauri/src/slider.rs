use serde::{Deserialize, Serialize};
use tauri::State;
use crate::AppState;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SliderTrack {
    pub id: String,
    pub duration: u32,
    pub title: String,
    pub artist: String,
    pub duration_raw: String,
    pub download_url: String,
}

#[derive(Deserialize, Debug)]
struct SliderResponse {
    audios: std::collections::HashMap<String, Vec<SliderTrackItem>>,
}

#[derive(Deserialize, Debug)]
struct SliderTrackItem {
    id: String,
    duration: u32,
    tit_art: String,
    url: String,
}

#[tauri::command]
pub async fn search_slider(query: String) -> Result<Vec<SliderTrack>, String> {
    println!("[slider] Searching sldr.su for query: {}", query);
    
    let client = reqwest::Client::new();
    let encoded_query = urlencoding::encode(&query);
    let search_url = format!("https://sldr.su/vk_auth.php?q={}", encoded_query);
    
    let res = client.get(&search_url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .send()
        .await
        .map_err(|e| format!("Failed to connect to Slider API: {}", e))?;
        
    let text = res.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
    
    // Parse the JSON
    let parsed: SliderResponse = match serde_json::from_str(&text) {
        Ok(data) => data,
        Err(e) => {
            println!("[slider] JSON parse error: {}. Response text: {}", e, text);
            return Ok(Vec::new());
        }
    };
    
    let mut tracks = Vec::new();
    
    // Extract items from any key in the HashMap (typically "" or search query)
    for (_key, items) in parsed.audios {
        for item in items {
            // Split tit_art into Artist and Title
            let parts: Vec<&str> = item.tit_art.splitn(2, " - ").collect();
            let (artist, title) = if parts.len() == 2 {
                (parts[0].trim().to_string(), parts[1].trim().to_string())
            } else {
                ("Unknown Artist".to_string(), item.tit_art.clone())
            };
            
            // Format duration
            let minutes = item.duration / 60;
            let seconds = item.duration % 60;
            let duration_raw = format!("{}:{:02}", minutes, seconds);
            
            // Construct download URL with individual path components
            let encoded_tit_art = urlencoding::encode(&item.tit_art);
            let download_url = format!(
                "https://sldr.su/download/{}/{}/{}/{}.mp3",
                item.id,
                item.duration,
                item.url,
                encoded_tit_art
            );
            
            tracks.push(SliderTrack {
                id: item.id,
                duration: item.duration,
                title,
                artist,
                duration_raw,
                download_url,
            });
        }
    }
    
    Ok(tracks)
}

#[tauri::command]
pub async fn download_slider_track(
    download_url: String,
    title: String,
    artist: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    println!("[slider] Downloading Slider track from URL: {}", download_url);
    
    // Create the download directory
    let music_dir = dirs::audio_dir()
        .unwrap_or_else(|| dirs::document_dir().unwrap_or_else(|| std::path::PathBuf::from(".")))
        .join("Aideo Downloads");
    std::fs::create_dir_all(&music_dir).map_err(|e| e.to_string())?;
    
    // Clean filename
    let clean_title = title.chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_ascii_control() => '_',
            c => c,
        })
        .collect::<String>();
    let clean_artist = artist.chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            c if c.is_ascii_control() => '_',
            c => c,
        })
        .collect::<String>();
        
    let filename = format!("{} - {}.mp3", clean_artist, clean_title);
    let file_path = music_dir.join(&filename);
    
    // Download the file
    let client = reqwest::Client::new();
    let res = client.get(&download_url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .header("Referer", "https://sldr.su/")
        .send()
        .await
        .map_err(|e| format!("Failed to send download request: {}", e))?;
        
    if !res.status().is_success() {
        return Err(format!("Server returned error code: {}", res.status()));
    }
    
    let bytes = res.bytes().await.map_err(|e| format!("Failed to read stream bytes: {}", e))?;
    std::fs::write(&file_path, bytes).map_err(|e| format!("Failed to write track file: {}", e))?;
    
    println!("[slider] Download success! File written to {:?}", file_path);
    
    // Add track to SQLite library
    let path_str = file_path.to_string_lossy().to_string();
    crate::add_track_to_library(path_str.clone(), state.clone())?;
    
    // Update SQLite library database metadata to guarantee it has perfect studio tags
    let conn = crate::safe_lock(&state.db);
    crate::db::update_track_metadata(&conn, &path_str, &title, &artist, "Slider Downloads")
        .map_err(|e| e.to_string())?;
        
    Ok(path_str)
}
