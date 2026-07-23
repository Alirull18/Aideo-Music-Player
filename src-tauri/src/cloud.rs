use serde::Serialize;
use rand::Rng;

#[derive(Serialize, Clone, Debug)]
pub struct CloudTrack {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: f64, // in seconds
    pub cover_url: Option<String>,
    pub stream_url: String,
    pub provider: String, // "subsonic" or "jellyfin"
    pub path_hash: Option<String>,
}

// ── Subsonic Commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn subsonic_ping(url: String, user: String, pass: String) -> Result<bool, String> {
    let clean_url = url.trim_end_matches('/');
    
    // Hash password with a random 8-character salt inside a temporary scope to drop Rng before await
    let (hash, salt) = {
        let chars: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        let mut rng = rand::rng();
        let salt: String = (0..8)
            .map(|_| {
                let idx = rng.random_range(0..chars.len());
                chars[idx] as char
            })
            .collect();
        
        let hash_input = format!("{}{}", pass, salt);
        let hash = format!("{:x}", md5::compute(hash_input.as_bytes()));
        (hash, salt)
    };
    
    let query_url = format!(
        "{}/rest/ping.view?u={}&t={}&s={}&v=1.16.1&c=aideo&f=json",
        clean_url,
        urlencoding::encode(&user),
        hash,
        salt
    );
    
    let client = crate::get_http_client();
    let res = client.get(&query_url)
        .send()
        .await
        .map_err(|e| format!("Network request failed: {}", e))?;
        
    let status = res.status();
    if !status.is_success() {
        return Err(format!("Server returned HTTP status: {}", status));
    }
    
    let body = res.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
    let json: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse response JSON: {}", e))?;
        
    let response_node = &json["subsonic-response"];
    if response_node["status"].as_str() == Some("ok") {
        Ok(true)
    } else {
        if let Some(err) = response_node["error"]["message"].as_str() {
            Err(err.to_string())
        } else {
            Err("Authentication failed or invalid server response".to_string())
        }
    }
}

#[tauri::command]
pub async fn subsonic_search(url: String, user: String, pass: String, query: String) -> Result<Vec<CloudTrack>, String> {
    let clean_url = url.trim_end_matches('/');
    
    // Scoped to drop ThreadRng before await
    let (hash, salt) = {
        let chars: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        let mut rng = rand::rng();
        let salt: String = (0..8)
            .map(|_| {
                let idx = rng.random_range(0..chars.len());
                chars[idx] as char
            })
            .collect();
        
        let hash_input = format!("{}{}", pass, salt);
        let hash = format!("{:x}", md5::compute(hash_input.as_bytes()));
        (hash, salt)
    };
    
    let query_url = format!(
        "{}/rest/search3.view?query={}&u={}&t={}&s={}&v=1.16.1&c=aideo&f=json",
        clean_url,
        urlencoding::encode(&query),
        urlencoding::encode(&user),
        hash,
        salt
    );
    
    let client = crate::get_http_client();
    let res = client.get(&query_url)
        .send()
        .await
        .map_err(|e| format!("Network request failed: {}", e))?;
        
    let body = res.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
    let json: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse response JSON: {}", e))?;
        
    let response_node = &json["subsonic-response"];
    if response_node["status"].as_str() != Some("ok") {
        if let Some(err) = response_node["error"]["message"].as_str() {
            return Err(err.to_string());
        }
        return Err("Subsonic search query failed".to_string());
    }
    
    let mut results = Vec::new();
    if let Some(songs) = response_node["searchResult3"]["song"].as_array() {
        for song in songs {
            let id = song["id"].as_str().unwrap_or("").to_string();
            let title = song["title"].as_str().unwrap_or("Unknown").to_string();
            let artist = song["artist"].as_str().unwrap_or("Unknown Artist").to_string();
            let album = song["album"].as_str().unwrap_or("Unknown Album").to_string();
            let duration = song["duration"].as_f64().or_else(|| song["duration"].as_i64().map(|v| v as f64)).unwrap_or(0.0);
            
            let cover_art_id = song["coverArt"].as_str().or_else(|| song["id"].as_str());
            let cover_url = cover_art_id.map(|cover_id| {
                format!(
                    "{}/rest/getCoverArt.view?id={}&u={}&t={}&s={}&v=1.16.1&c=aideo&f=json",
                    clean_url,
                    cover_id,
                    urlencoding::encode(&user),
                    hash,
                    salt
                )
            });
            
            // Stream URL resolution
            let stream_url = format!(
                "{}/rest/stream.view?id={}&u={}&t={}&s={}&v=1.16.1&c=aideo&f=json&title={}&artist={}&album={}",
                clean_url,
                id,
                urlencoding::encode(&user),
                hash,
                salt,
                urlencoding::encode(&title),
                urlencoding::encode(&artist),
                urlencoding::encode(&album)
            );
            
            let path_hash = Some(format!("{:x}", md5::compute(stream_url.as_bytes())));
            
            results.push(CloudTrack {
                id,
                title,
                artist,
                album,
                duration,
                cover_url,
                stream_url,
                provider: "subsonic".to_string(),
                path_hash,
            });
        }
    }
    
    Ok(results)
}

