use tauri::Emitter;
use std::io::Write;

pub async fn check_and_download_ytdlp(app_handle: tauri::AppHandle) -> Result<bool, String> {
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
    file.write_all(&bytes).map_err(|e| format!("Failed to write yt-dlp.exe: {}", e))?;

    println!("[dependencies] Successfully downloaded yt-dlp.exe!");
    let _ = app_handle.emit("ui-toast", serde_json::json!({
        "message": "Audio decoder setup complete! Ready for YouTube streaming.",
        "type": "success"
    }));

    Ok(true)
}
