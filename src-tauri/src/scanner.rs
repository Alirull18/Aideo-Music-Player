use rayon::prelude::*;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use symphonia::core::probe::Hint;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::formats::FormatOptions;
use symphonia::default::get_probe;
use std::fs::File;

use crate::db::Track;

use tauri::{AppHandle, Emitter};

pub const SCAN_CHUNK_SIZE: usize = 500;

pub fn scan_directory_chunked<F>(
    dir: &str,
    app_handle: &AppHandle,
    mut on_chunk: F,
) -> usize
where
    F: FnMut(Vec<Track>),
{
    if !std::path::Path::new(dir).exists() {
        return 0;
    }

    let mut total_scanned = 0;
    let mut current_chunk: Vec<PathBuf> = Vec::with_capacity(SCAN_CHUNK_SIZE);

    for entry in WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file())
    {
        let path = entry.path();
        if let Some(ext) = path.extension() {
            let ext_str = ext.to_string_lossy().to_lowercase();
            if matches!(
                ext_str.as_str(),
                "flac" | "wav" | "m4a" | "mp3" | "ogg" | "opus" | "aac" | "aiff" | "ape" | "wma" | "dsf" | "dff"
            ) {
                current_chunk.push(path.to_path_buf());
                if current_chunk.len() >= SCAN_CHUNK_SIZE {
                    let tracks = process_chunk(&current_chunk, app_handle);
                    total_scanned += tracks.len();
                    on_chunk(tracks);
                    current_chunk.clear();
                }
            }
        }
    }

    if !current_chunk.is_empty() {
        let tracks = process_chunk(&current_chunk, app_handle);
        total_scanned += tracks.len();
        on_chunk(tracks);
        current_chunk.clear();
    }

    total_scanned
}

fn process_chunk(chunk: &[PathBuf], app_handle: &AppHandle) -> Vec<Track> {
    chunk
        .par_iter()
        .filter_map(|path_owned| {
            let path_clone = path_owned.clone();
            let result = std::panic::catch_unwind(move || extract_metadata(&path_clone));
            match result {
                Ok(Some(track)) => Some(track),
                Ok(None) => None,
                Err(e) => {
                    let msg = format!("Failed to read file: {:?}. Error: {:?}", path_owned, e);
                    eprintln!("[scanner] {}", msg);
                    let _ = app_handle.emit("scanner-error", msg);
                    None
                }
            }
        })
        .collect()
}

pub fn scan_directory(dir: &str, app_handle: &AppHandle) -> Vec<Track> {
    let mut all_tracks = Vec::new();
    scan_directory_chunked(dir, app_handle, |chunk| {
        all_tracks.extend(chunk);
    });
    all_tracks
}

fn parse_number_value(value: &symphonia::core::meta::Value) -> Option<i32> {
    match value {
        symphonia::core::meta::Value::UnsignedInt(v) => Some(*v as i32),
        symphonia::core::meta::Value::SignedInt(v) => Some(*v as i32),
        symphonia::core::meta::Value::String(s) => parse_number_str(s),
        _ => None,
    }
}

fn parse_replaygain_value(value: &symphonia::core::meta::Value) -> Option<f64> {
    let s = match value {
        symphonia::core::meta::Value::String(s) => s.as_str(),
        _ => return None,
    };
    let clean = s.trim_matches('\0').trim();
    let num_part = clean.split_whitespace().next()?.trim_end_matches("dB").trim();
    num_part.parse::<f64>().ok()
}

/// Opus files carry `R128_TRACK_GAIN` referenced to −23 LUFS (RFC 7845) while
/// ReplayGain 2.0 tags are referenced to −18 LUFS. Stored gains are applied
/// uniformly at playback, so an Opus R128-sourced tag must be shifted +5 dB
/// to be equivalent to its ReplayGain 2.0 counterpart.
fn adjust_opus_r128_gain(gain: Option<f64>, from_r128_tag: bool, is_opus: bool) -> Option<f64> {
    match (gain, from_r128_tag, is_opus) {
        (Some(g), true, true) => Some(g + 5.0),
        (g, _, _) => g,
    }
}

