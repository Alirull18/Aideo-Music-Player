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
    
    let client = reqwest::Client::new();
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
    
    let client = reqwest::Client::new();
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
            
            results.push(CloudTrack {
                id,
                title,
                artist,
                album,
                duration,
                cover_url,
                stream_url,
                provider: "subsonic".to_string(),
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
    
    let client = reqwest::Client::new();
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
    
    let client = reqwest::Client::new();
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
            
            results.push(CloudTrack {
                id,
                title,
                artist,
                album,
                duration,
                cover_url,
                stream_url,
                provider: "jellyfin".to_string(),
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
    
    let client = reqwest::Client::new();
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
            
            results.push(CloudTrack {
                id,
                title,
                artist,
                album,
                duration,
                cover_url,
                stream_url,
                provider: "subsonic".to_string(),
            });
        }
    }
    
    results.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
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
pub async fn cache_cloud_track(stream_url: String) -> Result<bool, String> {
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
        
    if !res.status().is_success() {
        return Err(format!("Server returned HTTP status: {}", res.status()));
    }
    
    let bytes = res.bytes().await.map_err(|e| format!("Failed to read stream bytes: {}", e))?;
    
    // Encrypt bytes via XOR cipher
    let encrypted_bytes = xor_cipher(&bytes);
    
    // Save to disk
    std::fs::write(&cache_path, encrypted_bytes).map_err(|e| format!("Failed to save cache file: {}", e))?;
    
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
            if path.is_file() && path.extension().map_or(false, |ext| ext == "cache") {
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
    
    let client = reqwest::Client::new();
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
            
            results.push(CloudTrack {
                id,
                title,
                artist,
                album,
                duration,
                cover_url,
                stream_url,
                provider: "jellyfin".to_string(),
            });
        }
    }
    
    Ok(results)
}

fn subsonic_encrypt(input: &str) -> String {
    use base64::Engine;
    let key = b"aideo_music_player_secret_key_123";
    let encrypted: Vec<u8> = input.as_bytes().iter().zip(key.iter().cycle()).map(|(b, k)| b ^ k).collect();
    base64::prelude::BASE64_STANDARD.encode(&encrypted)
}

fn subsonic_decrypt(input: &str) -> Result<String, String> {
    use base64::Engine;
    let decoded = base64::prelude::BASE64_STANDARD.decode(input.as_bytes()).map_err(|e| e.to_string())?;
    let key = b"aideo_music_player_secret_key_123";
    let decrypted: Vec<u8> = decoded.iter().zip(key.iter().cycle()).map(|(b, k)| b ^ k).collect();
    String::from_utf8(decrypted).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_subsonic_password(app_handle: tauri::AppHandle, pass: String) -> Result<(), String> {
    use tauri::Manager;
    if let Ok(app_data) = app_handle.path().app_data_dir() {
        let pass_file = app_data.join("subsonic_pass.enc");
        let _ = std::fs::create_dir_all(&app_data);
        if pass.is_empty() {
            let _ = std::fs::remove_file(pass_file);
        } else {
            let encrypted = subsonic_encrypt(&pass);
            let _ = std::fs::write(pass_file, encrypted);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn get_subsonic_password(app_handle: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    if let Ok(app_data) = app_handle.path().app_data_dir() {
        let pass_file = app_data.join("subsonic_pass.enc");
        if pass_file.exists() {
            if let Ok(content) = std::fs::read_to_string(pass_file) {
                if let Ok(decrypted) = subsonic_decrypt(&content) {
                    return Ok(decrypted);
                }
            }
        }
    }
    Ok(String::new())
}


