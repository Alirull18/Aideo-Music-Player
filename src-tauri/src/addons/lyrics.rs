//! Internal lyrics providers and the Eclipse lyrics/translation boundary.
use crate::{get_http_client, lyrics, AppState};
use serde::{Deserialize, Serialize};
use std::{future::Future, sync::Arc, time::Duration};
use tauri::{AppHandle, Manager, State};

const TRANSLATION_TIMEOUT: Duration = Duration::from_secs(5);
const PROVIDER_TIMEOUT: Duration = Duration::from_millis(3500);

/// Native futures keep provider calls on the existing runtime without a new dependency.
/// Translation returns (English text, transliteration), matching the existing IPC shape.
pub trait LyricsAddon {
    fn search(
        &self,
        query: String,
        title: Option<String>,
        artist: Option<String>,
        album: Option<String>,
        duration: Option<f64>,
    ) -> impl Future<Output = Result<Vec<SearchResult>, String>> + Send;

    fn translate(
        &self,
        text: String,
    ) -> impl Future<Output = Result<(String, String), String>> + Send;
}

pub struct InternalLyricsAddon;

impl LyricsAddon for InternalLyricsAddon {
    async fn search(
        &self,
        query: String,
        title: Option<String>,
        artist: Option<String>,
        album: Option<String>,
        duration: Option<f64>,
    ) -> Result<Vec<SearchResult>, String> {
        search_internal(query, title, artist, album, duration).await
    }

    async fn translate(&self, text: String) -> Result<(String, String), String> {
        if text.trim().is_empty() {
            return Ok((String::new(), String::new()));
        }
        if !super::is_enabled("org.aideo.translation") {
            return Ok((text, String::new()));
        }
        translation_with_timeout(&text, TRANSLATION_TIMEOUT, translate_internal(text.clone())).await
    }
}

pub struct EclipseLyricsAddon {
    pub id: String,
    pub base: url::Url,
}

impl LyricsAddon for EclipseLyricsAddon {
    async fn search(
        &self,
        query: String,
        _title: Option<String>,
        _artist: Option<String>,
        _album: Option<String>,
        _duration: Option<f64>,
    ) -> Result<Vec<SearchResult>, String> {
        let rows = super::eclipse::lyrics(super::eclipse::client(), &self.base, &query, _title.as_deref(), _artist.as_deref(), _album.as_deref(), _duration).await?;
        Ok(rows
            .into_iter()
            .filter_map(|row| external_search_result(&self.id, row))
            .collect())
    }

    async fn translate(&self, text: String) -> Result<(String, String), String> {
        super::eclipse::translate(super::eclipse::client(), &self.base, &text)
            .await
            .map(|translated| (translated, String::new()))
    }
}

fn external_search_result(id: &str, value: serde_json::Value) -> Option<SearchResult> {
    // Aideo lyrics extension: syncedLyrics (preferred) / plainLyrics; raw_lrc and lyrics kept as aliases.
    let synced_text = value.get("syncedLyrics").and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty());
    let raw = synced_text
        .or_else(|| value.get("raw_lrc").and_then(|v| v.as_str()))
        .or_else(|| value.get("plainLyrics").and_then(|v| v.as_str()))
        .or_else(|| value.get("lyrics").and_then(|v| v.as_str()))?;
    if raw.trim().is_empty() || raw.len() > 512 * 1024 {
        return None;
    }
    let synced = synced_text.is_some() || value["synced"].as_bool().unwrap_or(false);
    Some(SearchResult {
        id: format!("{}:{}", id, value["id"].as_str().unwrap_or("lyrics")),
        title: value["title"].as_str().unwrap_or("").to_string(),
        artist: value["artist"].as_str().unwrap_or("").to_string(),
        source: id.to_string(),
        synced,
        content_id: None,
        raw_lrc: Some(raw.to_string()),
        duration: value["duration"].as_f64(),
    })
}

async fn translation_with_timeout(
    original: &str,
    budget: Duration,
    operation: impl Future<Output = Result<(String, String), String>>,
) -> Result<(String, String), String> {
    match tokio::time::timeout(budget, operation).await {
        Ok(result) => result,
        Err(_) => Ok((original.to_string(), String::new())),
    }
}

/// Manifest resource name for translation addons; must match `builtins()` and `eclipse.rs`.
const TRANSLATE_RESOURCE: &str = "translate";

fn kugou_search_url(query: &str) -> String {
    format!(
        "https://lyrics.kugou.com/search?ver=1&man=yes&client=pc&keyword={}&duration=&hash=",
        urlencoding::encode(query)
    )
}

fn kugou_download_url(id: &str, accesskey: &str) -> String {
    format!(
        "https://lyrics.kugou.com/download?ver=1&client=pc&id={}&accesskey={}&fmt=krc&charset=utf8",
        urlencoding::encode(id),
        urlencoding::encode(accesskey)
    )
}

fn external_addons(state: &AppState, resource: &str) -> Vec<EclipseLyricsAddon> {
    super::enabled_bases(state, resource)
        .into_iter()
        .map(|(id, base)| EclipseLyricsAddon { id, base })
        .collect()
}