fn parse_number_str(s: &str) -> Option<i32> {
    let clean = s.trim_matches('\0').trim();
    let num_part = clean.split('/').next()?.trim();
    num_part.parse::<i32>().ok()
}

fn extract_disc_and_track_from_path(path: &Path) -> (Option<i32>, Option<i32>) {
    let path_str = path.to_string_lossy();
    let mut disc = None;
    let mut track = None;

    let lower = path_str.to_lowercase();
    if let Some(pos) = lower.find("disc ") {
        if let Some(c) = lower[pos + 5..].chars().next() {
            if let Some(d) = c.to_digit(10) {
                disc = Some(d as i32);
            }
        }
    } else if let Some(pos) = lower.find("disc") {
        if let Some(c) = lower[pos + 4..].chars().next() {
            if let Some(d) = c.to_digit(10) {
                disc = Some(d as i32);
            }
        }
    } else if let Some(pos) = lower.find("cd ") {
        if let Some(c) = lower[pos + 3..].chars().next() {
            if let Some(d) = c.to_digit(10) {
                disc = Some(d as i32);
            }
        }
    } else if let Some(pos) = lower.find("cd") {
        if let Some(c) = lower[pos + 2..].chars().next() {
            if let Some(d) = c.to_digit(10) {
                disc = Some(d as i32);
            }
        }
    }

    if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
        let trimmed = stem.trim();
        if let Some(dash_pos) = trimmed.find('-') {
            let prefix = trimmed[..dash_pos].trim();
            let suffix = trimmed[dash_pos + 1..].trim();
            let suffix_digits: String = suffix.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let (Ok(d), Ok(t)) = (prefix.parse::<i32>(), suffix_digits.parse::<i32>()) {
                if d > 0 && d < 20 && t > 0 {
                    if disc.is_none() { disc = Some(d); }
                    track = Some(t);
                }
            }
        }

        if track.is_none() {
            let digit_str: String = trimmed.chars().take_while(|c| c.is_ascii_digit()).collect();
            if !digit_str.is_empty() && digit_str.len() <= 3 {
                if let Ok(num) = digit_str.parse::<i32>() {
                    if num > 0 {
                        track = Some(num);
                    }
                }
            }
        }
    }

    (disc, track)
}

