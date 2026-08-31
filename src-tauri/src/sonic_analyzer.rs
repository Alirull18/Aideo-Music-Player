use symphonia::core::io::MediaSourceStream;
use symphonia::core::probe::Hint;
use symphonia::core::formats::FormatOptions;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::default::{get_probe, get_codecs};
use rustfft::{FftPlanner, num_complex::Complex};

// Convert AudioBufferRef to interleaved i16 for Chromaprint
pub fn audio_buffer_to_interleaved_s16(buf: &AudioBufferRef<'_>) -> Vec<i16> {
    let frames = buf.frames();
    let channels = buf.spec().channels.count();
    let mut out = vec![0i16; frames * channels];
    if channels == 0 || frames == 0 {
        return out;
    }
    
    match buf {
        AudioBufferRef::F32(b) => {
            for ch in 0..channels {
                let chan_data = b.chan(ch);
                for (i, &s) in chan_data.iter().enumerate() {
                    let clamped = s.clamp(-1.0, 1.0);
                    out[i * channels + ch] = (clamped * 32767.0) as i16;
                }
            }
        }
        AudioBufferRef::S16(b) => {
            for ch in 0..channels {
                let chan_data = b.chan(ch);
                for (i, &s) in chan_data.iter().enumerate() {
                    out[i * channels + ch] = s;
                }
            }
        }
        AudioBufferRef::S32(b) => {
            for ch in 0..channels {
                let chan_data = b.chan(ch);
                for (i, &s) in chan_data.iter().enumerate() {
                    out[i * channels + ch] = (s >> 16) as i16;
                }
            }
        }
        AudioBufferRef::U8(b) => {
            for ch in 0..channels {
                let chan_data = b.chan(ch);
                for (i, &s) in chan_data.iter().enumerate() {
                    out[i * channels + ch] = ((s as i32 - 128) * 256) as i16;
                }
            }
        }
        AudioBufferRef::S24(b) => {
            for ch in 0..channels {
                let chan_data = b.chan(ch);
                for (i, &s) in chan_data.iter().enumerate() {
                    out[i * channels + ch] = (s.inner() >> 8) as i16;
                }
            }
        }
        AudioBufferRef::F64(b) => {
            for ch in 0..channels {
                let chan_data = b.chan(ch);
                for (i, &s) in chan_data.iter().enumerate() {
                    let clamped = s.clamp(-1.0, 1.0);
                    out[i * channels + ch] = (clamped * 32767.0) as i16;
                }
            }
        }
        _ => {}
    }
    out
}

// Convert AudioBufferRef to mono f32 for analysis
pub fn audio_buffer_to_mono_f32(buf: &AudioBufferRef<'_>) -> Vec<f32> {
    let frames = buf.frames();
    let channels = buf.spec().channels.count();
    let mut out = vec![0.0f32; frames];
    if channels == 0 || frames == 0 {
        return out;
    }
    
    match buf {
        AudioBufferRef::F32(b) => {
            for i in 0..frames {
                let mut sum = 0.0;
                for ch in 0..channels {
                    sum += b.chan(ch)[i];
                }
                out[i] = sum / channels as f32;
            }
        }
        AudioBufferRef::S16(b) => {
            for i in 0..frames {
                let mut sum = 0.0;
                for ch in 0..channels {
                    sum += b.chan(ch)[i] as f32 / 32768.0;
                }
                out[i] = sum / channels as f32;
            }
        }
        AudioBufferRef::S32(b) => {
            for i in 0..frames {
                let mut sum = 0.0;
                for ch in 0..channels {
                    sum += b.chan(ch)[i] as f32 / i32::MAX as f32;
                }
                out[i] = sum / channels as f32;
            }
        }
        AudioBufferRef::U8(b) => {
            for i in 0..frames {
                let mut sum = 0.0;
                for ch in 0..channels {
                    sum += (b.chan(ch)[i] as f32 - 128.0) / 128.0;
                }
                out[i] = sum / channels as f32;
            }
        }
        AudioBufferRef::S24(b) => {
            for i in 0..frames {
                let mut sum = 0.0;
                for ch in 0..channels {
                    sum += b.chan(ch)[i].inner() as f32 / 8_388_607.0;
                }
                out[i] = sum / channels as f32;
            }
        }
        AudioBufferRef::F64(b) => {
            for i in 0..frames {
                let mut sum = 0.0;
                for ch in 0..channels {
                    sum += b.chan(ch)[i] as f32;
                }
                out[i] = sum / channels as f32;
            }
        }
        _ => {}
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
                    let _ = fp.feed(&interleaved);
                    total_samples_decoded += interleaved.len();
                }
                
                // Save mono f32 samples for sonic profiling (cap at first 120 seconds as well)
                if all_mono_samples.len() < 120 * sample_rate as usize {
                    all_mono_samples.extend(audio_buffer_to_mono_f32(&buf));
                }
            }
            Err(symphonia::core::errors::Error::DecodeError(_)) => continue,
            Err(e) => return Err(e.to_string()),
        }
    }

    let _ = fp.finish();
    let fingerprint = fp.encode();

    // ── Sonic Analysis (BPM, Energy, Spectral Ratios) ───────────────────────
    let profile = calculate_sonic_profile(&all_mono_samples, sample_rate as usize);

    Ok((fingerprint, duration, profile))
}

