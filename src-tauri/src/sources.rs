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
}

impl RecordingEvidence {
    pub fn from_catalog(item: &serde_json::Value) -> Self {
        Self {
            isrc: item["isrc"].as_str().map(str::to_owned),
            upc: item["album"]["upc"].as_str().map(str::to_owned),
            version: item["version"].as_str().map(str::to_owned),
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
    let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
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
}
