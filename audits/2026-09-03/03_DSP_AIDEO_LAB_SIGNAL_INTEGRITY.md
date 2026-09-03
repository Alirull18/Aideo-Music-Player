# DSP, Aideo Lab and signal-integrity audit

**Snapshot:** `be94f376930cadd288b987183ee3486c6d36abbd`  
**Verdict:** **NO-GO**  
**Physical/audio-lab status:** **UNTESTED** — no DAC capture, Audio Precision run, null test, IMD/THD+N sweep or listening panel was performed.

## Actual DSP order

When the raw bit-perfect preference does not bypass the graph, the nodes are instantiated and processed in this order (`player/mod.rs:4725-4750`, `5237-5240`):

1. Preamp / ReplayGain
2. Saturation
3. “Phase response” all-pass filters
4. Graphic and parametric EQ
5. Aideo filter
6. Subsonic filter
7. Crossfeed
8. Spatializer
9. Convolution
10. Stereo width
11. Compressor
12. Dynamic “R128” normalizer
13. Lookahead limiter

Crossfade mixing occurs before this graph, so current-track parameters affect both tracks during overlap.

## Findings

### AUD-DSP-01 — Dither can be applied twice

**Severity:** P0  
**Evidence:** STATIC-HIGH

The producer adds TPDF-like noise before writing `f32` to the ring whenever raw DSP dither is enabled and output is integer (`player/mod.rs:5275-5299`). Integer CPAL callbacks then add dither again during quantization (for example the I16 path around `4365-4374`), and custom WASAPI performs its own quantization/dither (`wasapi_engine.rs:519-608`).

Thus a non-bit-perfect integer path can receive two independent noise additions. Dither belongs exactly once, at the final reduction to the actual valid-bit depth.

### AUD-DSP-02 — Playback speed is neither generally applied nor pitch-preserved

**Severity:** P0 because the UI makes an explicit false claim  
**Evidence:** STATIC-HIGH

`playback_rate` is consulted only inside the `file_rate != dev_rate` branch (`player/mod.rs:5140-5167`). When source and device rates are equal, changing rate has no signal-path effect.