async fn translate_line(
    text: String,
    external: &[EclipseLyricsAddon],
) -> Result<(String, String), String> {
    if text.trim().is_empty() {
        return Ok((String::new(), String::new()));
    }
    let operation = async {
        for addon in external {
            if let Ok(result) = addon.translate(text.clone()).await {
                if !result.0.trim().is_empty() {
                    return Ok(result);
                }
            }
        }
        InternalLyricsAddon.translate(text.clone()).await
    };
    translation_with_timeout(&text, TRANSLATION_TIMEOUT, operation).await
}

#[tauri::command]
pub async fn translate_lyric_line(
    state: State<'_, AppState>,
    text: String,
) -> Result<(String, String), String> {
    translate_line(text, &external_addons(&state, TRANSLATE_RESOURCE)).await
}

#[tauri::command]
pub async fn translate_lyrics_batch(
    state: State<'_, AppState>,
    lines: Vec<String>,
) -> Result<Vec<(String, String)>, String> {
    let external = external_addons(&state, TRANSLATE_RESOURCE);
    let semaphore = Arc::new(tokio::sync::Semaphore::new(4));
    let tasks = lines.into_iter().map(|line| {
        let semaphore = semaphore.clone();
        let external = &external;
        async move {
            let _permit = semaphore.acquire().await.map_err(|e| e.to_string())?;
            translate_line(line, external).await
        }
    });
    futures::future::join_all(tasks).await.into_iter().collect()
}

#[tauri::command]
pub async fn search_lyrics_online(
    state: State<'_, AppState>,
    query: String,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<f64>,
) -> Result<Vec<SearchResult>, String> {
    let external = external_addons(&state, "lyrics");
    let internal = async {
        if super::is_enabled("org.aideo.lyrics") {
            InternalLyricsAddon
                .search(query.clone(), title.clone(), artist.clone(), album.clone(), duration)
                .await
                .unwrap_or_default()
        } else {
            Vec::new()
        }
    };
    let external_results = futures::future::join_all(external.iter().map(|addon| async {
        tokio::time::timeout(
            PROVIDER_TIMEOUT,
            addon.search(query.clone(), title.clone(), artist.clone(), album.clone(), duration),
        )
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or_default()
    }));
    let (mut results, external_results) = tokio::join!(internal, external_results);
    results.extend(external_results.into_iter().flatten());
    Ok(results)
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub source: String,
    pub synced: bool,
    pub content_id: Option<String>,
    pub raw_lrc: Option<String>,
    pub duration: Option<f64>,
}

fn clean_translated_text(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .trim()
        .to_string()
}

// ── Translation command ─────────────────────────────────────────────────────
async fn translate_internal(text: String) -> Result<(String, String), String> {
    if text.trim().is_empty() {
        return Ok((String::new(), String::new()));
    }
    let client = get_http_client();

    // 1. Try Google Translate API (JSON with transliteration dt=rm)
    let api_url = format!(
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&dt=rm&q={}",
        urlencoding::encode(&text)
    );

    if let Ok(res) = client
        .get(&api_url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .send()
        .await
    {
        if res.status().is_success() {
            if let Ok(data) = res.json::<serde_json::Value>().await {
                let translation = data.get(0)
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|item| item.get(0).and_then(|t| t.as_str()))
                            .collect::<Vec<_>>()
                            .join("")
                    })
                    .unwrap_or_default();

                let transliteration = data.get(0)
                    .and_then(|v| v.as_array())
                    .and_then(|arr| arr.iter().rev().find_map(|item| {
                        item.get(3).and_then(|t| t.as_str())
                            .or_else(|| item.get(2).and_then(|t| t.as_str()))
                    }))
                    .unwrap_or("")
                    .to_string();

                if !translation.is_empty() || !transliteration.is_empty() {
                    return Ok((clean_translated_text(&translation), transliteration));
                }
            }
        }
    }

    // 2. Fallback: Google Mobile Translate Web Scraper
    let mobile_url = format!(
        "https://translate.google.com/m?sl=auto&tl=en&q={}",
        urlencoding::encode(&text)
    );

    if let Ok(res) = client
        .get(&mobile_url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .send()
        .await
    {
        if let Ok(html) = res.text().await {
            if let Some(start) = html.find("<div class=\"result-container\">") {
                let rest = &html[start + 30..];
                if let Some(end) = rest.find("</div>") {
                    let trans = clean_translated_text(&rest[..end]);
                    return Ok((trans, String::new()));
                }
            }
        }
    }

    // 3. Fallback: MyMemory API
    let mymemory_url = format!(
        "https://api.mymemory.translated.net/get?q={}&langpair=auto|en",
        urlencoding::encode(&text)
    );

    if let Ok(res) = client.get(&mymemory_url).send().await {
        if let Ok(data) = res.json::<serde_json::Value>().await {
            if let Some(trans) = data["responseData"]["translatedText"].as_str() {
                let trans = clean_translated_text(trans);
                if !trans.starts_with("MYMEMORY WARNING:") {
                    return Ok((trans, String::new()));
                }
            }
        }
    }

    Ok((String::new(), String::new()))
}

