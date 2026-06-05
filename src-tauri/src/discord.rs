use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use std::thread;
use lazy_static::lazy_static;

// Placeholder Client ID - You can create your own at discord.com/developers
const DISCORD_CLIENT_ID: &str = "1504408732203745301"; 

lazy_static! {
    static ref DISCORD_CLIENT: Mutex<Option<DiscordIpcClient>> = Mutex::new(None);
    static ref IS_CONNECTING: AtomicBool = AtomicBool::new(false);
    static ref LAST_DETAILS: Mutex<Option<String>> = Mutex::new(None);
    static ref LAST_STATE: Mutex<Option<String>> = Mutex::new(None);
    static ref LAST_IS_PLAYING: Mutex<bool> = Mutex::new(false);
}

pub fn init_discord() {
    println!("[Discord] Initializing Discord RPC...");
    trigger_reconnection();
}

fn trigger_reconnection() {
    if IS_CONNECTING.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
        thread::spawn(|| {
            println!("[Discord] Spawning background reconnection loop...");
            let mut attempts = 0;
            const MAX_ATTEMPTS: u32 = 30; // 5 minutes total (30 * 10 seconds)
            loop {
                attempts += 1;
                println!("[Discord] Attempting to connect with ID: {} (attempt {}/{})", DISCORD_CLIENT_ID, attempts, MAX_ATTEMPTS);
                match DiscordIpcClient::new(DISCORD_CLIENT_ID) {
                    Ok(mut client) => {
                        match client.connect() {
                            Ok(_) => {
                                println!("[Discord] Connected Successfully!");
                                {
                                    let mut global_client = DISCORD_CLIENT.lock().unwrap();
                                    *global_client = Some(client);
                                }
                                IS_CONNECTING.store(false, Ordering::SeqCst);
                                
                                // Send the last known presence if we have one
                                let details = LAST_DETAILS.lock().unwrap().clone();
                                let state = LAST_STATE.lock().unwrap().clone();
                                let is_playing = *LAST_IS_PLAYING.lock().unwrap();
                                
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
                
                if attempts >= MAX_ATTEMPTS {
                    println!("[Discord] Max reconnection attempts ({}) reached. Stopping background loop.", MAX_ATTEMPTS);
                    IS_CONNECTING.store(false, Ordering::SeqCst);
                    break;
                }
                thread::sleep(Duration::from_secs(10));
            }
        });
    }
}

fn update_presence_internal(details: &str, state: &str, is_playing: bool) -> Result<(), Box<dyn std::error::Error>> {
    let mut global_client = DISCORD_CLIENT.lock().unwrap();
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
        *LAST_DETAILS.lock().unwrap() = Some(details.to_string());
        *LAST_STATE.lock().unwrap() = Some(state.to_string());
        *LAST_IS_PLAYING.lock().unwrap() = is_playing;
    }

    // 2. Try updating
    match update_presence_internal(details, state, is_playing) {
        Ok(_) => {}
        Err(e) => {
            println!("[Discord] Presence update failed or client not connected: {}. Ensuring background thread is active...", e);
            // Clear the client if it was some erroring client
            {
                let mut global_client = DISCORD_CLIENT.lock().unwrap();
                if let Some(mut client) = global_client.take() {
                    let _ = client.close();
                }
            }
            trigger_reconnection();
        }
    }
}

#[allow(dead_code)]
pub fn clear_presence() {
    {
        *LAST_DETAILS.lock().unwrap() = None;
        *LAST_STATE.lock().unwrap() = None;
    }
    let mut global_client = DISCORD_CLIENT.lock().unwrap();
    if let Some(client) = global_client.as_mut() {
        let _ = client.clear_activity();
    }
}
