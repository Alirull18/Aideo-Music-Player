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
}
