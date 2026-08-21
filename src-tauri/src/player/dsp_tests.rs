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
}


