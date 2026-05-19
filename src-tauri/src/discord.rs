use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use std::sync::Mutex;
use lazy_static::lazy_static;

// Placeholder Client ID - You can create your own at discord.com/developers
const DISCORD_CLIENT_ID: &str = "1504408732203745301"; 

lazy_static! {
    static ref DISCORD_CLIENT: Mutex<Option<DiscordIpcClient>> = Mutex::new(None);
}

pub fn init_discord() {
    println!("[Discord] Attempting to connect with ID: {}", DISCORD_CLIENT_ID);
    let mut client = match DiscordIpcClient::new(DISCORD_CLIENT_ID) {
        Ok(c) => c,
        Err(e) => {
            println!("[Discord] Client Creation Error: {}", e);
            return;
        },
    };

    match client.connect() {
        Ok(_) => {
            println!("[Discord] Connected Successfully!");
            let mut global_client = DISCORD_CLIENT.lock().unwrap();
            *global_client = Some(client);
        }
        Err(e) => {
            println!("[Discord] Connection Failed: {}. Is Discord open?", e);
        }
    }
}

pub fn update_presence(details: &str, state: &str, is_playing: bool) {
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
                    "https://github.com/Alirul18/Aideo-Music-Player",
                ),
                activity::Button::new(
                    "Download App",
                    "https://github.com/Alirul18/Aideo-Music-Player/releases",
                ),
            ]);
        }

        if let Err(e) = client.set_activity(act) {
            println!("[Discord] Presence Update Error: {}", e);
        }
    }
}

#[allow(dead_code)]
pub fn clear_presence() {
    let mut global_client = DISCORD_CLIENT.lock().unwrap();
    if let Some(client) = global_client.as_mut() {
        let _ = client.clear_activity();
    }
}
