use symphonia::core::io::MediaSourceStream;
use symphonia::core::probe::Hint;
use symphonia::core::formats::FormatOptions;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::default::{get_probe, get_codecs};
use rustfft::{FftPlanner, num_complex::Complex};
use symphonia::core::conv::FromSample;

// Use Symphonia's conversions so every decoded sample format is analyzed.
pub fn audio_buffer_to_interleaved_s16(buf: &AudioBufferRef<'_>) -> Vec<i16> {
    let channels = buf.spec().channels.count();
    let mut out = vec![0i16; buf.frames() * channels];
    macro_rules! convert {
        ($b:expr) => {
            for ch in 0..channels {
                for (i, &sample) in $b.chan(ch).iter().enumerate() {
                    out[i * channels + ch] = i16::from_sample(sample);
                }
            }
        };
    }
    match buf {
        AudioBufferRef::U8(b) => convert!(b),
        AudioBufferRef::U16(b) => convert!(b),
        AudioBufferRef::U24(b) => convert!(b),
        AudioBufferRef::U32(b) => convert!(b),
        AudioBufferRef::S8(b) => convert!(b),
        AudioBufferRef::S16(b) => convert!(b),
        AudioBufferRef::S24(b) => convert!(b),
        AudioBufferRef::S32(b) => convert!(b),
        AudioBufferRef::F32(b) => convert!(b),
        AudioBufferRef::F64(b) => convert!(b),
    }
    out
}

pub fn audio_buffer_to_mono_f32(buf: &AudioBufferRef<'_>) -> Vec<f32> {
    let channels = buf.spec().channels.count();
    let mut out = vec![0.0f32; buf.frames()];
    macro_rules! convert {
        ($b:expr) => {
            for ch in 0..channels {
                for (value, &sample) in out.iter_mut().zip($b.chan(ch)) {
                    *value += f32::from_sample(sample) / channels as f32;
                }
            }
        };
    }
    match buf {
        AudioBufferRef::U8(b) => convert!(b),
        AudioBufferRef::U16(b) => convert!(b),
        AudioBufferRef::U24(b) => convert!(b),
        AudioBufferRef::U32(b) => convert!(b),
        AudioBufferRef::S8(b) => convert!(b),
        AudioBufferRef::S16(b) => convert!(b),
        AudioBufferRef::S24(b) => convert!(b),
        AudioBufferRef::S32(b) => convert!(b),
        AudioBufferRef::F32(b) => convert!(b),
        AudioBufferRef::F64(b) => convert!(b),
    }
    out
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct SonicProfile {
    pub bpm: f64,
    pub energy: f64,
    pub bass_ratio: f64,
    pub treble_ratio: f64,
    pub integrated_lufs: f64,
    pub lufs_gain_db: f64,
    pub waveform: Vec<f32>,
}

// Generate the Acoustid base64 fingerprint and calculate sonic metrics
pub fn analyze_audio_file(path: &str) -> Result<(String, f64, SonicProfile), String> {
    let file = std::fs::File::open(path).map_err(|e| format!("Failed to open file: {}", e))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(path).extension() {
        hint.with_extension(&ext.to_string_lossy());
    }
    
    let probed = get_probe().format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| format!("Symphonia probe error: {}", e))?;
    
    let mut format = probed.format;
    let track = format.tracks().first().ok_or("No audio tracks found")?.clone();
    let mut decoder = get_codecs().make(&track.codec_params, &Default::default())
        .map_err(|e| format!("Failed to create decoder: {}", e))?;
    let track_id = track.id;

    let sample_rate = track.codec_params.sample_rate.unwrap_or(44100);
    let channels = track.codec_params.channels.map(|c| c.count()).unwrap_or(2);
    
    // Compute duration in seconds
    let duration = if let Some(n_frames) = track.codec_params.n_frames {
        n_frames as f64 / sample_rate as f64
    } else {
        0.0
    };

    // Initialize Chromaprint
    let mut fp = chromaprint::Fingerprinter::new(chromaprint::Algorithm::default());
    fp.start(sample_rate, channels as u16).map_err(|e| format!("Failed to start fingerprinter: {:?}", e))?;

    let mut total_samples_decoded = 0;
    let limit_samples = 120 * sample_rate as usize * channels; // Process up to 120 seconds for fingerprint
    
    let mut all_mono_samples = Vec::new();

    loop {
        if total_samples_decoded >= limit_samples { break; }
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(ref err)) if err.kind() == std::io::ErrorKind::UnexpectedEof => {
                break;
            }
            Err(e) => return Err(e.to_string()),
        };
        
        if packet.track_id() != track_id {
            continue;
        }
        
        match decoder.decode(&packet) {
            Ok(buf) => {
                let interleaved = audio_buffer_to_interleaved_s16(&buf);
                if total_samples_decoded < limit_samples {
                    let take = interleaved.len().min(limit_samples - total_samples_decoded); let _ = fp.feed(&interleaved[..take]);
                    total_samples_decoded += take;
                }
                
                // Save mono f32 samples for sonic profiling (cap at first 120 seconds as well)
                if all_mono_samples.len() < 120 * sample_rate as usize {
                    let mono = audio_buffer_to_mono_f32(&buf); let take = mono.len().min(120 * sample_rate as usize - all_mono_samples.len()); all_mono_samples.extend_from_slice(&mono[..take]);
                }
            }
            Err(e) => return Err(e.to_string()),
        }
    }

    let _ = fp.finish();
    let fingerprint = fp.encode();

    // ── Sonic Analysis (BPM, Energy, Spectral Ratios) ───────────────────────
    let profile = calculate_sonic_profile(&all_mono_samples, sample_rate as usize)?;

    Ok((fingerprint, duration, profile))
}

