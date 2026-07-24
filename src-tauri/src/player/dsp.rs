#[derive(Clone, Debug, Default)]
pub struct BiquadFilter {
    pub b0: f32,
    pub b1: f32,
    pub b2: f32,
    pub a1: f32,
    pub a2: f32,
    pub x1: f32,
    pub x2: f32,
    pub y1: f32,
    pub y2: f32,
}

impl BiquadFilter {
    pub fn new() -> Self {
        Self {
            b0: 1.0, b1: 0.0, b2: 0.0,
            a1: 0.0, a2: 0.0,
            x1: 0.0, x2: 0.0,
            y1: 0.0, y2: 0.0,
        }
    }

    #[allow(dead_code)]
    pub fn reset_state(&mut self) {
        self.x1 = 0.0;
        self.x2 = 0.0;
        self.y1 = 0.0;
        self.y2 = 0.0;
    }

    pub fn set_peaking(&mut self, fs: f32, f0: f32, gain_db: f32, q: f32) {
        let f0 = f0.clamp(10.0, fs * 0.49);
        let q = q.max(0.01);
        let a = 10.0f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * f0 / fs;
        let cos_w0 = w0.cos();
        let alpha = w0.sin() / (2.0 * q);

        let b0 = 1.0 + alpha * a;
        let b1 = -2.0 * cos_w0;
        let b2 = 1.0 - alpha * a;
        let a0 = 1.0 + alpha / a;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha / a;

        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }

    pub fn set_lowshelf(&mut self, fs: f32, f0: f32, gain_db: f32, q: f32) {
        let f0 = f0.clamp(10.0, fs * 0.49);
        let q = q.max(0.01);
        let a = 10.0f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * f0 / fs;
        let cos_w0 = w0.cos();
        let alpha = w0.sin() / (2.0 * q);
        let sqrt_a = a.sqrt();

        let b0 = a * ((a + 1.0) - (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha);
        let b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0);
        let b2 = a * ((a + 1.0) - (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha);
        let a0 = (a + 1.0) + (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha;
        let a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos_w0);
        let a2 = (a + 1.0) + (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha;

        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }

    pub fn set_highshelf(&mut self, fs: f32, f0: f32, gain_db: f32, q: f32) {
        let f0 = f0.clamp(10.0, fs * 0.49);
        let q = q.max(0.01);
        let a = 10.0f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * f0 / fs;
        let cos_w0 = w0.cos();
        let alpha = w0.sin() / (2.0 * q);
        let sqrt_a = a.sqrt();

        let b0 = a * ((a + 1.0) + (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha);
        let b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0);
        let b2 = a * ((a + 1.0) + (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha);
        let a0 = (a + 1.0) - (a - 1.0) * cos_w0 + 2.0 * sqrt_a * alpha;
        let a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cos_w0);
        let a2 = (a + 1.0) - (a - 1.0) * cos_w0 - 2.0 * sqrt_a * alpha;

        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }

    pub fn set_highpass(&mut self, fs: f32, f0: f32, q: f32) {
        let f0 = f0.clamp(10.0, fs * 0.49);
        let q = q.max(0.01);
        let w0 = 2.0 * std::f32::consts::PI * f0 / fs;
        let cos_w0 = w0.cos();
        let alpha = w0.sin() / (2.0 * q);

        let b0 = (1.0 + cos_w0) / 2.0;
        let b1 = -(1.0 + cos_w0);
        let b2 = (1.0 + cos_w0) / 2.0;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha;

        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }

    pub fn set_lowpass(&mut self, fs: f32, f0: f32, q: f32) {
        let f0 = f0.clamp(10.0, fs * 0.49);
        let q = q.max(0.01);
        let w0 = 2.0 * std::f32::consts::PI * f0 / fs;
        let cos_w0 = w0.cos();
        let alpha = w0.sin() / (2.0 * q);

        let b0 = (1.0 - cos_w0) / 2.0;
        let b1 = 1.0 - cos_w0;
        let b2 = (1.0 - cos_w0) / 2.0;
        let a0 = 1.0 + alpha;
        let a1 = -2.0 * cos_w0;
        let a2 = 1.0 - alpha;

        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }

    #[inline]
    pub fn process(&mut self, x: f32) -> f32 {
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

#[derive(Clone, Debug)]
pub struct ConvolutionFilter {
    ir_samples: Vec<f32>,
    history: Vec<f32>,
    history_ptr: usize,
    pub wet: f32,
    pub enabled: bool,
}

impl ConvolutionFilter {
    pub fn new() -> Self {
        Self {
            ir_samples: Vec::new(),
            history: Vec::new(),
            history_ptr: 0,
            wet: 0.5,
            enabled: false,
        }
    }

    pub fn load_ir_samples(&mut self, samples: Vec<f32>) {
        if samples.is_empty() {
            self.ir_samples.clear();
            self.history.clear();
            self.history_ptr = 0;
            return;
        }
        let max_val = samples.iter().map(|s| s.abs()).fold(0.0f32, f32::max).max(1e-6);
        self.ir_samples = samples.iter().map(|s| s / max_val).collect();
        let len = self.ir_samples.len().min(4096);
        self.ir_samples.truncate(len);
        self.history = vec![0.0; len];
        self.history_ptr = 0;
    }

    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        if !self.enabled || self.ir_samples.is_empty() {
            return input;
        }

        self.history[self.history_ptr] = input;
        let mut conv = 0.0f32;
        let len = self.ir_samples.len();
        
        let mut h_idx = self.history_ptr;
        for &ir_sample in &self.ir_samples {
            conv += self.history[h_idx] * ir_sample;
            if h_idx == 0 {
                h_idx = len - 1;
            } else {
                h_idx -= 1;
            }
        }

        self.history_ptr = (self.history_ptr + 1) % len;

        input * (1.0 - self.wet) + conv * self.wet
    }
}