fn parse_dsf_metadata(path: &Path) -> Option<Track> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = File::open(path).ok()?;
    
    // Read first 80 bytes for DSF headers
    let mut header = [0u8; 80];
    file.read_exact(&mut header).ok()?;
    
    if &header[0..4] != b"DSD " {
        return None;
    }
    
    // Format chunk (fmt) typically starts at offset 28
    let fmt_offset = 28;
    if &header[fmt_offset..fmt_offset + 4] != b"fmt " {
        return None;
    }
    
    // Extract format parameters from format chunk
    let _channels = u32::from_le_bytes(header[fmt_offset + 24..fmt_offset + 28].try_into().ok()?);
    let sample_rate = u32::from_le_bytes(header[fmt_offset + 28..fmt_offset + 32].try_into().ok()?);
    let sample_count = u64::from_le_bytes(header[fmt_offset + 36..fmt_offset + 44].try_into().ok()?);
    
    let duration = if sample_rate > 0 {
        Some(sample_count as f64 / sample_rate as f64)
    } else {
        None
    };

    // ID3v2 metadata chunk offset is specified in the DSD chunk at offset 20..28
    let id3_offset = u64::from_le_bytes(header[20..28].try_into().ok()?);
    
    let mut title = None;
    let mut artist = None;
    let mut album = None;
    let mut track_number = None;
    let mut disc_number = None;

    if id3_offset > 0 && file.seek(SeekFrom::Start(id3_offset)).is_ok() {
        let mut id3_header = [0u8; 10];
            if file.read_exact(&mut id3_header).is_ok() && &id3_header[0..3] == b"ID3" {
                let is_v2_4 = id3_header[3] >= 4;
                let id3_size = ((id3_header[6] as usize) << 21) |
                               ((id3_header[7] as usize) << 14) |
                               ((id3_header[8] as usize) << 7) |
                               (id3_header[9] as usize);
                
                if id3_size > 10 * 1024 * 1024 {
                    return None;
                }
                let mut frame_data = vec![0u8; id3_size];
                if file.read_exact(&mut frame_data).is_ok() {
                    let mut offset = 0;
                    while offset + 10 < id3_size {
                        let frame_id = &frame_data[offset..offset + 4];
                        if frame_id[0] == 0 { break; } 
                        
                        let frame_size = if is_v2_4 {
                            (((frame_data[offset + 4] as usize) & 0x7F) << 21) |
                            (((frame_data[offset + 5] as usize) & 0x7F) << 14) |
                            (((frame_data[offset + 6] as usize) & 0x7F) << 7) |
                            ((frame_data[offset + 7] as usize) & 0x7F)
                        } else {
                            ((frame_data[offset + 4] as usize) << 24) |
                            ((frame_data[offset + 5] as usize) << 16) |
                            ((frame_data[offset + 6] as usize) << 8) |
                            (frame_data[offset + 7] as usize)
                        };
                        
                        if offset + 10 + frame_size > id3_size {
                            break;
                        }
                        
                        let data = &frame_data[offset + 10..offset + 10 + frame_size];
                        
                        if frame_id.starts_with(b"T") {
                            let text = if data.len() > 1 {
                                let encoding = data[0];
                                let bytes = &data[1..];
                                match encoding {
                                    0 => String::from_utf8_lossy(bytes).into_owned(),
                                    1 => {
                                        if bytes.len() >= 2 {
                                            let is_le = bytes[0] == 0xFF && bytes[1] == 0xFE;
                                            let u16s: Vec<u16> = bytes[2..].chunks_exact(2).map(|c| {
                                                if is_le {
                                                    u16::from_le_bytes([c[0], c[1]])
                                                } else {
                                                    u16::from_be_bytes([c[0], c[1]])
                                                }
                                            }).collect();
                                            String::from_utf16_lossy(&u16s)
                                        } else {
                                            String::new()
                                        }
                                    }
                                    2 => {
                                        let u16s: Vec<u16> = bytes.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
                                        String::from_utf16_lossy(&u16s)
                                    }
                                    3 => String::from_utf8_lossy(bytes).into_owned(),
                                    _ => String::from_utf8_lossy(bytes).into_owned(),
                                }
                            } else {
                                String::new()
                            };
                            
                            let trimmed = text.trim_matches('\0').trim().to_string();
                            match frame_id {
                                b"TIT2" => title = Some(trimmed),
                                b"TPE1" => artist = Some(trimmed),
                                b"TALB" => album = Some(trimmed),
                                b"TRCK" => track_number = trimmed.split('/').next().and_then(|s| s.trim().parse::<i32>().ok()),
                                b"TPOS" => disc_number = trimmed.split('/').next().and_then(|s| s.trim().parse::<i32>().ok()),
                                _ => {}
                            }
                        }
                        
                        offset += 10 + frame_size;
                    }
                }
            }
        }

    let (path_disc, path_track) = extract_disc_and_track_from_path(path);
    let final_track_number = track_number.or(path_track);
    let final_disc_number = disc_number.or(path_disc);

    let final_title = title.or_else(|| {
        path.file_stem().map(|s| s.to_string_lossy().into_owned())
    });

    Some(Track {
        id: 0,
        path: path.to_string_lossy().into_owned(),
        title: final_title,
        artist,
        album,
        duration,
        format: Some("DSF".to_string()),
        lyric_offset: 0,
        loved: Some(0),
        disliked: Some(0),
        cover_url: None,
        path_hash: None,
        bpm: None,
        energy: None,
        bass_ratio: None,
        treble_ratio: None,
        replaygain_gain: None,
        track_number: final_track_number,
        disc_number: final_disc_number,
    })
}

