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
}
