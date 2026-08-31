use std::sync::atomic::{AtomicU64, AtomicU32, AtomicBool, Ordering};

pub static SESSION_DOWNLOADED_BYTES: AtomicU64 = AtomicU64::new(0);
pub static CURRENT_DOWNLOAD_SPEED_BPS: AtomicU32 = AtomicU32::new(0);
pub static STREAM_LATENCY_MS: AtomicU32 = AtomicU32::new(0);
pub static ACTIVE_STREAM_BUFFERED_BYTES: AtomicU64 = AtomicU64::new(0);
pub static ACTIVE_STREAM_TOTAL_BYTES: AtomicU64 = AtomicU64::new(0);

/// Consecutive WASAPI Exclusive failures for the CURRENT track
pub static EXCLUSIVE_STREAM_FAILURES: AtomicU32 = AtomicU32::new(0);
/// Ensures the "staying in Shared Mode" toast fires once per budget
pub static EXCLUSIVE_FALLBACK_NOTIFIED: AtomicBool = AtomicBool::new(false);

#[derive(serde::Serialize, Clone, Debug)]
pub struct NetworkTelemetry {
    pub session_downloaded_bytes: u64,
    pub current_download_rate_bps: u32,
    pub latency_ms: u32,
    pub active_stream_buffered_bytes: u64,
    pub active_stream_total_bytes: u64,
}

pub fn get_network_telemetry() -> NetworkTelemetry {
    NetworkTelemetry {
        session_downloaded_bytes: SESSION_DOWNLOADED_BYTES.load(Ordering::Relaxed),
        current_download_rate_bps: CURRENT_DOWNLOAD_SPEED_BPS.load(Ordering::Relaxed),
        latency_ms: STREAM_LATENCY_MS.load(Ordering::Relaxed),
        active_stream_buffered_bytes: ACTIVE_STREAM_BUFFERED_BYTES.load(Ordering::Relaxed),
        active_stream_total_bytes: ACTIVE_STREAM_TOTAL_BYTES.load(Ordering::Relaxed),
    }
}