// ── Jellyfin Commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn jellyfin_ping(url: String, api_key: String) -> Result<bool, String> {
    let clean_url = url.trim_end_matches('/');
    let query_url = format!("{}/System/Info?api_key={}", clean_url, api_key);
    
    let client = crate::get_http_client();
    let res = client.get(&query_url)
        .send()
        .await
        .map_err(|e| format!("Network request failed: {}", e))?;
        
    let status = res.status();
    if status.is_success() {
        Ok(true)
    } else {
        Err(format!("Server returned HTTP status: {}", status))
    }
}

#[tauri::command]
pub async fn jellyfin_search(url: String, api_key: String, query: String) -> Result<Vec<CloudTrack>, String> {
    let clean_url = url.trim_end_matches('/');
    let query_url = format!(
        "{}/Items?searchTerm={}&IncludeItemTypes=Audio&Recursive=true&Fields=PrimaryImageAspectRatio,SortName&api_key={}",
        clean_url,
        urlencoding::encode(&query),
        api_key
    );
    
    let client = crate::get_http_client();
    let res = client.get(&query_url)
        .send()
        .await
        .map_err(|e| format!("Network request failed: {}", e))?;
        
    let body = res.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
    let json: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse response JSON: {}", e))?;
        
    let mut results = Vec::new();
    if let Some(items) = json["Items"].as_array() {
        for item in items {
            let id = item["Id"].as_str().unwrap_or("").to_string();
            let title = item["Name"].as_str().unwrap_or("Unknown").to_string();
            let album = item["Album"].as_str().unwrap_or("Unknown Album").to_string();
            
            // Extract artist list from Artists array, fallback to AlbumArtist
            let artist = if let Some(artists) = item["Artists"].as_array() {
                let list: Vec<String> = artists.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect();
                if !list.is_empty() {
                    list.join(", ")
                } else {
                    item["AlbumArtist"].as_str().unwrap_or("Unknown Artist").to_string()
                }
            } else {
                item["AlbumArtist"].as_str().unwrap_or("Unknown Artist").to_string()
            };
            
            // Jellyfin tick duration (1 tick = 100ns)
            let ticks = item["RunTimeTicks"].as_f64().or_else(|| item["RunTimeTicks"].as_i64().map(|v| v as f64)).unwrap_or(0.0);
            let duration = ticks / 10_000_000.0;
            
            // Image resolution
            let has_image = item["ImageTags"]["Primary"].is_string();
            let cover_url = if has_image {
                Some(format!(
                    "{}/Items/{}/Images/Primary?api_key={}",
                    clean_url,
                    id,
                    api_key
                ))
            } else {
                None
            };
            
            // Stream URL resolution
            let stream_url = format!(
                "{}/Audio/{}/stream?api_key={}&title={}&artist={}&album={}",
                clean_url,
                id,
                api_key,
                urlencoding::encode(&title),
                urlencoding::encode(&artist),
                urlencoding::encode(&album)
            );
            
            let path_hash = Some(format!("{:x}", md5::compute(stream_url.as_bytes())));
            
            results.push(CloudTrack {
                id,
                title,
                artist,
                album,
                duration,
                cover_url,
                stream_url,
                provider: "jellyfin".to_string(),
                path_hash,
            });
        }
    }
    
    Ok(results)
}

