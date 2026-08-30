use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::{ItemKey, Tag};
use lofty::picture::{Picture, PictureType, MimeType};
use lofty::config::WriteOptions;
use serde::{Deserialize, Serialize};
use std::path::Path;
use base64::Engine;

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct AudioTagData {
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub year: Option<String>,
    pub genre: Option<String>,
    pub track_number: Option<u32>,
    pub track_total: Option<u32>,
    pub disc_number: Option<u32>,
    pub disc_total: Option<u32>,
    pub comment: Option<String>,
    pub lyrics: Option<String>,
    pub cover_data_url: Option<String>,
    pub format: Option<String>,
    pub duration_secs: Option<f64>,
    pub bitrate: Option<u32>,
    pub sample_rate: Option<u32>,
    pub channels: Option<u8>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct AudioTagUpdate {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub year: Option<String>,
    pub genre: Option<String>,
    pub track_number: Option<u32>,
    pub track_total: Option<u32>,
    pub disc_number: Option<u32>,
    pub disc_total: Option<u32>,
    pub comment: Option<String>,
    pub lyrics: Option<String>,
    pub cover_base64: Option<String>, // Base64 data URL or raw base64 string
    pub remove_cover: Option<bool>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct AudioTagBatchUpdate {
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub year: Option<String>,
    pub genre: Option<String>,
    pub comment: Option<String>,
    pub cover_base64: Option<String>,
    pub remove_cover: Option<bool>,
}

/// Read all tags and embedded cover art from an audio file.
pub fn read_tags(file_path: &str) -> Result<AudioTagData, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(format!("File does not exist: {}", file_path));
    }

    let tagged_file = Probe::open(path)
        .map_err(|e| format!("Failed to open audio file: {}", e))?
        .read()
        .map_err(|e| format!("Failed to read metadata: {}", e))?;

    let properties = tagged_file.properties();
    let duration_secs = Some(properties.duration().as_secs_f64());
    let bitrate = properties.audio_bitrate();
    let sample_rate = properties.sample_rate();
    let channels = properties.channels();

    let format = path.extension()
        .and_then(|ext| ext.to_str())
        .map(|s| s.to_uppercase());

    let mut data = AudioTagData {
        path: file_path.to_string(),
        format,
        duration_secs,
        bitrate,
        sample_rate,
        channels,
        ..Default::default()
    };

    if let Some(tag) = tagged_file.primary_tag().or_else(|| tagged_file.first_tag()) {
        data.title = tag.get_string(&ItemKey::TrackTitle).map(|s| s.to_string());
        data.artist = tag.get_string(&ItemKey::TrackArtist).map(|s| s.to_string());
        data.album = tag.get_string(&ItemKey::AlbumTitle).map(|s| s.to_string());
        data.album_artist = tag.get_string(&ItemKey::AlbumArtist).map(|s| s.to_string());
        data.year = tag.get_string(&ItemKey::Year)
            .or_else(|| tag.get_string(&ItemKey::RecordingDate))
            .or_else(|| tag.get_string(&ItemKey::OriginalReleaseDate))
            .map(|s| s.to_string());
        data.genre = tag.get_string(&ItemKey::Genre).map(|s| s.to_string());
        data.comment = tag.get_string(&ItemKey::Comment).map(|s| s.to_string());
        data.lyrics = tag.get_string(&ItemKey::Lyrics).map(|s| s.to_string());

        // Numeric fields (Track #, Disc #)
        if let Some(track_no) = tag.track() {
            data.track_number = Some(track_no);
        } else if let Some(s) = tag.get_string(&ItemKey::TrackNumber) {
            data.track_number = parse_num_from_slash_str(s);
        }

        if let Some(track_total) = tag.track_total() {
            data.track_total = Some(track_total);
        } else if let Some(s) = tag.get_string(&ItemKey::TrackTotal) {
            data.track_total = s.parse::<u32>().ok();
        }

        if let Some(disc_no) = tag.disk() {
            data.disc_number = Some(disc_no);
        } else if let Some(s) = tag.get_string(&ItemKey::DiscNumber) {
            data.disc_number = parse_num_from_slash_str(s);
        }

        if let Some(disc_total) = tag.disk_total() {
            data.disc_total = Some(disc_total);
        } else if let Some(s) = tag.get_string(&ItemKey::DiscTotal) {
            data.disc_total = s.parse::<u32>().ok();
        }

        // Cover Picture extraction
        let front_pic = tag.pictures().iter()
            .find(|p| p.pic_type() == PictureType::CoverFront)
            .or_else(|| tag.pictures().first());

        if let Some(pic) = front_pic {
            let mime_str = match pic.mime_type() {
                Some(m) => m.as_str(),
                None => "image/jpeg",
            };
            let b64 = base64::engine::general_purpose::STANDARD.encode(pic.data());
            data.cover_data_url = Some(format!("data:{};base64,{}", mime_str, b64));
        }
    }

    Ok(data)
}

