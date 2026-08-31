use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::AppState;

static WATCHER_HANDLE: Mutex<Option<WatchController>> = Mutex::new(None);

pub struct WatchController {
    _watcher: RecommendedWatcher,
    _tx: Sender<Vec<String>>,
}

/// Updates active folder watchers. Takes list of directory paths to watch.
pub fn update_watch_folders(dirs: Vec<String>, app_handle: &AppHandle) -> Result<(), String> {
    let mut guard = crate::safe_lock(&WATCHER_HANDLE);
    
    // Stop existing watcher thread/handle
    *guard = None;

    if dirs.is_empty() {
        return Ok(());
    }

    let (event_tx, event_rx) = channel::<notify::Result<Event>>();
    let mut watcher = RecommendedWatcher::new(event_tx, notify::Config::default())
        .map_err(|e| format!("Failed to create watcher: {}", e))?;

    let mut valid_dirs = Vec::new();
    for dir_str in &dirs {
        let p = PathBuf::from(dir_str);
        if p.exists() && p.is_dir() {
            if let Ok(_) = watcher.watch(&p, RecursiveMode::Recursive) {
                valid_dirs.push(dir_str.clone());
            }
        }
    }

    if valid_dirs.is_empty() {
        return Ok(());
    }

    let (dirs_tx, dirs_rx) = channel::<Vec<String>>();
    let app = app_handle.clone();

    // Spawn debouncer thread
    std::thread::spawn(move || {
        debouncer_loop(event_rx, dirs_rx, app, valid_dirs);
    });

    *guard = Some(WatchController {
        _watcher: watcher,
        _tx: dirs_tx,
    });

    Ok(())
}

fn debouncer_loop(
    event_rx: Receiver<notify::Result<Event>>,
    _dirs_rx: Receiver<Vec<String>>,
    app_handle: AppHandle,
    watched_dirs: Vec<String>,
) {
    let debounce_duration = Duration::from_secs(2);
    let mut last_event_time: Option<Instant> = None;
    let mut pending_change = false;
    let mut pending_paths: std::collections::HashSet<std::path::PathBuf> = std::collections::HashSet::new();

    loop {
        match event_rx.recv_timeout(Duration::from_millis(500)) {
            Ok(Ok(event)) => {
                // Filter for meaningful audio file events (create, modify, remove, rename)
                if matches!(
                    event.kind,
                    EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
                ) {
                    let mut audio_event = false;
                    for p in &event.paths {
                        let is_audio = p.extension()
                            .and_then(|e| e.to_str())
                            .map(|ext| {
                                matches!(
                                    ext.to_lowercase().as_str(),
                                    "flac"
                                        | "wav"
                                        | "m4a"
                                        | "mp3"
                                        | "ogg"
                                        | "opus"
                                        | "aac"
                                        | "aiff"
                                        | "ape"
                                        | "wma"
                                        | "dsf"
                                        | "dff"
                                )
                            })
                            .unwrap_or(false);

                        if is_audio {
                            pending_paths.insert(p.clone());
                            audio_event = true;
                        }
                    }

                    if audio_event {
                        last_event_time = Some(Instant::now());
                        pending_change = true;
                    }
                }
            }
            Ok(Err(_)) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if pending_change {
                    if let Some(last_time) = last_event_time {
                        if last_time.elapsed() >= debounce_duration {
                            pending_change = false;
                            last_event_time = None;

                            let paths_to_process: Vec<_> = pending_paths.drain().collect();
                            // Perform incremental rescan and emit event
                            incremental_or_full_rescan(&app_handle, &watched_dirs, &paths_to_process);
                        }
                    }
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                break;
            }
        }
    }
}

fn incremental_or_full_rescan(
    app_handle: &AppHandle,
    _watched_dirs: &[String],
    changed_paths: &[std::path::PathBuf],
) {
    if changed_paths.is_empty() {
        return;
    }

    println!(
        "[watcher] FS change detected. Incrementally processing {} file(s)...",
        changed_paths.len()
    );

    if let Some(state) = app_handle.try_state::<AppState>() {
        let mut conn = crate::safe_lock(&state.db);
        let mut updated_tracks = Vec::new();

        for path in changed_paths {
            if path.exists() && path.is_file() {
                if let Some(track) = crate::scanner::extract_metadata(path) {
                    updated_tracks.push(track);
                }
            } else {
                // File was deleted or moved
                let path_str = path.to_string_lossy();
                let _ = crate::db::delete_track(&mut conn, &path_str);
            }
        }

        if !updated_tracks.is_empty() {
            let _ = crate::db::save_tracks(&mut conn, &mut updated_tracks);
        }
    }

    let _ = app_handle.emit("library-updated", ());
}

#[tauri::command]
pub fn sync_watch_folders(dirs: Vec<String>, app_handle: AppHandle) -> Result<(), String> {
    if let Some(state) = app_handle.try_state::<AppState>() {
        let conn = crate::safe_lock(&state.db);
        let _ = crate::db::save_library_directories(&conn, &dirs);
    }
    update_watch_folders(dirs, &app_handle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_audio_extension_filter() {
        let audio_extensions = vec![
            "flac", "wav", "m4a", "mp3", "ogg", "opus", "aac", "aiff", "ape", "wma", "dsf", "dff",
        ];
        for ext in audio_extensions {
            let path = PathBuf::from(format!("song.{}", ext));
            let is_audio = path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| matches!(e.to_lowercase().as_str(), "flac" | "wav" | "m4a" | "mp3" | "ogg" | "opus" | "aac" | "aiff" | "ape" | "wma" | "dsf" | "dff"))
                .unwrap_or(false);
            assert!(is_audio, "Extension {} should be identified as audio", ext);
        }

        let non_audio = PathBuf::from("cover.jpg");
        let is_audio = non_audio
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| matches!(e.to_lowercase().as_str(), "flac" | "wav" | "m4a" | "mp3" | "ogg" | "opus" | "aac" | "aiff" | "ape" | "wma" | "dsf" | "dff"))
            .unwrap_or(false);
        assert!(!is_audio, "JPG should not be identified as audio");
    }
}
