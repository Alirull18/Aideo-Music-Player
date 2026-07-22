use serde::{Deserialize, Serialize};

lazy_static::lazy_static! {
    pub static ref RE_INNERTUBE_1: regex::Regex = regex::Regex::new(r#""INNERTUBE_API_KEY"\s*:\s*"([^"]+)""#).unwrap();
    pub static ref RE_INNERTUBE_2: regex::Regex = regex::Regex::new(r#""innertubeApiKey"\s*:\s*"([^"]+)""#).unwrap();
    pub static ref RE_VIEWS: regex::Regex = regex::Regex::new(r"([\d\.]+)\s*([bmk])\s*(views|plays)").unwrap();
    pub static ref COVER_REGEXES: Vec<regex::Regex> = vec![
        regex::Regex::new(r"\bcover\s+by\b").unwrap(),
        regex::Regex::new(r"\bcover\s+version\b").unwrap(),
        regex::Regex::new(r"[\(\[][^)]*\bcover\b[^)]*[\)\]]").unwrap(),
        regex::Regex::new(r"\s+-\s+cover\b").unwrap(),
        regex::Regex::new(r"\bcover\s+of\b").unwrap(),
        regex::Regex::new(r"\bacoustic\s+cover\b").unwrap(),
        regex::Regex::new(r"\bpiano\s+cover\b").unwrap(),
        regex::Regex::new(r"\bguitar\s+cover\b").unwrap(),
        regex::Regex::new(r"\bviolin\s+cover\b").unwrap(),
        regex::Regex::new(r"\bmetal\s+cover\b").unwrap(),
        regex::Regex::new(r"\bdrum\s+cover\b").unwrap(),
        regex::Regex::new(r"\bcell\s+cover\b").unwrap(),
        regex::Regex::new(r"\bflute\s+cover\b").unwrap(),
        regex::Regex::new(r"\bharp\s+cover\b").unwrap(),
        // Remix/edit patterns
        regex::Regex::new(r"[\(\[][^)]*\bremix\b[^)]*[\)\]]").unwrap(),
        regex::Regex::new(r"\s+-\s+remix\b").unwrap(),
        regex::Regex::new(r"\bsped[- ]up\b").unwrap(),
        regex::Regex::new(r"\bslowed[- ](?:reverb|down|\+\s*reverb)\b").unwrap(),
        regex::Regex::new(r"\bnightcore\s+version\b").unwrap(),
        regex::Regex::new(r"\b8d\s+(?:audio|version|mix)\b").unwrap(),
        // Compilation/playlist patterns
        regex::Regex::new(r"\bbest\s+of\b").unwrap(),
        regex::Regex::new(r"\btop\s+\d+\s+songs\b").unwrap(),
        regex::Regex::new(r"\bnonstop\s+mix\b").unwrap(),
        regex::Regex::new(r"\bfull\s+playlist\b").unwrap(),
        regex::Regex::new(r"\bgreatest\s+hits\b").unwrap(),
    ];
    pub static ref ARTIST_REGEXES: Vec<regex::Regex> = vec![
        regex::Regex::new(r"\bcovers\b").unwrap(),
        regex::Regex::new(r"\bcover\s+nation\b").unwrap(),
        regex::Regex::new(r"\bcover\s+channel\b").unwrap(),
        regex::Regex::new(r"\bcover\s+band\b").unwrap(),
        regex::Regex::new(r"\btribute\s+band\b").unwrap(),
        regex::Regex::new(r"\bpiano\s+tribute\b").unwrap(),
        regex::Regex::new(r"\btribute\s+orchestra\b").unwrap(),
        // Compilation/playlist channel patterns
        regex::Regex::new(r"\bmusic\s+(?:hits|vibes|collection|zone)\b").unwrap(),
        regex::Regex::new(r"\bbest\s+of\b").unwrap(),
        regex::Regex::new(r"\bplaylist\b").unwrap(),
        regex::Regex::new(r"\bcompilation\b").unwrap(),
        regex::Regex::new(r"\btop\s+(?:hits|songs|tracks)\b").unwrap(),
        regex::Regex::new(r"\bremix\s+(?:channel|music|official)\b").unwrap(),
        regex::Regex::new(r"\bnightcore\b").unwrap(),
        regex::Regex::new(r"\bsped[- ]up\b").unwrap(),
    ];
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct YoutubeTrack {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub cover_url: Option<String>,
    pub duration_raw: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recommendation_source: Option<String>,
}

pub fn is_duration(s: &str) -> bool {
    let parts: Vec<&str> = s.split(':').collect();
    if parts.len() < 2 || parts.len() > 3 {
        return false;
    }
    parts.iter().all(|p| {
        let trimmed = p.trim();
        !trimmed.is_empty() && trimmed.chars().all(|c| c.is_ascii_digit())
    })
}

pub fn extract_duration(val: &serde_json::Value) -> Option<String> {
    if let serde_json::Value::Object(obj) = val {
        if let Some(serde_json::Value::String(text)) = obj.get("text") {
            if is_duration(text) {
                return Some(text.trim().to_string());
            }
        }
        for (_, v) in obj {
            if let Some(dur) = extract_duration(v) {
                return Some(dur);
            }
        }
    } else if let serde_json::Value::Array(arr) = val {
        for v in arr {
            if let Some(dur) = extract_duration(v) {
                return Some(dur);
            }
        }
    }
    None
}

pub fn extract_duration_safe(item: &serde_json::Value) -> Option<String> {
    if let Some(cols) = item.get("flexColumns").and_then(|c| c.as_array()) {
        for col in cols.iter().skip(1) {
            if let Some(dur) = extract_duration(col) {
                return Some(dur);
            }
        }
        None
    } else {
        extract_duration(item)
    }
}

pub fn find_video_id_safe(val: &serde_json::Value) -> Option<String> {
    if let serde_json::Value::Object(obj) = val {
        if let Some(serde_json::Value::String(vid)) = obj.get("videoId") {
            return Some(vid.clone());
        }
        for (k, v) in obj {
            if k == "menu" {
                continue;
            }
            if let Some(vid) = find_video_id_safe(v) {
                return Some(vid);
            }
        }
    } else if let serde_json::Value::Array(arr) = val {
        for v in arr {
            if let Some(vid) = find_video_id_safe(v) {
                return Some(vid);
            }
        }
    }
    None
}

pub fn find_list_items(val: &serde_json::Value, items: &mut Vec<serde_json::Value>) {
    if let serde_json::Value::Object(obj) = val {
        if let Some(renderer) = obj.get("musicResponsiveListItemRenderer") {
            items.push(renderer.clone());
        } else {
            for (_, v) in obj {
                find_list_items(v, items);
            }
        }
    } else if let serde_json::Value::Array(arr) = val {
        for v in arr {
            find_list_items(v, items);
        }
    }
}
