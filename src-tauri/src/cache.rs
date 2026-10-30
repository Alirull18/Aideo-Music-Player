//! Provider-neutral stream cache and keyring helpers (formerly part of cloud.rs).

/// ponytail: fixed-key XOR is obfuscation for on-disk cache files, not encryption; kept for
/// compatibility with existing `.cache` files. Switch to an AEAD with a per-install key if needed.
pub fn xor_cipher(data: &[u8]) -> Vec<u8> {
    let key = b"AIDEO_OFFLINE_CACHE_KEY_2026";
    data.iter()
        .enumerate()
        .map(|(i, &byte)| byte ^ key[i % key.len()])
        .collect()
}

pub fn rendition_cache_key(namespace: &str, provider: &str, source_id: &str, rendition_format: &str) -> String {
    crate::player::rendition_cache_key(namespace, provider, source_id, rendition_format)
}

#[tauri::command]
pub async fn cache_cloud_track(app_handle: tauri::AppHandle, stream_url: String) -> Result<bool, String> {
    let parsed_url = url::Url::parse(&stream_url).map_err(|e| format!("Invalid stream URL: {}", e))?;
    if parsed_url.scheme() != "http" && parsed_url.scheme() != "https" {
        return Err("Invalid stream URL scheme: only http and https are permitted".to_string());
    }

    let (cache_path, temp_path) = crate::player::get_cache_paths(&stream_url)
        .ok_or_else(|| "Failed to resolve cache path".to_string())?;
    if cache_path.exists() {
        return Ok(true); // Already cached
    }

    // Download cloud track bytes
    let client = reqwest::Client::new();
    let res = client.get(&stream_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download cloud track: {}", e))?;

    // Guard against infinite streams and files over 150MB to prevent memory exhaustion
    if res.content_length().is_none() {
        return Err("Cannot cache infinite stream (missing Content-Length)".to_string());
    }
    if let Some(len) = res.content_length() {
        if len > 150 * 1024 * 1024 {
            return Err("File size exceeds 150MB limit".to_string());
        }
    }

    use futures::StreamExt;
    use tokio::io::AsyncWriteExt;

    let mut file = tokio::fs::File::create(&temp_path).await
        .map_err(|e| format!("Failed to create temp file: {}", e))?;

    let mut stream = res.bytes_stream();
    let mut bytes_written = 0;
    let key = b"AIDEO_OFFLINE_CACHE_KEY_2026";

    while let Some(chunk_res) = stream.next().await {
        let chunk = chunk_res.map_err(|e| format!("Stream read error: {}", e))?;
        let mut chunk_vec = chunk.to_vec();
        for idx in 0..chunk_vec.len() {
            let global_pos = bytes_written + idx;
            chunk_vec[idx] ^= key[global_pos % key.len()];
        }
        file.write_all(&chunk_vec).await.map_err(|e| format!("Write failed: {}", e))?;
        bytes_written += chunk_vec.len();
    }

    file.flush().await.map_err(|e| format!("Flush failed: {}", e))?;
    drop(file);

    if bytes_written < 1024 {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return Err("Cloud track stream truncated (under 1024 bytes)".to_string());
    }

    tokio::fs::rename(&temp_path, &cache_path).await.map_err(|e| format!("Rename failed: {}", e))?;

    let _ = prune_cache_to_limit_internal(&app_handle);

    Ok(true)
}

#[tauri::command]
pub fn get_all_cached_cloud_hashes() -> Result<Vec<String>, String> {
    let Some(data_dir) = dirs::data_dir() else {
        return Err("Failed to resolve data directory".to_string());
    };
    let cache_dir = data_dir.join("Aideo").join("CloudCache");
    if !cache_dir.exists() {
        return Ok(Vec::new());
    }

    let mut hashes = Vec::new();
    if let Ok(entries) = std::fs::read_dir(cache_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().is_some_and(|ext| ext == "cache") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    hashes.push(stem.to_string());
                }
            }
        }
    }
    Ok(hashes)
}

#[tauri::command]
pub fn get_url_hash(url: String) -> String {
    format!("{:x}", md5::compute(url.as_bytes()))
}