/// Helper to parse "3/12" into Some(3)
fn parse_num_from_slash_str(s: &str) -> Option<u32> {
    let clean = s.trim_matches('\0').trim();
    clean.split('/').next()?.trim().parse::<u32>().ok()
}

/// Write updated tags and/or cover art to an audio file on disk.
pub fn write_tags(file_path: &str, update: &AudioTagUpdate) -> Result<(), String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let tagged_file = Probe::open(path)
        .map_err(|e| format!("Failed to open file: {}", e))?
        .read()
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let tag_type = tagged_file.primary_tag_type();
    
    // Get existing tag or create a new one matching the file's primary tag format
    let mut tag = if let Some(t) = tagged_file.primary_tag() {
        t.clone()
    } else if let Some(t) = tagged_file.first_tag() {
        t.clone()
    } else {
        Tag::new(tag_type)
    };

    // Helper to insert or remove text tags
    let update_text_tag = |tag: &mut Tag, key: ItemKey, val: Option<&String>| {
        if let Some(text) = val {
            if text.trim().is_empty() {
                tag.remove_key(&key);
            } else {
                tag.insert_text(key, text.clone());
            }
        }
    };

    // Update string fields
    update_text_tag(&mut tag, ItemKey::TrackTitle, update.title.as_ref());
    update_text_tag(&mut tag, ItemKey::TrackArtist, update.artist.as_ref());
    update_text_tag(&mut tag, ItemKey::AlbumTitle, update.album.as_ref());
    update_text_tag(&mut tag, ItemKey::AlbumArtist, update.album_artist.as_ref());
    if let Some(ref year) = update.year {
        if year.trim().is_empty() {
            tag.remove_key(&ItemKey::Year);
            tag.remove_key(&ItemKey::RecordingDate);
        } else {
            tag.insert_text(ItemKey::Year, year.clone());
            tag.insert_text(ItemKey::RecordingDate, year.clone());
        }
    }
    update_text_tag(&mut tag, ItemKey::Genre, update.genre.as_ref());
    update_text_tag(&mut tag, ItemKey::Comment, update.comment.as_ref());
    update_text_tag(&mut tag, ItemKey::Lyrics, update.lyrics.as_ref());

    // Update numeric fields
    if let Some(track_no) = update.track_number {
        if track_no > 0 {
            tag.set_track(track_no);
        } else {
            tag.remove_key(&ItemKey::TrackNumber);
        }
    }
    if let Some(track_total) = update.track_total {
        if track_total > 0 {
            tag.set_track_total(track_total);
        } else {
            tag.remove_key(&ItemKey::TrackTotal);
        }
    }
    if let Some(disc_no) = update.disc_number {
        if disc_no > 0 {
            tag.set_disk(disc_no);
        } else {
            tag.remove_key(&ItemKey::DiscNumber);
        }
    }
    if let Some(disc_total) = update.disc_total {
        if disc_total > 0 {
            tag.set_disk_total(disc_total);
        } else {
            tag.remove_key(&ItemKey::DiscTotal);
        }
    }

    // Helper to strip existing cover pictures
    let strip_existing_pictures = |tag: &mut Tag| {
        tag.remove_picture_type(PictureType::CoverFront);
        tag.remove_picture_type(PictureType::Other);
        tag.remove_picture_type(PictureType::Illustration);
        tag.remove_picture_type(PictureType::BandLogo);
        tag.remove_picture_type(PictureType::PublisherLogo);
    };

    // Handle Cover Art
    if update.remove_cover.unwrap_or(false) {
        strip_existing_pictures(&mut tag);
    } else if let Some(ref b64_input) = update.cover_base64 {
        if !b64_input.trim().is_empty() {
            let (mime, raw_b64) = if let Some(pos) = b64_input.find(";base64,") {
                let prefix = &b64_input[..pos];
                let mime_str = prefix.strip_prefix("data:").unwrap_or("image/jpeg");
                (mime_str, &b64_input[pos + 8..])
            } else {
                ("image/jpeg", b64_input.as_str())
            };

            let decoded_bytes = base64::engine::general_purpose::STANDARD
                .decode(raw_b64.trim().as_bytes())
                .map_err(|e| format!("Invalid base64 cover image: {}", e))?;

            if !decoded_bytes.is_empty() {
                let mime_type = if mime.contains("png") {
                    MimeType::Png
                } else {
                    MimeType::Jpeg
                };

                let picture = Picture::new_unchecked(
                    PictureType::CoverFront,
                    Some(mime_type),
                    None,
                    decoded_bytes,
                );

                strip_existing_pictures(&mut tag);
                tag.push_picture(picture);
            }
        }
    }

    // Save tags safely to disk
    tag.save_to_path(path, WriteOptions::default())
        .map_err(|e| format!("Failed to save tags to audio file: {}", e))?;

    Ok(())
}