fn calculate_sonic_profile(samples: &[f32], sample_rate: usize) -> Result<SonicProfile, String> {
    calculate_profile(samples, sample_rate, true, &|| false)
}

fn calculate_profile(samples: &[f32], sample_rate: usize, loudness: bool, cancelled: &dyn Fn() -> bool) -> Result<SonicProfile, String> {
    if samples.is_empty() || sample_rate == 0 {
        return Err("Cannot analyze audio without finite decoded samples and a sample rate".to_string());
    }

    // 1. RMS Energy
    let mut sum_sq = 0.0f64;
    for chunk in samples.chunks(4096) {
        if cancelled() { return Err("cancelled".into()); }
        for &sample in chunk {
            if !sample.is_finite() { return Err("Nonfinite decoded sample".into()); }
            sum_sq += (sample as f64).powi(2);
        }
    }
    let rms = (sum_sq / samples.len() as f64).sqrt();
    let energy = (rms as f64 * 3.0).clamp(0.0, 1.0); // Simple normalization scaling

    // 2. BPM / Tempo (Energy envelope onset detection + Autocorrelation with Parabolic Interpolation)
    // Block duration ~20ms (50 blocks per second) for enhanced tempo resolution
    let block_size = (sample_rate / 50).max(1); // 20ms blocks
    let mut energy_envelope = Vec::new();
    
    for chunk in samples.chunks(block_size) { if cancelled() { return Err("cancelled".into()); }
        let chunk_sum_sq: f32 = chunk.iter().map(|&s| s * s).sum();
        let chunk_rms = (chunk_sum_sq / chunk.len() as f32).sqrt();
        energy_envelope.push(chunk_rms);
    }

    // First rectified difference
    let mut onsets = Vec::new();
    for i in 1..energy_envelope.len() {
        let diff = (energy_envelope[i] - energy_envelope[i - 1]).max(0.0);
        onsets.push(diff);
    }

    // Autocorrelation on onsets to find dominant periodicity (lags corresponding to 60-190 BPM)
    // 20ms block size -> 50 blocks per second.
    // Lag 16 -> 50 / 16 * 60 = 187.5 BPM
    // Lag 50 -> 50 / 50 * 60 = 60.0 BPM
    let min_lag = 16;
    let max_lag = 50.min(onsets.len().saturating_sub(1));
    let mut correlations = vec![0.0f32; max_lag + 2];
    let mut best_lag = 0;
    let mut max_correlation = 0.0f32;

    if onsets.len() > min_lag + 2 && max_lag > min_lag {
        for lag in min_lag..=max_lag {
            let mut correlation = 0.0f32;
            let mut count = 0;
            for i in 0..(onsets.len() - lag) {
                correlation += onsets[i] * onsets[i + lag];
                count += 1;
            }
            if count > 0 {
                correlation /= count as f32;
            }
            correlations[lag] = correlation;
            if correlation > max_correlation {
                max_correlation = correlation;
                best_lag = lag;
            }
        }
    }

    let bpm = if best_lag >= min_lag && best_lag <= max_lag {
        // Apply 3-point parabolic interpolation around the peak lag
        let exact_lag = if best_lag > min_lag && best_lag < max_lag {
            let alpha = correlations[best_lag - 1];
            let beta = correlations[best_lag];
            let gamma = correlations[best_lag + 1];
            let denom = 2.0 * (alpha - 2.0 * beta + gamma);
            if denom.abs() > 1e-7 {
                let delta = (alpha - gamma) / denom;
                (best_lag as f64 + delta as f64).clamp(min_lag as f64, max_lag as f64)
            } else {
                best_lag as f64
            }
        } else {
            best_lag as f64
        };
        let raw_bpm = (50.0 / exact_lag) * 60.0;
        ((raw_bpm * 10.0).round() / 10.0).clamp(60.0, 200.0)
    } else {
        120.0
    };

    let (bass_ratio, treble_ratio) = spectral_ratios(samples, sample_rate, cancelled)?;

    // 4. EBU R128 Integrated LUFS & ReplayGain dB Calculation
    let integrated_lufs = if loudness { calculate_ebu_r128_lufs(samples, sample_rate) } else { -70.0 };
    let lufs_gain_db = (-14.0 - integrated_lufs).clamp(-12.0, 12.0);
    let waveform = if loudness { calculate_waveform_peaks(samples, 100) } else { Vec::new() };

    Ok(SonicProfile {
        bpm,
        energy,
        bass_ratio,
        treble_ratio,
        integrated_lufs,
        lufs_gain_db,
        waveform,
    })
}

