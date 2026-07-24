use reqwest::header::USER_AGENT;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::env;
use std::process::Command;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;
use url::Url;

#[derive(Serialize, Deserialize, Debug)]
pub struct UpdateResponse {
    pub available: bool,
    pub version: String,
    pub download_url: String,
    pub body: String,
    pub sha256_url: Option<String>,
}

#[derive(Deserialize, Debug)]
struct GithubRelease {
    tag_name: String,
    body: String,
    assets: Vec<GithubAsset>,
}

#[derive(Deserialize, Debug)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

fn is_newer(remote: &str, local: &str) -> bool {
    let parse = |v: &str| -> (u32, u32, u32) {
        let clean = v.trim_start_matches('v').split('-').next().unwrap_or(v);
        let parts: Vec<&str> = clean.split('.').collect();
        let major = parts.first().unwrap_or(&"0").parse().unwrap_or(0);
        let minor = parts.get(1).unwrap_or(&"0").parse().unwrap_or(0);
        let patch = parts.get(2).unwrap_or(&"0").parse().unwrap_or(0);
        (major, minor, patch)
    };
    parse(remote) > parse(local)
}

fn is_trusted_github_url(url_str: &str) -> bool {
    if let Ok(parsed) = Url::parse(url_str) {
        if parsed.scheme() != "https" {
            return false;
        }
        if let Some(host) = parsed.host_str() {
            let host = host.to_lowercase();
            return host == "github.com"
                || host == "api.github.com"
                || host == "raw.githubusercontent.com"
                || host == "github-releases.githubusercontent.com"
                || host == "objects.githubusercontent.com"
                || host.ends_with(".githubusercontent.com");
        }
    }
    false
}

#[tauri::command]
pub async fn check_update(app_handle: tauri::AppHandle) -> Result<UpdateResponse, String> {
    let current_version = app_handle.package_info().version.to_string();
    let client = crate::get_http_client();
    let url = "https://api.github.com/repos/Alirull18/Aideo-Music-Player/releases/latest";
    
    let res = client
        .get(url)
        .header(USER_AGENT, format!("AideoMusicPlayer/{}", current_version))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let release: GithubRelease = res.json().await.map_err(|e| e.to_string())?;

    let remote_version = release.tag_name.trim_start_matches('v').to_string();
    
    if is_newer(&remote_version, &current_version) {
        let mut download_url = None;
        let mut sha256_url = None;
        
        for asset in &release.assets {
            if asset.name.ends_with(".exe") || asset.name.ends_with(".msi") {
                if download_url.is_none() {
                    download_url = Some(asset.browser_download_url.clone());
                }
            }
            if asset.name.ends_with(".sha256") || asset.name.ends_with(".sig") {
                sha256_url = Some(asset.browser_download_url.clone());
            }
        }

        if let Some(url) = download_url {
            return Ok(UpdateResponse {
                available: true,
                version: remote_version,
                download_url: url,
                body: release.body,
                sha256_url,
            });
        }
    }

    Ok(UpdateResponse {
        available: false,
        version: current_version,
        download_url: String::new(),
        body: String::new(),
        sha256_url: None,
    })
}

#[tauri::command]
pub async fn download_and_install(
    url: String,
    expected_sha256: Option<String>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    if !is_trusted_github_url(&url) {
        return Err("Untrusted update URL domain: updates must originate from official GitHub releases.".to_string());
    }

    let client = crate::get_http_client();
    let mut res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("Download failed with status: {}", res.status()));
    }
    
    let is_msi = url.to_lowercase().ends_with(".msi");
    let ext = if is_msi { "msi" } else { "exe" };
    
    let mut temp_file_path = env::temp_dir();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    temp_file_path.push(format!("aideo_installer_{}.{}", timestamp, ext));
    
    let mut file = File::create(&temp_file_path)
        .await
        .map_err(|e| e.to_string())?;

    let mut hasher = Sha256::new();

    while let Some(chunk) = res.chunk().await.map_err(|e| e.to_string())? {
        hasher.update(&chunk);
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    if let Some(expected_hash) = expected_sha256 {
        let expected_clean = expected_hash.trim().to_lowercase();
        if !expected_clean.is_empty() {
            let actual_hash = hex::encode(hasher.finalize());
            if actual_hash != expected_clean {
                let _ = tokio::fs::remove_file(&temp_file_path).await;
                return Err(format!(
                    "SHA256 checksum mismatch! Expected {}, got {}",
                    expected_clean, actual_hash
                ));
            }
        }
    }
    
    let temp_str = temp_file_path.to_string_lossy().into_owned();
    
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let cmd_str = if is_msi {
            format!("ping 127.0.0.1 -n 6 > nul && msiexec.exe /i \"{}\" /qb && timeout /t 10 > nul && del /f /q \"{}\"", temp_str, temp_str)
        } else {
            format!("ping 127.0.0.1 -n 6 > nul && start \"\" \"{}\" && timeout /t 15 > nul && del /f /q \"{}\"", temp_str, temp_str)
        };
        
        Command::new("cmd.exe")
            .raw_arg(format!("/C {}", cmd_str))
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let cmd_str = format!("sleep 5 && open \"{}\" && sleep 15 && rm -f \"{}\"", temp_str, temp_str);
        Command::new("sh")
            .arg("-c")
            .arg(&cmd_str)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    app_handle.exit(0);
    
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_newer() {
        assert!(is_newer("v0.9.4", "v0.9.3"));
        assert!(is_newer("1.0.0", "0.9.3"));
        assert!(!is_newer("v0.9.3", "v0.9.3"));
        assert!(!is_newer("v0.9.2", "v0.9.3"));
    }

    #[test]
    fn test_is_trusted_github_url() {
        assert!(is_trusted_github_url("https://github.com/Alirull18/Aideo-Music-Player/releases/download/v0.9.3/aideo.exe"));
        assert!(is_trusted_github_url("https://objects.githubusercontent.com/github-production-release-asset/123"));
        assert!(!is_trusted_github_url("https://malicious-domain.com/setup.exe"));
        assert!(!is_trusted_github_url("http://github.com/insecure"));
    }
}


