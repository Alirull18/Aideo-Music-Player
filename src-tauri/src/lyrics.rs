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

/// Finds a .lrc file next to the audio file or in AppData cache and parses it.
pub fn get_lyrics_for_track(audio_path: &str) -> Vec<LyricLine> {
    let lrc_path = get_lrc_path(audio_path);
    if !lrc_path.exists() {
        return Vec::new();
    }
    let content = match std::fs::read_to_string(&lrc_path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    parse_lrc(&content)
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
                    if !word_text.is_empty() {
                        words.push(LyricWord {
                            time_secs: ts,
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