fn calculate_sonic_profile(samples: &[f32], sample_rate: usize) -> SonicProfile {
    if samples.is_empty() || sample_rate == 0 {
        return SonicProfile { bpm: 120.0, energy: 0.5, bass_ratio: 0.33, treble_ratio: 0.33, integrated_lufs: -14.0, lufs_gain_db: 0.0, waveform: vec![0.5; 100] };
    }

    // 1. RMS Energy
    let sum_sq: f32 = samples.iter().map(|&s| s * s).sum();
    let rms = (sum_sq / samples.len() as f32).sqrt();
    let energy = (rms as f64 * 3.0).clamp(0.0, 1.0); // Simple normalization scaling

    // 2. BPM / Tempo (Energy envelope onset detection + Autocorrelation with Parabolic Interpolation)
    // Block duration ~20ms (50 blocks per second) for enhanced tempo resolution
    let block_size = (sample_rate / 50).max(1); // 20ms blocks
    let mut energy_envelope = Vec::new();
    
    for chunk in samples.chunks(block_size) {
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

    // 3. Spectral Ratios (Lightweight FFT on a 2048-sample slice in the middle of the track)
    let mut bass_ratio = 0.33;
    let mut treble_ratio = 0.33;
    
    let fft_size = 2048;
    if samples.len() > fft_size + 1000 {
        // Take a slice from the middle of the track
        let mid_index = samples.len() / 2;
        let mut fft_buffer: Vec<Complex<f32>> = samples[mid_index..(mid_index + fft_size)]
            .iter()
            .map(|&s| Complex::new(s, 0.0))
            .collect();
            
        let mut planner = FftPlanner::new();
        let fft = planner.plan_fft_forward(fft_size);
        fft.process(&mut fft_buffer);

        let hz_per_bin = sample_rate as f32 / fft_size as f32;
        
        let mut bass_sum = 0.0;
        let mut mid_sum = 0.0;
        let mut treble_sum = 0.0;
        
        // Loop over the positive frequency bins (first half)
        for i in 0..(fft_size / 2) {
            let freq = i as f32 * hz_per_bin;
            let mag = fft_buffer[i].norm();
            if freq < 250.0 {
                bass_sum += mag;
            } else if freq < 4000.0 {
                mid_sum += mag;
            } else {
                treble_sum += mag;
            }
        }
        
        let total_spectral_sum = bass_sum + mid_sum + treble_sum;
        if total_spectral_sum > 0.0 {
            bass_ratio = (bass_sum / total_spectral_sum) as f64;
            treble_ratio = (treble_sum / total_spectral_sum) as f64;
        }
    }

    // 4. EBU R128 Integrated LUFS & ReplayGain dB Calculation
    let integrated_lufs = calculate_ebu_r128_lufs(samples, sample_rate);
    let lufs_gain_db = (-14.0 - integrated_lufs).clamp(-12.0, 12.0);
    let waveform = calculate_waveform_peaks(samples, 100);

    SonicProfile {
        bpm,
        energy,
        bass_ratio,
        treble_ratio,
        integrated_lufs,
        lufs_gain_db,
        waveform,
    }
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

    #[test]
    fn test_audio_buffer_to_mono_and_interleaved_safety() {
        use symphonia::core::audio::{AudioBuffer, AudioBufferRef, Signal, SignalSpec, Channels};

        let spec_mono = SignalSpec::new(44100, Channels::FRONT_CENTRE);
        let mut mono_buf = AudioBuffer::<f32>::new(50, spec_mono);
        mono_buf.render_reserved(Some(50));
        for i in 0..50 {
            mono_buf.chan_mut(0)[i] = 0.5;
        }
        let buf_ref = AudioBufferRef::F32(std::borrow::Cow::Borrowed(&mono_buf));

        let mono_out = audio_buffer_to_mono_f32(&buf_ref);
        assert_eq!(mono_out.len(), 50);
        assert_eq!(mono_out[0], 0.5);

        let interleaved = audio_buffer_to_interleaved_s16(&buf_ref);
        assert_eq!(interleaved.len(), 50);
        assert_eq!(interleaved[0], 16383);
    }
}

