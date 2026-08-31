# Emergency Song Playback Crash — Investigation & Resolution Handoff

## Summary
Investigated and resolved the emergency crash/abort issue in Aideo Music Player where triggering song playback could cause an unhandled panic / process abort, abruptly closing the desktop app window.

---

## 1. Root Cause Analysis
Under `panic = "abort"` in the release profile (and during unhandled thread panics), panics terminate the entire desktop process. The investigation identified the following critical vulnerabilities across the audio decoding and playback pipeline:

1. **Unchecked Symphonia `AudioBuffer::chan(ch)` Indexing in Planar Decoding (`src-tauri/src/player/mod.rs`)**:
   - In `background_decode`, `play_file` (streaming packets), and crossfade next-track decoding, audio channel loops iterated up to `file_ch` (which defaults to 2 or multichannel) while decoding audio buffers.
   - For mono audio files (or tracks where Symphonia decodes to 1 channel), calling `b.chan(1)` directly on a 1-channel buffer triggered an immediate `IndexOutOfBounds` panic, crashing the process.
   - **Fix**: Replaced raw `b.chan(ch)` accesses across `background_decode`, `play_file`, and crossfade with `extract_f32_channel_data`, which bounds-checks channel counts and performs mono upmixing (duplicating channel 0 when targeting stereo/multichannel playback) and silence padding for missing channels.

2. **Decoder Loop Thread Disconnection Hang (`src-tauri/src/player/mod.rs`)**:
   - In `play_file`, the `rx_decoder` polling loop ignored `TryRecvError::Disconnected`. If the background decoder thread errored or failed to send, the loop would hang indefinitely in a sleep cycle.
   - **Fix**: Added explicit handling for `TryRecvError::Disconnected` in `rx_decoder` polling to immediately reap child processes, emit `playback-error` to the frontend, and cleanly return `None`.

3. **Unsafe `.unwrap()` / `.expect()` Calls (`src-tauri/src/player/mod.rs`, `src-tauri/src/wasapi_engine.rs`)**:
   - In `spawn_youtube_downloader` and `background_decode`, `.take().unwrap()` was called on `child.stdout` and `ytdlp.stdout`.
   - In `wasapi_engine.rs`, `successful_client.unwrap()` was called directly after format loop completion.
   - In `play_file`, `next_track_path.take().unwrap()` was called during crossfade transitions.
   - In `play_file`, `prod_opt.unwrap()` was called separately from `stream_info`.
   - In `Player::new`, `.expect(...)` was called on thread builder spawns.
   - **Fix**: Replaced all instances with safe `match`, `if let`, and `unwrap_or` fallbacks with non-fatal error logging.

4. **Multi-Channel Sample Output Bounds Checking (`mix_output_channel_sample`)**:
   - Strengthened bounds checking in `mix_output_channel_sample` to verify both `planar.len()` and `planar[src_ch].len()`, preventing indexing panics on empty or truncated planar vectors.

5. **Sonic Analyzer Zero-Channel and Zero-Rate Guards (`sonic_analyzer.rs`)**:
   - Added explicit zero-channel and zero-frame guard checks to `audio_buffer_to_mono_f32` and `audio_buffer_to_interleaved_s16` to prevent divide-by-zero (`NaN`) and empty buffer index panics.
   - Added zero sample rate check in `calculate_sonic_profile` and `calculate_ebu_r128_lufs`.

6. **Lookahead Limiter Channel Expansion Delay Alignment & AudioNode Bounds Safety (`src-tauri/src/player/mod.rs`)**:
   - In `LookaheadLimiter::process`, dynamically added channels (e.g. transitioning from stereo to 5.1/surround) previously created empty deques instead of pre-filling `window_len` zero-delay samples, resulting in multi-channel phase skew.
   - AudioNode processing loops (`AideoFilterNode`, `CrossfeedNode`, `SpatializerNode`, `WidthNode`, `LimiterNode`, `CompressorNode`, `NormalizerNode`, `ConvolutionNode`) now strictly bound iteration to minimum channel length across planar buffers.

7. **RAM Cache Completion Drain and Track Progression Loop Guard (`src-tauri/src/player/mod.rs`)**:
   - Restored the `else if is_complete` branch in the RAM cache playback loop to ensure tracks properly drain and cleanly transition to subsequent queued tracks or trigger EOF without hanging.

---

## 2. Changes Applied

### Backend (`src-tauri/`)
- `src-tauri/src/player/mod.rs`:
  - Implemented `extract_f32_channel_data` with channel bounds checking, mono upmixing, and zero-padding.
  - Replaced unsafe `b.chan(ch)` indexing in `background_decode` and `play_file` streaming loops with `extract_f32_channel_data`.
  - Added clean handling for `TryRecvError::Disconnected` in `play_file` decoder polling.
  - Replaced `.take().unwrap()` with safe `if let Some(...)` in crossfade next track transitions and child process pipe handling.
  - Combined `prod_opt` and `stream_info` extraction into a single safe pattern match.
  - Enhanced `mix_output_channel_sample` to safely handle empty planar arrays and variable channel lengths.
  - Initialized dynamically expanded delay buffers in `LookaheadLimiter::process` with `window_len` zero samples.
  - Guarded channel slice lengths in all DSP `AudioNode` process implementations against channel length disparities.
  - Safely spawned background threads in `Player::new` without unhandled panics.
  - Restored `else if is_complete` branch for RAM-cached audio EOF drain and queue progression.
- `src-tauri/src/wasapi_engine.rs`:
  - Replaced `successful_client.unwrap()` with safe `match successful_client` returning a descriptive error on failure.
- `src-tauri/src/sonic_analyzer.rs`:
  - Added zero-channel and zero-frame guard checks to `audio_buffer_to_mono_f32` and `audio_buffer_to_interleaved_s16`.
  - Added zero sample-rate guard to `calculate_sonic_profile` and `calculate_ebu_r128_lufs`.
- `src-tauri/src/player/dsp_tests.rs`:
  - Added dedicated regression unit tests:
    - `test_extract_f32_channel_data_mono_upmix_and_bounds_safety`
    - `test_mix_output_channel_sample_bounds_safety`
    - `test_lookahead_limiter_dynamic_channel_expansion_preserves_delay_alignment`
    - `test_audio_nodes_mismatched_channel_buffer_lengths_safety`
    - `test_sonic_analyzer_zero_sample_rate_and_empty_buffer_safety`
    - `test_ram_cache_completion_buffer_drain_and_progression`
- `src-tauri/src/youtube/mod.rs`:
  - Resolved compiler warning for unused variable `_empty_skips`.

---

## 3. Verification Gates
- **Backend Rust Check**: `cargo check --quiet --manifest-path src-tauri/Cargo.toml` -> **Passed (0 warnings, 0 errors)**
- **Backend Rust Test Suite**: `cargo test --quiet --manifest-path src-tauri/Cargo.toml` -> **Passed (216 passed, 0 failed, 1 ignored)**
- **Frontend TypeScript Typecheck**: `npx tsc --noEmit` -> **Passed (0 errors)**
- **Frontend Vitest Test Suite**: `npx vitest run src/test` -> **Passed (63 test files passed, 406 tests passed)**