pub(crate) fn cache_limit_gb(app_handle: &tauri::AppHandle) -> f64 {
    use tauri::Manager;
    app_handle.path().app_data_dir().ok()
        .and_then(|dir| std::fs::read_to_string(dir.join("cache_limit_gb.txt")).ok())
        .and_then(|value| value.trim().parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(5.0)
}

pub fn prune_cache_to_limit_internal(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let limit_gb = cache_limit_gb(app_handle);

    let Some(data_dir) = dirs::data_dir() else {
        return Err("Failed to resolve data directory".to_string());
    };
    let cloud_cache = data_dir.join("Aideo").join("CloudCache");
    let ytdlp_cache = data_dir.join("Aideo").join("cache");

    let limit_bytes = (limit_gb * 1024.0 * 1024.0 * 1024.0) as u64;

    let mut files = Vec::new();
    let mut total_size = 0u64;

    // 1. Scan CloudCache
    if cloud_cache.exists() {
        if let Ok(entries) = std::fs::read_dir(&cloud_cache) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let is_cache_or_tmp = path.extension()
                        .map(|ext| ext == "cache" || ext == "tmp")
                        .unwrap_or(false);

                    if is_cache_or_tmp {
                        if let Ok(metadata) = std::fs::metadata(&path) {
                            let size = metadata.len();
                            let modified = metadata.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                            total_size += size;
                            files.push((path, size, modified));
                        }
                    }
                }
            }
        }
    }

    // 2. Scan yt-dlp cache directory
    if ytdlp_cache.exists() {
        if let Ok(entries) = std::fs::read_dir(&ytdlp_cache) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Ok(metadata) = std::fs::metadata(&path) {
                        let size = metadata.len();
                        let modified = metadata.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                        total_size += size;
                        files.push((path, size, modified));
                    }
                }
            }
        }
    }

    // 3. Scan system temp directory for aideo_cache_*
    if let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
                    if filename.starts_with("aideo_cache_") {
                        if let Ok(metadata) = std::fs::metadata(&path) {
                            let size = metadata.len();
                            let modified = metadata.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH);
                            total_size += size;
                            files.push((path, size, modified));
                        }
                    }
                }
            }
        }
    }

    if total_size > limit_bytes {
        files.sort_by_key(|f| f.2);

        println!(
            "[cache-manager] Combined cache size ({} MB) exceeds limit ({} MB). Pruning oldest LRU files...",
            total_size / (1024 * 1024),
            limit_bytes / (1024 * 1024)
        );

        let target_size = (limit_bytes as f64 * 0.75) as u64; // 75% target threshold (3.75 GB)

        for (path, size, _) in files {
            if total_size <= target_size {
                break;
            }
            if std::fs::remove_file(&path).is_ok() {
                total_size = total_size.saturating_sub(size);
                println!("[cache-manager] Pruned cache file: {:?}", path.file_name().unwrap_or_default());
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn prune_cache_to_limit(app_handle: tauri::AppHandle, limit_gb: f64) -> Result<(), String> {
    use tauri::Manager;
    if !limit_gb.is_finite() || limit_gb <= 0.0 {
        return Err("Cache limit must be a finite positive number of GB".to_string());
    }
    let app_data = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&app_data).map_err(|e| e.to_string())?;
    std::fs::write(app_data.join("cache_limit_gb.txt"), limit_gb.to_string()).map_err(|e| e.to_string())?;
    prune_cache_to_limit_internal(&app_handle)
}

#[tauri::command]
pub fn check_url_is_cached(url: String) -> bool {
    if let Some((cache_path, _)) = crate::player::get_cache_paths(&url) {
        if cache_path.exists() {
            return true;
        }
    }
    let hash = format!("{:x}", md5::compute(url.as_bytes()));
    if let Some(data_dir) = dirs::data_dir() {
        let cache_path = data_dir.join("Aideo").join("CloudCache").join(format!("{}.cache", hash));
        return cache_path.exists();
    }
    false
}

#[tauri::command]
pub async fn save_keyring_secret(service: String, secret: String) -> Result<(), String> {
    use keyring::Entry;
    let entry = Entry::new("AideoMusicPlayer", &service).map_err(|e| e.to_string())?;
    if secret.is_empty() {
        let _ = entry.delete_credential();
    } else {
        entry.set_password(&secret).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_keyring_secret(service: String) -> Result<String, String> {
    use keyring::{Entry, Error};
    let entry = Entry::new("AideoMusicPlayer", &service).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(pass) => Ok(pass),
        Err(Error::NoEntry) => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn delete_keyring_secret(service: String) -> Result<(), String> {
    use keyring::Entry;
    let entry = Entry::new("AideoMusicPlayer", &service).map_err(|e| e.to_string())?;
    let _ = entry.delete_credential();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xor_cipher_round_trips_and_stays_compatible() {
        let plain = b"cache bytes \x00\xff longer than the 28 byte key to cover wrap-around";
        let cipher = xor_cipher(plain);
        assert_ne!(cipher.as_slice(), plain.as_slice());
        assert_eq!(xor_cipher(&cipher), plain);
        assert_eq!(cipher[0], plain[0] ^ b'A', "existing .cache files use the fixed key");
    }

    #[test]
    fn url_hash_matches_existing_cache_file_names() {
        assert_eq!(get_url_hash("https://x/y".into()), format!("{:x}", md5::compute(b"https://x/y")));
    }
}
