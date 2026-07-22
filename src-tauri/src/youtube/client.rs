use super::parser::{RE_INNERTUBE_1, RE_INNERTUBE_2};

fn get_fallback_innertube_key() -> String {
    let p1 = "AIzaSyAO_Cq3eb5Cu";
    let p2 = "uaQSS9g-U37stSrb7Sg5gQ";
    format!("{}{}", p1, p2)
}

lazy_static::lazy_static! {
    static ref INNERTUBE_KEY: tokio::sync::RwLock<Option<String>> = tokio::sync::RwLock::new(None);
}

pub async fn invalidate_innertube_key() {
    let mut w = INNERTUBE_KEY.write().await;
    *w = None;
    println!("[youtube] InnerTube API key invalidated.");
}

pub async fn fetch_innertube_key() -> String {
    {
        let r = INNERTUBE_KEY.read().await;
        if let Some(ref cached) = *r {
            return cached.clone();
        }
    }

    let mut w = INNERTUBE_KEY.write().await;
    if let Some(ref cached) = *w {
        return cached.clone();
    }

    let client = crate::get_http_client();

    let response = client.get("https://music.youtube.com/")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await;

    let html = match response {
        Ok(res) => res.text().await.unwrap_or_default(),
        Err(_) => {
            println!("⚠ [YOUTUBE ENGINE] Failed to connect to music.youtube.com. Using fallback InnerTube API key.");
            return get_fallback_innertube_key();
        }
    };

    let key = if let Some(caps) = RE_INNERTUBE_1.captures(&html) {
        caps.get(1).map(|m| m.as_str().to_string())
    } else if let Some(caps) = RE_INNERTUBE_2.captures(&html) {
        caps.get(1).map(|m| m.as_str().to_string())
    } else {
        None
    };

    let final_key = match key {
        Some(k) => k,
        None => {
            println!("⚠ [YOUTUBE ENGINE] Could not extract InnerTube API key from music.youtube.com HTML. Using fallback key.");
            get_fallback_innertube_key()
        }
    };

    *w = Some(final_key.clone());
    final_key
}
