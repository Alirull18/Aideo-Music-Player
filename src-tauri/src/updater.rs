use reqwest::header::USER_AGENT;
use serde::{Deserialize, Serialize};
use std::env;
use std::fs::File;
use std::io::Write;
use std::process::Command;

#[derive(Serialize, Deserialize, Debug)]
pub struct UpdateResponse {
    pub available: bool,
    pub version: String,
    pub download_url: String,
    pub body: String,
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
        let major = parts.get(0).unwrap_or(&"0").parse().unwrap_or(0);
        let minor = parts.get(1).unwrap_or(&"0").parse().unwrap_or(0);
        let patch = parts.get(2).unwrap_or(&"0").parse().unwrap_or(0);
        (major, minor, patch)
    };
    parse(remote) > parse(local)
}

#[tauri::command]
pub async fn check_update(app_handle: tauri::AppHandle) -> Result<UpdateResponse, String> {
    let current_version = app_handle.package_info().version.to_string();
    let client = reqwest::Client::new();
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
        
        for asset in &release.assets {
            if asset.name.ends_with(".exe") {
                download_url = Some(asset.browser_download_url.clone());
                break;
            }
        }
        
        if download_url.is_none() {
            for asset in &release.assets {
                if asset.name.ends_with(".msi") {
                    download_url = Some(asset.browser_download_url.clone());
                    break;
                }
            }
        }

        if let Some(url) = download_url {
            return Ok(UpdateResponse {
                available: true,
                version: remote_version,
                download_url: url,
                body: release.body,
            });
        }
    }

    Ok(UpdateResponse {
        available: false,
        version: current_version,
        download_url: String::new(),
        body: String::new(),
    })
}

#[tauri::command]
pub async fn download_and_install(url: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    let client = reqwest::Client::new();
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    
    let is_msi = url.to_lowercase().ends_with(".msi");
    let ext = if is_msi { "msi" } else { "exe" };
    
    let mut temp_file_path = env::temp_dir();
    temp_file_path.push(format!("aideo_installer.{}", ext));
    
    let bytes = res.bytes().await.map_err(|e| e.to_string())?;
    let mut file = File::create(&temp_file_path).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    
    if is_msi {
        Command::new("msiexec.exe")
            .args(["/i", temp_file_path.to_str().unwrap(), "/qb"])
            .spawn()
            .map_err(|e| e.to_string())?;
    } else {
        Command::new(temp_file_path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    app_handle.exit(0);
    
    Ok(())
}
