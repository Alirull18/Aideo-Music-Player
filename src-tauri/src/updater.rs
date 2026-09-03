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
            if asset.name.ends_with(".sha256") || asset.name.ends_with(".sha256sum") {
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

    let actual_hash = hex::encode(hasher.finalize());
    if let Err(e) = validate_sha256_checksum(expected_sha256.as_deref(), &actual_hash) {
        let _ = tokio::fs::remove_file(&temp_file_path).await;
        return Err(e);
    }
    
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x00000008;

        if is_msi {
            Command::new("msiexec.exe")
                .arg("/i")
                .arg(&temp_file_path)
                .arg("/qb")
                .creation_flags(DETACHED_PROCESS)
                .spawn()
                .map_err(|e| format!("Failed to execute MSI installer: {}", e))?;
        } else {
            Command::new(&temp_file_path)
                .creation_flags(DETACHED_PROCESS)
                .spawn()
                .map_err(|e| format!("Failed to execute installer binary: {}", e))?;
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        #[cfg(target_os = "macos")]
        {
            Command::new("open")
                .arg(&temp_file_path)
                .spawn()
                .map_err(|e| format!("Failed to open installer: {}", e))?;
        }
        #[cfg(not(target_os = "macos"))]
        {
            Command::new("xdg-open")
                .arg(&temp_file_path)
                .spawn()
                .map_err(|e| format!("Failed to open installer: {}", e))?;
        }
    }

    app_handle.exit(0);
    
    Ok(())
}

/// Extract the hash token from a `.sha256` sidecar string.
/// Sidecars are typically "<hash>  <filename>\n"; bare hashes also accepted.
pub fn extract_sha256_token(sidecar: &str) -> String {
    sidecar.trim().to_lowercase().split_whitespace().next().unwrap_or("").to_string()
}

/// Validate that a remote SHA256 token is valid and matches the actual computed SHA256 hex digest.
pub fn validate_sha256_checksum(expected: Option<&str>, actual: &str) -> Result<String, String> {
    let expected_str = expected.ok_or_else(|| {
        "Mandatory SHA256 checksum missing: installation aborted for security.".to_string()
    })?;
    let expected_clean = extract_sha256_token(expected_str);
    if expected_clean.len() != 64 || !expected_clean.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("Mandatory SHA256 checksum missing or malformed: installation aborted for security.".to_string());
    }

    let actual_clean = actual.trim().to_lowercase();
    if actual_clean != expected_clean {
        return Err(format!(
            "SHA256 checksum mismatch! Expected {}, got {}",
            expected_clean, actual_clean
        ));
    }

    Ok(expected_clean)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_newer() {
        assert!(is_newer("v0.9.5", "v0.9.4"));
        assert!(is_newer("1.0.0", "0.9.4"));
        assert!(!is_newer("v0.9.4", "v0.9.4"));
        assert!(!is_newer("v0.9.3", "v0.9.4"));
    }

    #[test]
    fn test_is_trusted_github_url() {
        assert!(is_trusted_github_url("https://github.com/Alirul/Aideo-Music-Player/releases/download/v0.9.4/aideo.exe"));
        assert!(is_trusted_github_url("https://objects.githubusercontent.com/github-production-release-asset/123"));
        assert!(!is_trusted_github_url("https://malicious-domain.com/setup.exe"));
        assert!(!is_trusted_github_url("http://github.com/insecure"));
    }

    #[test]
    fn test_is_sha256_sidecar_extension() {
        let is_sidecar = |name: &str| name.ends_with(".sha256") || name.ends_with(".sha256sum");
        assert!(is_sidecar("aideo.exe.sha256"));
        assert!(is_sidecar("aideo.msi.sha256sum"));
        assert!(!is_sidecar("aideo.exe.sig")); // minisign signature must not be parsed as sha256
        assert!(!is_sidecar("aideo.msi.zip.sig"));
    }

    #[test]
    fn test_extract_sha256_token_sidecar_with_filename() {
        let hash = "a".repeat(64);
        assert_eq!(extract_sha256_token(&format!("{}  aideo_0.9.5_x64.exe\n", hash)), hash);
    }

    #[test]
    fn test_extract_sha256_token_bare_hash() {
        let hash = "b".repeat(64);
        assert_eq!(extract_sha256_token(&hash), hash);
    }

    #[test]
    fn test_extract_sha256_token_uppercase_normalized() {
        let hash = "C".repeat(64);
        assert_eq!(extract_sha256_token(&format!("{}  file.msi", hash)), hash.to_lowercase());
    }

    #[test]
    fn test_extract_sha256_token_empty() {
        assert_eq!(extract_sha256_token(""), "");
        assert_eq!(extract_sha256_token("   \n"), "");
    }

    #[test]
    fn test_validate_sha256_checksum_valid_exact() {
        let hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        let res = validate_sha256_checksum(Some(hash), hash);
        assert_eq!(res, Ok(hash.to_string()));
    }

    #[test]
    fn test_validate_sha256_checksum_valid_sidecar() {
        let hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        let sidecar = format!("{}  aideo_installer.exe\n", hash);
        let res = validate_sha256_checksum(Some(&sidecar), hash);
        assert_eq!(res, Ok(hash.to_string()));
    }

    #[test]
    fn test_validate_sha256_checksum_none_rejected() {
        let hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        let res = validate_sha256_checksum(None, hash);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("missing"));
    }

    #[test]
    fn test_validate_sha256_checksum_empty_rejected() {
        let hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        let res = validate_sha256_checksum(Some("   "), hash);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("missing or malformed"));
    }

    #[test]
    fn test_validate_sha256_checksum_malformed_hex_rejected() {
        let actual = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        // Invalid character 'z' in 64-char string
        let malformed = "z3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        let res = validate_sha256_checksum(Some(malformed), actual);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("missing or malformed"));

        // Short length (63 chars)
        let short_hash = &actual[..63];
        let res2 = validate_sha256_checksum(Some(short_hash), actual);
        assert!(res2.is_err());
        assert!(res2.unwrap_err().contains("missing or malformed"));
    }

    #[test]
    fn test_validate_sha256_checksum_mismatch_rejected() {
        let hash1 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
        let hash2 = "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb";
        let res = validate_sha256_checksum(Some(hash1), hash2);
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("checksum mismatch"));
    }
}


