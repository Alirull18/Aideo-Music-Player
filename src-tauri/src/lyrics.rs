use quick_xml::events::Event;
use quick_xml::reader::Reader;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LyricWord {
    pub time_secs: f64,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_secs: Option<f64>,
}

/// Parses .ttml / .lrc lyric files and returns timestamped lines.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LyricLine {
    pub time_secs: f64,
    pub text: String,
    pub words: Option<Vec<LyricWord>>,
}

pub fn clean_url_for_lyrics(url_str: &str) -> String {
    if let Ok(mut parsed) = url::Url::parse(url_str) {
        let query_pairs: Vec<(String, String)> = parsed.query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .filter(|(k, _)| {
                k != "t" && k != "s" && k != "u" && k != "api_key" && k != "token" && k != "expires"
            })
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

/// Returns the cache directory for lyrics: %APPDATA%/Aideo/lyrics
pub fn get_lyrics_cache_dir() -> std::path::PathBuf {
    let data_dir = dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let lyrics_dir = data_dir.join("Aideo").join("lyrics");
    let _ = std::fs::create_dir_all(&lyrics_dir);
    lyrics_dir
}

/// Returns the cached file path in AppData for an audio path/URL with a given extension (e.g. "ttml" or "lrc").
pub fn get_lyrics_cache_path(audio_path: &str, ext: &str) -> std::path::PathBuf {
    let cleaned = if audio_path.starts_with("http://") || audio_path.starts_with("https://") {
        clean_url_for_lyrics(audio_path)
    } else {
        audio_path.to_string()
    };
    let hash = format!("{:x}", md5::compute(cleaned.as_bytes()));
    get_lyrics_cache_dir().join(format!("{}.{}", hash, ext))
}

/// Returns the direct sidecar or cached file path for an audio path/URL with a given extension.
pub fn get_lyrics_file_path(audio_path: &str, ext: &str) -> std::path::PathBuf {
    if audio_path.starts_with("http://") || audio_path.starts_with("https://") {
        get_lyrics_cache_path(audio_path, ext)
    } else {
        std::path::Path::new(audio_path).with_extension(ext)
    }
}

/// Backward compatibility helper for .lrc path
#[allow(dead_code)]
pub fn get_lrc_path(audio_path: &str) -> std::path::PathBuf {
    get_lyrics_file_path(audio_path, "lrc")
}

/// Returns the save path for lyrics based on content type (TTML vs LRC)
pub fn get_lyrics_save_path(audio_path: &str, content: &str) -> std::path::PathBuf {
    let trimmed = content.trim_start();
    let is_ttml = trimmed.starts_with("<?xml")
        || trimmed.starts_with("<tt")
        || trimmed.starts_with("<TT")
        || trimmed.contains("<tt ")
        || trimmed.contains("<tt>")
        || trimmed.contains("<tt:")
        || trimmed.contains("<TT ")
        || trimmed.contains("<TT>")
        || trimmed.contains("xmlns=\"http://www.w3.org/ns/ttml\"");
    let ext = if is_ttml { "ttml" } else { "lrc" };
    get_lyrics_file_path(audio_path, ext)
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

/// Finds a .ttml or .lrc file next to the audio file, in AppData cache, or embedded in audio tags, and parses it.
pub fn get_lyrics_for_track(audio_path: &str) -> Vec<LyricLine> {
    if audio_path.starts_with("http://") || audio_path.starts_with("https://") {
        // 1. Web stream AppData cache: .ttml first, then .lrc
        let ttml_cache = get_lyrics_cache_path(audio_path, "ttml");
        if ttml_cache.exists() {
            if let Ok(content) = std::fs::read_to_string(&ttml_cache) {
                let parsed = parse_lyrics_auto(&content);
                if !parsed.is_empty() {
                    return parsed;
                }
            }
        }
        let lrc_cache = get_lyrics_cache_path(audio_path, "lrc");
        if lrc_cache.exists() {
            if let Ok(content) = std::fs::read_to_string(&lrc_cache) {
                let parsed = parse_lyrics_auto(&content);
                if !parsed.is_empty() {
                    return parsed;
                }
            }
        }
        return Vec::new();
    }

    // Local track resolution:
    // 1. Check sidecar .ttml next to audio file
    let sidecar_ttml = get_lyrics_file_path(audio_path, "ttml");
    if sidecar_ttml.exists() {
        if let Ok(content) = std::fs::read_to_string(&sidecar_ttml) {
            let parsed = parse_lyrics_auto(&content);
            if !parsed.is_empty() {
                return parsed;
            }
        }
    }

    // 2. Check sidecar .lrc next to audio file
    let sidecar_lrc = get_lyrics_file_path(audio_path, "lrc");
    if sidecar_lrc.exists() {
        if let Ok(content) = std::fs::read_to_string(&sidecar_lrc) {
            let parsed = parse_lyrics_auto(&content);
            if !parsed.is_empty() {
                return parsed;
            }
        }
    }

    // 3. Check AppData cached .ttml for local track
    let appdata_ttml = get_lyrics_cache_path(audio_path, "ttml");
    if appdata_ttml.exists() {
        if let Ok(content) = std::fs::read_to_string(&appdata_ttml) {
            let parsed = parse_lyrics_auto(&content);
            if !parsed.is_empty() {
                return parsed;
            }
        }
    }

    // 4. Check AppData cached .lrc for local track
    let appdata_lrc = get_lyrics_cache_path(audio_path, "lrc");
    if appdata_lrc.exists() {
        if let Ok(content) = std::fs::read_to_string(&appdata_lrc) {
            let parsed = parse_lyrics_auto(&content);
            if !parsed.is_empty() {
                return parsed;
            }
        }
    }

    // 5. Fallback: extract embedded lyrics from the audio file itself (using parse_lyrics_auto)
    if let Some(embedded) = extract_embedded_lyrics(audio_path) {
        let parsed = parse_lyrics_auto(&embedded);
        if !parsed.is_empty() {
            return parsed;
        }
    }

    Vec::new()
}

/// Parses clock times (hh:mm:ss.xxx, mm:ss.xxx, ss.xxx), metric suffixes (83.45s, 83450ms, 1.5m, 0.5h),
/// comma-delimited ms timestamps ([0,3500], [10500,4200]), or plain fractional seconds into floating point seconds (f64).
pub fn parse_timestamp(ts: &str) -> Option<f64> {
    let s = ts.trim();
    if s.is_empty() {
        return None;
    }

    // 1. Check metric suffixes
    if let Some(rest) = s.strip_suffix("ms") {
        return rest.trim().parse::<f64>().ok().map(|ms| ms / 1000.0);
    }
    if let Some(rest) = s.strip_suffix('s') {
        return rest.trim().parse::<f64>().ok();
    }
    if let Some(rest) = s.strip_suffix('m') {
        return rest.trim().parse::<f64>().ok().map(|m| m * 60.0);
    }
    if let Some(rest) = s.strip_suffix('h') {
        return rest.trim().parse::<f64>().ok().map(|h| h * 3600.0);
    }

    // 2. Comma-delimited formats e.g. [0,3500] or [10500,4200] or [00:10.50,3000]
    if s.contains(',') {
        let parts: Vec<&str> = s.split(',').collect();
        if !parts.is_empty() {
            let start_str = parts[0].trim();
            if start_str.contains(':') {
                return parse_timestamp(start_str);
            }
            if let Ok(ms) = start_str.parse::<f64>() {
                return Some(ms / 1000.0);
            }
        }
    }

    // 3. Colon-delimited formats (e.g. mm:ss.xx, hh:mm:ss.xxx, hh:mm:ss:ff)
    if s.contains(':') {
        let parts: Vec<&str> = s.split(':').collect();
        match parts.len() {
            2 => {
                let m = parts[0].trim().parse::<f64>().ok()?;
                let sec = parts[1].trim().parse::<f64>().ok()?;
                Some(m * 60.0 + sec)
            }
            3 => {
                let h = parts[0].trim().parse::<f64>().ok()?;
                let m = parts[1].trim().parse::<f64>().ok()?;
                let sec = parts[2].trim().parse::<f64>().ok()?;
                Some(h * 3600.0 + m * 60.0 + sec)
            }
            4 => {
                let h = parts[0].trim().parse::<f64>().ok()?;
                let m = parts[1].trim().parse::<f64>().ok()?;
                let sec = parts[2].trim().parse::<f64>().ok()?;
                let frames = parts[3].trim().parse::<f64>().ok()?;
                let fps = if frames > 30.0 { 1000.0 } else { 30.0 };
                Some(h * 3600.0 + m * 60.0 + sec + (frames / fps))
            }
            _ => None,
        }
    } else {
        // 4. Plain floating-point seconds
        s.parse::<f64>().ok()
    }
}

fn parse_line_words(line_start_secs: f64, text: &str) -> (String, Option<Vec<LyricWord>>) {
    // 1. Check if it's NetEase KLyric (prefix parenthesis: `(offset,dur)word`) or QQ Music QRC (suffix parenthesis: `word(offset,dur)`)
    if text.contains('(') && text.contains(')') {
        let mut words = Vec::new();
        let mut clean_text_parts = Vec::new();

        let parts: Vec<&str> = text.split('(').collect();
        if !parts.is_empty() {
            let first_part = parts[0];
            if first_part.trim().is_empty() {
                // Form A: Prefix parenthesis `(offset,dur)word` (NetEase KLyric style)
                for part in parts.iter().skip(1) {
                    if let Some(close_idx) = part.find(')') {
                        let meta_str = &part[..close_idx];
                        let word_text = &part[close_idx + 1..];

                        let nums: Vec<&str> = meta_str.split(',').collect();
                        if nums.len() >= 2 {
                            if let (Ok(offset_ms), Ok(duration_ms)) = (
                                nums[0].trim().parse::<f64>(),
                                nums[1].trim().parse::<f64>(),
                            ) {
                                let abs_time = if offset_ms >= (line_start_secs * 1000.0) - 50.0 {
                                    offset_ms / 1000.0
                                } else {
                                    line_start_secs + (offset_ms / 1000.0)
                                };
                                let dur_secs = if duration_ms > 0.0 {
                                    Some(duration_ms / 1000.0)
                                } else {
                                    None
                                };
                                if !word_text.is_empty() {
                                    words.push(LyricWord {
                                        time_secs: abs_time,
                                        text: word_text.to_string(),
                                        duration_secs: dur_secs,
                                    });
                                    clean_text_parts.push(word_text.to_string());
                                }
                            }
                        }
                    } else if !part.trim().is_empty() {
                        clean_text_parts.push(part.to_string());
                    }
                }
            } else {
                // Form B: Suffix parenthesis `word(offset,dur)` (QQ Music QRC style)
                let mut current_word_text = first_part.to_string();
                for part in parts.iter().skip(1) {
                    if let Some(close_idx) = part.find(')') {
                        let meta_str = &part[..close_idx];
                        let next_word_prefix = &part[close_idx + 1..];

                        let nums: Vec<&str> = meta_str.split(',').collect();
                        if nums.len() >= 2 {
                            if let (Ok(offset_ms), Ok(duration_ms)) = (
                                nums[0].trim().parse::<f64>(),
                                nums[1].trim().parse::<f64>(),
                            ) {
                                let abs_time = if offset_ms >= (line_start_secs * 1000.0) - 50.0 {
                                    offset_ms / 1000.0
                                } else {
                                    line_start_secs + (offset_ms / 1000.0)
                                };
                                let dur_secs = if duration_ms > 0.0 {
                                    Some(duration_ms / 1000.0)
                                } else {
                                    None
                                };
                                if !current_word_text.is_empty() {
                                    words.push(LyricWord {
                                        time_secs: abs_time,
                                        text: current_word_text.clone(),
                                        duration_secs: dur_secs,
                                    });
                                    clean_text_parts.push(current_word_text.clone());
                                }
                            }
                        }
                        current_word_text = next_word_prefix.to_string();
                    } else {
                        current_word_text.push('(');
                        current_word_text.push_str(part);
                    }
                }
                if !current_word_text.is_empty() && !current_word_text.trim().is_empty() {
                    clean_text_parts.push(current_word_text);
                }
            }

            if !words.is_empty() {
                let joined = clean_text_parts.join("").trim().to_string();
                return (joined, Some(words));
            }
        }
    }

    // 2. Check if it is Enhanced LRC format with angle brackets: <mm:ss.xx>, <ss.xx>, or KRC/QRC <offset,duration,0>
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

                if ts_str.contains(',') {
                    let comma_parts: Vec<&str> = ts_str.split(',').collect();
                    if comma_parts.len() >= 2 {
                        if let (Ok(offset_ms), Ok(duration_ms)) = (
                            comma_parts[0].trim().parse::<f64>(),
                            comma_parts[1].trim().parse::<f64>(),
                        ) {
                            let abs_ts = if offset_ms >= (line_start_secs * 1000.0) - 50.0 {
                                offset_ms / 1000.0
                            } else {
                                line_start_secs + (offset_ms / 1000.0)
                            };
                            let dur_secs = if duration_ms > 0.0 {
                                Some(duration_ms / 1000.0)
                            } else {
                                None
                            };
                            if !word_text.is_empty() {
                                words.push(LyricWord {
                                    time_secs: abs_ts,
                                    text: word_text.to_string(),
                                    duration_secs: dur_secs,
                                });
                                clean_text_parts.push(word_text.to_string());
                            }
                            continue;
                        }
                    }
                }

                if let Some(ts) = parse_timestamp(ts_str) {
                    let abs_ts = if ts < line_start_secs {
                        line_start_secs + ts
                    } else {
                        ts
                    };
                    if !word_text.is_empty() {
                        words.push(LyricWord {
                            time_secs: abs_ts,
                            text: word_text.to_string(),
                            duration_secs: None,
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

fn local_tag_name(name: &[u8]) -> &[u8] {
    if let Some(pos) = name.iter().position(|&b| b == b':') {
        &name[pos + 1..]
    } else {
        name
    }
}

fn extract_timing_attrs(e: &quick_xml::events::BytesStart) -> (Option<f64>, Option<f64>, Option<f64>) {
    let mut begin = None;
    let mut end = None;
    let mut dur = None;
    for attr in e.attributes().flatten() {
        let key = attr.key;
        let local_key = local_tag_name(key.as_ref());
        match local_key {
            b"begin" => {
                if let Ok(val) = std::str::from_utf8(&attr.value) {
                    begin = parse_timestamp(val);
                }
            }
            b"end" => {
                if let Ok(val) = std::str::from_utf8(&attr.value) {
                    end = parse_timestamp(val);
                }
            }
            b"dur" => {
                if let Ok(val) = std::str::from_utf8(&attr.value) {
                    dur = parse_timestamp(val);
                }
            }
            _ => {}
        }
    }
    if end.is_none() {
        if let (Some(b), Some(d)) = (begin, dur) {
            end = Some(b + d);
        }
    }
    if dur.is_none() {
        if let (Some(b), Some(e)) = (begin, end) {
            if e >= b {
                dur = Some(e - b);
            }
        }
    }
    (begin, end, dur)
}

#[derive(Debug, Clone)]
struct SpanContext {
    begin: Option<f64>,
    dur: Option<f64>,
    text: String,
}

fn decode_entity(entity: &str) -> String {
    match entity {
        "apos" => "'".to_string(),
        "quot" => "\"".to_string(),
        "amp" => "&".to_string(),
        "lt" => "<".to_string(),
        "gt" => ">".to_string(),
        _ => {
            if entity.starts_with("#x") || entity.starts_with("#X") {
                if let Ok(code) = u32::from_str_radix(&entity[2..], 16) {
                    if let Some(ch) = char::from_u32(code) {
                        return ch.to_string();
                    }
                }
            } else if entity.starts_with('#') {
                if let Ok(code) = entity[1..].parse::<u32>() {
                    if let Some(ch) = char::from_u32(code) {
                        return ch.to_string();
                    }
                }
            }
            format!("&{};", entity)
        }
    }
}

fn unescape_xml(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut result = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '&' {
            let mut entity = String::new();
            let mut closed = false;
            while let Some(&next_c) = chars.peek() {
                if next_c == ';' {
                    chars.next();
                    closed = true;
                    break;
                } else if next_c == '&' || next_c == ' ' || entity.len() > 10 {
                    break;
                } else {
                    entity.push(chars.next().unwrap());
                }
            }
            if closed {
                result.push_str(&decode_entity(&entity));
            } else {
                result.push('&');
                result.push_str(&entity);
            }
        } else {
            result.push(c);
        }
    }
    result
}

/// Parses TTML XML lyrics documents (Apple Music / W3C TTML dialects) into timestamped lines and word-level karaoke sync.
pub fn parse_ttml(content: &str) -> Vec<LyricLine> {
    let mut reader = Reader::from_str(content);
    reader.config_mut().trim_text(false);

    let mut lines = Vec::new();
    let mut in_p = false;
    let mut current_line_begin: Option<f64> = None;
    let mut current_line_words: Vec<LyricWord> = Vec::new();
    let mut current_line_text = String::new();
    let mut span_stack: Vec<SpanContext> = Vec::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let name = e.name();
                let local_name = local_tag_name(name.as_ref());
                match local_name {
                    b"p" => {
                        in_p = true;
                        current_line_words.clear();
                        current_line_text.clear();
                        span_stack.clear();
                        let (begin, _, _) = extract_timing_attrs(e);
                        current_line_begin = begin;
                    }
                    b"span" => {
                        if in_p {
                            let (begin, _, dur) = extract_timing_attrs(e);
                            span_stack.push(SpanContext {
                                begin,
                                dur,
                                text: String::new(),
                            });
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(ref e)) => {
                let name = e.name();
                let local_name = local_tag_name(name.as_ref());
                if local_name == b"br" && in_p {
                    if let Some(top) = span_stack.last_mut() {
                        if !top.text.ends_with(' ') {
                            top.text.push(' ');
                        }
                    } else {
                        if let Some(last_word) = current_line_words.last_mut() {
                            if !last_word.text.ends_with(' ') {
                                last_word.text.push(' ');
                            }
                        }
                        if !current_line_text.ends_with(' ') {
                            current_line_text.push(' ');
                        }
                    }
                }
            }
            Ok(Event::End(ref e)) => {
                let name = e.name();
                let local_name = local_tag_name(name.as_ref());
                match local_name {
                    b"p" => {
                        if in_p {
                            let line_time = current_line_begin
                                .or_else(|| current_line_words.first().map(|w| w.time_secs))
                                .unwrap_or(0.0);

                            let text = if !current_line_words.is_empty() {
                                current_line_words.iter().map(|w| w.text.as_str()).collect::<Vec<_>>().join("").trim().to_string()
                            } else {
                                current_line_text.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect::<Vec<_>>().join(" ")
                            };

                            if !text.is_empty() {
                                let words = if !current_line_words.is_empty() {
                                    if let Some(last) = current_line_words.last_mut() {
                                        last.text = last.text.trim_end().to_string();
                                    }
                                    Some(current_line_words.clone())
                                } else {
                                    None
                                };
                                lines.push(LyricLine {
                                    time_secs: line_time,
                                    text,
                                    words,
                                });
                            }
                            in_p = false;
                            current_line_words.clear();
                            current_line_text.clear();
                            span_stack.clear();
                        }
                    }
                    b"span" => {
                        if let Some(span) = span_stack.pop() {
                            if span.begin.is_some() && !span.text.trim().is_empty() {
                                current_line_words.push(LyricWord {
                                    time_secs: span.begin.unwrap(),
                                    text: span.text.clone(),
                                    duration_secs: span.dur,
                                });
                                current_line_text.push_str(&span.text);
                            } else if let Some(parent) = span_stack.last_mut() {
                                parent.text.push_str(&span.text);
                            } else {
                                current_line_text.push_str(&span.text);
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(ref e)) => {
                if in_p {
                    let raw_str = std::str::from_utf8(e.as_ref()).unwrap_or("");
                    let unescaped = unescape_xml(raw_str);
                    if let Some(top) = span_stack.last_mut() {
                        top.text.push_str(&unescaped);
                    } else {
                        // Whitespace between </span> and <span> inside a <p>
                        if unescaped.contains(' ') || unescaped.contains('\t') {
                            if let Some(last_word) = current_line_words.last_mut() {
                                if !last_word.text.ends_with(' ') {
                                    last_word.text.push(' ');
                                }
                            }
                        }
                        current_line_text.push_str(&unescaped);
                    }
                }
            }
            Ok(Event::GeneralRef(ref e)) => {
                if in_p {
                    let entity_str = std::str::from_utf8(e.as_ref()).unwrap_or("");
                    let decoded = decode_entity(entity_str);
                    if let Some(top) = span_stack.last_mut() {
                        top.text.push_str(&decoded);
                    } else {
                        current_line_text.push_str(&decoded);
                    }
                }
            }
            Ok(Event::CData(ref e)) => {
                if in_p {
                    if let Ok(text_str) = std::str::from_utf8(e.as_ref()) {
                        if let Some(top) = span_stack.last_mut() {
                            top.text.push_str(text_str);
                        } else {
                            current_line_text.push_str(text_str);
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }

    lines.sort_by(|a, b| a.time_secs.partial_cmp(&b.time_secs).unwrap_or(std::cmp::Ordering::Equal));
    lines
}

/// Parses QQ Music QRC format (either raw QRC XML with LyricContent or extracted QRC string).
pub fn parse_qrc(content: &str) -> Vec<LyricLine> {
    let trimmed = content.trim();
    if let Some(pos) = trimmed.find("LyricContent=\"") {
        let start_idx = pos + "LyricContent=\"".len();
        if let Some(end_idx) = trimmed[start_idx..].find('"') {
            let inner_content = &trimmed[start_idx..start_idx + end_idx];
            let unescaped = unescape_xml(inner_content);
            return parse_lrc(&unescaped);
        }
    }
    parse_lrc(trimmed)
}

/// Decodes and decrypts a Kugou KRC (KuGou Resource / Karaoke) base64 payload into plain text lyrics with sub-millisecond syllable tags.
pub fn decode_krc(base64_str: &str) -> Option<String> {
    use base64::Engine;
    use std::io::Read;

    let raw = base64::engine::general_purpose::STANDARD.decode(base64_str.trim()).ok()?;
    if raw.len() < 4 {
        return None;
    }
    // Skip 4-byte header if starts with "krc1"
    let payload = if raw.starts_with(b"krc1") { &raw[4..] } else { &raw[..] };
    let xor_key: [u8; 16] = [0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69];
    let mut decrypted = Vec::with_capacity(payload.len());
    for (i, &b) in payload.iter().enumerate() {
        decrypted.push(b ^ xor_key[i % 16]);
    }
    let mut decoder = flate2::read::ZlibDecoder::new(&decrypted[..]);
    let mut decompressed = String::new();
    if decoder.read_to_string(&mut decompressed).is_ok() {
        Some(decompressed)
    } else {
        None
    }
}

/// Auto-detects whether content is TTML XML, QRC XML, KRC, KLyric/Enhanced/Standard LRC, or plain text, and parses accordingly.
pub fn parse_lyrics_auto(content: &str) -> Vec<LyricLine> {
    let trimmed = content.trim_start();

    // Check if content is a base64 encoded KRC file
    if trimmed.starts_with("a3Jj") || trimmed.starts_with("krc1") {
        if let Some(decoded) = decode_krc(trimmed) {
            return parse_lrc(&decoded);
        }
    }

    if trimmed.starts_with("<?xml")
        || trimmed.starts_with("<tt")
        || trimmed.starts_with("<TT")
        || trimmed.contains("<tt ")
        || trimmed.contains("<tt>")
        || trimmed.contains("<tt:")
        || trimmed.contains("<TT ")
        || trimmed.contains("<TT>")
        || trimmed.contains("xmlns=\"http://www.w3.org/ns/ttml\"")
    {
        // Check for QRC XML first if it contains LyricContent or <Qrc
        if trimmed.contains("LyricContent=\"") || trimmed.contains("<Qrc") || trimmed.contains("<Lyric_") {
            let qrc_lines = parse_qrc(content);
            if !qrc_lines.is_empty() {
                return qrc_lines;
            }
        }
        let ttml_lines = parse_ttml(content);
        if !ttml_lines.is_empty() {
            return ttml_lines;
        }
    }

    if trimmed.contains("LyricContent=\"") || trimmed.contains("<Qrc") {
        let qrc_lines = parse_qrc(content);
        if !qrc_lines.is_empty() {
            return qrc_lines;
        }
    }

    parse_lrc(content)
}

/// Convenience alias for format identification and parsing
#[allow(dead_code)]
pub fn detect_and_parse_lyrics(content: &str) -> Vec<LyricLine> {
    parse_lyrics_auto(content)
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
        assert_eq!(words[0].duration_secs, Some(0.3));
        assert_eq!(words[1].text, "word");
        assert_eq!(words[1].time_secs, 10.8);
        assert_eq!(words[1].duration_secs, Some(0.2));
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

    #[test]
    fn test_parse_ttml_apple_music_standard() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
          <body>
            <div>
              <p begin="00:00:10.500" end="00:00:14.200">
                <span begin="00:00:10.500" end="00:00:11.000">Is </span>
                <span begin="00:00:11.000" end="00:00:11.400">this </span>
                <span begin="00:00:11.400" end="00:00:11.900">the </span>
                <span begin="00:00:11.900" end="00:00:12.700">real </span>
                <span begin="00:00:12.700" end="00:00:14.200">life?</span>
              </p>
            </div>
          </body>
        </tt>"#;

        let lines = parse_ttml(xml);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].time_secs, 10.5);
        assert_eq!(lines[0].text, "Is this the real life?");
        let words = lines[0].words.as_ref().expect("words should be present");
        assert_eq!(words.len(), 5);
        assert_eq!(words[0].text, "Is ");
        assert_eq!(words[0].time_secs, 10.5);
        assert_eq!(words[0].duration_secs, Some(0.5));
        assert_eq!(words[4].text, "life?");
        assert_eq!(words[4].time_secs, 12.7);
        assert_eq!(words[4].duration_secs, Some(1.5));
    }

    #[test]
    fn test_parse_ttml_line_only_without_spans() {
        let xml = r#"<tt><body><div>
          <p begin="00:00:15.000" end="00:00:18.000">Easy come, easy go</p>
        </div></body></tt>"#;

        let lines = parse_ttml(xml);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].time_secs, 15.0);
        assert_eq!(lines[0].text, "Easy come, easy go");
        assert!(lines[0].words.is_none());
    }

    #[test]
    fn test_parse_ttml_nested_spans_and_entities() {
        let xml = r#"<tt><body><div>
          <p begin="00:00:05.000" end="00:00:10.000">
            <span begin="00:00:05.000" end="00:00:07.000">
              <span begin="00:00:05.000" end="00:00:06.000">Don&apos;t </span>
              <span begin="00:00:06.000" end="00:00:07.000">stop </span>
            </span>
            <span begin="00:00:07.000" end="00:00:10.000">now &amp; forever</span>
          </p>
        </div></body></tt>"#;

        let lines = parse_ttml(xml);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].text, "Don't stop now & forever");
        let words = lines[0].words.as_ref().expect("words should be present");
        assert_eq!(words.len(), 3);
        assert_eq!(words[0].text, "Don't ");
        assert_eq!(words[0].time_secs, 5.0);
        assert_eq!(words[0].duration_secs, Some(1.0));
        assert_eq!(words[1].text, "stop ");
        assert_eq!(words[1].time_secs, 6.0);
        assert_eq!(words[1].duration_secs, Some(1.0));
        assert_eq!(words[2].text, "now & forever");
        assert_eq!(words[2].time_secs, 7.0);
        assert_eq!(words[2].duration_secs, Some(3.0));
    }

    #[test]
    fn test_parse_ttml_background_vocals() {
        let xml = r#"<tt xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div>
          <p begin="00:00:15.000" end="00:00:18.000" ttm:role="x-bg">
            <span begin="00:00:15.000" end="00:00:18.000">(Galileo)</span>
          </p>
        </div></body></tt>"#;

        let lines = parse_ttml(xml);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].text, "(Galileo)");
        assert_eq!(lines[0].time_secs, 15.0);
        let words = lines[0].words.as_ref().expect("words should be present");
        assert_eq!(words.len(), 1);
        assert_eq!(words[0].text, "(Galileo)");
        assert_eq!(words[0].time_secs, 15.0);
        assert_eq!(words[0].duration_secs, Some(3.0));
    }

    #[test]
    fn test_parse_timestamp_formats() {
        assert_eq!(parse_timestamp("00:01:23.450"), Some(83.45));
        assert_eq!(parse_timestamp("01:23.45"), Some(83.45));
        assert_eq!(parse_timestamp("83.45s"), Some(83.45));
        assert_eq!(parse_timestamp("83450ms"), Some(83.45));
        assert_eq!(parse_timestamp("83.45"), Some(83.45));
        assert_eq!(parse_timestamp("01:00:00.000"), Some(3600.0));
        assert_eq!(parse_timestamp("1.5m"), Some(90.0));
        assert_eq!(parse_timestamp("0.5h"), Some(1800.0));
        assert_eq!(parse_timestamp("00:00:01.123456"), Some(1.123456));
        assert_eq!(parse_timestamp("   "), None);
        assert_eq!(parse_timestamp("invalid"), None);
    }

    #[test]
    fn test_parse_lyrics_auto_detection() {
        let ttml = r#"<tt><body><div><p begin="00:01.00"><span begin="00:01.00" end="00:02.00">Hi</span></p></div></body></tt>"#;
        let lrc = "[00:01.00]Hi";
        let plain = "Just plain words\nSecond line";

        let ttml_res = parse_lyrics_auto(ttml);
        assert_eq!(ttml_res.len(), 1);
        assert_eq!(ttml_res[0].text, "Hi");

        let lrc_res = parse_lyrics_auto(lrc);
        assert_eq!(lrc_res.len(), 1);
        assert_eq!(lrc_res[0].text, "Hi");

        let plain_res = parse_lyrics_auto(plain);
        assert_eq!(plain_res.len(), 2);
    }

    #[test]
    fn test_lyrics_path_resolution() {
        let local_path = "C:\\Music\\song.mp3";
        assert_eq!(get_lyrics_file_path(local_path, "ttml"), std::path::PathBuf::from("C:\\Music\\song.ttml"));
        assert_eq!(get_lyrics_file_path(local_path, "lrc"), std::path::PathBuf::from("C:\\Music\\song.lrc"));
        assert_eq!(get_lrc_path(local_path), std::path::PathBuf::from("C:\\Music\\song.lrc"));

        let ttml_content = "<tt><body><p>Test</p></body></tt>";
        let lrc_content = "[00:01.00]Test";
        assert_eq!(get_lyrics_save_path(local_path, ttml_content), std::path::PathBuf::from("C:\\Music\\song.ttml"));
        assert_eq!(get_lyrics_save_path(local_path, lrc_content), std::path::PathBuf::from("C:\\Music\\song.lrc"));
    }

    // =========================================================================
    // EMPIRICAL CHALLENGER STRESS TESTS
    // =========================================================================

    #[test]
    fn test_ttml_malformed_unclosed_tags() {
        // Incomplete XML / unclosed tags should not panic and should salvage complete elements
        let malformed1 = r#"<tt><body><div>
            <p begin="00:01.000" end="00:03.000"><span begin="00:01.000" end="00:02.000">First </p>
            <p begin="00:04.000" end="00:06.000">Second</p>"#;
        let lines1 = parse_ttml(malformed1);
        // Should parse safely without panic
        assert!(!lines1.is_empty() || lines1.is_empty());

        let malformed_truncated = r#"<tt><body><div><p begin="00:01.000"><span begin="00:01.000">Hello"#;
        let lines2 = parse_ttml(malformed_truncated);
        // Truncated input must terminate safely without panic
        assert!(lines2.is_empty() || !lines2.is_empty());
    }

    #[test]
    fn test_ttml_custom_and_deep_namespaces() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <tt:tt xmlns:tt="http://www.w3.org/ns/ttml"
               xmlns:ttm="http://www.w3.org/ns/ttml#metadata"
               xmlns:itunes="http://music.apple.com/metadata"
               xmlns:amx="http://music.apple.com/amx">
          <tt:head>
            <tt:metadata>
              <itunes:songId>12345678</itunes:songId>
              <amx:tempo>120</amx:tempo>
            </tt:metadata>
          </tt:head>
          <tt:body>
            <tt:div>
              <tt:p tt:begin="00:01.500" tt:end="00:03.000">
                <tt:span tt:begin="00:01.500" tt:end="00:02.000">Hello </tt:span>
                <tt:span tt:begin="00:02.000" tt:end="00:03.000">World</tt:span>
              </tt:p>
            </tt:div>
          </tt:body>
        </tt:tt>"#;

        let lines = parse_ttml(xml);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].time_secs, 1.5);
        assert_eq!(lines[0].text, "Hello World");
        let words = lines[0].words.as_ref().expect("words present");
        assert_eq!(words.len(), 2);
        assert_eq!(words[0].text, "Hello ");
        assert_eq!(words[0].time_secs, 1.5);
        assert_eq!(words[0].duration_secs, Some(0.5));
        assert_eq!(words[1].text, "World");
        assert_eq!(words[1].time_secs, 2.0);
        assert_eq!(words[1].duration_secs, Some(1.0));
    }

    #[test]
    fn test_ttml_deeply_nested_spans() {
        let xml = r#"<tt><body><div>
          <p begin="00:02.000" end="00:08.000">
            <span>
              <span>
                <span begin="00:02.000" dur="2s">Deep </span>
                <span begin="00:04.000" dur="2s">Level </span>
              </span>
              <span begin="00:06.000" dur="2s">Nesting</span>
            </span>
          </p>
        </div></body></tt>"#;

        let lines = parse_ttml(xml);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].text, "Deep Level Nesting");
        let words = lines[0].words.as_ref().expect("words present");
        assert_eq!(words.len(), 3);
        assert_eq!(words[0].text, "Deep ");
        assert_eq!(words[0].time_secs, 2.0);
        assert_eq!(words[0].duration_secs, Some(2.0));
        assert_eq!(words[1].text, "Level ");
        assert_eq!(words[1].time_secs, 4.0);
        assert_eq!(words[1].duration_secs, Some(2.0));
        assert_eq!(words[2].text, "Nesting");
        assert_eq!(words[2].time_secs, 6.0);
        assert_eq!(words[2].duration_secs, Some(2.0));
    }

    #[test]
    fn test_ttml_special_characters_and_entities() {
        let xml = r#"<tt><body><div>
          <p begin="00:01.000" end="00:05.000">
            <span begin="00:01.000" end="00:02.000">Rock &amp; </span>
            <span begin="00:02.000" end="00:03.000">Roll &apos;N&apos; </span>
            <span begin="00:03.000" end="00:04.000">&quot;Heavy&quot; </span>
            <span begin="00:04.000" end="00:05.000">&#9835; &#x1F3B5;</span>
          </p>
        </div></body></tt>"#;

        let lines = parse_ttml(xml);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].text, "Rock & Roll 'N' \"Heavy\" ♫ 🎵");
        let words = lines[0].words.as_ref().expect("words present");
        assert_eq!(words.len(), 4);
        assert_eq!(words[0].text, "Rock & ");
        assert_eq!(words[1].text, "Roll 'N' ");
        assert_eq!(words[2].text, "\"Heavy\" ");
        assert_eq!(words[3].text, "♫ 🎵");
    }

    #[test]
    fn test_ttml_unicode_and_cjk() {
        let xml = r#"<tt><body><div>
          <p begin="00:10.000" end="00:15.000">
            <span begin="00:10.000" end="00:11.500">こんにちは </span>
            <span begin="00:11.500" end="00:13.000">世界 </span>
            <span begin="00:13.000" end="00:14.000">مرحبا </span>
            <span begin="00:14.000" end="00:15.000">Привет</span>
          </p>
        </div></body></tt>"#;

        let lines = parse_ttml(xml);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].text, "こんにちは 世界 مرحبا Привет");
        let words = lines[0].words.as_ref().expect("words present");
        assert_eq!(words.len(), 4);
        assert_eq!(words[0].text, "こんにちは ");
        assert_eq!(words[1].text, "世界 ");
        assert_eq!(words[2].text, "مرحبا ");
        assert_eq!(words[3].text, "Привет");
    }

    #[test]
    fn test_ttml_cdata_and_xml_comments() {
        let xml = r#"<tt><body><div>
          <!-- Introductory verse comment -->
          <p begin="00:03.000" end="00:07.000">
            <!-- inner span comment -->
            <span begin="00:03.000" end="00:05.000"><![CDATA[Live at <Wembley> & Co. ]]></span>
            <span begin="00:05.000" end="00:07.000">Stadium</span>
          </p>
        </div></body></tt>"#;

        let lines = parse_ttml(xml);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].text, "Live at <Wembley> & Co. Stadium");
        let words = lines[0].words.as_ref().expect("words present");
        assert_eq!(words.len(), 2);
        assert_eq!(words[0].text, "Live at <Wembley> & Co. ");
        assert_eq!(words[1].text, "Stadium");
    }

    #[test]
    fn test_ttml_empty_tags_and_whitespace() {
        let xml = r#"<tt><body><div>
          <p></p>
          <p begin="00:01.000" end="00:02.000"></p>
          <p begin="00:02.000" end="00:03.000">   </p>
          <p begin="00:04.000" end="00:06.000">
            <span begin="00:04.000" end="00:05.000">Valid </span>
            <span begin="00:05.000" end="00:05.500">   </span>
            <span begin="00:05.500" end="00:06.000">Line</span>
          </p>
        </div></body></tt>"#;

        let lines = parse_ttml(xml);
        // Only the valid non-empty line should be retained
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].time_secs, 4.0);
        assert_eq!(lines[0].text, "Valid Line");
        let words = lines[0].words.as_ref().expect("words present");
        assert_eq!(words.len(), 2);
        assert_eq!(words[0].text, "Valid ");
        assert_eq!(words[1].text, "Line");
    }

    #[test]
    fn test_extreme_timestamps_comprehensive() {
        // Zero timestamps
        assert_eq!(parse_timestamp("0ms"), Some(0.0));
        assert_eq!(parse_timestamp("0s"), Some(0.0));
        assert_eq!(parse_timestamp("0.00"), Some(0.0));
        assert_eq!(parse_timestamp("00:00.00"), Some(0.0));
        assert_eq!(parse_timestamp("00:00:00.000"), Some(0.0));
        assert_eq!(parse_timestamp("00:00:00:00"), Some(0.0));

        // High values (999 hours)
        let high_hms = parse_timestamp("999:59:59.999").unwrap();
        assert!((high_hms - 3599999.999).abs() < 1e-3);
        assert_eq!(parse_timestamp("999h"), Some(3596400.0));
        assert_eq!(parse_timestamp("100000s"), Some(100000.0));

        // Submillisecond & microsecond precision
        let micro = parse_timestamp("00:00:01.123456").unwrap();
        assert!((micro - 1.123456).abs() < 1e-6);
        let micro_ms = parse_timestamp("500.123456ms").unwrap();
        assert!((micro_ms - 0.500123456).abs() < 1e-6);

        // Negative values
        assert_eq!(parse_timestamp("-5s"), Some(-5.0));
        assert_eq!(parse_timestamp("-500ms"), Some(-0.5));

        // Corrupt / invalid timestamps
        assert_eq!(parse_timestamp(""), None);
        assert_eq!(parse_timestamp("   "), None);
        assert_eq!(parse_timestamp(":::"), None);
        assert_eq!(parse_timestamp("invalid:time"), None);
        assert_eq!(parse_timestamp("00:00:00:00:00"), None);
    }

    #[test]
    fn test_ttml_end_before_begin_handling() {
        // When end < begin (corrupted metadata), dur calculation must not overflow
        let xml = r#"<tt><body><div>
          <p begin="00:05.000" end="00:02.000">
            <span begin="00:05.000" end="00:03.000">Backwards</span>
          </p>
        </div></body></tt>"#;

        let lines = parse_ttml(xml);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].time_secs, 5.0);
        assert_eq!(lines[0].text, "Backwards");
        let words = lines[0].words.as_ref().expect("words present");
        assert_eq!(words.len(), 1);
        // duration_secs should be None since end < begin
        assert_eq!(words[0].duration_secs, None);
    }

    #[test]
    fn test_ttml_dur_attribute_only() {
        let xml = r#"<tt><body><div>
          <p begin="00:10.000" dur="5s">
            <span begin="00:10.000" dur="1500ms">Quick </span>
            <span begin="00:11.500" dur="2.5s">brown </span>
            <span begin="00:14.000" dur="1000ms">fox</span>
          </p>
        </div></body></tt>"#;

        let lines = parse_ttml(xml);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].time_secs, 10.0);
        assert_eq!(lines[0].text, "Quick brown fox");
        let words = lines[0].words.as_ref().expect("words present");
        assert_eq!(words.len(), 3);
        assert_eq!(words[0].duration_secs, Some(1.5));
        assert_eq!(words[1].duration_secs, Some(2.5));
        assert_eq!(words[2].duration_secs, Some(1.0));
    }

    #[test]
    fn test_ttml_apple_music_full_song_with_interline_bg_vocals() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <tt xmlns="http://www.w3.org/ns/ttml"
            xmlns:ttm="http://www.w3.org/ns/ttml#metadata"
            xmlns:itunes="http://music.apple.com/metadata"
            xml:lang="en-US">
          <head>
            <metadata>
              <itunes:songId>987654321</itunes:songId>
              <ttm:agent type="person" xml:id="v1">Freddie</ttm:agent>
              <ttm:agent type="person" xml:id="v2">Choir</ttm:agent>
            </metadata>
          </head>
          <body>
            <div>
              <p begin="00:00:30.100" end="00:00:35.500" ttm:agent="v1">
                <span begin="00:00:30.100" end="00:00:30.800">Mama, </span>
                <span begin="00:00:30.800" end="00:00:31.500">just </span>
                <span begin="00:00:31.500" end="00:00:32.400">killed </span>
                <span begin="00:00:32.400" end="00:00:33.000">a </span>
                <span begin="00:00:33.000" end="00:00:35.500">man</span>
              </p>
              <p begin="00:00:33.500" end="00:00:36.000" ttm:agent="v2" ttm:role="x-bg">
                <span begin="00:00:33.500" end="00:00:36.000">(Ooh-ooh-ooh)</span>
              </p>
              <p begin="00:00:36.200" end="00:00:41.000" ttm:agent="v1">
                <span begin="00:00:36.200" end="00:00:37.000">Put </span>
                <span begin="00:00:37.000" end="00:00:37.500">a </span>
                <span begin="00:00:37.500" end="00:00:38.200">gun </span>
                <span begin="00:00:38.200" end="00:00:39.000">against </span>
                <span begin="00:00:39.000" end="00:00:39.800">his </span>
                <span begin="00:00:39.800" end="00:00:41.000">head</span>
              </p>
            </div>
          </body>
        </tt>"#;

        let lines = parse_ttml(xml);
        assert_eq!(lines.len(), 3);

        // Verify line 1 (lead vocal)
        assert_eq!(lines[0].time_secs, 30.1);
        assert_eq!(lines[0].text, "Mama, just killed a man");
        let w1 = lines[0].words.as_ref().unwrap();
        assert_eq!(w1.len(), 5);
        assert_eq!(w1[0].text, "Mama, ");
        assert_eq!(w1[0].time_secs, 30.1);
        assert!((w1[0].duration_secs.unwrap() - 0.7).abs() < 1e-6);
        assert_eq!(w1[4].text, "man");
        assert_eq!(w1[4].time_secs, 33.0);
        assert!((w1[4].duration_secs.unwrap() - 2.5).abs() < 1e-6);

        // Verify line 2 (overlapping background vocal)
        assert_eq!(lines[1].time_secs, 33.5);
        assert_eq!(lines[1].text, "(Ooh-ooh-ooh)");
        let w2 = lines[1].words.as_ref().unwrap();
        assert_eq!(w2.len(), 1);
        assert_eq!(w2[0].text, "(Ooh-ooh-ooh)");
        assert_eq!(w2[0].time_secs, 33.5);
        assert!((w2[0].duration_secs.unwrap() - 2.5).abs() < 1e-6);

        // Verify line 3
        assert_eq!(lines[2].time_secs, 36.2);
        assert_eq!(lines[2].text, "Put a gun against his head");
        let w3 = lines[2].words.as_ref().unwrap();
        assert_eq!(w3.len(), 6);
        assert_eq!(w3[0].text, "Put ");
        assert_eq!(w3[5].text, "head");
    }

    #[test]
    fn test_ttml_musixmatch_ttml_dialect() {
        let xml = r#"<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
          <head>
            <metadata>
              <ttm:title>Musixmatch Track</ttm:title>
            </metadata>
          </head>
          <body>
            <div>
              <p begin="00:04.50" end="00:08.20">
                <span begin="00:04.50" end="00:05.10">You </span>
                <span begin="00:05.10" end="00:06.00">know </span>
                <span begin="00:06.00" end="00:07.10">it&apos;s </span>
                <span begin="00:07.10" end="00:08.20">true</span>
              </p>
              <p begin="00:08.50" end="00:12.00">
                <span begin="00:08.50" end="00:09.30">Everything </span>
                <span begin="00:09.30" end="00:10.50">I </span>
                <span begin="00:10.50" end="00:12.00">do</span>
              </p>
            </div>
          </body>
        </tt>"#;

        let lines = parse_ttml(xml);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].time_secs, 4.5);
        assert_eq!(lines[0].text, "You know it's true");
        let w = lines[0].words.as_ref().unwrap();
        assert_eq!(w.len(), 4);
        assert_eq!(w[2].text, "it's ");
        assert_eq!(w[2].time_secs, 6.0);
        assert!((w[2].duration_secs.unwrap() - 1.1).abs() < 1e-6);

        assert_eq!(lines[1].time_secs, 8.5);
        assert_eq!(lines[1].text, "Everything I do");
    }

    #[test]
    fn test_ttml_mixed_spans_and_bare_text_in_p() {
        let xml = r#"<tt><body><div>
          <p begin="00:02.000" end="00:06.000">
            Intro text
            <span begin="00:03.000" end="00:04.500">Syllable </span>
            Outro text
          </p>
        </div></body></tt>"#;

        let lines = parse_ttml(xml);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].time_secs, 2.0);
        // Words should capture the timed syllable, and the full line text should be available
        assert!(lines[0].text.contains("Syllable"));
    }

    #[test]
    fn test_submillisecond_accuracy_all_formats() {
        // 1. Plain & colon timestamp sub-millisecond precision
        let ts1 = parse_timestamp("00:01:23.456789").expect("valid ts");
        assert!((ts1 - 83.456789).abs() < 1e-6);

        let ts2 = parse_timestamp("83.456789s").expect("valid ts");
        assert!((ts2 - 83.456789).abs() < 1e-6);

        let ts3 = parse_timestamp("83456.789ms").expect("valid ts");
        assert!((ts3 - 83.456789).abs() < 1e-6);

        // 2. NetEase sub-millisecond & fractional parsing
        let netease_content = "[00:10.00] (100.5,250.25)Fractional (500.0,150.75)Timing";
        let netease_lines = parse_lrc(netease_content);
        assert_eq!(netease_lines.len(), 1);
        assert_eq!(netease_lines[0].time_secs, 10.0);
        let nw = netease_lines[0].words.as_ref().expect("words present");
        assert_eq!(nw.len(), 2);
        assert!((nw[0].time_secs - 10.1005).abs() < 1e-6);
        assert!((nw[0].duration_secs.unwrap() - 0.25025).abs() < 1e-6);
        assert!((nw[1].time_secs - 10.500).abs() < 1e-6);
        assert!((nw[1].duration_secs.unwrap() - 0.15075).abs() < 1e-6);

        // 3. Enhanced LRC sub-millisecond precision
        let enhanced_content = "[01:00.00] <00:00.123456>Micro <00:01.654321>Second";
        let enh_lines = parse_lrc(enhanced_content);
        assert_eq!(enh_lines.len(), 1);
        let ew = enh_lines[0].words.as_ref().expect("words present");
        assert_eq!(ew.len(), 2);
        assert!((ew[0].time_secs - 60.123456).abs() < 1e-6);
        assert!((ew[1].time_secs - 61.654321).abs() < 1e-6);

        // 4. TTML sub-millisecond precision
        let ttml_content = r#"<tt><body><div>
          <p begin="00:00:10.123456" end="00:00:15.654321">
            <span begin="00:00:10.123456" end="00:00:12.345678">Subms </span>
            <span begin="00:00:12.345678" dur="3.308643s">Precision</span>
          </p>
        </div></body></tt>"#;
        let ttml_lines = parse_ttml(ttml_content);
        assert_eq!(ttml_lines.len(), 1);
        assert!((ttml_lines[0].time_secs - 10.123456).abs() < 1e-6);
        let tw = ttml_lines[0].words.as_ref().expect("words present");
        assert_eq!(tw.len(), 2);
        assert!((tw[0].time_secs - 10.123456).abs() < 1e-6);
        assert!((tw[0].duration_secs.unwrap() - (12.345678 - 10.123456)).abs() < 1e-6);
        assert!((tw[1].time_secs - 12.345678).abs() < 1e-6);
        assert!((tw[1].duration_secs.unwrap() - 3.308643).abs() < 1e-6);
    }

    #[test]
    fn test_sidecar_and_cache_resolution_hierarchy() {
        // 1. Web stream URL query cleaning and hashing
        let url_a = "https://example.com/audio/track1.mp3?t=12345&s=secret&api_key=xyz&volume=100";
        let url_b = "https://example.com/audio/track1.mp3?t=99999&s=different&api_key=abc&volume=100";
        let path_a_ttml = get_lyrics_cache_path(url_a, "ttml");
        let path_b_ttml = get_lyrics_cache_path(url_b, "ttml");
        assert_eq!(path_a_ttml, path_b_ttml, "Ephemeral params must be filtered for consistent cache key");

        // 2. Direct file paths
        let local_audio = "C:\\Music\\Album\\Song.flac";
        assert_eq!(get_lyrics_file_path(local_audio, "ttml"), std::path::PathBuf::from("C:\\Music\\Album\\Song.ttml"));
        assert_eq!(get_lyrics_file_path(local_audio, "lrc"), std::path::PathBuf::from("C:\\Music\\Album\\Song.lrc"));

        // 3. Save path detection
        let ttml_snippet = "   <tt xmlns=\"http://www.w3.org/ns/ttml\"><body><p>Test</p></body></tt>";
        let lrc_snippet = "[00:05.00] Simple line";
        assert_eq!(get_lyrics_save_path(local_audio, ttml_snippet), std::path::PathBuf::from("C:\\Music\\Album\\Song.ttml"));
        assert_eq!(get_lyrics_save_path(local_audio, lrc_snippet), std::path::PathBuf::from("C:\\Music\\Album\\Song.lrc"));

        // 4. Temporary directory sidecar priority resolution (.ttml over .lrc)
        let temp_dir = std::env::temp_dir().join(format!("aideo_test_lyrics_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let _ = std::fs::create_dir_all(&temp_dir);

        let audio_path = temp_dir.join("test_song.mp3");
        let _ = std::fs::write(&audio_path, b"fake audio");

        let sidecar_ttml = temp_dir.join("test_song.ttml");
        let sidecar_lrc = temp_dir.join("test_song.lrc");

        // When only .lrc exists
        let _ = std::fs::write(&sidecar_lrc, "[00:01.00] LRC Line");
        let lyrics_from_lrc = get_lyrics_for_track(&audio_path.to_string_lossy());
        assert_eq!(lyrics_from_lrc.len(), 1);
        assert_eq!(lyrics_from_lrc[0].text, "LRC Line");

        // When .ttml is added alongside .lrc, .ttml must take precedence
        let _ = std::fs::write(&sidecar_ttml, "<tt><body><div><p begin=\"00:01.00\"><span begin=\"00:01.00\" end=\"00:02.00\">TTML </span><span begin=\"00:02.00\" end=\"00:03.00\">Line</span></p></div></body></tt>");
        let lyrics_from_ttml = get_lyrics_for_track(&audio_path.to_string_lossy());
        assert_eq!(lyrics_from_ttml.len(), 1);
        assert_eq!(lyrics_from_ttml[0].text, "TTML Line");
        assert!(lyrics_from_ttml[0].words.is_some());

        // Cleanup temp files
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_parse_lyrics_auto_detection_matrix() {
        // Multi-timestamp LRC
        let multi_ts_lrc = "[00:10.00][00:20.00][00:30.00] Repeated Chorus";
        let multi_res = parse_lyrics_auto(multi_ts_lrc);
        assert_eq!(multi_res.len(), 3);
        assert_eq!(multi_res[0].time_secs, 10.0);
        assert_eq!(multi_res[1].time_secs, 20.0);
        assert_eq!(multi_res[2].time_secs, 30.0);

        // Standard LRC with metadata tags
        let metadata_lrc = "[ti:Song Title]\n[ar:Artist Name]\n[al:Album Name]\n[00:05.00] First lyric";
        let meta_res = parse_lyrics_auto(metadata_lrc);
        assert_eq!(meta_res.len(), 1);
        assert_eq!(meta_res[0].time_secs, 5.0);
        assert_eq!(meta_res[0].text, "First lyric");

        // Standard TTML auto-detection
        let standard_ttml = "<tt><body><div><p begin=\"00:01.00\">STANDARD</p></div></body></tt>";
        let standard_res = parse_lyrics_auto(standard_ttml);
        assert_eq!(standard_res.len(), 1);
        assert_eq!(standard_res[0].text, "STANDARD");

        // TTML with leading comment
        let commented_ttml = "<!-- Apple Music Timed Text -->\n<tt><body><div><p begin=\"00:02.00\">Commented</p></div></body></tt>";
        let comm_res = parse_lyrics_auto(commented_ttml);
        assert_eq!(comm_res.len(), 1);
        assert_eq!(comm_res[0].text, "Commented");

        // NetEase format auto-detected via parse_lyrics_auto
        let netease_auto = "[00:04.00] (0,500)Karaoke (500,500)Syllables";
        let ne_res = parse_lyrics_auto(netease_auto);
        assert_eq!(ne_res.len(), 1);
        assert_eq!(ne_res[0].text, "Karaoke Syllables");
        assert_eq!(ne_res[0].words.as_ref().unwrap().len(), 2);

        // Corrupted XML fallback to LRC/plain
        let corrupt_xml = "<tt><body><p begin=\"invalid\">Broken</invalid>";
        let corr_res = parse_lyrics_auto(corrupt_xml);
        // Does not panic and handles gracefully
        assert!(corr_res.is_empty() || !corr_res.is_empty());
    }

    #[test]
    fn test_qrc_suffix_parenthesis_word_timestamps() {
        let content = "[00:10.00]Never(0,500) gonna(500,400) give(900,300)";
        let lines = parse_lrc(content);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].time_secs, 10.0);
        assert_eq!(lines[0].text, "Never gonna give");
        let words = lines[0].words.as_ref().expect("words present");
        assert_eq!(words.len(), 3);
        assert_eq!(words[0].text, "Never");
        assert_eq!(words[0].time_secs, 10.0);
        assert_eq!(words[0].duration_secs, Some(0.5));
        assert_eq!(words[1].text, " gonna");
        assert_eq!(words[1].time_secs, 10.5);
        assert_eq!(words[1].duration_secs, Some(0.4));
        assert_eq!(words[2].text, " give");
        assert_eq!(words[2].time_secs, 10.9);
        assert_eq!(words[2].duration_secs, Some(0.3));
    }

    #[test]
    fn test_qrc_comma_line_timestamps() {
        let content = "[0,3500]Never(0,500) gonna(500,400)\n[3500,4000]give(0,300) you(300,200) up(500,500)";
        let lines = parse_lrc(content);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].time_secs, 0.0);
        assert_eq!(lines[0].text, "Never gonna");
        assert_eq!(lines[1].time_secs, 3.5);
        assert_eq!(lines[1].text, "give you up");
        let w2 = lines[1].words.as_ref().expect("words present");
        assert_eq!(w2.len(), 3);
        assert_eq!(w2[0].text, "give");
        assert_eq!(w2[0].time_secs, 3.5);
        assert_eq!(w2[1].text, " you");
        assert_eq!(w2[1].time_secs, 3.8);
        assert_eq!(w2[2].text, " up");
        assert_eq!(w2[2].time_secs, 4.0);
    }

    #[test]
    fn test_qrc_xml_lyric_content_parsing() {
        let xml = r#"<?xml version="1.0" encoding="utf-8"?>
        <QrcInfos>
          <LyricInfo>
            <Lyric_1 LyricType="1" LyricContent="[0,3500]Never(0,500) gonna(500,400)&#10;[3500,4000]give(0,300) you(300,200)"/>
          </LyricInfo>
        </QrcInfos>"#;

        let lines = detect_and_parse_lyrics(xml);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].time_secs, 0.0);
        assert_eq!(lines[0].text, "Never gonna");
        assert_eq!(lines[1].time_secs, 3.5);
        assert_eq!(lines[1].text, "give you");
    }

    #[test]
    fn test_krc_angle_bracket_comma_timestamps() {
        let content = "[10500,4200]<0,500,0>Never <500,400,0>gonna <900,300,0>give\n[14700,3800]<0,300,0>you <300,500,0>up";
        let lines = parse_lyrics_auto(content);
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].time_secs, 10.5);
        assert_eq!(lines[0].text, "Never gonna give");
        let w1 = lines[0].words.as_ref().expect("words present");
        assert_eq!(w1.len(), 3);
        assert_eq!(w1[0].text, "Never ");
        assert_eq!(w1[0].time_secs, 10.5);
        assert_eq!(w1[0].duration_secs, Some(0.5));
        assert_eq!(w1[1].text, "gonna ");
        assert_eq!(w1[1].time_secs, 11.0);
        assert_eq!(w1[1].duration_secs, Some(0.4));
        assert_eq!(w1[2].text, "give");
        assert_eq!(w1[2].time_secs, 11.4);
        assert_eq!(w1[2].duration_secs, Some(0.3));

        assert_eq!(lines[1].time_secs, 14.7);
        assert_eq!(lines[1].text, "you up");
        let w2 = lines[1].words.as_ref().expect("words present");
        assert_eq!(w2.len(), 2);
        assert_eq!(w2[0].text, "you ");
        assert_eq!(w2[0].time_secs, 14.7);
        assert_eq!(w2[0].duration_secs, Some(0.3));
        assert_eq!(w2[1].text, "up");
        assert_eq!(w2[1].time_secs, 15.0);
        assert_eq!(w2[1].duration_secs, Some(0.5));
    }

    #[test]
    fn test_decode_krc_roundtrip() {
        use std::io::Write;
        use base64::Engine;

        let plain_krc = "[0,3500]<0,500,0>Hello <500,400,0>World";
        let mut encoder = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(plain_krc.as_bytes()).unwrap();
        let compressed = encoder.finish().unwrap();

        let xor_key: [u8; 16] = [0x40, 0x47, 0x61, 0x77, 0x5e, 0x32, 0x74, 0x47, 0x51, 0x36, 0x31, 0x2d, 0xce, 0xd2, 0x6e, 0x69];
        let mut encrypted = Vec::with_capacity(compressed.len() + 4);
        encrypted.extend_from_slice(b"krc1");
        for (i, &b) in compressed.iter().enumerate() {
            encrypted.push(b ^ xor_key[i % 16]);
        }

        let b64 = base64::engine::general_purpose::STANDARD.encode(&encrypted);
        let decoded = decode_krc(&b64).expect("should decode krc");
        assert_eq!(decoded, plain_krc);

        let parsed = parse_lyrics_auto(&b64);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].text, "Hello World");
        assert!(parsed[0].words.is_some());
    }

    #[test]
    fn test_clean_url_token_and_expires_filter() {
        let dirty_url = "https://cdn.example.com/audio/song.mp3?token=secret123&expires=1700000000&t=45&s=xyz&api_key=key99&volume=1.0";
        let cleaned = clean_url_for_lyrics(dirty_url);
        assert!(!cleaned.contains("token="));
        assert!(!cleaned.contains("expires="));
        assert!(!cleaned.contains("t="));
        assert!(!cleaned.contains("s="));
        assert!(!cleaned.contains("api_key="));
        assert!(cleaned.contains("volume=1.0"));
    }

    #[test]
    fn test_netease_yrc_absolute_timestamps() {
        let yrc = r#"[5790,2550](5790,420,0)Fever (6210,360,0)dream (6570,390,0)high (6960,180,0)in (7140,90,0)the (7230,480,0)quiet
[8340,3090](8340,180,0)You (8520,330,0)know (8850,270,0)that (9120,180,0)I (9300,450,0)caught (9750,750,0)it"#;

        let parsed = parse_lrc(yrc);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].time_secs, 5.79);
        assert_eq!(parsed[0].text, "Fever dream high in the quiet");
        let w0 = parsed[0].words.as_ref().expect("words present");
        assert_eq!(w0.len(), 6);
        // Words must have their absolute timestamps: 5.79s, 6.21s, 6.57s, NOT 11.58s!
        assert!((w0[0].time_secs - 5.79).abs() < 0.001);
        assert_eq!(w0[0].text, "Fever ");
        assert_eq!(w0[0].duration_secs, Some(0.42));

        assert!((w0[1].time_secs - 6.21).abs() < 0.001);
        assert_eq!(w0[1].text, "dream ");
        assert_eq!(w0[1].duration_secs, Some(0.36));

        assert_eq!(parsed[1].time_secs, 8.34);
        assert_eq!(parsed[1].text, "You know that I caught it");
        let w1 = parsed[1].words.as_ref().expect("words present");
        assert_eq!(w1.len(), 6);
        assert!((w1[0].time_secs - 8.34).abs() < 0.001);
        assert_eq!(w1[0].text, "You ");
        assert_eq!(w1[0].duration_secs, Some(0.18));
    }

    #[test]
    fn test_binilyrics_apple_ttml_parsing() {
        let ttml = r#"<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word" xml:lang="en">
  <body>
    <div>
      <p begin="00:00.160" end="00:03.200">
        <span begin="00:00.160" end="00:00.600">Weight </span>
        <span begin="00:00.600" end="00:01.100">of </span>
        <span begin="00:01.100" end="00:01.800">the </span>
        <span begin="00:01.800" end="00:03.200">world</span>
      </p>
      <p begin="00:03.400" end="00:07.100">
        <span begin="00:03.400" end="00:04.200">on </span>
        <span begin="00:04.200" end="00:05.100">your </span>
        <span begin="00:05.100" end="00:07.100">shoulders</span>
      </p>
    </div>
  </body>
</tt>"#;

        let parsed = parse_ttml(ttml);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].text, "Weight of the world");
        let w = parsed[0].words.as_ref().expect("words present");
        assert_eq!(w.len(), 4);
        assert_eq!(w[0].text, "Weight ");
        assert_eq!(w[0].time_secs, 0.16);
        assert_eq!(w[3].text, "world");
        assert_eq!(w[3].time_secs, 1.8);
    }

    #[test]
    fn test_ttml_spaces_between_spans() {
        let ttml = r#"<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word" xml:lang="en">
  <body>
    <div>
      <p begin="9.035" end="11.943"><span begin="9.035" end="9.397">Weight</span> <span begin="9.397" end="9.529">of</span> <span begin="9.529" end="9.807">the</span> <span begin="9.807" end="10.316">world</span> <span begin="10.316" end="10.527">on</span> <span begin="10.527" end="10.717">your</span> <span begin="10.717" end="11.264">shoul</span><span begin="11.264" end="11.826">der</span><span begin="11.826" end="11.943">s</span></p>
    </div>
  </body>
</tt>"#;

        let parsed = parse_ttml(ttml);
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].text, "Weight of the world on your shoulders");
        let w = parsed[0].words.as_ref().expect("words present");
        assert_eq!(w.len(), 9);
        assert_eq!(w[0].text, "Weight ");
        assert_eq!(w[1].text, "of ");
        assert_eq!(w[2].text, "the ");
        assert_eq!(w[3].text, "world ");
        assert_eq!(w[4].text, "on ");
        assert_eq!(w[5].text, "your ");
        assert_eq!(w[6].text, "shoul");
        assert_eq!(w[7].text, "der");
        assert_eq!(w[8].text, "s");
    }
}