/// Batch update metadata on multiple tracks simultaneously.
pub fn batch_write_tags(file_paths: &[String], update: &AudioTagBatchUpdate) -> Result<usize, String> {
    let mut updated_count = 0;

    for path in file_paths {
        let single_update = AudioTagUpdate {
            title: None, // Keep individual titles
            artist: update.artist.clone(),
            album: update.album.clone(),
            album_artist: update.album_artist.clone(),
            year: update.year.clone(),
            genre: update.genre.clone(),
            track_number: None,
            track_total: None,
            disc_number: None,
            disc_total: None,
            comment: update.comment.clone(),
            lyrics: None,
            cover_base64: update.cover_base64.clone(),
            remove_cover: update.remove_cover,
        };

        if let Ok(()) = write_tags(path, &single_update) {
            updated_count += 1;
        }
    }

    Ok(updated_count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_num_from_slash_str() {
        assert_eq!(parse_num_from_slash_str("5"), Some(5));
        assert_eq!(parse_num_from_slash_str("5/12"), Some(5));
        assert_eq!(parse_num_from_slash_str(" 07 / 10 "), Some(7));
        assert_eq!(parse_num_from_slash_str(""), None);
        assert_eq!(parse_num_from_slash_str("abc"), None);
    }

    #[test]
    fn test_audio_tag_data_default() {
        let tag = AudioTagData::default();
        assert!(tag.title.is_none());
        assert!(tag.artist.is_none());
        assert!(tag.cover_data_url.is_none());
    }

    #[test]
    fn test_audio_tag_update_defaults() {
        let update = AudioTagUpdate {
            title: Some("Test Title".to_string()),
            artist: Some("Test Artist".to_string()),
            track_number: Some(3),
            ..Default::default()
        };
        assert_eq!(update.title.as_deref(), Some("Test Title"));
        assert_eq!(update.artist.as_deref(), Some("Test Artist"));
        assert_eq!(update.track_number, Some(3));
        assert!(update.album.is_none());
    }
}
