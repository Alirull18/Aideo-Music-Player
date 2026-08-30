#[derive(Clone, Debug, Default)]
pub struct BiquadFilter {
    pub b0: f32,
    pub b1: f32,
    pub b2: f32,
    pub a1: f32,
    pub a2: f32,
    // Target coefficients the live coefficients glide toward (coefficient
    // slewing) so parameter changes never click or zipper.
    tb0: f32,
    tb1: f32,
    tb2: f32,
    ta1: f32,
    ta2: f32,
    // One-pole slew factor derived from the sample rate at set_* time
    // (~5ms time constant). 1.0 = instant snap.
    slew_k: f32,
    pub x1: f32,
    pub x2: f32,
    pub y1: f32,
    pub y2: f32,
}

/// Slew time constant in seconds for coefficient smoothing.
const COEFF_SLEW_TIME_S: f32 = 0.005;

impl BiquadFilter {
    pub fn new() -> Self {
        Self {
            b0: 1.0, b1: 0.0, b2: 0.0,
            a1: 0.0, a2: 0.0,
            tb0: 1.0, tb1: 0.0, tb2: 0.0,
            ta1: 0.0, ta2: 0.0,
            slew_k: 1.0,
            x1: 0.0, x2: 0.0,
            y1: 0.0, y2: 0.0,
        }
    }

    #[cfg(test)]
    pub fn coeffs_current_and_target(&self) -> ([f32; 5], [f32; 5]) {
        (
            [self.b0, self.b1, self.b2, self.a1, self.a2],
            [self.tb0, self.tb1, self.tb2, self.ta1, self.ta2],
        )
    }

    #[allow(dead_code)]
    pub fn reset_state(&mut self) {
        self.x1 = 0.0;
        self.x2 = 0.0;
        self.y1 = 0.0;
        self.y2 = 0.0;
    }

    /// Store normalized coefficients as slew targets and derive the one-pole
    /// smoothing factor for this sample rate (~5ms time constant).
    fn apply_target_coeffs(&mut self, safe_fs: f32, b0: f32, b1: f32, b2: f32, a1: f32, a2: f32) {
        self.tb0 = b0;
        self.tb1 = b1;
        self.tb2 = b2;
        self.ta1 = a1;
        self.ta2 = a2;
        self.slew_k = 1.0 - (-1.0 / (COEFF_SLEW_TIME_S * safe_fs)).exp();
    }

