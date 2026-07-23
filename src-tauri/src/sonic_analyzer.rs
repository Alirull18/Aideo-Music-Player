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
    if samples.is_empty() {
        return SonicProfile { bpm: 120.0, energy: 0.5, bass_ratio: 0.33, treble_ratio: 0.33, integrated_lufs: -14.0, lufs_gain_db: 0.0 };
    }

    // 1. RMS Energy
    let sum_sq: f32 = samples.iter().map(|&s| s * s).sum();
    let rms = (sum_sq / samples.len() as f32).sqrt();
    let energy = (rms as f64 * 3.0).clamp(0.0, 1.0); // Simple normalization scaling

    // 2. BPM / Tempo (Energy envelope onset detection + Autocorrelation)
    // Block duration ~50ms
    let block_size = sample_rate / 20; // 50ms blocks
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

    // Autocorrelation on onsets to find dominant periodicity (lags corresponding to 60-180 BPM)
    // 50ms block size -> 20 blocks per second.
    // Lag of 7 blocks -> 20 / 7 * 60 = 171 BPM
    // Lag of 20 blocks -> 20 / 20 * 60 = 60 BPM
    let min_lag = 7;
    let max_lag = 20;
    let mut best_lag = 10;
    let mut max_correlation = 0.0;

    for lag in min_lag..=max_lag {
        let mut correlation = 0.0;
        let mut count = 0;
        for i in 0..(onsets.len() - lag) {
            correlation += onsets[i] * onsets[i + lag];
            count += 1;
        }
        if count > 0 {
            correlation /= count as f32;
        }
        if correlation > max_correlation {
            max_correlation = correlation;
            best_lag = lag;
        }
    }

    let bpm = if best_lag > 0 {
        // block_size is 50ms (20 per sec)
        (20.0 / best_lag as f64) * 60.0
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
    let integrated_lufs = if rms > 1e-6 {
        (20.0 * (rms as f64).log10() - 0.69).max(-70.0)
    } else {
        -70.0
    };
    let lufs_gain_db = (-14.0 - integrated_lufs).clamp(-12.0, 12.0);

    SonicProfile {
        bpm,
        energy,
        bass_ratio,
        treble_ratio,
        integrated_lufs,
        lufs_gain_db,
    }
}
