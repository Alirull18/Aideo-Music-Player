use rusty_ytdl::search::{YouTube, SearchOptions, SearchType, SearchResult};
use rusty_ytdl::{Video, VideoOptions, VideoQuality, VideoSearchOptions};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, State};
use crate::AppState;

#[derive(Serialize, Deserialize, Debug)]
pub struct YoutubeTrack {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub cover_url: Option<String>,
    pub duration_raw: String,
    pub url: String,
}

#[tauri::command]
pub async fn search_youtube(query: String) -> Result<Vec<YoutubeTrack>, String> {
    let yt = YouTube::new().map_err(|e| e.to_string())?;
    let search_options = SearchOptions {
        limit: 15,
        search_type: SearchType::Video,
        safe_search: false,
    };
    
    let res = yt.search(&query, Some(&search_options)).await.map_err(|e| e.to_string())?;
    let mut tracks = Vec::new();
    
    for item in res {
        if let SearchResult::Video(video) = item {
            // Grab the highest resolution thumbnail
            let cover_url = video.thumbnails.last().map(|t| t.url.clone());
            tracks.push(YoutubeTrack {
                id: video.id,
                title: video.title,
                artist: video.channel.name,
                cover_url,
                duration_raw: video.duration_raw,
                url: video.url,
            });
        }
    }
    
    Ok(tracks)
}

use std::os::windows::process::CommandExt;
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[tauri::command]
pub async fn download_track(url: String, state: State<'_, AppState>) -> Result<String, String> {
    println!("[youtube] Initiating invisible yt-dlp download for URL: {}", url);
    
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
    
    // 2. We use rusty-ytdl just to quickly fetch the title for the filename (since their metadata endpoint isn't 403 blocked)
    let video_options = VideoOptions::default();
    let video = Video::new_with_options(&url, video_options).map_err(|e| e.to_string())?;
    
    println!("[youtube] Fetching video metadata...");
    let info = video.get_info().await.map_err(|e| e.to_string())?;
    let title = info.video_details.title.replace("/", "_").replace("\\", "_").replace(":", "_").replace("\"", "_");
    
    // 3. Prepare the music output directory
    let music_dir = dirs::audio_dir()
        .unwrap_or_else(|| dirs::document_dir().unwrap_or_else(|| std::path::PathBuf::from(".")))
        .join("Aideo Downloads");
        
    std::fs::create_dir_all(&music_dir).map_err(|e| e.to_string())?;
    let file_path = music_dir.join(format!("{}.m4a", title));
    
    // 4. Run yt-dlp invisibly!
    println!("[youtube] Extracting perfectly muxed stream (Format 18) via invisible yt-dlp to {:?}...", file_path);
    let output = std::process::Command::new(&ytdlp_path)
        .arg("-f")
        .arg("18")
        .arg("-o")
        .arg(&file_path)
        .arg(&url)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Failed to execute yt-dlp: {}", e))?;
        
    if !output.status.success() {
        let err_msg = String::from_utf8_lossy(&output.stderr);
        println!("[youtube] yt-dlp failed: {}", err_msg);
        return Err(format!("yt-dlp error: {}", err_msg));
    }
    
    println!("[youtube] Download SUCCESS! Adding to library...");
    
    // Automatically inject the downloaded track into Aideo's local SQL library
    crate::add_track_to_library(file_path.to_string_lossy().to_string(), state)?;
    
    Ok(file_path.to_string_lossy().to_string())
}
