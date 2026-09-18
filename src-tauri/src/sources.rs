use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StreamingQuality {
    #[default]
    BestAvailable,
    StandardLossless,
    DataSaver,
}

impl StreamingQuality {
    pub fn tidal(self) -> &'static [&'static str] {
        match self {
            Self::BestAvailable => &["HI_RES_LOSSLESS", "HI_RES", "LOSSLESS", "HIGH", "LOW"],
            Self::StandardLossless => &["LOSSLESS", "HIGH", "LOW"],
            Self::DataSaver => &["LOW", "HIGH"],
        }
    }

    pub fn qobuz(self) -> &'static [u32] {
        match self {
            Self::BestAvailable => &crate::qobuz::FORMAT_LADDER,
            Self::StandardLossless => &[6, 5],
            Self::DataSaver => &[5],
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct SourceQuality {
    pub lossless: Option<bool>,
    pub sample_rate: Option<f64>,
    pub bit_depth: Option<u32>,
    pub codec: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct RecordingEvidence {
    pub isrc: Option<String>,
    pub upc: Option<String>,
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub explicit: Option<bool>,
}

pub fn extract_catalog_version(item: &serde_json::Value) -> Option<String> {
    item["version"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .filter(|s| !s.eq_ignore_ascii_case("explicit") && !s.eq_ignore_ascii_case("clean"))
        .map(str::to_owned)
        .or_else(|| {
            item["album"]["title"].as_str().and_then(|alb| {
                if let (Some(start), Some(end)) = (alb.rfind('('), alb.rfind(')')) {
                    if start < end {
                        let inner = alb[start + 1..end].trim();
                        let inner_lower = inner.to_lowercase();
                        if inner_lower.contains("sped up") || inner_lower.contains("speed up")
                            || inner_lower.contains("spedup") || inner_lower.contains("speedup")
                            || inner_lower.contains("slowed") || inner_lower.contains("remix")
                            || inner_lower.contains("live") || inner_lower.contains("acoustic")
                            || inner_lower.contains("instrumental") || inner_lower.contains("karaoke")
                            || inner_lower.contains("cover") || inner_lower.contains("piano") {
                            return Some(inner.to_string());
                        }
                    }
                }
                None
            })
        })
}

pub fn format_catalog_title(item: &serde_json::Value) -> String {
    let raw_title = item["title"].as_str().unwrap_or("").trim();
    let version = extract_catalog_version(item);
    match version {
        Some(ref v) if !raw_title.to_lowercase().contains(&v.to_lowercase()) => {
            format!("{} ({})", raw_title, v)
        }
        _ => raw_title.to_string(),
    }
}

impl RecordingEvidence {
    pub fn from_catalog(item: &serde_json::Value) -> Self {
        let explicit = item["explicit"].as_bool().or_else(|| {
            item["version"].as_str().and_then(|v| {
                let v_clean = v.trim().to_lowercase();
                if v_clean == "explicit" {
                    Some(true)
                } else if v_clean == "clean" {
                    Some(false)
                } else {
                    None
                }
            })
        });
        Self {
            isrc: item["isrc"].as_str().map(str::to_owned),
            upc: item["album"]["upc"].as_str().map(str::to_owned),
            version: extract_catalog_version(item),
            explicit,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ResolvedStream {
    pub url: String,
    pub quality: SourceQuality,
}

pub fn validate_track_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 32 || !id.bytes().all(|b| b.is_ascii_digit()) {
        return Err("Invalid provider track ID".into());
    }
    Ok(())
}

#[derive(Serialize)]
pub struct LocalSourceResult {
    #[serde(flatten)]
    track: crate::db::Track,
    recording_evidence: RecordingEvidence,
    catalog_quality: SourceQuality,
}

#[tauri::command]
pub async fn search_local_sources(query: String, state: tauri::State<'_, crate::AppState>) -> Result<Vec<LocalSourceResult>, String> {
    let clean_query = query.replace(&['"', '\'', '“', '”', '‘', '’'][..], " ").trim().to_string();
    let stopwords = ["by", "the", "a", "an", "of", "and", "in", "on", "for", "with", "to", "from"];
    let raw_words: Vec<String> = clean_query.split_whitespace().map(str::to_lowercase).collect();
    let words: Vec<String> = if raw_words.len() <= 1 {
        raw_words
    } else {
        let filtered: Vec<String> = raw_words.into_iter().filter(|w| !stopwords.contains(&w.as_str())).collect();
        if filtered.is_empty() { clean_query.split_whitespace().map(str::to_lowercase).collect() } else { filtered }
    };
    if words.is_empty() || query.len() > 512 { return Ok(Vec::new()); }
    let tracks = crate::db::get_all_tracks(&crate::safe_lock(&state.db)).map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        tracks.into_iter().filter(|t| std::path::Path::new(&t.path).is_absolute())
            .filter(|t| {
                let text = format!("{} {} {}", t.title.as_deref().unwrap_or(""), t.artist.as_deref().unwrap_or(""), t.album.as_deref().unwrap_or("")).to_lowercase();
                words.iter().all(|w| text.contains(w))
            }).take(50).map(|mut track| {
                let tags = crate::tag_editor::read_tags(&track.path).ok();
                if let Some(tags) = &tags { track.duration = tags.duration_secs; }
                LocalSourceResult {
                    recording_evidence: RecordingEvidence {
                        isrc: tags.as_ref().and_then(|t| t.isrc.clone()),
                        upc: tags.as_ref().and_then(|t| t.upc.clone()),
                        version: None,
                        explicit: None,
                    },
                    catalog_quality: SourceQuality {
                        lossless: tags.as_ref().and_then(|t| t.lossless),
                        sample_rate: tags.as_ref().and_then(|t| t.sample_rate).map(f64::from),
                        bit_depth: tags.as_ref().and_then(|t| t.bit_depth).map(u32::from),
                        codec: tags.as_ref().and_then(|t| t.format.clone()),
                    },
                    track,
                }
            }).collect()
    }).await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quality_preferences_request_the_expected_provider_formats() {
        assert_eq!(StreamingQuality::BestAvailable.tidal()[0], "HI_RES_LOSSLESS");
        assert_eq!(StreamingQuality::StandardLossless.tidal(), &["LOSSLESS", "HIGH", "LOW"]);
        assert_eq!(StreamingQuality::DataSaver.tidal(), &["LOW", "HIGH"]);
        assert_eq!(StreamingQuality::BestAvailable.qobuz(), &[27, 7, 6, 5]);
        assert_eq!(StreamingQuality::StandardLossless.qobuz(), &[6, 5]);
        assert_eq!(StreamingQuality::DataSaver.qobuz(), &[5]);
        assert!(validate_track_id("123").is_ok());
        assert!(validate_track_id("https://cdn.example/123").is_err());
        assert!(validate_track_id("../123").is_err());
    }

    #[test]
    fn test_format_catalog_title_with_version() {
        let direct_version = serde_json::json!({
            "title": "Kill Bill",
            "version": "Sped Up Version",
            "album": { "title": "Kill Bill (Sped Up Version)" }
        });
        assert_eq!(format_catalog_title(&direct_version), "Kill Bill (Sped Up Version)");
        assert_eq!(extract_catalog_version(&direct_version), Some("Sped Up Version".to_string()));

        let album_version = serde_json::json!({
            "title": "Kill Bill",
            "version": null,
            "album": { "title": "Kill Bill (Sped Up Version)" }
        });
        assert_eq!(format_catalog_title(&album_version), "Kill Bill (Sped Up Version)");
        assert_eq!(extract_catalog_version(&album_version), Some("Sped Up Version".to_string()));

        let standard = serde_json::json!({
            "title": "Kill Bill",
            "version": null,
            "album": { "title": "SOS" }
        });
        assert_eq!(format_catalog_title(&standard), "Kill Bill");
        assert_eq!(extract_catalog_version(&standard), None);

        let already_included = serde_json::json!({
            "title": "Kill Bill (Sped Up Version)",
            "version": "Sped Up Version",
            "album": { "title": "Kill Bill (Sped Up Version)" }
        });
        assert_eq!(format_catalog_title(&already_included), "Kill Bill (Sped Up Version)");

        let explicit_item = serde_json::json!({
            "title": "Kill Bill",
            "version": "Explicit",
            "album": { "title": "SOS" }
        });
        assert_eq!(format_catalog_title(&explicit_item), "Kill Bill");
        assert_eq!(extract_catalog_version(&explicit_item), None);
        assert_eq!(RecordingEvidence::from_catalog(&explicit_item).explicit, Some(true));
    }
}