#[tauri::command]
pub async fn subsonic_get_library(
    url: String,
    user: String,
    pass: String,
    query: String,
    offset: u32,
    limit: u32,
) -> Result<Vec<CloudTrack>, String> {
    let clean_url = url.trim_end_matches('/');
    
    let (hash, salt) = {
        let chars: &[u8] = b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        let mut rng = rand::rng();
        let salt: String = (0..8)
            .map(|_| {
                let idx = rng.random_range(0..chars.len());
                chars[idx] as char
            })
            .collect();
        let hash_input = format!("{}{}", pass, salt);
        let hash = format!("{:x}", md5::compute(hash_input.as_bytes()));
        (hash, salt)
    };
    
    let search_query = if query.is_empty() { "*".to_string() } else { query };

    let query_url = format!(
        "{}/rest/search3.view?query={}&songOffset={}&songCount={}&u={}&t={}&s={}&v=1.16.1&c=aideo&f=json",
        clean_url,
        urlencoding::encode(&search_query),
        offset,
        limit,
        urlencoding::encode(&user),
        hash,
        salt
    );
    
    let client = crate::get_http_client();
    let res = client.get(&query_url)
        .send()
        .await
        .map_err(|e| format!("Network request failed: {}", e))?;
        
    let body = res.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
    let json: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse response JSON: {}", e))?;
        
    let response_node = &json["subsonic-response"];
    if response_node["status"].as_str() != Some("ok") {
        if let Some(err) = response_node["error"]["message"].as_str() {
            return Err(err.to_string());
        }
        return Err("Subsonic library query failed".to_string());
    }
    
    let mut results = Vec::new();
    if let Some(songs) = response_node["searchResult3"]["song"].as_array() {
        for song in songs {
            let id = song["id"].as_str().unwrap_or("").to_string();
            let title = song["title"].as_str().unwrap_or("Unknown").to_string();
            let artist = song["artist"].as_str().unwrap_or("Unknown Artist").to_string();
            let album = song["album"].as_str().unwrap_or("Unknown Album").to_string();
            let duration = song["duration"].as_f64().or_else(|| song["duration"].as_i64().map(|v| v as f64)).unwrap_or(0.0);
            
            let cover_art_id = song["coverArt"].as_str().or_else(|| song["id"].as_str());
            let cover_url = cover_art_id.map(|cover_id| {
                format!(
                    "{}/rest/getCoverArt.view?id={}&u={}&t={}&s={}&v=1.16.1&c=aideo&f=json",
                    clean_url,
                    cover_id,
                    urlencoding::encode(&user),
                    hash,
                    salt
                )
            });
            
            let stream_url = format!(
                "{}/rest/stream.view?id={}&u={}&t={}&s={}&v=1.16.1&c=aideo&f=json&title={}&artist={}&album={}",
                clean_url,
                id,
                urlencoding::encode(&user),
                hash,
                salt,
                urlencoding::encode(&title),
                urlencoding::encode(&artist),
                urlencoding::encode(&album)
            );
            
            let path_hash = Some(format!("{:x}", md5::compute(stream_url.as_bytes())));
            
            results.push(CloudTrack {
                id,
                title,
                artist,
                album,
                duration,
                cover_url,
                stream_url,
                provider: "subsonic".to_string(),
                path_hash,
            });
        }
    }
    
    results.sort_by_key(|a| a.title.to_lowercase());
    Ok(results)
}

pub fn xor_cipher(data: &[u8]) -> Vec<u8> {
    let key = b"AIDEO_OFFLINE_CACHE_KEY_2026";
    data.iter()
        .enumerate()
        .map(|(i, &byte)| byte ^ key[i % key.len()])
        .collect()
}

