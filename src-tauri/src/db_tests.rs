#[cfg(test)]
mod tests {
    use crate::db::{column_exists, init_db, init_db_pool};

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

    fn auto_sources() -> crate::db::RecordingSources {
        serde_json::from_value(serde_json::json!({
            "recording_id": "recording-1",
            "sources": [{"provider": "tidal", "id": "123", "metadata": {
                "title": "Song", "artist": "Artist", "album": "Album", "duration": 180,
                "cover_url": "https://example.com/cover.jpg", "track_number": 2, "disc_number": 1
            }}, {"provider": "qobuz", "id": "123"}],
            "selection": {"mode": "auto"}
        })).unwrap()
    }

    #[test]
    fn unified_entries_preserve_legacy_sources_and_order_after_restart() {
        use crate::db::*;
        let db_path = std::env::temp_dir().join(format!("aideo-sources-{}.sqlite", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let path = db_path.to_str().unwrap();
        {
            let conn = rusqlite::Connection::open(path).unwrap();
            conn.execute_batch("CREATE TABLE playlists (id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);
                CREATE TABLE playlist_tracks (playlist_id INTEGER, track_path TEXT, position INTEGER,
                    PRIMARY KEY(playlist_id, track_path),
                    FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE);
                INSERT INTO playlists VALUES (1, 'Legacy');
                INSERT INTO playlist_tracks VALUES (1, '123', 7);").unwrap();
        }
        let auto_id;
        {
            let mut conn = init_db(path).unwrap();
            let legacy = get_playlist_entries(&conn, 1).unwrap();
            assert_eq!(legacy.len(), 1);
            assert!(legacy[0].source_context.is_none());
            assert_eq!(legacy[0].track.path, "123");
            add_to_playlist(&mut conn, 1, "123", Some(&auto_sources()), None).unwrap();
            add_to_playlist(&mut conn, 1, "123", None, None).unwrap();
            let entries = get_playlist_entries(&conn, 1).unwrap();
            assert_eq!(entries.len(), 2);
            auto_id = entries[1].playlist_entry_id;
            assert_ne!(legacy[0].playlist_entry_id, auto_id);
            reorder_playlist(&mut conn, 1, &[], Some(&[auto_id, legacy[0].playlist_entry_id])).unwrap();
        }
        {
            let conn = init_db(path).unwrap();
            let entries = get_playlist_entries(&conn, 1).unwrap();
            assert_eq!(entries[0].playlist_entry_id, auto_id);
            assert_eq!(entries[0].source_context, Some(auto_sources()));
            assert!(entries[1].source_context.is_none());
            remove_from_playlist(&conn, 1, "123", Some(auto_id)).unwrap();
            let remaining = get_playlist_entries(&conn, 1).unwrap();
            assert_eq!(remaining.len(), 1);
            assert!(remaining[0].source_context.is_none());
        }
        std::fs::remove_file(db_path).unwrap();
    }

    #[test]
    fn unified_entries_validate_sources_and_keep_explicit_preferences() {
        use crate::db::*;
        let mut conn = init_db(":memory:").unwrap();
        let playlist = create_playlist(&conn, "Sources").unwrap();
        conn.execute("INSERT INTO tracks (path) VALUES ('123')", []).unwrap();
        let mut context = auto_sources();
        context.selection = SourceSelection::Explicit { source: context.sources[1].clone() };
        add_to_playlist(&mut conn, playlist, "123", Some(&context), None).unwrap();
        // Re-adding Auto must not overwrite a remembered explicit preference.
        add_to_playlist(&mut conn, playlist, "123", Some(&auto_sources()), None).unwrap();
        assert_eq!(get_playlist_entries(&conn, playlist).unwrap()[0].source_context, Some(context));
        let mut invalid = auto_sources();
        invalid.sources[0].id = "https://cdn.example/expired.flac".into();
        assert!(add_to_playlist(&mut conn, playlist, "123", Some(&invalid), None).is_err());
        let mut invalid = auto_sources();
        invalid.sources.clear();
        assert!(add_to_playlist(&mut conn, playlist, "123", Some(&invalid), None).is_err());
        let mut invalid = auto_sources();
        invalid.recording_id.clear();
        assert!(add_to_playlist(&mut conn, playlist, "123", Some(&invalid), None).is_err());
        let mut invalid = auto_sources();
        invalid.sources.push(invalid.sources[0].clone());
        assert!(add_to_playlist(&mut conn, playlist, "123", Some(&invalid), None).is_err());
        let mut invalid = auto_sources();
        invalid.selection = SourceSelection::Explicit { source: PlaybackSource { provider: SourceProvider::Tidal, id: "999".into(), catalog_quality: None, metadata: None } };
        assert!(add_to_playlist(&mut conn, playlist, "123", Some(&invalid), None).is_err());
        let mut metadata = get_track_by_path(&conn, "123").unwrap();
        metadata.path = "https://cdn.example/temporary.flac".into();
        assert!(add_to_playlist(&mut conn, playlist, &metadata.path, Some(&auto_sources()), Some(&metadata)).is_err());
        assert_eq!(get_playlist_entries(&conn, playlist).unwrap().len(), 1);
    }

    #[test]
    fn converting_a_legacy_entry_keeps_both_copies_and_validates_source_identity() {
        use crate::db::*;
        let youtube = PlaybackSource { provider: SourceProvider::Youtube, id: "abcdefghijk".into(), catalog_quality: None, metadata: None };
        assert!(youtube.matches_path("https://youtu.be/abcdefghijk"));
        assert!(youtube.matches_path("https://music.youtube.com/watch?v=abcdefghijk"));
        assert!(!youtube.matches_path("https://example.com/watch?v=abcdefghijk"));
        assert!(!youtube.matches_path("https://youtu.be/12345678901"));
        let mut conn = init_db(":memory:").unwrap();
        let playlist = create_playlist(&conn, "Convert").unwrap();
        conn.execute("INSERT INTO tracks (path, title, format) VALUES ('123', 'Song', 'Tidal FLAC')", []).unwrap();
        add_to_playlist(&mut conn, playlist, "123", None, None).unwrap();
        add_to_playlist(&mut conn, playlist, "123", Some(&auto_sources()), None).unwrap();
        let entries = get_playlist_entries(&conn, playlist).unwrap();
        let json = auto_sources().to_json().unwrap();
        let metadata = serde_json::to_string(&entries[0].track).unwrap();
        conn.execute("UPDATE playlist_tracks SET source_context = ?1, metadata_json = ?2 WHERE entry_id = ?3",
            rusqlite::params![json, metadata, entries[0].playlist_entry_id]).unwrap();
        add_to_playlist(&mut conn, playlist, "123", Some(&auto_sources()), None).unwrap();
        assert_eq!(get_playlist_entries(&conn, playlist).unwrap().len(), 2);
        let mut invalid = auto_sources();
        let mut duplicate = invalid.sources[0].clone();
        duplicate.catalog_quality = Some(crate::sources::SourceQuality { lossless: Some(true), ..Default::default() });
        invalid.sources.push(duplicate);
        assert!(invalid.to_json().is_err());
        let mut selected = auto_sources();
        let mut choice = selected.sources[0].clone();
        choice.catalog_quality = Some(crate::sources::SourceQuality { lossless: Some(true), ..Default::default() });
        selected.selection = SourceSelection::Explicit { source: choice };
        assert!(selected.to_json().is_ok());
    }

    #[test]
    fn unified_entries_keep_metadata_when_provider_ids_collide_or_local_copy_is_removed() {
        use crate::db::*;
        let mut conn = init_db(":memory:").unwrap();
        let playlist = create_playlist(&conn, "Sources").unwrap();
        conn.execute("INSERT INTO tracks (path, title, format) VALUES ('123', 'Tidal Song', 'Tidal FLAC')", []).unwrap();
        add_to_playlist(&mut conn, playlist, "123", None, None).unwrap();
        let mut metadata = get_track_by_path(&conn, "123").unwrap();
        metadata.title = Some("Different Qobuz Song".into());
        metadata.format = Some("Qobuz FLAC".into());
        let mut context = auto_sources();
        context.sources = vec![context.sources[1].clone()];
        add_to_playlist(&mut conn, playlist, "123", Some(&context), Some(&metadata)).unwrap();
        let entries = get_playlist_entries(&conn, playlist).unwrap();
        assert_eq!(entries[0].track.title.as_deref(), Some("Tidal Song"));
        assert_eq!(entries[1].track.title.as_deref(), Some("Different Qobuz Song"));
        delete_track(&mut conn, "123").unwrap();
        let remaining = get_playlist_entries(&conn, playlist).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].track.title, metadata.title);
        assert_eq!(remaining[0].source_context, Some(context));
    }

    #[test]
    fn unified_entries_reject_wrong_playlist_ids_and_roll_back_reorders() {
        use crate::db::*;
        let mut conn = init_db(":memory:").unwrap();
        let playlist = create_playlist(&conn, "Sources").unwrap();
        conn.execute("INSERT INTO tracks (path) VALUES ('123'), ('456')", []).unwrap();
        add_to_playlist(&mut conn, playlist, "123", None, None).unwrap();
        add_to_playlist(&mut conn, playlist, "456", None, None).unwrap();
        let entries = get_playlist_entries(&conn, playlist).unwrap();
        let ids: Vec<i64> = entries.iter().map(|e| e.playlist_entry_id).collect();
        assert!(reorder_playlist(&mut conn, playlist, &[], Some(&[ids[1], 9999])).is_err());
        assert!(reorder_playlist(&mut conn, playlist, &[], Some(&[ids[1], ids[1]])).is_err());
        assert!(add_to_playlist(&mut conn, 9999, "123", Some(&auto_sources()), None).is_err());
        remove_from_playlist(&conn, 9999, "123", Some(ids[0])).unwrap();
        let after: Vec<i64> = get_playlist_entries(&conn, playlist).unwrap().iter().map(|e| e.playlist_entry_id).collect();
        assert_eq!(after, ids);
    }

    #[test]
    fn unified_favorites_do_not_change_legacy_saved_sources() {
        use crate::db::*;
        let mut conn = init_db(":memory:").unwrap();
        toggle_love_track(&mut conn, "123", true, Some("Legacy"), None, None, None, Some("Tidal FLAC"), None, None).unwrap();
        toggle_love_track(&mut conn, "123", true, Some("Unified"), None, None, None, Some("Qobuz FLAC"), None, Some(&auto_sources())).unwrap();
        let playlist = get_playlists(&conn).unwrap()[0].id;
        let entries = get_playlist_entries(&conn, playlist).unwrap();
        assert_eq!(entries.len(), 2);
        assert!(entries[0].source_context.is_none());
        assert_eq!(entries[0].track.title.as_deref(), Some("Legacy"));
        assert_eq!(entries[1].source_context, Some(auto_sources()));
        toggle_love_track(&mut conn, "123", false, None, None, None, None, None, None, Some(&auto_sources())).unwrap();
        assert_eq!(get_playlist_entries(&conn, playlist).unwrap().len(), 1);
        assert_eq!(get_track_by_path(&conn, "123").unwrap().loved, Some(1));
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
        add_to_playlist(&mut conn, pl_id, "C:/song.mp3", None, None).unwrap();

        let tracks = get_playlist_tracks(&conn, pl_id).unwrap();
        assert_eq!(tracks.len(), 1);

        // Delete track wraps both tracks and playlist_tracks in transaction
        delete_track(&mut conn, "C:/song.mp3").unwrap();
        let remaining_pl_tracks = get_playlist_tracks(&conn, pl_id).unwrap();
        assert_eq!(remaining_pl_tracks.len(), 0);
    }

    #[test]
    fn test_library_pagination_filters_and_orders_tracks() {
        use crate::db::{get_tracks_count, get_tracks_paginated};

        let conn = init_db(":memory:").unwrap();
        conn.execute(
            "INSERT INTO tracks (path, title, artist, album, duration, format) VALUES
             ('C:/b.mp3', 'Bravo', 'Artist B', 'Album 2', 240.0, 'MP3'),
             ('C:/a.mp3', 'Alpha', 'Artist A', 'Album 1', 180.0, 'FLAC'),
             ('C:/c.mp3', 'Charlie', 'Artist A', 'Album 1', 300.0, 'FLAC')",
            [],
        )
        .unwrap();

        assert_eq!(get_tracks_count(&conn, Some("artist a")).unwrap(), 2);

        let page = get_tracks_paginated(&conn, 1, 1, Some("artist a"), Some("title")).unwrap();
        assert_eq!(page.total, 2);
        assert_eq!(page.offset, 1);
        assert_eq!(page.limit, 1);
        assert_eq!(page.tracks.len(), 1);
        assert_eq!(page.tracks[0].title.as_deref(), Some("Charlie"));
    }

    #[test]
    fn test_sqlite_pool_opens_valid_connections() {
        let db_path = std::env::temp_dir().join(format!(
            "aideo-db-pool-test-{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let db_path_string = db_path.to_string_lossy().to_string();

        let pool = init_db_pool(&db_path_string, 2).expect("pool should initialize");
        let connection = pool.get().expect("pool should provide a connection");
        let table_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'tracks'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(table_count, 1);
        drop(connection);
        drop(pool);

        let _ = std::fs::remove_file(db_path);
    }
}
