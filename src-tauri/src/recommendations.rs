use crate::db::{self, Track};
use crate::sources::RecordingEvidence;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Deserialize)]
pub struct RecommendationRequest {
    pub surface: String,
    pub seed: Option<Track>,
    #[serde(default)]
    pub candidates: Vec<Track>,
    pub mode: String,
    pub provider: String,
    pub allow_local: Option<bool>,
    pub discovery_level: f64,
    #[serde(default)]
    pub excluded_paths: Vec<String>,
    pub limit: usize,
    pub generation: u64,
    pub period_days: Option<u32>,
    pub mood: Option<String>,
    #[serde(default)]
    pub recording_evidence: HashMap<String, RecordingEvidence>,
    #[serde(default)]
    pub relatedness: HashMap<String, f64>,
    #[serde(default)]
    pub provenance: HashMap<String, String>,
}
#[derive(Serialize)]
pub struct RecommendationResponse {
    pub tracks: Vec<Track>,
    pub generation: u64,
    pub reasons: HashMap<String, String>,
    pub recording_ids: HashMap<String, String>,
    pub confidence: HashMap<String, f64>,
}
pub fn init_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS recommendation_aliases (
        source_key TEXT PRIMARY KEY, recording_id TEXT NOT NULL, title TEXT, artist TEXT, duration REAL);
        CREATE INDEX IF NOT EXISTS idx_recommendation_recording ON recommendation_aliases(recording_id);
        CREATE INDEX IF NOT EXISTS idx_recommendation_metadata ON recommendation_aliases(title,artist,duration);
        CREATE TABLE IF NOT EXISTS recommendation_interest (recording_id TEXT PRIMARY KEY, interested INTEGER NOT NULL CHECK(interested IN (0,1)));
        CREATE TABLE IF NOT EXISTS recommendation_training_ignored(history_id INTEGER PRIMARY KEY REFERENCES playback_history(id) ON DELETE CASCADE);")?;
    for (column, declaration) in [
        ("recording_id", "TEXT"),
        ("source_key", "TEXT"),
        ("listened_seconds", "REAL NOT NULL DEFAULT 0"),
        ("signal_quality", "TEXT NOT NULL DEFAULT 'legacy'"),
        ("end_reason", "TEXT"),
        ("origin", "TEXT"),
    ] {
        if !db::column_exists(conn, "playback_history", column) {
            conn.execute(
                &format!("ALTER TABLE playback_history ADD COLUMN {column} {declaration}"),
                [],
            )?;
        }
    }
    for (column, kind) in [
        ("isrc", "TEXT"),
        ("version", "TEXT"),
        ("explicit", "INTEGER"),
    ] {
        if !db::column_exists(conn, "recommendation_aliases", column) {
            conn.execute(
                &format!("ALTER TABLE recommendation_aliases ADD COLUMN {column} {kind}"),
                [],
            )?;
        }
    }
    Ok(())
}
fn normalized(value: &Option<String>) -> Option<String> {
    value
        .as_ref()
        .map(|s| {
            s.split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .to_lowercase()
        })
        .filter(|s| !s.is_empty())
}
pub fn source_key(track: &Track) -> String {
    let path = track.path.trim();
    let format = track.format.as_deref().unwrap_or("").to_ascii_lowercase();
    for provider in ["tidal", "qobuz", "youtube"] {
        if let Some(id) = path.strip_prefix(&format!("{provider}:")) {
            return format!("{provider}:{}", id.trim_start_matches('/'));
        }
        if format.contains(provider)
            && !path.contains(['/', '\\'])
            && !path.is_empty()
            && (provider == "youtube" || path.bytes().all(|b| b.is_ascii_digit()))
        {
            return format!("{provider}:{path}");
        }
    }
    if let Ok(url) = reqwest::Url::parse(path) {
        let id = match url.host_str() {
            Some("youtu.be") => Some(url.path().trim_start_matches('/').to_owned()),
            Some("youtube.com" | "www.youtube.com" | "music.youtube.com") => url
                .query_pairs()
                .find(|(k, _)| k == "v")
                .map(|(_, v)| v.into_owned()),
            _ => None,
        };
        if let Some(id) = id.filter(|id| {
            id.len() == 11
                && id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        }) {
            return format!("youtube:{id}");
        }
    }
    if path.starts_with("http://") || path.starts_with("https://") {
        return format!("remote:{path}");
    }
    format!("local:{}", path.replace('/', "\\").to_lowercase())
}
pub fn recording_id(conn: &Connection, track: &Track) -> rusqlite::Result<String> {
    canonical_id_with_evidence(conn, track, None)
}
pub fn canonical_id_with_evidence(
    conn: &Connection,
    track: &Track,
    evidence: Option<&RecordingEvidence>,
) -> rusqlite::Result<String> {
    let key = source_key(track);
    let isrc = evidence
        .and_then(|e| normalized(&e.isrc))
        .map(|s| s.replace('-', ""));
    let version = evidence.and_then(|e| normalized(&e.version));
    let explicit = evidence.and_then(|e| e.explicit);
    if let Some(mut id) = conn
        .query_row(
            "SELECT recording_id FROM recommendation_aliases WHERE source_key=?1",
            [&key],
            |r| r.get::<_, String>(0),
        )
        .optional()?
    {
        let conflicting:bool=conn.query_row("SELECT EXISTS(SELECT 1 FROM recommendation_aliases WHERE recording_id=?1 AND ((?2 IS NOT NULL AND isrc IS NOT ?2 AND (isrc IS NOT NULL OR source_key!=?5)) OR (?3 IS NOT NULL AND version IS NOT ?3 AND (version IS NOT NULL OR source_key!=?5)) OR (?4 IS NOT NULL AND explicit IS NOT ?4 AND (explicit IS NOT NULL OR source_key!=?5))))",params![id,isrc,version,explicit,key],|r|r.get(0))?;
        if conflicting {
            let original_id = id.clone();
            // Past observations retain their original identity when later catalogue evidence separates a source.
            id = format!(
                "recording:{:x}",
                md5::compute(format!("{key}|{isrc:?}|{version:?}|{explicit:?}").as_bytes())
            );
            conn.execute("UPDATE recommendation_aliases SET recording_id=?1,isrc=COALESCE(?2,isrc),version=COALESCE(?3,version),explicit=COALESCE(?4,explicit) WHERE source_key=?5",params![id,isrc,version,explicit,key])?;
            conn.execute("INSERT INTO recommendation_interest(recording_id,interested) SELECT ?1,interested FROM recommendation_interest WHERE recording_id=?2 ON CONFLICT(recording_id) DO NOTHING",params![id,original_id])?;
        }
        conn.execute("UPDATE recommendation_aliases SET isrc=COALESCE(isrc,?1),version=COALESCE(version,?2),explicit=COALESCE(explicit,?3),title=COALESCE(title,?4),artist=COALESCE(artist,?5),duration=COALESCE(duration,?6) WHERE source_key=?7",params![isrc,version,explicit,normalized(&track.title),normalized(&track.artist),track.duration.filter(|d|d.is_finite()&&*d>0.0),key])?;
        return Ok(id);
    }
    let title = normalized(&track.title);
    let artist = normalized(&track.artist);
    let duration = track.duration.filter(|d| d.is_finite() && *d > 0.0);
    // ponytail: exact full titles preserve versions; fuzzy matching needs explicit provenance.
    let matched = if title.is_some() && artist.is_some() && duration.is_some() {
        conn.query_row("SELECT a.recording_id FROM recommendation_aliases a WHERE a.title=?1 AND a.artist=?2 AND a.duration>0 AND ABS(a.duration-?3)<=3 AND a.isrc IS ?4 AND a.version IS ?5 AND a.explicit IS ?6 AND NOT EXISTS(SELECT 1 FROM recommendation_aliases b WHERE b.recording_id=a.recording_id AND ((b.duration>0 AND ABS(b.duration-?3)>3) OR b.isrc IS NOT ?4 OR b.version IS NOT ?5 OR b.explicit IS NOT ?6)) ORDER BY a.source_key LIMIT 1", params![title, artist, duration,isrc,version,explicit], |r| r.get::<_,String>(0)).optional()?
    } else {
        None
    };
    let id = matched.unwrap_or_else(|| format!("recording:{:x}", md5::compute(key.as_bytes())));
    conn.execute("INSERT OR IGNORE INTO recommendation_aliases(source_key,recording_id,title,artist,duration,isrc,version,explicit) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)", params![key,id,title,artist,duration,isrc,version,explicit])?;
    Ok(id)
}
#[derive(Default, Clone)]
struct Evidence {
    positive: f64,
    qualified_positive: f64,
    negative: f64,
    qualified: Vec<i64>,
    last: Option<i64>,
    session: f64,
    skips: Vec<i64>,
    profile: Option<Track>,
}
fn posterior(e: &Evidence) -> f64 {
    (2.0 + e.positive) / (4.0 + e.positive + e.negative)
}
fn evidence(conn: &Connection, now: i64) -> rusqlite::Result<HashMap<String, Evidence>> {
    let mut stmt = conn.prepare("SELECT recording_id,timestamp,signal_quality,end_reason,listened_seconds,duration,track_path,title,artist,format,duration_played,skipped,genre FROM playback_history WHERE NOT EXISTS(SELECT 1 FROM recommendation_training_ignored i WHERE i.history_id=playback_history.id) ORDER BY timestamp DESC,id DESC")?;
    let mut rows = stmt.query([])?;
    let mut result = HashMap::<String, Evidence>::new();
    let mut daily = HashMap::<(String, i64), usize>::new();
    let mut session_count = 0;
    let mut legacy_days = HashSet::new();
    while let Some(row) = rows.next()? {
        let id = match row.get::<_, Option<String>>(0)? {
            Some(id) => id,
            None => recording_id(
                conn,
                &Track {
                    path: row.get(6)?,
                    title: row.get(7)?,
                    artist: row.get(8)?,
                    format: row.get(9)?,
                    duration: row.get(5)?,
                    ..empty_track()
                },
            )?,
        };
        let timestamp: i64 = row.get(1)?;
        if timestamp > now {
            continue;
        }
        let quality: String = row.get(2)?;
        let profile = Track {
            path: row.get(6)?,
            title: row.get(7)?,
            artist: row.get(8)?,
            format: row.get(9)?,
            duration: row.get(5)?,
            genre: row.get(12)?,
            ..empty_track()
        };
        let end: Option<String> = row.get(3)?;
        if end.as_deref() == Some("error") {
            continue;
        }
        let listened: f64 = row.get(4)?;
        let duration: Option<f64> = row.get(5)?;
        if !listened.is_finite() || listened < 0.0 {
            continue;
        }
        let age = (now - timestamp) as f64;
        let decay = 2.0_f64.powf(-age / (60.0 * 86400.0));
        if quality == "legacy" {
            let played = row.get::<_, Option<f64>>(10)?.unwrap_or(0.0);
            if played.is_finite()
                && played > 0.0
                && row.get::<_, Option<i32>>(11)?.unwrap_or(0) == 0
                && legacy_days.insert((id.clone(), timestamp / 86400))
            {
                let e = result.entry(id).or_default();
                e.positive += 0.25 * decay;
                e.profile.get_or_insert(profile);
            }
            continue;
        }
        let threshold = duration
            .filter(|d| d.is_finite() && *d > 0.0)
            .map(|d| 120.0_f64.min(d / 2.0))
            .unwrap_or(120.0);
        let qualified = quality == "qualified" && listened >= threshold;
        let skipped = end.as_deref() == Some("skipped") && !qualified;
        if !qualified && !skipped {
            continue;
        }
        let count = daily.entry((id.clone(), timestamp / 86400)).or_default();
        if *count >= 3 {
            continue;
        }
        *count += 1;
        let e = result.entry(id).or_default();
        e.profile.get_or_insert(profile);
        if qualified {
            let completed = end.as_deref() == Some("completed")
                && duration.is_some_and(|d| d.is_finite() && d > 0.0 && listened >= d * 0.8);
            e.positive += if completed { decay } else { 0.75 * decay };
            e.qualified_positive += if completed { decay } else { 0.75 * decay };
            if !completed {
                e.negative += 0.25 * decay;
            }
            e.qualified.push(timestamp);
            e.last = Some(e.last.unwrap_or(timestamp).max(timestamp));
            if age <= 7200.0 && session_count < 10 {
                e.session += 2.0_f64.powf(-age / 1800.0);
                session_count += 1;
            }
        } else {
            e.negative += 0.5 * decay;
            e.skips.push(timestamp);
        }
    }
    if result
        .values()
        .filter_map(|e| e.last)
        .max()
        .is_none_or(|latest| now - latest > 1800)
    {
        for e in result.values_mut() {
            e.session = 0.0;
        }
    }
    Ok(result)
}
fn sonic(a: &Track, b: &Track) -> Option<f64> {
    let mut parts = Vec::new();
    if let (Some(x), Some(y)) = (a.bpm, b.bpm) {
        if x.is_finite() && y.is_finite() && x > 0.0 && y > 0.0 {
            let difference = [y, y * 2.0, y / 2.0]
                .into_iter()
                .map(|v| ((x - v) / x).abs())
                .fold(f64::INFINITY, f64::min);
            parts.push((1.0 - difference).clamp(0.0, 1.0));
        }
    }
    for (x, y) in [
        (a.energy, b.energy),
        (a.bass_ratio, b.bass_ratio),
        (a.treble_ratio, b.treble_ratio),
    ] {
        if let (Some(x), Some(y)) = (x, y) {
            if x.is_finite()
                && y.is_finite()
                && (0.0..=1.0).contains(&x)
                && (0.0..=1.0).contains(&y)
            {
                parts.push(1.0 - (x - y).abs());
            }
        }
    }
    (!parts.is_empty()).then(|| parts.iter().sum::<f64>() / parts.len() as f64)
}
fn relation(a: &Track, b: &Track) -> f64 {
    let artist = normalized(&a.artist).is_some() && normalized(&a.artist) == normalized(&b.artist);
    let genre = normalized(&a.genre).is_some() && normalized(&a.genre) == normalized(&b.genre);
    (if artist {
        1.0_f64
    } else if genre {
        0.65
    } else {
        0.0
    })
    .max(sonic(a, b).unwrap_or(0.0))
}
fn matches_mood(track: &Track, mood: &str) -> bool {
    let mood = mood.trim().to_lowercase();
    let genre = normalized(&track.genre).unwrap_or_default();
    let energy = track
        .energy
        .filter(|e| e.is_finite() && (0.0..=1.0).contains(e));
    match mood.as_str() {
        "calm" | "relax" | "chill" => {
            genre.contains("ambient") || genre.contains("chill") || energy.is_some_and(|e| e <= 0.3)
        }
        "energetic" | "workout" => genre.contains("dance") || energy.is_some_and(|e| e >= 0.75),
        "focus" => genre.contains("instrumental") || genre.contains("ambient"),
        "happy" => genre.contains("happy") || genre.contains("uplifting"),
        "sad" | "melancholic" | "melancholy" => {
            genre.contains("sad") || genre.contains("melanchol")
        }
        _ => false,
    }
}
pub fn rank(
    conn: &Connection,
    mut request: RecommendationRequest,
    now: i64,
) -> Result<RecommendationResponse, String> {
    const SURFACES: &[&str] = &[
        "radio",
        "home",
        "discovery",
        "supermix",
        "spotlight",
        "on_repeat",
        "heavy_rotation",
        "recap",
        "forgotten_favorites",
        "forgotten_gems",
        "recent",
        "mood",
    ];
    if !SURFACES.contains(&request.surface.as_str())
        || !matches!(request.mode.as_str(), "local" | "hybrid")
        || !matches!(request.provider.as_str(), "our" | "youtube" | "tidal")
        || !request.discovery_level.is_finite()
        || !(0.0..=1.0).contains(&request.discovery_level)
        || request.limit > 100
        || request.candidates.len() > 10000
        || request.excluded_paths.len() > 10000
        || request.period_days.is_some_and(|d| d == 0 || d > 3660)
    {
        return Err("Invalid recommendation request".into());
    }
    if request.surface == "mood" && request.mood.is_none() {
        return Err("Mood is required".into());
    }
    let mut library = db::get_all_tracks(conn).map_err(|e| e.to_string())?;
    let fresh: HashMap<_, _> = library
        .iter()
        .filter(|t| source_key(t).starts_with("local:"))
        .map(|t| (source_key(t), t))
        .collect();
    let overlay = |track: &mut Track| {
        if let Some(stored) = fresh.get(&source_key(track)) {
            track.bpm = stored.bpm;
            track.energy = stored.energy;
            track.bass_ratio = stored.bass_ratio;
            track.treble_ratio = stored.treble_ratio;
        }
    };
    for track in &mut request.candidates {
        overlay(track);
    }
    if let Some(seed) = &mut request.seed {
        overlay(seed);
    }
    if let Some(playlist) = conn
        .query_row(
            "SELECT id FROM playlists WHERE name='Favorite Songs'",
            [],
            |r| r.get::<_, i32>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
    {
        for entry in db::get_playlist_entries(conn, playlist).map_err(|e| e.to_string())? {
            let mut track = entry.track;
            track.loved = Some(1);
            library.push(track);
        }
    }
    if request.candidates.is_empty() {
        request.candidates = library
            .iter()
            .filter(|track| {
                request.allow_local != Some(false) || !source_key(track).starts_with("local:")
            })
            .cloned()
            .collect();
    } else {
        let supplied: HashSet<_> = request.candidates.iter().map(|t| t.path.clone()).collect();
        request.candidates.extend(
            library
                .iter()
                .filter(|t| {
                    request.allow_local != Some(false)
                        && source_key(t).starts_with("local:")
                        && !supplied.contains(&t.path)
                })
                .cloned(),
        );
    }
    let mut tracks = library;
    tracks.extend(request.candidates.iter().cloned());
    if let Some(seed) = &request.seed {
        tracks.push(seed.clone());
    }
    let mut ids = HashMap::new();
    let mut path_sources: HashMap<String, HashSet<String>> = HashMap::new();
    for track in &tracks {
        let key = source_key(track);
        path_sources
            .entry(track.path.clone())
            .or_default()
            .insert(key.clone());
        ids.insert(
            key.clone(),
            canonical_id_with_evidence(
                conn,
                track,
                request
                    .recording_evidence
                    .get(&key)
                    .or_else(|| request.recording_evidence.get(&track.path)),
            )
            .map_err(|e| e.to_string())?,
        );
    }
    let history = evidence(conn, now).map_err(|e| e.to_string())?;
    let mut excluded = HashSet::new();
    let mut loved = HashSet::new();
    for track in &tracks {
        if track.disliked == Some(1) {
            excluded.insert(ids[&source_key(track)].clone());
        }
        if track.loved == Some(1) {
            loved.insert(ids[&source_key(track)].clone());
        }
    }
    let mut stmt = conn
        .prepare("SELECT recording_id,interested FROM recommendation_interest")
        .map_err(|e| e.to_string())?;
    let interest = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i32>(1)?)))
        .map_err(|e| e.to_string())?;
    for row in interest {
        let (id, interested) = row.map_err(|e| e.to_string())?;
        if interested == 0 {
            excluded.insert(id);
        } else {
            excluded.remove(&id);
        }
    }
    let feedback_excluded = excluded.clone();
    loved.retain(|id| !feedback_excluded.contains(id));
    for path in &request.excluded_paths {
        let matching: Vec<_> = tracks.iter().filter(|t| t.path == *path).collect();
        if !matching.is_empty() {
            for track in matching {
                excluded.insert(ids[&source_key(track)].clone());
            }
        } else if let Some(id) = conn
            .query_row(
                "SELECT recording_id FROM recommendation_aliases WHERE source_key=?1",
                [source_key(&Track {
                    path: path.clone(),
                    ..empty_track()
                })],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
        {
            excluded.insert(id);
        }
    }
    if let Some(seed) = &request.seed {
        excluded.insert(ids[&source_key(seed)].clone());
    }
    let mut profiles: BTreeMap<String, Track> = BTreeMap::new();
    for track in &tracks {
        profiles
            .entry(ids[&source_key(track)].clone())
            .or_insert_with(|| track.clone());
    }
    for (id, e) in &history {
        if let Some(profile) = &e.profile {
            profiles
                .entry(id.clone())
                .or_insert_with(|| profile.clone());
        }
    }
    let anchors: Vec<_> = profiles
        .iter()
        .filter(|(id, _)| {
            !feedback_excluded.contains(*id)
                && (loved.contains(*id)
                    || history.get(*id).is_some_and(|e| e.positive > e.negative))
        })
        .collect();
    let mut seen = HashSet::new();
    let mut scored = Vec::new();
    for track in request.candidates {
        let id = &ids[&source_key(&track)];
        if excluded.contains(id) || request.excluded_paths.contains(&track.path) {
            continue;
        }
        let source = source_key(&track);
        let local = source.starts_with("local:");
        if local && request.allow_local == Some(false) {
            continue;
        }
        if local && !std::path::Path::new(&track.path).is_file() {
            continue;
        }
        if request.mode == "local" && !local {
            continue;
        }
        if !local
            && (source.starts_with("remote:")
                || (request.provider != "our"
                    && !source.starts_with(&format!("{}:", request.provider))))
        {
            continue;
        }
        if !seen.insert(id.clone()) {
            continue;
        }
        let e = history.get(id).cloned().unwrap_or_default();
        let plays7 = e
            .qualified
            .iter()
            .filter(|t| now - **t <= 7 * 86400)
            .count();
        let plays30 = e
            .qualified
            .iter()
            .filter(|t| now - **t <= 30 * 86400)
            .count();
        let age = e.last.map(|t| now - t);
        let allowed = match request.surface.as_str() {
            "on_repeat" => plays7 >= 2,
            "heavy_rotation" => plays30 >= 2,
            "recap" => e
                .qualified
                .iter()
                .any(|t| now - *t <= i64::from(request.period_days.unwrap_or(365)) * 86400),
            "recent" => e.last.is_some(),
            "forgotten_favorites" => {
                age.is_some_and(|a| a >= 30 * 86400)
                    && (loved.contains(id) || e.positive > e.negative)
            }
            "forgotten_gems" => {
                age.is_some_and(|a| a >= 30 * 86400)
                    && e.qualified.len() >= 2
                    && e.positive > e.negative
            }
            "mood" => matches_mood(&track, request.mood.as_deref().unwrap_or("")),
            _ => true,
        };
        if !allowed {
            continue;
        }
        let artist = anchors
            .iter()
            .filter(|(_, a)| {
                normalized(&a.artist).is_some()
                    && normalized(&a.artist) == normalized(&track.artist)
            })
            .map(|(anchor_id, _)| {
                if loved.contains(*anchor_id) {
                    3.0
                } else {
                    history[*anchor_id].positive
                }
            })
            .sum::<f64>();
        let genre = anchors
            .iter()
            .filter(|(_, a)| {
                normalized(&a.genre).is_some() && normalized(&a.genre) == normalized(&track.genre)
            })
            .map(
                |(anchor_id, _)| {
                    if loved.contains(*anchor_id) {
                        1.0
                    } else {
                        0.5
                    }
                },
            )
            .sum::<f64>();
        let artist_skips: HashSet<_> = profiles
            .iter()
            .filter(|(profile_id, t)| {
                normalized(&track.artist).is_some()
                    && normalized(&t.artist) == normalized(&track.artist)
                    && history
                        .get(*profile_id)
                        .is_some_and(|h| h.skips.iter().any(|ts| now - *ts <= 30 * 86400))
            })
            .map(|(id, _)| id.clone())
            .collect();
        let taste_e = Evidence {
            positive: e.positive
                + if loved.contains(id) { 3.0 } else { 0.0 }
                + artist.min(3.0)
                + genre.min(1.0),
            negative: e.negative + if artist_skips.len() >= 3 { 0.5 } else { 0.0 },
            ..e.clone()
        };
        let taste = posterior(&taste_e);
        let provider_relation = request
            .relatedness
            .get(&source_key(&track))
            .or_else(|| request.relatedness.get(&track.path))
            .copied()
            .filter(|r| r.is_finite() && (0.0..=1.0).contains(r))
            .unwrap_or(0.0);
        let seed_relation = request
            .seed
            .as_ref()
            .map(|s| relation(s, &track).max(provider_relation));
        let relevance = seed_relation.unwrap_or_else(|| {
            anchors
                .iter()
                .map(|(_, a)| relation(a, &track))
                .fold(provider_relation, f64::max)
        });
        if matches!(request.surface.as_str(), "radio" | "spotlight")
            && request.seed.is_some()
            && relevance < 0.3
        {
            continue;
        }
        let related = relevance >= 0.3 || taste > 0.52 || anchors.is_empty();
        if request.surface == "discovery" && !related {
            continue;
        }
        let novelty = if related {
            1.0 / (1.0 + e.positive)
        } else {
            0.0
        };
        let session = profiles
            .iter()
            .filter_map(|(profile_id, t)| {
                history
                    .get(profile_id)
                    .filter(|h| h.session > 0.0)
                    .map(|h| relation(t, &track) * h.session)
            })
            .sum::<f64>()
            .min(1.0);
        let (mut wt, wr, wu, mut wn, wv) = match request.surface.as_str() {
            "radio" | "spotlight" => (0.25, 0.35, 0.20, 0.10, 0.10),
            "discovery" => (0.25, 0.25, 0.05, 0.35, 0.10),
            _ => (0.55, 0.10, 0.05, 0.20, 0.10),
        };
        let shift = (request.discovery_level - 0.5)
            * if request.discovery_level < 0.5 {
                0.2
            } else {
                0.3
            };
        wt -= shift;
        wn += shift;
        let version_preference = if loved.contains(id) {
            1.0
        } else {
            posterior(&Evidence {
                positive: e.qualified_positive,
                negative: e.negative,
                ..Default::default()
            })
        };
        let mut score =
            wt * taste + wr * relevance + wu * session + wn * novelty + wv * version_preference;
        let reason = match request.surface.as_str() {
            "on_repeat" => {
                score = plays7 as f64;
                "Repeated this week"
            }
            "heavy_rotation" => {
                score = plays30 as f64;
                "Frequently heard this month"
            }
            "recap" => {
                score = e
                    .qualified
                    .iter()
                    .filter(|t| now - **t <= i64::from(request.period_days.unwrap_or(365)) * 86400)
                    .count() as f64;
                "Qualified listens in this period"
            }
            "recent" => {
                score = e.last.unwrap_or(0) as f64;
                "Recently listened"
            }
            "forgotten_favorites" | "forgotten_gems" => "Rediscover a past favorite",
            "mood" => "Matches supported mood metadata",
            _ if loved.contains(id) => "A favorite recording",
            _ if seed_relation.is_some_and(|r| r >= 0.3) => "Related to your seed",
            _ if taste > 0.52 => "Fits your listening taste",
            _ => "Explore available music",
        };
        let same_seed_artist = request.seed.as_ref().is_some_and(|s| {
            normalized(&s.artist).is_some() && normalized(&s.artist) == normalized(&track.artist)
        });
        let reason = request
            .provenance
            .get(&source_key(&track))
            .or_else(|| request.provenance.get(&track.path))
            .filter(|r| !r.trim().is_empty() && r.len() <= 256)
            .cloned()
            .unwrap_or_else(|| reason.to_owned());
        let familiar = loved.contains(id) || !e.qualified.is_empty();
        let known_artist = anchors.iter().any(|(_, a)| {
            normalized(&track.artist).is_some()
                && normalized(&a.artist) == normalized(&track.artist)
        });
        let mix_group = if familiar {
            0
        } else if known_artist {
            1
        } else {
            2
        };
        scored.push((track, score, reason, same_seed_artist, mix_group));
    }
    scored.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.path.cmp(&b.0.path)));
    let mut local_pool = 0;
    let mut online_pool = 0;
    scored.retain(|entry| {
        let count = if source_key(&entry.0).starts_with("local:") {
            &mut local_pool
        } else {
            &mut online_pool
        };
        *count += 1;
        *count <= 120
    });
    let mut selected: Vec<Track> = Vec::new();
    let mut reasons = HashMap::new();
    let mut recording_ids = HashMap::new();
    let mut confidence = HashMap::new();
    let mut groups = [0usize; 3];
    let familiar = matches!(
        request.surface.as_str(),
        "on_repeat" | "heavy_rotation" | "recap" | "recent"
    );
    while selected.len() < request.limit && !scored.is_empty() {
        let spotlight = request.surface == "spotlight"
            && selected
                .iter()
                .filter(|t| {
                    request
                        .seed
                        .as_ref()
                        .is_some_and(|s| normalized(&s.artist) == normalized(&t.artist))
                })
                .count()
                * 10
                < (selected.len() + 1) * 7;
        let eligible = |entry: &(Track, f64, String, bool, usize)| {
            let artist = normalized(&entry.0.artist);
            (request.surface == "spotlight" && entry.3)
                || artist.is_none()
                || selected
                    .iter()
                    .rev()
                    .take(9)
                    .filter(|t| normalized(&t.artist) == artist)
                    .count()
                    < if familiar { 3 } else { 2 }
        };
        let adjacent = |entry: &(Track, f64, String, bool, usize)| {
            selected.last().is_some_and(|last| {
                normalized(&last.artist).is_some()
                    && normalized(&last.artist) == normalized(&entry.0.artist)
            })
        };
        let mix_group = if request.surface == "supermix" {
            [0, 1, 2]
                .into_iter()
                .filter(|g| scored.iter().any(|e| e.4 == *g && eligible(e)))
                .max_by(|a, b| {
                    let targets = [0.60, 0.25, 0.15];
                    (targets[*a] * (selected.len() + 1) as f64 - groups[*a] as f64)
                        .total_cmp(&(targets[*b] * (selected.len() + 1) as f64 - groups[*b] as f64))
                })
        } else {
            None
        };
        let preferred = |e: &(Track, f64, String, bool, usize)| {
            (!spotlight || e.3) && mix_group.is_none_or(|g| e.4 == g)
        };
        let best = |require_nonadjacent: bool, require_preferred: bool| {
            scored
                .iter()
                .enumerate()
                .filter(|(_, e)| {
                    eligible(e)
                        && (!require_nonadjacent || !adjacent(e))
                        && (!require_preferred || preferred(e))
                })
                .max_by(|(_, a), (_, b)| {
                    let adjusted = |entry: &(Track, f64, String, bool, usize)| {
                        let redundancy = selected
                            .iter()
                            .map(|track| relation(track, &entry.0))
                            .fold(0.0, f64::max);
                        let coherence = if request.surface == "radio" {
                            selected
                                .last()
                                .map(|previous| relation(previous, &entry.0))
                                .unwrap_or(0.0)
                        } else {
                            0.0
                        };
                        entry.1 - 0.15 * redundancy + 0.10 * coherence
                    };
                    adjusted(a)
                        .total_cmp(&adjusted(b))
                        .then_with(|| b.0.path.cmp(&a.0.path))
                })
                .map(|(index, _)| index)
        };
        let index = best(true, true)
            .or_else(|| best(true, false))
            .or_else(|| best(false, true))
            .or_else(|| best(false, false));
        let Some(index) = index else { break };
        let (track, _, reason, _, group) = scored.remove(index);
        groups[group] += 1;
        let key = source_key(&track);
        reasons.insert(key.clone(), reason.clone());
        recording_ids.insert(key.clone(), ids[&key].clone());
        let e = history.get(&ids[&key]).cloned().unwrap_or_default();
        let certainty =
            ((e.positive + e.negative) / (4.0 + e.positive + e.negative)).clamp(0.0, 1.0);
        confidence.insert(key.clone(), certainty);
        if path_sources[&track.path].len() == 1 {
            reasons.insert(track.path.clone(), reason);
            recording_ids.insert(track.path.clone(), ids[&key].clone());
            confidence.insert(track.path.clone(), certainty);
        }
        selected.push(track);
    }
    Ok(RecommendationResponse {
        tracks: selected,
        generation: request.generation,
        reasons,
        recording_ids,
        confidence,
    })
}
#[derive(Serialize)]
pub struct ExcludedRecording {
    recording_id: String,
    track: Track,
    version: Option<String>,
    sources: Vec<String>,
}
pub fn preference_recordings(
    conn: &Connection,
    excluded_only: bool,
) -> rusqlite::Result<Vec<ExcludedRecording>> {
    let mut stmt = conn.prepare("SELECT a.recording_id,a.source_key,a.title,a.artist,a.duration,a.version FROM recommendation_aliases a LEFT JOIN recommendation_interest i ON i.recording_id=a.recording_id WHERE (?1=0 OR i.interested=0) ORDER BY a.recording_id,a.source_key")?;
    let mut groups = BTreeMap::<String, ExcludedRecording>::new();
    for row in stmt.query_map([excluded_only], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, Option<String>>(2)?,
            r.get::<_, Option<String>>(3)?,
            r.get::<_, Option<f64>>(4)?,
            r.get::<_, Option<String>>(5)?,
        ))
    })? {
        let (id, key, title, artist, duration, version) = row?;
        let path = key.strip_prefix("local:").unwrap_or(&key).to_owned();
        groups
            .entry(id.clone())
            .or_insert_with(|| ExcludedRecording {
                recording_id: id,
                track: Track {
                    path,
                    title,
                    artist,
                    duration,
                    ..empty_track()
                },
                version,
                sources: vec![],
            })
            .sources
            .push(key);
    }
    Ok(groups.into_values().collect())
}
#[tauri::command]
pub fn get_recommendation_exclusions(
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<ExcludedRecording>, String> {
    preference_recordings(&*state.db.lock().map_err(|e| e.to_string())?, true)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn get_recommendation_recordings(
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<ExcludedRecording>, String> {
    preference_recordings(&*state.db.lock().map_err(|e| e.to_string())?, false)
        .map_err(|e| e.to_string())
}
#[derive(Deserialize, Serialize, Clone)]
pub struct ResetSelection {
    pub all: bool,
    pub recording_ids: Vec<String>,
    pub start: Option<i64>,
    pub end: Option<i64>,
}
#[derive(Serialize)]
pub struct ResetPreview {
    count: usize,
    token: String,
}
fn reset_ids(conn: &Connection, selection: &ResetSelection) -> Result<Vec<i64>, String> {
    if selection.recording_ids.len() > 10000
        || selection.recording_ids.iter().any(|id| id.len() > 256)
        || selection
            .start
            .zip(selection.end)
            .is_some_and(|(a, b)| a > b)
        || selection.start.is_some_and(|v| v < 0)
        || selection.end.is_some_and(|v| v < 0)
        || (!selection.all
            && selection.recording_ids.is_empty()
            && selection.start.is_none()
            && selection.end.is_none())
    {
        return Err("Choose recordings, a valid date range, or all learned history".into());
    }
    let mut stmt=conn.prepare("SELECT id,recording_id,timestamp,source_key,track_path,format FROM playback_history WHERE NOT EXISTS(SELECT 1 FROM recommendation_training_ignored i WHERE i.history_id=playback_history.id) ORDER BY id").map_err(|e|e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, Option<String>>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut ids = vec![];
    for row in rows {
        let (id, recording, time, source, path, format) = row.map_err(|e| e.to_string())?;
        let key = source.unwrap_or_else(|| {
            source_key(&Track {
                path,
                format,
                ..empty_track()
            })
        });
        let refined = {
            conn.query_row(
                "SELECT recording_id FROM recommendation_aliases WHERE source_key=?1",
                [key],
                |r| r.get::<_, String>(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
        };
        if (selection.all
            || selection.recording_ids.is_empty()
            || recording
                .as_ref()
                .is_some_and(|r| selection.recording_ids.contains(r))
            || refined
                .as_ref()
                .is_some_and(|r| selection.recording_ids.contains(r)))
            && selection.start.is_none_or(|v| time >= v)
            && selection.end.is_none_or(|v| time <= v)
        {
            ids.push(id);
        }
    }
    Ok(ids)
}
fn reset_preview(ids: &[i64]) -> ResetPreview {
    ResetPreview {
        count: ids.len(),
        token: format!("{:x}", md5::compute(format!("{ids:?}"))),
    }
}
#[tauri::command]
pub fn preview_recommendation_reset(
    selection: ResetSelection,
    state: tauri::State<'_, crate::AppState>,
) -> Result<ResetPreview, String> {
    Ok(reset_preview(&reset_ids(
        &*state.db.lock().map_err(|e| e.to_string())?,
        &selection,
    )?))
}
#[tauri::command]
pub fn apply_recommendation_reset(
    selection: ResetSelection,
    token: String,
    rollback_path: String,
    settings: BTreeMap<String, String>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<usize, String> {
    let _maintenance = crate::library_health::begin_maintenance()?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let ids = reset_ids(&conn, &selection)?;
    if reset_preview(&ids).token != token {
        return Err("Listening history changed; preview the reset again".into());
    }
    crate::backup::write_rollback_snapshot(&conn, &rollback_path, settings)?;
    ignore_history(&mut conn, &ids)?;
    Ok(ids.len())
}
fn ignore_history(conn: &mut Connection, ids: &[i64]) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for id in ids {
        tx.execute(
            "INSERT OR IGNORE INTO recommendation_training_ignored(history_id) VALUES(?1)",
            [id],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn get_recommendations(
    request: RecommendationRequest,
    state: tauri::State<'_, crate::AppState>,
) -> Result<RecommendationResponse, String> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs() as i64;
    let database = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = database.lock().map_err(|e| e.to_string())?;
        rank(&conn, request, now)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn set_recommendation_interest(
    track: Track,
    interested: bool,
    source_context: Option<db::RecordingSources>,
    restore_loved: Option<bool>,
    recording_evidence: Option<RecordingEvidence>,
    state: tauri::State<'_, crate::AppState>,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let id = canonical_id_with_evidence(&tx, &track, recording_evidence.as_ref())
        .map_err(|e| e.to_string())?;
    let was_excluded = tx
        .query_row(
            "SELECT interested=0 FROM recommendation_interest WHERE recording_id=?1",
            [&id],
            |r| r.get::<_, bool>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(false);
    set_interest(&tx, &track, interested, source_context.as_ref()).map_err(|e| e.to_string())?;
    if interested && restore_loved == Some(true) && was_excluded {
        tx.execute("UPDATE tracks SET loved=1 WHERE path=?1", [&track.path])
            .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO playlists(name) VALUES ('Favorite Songs') ON CONFLICT(name) DO NOTHING",
            [],
        )
        .map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO playlist_tracks(playlist_id,track_path,position) SELECT id,?1,COALESCE((SELECT MAX(position)+1 FROM playlist_tracks WHERE playlist_id=playlists.id),0) FROM playlists WHERE name='Favorite Songs' AND NOT EXISTS(SELECT 1 FROM playlist_tracks WHERE playlist_id=playlists.id AND track_path=?1)",[&track.path]).map_err(|e|e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}
pub fn set_interest(
    conn: &Connection,
    track: &Track,
    interested: bool,
    context: Option<&db::RecordingSources>,
) -> rusqlite::Result<()> {
    let id = recording_id(conn, track)?;
    if let Some(context) = context {
        context.to_json()?;
        for source in &context.sources {
            let Some(metadata) = &source.metadata else {
                continue;
            };
            let alias = Track {
                path: match source.provider {
                    db::SourceProvider::Local => source.id.clone(),
                    db::SourceProvider::Tidal => format!("tidal:{}", source.id),
                    db::SourceProvider::Qobuz => format!("qobuz:{}", source.id),
                    db::SourceProvider::Youtube => format!("youtube:{}", source.id),
                },
                title: metadata.title.clone(),
                artist: metadata.artist.clone(),
                duration: metadata.duration,
                ..empty_track()
            };
            if normalized(&alias.title).is_some()
                && normalized(&alias.title) == normalized(&track.title)
                && normalized(&alias.artist).is_some()
                && normalized(&alias.artist) == normalized(&track.artist)
                && alias.duration.zip(track.duration).is_some_and(|(a, b)| {
                    a.is_finite() && b.is_finite() && a > 0.0 && b > 0.0 && (a - b).abs() <= 3.0
                })
            {
                recording_id(conn, &alias)?;
            }
        }
    }
    conn.execute("INSERT INTO recommendation_interest(recording_id,interested) VALUES (?1,?2) ON CONFLICT(recording_id) DO UPDATE SET interested=excluded.interested",params![id,interested])?;
    for local in db::get_all_tracks(conn)? {
        if recording_id(conn, &local)? == id {
            conn.execute("UPDATE tracks SET disliked=?1,loved=CASE WHEN ?1=1 THEN 0 ELSE loved END WHERE path=?2",params![!interested,local.path])?;
        }
    }
    if !interested {
        if let Some(playlist) = conn
            .query_row(
                "SELECT id FROM playlists WHERE name='Favorite Songs'",
                [],
                |r| r.get::<_, i32>(0),
            )
            .optional()?
        {
            for entry in db::get_playlist_entries(conn, playlist)? {
                if recording_id(conn, &entry.track)? == id {
                    conn.execute(
                        "DELETE FROM playlist_tracks WHERE entry_id=?1",
                        [entry.playlist_entry_id],
                    )?;
                }
            }
        }
    }
    Ok(())
}
fn empty_track() -> Track {
    Track {
        id: 0,
        path: String::new(),
        title: None,
        artist: None,
        album: None,
        duration: None,
        format: None,
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
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn online_radio_does_not_reinsert_local_library_candidates() {
        let mut conn = db::init_db(":memory:").unwrap();
        let seed = track(
            "https://www.youtube.com/watch?v=aaaaaaaaaaa",
            "Seed",
            "Artist",
        );
        let local = track("online-radio-local", "Local", "Artist");
        db::save_tracks(&mut conn, &mut [local.clone()]).unwrap();
        for candidates in [vec![], vec![local.clone()]] {
            let input: RecommendationRequest = serde_json::from_value(serde_json::json!({
                "surface": "radio", "mode": "hybrid", "provider": "youtube", "seed": seed,
                "candidates": candidates, "discovery_level": 0.5, "limit": 10, "generation": 0,
                "allow_local": false
            }))
            .unwrap();
            assert!(rank(&conn, input, 1_000_000).unwrap().tracks.is_empty());
        }
    }

    #[test]
    fn source_qualified_metadata_and_reasons_do_not_collide_on_numeric_ids() {
        let conn = db::init_db(":memory:").unwrap();
        let mut a = empty_track();
        a.path = "456".into();
        a.format = Some("Tidal FLAC".into());
        a.title = Some("Same song".into());
        a.artist = Some("Same artist".into());
        a.duration = Some(180.0);
        let mut b = a.clone();
        b.format = Some("Qobuz FLAC".into());
        let mut input = request("home", vec![a, b]);
        input.recording_evidence.insert(
            "tidal:456".into(),
            RecordingEvidence {
                isrc: Some("AA1234567890".into()),
                ..Default::default()
            },
        );
        input.recording_evidence.insert(
            "qobuz:456".into(),
            RecordingEvidence {
                isrc: Some("BB1234567890".into()),
                ..Default::default()
            },
        );
        input
            .provenance
            .insert("tidal:456".into(), "Tidal related recording".into());
        input
            .provenance
            .insert("qobuz:456".into(), "Qobuz related recording".into());
        let rows = rank(&conn, input, 1_000_000).unwrap();
        assert_eq!(rows.tracks.len(), 2);
        assert_eq!(rows.reasons["tidal:456"], "Tidal related recording");
        assert_eq!(rows.reasons["qobuz:456"], "Qobuz related recording");
        assert!(rows.confidence.contains_key("tidal:456"));
        assert!(rows.confidence.contains_key("qobuz:456"));
        assert_ne!(
            rows.recording_ids["tidal:456"],
            rows.recording_ids["qobuz:456"]
        );
    }
    #[test]
    fn failed_ignore_write_rolls_back_and_reopening_retains_successful_reset() {
        let path = std::env::temp_dir().join(format!(
            "aideo-taste-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let mut conn = db::init_db(path.to_str().unwrap()).unwrap();
        let t = track("reset-persist", "Song", "Artist");
        listen(&conn, &t, 100, 150.0, "qualified", "completed");
        listen(&conn, &t, 200, 150.0, "qualified", "completed");
        let selection = ResetSelection {
            all: true,
            recording_ids: vec![],
            start: None,
            end: None,
        };
        let ids = reset_ids(&conn, &selection).unwrap();
        conn.execute_batch(&format!("CREATE TRIGGER fail_ignore BEFORE INSERT ON recommendation_training_ignored WHEN NEW.history_id={} BEGIN SELECT RAISE(ABORT,'fixture disk failure'); END;",ids[1])).unwrap();
        assert!(ignore_history(&mut conn, &ids).is_err());
        assert_eq!(reset_ids(&conn, &selection).unwrap(), ids);
        conn.execute_batch("DROP TRIGGER fail_ignore").unwrap();
        ignore_history(&mut conn, &ids).unwrap();
        drop(conn);
        let conn = db::init_db(path.to_str().unwrap()).unwrap();
        assert!(reset_ids(&conn, &selection).unwrap().is_empty());
        assert!(evidence(&conn, 200).unwrap().is_empty());
        drop(conn);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn exclusions_group_aliases_and_keep_provider_numeric_ids_distinct() {
        let conn = db::init_db(":memory:").unwrap();
        let a = track("tidal:123", "Song", "Artist");
        let b = track("qobuz:123", "Other", "Other artist");
        let c = track("qobuz:456", "Song", "Artist");
        set_interest(&conn, &a, false, None).unwrap();
        recording_id(&conn, &c).unwrap();
        set_interest(&conn, &b, false, None).unwrap();
        let entries = preference_recordings(&conn, true).unwrap();
        assert_eq!(entries.len(), 2);
        let song = entries
            .iter()
            .find(|r| r.track.title.as_deref() == Some("song"))
            .unwrap();
        assert_eq!(song.sources, vec!["qobuz:456", "tidal:123"]);
        set_interest(&conn, &song.track, true, None).unwrap();
        assert_eq!(preference_recordings(&conn, true).unwrap().len(), 1);
    }
    #[test]
    fn reset_dates_and_preview_detect_new_history_without_changing_preferences() {
        let conn = db::init_db(":memory:").unwrap();
        let a = track("reset-dates", "Song", "Artist");
        listen(&conn, &a, 100, 150.0, "qualified", "completed");
        listen(&conn, &a, 200, 150.0, "qualified", "completed");
        set_interest(&conn, &a, false, None).unwrap();
        let selection = ResetSelection {
            all: false,
            recording_ids: vec![],
            start: Some(100),
            end: Some(150),
        };
        let ids = reset_ids(&conn, &selection).unwrap();
        assert_eq!(ids.len(), 1);
        let token = reset_preview(&ids).token;
        listen(&conn, &a, 125, 150.0, "qualified", "completed");
        assert_ne!(
            token,
            reset_preview(&reset_ids(&conn, &selection).unwrap()).token
        );
        assert_eq!(preference_recordings(&conn, true).unwrap().len(), 1);
    }
    #[test]
    fn taste_reset_preserves_history_and_filters_persistent_and_session_evidence() {
        let conn = db::init_db(":memory:").unwrap();
        let t = track("taste-reset", "Song", "Artist");
        let now = 1_000_000;
        listen(&conn, &t, now, 150.0, "qualified", "completed");
        let id = recording_id(&conn, &t).unwrap();
        let selection = ResetSelection {
            all: false,
            recording_ids: vec![id.clone()],
            start: None,
            end: None,
        };
        let ids = reset_ids(&conn, &selection).unwrap();
        assert_eq!(ids.len(), 1);
        assert!(evidence(&conn, now).unwrap()[&id].session > 0.0);
        conn.execute(
            "INSERT INTO recommendation_training_ignored(history_id) VALUES(?1)",
            [ids[0]],
        )
        .unwrap();
        assert!(evidence(&conn, now).unwrap().is_empty());
        assert!(reset_ids(&conn, &selection).unwrap().is_empty());
        assert_eq!(
            conn.query_row("SELECT count(*) FROM playback_history", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
        listen(&conn, &t, now + 1, 150.0, "qualified", "completed");
        assert!(evidence(&conn, now + 1).unwrap()[&id].session > 0.0);
    }
    #[test]
    fn mood_boundary_normalizes_case_whitespace_and_melancholic_alias() {
        let conn = db::init_db(":memory:").unwrap();
        let mut a = track("mood-case", "Song", "Artist");
        a.genre = Some("Melancholic".into());
        let mut input = request("mood", vec![a.clone()]);
        input.mood = Some(" Melancholic ".into());
        assert_eq!(
            rank(&conn, input, 1_000_000).unwrap().tracks[0].path,
            a.path
        );
    }
    #[test]
    fn explicit_interest_survives_later_catalog_identity_refinement() {
        let conn = db::init_db(":memory:").unwrap();
        let a = track("tidal:991", "Song", "Artist");
        let b = track("qobuz:992", "Song", "Artist");
        recording_id(&conn, &b).unwrap();
        set_interest(&conn, &a, false, None).unwrap();
        let evidence = RecordingEvidence {
            isrc: Some("AA1234567890".into()),
            ..Default::default()
        };
        let refined = canonical_id_with_evidence(&conn, &a, Some(&evidence)).unwrap();
        assert_eq!(
            conn.query_row(
                "SELECT interested FROM recommendation_interest WHERE recording_id=?1",
                [refined],
                |r| r.get::<_, i32>(0)
            )
            .unwrap(),
            0
        );
        let mut input = request("home", vec![a]);
        input
            .recording_evidence
            .insert(input.candidates[0].path.clone(), evidence);
        assert!(rank(&conn, input, 1_000_000).unwrap().tracks.is_empty());
    }
    #[test]
    fn fresh_database_sonic_features_overlay_stale_supplied_tracks_and_seed() {
        let conn = db::init_db(":memory:").unwrap();
        let seed = track("overlay-seed", "Seed", "A");
        let candidate = track("overlay-candidate", "Candidate", "B");
        conn.execute("INSERT INTO tracks(path,title,artist,duration,format,bpm) VALUES (?1,'Seed','A',180,'FLAC',80)",[&seed.path]).unwrap();
        conn.execute("INSERT INTO tracks(path,title,artist,duration,format,bpm) VALUES (?1,'Candidate','B',180,'FLAC',160)",[&candidate.path]).unwrap();
        let mut input = request("radio", vec![candidate.clone()]);
        input.seed = Some(seed);
        let ranked = rank(&conn, input, 1_000_000).unwrap();
        assert_eq!(ranked.tracks.len(), 1);
        assert_eq!(ranked.tracks[0].path, candidate.path);
        assert_eq!(ranked.tracks[0].bpm, Some(160.0));
    }
    #[test]
    fn same_numeric_ids_from_different_providers_remain_distinct() {
        let conn = db::init_db(":memory:").unwrap();
        let mut a = empty_track();
        a.path = "123".into();
        a.format = Some("Tidal FLAC".into());
        a.title = Some("Song A".into());
        a.artist = Some("Artist A".into());
        a.duration = Some(180.0);
        let mut b = a.clone();
        b.format = Some("Qobuz FLAC".into());
        b.title = Some("Song B".into());
        b.artist = Some("Artist B".into());
        assert_eq!(
            rank(
                &conn,
                request("home", vec![a.clone(), b.clone()]),
                1_000_000
            )
            .unwrap()
            .tracks
            .len(),
            2
        );
        set_interest(&conn, &a, false, None).unwrap();
        let rows = rank(&conn, request("home", vec![a, b]), 1_000_000).unwrap();
        assert_eq!(rows.tracks.len(), 1);
        assert_eq!(rows.tracks[0].title.as_deref(), Some("Song B"));
    }
    #[test]
    fn selection_penalizes_redundant_tracks_after_the_first_choice() {
        let conn = db::init_db(":memory:").unwrap();
        let mut a = track("mmr-a", "Favorite", "A");
        a.loved = Some(1);
        a.genre = Some("Rock".into());
        let mut b = track("mmr-b", "Redundant", "B");
        b.genre = Some("Rock".into());
        let mut c = track("mmr-c", "Varied", "C");
        c.genre = Some("Jazz".into());
        let mut input = request("home", vec![a.clone(), b, c.clone()]);
        input.relatedness.insert(c.path.clone(), 0.65);
        let rows = rank(&conn, input, 1_000_000).unwrap();
        assert_eq!(rows.tracks[0].path, a.path);
        assert_eq!(rows.tracks[1].path, c.path);
    }
    #[test]
    fn late_conflicting_catalog_evidence_splits_aliases_without_rewriting_history() {
        let conn = db::init_db(":memory:").unwrap();
        let a = track("tidal:801", "Song", "Artist");
        let b = track("qobuz:802", "Song", "Artist");
        let old = recording_id(&conn, &a).unwrap();
        assert_eq!(old, recording_id(&conn, &b).unwrap());
        listen(&conn, &a, 1_000_000, 180.0, "qualified", "completed");
        let first = RecordingEvidence {
            isrc: Some("AA1234567890".into()),
            ..Default::default()
        };
        let second = RecordingEvidence {
            isrc: Some("BB1234567890".into()),
            ..Default::default()
        };
        let new_a = canonical_id_with_evidence(&conn, &a, Some(&first)).unwrap();
        let new_b = canonical_id_with_evidence(&conn, &b, Some(&second)).unwrap();
        assert_ne!(new_a, new_b);
        assert_eq!(
            conn.query_row("SELECT recording_id FROM playback_history", [], |r| r
                .get::<_, String>(0))
                .unwrap(),
            old
        );
    }
    #[test]
    fn canonical_copies_do_not_multiply_session_affinity() {
        let conn = db::init_db(":memory:").unwrap();
        let a = track("session-original", "Song", "Artist");
        let alias = track("tidal:803", "Song", "Artist");
        let b = track("session-new", "New song", "Artist");
        let now = 1_000_000;
        listen(&conn, &a, now, 180.0, "qualified", "completed");
        let one = rank(&conn, request("home", vec![a.clone(), b.clone()]), now).unwrap();
        let many = rank(
            &conn,
            request("home", vec![a.clone(), alias.clone(), a, alias, b]),
            now,
        )
        .unwrap();
        assert_eq!(
            one.tracks.iter().map(|t| &t.path).collect::<Vec<_>>(),
            many.tracks.iter().map(|t| &t.path).collect::<Vec<_>>()
        );
    }
    #[test]
    fn history_outside_candidate_pool_still_supplies_artist_penalty_and_taste() {
        let conn = db::init_db(":memory:").unwrap();
        let now = 1_000_000;
        let a = track("history-negative-a", "Fresh", "Artist");
        let b = track("history-negative-b", "Other fresh", "Other");
        for i in 0..3 {
            listen(
                &conn,
                &track(
                    &format!("historical-skip-{i}"),
                    &format!("Skipped{i}"),
                    "Artist",
                ),
                now,
                10.0,
                "observed",
                "skipped",
            );
        }
        assert_eq!(
            rank(&conn, request("home", vec![a, b.clone()]), now)
                .unwrap()
                .tracks[0]
                .path,
            b.path
        );
        let liked = track("historical-liked", "Listened song", "Fav artist");
        listen(&conn, &liked, now, 180.0, "qualified", "completed");
        let next = track("historical-next", "Next song", "Fav artist");
        let unrelated = track("historical-unrelated", "Unrelated", "Other");
        let result = rank(
            &conn,
            request("discovery", vec![next.clone(), unrelated]),
            now,
        )
        .unwrap();
        assert_eq!(result.tracks.len(), 1);
        assert_eq!(result.tracks[0].path, next.path);
    }
    #[test]
    fn qualified_unknown_duration_uses_actual_two_minutes() {
        let conn = db::init_db(":memory:").unwrap();
        let t = track("unknown-duration", "Song", "Artist");
        let now = 1_000_000;
        listen(&conn, &t, now, 119.0, "qualified", "stopped");
        conn.execute("UPDATE playback_history SET duration=NULL", [])
            .unwrap();
        assert!(evidence(&conn, now).unwrap().is_empty());
        conn.execute("UPDATE playback_history SET listened_seconds=120", [])
            .unwrap();
        let id = recording_id(&conn, &t).unwrap();
        assert_eq!(evidence(&conn, now).unwrap()[&id].qualified.len(), 1);
    }
    #[test]
    fn artist_penalty_needs_three_distinct_recent_skipped_recordings() {
        let conn = db::init_db(":memory:").unwrap();
        let now = 1_000_000;
        let a = track("artist-negative-a", "Fresh", "Artist");
        let b = track("artist-negative-b", "Other fresh", "Other");
        let mut candidates = vec![a.clone(), b.clone()];
        for index in 0..2 {
            let skipped = track(
                &format!("skip-{index}"),
                &format!("Skipped{index}"),
                "Artist",
            );
            listen(&conn, &skipped, now, 10.0, "observed", "skipped");
            candidates.push(skipped);
        }
        assert_eq!(
            rank(&conn, request("home", candidates.clone()), now)
                .unwrap()
                .tracks[0]
                .path,
            a.path
        );
        let skipped = track("skip-2", "Skipped2", "Artist");
        listen(&conn, &skipped, now, 10.0, "observed", "skipped");
        candidates.push(skipped);
        assert_eq!(
            rank(&conn, request("home", candidates), now)
                .unwrap()
                .tracks[0]
                .path,
            b.path
        );
    }
    #[test]
    fn spotlight_and_supermix_use_supported_candidate_quotas() {
        let conn = db::init_db(":memory:").unwrap();
        let mut spotlight = request("spotlight", vec![]);
        spotlight.limit = 10;
        spotlight.seed = Some(track("spotlight-seed", "Seed", "Seed artist"));
        for i in 0..7 {
            spotlight.candidates.push(track(
                &format!("spotlight-{i}"),
                &format!("Song{i}"),
                "Seed artist",
            ));
        }
        for i in 0..3 {
            let related = track(
                &format!("related-{i}"),
                &format!("Related{i}"),
                &format!("Related artist{i}"),
            );
            spotlight.relatedness.insert(related.path.clone(), 0.6);
            spotlight.candidates.push(related);
        }
        let ranked = rank(&conn, spotlight, 1_000_000).unwrap();
        assert_eq!(ranked.tracks.len(), 10);
        assert_eq!(
            ranked
                .tracks
                .iter()
                .filter(|t| t.artist.as_deref() == Some("Seed artist"))
                .count(),
            7
        );
        let mut mix = request("supermix", vec![]);
        mix.limit = 20;
        for i in 0..30 {
            let mut favorite = track(
                &format!("mix-familiar-{i}"),
                &format!("Favorite{i}"),
                &format!("Artist{i}"),
            );
            favorite.loved = Some(1);
            mix.candidates.push(favorite);
            mix.candidates.push(track(
                &format!("mix-adjacent-{i}"),
                &format!("Adjacent{i}"),
                &format!("Artist{i}"),
            ));
            let new = track(
                &format!("mix-new-{i}"),
                &format!("New{i}"),
                &format!("New artist{i}"),
            );
            mix.relatedness.insert(new.path.clone(), 0.5);
            mix.candidates.push(new);
        }
        let ranked = rank(&conn, mix, 1_000_000).unwrap();
        assert_eq!(ranked.tracks.len(), 20);
        assert_eq!(
            ranked.tracks.iter().filter(|t| t.loved == Some(1)).count(),
            12
        );
        assert_eq!(
            ranked
                .tracks
                .iter()
                .filter(|t| t.path.contains("mix-adjacent"))
                .count(),
            5
        );
        assert_eq!(
            ranked
                .tracks
                .iter()
                .filter(|t| t.path.contains("mix-new"))
                .count(),
            3
        );
    }
    #[test]
    fn legacy_positive_history_is_only_a_weak_daily_prior() {
        let conn = db::init_db(":memory:").unwrap();
        let t = track("legacy-evidence", "Old song", "Artist");
        let now = 1_000_000;
        for _ in 0..5 {
            conn.execute("INSERT INTO playback_history(track_path,title,artist,duration,format,timestamp,duration_played) VALUES (?1,?2,?3,180,'FLAC',?4,120)",params![t.path,t.title,t.artist,now]).unwrap();
        }
        let id = recording_id(&conn, &t).unwrap();
        let all = evidence(&conn, now).unwrap();
        assert_eq!(all[&id].positive, 0.25);
        assert!(all[&id].qualified.is_empty());
        assert_eq!(all[&id].session, 0.0);
    }
    #[test]
    fn conflicting_isrc_or_version_cannot_alias_and_provider_formats_are_not_local() {
        let conn = db::init_db(":memory:").unwrap();
        let a = track("tidal:1", "Song", "Artist");
        let b = track("qobuz:2", "Song", "Artist");
        let c = track("youtube:abcdefghijk", "Song", "Artist");
        let first = RecordingEvidence {
            isrc: Some("AA1234567890".into()),
            ..Default::default()
        };
        let second = RecordingEvidence {
            isrc: Some("BB1234567890".into()),
            ..Default::default()
        };
        assert_ne!(
            canonical_id_with_evidence(&conn, &a, Some(&first)).unwrap(),
            canonical_id_with_evidence(&conn, &b, Some(&second)).unwrap()
        );
        assert_ne!(
            canonical_id_with_evidence(&conn, &a, Some(&first)).unwrap(),
            recording_id(&conn, &c).unwrap()
        );
        let mut numeric = empty_track();
        numeric.path = "123".into();
        numeric.format = Some("Tidal FLAC".into());
        assert_eq!(source_key(&numeric), "tidal:123");
        numeric.format = Some("Qobuz FLAC".into());
        assert_eq!(source_key(&numeric), "qobuz:123");
    }
    #[test]
    fn session_expires_after_thirty_minutes_without_a_qualified_listen() {
        let conn = db::init_db(":memory:").unwrap();
        let t = track("session", "Song", "Artist");
        let now = 1_000_000;
        listen(&conn, &t, now - 1801, 180.0, "qualified", "completed");
        let id = recording_id(&conn, &t).unwrap();
        assert_eq!(evidence(&conn, now).unwrap()[&id].session, 0.0);
    }
    fn track(path: &str, title: &str, artist: &str) -> Track {
        let path = if path.starts_with("http") || path.contains(':') {
            path.to_owned()
        } else {
            let directory = std::env::temp_dir().join("aideo-ranker-fixtures");
            std::fs::create_dir_all(&directory).unwrap();
            let file = directory.join(path);
            std::fs::write(&file, b"fixture").unwrap();
            file.to_string_lossy().into_owned()
        };
        Track {
            path,
            title: Some(title.into()),
            artist: Some(artist.into()),
            duration: Some(180.0),
            ..empty_track()
        }
    }
    fn request(surface: &str, candidates: Vec<Track>) -> RecommendationRequest {
        RecommendationRequest {
            surface: surface.into(),
            seed: None,
            candidates,
            mode: "hybrid".into(),
            provider: "our".into(),
            allow_local: None,
            discovery_level: 0.5,
            excluded_paths: vec![],
            limit: 100,
            generation: 12,
            period_days: None,
            mood: None,
            recording_evidence: HashMap::new(),
            relatedness: HashMap::new(),
            provenance: HashMap::new(),
        }
    }
    fn listen(conn: &Connection, t: &Track, now: i64, seconds: f64, quality: &str, end: &str) {
        let id = recording_id(conn, t).unwrap();
        conn.execute("INSERT INTO playback_history(track_path,timestamp,recording_id,listened_seconds,signal_quality,end_reason,duration,title,artist,format,genre) VALUES (?1,?2,?3,?4,?5,?6,180,?7,?8,?9,?10)",params![t.path,now,id,seconds,quality,end,t.title,t.artist,t.format,t.genre]).unwrap();
    }
    #[test]
    fn identity_preserves_versions_and_requires_duration() {
        let conn = db::init_db(":memory:").unwrap();
        let a = track("a", "Song", "Artist");
        let b = track("tidal:123", "Song", "Artist");
        assert_eq!(
            recording_id(&conn, &a).unwrap(),
            recording_id(&conn, &b).unwrap()
        );
        let live = track("live", "Song (Live)", "Artist");
        assert_ne!(
            recording_id(&conn, &a).unwrap(),
            recording_id(&conn, &live).unwrap()
        );
        let mut unknown = b.clone();
        unknown.path = "unknown".into();
        unknown.duration = None;
        assert_ne!(
            recording_id(&conn, &a).unwrap(),
            recording_id(&conn, &unknown).unwrap()
        );
        assert_eq!(
            source_key(&track("https://youtu.be/abcdefghijk", "S", "A")),
            "youtube:abcdefghijk"
        );
    }
    #[test]
    fn qualified_evidence_ignores_starts_errors_and_caps_daily() {
        let conn = db::init_db(":memory:").unwrap();
        let t = track("a", "Song", "Artist");
        let now = 1_000_000;
        listen(&conn, &t, now, 0.0, "legacy", "started");
        listen(&conn, &t, now, 20.0, "observed", "error");
        let id = recording_id(&conn, &t).unwrap();
        assert!(evidence(&conn, now).unwrap().is_empty());
        for _ in 0..5 {
            listen(&conn, &t, now, 180.0, "qualified", "completed");
        }
        let all = evidence(&conn, now).unwrap();
        assert_eq!(all[&id].qualified.len(), 3);
        assert_eq!(posterior(&all[&id]), 5.0 / 7.0);
    }
    #[test]
    fn canonical_dislike_blocks_all_copies_and_is_idempotent() {
        let conn = db::init_db(":memory:").unwrap();
        let a = track("a", "Song", "Artist");
        let b = track("tidal:123", "Song", "Artist");
        set_interest(&conn, &a, false, None).unwrap();
        set_interest(&conn, &a, false, None).unwrap();
        assert!(rank(
            &conn,
            request("home", vec![a.clone(), b.clone()]),
            1_000_000
        )
        .unwrap()
        .tracks
        .is_empty());
        set_interest(&conn, &b, true, None).unwrap();
        assert_eq!(
            rank(&conn, request("home", vec![a, b]), 1_000_000)
                .unwrap()
                .tracks
                .len(),
            1
        );
    }
    #[test]
    fn repeat_windows_and_small_pools_are_truthful() {
        let conn = db::init_db(":memory:").unwrap();
        let a = track("a", "Song", "Artist");
        let now = 10_000_000;
        listen(&conn, &a, now - 8 * 86400, 180.0, "qualified", "completed");
        listen(&conn, &a, now - 9 * 86400, 180.0, "qualified", "completed");
        assert!(rank(&conn, request("on_repeat", vec![a.clone()]), now)
            .unwrap()
            .tracks
            .is_empty());
        assert_eq!(
            rank(&conn, request("heavy_rotation", vec![a.clone()]), now)
                .unwrap()
                .tracks
                .len(),
            1
        );
        assert!(rank(&conn, request("forgotten_gems", vec![a.clone()]), now)
            .unwrap()
            .tracks
            .is_empty());
        assert_eq!(
            rank(&conn, request("forgotten_gems", vec![a]), now + 31 * 86400)
                .unwrap()
                .tracks
                .len(),
            1
        );
    }
    #[test]
    fn missing_sonics_have_no_similarity_and_half_tempo_matches() {
        let mut a = track("a", "Song", "Artist");
        let mut b = track("b", "Other", "Other");
        assert_eq!(sonic(&a, &b), None);
        a.bpm = Some(80.0);
        b.bpm = Some(160.0);
        assert_eq!(sonic(&a, &b), Some(1.0));
    }
    #[test]
    fn discovery_increases_related_novelty_without_rescuing_unrelated() {
        let conn = db::init_db(":memory:").unwrap();
        let now = 10_000_000;
        let mut a = track("a", "Favorite", "Artist");
        let mut b = track("b", "Fresh", "Other artist");
        let c = track("c", "Unrelated", "Other");
        a.energy = Some(0.0);
        b.energy = Some(0.7);
        for day in 0..12 {
            listen(
                &conn,
                &a,
                now - day * 86400,
                180.0,
                "qualified",
                "completed",
            );
        }
        let mut low = request("discovery", vec![a.clone(), b.clone(), c.clone()]);
        low.discovery_level = 0.0;
        let mut high = request("discovery", vec![a, b, c]);
        high.discovery_level = 1.0;
        let familiar = rank(&conn, low, now).unwrap();
        let discovery = rank(&conn, high, now).unwrap();
        assert!(familiar.tracks[0].path.ends_with("a"));
        assert!(discovery.tracks[0].path.ends_with("b"));
        assert!(discovery.tracks.iter().all(|t| !t.path.ends_with("c")));
    }
    #[test]
    fn diversity_returns_short_pool_and_mood_requires_evidence() {
        let conn = db::init_db(":memory:").unwrap();
        let candidates = (0..5)
            .map(|i| track(&format!("{i}"), &format!("Song{i}"), "Artist"))
            .collect::<Vec<_>>();
        assert_eq!(
            rank(&conn, request("home", candidates.clone()), 1_000_000)
                .unwrap()
                .tracks
                .len(),
            2
        );
        let mut mood = request("mood", candidates);
        mood.mood = Some("happy".into());
        assert!(rank(&conn, mood, 1_000_000).unwrap().tracks.is_empty());
    }
}
