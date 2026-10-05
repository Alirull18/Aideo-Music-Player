use crate::db::{PlaybackSource, SourceProvider};
use crate::sources::SourceQuality;
use crate::{safe_lock, AppState};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncWriteExt;
use tokio::sync::watch;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DownloadOption {
    pub id: String,
    pub label: String,
    pub extension: String,
    pub quality: SourceQuality,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Collision {
    Ask,
    KeepBoth,
    Replace,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct DownloadJob {
    pub id: String,
    pub revision: u64,
    pub source: PlaybackSource,
    pub option: DownloadOption,
    pub path: String,
    pub status: String,
    pub downloaded: u64,
    pub total: Option<u64>,
    pub percent: Option<f64>,
    pub error: Option<String>,
    pub saved: bool,
    collision: Collision,
    #[serde(default)]
    etag: Option<String>,
    #[serde(default)]
    fingerprint: Option<String>,
}

struct Entry {
    job: DownloadJob,
    cancel: watch::Sender<bool>,
}
#[derive(Default)]
pub struct DownloadState(Mutex<HashMap<String, Entry>>);

fn partial_path(job: &DownloadJob) -> PathBuf {
    Path::new(&job.path).with_file_name(format!(".aideo-{}.{}.part", job.id, job.option.extension))
}

fn validate_partial(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if !metadata.is_file() || metadata.file_type().is_symlink() => {
            Err("Partial download is not an owned regular file".into())
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Cannot inspect partial download: {error}")),
    }
}

fn job_table(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS download_jobs (id TEXT PRIMARY KEY, version INTEGER NOT NULL, revision INTEGER NOT NULL, record TEXT NOT NULL)").map_err(|e| e.to_string())
}

fn persist_job(conn: &rusqlite::Connection, job: &DownloadJob) -> Result<(), String> {
    job_table(conn)?;
    let mut safe = job.clone();
    if let Some(metadata) = &mut safe.source.metadata {
        metadata.cover_url = None;
        metadata.duration_raw = None;
    }
    // Provider failures can contain signed URLs; retain details only in memory.
    safe.error = None;
    conn.execute("INSERT INTO download_jobs(id,version,revision,record) VALUES (?1,1,?2,?3) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,record=excluded.record WHERE excluded.revision >= download_jobs.revision", rusqlite::params![safe.id, i64::try_from(safe.revision).map_err(|_| "Download revision overflow")?, serde_json::to_string(&safe).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
    Ok(())
}

fn persist(app: &AppHandle, job: &DownloadJob) -> Result<(), String> {
    persist_job(&safe_lock(&app.state::<AppState>().db), job)
}

fn file_fingerprint(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Read;
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut digest = Sha256::new();
    let mut bytes = [0; 65536];
    loop {
        let count = file.read(&mut bytes).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        digest.update(&bytes[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn recover_job(job: &mut DownloadJob) -> Result<(), String> {
    validate_source(&job.source)?;
    filename(&job.source, &job.option.extension)?;
    if !Path::new(&job.path).is_absolute()
        || job.id.is_empty()
        || !job
            .id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("Invalid saved download destination".into());
    }
    if (job.saved || job.status == "completed")
        && (job.fingerprint.is_none()
            || file_fingerprint(Path::new(&job.path)).ok() != job.fingerprint)
    {
        job.saved = false;
        job.status = "recoverable".into();
        job.error = Some("Saved output changed or is missing. Choose another copy or discard this job; it was not imported.".into());
        job.percent = None;
        job.revision += 1;
        return Ok(());
    }
    if job.fingerprint.is_some() && matches!(job.status.as_str(), "failed" | "recoverable") {
        job.saved = file_fingerprint(Path::new(&job.path)).ok() == job.fingerprint;
    }
    if job.status == "cancelling" {
        let partial = partial_path(job);
        validate_partial(&partial)?;
        if partial.exists() {
            std::fs::remove_file(partial).map_err(|e| e.to_string())?;
        }
        job.status = "cancelled".into();
        job.revision += 1;
    }
    if matches!(
        job.status.as_str(),
        "preparing" | "downloading" | "cancelling" | "finalizing"
    ) {
        if let Some(expected) = &job.fingerprint {
            job.saved = file_fingerprint(Path::new(&job.path)).ok().as_ref() == Some(expected);
        }
        job.status = "recoverable".into();
        job.error = Some(
            if job.saved {
                "File saved. Retry to finish adding it to the library."
            } else {
                "Download interrupted. Retry or discard it."
            }
            .into(),
        );
        job.revision += 1;
    }
    Ok(())
}

#[cfg(test)]
struct PartialFile(PathBuf);
#[cfg(test)]
impl PartialFile {
    fn create(path: PathBuf) -> Result<Self, String> {
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|e| format!("Cannot create partial download: {e}"))?;
        Ok(Self(path))
    }
}
#[cfg(test)]
impl Drop for PartialFile {
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_file(&self.0) {
            if error.kind() != std::io::ErrorKind::NotFound {
                eprintln!("[download] Could not remove partial file: {error}");
            }
        }
    }
}

fn validate_source(source: &PlaybackSource) -> Result<(), String> {
    match source.provider {
        SourceProvider::Tidal | SourceProvider::Qobuz => {
            crate::sources::validate_track_id(&source.id)?
        }
        SourceProvider::Youtube
            if source.id.len() == 11
                && source
                    .id
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-') =>
        {
            ()
        }
        _ => return Err("This source is already local or has no downloadable provider ID".into()),
    }
    if let Some(metadata) = &source.metadata {
        if [
            &metadata.title,
            &metadata.artist,
            &metadata.album,
            &metadata.cover_url,
        ]
        .iter()
        .any(|v| v.as_ref().is_some_and(|v| v.len() > 4096))
            || metadata.duration.is_some_and(|d| !d.is_finite() || d < 0.0)
        {
            return Err("Invalid download metadata".into());
        }
    }
    Ok(())
}

fn quality_label(quality: &SourceQuality) -> String {
    let codec = quality.codec.as_deref().unwrap_or("Unknown codec");
    let mut label = codec.to_uppercase();
    if let Some(bits) = quality.bit_depth {
        label.push_str(&format!(" · {bits}-bit"));
    }
    if let Some(rate) = quality.sample_rate {
        label.push_str(&format!(" · {} kHz", rate / 1000.0));
    }
    if quality.lossless == Some(true)
        && (quality.bit_depth.is_none() || quality.sample_rate.is_none())
    {
        label.push_str(" · resolution unknown");
    }
    label
}

struct DownloadStream {
    option: DownloadOption,
    url: String,
    headers: reqwest::header::HeaderMap,
}

async fn youtube_formats(id: &str) -> Result<serde_json::Value, String> {
    let binary = dirs::data_dir()
        .ok_or("Cannot locate yt-dlp")?
        .join("Aideo/yt-dlp.exe");
    if !binary.is_file() {
        return Err("Install the Web Stream Decoder in Settings > System first".into());
    }
    let mut command = tokio::process::Command::new(binary);
    command
        .args([
            "--ignore-config",
            "--no-cache-dir",
            "--no-update",
            "--no-playlist",
            "--no-check-formats",
            "--skip-download",
            "--dump-single-json",
            "--socket-timeout",
            "15",
            "--retries",
            "0",
            "--force-ipv4",
            "--",
        ])
        .arg(format!("https://www.youtube.com/watch?v={id}"))
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let output = tokio::time::timeout(Duration::from_secs(60), command.output())
        .await
        .map_err(|_| "Checking Webstream formats timed out")?
        .map_err(|e| format!("Cannot run yt-dlp: {e}"))?;
    if !output.status.success() {
        return Err("Webstream formats could not be checked. Check your connection and update the Web Stream Decoder in Settings.".into());
    }
    serde_json::from_slice(&output.stdout)
        .map_err(|_| "Webstream returned invalid format information".into())
}

fn youtube_streams(json: &serde_json::Value) -> Vec<DownloadStream> {
    json["formats"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|format| {
            if format["vcodec"].as_str() != Some("none")
                || format["acodec"].as_str().is_none_or(|c| c == "none")
                || !matches!(format["protocol"].as_str(), Some("https" | "http"))
                || format.get("fragments").is_some()
            {
                return None;
            }
            let id = format["format_id"].as_str()?;
            let extension = format["ext"].as_str()?;
            if !matches!(extension, "m4a" | "webm" | "mp3" | "ogg" | "opus") {
                return None;
            }
            let quality = SourceQuality {
                lossless: Some(false),
                codec: format["acodec"].as_str().map(str::to_owned),
                sample_rate: format["asr"].as_f64(),
                bit_depth: None,
            };
            let mut label = quality_label(&quality);
            if let Some(bitrate) = format["abr"].as_f64() {
                label.push_str(&format!(" · {bitrate:.0} kbps"));
            }
            label.push_str(&format!(" · {}", extension.to_uppercase()));
            let mut headers = reqwest::header::HeaderMap::new();
            if let Some(values) = format["http_headers"]
                .as_object()
                .or_else(|| json["http_headers"].as_object())
            {
                for name in ["User-Agent", "Referer", "Origin"] {
                    if let Some(value) = values.get(name).and_then(|v| v.as_str()) {
                        if let (Ok(name), Ok(value)) = (
                            reqwest::header::HeaderName::from_bytes(name.as_bytes()),
                            reqwest::header::HeaderValue::from_str(value),
                        ) {
                            headers.insert(name, value);
                        }
                    }
                }
            }
            Some(DownloadStream {
                option: DownloadOption {
                    id: id.into(),
                    label,
                    extension: extension.into(),
                    quality,
                },
                url: format["url"].as_str()?.into(),
                headers,
            })
        })
        .collect()
}

async fn resolve_format(
    app: &AppHandle,
    source: &PlaybackSource,
    format: &str,
) -> Result<DownloadStream, String> {
    validate_source(source)?;
    if source.provider == SourceProvider::Youtube {
        return youtube_streams(&youtube_formats(&source.id).await?)
            .into_iter()
            .find(|s| s.option.id == format)
            .ok_or("The selected Webstream format is no longer available".into());
    }
    let resolved = match source.provider {
        SourceProvider::Tidal => {
            crate::tidal::resolve_download_format(
                &app.state::<Arc<crate::tidal::TidalState>>(),
                app,
                &source.id,
                format,
            )
            .await?
        }
        SourceProvider::Qobuz => {
            crate::qobuz::resolve_download_format(
                &app.state::<Arc<crate::qobuz::QobuzState>>(),
                app,
                &source.id,
                format.parse().map_err(|_| "Invalid Qobuz format")?,
            )
            .await?
        }
        _ => return Err("Unsupported download source".into()),
    };
    let codec = resolved
        .quality
        .codec
        .as_deref()
        .unwrap_or("")
        .to_lowercase();
    let extension = if codec.contains("flac") {
        "flac"
    } else if codec.contains("mpeg") && !codec.contains("mp4") {
        "mp3"
    } else if codec.contains("aac") || codec.contains("mp4") || codec.contains("m4a") {
        "m4a"
    } else {
        return Err("The provider did not verify a supported download container".into());
    };
    Ok(DownloadStream {
        option: DownloadOption {
            id: format.into(),
            label: quality_label(&resolved.quality),
            extension: extension.into(),
            quality: resolved.quality,
        },
        url: resolved.url,
        headers: Default::default(),
    })
}

#[tauri::command]
pub async fn get_track_download_options(
    app: AppHandle,
    source: PlaybackSource,
) -> Result<Vec<DownloadOption>, String> {
    validate_source(&source)?;
    if source.provider == SourceProvider::Youtube {
        let options: Vec<_> = youtube_streams(&youtube_formats(&source.id).await?)
            .into_iter()
            .map(|s| s.option)
            .collect();
        return if options.is_empty() {
            Err("No directly downloadable audio formats were found".into())
        } else {
            Ok(options)
        };
    }
    let formats: &[&str] = if source.provider == SourceProvider::Tidal {
        &["HI_RES_LOSSLESS", "LOSSLESS", "HIGH", "LOW"]
    } else {
        &["27", "7", "6", "5"]
    };
    let results = futures::future::join_all(
        formats
            .iter()
            .map(|format| resolve_format(&app, &source, format)),
    )
    .await;
    let mut options: Vec<DownloadOption> = Vec::new();
    let mut last_error = "No downloadable qualities are available for this account".to_string();
    for result in results {
        match result {
            Ok(stream) => {
                // Preserve distinct requested tiers even when provider resolution metadata is missing.
                let tier = match stream.option.id.as_str() {
                    "HI_RES_LOSSLESS" => "Hi-Res lossless",
                    "LOSSLESS" => "Lossless",
                    "HIGH" => "High",
                    "LOW" => "Low",
                    "27" => "24-bit up to 192 kHz",
                    "7" => "24-bit up to 96 kHz",
                    "6" => "CD quality",
                    _ => "Compressed",
                };
                let mut option = stream.option;
                option.label = format!("{tier} · {}", option.label);
                options.push(option);
            }
            Err(error) => last_error = error,
        }
    }
    if options.is_empty() {
        Err(last_error)
    } else {
        Ok(options)
    }
}

fn folder_path(folder: &str) -> Result<PathBuf, String> {
    let path = Path::new(folder);
    if !path.is_absolute() {
        return Err("Choose an absolute download folder".into());
    }
    let path =
        dunce::canonicalize(path).map_err(|e| format!("Download folder is unavailable: {e}"))?;
    if !path.is_dir() {
        return Err("Download destination must be a folder".into());
    }
    Ok(path)
}

fn filename(source: &PlaybackSource, extension: &str) -> Result<String, String> {
    if !matches!(extension, "flac" | "mp3" | "m4a" | "webm" | "ogg" | "opus") {
        return Err("Unsupported download extension".into());
    }
    let metadata = source.metadata.as_ref();
    let artist = metadata
        .and_then(|m| m.artist.as_deref())
        .unwrap_or("Unknown Artist");
    let title = metadata
        .and_then(|m| m.title.as_deref())
        .unwrap_or("Unknown Title");
    let stem: String = format!("{artist} - {title}")
        .chars()
        .filter(|c| !c.is_control() && !"\\/:*?\"<>|".contains(*c))
        .take(140)
        .collect();
    Ok(format!(
        "{}.{}",
        stem.trim().trim_end_matches('.'),
        extension
    ))
}

fn destination(folder: &Path, name: &str, collision: Collision) -> Result<PathBuf, String> {
    let path = folder.join(name);
    if path.exists() {
        match collision {
            Collision::Ask => return Err("FILE_EXISTS".into()),
            Collision::Replace if !path.is_file() => {
                return Err("Destination is not a regular file".into())
            }
            Collision::KeepBoth => {
                let stem = path.file_stem().unwrap().to_string_lossy();
                let ext = path.extension().unwrap().to_string_lossy();
                for suffix in 1..10000 {
                    let other = folder.join(format!("{stem} ({suffix}).{ext}"));
                    if !other.exists() {
                        return Ok(other);
                    }
                }
                return Err("Too many copies with this filename".into());
            }
            _ => (),
        }
    }
    Ok(path)
}

#[derive(Serialize)]
pub struct DownloadFolder {
    folder: String,
    configured: bool,
}

#[tauri::command]
pub fn get_download_folder(app: AppHandle) -> Result<DownloadFolder, String> {
    let settings = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("download_folder.txt");
    let saved = std::fs::read_to_string(settings)
        .ok()
        .and_then(|folder| folder_path(folder.trim()).ok());
    let configured = saved.is_some();
    let folder = saved
        .or_else(dirs::download_dir)
        .ok_or("Cannot locate Downloads; choose a folder")?;
    Ok(DownloadFolder {
        folder: folder.to_string_lossy().into(),
        configured,
    })
}

#[tauri::command]
pub fn set_download_folder(app: AppHandle, folder: String) -> Result<String, String> {
    let folder = folder_path(&folder)?.to_string_lossy().into_owned();
    let settings = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&settings).map_err(|e| e.to_string())?;
    std::fs::write(settings.join("download_folder.txt"), &folder).map_err(|e| e.to_string())?;
    Ok(folder)
}

fn update_job(app: &AppHandle, id: &str, update: impl FnOnce(&mut DownloadJob)) {
    let job = {
        let state = app.state::<DownloadState>();
        let mut entries = safe_lock(&state.0);
        let Some(entry) = entries.get_mut(id) else {
            return;
        };
        update(&mut entry.job);
        entry.job.revision += 1;
        entry.job.clone()
    };
    if let Err(error) = persist(app, &job) {
        eprintln!("[download] Cannot persist progress: {error}");
    }
    let _ = app.emit("track-download-progress", job);
}

fn cancellable(status: &str) -> bool {
    matches!(status, "preparing" | "downloading" | "cancelling")
}

#[tauri::command]
pub fn get_track_download_jobs(app: AppHandle) -> Result<Vec<DownloadJob>, String> {
    let state = app.state::<DownloadState>();
    let mut entries = safe_lock(&state.0);
    let records = {
        let db = app.state::<AppState>();
        let conn = safe_lock(&db.db);
        job_table(&conn)?;
        let records = conn
            .prepare("SELECT record FROM download_jobs WHERE version=1")
            .map_err(|e| e.to_string())?
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        records
    };
    for record in records {
        let mut job: DownloadJob = serde_json::from_str(&record).map_err(|e| e.to_string())?;
        if let Some(existing) = entries.get(&job.id) {
            if cancellable(&existing.job.status)
                || existing.job.status == "finalizing"
                || (existing.job.revision >= job.revision
                    && existing.job.status != "completed"
                    && !existing.job.saved)
            {
                continue;
            }
        }
        recover_job(&mut job)?;
        if job.status == "completed" || job.saved {
            let _activity = crate::library_health::begin_library_activity()?;
            match inspect_download(Path::new(&job.path), &job.option)
                .and_then(|track| import_file(&app, &job, track))
            {
                Ok(()) => {
                    job.status = "completed".into();
                    job.saved = true;
                    job.percent = Some(100.0);
                    job.error = None;
                }
                Err(error) => {
                    job.status = "recoverable".into();
                    job.error = Some(error);
                }
            }
            job.revision += 1;
        }
        persist(&app, &job)?;
        let (cancel, _) = watch::channel(false);
        entries.insert(job.id.clone(), Entry { job, cancel });
    }
    Ok(entries.values().map(|entry| entry.job.clone()).collect())
}

#[tauri::command]
pub fn discard_track_download(app: AppHandle, job_id: String) -> Result<(), String> {
    let _activity = crate::library_health::begin_library_activity()?;
    let state = app.state::<DownloadState>();
    let mut entries = safe_lock(&state.0);
    let job = &entries.get(&job_id).ok_or("Download no longer exists")?.job;
    discard_record(&safe_lock(&app.state::<AppState>().db), job)?;
    entries.remove(&job_id);
    Ok(())
}

fn discard_record(conn: &rusqlite::Connection, job: &DownloadJob) -> Result<(), String> {
    if cancellable(&job.status) || job.status == "finalizing" {
        return Err("Cancel the running download first".into());
    }
    let partial = partial_path(job);
    validate_partial(&partial)?;
    if partial.exists() {
        std::fs::remove_file(partial)
            .map_err(|e| format!("Cannot discard partial download: {e}"))?;
    }
    conn.execute("DELETE FROM download_jobs WHERE id=?1", [&job.id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn cancel_track_download(app: AppHandle, job_id: String) -> Result<(), String> {
    {
        let state = app.state::<DownloadState>();
        let mut entries = safe_lock(&state.0);
        let entry = entries
            .get_mut(&job_id)
            .ok_or("Download no longer exists")?;
        if !cancellable(&entry.job.status) {
            return Err("Download is already finalizing or finished".into());
        }
        entry.cancel.send_replace(true);
        entry.job.status = "cancelling".into();
    }
    update_job(&app, &job_id, |_| {});
    Ok(())
}

fn begin_finalization(app: &AppHandle, id: &str) -> Result<(), String> {
    let state = app.state::<DownloadState>();
    let mut entries = safe_lock(&state.0);
    let entry = entries.get_mut(id).ok_or("Download no longer exists")?;
    if *entry.cancel.borrow() {
        return Err("Download cancelled".into());
    }
    entry.job.status = "finalizing".into();
    Ok(())
}

#[cfg(windows)]
pub(crate) fn commit_file(partial: &Path, target: &Path, replace: bool) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        },
    };
    let from: Vec<_> = partial.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<_> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let flags = if replace {
        MOVEFILE_WRITE_THROUGH | MOVEFILE_REPLACE_EXISTING
    } else {
        MOVEFILE_WRITE_THROUGH
    };
    unsafe { MoveFileExW(PCWSTR(from.as_ptr()), PCWSTR(to.as_ptr()), flags) }
        .map_err(|e| format!("Cannot finalize file: {e}"))
}

#[cfg(not(windows))]
pub(crate) fn commit_file(partial: &Path, target: &Path, replace: bool) -> Result<(), String> {
    if replace {
        std::fs::rename(partial, target)
    } else {
        std::fs::hard_link(partial, target)
    }
    .map_err(|e| format!("Cannot finalize file: {e}"))
}

async fn transfer(app: &AppHandle, job: &DownloadJob, partial: &Path) -> Result<(), String> {
    let stream = resolve_format(app, &job.source, &job.option.id).await?;
    if stream.option.extension != job.option.extension
        || stream.option.quality != job.option.quality
    {
        return Err("The selected quality changed; choose an available quality again".into());
    }
    let Some((response, append)) = request_transfer(stream, job, partial).await? else {
        return Ok(());
    };
    let etag = response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|v| v.to_str().ok())
        .filter(|v| strong_etag(v))
        .map(str::to_string);
    update_job(app, &job.id, |j| {
        j.etag = etag;
    });
    write_response_at(
        response,
        partial,
        append,
        if append > 0 { job.total } else { None },
        |downloaded, total| {
            update_job(app, &job.id, |j| {
                if j.status != "cancelling" {
                    j.status = "downloading".into();
                }
                j.total = total;
                j.downloaded = downloaded;
                j.percent = total.map(|t| (downloaded as f64 * 100.0 / t as f64).min(99.9));
            });
        },
    )
    .await
}

async fn request_transfer(
    stream: DownloadStream,
    job: &DownloadJob,
    partial: &Path,
) -> Result<Option<(reqwest::Response, u64)>, String> {
    let url = reqwest::Url::parse(&stream.url).map_err(|_| "Invalid provider download URL")?;
    if !matches!(url.scheme(), "https" | "http") {
        return Err("Unsupported download URL".into());
    }
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Cannot initialize download client: {e}"))?;
    let offset = std::fs::metadata(partial).map(|m| m.len()).unwrap_or(0);
    let mut request = client
        .get(url.clone())
        .headers(stream.headers.clone())
        .header(reqwest::header::ACCEPT_ENCODING, "identity");
    let can_resume = offset > 0
        && job.total.is_some_and(|total| offset <= total)
        && job.etag.as_deref().is_some_and(strong_etag);
    if can_resume {
        request = request
            .header(reqwest::header::RANGE, format!("bytes={offset}-"))
            .header(reqwest::header::IF_RANGE, job.etag.as_deref().unwrap());
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| "Could not connect to the selected download source")?;
    let mut append = 0;
    if can_resume
        && response.status() == reqwest::StatusCode::RANGE_NOT_SATISFIABLE
        && job.total == Some(offset)
        && response
            .headers()
            .get(reqwest::header::ETAG)
            .and_then(|v| v.to_str().ok())
            == job.etag.as_deref()
        && response
            .headers()
            .get(reqwest::header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            == Some(format!("bytes */{offset}").as_str())
        && inspect_download(partial, &job.option).is_ok()
    {
        return Ok(None);
    }
    if can_resume
        && valid_resume(
            &response,
            offset,
            job.total.unwrap(),
            job.etag.as_deref().unwrap(),
        )
    {
        append = offset;
    } else if response.status() == reqwest::StatusCode::PARTIAL_CONTENT
        || (can_resume && response.status() != reqwest::StatusCode::OK)
    {
        if response.status() == reqwest::StatusCode::UNAUTHORIZED
            || response.status() == reqwest::StatusCode::FORBIDDEN
        {
            return Err("Provider rejected the download. Reconnect in Settings and retry.".into());
        }
        response = client
            .get(url)
            .headers(stream.headers)
            .header(reqwest::header::ACCEPT_ENCODING, "identity")
            .send()
            .await
            .map_err(|_| "Could not restart download")?;
    }
    if append == 0 && response.status() != reqwest::StatusCode::OK {
        return Err("Download request rejected; reconnect the provider or retry.".into());
    }
    let response = response
        .error_for_status()
        .map_err(|_| "Download request rejected")?;
    Ok(Some((response, append)))
}

fn strong_etag(value: &str) -> bool {
    value.starts_with('"') && value.ends_with('"') && value.len() >= 2
}

fn valid_resume(response: &reqwest::Response, offset: u64, total: u64, etag: &str) -> bool {
    if response.status() != reqwest::StatusCode::PARTIAL_CONTENT
        || response
            .headers()
            .get(reqwest::header::ETAG)
            .and_then(|v| v.to_str().ok())
            != Some(etag)
    {
        return false;
    }
    let Some(range) = response
        .headers()
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("bytes "))
    else {
        return false;
    };
    let Some((bounds, length)) = range.split_once('/') else {
        return false;
    };
    let Some((start, end)) = bounds.split_once('-') else {
        return false;
    };
    start.parse::<u64>().ok() == Some(offset)
        && length.parse::<u64>().ok() == Some(total)
        && end.parse::<u64>().ok() == total.checked_sub(1)
        && response.content_length() == total.checked_sub(offset)
        && response
            .headers()
            .get(reqwest::header::CONTENT_ENCODING)
            .is_none()
}

#[cfg(test)]
async fn write_response(
    response: reqwest::Response,
    partial: &Path,
    progress: impl FnMut(u64, Option<u64>),
) -> Result<(), String> {
    write_response_at(response, partial, 0, None, progress).await
}

async fn write_response_at(
    response: reqwest::Response,
    partial: &Path,
    offset: u64,
    known_total: Option<u64>,
    mut progress: impl FnMut(u64, Option<u64>),
) -> Result<(), String> {
    let total = known_total.or_else(|| response.content_length().filter(|size| *size > 0));
    progress(offset, total);
    let mut file = tokio::fs::OpenOptions::new()
        .write(true)
        .append(offset > 0)
        .truncate(offset == 0)
        .open(partial)
        .await
        .map_err(|e| format!("Cannot open partial download: {e}"))?;
    let mut chunks = response.bytes_stream();
    let mut downloaded = offset;
    let mut last_update = std::time::Instant::now();
    while let Some(chunk) = chunks.next().await {
        let chunk = chunk.map_err(|_| "The download connection was interrupted")?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Cannot write download: {e}"))?;
        downloaded += chunk.len() as u64;
        if last_update.elapsed() >= Duration::from_millis(150) {
            progress(downloaded, total);
            last_update = std::time::Instant::now();
        }
    }
    if downloaded == 0 || total.is_some_and(|total| total != downloaded) {
        return Err("Download ended before the complete file arrived".into());
    }
    file.flush().await.map_err(|e| e.to_string())?;
    file.sync_all().await.map_err(|e| e.to_string())?;
    progress(downloaded, total);
    Ok(())
}

fn verify_download_profile(
    parameters: &symphonia::core::codecs::CodecParameters,
    option: &DownloadOption,
) -> Result<(), String> {
    use symphonia::core::codecs::*;
    let expected = match option.extension.as_str() {
        "flac" => parameters.codec == CODEC_TYPE_FLAC,
        "mp3" => parameters.codec == CODEC_TYPE_MP3,
        "m4a" => parameters.codec == CODEC_TYPE_AAC,
        "webm" | "ogg" => match option.quality.codec.as_deref() {
            Some("opus") => parameters.codec == CODEC_TYPE_OPUS,
            Some("vorbis") => parameters.codec == CODEC_TYPE_VORBIS,
            _ => false,
        },
        "opus" => parameters.codec == CODEC_TYPE_OPUS,
        _ => false,
    };
    if !expected {
        return Err("The downloaded audio does not match the selected format".into());
    }
    if option.quality.lossless == Some(true)
        && (option
            .quality
            .bit_depth
            .is_some_and(|bits| parameters.bits_per_sample != Some(bits))
            || option
                .quality
                .sample_rate
                .is_some_and(|rate| parameters.sample_rate.map(f64::from) != Some(rate)))
    {
        return Err("The downloaded audio does not match the selected lossless resolution".into());
    }
    Ok(())
}

fn inspect_download(path: &Path, option: &DownloadOption) -> Result<crate::db::Track, String> {
    use symphonia::core::{io::MediaSourceStream, probe::Hint};
    let file =
        std::fs::File::open(path).map_err(|e| format!("Cannot inspect downloaded audio: {e}"))?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let probed = symphonia::default::get_probe()
        .format(
            &Hint::new(),
            stream,
            &Default::default(),
            &Default::default(),
        )
        .map_err(|_| "The downloaded file is not recognized as playable audio")?;
    let audio = probed
        .format
        .default_track()
        .ok_or("The downloaded file has no audio track")?;
    verify_download_profile(&audio.codec_params, option)?;
    let mut track = crate::scanner::extract_metadata(path)
        .ok_or("The downloaded file is not recognized as playable audio")?;
    track.format = Some(option.extension.to_uppercase());
    Ok(track)
}

fn import_file(app: &AppHandle, job: &DownloadJob, track: crate::db::Track) -> Result<(), String> {
    import_record(&mut safe_lock(&app.state::<AppState>().db), job, track)?;
    let _ = app.emit("library-updated", ());
    Ok(())
}

fn import_record(
    conn: &mut rusqlite::Connection,
    job: &DownloadJob,
    mut track: crate::db::Track,
) -> Result<(), String> {
    track.path = job.path.clone();
    if let Some(metadata) = &job.source.metadata {
        track.title = metadata.title.clone().or(track.title);
        track.artist = metadata.artist.clone().or(track.artist);
        track.album = metadata.album.clone().or(track.album);
        track.cover_url = metadata.cover_url.clone().or(track.cover_url);
    }
    conn.execute_batch("CREATE TABLE IF NOT EXISTS track_downloads (path TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS download_imports (job_id TEXT PRIMARY KEY)")
        .map_err(|e| e.to_string())?;
    let imported: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM download_imports WHERE job_id=?1)",
            [&job.id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if imported {
        return Ok(());
    }
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    crate::db::save_tracks_in_transaction(&tx, &mut [track]).map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT OR IGNORE INTO track_downloads (path) VALUES (?1)",
        [&job.path],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT OR IGNORE INTO download_imports(job_id) VALUES (?1)",
        [&job.id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

async fn run_job(
    app: AppHandle,
    job: DownloadJob,
    mut cancel: watch::Receiver<bool>,
    _activity: crate::library_health::LibraryActivityGuard,
) {
    let partial_path = partial_path(&job);
    let mut result: Result<(), String> = async {
        if !job.saved {
            validate_partial(&partial_path)?;
            if !partial_path.exists() {
                std::fs::OpenOptions::new().write(true).create_new(true).open(&partial_path).map_err(|e| format!("Cannot create partial download: {e}"))?;
            }
            tokio::select! {
                biased;
                _ = cancel.wait_for(|cancelled| *cancelled) => return Err("Download cancelled".into()),
                result = transfer(&app, &job, &partial_path) => result?,
            }
        }
        begin_finalization(&app, &job.id)?;
        update_job(&app, &job.id, |_| {});
        let app = app.clone();
        let job = job.clone();
        let partial_path = partial_path.clone();
        tokio::task::spawn_blocking(move || {
            let path = if job.saved { Path::new(&job.path) } else { &partial_path };
            let track = inspect_download(path, &job.option)?;
            if !job.saved {
                let fingerprint = file_fingerprint(&partial_path)?;
                update_job(&app, &job.id, |j| j.fingerprint = Some(fingerprint));
                let snapshot = safe_lock(&app.state::<DownloadState>().0).get(&job.id).ok_or("Download no longer exists")?.job.clone();
                persist(&app, &snapshot)?;
                commit_file(&partial_path, Path::new(&job.path), job.collision == Collision::Replace)?;
                update_job(&app, &job.id, |j| j.saved = true);
            }
            import_file(&app, &job, track).map_err(|e| format!("File saved to {}, but library import failed: {e}. Retry to import it.", job.path))
        }).await.map_err(|e| format!("Download finalization failed: {e}"))?
    }.await;
    // The transfer future and its file handle have dropped before partial-file cleanup.
    if matches!(
        result.as_ref().err().map(String::as_str),
        Some("Download cancelled")
    ) {
        if let Err(error) = std::fs::remove_file(&partial_path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                result = Err(format!(
                    "Cancelled, but partial cleanup failed: {error}. Discard to retry cleanup."
                ));
            }
        }
    }
    update_job(&app, &job.id, |j| match result {
        Ok(()) => {
            j.status = "completed".into();
            j.percent = Some(100.0);
            j.saved = true;
        }
        Err(error) => {
            j.status = if error == "Download cancelled" {
                "cancelled"
            } else {
                "failed"
            }
            .into();
            j.error = if j.status == "cancelled" {
                None
            } else {
                Some(error)
            };
        }
    });
}

fn start_job(
    app: &AppHandle,
    source: PlaybackSource,
    option: DownloadOption,
    folder: &str,
    collision: Collision,
) -> Result<DownloadJob, String> {
    let activity = crate::library_health::begin_library_activity()?;
    validate_source(&source)?;
    if option.id.is_empty() || option.id.len() > 64 || option.label.len() > 512 {
        return Err("Invalid download quality".into());
    }
    let path = destination(
        &folder_path(folder)?,
        &filename(&source, &option.extension)?,
        collision,
    )?;
    let state = app.state::<DownloadState>();
    let mut entries = safe_lock(&state.0);
    if entries.values().any(|e| {
        e.job.path == path.to_string_lossy()
            && (cancellable(&e.job.status) || e.job.status == "finalizing")
    }) {
        return Err("A download to this file is already active".into());
    }
    let id = next_job_id();
    let job = DownloadJob {
        id: id.clone(),
        revision: 0,
        source,
        option,
        path: path.to_string_lossy().into(),
        status: "preparing".into(),
        downloaded: 0,
        total: None,
        percent: None,
        error: None,
        saved: false,
        collision,
        etag: None,
        fingerprint: None,
    };
    persist(app, &job)?;
    let (cancel, receiver) = watch::channel(false);
    entries.insert(
        id,
        Entry {
            job: job.clone(),
            cancel,
        },
    );
    drop(entries);
    let _ = app.emit("track-download-progress", &job);
    tauri::async_runtime::spawn(run_job(app.clone(), job.clone(), receiver, activity));
    Ok(job)
}

fn next_job_id() -> String {
    static NEXT_ID: AtomicU64 = AtomicU64::new(0);
    format!(
        "{}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    )
}

#[tauri::command]
pub fn start_track_download(
    app: AppHandle,
    source: PlaybackSource,
    option: DownloadOption,
    folder: String,
    collision: Collision,
) -> Result<DownloadJob, String> {
    start_job(&app, source, option, &folder, collision)
}

#[tauri::command]
pub fn retry_track_download(app: AppHandle, job_id: String) -> Result<DownloadJob, String> {
    let state = app.state::<DownloadState>();
    let job = safe_lock(&state.0)
        .get(&job_id)
        .ok_or("Download no longer exists")?
        .job
        .clone();
    let activity = crate::library_health::begin_library_activity()?;
    if !matches!(job.status.as_str(), "failed" | "cancelled" | "recoverable") {
        return Err("Only interrupted or failed downloads can be retried".into());
    }
    validate_source(&job.source)?;
    if job.saved
        && job.fingerprint.is_some()
        && file_fingerprint(Path::new(&job.path)).ok() != job.fingerprint
    {
        return Err("Saved output changed; choose a new download instead.".into());
    }
    folder_path(
        Path::new(&job.path)
            .parent()
            .and_then(Path::to_str)
            .ok_or("Invalid destination")?,
    )?;
    if !job.saved && Path::new(&job.path).exists() && job.collision != Collision::Replace {
        return Err("FILE_EXISTS".into());
    }
    let mut entries = safe_lock(&state.0);
    if entries
        .get(&job_id)
        .map(|entry| entry.job.revision != job.revision)
        .unwrap_or(true)
    {
        return Err("Download changed while retrying. Refresh the download list.".into());
    }

    if entries.values().any(|entry| {
        entry.job.path == job.path
            && (cancellable(&entry.job.status) || entry.job.status == "finalizing")
    }) {
        return Err("A download for this file is already active".into());
    }
    let mut retry = job;
    retry.revision += 1;
    retry.status = "preparing".into();
    retry.error = None;
    persist(&app, &retry)?;
    let (cancel, receiver) = watch::channel(false);
    entries.insert(
        retry.id.clone(),
        Entry {
            job: retry.clone(),
            cancel,
        },
    );
    drop(entries);
    tauri::async_runtime::spawn(run_job(app, retry.clone(), receiver, activity));
    Ok(retry)
}

#[tauri::command]
pub fn get_downloaded_file_paths(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let conn = safe_lock(&state.db);
    conn.execute_batch("CREATE TABLE IF NOT EXISTS track_downloads (path TEXT PRIMARY KEY)")
        .map_err(|e| e.to_string())?;
    let mut statement = conn
        .prepare("SELECT path FROM track_downloads")
        .map_err(|e| e.to_string())?;
    let paths = statement
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<String>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(paths)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    struct TestDir(PathBuf);
    impl TestDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("aideo-download-test-{}", next_job_id()));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TestDir {
        fn drop(&mut self) {
            for file in std::fs::read_dir(&self.0).unwrap() {
                let _ = std::fs::remove_file(file.unwrap().path());
            }
            let _ = std::fs::remove_dir(&self.0);
        }
    }

    fn fixture_job(path: &Path) -> DownloadJob {
        DownloadJob {
            id: "fixture-1".into(), revision: 2,
            source: serde_json::from_value(serde_json::json!({"provider":"qobuz", "id":"123", "metadata":{"title":"Song", "artist":"Artist", "album":"Album", "duration":180, "duration_raw":"secret", "cover_url":"https://example.com/?token=secret", "track_number":1, "disc_number":1}})).unwrap(),
            option: DownloadOption { id: "6".into(), label: "FLAC".into(), extension: "flac".into(), quality: SourceQuality { codec: Some("flac".into()), lossless: Some(true), bit_depth: Some(16), sample_rate: Some(44100.0) } },
            path: path.to_string_lossy().into(), status: "downloading".into(), downloaded: 4, total: Some(8), percent: Some(50.0), error: Some("https://signed.example/?credential=secret".into()), saved: false, collision: Collision::Replace, etag: Some("\"rendition\"".into()), fingerprint: None,
        }
    }

    #[test]
    fn durable_records_omit_urls_and_reject_stale_revision() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        let dir = TestDir::new();
        let mut job = fixture_job(&dir.0.join("song.flac"));
        persist_job(&conn, &job).unwrap();
        job.revision = 1;
        job.status = "preparing".into();
        persist_job(&conn, &job).unwrap();
        let record: String = conn
            .query_row("SELECT record FROM download_jobs", [], |row| row.get(0))
            .unwrap();
        assert!(!record.contains("secret"));
        assert!(!record.contains("https://"));
        let saved: DownloadJob = serde_json::from_str(&record).unwrap();
        assert_eq!(saved.revision, 2);
        assert_eq!(saved.status, "downloading");
        assert_eq!(saved.source.id, "123");
    }

    #[test]
    fn crash_recovery_distinguishes_committed_output_from_original() {
        let dir = TestDir::new();
        let target = dir.0.join("song.flac");
        std::fs::write(&target, b"original").unwrap();
        let mut job = fixture_job(&target);
        let partial = partial_path(&job);
        std::fs::write(&partial, b"new-file").unwrap();
        job.fingerprint = Some(file_fingerprint(&partial).unwrap());
        job.status = "finalizing".into();
        let mut before_commit = job.clone();
        recover_job(&mut before_commit).unwrap();
        assert!(!before_commit.saved);
        assert_eq!(before_commit.status, "recoverable");
        commit_file(&partial, &target, true).unwrap();
        recover_job(&mut job).unwrap();
        assert!(job.saved);
        assert_eq!(job.status, "recoverable");
        assert_eq!(std::fs::read(&target).unwrap(), b"new-file");
        recover_job(&mut job).unwrap();
        assert!(job.saved);
    }

    #[test]
    fn completed_recovery_rejects_changed_compatible_audio() {
        let dir = TestDir::new();
        let target = dir.0.join("song.flac");
        let mut header = b"fLaC\x80\x00\x00\x22\x00\x10\x00\x10\x00\x00\x00\x00\x00\x00".to_vec();
        header.extend_from_slice(&((44100u64 << 44) | (1 << 41) | (15 << 36) | 16).to_be_bytes());
        header.extend_from_slice(&[0; 16]);
        header.extend_from_slice(&[255, 248, 105, 24, 0, 15, 146, 0, 0, 0, 0, 0, 0, 172, 6]);
        std::fs::write(&target, &header).unwrap();
        let mut job = fixture_job(&target);
        job.saved = true;
        job.status = "completed".into();
        job.fingerprint = Some(file_fingerprint(&target).unwrap());
        assert!(inspect_download(&target, &job.option).is_ok());
        // STREAMINFO MD5 is metadata; changing it preserves the selected audio profile.
        header[30] = 1;
        std::fs::write(&target, &header).unwrap();
        assert!(inspect_download(&target, &job.option).is_ok());
        recover_job(&mut job).unwrap();
        assert_eq!(job.status, "recoverable");
        assert!(!job.saved);
        assert!(job.error.as_deref().unwrap().contains("changed"));
        assert!(
            !(job.status == "completed" || job.saved),
            "snapshot import gate must remain closed"
        );
    }

    #[test]
    fn restart_keeps_partial_except_explicit_cancellation() {
        let dir = TestDir::new();
        let mut job = fixture_job(&dir.0.join("song.flac"));
        let partial = partial_path(&job);
        std::fs::write(&partial, b"part").unwrap();
        recover_job(&mut job).unwrap();
        assert!(partial.exists());
        assert_eq!(job.status, "recoverable");
        job.status = "cancelling".into();
        recover_job(&mut job).unwrap();
        assert!(!partial.exists());
        assert_eq!(job.status, "cancelled");
        job.status = "downloading".into();
        recover_job(&mut job).unwrap();
        assert_eq!(job.status, "recoverable");
    }

    #[test]
    fn import_commit_is_atomic_and_recovery_preserves_loved_and_edited_metadata() {
        let dir = TestDir::new();
        let job = fixture_job(&dir.0.join("song.flac"));
        let mut conn = crate::db::init_db(":memory:").unwrap();
        let track: crate::db::Track = serde_json::from_value(serde_json::json!({"id":0,"path":job.path,"title":"File title","artist":"Artist","album":"Album","duration":180.0,"format":"FLAC","lyric_offset":0})).unwrap();
        conn.execute_batch("CREATE TABLE download_imports(job_id TEXT PRIMARY KEY); CREATE TRIGGER fail_import BEFORE INSERT ON download_imports BEGIN SELECT RAISE(ABORT,'fixture failure'); END;").unwrap();
        assert!(import_record(&mut conn, &job, track.clone()).is_err());
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM tracks", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM track_downloads", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
        conn.execute_batch("DROP TRIGGER fail_import").unwrap();
        import_record(&mut conn, &job, track.clone()).unwrap();
        conn.execute(
            "UPDATE tracks SET loved=1,title='Edited title' WHERE path=?1",
            [&job.path],
        )
        .unwrap();
        // Simulate import-before-job-status crash: recovery invokes the same job again.
        import_record(&mut conn, &job, track).unwrap();
        let saved = crate::db::get_all_tracks(&conn).unwrap();
        assert_eq!(saved.len(), 1);
        assert_eq!(saved[0].title.as_deref(), Some("Edited title"));
        assert_eq!(saved[0].loved, Some(1));
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM download_imports", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn discard_only_removes_owned_partial_and_inactive_record() {
        let dir = TestDir::new();
        let target = dir.0.join("song.flac");
        std::fs::write(&target, b"original").unwrap();
        let foreign = dir.0.join("unrelated.part");
        std::fs::write(&foreign, b"foreign").unwrap();
        let mut job = fixture_job(&target);
        let partial = partial_path(&job);
        std::fs::write(&partial, b"part").unwrap();
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        persist_job(&conn, &job).unwrap();
        assert!(discard_record(&conn, &job).is_err());
        assert!(partial.exists());
        job.status = "recoverable".into();
        discard_record(&conn, &job).unwrap();
        assert!(!partial.exists());
        assert_eq!(std::fs::read(&target).unwrap(), b"original");
        assert_eq!(std::fs::read(&foreign).unwrap(), b"foreign");
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM download_jobs", [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn range_fixture_resumes_or_restarts_without_repeated_bytes() {
        for (status, range, etag, body, valid) in [
            (
                "206 Partial Content",
                "bytes 4-7/8",
                "\"rendition\"",
                "tail",
                true,
            ),
            ("200 OK", "bytes 4-7/8", "\"rendition\"", "headtail", false),
            (
                "206 Partial Content",
                "bytes 3-7/8",
                "\"rendition\"",
                "other",
                false,
            ),
            (
                "206 Partial Content",
                "bytes 4-7/9",
                "\"rendition\"",
                "tail",
                false,
            ),
            (
                "206 Partial Content",
                "bytes 4-7/8",
                "\"changed\"",
                "tail",
                false,
            ),
            (
                "206 Partial Content",
                "invalid",
                "\"rendition\"",
                "tail",
                false,
            ),
            (
                "403 Forbidden",
                "bytes 4-7/8",
                "\"rendition\"",
                "tail",
                false,
            ),
        ] {
            let dir = TestDir::new();
            let partial = dir.0.join("partial.flac");
            std::fs::write(&partial, b"head").unwrap();
            let job = fixture_job(&dir.0.join("song.flac"));
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = [0; 2048];
                let size = socket.read(&mut request).await.unwrap();
                let request = String::from_utf8_lossy(&request[..size]).to_lowercase();
                assert!(request.contains("range: bytes=4-"));
                assert!(request.contains("if-range: \"rendition\""));
                socket.write_all(format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nContent-Range: {range}\r\nETag: {etag}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
                drop(socket);
                if !valid && status.starts_with("206") {
                    let (mut socket, _) = listener.accept().await.unwrap();
                    let mut request = [0; 2048];
                    let size = socket.read(&mut request).await.unwrap();
                    let request = String::from_utf8_lossy(&request[..size]).to_lowercase();
                    assert!(!request.contains("range:"));
                    socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\nETag: \"fresh\"\r\nConnection: close\r\n\r\nheadtail").await.unwrap();
                }
            });
            let stream = DownloadStream {
                option: job.option.clone(),
                url: format!("http://{address}/fresh-url"),
                headers: Default::default(),
            };
            let result = request_transfer(stream, &job, &partial).await;
            if status.starts_with("403") {
                assert!(result.unwrap_err().contains("Reconnect"));
                assert_eq!(std::fs::read(&partial).unwrap(), b"head");
            } else {
                let (response, offset) = result.unwrap().unwrap();
                assert_eq!(offset, if valid { 4 } else { 0 });
                write_response_at(
                    response,
                    &partial,
                    offset,
                    if offset > 0 { Some(8) } else { None },
                    |_, _| {},
                )
                .await
                .unwrap();
                assert_eq!(std::fs::read(&partial).unwrap(), b"headtail");
            }
            server.await.unwrap();
        }
        assert!(!strong_etag("W/\"weak\""));
    }

    #[tokio::test]
    async fn complete_partial_416_is_validated_and_disk_failure_is_reported() {
        let dir = TestDir::new();
        let partial = dir.0.join("audio.flac.part");
        let mut header = b"fLaC\x80\x00\x00\x22\x00\x10\x00\x10\x00\x00\x00\x00\x00\x00".to_vec();
        header.extend_from_slice(&((44100u64 << 44) | (1 << 41) | (15 << 36) | 16).to_be_bytes());
        header.extend_from_slice(&[0; 16]);
        header.extend_from_slice(&[255, 248, 105, 24, 0, 15, 146, 0, 0, 0, 0, 0, 0, 172, 6]);
        std::fs::write(&partial, &header).unwrap();
        let mut job = fixture_job(&dir.0.join("song.flac"));
        job.total = Some(header.len() as u64);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let total = header.len();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 2048];
            socket.read(&mut request).await.unwrap();
            socket.write_all(format!("HTTP/1.1 416 Range Not Satisfiable\r\nContent-Length: 0\r\nContent-Range: bytes */{total}\r\nETag: \"rendition\"\r\nConnection: close\r\n\r\n").as_bytes()).await.unwrap();
        });
        let stream = DownloadStream {
            option: job.option.clone(),
            url: format!("http://{address}/renewed"),
            headers: Default::default(),
        };
        assert!(request_transfer(stream, &job, &partial)
            .await
            .unwrap()
            .is_none());
        assert_eq!(std::fs::read(&partial).unwrap(), header);
        server.await.unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 2048];
            socket.read(&mut request).await.unwrap();
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\ntail")
                .await
                .unwrap();
        });
        let response = reqwest::get(format!("http://{address}/audio"))
            .await
            .unwrap();
        assert!(write_response_at(response, &dir.0, 0, None, |_, _| {})
            .await
            .unwrap_err()
            .contains("Cannot open partial"));
        server.await.unwrap();
    }

    #[test]
    fn rejects_mislabeled_codec_and_lossless_resolution() {
        use symphonia::core::codecs::{CodecParameters, CODEC_TYPE_AAC, CODEC_TYPE_FLAC};
        let option = DownloadOption {
            id: "27".into(),
            label: "24-bit FLAC".into(),
            extension: "flac".into(),
            quality: SourceQuality {
                codec: Some("flac".into()),
                lossless: Some(true),
                bit_depth: Some(24),
                sample_rate: Some(96000.0),
            },
        };
        let mut parameters = CodecParameters::new();
        parameters.codec = CODEC_TYPE_AAC;
        parameters.bits_per_sample = Some(24);
        parameters.sample_rate = Some(96000);
        assert!(verify_download_profile(&parameters, &option).is_err());
        parameters.codec = CODEC_TYPE_FLAC;
        parameters.bits_per_sample = Some(16);
        assert!(verify_download_profile(&parameters, &option).is_err());
        parameters.bits_per_sample = Some(24);
        assert!(verify_download_profile(&parameters, &option).is_ok());
    }

    #[test]
    fn inspects_flac_header_with_partial_extension() {
        let dir = TestDir::new();
        let path = dir.0.join("audio.flac.part");
        // FLAC STREAMINFO and one stereo constant-silence frame (16 samples, 16-bit, 44.1 kHz).
        let mut header = b"fLaC\x80\x00\x00\x22\x00\x10\x00\x10\x00\x00\x00\x00\x00\x00".to_vec();
        header.extend_from_slice(&((44100u64 << 44) | (1 << 41) | (15 << 36) | 16).to_be_bytes());
        header.extend_from_slice(&[0; 16]);
        header.extend_from_slice(&[255, 248, 105, 24, 0, 15, 146, 0, 0, 0, 0, 0, 0, 172, 6]);
        std::fs::write(&path, header).unwrap();
        let option = DownloadOption {
            id: "6".into(),
            label: "CD quality".into(),
            extension: "flac".into(),
            quality: SourceQuality {
                lossless: Some(true),
                bit_depth: Some(16),
                sample_rate: Some(44100.0),
                codec: Some("flac".into()),
            },
        };
        let track = inspect_download(&path, &option).unwrap();
        assert_eq!(track.format.as_deref(), Some("FLAC"));
        assert_eq!(track.duration, Some(16.0 / 44100.0));
        std::fs::write(&path, b"<html>provider failure</html>").unwrap();
        assert!(inspect_download(&path, &option).is_err());
    }

    #[test]
    fn collision_choices_preserve_original_until_atomic_commit() {
        let dir = TestDir::new();
        let target = dir.0.join("song.flac");
        std::fs::write(&target, b"original").unwrap();
        assert_eq!(
            destination(&dir.0, "song.flac", Collision::Ask).unwrap_err(),
            "FILE_EXISTS"
        );
        let copy = destination(&dir.0, "song.flac", Collision::KeepBoth).unwrap();
        assert_eq!(copy.file_name().unwrap(), "song (1).flac");
        assert_eq!(
            destination(&dir.0, "song.flac", Collision::Replace).unwrap(),
            target
        );
        let partial = PartialFile::create(dir.0.join("part.flac")).unwrap();
        std::fs::write(&partial.0, b"new audio").unwrap();
        assert!(commit_file(&partial.0, &target, false).is_err());
        assert_eq!(std::fs::read(&target).unwrap(), b"original");
        commit_file(&partial.0, &target, true).unwrap();
        assert_eq!(std::fs::read(&target).unwrap(), b"new audio");
        drop(partial);
    }

    #[test]
    fn partial_file_guard_only_removes_files_it_created() {
        let dir = TestDir::new();
        let foreign = dir.0.join("foreign.flac");
        std::fs::write(&foreign, b"existing").unwrap();
        assert!(PartialFile::create(foreign.clone()).is_err());
        assert_eq!(std::fs::read(foreign).unwrap(), b"existing");
        let owned_path = dir.0.join("owned.flac");
        drop(PartialFile::create(owned_path.clone()).unwrap());
        assert!(!owned_path.exists());
    }

    #[test]
    fn webstream_options_exclude_video_and_segmented_transcodes() {
        let json = serde_json::json!({"formats": [
            {"format_id":"251","vcodec":"none","acodec":"opus","protocol":"https","ext":"webm","url":"https://example.com/audio","asr":48000,"abr":128},
            {"format_id":"18","vcodec":"h264","acodec":"aac","protocol":"https","ext":"mp4","url":"https://example.com/video"},
            {"format_id":"hls","vcodec":"none","acodec":"aac","protocol":"m3u8_native","ext":"m4a","url":"https://example.com/playlist"}
        ]});
        let options = youtube_streams(&json);
        assert_eq!(options.len(), 1);
        assert_eq!(options[0].option.id, "251");
        assert_eq!(options[0].option.extension, "webm");
        assert_eq!(options[0].option.quality.lossless, Some(false));
    }

    #[tokio::test]
    async fn cancelling_a_running_transfer_removes_partial_and_keeps_original() {
        let dir = TestDir::new();
        let target = dir.0.join("song.flac");
        std::fs::write(&target, b"original").unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0; 1024];
            socket.read(&mut request).await.unwrap();
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 8\r\n\r\npart")
                .await
                .unwrap();
            std::future::pending::<()>().await;
        });
        let response = reqwest::get(format!("http://{address}/audio"))
            .await
            .unwrap();
        let partial_path = dir.0.join("partial.flac");
        let partial = PartialFile::create(partial_path.clone()).unwrap();
        let (cancel, mut receiver) = watch::channel(false);
        let worker_path = partial_path.clone();
        let worker = tokio::spawn(async move {
            let result = tokio::select! {
                biased;
                _ = receiver.wait_for(|cancelled| *cancelled) => Err("cancelled".to_string()),
                result = write_response(response, &worker_path, |_, _| {}) => result,
            };
            drop(partial);
            result
        });
        tokio::time::timeout(Duration::from_secs(3), async {
            while std::fs::metadata(&partial_path).unwrap().len() != 4 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        cancel.send_replace(true);
        assert_eq!(worker.await.unwrap().unwrap_err(), "cancelled");
        assert!(!partial_path.exists());
        assert_eq!(std::fs::read(target).unwrap(), b"original");
        server.abort();
    }

    #[tokio::test]
    async fn transfer_with_unknown_size_reports_bytes_and_rejects_truncation() {
        for (headers, body, expected) in [
            ("Connection: close", "audio", true),
            ("Content-Length: 100", "short", false),
        ] {
            let dir = TestDir::new();
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = [0; 1024];
                socket.read(&mut request).await.unwrap();
                socket
                    .write_all(format!("HTTP/1.1 200 OK\r\n{headers}\r\n\r\n{body}").as_bytes())
                    .await
                    .unwrap();
            });
            let response = reqwest::get(format!("http://{address}/audio"))
                .await
                .unwrap();
            let partial = PartialFile::create(dir.0.join("partial.flac")).unwrap();
            let mut updates = Vec::new();
            let result = write_response(response, &partial.0, |bytes, total| {
                updates.push((bytes, total))
            })
            .await;
            assert_eq!(result.is_ok(), expected);
            if expected {
                assert_eq!(updates.last(), Some(&(5, None)));
            }
            drop(partial);
            server.await.unwrap();
        }
    }
}
