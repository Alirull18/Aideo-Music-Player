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
    pub cover_url: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Playlist {
    pub id: i32,
    pub name: String,
}

pub fn init_db(db_path: &str) -> Result<Connection> {
    let conn = Connection::open(db_path)?;
    
    // Enable Foreign Key support in SQLite
    conn.execute("PRAGMA foreign_keys = ON", [])?;
    
    // Create base table if missing
    conn.execute(
        "CREATE TABLE IF NOT EXISTS tracks (
            id INTEGER PRIMARY KEY,
            path TEXT UNIQUE NOT NULL,
            title TEXT,
            artist TEXT,
            album TEXT,
            duration REAL
        )",
        [],
    )?;

    // Migration: Add format column if it doesn't exist
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN format TEXT", []);
    
    // Migration: Add lyric_offset column if it doesn't exist
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN lyric_offset INTEGER DEFAULT 0", []);

    // Migration: Add loved column if it doesn't exist
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN loved INTEGER DEFAULT 0", []);

    // Migration: Add cover_url column if it doesn't exist
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN cover_url TEXT", []);

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

    // Migration: Remove foreign key constraint on track_path from playlist_tracks.
    // SQLite does not support ALTER TABLE DROP CONSTRAINT, so we migrate by renaming and recreating.
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
        // 1. Rename existing table
        conn.execute("ALTER TABLE playlist_tracks RENAME TO temp_playlist_tracks", [])?;
        // 2. Create new table without the tracks FK
        conn.execute(
            "CREATE TABLE playlist_tracks (
                playlist_id INTEGER,
                track_path TEXT,
                position INTEGER,
                FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
                PRIMARY KEY(playlist_id, track_path)
            )",
            [],
        )?;
        // 3. Copy data
        conn.execute(
            "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_path, position)
             SELECT playlist_id, track_path, position FROM temp_playlist_tracks",
            [],
        )?;
        // 4. Drop temp table
        conn.execute("DROP TABLE temp_playlist_tracks", [])?;
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

    Ok(conn)
}

pub fn save_tracks(conn: &mut Connection, tracks: &mut [Track]) -> Result<()> {
    let tx = conn.transaction()?;
    for track in tracks {
        tx.execute(
            "INSERT OR REPLACE INTO tracks (id, path, title, artist, album, duration, format, lyric_offset, loved, cover_url)
             VALUES (
                 (SELECT id FROM tracks WHERE path = :path),
                 :path, :title, :artist, :album, :duration, :format, :lyric_offset,
                 COALESCE((SELECT loved FROM tracks WHERE path = :path), 0),
                 :cover_url
             )",
            rusqlite::named_params! {
                ":path": &track.path,
                ":title": &track.title,
                ":artist": &track.artist,
                ":album": &track.album,
                ":duration": &track.duration,
                ":format": &track.format,
                ":lyric_offset": &track.lyric_offset,
                ":cover_url": &track.cover_url,
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

pub fn get_all_tracks(conn: &Connection) -> Result<Vec<Track>> {
    let mut stmt = conn.prepare("SELECT id, path, title, artist, album, duration, format, lyric_offset, loved, cover_url FROM tracks")?;
    let track_iter = stmt.query_map([], |row| {
        Ok(Track {
            id: row.get(0)?,
            path: row.get(1)?,
            title: row.get(2)?,
            artist: row.get(3)?,
            album: row.get(4)?,
            duration: row.get(5)?,
            format: row.get(6)?,
            lyric_offset: row.get(7).unwrap_or(0),
            loved: Some(row.get(8).unwrap_or(0)),
            cover_url: row.get(9).ok(),
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

pub fn get_playlist_tracks(conn: &Connection, playlist_id: i32) -> Result<Vec<Track>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.path, t.title, t.artist, t.album, t.duration, t.format, t.lyric_offset, t.loved, t.cover_url 
         FROM playlist_tracks pt
         LEFT JOIN tracks t ON t.path = pt.track_path 
         WHERE pt.playlist_id = ?1 
         ORDER BY pt.position ASC"
    )?;
    let track_iter = stmt.query_map(params![playlist_id], |row| {
        // With LEFT JOIN, t.* fields can be NULL if the track was orphaned
        let path_opt: Option<String> = row.get(1)?;
        let path = match path_opt {
            Some(p) => p,
            None => return Err(rusqlite::Error::QueryReturnedNoRows), // skip fully NULL rows
        };
        Ok(Track {
            id: row.get(0).unwrap_or(0),
            path,
            title: row.get(2)?,
            artist: row.get(3)?,
            album: row.get(4)?,
            duration: row.get(5)?,
            format: row.get(6)?,
            lyric_offset: row.get(7).unwrap_or(0),
            loved: Some(row.get(8).unwrap_or(0)),
            cover_url: row.get(9).ok(),
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

    let exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM tracks WHERE path = ?1)",
        rusqlite::params![path],
        |row| row.get(0),
    ).unwrap_or(false);

    if !exists && loved {
        conn.execute(
            "INSERT INTO tracks (path, title, artist, album, duration, format, loved, cover_url)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![path, title, artist, album, duration, format, loved_int, cover_url],
        )?;
    } else {
        conn.execute(
            "UPDATE tracks SET loved = ?1 WHERE path = ?2",
            rusqlite::params![loved_int, path],
        )?;
    }

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
