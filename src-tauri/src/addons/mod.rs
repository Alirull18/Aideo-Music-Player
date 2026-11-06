//! Runtime-installed Eclipse addons: manifest metadata lives in SQLite, the base URL
//! (which may embed a user token) lives in the OS keyring and is never sent to the frontend.
pub mod eclipse;
pub mod lyrics;
pub mod sidecar;

use crate::{safe_lock, AppState};
use serde::Serialize;
use tauri::State;
use std::collections::HashSet;
use std::sync::{OnceLock, RwLock};

pub const YOUTUBE: &str = "org.aideo.youtube";
pub const LYRICS: &str = "org.aideo.lyrics";
pub const TRANSLATION: &str = "org.aideo.translation";
const QOBUZ: &str = "org.aideo.qobuz";

/// Addons the host can sign in through an embedded browser window. Matched on the exact id so a
/// look-alike addon can never receive a token captured from the provider's site.
pub(crate) fn supports_browser_login(addon_id: &str) -> bool {
    addon_id == QOBUZ
}

fn disabled() -> &'static RwLock<HashSet<String>> {
    static DISABLED: OnceLock<RwLock<HashSet<String>>> = OnceLock::new();
    DISABLED.get_or_init(|| RwLock::new(HashSet::new()))
}

pub fn is_enabled(id: &str) -> bool {
    [YOUTUBE, LYRICS, TRANSLATION].contains(&id) || disabled().read().map(|ids| !ids.contains(id)).unwrap_or(false)
}

pub fn initialize(conn: &rusqlite::Connection) -> Result<(), String> {
    let mut stmt = conn.prepare("SELECT id FROM addon_preferences WHERE enabled = 0").map_err(|e| e.to_string())?;
    let ids = stmt.query_map([], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?
        .collect::<Result<HashSet<_>, _>>().map_err(|e| e.to_string())?;
    *disabled().write().map_err(|_| "Addon preferences unavailable")? = ids;
    Ok(())
}

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
    pub description: Option<String>,
    pub icon: Option<String>,
    pub resources: Vec<String>,
    pub content_type: Option<String>,
    pub auth: Option<eclipse::AddonAuthSpec>,
    /// scheme://host:port only.
    pub origin: String,
    pub builtin: bool,
    pub enabled: bool,
}

fn builtins() -> Vec<AddonInfo> {
    [(YOUTUBE, "YouTube", vec!["search", "stream"]),
     (LYRICS, "Synced lyrics · LRCLIB / Kugou / BiniLyrics", vec!["lyrics"]),
     (TRANSLATION, "Lyric translation", vec!["translate"])].into_iter().map(|(id, name, resources)| AddonInfo {
        id: id.into(), name: name.into(), version: "1".into(), description: None, icon: None,
        resources: resources.into_iter().map(String::from).collect(), content_type: None, auth: None,
        origin: "internal".into(), builtin: true, enabled: is_enabled(id),
    }).collect()
}

fn info(m: eclipse::Manifest, origin: String) -> AddonInfo {
    let enabled = is_enabled(&m.id);
    let browser_login = supports_browser_login(&m.id);
    let auth = m.auth.map(|mut auth| {
        auth.browser_login = browser_login;
        auth
    });
    AddonInfo {
        id: m.id,
        name: m.name,
        version: m.version,
        description: m.description,
        icon: m.icon,
        resources: m.resources,
        content_type: m.content_type,
        auth,
        origin,
        builtin: false,
        enabled,
    }
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
    let mut entries = builtins();
    for row in rows {
        let (json, origin) = row.map_err(|e| e.to_string())?;
        if let Ok(u) = url::Url::parse(&origin) {
            eclipse::ensure_local_cloud_server(&u);
        }
        if let Ok(manifest) = serde_json::from_str::<eclipse::Manifest>(&json) {
            entries.push(info(manifest, origin));
        }
    }
    Ok(entries)
}

#[tauri::command]
pub async fn addon_install(state: State<'_, AppState>, manifest_url: String) -> Result<AddonInfo, String> {
    let base = eclipse::base_from_manifest_url(&manifest_url)?;
    let manifest = eclipse::fetch_manifest(eclipse::client(), &base).await?;
    if builtins().iter().any(|entry| entry.id == manifest.id) {
        return Err("Internal addon ids cannot be replaced".into());
    }
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
    if builtins().iter().any(|entry| entry.id == addon_id) {
        return Err("Internal addons can be disabled but not removed".into());
    }
    safe_lock(&state.db)
        .execute("DELETE FROM addons WHERE id = ?1", rusqlite::params![addon_id])
        .map_err(|e| e.to_string())?;
    let _ = keyring_entry(&addon_id).and_then(|e| e.delete_credential().map_err(|e| e.to_string()));
    Ok(())
}

