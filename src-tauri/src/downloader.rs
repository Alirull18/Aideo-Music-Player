use tauri::{command, AppHandle, Emitter};
use std::process::{Command, Stdio};
use std::path::PathBuf;
use std::io::{BufRead, BufReader, Read};

#[derive(serde::Serialize, Clone)]
struct DownloadProgress {
    percentage: f32,
    status: String,
}

/// Helper to find yt-dlp binary
fn get_ytdlp_command() -> String {
    if Command::new("yt-dlp").arg("--version").output().is_ok() {
        return "yt-dlp".to_string();
    }
    if let Some(local_appdata) = std::env::var_os("LOCALAPPDATA") {
        let winget_path = PathBuf::from(local_appdata)
            .join("Microsoft")
            .join("WinGet")
            .join("Links")
            .join("yt-dlp.exe");
        if winget_path.exists() {
            return winget_path.to_string_lossy().to_string();
        }
    }
    "yt-dlp".to_string()
}

/// Helper to find WinGet Package directories (FFmpeg, Deno, etc)
fn get_package_dir(name_part: &str, sub_bin: &str) -> Option<String> {
    // Check standard WinGet path
    if let Some(local_appdata) = std::env::var_os("LOCALAPPDATA") {
        let base_path = PathBuf::from(local_appdata).join("Microsoft").join("WinGet").join("Packages");
        if let Ok(entries) = std::fs::read_dir(&base_path) {
            for entry in entries.filter_map(|e| e.ok()) {
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if name.contains(name_part) {
                    let package_path = entry.path();
                    if !sub_bin.is_empty() {
                        if let Ok(sub_entries) = std::fs::read_dir(&package_path) {
                            for sub in sub_entries.filter_map(|e| e.ok()) {
                                let bin_path = sub.path().join(sub_bin);
                                if bin_path.exists() { return Some(bin_path.to_string_lossy().to_string()); }
                            }
                        }
                    }
                    let direct_path = if sub_bin.is_empty() { package_path.clone() } else { package_path.join(sub_bin) };
                    if direct_path.exists() { return Some(direct_path.to_string_lossy().to_string()); }
                }
            }
        }
    }
    
    // Fallback: Check common user-level install paths (like .deno for Deno)
    if name_part == "deno" {
        if let Some(home) = std::env::var_os("USERPROFILE") {
            let deno_home = PathBuf::from(home).join(".deno").join("bin");
            if deno_home.exists() { return Some(deno_home.to_string_lossy().to_string()); }
        }
    }

    None
}

/// Returns the standard set of arguments used to bypass YouTube blocks
fn get_stealth_args() -> Vec<String> {
    vec![
        "--no-playlist".to_string(),
        "--newline".to_string(),
        "--no-part".to_string(),
        "--force-ipv4".to_string(),
        "--no-check-certificates".to_string(),
        // Use a realistic Mobile Chrome identity
        "--user-agent".to_string(), "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36".to_string(),
        // The "mweb" client is currently the most stable for bypassing PO Tokens
        "--extractor-args".to_string(), "youtube:player_client=mweb".to_string(),
        "--youtube-skip-dash-manifest".to_string(),
        "--youtube-skip-hls-manifest".to_string(),
    ]
}

#[command]
pub async fn download_youtube(app: AppHandle, url: String, save_path: String) -> Result<String, String> {
    let cmd_path = get_ytdlp_command();
    let ffmpeg_dir = get_package_dir("ffmpeg", "bin");
    let deno_dir = get_package_dir("deno", "");

    let mut cmd = Command::new(&cmd_path);
    
    // Base Download Config
    cmd.args(["-x", "--audio-format", "m4a", "-f", "bestaudio/best"]);
    
    // Stealth Bypass Config
    cmd.args(get_stealth_args());
    
    // Output Path
    cmd.arg("-o").arg(&save_path);

    if let Some(ref dir) = ffmpeg_dir {
        cmd.arg("--ffmpeg-location").arg(dir);
    }

    // Add Deno to PATH if found to satisfy YouTube JS runtime requirement
    if let Some(dir) = deno_dir {
        if let Some(old_path) = std::env::var_os("PATH") {
            let mut paths = std::env::split_paths(&old_path).collect::<Vec<_>>();
            paths.push(PathBuf::from(dir));
            if let Ok(new_path) = std::env::join_paths(paths) {
                cmd.env("PATH", new_path);
            }
        }
    }

    cmd.arg(&url);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn yt-dlp: {}", e))?;
    let stdout = child.stdout.take().unwrap();
    let mut stderr_pipe = child.stderr.take().unwrap();
    let reader = BufReader::new(stdout);

    for line in reader.lines().filter_map(|l| l.ok()) {
        if line.contains("[download]") && line.contains("%") {
            if let Some(pct_str) = line.split_whitespace().find(|s| s.contains("%")) {
                let pct = pct_str.trim_end_matches('%').parse::<f32>().unwrap_or(0.0);
                let _ = app.emit("download-progress", DownloadProgress {
                    percentage: pct,
                    status: format!("Downloading... {}%", pct),
                });
            }
        } else if line.contains("[ExtractAudio]") {
            let _ = app.emit("download-progress", DownloadProgress {
                percentage: 100.0,
                status: "Extracting Audio...".to_string(),
            });
        }
    }

    let status = child.wait().map_err(|e| format!("Process error: {}", e))?;

    if status.success() {
        if std::path::Path::new(&save_path).exists() {
            let _ = app.emit("download-progress", DownloadProgress {
                percentage: 100.0,
                status: "Complete".to_string(),
            });
            Ok(save_path)
        } else {
            Err("yt-dlp finished but the audio file was not created. Check your save path permissions.".to_string())
        }
    } else {
        let mut stderr_content = String::new();
        let _ = stderr_pipe.read_to_string(&mut stderr_content);
        Err(format!("yt-dlp error: {}", stderr_content.trim()))
    }
}

#[command]
pub async fn get_video_title(url: String) -> Result<String, String> {
    let cmd_path = get_ytdlp_command();
    let mut cmd = Command::new(&cmd_path);
    
    cmd.arg("--get-title");
    cmd.args(get_stealth_args());
    cmd.arg(&url);

    let output = cmd.output().map_err(|e| format!("Failed to run yt-dlp: {}", e))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("yt-dlp error: {}", stderr.trim()))
    }
}
