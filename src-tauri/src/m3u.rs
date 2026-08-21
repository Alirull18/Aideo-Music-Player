use crate::db;
use rusqlite::Connection;
use std::path::Path;

/// Exports a playlist as an extended M3U8 (.m3u) file.
/// Writes #EXTM3U header plus #EXTINF lines with duration and artist - title.
pub fn export_playlist_m3u(conn: &Connection, playlist_id: i32, dest_path: &str) -> Result<usize, String> {
    let name: String = conn
        .query_row("SELECT name FROM playlists WHERE id = ?1", rusqlite::params![playlist_id], |r| r.get(0))
        .map_err(|e| format!("Playlist not found: {}", e))?;

    let tracks = db::get_playlist_tracks(conn, playlist_id).map_err(|e| e.to_string())?;

    let mut out = String::from("#EXTM3U\n");
    out.push_str(&format!("#PLAYLIST:{}\n", name));
    for t in &tracks {
        let display = match (&t.artist, &t.title) {
            (Some(a), Some(ti)) => format!("{} - {}", a, ti),
            (None, Some(ti)) => ti.clone(),
            (Some(a), None) => a.clone(),
            (None, None) => Path::new(&t.path)
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| t.path.clone()),
        };
        let secs = t.duration.map(|d| d.round() as i64).unwrap_or(-1);
        out.push_str(&format!("#EXTINF:{},{}\n", secs, display));
        out.push_str(&t.path);
        out.push('\n');
    }

    std::fs::write(dest_path, out).map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(tracks.len())
}

/// Import result: how many entries were resolved against the library and how many were skipped.
pub struct ImportResult {
    pub resolved: usize,
    pub skipped: usize,
}

