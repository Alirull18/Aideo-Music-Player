use rusqlite::{Connection, Result};
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
}

pub fn init_db(db_path: &str) -> Result<Connection> {
    let conn = Connection::open(db_path)?;
    
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

    Ok(conn)
}

pub fn save_tracks(conn: &Connection, tracks: &mut [Track]) -> Result<()> {
    for track in tracks {
        conn.execute(
            "INSERT OR REPLACE INTO tracks (id, path, title, artist, album, duration, format, lyric_offset)
             VALUES (
                 (SELECT id FROM tracks WHERE path = :path),
                 :path, :title, :artist, :album, :duration, :format, :lyric_offset
             )",
            rusqlite::named_params! {
                ":path": &track.path,
                ":title": &track.title,
                ":artist": &track.artist,
                ":album": &track.album,
                ":duration": &track.duration,
                ":format": &track.format,
                ":lyric_offset": &track.lyric_offset,
            },
        )?;
    }
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
    let mut stmt = conn.prepare("SELECT id, path, title, artist, album, duration, format, lyric_offset FROM tracks")?;
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
        })
    })?;

    let mut tracks = Vec::new();
    for track in track_iter {
        tracks.push(track?);
    }
    Ok(tracks)
}
