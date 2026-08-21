#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LyricWord {
    pub time_secs: f64,
    pub text: String,
}

/// Parses .lrc lyric files and returns timestamped lines.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LyricLine {
    pub time_secs: f64,
    pub text: String,
    pub words: Option<Vec<LyricWord>>,
}

pub fn clean_url_for_lyrics(url_str: &str) -> String {
    if let Ok(mut parsed) = url::Url::parse(url_str) {
        let query_pairs: Vec<(String, String)> = parsed.query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .filter(|(k, _)| k != "t" && k != "s" && k != "u" && k != "api_key")
            .collect();
            
        parsed.set_query(None);
        if !query_pairs.is_empty() {
            let mut serializer = parsed.query_pairs_mut();
            for (k, v) in query_pairs {
                serializer.append_pair(&k, &v);
            }
            drop(serializer);
        }
        parsed.to_string()
    } else {
        url_str.to_string()
    }
}

pub fn get_lrc_path(audio_path: &str) -> std::path::PathBuf {
    if audio_path.starts_with("http://") || audio_path.starts_with("https://") {
        let cleaned = clean_url_for_lyrics(audio_path);
        let data_dir = dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
        let lyrics_dir = data_dir.join("Aideo").join("lyrics");
        let _ = std::fs::create_dir_all(&lyrics_dir);
        let hash = format!("{:x}", md5::compute(cleaned.as_bytes()));
        lyrics_dir.join(format!("{}.lrc", hash))
    } else {
        std::path::Path::new(audio_path).with_extension("lrc")
    }
}

/// Extracts embedded lyric tags from audio file (USLT, LYRICS, UNSYNCEDLYRICS)
pub fn extract_embedded_lyrics(audio_path: &str) -> Option<String> {
    let path = std::path::Path::new(audio_path);
    if !path.exists() {
        return None;
    }

    let file = std::fs::File::open(path).ok()?;
    let mss = symphonia::core::io::MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = symphonia::core::probe::Hint::new();
    if let Some(ext) = path.extension() {
        hint.with_extension(&ext.to_string_lossy());
    }

    let mut probed = symphonia::default::get_probe()
        .format(&hint, mss, &symphonia::core::formats::FormatOptions::default(), &symphonia::core::meta::MetadataOptions::default())
        .ok()?;

    if let Some(metadata) = probed.format.metadata().current() {
        for tag in metadata.tags() {
            if let Some(symphonia::core::meta::StandardTagKey::Lyrics) = tag.std_key {
                let s = tag.value.to_string();
                if !s.trim().is_empty() {
                    return Some(s);
                }
            }
            let key_upper = tag.key.to_uppercase();
            if key_upper == "LYRICS" || key_upper == "UNSYNCEDLYRICS" || key_upper == "UNSYNCED LYRICS" || key_upper == "USLT" || key_upper == "SYLT" {
                let s = tag.value.to_string();
                if !s.trim().is_empty() {
                    return Some(s);
                }
            }
        }
    }

    if let Some(rev) = probed.metadata.get() {
        if let Some(metadata) = rev.current() {
            for tag in metadata.tags() {
                if let Some(symphonia::core::meta::StandardTagKey::Lyrics) = tag.std_key {
                    let s = tag.value.to_string();
                    if !s.trim().is_empty() {
                        return Some(s);
                    }
                }
                let key_upper = tag.key.to_uppercase();
                if key_upper == "LYRICS" || key_upper == "UNSYNCEDLYRICS" || key_upper == "UNSYNCED LYRICS" || key_upper == "USLT" || key_upper == "SYLT" {
                    let s = tag.value.to_string();
                    if !s.trim().is_empty() {
                        return Some(s);
                    }
                }
            }
        }
    }

    None
}

/// Finds a .lrc file next to the audio file, in AppData cache, or embedded in audio tags, and parses it.
pub fn get_lyrics_for_track(audio_path: &str) -> Vec<LyricLine> {
    let lrc_path = get_lrc_path(audio_path);
    if lrc_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&lrc_path) {
            let parsed = parse_lrc(&content);
            if !parsed.is_empty() {
                return parsed;
            }
        }
    }

    // Fallback: extract embedded lyrics from the audio file itself
    if let Some(embedded) = extract_embedded_lyrics(audio_path) {
        let parsed = parse_lrc(&embedded);
        if !parsed.is_empty() {
            return parsed;
        }
    }

    Vec::new()
}

