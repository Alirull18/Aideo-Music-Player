use std::collections::VecDeque;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};

static GLOBAL_LOGGER: OnceLock<Arc<AppLogger>> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum LogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
    Crash,
}

impl LogLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            LogLevel::Trace => "TRACE",
            LogLevel::Debug => "DEBUG",
            LogLevel::Info => "INFO",
            LogLevel::Warn => "WARN",
            LogLevel::Error => "ERROR",
            LogLevel::Crash => "CRASH",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s.to_uppercase().as_str() {
            "TRACE" => LogLevel::Trace,
            "DEBUG" => LogLevel::Debug,
            "INFO" => LogLevel::Info,
            "WARN" | "WARNING" => LogLevel::Warn,
            "ERROR" => LogLevel::Error,
            "CRASH" | "PANIC" | "FATAL" => LogLevel::Crash,
            _ => LogLevel::Info,
        }
    }

    pub fn ansi_color(&self) -> (&'static str, &'static str) {
        match self {
            LogLevel::Trace => ("\x1b[2;37m", "\x1b[0m"),     // Dim White
            LogLevel::Debug => ("\x1b[36m", "\x1b[0m"),       // Cyan
            LogLevel::Info => ("\x1b[32m", "\x1b[0m"),        // Green
            LogLevel::Warn => ("\x1b[33m", "\x1b[0m"),        // Yellow
            LogLevel::Error => ("\x1b[1;31m", "\x1b[0m"),     // Bold Red
            LogLevel::Crash => ("\x1b[1;97;41m", "\x1b[0m"),  // Bold White on Red Background
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEntry {
    pub timestamp: String,
    pub level: String,
    pub tag: String,
    pub message: String,
    pub details: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontendCrashReport {
    pub message: String,
    pub stack: Option<String>,
    pub component_stack: Option<String>,
    pub url: Option<String>,
    pub view: Option<String>,
    pub breadcrumbs: Option<Vec<String>>,
    pub extra: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemDiagnosticInfo {
    pub app_name: String,
    pub app_version: String,
    pub os_name: String,
    pub os_version: String,
    pub arch: String,
    pub cpu_count: usize,
    pub process_id: u32,
    pub log_dir: String,
    pub log_file: String,
    pub total_logs_in_memory: usize,
    pub active_audio_backend: String,
    pub timestamp: String,
}

pub struct AppLogger {
    logs_dir: PathBuf,
    current_log_file: PathBuf,
    recent_logs: Mutex<VecDeque<LogEntry>>,
    max_recent_logs: usize,
    max_file_size_bytes: u64,
}

impl AppLogger {
    pub fn new(logs_dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&logs_dir);
        let current_log_file = logs_dir.join("aideo.log");

        Self {
            logs_dir,
            current_log_file,
            recent_logs: Mutex::new(VecDeque::with_capacity(300)),
            max_recent_logs: 300,
            max_file_size_bytes: 10 * 1024 * 1024, // 10MB
        }
    }

    pub fn format_timestamp(time: SystemTime) -> String {
        let duration = time.duration_since(UNIX_EPOCH).unwrap_or_default();
        let total_secs = duration.as_secs();
        let millis = duration.subsec_millis();

        // Calculate UTC date/time fields
        let sec = (total_secs % 60) as u32;
        let min = ((total_secs / 60) % 60) as u32;
        let hour = ((total_secs / 3600) % 24) as u32;
        
        // Days since Unix epoch
        let mut days = (total_secs / 86400) as i64;
        let mut year = 1970;
        loop {
            let leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
            let days_in_year = if leap { 366 } else { 365 };
            if days < days_in_year {
                break;
            }
            days -= days_in_year;
            year += 1;
        }

        let leap = (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
        let days_in_months = if leap {
            [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        } else {
            [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        };

        let mut month = 1;
        for &dim in &days_in_months {
            if days < dim {
                break;
            }
            days -= dim;
            month += 1;
        }
        let day = (days + 1) as u32;

        format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{:03}",
            year, month, day, hour, min, sec, millis
        )
    }

    pub fn log(&self, level: LogLevel, tag: &str, message: &str, details: Option<&str>) {
        let now = SystemTime::now();
        let timestamp = Self::format_timestamp(now);

        let entry = LogEntry {
            timestamp: timestamp.clone(),
            level: level.as_str().to_string(),
            tag: tag.to_string(),
            message: message.to_string(),
            details: details.map(|s| s.to_string()),
        };

        // 1. Add to ring buffer
        if let Ok(mut ring) = self.recent_logs.lock() {
            if ring.len() >= self.max_recent_logs {
                ring.pop_front();
            }
            ring.push_back(entry);
        }

        // 2. Terminal Output with ANSI colors
        let (color_start, color_end) = level.ansi_color();
        let tag_formatted = format!("[{: <9}]", tag);
        let level_formatted = format!("[{: <5}]", level.as_str());

        if let Some(extra) = details {
            eprintln!(
                "\x1b[2;37m[{}]\x1b[0m {}{}{} \x1b[1;34m{}\x1b[0m {}\n  \x1b[2m↳ {}\x1b[0m",
                timestamp, color_start, level_formatted, color_end, tag_formatted, message, extra
            );
        } else {
            eprintln!(
                "\x1b[2;37m[{}]\x1b[0m {}{}{} \x1b[1;34m{}\x1b[0m {}",
                timestamp, color_start, level_formatted, color_end, tag_formatted, message
            );
        }

        // 3. File Logging
        self.append_to_file(&timestamp, level.as_str(), tag, message, details);
    }

    fn append_to_file(&self, timestamp: &str, level: &str, tag: &str, message: &str, details: Option<&str>) {
        self.check_rotate_file();

        let mut formatted = format!("[{}] [{: <5}] [{: <9}] {}\n", timestamp, level, tag, message);
        if let Some(extra) = details {
            formatted.push_str(&format!("    Details: {}\n", extra));
        }

        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.current_log_file)
        {
            let _ = file.write_all(formatted.as_bytes());
            let _ = file.flush();
        }
    }

    fn check_rotate_file(&self) {
        if let Ok(metadata) = fs::metadata(&self.current_log_file) {
            if metadata.len() > self.max_file_size_bytes {
                let backup_file = self.logs_dir.join("aideo.old.log");
                let _ = fs::remove_file(&backup_file);
                let _ = fs::rename(&self.current_log_file, &backup_file);
            }
        }
    }

    pub fn get_recent_entries(&self, count: Option<usize>) -> Vec<LogEntry> {
        if let Ok(ring) = self.recent_logs.lock() {
            let n = count.unwrap_or(self.max_recent_logs);
            let skip = if ring.len() > n { ring.len() - n } else { 0 };
            ring.iter().skip(skip).cloned().collect()
        } else {
            Vec::new()
        }
    }

    pub fn write_crash_dump(
        &self,
        crash_type: &str,
        reason: &str,
        backtrace_str: Option<&str>,
        extra_info: Option<&str>,
    ) -> Result<PathBuf, String> {
        let now = SystemTime::now();
        let timestamp_file = Self::format_timestamp(now)
            .replace(':', "-")
            .replace(' ', "_");
        let crash_filename = format!("crash-{}-{}.log", crash_type.to_lowercase(), timestamp_file);
        let crash_file_path = self.logs_dir.join(&crash_filename);

        let system_info = Self::collect_system_info(&self.logs_dir, &self.current_log_file);

        let mut dump = String::new();
        dump.push_str("================================================================================\n");
        dump.push_str(&format!(" AIDEO MUSIC PLAYER - CRASH REPORT ({})\n", crash_type.to_uppercase()));
        dump.push_str("================================================================================\n\n");
        dump.push_str(&format!("Timestamp:     {}\n", system_info.timestamp));
        dump.push_str(&format!("Application:   {} v{}\n", system_info.app_name, system_info.app_version));
        dump.push_str(&format!("Platform:      {} (Arch: {}, CPUs: {})\n", system_info.os_version, system_info.arch, system_info.cpu_count));
        dump.push_str(&format!("Process ID:    {}\n", system_info.process_id));
        dump.push_str(&format!("Crash Reason:  {}\n\n", reason));

        if let Some(extra) = extra_info {
            dump.push_str("--------------------------------------------------------------------------------\n");
            dump.push_str("CONTEXT & DETAILS\n");
            dump.push_str("--------------------------------------------------------------------------------\n");
            dump.push_str(extra);
            dump.push_str("\n\n");
        }

        if let Some(bt) = backtrace_str {
            dump.push_str("--------------------------------------------------------------------------------\n");
            dump.push_str("STACK BACKTRACE\n");
            dump.push_str("--------------------------------------------------------------------------------\n");
            dump.push_str(bt);
            dump.push_str("\n\n");
        }

        dump.push_str("--------------------------------------------------------------------------------\n");
        dump.push_str("RECENT LOG BREADCRUMBS (Pre-Crash Activity)\n");
        dump.push_str("--------------------------------------------------------------------------------\n");
        let entries = self.get_recent_entries(Some(100));
        if entries.is_empty() {
            dump.push_str("No preceding log records captured in buffer.\n");
        } else {
            for entry in entries {
                dump.push_str(&format!("[{}] [{: <5}] [{: <9}] {}\n", entry.timestamp, entry.level, entry.tag, entry.message));
                if let Some(d) = entry.details {
                    dump.push_str(&format!("    Details: {}\n", d));
                }
            }
        }
        dump.push_str("\n================================================================================\n");
        dump.push_str(" END OF CRASH REPORT\n");
        dump.push_str("================================================================================\n");

        let mut file = File::create(&crash_file_path)
            .map_err(|e| format!("Failed to create crash file at {:?}: {}", crash_file_path, e))?;
        file.write_all(dump.as_bytes())
            .map_err(|e| format!("Failed to write crash dump: {}", e))?;
        file.flush().ok();

        // Also record to main log file
        self.log(
            LogLevel::Crash,
            "CRASH",
            &format!("Crash dump written to {:?}", crash_file_path),
            Some(reason),
        );

        Ok(crash_file_path)
    }

    pub fn collect_system_info(logs_dir: &Path, current_log_file: &Path) -> SystemDiagnosticInfo {
        let total_logs = if let Some(logger) = GLOBAL_LOGGER.get() {
            logger.recent_logs.lock().map(|r| r.len()).unwrap_or(0)
        } else {
            0
        };

        SystemDiagnosticInfo {
            app_name: "Aideo Music Player".to_string(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            os_name: std::env::consts::OS.to_string(),
            os_version: format!("{} ({})", std::env::consts::OS, std::env::consts::FAMILY),
            arch: std::env::consts::ARCH.to_string(),
            cpu_count: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1),
            process_id: std::process::id(),
            log_dir: logs_dir.to_string_lossy().to_string(),
            log_file: current_log_file.to_string_lossy().to_string(),
            total_logs_in_memory: total_logs,
            active_audio_backend: if cfg!(feature = "asio") { "ASIO/CPAL/WASAPI" } else { "CPAL/WASAPI" }.to_string(),
            timestamp: Self::format_timestamp(SystemTime::now()),
        }
    }

    pub fn clear_logs(&self) -> Result<(), String> {
        if let Ok(mut ring) = self.recent_logs.lock() {
            ring.clear();
        }
        if self.current_log_file.exists() {
            let _ = fs::remove_file(&self.current_log_file);
        }
        let backup = self.logs_dir.join("aideo.old.log");
        if backup.exists() {
            let _ = fs::remove_file(&backup);
        }
        Ok(())
    }
}

// Global logger helper functions
pub fn init_logger(logs_dir: PathBuf) -> Arc<AppLogger> {
    let logger = Arc::new(AppLogger::new(logs_dir));
    let _ = GLOBAL_LOGGER.set(logger.clone());
    logger
}

pub fn get_logger() -> Option<Arc<AppLogger>> {
    GLOBAL_LOGGER.get().cloned()
}

pub fn log_msg(level: LogLevel, tag: &str, message: &str, details: Option<&str>) {
    if let Some(logger) = GLOBAL_LOGGER.get() {
        logger.log(level, tag, message, details);
    } else {
        // Fallback before global logger init
        let now = SystemTime::now();
        let ts = AppLogger::format_timestamp(now);
        let (color_start, color_end) = level.ansi_color();
        eprintln!(
            "\x1b[2;37m[{}]\x1b[0m {}{}{} \x1b[1;34m[{}]\x1b[0m {}",
            ts, color_start, level.as_str(), color_end, tag, message
        );
    }
}

pub fn install_panic_hook() {
    std::panic::set_hook(Box::new(|panic_info| {
        let payload = if let Some(s) = panic_info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = panic_info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "Box<Any> panic payload (unknown reason)".to_string()
        };

        let location = if let Some(loc) = panic_info.location() {
            format!("{}:{}:{}", loc.file(), loc.line(), loc.column())
        } else {
            "Unknown location".to_string()
        };

        let thread_name = std::thread::current()
            .name()
            .unwrap_or("unnamed")
            .to_string();

        let backtrace = std::backtrace::Backtrace::force_capture();
        let backtrace_str = format!("{}", backtrace);

        let reason = format!("Thread '{}' panicked at {}: {}", thread_name, location, payload);

        eprintln!("\n\x1b[1;97;41m================================================================================\x1b[0m");
        eprintln!("\x1b[1;31m[AIDEO BACKEND PANIC DETECTED]\x1b[0m");
        eprintln!("\x1b[1;37mReason:\x1b[0m   {}", payload);
        eprintln!("\x1b[1;37mLocation:\x1b[0m {}", location);
        eprintln!("\x1b[1;37mThread:\x1b[0m   {}", thread_name);

        if let Some(logger) = GLOBAL_LOGGER.get() {
            match logger.write_crash_dump("backend", &reason, Some(&backtrace_str), None) {
                Ok(path) => {
                    eprintln!("\x1b[1;32mCrash Log:\x1b[0m {:?}", path);
                }
                Err(e) => {
                    eprintln!("\x1b[1;31mFailed to write crash dump:\x1b[0m {}", e);
                }
            }
        }

        eprintln!("\x1b[1;33mStack Backtrace:\x1b[0m\n{}", backtrace_str);
        eprintln!("\x1b[1;97;41m================================================================================\x1b[0m\n");
    }));
}

// ── Convenient Logging Macros ───────────────────────────────────────────────
#[macro_export]
macro_rules! log_debug {
    ($tag:expr, $($arg:tt)*) => {
        $crate::logger::log_msg($crate::logger::LogLevel::Debug, $tag, &format!($($arg)*), None)
    };
}

#[macro_export]
macro_rules! log_info {
    ($tag:expr, $($arg:tt)*) => {
        $crate::logger::log_msg($crate::logger::LogLevel::Info, $tag, &format!($($arg)*), None)
    };
}

#[macro_export]
macro_rules! log_warn {
    ($tag:expr, $($arg:tt)*) => {
        $crate::logger::log_msg($crate::logger::LogLevel::Warn, $tag, &format!($($arg)*), None)
    };
}

#[macro_export]
macro_rules! log_error {
    ($tag:expr, $($arg:tt)*) => {
        $crate::logger::log_msg($crate::logger::LogLevel::Error, $tag, &format!($($arg)*), None)
    };
}

#[macro_export]
macro_rules! log_error_details {
    ($tag:expr, $msg:expr, $details:expr) => {
        $crate::logger::log_msg($crate::logger::LogLevel::Error, $tag, $msg, Some($details))
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_timestamp() {
        let time = UNIX_EPOCH + std::time::Duration::from_secs(1700000000);
        let formatted = AppLogger::format_timestamp(time);
        assert!(!formatted.is_empty());
        assert!(formatted.contains("-"));
        assert!(formatted.contains(":"));
        assert!(formatted.contains("."));
    }

    #[test]
    fn test_log_level_parsing() {
        assert_eq!(LogLevel::from_str("debug"), LogLevel::Debug);
        assert_eq!(LogLevel::from_str("INFO"), LogLevel::Info);
        assert_eq!(LogLevel::from_str("warn"), LogLevel::Warn);
        assert_eq!(LogLevel::from_str("warning"), LogLevel::Warn);
        assert_eq!(LogLevel::from_str("error"), LogLevel::Error);
        assert_eq!(LogLevel::from_str("crash"), LogLevel::Crash);
        assert_eq!(LogLevel::from_str("unknown"), LogLevel::Info);
    }

    #[test]
    fn test_logger_ring_buffer_and_file() {
        let temp_dir = std::env::temp_dir().join("aideo_test_logs");
        let _ = fs::remove_dir_all(&temp_dir);
        let logger = AppLogger::new(temp_dir.clone());

        logger.log(LogLevel::Info, "TEST", "Test message 1", None);
        logger.log(LogLevel::Warn, "TEST", "Test warning 2", Some("Extra details"));
        logger.log(LogLevel::Error, "TEST", "Test error 3", None);

        let entries = logger.get_recent_entries(Some(10));
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].message, "Test message 1");
        assert_eq!(entries[1].message, "Test warning 2");
        assert_eq!(entries[1].details.as_deref(), Some("Extra details"));
        assert_eq!(entries[2].message, "Test error 3");

        assert!(logger.current_log_file.exists());
        let file_content = fs::read_to_string(&logger.current_log_file).unwrap();
        assert!(file_content.contains("Test message 1"));
        assert!(file_content.contains("Test warning 2"));
        assert!(file_content.contains("Extra details"));

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_write_crash_dump() {
        let temp_dir = std::env::temp_dir().join("aideo_test_crash");
        let _ = fs::remove_dir_all(&temp_dir);
        let logger = AppLogger::new(temp_dir.clone());

        logger.log(LogLevel::Info, "SYSTEM", "Starting playback...", None);
        let crash_path = logger.write_crash_dump(
            "frontend",
            "Uncaught TypeError: Cannot read properties of undefined",
            Some("Error: at Object.render (App.tsx:120)"),
            Some("Active View: NowPlayingView\nTrack: Hotel California"),
        ).expect("Crash dump should be written");

        assert!(crash_path.exists());
        let dump_content = fs::read_to_string(&crash_path).unwrap();
        assert!(dump_content.contains("AIDEO MUSIC PLAYER - CRASH REPORT (FRONTEND)"));
        assert!(dump_content.contains("Uncaught TypeError"));
        assert!(dump_content.contains("Active View: NowPlayingView"));
        assert!(dump_content.contains("Starting playback..."));

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