#[tauri::command]
pub async fn cache_cloud_track(app_handle: tauri::AppHandle, stream_url: String) -> Result<bool, String> {
    let hash = format!("{:x}", md5::compute(stream_url.as_bytes()));
    let Some(data_dir) = dirs::data_dir() else {
        return Err("Failed to resolve data directory".to_string());
    };
    let cache_dir = data_dir.join("Aideo").join("CloudCache");
    std::fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    
    let cache_path = cache_dir.join(format!("{}.cache", hash));
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
    
    let temp_path = cache_dir.join(format!("{}.tmp", hash));
    
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

#[tauri::command]
pub async fn jellyfin_get_library(
    url: String,
    api_key: String,
    query: String,
    offset: u32,
    limit: u32,
) -> Result<Vec<CloudTrack>, String> {
    let clean_url = url.trim_end_matches('/');
    
    let search_part = if query.is_empty() {
        "".to_string()
    } else {
        format!("&searchTerm={}", urlencoding::encode(&query))
    };

    let query_url = format!(
        "{}/Items?IncludeItemTypes=Audio&Recursive=true&SortBy=SortName&SortOrder=Ascending&StartIndex={}&Limit={}{}&Fields=PrimaryImageAspectRatio,SortName&api_key={}",
        clean_url,
        offset,
        limit,
        search_part,
        api_key
    );
    
    let client = crate::get_http_client();
    let res = client.get(&query_url)
        .send()
        .await
        .map_err(|e| format!("Network request failed: {}", e))?;
        
    let body = res.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
    let json: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse response JSON: {}", e))?;
        
    let mut results = Vec::new();
    if let Some(items) = json["Items"].as_array() {
        for item in items {
            let id = item["Id"].as_str().unwrap_or("").to_string();
            let title = item["Name"].as_str().unwrap_or("Unknown").to_string();
            let album = item["Album"].as_str().unwrap_or("Unknown Album").to_string();
            
            let artist = if let Some(artists) = item["Artists"].as_array() {
                let list: Vec<String> = artists.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect();
                if !list.is_empty() {
                    list.join(", ")
                } else {
                    item["AlbumArtist"].as_str().unwrap_or("Unknown Artist").to_string()
                }
            } else {
                item["AlbumArtist"].as_str().unwrap_or("Unknown Artist").to_string()
            };
            
            let ticks = item["RunTimeTicks"].as_f64().or_else(|| item["RunTimeTicks"].as_i64().map(|v| v as f64)).unwrap_or(0.0);
            let duration = ticks / 10_000_000.0;
            
            let has_image = item["ImageTags"]["Primary"].is_string();
            let cover_url = if has_image {
                Some(format!(
                    "{}/Items/{}/Images/Primary?api_key={}",
                    clean_url,
                    id,
                    api_key
                ))
            } else {
                None
            };
            
            let stream_url = format!(
                "{}/Audio/{}/stream?api_key={}&title={}&artist={}&album={}",
                clean_url,
                id,
                api_key,
                urlencoding::encode(&title),
                urlencoding::encode(&artist),
                urlencoding::encode(&album)
            );
            
            let path_hash = Some(format!("{:x}", md5::compute(stream_url.as_bytes())));
            
            results.push(CloudTrack {
                id,
                title,
                artist,
                album,
                duration,
                cover_url,
                stream_url,
                provider: "jellyfin".to_string(),
                path_hash,
            });
        }
    }
    
    Ok(results)
}

fn subsonic_decrypt(input: &str) -> Result<String, String> {
    use base64::Engine;
    let decoded = base64::engine::general_purpose::STANDARD.decode(input.as_bytes()).map_err(|e| e.to_string())?;
    let key = b"aideo_music_player_secret_key_123";
    let decrypted: Vec<u8> = decoded.iter().zip(key.iter().cycle()).map(|(b, k)| b ^ k).collect();
    String::from_utf8(decrypted).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_subsonic_password(app_handle: tauri::AppHandle, pass: String) -> Result<(), String> {
    use keyring::Entry;
    let entry = Entry::new("AideoMusicPlayer", "subsonic_password").map_err(|e| e.to_string())?;
    if pass.is_empty() {
        let _ = entry.delete_credential();
    } else {
        entry.set_password(&pass).map_err(|e| e.to_string())?;
    }
    
    // Also cleanup old file if it exists
    use tauri::Manager;
    if let Ok(app_data) = app_handle.path().app_data_dir() {
        let pass_file = app_data.join("subsonic_pass.enc");
        if pass_file.exists() {
            let _ = std::fs::remove_file(pass_file);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_subsonic_password(app_handle: tauri::AppHandle) -> Result<String, String> {
    use keyring::{Entry, Error};
    let entry = Entry::new("AideoMusicPlayer", "subsonic_password").map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(pass) => Ok(pass),
        Err(Error::NoEntry) => {
            // Check if there is an old encrypted file to migrate
            use tauri::Manager;
            if let Ok(app_data) = app_handle.path().app_data_dir() {
                let pass_file = app_data.join("subsonic_pass.enc");
                if pass_file.exists() {
                    if let Ok(content) = std::fs::read_to_string(&pass_file) {
                        if let Ok(decrypted) = subsonic_decrypt(&content) {
                            // Migrate to keyring
                            if entry.set_password(&decrypted).is_ok() {
                                // Delete old file
                                let _ = std::fs::remove_file(pass_file);
                                return Ok(decrypted);
                            }
                        }
                    }
                }
            }
            Ok(String::new())
        }
        Err(e) => Err(e.to_string()),
    }
}

pub fn prune_cache_to_limit_internal(app_handle: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let limit_gb = if let Ok(app_data) = app_handle.path().app_data_dir() {
        let limit_file = app_data.join("cache_limit_gb.txt");
        if limit_file.exists() {
            if let Ok(content) = std::fs::read_to_string(limit_file) {
                content.trim().parse::<f64>().unwrap_or(5.0)
            } else {
                5.0
            }
        } else {
            5.0
        }
    } else {
        5.0
    };

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
    if let Ok(app_data) = app_handle.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&app_data);
        let limit_file = app_data.join("cache_limit_gb.txt");
        let _ = std::fs::write(limit_file, limit_gb.to_string());
    }
    prune_cache_to_limit_internal(&app_handle)
}

#[tauri::command]
pub fn check_url_is_cached(url: String) -> bool {
    let hash = format!("{:x}", md5::compute(url.as_bytes()));
    if let Some(data_dir) = dirs::data_dir() {
        let cache_path = data_dir.join("Aideo").join("CloudCache").join(format!("{}.cache", hash));
        return cache_path.exists();
    }
    false
}



