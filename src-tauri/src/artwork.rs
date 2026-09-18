use symphonia::core::probe::Hint;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::formats::FormatOptions;
use symphonia::default::get_probe;
use base64::Engine;
use lofty::probe::Probe;
use lofty::prelude::*;
use lofty::picture::PictureType;

use std::sync::Mutex;
use std::collections::HashMap;
use std::path::Path;

lazy_static::lazy_static! {
    static ref COVER_CACHE: Mutex<HashMap<String, Option<String>>> = Mutex::new(HashMap::new());
}

/// Normalizes audio path by removing file URI prefixes and percent-decoding if present.
pub fn normalize_audio_path(audio_path: &str) -> String {
    let clean = if let Some(stripped) = audio_path.strip_prefix("file:///") {
        stripped
    } else if let Some(stripped) = audio_path.strip_prefix("file://") {
        stripped
    } else {
        audio_path
    };

    urlencoding::decode(clean)
        .map(|s| s.into_owned())
        .unwrap_or_else(|_| clean.to_string())
}

/// Extracts embedded cover art from an audio file and returns it as a data URL.
pub fn get_cover_art(audio_path: &str) -> Option<String> {
    let normalized = normalize_audio_path(audio_path);

    if let Ok(cache) = COVER_CACHE.lock() {
        if let Some(art) = cache.get(&normalized) {
            return art.clone();
        }
        if let Some(art) = cache.get(audio_path) {
            return art.clone();
        }
    }

    let target_path = normalized.clone();
    let res = std::panic::catch_unwind(move || extract_art(&target_path))
        .ok()
        .flatten();

    if let Ok(mut cache) = COVER_CACHE.lock() {
        if cache.len() >= 1000 {
            cache.clear();
        }
        cache.insert(normalized.clone(), res.clone());
        if audio_path != normalized {
            cache.insert(audio_path.to_string(), res.clone());
        }
    }

    res
}

/// Invalidates cached artwork for a given audio path so updated tags reflect immediately.
pub fn invalidate_cover_cache(audio_path: &str) {
    let normalized = normalize_audio_path(audio_path);
    if let Ok(mut cache) = COVER_CACHE.lock() {
        cache.remove(&normalized);
        cache.remove(audio_path);
    }
}

fn extract_art(audio_path: &str) -> Option<String> {
    let path = Path::new(audio_path);
    if path.exists() {
        if let Some(art) = extract_art_lofty(path) {
            return Some(art);
        }
        if let Some(art) = extract_art_symphonia(audio_path) {
            return Some(art);
        }
        if let Some(art) = extract_folder_art(audio_path) {
            return Some(art);
        }
    }

    None
}

fn extract_art_lofty(path: &Path) -> Option<String> {
    let tagged_file = Probe::open(path).ok()?.read().ok()?;
    let pic = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag())
        .and_then(|tag| {
            tag.pictures()
                .iter()
                .find(|p| p.pic_type() == PictureType::CoverFront)
                .or_else(|| tag.pictures().first())
        })
        .or_else(|| {
            tagged_file.tags().iter().find_map(|tag| {
                tag.pictures()
                    .iter()
                    .find(|p| p.pic_type() == PictureType::CoverFront)
                    .or_else(|| tag.pictures().first())
            })
        })?;

    let mime_str = match pic.mime_type() {
        Some(m) => m.as_str(),
        None => "image/jpeg",
    };
    let encoded = base64::engine::general_purpose::STANDARD.encode(pic.data());
    Some(format!("data:{mime_str};base64,{encoded}"))
}

fn extract_art_symphonia(audio_path: &str) -> Option<String> {
    let file = std::fs::File::open(audio_path).ok()?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = Path::new(audio_path).extension() {
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

    None
}

fn extract_folder_art(audio_path: &str) -> Option<String> {
    let parent = Path::new(audio_path).parent()?;
    let stem = Path::new(audio_path).file_stem().and_then(|s| s.to_str()).unwrap_or("cover");
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
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    #[test]
    fn test_non_existent_file_returns_none() {
        assert_eq!(get_cover_art("non_existent_file_xyz_12345.mp3"), None);
    }

    #[test]
    fn test_folder_art_fallback() {
        let temp_dir = std::env::temp_dir().join("aideo_artwork_test_folder");
        let _ = std::fs::create_dir_all(&temp_dir);

        let audio_path = temp_dir.join("track01.dummy");
        let cover_path = temp_dir.join("cover.jpg");

        // Write dummy audio and cover image
        let dummy_jpeg_bytes = b"\xFF\xD8\xFF\xE0\x00\x10JFIF\x00\x01\x01\x01\x00`\x00`\x00\x00\xFF\xDB";
        let _ = File::create(&audio_path).and_then(|mut f| f.write_all(b"audio content"));
        let _ = File::create(&cover_path).and_then(|mut f| f.write_all(dummy_jpeg_bytes));

        let art = extract_folder_art(&audio_path.to_string_lossy());
        assert!(art.is_some(), "Folder art fallback should find cover.jpg");
        let art_str = art.unwrap();
        assert!(art_str.starts_with("data:image/jpeg;base64,"));

        // Clean up
        let _ = std::fs::remove_file(&audio_path);
        let _ = std::fs::remove_file(&cover_path);
        let _ = std::fs::remove_dir(&temp_dir);
    }

    #[test]
    fn test_cover_cache_and_invalidation() {
        let path = "test_track_path_for_cache.mp3";
        invalidate_cover_cache(path);

        // Pre-populate cache directly
        if let Ok(mut cache) = COVER_CACHE.lock() {
            cache.insert(path.to_string(), Some("data:image/jpeg;base64,mockart".to_string()));
        }

        assert_eq!(get_cover_art(path), Some("data:image/jpeg;base64,mockart".to_string()));

        invalidate_cover_cache(path);
        // Since test_track_path_for_cache.mp3 doesn't exist on disk, after invalidation get_cover_art returns None
        assert_eq!(get_cover_art(path), None);
    }

    #[test]
    fn test_normalize_audio_path() {
        assert_eq!(normalize_audio_path("C:/Music/song.mp3"), "C:/Music/song.mp3");
        assert_eq!(normalize_audio_path("file:///C:/Music/song.mp3"), "C:/Music/song.mp3");
        assert_eq!(normalize_audio_path("file://C:/Music/song.mp3"), "C:/Music/song.mp3");
        assert_eq!(normalize_audio_path("C:/Music/My%20Song%20%231.flac"), "C:/Music/My Song #1.flac");
        assert_eq!(normalize_audio_path("file:///C:/Music/My%20Song.mp3"), "C:/Music/My Song.mp3");
    }
}
