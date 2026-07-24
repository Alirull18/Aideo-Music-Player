use symphonia::core::probe::Hint;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::formats::FormatOptions;
use symphonia::default::get_probe;
use base64::Engine;

use std::sync::Mutex;
use std::collections::HashMap;

lazy_static::lazy_static! {
    static ref COVER_CACHE: Mutex<HashMap<String, Option<String>>> = Mutex::new(HashMap::new());
}

/// Extracts embedded cover art from an audio file and returns it as a data URL.
pub fn get_cover_art(audio_path: &str) -> Option<String> {
    if let Ok(cache) = COVER_CACHE.lock() {
        if let Some(art) = cache.get(audio_path) {
            return art.clone();
        }
    }

    let path = audio_path.to_string();
    let res = std::panic::catch_unwind(move || extract_art(&path))
        .ok()
        .flatten();

    if let Ok(mut cache) = COVER_CACHE.lock() {
        if cache.len() >= 100 {
            cache.clear();
        }
        cache.insert(audio_path.to_string(), res.clone());
    }

    res
}

fn extract_art(audio_path: &str) -> Option<String> {
    let file = std::fs::File::open(audio_path).ok()?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(audio_path).extension() {
        hint.with_extension(&ext.to_string_lossy());
    }

    let mut probed = get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions {
                limit_metadata_bytes: symphonia::core::meta::Limit::Maximum(1024 * 1024 * 16),
                limit_visual_bytes: symphonia::core::meta::Limit::Maximum(1024 * 1024 * 16),
            },
        )
        .ok()?;

    // Try inline metadata first (MP3, AAC)
    if let Some(meta) = probed.format.metadata().current() {
        if let Some(v) = meta.visuals().first() {
            let encoded = base64::engine::general_purpose::STANDARD.encode(&*v.data);
            let mime = if v.media_type.is_empty() { "image/jpeg" } else { &v.media_type };
            return Some(format!("data:{mime};base64,{encoded}"));
        }
    }

    // Fallback: metadata log (FLAC, OGG)
    if let Some(rev) = probed.metadata.get() {
        if let Some(meta) = rev.current() {
            if let Some(v) = meta.visuals().first() {
                let encoded = base64::engine::general_purpose::STANDARD.encode(&*v.data);
                let mime = if v.media_type.is_empty() { "image/jpeg" } else { &v.media_type };
                return Some(format!("data:{mime};base64,{encoded}"));
            }
        }
    }

    // Fallback 2: Look for specific local cover image or generic folder covers
    if let Some(parent) = std::path::Path::new(audio_path).parent() {
        let stem = std::path::Path::new(audio_path).file_stem().and_then(|s| s.to_str()).unwrap_or("cover");
        let names = [
            format!("{}.jpg", stem), format!("{}.png", stem), format!("{}.jpeg", stem),
            "cover.jpg".to_string(), "cover.png".to_string(), "cover.jpeg".to_string(),
            "folder.jpg".to_string(), "folder.png".to_string(),
            "album.jpg".to_string(), "album.png".to_string(),
            "front.jpg".to_string(), "front.png".to_string()
        ];
        for name in names {
            let img_path = parent.join(&name);
            if img_path.exists() {
                if let Ok(bytes) = std::fs::read(&img_path) {
                    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
                    let mime = if name.ends_with(".png") { "image/png" } else { "image/jpeg" };
                    return Some(format!("data:{mime};base64,{encoded}"));
                }
            }
        }
    }

    None
}
