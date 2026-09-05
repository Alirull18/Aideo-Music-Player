#[cfg(test)]
mod dsp_tests {
    use crate::player::{AideoFilterNode, AudioNode, BiquadFilter, CircularDelayLine, ConvolutionFilter, DSPState, LookaheadLimiter};
    use crate::player::mix_output_channel_sample;

    /// Deterministic xorshift for reproducible test signals.
    struct XorShift(u32);
    impl XorShift {
        fn next_f32(&mut self) -> f32 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 17;
            self.0 ^= self.0 << 5;
            (self.0 as f32 / 2147483648.0) - 1.0
        }
    }

    /// Naive direct convolution reference used to lock the FFT convolver's
    /// mathematical equivalence.
    fn direct_convolve(input: &[f32], ir: &[f32]) -> Vec<f32> {
        let mut out = vec![0.0f32; input.len()];
        for n in 0..input.len() {
            let mut acc = 0.0f32;
            for (k, &tap) in ir.iter().enumerate() {
                if k > n {
                    break;
                }
                acc += input[n - k] * tap;
            }
            out[n] = acc;
        }
        out
    }

    /// The convolver peak-normalizes loaded IRs; mirror that here so the
    /// reference operates on the same effective filter.
    fn peak_normalize(ir: &[f32]) -> Vec<f32> {
        let max_val = ir.iter().map(|s| s.abs()).fold(0.0f32, f32::max).max(1e-6);
        ir.iter().map(|s| s / max_val).collect()
    }

    #[test]
    fn test_biquad_filter_identity_pass_through() {
        let mut filter = BiquadFilter::new();
        // Default initialized BiquadFilter (gain 0dB peaking) should return sample unmodified
        filter.set_peaking(44100.0, 1000.0, 0.0, 1.0);
        let sample = 0.75f32;
        let processed = filter.process(sample);
        assert!((processed - sample).abs() < 1e-4, "0dB peak filter should pass signal cleanly");
    }

    #[test]
    fn test_biquad_coefficients_slew_smoothly_to_target() {
        let mut filter = BiquadFilter::new();
        filter.set_peaking(44100.0, 1000.0, 12.0, 1.0);

        // A few samples after a parameter change the coefficients must still be
        // mid-slew (not snapped): this is what makes slider drags click-free.
        for _ in 0..10 {
            filter.process(0.0);
        }
        let (current, target) = filter.coeffs_current_and_target();
        let early_distance: f32 =
            (0..5).map(|i| (current[i] - target[i]).abs()).fold(0.0, f32::max);
        assert!(
            early_distance > 1e-4,
            "coefficients must not snap to targets immediately, distance was {}",
            early_distance
        );

        // After several slew time constants they must converge on the target
        // response exactly enough that the steady-state EQ curve is unchanged.
        for _ in 0..8000 {
            filter.process(0.0);
        }
        let (converged, _) = filter.coeffs_current_and_target();
        for i in 0..5 {
            assert!(
                (converged[i] - target[i]).abs() < 1e-3,
                "coefficient {} did not converge: {} vs {}",
                i,
                converged[i],
                target[i]
            );
        }
    }

    #[test]
    fn test_biquad_slew_stays_finite_and_bounded_during_aggressive_change() {
        let mut filter = BiquadFilter::new();
        // Full-scale sine already flowing through the filter when a violent
        // boost lands: slewing must never produce instability or NaN blowups.
        let fs = 44100.0f32;
        let w = 2.0 * std::f32::consts::PI * 440.0 / fs;
        for i in 0..(fs as usize / 2) {
            if i == 100 {
                filter.set_peaking(fs, 60.0, 15.0, 8.0);
            }
            let y = filter.process((w * i as f32).sin());
            assert!(y.is_finite(), "output went non-finite at sample {}", i);
            assert!(y.abs() < 8.0, "output diverged during slew: {}", y);
        }
    }

    #[test]
    fn test_circular_delay_line_samples() {
        let mut delay = CircularDelayLine::new(1024);
        delay.push(1.0);
        delay.push(2.0);
        delay.push(3.0);
        delay.push(4.0);

        assert_eq!(delay.read_delayed(1), 4.0, "Delay of 1 sample yields current pushed sample (4.0)");
        assert_eq!(delay.read_delayed(2), 3.0, "Delay of 2 samples yields previous sample (3.0)");
        assert_eq!(delay.read_delayed(3), 2.0, "Delay of 3 samples yields sample (2.0)");
        assert_eq!(delay.read_delayed(4), 1.0, "Delay of 4 samples yields sample (1.0)");
    }

    #[test]
    fn test_lookahead_limiter_multichannel_no_panic() {
        // Regression: 5.1 file (6 channels) through a limiter built for stereo output
        // previously indexed delay_buffers out of bounds and panicked the player thread.
        let mut limiter = LookaheadLimiter::new(2, 5.0, 48000.0);
        let mut samples = vec![0.5f32; 6];
        limiter.process(&mut samples, -1.0);
        assert_eq!(samples.len(), 6);
        for ch in samples.iter() {
            assert!(ch.is_finite(), "limiter output must stay finite");
        }
    }

    #[test]
    fn test_lookahead_limiter_transparent_below_threshold() {
        // Characterization lock for the O(1) sliding-window-max refactor:
        // sustained material under the threshold must emerge bit-exact after the
        // lookahead delay warms up (unity gain envelope, no padding).
        let lookahead_ms = 5.0f32;
        let sample_rate = 48000.0f32;
        let mut limiter = LookaheadLimiter::new(2, lookahead_ms, sample_rate);
        let warmup = (lookahead_ms * 0.001 * sample_rate).ceil() as usize + 8;
        let total = warmup + 256;
        let mut transparent = true;
        for i in 0..total {
            let mut s = vec![0.25f32, -0.25f32];
            limiter.process(&mut s, 0.0);
            if i >= warmup && (s[0] != 0.25 || s[1] != -0.25) {
                transparent = false;
            }
        }
        assert!(transparent, "limiter must pass sub-threshold signal bit-exact after warmup");
    }

    #[test]
    fn test_lookahead_limiter_bounded_and_finite_on_dynamic_material() {
        // Guards the sliding-window peak tracker against index/NaN regressions
        // on constantly changing dynamics (the case brute-force scanning hid).
        struct XorShift(u32);
        impl XorShift {
            fn next(&mut self) -> u32 {
                self.0 ^= self.0 << 13;
                self.0 ^= self.0 >> 17;
                self.0 ^= self.0 << 5;
                self.0
            }
        }
        let mut rng = XorShift(0x12345678);
        let mut limiter = LookaheadLimiter::new(2, 5.0, 44100.0);
        for _ in 0..20000 {
            let level = match rng.next() % 4 {
                0 => 0.05f32,
                1 => 0.3f32,
                2 => 0.9f32,
                _ => 1.5f32,
            };
            let mut s = vec![level, -level * 0.8];
            limiter.process(&mut s, -0.1);
            assert!(s[0].is_finite() && s[1].is_finite(), "limiter output must stay finite");
            assert!(s[0].abs() < 1.6 && s[1].abs() < 1.6, "limiter output must stay bounded");
        }
    }

    #[test]
    fn test_limiter_node_engaged_is_unity_when_signal_below_threshold() {
        use crate::player::{AudioNode, DSPState, LimiterNode};
        let mut node = LimiterNode::new(2, 2.0, 48000.0);
        let dsp = DSPState {
            enabled: true,
            ..DSPState::default()
        };
        node.update_params(&dsp, 48000.0);

        // With DSP enabled the chain previously applied a fixed 0.95 pad even
        // when the limiter never engages. Sub-threshold material must come out
        // bit-exact (after the 2ms lookahead warmup) instead.
        let warmup = 96 + 16; // 2ms lookahead @48kHz + margin
        let total = warmup + 64;
        let mut s = vec![vec![0.5f32; total], vec![-0.5f32; total]];
        node.process(&mut s, 48000.0);
        let unity = s[0][total - 1] == 0.5 && s[1][total - 1] == -0.5;
        assert!(unity, "engaged limiter must not pad the level when it never limits");
    }

    #[test]
    fn test_lookahead_limiter_limits_overscale() {
        let mut limiter = LookaheadLimiter::new(2, 5.0, 48000.0);
        // Feed sustained +6dBFS material. This is a soft limiter with exponential
        // attack: gain converges toward threshold/peak, so output approaches 1.0
        // from above but stays near unity-scale rather than passing 2.0 through.
        for _ in 0..1000 {
            let mut samples = vec![2.0f32, -2.0f32];
            limiter.process(&mut samples, 0.0);
        }
        let mut samples = vec![2.0f32, -2.0f32];
        limiter.process(&mut samples, 0.0);
        assert!(
            samples.iter().all(|s| s.abs() < 1.1),
            "limiter must attenuate overscale input toward unity, got {:?}",
            samples
        );
    }

    #[test]
    fn test_preamp_node_applies_replaygain_when_r128_enabled() {
        use crate::player::{AudioNode, DSPState, PreampNode};
        let mut preamp = PreampNode::new();
        let dsp = DSPState {
            enabled: true,
            r128_enabled: true,
            track_replaygain_gain: -6.0,
            ..DSPState::default()
        };

        preamp.update_params(&dsp, 44100.0);
        let mut samples = vec![vec![1.0f32; 4]];
        preamp.process(&mut samples, 44100.0);

        let expected = 10.0f32.powf(-6.0 / 20.0);
        assert!((samples[0][0] - expected).abs() < 1e-4, "Expected ~0.5012, got {}", samples[0][0]);
    }

    #[test]
    fn test_biquad_filter_safe_under_zero_or_low_sample_rate() {
        let mut filter = BiquadFilter::new();
        // Zero and sub-20Hz sample rates must not panic or divide by zero
        filter.set_peaking(0.0, 1000.0, 3.0, 1.0);
        assert!(filter.process(0.5).is_finite());

        filter.set_lowshelf(10.0, 50.0, 6.0, 0.707);
        assert!(filter.process(0.5).is_finite());

        filter.set_highshelf(20.0, 10000.0, -3.0, 0.707);
        assert!(filter.process(0.5).is_finite());

        filter.set_highpass(5.0, 200.0, 1.0);
        assert!(filter.process(0.5).is_finite());

        filter.set_lowpass(15.0, 500.0, 1.0);
        assert!(filter.process(0.5).is_finite());
    }

    #[test]
    fn test_spatializer_node_preserves_stereo_separation_at_zero_wet() {
        use crate::player::{AudioNode, DSPState, SpatializerNode};
        let mut spatializer = SpatializerNode::new();
        let dsp = DSPState {
            enabled: true,
            spatial_enabled: true,
            spatial_wet: 0.0,
            ..DSPState::default()
        };

        spatializer.update_params(&dsp, 44100.0);
        // Feed pure hard-panned stereo: Left = 1.0, Right = 0.0
        let mut samples = vec![vec![1.0f32; 128], vec![0.0f32; 128]];
        spatializer.process(&mut samples, 44100.0);

        // At wet = 0.0, Right channel must remain 0.0 (no collapse to mono)
        assert_eq!(samples[0][0], 1.0, "Left channel should remain 1.0 at wet 0.0");
        assert_eq!(samples[1][0], 0.0, "Right channel should remain 0.0 at wet 0.0");
    }

    #[test]
    fn test_normalizer_node_noise_gate_preserves_unity_gain_during_silence() {
        use crate::player::{AudioNode, DSPState, NormalizerNode};
        let mut normalizer = NormalizerNode::new();
        let dsp = DSPState {
            enabled: true,
            r128_enabled: true,
            ..DSPState::default()
        };

        normalizer.update_params(&dsp, 44100.0);
        // Feed 1 second of pure silence
        let mut silent_samples = vec![vec![0.0f32; 44100], vec![0.0f32; 44100]];
        normalizer.process(&mut silent_samples, 44100.0);

        // Feed first transient after silence
        let mut transient = vec![vec![0.5f32; 1], vec![0.5f32; 1]];
        normalizer.process(&mut transient, 44100.0);

        // Transient must not be boosted by +6dB (2.0x) due to noise gate
        assert!(
            transient[0][0] <= 0.55,
            "Transient after silence should not be amplified excessively (expected <= 0.55, got {})",
            transient[0][0]
        );
    }

    #[test]
    fn test_normalizer_bypasses_track_with_replaygain_tag() {
        use crate::player::{AudioNode, DSPState, NormalizerNode};
        let mut normalizer = NormalizerNode::new();
        let dsp = DSPState {
            enabled: true,
            r128_enabled: true,
            track_replaygain_gain: -6.0,
            ..DSPState::default()
        };

        normalizer.update_params(&dsp, 44100.0);

        // Single-path loudness rule: when a static ReplayGain tag exists it is
        // applied once by PreampNode, so the dynamic AGC must stay out of the
        // signal path entirely (no pumping on top of the tag).
        let mut samples = vec![vec![0.9f32; 48000], vec![0.9f32; 48000]];
        normalizer.process(&mut samples, 44100.0);

        assert_eq!(samples[0][0], 0.9, "Tagged track first sample must pass through untouched");
        assert_eq!(
            samples[0][47999],
            0.9,
            "Tagged track last sample must pass through untouched (AGC must not ramp in)"
        );
    }

    #[test]
    fn test_normalizer_still_engages_for_untagged_track() {
        use crate::player::{AudioNode, DSPState, NormalizerNode};
        let mut normalizer = NormalizerNode::new();
        let dsp = DSPState {
            enabled: true,
            r128_enabled: true,
            track_replaygain_gain: 0.0,
            ..DSPState::default()
        };

        normalizer.update_params(&dsp, 44100.0);

        // Untagged quiet material (-26 dBFS-ish) must still be pulled up toward
        // -14 LUFS by the AGC — the single-path rule only disables the AGC when
        // a real tag provides the gain.
        let mut samples = vec![vec![0.05f32; 44100 * 3], vec![0.05f32; 44100 * 3]];
        normalizer.process(&mut samples, 44100.0);

        assert!(
            samples[0][44100 * 3 - 1] > 0.09,
            "Untagged quiet track should be amplified toward target loudness, got {}",
            samples[0][44100 * 3 - 1]
        );
    }

    #[test]
    fn test_resampler_bridges_44100_to_48000_without_distortion_or_nans() {
        use rubato::{Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction};
        let chunk_size = 1024;
        let mut resampler = SincFixedIn::<f32>::new(
            48000.0 / 44100.0,
            2.0,
            SincInterpolationParameters {
                sinc_len: 64,
                f_cutoff: 0.96,
                interpolation: SincInterpolationType::Cubic,
                oversampling_factor: 128,
                window: WindowFunction::BlackmanHarris2,
            },
            chunk_size,
            2,
        ).expect("Resampler initialization from 44.1kHz to 48kHz must succeed");

        let input = vec![vec![0.5f32; chunk_size], vec![-0.5f32; chunk_size]];
        let output = resampler.process(&input, None).expect("Resampling process must succeed");
        assert_eq!(output.len(), 2);
        assert!(!output[0].is_empty());
        for sample in &output[0] {
            assert!(sample.is_finite() && !sample.is_nan());
            assert!(sample.abs() <= 1.0);
        }
    }

    #[test]
    fn test_resampler_bridges_44100_to_96000_high_res() {
        use rubato::{Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction};
        let chunk_size = 1024;
        let mut resampler = SincFixedIn::<f32>::new(
            96000.0 / 44100.0,
            2.0,
            SincInterpolationParameters {
                sinc_len: 128,
                f_cutoff: 0.985,
                interpolation: SincInterpolationType::Cubic,
                oversampling_factor: 256,
                window: WindowFunction::BlackmanHarris2,
            },
            chunk_size,
            2,
        ).expect("Resampler initialization from 44.1kHz to 96kHz must succeed");

        let input = vec![vec![0.25f32; chunk_size], vec![0.75f32; chunk_size]];
        let output = resampler.process(&input, None).expect("Resampling process must succeed");
        assert_eq!(output.len(), 2);
        assert!(!output[0].is_empty());
        for sample in &output[0] {
            assert!(sample.is_finite() && !sample.is_nan());
        }
    }

    const CONV_PARTITION: usize = 256;

    #[test]
    fn test_convolution_matches_direct_form_reference_at_partition_latency() {
        let mut ir_rng = XorShift(0xDEADBEEF);
        let mut in_rng = XorShift(0xCAFEBABE);
        let ir: Vec<f32> = (0..300).map(|_| ir_rng.next_f32() * 0.1).collect();
        let input: Vec<f32> = (0..4096).map(|_| in_rng.next_f32() * 0.5).collect();

        let reference = direct_convolve(&input, &peak_normalize(&ir));

        let mut conv = ConvolutionFilter::new();
        conv.wet = 1.0;
        conv.enabled = true;
        conv.load_ir_samples(ir.clone());

        // System latency is exactly one partition: dry and wet are aligned
        // together, so the output is the full linear convolution delayed by P.
        let mut worst = 0.0f32;
        for (n, &x) in input.iter().enumerate() {
            let y = conv.process(x);
            if n >= CONV_PARTITION {
                let expected = reference[n - CONV_PARTITION];
                worst = worst.max((y - expected).abs());
            }
            assert!(y.is_finite(), "convolver went non-finite at {}", n);
        }
        assert!(
            worst < 5e-3,
            "FFT convolution diverged from direct-form reference, max error {}",
            worst
        );
    }

    #[test]
    fn test_convolution_wet_dry_mix_paths_stay_aligned() {
        let mut ir_rng = XorShift(0x1512_0007);
        let mut in_rng = XorShift(0x55AA55AA);
        let ir: Vec<f32> = (0..128).map(|_| ir_rng.next_f32() * 0.2).collect();
        let input: Vec<f32> = (0..2048).map(|_| in_rng.next_f32() * 0.6).collect();

        let reference = direct_convolve(&input, &peak_normalize(&ir));

        let mut conv = ConvolutionFilter::new();
        conv.wet = 0.25;
        conv.enabled = true;
        conv.load_ir_samples(ir.clone());

        let mut worst = 0.0f32;
        let mut worst_n = 0usize;
        for (n, &x) in input.iter().enumerate() {
            let y = conv.process(x);
            if n >= CONV_PARTITION {
                let expected = 0.75 * input[n - CONV_PARTITION] + 0.25 * reference[n - CONV_PARTITION];
                let err = (y - expected).abs();
                if err > worst {
                    worst = err;
                    worst_n = n;
                }
            }
            assert!(y.is_finite());
        }
        assert!(
            worst < 5e-3,
            "wet/dry paths misaligned at n={}, max error {}",
            worst_n,
            worst
        );
    }

    #[test]
    fn test_convolution_passthrough_when_disabled_or_empty() {
        let mut conv = ConvolutionFilter::new();
        conv.enabled = false;
        conv.wet = 0.5;
        conv.load_ir_samples(vec![1.0, 0.5, 0.25]);
        // Disabled with a loaded IR must bypass immediately (no latency).
        assert_eq!(conv.process(0.42), 0.42);

        conv.enabled = true;
        conv.load_ir_samples(Vec::new());
        // Enabled but empty IR must also bypass immediately.
        assert_eq!(conv.process(0.42), 0.42);
    }

    #[test]
    fn test_convolution_loads_long_ir_beyond_legacy_cap() {
        // Regression for the silent 4096-tap truncation: a tap far beyond the
        // old cap must still be applied to the signal.
        let tap_pos = 8000;
        let mut ir = vec![0.0f32; 8192];
        ir[tap_pos] = 1.0;
        ir[0] = 1.0; // peak normalization reference

        let mut conv = ConvolutionFilter::new();
        conv.wet = 1.0;
        conv.enabled = true;
        conv.load_ir_samples(ir);

        // Feed an impulse: output must contain BOTH taps at their delayed
        // positions (partition latency + tap offset).
        let mut got_first = false;
        let mut got_late_tap = false;
        for n in 0..(CONV_PARTITION + tap_pos + 64) {
            let y = if n == 0 { 1.0 } else { 0.0 };
            let out = conv.process(y);
            if n >= CONV_PARTITION && (out - 1.0).abs() < 1e-3 {
                got_first = true;
            }
            if n >= CONV_PARTITION + tap_pos && (out - 1.0).abs() < 1e-3 {
                got_late_tap = true;
            }
        }
        assert!(got_first, "IR head tap missing from output");
        assert!(
            got_late_tap,
            "IR tap at position {} was dropped (legacy truncation regression)",
            tap_pos
        );
    }

    #[test]
    fn test_mono_source_is_duplicated_to_all_output_channels() {
        // Regression: mono files must not play hard-left on stereo hardware.
        let planar = vec![vec![0.1, 0.5, -0.3]];
        assert_eq!(mix_output_channel_sample(&planar, 0, 0, 1), 0.1);
        assert_eq!(mix_output_channel_sample(&planar, 1, 1, 1), 0.5);
        assert_eq!(mix_output_channel_sample(&planar, 2, 3, 1), -0.3);
    }

    #[test]
    fn test_multichannel_sources_keep_mapping_and_pad_silence() {
        let planar = vec![vec![0.25], vec![-0.75]];
        assert_eq!(mix_output_channel_sample(&planar, 0, 0, 2), 0.25);
        assert_eq!(mix_output_channel_sample(&planar, 0, 1, 2), -0.75);
        // Stereo file into a 4-channel device: extra outputs stay silent.
        assert_eq!(mix_output_channel_sample(&planar, 0, 2, 2), 0.0);
        assert_eq!(mix_output_channel_sample(&planar, 0, 3, 2), 0.0);
    }

    #[test]
    fn test_mix_helper_returns_silence_on_empty_planes_or_short_frames() {
        let empty: Vec<Vec<f32>> = Vec::new();
        assert_eq!(mix_output_channel_sample(&empty, 0, 0, 2), 0.0);
        let short = vec![vec![0.5]];
        assert_eq!(mix_output_channel_sample(&short, 5, 0, 2), 0.0);
    }

    #[test]
    fn test_aideo_filter_node_disabled_is_passthrough() {
        let mut node = AideoFilterNode::new();
        let mut dsp = DSPState::default();
        dsp.enabled = false;
        dsp.aideo_filter_enabled = true;
        node.update_params(&dsp, 48000.0);

        let mut samples = vec![vec![0.5, -0.5, 0.25], vec![0.3, -0.3, 0.15]];
        let original = samples.clone();
        node.process(&mut samples, 48000.0);
        assert_eq!(samples, original);
    }

    #[test]
    fn test_aideo_filter_node_warmth_boost_active() {
        let mut node = AideoFilterNode::new();
        let mut dsp = DSPState::default();
        dsp.enabled = true;
        dsp.aideo_filter_enabled = true;
        dsp.aideo_filter_bass_thump = 6.0;
        dsp.aideo_filter_room_size = 0.0;
        node.update_params(&dsp, 48000.0);

        // Low frequency test (50Hz wave at 48kHz: 4800 samples = 100ms / 5 cycles)
        let sample_rate = 48000.0f32;
        let total_samples = 4800;
        let mut left = Vec::with_capacity(total_samples);
        let mut right = Vec::with_capacity(total_samples);
        for n in 0..total_samples {
            let s = (2.0 * std::f32::consts::PI * 50.0 * (n as f32) / sample_rate).sin() * 0.1;
            left.push(s);
            right.push(s);
        }
        let mut samples = vec![left, right];
        node.process(&mut samples, sample_rate);

        // Output peak in the second half (after filter coefficient slew warmup) should be boosted
        let max_out = samples[0][2400..].iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        assert!(max_out > 0.12, "Aideo Filter warmth must boost low frequency energy (got steady-state peak {})", max_out);
    }

    #[test]
    fn test_aideo_filter_node_room_reflection_generates_ambience() {
        let mut node = AideoFilterNode::new();
        let mut dsp = DSPState::default();
        dsp.enabled = true;
        dsp.aideo_filter_enabled = true;
        dsp.aideo_filter_bass_thump = 0.0;
        dsp.aideo_filter_room_size = 0.8;
        dsp.aideo_filter_dampening = 0.3;
        node.update_params(&dsp, 48000.0);

        // Send an impulse to the left channel only (right channel is zero)
        let mut left = vec![0.0f32; 4800];
        let right = vec![0.0f32; 4800];
        left[0] = 1.0;

        let mut samples = vec![left, right];
        node.process(&mut samples, 48000.0);

        // Right channel should receive room reflections from the left impulse
        let right_energy: f32 = samples[1].iter().map(|s| s.abs()).sum();
        assert!(right_energy > 0.01, "Room reflections must generate cross-channel ambient energy");
    }

    #[test]
    fn test_dsp_state_deserialization_from_frontend_json() {
        let frontend_json = r#"{
            "enabled": true,
            "low_spec_mode": false,
            "audio_profile": "normal",
            "resampler_interpolation": "linear",
            "resampler_sinc_len": 128,
            "resampler_oversampling": 256,
            "ffmpeg_transcode_quality": "native",
            "width": 1.0,
            "upsample_rate": 0,
            "dither": false,
            "exclusive_mode_timing": "event",
            "preamp_gain": 0.0,
            "limiter_threshold": -0.1,
            "resampler_phase_mode": "linear",
            "eq_enabled": true,
            "eq_parametric": false,
            "eq_graphic_gains": [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            "eq_parametric_bands": [],
            "crossfeed_enabled": false,
            "crossfeed_level": -6.0,
            "crossfeed_corner": 700.0,
            "spatial_enabled": false,
            "spatial_haas_delay": 7.5,
            "spatial_wet": 0.15,
            "convolution_enabled": false,
            "convolution_ir_path": "",
            "convolution_wet": 0.5,
            "subsonic_enabled": false,
            "night_mode_enabled": false,
            "r128_enabled": false,
            "aideo_filter_enabled": false,
            "aideo_filter_room_size": 0.85,
            "aideo_filter_bass_thump": 6.0,
            "aideo_filter_dampening": 0.5,
            "auto_headroom": false,
            "saturation_enabled": false,
            "saturation_drive": 0.0,
            "crossfade_transition_enabled": true,
            "crossfade_transition_duration": 3.0,
            "stream_engine": "auto",
            "lookahead_prebuffer_enabled": true
        }"#;

        let res: Result<DSPState, _> = serde_json::from_str(frontend_json);
        assert!(res.is_ok(), "Frontend JSON must deserialize successfully into DSPState, error: {:?}", res.err());
        let dsp = res.unwrap();
        assert!(dsp.enabled);
        assert!(dsp.eq_enabled);
        assert_eq!(dsp.track_replaygain_gain, 0.0);
        assert_eq!(dsp.playback_rate, 1.0);
    }

    #[test]
    fn test_ringbuffer_wraparound_push_slice_no_sample_loss() {
        use ringbuf::RingBuffer;

        let rb = RingBuffer::<f32>::new(100);
        let (mut prod, mut cons) = rb.split();

        // 1. Advance write pointer close to end of circular buffer
        let dummy = vec![1.0f32; 80];
        let p = prod.push_slice(&dummy);
        assert_eq!(p, 80);
        let mut out_dummy = vec![0.0f32; 80];
        let c = cons.pop_slice(&mut out_dummy);
        assert_eq!(c, 80);

        // RingBuffer internal head/tail are now at 80.
        // There are 20 slots left until physical vector end, and 80 slots after wrap.
        // Pushing a 50-element chunk with multi-pass logic MUST push all 50 samples without dropping!
        let chunk: Vec<f32> = (0..50).map(|i| i as f32).collect();
        let mut pushed = prod.push_slice(&chunk);

        // Multi-pass push completes the remaining samples
        while pushed < chunk.len() {
            let n = prod.push_slice(&chunk[pushed..]);
            if n > 0 {
                pushed += n;
            }
        }
        assert_eq!(pushed, 50, "All 50 samples must be written across wrap boundary");

        // Consumer reads all 50 samples with multi-pass pop
        let mut received = vec![0.0f32; 50];
        let mut popped = cons.pop_slice(&mut received);
        while popped < 50 {
            let n = cons.pop_slice(&mut received[popped..]);
            if n > 0 {
                popped += n;
            }
        }
        assert_eq!(popped, 50);
        assert_eq!(received, chunk, "Samples across circular boundary must match input perfectly");
    }

    #[test]
    fn test_stream_prebuffer_watermark_condition() {
        use crate::player::is_stream_prebuffer_ready;
        // 2 seconds @ 44.1kHz = 88200 frames
        let watermark = 88200;

        // Insufficient buffer and not complete -> Not ready
        assert!(!is_stream_prebuffer_ready(1000, watermark, false));

        // Reached watermark -> Ready even if download still ongoing
        assert!(is_stream_prebuffer_ready(88200, watermark, false));
        assert!(is_stream_prebuffer_ready(100000, watermark, false));

        // Short track completed before watermark -> Ready
        assert!(is_stream_prebuffer_ready(40000, watermark, true));
    }

    #[test]
    fn test_bit_perfect_rules() {
        use crate::player::{should_bypass_dsp_for_bit_perfect, resolve_stream_volume, resolve_hardware_upsample_and_dither};

        // 1. DSP Bypass Rule: Bit-Perfect ALWAYS forces bypass, even if DSP is enabled
        assert!(should_bypass_dsp_for_bit_perfect(true, true));
        assert!(should_bypass_dsp_for_bit_perfect(true, false));
        assert!(!should_bypass_dsp_for_bit_perfect(false, true)); // Run DSP when BP off and DSP on
        assert!(should_bypass_dsp_for_bit_perfect(false, false));

        // 2. Volume Rule: Bit-Perfect locks volume to 1.0 (unity gain) when not paused
        assert_eq!(resolve_stream_volume(true, false, 0.45), 1.0);
        assert_eq!(resolve_stream_volume(true, false, 0.0), 1.0);
        assert_eq!(resolve_stream_volume(true, true, 0.45), 0.0); // Paused is silent
        assert_eq!(resolve_stream_volume(false, false, 0.45), 0.45); // Normal volume

        // 3. Upsample & Dither: Bit-Perfect disables upsampling and dither
        let (upsample, dither) = resolve_hardware_upsample_and_dither(true, 192000, true);
        assert_eq!(upsample, 0);
        assert!(!dither);

        let (upsample, dither) = resolve_hardware_upsample_and_dither(false, 192000, true);
        assert_eq!(upsample, 192000);
        assert!(dither);

        // 4. Rate Mismatch Rule: When rates differ, audio is resampled so is_bp is false;
        // user DSP remains active instead of being suppressed.
        let bp_pref = true;
        let file_rate = 96000;
        let dev_rate = 44100;
        let file_ch = 2;
        let dev_ch = 2;
        let is_bp = bp_pref && file_rate == dev_rate && file_ch == dev_ch;
        assert!(!is_bp);
        assert!(!should_bypass_dsp_for_bit_perfect(is_bp, true));
    }

    #[test]
    fn test_can_reuse_stream_session() {
        use crate::player::can_reuse_stream_session;

        let dev_a = Some("DAC-1".to_string());
        let dev_b = Some("DAC-2".to_string());

        // 1. Shared mode reuses session when rates match, but rejects reuse across different rates to avoid broken forced resampling
        assert!(can_reuse_stream_session(&dev_a, false, 44100, 2, &dev_a, false, 44100, 2, 0));
        assert!(can_reuse_stream_session(&dev_a, false, 48000, 2, &dev_a, false, 48000, 2, 0));
        assert!(!can_reuse_stream_session(&dev_a, false, 48000, 2, &dev_a, false, 44100, 2, 0));
        assert!(!can_reuse_stream_session(&dev_a, false, 48000, 2, &dev_a, false, 96000, 2, 0));

        // 2. Exclusive mode reuses session when rates and channels match
        assert!(can_reuse_stream_session(&dev_a, true, 44100, 2, &dev_a, true, 44100, 2, 0));
        assert!(can_reuse_stream_session(&dev_a, true, 96000, 2, &dev_a, true, 96000, 2, 0));

        // 3. Exclusive mode rejects session when track rates differ (requires DAC clock reset)
        assert!(!can_reuse_stream_session(&dev_a, true, 44100, 2, &dev_a, true, 96000, 2, 0));
        assert!(!can_reuse_stream_session(&dev_a, true, 96000, 2, &dev_a, true, 44100, 2, 0));

        // 4. Exclusive mode rejects session when channel counts differ (e.g. 2ch vs 6ch surround)
        assert!(!can_reuse_stream_session(&dev_a, true, 44100, 2, &dev_a, true, 44100, 6, 0));
        assert!(!can_reuse_stream_session(&dev_a, true, 44100, 6, &dev_a, true, 44100, 2, 0));

        // 5. Mode mismatch (shared vs exclusive) rejects session
        assert!(!can_reuse_stream_session(&dev_a, false, 44100, 2, &dev_a, true, 44100, 2, 0));
        assert!(!can_reuse_stream_session(&dev_a, true, 44100, 2, &dev_a, false, 44100, 2, 0));

        // 6. Device change rejects session
        assert!(!can_reuse_stream_session(&dev_a, false, 48000, 2, &dev_b, false, 48000, 2, 0));

        // 7. Upsampling target in exclusive mode
        assert!(can_reuse_stream_session(&dev_a, true, 96000, 2, &dev_a, true, 44100, 2, 96000));
        assert!(!can_reuse_stream_session(&dev_a, true, 44100, 2, &dev_a, true, 44100, 2, 96000));
    }

    #[test]
    fn test_exclusive_mode_turn_off_rules() {
        use crate::player::{can_reuse_stream_session, evaluate_audio_path, AudioFormatSnapshot, AudioRouteSnapshot, DSPState};

        let dev = Some("Test DAC".to_string());

        // 1. When exclusive mode was active (true) and is turned off (false), session reuse MUST be rejected
        assert!(!can_reuse_stream_session(&dev, true, 44100, 2, &dev, false, 44100, 2, 0));

        // 2. Shared route cannot be bit-perfect even if bit-perfect was requested
        let shared_route = AudioRouteSnapshot {
            active: true,
            engine: "cpal".to_string(),
            share_mode: "shared".to_string(),
            source: AudioFormatSnapshot {
                sample_rate: 44100,
                channels: 2,
                sample_format: Some("pcm_s16".to_string()),
                bits_per_sample: Some(16),
                valid_bits_per_sample: Some(16),
                channel_mask: Some(3),
            },
            pipeline_sample_format: "pcm_f32".to_string(),
            output: AudioFormatSnapshot {
                sample_rate: 48000,
                channels: 2,
                sample_format: Some("pcm_f32".to_string()),
                bits_per_sample: Some(32),
                valid_bits_per_sample: Some(32),
                channel_mask: Some(3),
            },
            fallback_reason: None,
            gain_ramp: false,
            volume_bypass_in_bit_perfect: false,
            dither_enabled: false,
            sample_integrity_verified: false,
        };

        // If exclusive mode is turned off, requested_exclusive is false
        let path = evaluate_audio_path(&shared_route, &DSPState::default(), false, false, 1.0, 0);
        assert!(!path.strict_bit_perfect);
        assert_eq!(path.share_mode, "shared");

        // Even if bit-perfect was requested while exclusive is false, it MUST reject bit-perfect
        let path_bp_requested = evaluate_audio_path(&shared_route, &DSPState::default(), false, true, 1.0, 0);
        assert!(!path_bp_requested.strict_bit_perfect);
        assert!(path_bp_requested.strict_failure_reasons.contains(&"shared_output".to_string()));
    }

    #[test]
    fn test_resolve_exclusive_target_rate() {
        use crate::player::resolve_exclusive_target_rate;

        // Native rate pass-through when no upsample target is requested
        assert_eq!(resolve_exclusive_target_rate(44100, 0), 44100);
        assert_eq!(resolve_exclusive_target_rate(48000, 0), 48000);
        assert_eq!(resolve_exclusive_target_rate(88200, 0), 88200);
        assert_eq!(resolve_exclusive_target_rate(96000, 0), 96000);
        assert_eq!(resolve_exclusive_target_rate(192000, 0), 192000);

        // Explicit upsampling target overrides file rate
        assert_eq!(resolve_exclusive_target_rate(44100, 96000), 96000);
        assert_eq!(resolve_exclusive_target_rate(44100, 192000), 192000);
        assert_eq!(resolve_exclusive_target_rate(96000, 192000), 192000);
    }

    #[test]
    fn test_trim_encoder_delay_and_padding() {
        use crate::player::trim_encoder_delay_and_padding;

        // 2-channel buffer with 1000 samples
        let mut samples = vec![
            (0..1000).map(|i| i as f32).collect::<Vec<f32>>(),
            (0..1000).map(|i| i as f32).collect::<Vec<f32>>(),
        ];

        // Trim 100 delay frames (primer) and 50 padding frames
        trim_encoder_delay_and_padding(&mut samples, 100, 50);

        assert_eq!(samples[0].len(), 850);
        assert_eq!(samples[1].len(), 850);
        // First sample should now be what was previously index 100
        assert_eq!(samples[0][0], 100.0);
        assert_eq!(samples[1][0], 100.0);
        // Last sample should now be what was index 949 (1000 - 50 - 1)
        assert_eq!(samples[0][849], 949.0);
        assert_eq!(samples[1][849], 949.0);
    }

    #[test]
    fn test_active_stream_session_manual_change_flush_signal() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;

        let flush_signal = Arc::new(AtomicBool::new(false));

        // When a session is created from a natural queue transition, is_manual_change is false
        let is_manual_change = false;
        if is_manual_change {
            flush_signal.store(true, Ordering::SeqCst);
        }
        assert!(!flush_signal.load(Ordering::SeqCst), "Natural queue transition must not flush the active session");

        // When a session is created from a manual Play command, is_manual_change is true
        let is_manual_change = true;
        if is_manual_change {
            flush_signal.store(true, Ordering::SeqCst);
        }
        assert!(flush_signal.load(Ordering::SeqCst), "Manual track skip must assert flush_signal to drain stale audio");

        // Simulating the audio callback draining the ringbuffer
        assert!(flush_signal.swap(false, Ordering::SeqCst), "Callback should observe and consume the flush signal");
        assert!(!flush_signal.load(Ordering::SeqCst), "Flush signal should be reset for new track playback");
    }

    #[test]
    fn test_ingestion_delay_skipping_prevents_cache_index_shift() {
        use crate::player::trim_encoder_delay_and_padding;

        // Model decoded packets arriving chunk by chunk (e.g. 500 samples per packet)
        let total_frames = 2000;
        let encoder_delay = 100usize;
        let encoder_padding = 50usize;

        let mut remaining_delay = encoder_delay;
        let mut samples: Vec<Vec<f32>> = vec![Vec::new(), Vec::new()];

        let raw_stream: Vec<f32> = (0..total_frames).map(|i| i as f32).collect();

        // Simulate chunk ingestion with front-skipping
        for chunk in raw_stream.chunks(500) {
            let n_frames = chunk.len();
            let skip_frames = if remaining_delay > 0 {
                let skip = remaining_delay.min(n_frames);
                remaining_delay -= skip;
                skip
            } else {
                0
            };

            if skip_frames < n_frames {
                for ch in 0..2 {
                    samples[ch].extend_from_slice(&chunk[skip_frames..]);
                }
            }
        }

        // Reader starts consuming at ram_cursor = 0 concurrently
        let mut ram_cursor = 0usize;
        let read_chunk = 200usize;
        let first_read = samples[0][ram_cursor..ram_cursor + read_chunk].to_vec();
        ram_cursor += read_chunk;

        // First sample read by playback was already sample 100.0 (the primer delay was skipped at ingestion!)
        assert_eq!(first_read[0], 100.0);

        // At EOF, only trailing padding is truncated
        if encoder_padding > 0 {
            for ch in samples.iter_mut() {
                let truncate_to = ch.len() - encoder_padding;
                ch.truncate(truncate_to);
            }
        }

        // Verify: ram_cursor is STILL valid! The sample at ram_cursor is exactly sample 300.0 (100 + 200)
        // No drain occurred from index 0, so NO samples were skipped mid-stream!
        assert_eq!(samples[0][ram_cursor], 300.0);
        assert_eq!(samples[0].len(), total_frames - encoder_delay - encoder_padding);

        // Also test robust boundary handling for trim_encoder_delay_and_padding
        let mut empty_buf: Vec<Vec<f32>> = vec![vec![]];
        trim_encoder_delay_and_padding(&mut empty_buf, 1000, 500);
        assert!(empty_buf[0].is_empty());

        let mut short_buf: Vec<Vec<f32>> = vec![vec![1.0, 2.0]];
        trim_encoder_delay_and_padding(&mut short_buf, 5, 5);
        assert!(short_buf[0].is_empty());
    }

    #[test]
    fn test_playback_generation_aborts_stale_worker() {
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::{Arc, Mutex};
        use crate::player::PLAYBACK_GENERATION;

        let _current_process = Arc::new(Mutex::new(None::<std::process::Child>));

        // Track A starts with generation 1
        let gen_a = PLAYBACK_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        let cancel_a = Arc::new(AtomicBool::new(false));

        // User rapidly skips to Track B before Track A finishes
        let cancel_a_clone = Arc::clone(&cancel_a);
        cancel_a_clone.store(true, Ordering::SeqCst);
        let gen_b = PLAYBACK_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        let cancel_b = Arc::new(AtomicBool::new(false));

        assert!(gen_b > gen_a);

        // Worker A attempts to check whether it is valid to touch current_process
        let is_worker_a_valid = !cancel_a.load(Ordering::SeqCst) && PLAYBACK_GENERATION.load(Ordering::SeqCst) == gen_a;
        assert!(!is_worker_a_valid, "Worker A must detect that its generation is obsolete / cancelled");

        // Worker B is the active generation
        let is_worker_b_valid = !cancel_b.load(Ordering::SeqCst) && PLAYBACK_GENERATION.load(Ordering::SeqCst) == gen_b;
        assert!(is_worker_b_valid, "Worker B must be recognized as the valid active generation");
    }

    #[test]
    fn test_dsp_state_sanitize_guards_nan_and_extremes() {
        use crate::player::{DSPState, EQBand};

        let mut dsp = DSPState {
            width: f32::NAN,
            preamp_gain: f32::INFINITY,
            limiter_threshold: -100.0,
            playback_rate: f64::NAN,
            eq_graphic_gains: vec![f32::NAN, 100.0, -100.0],
            eq_parametric_bands: vec![
                EQBand { freq: f32::NAN, gain: f32::INFINITY, q: f32::NAN, band_type: "peaking".to_string() }
            ],
            ..DSPState::default()
        };

        dsp.sanitize();

        assert!(dsp.width.is_finite());
        assert_eq!(dsp.width, 1.0);
        assert!(dsp.preamp_gain.is_finite());
        assert_eq!(dsp.preamp_gain, 0.0);
        assert_eq!(dsp.limiter_threshold, -30.0);
        assert_eq!(dsp.playback_rate, 1.0);

        assert_eq!(dsp.eq_graphic_gains[0], 0.0);
        assert_eq!(dsp.eq_graphic_gains[1], 36.0);
        assert_eq!(dsp.eq_graphic_gains[2], -36.0);

        assert_eq!(dsp.eq_parametric_bands[0].freq, 1000.0);
        assert_eq!(dsp.eq_parametric_bands[0].gain, 0.0);
        assert_eq!(dsp.eq_parametric_bands[0].q, 0.707);
    }

    #[test]
    fn test_biquad_filter_guards_nan_and_extremes() {
        use crate::player::dsp::BiquadFilter;

        let mut filter = BiquadFilter::new();
        // Passing NaN / Inf / Extreme gain should not panic or produce NaN filter output
        filter.set_peaking(44100.0, f32::NAN, f32::INFINITY, f32::NAN);
        let out = filter.process(0.5);
        assert!(out.is_finite());

        filter.set_lowshelf(44100.0, 100.0, 1000.0, 1.0);
        let out2 = filter.process(0.5);
        assert!(out2.is_finite());

        // Feeding NaN input sample directly to filter must not poison it permanently
        let _ = filter.process(f32::NAN);
        let recovered = filter.process(0.5);
        assert!(recovered.is_finite(), "Filter must recover cleanly after receiving a NaN sample");
    }

    #[test]
    fn test_limiter_multichannel_expansion_lookahead_alignment() {
        use crate::player::LookaheadLimiter;

        // Initialize stereo limiter with 5ms lookahead at 48kHz
        let mut limiter = LookaheadLimiter::new(2, 5.0, 48000.0);
        let lookahead_samples = ((5.0f32 * 0.001f32 * 48000.0f32).round() as usize).max(1);

        // Dynamically expand to 6 channels on the first process call
        let mut s = vec![0.5f32; 6];
        limiter.process(&mut s, 0.0);

        // On first frame, all 6 channels must output 0.0 because they are pre-filled with lookahead silence
        for ch in 0..6 {
            assert_eq!(s[ch], 0.0, "Channel {} must output lookahead silence on frame 0", ch);
        }

        // Process up to lookahead_samples frames
        for _ in 1..lookahead_samples {
            let mut frame = vec![0.5f32; 6];
            limiter.process(&mut frame, 0.0);
            for ch in 0..6 {
                assert_eq!(frame[ch], 0.0, "Channel {} must remain in lookahead silence window", ch);
            }
        }

        // At frame lookahead_samples + 1, all channels must exit silence together
        let mut out_frame = vec![0.5f32; 6];
        limiter.process(&mut out_frame, 0.0);
        for ch in 0..6 {
            assert!(
                out_frame[ch] > 0.0,
                "Channel {} must output audio aligned with all other channels at frame lookahead_samples + 1",
                ch
            );
            assert_eq!(
                out_frame[ch],
                out_frame[0],
                "Channel {} must have identical gain/delay alignment to channel 0",
                ch
            );
        }
    }

    #[test]
    fn test_audio_tail_padding_prevents_sample_loss_at_eof() {
        use std::collections::VecDeque;

        let chunk_size = 1024usize;
        let file_ch = 2usize;
        let residual_len = 350usize;

        // Pending buffer with residual frames (< chunk_size)
        let mut pending: Vec<VecDeque<f32>> = vec![
            (0..residual_len).map(|i| i as f32).collect(),
            (0..residual_len).map(|i| (i * 2) as f32).collect(),
        ];

        assert_eq!(pending[0].len(), residual_len);
        assert!(pending[0].len() < chunk_size);

        // Under EOF condition, buffer must be padded up to chunk_size so final frames can be drained
        if !pending[0].is_empty() && pending[0].len() < chunk_size {
            let pad = chunk_size - pending[0].len();
            for ch in 0..file_ch {
                pending[ch].extend(std::iter::repeat(0.0).take(pad));
            }
        }

        assert_eq!(pending[0].len(), chunk_size);
        assert_eq!(pending[1].len(), chunk_size);

        // Verify the original audio frames are completely intact
        for i in 0..residual_len {
            assert_eq!(pending[0][i], i as f32);
            assert_eq!(pending[1][i], (i * 2) as f32);
        }

        // Verify padded tail is silence
        for i in residual_len..chunk_size {
            assert_eq!(pending[0][i], 0.0);
            assert_eq!(pending[1][i], 0.0);
        }
    }

    #[test]
    fn test_downmix_to_stereo_3_0_center_balanced() {
        use crate::player::downmix_to_stereo;

        // 3.0 audio: L = 0.0, R = 0.0, C = 1.0
        let mut planar = vec![
            vec![0.0f32; 100],
            vec![0.0f32; 100],
            vec![1.0f32; 100],
        ];

        downmix_to_stereo(&mut planar, 100);

        // Center must be distributed symmetrically to Left and Right
        assert!(planar[0][0] > 0.0, "Left channel must receive center audio");
        assert!(planar[1][0] > 0.0, "Right channel must receive center audio");
        assert_eq!(
            planar[0][0], planar[1][0],
            "Center channel must be panned equally to Left and Right"
        );
    }

    #[test]
    fn test_downmix_to_stereo_5_1_includes_lfe() {
        use crate::player::downmix_to_stereo;

        // 5.1 audio with only LFE signal (channel 3)
        let mut planar = vec![
            vec![0.0f32; 100], // L
            vec![0.0f32; 100], // R
            vec![0.0f32; 100], // C
            vec![0.8f32; 100], // LFE
            vec![0.0f32; 100], // Ls
            vec![0.0f32; 100], // Rs
        ];

        downmix_to_stereo(&mut planar, 100);

        // LFE must not be dropped
        assert!(planar[0][0] > 0.0, "Left channel must receive LFE audio");
        assert!(planar[1][0] > 0.0, "Right channel must receive LFE audio");
        assert_eq!(
            planar[0][0], planar[1][0],
            "LFE channel must be balanced symmetrically across Left and Right"
        );
    }

    #[test]
    fn test_downmix_to_stereo_7_1_folds_rear_surrounds() {
        use crate::player::downmix_to_stereo;

        // 7.1 audio: only rear surrounds active (ch 6 Rls, ch 7 Rrs)
        let mut planar = vec![
            vec![0.0f32; 100], // 0: L
            vec![0.0f32; 100], // 1: R
            vec![0.0f32; 100], // 2: C
            vec![0.0f32; 100], // 3: LFE
            vec![0.0f32; 100], // 4: Ls
            vec![0.0f32; 100], // 5: Rs
            vec![0.6f32; 100], // 6: Rls
            vec![0.6f32; 100], // 7: Rrs
        ];

        downmix_to_stereo(&mut planar, 100);

        // Rear surrounds must fold into Left and Right respectively
        assert!(planar[0][0] > 0.0, "Left channel must receive rear-left surround audio");
        assert!(planar[1][0] > 0.0, "Right channel must receive rear-right surround audio");
        assert_eq!(
            planar[0][0], planar[1][0],
            "Symmetric rear surrounds must produce balanced stereo output"
        );
    }

    #[test]
    fn test_should_bypass_ram_cache_protects_against_high_res_uncompressed_bloat() {
        use crate::player::should_bypass_ram_cache;

        // 1. Standard 3-minute CD-quality FLAC (50MB compressed, 180s, 44.1kHz, 2ch)
        // Decoded RAM: 180 * 44100 * 2 * 4 = 63.5 MB (< 400MB) -> do NOT bypass
        assert!(!should_bypass_ram_cache(50 * 1024 * 1024, 180.0, 44100, 2));

        // 2. High-res 5-minute 192kHz 6-channel FLAC (100MB compressed, 300s, 192kHz, 6ch)
        // Decoded RAM: 300 * 192000 * 6 * 4 = 1.38 GB (> 400MB) -> MUST bypass to prevent RAM explosion!
        assert!(should_bypass_ram_cache(100 * 1024 * 1024, 300.0, 192000, 6));

        // 3. DXD 384kHz 2-channel track (120MB compressed, 300s, 384kHz, 2ch)
        // Decoded RAM: 300 * 384000 * 2 * 4 = 921 MB (> 400MB) -> MUST bypass
        assert!(should_bypass_ram_cache(120 * 1024 * 1024, 300.0, 384000, 2));

        // 4. Exceeds compressed file limit (>150MB)
        assert!(should_bypass_ram_cache(160 * 1024 * 1024, 120.0, 44100, 2));

        // 5. Exceeds duration limit (>15 mins / 900s)
        assert!(should_bypass_ram_cache(20 * 1024 * 1024, 950.0, 44100, 2));
    }

    #[test]
    fn test_should_bypass_resampler_logic() {
        use crate::player::should_bypass_resampler;

        // Same rate and 1.0x speed -> bypasses resampler
        assert!(should_bypass_resampler(44100, 44100, 1.0));
        assert!(should_bypass_resampler(48000, 48000, 1.0));

        // Same rate BUT speed changed -> must NOT bypass resampler!
        assert!(!should_bypass_resampler(44100, 44100, 1.25));
        assert!(!should_bypass_resampler(44100, 44100, 0.75));
        assert!(!should_bypass_resampler(48000, 48000, 1.5));

        // Different rates -> must NOT bypass resampler
        assert!(!should_bypass_resampler(44100, 48000, 1.0));
        assert!(!should_bypass_resampler(96000, 44100, 1.0));
    }

    #[test]
    fn test_phase_response_node_processes_all_channels() {
        use crate::player::{PhaseResponseNode, AudioNode, DSPState};

        let mut node = PhaseResponseNode::new();
        let dsp = DSPState {
            enabled: true,
            resampler_phase_mode: "minimum".to_string(),
            ..DSPState::default()
        };
        node.update_params(&dsp, 44100.0);

        // 4 identical channels with an impulse
        let mut samples = vec![
            vec![1.0, 0.0, 0.0, 0.0],
            vec![1.0, 0.0, 0.0, 0.0],
            vec![1.0, 0.0, 0.0, 0.0],
            vec![1.0, 0.0, 0.0, 0.0],
        ];

        node.process(&mut samples, 44100.0);

        // All 4 channels must be identical (phase-aligned across all channels)
        for ch in 1..4 {
            for i in 0..4 {
                assert_eq!(
                    samples[ch][i], samples[0][i],
                    "Channel {} sample {} must match channel 0",
                    ch, i
                );
            }
        }
    }

    #[test]
    fn test_convolution_filter_scaled_preserves_stereo_balance() {
        use crate::player::dsp::ConvolutionFilter;

        let mut left_filter = ConvolutionFilter::new();
        let mut right_filter = ConvolutionFilter::new();
        left_filter.enabled = true;
        left_filter.wet = 1.0;
        right_filter.enabled = true;
        right_filter.wet = 1.0;

        let left_ir = vec![1.0f32, 0.0];
        let right_ir = vec![0.25f32, 0.0];

        let max_l = left_ir.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        let max_r = right_ir.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        let global_max = max_l.max(max_r).max(1e-6);

        left_filter.load_ir_samples_scaled(left_ir, global_max);
        right_filter.load_ir_samples_scaled(right_ir, global_max);

        // Process impulse through both
        let mut left_out = Vec::new();
        let mut right_out = Vec::new();

        for i in 0..1024 {
            let input = if i == 0 { 1.0 } else { 0.0 };
            left_out.push(left_filter.process(input));
            right_out.push(right_filter.process(input));
        }

        let max_out_l = left_out.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        let max_out_r = right_out.iter().map(|s| s.abs()).fold(0.0f32, f32::max);

        // Ratio must be approximately 4:1 (within 1%)
        assert!(max_out_l > 0.0);
        assert!(max_out_r > 0.0);
        let ratio = max_out_l / max_out_r;
        assert!(
            (ratio - 4.0).abs() < 0.05,
            "Expected 4:1 ratio between Left and Right outputs, got {}",
            ratio
        );
    }

    #[test]
    fn test_player_command_shutdown_protocol() {
        use crate::player::PlayerCommand;

        let (tx, rx) = std::sync::mpsc::channel::<PlayerCommand>();
        assert!(tx.send(PlayerCommand::Shutdown).is_ok());

        let received = rx.recv().expect("must receive Shutdown command");
        match received {
            PlayerCommand::Shutdown => {
                // Verified: Shutdown variant successfully transmitted
            }
            _ => panic!("Expected PlayerCommand::Shutdown"),
        }
    }

    #[test]
    fn test_find_best_matching_device_name_logic() {
        use crate::player::find_best_matching_device_name;

        let candidates = vec![
            "Realtek High Definition Audio".to_string(),
            "Focusrite Scarlett 2i2 USB".to_string(),
            "FiiO K5 Pro DAC".to_string(),
            "Speakers (Realtek Audio)".to_string(),
        ];

        // 1. Exact match
        assert_eq!(
            find_best_matching_device_name("FiiO K5 Pro DAC", &candidates),
            Some(&"FiiO K5 Pro DAC".to_string())
        );

        // 2. Case-insensitive match
        assert_eq!(
            find_best_matching_device_name("focusrite scarlett 2i2 usb", &candidates),
            Some(&"Focusrite Scarlett 2i2 USB".to_string())
        );

        // 3. Distinctive model tokens
        assert_eq!(
            find_best_matching_device_name("Scarlett 2i2", &candidates),
            Some(&"Focusrite Scarlett 2i2 USB".to_string())
        );

        // 4. Generic word "Speakers" must not randomly hijack "Realtek High Definition Audio"
        // It matches "Speakers (Realtek Audio)" which contains "Speakers"
        assert_eq!(
            find_best_matching_device_name("Speakers", &candidates),
            None // generic single word without distinctive identifier safely rejected from fuzzy hijacking
        );
    }

    #[test]
    fn test_crossfade_failed_prep_restores_queue() {
        use std::collections::VecDeque;

        let mut queue = VecDeque::new();
        queue.push_back("track_2.flac".to_string());
        queue.push_back("track_3.flac".to_string());

        // Simulate crossfade triggering: pop_front
        let popped = queue.pop_front().unwrap();
        assert_eq!(popped, "track_2.flac");

        // Simulate preparation failure: restore to front
        queue.push_front(popped);

        // Verify queue order is completely restored
        assert_eq!(queue.pop_front(), Some("track_2.flac".to_string()));
        assert_eq!(queue.pop_front(), Some("track_3.flac".to_string()));
        assert_eq!(queue.pop_front(), None);
    }

    #[test]
    fn test_background_decode_ffmpeg_args_format() {
        let file_rate: usize = 176400;
        let file_ch: usize = 2;

        let rate_str = file_rate.to_string();
        let ch_str = file_ch.to_string();

        let args = [
            "-probesize", "32768",
            "-analyzeduration", "100000",
            "-i", "sample.dsf",
            "-f", "wav",
            "-acodec", "pcm_s16le",
            "-ar", &rate_str,
            "-ac", &ch_str,
            "-"
        ];

        let ar_idx = args.iter().position(|&x| x == "-ar").unwrap();
        assert_eq!(args[ar_idx + 1], "176400");

        let ac_idx = args.iter().position(|&x| x == "-ac").unwrap();
        assert_eq!(args[ac_idx + 1], "2");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_timer_resolution_guard_windows() {
        use crate::player::TimePeriodGuard;
        let guard = TimePeriodGuard::new();
        assert!(guard.is_active(), "TimePeriodGuard must be active on Windows");
        drop(guard);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn test_windows_audio_thread_guard_activation() {
        use crate::player::WindowsAudioThreadGuard;
        let guard = WindowsAudioThreadGuard::activate();
        // Guard must activate without panic and drop cleanly
        drop(guard);
    }

    #[test]
    fn test_cache_reuse_and_decode_shutdown_safety() {
        use crate::player::{can_reuse_cached_track, should_mark_decode_complete};

        // 1. Same track, already fully decoded into RAM: always reusable
        assert!(can_reuse_cached_track("track_a.flac", "track_a.flac", true, false));
        assert!(can_reuse_cached_track("track_a.flac", "track_a.flac", true, true));

        // 2. Same track, partially decoded, background decoder thread STILL ACTIVE:
        // Must be reused so mode toggles / stream restarts don't abort decoding or truncate buffer!
        assert!(can_reuse_cached_track("track_a.flac", "track_a.flac", false, true));

        // 3. Same track, partially decoded, but background decoder thread was ABORTED:
        // Must NOT be reused (stale truncated buffer), must rebuild cache fresh!
        assert!(!can_reuse_cached_track("track_a.flac", "track_a.flac", false, false));

        // 4. Different tracks: never reusable
        assert!(!can_reuse_cached_track("track_a.flac", "track_b.flac", true, true));
        assert!(!can_reuse_cached_track("track_a.flac", "track_b.flac", false, true));

        // 5. Aborted background decodes must NEVER be marked as complete (prevents false EOF / premature next-track skip)
        assert!(!should_mark_decode_complete(true));
        assert!(should_mark_decode_complete(false));
    }

    #[test]
    fn test_crossfade_disabled_by_default() {
        let dsp = DSPState::default();
        // Crossfade must be disabled by default so songs play naturally to completion
        assert!(!dsp.crossfade_transition_enabled);
    }

    #[test]
    fn test_eof_drain_delay_calculation_converges_to_track_end() {
        let file_rate = 44100usize;
        let dev_rate = 44100usize;
        let dev_ch = 2usize;
        let duration_secs = 180.0f64;
        let total_frames = (duration_secs * file_rate as f64) as usize;
        let ram_cursor = total_frames;

        // 1. At initial EOF before drain, pending is empty, but ringbuffer (prod) is full (e.g. 2.5s of audio)
        let initial_prod_len = (dev_rate as f64 * 2.5 * dev_ch as f64) as usize;
        let p_len = 0.0f64;
        let r_len_initial = initial_prod_len as f64 / dev_ch as f64;
        let delay_initial = (p_len / file_rate as f64) + (r_len_initial / dev_rate as f64);
        let pos_before_drain = (ram_cursor as f64 / file_rate as f64) - delay_initial;
        assert!((pos_before_drain - 177.5).abs() < 1e-4);

        // 2. Midway through drain (1.0s remaining)
        let mid_prod_len = (dev_rate as f64 * 1.0 * dev_ch as f64) as usize;
        let r_len_mid = mid_prod_len as f64 / dev_ch as f64;
        let delay_mid = (p_len / file_rate as f64) + (r_len_mid / dev_rate as f64);
        let pos_mid_drain = (ram_cursor as f64 / file_rate as f64) - delay_mid;
        assert!((pos_mid_drain - 179.0).abs() < 1e-4);

        // 3. Fully drained (0 remaining) - position smoothly converges to 100% of duration
        let drained_prod_len = 0usize;
        let r_len_drained = drained_prod_len as f64 / dev_ch as f64;
        let delay_drained = (p_len / file_rate as f64) + (r_len_drained / dev_rate as f64);
        let pos_after_drain = (ram_cursor as f64 / file_rate as f64) - delay_drained;
        assert_eq!(pos_after_drain, duration_secs);
    }

    #[test]
    fn test_stream_restart_circuit_breaker_retries_with_progressive_backoff() {
        use crate::player::{decide_stream_restart, RestartAction};

        // First failure: retries with 250ms backoff
        assert_eq!(
            decide_stream_restart(0, 1),
            RestartAction::Retry { delay_ms: 250, next_count: 1 }
        );

        // Second failure in rapid succession: retries with 500ms backoff
        assert_eq!(
            decide_stream_restart(1, 1),
            RestartAction::Retry { delay_ms: 500, next_count: 2 }
        );

        // Third failure: retries with 750ms backoff
        assert_eq!(
            decide_stream_restart(2, 2),
            RestartAction::Retry { delay_ms: 750, next_count: 3 }
        );

        // Exceeded limit (4th attempt): circuit breaker halts to protect system and audio drivers
        assert_eq!(
            decide_stream_restart(3, 1),
            RestartAction::Halt
        );
    }

    #[test]
    fn test_stream_restart_circuit_breaker_resets_after_grace_period() {
        use crate::player::{decide_stream_restart, RestartAction};

        // If a failure happens after the 5s grace period, count resets back to 1
        assert_eq!(
            decide_stream_restart(3, 6),
            RestartAction::Retry { delay_ms: 250, next_count: 1 }
        );
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_windows_audio_thread_guard_restores_thread_priority() {
        use crate::player::WindowsAudioThreadGuard;

        unsafe {
            let initial_priority = windows::Win32::System::Threading::GetThreadPriority(
                windows::Win32::System::Threading::GetCurrentThread(),
            );

            let guard = WindowsAudioThreadGuard::activate();
            // While active, priority is elevated (either TIME_CRITICAL or MMCSS Audio profile level >= HIGHEST)
            let elevated_priority = windows::Win32::System::Threading::GetThreadPriority(
                windows::Win32::System::Threading::GetCurrentThread(),
            );
            assert!(elevated_priority >= windows::Win32::System::Threading::THREAD_PRIORITY_HIGHEST.0);

            drop(guard);

            // After drop, priority must be restored to its initial level to prevent system starvation
            let restored_priority = windows::Win32::System::Threading::GetThreadPriority(
                windows::Win32::System::Threading::GetCurrentThread(),
            );
            assert_eq!(restored_priority, initial_priority);
        }
    }

    #[test]
    fn test_build_ffmpeg_decoder_args_tidal_seeking() {
        use crate::player::build_ffmpeg_decoder_args;

        let tidal_url = "https://sp-play.tidal.com/stream/mock_track_12345.flac?token=abc";
        let start_pos = 206.505;
        let use_ffmpeg_seek = true;
        let is_stream = true;
        let is_youtube_stream = false;
        let quality = "native";
        let is_dsd = false;

        let args = build_ffmpeg_decoder_args(
            tidal_url,
            start_pos,
            use_ffmpeg_seek,
            is_stream,
            is_youtube_stream,
            quality,
            is_dsd,
        );

        // 1. For piped streams, -ss MUST be placed AFTER -i pipe: so FFmpeg uses decoder-level seeking
        // instead of attempting demuxer seeking on non-seekable standard input (which causes "could not seek to position")
        let ss_idx = args.iter().position(|x| x == "-ss").expect("Must contain -ss");
        let i_idx = args.iter().position(|x| x == "-i").expect("Must contain -i");
        assert!(i_idx < ss_idx, "-ss must succeed -i for piped streams to avoid unseekable pipe demux errors");
        assert_eq!(args[ss_idx + 1], "206.505");

        // 2. The input target MUST be pipe: because Aideo's audio-only FFmpeg build uses stdin piping
        assert_eq!(args[i_idx + 1], "pipe:", "Stream input must be pipe:");

        // 3. Must NEVER pass -user_agent, -protocol_whitelist, or -reconnect to FFmpeg (not supported in audio-only build)
        assert!(!args.contains(&"-user_agent".to_string()), "Must not contain -user_agent");
        assert!(!args.contains(&"-protocol_whitelist".to_string()), "Must not contain -protocol_whitelist");
        assert!(!args.contains(&"-reconnect".to_string()), "Must not contain -reconnect");
    }

    #[test]
    fn test_build_ffmpeg_decoder_args_subsonic_injected_seek() {
        use crate::player::build_ffmpeg_decoder_args;

        let subsonic_url = "https://subsonic.local/rest/stream?id=123&timeOffset=45";
        let start_pos = 45.0;
        let use_ffmpeg_seek = false; // Server-side seek injected
        let is_stream = true;
        let is_youtube_stream = false;
        let quality = "studio";
        let is_dsd = false;

        let args = build_ffmpeg_decoder_args(
            subsonic_url,
            start_pos,
            use_ffmpeg_seek,
            is_stream,
            is_youtube_stream,
            quality,
            is_dsd,
        );

        // Subsonic server handles seek offset via query parameter, so -ss should not be passed to ffmpeg
        assert!(!args.iter().any(|x| x == "-ss"), "When server-side seek is active, -ss must be omitted");
        let i_idx = args.iter().position(|x| x == "-i").expect("Must contain -i");
        assert_eq!(args[i_idx + 1], "pipe:");
    }

    #[test]
    fn test_build_ffmpeg_decoder_args_local_file_seeking() {
        use crate::player::build_ffmpeg_decoder_args;

        let local_path = "C:\\Music\\Album\\track.flac";
        let start_pos = 30.0;
        let use_ffmpeg_seek = true;
        let is_stream = false;
        let is_youtube_stream = false;
        let quality = "hires";
        let is_dsd = false;

        let args = build_ffmpeg_decoder_args(
            local_path,
            start_pos,
            use_ffmpeg_seek,
            is_stream,
            is_youtube_stream,
            quality,
            is_dsd,
        );

        let ss_idx = args.iter().position(|x| x == "-ss").expect("Must contain -ss");
        let i_idx = args.iter().position(|x| x == "-i").expect("Must contain -i");
        assert!(ss_idx < i_idx);
        assert_eq!(args[i_idx + 1], local_path);
        // Local files do not require protocol whitelist or network reconnection arguments
        assert!(!args.contains(&"-reconnect".to_string()));
    }

    #[test]
    fn test_stream_active_downloads_coordination() {
        use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
        use std::sync::Arc;
        use crate::player::{ACTIVE_STREAM_DOWNLOADS, ActiveStreamDownload, abort_inactive_stream_downloads};

        let url1 = "https://sp-pr-cf.audio.tidal.com/stream1";
        let url2 = "https://sp-pr-cf.audio.tidal.com/stream2";
        let temp_dir = std::env::temp_dir();

        let dl1 = Arc::new(ActiveStreamDownload {
            url: url1.to_string(),
            stream_path: temp_dir.join("test_stream1.stream"),
            cache_path: temp_dir.join("test_stream1.cache"),
            total_bytes: Arc::new(AtomicU64::new(10_000_000)),
            downloaded_bytes: Arc::new(AtomicU64::new(5_000_000)),
            complete: Arc::new(AtomicBool::new(false)),
            abort: Arc::new(AtomicBool::new(false)),
        });

        let dl2 = Arc::new(ActiveStreamDownload {
            url: url2.to_string(),
            stream_path: temp_dir.join("test_stream2.stream"),
            cache_path: temp_dir.join("test_stream2.cache"),
            total_bytes: Arc::new(AtomicU64::new(20_000_000)),
            downloaded_bytes: Arc::new(AtomicU64::new(1_000_000)),
            complete: Arc::new(AtomicBool::new(false)),
            abort: Arc::new(AtomicBool::new(false)),
        });

        {
            let mut active = ACTIVE_STREAM_DOWNLOADS.lock().unwrap();
            active.insert(url1.to_string(), Arc::clone(&dl1));
            active.insert(url2.to_string(), Arc::clone(&dl2));
        }

        // Seeking on url1 or switching to url1 should preserve url1 and abort url2
        abort_inactive_stream_downloads(Some(url1));

        assert!(!dl1.abort.load(Ordering::SeqCst), "Active track stream download must not be aborted");
        assert!(dl2.abort.load(Ordering::SeqCst), "Inactive track stream download must be aborted");

        {
            let active = ACTIVE_STREAM_DOWNLOADS.lock().unwrap();
            assert!(active.contains_key(url1), "Active track must remain registered");
            assert!(!active.contains_key(url2), "Aborted track must be evicted from active registry");
        }

        // Stopping playback should abort all active streams
        abort_inactive_stream_downloads(None);
        assert!(dl1.abort.load(Ordering::SeqCst), "All streams must be aborted on stop");
        {
            let active = ACTIVE_STREAM_DOWNLOADS.lock().unwrap();
            assert!(active.is_empty(), "Registry must be empty after full abort");
        }
    }

    #[test]
    fn test_stream_feeder_from_growing_file_simulation() {
        use std::io::{Read, Write, Seek, SeekFrom};
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;

        let temp_dir = std::env::temp_dir();
        let test_file_path = temp_dir.join(format!("aideo_test_feeder_{}.tmp", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let complete = Arc::new(AtomicBool::new(false));
        let abort = Arc::new(AtomicBool::new(false));

        let producer_path = test_file_path.clone();
        let producer_complete = Arc::clone(&complete);

        // Spawn producer (simulating run_stream_downloader)
        let producer_handle = std::thread::spawn(move || {
            let mut file = std::fs::File::create(&producer_path).unwrap();
            for i in 0..5 {
                let chunk = vec![i as u8; 4096];
                file.write_all(&chunk).unwrap();
                file.flush().unwrap();
                std::thread::sleep(std::time::Duration::from_millis(15));
            }
            producer_complete.store(true, Ordering::SeqCst);
        });

        // Simulate feeder loop (reading from growing file)
        let mut read_bytes = Vec::new();
        let mut read_offset: u64 = 0;
        let mut file = loop {
            if let Ok(f) = std::fs::File::open(&test_file_path) {
                break f;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        };

        let mut buf = [0u8; 2048];
        let start = std::time::Instant::now();
        loop {
            if abort.load(Ordering::SeqCst) || start.elapsed() > std::time::Duration::from_secs(5) {
                break;
            }
            file.seek(SeekFrom::Start(read_offset)).unwrap();
            match file.read(&mut buf) {
                Ok(0) => {
                    if complete.load(Ordering::SeqCst) {
                        break;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                Ok(n) => {
                    read_bytes.extend_from_slice(&buf[..n]);
                    read_offset += n as u64;
                }
                Err(_) => break,
            }
        }

        producer_handle.join().unwrap();
        let _ = std::fs::remove_file(&test_file_path);

        assert_eq!(read_bytes.len(), 5 * 4096, "Feeder must receive all chunks from growing file");
        for i in 0..5 {
            let chunk_slice = &read_bytes[i * 4096..(i + 1) * 4096];
            assert!(chunk_slice.iter().all(|&b| b == i as u8), "Data chunk {} must match produced content", i);
        }
    }

    #[test]
    fn test_is_playable_local_path() {
        use crate::player::is_playable_local_path;
        assert!(!is_playable_local_path("https://lgf.audio.tidal.com/stream.flac"));
        assert!(!is_playable_local_path("http://localhost:8000/stream.mp3"));
        assert!(!is_playable_local_path("455738981"));
        assert!(!is_playable_local_path("non_existent_file_path_xyz.flac"));
        assert!(!is_playable_local_path(""));

        let temp_dir = std::env::temp_dir();
        let test_file = temp_dir.join("aideo_test_playable.flac");
        std::fs::write(&test_file, b"test").unwrap();
        let path_str = test_file.to_str().unwrap();
        assert!(is_playable_local_path(path_str));
        let _ = std::fs::remove_file(&test_file);
    }

    #[test]
    fn test_calculate_stream_eof_padding() {
        use crate::player::calculate_stream_eof_padding;
        assert_eq!(calculate_stream_eof_padding(0, 1024), 0);
        assert_eq!(calculate_stream_eof_padding(1024, 1024), 0);
        assert_eq!(calculate_stream_eof_padding(2500, 1024), 0);
        assert_eq!(calculate_stream_eof_padding(500, 1024), 524);
        assert_eq!(calculate_stream_eof_padding(1023, 1024), 1);
    }
}