/// Imports an M3U/M3U8 file into a (new or existing) playlist.
/// Each non-comment line is resolved against the library:
///   1. exact path match
///   2. filename (with extension) match against any library path
///   3. file stem match
/// Unresolvable lines are skipped and counted.
pub fn import_playlist_m3u(conn: &mut Connection, src_path: &str, playlist_name: &str) -> Result<ImportResult, String> {
    let content = std::fs::read_to_string(src_path).map_err(|e| format!("Failed to read file: {}", e))?;

    conn.execute("INSERT INTO playlists (name) VALUES (?1)", rusqlite::params![playlist_name])
        .map_err(|e| e.to_string())?;
    let playlist_id = conn.last_insert_rowid() as i32;

    // Build resolution index: lowercase filename -> path, lowercase stem -> path
    let mut by_filename: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut by_stem: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT path FROM tracks").map_err(|e| e.to_string())?;
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        while let Ok(Some(row)) = rows.next() {
            let path: String = row.get(0).map_err(|e| e.to_string())?;
            if let Some(name) = Path::new(&path).file_name().and_then(|n| n.to_str()) {
                by_filename.entry(name.to_lowercase().replace('\\', "/")).or_insert_with(|| path.clone());
            }
            if let Some(stem) = Path::new(&path).file_stem().and_then(|n| n.to_str()) {
                by_stem.entry(stem.to_lowercase()).or_insert_with(|| path.clone());
            }
        }
    }

    let mut resolved = 0;
    let mut skipped = 0;
    let mut pos = 1;
    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let normalized = line.replace('\\', "/");
        let resolved_path = if conn
            .query_row("SELECT 1 FROM tracks WHERE path = ?1", rusqlite::params![line], |_| Ok(()))
            .is_ok()
        {
            Some(line.to_string())
        } else if let Some(p) = Path::new(&normalized)
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(|n| by_filename.get(&n.to_lowercase().replace('\\', "/")))
        {
            Some(p.clone())
        } else if let Some(p) = Path::new(&normalized)
            .file_stem()
            .and_then(|n| n.to_str())
            .and_then(|n| by_stem.get(&n.to_lowercase()))
        {
            Some(p.clone())
        } else {
            None
        };

        match resolved_path {
            Some(p) => {
                let _ = conn.execute(
                    "INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_path, position) VALUES (?1, ?2, ?3)",
                    rusqlite::params![playlist_id, p, pos],
                );
                pos += 1;
                resolved += 1;
            }
            None => {
                skipped += 1;
            }
        }
    }

    // Remove the playlist again if nothing resolved, to avoid empty orphans
    if resolved == 0 {
        let _ = conn.execute("DELETE FROM playlists WHERE id = ?1", rusqlite::params![playlist_id]);
    }

    Ok(ImportResult { resolved, skipped })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE tracks (id INTEGER PRIMARY KEY, path TEXT UNIQUE, title TEXT, artist TEXT, album TEXT, duration REAL, format TEXT, lyric_offset INTEGER DEFAULT 0, loved INTEGER DEFAULT 0, disliked INTEGER DEFAULT 0, cover_url TEXT, bpm REAL, energy REAL, bass_ratio REAL, treble_ratio REAL, replaygain_gain REAL, path_hash TEXT, track_number INTEGER, disc_number INTEGER);
             CREATE TABLE playlists (id INTEGER PRIMARY KEY, name TEXT);
             CREATE TABLE playlist_tracks (playlist_id INTEGER, track_path TEXT, position INTEGER, PRIMARY KEY (playlist_id, track_path));",
        )
        .unwrap();
        conn
    }

    #[test]
    fn export_writes_extended_m3u() {
        let conn = test_db();
        conn.execute("INSERT INTO tracks (path, title, artist, duration) VALUES ('C:/a.mp3', 'Song A', 'Artist X', 180.4), ('C:/b.flac', 'Song B', 'Artist Y', NULL)", []).unwrap();
        conn.execute("INSERT INTO playlists (name) VALUES ('Mix')", []).unwrap();
        let pid: i32 = conn.query_row("SELECT id FROM playlists", [], |r| r.get(0)).unwrap();
        conn.execute("INSERT INTO playlist_tracks (playlist_id, track_path, position) VALUES (?1, 'C:/a.mp3', 1), (?1, 'C:/b.flac', 2)", [pid]).unwrap();

        let dir = std::env::temp_dir().join("aideo_m3u_test");
        std::fs::create_dir_all(&dir).unwrap();
        let dest = dir.join("export_test.m3u8");
        let count = export_playlist_m3u(&conn, pid, dest.to_str().unwrap()).unwrap();

        assert_eq!(count, 2);
        let content = std::fs::read_to_string(&dest).unwrap();
        assert!(content.starts_with("#EXTM3U\n"));
        assert!(content.contains("#PLAYLIST:Mix"));
        assert!(content.contains("#EXTINF:180,Artist X - Song A"));
        assert!(content.contains("#EXTINF:-1,Artist Y - Song B"));
        assert!(content.contains("C:/a.mp3"));
    }

    #[test]
    fn import_resolves_by_filename_and_stem() {
        let mut conn = test_db();
        conn.execute("INSERT INTO tracks (path) VALUES ('C:/Music/deep/nested_track.flac')", []).unwrap();

        let dir = std::env::temp_dir().join("aideo_m3u_test");
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("import_test.m3u8");
        std::fs::write(&src, "#EXTM3U\n#EXTINF:100,Some Song\nD:/other-folder/nested_track.flac\nC:/missing.mp3\n").unwrap();

        let result = import_playlist_m3u(&mut conn, src.to_str().unwrap(), "Imported").unwrap();
        assert_eq!(result.resolved, 1);
        assert_eq!(result.skipped, 1);

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id WHERE p.name = 'Imported'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn import_with_no_matches_creates_no_orphan_playlist() {
        let mut conn = test_db();
        let dir = std::env::temp_dir().join("aideo_m3u_test");
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("empty_import.m3u8");
        std::fs::write(&src, "#EXTM3U\nC:/nothing_here.mp3\n").unwrap();

        let result = import_playlist_m3u(&mut conn, src.to_str().unwrap(), "Ghost").unwrap();
        assert_eq!(result.resolved, 0);
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM playlists", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }
}
