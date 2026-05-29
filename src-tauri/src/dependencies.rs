use tauri::Emitter;
use futures::StreamExt;
use std::io::Write;
use std::path::{Path, PathBuf};
use serde::Serialize;

#[derive(Serialize, Debug, Clone)]
pub struct DependencyStatus {
    pub ytdlp_installed: bool,
    pub ffmpeg_installed: bool,
    pub ytdlp_size: u64,
    pub ffmpeg_size: u64,
}

fn get_aideo_dir() -> PathBuf {
    let data_dir = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    data_dir.join("Aideo")
}

#[tauri::command]
pub fn get_dependencies_status() -> Result<DependencyStatus, String> {
    let aideo_dir = get_aideo_dir();
    let ytdlp_path = aideo_dir.join("yt-dlp.exe");
    let ffmpeg_path = aideo_dir.join("ffmpeg.exe");

    let ytdlp_size = std::fs::metadata(&ytdlp_path).map(|m| m.len()).unwrap_or(0);
    let ffmpeg_size = std::fs::metadata(&ffmpeg_path).map(|m| m.len()).unwrap_or(0);

    Ok(DependencyStatus {
        ytdlp_installed: ytdlp_path.exists(),
        ffmpeg_installed: ffmpeg_path.exists(),
        ytdlp_size,
        ffmpeg_size,
    })
}

async fn download_with_progress(
    url: &str,
    dest_path: &Path,
    dep_id: &str,
    app_handle: &tauri::AppHandle,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let res = client
        .get(url)
        .header("User-Agent", "Mozilla/5.0")
        .send()
        .await
        .map_err(|e| format!("Network request failed: {}", e))?;

    let total_size = res
        .content_length()
        .ok_or_else(|| "Failed to fetch file content size".to_string())?;

    let mut file = std::fs::File::create(dest_path)
        .map_err(|e| format!("Failed to create local destination file: {}", e))?;

    let mut downloaded = 0;
    let mut stream = res.bytes_stream();
    let mut last_emit = std::time::Instant::now();

    while let Some(item) = stream.next().await {
        let chunk = item.map_err(|e| format!("Error during streaming download: {}", e))?;
        file.write_all(&chunk)
            .map_err(|e| format!("Failed to write chunk to disk: {}", e))?;
        downloaded += chunk.len() as u64;

        let now = std::time::Instant::now();
        if now.duration_since(last_emit).as_millis() > 150 || downloaded == total_size {
            let percent = (downloaded as f64 / total_size as f64) * 100.0;
            let _ = app_handle.emit(
                "dependency-download-progress",
                serde_json::json!({
                    "id": dep_id,
                    "percent": percent,
                    "downloaded": downloaded,
                    "total": total_size
                }),
            );
            last_emit = now;
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn install_dependency(app_handle: tauri::AppHandle, dep_id: String) -> Result<bool, String> {
    let aideo_dir = get_aideo_dir();
    if !aideo_dir.exists() {
        std::fs::create_dir_all(&aideo_dir).map_err(|e| format!("Failed to create Aideo directory: {}", e))?;
    }

    match dep_id.as_str() {
        "ytdlp" => {
            let dest = aideo_dir.join("yt-dlp.exe");
            let url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
            let _ = app_handle.emit("ui-toast", serde_json::json!({
                "message": "Downloading high-performance YouTube audio decoder in background...",
                "type": "info"
            }));
            download_with_progress(url, &dest, "ytdlp", &app_handle).await?;
            let _ = app_handle.emit("ui-toast", serde_json::json!({
                "message": "YouTube audio decoder successfully installed!",
                "type": "success"
            }));
        }
        "ffmpeg" => {
            let zip_dest = aideo_dir.join("ffmpeg.zip");
            let url = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";
            let _ = app_handle.emit("ui-toast", serde_json::json!({
                "message": "Downloading FFmpeg Transcoder in background...",
                "type": "info"
            }));
            download_with_progress(url, &zip_dest, "ffmpeg", &app_handle).await?;
            
            let _ = app_handle.emit("ui-toast", serde_json::json!({
                "message": "Extracting FFmpeg engine...",
                "type": "info"
            }));

            let temp_extract_dir = aideo_dir.join("ffmpeg_temp");
            if temp_extract_dir.exists() {
                let _ = std::fs::remove_dir_all(&temp_extract_dir);
            }

            let status = std::process::Command::new("powershell")
                .arg("-Command")
                .arg(format!(
                    "Expand-Archive -Path '{}' -DestinationPath '{}' -Force; Get-ChildItem -Path '{}' -Filter 'ffmpeg.exe' -Recurse | Move-Item -Destination '{}' -Force",
                    zip_dest.to_string_lossy(),
                    temp_extract_dir.to_string_lossy(),
                    temp_extract_dir.to_string_lossy(),
                    aideo_dir.to_string_lossy()
                ))
                .status();

            let _ = std::fs::remove_file(&zip_dest);
            let _ = std::fs::remove_dir_all(&temp_extract_dir);

            if status.is_err() || !status.unwrap().success() {
                return Err("Failed to extract FFmpeg binaries.".to_string());
            }

            let _ = app_handle.emit("ui-toast", serde_json::json!({
                "message": "FFmpeg Transcoder successfully installed!",
                "type": "success"
            }));
        }
        _ => return Err(format!("Unknown dependency identifier: {}", dep_id)),
    }

    Ok(true)
}

#[tauri::command]
pub fn uninstall_dependency(app_handle: tauri::AppHandle, dep_id: String) -> Result<bool, String> {
    let aideo_dir = get_aideo_dir();
    
    match dep_id.as_str() {
        "ytdlp" => {
            let path = aideo_dir.join("yt-dlp.exe");
            if path.exists() {
                std::fs::remove_file(&path).map_err(|e| format!("Failed to delete yt-dlp: {}", e))?;
            }
            let _ = app_handle.emit("ui-toast", serde_json::json!({
                "message": "YouTube audio decoder successfully uninstalled and deleted from system.",
                "type": "success"
            }));
        }
        "ffmpeg" => {
            let path = aideo_dir.join("ffmpeg.exe");
            if path.exists() {
                std::fs::remove_file(&path).map_err(|e| format!("Failed to delete FFmpeg: {}", e))?;
            }
            let _ = app_handle.emit("ui-toast", serde_json::json!({
                "message": "FFmpeg Transcoder successfully uninstalled and deleted from system.",
                "type": "success"
            }));
        }
        _ => return Err(format!("Unknown dependency identifier: {}", dep_id)),
    }

    Ok(true)
}