fn require_resource(state: &AppState, id: &str, resource: &str) -> Result<(), String> {
    if !valid_addon_id(id) || !is_enabled(id) {
        return Err("Addon is disabled or invalid".into());
    }
    let json: String = state.read_conn().query_row(
        "SELECT manifest_json FROM addons WHERE id = ?1", [id], |row| row.get(0),
    ).map_err(|_| "Addon is not installed")?;
    let manifest: eclipse::Manifest = serde_json::from_str(&json).map_err(|_| "Invalid stored addon manifest")?;
    if !manifest.resources.iter().any(|entry| entry == resource) {
        return Err("Addon does not provide this resource".into());
    }
    Ok(())
}

pub fn enabled_bases(state: &AppState, resource: &str) -> Vec<(String, url::Url)> {
    let manifests: Vec<String> = {
        let conn = state.read_conn();
        let Ok(mut stmt) = conn.prepare("SELECT manifest_json FROM addons ORDER BY installed_at, id") else { return Vec::new() };
        let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(0)) else { return Vec::new() };
        rows.filter_map(Result::ok).collect()
    };
    manifests.into_iter().filter_map(|json| {
        let manifest: eclipse::Manifest = serde_json::from_str(&json).ok()?;
        if !is_enabled(&manifest.id) || !manifest.resources.iter().any(|entry| entry == resource) { return None; }
        Some((manifest.id.clone(), load_base(&manifest.id).ok()?))
    }).collect()
}

#[tauri::command]
pub async fn addon_set_enabled(state: State<'_, AppState>, addon_id: String, enabled: bool) -> Result<(), String> {
    if !valid_addon_id(&addon_id) { return Err("Invalid addon id".into()); }
    if !enabled && [YOUTUBE, LYRICS, TRANSLATION].contains(&addon_id.as_str()) {
        return Err("Internal addons cannot be disabled".into());
    }
    if !builtins().iter().any(|entry| entry.id == addon_id) {
        let installed: bool = state.read_conn().query_row(
            "SELECT EXISTS(SELECT 1 FROM addons WHERE id = ?1)", [&addon_id], |row| row.get(0),
        ).map_err(|e| e.to_string())?;
        if !installed { return Err("Addon is not installed".into()); }
    }
    let mut ids = disabled().write().map_err(|_| "Addon preferences unavailable")?;
    safe_lock(&state.db).execute(
        "INSERT INTO addon_preferences (id, enabled) VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled",
        rusqlite::params![addon_id, enabled],
    ).map_err(|e| e.to_string())?;
    if enabled { ids.remove(&addon_id); } else { ids.insert(addon_id); }
    Ok(())
}

#[tauri::command]
pub async fn addon_search(state: State<'_, AppState>, addon_id: String, query: String) -> Result<Vec<eclipse::AddonTrack>, String> {
    if !valid_addon_id(&addon_id) || query.len() > 512 {
        return Err("Invalid addon search".into());
    }
    require_resource(&state, &addon_id, "search")?;
    let tracks = eclipse::search(eclipse::client(), &addon_id, &load_base(&addon_id)?, &query).await?;
    require_resource(&state, &addon_id, "search")?;
    Ok(tracks)
}

#[tauri::command]
pub async fn addon_catalog(state: State<'_, AppState>, addon_id: String, kind: String, id: String) -> Result<Vec<eclipse::AddonTrack>, String> {
    require_resource(&state, &addon_id, "search")?;
    let tracks = eclipse::catalog(eclipse::client(), &addon_id, &load_base(&addon_id)?, &kind, &id).await?;
    require_resource(&state, &addon_id, "search")?;
    Ok(tracks)
}

/// Dispatched dynamically by the frontend as `${provider}_resolve_source` with provider = "addon".
#[tauri::command]
pub async fn addon_resolve_source(
    state: State<'_, AppState>,
    track_id: String,
    requested_quality: Option<crate::sources::StreamingQuality>,
) -> Result<crate::sources::ResolvedStream, String> {
    let (addon_id, tid) = track_id.split_once(':').filter(|_| valid_source_id(&track_id)).ok_or("Invalid addon track id")?;
    require_resource(&state, addon_id, "stream")?;
    let stream = eclipse::resolve(eclipse::client(), &load_base(addon_id)?, tid, requested_quality).await?;
    require_resource(&state, addon_id, "stream")?;
    Ok(stream)
}

