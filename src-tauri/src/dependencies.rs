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
    if let Ok(parsed) = url::Url::parse(url) {
        let host = parsed.host_str().unwrap_or("").to_lowercase();
        let is_allowed = host == "github.com" 
            || host.ends_with(".github.com") 
            || host == "githubusercontent.com" 
            || host.ends_with(".githubusercontent.com");
        if !is_allowed {
            return Err("Security error: Dependency download domain not allowed.".to_string());
        }
    } else {
        return Err("Invalid dependency download URL.".to_string());
    }

    let client = crate::get_http_client();
    let res = client
        .get(url)
        .header("User-Agent", "AideoMusicPlayer/0.9.5")
        .send()
        .await
        .map_err(|e| format!("Network request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Dependency download failed with HTTP status: {}", res.status()));
    }

    let total_size = res
        .content_length()
        .ok_or_else(|| "Failed to fetch file content size".to_string())?;

    if total_size < 1_000_000 {
        return Err("Invalid dependency binary size (too small or corrupted).".to_string());
    }

    let temp_dest = dest_path.with_extension("tmp");
    let mut file = std::fs::File::create(&temp_dest)
        .map_err(|e| format!("Failed to create temporary destination file: {}", e))?;

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
    drop(file);

    std::fs::rename(&temp_dest, dest_path)
        .map_err(|e| format!("Failed to finalize dependency installation: {}", e))?;

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
            let url = "https://github.com/xihan123/FFmpeg-Audio/releases/download/n8.0.1/ffmpeg-audio-only-8.0.1-windows-x64.zip";
            let _ = app_handle.emit("ui-toast", serde_json::json!({
                "message": "Downloading FFmpeg Transcoder in background...",
                "type": "info"
            }));
            download_with_progress(url, &zip_dest, "ffmpeg", &app_handle).await?;
            
            let _ = app_handle.emit("ui-toast", serde_json::json!({
                "message": "Extracting FFmpeg engine...",
                "type": "info"
            }));

            let aideo_dir_clone = aideo_dir.clone();
            let zip_dest_clone = zip_dest.clone();
            let extract_res = tokio::task::spawn_blocking(move || {
                let file = std::fs::File::open(&zip_dest_clone)
                    .map_err(|e| format!("Failed to open downloaded zip: {}", e))?;
                let mut archive = zip::ZipArchive::new(file)
                    .map_err(|e| format!("Failed to read zip archive: {}", e))?;

                let mut extracted = false;
                for i in 0..archive.len() {
                    let mut file = archive.by_index(i)
                        .map_err(|e| format!("Failed to retrieve file from zip: {}", e))?;
                    
                    let outpath = match file.enclosed_name() {
                        Some(path) => path.to_owned(),
                        None => continue,
                    };

                    if outpath.file_name().and_then(|n| n.to_str()).map(|n| n.eq_ignore_ascii_case("ffmpeg.exe")).unwrap_or(false) {
                        let mut outfile = std::fs::File::create(aideo_dir_clone.join("ffmpeg.exe"))
                            .map_err(|e| format!("Failed to create destination file: {}", e))?;
                        std::io::copy(&mut file, &mut outfile)
                            .map_err(|e| format!("Failed to extract ffmpeg.exe: {}", e))?;
                        extracted = true;
                        break;
                    }
                }

                let _ = std::fs::remove_file(&zip_dest_clone);

                if !extracted {
                    return Err("ffmpeg.exe was not found inside the zip archive".to_string());
                }
                Ok(())
            }).await.map_err(|e| format!("Extraction task panicked: {}", e))?;
            
            extract_res?;

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

#[tauri::command]
pub async fn check_update_ytdlp(app_handle: tauri::AppHandle) -> Result<bool, String> {
    let aideo_dir = get_aideo_dir();
    let ytdlp_path = aideo_dir.join("yt-dlp.exe");

    if !ytdlp_path.exists() {
        return install_dependency(app_handle, "ytdlp".to_string()).await;
    }

    let _ = app_handle.emit("ui-toast", serde_json::json!({
        "message": "Checking for yt-dlp binary updates...",
        "type": "info"
    }));

    // Method 1: Execute yt-dlp -U in background
    let ytdlp_clone = ytdlp_path.clone();
    let update_output = tokio::task::spawn_blocking(move || {
        let mut cmd = std::process::Command::new(&ytdlp_clone);
        cmd.arg("-U");
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }
        cmd.output()
    }).await.map_err(|e| e.to_string())?;

    let is_updated = match update_output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            println!("[ytdlp-update] stdout: {}, stderr: {}", stdout, stderr);
            stdout.contains("Updated yt-dlp") || stdout.contains("yt-dlp is up to date") || out.status.success()
        }
        Err(_) => false,
    };

    if is_updated {
        let _ = app_handle.emit("ui-toast", serde_json::json!({
            "message": "yt-dlp stream engine is up to date!",
            "type": "success"
        }));
        return Ok(true);
    }

    // Method 2 fallback: Re-download latest binary if -U failed
    let dest = aideo_dir.join("yt-dlp.exe");
    let url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
    download_with_progress(url, &dest, "ytdlp", &app_handle).await?;
    
    let _ = app_handle.emit("ui-toast", serde_json::json!({
        "message": "yt-dlp binary successfully updated to latest release!",
        "type": "success"
    }));

    Ok(true)
}

pub fn spawn_background_ytdlp_updater(_app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        // Wait 15 seconds after startup before background check
        std::thread::sleep(std::time::Duration::from_secs(15));
        let aideo_dir = get_aideo_dir();
        let ytdlp_path = aideo_dir.join("yt-dlp.exe");
        if ytdlp_path.exists() {
            println!("[ytdlp-auto-update] Running background check for yt-dlp updates...");
            let mut cmd = std::process::Command::new(&ytdlp_path);
            cmd.arg("-U");
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
            }
            let _ = cmd.output();
            println!("[ytdlp-auto-update] Background update check completed.");
        }
    });
}