fn calculate_waveform_peaks(samples: &[f32], buckets: usize) -> Vec<f32> {
    if samples.is_empty() || buckets == 0 {
        return vec![0.5; buckets];
    }
    let chunk_size = (samples.len() / buckets).max(1);
    let mut peaks = Vec::with_capacity(buckets);
    let mut max_peak = 0.001f32;

    for chunk in samples.chunks(chunk_size).take(buckets) {
        let peak = chunk.iter().map(|&s| s.abs()).fold(0.0f32, f32::max);
        max_peak = max_peak.max(peak);
        peaks.push(peak);
    }
    while peaks.len() < buckets {
        peaks.push(0.0);
    }
    peaks.into_iter().map(|p| (p / max_peak).clamp(0.08, 1.0)).collect()
}

/// Biquad IIR Filter used for EBU R128 / ITU-R BS.1770 K-weighting pre-filtering.
#[derive(Debug, Clone)]
pub struct BiquadFilter {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl BiquadFilter {
    /// Stage 1 K-weighting: High-shelf filter (+4 dB at 1.5 kHz, Q = 0.707)
    pub fn new_high_shelf(sample_rate: f32) -> Self {
        let v0 = 10.0f32.powf(4.0 / 20.0); // ~1.5848932
        let k = (std::f32::consts::PI * 1500.0 / sample_rate).tan();
        let k2 = k * k;
        let sqrt2 = std::f32::consts::SQRT_2;
        let sqrt_v0 = v0.sqrt();

        let a0 = 1.0 + sqrt2 * k + k2;
        let b0 = (v0 + sqrt2 * sqrt_v0 * k + k2) / a0;
        let b1 = 2.0 * (k2 - v0) / a0;
        let b2 = (v0 - sqrt2 * sqrt_v0 * k + k2) / a0;
        let a1 = 2.0 * (k2 - 1.0) / a0;
        let a2 = (1.0 - sqrt2 * k + k2) / a0;

        Self {
            b0,
            b1,
            b2,
            a1,
            a2,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    /// Stage 2 K-weighting: High-pass filter (2nd order Butterworth at 38 Hz, Q = 0.707)
    pub fn new_high_pass(sample_rate: f32) -> Self {
        let k = (std::f32::consts::PI * 38.0 / sample_rate).tan();
        let k2 = k * k;
        let sqrt2 = std::f32::consts::SQRT_2;

        let a0 = 1.0 + sqrt2 * k + k2;
        let b0 = 1.0 / a0;
        let b1 = -2.0 / a0;
        let b2 = 1.0 / a0;
        let a1 = 2.0 * (k2 - 1.0) / a0;
        let a2 = (1.0 - sqrt2 * k + k2) / a0;

        Self {
            b0,
            b1,
            b2,
            a1,
            a2,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2 - self.a1 * self.y1 - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }
}

/// Calculates standard EBU R128 / ITU-R BS.1770-4 Integrated Loudness (LUFS)
/// with K-weighting pre-filtering and two-stage gating (absolute -70 LUFS & relative -10 LU).
pub fn calculate_ebu_r128_lufs(samples: &[f32], sample_rate: usize) -> f64 {
    if samples.is_empty() || sample_rate == 0 {
        return -70.0;
    }

    let sr = sample_rate as f32;
    let mut stage1 = BiquadFilter::new_high_shelf(sr);
    let mut stage2 = BiquadFilter::new_high_pass(sr);

    // 1. Apply K-weighting filters
    let k_weighted: Vec<f32> = samples
        .iter()
        .map(|&s| {
            let s1 = stage1.process(s);
            stage2.process(s1)
        })
        .collect();

    // 2. 400ms blocks with 100ms hop (75% overlap)
    let block_size = (sample_rate as f32 * 0.4) as usize;
    let hop_size = (sample_rate as f32 * 0.1) as usize;

    if block_size == 0 || hop_size == 0 || k_weighted.len() < block_size {
        let sum_sq: f32 = k_weighted.iter().map(|&s| s * s).sum();
        let ms = sum_sq / k_weighted.len().max(1) as f32;
        if ms <= 1e-10 {
            return -70.0;
        }
        return (-0.691 + 10.0 * (ms as f64).log10()).clamp(-70.0, 10.0);
    }

    let mut block_ms = Vec::new();
    let mut i = 0;
    while i + block_size <= k_weighted.len() {
        let block = &k_weighted[i..i + block_size];
        let sum_sq: f32 = block.iter().map(|&s| s * s).sum();
        let ms = sum_sq / block_size as f32;
        block_ms.push(ms);
        i += hop_size;
    }

    if block_ms.is_empty() {
        return -70.0;
    }

    // Absolute threshold: -70.0 LUFS => z_abs_thresh = 10^((-70 + 0.691) / 10)
    let abs_thresh_ms = 10.0f64.powf((-70.0 + 0.691) / 10.0) as f32;
    let abs_pass: Vec<f32> = block_ms.into_iter().filter(|&ms| ms >= abs_thresh_ms).collect();

    if abs_pass.is_empty() {
        return -70.0;
    }

    let abs_avg_ms: f32 = abs_pass.iter().sum::<f32>() / abs_pass.len() as f32;

    // Relative threshold: 10 dB below absolute average => z_rel_thresh = abs_avg * 10^(-1.0)
    let rel_thresh_ms = abs_avg_ms * 0.1;
    let rel_pass: Vec<f32> = abs_pass.into_iter().filter(|&ms| ms >= rel_thresh_ms).collect();

    if rel_pass.is_empty() {
        return -70.0;
    }

    let integrated_ms: f32 = rel_pass.iter().sum::<f32>() / rel_pass.len() as f32;
    if integrated_ms <= 1e-10 {
        return -70.0;
    }

    let lufs = -0.691 + 10.0 * (integrated_ms as f64).log10();
    lufs.clamp(-70.0, 10.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_gate_excludes_local_and_remote_playback() {
        assert!(analysis_busy(1, false, false));
        assert!(analysis_busy(0, true, false));
        assert!(analysis_busy(2, false, true));
        assert!(!analysis_busy(2, false, false));
    }

    #[test]
    fn spectral_profile_aggregates_windows() {
        let sr = 16000;
        let samples: Vec<f32> = (0..sr * 4).map(|i| {
            let frequency = if i < sr * 2 { 100.0 } else { 6000.0 };
            (2.0 * std::f32::consts::PI * frequency * i as f32 / sr as f32).sin()
        }).collect();
        let profile = calculate_sonic_profile(&samples, sr).unwrap();
        assert!(profile.bass_ratio > 0.2 && profile.treble_ratio > 0.2);
    }

    #[test]
    fn recommendation_analysis_cancels_before_opening_file() {
        assert_eq!(analyze_recommendation("missing.wav", &|| true).unwrap_err(), "cancelled");
        assert_eq!(calculate_profile(&[0.1; 4096], 8000, false, &|| true).unwrap_err(), "cancelled");
    }

    #[test]
    fn recommendation_decode_stops_at_ninety_seconds_without_loudness() {
        let path = std::env::temp_dir().join(format!("aideo-analysis-{}.wav", std::process::id()));
        let rate = 8000u32;
        let frames = rate * 91;
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF"); wav.extend_from_slice(&(36 + frames * 2).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt "); wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes()); wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&rate.to_le_bytes()); wav.extend_from_slice(&(rate * 2).to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes()); wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data"); wav.extend_from_slice(&(frames * 2).to_le_bytes());
        for i in 0..frames { wav.extend_from_slice(&(if i < rate * 90 { 8192i16 } else { 32767i16 }).to_le_bytes()); }
        std::fs::write(&path, wav).unwrap();
        let result = analyze_recommendation(path.to_str().unwrap(), &|| false);
        std::fs::remove_file(path).unwrap();
        let profile = result.unwrap();
        assert!((profile.energy - 0.75).abs() < 0.0001);
        assert_eq!(profile.integrated_lufs, -70.0);
    }

    #[test]
    fn analyzer_converts_integer_formats_instead_of_silence() {
        use symphonia::core::audio::{AsAudioBufferRef, AudioBuffer, Channels, SignalSpec};
        use symphonia::core::sample::{u24, i24};
        let spec = SignalSpec::new(44100, Channels::FRONT_LEFT | Channels::FRONT_RIGHT);
        macro_rules! check {
            ($ty:ty, $negative:expr, $positive:expr) => {{
                let mut audio = AudioBuffer::<$ty>::new(2, spec);
                audio.render_reserved(Some(2));
                audio.chan_mut(0).copy_from_slice(&[$negative, $positive]);
                audio.chan_mut(1).copy_from_slice(&[$negative, $positive]);
                let buffer = audio.as_audio_buffer_ref();
                let mono = audio_buffer_to_mono_f32(&buffer);
                assert_eq!(mono, vec![-0.5, 0.5]);
                let fingerprint_samples = audio_buffer_to_interleaved_s16(&buffer);
                assert_eq!(fingerprint_samples, vec![-16384, -16384, 16384, 16384]);
            }};
        }
        check!(u8, 64, 192);
        check!(u16, 16384, 49152);
        check!(u24, u24(4194304), u24(12582912));
        check!(u32, 1073741824, 3221225472);
        check!(i8, -64, 64);
        check!(i16, -16384, 16384);
        check!(i24, i24(-4194304), i24(4194304));
        check!(i32, -1073741824, 1073741824);
        check!(f32, -0.5, 0.5);
        check!(f64, -0.5, 0.5);
    }

    #[test]
    fn sonic_profile_requires_decoded_finite_audio() {
        assert!(calculate_sonic_profile(&[], 44100).is_err());
        assert!(calculate_sonic_profile(&[f32::NAN], 44100).is_err());
        assert!(calculate_sonic_profile(&[0.0], 0).is_err());
        let silence = calculate_sonic_profile(&[0.0; 100], 44100).unwrap();
        assert_eq!(silence.energy, 0.0);
        assert_eq!(silence.integrated_lufs, -70.0);
    }

    #[test]
    fn test_ebu_r128_empty_returns_minus_70() {
        assert_eq!(calculate_ebu_r128_lufs(&[], 44100), -70.0);
    }

    #[test]
    fn test_ebu_r128_silence_returns_minus_70() {
        let silence = vec![0.0f32; 44100 * 2];
        assert_eq!(calculate_ebu_r128_lufs(&silence, 44100), -70.0);
    }

    #[test]
    fn test_ebu_r128_sine_wave_lufs() {
        let sample_rate = 44100;
        let duration_secs = 3;
        let freq = 1000.0f32; // 1 kHz sine wave
        let amplitude = 0.12589f32; // -18 dBFS peak

        let mut samples = Vec::with_capacity(sample_rate * duration_secs);
        for i in 0..(sample_rate * duration_secs) {
            let t = i as f32 / sample_rate as f32;
            let val = amplitude * (2.0 * std::f32::consts::PI * freq * t).sin();
            samples.push(val);
        }

        let lufs = calculate_ebu_r128_lufs(&samples, sample_rate);
        // Standard K-weighted 1 kHz sine wave at -18 dBFS yields ~ -18.5 to -19.5 LUFS
        assert!(lufs > -22.0 && lufs < -16.0, "Expected LUFS around -19.0, got {:.2}", lufs);
    }
}

fn spectral_ratios(samples: &[f32], sample_rate: usize, cancelled: &dyn Fn() -> bool) -> Result<(f64, f64), String> {
    let size = 2048;
    let fft = FftPlanner::new().plan_fft_forward(size);
    let mut buffer = vec![Complex::new(0.0f32, 0.0); size];
    let mut sums = [0.0f64; 3];
    // ponytail: 64 evenly spaced windows bound FFT work; increase only with measured benefit.
    let windows = (samples.len() / size).min(64);
    for window in 0..windows {
        if cancelled() { return Err("cancelled".into()); }
        let offset = if windows <= 1 { 0 } else { window * (samples.len() - size) / (windows - 1) };
        for (i, value) in buffer.iter_mut().enumerate() {
            let hann = 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (size - 1) as f32).cos();
            *value = Complex::new(samples[offset + i] * hann, 0.0);
        }
        fft.process(&mut buffer);
        for (i, value) in buffer.iter().enumerate().take(size / 2).skip(1) {
            let hz = i * sample_rate / size;
            sums[if hz < 250 { 0 } else if hz < 4000 { 1 } else { 2 }] += value.norm_sqr() as f64;
        }
    }
    let total: f64 = sums.iter().sum();
    Ok(if total > 0.0 { (sums[0] / total, sums[2] / total) } else { (0.0, 0.0) })
}

fn analyze_recommendation(path: &str, cancelled: &dyn Fn() -> bool) -> Result<SonicProfile, String> {
    if cancelled() { return Err("cancelled".into()); }
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(path).extension() { hint.with_extension(&ext.to_string_lossy()); }
    let mut format = get_probe().format(&hint, MediaSourceStream::new(Box::new(file), Default::default()), &FormatOptions::default(), &MetadataOptions::default()).map_err(|e| e.to_string())?.format;
    let track = format.default_track().ok_or("No audio track")?.clone();
    let rate = track.codec_params.sample_rate.ok_or("Missing sample rate")? as usize;
    if rate == 0 || rate > 192000 { return Err("Unsupported sample rate".into()); }
    let mut decoder = get_codecs().make(&track.codec_params, &Default::default()).map_err(|e| e.to_string())?;
    let mut samples = Vec::new();
    let started = std::time::Instant::now();
    while samples.len() < rate * 90 {
        if cancelled() { return Err("cancelled".into()); }
        if started.elapsed() > std::time::Duration::from_secs(30) { return Err("Analysis time limit".into()); }
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(symphonia::core::errors::Error::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(e.to_string()),
        };
        if packet.track_id() != track.id { continue; }
        let buffer = decoder.decode(&packet).map_err(|e| e.to_string())?;
        if buffer.spec().rate as usize != rate { return Err("Changing sample rate".into()); }
        let mono = audio_buffer_to_mono_f32(&buffer);
        let take = mono.len().min(rate * 90 - samples.len());
        samples.extend_from_slice(&mono[..take]);
    }
    if cancelled() { return Err("cancelled".into()); }
    calculate_profile(&samples, rate, false, cancelled)
}

fn file_stamp(path: &str) -> Option<(i64, String)> {
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() || !std::path::Path::new(path).is_absolute() { return None; }
    Some((i64::try_from(metadata.len()).ok()?, format!("{:?}", metadata.modified().ok()?)))
}

fn analysis_busy(local: u8, chromecast: bool, upnp: bool) -> bool {
    local == 1 || chromecast || upnp
}

pub fn start_idle_analysis(state: crate::AppState) {
    let status = match state.player.lock() { Ok(player) => player.status.clone(), Err(_) => return };
    let _ = std::thread::Builder::new().name("idle-audio-analysis".into()).spawn(move || {
        use std::sync::atomic::Ordering;
        use std::time::{Duration, Instant};
        let cancelled = || analysis_busy(status.load(Ordering::Acquire), crate::chromecast::analysis_playback_active(), crate::upnp::analysis_playback_active());
        let mut idle_since = Instant::now();
        let mut after_path = String::new();
        loop {
            std::thread::sleep(Duration::from_secs(1));
            if cancelled() { idle_since = Instant::now(); continue; }
            if idle_since.elapsed() < Duration::from_secs(30) { continue; }
            let candidates = (|| -> rusqlite::Result<Vec<String>> {
                let db = state.db.lock().map_err(|_| rusqlite::Error::InvalidQuery)?;
                db.execute_batch("CREATE TABLE IF NOT EXISTS audio_analysis (path TEXT PRIMARY KEY, file_size INTEGER NOT NULL, mtime TEXT NOT NULL, version INTEGER NOT NULL, succeeded INTEGER NOT NULL)")?;
                let mut query = db.prepare("SELECT path FROM tracks WHERE path > ?1 ORDER BY path LIMIT 32")?;
                let paths = query.query_map([&after_path], |row| row.get(0))?.collect();
                paths
            })();
            let Ok(paths) = candidates else { continue; };
            if paths.is_empty() { after_path.clear(); continue; }
            for path in paths {
                if cancelled() { idle_since = Instant::now(); break; }
                let Some(stamp) = file_stamp(&path) else { after_path = path; continue; };
                let fresh = state.db.lock().ok().and_then(|db| db.query_row("SELECT EXISTS(SELECT 1 FROM audio_analysis WHERE path=?1 AND file_size=?2 AND mtime=?3 AND version=1)", rusqlite::params![path, stamp.0, stamp.1], |row| row.get::<_, bool>(0)).ok()).unwrap_or(false);
                if fresh { after_path = path; continue; }
                let result = analyze_recommendation(&path, &cancelled);
                if cancelled() || result.as_ref().err().is_some_and(|error| error == "cancelled") { idle_since = Instant::now(); break; }
                if file_stamp(&path).as_ref() != Some(&stamp) { after_path = path; continue; }
                let Ok(mut db) = state.db.lock() else { break; };
                if cancelled() { idle_since = Instant::now(); break; }
                let Ok(tx) = db.transaction() else { break; };
                let stored = (|| -> rusqlite::Result<()> {
                    if cancelled() { return Err(rusqlite::Error::InvalidQuery); }
                    if let Ok(profile) = &result {
                        crate::db::update_track_sonic_profile(&tx, &path, profile.bpm, profile.energy, profile.bass_ratio, profile.treble_ratio, None)?;
                    }
                    tx.execute("INSERT INTO audio_analysis(path,file_size,mtime,version,succeeded) VALUES(?1,?2,?3,1,?4) ON CONFLICT(path) DO UPDATE SET file_size=excluded.file_size,mtime=excluded.mtime,version=excluded.version,succeeded=excluded.succeeded", rusqlite::params![path, stamp.0, stamp.1, result.is_ok()])?;
                    Ok(())
                })();
                if stored.is_ok() && !cancelled() && file_stamp(&path).as_ref() == Some(&stamp) { let _ = tx.commit(); }
                after_path = path;
            }
        }
    });
}
