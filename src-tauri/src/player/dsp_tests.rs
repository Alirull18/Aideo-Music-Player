#[cfg(test)]
mod dsp_tests {
    use crate::player::{BiquadFilter, CircularDelayLine, LookaheadLimiter};

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
}