/// Parse DSDIFF (DFF) sample rate and channels from raw header bytes.
/// DSDIFF 1.5 chunk layout: ckID(4) + ckSize(8: u32 high + u32 low, big-endian) + data.
/// The "FS  " chunk data is a big-endian u32 sample rate at pos+12.
/// The "CHNL" chunk data starts with a big-endian u16 channel count at pos+12.
fn parse_dff_props(buffer: &[u8]) -> (u32, u16) {
    let mut sample_rate = 0u32;
    let mut channels = 0u16;

    if let Some(pos) = buffer.windows(4).position(|w| w == b"FS  ") {
        if pos + 16 <= buffer.len() {
            sample_rate = u32::from_be_bytes(buffer[pos + 12..pos + 16].try_into().unwrap_or([0; 4]));
        }
    }

    if let Some(pos) = buffer.windows(4).position(|w| w == b"CHNL") {
        if pos + 14 <= buffer.len() {
            channels = u16::from_be_bytes(buffer[pos + 12..pos + 14].try_into().unwrap_or([0; 2]));
        }
    }

    (sample_rate, channels)
}

fn parse_dff_metadata(path: &Path) -> Option<Track> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = File::open(path).ok()?;
    
    let mut buffer = vec![0u8; 4096];
    file.seek(SeekFrom::Start(0)).ok()?;
    let bytes_read = file.read(&mut buffer).unwrap_or(0);
    
    let (mut sample_rate, mut channels) = parse_dff_props(&buffer[..bytes_read]);
    
    if sample_rate == 0 {
        sample_rate = 2822400; 
    }
    if channels == 0 {
        channels = 2;
    }
    
    let file_metadata = std::fs::metadata(path).ok()?;
    let file_size = file_metadata.len();
    let duration = if sample_rate > 0 && channels > 0 {
        let audio_bytes = if file_size > 1024 { file_size - 1024 } else { file_size };
        Some((audio_bytes as f64 * 8.0) / (channels as f64 * sample_rate as f64))
    } else {
        None
    };

    let title = path.file_stem().map(|s| s.to_string_lossy().into_owned());
    let (path_disc, path_track) = extract_disc_and_track_from_path(path);
    
    Some(Track {
        id: 0,
        path: path.to_string_lossy().into_owned(),
        title,
        artist: None,
        album: None,
        duration,
        format: Some("DFF".to_string()),
        lyric_offset: 0,
        loved: Some(0),
        disliked: Some(0),
        cover_url: None,
        path_hash: None,
        bpm: None,
        energy: None,
        bass_ratio: None,
        treble_ratio: None,
        replaygain_gain: None,
        track_number: path_track,
        disc_number: path_disc,
    })
}

#[cfg(test)]
mod tests {
    use super::{adjust_opus_r128_gain, parse_dff_props};

    fn dff_header(sample_rate: u32, channels: u16) -> Vec<u8> {
        let mut b = Vec::new();
        b.extend_from_slice(b"FRM8");
        b.extend_from_slice(&[0u8; 8]);
        b.extend_from_slice(b"DSD ");
        // PROP chunk
        b.extend_from_slice(b"PROP");
        b.extend_from_slice(&[0u8; 8]);
        b.extend_from_slice(b"SND ");
        // FS   chunk: ckID(4) + ckSize(8) + u32 BE sample rate
        b.extend_from_slice(b"FS  ");
        b.extend_from_slice(&[0u8; 8]);
        b.extend_from_slice(&sample_rate.to_be_bytes());
        // CHNL chunk: ckID(4) + ckSize(8) + u16 BE channels
        b.extend_from_slice(b"CHNL");
        b.extend_from_slice(&[0u8; 8]);
        b.extend_from_slice(&channels.to_be_bytes());
        b
    }

    #[test]
    fn test_dff_parses_spec_sample_rate_and_channels() {
        let buf = dff_header(5644800, 2);
        assert_eq!(parse_dff_props(&buf), (5644800, 2));
    }

    #[test]
    fn test_dff_parses_multichannel() {
        let buf = dff_header(2822400, 6);
        assert_eq!(parse_dff_props(&buf), (2822400, 6));
    }

    #[test]
    fn test_dff_truncated_returns_zeros() {
        let buf = dff_header(2822400, 2);
        // Truncate the entire CHNL chunk (last 14 bytes): FS still parses, channels don't
        let truncated = &buf[..buf.len() - 14];
        let (rate, ch) = parse_dff_props(truncated);
        assert_eq!(rate, 2822400);
        assert_eq!(ch, 0);
    }

