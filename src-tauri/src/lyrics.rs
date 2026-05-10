/// Parses .lrc lyric files and returns timestamped lines.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LyricLine {
    pub time_secs: f64,
    pub text: String,
}

/// Finds a .lrc file next to the audio file and parses it.
pub fn get_lyrics_for_track(audio_path: &str) -> Vec<LyricLine> {
    let lrc_path = std::path::Path::new(audio_path).with_extension("lrc");
    if !lrc_path.exists() {
        return Vec::new();
    }
    let content = match std::fs::read_to_string(&lrc_path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    parse_lrc(&content)
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
        let text = rest.trim().to_string();
        if text.contains(':') && timestamps.is_empty() {
            continue;
        }
        for ts in timestamps {
            lines.push(LyricLine { time_secs: ts, text: text.clone() });
        }
    }
    lines.sort_by(|a, b| a.time_secs.partial_cmp(&b.time_secs)
        .unwrap_or(std::cmp::Ordering::Equal));
    lines
}

fn parse_timestamp(ts: &str) -> Option<f64> {
    let colon = ts.find(':')?;
    let minutes: f64 = ts[..colon].parse().ok()?;
    let seconds: f64 = ts[colon + 1..].parse().ok()?;
    Some(minutes * 60.0 + seconds)
}
