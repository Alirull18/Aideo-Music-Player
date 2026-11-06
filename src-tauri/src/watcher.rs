use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::AppState;

static WATCHER_HANDLE: Mutex<Option<WatchController>> = Mutex::new(None);

pub struct WatchController {
    _watcher: RecommendedWatcher,
    dirs: Vec<String>,
}

/// Updates active folder watchers. Takes list of directory paths to watch.
/// A call with the folders already being watched is a no-op, so pending changes are not dropped.
pub fn update_watch_folders(dirs: Vec<String>, app_handle: &AppHandle) -> Result<(), String> {
    let mut guard = crate::safe_lock(&WATCHER_HANDLE);
    if guard.as_ref().is_some_and(|w| w.dirs == dirs) {
        return Ok(());
    }

    // Stop existing watcher thread/handle
    *guard = None;

    if dirs.is_empty() {
        return Ok(());
    }

    let (event_tx, event_rx) = channel::<notify::Result<Event>>();
    let mut watcher = RecommendedWatcher::new(event_tx, notify::Config::default())
        .map_err(|e| format!("Failed to create watcher: {}", e))?;

    let mut watching_any = false;
    for dir_str in &dirs {
        let p = PathBuf::from(dir_str);
        if p.is_dir() && watcher.watch(&p, RecursiveMode::Recursive).is_ok() {
            watching_any = true;
        }
    }

    if !watching_any {
        return Ok(());
    }

    let app = app_handle.clone();
    std::thread::spawn(move || debouncer_loop(event_rx, app));

    *guard = Some(WatchController { _watcher: watcher, dirs });
    Ok(())
}

fn is_audio_path(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|ext| crate::scanner::SUPPORTED_AUDIO_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Paths from a create/modify event that need re-reading: audio files, or whole folders that
/// were created or moved into the library (Windows reports a folder move as one event).
fn changed_paths(event: &Event) -> Vec<PathBuf> {
    if !matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_)) {
        return Vec::new();
    }
    event
        .paths
        .iter()
        .filter(|p| is_audio_path(p) || (matches!(event.kind, EventKind::Create(_)) && p.is_dir()))
        .cloned()
        .collect()
}

fn debouncer_loop(event_rx: Receiver<notify::Result<Event>>, app_handle: AppHandle) {
    let debounce_duration = Duration::from_secs(2);
    let mut last_event_time: Option<Instant> = None;
    let mut pending: HashSet<PathBuf> = HashSet::new();

    loop {
        match event_rx.recv_timeout(Duration::from_millis(500)) {
            Ok(Ok(event)) => {
                let paths = changed_paths(&event);
                if !paths.is_empty() {
                    pending.extend(paths);
                    last_event_time = Some(Instant::now());
                }
            }
            Ok(Err(_)) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if !pending.is_empty() && last_event_time.is_some_and(|t| t.elapsed() >= debounce_duration) {
                    last_event_time = None;
                    let batch: Vec<PathBuf> = pending.drain().collect();
                    rescan_and_notify(&app_handle, &batch);
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

/// Re-reads only the files that changed instead of the whole library.
fn rescan_and_notify(app_handle: &AppHandle, changed: &[PathBuf]) {
    let Ok(_activity) = crate::library_health::begin_library_activity() else { return; };
    crate::log_info!("WATCHER", "Rescanning {} changed path(s)", changed.len());
    let mut tracks = Vec::new();
    for path in changed {
        if path.is_dir() {
            tracks.extend(crate::scanner::scan_directory(&path.to_string_lossy(), app_handle));
        } else if path.is_file() {
            let p = path.clone();
            if let Ok(Some(track)) = std::panic::catch_unwind(move || crate::scanner::extract_metadata(&p)) {
                tracks.push(track);
            }
        }
    }

    if tracks.is_empty() {
        return;
    }
    if let Some(state) = app_handle.try_state::<AppState>() {
        let mut conn = crate::safe_lock(&state.db);
        if let Err(e) = crate::db::save_tracks(&mut conn, &mut tracks) {
            crate::log_warn!("WATCHER", "Failed to save rescanned tracks: {}", e);
            return;
        }
    }
    let _ = app_handle.emit("library-updated", ());
}

#[tauri::command(async)]
pub fn sync_watch_folders(dirs: Vec<String>, app_handle: AppHandle) -> Result<(), String> {
    if let Some(state) = app_handle.try_state::<AppState>() {
        let conn = crate::safe_lock(&state.db);
        crate::db::save_library_directories(&conn, &dirs).map_err(|e| e.to_string())?;
    }
    update_watch_folders(dirs, &app_handle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_audio_extension_filter() {
        for ext in crate::scanner::SUPPORTED_AUDIO_EXTENSIONS {
            let path = PathBuf::from(format!("song.{}", ext));
            let is_audio = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| {
                    let ext_lower = e.to_lowercase();
                    crate::scanner::SUPPORTED_AUDIO_EXTENSIONS.contains(&ext_lower.as_str())
                })
                .unwrap_or(false);
            assert!(is_audio, "Extension {} should be identified as audio", ext);
        }

        let non_audio_extensions = &["jpg", "png", "txt", "exe", "pdf"];
        for ext in non_audio_extensions {
            let non_audio = PathBuf::from(format!("file.{}", ext));
            let is_audio = non_audio
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| {
                    let ext_lower = e.to_lowercase();
                    crate::scanner::SUPPORTED_AUDIO_EXTENSIONS.contains(&ext_lower.as_str())
                })
                .unwrap_or(false);
            assert!(!is_audio, "Extension {} should not be identified as audio", ext);
        }
    }
}
