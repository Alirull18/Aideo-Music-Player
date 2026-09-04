// Taskbar integration is intentionally kept non-invasive.
//
// The Windows thumbnail toolbar requires subclassing the Tao/WebView2 window
// procedure. That integration was the source of the phase-3 stability
// regression: it can race the UI message pump and destabilize the whole app.
// Native media controls are already provided through Souvlaki/SMTC, so keep
// these hooks as no-ops until a dedicated, message-loop-owned implementation
// is available.

pub fn initialize_taskbar_buttons(_hwnd_raw: *mut std::ffi::c_void, _app_handle: tauri::AppHandle) {
    // Intentionally no-op to preserve Tao / WebView2 message-pump integrity.
}

pub fn update_taskbar_playback_state(_hwnd_raw: *mut std::ffi::c_void, _playing: bool) {
    // Intentionally no-op to prevent COM apartment deadlocks on background threads.
}
