use crate::{db, AppState};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::Path,
};

const MAX_BYTES: u64 = 32 * 1024 * 1024;
const CATEGORIES: [&str; 5] = [
    "playlists",
    "favorites",
    "history",
    "recommendations",
    "settings",
];
type Settings = BTreeMap<String, String>;
type Result<T> = std::result::Result<T, String>;
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Media {
    path: String,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
    duration: Option<f64>,
    format: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    media: Media,
    source_context: Option<db::RecordingSources>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Playlist {
    name: String,
    entries: Vec<Entry>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct History {
    media: Media,
    timestamp: i64,
    listened_seconds: f64,
    signal_quality: String,
    end_reason: Option<String>,
    recording_id: Option<String>,
    source_key: Option<String>,
    origin: Option<String>,
    #[serde(default)]
    duration_played: f64,
    #[serde(default)]
    skipped: bool,
    #[serde(default)]
    genre: Option<String>,
    #[serde(default)]
    playback_source: Option<String>,
    #[serde(default)]
    sample_rate: Option<u32>,
    #[serde(default)]
    bit_depth: Option<u32>,
    #[serde(default)]
    bit_perfect: bool,
    #[serde(default)]
    completion_rate: Option<f64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Alias {
    source_key: String,
    recording_id: String,
    title: Option<String>,
    artist: Option<String>,
    duration: Option<f64>,
    #[serde(default)]
    isrc: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    explicit: Option<bool>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct TrainingReset {
    media: Media,
    timestamp: i64,
    listened_seconds: f64,
    recording_id: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Envelope {
    schema_version: u32,
    app_version: String,
    created_at: u64,
    backup_id: String,
    categories: Vec<String>,
    playlists: Vec<Playlist>,
    favorites: Vec<Media>,
    history: Vec<History>,
    aliases: Vec<Alias>,
    feedback: BTreeMap<String, bool>,
    settings: Settings,
    #[serde(default)]
    training_resets: Vec<TrainingReset>,
}
#[derive(Serialize)]
pub struct Preview {
    backup_id: String,
    counts: BTreeMap<String, usize>,
    missing_paths: Vec<String>,
    playlist_collisions: Vec<String>,
    settings: Settings,
    already_imported: Vec<String>,
    fingerprint: String,
    categories: Vec<String>,
}
#[derive(Serialize)]
pub struct PendingSettings {
    backup_id: String,
    settings: Settings,
}

pub fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    crate::recommendations::init_schema(conn)?;
    conn.execute_batch("CREATE TABLE IF NOT EXISTS local_backup_imports(backup_id TEXT NOT NULL,category TEXT NOT NULL,PRIMARY KEY(backup_id,category));
        CREATE TABLE IF NOT EXISTS local_backup_settings(backup_id TEXT PRIMARY KEY,settings_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS local_backup_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);")
}
fn selected(categories: &[String]) -> Result<()> {
    if categories.is_empty()
        || categories.len() > 5
        || categories.iter().any(|c| !CATEGORIES.contains(&c.as_str()))
    {
        return Err("Choose valid backup categories".into());
    }
    let mut unique = categories.to_vec();
    unique.sort();
    unique.dedup();
    if unique.len() != categories.len() {
        return Err("Duplicate backup category".into());
    }
    Ok(())
}
fn settings_valid(settings: &Settings) -> Result<()> {
    if settings.len() > 128 {
        return Err("Too many preferences".into());
    }
    for (key, value) in settings {
        if key.starts_with("aideo_device_profile_") {
            if !text(key,2048) || !text(value,65536) { return Err("Invalid output profile size".into()); }
            device_profile_valid(value)?;
            continue;
        }
        let allowed: &[&str] = match key.as_str() {
            "aideo-color-scheme" => &["dark", "light", "system"],
            "aideo-album-art-fit" => &["cover", "contain"],
            "aideo_repeat" => &["none", "one", "all"],
            "aideo_autoplay_discovery_level" => &["familiarity", "balanced", "discovery"],
            "aideo_recommendation_engine" => &["youtube", "tidal", "our"],
            "aideo-app-mode" => &["local", "hybrid"],
            "aideo-discovery-layout" => &["shelves", "unified"],
            "aideo-discovery-view-mode" => &["grid", "list"],
            "aideo-playerbar-design" => &["classic", "floating", "waveform", "minimal", "vinyl"],
            "aideo-page-design" => &[
                "classic",
                "editorial",
                "command",
                "stage",
                "spotify",
                "apple",
            ],
            "aideo-library-design" => &[
                "classic",
                "studio",
                "editorial",
                "crate",
                "ambient",
                "brutalist",
            ],
            "aideo-album-view-mode" => &["classic", "compact", "editorial"],
            "aideo-theater-design" => &["stage", "zen", "studio", "vinyl", "poster", "scope"],
            "aideo-theater-hud-style" => &["capsule", "master", "minimal", "analog"],
            "aideo-canvas-mode" => &["off", "artwork", "backdrop", "both"],
            "aideo_visualizer_mode" => &["bars", "mirror", "wave", "circle", "dots", "baseline"],
            "aideo_visualizer_decay" => &["snappy", "balanced", "silky"],
            "aideo_crossfade_enabled" => &["true", "false"],
            "aideo_volume" | "aideo_crossfade_duration" => {
                let n: f64 = value.parse().map_err(|_| "Invalid playback preference")?;
                let ceiling = if key == "aideo_volume" { 1.0 } else { 30.0 };
                if !n.is_finite() || !(0.0..=ceiling).contains(&n) {
                    return Err("Invalid playback preference".into());
                }
                continue;
            }
            "aideo-sidebar-lastfm"
            | "aideo-sidebar-listenbrainz"
            | "aideo-sidebar-collapsed"
            | "aideo-show-smart-mix"
            | "aideo-os-notifications-enabled"
            | "aideo-os-notify-bg-only"
            | "aideo-playerbar-transparent"
            | "aideo-canvas-enabled"
            | "aideo-canvas-allow-online"
            | "aideo_visualizer_expanded" => &["true", "false"],
            "aideo-keyboard-shortcuts" | "aideo-global-hotkeys" => {
                let keys: BTreeMap<String, Option<String>> =
                    serde_json::from_str(value).map_err(|_| "Invalid shortcuts")?;
                if keys.iter().any(|(k, v)| {
                    ![
                        "playPause",
                        "next",
                        "prev",
                        "volumeUp",
                        "volumeDown",
                        "mute",
                        "dspBypass",
                        "fullscreenToggle",
                    ]
                    .contains(&k.as_str())
                        || v.as_ref().is_some_and(|s| !text(s, 100))
                }) {
                    return Err("Invalid shortcuts".into());
                }
                continue;
            }
            "aideo_autoplay" | "aideo-notifications-enabled" | "aideo-liquid-bg" => {
                &["true", "false"]
            }
            "aideo-loved-albums" => {
                let albums: Vec<String> =
                    serde_json::from_str(value).map_err(|_| "Invalid album bookmarks")?;
                if albums.len() > 10000 || albums.iter().any(|s| !text(s, 1024)) {
                    return Err("Invalid album bookmarks".into());
                }
                continue;
            }
            _ => return Err(format!("Unsupported backup preference: {key}")),
        };
        if !allowed.contains(&value.as_str()) {
            return Err(format!("Invalid preference: {key}"));
        }
    }
    Ok(())
}
fn device_profile_valid(raw: &str) -> Result<()> {
    let profile: serde_json::Value = serde_json::from_str(raw).map_err(err)?;
    let object = profile.as_object().ok_or("Invalid output device profile")?;
    if object.keys().any(|k| !["version","volume","dsp","autoEq","exclusive","bitPerfect"].contains(&k.as_str())) || profile["version"]!=1 || profile["volume"].as_f64().is_none_or(|n| !(0.0..=1.0).contains(&n)) || !profile["exclusive"].is_boolean() || !profile["bitPerfect"].is_boolean() { return Err("Invalid output device profile".into()); }
    let defaults = serde_json::to_value(crate::player::DSPState::default()).map_err(err)?;
    let dsp_object = profile["dsp"].as_object().ok_or("Invalid device DSP")?;
    if dsp_object.keys().any(|k| defaults.get(k).is_none() && k!="lookahead_prebuffer_enabled") || dsp_object.get("lookahead_prebuffer_enabled").is_some_and(|v| !v.is_boolean()) { return Err("Unsupported device DSP field".into()); }
    let dsp: crate::player::DSPState = serde_json::from_value(profile["dsp"].clone()).map_err(err)?;
    let mut sanitized = dsp.clone(); sanitized.sanitize();
    let ir_path = &dsp.convolution_ir_path;
    if !text(ir_path, 4096) || !ir_path.is_empty() && (!Path::new(ir_path).is_absolute() || ir_path.contains("://")) { return Err("Invalid impulse response path".into()); }
    if sanitized != dsp || dsp.eq_graphic_gains.len()!=10 || dsp.eq_parametric_bands.len()>32 || dsp.upsample_rate>768000
        || !["low","normal","high","custom"].contains(&dsp.audio_profile.as_str()) || !["linear","cubic"].contains(&dsp.resampler_interpolation.as_str())
        || ![64,128,256].contains(&dsp.resampler_sinc_len) || ![128,256,512].contains(&dsp.resampler_oversampling)
        || !["standard","studio","hires","native"].contains(&dsp.ffmpeg_transcode_quality.as_str()) || !["event","polling"].contains(&dsp.exclusive_mode_timing.as_str())
        || !["linear","minimum","intermediate"].contains(&dsp.resampler_phase_mode.as_str()) || !["yt-dlp","reqwest"].contains(&dsp.stream_engine.as_str())
        || dsp.eq_parametric_bands.iter().any(|b| !["peaking","lowshelf","highshelf","lowpass","highpass","notch","bandpass"].contains(&b.band_type.as_str())) { return Err("Invalid device DSP values".into()); }
    for band in profile["dsp"]["eq_parametric_bands"].as_array().ok_or("Invalid EQ bands")? {
        if band.as_object().is_none_or(|b| b.keys().any(|k| !["freq","gain","q","band_type"].contains(&k.as_str()))) { return Err("Unsupported EQ field".into()); }
    }
    if !profile["autoEq"].is_null() {
        let eq=profile["autoEq"].as_object().ok_or("Invalid AutoEQ identity")?;
        if eq.keys().any(|k| !["url","name","fullSource"].contains(&k.as_str())) || ["url","name","fullSource"].iter().any(|k| eq.get(*k).and_then(|v|v.as_str()).is_none_or(|s| !text(s,4096))) { return Err("Invalid AutoEQ identity".into()); }
        let raw_url=profile["autoEq"]["url"].as_str().ok_or("Invalid AutoEQ URL")?;
        let url=url::Url::parse(raw_url).map_err(err)?;
        if !raw_url.starts_with("https://raw.githubusercontent.com/jaakkopasanen/AutoEq/") || url.query().is_some() || url.fragment().is_some() || !url.username().is_empty() || url.password().is_some() { return Err("Unsafe AutoEQ URL".into()); }
    }
    Ok(())
}
fn text(s: &str, limit: usize) -> bool {
    s.len() <= limit && !s.chars().any(char::is_control)
}
fn reference(path: &str) -> bool {
    if !text(path, 32768) || path.is_empty() {
        return false;
    }
    if let Some(local) = path.strip_prefix("local:") {
        return Path::new(local).is_absolute() && !local.contains("://");
    }
    for provider in ["tidal", "qobuz", "youtube"] {
        if let Some(id) = path.strip_prefix(&format!("{provider}:")) {
            return if provider == "youtube" {
                id.len() == 11
                    && id
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
            } else {
                !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit())
            };
        }
    }
    Path::new(path).is_absolute() && !path.contains("://")
}
fn media_valid(m: &Media) -> bool {
    !m.path.starts_with("local:")
        && reference(&m.path)
        && [&m.title, &m.artist, &m.album, &m.format]
            .iter()
            .all(|v| v.as_ref().is_none_or(|s| text(s, 4096)))
        && m.duration
            .is_none_or(|n| n.is_finite() && (0.0..=86400.0).contains(&n))
}
fn safe_source(mut context: db::RecordingSources) -> Result<db::RecordingSources> {
    for source in &mut context.sources {
        source.catalog_quality = None;
        if let Some(meta) = &mut source.metadata {
            meta.cover_url = None;
            meta.duration_raw = None;
        }
    }
    if let db::SourceSelection::Explicit { source } = &mut context.selection {
        source.catalog_quality = None;
        if let Some(meta) = &mut source.metadata {
            meta.cover_url = None;
            meta.duration_raw = None;
        }
    }
    context.to_json().map_err(err)?;
    Ok(context)
}
fn validate(b: &Envelope) -> Result<()> {
    if b.training_resets.len() > 100000 || b.training_resets.iter().any(|r| !media_valid(&r.media) || r.timestamp < 0 || !r.listened_seconds.is_finite() || !(0.0..=86400.0).contains(&r.listened_seconds) || r.recording_id.as_ref().is_some_and(|id| !text(id,512))) { return Err("Invalid learned taste reset evidence".into()); }
    if b.schema_version != 1 {
        return Err("Unsupported backup version; update Aideo to read newer backups".into());
    }
    selected(&b.categories)?;
    if b.backup_id.is_empty() || !text(&b.backup_id, 128) || !text(&b.app_version, 64) {
        return Err("Invalid backup identity".into());
    }
    if b.playlists.len() > 10000
        || b.favorites.len() > 100000
        || b.history.len() > 100000
        || b.aliases.len() > 100000
        || b.feedback.len() > 100000
        || b.playlists.iter().map(|p| p.entries.len()).sum::<usize>() > 100000
    {
        return Err("Backup category is too large".into());
    }
    settings_valid(&b.settings)?;
    for p in &b.playlists {
        if p.name.trim().is_empty() || !text(&p.name, 512) {
            return Err("Invalid playlist name".into());
        }
        for e in &p.entries {
            if !media_valid(&e.media) {
                return Err("Invalid playlist media reference".into());
            }
            if let Some(s) = &e.source_context {
                if serde_json::to_string(s).map_err(err)?
                    != serde_json::to_string(&safe_source(s.clone())?).map_err(err)?
                {
                    return Err("Unsafe provider metadata".into());
                }
                for src in &s.sources {
                    if let Some(meta) = &src.metadata {
                        if [&meta.title, &meta.artist, &meta.album]
                            .iter()
                            .any(|v| v.as_ref().is_some_and(|s| !text(s, 4096)))
                            || meta
                                .duration
                                .is_some_and(|n| !n.is_finite() || !(0.0..=86400.0).contains(&n))
                        {
                            return Err("Invalid provider metadata".into());
                        }
                    }
                }
                if !s.sources.iter().any(|src| {
                    src.id == e.media.path
                        || format!(
                            "{}:{}",
                            match src.provider {
                                db::SourceProvider::Local => "local",
                                db::SourceProvider::Tidal => "tidal",
                                db::SourceProvider::Qobuz => "qobuz",
                                db::SourceProvider::Youtube => "youtube",
                            },
                            src.id
                        ) == e.media.path
                }) {
                    return Err("Playlist source does not match media reference".into());
                }
            }
        }
    }
    if b.favorites.iter().any(|m| !media_valid(m))
        || b.history.iter().any(|h| {
            !media_valid(&h.media)
                || h.timestamp < 0
                || !h.listened_seconds.is_finite()
                || !(0.0..=86400.0).contains(&h.listened_seconds)
                || !["qualified", "skipped"].contains(&h.signal_quality.as_str())
                || h.source_key.as_ref().is_some_and(|s| !reference(s))
                || h.recording_id.as_ref().is_some_and(|s| !text(s, 512))
                || h.origin.as_ref().is_some_and(|s| !text(s, 512))
                || h.end_reason.as_ref().is_some_and(|s| !text(s, 64))
        })
    {
        return Err("Invalid favorite or listening history".into());
    }
    if b.aliases.iter().any(|a| {
        !reference(&a.source_key)
            || !text(&a.recording_id, 512)
            || a.recording_id.is_empty()
            || a.duration
                .is_some_and(|n| !n.is_finite() || !(0.0..=86400.0).contains(&n))
            || [&a.title, &a.artist]
                .iter()
                .any(|v| v.as_ref().is_some_and(|s| !text(s, 4096)))
    }) || b.feedback.keys().any(|s| !text(s, 512) || s.is_empty())
    {
        return Err("Invalid recommendation evidence".into());
    }
    let mut sources = std::collections::HashSet::new();
    if b.aliases.iter().any(|a| !sources.insert(&a.source_key)) {
        return Err("Duplicate recommendation source".into());
    }
    if b.aliases.iter().any(|a| {
        [&a.isrc, &a.version]
            .iter()
            .any(|v| v.as_ref().is_some_and(|s| !text(s, 512)))
    }) || b.history.iter().any(|h| {
        !h.duration_played.is_finite()
            || !(0.0..=86400.0).contains(&h.duration_played)
            || h.completion_rate
                .is_some_and(|n| !n.is_finite() || !(0.0..=1.0).contains(&n))
            || [&h.genre, &h.playback_source]
                .iter()
                .any(|v| v.as_ref().is_some_and(|s| !text(s, 512)))
            || h.sample_rate.is_some_and(|n| n > 1536000)
            || h.bit_depth.is_some_and(|n| n > 64)
    }) {
        return Err("Invalid history or recording metadata".into());
    }
    Ok(())
}
fn canonical_media(mut m: Media) -> Option<Media> {
    if m.path.starts_with("local:") {
        m.path = m.path[6..].into();
    }
    if !reference(&m.path) {
        let track = db::Track {
            id: 0,
            path: m.path.clone(),
            title: None,
            artist: None,
            album: None,
            duration: None,
            format: m.format.clone(),
            lyric_offset: 0,
            loved: None,
            disliked: None,
            cover_url: None,
            path_hash: None,
            bpm: None,
            energy: None,
            bass_ratio: None,
            treble_ratio: None,
            replaygain_gain: None,
            track_number: None,
            disc_number: None,
            genre: None,
        };
        m.path = crate::recommendations::source_key(&track);
        if m.path.starts_with("local:") {
            m.path = m.path[6..].into();
        }
    }
    media_valid(&m).then_some(m)
}
fn row_media(row: &rusqlite::Row<'_>) -> rusqlite::Result<Media> {
    Ok(Media {
        path: row.get(0)?,
        title: row.get(1)?,
        artist: row.get(2)?,
        album: row.get(3)?,
        duration: row.get(4)?,
        format: row.get(5)?,
    })
}
fn nonce() -> String {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    format!(
        "{}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    )
}
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn snapshot(
    conn: &Connection,
    categories: Vec<String>,
    mut settings: Settings,
) -> Result<Envelope> {
    selected(&categories)?;
    settings_valid(&settings)?;
    if !categories.iter().any(|c| c == "settings") {
        settings.retain(|k, _| k == "aideo-loved-albums");
    }
    if !categories.iter().any(|c| c == "favorites") {
        settings.remove("aideo-loved-albums");
    }
    let mut b = Envelope {
        schema_version: 1,
        app_version: env!("CARGO_PKG_VERSION").into(),
        created_at: now(),
        backup_id: format!("{}-{}", now(), nonce()),
        categories: categories.clone(),
        playlists: vec![],
        favorites: vec![],
        history: vec![],
        aliases: vec![],
        feedback: BTreeMap::new(),
        settings,
        training_resets: vec![],
    };
    for category in &categories {
        match category.as_str() {
            "playlists" => {
                let mut stmt = conn
                    .prepare("SELECT id,name FROM playlists ORDER BY id")
                    .map_err(err)?;
                let rows = stmt
                    .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
                    .map_err(err)?;
                for row in rows {
                    let (id, name) = row.map_err(err)?;
                    let mut entries = conn.prepare("SELECT pt.track_path,t.title,t.artist,t.album,t.duration,t.format,pt.source_context,pt.metadata_json FROM playlist_tracks pt LEFT JOIN tracks t ON t.path=pt.track_path WHERE playlist_id=? ORDER BY position,entry_id").map_err(err)?;
                    let rows = entries
                        .query_map([id], |r| {
                            Ok((
                                row_media(r)?,
                                r.get::<_, Option<String>>(6)?,
                                r.get::<_, Option<String>>(7)?,
                            ))
                        })
                        .map_err(err)?;
                    let mut playlist = Playlist {
                        name,
                        entries: vec![],
                    };
                    for row in rows {
                        let (mut m, ctx, metadata) = row.map_err(err)?;
                        if let Some(meta) = metadata {
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&meta) {
                                m.title = v["title"].as_str().map(str::to_owned).or(m.title);
                                m.artist = v["artist"].as_str().map(str::to_owned).or(m.artist);
                                m.album = v["album"].as_str().map(str::to_owned).or(m.album);
                                m.duration = v["duration"].as_f64().or(m.duration);
                                m.format = v["format"].as_str().map(str::to_owned).or(m.format);
                            }
                        }
                        let context = ctx
                            .map(|s| {
                                serde_json::from_str::<db::RecordingSources>(&s)
                                    .map_err(err)
                                    .and_then(safe_source)
                            })
                            .transpose()?;
                        let m = canonical_media(m).ok_or("Unsafe playlist reference; remove unsupported URL entries before export")?;
                        playlist.entries.push(Entry {
                            media: m,
                            source_context: context,
                        });
                    }
                    b.playlists.push(playlist);
                }
            }
            "favorites" => {
                let mut stmt = conn.prepare("SELECT path,title,artist,album,duration,format FROM tracks WHERE loved=1 ORDER BY id").map_err(err)?;
                for row in stmt.query_map([], row_media).map_err(err)? {
                    b.favorites.push(
                        canonical_media(row.map_err(err)?).ok_or("Unsafe favorite reference")?,
                    );
                }
            }
            "history" => {
                let mut stmt = conn.prepare("SELECT track_path,title,artist,album,duration,format,timestamp,listened_seconds,signal_quality,end_reason,recording_id,source_key,origin,COALESCE(duration_played,0),COALESCE(skipped,0),genre,playback_source,sample_rate,bit_depth,COALESCE(bit_perfect,0),completion_rate FROM playback_history WHERE signal_quality='qualified' OR end_reason='skipped' ORDER BY timestamp,id").map_err(err)?;
                let rows = stmt
                    .query_map([], |r| {
                        Ok(History {
                            media: row_media(r)?,
                            timestamp: r.get(6)?,
                            listened_seconds: r.get(7)?,
                            signal_quality: r.get(8)?,
                            end_reason: r.get(9)?,
                            recording_id: r.get(10)?,
                            source_key: r.get(11)?,
                            origin: r.get(12)?,
                            duration_played: r.get(13)?,
                            skipped: r.get(14)?,
                            genre: r.get(15)?,
                            playback_source: r.get(16)?,
                            sample_rate: r.get(17)?,
                            bit_depth: r.get(18)?,
                            bit_perfect: r.get(19)?,
                            completion_rate: r.get(20)?,
                        })
                    })
                    .map_err(err)?;
                for row in rows {
                    let mut h = row.map_err(err)?;
                    h.media = canonical_media(h.media).ok_or("Unsafe history reference")?;
                    if h.signal_quality != "qualified" {
                        h.signal_quality = "skipped".into();
                    }
                    if let Some(s) = &h.source_key {
                        h.source_key = canonical_media(Media {
                            path: s.clone(),
                            title: None,
                            artist: None,
                            album: None,
                            duration: None,
                            format: h.media.format.clone(),
                        })
                        .map(|m| m.path);
                    }
                    b.history.push(h);
                }
            }
            "recommendations" => {
                let mut reset_stmt = conn.prepare("SELECT h.track_path,h.title,h.artist,h.album,h.duration,h.format,h.timestamp,h.listened_seconds,h.recording_id FROM playback_history h JOIN recommendation_training_ignored i ON i.history_id=h.id ORDER BY h.id").map_err(err)?;
                for row in reset_stmt.query_map([], |r| Ok(TrainingReset { media: row_media(r)?, timestamp:r.get(6)?, listened_seconds:r.get(7)?, recording_id:r.get(8)? })).map_err(err)? {
                    let mut reset = row.map_err(err)?;
                    reset.media = canonical_media(reset.media).ok_or("Unsafe reset evidence reference")?;
                    b.training_resets.push(reset);
                }
                let mut stmt = conn.prepare("SELECT source_key,recording_id,title,artist,duration,isrc,version,explicit FROM recommendation_aliases ORDER BY source_key").map_err(err)?;
                for row in stmt
                    .query_map([], |r| {
                        Ok(Alias {
                            source_key: r.get(0)?,
                            recording_id: r.get(1)?,
                            title: r.get(2)?,
                            artist: r.get(3)?,
                            duration: r.get(4)?,
                            isrc: r.get(5)?,
                            version: r.get(6)?,
                            explicit: r.get(7)?,
                        })
                    })
                    .map_err(err)?
                {
                    let a = row.map_err(err)?;
                    if reference(&a.source_key) {
                        b.aliases.push(a);
                    }
                }
                let mut stmt = conn.prepare("SELECT recording_id,interested FROM recommendation_interest ORDER BY recording_id").map_err(err)?;
                for row in stmt
                    .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, bool>(1)?)))
                    .map_err(err)?
                {
                    let (id, v) = row.map_err(err)?;
                    b.feedback.insert(id, v);
                }
            }
            _ => {}
        }
    }
    validate(&b)?;
    Ok(b)
}
fn write_atomic(path: &Path, b: &Envelope) -> Result<()> {
    validate(b)?;
    if path.exists() && read_backup(path).is_err() { return Err("Choose a new filename or an existing Aideo backup; other files cannot be overwritten".into()); }
    let bytes = serde_json::to_vec_pretty(b).map_err(err)?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("Backup exceeds 32 MB".into());
    }
    let name = path
        .file_name()
        .ok_or("Choose a backup filename")?
        .to_string_lossy();
    let temp = path.with_file_name(format!(".{name}.{}.tmp", nonce()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(err)?;
        file.write_all(&bytes).map_err(err)?;
        file.sync_all().map_err(err)?;
        drop(file);
        crate::downloads::commit_file(&temp, path, true)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}
fn read_backup(path: &Path) -> Result<Envelope> {
    let file = fs::File::open(path).map_err(err)?;
    if file.metadata().map_err(err)?.len() > MAX_BYTES {
        return Err("Backup exceeds 32 MB".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(err)?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("Backup exceeds 32 MB".into());
    }
    let b: Envelope =
        serde_json::from_slice(&bytes).map_err(|e| format!("Invalid backup JSON: {e}"))?;
    validate(&b)?;
    Ok(b)
}
fn fingerprint(b: &Envelope) -> Result<String> {
    use std::hash::{Hash, Hasher};
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    serde_json::to_vec(b).map_err(err)?.hash(&mut hash);
    Ok(format!("{:016x}", hash.finish()))
}
fn imported(conn: &Connection, id: &str, category: &str) -> Result<bool> {
    Ok(conn
        .query_row(
            "SELECT 1 FROM local_backup_imports WHERE backup_id=? AND category=?",
            params![id, category],
            |_| Ok(()),
        )
        .optional()
        .map_err(err)?
        .is_some())
}
fn preview(conn: &Connection, b: &Envelope, categories: &[String]) -> Result<Preview> {
    selected(categories)?;
    if categories.iter().any(|c| !b.categories.contains(c)) {
        return Err("Selected category is absent from this backup".into());
    }
    if categories.iter().any(|c| c=="recommendations" || c=="history") {
        for alias in &b.aliases {
            let current:Option<String> = conn.query_row("SELECT recording_id FROM recommendation_aliases WHERE source_key=?",[&alias.source_key],|r|r.get(0)).optional().map_err(err)?;
            if current.is_some_and(|id| id!=alias.recording_id) { return Err(format!("Recording identity conflict for {}. Restore this backup into a separate library profile before merging recommendation evidence.",alias.source_key)); }
        }
    }
    let mut collisions = vec![];
    for p in &b.playlists {
        if conn
            .query_row(
                "SELECT 1 FROM playlists WHERE name=?",
                [&p.name],
                |_| Ok(()),
            )
            .optional()
            .map_err(err)?
            .is_some()
        {
            collisions.push(p.name.clone());
        }
    }
    let mut missing = std::collections::BTreeSet::new();
    for m in b
        .favorites
        .iter()
        .chain(
            b.playlists
                .iter()
                .flat_map(|p| p.entries.iter().map(|e| &e.media)),
        )
        .chain(b.history.iter().map(|h| &h.media))
    {
        if Path::new(&m.path).is_absolute() && !Path::new(&m.path).exists() {
            missing.insert(m.path.clone());
        }
    }
    for source in b
        .playlists
        .iter()
        .flat_map(|p| &p.entries)
        .filter_map(|e| e.source_context.as_ref())
        .flat_map(|s| &s.sources)
    {
        if source.provider == db::SourceProvider::Local && !Path::new(&source.id).exists() {
            missing.insert(source.id.clone());
        }
    }
    let mut done = vec![];
    for c in categories {
        if imported(conn, &b.backup_id, c)? {
            done.push(c.clone());
        }
    }
    let counts = [
        ("playlists", b.playlists.len()),
        ("favorites", b.favorites.len()),
        ("history", b.history.len()),
        ("recommendations", b.aliases.len() + b.feedback.len()),
        ("settings", b.settings.len()),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_owned(), v))
    .collect();
    Ok(Preview {
        backup_id: b.backup_id.clone(),
        counts,
        missing_paths: missing.into_iter().collect(),
        playlist_collisions: collisions,
        settings: b.settings.clone(),
        already_imported: done,
        fingerprint: fingerprint(b)?,
        categories: b.categories.clone(),
    })
}
fn insert_media(conn: &Connection, m: &Media, loved: bool) -> Result<()> {
    conn.execute("INSERT INTO tracks(path,title,artist,album,duration,format,loved) VALUES(?,?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET loved=MAX(COALESCE(tracks.loved,0),excluded.loved)",params![m.path,m.title,m.artist,m.album,m.duration,m.format,loved]).map_err(err)?;
    Ok(())
}
fn apply(conn: &mut Connection, b: &Envelope, categories: &[String]) -> Result<()> {
    validate(b)?;
    preview(conn, b, categories)?;
    let tx = conn.transaction().map_err(err)?;
    let mut staged = Settings::new();
    for category in categories {
        if imported(&tx, &b.backup_id, category)? {
            continue;
        }
        match category.as_str() {
            "playlists" => {
                for p in &b.playlists {
                    let mut name = p.name.clone();
                    let mut suffix = 1;
                    while tx
                        .query_row("SELECT 1 FROM playlists WHERE name=?", [&name], |_| Ok(()))
                        .optional()
                        .map_err(err)?
                        .is_some()
                    {
                        name = format!("{} (restored {})", p.name, suffix);
                        suffix += 1;
                    }
                    tx.execute("INSERT INTO playlists(name) VALUES(?)", [name])
                        .map_err(err)?;
                    let id = tx.last_insert_rowid();
                    for (position, e) in p.entries.iter().enumerate() {
                        insert_media(&tx, &e.media, false)?;
                        let context = e
                            .source_context
                            .as_ref()
                            .map(serde_json::to_string)
                            .transpose()
                            .map_err(err)?;
                        let metadata = serde_json::to_string(&e.media).map_err(err)?;
                        tx.execute("INSERT INTO playlist_tracks(playlist_id,track_path,position,source_context,metadata_json) VALUES(?,?,?,?,?)",params![id,e.media.path,position as i64,context,metadata]).map_err(err)?;
                    }
                }
            }
            "favorites" => {
                for m in &b.favorites {
                    insert_media(&tx, m, true)?;
                }
                if let Some(v) = b.settings.get("aideo-loved-albums") {
                    staged.insert("aideo-loved-albums".into(), v.clone());
                }
            }
            "history" => {
                for h in &b.history {
                    tx.execute("INSERT INTO playback_history(track_path,title,artist,album,duration,format,timestamp,duration_played,listened_seconds,signal_quality,end_reason,recording_id,source_key,origin,synced,skipped,genre,playback_source,sample_rate,bit_depth,bit_perfect,completion_rate) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?)",params![h.media.path,h.media.title,h.media.artist,h.media.album,h.media.duration,h.media.format,h.timestamp,h.duration_played,h.listened_seconds,h.signal_quality,h.end_reason,h.recording_id,h.source_key,h.origin,h.skipped,h.genre,h.playback_source,h.sample_rate,h.bit_depth,h.bit_perfect,h.completion_rate]).map_err(err)?;
                }
            }
            "recommendations" => {
                for a in &b.aliases {
                    tx.execute("INSERT OR IGNORE INTO recommendation_aliases(source_key,recording_id,title,artist,duration,isrc,version,explicit) VALUES(?,?,?,?,?,?,?,?)",params![a.source_key,a.recording_id,a.title,a.artist,a.duration,a.isrc,a.version,a.explicit]).map_err(err)?;
                }
                for (id, v) in &b.feedback {
                    tx.execute("INSERT INTO recommendation_interest(recording_id,interested) VALUES(?,?) ON CONFLICT(recording_id) DO UPDATE SET interested=excluded.interested",params![id,v]).map_err(err)?;
                }
            }
            "settings" => staged.extend(
                b.settings
                    .iter()
                    .filter(|(k, _)| k.as_str() != "aideo-loved-albums")
                    .map(|(k, v)| (k.clone(), v.clone())),
            ),
            _ => unreachable!(),
        }
        tx.execute(
            "INSERT INTO local_backup_imports(backup_id,category) VALUES(?,?)",
            params![b.backup_id, category],
        )
        .map_err(err)?;
    }
    if imported(&tx, &b.backup_id, "recommendations")? {
        let resets: std::collections::HashSet<_> = b.training_resets.iter().map(|r| (r.media.path.clone(),r.timestamp,r.listened_seconds.to_bits(),r.recording_id.clone())).collect();
        let mut history = tx.prepare("SELECT id,track_path,title,artist,album,duration,format,timestamp,listened_seconds,recording_id FROM playback_history").map_err(err)?;
        let candidates = history.query_map([], |r| Ok((r.get::<_,i64>(0)?, Media {path:r.get(1)?,title:r.get(2)?,artist:r.get(3)?,album:r.get(4)?,duration:r.get(5)?,format:r.get(6)?}, r.get::<_,i64>(7)?, r.get::<_,f64>(8)?, r.get::<_,Option<String>>(9)?))).map_err(err)?.collect::<rusqlite::Result<Vec<_>>>().map_err(err)?;
        drop(history);
        for (id,media,timestamp,listened,recording) in candidates {
            if let Some(media) = canonical_media(media) {
                if resets.contains(&(media.path,timestamp,listened.to_bits(),recording)) {
                    tx.execute("INSERT OR IGNORE INTO recommendation_training_ignored(history_id) VALUES(?)",[id]).map_err(err)?;
                }
            }
        }
    }
    if !staged.is_empty() {
        let existing: Option<String> = tx
            .query_row(
                "SELECT settings_json FROM local_backup_settings WHERE backup_id=?",
                [&b.backup_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(err)?;
        if let Some(json) = existing {
            let mut merged: Settings = serde_json::from_str(&json).map_err(err)?;
            merged.extend(staged);
            staged = merged;
        }
        tx.execute("INSERT INTO local_backup_settings(backup_id,settings_json) VALUES(?,?) ON CONFLICT(backup_id) DO UPDATE SET settings_json=excluded.settings_json",params![b.backup_id,serde_json::to_string(&staged).map_err(err)?]).map_err(err)?;
    }
    tx.execute("INSERT INTO local_backup_state(key,value) VALUES('cloud_reconciliation_pending','true') ON CONFLICT(key) DO UPDATE SET value='true'",[]).map_err(err)?;
    tx.commit().map_err(err)
}

#[tauri::command]
pub async fn local_backup_export(
    state: tauri::State<'_, AppState>,
    path: String,
    categories: Vec<String>,
    settings: Settings,
) -> Result<()> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = state.db.lock().map_err(err)?;
        init_schema(&conn).map_err(err)?;
        let tx = conn.transaction().map_err(err)?;
        let b = snapshot(&tx, categories, settings)?;
        crate::library_health::validate_rollback_path(&tx,&path)?;
        tx.commit().map_err(err)?;
        write_atomic(Path::new(&path), &b)
    })
    .await
    .map_err(err)?
}
pub(crate) fn write_rollback_snapshot(conn: &Connection, path: &str, settings: BTreeMap<String, String>) -> Result<()> {
    init_schema(conn).map_err(err)?;
    crate::library_health::validate_rollback_path(conn,path)?;
    let backup = snapshot(conn, CATEGORIES.iter().map(|s| s.to_string()).collect(), settings)?;
    write_atomic(Path::new(path), &backup)
}
#[tauri::command]
pub async fn local_backup_preview(
    state: tauri::State<'_, AppState>,
    path: String,
    categories: Vec<String>,
) -> Result<Preview> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let b = read_backup(Path::new(&path))?;
        let conn = state.db.lock().map_err(err)?;
        init_schema(&conn).map_err(err)?;
        let chosen = if categories.is_empty() {
            &b.categories
        } else {
            &categories
        };
        preview(&conn, &b, chosen)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn local_backup_restore(
    state: tauri::State<'_, AppState>,
    path: String,
    categories: Vec<String>,
    rollback_path: String,
    fingerprint_expected: String,
    settings: Settings,
) -> Result<()> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _maintenance = crate::library_health::begin_maintenance()?;
        let player = state.player.lock().map_err(err)?;
        if player.status.load(std::sync::atomic::Ordering::Relaxed) != 0 { return Err("Stop playback before restoring".into()); }
        if Path::new(&path) == Path::new(&rollback_path)
            || fs::canonicalize(&path)
                .ok()
                .zip(fs::canonicalize(&rollback_path).ok())
                .is_some_and(|(a, b)| a == b)
        {
            return Err("Rollback and import must use different files".into());
        }
        let b = read_backup(Path::new(&path))?;
        if fingerprint(&b)? != fingerprint_expected {
            return Err("Backup changed after preview; preview it again".into());
        }
        let mut conn = state.db.lock().map_err(err)?;
        init_schema(&conn).map_err(err)?;
        preview(&conn, &b, &categories)?;
        crate::library_health::validate_rollback_path(&conn,&rollback_path)?;
        let tx = conn.transaction().map_err(err)?;
        let rollback = snapshot(
            &tx,
            CATEGORIES.iter().map(|s| s.to_string()).collect(),
            settings,
        )?;
        tx.commit().map_err(err)?;
        write_atomic(Path::new(&rollback_path), &rollback)?;
        apply(&mut conn, &b, &categories)
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub fn local_backup_pending_settings(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<PendingSettings>> {
    let conn = state.db.lock().map_err(err)?;
    init_schema(&conn).map_err(err)?;
    let mut stmt = conn
        .prepare("SELECT backup_id,settings_json FROM local_backup_settings ORDER BY rowid")
        .map_err(err)?;
    let mut items = vec![];
    for row in stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(err)?
    {
        let (id, json) = row.map_err(err)?;
        items.push(PendingSettings {
            backup_id: id,
            settings: serde_json::from_str(&json).map_err(err)?,
        });
    }
    Ok(items)
}
#[tauri::command]
pub fn local_backup_ack_settings(
    state: tauri::State<'_, AppState>,
    backup_id: String,
) -> Result<()> {
    let conn = state.db.lock().map_err(err)?;
    conn.execute(
        "DELETE FROM local_backup_settings WHERE backup_id=?",
        [backup_id],
    )
    .map_err(err)?;
    Ok(())
}

#[tauri::command]
pub fn local_backup_reconciliation_pending(state: tauri::State<'_, AppState>) -> Result<bool> {
    let conn = state.db.lock().map_err(err)?;
    init_schema(&conn).map_err(err)?;
    Ok(conn
        .query_row(
            "SELECT value FROM local_backup_state WHERE key='cloud_reconciliation_pending'",
            [],
            |r| r.get::<_, String>(0),
        )
        .optional()
        .map_err(err)?
        .as_deref()
        == Some("true"))
}
#[tauri::command]
pub fn local_backup_clear_reconciliation(state: tauri::State<'_, AppState>) -> Result<()> {
    let _activity = crate::library_health::begin_library_activity()?;
    let conn = state.db.lock().map_err(err)?;
    init_schema(&conn).map_err(err)?;
    conn.execute(
        "DELETE FROM local_backup_state WHERE key='cloud_reconciliation_pending'",
        [],
    )
    .map_err(err)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn database() -> Connection {
        let c = db::init_db(":memory:").unwrap();
        init_schema(&c).unwrap();
        c
    }
    #[test]
    fn taste_resets_follow_imported_history_ids_and_category_order() {
        let mut source = database();
        let b = fixture();
        apply(&mut source, &b, &b.categories).unwrap();
        source.execute("INSERT INTO recommendation_training_ignored SELECT id FROM playback_history", []).unwrap();
        let exported = snapshot(&source, CATEGORIES.iter().map(|s| s.to_string()).collect(), Settings::new()).unwrap();
        assert_eq!(exported.training_resets.len(), 1);
        let mut target = database();
        apply(&mut target, &exported, &["recommendations".into()]).unwrap();
        apply(&mut target, &exported, &["history".into()]).unwrap();
        assert_eq!(target.query_row("SELECT COUNT(*) FROM recommendation_training_ignored", [], |r| r.get::<_,i64>(0)).unwrap(), 1);
        apply(&mut target, &exported, &exported.categories).unwrap();
        assert_eq!(target.query_row("SELECT COUNT(*) FROM playback_history", [], |r| r.get::<_,i64>(0)).unwrap(), 1);
    }
    fn fixture() -> Envelope {
        let m = Media {
            path: "tidal:123".into(),
            title: Some("Song".into()),
            artist: Some("Artist".into()),
            album: None,
            duration: Some(180.0),
            format: Some("tidal".into()),
        };
        Envelope {
            schema_version: 1,
            app_version: "test".into(),
            created_at: 1,
            backup_id: "test-id".into(),
            categories: CATEGORIES.iter().map(|s| s.to_string()).collect(),
            playlists: vec![Playlist {
                name: "Test".into(),
                entries: vec![Entry {
                    media: m.clone(),
                    source_context: None,
                }],
            }],
            favorites: vec![m.clone()],
            history: vec![History {
                media: m,
                timestamp: 1,
                listened_seconds: 90.0,
                signal_quality: "qualified".into(),
                end_reason: Some("completed".into()),
                recording_id: Some("r1".into()),
                source_key: Some("tidal:123".into()),
                origin: Some("queue".into()),
                duration_played: 90.0,
                skipped: false,
                genre: None,
                playback_source: Some("queue".into()),
                sample_rate: Some(44100),
                bit_depth: Some(16),
                bit_perfect: true,
                completion_rate: Some(0.5),
            }],
            aliases: vec![Alias {
                source_key: "tidal:123".into(),
                recording_id: "r1".into(),
                title: Some("Song".into()),
                artist: Some("Artist".into()),
                duration: Some(180.0),
                isrc: Some("MY1234567890".into()),
                version: Some("studio".into()),
                explicit: Some(false),
            }],
            feedback: BTreeMap::from([("r1".into(), false)]),
            training_resets: vec![],
            settings: BTreeMap::from([
                ("aideo-color-scheme".into(), "dark".into()),
                ("aideo-loved-albums".into(), "[\"album\"]".into()),
            ]),
        }
    }
    #[test]
    fn roundtrip_is_idempotent_and_settings_survive_commit_without_replay() {
        let mut c = database();
        let b = fixture();
        apply(&mut c, &b, &b.categories).unwrap();
        apply(&mut c, &b, &b.categories).unwrap();
        assert_eq!(
            c.query_row("SELECT COUNT(*) FROM playlists", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            c.query_row("SELECT COUNT(*) FROM playback_history", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            c.query_row("SELECT loved FROM tracks WHERE path='tidal:123'", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        let saved = snapshot(&c, b.categories.clone(), b.settings.clone()).unwrap();
        assert_eq!(saved.playlists[0].entries[0].media.path, "tidal:123");
        assert_eq!(saved.aliases[0].recording_id, "r1");
        assert_eq!(saved.aliases[0].isrc.as_deref(), Some("MY1234567890"));
        assert!(saved.history[0].bit_perfect);
        let file = std::env::temp_dir().join(format!("aideo-backup-{}.json", nonce()));
        write_atomic(&file, &saved).unwrap();
        let loaded = read_backup(&file).unwrap();
        assert_eq!(loaded.playlists[0].entries[0].media.path, "tidal:123");
        fs::remove_file(file).unwrap();
        assert_eq!(
            c.query_row("SELECT COUNT(*) FROM local_backup_settings", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        let mut other = fixture();
        other.backup_id = "another".into();
        apply(&mut c, &other, &other.categories).unwrap();
        assert_eq!(
            c.query_row(
                "SELECT name FROM playlists ORDER BY id DESC LIMIT 1",
                [],
                |r| r.get::<_, String>(0)
            )
            .unwrap(),
            "Test (restored 1)"
        );
    }
    #[test]
    fn rollback_on_database_failure_leaves_no_provenance_or_partial_rows() {
        let mut c = database();
        c.execute_batch("CREATE TRIGGER fail_history BEFORE INSERT ON playback_history BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
        let b = fixture();
        assert!(apply(&mut c, &b, &b.categories).is_err());
        for table in [
            "tracks",
            "playlists",
            "local_backup_imports",
            "local_backup_settings",
        ] {
            assert_eq!(
                c.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
    }
    #[test]
    fn invalid_and_newer_files_and_failed_output_are_safe() {
        let mut b = fixture();
        b.schema_version = 2;
        assert!(validate(&b).unwrap_err().contains("Unsupported"));
        b.schema_version = 1;
        b.favorites[0].path = "https://user:SECRET@provider/file?token=SECRET".into();
        assert!(validate(&b).is_err());
        b = fixture();
        b.settings.insert("tidal_token".into(), "SECRET".into());
        assert!(validate(&b).is_err());
        let p = std::env::temp_dir().join(format!("aideo-backup-{}.json", nonce()));
        fs::write(&p, b"previous").unwrap();
        assert!(write_atomic(&p, &b).is_err());
        assert_eq!(fs::read(&p).unwrap(), b"previous");
        fs::remove_file(p).unwrap();
        let absent = std::env::temp_dir().join(nonce()).join("backup.json");
        assert!(write_atomic(&absent, &fixture()).is_err());
        assert!(serde_json::from_str::<Envelope>("{\"schema_version\":1}").is_err());
    }
    #[test]
    fn export_atomically_replaces_an_existing_backup() {
        let path = std::env::temp_dir().join(format!("aideo-replace-backup-{}.json",nonce()));
        write_atomic(&path,&fixture()).unwrap();
        write_atomic(&path,&fixture()).unwrap();
        assert_eq!(read_backup(&path).unwrap().backup_id,"test-id");
        fs::remove_file(path).unwrap();
    }
    #[test]
    fn backup_targets_preserve_referenced_and_unrelated_files() {
        let conn=database();
        let path=std::env::temp_dir().join(format!("aideo-sidecar-{}.json",nonce()));
        fs::write(&path,b"original library sidecar").unwrap();
        conn.execute("INSERT INTO tracks(path,title) VALUES(?,'Sidecar')",[path.to_str().unwrap()]).unwrap();
        assert!(write_rollback_snapshot(&conn,path.to_str().unwrap(),Settings::new()).is_err());
        assert_eq!(fs::read(&path).unwrap(),b"original library sidecar");
        assert!(write_atomic(&path,&fixture()).is_err());
        assert_eq!(fs::read(&path).unwrap(),b"original library sidecar");
        fs::remove_file(path).unwrap();
    }
    #[test]
    fn device_profiles_are_bounded_and_nested_secrets_rejected() {
        let mut dsp=serde_json::to_value(crate::player::DSPState::default()).unwrap();
        dsp["stream_engine"]=serde_json::json!("reqwest");
        let mut profile=serde_json::json!({"version":1,"volume":0.3,"dsp":dsp,"autoEq":null,"exclusive":false,"bitPerfect":false});
        profile["dsp"]["lookahead_prebuffer_enabled"]=serde_json::json!(true);
        device_profile_valid(&profile.to_string()).unwrap();
        profile["dsp"]["token"]=serde_json::json!("SECRET");
        assert!(device_profile_valid(&profile.to_string()).is_err());
        profile["dsp"].as_object_mut().unwrap().remove("token");
        profile["autoEq"]=serde_json::json!({"url":"https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/EQ.txt?token=SECRET","name":"Headphones","fullSource":"Measurement"});
        assert!(device_profile_valid(&profile.to_string()).is_err());
        profile["autoEq"]=serde_json::Value::Null;
        profile["dsp"]["convolution_ir_path"]=serde_json::json!("https://signed.example/ir.wav?token=SECRET");
        assert!(device_profile_valid(&profile.to_string()).is_err());
    }
    #[test]
    fn conflicting_alias_restore_is_rejected_before_mutation() {
        let mut conn=database();
        conn.execute("INSERT INTO recommendation_aliases(source_key,recording_id) VALUES('tidal:123','existing')",[]).unwrap();
        let b=fixture();
        assert!(preview(&conn,&b,&b.categories).err().unwrap().contains("identity conflict"));
        assert!(apply(&mut conn,&b,&b.categories).is_err());
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM playlists",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        let mut duplicated=b.clone();
        let mut alias=duplicated.aliases[0].clone();
        alias.recording_id="other".into();
        duplicated.aliases.push(alias);
        assert!(validate(&duplicated).err().unwrap().contains("Duplicate recommendation source"));
    }
    #[test]
    fn missing_local_media_and_nested_provider_credentials_are_handled() {
        let c = database();
        let mut b = fixture();
        b.favorites[0].path = std::env::temp_dir()
            .join("aideo-missing-media-123.flac")
            .to_string_lossy()
            .into();
        assert_eq!(
            preview(&c, &b, &b.categories).unwrap().missing_paths.len(),
            1
        );
        let context:db::RecordingSources=serde_json::from_value(serde_json::json!({"recording_id":"r1","sources":[{"provider":"tidal","id":"123","metadata":{"title":"Song","artist":"Artist","album":null,"duration":180.0,"duration_raw":"SECRET","cover_url":"https://u:SECRET@host/?token=SECRET","track_number":null,"disc_number":null},"catalog_quality":{"codec":"SECRET"},"token":"SECRET"}],"selection":{"mode":"auto"},"token":"SECRET"})).unwrap();
        let clean = safe_source(context).unwrap();
        assert!(!serde_json::to_string(&clean).unwrap().contains("SECRET"));
    }
}
