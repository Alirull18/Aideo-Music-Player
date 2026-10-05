use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::Instant;

pub struct AudioLevels {
    pub peak_dbfs: Option<f32>,
    pub headroom_db: Option<f32>,
    pub silent: bool,
}

pub struct AudioMeter {
    origin: Instant,
    lease_until_ms: AtomicU64,
    peak: AtomicU32,
}

impl AudioMeter {
    pub fn new() -> Self {
        Self { origin: Instant::now(), lease_until_ms: AtomicU64::new(0), peak: AtomicU32::new(0) }
    }

    pub fn clear(&self) {
        self.peak.store(0, Ordering::Relaxed);
    }

    pub fn record(&self, samples: impl Iterator<Item = f32>) {
        let deadline = self.lease_until_ms.load(Ordering::Relaxed);
        if deadline == 0 || self.origin.elapsed().as_millis() as u64 >= deadline {
            return;
        }
        let peak = samples.filter(|s| s.is_finite()).map(f32::abs).reduce(f32::max);
        if self.lease_until_ms.load(Ordering::Relaxed) != 0 {
            if let Some(peak) = peak {
                // Zero means no samples; adding one keeps measured silence distinct.
                self.peak.fetch_max(peak.to_bits() + 1, Ordering::Relaxed);
            }
        }
    }

    pub fn read(&self, enabled: bool) -> Option<AudioLevels> {
        let now = self.origin.elapsed().as_millis() as u64;
        // ponytail: a 1.5s lease covers 250ms polling; add owner leases only for independent windows.
        let previous = self.lease_until_ms.swap(if enabled { now + 1500 } else { 0 }, Ordering::Relaxed);
        let bits = self.peak.swap(0, Ordering::Relaxed);
        if !enabled || previous == 0 || previous <= now || bits == 0 {
            return None;
        }
        let peak = f32::from_bits(bits - 1);
        let peak_dbfs = (peak > 0.0).then(|| 20.0 * peak.log10());
        Some(AudioLevels { peak_dbfs, headroom_db: peak_dbfs.map(|db| -db), silent: peak == 0.0 })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closed_meter_never_reads_samples() {
        let meter = AudioMeter::new();
        meter.record(std::iter::from_fn(|| -> Option<f32> { panic!("closed meter scanned audio") }));
        assert!(meter.read(false).is_none());
    }

    #[test]
    fn reports_interval_peak_and_resets_after_read_or_close() {
        let meter = AudioMeter::new();
        assert!(meter.read(true).is_none());
        meter.record([0.1, -0.5, 0.25].into_iter());
        meter.record([0.4].into_iter());
        let levels = meter.read(true).unwrap();
        assert!((levels.peak_dbfs.unwrap() + 6.0206).abs() < 0.001);
        assert!((levels.headroom_db.unwrap() - 6.0206).abs() < 0.001);
        assert!(!levels.silent);
        assert!(meter.read(true).is_none());
        meter.record([1.0].into_iter());
        assert!(meter.read(false).is_none());
        assert!(meter.read(true).is_none());
    }

    #[test]
    fn distinguishes_silence_missing_data_and_over_full_scale() {
        let meter = AudioMeter::new();
        meter.read(true);
        meter.record([0.0, -0.0].into_iter());
        let silence = meter.read(true).unwrap();
        assert!(silence.silent);
        assert!(silence.peak_dbfs.is_none());
        assert!(silence.headroom_db.is_none());
        meter.record([f32::NAN, f32::INFINITY].into_iter());
        assert!(meter.read(true).is_none());
        meter.record([2.0].into_iter());
        let levels = meter.read(true).unwrap();
        assert!((levels.peak_dbfs.unwrap() - 6.0206).abs() < 0.001);
        assert!((levels.headroom_db.unwrap() + 6.0206).abs() < 0.001);
    }

    #[test]
    fn expired_lease_never_scans_or_returns_old_audio() {
        let mut meter = AudioMeter::new();
        meter.read(true);
        meter.record([0.5].into_iter());
        meter.origin = std::time::Instant::now() - std::time::Duration::from_secs(2);
        meter.record(std::iter::from_fn(|| -> Option<f32> { panic!("expired meter scanned audio") }));
        assert!(meter.read(true).is_none());
    }

    #[test]
    fn renewing_the_lease_during_a_callback_keeps_its_peak() {
        let mut meter = AudioMeter::new();
        meter.read(true);
        meter.origin = std::time::Instant::now() - std::time::Duration::from_millis(10);
        meter.record([0.5].into_iter().inspect(|_| { meter.read(true); }));
        assert!((meter.read(true).unwrap().peak_dbfs.unwrap() + 6.0206).abs() < 0.001);
    }
}