    #[test]
    fn test_dff_garbage_returns_zeros() {
        let (rate, ch) = parse_dff_props(&[0u8; 64]);
        assert_eq!(rate, 0);
        assert_eq!(ch, 0);
    }

    #[test]
    fn test_opus_r128_tag_gets_plus_5db_reference_correction() {
        // RFC 7845 stores R128_TRACK_GAIN against a −23 LUFS reference while
        // ReplayGain 2.0 tags target −18 LUFS; stored gains are applied
        // uniformly, so an Opus R128 tag must be shifted +5 dB.
        assert_eq!(
            adjust_opus_r128_gain(Some(-7.2), true, true),
            Some(-2.2)
        );
    }

    #[test]
    fn test_non_opus_r128_tag_is_left_untouched() {
        // FLAC/MP3 files may legally carry R128-named tags written by tools
        // that already use RG conventions — never shift those.
        assert_eq!(
            adjust_opus_r128_gain(Some(-7.2), true, false),
            Some(-7.2)
        );
    }

    #[test]
    fn test_opus_replaygain_tag_is_left_untouched() {
        // A real ReplayGain tag on an Opus file is already −18-referenced.
        assert_eq!(
            adjust_opus_r128_gain(Some(-3.5), false, true),
            Some(-3.5)
        );
    }

    #[test]
    fn test_missing_replaygain_stays_none_after_adjustment() {
        assert_eq!(adjust_opus_r128_gain(None, true, true), None);
        assert_eq!(adjust_opus_r128_gain(None, false, false), None);
    }

    #[test]
    fn test_scanner_metadata_corrupt_file_returns_none_safely() {
        use super::extract_metadata;
        use std::path::PathBuf;

        // Non-existent path
        let non_existent = PathBuf::from("non_existent_audio_file.flac");
        assert!(extract_metadata(&non_existent).is_none());

        // Create temporary invalid/corrupted file
        let mut temp_path = std::env::temp_dir();
        temp_path.push("corrupted_test_audio.mp3");
        std::fs::write(&temp_path, b"CORRUPTED_NOT_AUDIO_DATA_12345").unwrap();
        let result = extract_metadata(&temp_path);
        let _ = std::fs::remove_file(&temp_path);
        assert!(result.is_none());
    }
}

