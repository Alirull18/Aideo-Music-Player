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
    }
}