    pub fn set_peaking(&mut self, fs: f32, f0: f32, gain_db: f32, q: f32) {
        let safe_fs = fs.max(1000.0);
        let max_f0 = (safe_fs * 0.49).max(10.0);
        let f0 = f0.clamp(10.0, max_f0);
        let q = q.clamp(0.01, 100.0);
        let a = 10.0f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * f0 / safe_fs;
        let cos_w0 = w0.cos();
        let alpha = w0.sin() / (2.0 * q);

        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * cos_w0;
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha / a;

        self.apply_target_coeffs(safe_fs, b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
    }

    pub fn set_lowshelf(&mut self, fs: f32, f0: f32, gain_db: f32, q: f32) {
        let safe_fs = fs.max(1000.0);
        let max_f0 = (safe_fs * 0.49).max(10.0);
        let f0 = f0.clamp(10.0, max_f0);
        let q = q.clamp(0.01, 100.0);
        let a = 10.0f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * f0 / safe_fs;
        let cos_w0 = w0.cos();
        let alpha = w0.sin() / (2.0 * q);
        let sqrt_a = a.sqrt();

        let b0 = a * ((a + 1.0) - (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha);
        let b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0);
        let b2 = a * ((a + 1.0) - (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha);
        let a0 = (a + 1.0) + (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha;
        let a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos_w0);
        let a2 = (a + 1.0) + (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha;

        self.apply_target_coeffs(safe_fs, b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
    }

    pub fn set_highshelf(&mut self, fs: f32, f0: f32, gain_db: f32, q: f32) {
        let safe_fs = fs.max(1000.0);
        let max_f0 = (safe_fs * 0.49).max(10.0);
        let f0 = f0.clamp(10.0, max_f0);
        let q = q.clamp(0.01, 100.0);
        let a = 10.0f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * f0 / safe_fs;
        let cos_w0 = w0.cos();
        let alpha = w0.sin() / (2.0 * q);
        let sqrt_a = a.sqrt();

        let b0 = a * ((a + 1.0) + (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha);
        let b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0);
        let b2 = a * ((a + 1.0) + (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha);
        let a0 = (a + 1.0) - (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha;
        let a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cos_w0);
        let a2 = (a + 1.0) - (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha;

        self.apply_target_coeffs(safe_fs, b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
    }

    pub fn set_highpass(&mut self, fs: f32, f0: f32, q: f32) {
        let safe_fs = fs.max(1000.0);
        let max_f0 = (safe_fs * 0.49).max(10.0);
        let f0 = f0.clamp(10.0, max_f0);
        let q = q.clamp(0.01, 100.0);
        let w0 = 2.0 * std::f32::consts::PI * f0 / safe_fs;
        let cos_w0 = w0.cos();
        let alpha = w0.sin() / (2.0 * q);

        let b0 = (1.0 + cos_w0) / 2.0;
        let b1 = -(1.0 + cos_w0);
        let b2 = (1.0 + cos_w0) / 2.0;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha;

        self.apply_target_coeffs(safe_fs, b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
    }

    pub fn set_lowpass(&mut self, fs: f32, f0: f32, q: f32) {
        let safe_fs = fs.max(1000.0);
        let max_f0 = (safe_fs * 0.49).max(10.0);
        let f0 = f0.clamp(10.0, max_f0);
        let q = q.clamp(0.01, 100.0);
        let w0 = 2.0 * std::f32::consts::PI * f0 / safe_fs;
        let cos_w0 = w0.cos();
        let alpha = w0.sin() / (2.0 * q);

        let b0 = (1.0 - cos_w0) / 2.0;
        let b1 = 1.0 - cos_w0;
        let b2 = (1.0 - cos_w0) / 2.0;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha;

        self.apply_target_coeffs(safe_fs, b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
    }

    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
        // Coefficient slewing: glide the live coefficients toward the latest
        // targets so parameter changes stay click-free.
        let k = self.slew_k;
        self.b0 += (self.tb0 - self.b0) * k;
        self.b1 += (self.tb1 - self.b1) * k;
        self.b2 += (self.tb2 - self.b2) * k;
        self.a1 += (self.ta1 - self.a1) * k;
        self.a2 += (self.ta2 - self.a2) * k;

        let mut y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2 - self.a1 * self.y1 - self.a2 * self.y2;
        if y.abs() < 1e-20 {
            y = 0.0;
        }
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }

    /// Process a block of samples in 4-wide unrolled SIMD-friendly chunks
    #[allow(dead_code)]
    #[inline]
    pub fn process_block(&mut self, samples: &mut [f32]) {
        let mut chunks = samples.chunks_exact_mut(4);
        for chunk in &mut chunks {
            chunk[0] = self.process(chunk[0]);
            chunk[1] = self.process(chunk[1]);
            chunk[2] = self.process(chunk[2]);
            chunk[3] = self.process(chunk[3]);
        }
        let rem = chunks.into_remainder();
        for s in rem {
            *s = self.process(*s);
        }
    }
}

#[derive(Clone, Debug)]
pub struct CircularDelayLine {
    buffer: Vec<f32>,
    write_ptr: usize,
}

impl CircularDelayLine {
    pub fn new(max_delay_samples: usize) -> Self {
        Self {
            buffer: vec![0.0; max_delay_samples.max(16)],
            write_ptr: 0,
        }
    }

    pub fn push(&mut self, sample: f32) {
        self.buffer[self.write_ptr] = sample;
        self.write_ptr = (self.write_ptr + 1) % self.buffer.len();
    }

    pub fn read_delayed(&self, delay_samples: usize) -> f32 {
        let len = self.buffer.len();
        let delay_samples = delay_samples.clamp(0, len - 1);
        let read_ptr = (self.write_ptr + len - delay_samples) % len;
        self.buffer[read_ptr]
    }
}

#[derive(Clone)]
pub struct ConvolutionFilter {
    // Uniformly partitioned FFT convolution (Gardner, AES 1995): the IR is cut
    // into CONV_BLOCK partitions pre-transformed once at load time; each input
    // block costs one forward FFT, one spectral multiply-accumulate and one
    // inverse FFT regardless of IR length.
    fft_forward: std::sync::Arc<dyn rustfft::Fft<f32>>,
    fft_inverse: std::sync::Arc<dyn rustfft::Fft<f32>>,
    ir_partitions: Vec<Vec<rustfft::num_complex::Complex<f32>>>,
    history: Vec<Vec<rustfft::num_complex::Complex<f32>>>,
    hist_pos: usize,
    blocks_filled: usize,
    block_time: Vec<f32>,
    block_fill: usize,
    scratch_spec: Vec<rustfft::num_complex::Complex<f32>>,
    freq_acc: Vec<rustfft::num_complex::Complex<f32>>,
    overlap_add: Vec<f32>,
    wet_fifo: std::collections::VecDeque<f32>,
    dry_ring: Vec<f32>,
    dry_pos: usize,
    pub wet: f32,
    pub enabled: bool,
}

/// Partition (block) size in samples. Sets the convolver's system latency
/// (~5.3ms @48kHz) for BOTH dry and wet paths so they stay phase-coherent.
const CONV_BLOCK: usize = 256;
const CONV_FFT_SIZE: usize = CONV_BLOCK * 2;
/// Upper bound on IR length (~2.7s @48kHz) to bound memory/CPU.
const MAX_IR_SAMPLES: usize = 1 << 17;

impl ConvolutionFilter {
    pub fn new() -> Self {
        let mut planner = rustfft::FftPlanner::<f32>::new();
        let fft_forward = planner.plan_fft_forward(CONV_FFT_SIZE);
        let fft_inverse = planner.plan_fft_inverse(CONV_FFT_SIZE);
        Self {
            fft_forward,
            fft_inverse,
            ir_partitions: Vec::new(),
            history: Vec::new(),
            hist_pos: 0,
            blocks_filled: 0,
            block_time: vec![0.0; CONV_BLOCK],
            block_fill: 0,
            scratch_spec: vec![rustfft::num_complex::Complex::new(0.0, 0.0); CONV_FFT_SIZE],
            freq_acc: vec![rustfft::num_complex::Complex::new(0.0, 0.0); CONV_FFT_SIZE],
            overlap_add: vec![0.0; CONV_BLOCK],
            wet_fifo: std::collections::VecDeque::new(),
            dry_ring: vec![0.0; CONV_BLOCK],
            dry_pos: 0,
            wet: 0.5,
            enabled: false,
        }
    }

    fn reset_runtime_state(&mut self) {
        self.hist_pos = 0;
        self.blocks_filled = 0;
        self.block_fill = 0;
        self.block_time.iter_mut().for_each(|v| *v = 0.0);
        self.overlap_add.iter_mut().for_each(|v| *v = 0.0);
        self.freq_acc.iter_mut().for_each(|c| *c = rustfft::num_complex::Complex::new(0.0, 0.0));
        self.scratch_spec.iter_mut().for_each(|c| *c = rustfft::num_complex::Complex::new(0.0, 0.0));
        self.wet_fifo.clear();
        self.dry_ring.iter_mut().for_each(|v| *v = 0.0);
        self.dry_pos = 0;
    }

    pub fn load_ir_samples(&mut self, samples: Vec<f32>) {
        if samples.is_empty() {
            self.ir_partitions.clear();
            self.history.clear();
            self.reset_runtime_state();
            return;
        }
        // Peak-normalize (same loudness convention as the direct-form version)
        let max_val = samples.iter().map(|s| s.abs()).fold(0.0f32, f32::max).max(1e-6);
        let mut ir: Vec<f32> = samples.iter().map(|s| s / max_val).collect();
        ir.truncate(MAX_IR_SAMPLES);
        let num_parts = (ir.len() + CONV_BLOCK - 1) / CONV_BLOCK;
        ir.resize(num_parts * CONV_BLOCK, 0.0);

        let mut planner = rustfft::FftPlanner::<f32>::new();
        let fft_forward = planner.plan_fft_forward(CONV_FFT_SIZE);
        let fft_inverse = planner.plan_fft_inverse(CONV_FFT_SIZE);

        let partitions: Vec<Vec<rustfft::num_complex::Complex<f32>>> = ir
            .chunks_exact(CONV_BLOCK)
            .map(|chunk| {
                let mut spec = vec![rustfft::num_complex::Complex::new(0.0, 0.0); CONV_FFT_SIZE];
                for (i, &v) in chunk.iter().enumerate() {
                    spec[i] = rustfft::num_complex::Complex::new(v, 0.0);
                }
                fft_forward.process(&mut spec);
                spec
            })
            .collect();

        self.fft_forward = fft_forward;
        self.fft_inverse = fft_inverse;
        self.ir_partitions = partitions;
        self.history =
            vec![vec![rustfft::num_complex::Complex::new(0.0, 0.0); CONV_FFT_SIZE]; num_parts];
        self.reset_runtime_state();
    }

    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        if !self.enabled || self.ir_partitions.is_empty() {
            return input;
        }

        // Pop the pending wet sample BEFORE accumulating the current block:
        // this keeps the wet stream exactly one partition behind real time,
        // matching the dry delay line below.
        let wet_out = self.wet_fifo.pop_front().unwrap_or(0.0);

        // Dry path delayed by the same partition length so dry/wet stay aligned.
        let dry_out = {
            let delayed = self.dry_ring[self.dry_pos];
            self.dry_ring[self.dry_pos] = input;
            self.dry_pos = (self.dry_pos + 1) % self.dry_ring.len();
            delayed
        };

        self.block_time[self.block_fill] = input;
        self.block_fill += 1;

        if self.block_fill == CONV_BLOCK {
            self.block_fill = 0;

            for (i, slot) in self.scratch_spec.iter_mut().enumerate() {
                *slot = if i < CONV_BLOCK {
                    rustfft::num_complex::Complex::new(self.block_time[i], 0.0)
                } else {
                    rustfft::num_complex::Complex::new(0.0, 0.0)
                };
            }
            self.fft_forward.process(&mut self.scratch_spec);

            let m = self.ir_partitions.len();
            self.history[self.hist_pos]
                .clone_from_slice(&self.scratch_spec);
            self.hist_pos = (self.hist_pos + 1) % m;
            self.blocks_filled = (self.blocks_filled + 1).min(m);

            for c in self.freq_acc.iter_mut() {
                *c = rustfft::num_complex::Complex::new(0.0, 0.0);
            }
            for j in 0..self.blocks_filled {
                let x_spec = &self.history[(self.hist_pos + m - 1 - j) % m];
                let h_spec = &self.ir_partitions[j];
                for i in 0..CONV_FFT_SIZE {
                    self.freq_acc[i] += x_spec[i] * h_spec[i];
                }
            }
            self.fft_inverse.process(&mut self.freq_acc);

            let inv_n = 1.0 / CONV_FFT_SIZE as f32;
            for i in 0..CONV_BLOCK {
                self.wet_fifo
                    .push_back(self.freq_acc[i].re * inv_n + self.overlap_add[i]);
            }
            for i in 0..CONV_BLOCK {
                self.overlap_add[i] = self.freq_acc[CONV_BLOCK + i].re * inv_n;
            }
        }

        dry_out * (1.0 - self.wet) + wet_out * self.wet
    }
}