The implementation changes a sample-rate conversion ratio. It contains no phase vocoder, WSOLA, Rubber Band or other time-stretch algorithm. Resampling changes speed and pitch together. Rubato documents its component as a sample-rate converter and explicitly describes ratio changes as changing playback speed **or pitch**, not preserving one independently ([Rubato crate documentation](https://docs.rs/rubato/latest/rubato/)).

The frontend toast says `Pitch Preserved` (`src/store/playbackSlice.ts:1073-1076`). That label is false.

The `thread_local! LAST_RATIO` cache is also independent of each resampler instance. A newly constructed resampler can skip its required ratio update if the thread-local value happens to equal the previous track's ratio.

### AUD-DSP-03 — Raw bit-perfect flag bypasses DSP even when output is being resampled

**Severity:** P0  
**Evidence:** STATIC-HIGH

The true direct chunk bypass requires matching rate/channels (`player/mod.rs:5135`), but graph bypass uses `should_bypass_dsp_for_bit_perfect(bp_now, ...)` with the raw flag (`5237`). A resampled path can therefore disable intended DSP while still not being bit-perfect. Status does not expose that distinction.

### AUD-DSP-04 — “Minimum/intermediate resampler phase” is a post-resampler effect

**Severity:** P1  
**Evidence:** STATIC-HIGH

`PhaseResponseNode` cascades first-order all-pass filters over only left/right samples after resampling (`player/mod.rs:2423-2475`). It does not select or redesign the Rubato interpolation filter. Calling this `resampler_phase_mode` in Aideo Lab conflates an audible post-effect with the resampler's actual phase response.

### AUD-DSP-05 — Dynamic normalizer is not an EBU R128 loudness engine

**Severity:** P0 because README/product copy names the standard  
**Evidence:** STATIC-HIGH

`NormalizerNode` takes the maximum instantaneous squared channel sample, applies a three-second exponential average, estimates “LUFS” with a constant, and moves an AGC toward -14 (`player/mod.rs:3143-3206`). It has no K-weighting filters, BS.1770 channel weights, absolute/relative gating, integrated measurement window, loudness range, or true-peak stage.

EBU R128 requires loudness measurement compliant with ITU-R BS.1770; the EBU practical guidance shows K-weighting and gated integrated loudness ([EBU R 128](https://tech.ebu.ch/docs/r/r128.pdf), [EBU Tech 3343](https://tech.ebu.ch/docs/tech/tech3343.pdf)). The README's “EBU R128 LUFS Loudness Engine” claim (`README.md:209`) is not supported by this node.

Static ReplayGain/R128 tags are a separate, more defensible path, but that does not turn the fallback AGC into R128.

### AUD-DSP-06 — EQ parameter validation is incomplete at the backend boundary

**Severity:** P1  
**Evidence:** STATIC-RISK

`BiquadFilter` clamps sample rate, frequency and Q, but uses unbounded `gain_db` in `10.powf(gain_db / 40)` (`dsp.rs:67-84,87-125`). `DSPState` is deserialized from IPC and backend code does not validate all numeric fields as finite/in-range. Malformed or future frontend input can generate infinity/NaN coefficients and poison subsequent samples. UI slider limits are not a trust boundary.

Add one backend validation/normalization function and reject non-finite numbers before publishing a new DSP state.

### AUD-DSP-07 — Convolution loading can block the audio pump and changes IR semantics

**Severity:** P1  
**Evidence:** STATIC-HIGH

`ConvolutionNode::update_params` synchronously opens, probes and decodes the entire IR, then builds FFT partitions (`player/mod.rs:2966-3005,3042-3051`; `dsp.rs:303-330`). Parameter updates are run from the pump, so a large/corrupt/network-backed path can cause an audible underrun.

Additional correctness issues:

- IR sample rate is read by neither loader nor node, so an IR recorded at a different rate has the wrong time/frequency behavior.
- left and right are peak-normalized independently in separate filters, altering inter-channel balance;
- samples are peak-normalized before truncation and then truncated to 131,072 samples (`dsp.rs:310-314`);
- only left/right channels are convolved;
- invalid/failed paths clear filters but do not update `current_ir_path`, so later unrelated DSP changes retry the failing load.

Decode/validate/resample/partition off the pump thread, then atomically swap an immutable prepared IR.

### AUD-DSP-08 — Limiter channel expansion loses equal lookahead

**Severity:** P1  
**Evidence:** STATIC-HIGH

Initial limiter delay queues are zero-prefilled to the lookahead length (`player/mod.rs:2312-2319`). If a later block has more channels, new queues are created only with capacity and no zero fill (`2342-2348`). Existing channels remain delayed while new channels immediately pop their just-pushed sample. This creates inter-channel time skew before downmix.

The limiter is also described as “soft”; smoothed attenuation is not by itself proof of a brick-wall true-peak ceiling. Only sampled-peak tests exist.

### AUD-DSP-09 — Multichannel processing is internally inconsistent

**Severity:** P1  
**Evidence:** STATIC-HIGH

Preamp, saturation, compressor, normalizer and limiter iterate over all channels. Phase, EQ, subsonic, crossfeed, spatializer, convolution and width primarily alter only the first two. The later layout-blind downmix can combine processed and unprocessed channels. There is no declared per-layout contract.

Either define the engine as stereo and downmix once before DSP with a standards-based matrix, or make every node explicitly multichannel/layout-aware.

### AUD-DSP-10 — Startup gain ramps and silence contradict exact-output mode

**Severity:** P0 for bit-perfect claim  
**Evidence:** STATIC-HIGH

Even when bit-perfect forces target gain to unity, callbacks start with `current_gain = 0` and take 256 frames to reach it. Both shared and custom exclusive paths also prefill silence for stability. These choices may be pragmatic anti-click measures, but they are signal mutation and must not coexist with an unqualified exact-output claim.

## What existing tests do and do not prove

The Rust suite has useful unit coverage for filter identity, coefficient slewing, limiter bounds, convolution direct-form comparison, long-IR loading, resampler sanity and simple bit-perfect policy helpers. It does not establish:

- actual output byte equality;
- once-only dither at valid-bit depth;
- NaN/Inf rejection for the full IPC state;
- R128 conformance;
- pitch preservation;
- convolution sample-rate correctness or pump deadline safety;
- multichannel phase alignment; or
- physical DAC behavior.

## Lab acceptance criteria

1. **Bit-exact matrix:** deterministic PCM fixtures, supported exclusive formats, unity volume, no ramp/silence inside the compared programme interval; compare captured digital output bit-for-bit.
2. **Dither:** feed digital silence and low-level tones; verify one expected TPDF distribution and noise floor for 16/24-bit output, not two.
3. **Resampler:** swept sine, impulse, passband ripple, stopband attenuation, alias products and group delay for every exposed quality/phase option.
4. **Speed:** either add a real time-stretcher and measure pitch error/transients, or remove “Pitch Preserved.”
5. **R128:** validate against EBU/BS.1770 reference sequences, integrated loudness, gate behavior and true peak.
6. **DSP stability:** fuzz all IPC numeric fields with NaN/Inf/extremes; output must remain finite or command must be rejected.
7. **Multichannel:** channel-ID impulses through 3.0/5.1/7.1, checking routing, latency and fold-down coefficients.
8. **Real-time budget:** record worst-case pump/callback timing while changing IR/EQ and under CPU/DPC stress; no synchronous IR decode on the pump.

