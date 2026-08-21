use tauri::AppHandle;
use tauri::Emitter;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// Player actions that can be bound to a global shortcut.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HotkeyAction {
    PlayPause,
    Next,
    Prev,
}

impl HotkeyAction {
    pub fn from_id(id: &str) -> Option<Self> {
        match id {
            "playPause" => Some(HotkeyAction::PlayPause),
            "next" => Some(HotkeyAction::Next),
            "prev" => Some(HotkeyAction::Prev),
            _ => None,
        }
    }

    pub fn event_name(&self) -> &'static str {
        match self {
            // Event names must match what App.tsx setupListeners listens for,
            // so all shuffle/queue/scrobble logic stays in the frontend.
            HotkeyAction::PlayPause => "media-toggle",
            HotkeyAction::Next => "media-next",
            HotkeyAction::Prev => "media-prev",
        }
    }
}

/// Registers (or re-registers) a set of global shortcuts.
/// `bindings` maps action id -> accelerator string (e.g. "Ctrl+Alt+Right").
/// Empty bindings unregister the action.
pub fn apply_shortcuts(app: &AppHandle, bindings: &[(String, Option<String>)]) -> Result<(), String> {
    let gs = app.global_shortcut();

    // Unregister everything first so re-apply is idempotent and handles conflicts.
    let _ = gs.unregister_all();

    for (action_id, accel) in bindings {
        let Some(accel) = accel.as_deref().map(|s| s.trim()).filter(|s| !s.is_empty()) else {
            continue;
        };
        let action = HotkeyAction::from_id(action_id)
            .ok_or_else(|| format!("Unknown hotkey action: {}", action_id))?;
        gs.on_shortcut(accel, move |handle, _sc, event| {
            if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                let _ = handle.emit(action.event_name(), ());
            }
        })
        .map_err(|e| format!("Failed to register '{}': {}", accel, e))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn action_ids_roundtrip() {
        assert_eq!(HotkeyAction::from_id("playPause"), Some(HotkeyAction::PlayPause));
        assert_eq!(HotkeyAction::from_id("next"), Some(HotkeyAction::Next));
        assert_eq!(HotkeyAction::from_id("prev"), Some(HotkeyAction::Prev));
        assert_eq!(HotkeyAction::from_id("volumeUp"), None);
    }

    #[test]
    fn event_names_match_frontend_listeners() {
        assert_eq!(HotkeyAction::PlayPause.event_name(), "media-toggle");
        assert_eq!(HotkeyAction::Next.event_name(), "media-next");
        assert_eq!(HotkeyAction::Prev.event_name(), "media-prev");
    }
}
