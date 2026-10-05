use crate::{db, AppState};
use lofty::{file::TaggedFileExt, tag::Accessor};
use serde::{Deserialize, Serialize};
use std::{
    collections::{hash_map::DefaultHasher, HashMap},
    hash::{Hash, Hasher},
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};
use tauri::{Emitter, State};

#[derive(Clone, Serialize, Debug)]
pub struct HealthIssue {
    pub kind: String,
    pub paths: Vec<String>,
    pub detail: String,
}

#[cfg(test)]
mod relocation_tests {
    use super::*;
    use rusqlite::params;
    fn fixture() -> (rusqlite::Connection, std::path::PathBuf, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "aideo-relocate-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let old = dir.join("old");
        let new = dir.join("new");
        std::fs::create_dir_all(old.join("Disc 1")).unwrap();
        std::fs::create_dir_all(new.join("Disc 1")).unwrap();
        let mut wave = Vec::new();
        wave.extend(b"RIFF");
        wave.extend(1636u32.to_le_bytes());
        wave.extend(b"WAVEfmt ");
        wave.extend(16u32.to_le_bytes());
        wave.extend(1u16.to_le_bytes());
        wave.extend(1u16.to_le_bytes());
        wave.extend(8000u32.to_le_bytes());
        wave.extend(16000u32.to_le_bytes());
        wave.extend(2u16.to_le_bytes());
        wave.extend(16u16.to_le_bytes());
        wave.extend(b"data");
        wave.extend(1600u32.to_le_bytes());
        wave.extend(vec![0u8; 1600]);
        let path = old.join("Disc 1/歌曲.wav");
        let target = new.join("Disc 1/歌曲.wav");
        std::fs::write(&path, &wave).unwrap();
        std::fs::write(&target, &wave).unwrap();
        let conn = db::init_db(":memory:").unwrap();
        crate::recommendations::init_schema(&conn).unwrap();
        conn.execute("INSERT INTO tracks(path,title,duration,format,loved,path_hash,disc_number,track_number) VALUES (?1,'歌曲',0.1,'WAV',1,'old',1,1)", [path.to_str().unwrap()]).unwrap();
        conn.execute(
            "INSERT INTO library_directories(path) VALUES (?1)",
            [old.to_str().unwrap()],
        )
        .unwrap();
        conn.execute("INSERT INTO playlists(name) VALUES ('Multi-disc')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO playlist_tracks(playlist_id,track_path,position) VALUES(1,?1,4)",
            [path.to_str().unwrap()],
        )
        .unwrap();
        let context = serde_json::json!({"recording_id":"keep-id","sources":[{"provider":"local","id":path.to_str().unwrap()},{"provider":"tidal","id":"123"}],"selection":{"mode":"explicit","source":{"provider":"local","id":path.to_str().unwrap()}}});
        let track = db::get_all_tracks(&conn).unwrap().remove(0);
        conn.execute("INSERT INTO playlist_tracks(playlist_id,track_path,position,source_context,metadata_json) VALUES(1,'tidal:123',5,?1,?2)",params![context.to_string(),serde_json::to_string(&track).unwrap()]).unwrap();
        conn.execute("INSERT INTO playback_history(track_path,timestamp,recording_id,source_key,signal_quality,listened_seconds) VALUES (?1,123,'keep-id',?2,'qualified',45)",params![track.path,crate::recommendations::source_key(&track)]).unwrap();
        conn.execute(
            "INSERT INTO recommendation_aliases(source_key,recording_id) VALUES (?1,'keep-id')",
            [crate::recommendations::source_key(&track)],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO recommendation_interest(recording_id,interested) VALUES ('keep-id',0)",
            [],
        )
        .unwrap();
        conn.execute_batch("CREATE TABLE track_downloads(path TEXT PRIMARY KEY)")
            .unwrap();
        conn.execute(
            "INSERT INTO track_downloads(path) VALUES (?1)",
            [track.path],
        )
        .unwrap();
        (conn, old, new)
    }
    #[test]
    fn relocation_preserves_identity_history_preferences_and_nested_sources() {
        let (mut conn, old, new) = fixture();
        let preview =
            relocation_preview(&conn, old.to_str().unwrap(), new.to_str().unwrap()).unwrap();
        assert!(preview.conflicts.is_empty(), "{:?}", preview.conflicts);
        assert_eq!(preview.mappings.len(), 1);
        let remap = apply_relocation(&mut conn, &preview).unwrap();
        let track = db::get_all_tracks(&conn).unwrap().remove(0);
        assert_eq!(track.id, 1);
        assert_eq!(track.loved, Some(1));
        assert_eq!(track.path, preview.mappings[0].new_path);
        let entries = db::get_playlist_tracks(&conn, 1).unwrap();
        assert_eq!(entries.len(), 2);
        let raw: String = conn
            .query_row(
                "SELECT source_context FROM playlist_tracks WHERE position=5",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let context: db::RecordingSources = serde_json::from_str(&raw).unwrap();
        assert_eq!(context.recording_id, "keep-id");
        assert_eq!(context.sources[0].id, track.path);
        assert_eq!(context.sources[1].id, "123");
        assert_eq!(
            conn.query_row("SELECT timestamp FROM playback_history", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            123
        );
        assert_eq!(
            conn.query_row("SELECT interested FROM recommendation_interest", [], |r| {
                r.get::<_, i64>(0)
            })
            .unwrap(),
            0
        );
        undo_relocation(&mut conn, remap.id).unwrap();
        assert_eq!(
            db::get_all_tracks(&conn).unwrap()[0].path,
            preview.mappings[0].old_path
        );
        std::fs::remove_dir_all(old.parent().unwrap()).unwrap();
    }
    #[test]
    fn changed_targets_collision_and_mid_transaction_failure_leave_original_rows() {
        let (mut conn, old, new) = fixture();
        let preview =
            relocation_preview(&conn, old.to_str().unwrap(), new.to_str().unwrap()).unwrap();
        std::fs::write(&preview.mappings[0].new_path, b"changed").unwrap();
        assert!(apply_relocation(&mut conn, &preview).is_err());
        std::fs::copy(&preview.mappings[0].old_path, &preview.mappings[0].new_path).unwrap();
        conn.execute_batch("CREATE TRIGGER fail_relocation BEFORE UPDATE ON playback_history BEGIN SELECT RAISE(ABORT,'fixture injected failure'); END").unwrap();
        let fresh =
            relocation_preview(&conn, old.to_str().unwrap(), new.to_str().unwrap()).unwrap();
        assert!(apply_relocation(&mut conn, &fresh).is_err());
        assert_eq!(
            db::get_all_tracks(&conn).unwrap()[0].path,
            preview.mappings[0].old_path
        );
        assert_eq!(pending_remaps(&conn).unwrap().len(), 0);
        conn.execute_batch("DROP TRIGGER fail_relocation").unwrap();
        conn.execute(
            "INSERT INTO tracks(path) VALUES(?1)",
            [&preview.mappings[0].new_path],
        )
        .unwrap();
        assert!(
            !relocation_preview(&conn, old.to_str().unwrap(), new.to_str().unwrap())
                .unwrap()
                .conflicts
                .is_empty()
        );
        std::fs::remove_dir_all(old.parent().unwrap()).unwrap();
    }
    #[test]
    fn boundaries_traversal_and_overlap_are_rejected() {
        let (conn, old, new) = fixture();
        assert!(relative_local_path("C:\\Music2\\x.wav", "C:\\Music").is_none());
        assert_eq!(
            relative_local_path("c:\\MUSIC\\Disc 1\\歌曲.wav", "C:\\Music"),
            Some(std::path::PathBuf::from("Disc 1").join("歌曲.wav"))
        );
        assert!(relative_local_path("\\\\server\\Music\\..\\x.wav", "\\\\server\\Music").is_none());
        assert!(relocation_preview(
            &conn,
            old.to_str().unwrap(),
            old.join("Disc 1").to_str().unwrap()
        )
        .is_err());
        std::fs::remove_dir_all(new.parent().unwrap()).unwrap();
    }
    #[test]
    fn missing_originals_use_metadata_partial_matches_keep_root_and_undo_refuses_later_edits() {
        let (mut conn, old, new) = fixture();
        conn.execute("UPDATE tracks SET disc_number=NULL,track_number=NULL", [])
            .unwrap();
        let original = db::get_all_tracks(&conn).unwrap()[0].path.clone();
        std::fs::remove_file(&original).unwrap();
        conn.execute(
            "INSERT INTO tracks(path,title,duration,format) VALUES(?1,'Missing',0.1,'WAV')",
            [old.join("missing.wav").to_str().unwrap()],
        )
        .unwrap();
        let preview =
            relocation_preview(&conn, old.to_str().unwrap(), new.to_str().unwrap()).unwrap();
        assert_eq!(preview.mappings.len(), 1, "{:?}", preview.unresolved);
        assert_eq!(preview.unresolved.len(), 1);
        assert!(preview.roots.is_empty());
        let remap = apply_relocation(&mut conn, &preview).unwrap();
        assert_eq!(db::get_library_directories(&conn).unwrap().len(), 2);
        assert_eq!(remap.added_roots, vec![new.to_string_lossy().to_string()]);
        conn.execute("INSERT INTO recommendation_training_ignored(history_id) SELECT id FROM playback_history",[]).unwrap();
        assert!(undo_relocation(&mut conn, remap.id).is_err());
        conn.execute("DELETE FROM recommendation_training_ignored", [])
            .unwrap();
        let undo = undo_relocation(&mut conn, remap.id).unwrap();
        assert_eq!(undo.removed_roots, vec![new.to_string_lossy().to_string()]);
        assert_eq!(
            db::get_library_directories(&conn).unwrap(),
            vec![old.to_string_lossy().to_string()]
        );
        std::fs::remove_dir_all(old.parent().unwrap()).unwrap();
    }
    #[test]
    fn unc_unicode_component_mapping_preserves_source_keys_and_provider_identifiers() {
        let mappings = vec![PathMapping {
            old_path: "\\\\server\\音楽\\Disc 2\\歌曲.flac".into(),
            new_path: "\\\\other\\移動\\Disc 2\\歌曲.flac".into(),
        }];
        assert_eq!(
            relative_local_path(&mappings[0].old_path, "\\\\SERVER\\音楽"),
            Some(std::path::PathBuf::from("Disc 2").join("歌曲.flac"))
        );
        assert_eq!(
            local_source_key(&mappings[0].old_path),
            "local:\\\\server\\音楽\\disc 2\\歌曲.flac"
        );
        let mut context = serde_json::json!({"recording_id":mappings[0].old_path,"sources":[{"provider":"local","id":mappings[0].old_path},{"provider":"qobuz","id":"123"}]});
        remap_json(&mut context, &mappings);
        assert_eq!(context["recording_id"], mappings[0].old_path);
        assert_eq!(context["sources"][0]["id"], mappings[0].new_path);
        assert_eq!(context["sources"][1]["id"], "123");
    }
    #[test]
    fn multi_disc_playlist_keeps_entry_ids_and_order_after_relocation() {
        let (mut conn, old, new) = fixture();
        std::fs::create_dir(old.join("Disc 2")).unwrap();
        std::fs::create_dir(new.join("Disc 2")).unwrap();
        let source = db::get_all_tracks(&conn).unwrap()[0].path.clone();
        let second = old.join("Disc 2/Second.wav");
        let target = new.join("Disc 2/Second.wav");
        std::fs::copy(&source, &second).unwrap();
        std::fs::copy(&source, &target).unwrap();
        conn.execute("INSERT INTO tracks(path,title,duration,format,disc_number,track_number) VALUES(?1,'Second',0.1,'WAV',2,1)",[second.to_str().unwrap()]).unwrap();
        conn.execute(
            "INSERT INTO playlist_tracks(playlist_id,track_path,position) VALUES(1,?1,6)",
            [second.to_str().unwrap()],
        )
        .unwrap();
        let before: Vec<(i64, i64)> = {
            let mut stmt = conn
                .prepare("SELECT entry_id,position FROM playlist_tracks ORDER BY position")
                .unwrap();
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
            rows.collect::<Result<_, _>>().unwrap()
        };
        let preview =
            relocation_preview(&conn, old.to_str().unwrap(), new.to_str().unwrap()).unwrap();
        assert_eq!(preview.mappings.len(), 2);
        apply_relocation(&mut conn, &preview).unwrap();
        let after: Vec<(i64, i64)> = {
            let mut stmt = conn
                .prepare("SELECT entry_id,position FROM playlist_tracks ORDER BY position")
                .unwrap();
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
            rows.collect::<Result<_, _>>().unwrap()
        };
        assert_eq!(before, after);
        let tracks = db::get_all_tracks(&conn).unwrap();
        assert_eq!(
            tracks.iter().find(|t| t.id == 2).unwrap().disc_number,
            Some(2)
        );
        assert_eq!(
            path_identity(&tracks.iter().find(|t| t.id == 2).unwrap().path),
            path_identity(&target.to_string_lossy())
        );
        std::fs::remove_dir_all(old.parent().unwrap()).unwrap();
    }
}
#[derive(Clone, Serialize)]
pub struct HealthReport {
    pub scan_id: String,
    pub issues: Vec<HealthIssue>,
    pub cancelled: bool,
    pub invalidated: bool,
    pub checked: usize,
    pub total: usize,
}
#[derive(Clone, Serialize)]
struct Progress {
    scan_id: String,
    checked: usize,
    total: usize,
}
static JOBS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
#[derive(Default)]
struct LibraryActivity {
    active: usize,
    maintenance: bool,
}
static ACTIVITY: OnceLock<Mutex<LibraryActivity>> = OnceLock::new();
pub struct LibraryActivityGuard;
pub(crate) struct MaintenanceGuard;
fn activity() -> &'static Mutex<LibraryActivity> {
    ACTIVITY.get_or_init(Default::default)
}
pub fn begin_library_activity() -> Result<LibraryActivityGuard, String> {
    let mut state = activity().lock().map_err(|e| e.to_string())?;
    if state.maintenance {
        return Err("Library maintenance is in progress".into());
    }
    state.active += 1;
    Ok(LibraryActivityGuard)
}
pub(crate) fn begin_maintenance() -> Result<MaintenanceGuard, String> {
    let mut state = activity().lock().map_err(|e| e.to_string())?;
    if state.maintenance || state.active != 0 {
        return Err("Wait for library scans and downloads to finish before maintenance".into());
    }
    state.maintenance = true;
    Ok(MaintenanceGuard)
}
impl Drop for LibraryActivityGuard {
    fn drop(&mut self) {
        if let Ok(mut state) = activity().lock() {
            state.active = state.active.saturating_sub(1);
        }
    }
}
impl Drop for MaintenanceGuard {
    fn drop(&mut self) {
        if let Ok(mut state) = activity().lock() {
            state.maintenance = false;
        }
    }
}
fn jobs() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    JOBS.get_or_init(Default::default)
}
fn snapshot(conn: &rusqlite::Connection) -> Result<(Vec<db::Track>, Vec<String>, u64), String> {
    let mut tracks = db::get_all_tracks(conn).map_err(|e| e.to_string())?;
    tracks.sort_by(|a, b| a.path.cmp(&b.path));
    let mut roots = db::get_library_directories(conn).map_err(|e| e.to_string())?;
    roots.sort();
    let mut hash = DefaultHasher::new();
    serde_json::to_string(&tracks)
        .map_err(|e| e.to_string())?
        .hash(&mut hash);
    roots.hash(&mut hash);
    Ok((tracks, roots, hash.finish()))
}
fn local(path: &str) -> bool {
    Path::new(path).is_absolute() && !path.contains("://")
}
fn issue(issues: &mut Vec<HealthIssue>, kind: &str, path: &str, detail: &str) {
    issues.push(HealthIssue {
        kind: kind.into(),
        paths: vec![path.into()],
        detail: detail.into(),
    });
}
fn normalize(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}
fn missing_tags(tag: Option<&lofty::tag::Tag>) -> Vec<&'static str> {
    [
        ("title", tag.and_then(|t| t.title())),
        ("artist", tag.and_then(|t| t.artist())),
        ("album", tag.and_then(|t| t.album())),
    ]
    .into_iter()
    .filter_map(|(name, value)| {
        if value.is_none_or(|v| v.trim().is_empty()) {
            Some(name)
        } else {
            None
        }
    })
    .collect()
}
fn duplicates(tracks: &[db::Track], cancel: &AtomicBool) -> Vec<HealthIssue> {
    let mut groups: HashMap<(String, String), Vec<&db::Track>> = HashMap::new();
    for track in tracks.iter().filter(|t| local(&t.path)) {
        if cancel.load(Ordering::Relaxed) {
            return Vec::new();
        }
        if let (Some(artist), Some(title), Some(duration)) =
            (&track.artist, &track.title, track.duration)
        {
            if artist.trim().is_empty()
                || title.trim().is_empty()
                || !duration.is_finite()
                || duration <= 0.0
            {
                continue;
            }
            groups
                .entry((normalize(artist), normalize(title)))
                .or_default()
                .push(track);
        }
    }
    let mut issues = Vec::new();
    for group in groups.values_mut() {
        if cancel.load(Ordering::Relaxed) {
            return Vec::new();
        }
        group.sort_by(|a, b| a.duration.unwrap().total_cmp(&b.duration.unwrap()));
        let mut start = 0;
        while start < group.len() {
            let mut end = start + 1;
            while end < group.len()
                && group[end].duration.unwrap() - group[start].duration.unwrap() <= 2.0
            {
                end += 1;
            }
            // ponytail: keep every version suffix; byte comparison belongs to an explicit verification action.
            if end - start > 1 {
                issues.push(HealthIssue {
                    kind: "possible_duplicate".into(),
                    paths: group[start..end].iter().map(|t| t.path.clone()).collect(),
                    detail: "Same artist/title and similar duration; recordings may differ.".into(),
                });
            }
            start = end;
        }
    }
    issues
}
fn classify(error: &std::io::Error, root: bool) -> &'static str {
    match error.kind() {
        std::io::ErrorKind::NotFound if root => "unavailable_root",
        std::io::ErrorKind::NotFound => "missing_file",
        _ => "inaccessible",
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct PathMapping {
    pub old_path: String,
    pub new_path: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RelocationPreview {
    pub old_root: String,
    pub new_root: String,
    pub fingerprint: String,
    pub mappings: Vec<PathMapping>,
    pub roots: Vec<PathMapping>,
    pub unresolved: Vec<String>,
    pub conflicts: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LibraryRemap {
    pub id: i64,
    pub mappings: Vec<PathMapping>,
    pub roots: Vec<PathMapping>,
    pub added_roots: Vec<String>,
    pub removed_roots: Vec<String>,
}
fn make_remap(
    id: i64,
    mappings: Vec<PathMapping>,
    roots: Vec<PathMapping>,
    undo: bool,
) -> LibraryRemap {
    let additions: Vec<_> = roots
        .iter()
        .filter(|m| m.old_path == m.new_path)
        .map(|m| m.new_path.clone())
        .collect();
    LibraryRemap {
        id,
        mappings,
        roots: roots
            .into_iter()
            .filter(|m| m.old_path != m.new_path)
            .collect(),
        added_roots: if undo { Vec::new() } else { additions.clone() },
        removed_roots: if undo { additions } else { Vec::new() },
    }
}
fn relocation_schema(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS library_relocations(id INTEGER PRIMARY KEY AUTOINCREMENT, mappings TEXT NOT NULL, roots TEXT NOT NULL, before_fingerprint TEXT NOT NULL, after_fingerprint TEXT NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0, undone INTEGER NOT NULL DEFAULT 0)").map_err(|e|e.to_string())
}
fn path_parts(path: &str) -> Option<Vec<String>> {
    if path.chars().any(char::is_control) || path.contains("://") {
        return None;
    }
    let path = path.replace('/', "\\");
    let path = if let Some(p) = path.strip_prefix("\\\\?\\UNC\\") {
        format!("\\\\{p}")
    } else {
        path.strip_prefix("\\\\?\\").unwrap_or(&path).to_string()
    };
    if !(Path::new(&path).is_absolute()
        || path.starts_with("\\\\")
        || path.as_bytes().get(1) == Some(&b':') && path.as_bytes().get(2) == Some(&b'\\'))
    {
        return None;
    }
    let parts: Vec<_> = path
        .split('\\')
        .filter(|p| !p.is_empty())
        .map(str::to_string)
        .collect();
    if parts
        .iter()
        .any(|p| p == "." || p == ".." || p.ends_with([' ', '.']))
    {
        return None;
    }
    if path.starts_with("\\\\") && parts.len() < 2 {
        return None;
    }
    Some(parts)
}
fn path_identity(path: &str) -> Option<String> {
    path_parts(path).map(|p| p.join("\\").to_lowercase())
}
fn relative_local_path(path: &str, root: &str) -> Option<std::path::PathBuf> {
    let path = path_parts(path)?;
    let root = path_parts(root)?;
    if path.len() < root.len()
        || path
            .iter()
            .zip(&root)
            .any(|(a, b)| a.to_lowercase() != b.to_lowercase())
    {
        return None;
    }
    Some(path[root.len()..].iter().collect())
}
fn table_exists(conn: &rusqlite::Connection, table: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1)",
        [table],
        |r| r.get(0),
    )
    .map_err(|e| e.to_string())
}
const REFERENCE_TABLES: &[&str] = &[
    "tracks",
    "playlist_tracks",
    "playlists",
    "playback_history",
    "recommendation_aliases",
    "recommendation_interest",
    "recommendation_training_ignored",
    "library_directories",
    "track_downloads",
    "download_jobs",
];
fn reference_fingerprint(conn: &rusqlite::Connection) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut digest = Sha256::new();
    for table in REFERENCE_TABLES {
        if !table_exists(conn, table)? {
            continue;
        }
        digest.update(table.as_bytes());
        let mut stmt = conn
            .prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))
            .map_err(|e| e.to_string())?;
        let count = stmt.column_count();
        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            for column in 0..count {
                let value = row.get_ref(column).map_err(|e| e.to_string())?;
                let bytes = match value {
                    rusqlite::types::ValueRef::Null => b"null".to_vec(),
                    rusqlite::types::ValueRef::Integer(v) => v.to_le_bytes().to_vec(),
                    rusqlite::types::ValueRef::Real(v) => v.to_le_bytes().to_vec(),
                    rusqlite::types::ValueRef::Text(v) | rusqlite::types::ValueRef::Blob(v) => {
                        v.to_vec()
                    }
                };
                digest.update(format!("{:?}:{}:", value.data_type(), bytes.len()).as_bytes());
                digest.update(bytes);
            }
        }
    }
    Ok(format!("{:x}", digest.finalize()))
}
fn content_fingerprint(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}
fn collect_json_paths(value: &serde_json::Value, paths: &mut std::collections::BTreeSet<String>) {
    match value {
        serde_json::Value::Object(object) => {
            for (key, item) in object {
                if (key == "path"
                    || key == "track_path"
                    || key == "cover_url"
                    || key == "id"
                        && object.get("provider").and_then(|p| p.as_str()) == Some("local"))
                    && item.as_str().is_some_and(|p| path_parts(p).is_some())
                {
                    paths.insert(item.as_str().unwrap().into());
                }
                collect_json_paths(item, paths);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect_json_paths(item, paths);
            }
        }
        _ => {}
    }
}
fn path_inventory(
    conn: &rusqlite::Connection,
) -> Result<std::collections::BTreeSet<String>, String> {
    let mut paths = std::collections::BTreeSet::new();
    for (table, column) in [
        ("tracks", "path"),
        ("tracks", "cover_url"),
        ("playlist_tracks", "track_path"),
        ("playback_history", "track_path"),
        ("track_downloads", "path"),
    ] {
        if !table_exists(conn, table)? || !db::column_exists(conn, table, column) {
            continue;
        }
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {column} FROM {table} WHERE {column} IS NOT NULL"
            ))
            .map_err(|e| e.to_string())?;
        for path in stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
        {
            let path = path.map_err(|e| e.to_string())?;
            if path_parts(&path).is_some() {
                paths.insert(path);
            }
        }
    }
    for (table, column) in [
        ("playlist_tracks", "source_context"),
        ("playlist_tracks", "metadata_json"),
        ("download_jobs", "record"),
    ] {
        if !table_exists(conn, table)? {
            continue;
        }
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {column} FROM {table} WHERE {column} IS NOT NULL"
            ))
            .map_err(|e| e.to_string())?;
        for json in stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
        {
            collect_json_paths(
                &serde_json::from_str(&json.map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?,
                &mut paths,
            );
        }
    }
    for table in ["recommendation_aliases", "playback_history"] {
        if !table_exists(conn, table)? || !db::column_exists(conn, table, "source_key") {
            continue;
        }
        let mut stmt = conn
            .prepare(&format!(
                "SELECT source_key FROM {table} WHERE source_key LIKE 'local:%'"
            ))
            .map_err(|e| e.to_string())?;
        for key in stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
        {
            paths.insert(key.map_err(|e| e.to_string())?[6..].into());
        }
    }
    Ok(paths)
}
fn compatible_media(original: Option<&db::Track>, old: &str, new: &Path) -> Result<(), String> {
    if Path::new(old).is_file() {
        if content_fingerprint(Path::new(old))? != content_fingerprint(new)? {
            return Err("Original and replacement content differ".into());
        }
        return Ok(());
    }
    let Some(original) = original else {
        return Err("No original metadata or file remains to verify this reference".into());
    };
    let replacement =
        crate::scanner::extract_metadata(new).ok_or("Replacement audio cannot be read")?;
    let mut evidence = 0;
    for (old, new) in [
        (&original.title, &replacement.title),
        (&original.artist, &replacement.artist),
        (&original.album, &replacement.album),
    ] {
        if let Some(old) = old.as_ref().filter(|s| !s.trim().is_empty()) {
            evidence += 1;
            if new.as_ref().is_none_or(|s| normalize(s) != normalize(old)) {
                return Err("Replacement tags differ from the original metadata".into());
            }
        }
    }
    if let Some(duration) = original.duration.filter(|d| d.is_finite() && *d > 0.0) {
        evidence += 1;
        if replacement
            .duration
            .is_none_or(|d| !d.is_finite() || (d - duration).abs() > 2.0)
        {
            return Err("Replacement duration differs".into());
        }
    }
    if evidence == 0 {
        return Err("Original metadata is insufficient to confirm this file".into());
    }
    if original.disc_number.is_some() && original.disc_number != replacement.disc_number
        || original.track_number.is_some() && original.track_number != replacement.track_number
    {
        return Err("Replacement disc or track number differs".into());
    }
    Ok(())
}
fn relocation_preview(
    conn: &rusqlite::Connection,
    old_root: &str,
    new_root: &str,
) -> Result<RelocationPreview, String> {
    use sha2::{Digest, Sha256};
    path_parts(old_root).ok_or("Invalid original root")?;
    path_parts(new_root).ok_or("Invalid replacement root")?;
    let canonical = std::fs::canonicalize(new_root)
        .map_err(|e| format!("Replacement folder unavailable: {e}"))?;
    if !canonical.is_dir() {
        return Err("Replacement must be a directory".into());
    }
    if relative_local_path(new_root, old_root).is_some()
        || relative_local_path(old_root, new_root).is_some()
        || std::fs::canonicalize(old_root)
            .ok()
            .is_some_and(|old| old.starts_with(&canonical) || canonical.starts_with(old))
    {
        return Err("Original and replacement folders must not overlap".into());
    }
    let roots = db::get_library_directories(conn).map_err(|e| e.to_string())?;
    if !roots
        .iter()
        .any(|r| path_identity(r) == path_identity(old_root))
    {
        return Err("Original folder is not a registered library root".into());
    }
    if roots
        .iter()
        .filter(|r| path_identity(r) == path_identity(old_root))
        .count()
        != 1
    {
        return Err(
            "Multiple registered roots identify the original folder; resolve the ambiguity first"
                .into(),
        );
    }
    if roots.iter().any(|r| {
        path_identity(r) != path_identity(old_root)
            && (relative_local_path(r, old_root).is_some()
                || relative_local_path(old_root, r).is_some()
                || relative_local_path(r, new_root).is_some()
                || relative_local_path(new_root, r).is_some())
    }) {
        return Err("Another registered library folder overlaps this relocation".into());
    }
    let paths = path_inventory(conn)?;
    let mut mappings = Vec::new();
    let mut unresolved = Vec::new();
    let mut conflicts = Vec::new();
    let mut targets = std::collections::BTreeMap::<String, String>::new();
    let mut digest = Sha256::new();
    digest.update(reference_fingerprint(conn)?.as_bytes());
    digest.update(old_root.as_bytes());
    digest.update(new_root.as_bytes());
    // Alias keys use normalized spelling; the stored track path owns the mapping when both exist.
    let tracks = db::get_all_tracks(conn).map_err(|e| e.to_string())?;
    let originals: HashMap<_, _> = tracks
        .iter()
        .filter_map(|track| path_identity(&track.path).map(|key| (key, track)))
        .collect();
    let mut candidates = std::collections::BTreeMap::new();
    for path in &paths {
        if relative_local_path(path, old_root).is_some() {
            candidates
                .entry(path_identity(path).unwrap())
                .or_insert(path.clone());
        }
    }
    let mut track_identities = std::collections::HashSet::new();
    for track in &tracks {
        if relative_local_path(&track.path, old_root).is_some() {
            let identity = path_identity(&track.path).unwrap();
            if !track_identities.insert(identity.clone()) {
                conflicts.push(format!(
                    "{}: multiple track rows identify the same original file",
                    track.path
                ));
            }
            candidates.insert(identity, track.path.clone());
        }
    }
    for old in candidates.values() {
        let target = Path::new(new_root).join(relative_local_path(old, old_root).unwrap());
        let new = target.to_string_lossy().to_string();
        digest.update(old.as_bytes());
        digest.update(new.as_bytes());
        if !target.is_file() {
            unresolved.push(format!("{old} → {new}: replacement file unavailable"));
            digest.update(b"unavailable");
            continue;
        }
        let real = std::fs::canonicalize(&target).map_err(|e| e.to_string())?;
        if !real.starts_with(&canonical) {
            conflicts.push(format!("{new}: replacement escapes the selected folder"));
            continue;
        }
        let identity = path_identity(real.to_str().ok_or("Replacement path is not Unicode")?)
            .ok_or("Invalid canonical replacement path")?;
        if targets.insert(identity, old.clone()).is_some() {
            conflicts.push(format!("{new}: multiple originals share a replacement"));
            continue;
        }
        if paths
            .iter()
            .any(|p| path_identity(p) == path_identity(&new))
        {
            conflicts.push(format!("{new}: already referenced by the library"));
            continue;
        }
        digest.update(content_fingerprint(&target)?.as_bytes());
        if let Err(reason) = compatible_media(
            originals.get(&path_identity(old).unwrap()).copied(),
            old,
            &target,
        ) {
            let detail = format!("{old} → {new}: {reason}");
            if reason.contains("differ") {
                conflicts.push(detail);
            } else {
                unresolved.push(detail);
            }
            digest.update(reason.as_bytes());
            continue;
        }
        mappings.push(PathMapping {
            old_path: old.clone(),
            new_path: new,
        });
    }
    let root_mappings = if unresolved.is_empty() {
        vec![PathMapping {
            old_path: roots
                .iter()
                .find(|r| path_identity(r) == path_identity(old_root))
                .unwrap()
                .clone(),
            new_path: new_root.into(),
        }]
    } else {
        Vec::new()
    };
    digest.update(
        serde_json::to_vec(&(&mappings, &unresolved, &conflicts)).map_err(|e| e.to_string())?,
    );
    Ok(RelocationPreview {
        old_root: old_root.into(),
        new_root: new_root.into(),
        fingerprint: format!("{:x}", digest.finalize()),
        mappings,
        roots: root_mappings,
        unresolved,
        conflicts,
    })
}
fn remap_path(path: &str, mappings: &[PathMapping]) -> Option<String> {
    mappings
        .iter()
        .find(|m| {
            path_identity(path).is_some() && path_identity(path) == path_identity(&m.old_path)
        })
        .map(|m| m.new_path.clone())
}
fn local_source_key(path: &str) -> String {
    format!("local:{}", path.replace('/', "\\").to_lowercase())
}
pub(crate) fn validate_rollback_path(
    conn: &rusqlite::Connection,
    path: &str,
) -> Result<(), String> {
    if !Path::new(path).is_absolute()
        || !Path::new(path)
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("json"))
    {
        return Err("Choose an absolute JSON rollback backup path".into());
    }
    let canonical = std::fs::canonicalize(path).ok();
    if path_inventory(conn)?.iter().any(|p| {
        path_identity(p) == path_identity(path)
            || canonical
                .as_ref()
                .is_some_and(|target| std::fs::canonicalize(p).ok().as_ref() == Some(target))
    }) {
        return Err("Rollback backup must not replace a referenced library file".into());
    }
    Ok(())
}
fn remap_json(value: &mut serde_json::Value, mappings: &[PathMapping]) {
    match value {
        serde_json::Value::Object(object) => {
            let provider = object
                .get("provider")
                .and_then(|p| p.as_str())
                .map(str::to_owned);
            for (key, item) in object.iter_mut() {
                if key == "recording_id"
                    || key == "id" && provider.as_deref().is_some_and(|p| p != "local")
                {
                    continue;
                }
                if key == "path"
                    || key == "track_path"
                    || key == "cover_url"
                    || key == "id" && provider.as_deref() == Some("local")
                {
                    if let Some(next) = item.as_str().and_then(|p| remap_path(p, mappings)) {
                        *item = serde_json::Value::String(next);
                    }
                } else {
                    remap_json(item, mappings);
                }
            }
            if let Some(path) = object.get("path").and_then(|p| p.as_str()) {
                if mappings.iter().any(|m| m.new_path == path) {
                    let hash = format!("{:x}", md5::compute(path.as_bytes()));
                    if object.contains_key("path_hash") {
                        object.insert("path_hash".into(), serde_json::Value::String(hash));
                    }
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                remap_json(item, mappings);
            }
        }
        _ => {}
    }
}
fn update_references(
    conn: &rusqlite::Connection,
    mappings: &[PathMapping],
    roots: &[PathMapping],
) -> Result<(), String> {
    for (table, column) in [
        ("tracks", "path"),
        ("tracks", "cover_url"),
        ("playlist_tracks", "track_path"),
        ("playback_history", "track_path"),
        ("track_downloads", "path"),
    ] {
        if !table_exists(conn, table)? || !db::column_exists(conn, table, column) {
            continue;
        }
        let values: Vec<(i64, String)> = {
            let mut stmt = conn
                .prepare(&format!(
                    "SELECT rowid,{column} FROM {table} WHERE {column} IS NOT NULL"
                ))
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
        };
        for (row, path) in values {
            if let Some(new) = remap_path(&path, mappings) {
                conn.execute(
                    &format!("UPDATE {table} SET {column}=?1 WHERE rowid=?2"),
                    rusqlite::params![new, row],
                )
                .map_err(|e| e.to_string())?;
                if table == "tracks" && column == "path" {
                    conn.execute(
                        "UPDATE tracks SET path_hash=?1 WHERE id=?2",
                        rusqlite::params![format!("{:x}", md5::compute(new.as_bytes())), row],
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
        }
    }
    for column in ["source_context", "metadata_json"] {
        let values: Vec<(i64, String)> = {
            let mut stmt = conn
                .prepare(&format!(
                    "SELECT entry_id,{column} FROM playlist_tracks WHERE {column} IS NOT NULL"
                ))
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
        };
        for (id, json) in values {
            let mut value: serde_json::Value =
                serde_json::from_str(&json).map_err(|e| e.to_string())?;
            let original = value.clone();
            remap_json(&mut value, mappings);
            if value != original {
                conn.execute(
                    &format!("UPDATE playlist_tracks SET {column}=?1 WHERE entry_id=?2"),
                    rusqlite::params![value.to_string(), id],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }
    for mapping in mappings {
        let old_key = local_source_key(&mapping.old_path);
        let new_key = local_source_key(&mapping.new_path);
        if table_exists(conn, "recommendation_aliases")? {
            conn.execute(
                "UPDATE recommendation_aliases SET source_key=?1 WHERE source_key=?2",
                rusqlite::params![new_key, old_key],
            )
            .map_err(|e| e.to_string())?;
        }
        if db::column_exists(conn, "playback_history", "source_key") {
            conn.execute(
                "UPDATE playback_history SET source_key=?1 WHERE source_key=?2",
                rusqlite::params![new_key, old_key],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    if table_exists(conn, "download_jobs")? {
        let values: Vec<(String, i64, String)> = {
            let mut stmt = conn
                .prepare("SELECT id,revision,record FROM download_jobs")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<_, _>>().map_err(|e| e.to_string())?
        };
        for (id, revision, json) in values {
            let mut value: serde_json::Value =
                serde_json::from_str(&json).map_err(|e| e.to_string())?;
            let before = value.clone();
            remap_json(&mut value, mappings);
            if value != before {
                let next = revision
                    .checked_add(1)
                    .ok_or("Download revision overflow")?;
                value
                    .as_object_mut()
                    .ok_or("Invalid download record")?
                    .insert("revision".into(), serde_json::json!(next));
                conn.execute(
                    "UPDATE download_jobs SET revision=?1,record=?2 WHERE id=?3",
                    rusqlite::params![next, value.to_string(), id],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }
    for root in roots {
        conn.execute(
            "UPDATE library_directories SET path=?1 WHERE path=?2",
            rusqlite::params![root.new_path, root.old_path],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn apply_relocation(
    conn: &mut rusqlite::Connection,
    preview: &RelocationPreview,
) -> Result<LibraryRemap, String> {
    relocation_schema(conn)?;
    crate::backup::init_schema(conn).map_err(|e| e.to_string())?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let fresh = relocation_preview(&tx, &preview.old_root, &preview.new_root)?;
    if fresh.fingerprint != preview.fingerprint {
        return Err("Library or replacement files changed after preview; preview again".into());
    }
    if !fresh.conflicts.is_empty() || fresh.mappings.is_empty() {
        return Err("No conflict-free confirmed mappings to apply".into());
    }
    let before = reference_fingerprint(&tx)?;
    update_references(&tx, &fresh.mappings, &fresh.roots)?;
    tx.execute(
        "INSERT OR IGNORE INTO library_directories(path) VALUES (?1)",
        [&fresh.new_root],
    )
    .map_err(|e| e.to_string())?;
    let after = reference_fingerprint(&tx)?;
    let mut roots = fresh.roots;
    if roots.is_empty() {
        roots.push(PathMapping {
            old_path: fresh.new_root.clone(),
            new_path: fresh.new_root,
        });
    }
    tx.execute("INSERT INTO library_relocations(mappings,roots,before_fingerprint,after_fingerprint) VALUES(?1,?2,?3,?4)",rusqlite::params![serde_json::to_string(&fresh.mappings).map_err(|e|e.to_string())?,serde_json::to_string(&roots).map_err(|e|e.to_string())?,before,after]).map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO local_backup_state(key,value) VALUES('cloud_reconciliation_pending','true') ON CONFLICT(key) DO UPDATE SET value='true'",[]).map_err(|e|e.to_string())?;
    let remap = make_remap(tx.last_insert_rowid(), fresh.mappings, roots, false);
    tx.commit().map_err(|e| e.to_string())?;
    Ok(remap)
}
fn pending_remaps(conn: &rusqlite::Connection) -> Result<Vec<LibraryRemap>, String> {
    relocation_schema(conn)?;
    let mut stmt=conn.prepare("SELECT id,mappings,roots,undone FROM library_relocations WHERE acknowledged=0 ORDER BY id").map_err(|e|e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, bool>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    rows.map(|r| {
        let (id, mappings, roots, undo) = r.map_err(|e| e.to_string())?;
        Ok(make_remap(
            id,
            serde_json::from_str(&mappings).map_err(|e| e.to_string())?,
            serde_json::from_str(&roots).map_err(|e| e.to_string())?,
            undo,
        ))
    })
    .collect()
}
fn undo_relocation(conn: &mut rusqlite::Connection, id: i64) -> Result<LibraryRemap, String> {
    relocation_schema(conn)?;
    crate::backup::init_schema(conn).map_err(|e| e.to_string())?;
    let tx = conn
        .transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    let (json, root_json, after, undone): (String, String, String, bool) = tx
        .query_row(
            "SELECT mappings,roots,after_fingerprint,undone FROM library_relocations WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|e| e.to_string())?;
    if undone || reference_fingerprint(&tx)? != after {
        return Err(
            "Library references changed after relocation; Undo would overwrite later edits".into(),
        );
    }
    let mappings: Vec<PathMapping> = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    let roots: Vec<PathMapping> = serde_json::from_str(&root_json).map_err(|e| e.to_string())?;
    let inverse: Vec<_> = mappings
        .into_iter()
        .map(|m| PathMapping {
            old_path: m.new_path,
            new_path: m.old_path,
        })
        .collect();
    let inverse_roots: Vec<_> = roots
        .iter()
        .filter(|m| m.old_path != m.new_path)
        .map(|m| PathMapping {
            old_path: m.new_path.clone(),
            new_path: m.old_path.clone(),
        })
        .collect();
    update_references(&tx, &inverse, &inverse_roots)?;
    for root in roots.iter().filter(|m| m.old_path == m.new_path) {
        tx.execute(
            "DELETE FROM library_directories WHERE path=?1",
            [&root.new_path],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.execute(
        "UPDATE library_relocations SET undone=1,acknowledged=1 WHERE id=?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    let before = reference_fingerprint(&tx)?;
    let inverse_roots: Vec<_> = inverse_roots
        .into_iter()
        .chain(roots.into_iter().filter(|m| m.old_path == m.new_path))
        .collect();
    tx.execute("INSERT INTO library_relocations(mappings,roots,before_fingerprint,after_fingerprint,undone) VALUES(?1,?2,?3,?3,1)",rusqlite::params![serde_json::to_string(&inverse).map_err(|e|e.to_string())?,serde_json::to_string(&inverse_roots).map_err(|e|e.to_string())?,before]).map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO local_backup_state(key,value) VALUES('cloud_reconciliation_pending','true') ON CONFLICT(key) DO UPDATE SET value='true'",[]).map_err(|e|e.to_string())?;
    let remap = make_remap(tx.last_insert_rowid(), inverse, inverse_roots, true);
    tx.commit().map_err(|e| e.to_string())?;
    Ok(remap)
}
#[tauri::command]
pub async fn preview_library_relocation(
    state: State<'_, AppState>,
    old_root: String,
    new_root: String,
) -> Result<RelocationPreview, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let conn = db.lock().map_err(|e| e.to_string())?;
        relocation_preview(&conn, &old_root, &new_root)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn apply_library_relocation(
    state: State<'_, AppState>,
    preview: RelocationPreview,
    rollback_path: String,
    settings: std::collections::BTreeMap<String, String>,
) -> Result<LibraryRemap, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _maintenance = begin_maintenance()?;
        let player = state.player.lock().map_err(|e| e.to_string())?;
        if player.status.load(Ordering::SeqCst) != 0 {
            return Err("Stop playback before relocating a library folder".into());
        }
        let mut conn = state.db.lock().map_err(|e| e.to_string())?;
        validate_rollback_path(&conn, &rollback_path)?;
        if relative_local_path(&rollback_path, &preview.old_root).is_some()
            || relative_local_path(&rollback_path, &preview.new_root).is_some()
        {
            return Err(
                "Save the rollback backup outside the original and replacement library folders"
                    .into(),
            );
        }
        crate::backup::write_rollback_snapshot(&conn, &rollback_path, settings)?;
        let remap = apply_relocation(&mut conn, &preview)?;
        for m in &remap.mappings {
            crate::artwork::invalidate_cover_cache(&m.old_path);
            crate::artwork::invalidate_cover_cache(&m.new_path);
        }
        Ok(remap)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn undo_library_relocation(
    state: State<'_, AppState>,
    id: i64,
    rollback_path: String,
    settings: std::collections::BTreeMap<String, String>,
) -> Result<LibraryRemap, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _maintenance = begin_maintenance()?;
        let player = state.player.lock().map_err(|e| e.to_string())?;
        if player.status.load(Ordering::SeqCst) != 0 {
            return Err("Stop playback before undoing relocation".into());
        }
        let mut conn = state.db.lock().map_err(|e| e.to_string())?;
        validate_rollback_path(&conn, &rollback_path)?;
        crate::backup::write_rollback_snapshot(&conn, &rollback_path, settings)?;
        let remap = undo_relocation(&mut conn, id)?;
        for m in &remap.mappings {
            crate::artwork::invalidate_cover_cache(&m.old_path);
            crate::artwork::invalidate_cover_cache(&m.new_path);
        }
        Ok(remap)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn pending_library_relocations(
    state: State<'_, AppState>,
) -> Result<Vec<LibraryRemap>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    pending_remaps(&conn)
}
#[tauri::command]
pub fn ack_library_relocation(state: State<'_, AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    relocation_schema(&conn)?;
    conn.execute(
        "UPDATE library_relocations SET acknowledged=1 WHERE id=?1",
        [id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
#[derive(Serialize)]
pub struct RelocationUndoPreview {
    id: i64,
    mappings: Vec<PathMapping>,
    missing_paths: Vec<String>,
    conflicts: Vec<String>,
}
#[tauri::command]
pub fn preview_library_relocation_undo(
    state: State<'_, AppState>,
    id: i64,
) -> Result<RelocationUndoPreview, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    relocation_schema(&conn)?;
    let (json, after, undone): (String, String, bool) = conn
        .query_row(
            "SELECT mappings,after_fingerprint,undone FROM library_relocations WHERE id=?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|e| e.to_string())?;
    let mappings: Vec<PathMapping> = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    let mappings: Vec<_> = mappings
        .into_iter()
        .map(|m| PathMapping {
            old_path: m.new_path,
            new_path: m.old_path,
        })
        .collect();
    let missing_paths = mappings
        .iter()
        .filter(|m| !Path::new(&m.new_path).is_file())
        .map(|m| m.new_path.clone())
        .collect();
    let conflicts = if undone || reference_fingerprint(&conn)? != after {
        vec!["Library references changed after relocation; Undo would overwrite later edits".into()]
    } else {
        Vec::new()
    };
    Ok(RelocationUndoPreview {
        id,
        mappings,
        missing_paths,
        conflicts,
    })
}
#[tauri::command]
pub fn cancel_library_health(scan_id: String) -> Result<(), String> {
    if let Some(cancel) = jobs().lock().map_err(|e| e.to_string())?.get(&scan_id) {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}
#[tauri::command]
pub async fn scan_library_health(
    scan_id: String,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<HealthReport, String> {
    let _activity = begin_library_activity()?;
    if scan_id.is_empty() || scan_id.len() > 128 {
        return Err("Invalid scan ID".into());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut jobs = jobs().lock().map_err(|e| e.to_string())?;
        if !jobs.is_empty() {
            return Err("A library health scan is already running".into());
        }
        jobs.insert(scan_id.clone(), cancel.clone());
    }
    let db = state.db.clone();
    let id = scan_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<HealthReport, String> {
        let (tracks, roots, revision) = snapshot(&*db.lock().map_err(|e| e.to_string())?)?;
        let local_tracks: Vec<_> = tracks.into_iter().filter(|t| local(&t.path)).collect();
        let total = local_tracks.len();
        let mut issues = Vec::new();
        let mut unavailable = Vec::new();
        for root in &roots {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            if let Err(error) = std::fs::read_dir(root) {
                issue(
                    &mut issues,
                    classify(&error, true),
                    root,
                    &error.to_string(),
                );
                unavailable.push(root);
            }
        }
        let mut checked = 0;
        for track in &local_tracks {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            if !unavailable
                .iter()
                .any(|root| Path::new(&track.path).starts_with(root))
            {
                match std::fs::File::open(&track.path) {
                    Err(error) => issue(
                        &mut issues,
                        classify(&error, false),
                        &track.path,
                        &error.to_string(),
                    ),
                    Ok(_) => match lofty::read_from_path(&track.path) {
                        Ok(file) => {
                            let tag = file.primary_tag().or_else(|| file.first_tag());
                            let missing = missing_tags(tag);
                            if !missing.is_empty() {
                                issue(
                                    &mut issues,
                                    "incomplete_tags",
                                    &track.path,
                                    &format!("Missing {}", missing.join(", ")),
                                );
                            }
                            crate::artwork::invalidate_cover_cache(&track.path);
                            if crate::artwork::get_cover_art(&track.path).is_none() {
                                issue(
                                    &mut issues,
                                    "absent_artwork",
                                    &track.path,
                                    "No embedded or local folder artwork found.",
                                );
                            }
                        }
                        Err(error) => issue(
                            &mut issues,
                            "unreadable_metadata",
                            &track.path,
                            &error.to_string(),
                        ),
                    },
                }
            }
            checked += 1;
            if checked % 25 == 0 || checked == total {
                let _ = app.emit(
                    "library-health-progress",
                    Progress {
                        scan_id: id.clone(),
                        checked,
                        total,
                    },
                );
            }
        }
        let cancelled = cancel.load(Ordering::Relaxed);
        if !cancelled {
            issues.extend(duplicates(&local_tracks, &cancel));
        }
        let cancelled = cancel.load(Ordering::Relaxed);
        let invalidated = snapshot(&*db.lock().map_err(|e| e.to_string())?)?.2 != revision;
        Ok(HealthReport {
            scan_id: id,
            issues,
            cancelled,
            invalidated,
            checked,
            total,
        })
    })
    .await
    .map_err(|e| e.to_string())
    .and_then(|r| r);
    jobs().lock().map_err(|e| e.to_string())?.remove(&scan_id);
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn errors_and_provider_paths_are_distinct() {
        assert_eq!(
            classify(&std::io::Error::from(std::io::ErrorKind::NotFound), true),
            "unavailable_root"
        );
        assert_eq!(
            classify(&std::io::Error::from(std::io::ErrorKind::NotFound), false),
            "missing_file"
        );
        assert_eq!(
            classify(
                &std::io::Error::from(std::io::ErrorKind::PermissionDenied),
                true
            ),
            "inaccessible"
        );
        for path in [
            "tidal:123",
            "qobuz:456",
            "https://example.com/music",
            "youtube:foo",
        ] {
            assert!(!local(path));
        }
    }
    #[test]
    fn cancellation_is_scoped() {
        let flag = Arc::new(AtomicBool::new(false));
        jobs()
            .lock()
            .unwrap()
            .insert("fixture".into(), flag.clone());
        cancel_library_health("fixture".into()).unwrap();
        assert!(flag.load(Ordering::Relaxed));
        jobs().lock().unwrap().remove("fixture");
    }
    #[test]
    fn snapshot_detects_later_changes_and_duplicates_preserve_versions() {
        let conn = db::init_db(":memory:").unwrap();
        let before = snapshot(&conn).unwrap().2;
        let paths = [
            std::env::temp_dir().join("health-studio-a.flac"),
            std::env::temp_dir().join("health-studio-b.flac"),
            std::env::temp_dir().join("health-live.flac"),
            std::env::temp_dir().join("health-long.flac"),
        ];
        for (index, path) in paths.iter().enumerate() {
            conn.execute("INSERT INTO tracks (path,title,artist,album,duration,path_hash) VALUES (?1,?2,'Artist','Album',?3,'same-path-hash')", rusqlite::params![path.to_string_lossy(), if index == 2 { "Song (Live)" } else { "Song" }, if index == 3 { 300.0 } else { 200.0 }]).unwrap();
        }
        let (tracks, _, after) = snapshot(&conn).unwrap();
        assert_ne!(before, after);
        let matches = duplicates(&tracks, &AtomicBool::new(false));
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].paths.len(), 2);
        assert!(!matches[0]
            .paths
            .contains(&paths[2].to_string_lossy().to_string()));
        assert!(duplicates(&tracks, &AtomicBool::new(true)).is_empty());
        assert_eq!(snapshot(&conn).unwrap().2, after);
    }
    #[test]
    fn incomplete_tags_and_absent_artwork_use_isolated_fixture() {
        let mut tag = lofty::tag::Tag::new(lofty::tag::TagType::Id3v2);
        tag.set_title("Song".into());
        tag.set_artist(" ".into());
        assert_eq!(missing_tags(Some(&tag)), vec!["artist", "album"]);
        assert_eq!(missing_tags(None), vec!["title", "artist", "album"]);
        let dir = std::env::temp_dir().join(format!(
            "aideo-health-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("fixture.mp3");
        std::fs::write(&path, b"isolated unreadable fixture").unwrap();
        assert!(crate::artwork::get_cover_art(path.to_str().unwrap()).is_none());
        std::fs::write(dir.join("cover.jpg"), b"fixture artwork").unwrap();
        crate::artwork::invalidate_cover_cache(path.to_str().unwrap());
        assert!(crate::artwork::get_cover_art(path.to_str().unwrap()).is_some());
        std::fs::remove_file(dir.join("cover.jpg")).unwrap();
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
}
