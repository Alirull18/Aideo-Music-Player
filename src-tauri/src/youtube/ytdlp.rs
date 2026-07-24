pub async fn check_and_download_ytdlp(app_handle: tauri::AppHandle) -> Result<bool, String> {
    let data_dir = dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let aideo_dir = data_dir.join("Aideo");
    let ytdlp_path = aideo_dir.join("yt-dlp.exe");

    if ytdlp_path.exists() {
        return Ok(true);
    }

    crate::dependencies::install_dependency(app_handle, "ytdlp".to_string()).await
}