fn parse_line_words(line_start_secs: f64, text: &str) -> (String, Option<Vec<LyricWord>>) {
    // 1. Check if it's NetEase / QQ Music style with parenthesis: (offset_ms, duration_ms, ...)
    if text.contains('(') && text.contains(')') {
        let mut words = Vec::new();
        let mut clean_text_parts = Vec::new();
        
        let parts: Vec<&str> = text.split('(').collect();
        for part in parts {
            if part.is_empty() {
                continue;
            }
            if let Some(close_idx) = part.find(')') {
                let meta_str = &part[..close_idx];
                let word_text = &part[close_idx + 1..];
                
                let nums: Vec<&str> = meta_str.split(',').collect();
                if nums.len() >= 2 {
                    if let (Ok(offset_ms), Ok(_duration_ms)) = (nums[0].trim().parse::<f64>(), nums[1].trim().parse::<f64>()) {
                        let abs_time = line_start_secs + (offset_ms / 1000.0);
                        if !word_text.is_empty() {
                            words.push(LyricWord {
                                time_secs: abs_time,
                                text: word_text.to_string(),
                            });
                            clean_text_parts.push(word_text.to_string());
                        }
                    }
                }
            } else if !part.trim().is_empty() {
                clean_text_parts.push(part.to_string());
            }
        }
        
        if !words.is_empty() {
            let joined = clean_text_parts.join("").trim().to_string();
            return (joined, Some(words));
        }
    }
    
    // 2. Check if it is Enhanced LRC format with angle brackets: <mm:ss.xx> or <ss.xx>
    if text.contains('<') && text.contains('>') {
        let mut words = Vec::new();
        let mut clean_text_parts = Vec::new();
        
        let parts: Vec<&str> = text.split('<').collect();
        for part in parts {
            if part.is_empty() {
                continue;
            }
            if let Some(close_idx) = part.find('>') {
                let ts_str = &part[..close_idx];
                let word_text = &part[close_idx + 1..];
                if let Some(ts) = parse_timestamp(ts_str) {
                    let abs_ts = if ts < line_start_secs { line_start_secs + ts } else { ts };
                    if !word_text.is_empty() {
                        words.push(LyricWord {
                            time_secs: abs_ts,
                            text: word_text.to_string(),
                        });
                        clean_text_parts.push(word_text.to_string());
                    }
                }
            } else if !part.trim().is_empty() {
                clean_text_parts.push(part.to_string());
            }
        }
        
        if !words.is_empty() {
            let joined = clean_text_parts.join("").trim().to_string();
            return (joined, Some(words));
        }
    }
    
    (text.to_string(), None)
}

pub fn parse_lrc(content: &str) -> Vec<LyricLine> {
    let mut lines = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || !line.starts_with('[') {
            continue;
        }
        let mut rest = line;
        let mut timestamps = Vec::new();
        while rest.starts_with('[') {
            if let Some(close) = rest.find(']') {
                let ts_str = &rest[1..close];
                if let Some(t) = parse_timestamp(ts_str) {
                    timestamps.push(t);
                }
                rest = rest[close + 1..].trim_start();
            } else {
                break;
            }
        }
        
        let line_start = timestamps.first().copied().unwrap_or(0.0);
        let (clean_text, words) = parse_line_words(line_start, rest);
        
        if clean_text.contains(':') && timestamps.is_empty() {
            continue;
        }
        for ts in timestamps {
            lines.push(LyricLine {
                time_secs: ts,
                text: clean_text.clone(),
                words: words.clone(),
            });
        }
    }

    // Plain-lyrics fallback: if nothing parsed (no timestamped lines) but the file
    // has real text content (e.g. LRCLIB `plainLyrics`), synthesize unsynced lines
    // so the UI can still display them instead of reporting "No Lyrics".
    if lines.is_empty() {
        let has_text = content.lines().any(|l| {
            let t = l.trim();
            !t.is_empty() && !t.starts_with('[')
        });
        if has_text {
            for line in content.lines() {
                let text = line.trim();
                if text.is_empty() || text.starts_with('[') {
                    continue;
                }
                lines.push(LyricLine {
                    time_secs: 0.0,
                    text: text.to_string(),
                    words: None,
                });
            }
        }
    }

    lines.sort_by(|a, b| a.time_secs.partial_cmp(&b.time_secs)
        .unwrap_or(std::cmp::Ordering::Equal));
    lines
}

