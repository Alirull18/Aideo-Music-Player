use std::sync::Arc;
use std::sync::Mutex;
use std::sync::atomic::AtomicBool;
use symphonia::core::units::TimeBase;
use symphonia::core::formats::FormatReader;
use symphonia::core::codecs::Decoder;

#[derive(Clone)]
pub struct CachedTrack {
    pub path: String,
    pub samples: Arc<Mutex<Vec<Vec<f32>>>>,
    pub complete: Arc<AtomicBool>,
    pub file_rate: usize,
    pub file_ch: usize,
    pub time_base: Option<TimeBase>,
}

/// 📦 Grouped decoder state to simplify passing multiple arguments
pub struct DecoderInfo {
    pub format: Box<dyn FormatReader>,
    pub decoder: Box<dyn Decoder>,
    pub track_id: u32,
    pub time_base: Option<TimeBase>,
    pub file_rate: usize,
    pub file_ch: usize,
    pub resolved_path: String,
}
