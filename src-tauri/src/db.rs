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
    // We try to add it and ignore the error if it's already there
    let _ = conn.execute("ALTER TABLE tracks ADD COLUMN format TEXT", []);

    Ok(conn)
}

pub fn save_tracks(conn: &Connection, tracks: &mut [Track]) -> Result<()> {
    for track in tracks {
        conn.execute(
            "INSERT OR REPLACE INTO tracks (id, path, title, artist, album, duration, format)
             VALUES (
                 (SELECT id FROM tracks WHERE path = :path),
                 :path, :title, :artist, :album, :duration, :format
             )",
            rusqlite::named_params! {
                ":path": &track.path,
                ":title": &track.title,
                ":artist": &track.artist,
                ":album": &track.album,
                ":duration": &track.duration,
                ":format": &track.format,
            },
        )?;
    }
    Ok(())
}

pub fn get_all_tracks(conn: &Connection) -> Result<Vec<Track>> {
    let mut stmt = conn.prepare("SELECT id, path, title, artist, album, duration, format FROM tracks")?;
    let track_iter = stmt.query_map([], |row| {
        Ok(Track {
            id: row.get(0)?,
            path: row.get(1)?,
            title: row.get(2)?,
            artist: row.get(3)?,
            album: row.get(4)?,
            duration: row.get(5)?,
            format: row.get(6)?,
        })
    })?;

    let mut tracks = Vec::new();
    for track in track_iter {
        tracks.push(track?);
    }
    Ok(tracks)
}
