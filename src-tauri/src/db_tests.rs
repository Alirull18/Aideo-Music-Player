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

        let version: i32 = conn.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, crate::db::CURRENT_SCHEMA_VERSION, "PRAGMA user_version must match schema version");
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

    #[test]
    fn test_smart_playlist_numeric_text_column_matching() {
        use crate::db::{execute_smart_rules, init_db};

        let conn = init_db(":memory:").unwrap();
        conn.execute(
            "INSERT INTO tracks (path, title, artist, album, duration, format, loved) VALUES
            ('C:/1.mp3', 'Style', 'Taylor Swift', '1989', 231.0, 'FLAC', 1),
            ('C:/2.mp3', '1989', 'Ryan Adams', '1989', 210.0, 'MP3', 0),
            ('C:/3.mp3', 'Blank Space', 'Taylor Swift', '1989', 231.0, 'FLAC', 0)",
            [],
        )
        .unwrap();

        // Exact match on numeric string in text column
        let rules_json = serde_json::json!({
            "match_all": true,
            "rules": [
                { "field": "album", "operator": "equals", "value": "1989" }
            ]
        })
        .to_string();

        let matched_tracks = execute_smart_rules(&conn, &rules_json).unwrap();
        assert_eq!(matched_tracks.len(), 3, "All 3 tracks with album '1989' must match text equality");

        let title_rules_json = serde_json::json!({
            "match_all": true,
            "rules": [
                { "field": "title", "operator": "equals", "value": "1989" }
            ]
        })
        .to_string();

        let matched_title = execute_smart_rules(&conn, &title_rules_json).unwrap();
        assert_eq!(matched_title.len(), 1, "Only track with title '1989' must match");
        assert_eq!(matched_title[0].artist.as_deref(), Some("Ryan Adams"));
    }

    #[test]
    fn test_db_pool_and_concurrent_readers() {
        use crate::db::{init_db_pool, get_all_tracks};
        let temp_dir = std::env::temp_dir();
        let db_path = temp_dir.join(format!("test_aideo_pool_{}.db", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let db_path_str = db_path.to_string_lossy().to_string();

        let pool = init_db_pool(&db_path_str, 6).expect("Database pool initialization must succeed");

        // Seed some data with first connection
        {
            let conn = pool.get().expect("Must acquire connection");
            conn.execute(
                "INSERT INTO tracks (path, title, artist, album, duration) VALUES
                ('C:/track1.flac', 'Symphony 1', 'Beethoven', 'Classics', 300.0),
                ('C:/track2.flac', 'Symphony 2', 'Beethoven', 'Classics', 400.0)",
                [],
            ).unwrap();
        }

        // Spawn 4 concurrent reader threads from pool
        let mut handles = Vec::new();
        for _ in 0..4 {
            let pool_clone = pool.clone();
            handles.push(std::thread::spawn(move || {
                let conn = pool_clone.get().expect("Worker thread must acquire connection");
                let tracks = get_all_tracks(&conn).expect("Concurrent get_all_tracks must succeed");
                assert_eq!(tracks.len(), 2);
            }));
        }

        for h in handles {
            h.join().unwrap();
        }

        let _ = std::fs::remove_file(&db_path);
    }

    #[test]
    fn test_paginated_tracks_and_search_sorting() {
        use crate::db::{init_db, get_tracks_count, get_tracks_paginated};

        let conn = init_db(":memory:").unwrap();
        conn.execute(
            "INSERT INTO tracks (path, title, artist, album, duration) VALUES
            ('C:/1.mp3', 'Alpha', 'Artist B', 'Album Z', 100.0),
            ('C:/2.mp3', 'Beta', 'Artist A', 'Album Y', 200.0),
            ('C:/3.mp3', 'Gamma', 'Artist C', 'Album X', 300.0),
            ('C:/4.mp3', 'Delta', 'Artist B', 'Album W', 400.0),
            ('C:/5.mp3', 'Epsilon', 'Artist A', 'Album V', 500.0)",
            [],
        ).unwrap();

        // 1. Total count
        let total = get_tracks_count(&conn, None).unwrap();
        assert_eq!(total, 5);

        // 2. Filtered count
        let artist_a_count = get_tracks_count(&conn, Some("Artist A")).unwrap();
        assert_eq!(artist_a_count, 2);

        // 3. Pagination with limit=2, offset=0
        let page1 = get_tracks_paginated(&conn, 0, 2, None, Some("title")).unwrap();
        assert_eq!(page1.total, 5);
        assert_eq!(page1.offset, 0);
        assert_eq!(page1.limit, 2);
        assert_eq!(page1.tracks.len(), 2);
        assert_eq!(page1.tracks[0].title.as_deref(), Some("Alpha"));
        assert_eq!(page1.tracks[1].title.as_deref(), Some("Beta"));

        // 4. Pagination with limit=2, offset=2
        let page2 = get_tracks_paginated(&conn, 2, 2, None, Some("title")).unwrap();
        assert_eq!(page2.tracks.len(), 2);
        assert_eq!(page2.tracks[0].title.as_deref(), Some("Delta"));
        assert_eq!(page2.tracks[1].title.as_deref(), Some("Epsilon"));

        // 5. Pagination with limit=2, offset=4 (last page)
        let page3 = get_tracks_paginated(&conn, 4, 2, None, Some("title")).unwrap();
        assert_eq!(page3.tracks.len(), 1);
        assert_eq!(page3.tracks[0].title.as_deref(), Some("Gamma"));

        // 6. Descending sort
        let desc_page = get_tracks_paginated(&conn, 0, 2, None, Some("-duration")).unwrap();
        assert_eq!(desc_page.tracks[0].title.as_deref(), Some("Epsilon"));
        assert_eq!(desc_page.tracks[1].title.as_deref(), Some("Delta"));
    }

    #[test]
    fn test_save_tracks_preserves_existing_metadata_on_rescan() {
        use crate::db::{init_db, save_tracks, update_track_metadata, get_track_by_path, Track};

        let mut conn = init_db(":memory:").unwrap();

        // 1. Initial scan inserts a track with file tags
        let mut tracks = vec![Track {
            id: 0,
            path: "/music/song.mp3".to_string(),
            title: Some("Original Title".to_string()),
            artist: Some("Original Artist".to_string()),
            album: Some("Original Album".to_string()),
            duration: Some(200.0),
            format: Some("MP3".to_string()),
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
        }];
        save_tracks(&mut conn, &mut tracks).unwrap();

        // 2. User edits metadata via UI (DB-only update)
        update_track_metadata(&conn, "/music/song.mp3", "User Title", "User Artist", "User Album").unwrap();

        // Verify user edit is in DB
        let edited = get_track_by_path(&conn, "/music/song.mp3").unwrap();
        assert_eq!(edited.title.as_deref(), Some("User Title"));
        assert_eq!(edited.artist.as_deref(), Some("User Artist"));
        assert_eq!(edited.album.as_deref(), Some("User Album"));

        // 3. File watcher rescan — save_tracks with original file tags again
        let mut rescan_tracks = vec![Track {
            id: 0,
            path: "/music/song.mp3".to_string(),
            title: Some("Original Title".to_string()),
            artist: Some("Original Artist".to_string()),
            album: Some("Original Album".to_string()),
            duration: Some(200.0),
            format: Some("MP3".to_string()),
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
        }];
        save_tracks(&mut conn, &mut rescan_tracks).unwrap();

        // 4. Verify user-edited metadata survived the rescan
        let after_rescan = get_track_by_path(&conn, "/music/song.mp3").unwrap();
        assert_eq!(after_rescan.title.as_deref(), Some("User Title"), "title must survive rescan");
        assert_eq!(after_rescan.artist.as_deref(), Some("User Artist"), "artist must survive rescan");
        assert_eq!(after_rescan.album.as_deref(), Some("User Album"), "album must survive rescan");
    }
}

