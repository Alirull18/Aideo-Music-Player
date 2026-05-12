use std::path::Path;
use walkdir::WalkDir;
use symphonia::core::probe::Hint;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::formats::FormatOptions;
use symphonia::default::get_probe;
use std::fs::File;

use crate::db::Track;

pub fn scan_directory(dir: &str) -> Vec<Track> {
    let mut tracks = Vec::new();

    if !std::path::Path::new(dir).exists() {
        return tracks;
    }

    for entry in WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension() {
                let ext_str = ext.to_string_lossy().to_lowercase();
                if ext_str == "flac" || ext_str == "wav" || ext_str == "m4a" || ext_str == "mp3" {
                    let path_owned = path.to_path_buf();
                    let result = std::panic::catch_unwind(move || {
                        extract_metadata(&path_owned)
                    });
                    match result {
                        Ok(Some(track)) => tracks.push(track),
                        Ok(None) => {}
                        Err(_) => {}
                    }
                }
            }
        }
    }
    tracks
}

pub fn extract_metadata(path: &Path) -> Option<Track> {
    let file = File::open(path).ok()?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();

    let extension = path.extension().map(|e| e.to_string_lossy().to_uppercase());
    if let Some(ref ext) = extension {
        hint.with_extension(ext);
    }

    let mut probed = get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .ok()?;

    let mut title = None;
    let mut artist = None;
    let mut album = None;

    if let Some(metadata) = probed.format.metadata().current() {
        for tag in metadata.tags() {
            match tag.std_key {
                Some(symphonia::core::meta::StandardTagKey::TrackTitle) => title = Some(tag.value.to_string()),
                Some(symphonia::core::meta::StandardTagKey::Artist) => artist = Some(tag.value.to_string()),
                Some(symphonia::core::meta::StandardTagKey::Album) => album = Some(tag.value.to_string()),
                _ => {}
            }
        }
    }

    if title.is_none() {
        if let Some(rev) = probed.metadata.get() {
            if let Some(metadata) = rev.current() {
                for tag in metadata.tags() {
                    match tag.std_key {
                        Some(symphonia::core::meta::StandardTagKey::TrackTitle) => title = Some(tag.value.to_string()),
                        Some(symphonia::core::meta::StandardTagKey::Artist) => artist = Some(tag.value.to_string()),
                        Some(symphonia::core::meta::StandardTagKey::Album) => album = Some(tag.value.to_string()),
                        _ => {}
                    }
                }
            }
        }
    }

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
    })
}
