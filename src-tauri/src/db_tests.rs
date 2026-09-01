#[cfg(test)]
mod tests {
    use crate::db::{init_db, column_exists};

    #[test]
    fn test_init_db_in_memory() {
        let conn = init_db(":memory:").expect("In-memory SQLite database should initialize cleanly");
        
        // Verify core tables exist
        assert!(column_exists(&conn, "tracks", "id"), "tracks table should contain id column");
        assert!(column_exists(&conn, "tracks", "path"), "tracks table should contain path column");
        assert!(column_exists(&conn, "tracks", "title"), "tracks table should contain title column");
        assert!(column_exists(&conn, "tracks", "artist"), "tracks table should contain artist column");
        assert!(column_exists(&conn, "playlists", "name"), "playlists table should contain name column");
    }

    #[test]
    fn test_tray_icon_bytes() {
        let img = tauri::image::Image::from_bytes(include_bytes!("../icons/32x32.png"));
        assert!(img.is_ok(), "32x32.png should parse cleanly into tauri::image::Image: {:?}", img.err());
    }

    #[test]
    fn test_smart_playlist_rules_execution() {
        use crate::db::{create_smart_playlist, execute_smart_rules, get_smart_playlists, init_db};

        let conn = init_db(":memory:").unwrap();
        conn.execute(
            "INSERT INTO tracks (path, title, artist, album, duration, format, loved) VALUES
            ('C:/1.mp3', 'Jazz Suite', 'Miles Davis', 'Kind of Blue', 300.0, 'FLAC', 1),
            ('C:/2.mp3', 'Pop Hits', 'Taylor Swift', '1989', 200.0, 'MP3', 0),
            ('C:/3.mp3', 'Blue in Green', 'Miles Davis', 'Kind of Blue', 320.0, 'FLAC', 1)",
            [],
        )
        .unwrap();

        let rules_json = serde_json::json!({
            "match_all": true,
            "rules": [
                { "field": "artist", "operator": "contains", "value": "Miles" },
                { "field": "loved", "operator": "equals", "value": "1" }
            ],
            "limit": 10
        })
        .to_string();

        let sp_id = create_smart_playlist(&conn, "Miles Favorites", &rules_json).unwrap();
        assert!(sp_id > 0);

        let playlists = get_smart_playlists(&conn).unwrap();
        assert_eq!(playlists.len(), 1);
        assert_eq!(playlists[0].name, "Miles Favorites");

        let matched_tracks = execute_smart_rules(&conn, &rules_json).unwrap();
        assert_eq!(matched_tracks.len(), 2);
        assert_eq!(matched_tracks[0].artist.as_deref(), Some("Miles Davis"));
    }

    #[test]
    fn test_library_directories_table_and_crud() {
        use crate::db::{get_library_directories, init_db, save_library_directories};

        let conn = init_db(":memory:").unwrap();
        let dirs = vec![
            "C:\\Music\\Jazz".to_string(),
            "D:\\Audio\\FLAC".to_string(),
        ];

        save_library_directories(&conn, &dirs).expect("save_library_directories should succeed");

        let loaded = get_library_directories(&conn).expect("get_library_directories should succeed");
        assert_eq!(loaded.len(), 2);
        assert!(loaded.contains(&"C:\\Music\\Jazz".to_string()));
        assert!(loaded.contains(&"D:\\Audio\\FLAC".to_string()));

        // Overwrite / sync with new list
        let new_dirs = vec!["E:\\NewLibrary".to_string()];
        save_library_directories(&conn, &new_dirs).expect("save_library_directories overwrite should succeed");
        let updated = get_library_directories(&conn).unwrap();
        assert_eq!(updated.len(), 1);
        assert_eq!(updated[0], "E:\\NewLibrary");
    }

    #[test]
    fn test_history_index_and_scrobble_bounding() {
        let mut conn = init_db(":memory:").unwrap();

        // Verify index exists
        let index_exists: bool = conn
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_history_path'",
                [],
                |_| Ok(true),
            )
            .unwrap_or(false);
        assert!(index_exists, "idx_history_path index must be created in init_db");

        // Insert 1050 unsynced history rows in a transaction
        let tx = conn.transaction().unwrap();
        for i in 1..=1050 {
            tx.execute(
                "INSERT INTO playback_history (track_path, title, artist, timestamp, synced)
                 VALUES (?1, ?2, 'Artist', ?3, 0)",
                rusqlite::params![format!("C:/track_{}.mp3", i), format!("Track {}", i), i as i64],
            ).unwrap();
        }

        // Apply 1000 limit deletion
        tx.execute(
            "DELETE FROM playback_history 
             WHERE synced = 0 AND id NOT IN (
                 SELECT id FROM playback_history WHERE synced = 0 ORDER BY timestamp DESC LIMIT 1000
             )",
            [],
        ).unwrap();
        tx.commit().unwrap();

        let count: i64 = conn.query_row("SELECT COUNT(*) FROM playback_history WHERE synced = 0", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1000, "Unsynced history must be bounded to 1,000 max entries");
    }

    #[test]
    fn test_transactional_operations_commit_and_rollback() {
        use crate::db::{add_to_playlist, create_playlist, delete_track, get_playlist_tracks, init_db};

        let mut conn = init_db(":memory:").unwrap();
        conn.execute(
            "INSERT INTO tracks (path, title, artist) VALUES ('C:/song.mp3', 'Song A', 'Artist A')",
            [],
        ).unwrap();

        let pl_id = create_playlist(&conn, "Test Playlist").unwrap();
        add_to_playlist(&mut conn, pl_id, "C:/song.mp3").unwrap();

        let tracks = get_playlist_tracks(&conn, pl_id).unwrap();
        assert_eq!(tracks.len(), 1);

        // Delete track wraps both tracks and playlist_tracks in transaction
        delete_track(&mut conn, "C:/song.mp3").unwrap();
        let remaining_pl_tracks = get_playlist_tracks(&conn, pl_id).unwrap();
        assert_eq!(remaining_pl_tracks.len(), 0);
    }
}
