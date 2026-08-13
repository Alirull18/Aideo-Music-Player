use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use std::thread;
use lazy_static::lazy_static;

// Client ID for Aideo Music Player
const DISCORD_CLIENT_ID: &str = "1504408732203745301"; 

lazy_static! {
    static ref DISCORD_CLIENT: Mutex<Option<DiscordIpcClient>> = Mutex::new(None);
    static ref IS_CONNECTING: AtomicBool = AtomicBool::new(false);
    static ref IS_ENABLED: AtomicBool = AtomicBool::new(false);
    static ref LAST_DETAILS: Mutex<Option<String>> = Mutex::new(None);
    static ref LAST_STATE: Mutex<Option<String>> = Mutex::new(None);
    static ref LAST_IS_PLAYING: Mutex<bool> = Mutex::new(false);
}

pub fn set_enabled(enabled: bool) {
    println!("[Discord] set_enabled: {}", enabled);
    IS_ENABLED.store(enabled, Ordering::SeqCst);
    if enabled {
        trigger_reconnection();
    } else {
        // Disconnect immediately and release IPC client
        IS_CONNECTING.store(false, Ordering::SeqCst);
        let mut global_client = crate::safe_lock(&DISCORD_CLIENT);
        if let Some(mut client) = global_client.take() {
            let _ = client.clear_activity();
            let _ = client.close();
        }
    }
}

fn trigger_reconnection() {
    if !IS_ENABLED.load(Ordering::SeqCst) {
        return;
    }

    if IS_CONNECTING.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
        thread::spawn(|| {
            println!("[Discord] Spawning background reconnection loop...");
            let mut attempts = 0;
            const MAX_ATTEMPTS: u32 = 30; // 5 minutes total (30 * 10 seconds)
            loop {
                if !IS_ENABLED.load(Ordering::SeqCst) {
                    println!("[Discord] RPC disabled by user. Terminating connection search.");
                    IS_CONNECTING.store(false, Ordering::SeqCst);
                    break;
                }

                attempts += 1;
                println!("[Discord] Attempting to connect with ID: {} (attempt {}/{})", DISCORD_CLIENT_ID, attempts, MAX_ATTEMPTS);
                match DiscordIpcClient::new(DISCORD_CLIENT_ID) {
                    Ok(mut client) => {
                        match client.connect() {
                            Ok(_) => {
                                if !IS_ENABLED.load(Ordering::SeqCst) {
                                    let _ = client.close();
                                    IS_CONNECTING.store(false, Ordering::SeqCst);
                                    break;
                                }
                                println!("[Discord] Connected Successfully!");
                                {
                                    let mut global_client = crate::safe_lock(&DISCORD_CLIENT);
                                    *global_client = Some(client);
                                }
                                IS_CONNECTING.store(false, Ordering::SeqCst);
                                
                                // Send the last known presence if we have one
                                let details = crate::safe_lock(&LAST_DETAILS).clone();
                                let state = crate::safe_lock(&LAST_STATE).clone();
                                let is_playing = *crate::safe_lock(&LAST_IS_PLAYING);
                                
                                if let (Some(d), Some(s)) = (details, state) {
                                    let _ = update_presence_internal(&d, &s, is_playing);
                                }
                                break;
                            }
                            Err(e) => {
                                println!("[Discord] Connection Failed: {}. Retrying in 10s...", e);
                            }
                        }
                    }
                    Err(e) => {
                        println!("[Discord] Client Creation Error: {}. Retrying in 10s...", e);
                    }
                }
                
                if attempts >= MAX_ATTEMPTS || !IS_ENABLED.load(Ordering::SeqCst) {
                    println!("[Discord] Stopping background connection loop (attempts: {}, enabled: {}).", attempts, IS_ENABLED.load(Ordering::SeqCst));
                    IS_CONNECTING.store(false, Ordering::SeqCst);
                    break;
                }
                thread::sleep(Duration::from_secs(10));
            }
        });
    }
}

fn update_presence_internal(details: &str, state: &str, is_playing: bool) -> Result<(), Box<dyn std::error::Error>> {
    if !IS_ENABLED.load(Ordering::SeqCst) {
        return Ok(());
    }

    let mut global_client = crate::safe_lock(&DISCORD_CLIENT);
    if let Some(client) = global_client.as_mut() {
        println!("[Discord] Updating status: {} - {}", details, state);
        let assets = activity::Assets::new()
            .large_image("aideo_logo")
            .large_text("Aideo Music Player");

        let mut act = activity::Activity::new()
            .details(details)
            .state(state)
            .assets(assets);

        if is_playing {
            act = act.buttons(vec![
                activity::Button::new(
                    "Listen with Aideo",
                    "https://github.com/Alirull18/Aideo-Music-Player",
                ),
                activity::Button::new(
                    "Download App",
                    "https://github.com/Alirull18/Aideo-Music-Player/releases",
                ),
            ]);
        }

        client.set_activity(act)?;
        Ok(())
    } else {
        Err("Client not initialized".into())
    }
}

pub fn update_presence(details: &str, state: &str, is_playing: bool) {
    // 1. Save last state
    {
        *crate::safe_lock(&LAST_DETAILS) = Some(details.to_string());
        *crate::safe_lock(&LAST_STATE) = Some(state.to_string());
        *crate::safe_lock(&LAST_IS_PLAYING) = is_playing;
    }

    if !IS_ENABLED.load(Ordering::SeqCst) {
        return;
    }

    // 2. Try updating
    match update_presence_internal(details, state, is_playing) {
        Ok(_) => {}
        Err(e) => {
            println!("[Discord] Presence update failed or client not connected: {}. Ensuring background thread is active...", e);
            // Clear the client if it was some erroring client
            {
                let mut global_client = crate::safe_lock(&DISCORD_CLIENT);
                if let Some(mut client) = global_client.take() {
                    let _ = client.close();
                }
            }
            trigger_reconnection();
        }
    }
}

pub fn clear_presence() {
    {
        *crate::safe_lock(&LAST_DETAILS) = None;
        *crate::safe_lock(&LAST_STATE) = None;
    }
    let mut global_client = crate::safe_lock(&DISCORD_CLIENT);
    if let Some(client) = global_client.as_mut() {
        let _ = client.clear_activity();
    }
}

