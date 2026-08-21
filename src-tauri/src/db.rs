use rusqlite::{Connection, Result, params};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Track {
    pub id: i32,
    pub path: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration: Option<f64>,
    pub format: Option<String>,
    pub lyric_offset: i32,
    pub loved: Option<i32>,
    pub disliked: Option<i32>,
    pub cover_url: Option<String>,
    pub path_hash: Option<String>,
    pub bpm: Option<f64>,
    pub energy: Option<f64>,
    pub bass_ratio: Option<f64>,
    pub treble_ratio: Option<f64>,
    pub replaygain_gain: Option<f64>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Playlist {
    pub id: i32,
    pub name: String,
}

pub(crate) fn column_exists(conn: &Connection, table: &str, column: &str) -> bool {
    if !table.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return false;
    }
    let mut stmt = match conn.prepare(&format!("PRAGMA table_info({})", table)) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let mut rows = match stmt.query([]) {
        Ok(r) => r,
        Err(_) => return false,
    };
    while let Ok(Some(row)) = rows.next() {
        if let Ok(name) = row.get::<_, String>(1) {
            if name == column {
                return true;
            }
        }
    }
    false
}

pub fn init_db(db_path: &str) -> Result<Connection> {
    let mut conn = Connection::open(db_path)?;
    
    // Performance Tuning: Enable WAL (Write-Ahead Logging) and Foreign Keys
    let _ = conn.execute("PRAGMA journal_mode = WAL", []);
    let _ = conn.execute("PRAGMA synchronous = NORMAL", []);
    conn.execute("PRAGMA foreign_keys = ON", [])?;
    
    // Create base table if missing
    conn.execute(
        "CREATE TABLE IF NOT EXISTS tracks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE NOT NULL,
            title TEXT,
            artist TEXT,
            album TEXT,
            duration REAL,
            format TEXT
        )",
        [],
    )?;

    // Safe Schema Alterations
    if !column_exists(&conn, "tracks", "lyric_offset") {
        conn.execute("ALTER TABLE tracks ADD COLUMN lyric_offset INTEGER DEFAULT 0", [])?;
    }
    if !column_exists(&conn, "tracks", "loved") {
        conn.execute("ALTER TABLE tracks ADD COLUMN loved INTEGER DEFAULT 0", [])?;
    }
    if !column_exists(&conn, "tracks", "disliked") {
        conn.execute("ALTER TABLE tracks ADD COLUMN disliked INTEGER DEFAULT 0", [])?;
    }
    if !column_exists(&conn, "tracks", "cover_url") {
        conn.execute("ALTER TABLE tracks ADD COLUMN cover_url TEXT", [])?;
    }
    if !column_exists(&conn, "tracks", "path_hash") {
        conn.execute("ALTER TABLE tracks ADD COLUMN path_hash TEXT", [])?;
    }
    if !column_exists(&conn, "tracks", "bpm") {
        conn.execute("ALTER TABLE tracks ADD COLUMN bpm REAL DEFAULT 0.0", [])?;
    }
    if !column_exists(&conn, "tracks", "energy") {
        conn.execute("ALTER TABLE tracks ADD COLUMN energy REAL DEFAULT 0.5", [])?;
    }
    if !column_exists(&conn, "tracks", "bass_ratio") {
        conn.execute("ALTER TABLE tracks ADD COLUMN bass_ratio REAL DEFAULT 0.33", [])?;
    }
    if !column_exists(&conn, "tracks", "treble_ratio") {
        conn.execute("ALTER TABLE tracks ADD COLUMN treble_ratio REAL DEFAULT 0.33", [])?;
    }
    if !column_exists(&conn, "tracks", "replaygain_gain") {
        conn.execute("ALTER TABLE tracks ADD COLUMN replaygain_gain REAL DEFAULT 0.0", [])?;
    }
    if !column_exists(&conn, "tracks", "track_number") {
        conn.execute("ALTER TABLE tracks ADD COLUMN track_number INTEGER", [])?;
    }
    if !column_exists(&conn, "tracks", "disc_number") {
        conn.execute("ALTER TABLE tracks ADD COLUMN disc_number INTEGER", [])?;
    }

    // Create playlist tables
    conn.execute(
        "CREATE TABLE IF NOT EXISTS playlists (
            id INTEGER PRIMARY KEY,
            name TEXT UNIQUE NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS playlist_tracks (
            playlist_id INTEGER,
            track_path TEXT,
            position INTEGER,
            FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
            PRIMARY KEY(playlist_id, track_path)
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS smart_playlists (
            id INTEGER PRIMARY KEY,
            name TEXT UNIQUE NOT NULL,
            rules_json TEXT NOT NULL
        )",
        [],
    )?;

    // Migration: Remove foreign key constraint on track_path from playlist_tracks.
    let has_tracks_fk: bool = {
        let mut stmt = conn.prepare("PRAGMA foreign_key_list(playlist_tracks)")?;
        let mut rows = stmt.query([])?;
        let mut has_fk = false;
        while let Some(row) = rows.next()? {
            let table: String = row.get(2)?;
            if table == "tracks" {
                has_fk = true;
                break;
            }
        }
        has_fk
    };

    if has_tracks_fk {
        println!("[Database] Migrating playlist_tracks table: removing tracks(path) foreign key constraint...");
        let tx = conn.transaction()?;
        tx.execute("ALTER TABLE playlist_tracks RENAME TO temp_playlist_tracks", [])?;
        tx.execute(
            "CREATE TABLE playlist_tracks (
                playlist_id INTEGER,
                track_path TEXT,
                position INTEGER,
                FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
                PRIMARY KEY(playlist_id, track_path)
            )",
            [],
        )?;
        tx.execute(
            "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_path, position)
             SELECT playlist_id, track_path, position FROM temp_playlist_tracks",
            [],
        )?;
        tx.execute("DROP TABLE temp_playlist_tracks", [])?;
        tx.commit()?;
        println!("[Database] Migration completed successfully!");
    }

    // Create playback history table for future Spotify Wrapped
    conn.execute(
        "CREATE TABLE IF NOT EXISTS playback_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            track_path TEXT NOT NULL,
            title TEXT,
            artist TEXT,
            album TEXT,
            duration REAL,
            format TEXT,
            timestamp INTEGER NOT NULL,
            duration_played REAL DEFAULT 0.0,
            skipped INTEGER DEFAULT 0,
            synced INTEGER DEFAULT 0,
            genre TEXT,
            playback_source TEXT
        )",
        [],
    )?;

    // Migration: Add synced, genre, and playback_source columns if they don't exist
    let _ = conn.execute("ALTER TABLE playback_history ADD COLUMN synced INTEGER DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE playback_history ADD COLUMN genre TEXT", []);
    let _ = conn.execute("ALTER TABLE playback_history ADD COLUMN playback_source TEXT", []);

    // Migration: Recover missing playlist tracks
    if let Ok(mut stmt) = conn.prepare(
        "SELECT DISTINCT pt.track_path 
         FROM playlist_tracks pt 
         LEFT JOIN tracks t ON pt.track_path = t.path 
         WHERE t.path IS NULL"
    ) {
        if let Ok(missing_paths) = stmt.query_map([], |row| row.get::<_, String>(0)) {
            let missing_paths: Vec<String> = missing_paths.filter_map(|r| r.ok()).collect();
            
            let favorite_playlist_id: Option<i32> = conn.query_row(
                "SELECT id FROM playlists WHERE name = 'Favorite Songs'",
                [],
                |row| row.get(0),
            ).ok();

            for path in missing_paths {
                let is_favorite = if let Some(fav_id) = favorite_playlist_id {
                    let count: i64 = conn.query_row(
                        "SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = ?1 AND track_path = ?2",
                        rusqlite::params![fav_id, path],
                        |row| row.get(0),
                    ).unwrap_or(0);
                    count > 0
                } else {
                    false
                };

                let loved_val = if is_favorite { 1 } else { 0 };

                let metadata: Option<(Option<String>, Option<String>, Option<String>, Option<f64>, Option<String>)> = conn.query_row(
                    "SELECT title, artist, album, duration, format 
                     FROM playback_history 
                     WHERE track_path = ?1 
                     ORDER BY timestamp DESC 
                     LIMIT 1",
                    rusqlite::params![path],
                    |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
                ).ok();

                let (title, artist, album, duration, format) = match metadata {
                    Some(meta) => meta,
                    None => {
                        let format_str = if path.contains("tidal.com") || path.contains("api.tidal.com") {
                            "Tidal FLAC".to_string()
                        } else if path.starts_with("http") {
                            "YouTube Direct".to_string()
                        } else {
                            "MP3/FLAC".to_string()
                        };
                        (None, None, None, None, Some(format_str))
                    }
                };

                let mut cover_url: Option<String> = None;
                if path.starts_with("http") {
                    if let Some(pos) = path.find("v=") {
                        let start = pos + 2;
                        let end = path[start..].find('&').map(|idx| start + idx).unwrap_or(path.len());
                        let id = &path[start..end];
                        if id.len() == 11 {
                            cover_url = Some(format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", id));
                        }
                    } else if path.contains("youtu.be/") {
                        if let Some(pos) = path.rfind('/') {
                            let id = &path[pos+1..];
                            if id.len() == 11 {
                                cover_url = Some(format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", id));
                            }
                        }
                    }
                }

                let _ = conn.execute(
                    "INSERT INTO tracks (path, title, artist, album, duration, format, loved, cover_url) 
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    rusqlite::params![path, title, artist, album, duration, format, loved_val, cover_url],
                );
            }
        }
    }

    // Fix any existing YouTube tracks that have NULL cover_url
    if let Ok(mut stmt) = conn.prepare("SELECT path FROM tracks WHERE cover_url IS NULL AND (path LIKE '%youtube.com%' OR path LIKE '%youtu.be%')") {
        if let Ok(paths_to_fix) = stmt.query_map([], |row| row.get::<_, String>(0)) {
            for path_res in paths_to_fix {
                if let Ok(path) = path_res {
                    let mut video_id = None;
                    if let Some(pos) = path.find("v=") {
                        let start = pos + 2;
                        let end = path[start..].find('&').map(|idx| start + idx).unwrap_or(path.len());
                        let id = &path[start..end];
                        if id.len() == 11 {
                            video_id = Some(id.to_string());
                        }
                    } else if path.contains("youtu.be/") {
                        if let Some(pos) = path.rfind('/') {
                            let id = &path[pos+1..];
                            if id.len() == 11 {
                                video_id = Some(id.to_string());
                            }
                        }
                    }
                    if let Some(id) = video_id {
                        let cover_url = format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", id);
                        let _ = conn.execute("UPDATE tracks SET cover_url = ?1 WHERE path = ?2", rusqlite::params![cover_url, path]);
                    }
                }
            }
        }
    }

    // Backfill any missing path_hash entries
    if let Ok(mut stmt) = conn.prepare("SELECT path FROM tracks WHERE path_hash IS NULL") {
        if let Ok(paths) = stmt.query_map([], |row| row.get::<_, String>(0)) {
            let paths_to_hash: Vec<String> = paths.filter_map(|r| r.ok()).collect();
            for path in paths_to_hash {
                let hash = format!("{:x}", md5::compute(path.as_bytes()));
                let _ = conn.execute("UPDATE tracks SET path_hash = ?1 WHERE path = ?2", rusqlite::params![hash, path]);
            }
        }
    }

    // Add high-performance indexes for library filtering and analytics
    let _ = conn.execute("CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist)", []);
    let _ = conn.execute("CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album)", []);
    let _ = conn.execute("CREATE INDEX IF NOT EXISTS idx_tracks_album_order ON tracks(album, disc_number, track_number)", []);
    let _ = conn.execute("CREATE INDEX IF NOT EXISTS idx_tracks_loved ON tracks(loved)", []);
    let _ = conn.execute("CREATE INDEX IF NOT EXISTS idx_tracks_path_hash ON tracks(path_hash)", []);
    let _ = conn.execute("CREATE INDEX IF NOT EXISTS idx_history_timestamp ON playback_history(timestamp)", []);
    let _ = conn.execute("CREATE INDEX IF NOT EXISTS idx_playlist_tracks_pos ON playlist_tracks(playlist_id, position)", []);

    Ok(conn)
}

pub fn save_tracks(conn: &mut Connection, tracks: &mut [Track]) -> Result<()> {
    let tx = conn.transaction()?;
    for track in tracks {
        let hash = track.path_hash.clone().unwrap_or_else(|| format!("{:x}", md5::compute(track.path.as_bytes())));
        track.path_hash = Some(hash.clone());
        tx.execute(
            "INSERT INTO tracks (path, title, artist, album, duration, format, lyric_offset, loved, cover_url, track_number, disc_number, path_hash, replaygain_gain)
             VALUES (:path, :title, :artist, :album, :duration, :format, :lyric_offset, COALESCE(:loved, 0), :cover_url, :track_number, :disc_number, :path_hash, :replaygain_gain)
             ON CONFLICT(path) DO UPDATE SET
                 title = excluded.title,
                 artist = excluded.artist,
                 album = excluded.album,
                 duration = excluded.duration,
                 format = excluded.format,
                 cover_url = COALESCE(excluded.cover_url, tracks.cover_url),
                 track_number = COALESCE(excluded.track_number, tracks.track_number),
                 disc_number = COALESCE(excluded.disc_number, tracks.disc_number),
                 path_hash = COALESCE(excluded.path_hash, tracks.path_hash),
                 replaygain_gain = COALESCE(excluded.replaygain_gain, tracks.replaygain_gain)",
            rusqlite::named_params! {
                ":path": &track.path,
                ":title": &track.title,
                ":artist": &track.artist,
                ":album": &track.album,
                ":duration": &track.duration,
                ":format": &track.format,
                ":lyric_offset": &track.lyric_offset,
                ":loved": &track.loved,
                ":cover_url": &track.cover_url,
                ":track_number": &track.track_number,
                ":disc_number": &track.disc_number,
                ":path_hash": &hash,
                ":replaygain_gain": &track.replaygain_gain,
            },
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn update_track_metadata(conn: &Connection, path: &str, title: &str, artist: &str, album: &str) -> Result<()> {
    conn.execute(
        "UPDATE tracks SET title = ?1, artist = ?2, album = ?3 WHERE path = ?4",
        rusqlite::params![title, artist, album, path],
    )?;
    Ok(())
}

pub fn update_track_offset(conn: &Connection, path: &str, offset: i32) -> Result<()> {
    conn.execute(
        "UPDATE tracks SET lyric_offset = ?1 WHERE path = ?2",
        rusqlite::params![offset, path],
    )?;
    Ok(())
}

pub fn update_track_sonic_profile(conn: &Connection, path: &str, bpm: f64, energy: f64, bass_ratio: f64, treble_ratio: f64, replaygain_gain: Option<f64>) -> Result<()> {
    conn.execute(
        "UPDATE tracks SET bpm = ?1, energy = ?2, bass_ratio = ?3, treble_ratio = ?4, replaygain_gain = COALESCE(replaygain_gain, ?5) WHERE path = ?6",
        rusqlite::params![bpm, energy, bass_ratio, treble_ratio, replaygain_gain, path],
    )?;
    Ok(())
}

pub fn get_all_tracks(conn: &Connection) -> Result<Vec<Track>> {
    let mut stmt = conn.prepare("SELECT id, path, title, artist, album, duration, format, lyric_offset, loved, disliked, cover_url, bpm, energy, bass_ratio, treble_ratio, replaygain_gain, path_hash, track_number, disc_number FROM tracks")?;
    let track_iter = stmt.query_map([], |row| {
        let path: String = row.get(1)?;
        let db_hash: Option<String> = row.get(16).ok();
        let path_hash = db_hash.or_else(|| Some(format!("{:x}", md5::compute(path.as_bytes()))));
        Ok(Track {
            id: row.get(0)?,
            path,
            title: row.get(2)?,
            artist: row.get(3)?,
            album: row.get(4)?,
            duration: row.get(5)?,
            format: row.get(6)?,
            lyric_offset: row.get(7).unwrap_or(0),
            loved: Some(row.get(8).unwrap_or(0)),
            disliked: Some(row.get(9).unwrap_or(0)),
            cover_url: row.get(10).ok(),
            path_hash,
            bpm: row.get(11).ok(),
            energy: row.get(12).ok(),
            bass_ratio: row.get(13).ok(),
            treble_ratio: row.get(14).ok(),
            replaygain_gain: row.get(15).ok(),
            track_number: row.get(17).ok(),
            disc_number: row.get(18).ok(),
        })
    })?;

    let mut tracks = Vec::new();
    for track in track_iter {
        tracks.push(track?);
    }
    Ok(tracks)
}

pub fn create_playlist(conn: &Connection, name: &str) -> Result<i32> {
    conn.execute("INSERT INTO playlists (name) VALUES (?1)", params![name])?;
    Ok(conn.last_insert_rowid() as i32)
}

pub fn delete_playlist(conn: &Connection, id: i32) -> Result<()> {
    conn.execute("DELETE FROM playlists WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn get_playlists(conn: &Connection) -> Result<Vec<Playlist>> {
    let mut stmt = conn.prepare("SELECT id, name FROM playlists")?;
    let playlist_iter = stmt.query_map([], |row| {
        Ok(Playlist {
            id: row.get(0)?,
            name: row.get(1)?,
        })
    })?;

    let mut playlists = Vec::new();
    for p in playlist_iter {
        playlists.push(p?);
    }
    Ok(playlists)
}

pub fn add_to_playlist(conn: &Connection, playlist_id: i32, track_path: &str) -> Result<()> {
    let pos: i32 = conn.query_row(
        "SELECT COALESCE(MAX(position), 0) + 1 FROM playlist_tracks WHERE playlist_id = ?1",
        params![playlist_id],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_path, position) VALUES (?1, ?2, ?3)",
        params![playlist_id, track_path, pos],
    )?;
    Ok(())
}

pub fn remove_from_playlist(conn: &Connection, playlist_id: i32, track_path: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_path = ?2",
        params![playlist_id, track_path],
    )?;
    Ok(())
}

pub fn reorder_playlist(conn: &mut Connection, playlist_id: i32, track_paths: &[String]) -> Result<()> {
    let tx = conn.transaction()?;
    for (i, path) in track_paths.iter().enumerate() {
        tx.execute(
            "UPDATE playlist_tracks SET position = ?1 WHERE playlist_id = ?2 AND track_path = ?3",
            params![i as i32 + 1, playlist_id, path],
        )?;
    }
    tx.commit()?;
    Ok(())
}

pub fn get_playlist_tracks(conn: &Connection, playlist_id: i32) -> Result<Vec<Track>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.path, t.title, t.artist, t.album, t.duration, t.format, t.lyric_offset, t.loved, t.disliked, t.cover_url, t.bpm, t.energy, t.bass_ratio, t.treble_ratio, t.replaygain_gain, t.track_number, t.disc_number 
         FROM playlist_tracks pt 
         JOIN tracks t ON pt.track_path = t.path 
         WHERE pt.playlist_id = ?1 
         ORDER BY pt.position ASC"
    )?;
    let track_iter = stmt.query_map(params![playlist_id], |row| {
        let path: String = row.get(1)?;
        let path_hash = Some(format!("{:x}", md5::compute(path.as_bytes())));
        Ok(Track {
            id: row.get::<_, Option<i32>>(0)?.unwrap_or(0),
            path,
            title: row.get(2)?,
            artist: row.get(3)?,
            album: row.get(4)?,
            duration: row.get(5)?,
            format: row.get(6)?,
            lyric_offset: row.get::<_, Option<i32>>(7)?.unwrap_or(0),
            loved: Some(row.get::<_, Option<i32>>(8)?.unwrap_or(0)),
            disliked: Some(row.get::<_, Option<i32>>(9)?.unwrap_or(0)),
            cover_url: row.get(10).ok(),
            path_hash,
            bpm: row.get(11).ok(),
            energy: row.get(12).ok(),
            bass_ratio: row.get(13).ok(),
            treble_ratio: row.get(14).ok(),
            replaygain_gain: row.get(15).ok(),
            track_number: row.get(16).ok(),
            disc_number: row.get(17).ok(),
        })
    })?;

    let mut tracks = Vec::new();
    for track in track_iter {
        if let Ok(t) = track {
            tracks.push(t);
        }
    }
    Ok(tracks)
}

pub fn delete_track(conn: &Connection, path: &str) -> Result<()> {
    conn.execute("DELETE FROM tracks WHERE path = ?1", rusqlite::params![path])?;
    conn.execute("DELETE FROM playlist_tracks WHERE track_path = ?1", rusqlite::params![path])?;
    Ok(())
}

pub fn toggle_love_track(
    conn: &Connection,
    path: &str,
    loved: bool,
    title: Option<&str>,
    artist: Option<&str>,
    album: Option<&str>,
    duration: Option<f64>,
    format: Option<&str>,
    cover_url: Option<&str>,
) -> Result<()> {
    let loved_int = if loved { 1 } else { 0 };

    conn.execute(
        "INSERT INTO tracks (path, title, artist, album, duration, format, loved, disliked, cover_url)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)
         ON CONFLICT(path) DO UPDATE SET
             loved = ?7,
             disliked = CASE WHEN ?7 = 1 THEN 0 ELSE tracks.disliked END,
             title = COALESCE(excluded.title, tracks.title),
             artist = COALESCE(excluded.artist, tracks.artist),
             album = COALESCE(excluded.album, tracks.album),
             duration = COALESCE(excluded.duration, tracks.duration),
             format = COALESCE(excluded.format, tracks.format),
             cover_url = COALESCE(excluded.cover_url, tracks.cover_url)",
        rusqlite::params![path, title, artist, album, duration, format, loved_int, cover_url],
    )?;

    let playlist_name = "Favorite Songs";
    
    // Check if "Favorite Songs" playlist exists
    let playlist_id: i32 = match conn.query_row(
        "SELECT id FROM playlists WHERE name = ?1",
        rusqlite::params![playlist_name],
        |row| row.get(0),
    ) {
        Ok(id) => id,
        Err(_) => {
            // Create the playlist
            conn.execute("INSERT INTO playlists (name) VALUES (?1)", rusqlite::params![playlist_name])?;
            conn.last_insert_rowid() as i32
        }
    };

    if loved {
        // Insert into playlist_tracks with new position
        let pos: i32 = conn.query_row(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM playlist_tracks WHERE playlist_id = ?1",
            rusqlite::params![playlist_id],
            |row| row.get(0),
        ).unwrap_or(1);
        conn.execute(
            "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_path, position) VALUES (?1, ?2, ?3)",
            rusqlite::params![playlist_id, path, pos],
        )?;
    } else {
        // Remove from playlist_tracks
        conn.execute(
            "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_path = ?2",
            rusqlite::params![playlist_id, path],
        )?;
    }

    Ok(())
}

pub fn toggle_dislike_track(
    conn: &Connection,
    path: &str,
    disliked: bool,
    title: Option<&str>,
    artist: Option<&str>,
    album: Option<&str>,
    duration: Option<f64>,
    format: Option<&str>,
    cover_url: Option<&str>,
) -> Result<()> {
    let disliked_int = if disliked { 1 } else { 0 };

    conn.execute(
        "INSERT INTO tracks (path, title, artist, album, duration, format, disliked, loved, cover_url)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)
         ON CONFLICT(path) DO UPDATE SET
             disliked = ?7,
             loved = CASE WHEN ?7 = 1 THEN 0 ELSE tracks.loved END,
             title = COALESCE(excluded.title, tracks.title),
             artist = COALESCE(excluded.artist, tracks.artist),
             album = COALESCE(excluded.album, tracks.album),
             duration = COALESCE(excluded.duration, tracks.duration),
             format = COALESCE(excluded.format, tracks.format),
             cover_url = COALESCE(excluded.cover_url, tracks.cover_url)",
        rusqlite::params![path, title, artist, album, duration, format, disliked_int, cover_url],
    )?;

    if disliked {
        // Delete from Favorite Songs playlist if it was there
        if let Ok(playlist_id) = conn.query_row(
            "SELECT id FROM playlists WHERE name = 'Favorite Songs'",
            [],
            |row| row.get::<_, i32>(0),
        ) {
            let _ = conn.execute(
                "DELETE FROM playlist_tracks WHERE playlist_id = ?1 AND track_path = ?2",
                rusqlite::params![playlist_id, path],
            );
        }
    }

    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct SmartRule {
    pub field: String,
    pub operator: String,
    pub value: String,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct SmartPlaylistDef {
    pub match_all: bool,
    pub rules: Vec<SmartRule>,
    pub limit: Option<usize>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct SmartPlaylist {
    pub id: i32,
    pub name: String,
    pub rules_json: String,
}

pub fn create_smart_playlist(conn: &Connection, name: &str, rules_json: &str) -> Result<i32> {
    conn.execute(
        "INSERT INTO smart_playlists (name, rules_json) VALUES (?1, ?2)",
        params![name, rules_json],
    )?;
    Ok(conn.last_insert_rowid() as i32)
}

pub fn get_smart_playlists(conn: &Connection) -> Result<Vec<SmartPlaylist>> {
    let mut stmt = conn.prepare("SELECT id, name, rules_json FROM smart_playlists ORDER BY name ASC")?;
    let iter = stmt.query_map([], |row| {
        Ok(SmartPlaylist {
            id: row.get(0)?,
            name: row.get(1)?,
            rules_json: row.get(2)?,
        })
    })?;
    let mut list = Vec::new();
    for item in iter {
        if let Ok(sp) = item {
            list.push(sp);
        }
    }
    Ok(list)
}

pub fn delete_smart_playlist(conn: &Connection, id: i32) -> Result<()> {
    conn.execute("DELETE FROM smart_playlists WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn execute_smart_rules(conn: &Connection, rules_json: &str) -> Result<Vec<Track>> {
    let def: SmartPlaylistDef = serde_json::from_str(rules_json)
        .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;

    let mut where_clauses = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    for rule in &def.rules {
        let col = match rule.field.to_lowercase().as_str() {
            "title" => "t.title",
            "artist" => "t.artist",
            "album" => "t.album",
            "format" => "t.format",
            "loved" => "t.loved",
            "disliked" => "t.disliked",
            "bpm" => "t.bpm",
            "duration" => "t.duration",
            _ => continue,
        };

        match rule.operator.to_lowercase().as_str() {
            "contains" | "like" => {
                where_clauses.push(format!("{} LIKE ?", col));
                params.push(Box::new(format!("%{}%", rule.value)));
            }
            "equals" | "=" => {
                if let Ok(num) = rule.value.parse::<i32>() {
                    where_clauses.push(format!("{} = ?", col));
                    params.push(Box::new(num));
                } else if let Ok(num) = rule.value.parse::<f64>() {
                    where_clauses.push(format!("{} = ?", col));
                    params.push(Box::new(num));
                } else {
                    where_clauses.push(format!("{} = ?", col));
                    params.push(Box::new(rule.value.clone()));
                }
            }
            "greater_than" | ">" | ">=" => {
                if let Ok(num) = rule.value.parse::<f64>() {
                    where_clauses.push(format!("{} >= ?", col));
                    params.push(Box::new(num));
                }
            }
            "less_than" | "<" | "<=" => {
                if let Ok(num) = rule.value.parse::<f64>() {
                    where_clauses.push(format!("{} <= ?", col));
                    params.push(Box::new(num));
                }
            }
            _ => {}
        }
    }

    let join_op = if def.match_all { " AND " } else { " OR " };
    let where_sql = if where_clauses.is_empty() {
        "1=1".to_string()
    } else {
        where_clauses.join(join_op)
    };

    let limit_clause = match def.limit {
        Some(l) if l > 0 => format!(" LIMIT {}", l),
        _ => "".to_string(),
    };

    let query_str = format!(
        "SELECT t.id, t.path, t.title, t.artist, t.album, t.duration, t.format, t.lyric_offset, t.loved, t.disliked, t.cover_url, t.bpm, t.energy, t.bass_ratio, t.treble_ratio, t.replaygain_gain, t.track_number, t.disc_number FROM tracks t WHERE ({}) ORDER BY t.title ASC{}",
        where_sql, limit_clause
    );

    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let mut stmt = conn.prepare(&query_str)?;
    let track_iter = stmt.query_map(param_refs.as_slice(), |row| {
        let path: String = row.get(1)?;
        let path_hash = Some(format!("{:x}", md5::compute(path.as_bytes())));
        Ok(Track {
            id: row.get::<_, Option<i32>>(0)?.unwrap_or(0),
            path,
            title: row.get(2)?,
            artist: row.get(3)?,
            album: row.get(4)?,
            duration: row.get(5)?,
            format: row.get(6)?,
            lyric_offset: row.get::<_, Option<i32>>(7)?.unwrap_or(0),
            loved: Some(row.get::<_, Option<i32>>(8)?.unwrap_or(0)),
            disliked: Some(row.get::<_, Option<i32>>(9)?.unwrap_or(0)),
            cover_url: row.get(10).ok(),
            path_hash,
            bpm: row.get(11).ok(),
            energy: row.get(12).ok(),
            bass_ratio: row.get(13).ok(),
            treble_ratio: row.get(14).ok(),
            replaygain_gain: row.get(15).ok(),
            track_number: row.get(16).ok(),
            disc_number: row.get(17).ok(),
        })
    })?;

    let mut tracks = Vec::new();
    for t in track_iter {
        if let Ok(tr) = t {
            tracks.push(tr);
        }
    }
    Ok(tracks)
}

pub fn reset_disliked_tracks(conn: &Connection) -> Result<()> {
    conn.execute("UPDATE tracks SET disliked = 0", [])?;
    Ok(())
}