pub fn extract_metadata(path: &Path) -> Option<Track> {
    let extension = path.extension().map(|e| e.to_string_lossy().to_uppercase());
    if let Some(ref ext) = extension {
        if ext == "DSF" {
            if let Some(track) = parse_dsf_metadata(path) {
                return Some(track);
            }
        } else if ext == "DFF" {
            if let Some(track) = parse_dff_metadata(path) {
                return Some(track);
            }
        }
    }

    let file = File::open(path).ok()?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();

    if let Some(ref ext) = extension {
        hint.with_extension(ext);
    }

    let mut probed = get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .ok()?;

    let mut title = None;
    let mut artist = None;
    let mut album = None;
    let mut track_number = None;
    let mut disc_number = None;
    let mut replaygain_gain = None;
    // True when replaygain_gain came from an R128-named tag (−23 LUFS ref).
    let mut rg_from_r128 = false;

    if let Some(metadata) = probed.format.metadata().current() {
        for tag in metadata.tags() {
            match tag.std_key {
                Some(symphonia::core::meta::StandardTagKey::TrackTitle) => title = Some(tag.value.to_string()),
                Some(symphonia::core::meta::StandardTagKey::Artist) => artist = Some(tag.value.to_string()),
                Some(symphonia::core::meta::StandardTagKey::Album) => album = Some(tag.value.to_string()),
                Some(symphonia::core::meta::StandardTagKey::TrackNumber) => track_number = parse_number_value(&tag.value),
                Some(symphonia::core::meta::StandardTagKey::DiscNumber) => disc_number = parse_number_value(&tag.value),
                Some(symphonia::core::meta::StandardTagKey::ReplayGainTrackGain) => {
                    replaygain_gain = parse_replaygain_value(&tag.value);
                    rg_from_r128 = false;
                }
                _ => {
                    let key_upper = tag.key.to_uppercase();
                    if track_number.is_none() && (key_upper == "TRACKNUMBER" || key_upper == "TRACK" || key_upper == "TRCK") {
                        track_number = parse_number_value(&tag.value);
                    } else if disc_number.is_none() && (key_upper == "DISCNUMBER" || key_upper == "DISC" || key_upper == "TPOS") {
                        disc_number = parse_number_value(&tag.value);
                    } else if replaygain_gain.is_none() && (key_upper == "REPLAYGAIN_TRACK_GAIN" || key_upper == "R128_TRACK_GAIN" || key_upper == "REPLAYGAIN_TRACK_GAIN_DB") {
                        replaygain_gain = parse_replaygain_value(&tag.value);
                        rg_from_r128 = key_upper == "R128_TRACK_GAIN";
                    }
                }
            }
        }
    }

    if title.is_none() || track_number.is_none() || disc_number.is_none() || replaygain_gain.is_none() {
        if let Some(rev) = probed.metadata.get() {
            if let Some(metadata) = rev.current() {
                for tag in metadata.tags() {
                    match tag.std_key {
                        Some(symphonia::core::meta::StandardTagKey::TrackTitle) => if title.is_none() { title = Some(tag.value.to_string()); },
                        Some(symphonia::core::meta::StandardTagKey::Artist) => if artist.is_none() { artist = Some(tag.value.to_string()); },
                        Some(symphonia::core::meta::StandardTagKey::Album) => if album.is_none() { album = Some(tag.value.to_string()); },
                        Some(symphonia::core::meta::StandardTagKey::TrackNumber) => if track_number.is_none() { track_number = parse_number_value(&tag.value); },
                        Some(symphonia::core::meta::StandardTagKey::DiscNumber) => if disc_number.is_none() { disc_number = parse_number_value(&tag.value); },
                        Some(symphonia::core::meta::StandardTagKey::ReplayGainTrackGain) => if replaygain_gain.is_none() { replaygain_gain = parse_replaygain_value(&tag.value); },
                        _ => {
                            let key_upper = tag.key.to_uppercase();
                            if track_number.is_none() && (key_upper == "TRACKNUMBER" || key_upper == "TRACK" || key_upper == "TRCK") {
                                track_number = parse_number_value(&tag.value);
                            } else if disc_number.is_none() && (key_upper == "DISCNUMBER" || key_upper == "DISC" || key_upper == "TPOS") {
                                disc_number = parse_number_value(&tag.value);
                            } else if replaygain_gain.is_none() && (key_upper == "REPLAYGAIN_TRACK_GAIN" || key_upper == "R128_TRACK_GAIN" || key_upper == "REPLAYGAIN_TRACK_GAIN_DB") {
                                replaygain_gain = parse_replaygain_value(&tag.value);
                                rg_from_r128 = key_upper == "R128_TRACK_GAIN";
                            }
                        }
                    }
                }
            }
        }
    }

    let is_opus = extension.as_deref() == Some("opus");
    let replaygain_gain = adjust_opus_r128_gain(replaygain_gain, rg_from_r128, is_opus);

    let (path_disc, path_track) = extract_disc_and_track_from_path(path);
    let final_track_number = track_number.or(path_track);
    let final_disc_number = disc_number.or(path_disc);

    let duration = probed.format.default_track().and_then(|track| {
        let tb = track.codec_params.time_base?;
        let ts = track.codec_params.n_frames?;
        Some(tb.calc_time(ts).seconds as f64 + tb.calc_time(ts).frac)
    });

    let final_title = title.or_else(|| {
        path.file_stem().map(|s| s.to_string_lossy().into_owned())
    });

    Some(Track {
        id: 0,
        path: path.to_string_lossy().into_owned(),
        title: final_title,
        artist,
        album,
        duration,
        format: extension,
        lyric_offset: 0,
        loved: Some(0),
        disliked: Some(0),
        cover_url: None,
        path_hash: None,
        bpm: None,
        energy: None,
        bass_ratio: None,
        treble_ratio: None,
        replaygain_gain,
        track_number: final_track_number,
        disc_number: final_disc_number,
    })
}