fn parse_timestamp(ts: &str) -> Option<f64> {
    let ts = ts.trim();
    if let Some(colon) = ts.find(':') {
        let minutes: f64 = ts[..colon].parse().ok()?;
        let seconds: f64 = ts[colon + 1..].parse().ok()?;
        Some(minutes * 60.0 + seconds)
    } else {
        ts.parse::<f64>().ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_lrc_enhanced_relative_timestamps() {
        let content = "[01:30.00] <00:01.00>Hello <00:02.50>world";
        let lines = parse_lrc(content);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].time_secs, 90.0);
        let words = lines[0].words.as_ref().expect("words should be present");
        assert_eq!(words.len(), 2);
        assert_eq!(words[0].text, "Hello ");
        assert_eq!(words[0].time_secs, 91.0);
        assert_eq!(words[1].text, "world");
        assert_eq!(words[1].time_secs, 92.5);
    }

    #[test]
    fn test_parse_lrc_enhanced_absolute_timestamps() {
        let content = "[01:30.00] <01:31.00>Hello <01:32.50>world";
        let lines = parse_lrc(content);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].time_secs, 90.0);
        let words = lines[0].words.as_ref().expect("words should be present");
        assert_eq!(words.len(), 2);
        assert_eq!(words[0].text, "Hello ");
        assert_eq!(words[0].time_secs, 91.0);
        assert_eq!(words[1].text, "world");
        assert_eq!(words[1].time_secs, 92.5);
    }

    #[test]
    fn test_parse_lrc_subsecond_relative_timestamps() {
        let content = "[00:45.00] <0.50>Quick <1.20>fox";
        let lines = parse_lrc(content);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].time_secs, 45.0);
        let words = lines[0].words.as_ref().expect("words should be present");
        assert_eq!(words.len(), 2);
        assert_eq!(words[0].text, "Quick ");
        assert_eq!(words[0].time_secs, 45.5);
        assert_eq!(words[1].text, "fox");
        assert_eq!(words[1].time_secs, 46.2);
    }

    #[test]
    fn test_parse_lrc_netease_parentheses_timestamps() {
        let content = "[00:10.00] (500,300)Test (800,200)word";
        let lines = parse_lrc(content);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].time_secs, 10.0);
        let words = lines[0].words.as_ref().expect("words should be present");
        assert_eq!(words.len(), 2);
        assert_eq!(words[0].text, "Test ");
        assert_eq!(words[0].time_secs, 10.5);
        assert_eq!(words[1].text, "word");
        assert_eq!(words[1].time_secs, 10.8);
    }

    #[test]
    fn test_parse_lrc_boundary_zero_timestamp() {
        let content = "[00:00.00] <00:00.00>Start <00:01.50>Next";
        let lines = parse_lrc(content);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].time_secs, 0.0);
        let words = lines[0].words.as_ref().expect("words should be present");
        assert_eq!(words.len(), 2);
        assert_eq!(words[0].text, "Start ");
        assert_eq!(words[0].time_secs, 0.0);
        assert_eq!(words[1].text, "Next");
        assert_eq!(words[1].time_secs, 1.5);
    }

    #[test]
    fn test_parse_lrc_boundary_relative_zero_on_non_zero_line() {
        let content = "[00:15.00] <00:00.00>First <00:02.00>Second";
        let lines = parse_lrc(content);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].time_secs, 15.0);
        let words = lines[0].words.as_ref().expect("words should be present");
        assert_eq!(words.len(), 2);
        assert_eq!(words[0].text, "First ");
        assert_eq!(words[0].time_secs, 15.0);
        assert_eq!(words[1].text, "Second");
        assert_eq!(words[1].time_secs, 17.0);
    }

    #[test]
    fn test_parse_lrc_boundary_absolute_exact_match_line_start() {
        let content = "[00:15.00] <00:15.00>First <00:17.00>Second";
        let lines = parse_lrc(content);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].time_secs, 15.0);
        let words = lines[0].words.as_ref().expect("words should be present");
        assert_eq!(words.len(), 2);
        assert_eq!(words[0].text, "First ");
        assert_eq!(words[0].time_secs, 15.0);
        assert_eq!(words[1].text, "Second");
        assert_eq!(words[1].time_secs, 17.0);
    }
}
