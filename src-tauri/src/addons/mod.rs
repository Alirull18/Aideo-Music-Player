//! Runtime-installed Eclipse addons: manifest metadata lives in SQLite, the base URL
//! (which may embed a user token) lives in the OS keyring and is never sent to the frontend.
pub mod eclipse;

use crate::{safe_lock, AppState};
use serde::Serialize;
use tauri::State;

const KEYRING_SERVICE: &str = "aideo-addon";

/// `com.example.addon`: lowercase, at least one dot, so `<id>:<track>` can never look like a Windows path.
pub(crate) fn valid_addon_id(id: &str) -> bool {
    id.len() <= 128
        && id.contains('.')
        && id.split('.').all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'))
}

/// Source id format: `<addonId>:<trackId>`.
pub(crate) fn valid_source_id(id: &str) -> bool {
    id.split_once(':')
        .is_some_and(|(a, t)| valid_addon_id(a) && !t.is_empty() && t.len() <= 512 && !t.chars().any(char::is_control))
}

#[derive(Serialize, Clone, Debug)]
pub struct AddonInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub icon: Option<String>,
    pub resources: Vec<String>,
    pub content_type: Option<String>,
    /// scheme://host:port only.
    pub origin: String,
}

fn info(m: eclipse::Manifest, origin: String) -> AddonInfo {
    AddonInfo { id: m.id, name: m.name, version: m.version, icon: m.icon, resources: m.resources, content_type: m.content_type, origin }
}

fn origin_of(u: &url::Url) -> String {
    u.origin().ascii_serialization()
}

fn keyring_entry(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, id).map_err(|e| e.to_string())
}

fn load_base(id: &str) -> Result<url::Url, String> {
    let raw = keyring_entry(id)?
        .get_password()
        .map_err(|_| "Addon not installed. Reinstall it in Settings.".to_string())?;
    url::Url::parse(&raw).map_err(|_| "Stored addon URL is invalid. Reinstall the addon.".to_string())
}

#[tauri::command]
pub async fn addon_list(state: State<'_, AppState>) -> Result<Vec<AddonInfo>, String> {
    let conn = state.read_conn();
    let mut stmt = conn
        .prepare("SELECT manifest_json, origin FROM addons ORDER BY installed_at, id")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    Ok(rows
        .flatten()
        .filter_map(|(json, origin)| serde_json::from_str::<eclipse::Manifest>(&json).ok().map(|m| info(m, origin)))
        .collect())
}

#[tauri::command]
pub async fn addon_install(state: State<'_, AppState>, manifest_url: String) -> Result<AddonInfo, String> {
    let base = eclipse::base_from_manifest_url(&manifest_url)?;
    let manifest = eclipse::fetch_manifest(eclipse::client(), &base).await?;
    let origin = origin_of(&base);
    let json = serde_json::to_string(&manifest).map_err(|e| e.to_string())?;
    // A different server must not silently take over an installed addon's id (and its stored token).
    let existing: Option<String> = state
        .read_conn()
        .query_row("SELECT origin FROM addons WHERE id = ?1", rusqlite::params![manifest.id], |r| r.get(0))
        .ok();
    if existing.is_some_and(|o| o != origin) {
        return Err("An addon with this id is already installed from another origin. Remove it first.".into());
    }
    keyring_entry(&manifest.id)?.set_password(base.as_str()).map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    safe_lock(&state.db)
        .execute(
            "INSERT INTO addons (id, name, manifest_json, origin, installed_at) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, manifest_json = excluded.manifest_json, origin = excluded.origin",
            rusqlite::params![manifest.id, manifest.name, json, origin, now],
        )
        .map_err(|e| e.to_string())?;
    Ok(info(manifest, origin))
}

#[tauri::command]
pub async fn addon_remove(state: State<'_, AppState>, addon_id: String) -> Result<(), String> {
    if !valid_addon_id(&addon_id) {
        return Err("Invalid addon id".into());
    }
    safe_lock(&state.db)
        .execute("DELETE FROM addons WHERE id = ?1", rusqlite::params![addon_id])
        .map_err(|e| e.to_string())?;
    let _ = keyring_entry(&addon_id).and_then(|e| e.delete_credential().map_err(|e| e.to_string()));
    Ok(())
}

#[tauri::command]
pub async fn addon_search(addon_id: String, query: String) -> Result<Vec<eclipse::AddonTrack>, String> {
    if !valid_addon_id(&addon_id) || query.len() > 512 {
        return Err("Invalid addon search".into());
    }
    eclipse::search(eclipse::client(), &addon_id, &load_base(&addon_id)?, &query).await
}

/// Dispatched dynamically by the frontend as `${provider}_resolve_source` with provider = "addon".
#[tauri::command]
pub async fn addon_resolve_source(
    track_id: String,
    requested_quality: Option<crate::sources::StreamingQuality>,
) -> Result<crate::sources::ResolvedStream, String> {
    let _ = requested_quality; // Eclipse /stream/{id} has no quality parameter.
    let (addon_id, tid) = track_id.split_once(':').filter(|_| valid_source_id(&track_id)).ok_or("Invalid addon track id")?;
    eclipse::resolve(eclipse::client(), &load_base(addon_id)?, tid).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_addon_id_validation() {
        assert!(valid_addon_id("com.example.addon"));
        assert!(valid_addon_id("a-b.c"));
        assert!(!valid_addon_id("nodot"));
        assert!(!valid_addon_id("C.upper"));
        assert!(!valid_addon_id("a..b"));
        assert!(!valid_addon_id("c:\\x.y"));
        assert!(valid_source_id("com.x.y:track 1"));
        assert!(!valid_source_id("com.x.y:"));
        assert!(!valid_source_id("c:\\music\\a.flac"), "Windows paths are not addon sources");
        assert!(!valid_source_id("com.x.y:a\nb"));
    }
}