fn require_installed_base(state: &AppState, id: &str) -> Result<url::Url, String> {
    if !valid_addon_id(id) {
        return Err("Invalid addon id".into());
    }
    let installed: bool = state
        .read_conn()
        .query_row("SELECT EXISTS(SELECT 1 FROM addons WHERE id = ?1)", [id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if !installed {
        return Err("Addon is not installed".into());
    }
    load_base(id)
}

#[tauri::command]
pub async fn addon_auth_status(state: State<'_, AppState>, addon_id: String) -> Result<serde_json::Value, String> {
    let base = require_installed_base(&state, &addon_id)?;
    eclipse::auth_status(eclipse::client(), &base).await
}

#[tauri::command]
pub async fn addon_auth_start_device(state: State<'_, AppState>, addon_id: String) -> Result<serde_json::Value, String> {
    let base = require_installed_base(&state, &addon_id)?;
    eclipse::auth_start_device(eclipse::client(), &base).await
}

#[tauri::command]
pub async fn addon_auth_poll_device(state: State<'_, AppState>, addon_id: String) -> Result<serde_json::Value, String> {
    let base = require_installed_base(&state, &addon_id)?;
    eclipse::auth_poll_device(eclipse::client(), &base).await
}

#[tauri::command]
pub async fn addon_auth_login(
    state: State<'_, AppState>,
    addon_id: String,
    credentials: std::collections::HashMap<String, String>,
) -> Result<serde_json::Value, String> {
    let base = require_installed_base(&state, &addon_id)?;
    let creds = serde_json::to_value(credentials).map_err(|e| e.to_string())?;
    eclipse::auth_login(eclipse::client(), &base, creds).await
}

#[tauri::command]
pub async fn addon_auth_logout(state: State<'_, AppState>, addon_id: String) -> Result<serde_json::Value, String> {
    let base = require_installed_base(&state, &addon_id)?;
    eclipse::auth_logout(eclipse::client(), &base).await
}

pub(crate) fn extract_qobuz_token_from_callback_url(url_str: &str) -> Option<String> {
    let parsed = url::Url::parse(url_str).ok()?;
    if !parsed.path().contains("aideo-auth-callback") {
        return None;
    }
    parsed
        .query_pairs()
        .find(|(k, _)| k == "token")
        .map(|(_, v)| v.to_string())
        .filter(|t| !t.trim().is_empty())
}

#[tauri::command]
pub async fn addon_open_browser_login(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    addon_id: String,
) -> Result<serde_json::Value, String> {
    use tauri::{Emitter, Manager};

    if !supports_browser_login(&addon_id) {
        return Err("Browser login is not available for this addon".into());
    }
    let base = require_installed_base(&state, &addon_id)?;
    eclipse::ensure_local_cloud_server(&base);

    let label = "addon-qobuz-login";
    if let Some(win) = app_handle.get_webview_window(label) {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        return Ok(serde_json::json!({ "ok": true, "mode": "webview" }));
    }

    let init_script = r#"
(function() {
    if (window.__aideoQobuzHooked) return;
    window.__aideoQobuzHooked = true;
    var captured = false;

    function notifyRust(token) {
        if (captured || !token || typeof token !== 'string' || token.length < 10) return;
        captured = true;
        window.location.href = 'https://play.qobuz.com/aideo-auth-callback?token=' + encodeURIComponent(token);
    }

    var origFetch = window.fetch;
    window.fetch = function() {
        var args = arguments;
        var url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url ? args[0].url : '');
        var opts = args[1] || {};
        if (opts.headers) {
            var h = opts.headers;
            var tok = (typeof h.get === 'function') ? h.get('x-user-auth-token') : (h['x-user-auth-token'] || h['X-User-Auth-Token']);
            if (tok) notifyRust(tok);
        }
        return origFetch.apply(this, args).then(function(response) {
            if (url.indexOf('/user/login') !== -1 || url.indexOf('login') !== -1) {
                response.clone().json().then(function(data) {
                    if (data && data.user_auth_token) notifyRust(data.user_auth_token);
                }).catch(function(){});
            }
            return response;
        });
    };

    var origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
        if (name && name.toLowerCase() === 'x-user-auth-token' && value) {
            notifyRust(value);
        }
        return origSetHeader.apply(this, arguments);
    };

    var origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function() {
        this.addEventListener('load', function() {
            try {
                var data = JSON.parse(this.responseText);
                if (data && data.user_auth_token) notifyRust(data.user_auth_token);
            } catch(e) {}
        });
        return origSend.apply(this, arguments);
    };

    var pollInterval = setInterval(function() {
        if (captured) { clearInterval(pollInterval); return; }
        try {
            for (var i = 0; i < localStorage.length; i++) {
                var key = localStorage.key(i);
                var val = localStorage.getItem(key);
                if (!val) continue;
                if (key.toLowerCase().indexOf('token') !== -1 && val.length > 20 && val.length < 500 && val.indexOf('{') === -1) {
                    notifyRust(val);
                    return;
                }
                if (val.indexOf('user_auth_token') !== -1) {
                    var parsed = JSON.parse(val);
                    if (parsed.user_auth_token) {
                        notifyRust(parsed.user_auth_token);
                        return;
                    }
                }
            }
        } catch(e) {}
    }, 1000);
})();
"#;

    let app_clone = app_handle.clone();
    let addon_id_clone = addon_id.clone();
    let base_clone = base.clone();

    let _login_window = tauri::WebviewWindowBuilder::new(
        &app_handle,
        label,
        tauri::WebviewUrl::External(
            "https://play.qobuz.com/login"
                .parse()
                .map_err(|e: url::ParseError| e.to_string())?,
        ),
    )
    .title("Qobuz Login — Aideo")
    .inner_size(520.0, 720.0)
    .center()
    .resizable(true)
    .initialization_script(init_script)
    .on_navigation(move |url| {
        if let Some(token) = extract_qobuz_token_from_callback_url(url.as_str()) {
            let app = app_clone.clone();
            let id_for_task = addon_id_clone.clone();
            let base_for_task = base_clone.clone();
            tauri::async_runtime::spawn(async move {
                match eclipse::auth_login(
                    eclipse::client(),
                    &base_for_task,
                    serde_json::json!({ "userAuthToken": token }),
                )
                .await
                {
                    Ok(_) => {
                        if let Some(win) = app.get_webview_window("addon-qobuz-login") {
                            let _ = win.close();
                        }
                        let _ = app.emit(
                            "addon-auth-success",
                            serde_json::json!({ "addonId": id_for_task, "provider": "qobuz" }),
                        );
                    }
                    Err(err) => {
                        let _ = app.emit(
                            "addon-auth-error",
                            serde_json::json!({ "addonId": id_for_task, "error": err }),
                        );
                    }
                }
            });
            return false;
        }
        true
    })
    .build()
    .map_err(|e| format!("Failed to open Qobuz login window: {e}"))?;

    Ok(serde_json::json!({ "ok": true, "mode": "webview" }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_manifests_are_capability_specific() {
        let entries = builtins();
        assert_eq!(entries.len(), 3);
        assert!(entries.iter().all(|a| a.builtin && a.enabled && valid_addon_id(&a.id)));
        assert!(entries[0].resources.contains(&"search".into()));
        assert!(entries[1].resources.contains(&"lyrics".into()));
        assert!(entries[2].resources.contains(&"translate".into()));
    }

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

    #[test]
    fn browser_login_is_limited_to_the_exact_qobuz_addon() {
        assert!(supports_browser_login("org.aideo.qobuz"));
        for id in ["org.evil.qobuz", "com.example.qobuz-clone", "org.aideo.tidal", "org.aideo.qobuz.fake", ""] {
            assert!(!supports_browser_login(id), "{id} must not get browser login");
        }
    }

    #[test]
    fn info_sets_browser_login_from_the_host_not_the_manifest() {
        let manifest = |id: &str| eclipse::Manifest {
            id: id.into(), name: "x".into(), version: "1".into(), description: None, icon: None,
            resources: vec!["search".into(), "stream".into()], content_type: None,
            auth: Some(eclipse::AddonAuthSpec {
                auth_type: "credentials".into(), label: None, help_text: None, fields: vec![], browser_login: true,
            }),
        };
        assert!(info(manifest("org.aideo.qobuz"), "http://127.0.0.1:7014".into()).auth.unwrap().browser_login);
        assert!(!info(manifest("org.evil.qobuz"), "http://127.0.0.1:7014".into()).auth.unwrap().browser_login);
    }

    #[test]
    fn extracts_qobuz_token_from_callback_url() {
        assert_eq!(
            extract_qobuz_token_from_callback_url("https://play.qobuz.com/aideo-auth-callback?token=qbz_secret_123"),
            Some("qbz_secret_123".to_string())
        );
        assert_eq!(
            extract_qobuz_token_from_callback_url("https://play.qobuz.com/login?token=qbz_secret_123"),
            None
        );
        assert_eq!(
            extract_qobuz_token_from_callback_url("https://play.qobuz.com/aideo-auth-callback?token="),
            None
        );
    }
}
