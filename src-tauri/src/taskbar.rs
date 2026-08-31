// Taskbar module - safe integration without intrusive HWND subclassing
// (Native media controls are handled via SMTC / Souvlaki)

pub fn initialize_taskbar_buttons(_hwnd_raw: *mut std::ffi::c_void, _app_handle: tauri::AppHandle) {
    // Intentionally no-op to preserve Tao / WebView2 message pump integrity
}

pub fn update_taskbar_playback_state(_hwnd_raw: *mut std::ffi::c_void, _playing: bool) {
    // Intentionally no-op to prevent COM apartment deadlocks on background threads
}