// ── Online Search commands ──────────────────────────────────────────────────
#[tauri::command]
pub async fn get_unison_ttml(
    song: String,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<f64>,
) -> Result<String, String> {
    if !super::is_enabled("org.aideo.lyrics") {
        return Err("Built-in lyrics addon is disabled".into());
    }
    let client = get_http_client();
    let timeout_dur = std::time::Duration::from_millis(3500);

    let art_param = artist.as_deref().unwrap_or("").trim();
    let song_param = song.trim();
    let query_str = format!("{} {}", art_param, song_param).trim().to_string();

    let req_fut = async {
        // 1. First attempt: BiniLyrics (Apple Music Word-Level TTML CDN)
        let bini_url = format!(
            "https://lyrics-api.binimum.org/getLyrics?q={}",
            urlencoding::encode(&query_str)
        );
        if let Ok(resp) = client
            .get(&bini_url)
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Aideo/0.9.12")
            .send()
            .await
        {
            if let Ok(data) = resp.json::<serde_json::Value>().await {
                if let Some(list) = data["results"].as_array() {
                    let mut sorted = list.clone();
                    sorted.sort_by_key(|item| {
                        if item["timing_type"].as_str() == Some("word") { 0 } else { 1 }
                    });
                    if let Some(first) = sorted.first() {
                        if let Some(url) = first["lyricsUrl"].as_str() {
                            if let Ok(ttml_res) = client.get(url).send().await {
                                if let Ok(body) = ttml_res.text().await {
                                    let trimmed = body.trim();
                                    if trimmed.starts_with('<') {
                                        return Ok(trimmed.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // 2. Second attempt: Better Lyrics / Unison (Crowdsourced TTML)
        let mut urls = vec![
            format!(
                "https://lyrics-api.boidu.dev/getLyrics?s={}&a={}",
                urlencoding::encode(song_param),
                urlencoding::encode(art_param)
            ),
            format!(
                "https://lyrics.boidu.dev/getLyrics?s={}&a={}",
                urlencoding::encode(song_param),
                urlencoding::encode(art_param)
            ),
        ];
        if let Some(ref alb) = album {
            if !alb.trim().is_empty() {
                urls[0].push_str(&format!("&album={}", urlencoding::encode(alb)));
            }
        }
        if let Some(dur) = duration {
            if dur > 0.0 {
                urls[0].push_str(&format!("&duration={:.1}", dur));
            }
        }

        for url in urls {
            if let Ok(resp) = client
                .get(&url)
                .header("Accept", "application/json, text/xml, */*")
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Aideo/0.9.12")
                .send()
                .await
            {
                if resp.status().is_success() {
                    if let Ok(body) = resp.text().await {
                        let trimmed = body.trim();
                        if trimmed.starts_with('<') {
                            return Ok(trimmed.to_string());
                        }
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(trimmed) {
                            if let Some(ttml) = json["ttml"].as_str()
                                .or_else(|| json["lyrics"].as_str())
                                .or_else(|| json["data"]["ttml"].as_str())
                                .or_else(|| json["data"]["lyrics"].as_str())
                            {
                                if !ttml.trim().is_empty() {
                                    return Ok(ttml.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }

        Err("No TTML lyrics found in BiniLyrics or Better Lyrics".to_string())
    };

    match tokio::time::timeout(timeout_dur, req_fut).await {
        Ok(res) => res,
        Err(_) => Err("TTML lyrics request timed out after 3.5s".to_string()),
    }
}

#[tauri::command]
pub async fn get_kugou_krc(id: String, accesskey: String) -> Result<String, String> {
    if !super::is_enabled("org.aideo.lyrics") {
        return Err("Built-in lyrics addon is disabled".into());
    }
    let client = get_http_client();
    let timeout_dur = std::time::Duration::from_millis(3500);
    let url = kugou_download_url(&id, &accesskey);

    let fetch_fut = async {
        let resp = client
            .get(&url)
            .header("User-Agent", "KuGou/10000")
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        if let Some(content_b64) = data["content"].as_str() {
            if let Some(decoded) = lyrics::decode_krc(content_b64) {
                return Ok(decoded);
            }
        }
        Err("Failed to decode Kugou KRC lyrics".to_string())
    };

    match tokio::time::timeout(timeout_dur, fetch_fut).await {
        Ok(res) => res,
        Err(_) => Err("Kugou download request timed out after 3.5s".to_string()),
    }
}

async fn search_internal(
    query: String,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<f64>,
) -> Result<Vec<SearchResult>, String> {
    if !super::is_enabled("org.aideo.lyrics") {
        return Err("Built-in lyrics addon is disabled".into());
    }
    let client = get_http_client();
    let timeout_dur = std::time::Duration::from_millis(3500);

    let explicit_title = title.as_deref().unwrap_or("").trim();
    let explicit_artist = artist.as_deref().unwrap_or("").trim();

    let (song, artist_opt) = if !explicit_title.is_empty() {
        (
            explicit_title.to_string(),
            if explicit_artist.is_empty() {
                None
            } else {
                Some(explicit_artist.to_string())
            },
        )
    } else if let Some(pos) = query.find(" - ") {
        let art = query[..pos].trim();
        let sng = query[pos + 3..].trim();
        (sng.to_string(), Some(art.to_string()))
    } else {
        (query.trim().to_string(), None)
    };

    let full_search_str = if let Some(ref art) = artist_opt {
        format!("{} {}", art, song)
    } else {
        query.clone()
    };
    let encoded_query = urlencoding::encode(&full_search_str);

    // 1. BiniLyrics (Apple Music Official Word-Sync TTML)
    let bini_query = full_search_str.clone();
    let bini_song_fallback = song.clone();
    let bini_fut = async {
        let mut results = Vec::new();
        let bini_url = format!(
            "https://lyrics-api.binimum.org/getLyrics?q={}",
            urlencoding::encode(&bini_query)
        );
        if let Ok(res) = client
            .get(&bini_url)
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Aideo/0.9.12")
            .send()
            .await
        {
            if let Ok(data) = res.json::<serde_json::Value>().await {
                if let Some(list) = data["results"].as_array() {
                    let mut sorted = list.clone();
                    sorted.sort_by_key(|item| {
                        if item["timing_type"].as_str() == Some("word") { 0 } else { 1 }
                    });

                    for item in sorted.iter().take(2) {
                        let track_name = item["track_name"].as_str().unwrap_or("").to_string();
                        let artist_name = item["artist_name"].as_str().unwrap_or("").to_string();
                        let dur = item["duration"].as_f64();
                        let timing = item["timing_type"].as_str().unwrap_or("").to_string();
                        let lyrics_url = item["lyricsUrl"].as_str().unwrap_or("").to_string();

                        if !lyrics_url.is_empty() {
                            let mut raw_ttml = None;
                            if let Ok(lyr_res) = client.get(&lyrics_url).send().await {
                                if let Ok(lyr_text) = lyr_res.text().await {
                                    if lyr_text.trim().starts_with('<') {
                                        raw_ttml = Some(lyr_text);
                                    }
                                }
                            }

                            results.push(SearchResult {
                                id: format!("binilyrics-{}", item["id"].as_str().unwrap_or("item")),
                                title: if track_name.is_empty() { bini_song_fallback.clone() } else { track_name },
                                artist: artist_name,
                                source: "BiniLyrics".to_string(),
                                synced: true,
                                content_id: Some(lyrics_url),
                                raw_lrc: raw_ttml,
                                duration: dur,
                            });
                            if timing == "word" {
                                break;
                            }
                        }
                    }
                }
            }
        }
        results
    };

    // 2. Better Lyrics / Unison API (Syllable-level TTML)
    let boidu_song = song.clone();
    let boidu_art = artist_opt.clone();
    let boidu_dur = duration;
    let boidu_alb = album.clone();
    let boidu_fut = async {
        let mut results = Vec::new();
        let art_str = boidu_art.as_deref().unwrap_or("");
        let mut urls = vec![
            format!(
                "https://lyrics-api.boidu.dev/getLyrics?s={}&a={}",
                urlencoding::encode(&boidu_song),
                urlencoding::encode(art_str)
            ),
            format!(
                "https://lyrics.boidu.dev/getLyrics?s={}&a={}",
                urlencoding::encode(&boidu_song),
                urlencoding::encode(art_str)
            ),
        ];
        if let Some(ref alb) = boidu_alb {
            if !alb.trim().is_empty() {
                urls[0].push_str(&format!("&album={}", urlencoding::encode(alb)));
            }
        }
        if let Some(dur) = boidu_dur {
            if dur > 0.0 {
                urls[0].push_str(&format!("&duration={:.1}", dur));
            }
        }

        for u in urls {
            if let Ok(res) = client.get(&u)
                .header("Accept", "application/json, text/xml, */*")
                .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Aideo/0.9.12")
                .send()
                .await
            {
                if res.status().is_success() {
                    if let Ok(body) = res.text().await {
                        let trimmed = body.trim();
                        let mut ttml_str = None;
                        if trimmed.starts_with('<') {
                            ttml_str = Some(trimmed.to_string());
                        } else if let Ok(json) = serde_json::from_str::<serde_json::Value>(trimmed) {
                            if let Some(s) = json["ttml"].as_str()
                                .or_else(|| json["lyrics"].as_str())
                                .or_else(|| json["data"]["ttml"].as_str())
                                .or_else(|| json["data"]["lyrics"].as_str())
                            {
                                if !s.trim().is_empty() {
                                    ttml_str = Some(s.to_string());
                                }
                            }
                        }

                        if let Some(ttml) = ttml_str {
                            let title_str = boidu_song.clone();
                            let art_name = art_str.to_string();
                            results.push(SearchResult {
                                id: format!("betterlyrics-{:x}", md5::compute(format!("{}-{}", title_str, art_name).as_bytes())),
                                title: title_str,
                                artist: art_name,
                                source: "Better Lyrics".to_string(),
                                synced: true,
                                content_id: Some(boidu_song.clone()),
                                raw_lrc: Some(ttml),
                                duration: boidu_dur,
                            });
                            break;
                        }
                    }
                }
            }
        }
        results
    };

    // 3. NetEase Cloud Music (YRC Word-Sync & KLyric Karaoke)
    let ne_fut = async {
        let mut results = Vec::new();
        let ne_url = format!(
            "https://music.163.com/api/search/get?s={}&type=1&limit=3",
            encoded_query
        );
        if let Ok(res) = client
            .get(&ne_url)
            .header("Referer", "https://music.163.com")
            .send()
            .await
        {
            if let Ok(data) = res.json::<serde_json::Value>().await {
                if let Some(songs) = data["result"]["songs"].as_array() {
                    for item in songs.iter().take(2) {
                        let ne_id = item["id"]
                            .as_i64()
                            .map(|i| i.to_string())
                            .or_else(|| item["id"].as_str().map(|s| s.to_string()))
                            .unwrap_or_else(|| item["id"].to_string());

                        let mut raw_yrc = None;
                        let lyr_url = format!(
                            "https://music.163.com/api/song/lyric?id={}&lv=1&kv=1&tv=-1&os=pc&yv=1",
                            ne_id
                        );
                        if let Ok(lyr_res) = client
                            .get(&lyr_url)
                            .header("Referer", "https://music.163.com")
                            .send()
                            .await
                        {
                            if let Ok(lyr_data) = lyr_res.json::<serde_json::Value>().await {
                                if let Some(yrc_text) = lyr_data["yrc"]["lyric"]
                                    .as_str()
                                    .or_else(|| lyr_data["klyric"]["lyric"].as_str())
                                    .or_else(|| lyr_data["lrc"]["lyric"].as_str())
                                {
                                    if !yrc_text.trim().is_empty() {
                                        raw_yrc = Some(yrc_text.to_string());
                                    }
                                }
                            }
                        }

                        results.push(SearchResult {
                            id: ne_id.clone(),
                            title: item["name"].as_str().unwrap_or("").to_string(),
                            artist: item["artists"]
                                .as_array()
                                .and_then(|arr| arr.first())
                                .and_then(|a| a["name"].as_str())
                                .unwrap_or("")
                                .to_string(),
                            source: "NetEase".to_string(),
                            synced: true,
                            content_id: Some(ne_id),
                            raw_lrc: raw_yrc,
                            duration: item["duration"]
                                .as_f64()
                                .map(|ms| ms / 1000.0)
                                .or_else(|| item["dt"].as_f64().map(|ms| ms / 1000.0)),
                        });
                    }
                }
            }
        }
        results
    };

    // 4. Kugou (KRC Word-by-Word Sync)
    let kugou_search_query = full_search_str.clone();
    let kugou_song_fallback = song.clone();
    let kugou_fut = async {
        let mut results = Vec::new();
        let kugou_url = kugou_search_url(&kugou_search_query);
        if let Ok(res) = client
            .get(&kugou_url)
            .header("User-Agent", "KuGou/10000")
            .send()
            .await
        {
            if let Ok(data) = res.json::<serde_json::Value>().await {
                if let Some(candidates) = data["candidates"].as_array() {
                    for cand in candidates.iter().take(2) {
                        let id = cand["id"].to_string();
                        let accesskey = cand["accesskey"].as_str().unwrap_or("").to_string();
                        let song_title = cand["song"].as_str().unwrap_or("").to_string();
                        let singer = cand["singer"].as_str().unwrap_or("").to_string();
                        let dur = cand["duration"].as_f64().map(|ms| ms / 1000.0);

                        if !accesskey.is_empty() {
                            let d_url = kugou_download_url(&id, &accesskey);
                            if let Ok(d_res) = client
                                .get(&d_url)
                                .header("User-Agent", "KuGou/10000")
                                .send()
                                .await
                            {
                                if let Ok(d_data) = d_res.json::<serde_json::Value>().await {
                                    if let Some(content_b64) = d_data["content"].as_str() {
                                        if let Some(decoded_krc) = lyrics::decode_krc(content_b64) {
                                            results.push(SearchResult {
                                                id: format!("kugou-{}", id),
                                                title: if song_title.is_empty() {
                                                    kugou_song_fallback.clone()
                                                } else {
                                                    song_title
                                                },
                                                artist: singer,
                                                source: "Kugou".to_string(),
                                                synced: true,
                                                content_id: Some(id),
                                                raw_lrc: Some(decoded_krc),
                                                duration: dur,
                                            });
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        results
    };

    // 5. QQ Music (qrc word sync & lrc)
    let qq_fut = async {
        let mut results = Vec::new();
        let qq_url = format!(
            "https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=3&w={}&format=json",
            encoded_query
        );
        if let Ok(res) = client.get(&qq_url).send().await {
            if let Ok(data) = res.json::<serde_json::Value>().await {
                if let Some(songs) = data["data"]["song"]["list"].as_array() {
                    for item in songs.iter().take(2) {
                        results.push(SearchResult {
                            id: item["songmid"].as_str().unwrap_or("").to_string(),
                            title: item["songname"].as_str().unwrap_or("").to_string(),
                            artist: item["singer"]
                                .as_array()
                                .and_then(|arr| arr.first())
                                .and_then(|s| s["name"].as_str())
                                .unwrap_or("")
                                .to_string(),
                            source: "QQMusic".to_string(),
                            synced: true,
                            content_id: Some(item["songmid"].as_str().unwrap_or("").to_string()),
                            raw_lrc: None,
                            duration: item["interval"]
                                .as_f64()
                                .or_else(|| item["duration"].as_f64()),
                        });
                    }
                }
            }
        }
        results
    };

    // 6. LRCLIB (Exact Match & Search)
    let lrc_song = song.clone();
    let lrc_art = artist_opt.clone();
    let lrc_fut = async {
        let mut results = Vec::new();

        // Exact match attempt if artist is known
        if let Some(ref art) = lrc_art {
            let get_url = format!(
                "https://lrclib.net/api/get?track_name={}&artist_name={}",
                urlencoding::encode(&lrc_song),
                urlencoding::encode(art)
            );
            if let Ok(res) = client.get(&get_url).send().await {
                if let Ok(item) = res.json::<serde_json::Value>().await {
                    if let Some(synced) = item["syncedLyrics"]
                        .as_str()
                        .or_else(|| item["plainLyrics"].as_str())
                    {
                        results.push(SearchResult {
                            id: item["id"].to_string(),
                            title: item["trackName"].as_str().unwrap_or(&lrc_song).to_string(),
                            artist: item["artistName"].as_str().unwrap_or(art).to_string(),
                            source: "LRCLIB".to_string(),
                            synced: !item["syncedLyrics"].is_null(),
                            content_id: None,
                            raw_lrc: Some(synced.to_string()),
                            duration: item["duration"].as_f64(),
                        });
                    }
                }
            }
        }

        // Search attempt
        let search_url = format!("https://lrclib.net/api/search?q={}", encoded_query);
        if let Ok(res) = client.get(&search_url).send().await {
            if let Ok(data) = res.json::<serde_json::Value>().await {
                if let Some(list) = data.as_array() {
                    for item in list.iter().take(3) {
                        let id_str = item["id"].to_string();
                        if !results.iter().any(|r| r.id == id_str) {
                            results.push(SearchResult {
                                id: id_str,
                                title: item["trackName"].as_str().unwrap_or("").to_string(),
                                artist: item["artistName"].as_str().unwrap_or("").to_string(),
                                source: "LRCLIB".to_string(),
                                synced: !item["syncedLyrics"].is_null(),
                                content_id: None,
                                raw_lrc: item["syncedLyrics"]
                                    .as_str()
                                    .or(item["plainLyrics"].as_str())
                                    .map(|s| s.to_string()),
                                duration: item["duration"].as_f64(),
                            });
                        }
                    }
                }
            }
        }
        results
    };

    // Join all 6 providers concurrently with timeout
    let (bini_res, boidu_res, ne_res, kugou_res, qq_res, lrc_res) = tokio::join!(
        tokio::time::timeout(timeout_dur, bini_fut),
        tokio::time::timeout(timeout_dur, boidu_fut),
        tokio::time::timeout(timeout_dur, ne_fut),
        tokio::time::timeout(timeout_dur, kugou_fut),
        tokio::time::timeout(timeout_dur, qq_fut),
        tokio::time::timeout(timeout_dur, lrc_fut)
    );

    let mut results = Vec::new();
    if let Ok(r) = bini_res {
        results.extend(r);
    }
    if let Ok(r) = boidu_res {
        results.extend(r);
    }
    if let Ok(r) = kugou_res {
        results.extend(r);
    }
    if let Ok(r) = qq_res {
        results.extend(r);
    }
    if let Ok(r) = lrc_res {
        results.extend(r);
    }
    if let Ok(r) = ne_res {
        results.extend(r);
    }

    Ok(results)
}

#[tauri::command]
pub async fn get_netease_lrc(id: String) -> Result<String, String> {
    if !super::is_enabled("org.aideo.lyrics") {
        return Err("Built-in lyrics addon is disabled".into());
    }
    let client = get_http_client();
    let timeout_dur = std::time::Duration::from_millis(3500);
    let url = format!(
        "https://music.163.com/api/song/lyric?id={}&lv=1&kv=1&tv=-1&os=pc&yv=1",
        id
    );

    let fetch_fut = async {
        let res = client
            .get(&url)
            .header("Referer", "https://music.163.com")
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let data = res
            .json::<serde_json::Value>()
            .await
            .map_err(|e| e.to_string())?;
        let lrc = data["yrc"]["lyric"]
            .as_str()
            .or_else(|| data["klyric"]["lyric"].as_str())
            .or_else(|| data["lrc"]["lyric"].as_str())
            .ok_or("No lyric found")?
            .to_string();
        Ok(lrc)
    };

    match tokio::time::timeout(timeout_dur, fetch_fut).await {
        Ok(res) => res,
        Err(_) => Err("NetEase lyric request timed out after 3.5s".to_string()),
    }
}

#[tauri::command]
pub async fn get_qqmusic_lrc(mid: String) -> Result<String, String> {
    if !super::is_enabled("org.aideo.lyrics") {
        return Err("Built-in lyrics addon is disabled".into());
    }
    let client = get_http_client();
    let timeout_dur = std::time::Duration::from_millis(3500);
    let url = format!("https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid={}&format=json&nobase64=1", mid);

    let fetch_fut = async {
        let res = client
            .get(&url)
            .header("Referer", "https://y.qq.com/portal/player.html")
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let text = res.text().await.map_err(|e| e.to_string())?;
        let mut clean_json = text;
        if clean_json.contains("MusicJsonCallback(") {
            clean_json = clean_json.replace("MusicJsonCallback(", "");
            if clean_json.ends_with(')') {
                clean_json.pop();
            } else if clean_json.ends_with(");") {
                clean_json.truncate(clean_json.len() - 2);
            } else {
                clean_json = clean_json
                    .trim_end_matches(')')
                    .trim_end_matches(';')
                    .trim_end_matches(' ')
                    .to_string();
            }
        }

        let data: serde_json::Value =
            serde_json::from_str(&clean_json).map_err(|e| e.to_string())?;
        let lrc = data["lyric"]
            .as_str()
            .or_else(|| data["qrc"].as_str())
            .ok_or("No lyric found")?
            .to_string();

        if !lrc.contains('[') && lrc.len() > 10 {
            use base64::{engine::general_purpose, Engine as _};
            if let Ok(decoded) = general_purpose::STANDARD.decode(lrc.trim()) {
                if let Ok(s) = String::from_utf8(decoded) {
                    return Ok(s);
                }
            }
        }

        Ok(lrc)
    };

    match tokio::time::timeout(timeout_dur, fetch_fut).await {
        Ok(res) => res,
        Err(_) => Err("QQ Music lyric request timed out after 3.5s".to_string()),
    }
}

#[tauri::command]
pub fn get_lyrics(path: String) -> Result<Vec<lyrics::LyricLine>, String> {
    Ok(lyrics::get_lyrics_for_track(&path))
}

#[tauri::command]
pub fn save_lyrics_file(path: String, content: String) -> Result<(), String> {
    let save_path = lyrics::get_lyrics_save_path(&path, &content);
    let ext = save_path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("lrc");
    std::fs::write(&save_path, content).map_err(|e| e.to_string())?;
    lyrics::clean_stale_lyrics_cache(&path, ext);
    Ok(())
}

// ── Desktop Lyrics Window Commands ─────────────────────────────────────────
#[tauri::command]
pub async fn toggle_desktop_lyrics(show: bool, app_handle: AppHandle) -> Result<bool, String> {
    if show {
        if let Some(win) = app_handle.get_webview_window("desktop-lyrics") {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        } else {
            let win_builder = tauri::WebviewWindowBuilder::new(
                &app_handle,
                "desktop-lyrics",
                tauri::WebviewUrl::App("index.html?window=desktop-lyrics".into()),
            )
            .title("Aideo Desktop Lyrics")
            .inner_size(880.0, 140.0)
            .transparent(true)
            .decorations(false)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .resizable(true);

            let win = win_builder.build().map_err(|e| e.to_string())?;
            let _ = win.show();
        }
        Ok(true)
    } else {
        if let Some(win) = app_handle.get_webview_window("desktop-lyrics") {
            let _ = win.hide();
        }
        Ok(false)
    }
}

#[tauri::command]
pub fn set_desktop_lyrics_ignore_cursor(ignore: bool, app_handle: AppHandle) -> Result<(), String> {
    if let Some(win) = app_handle.get_webview_window("desktop-lyrics") {
        win.set_ignore_cursor_events(ignore)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_desktop_lyrics_status(app_handle: AppHandle) -> Result<bool, String> {
    if let Some(win) = app_handle.get_webview_window("desktop-lyrics") {
        Ok(win.is_visible().unwrap_or(false))
    } else {
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn kugou_requests_use_https_and_encode_their_parameters() {
        let search = kugou_search_url("adele & hello");
        assert!(search.starts_with("https://lyrics.kugou.com/search?"), "{search}");
        assert!(search.contains("keyword=adele%20%26%20hello"), "{search}");

        let download = kugou_download_url("12 3", "key&x=1");
        assert!(download.starts_with("https://lyrics.kugou.com/download?"), "{download}");
        assert!(download.contains("id=12%203&accesskey=key%26x%3D1&"), "{download}");
        assert!(!download.contains("&x=1"), "an access key must not inject query parameters");
    }

    #[test]
    fn external_lyrics_prefer_synced_text_and_reject_empty_or_oversized() {
        let row = serde_json::json!({"id": "1", "title": "T", "artist": "A", "syncedLyrics": "[00:01.00]Hi", "plainLyrics": "Hi"});
        let r = external_search_result("com.x.y", row).unwrap();
        assert!(r.synced);
        assert_eq!(r.raw_lrc.as_deref(), Some("[00:01.00]Hi"));
        assert_eq!(r.source, "com.x.y");
        let plain = external_search_result("com.x.y", serde_json::json!({"plainLyrics": "Hi"})).unwrap();
        assert!(!plain.synced);
        assert!(external_search_result("com.x.y", serde_json::json!({"syncedLyrics": "  "})).is_none());
        assert!(external_search_result("com.x.y", serde_json::json!({"lyrics": "x".repeat(600 * 1024)})).is_none());
    }

    #[test]
    fn translation_dispatch_uses_the_manifest_capability_name() {
        // Regression: dispatch asked for "translation" while manifests declare "translate",
        // so installed translation addons were never selected.
        let translation_builtin = super::super::builtins()
            .into_iter()
            .find(|a| a.id == super::super::TRANSLATION)
            .expect("builtin translation addon");
        assert!(translation_builtin.resources.iter().any(|r| r == TRANSLATE_RESOURCE));
    }

    #[tokio::test]
    async fn translation_timeout_preserves_original_unicode_line() {
        let original = "  你好 & café  ";
        let result = translation_with_timeout(
            original,
            Duration::from_millis(10),
            std::future::pending::<Result<(String, String), String>>(),
        )
        .await;
        assert_eq!(result, Ok((original.to_string(), String::new())));
    }

    #[tokio::test]
    async fn translation_success_keeps_translation_and_transliteration() {
        let expected = ("Hello".to_string(), "Nǐ hǎo".to_string());
        let result = translation_with_timeout(
            "你好",
            Duration::from_secs(1),
            std::future::ready(Ok(expected.clone())),
        )
        .await;
        assert_eq!(result, Ok(expected));
    }

    #[tokio::test]
    async fn translation_error_is_not_replaced_by_timeout_fallback() {
        let result = translation_with_timeout(
            "original",
            Duration::from_secs(1),
            std::future::ready(Err("provider unavailable".to_string())),
        )
        .await;
        assert_eq!(result, Err("provider unavailable".to_string()));
    }

    #[tokio::test]
    async fn translation_budget_covers_sequential_fallbacks_and_cancels_work() {
        struct Dropped(std::sync::Arc<std::sync::atomic::AtomicBool>);
        impl Drop for Dropped {
            fn drop(&mut self) {
                self.0.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        }
        let dropped = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let guard = Dropped(dropped.clone());
        let operation = async move {
            let _guard = guard;
            for _ in 0..3 {
                tokio::time::sleep(Duration::from_millis(30)).await;
            }
            Ok(("too late".to_string(), String::new()))
        };
        let result =
            translation_with_timeout("original", Duration::from_millis(50), operation).await;
        assert_eq!(result, Ok(("original".to_string(), String::new())));
        assert!(dropped.load(std::sync::atomic::Ordering::SeqCst));
    }

    #[tokio::test]
    async fn internal_empty_translation_does_not_need_network() {
        for text in ["", "  \n\t"] {
            assert_eq!(
                InternalLyricsAddon.translate(text.to_string()).await,
                Ok((String::new(), String::new()))
            );
        }
    }

    #[test]
    fn translation_budget_is_five_seconds() {
        assert_eq!(TRANSLATION_TIMEOUT, Duration::from_secs(5));
    }

    #[tokio::test]
    async fn empty_line_bypasses_external_and_internal_translation() {
        assert_eq!(
            translate_line(" \n\t".into(), &[]).await,
            Ok((String::new(), String::new()))
        );
    }

    #[test]
    fn external_lyrics_keep_content_and_namespace_identity() {
        let result = external_search_result(
            "com.example.lyrics",
            serde_json::json!({
                "id": "track", "title": "你好", "artist": "café", "lyrics": "[00:01]你好",
                "synced": true, "duration": 123.5, "source": "untrusted spoof"
            }),
        )
        .unwrap();
        assert_eq!(result.id, "com.example.lyrics:track");
        assert_eq!(result.source, "com.example.lyrics");
        assert_eq!(result.title, "你好");
        assert_eq!(result.artist, "café");
        assert_eq!(result.raw_lrc.as_deref(), Some("[00:01]你好"));
        assert!(result.synced);
        assert_eq!(result.duration, Some(123.5));
        assert_eq!(result.content_id, None);
    }

    #[test]
    fn external_lyrics_allow_raw_lrc_and_optional_metadata() {
        let result = external_search_result(
            "com.example.lyrics",
            serde_json::json!({
                "raw_lrc": "<tt>words</tt>"
            }),
        )
        .unwrap();
        assert_eq!(result.id, "com.example.lyrics:lyrics");
        assert_eq!(result.raw_lrc.as_deref(), Some("<tt>words</tt>"));
        assert_eq!(result.duration, None);
        assert!(!result.synced);
    }

    #[test]
    fn external_lyrics_ignore_missing_empty_and_wrong_type_content() {
        for value in [
            serde_json::Value::Null,
            serde_json::json!({}),
            serde_json::json!({"lyrics": "  \n"}),
            serde_json::json!({"lyrics": 123}),
            serde_json::json!({"lyrics": ["unexpected"]}),
        ] {
            assert!(external_search_result("com.example.lyrics", value).is_none());
        }
    }

    #[test]
    fn external_lyrics_addon_constructs_cleanly() {
        let u = url::Url::parse("http://127.0.0.1:7011").unwrap();
        let a = EclipseLyricsAddon { id: "com.test.lyrics".into(), base: u };
        assert_eq!(a.id, "com.test.lyrics");
    }

    #[tokio::test]
    async fn eclipse_lyrics_addon_forwards_metadata_query_parameters() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = l.local_addr().unwrap();
        tokio::spawn(async move {
            let Ok((mut s, _)) = l.accept().await else { return };
            let mut buf = vec![0u8; 2048];
            let n = s.read(&mut buf).await.unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            let path = req.split_whitespace().nth(1).unwrap_or("");
            let body = if path == "/lyrics?q=Artist+-+Song&title=Song&artist=Artist&album=Album&duration=185.5" {
                r#"{"lyrics":[{"id":"1","title":"Song","artist":"Artist","syncedLyrics":"[00:01.00]Hello"}]}"#
            } else {
                r#"{"lyrics":[]}"#
            };
            let _ = s.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await;
            let _ = s.shutdown().await;
        });
        let addon = EclipseLyricsAddon {
            id: "com.test.lyrics".into(),
            base: url::Url::parse(&format!("http://127.0.0.1:{}", addr.port())).unwrap(),
        };
        let results = addon.search("Artist - Song".into(), Some("Song".into()), Some("Artist".into()), Some("Album".into()), Some(185.5)).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "com.test.lyrics:1");
        assert!(results[0].synced);
    }

    #[test]
    fn translated_entities_and_unicode_are_preserved() {
        assert_eq!(
            clean_translated_text("  &amp;&quot;&#39;&apos;&lt;&gt;&nbsp;café  "),
            "&\"''<> café"
        );
    }
}
