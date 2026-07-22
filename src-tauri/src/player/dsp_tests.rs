#[cfg(test)]
mod dsp_tests {
    use crate::player::{BiquadFilter, CircularDelayLine};

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
}

