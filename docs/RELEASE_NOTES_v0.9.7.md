# 💎 Aideo Music Player v0.9.7 — Feature Expansion, Streaming Services & Stability

Welcome to **Aideo v0.9.7**! This version represents a substantial expansion beyond the v0.9.6 baseline (+33,289 lines / -13,442 lines across 18 commits), introducing official Qobuz streaming, overhauled discovery layouts, structured system diagnostics, storage management, and a robust test suite of 427 frontend tests and 238 backend tests.

---

## 🌟 Highlights & Key Additions

### 🎵 Qobuz & Tidal Lossless Streaming
* **Qobuz Lossless Integration (`src-tauri/src/qobuz.rs`, `src/store/qobuzSlice.ts`)**: Built native Qobuz API client with streaming URL extraction, format inspection, catalog search, and credential management.
* **Persistent Tidal Bootstrap (`src/test/tidalBootstrap.test.tsx`, `src/store/tidalSlice.ts`)**: Tidal sessions now restore automatically on boot via OS keyring without requiring the user to visit the Settings tab.
* **Qobuz & Tidal Connect Cards**: Dedicated interactive connection cards in `src/components/QobuzConnectCard.tsx` and `src/components/TidalConnectCard.tsx`.

### 🧭 Redesigned Aideo Discovery Hubs
* **Three New Layouts (`src/components/aideo/`)**:
  * **Command Deck (`CommandDeckHome.tsx`)**: High-density audiophile dashboard with quick DSP presets, streaming quick-access, and recent favorites.
  * **Editorial Home (`EditorialHome.tsx`)**: Magazine-style visual layout highlighting featured albums, curated playlists, and artist deep-dives.
  * **Stage Home (`StageHome.tsx`)**: Minimalist immersive presentation prioritizing high-resolution album artwork and current playback status.
* **Unified Discovery Feed (`src/utils/discoveryFeed.ts`)**: Algorithmic blending of local library tracks, Tidal suggestions, and YouTube autoplay recommendations.

### 💾 Offline Storage & Download Manager
* **Downloaded Tracks View (`src/components/DownloadedView.tsx`)**: Brand new dedicated view for monitoring local disk space utilization, managing cached offline streams, and inspecting downloaded library tracks.
* **Smart Playlist Builder Modal (`src/components/SmartPlaylistBuilderModal.tsx`)**: Visual rule builder allowing users to create dynamic offline smart mixes based on artists, genres, release years, play counts, and audio formats.

### 🛠️ Diagnostics & Diagnostic Telemetry
* **Live System Diagnostics Modal (`src/components/DebugLogsModal.tsx`)**: Integrated in-app diagnostics viewer displaying memory usage, active audio backend, log streams with level filtering (INFO, WARN, ERROR, DEBUG), and one-click diagnostic report export.
* **Persistent Structured Logger (`src-tauri/src/logger.rs`)**: High-performance log ring buffer with automatic log rotation, file persistence, and safe formatting.

### 🛡️ UI Safety & Resilience Overhaul
* **React Error Boundaries (`src/components/ErrorBoundary.tsx`)**: Wrapped core views (`AideoView`, `LibraryView`, etc.) in error boundaries to prevent a single rendering error from crashing the entire application window.
* **Toast Notification Engine (`src/utils/toast.ts`, `src/components/Toast.tsx`)**: Rewritten toast notification pipeline with deduplication, message categorization (`info`, `success`, `warning`, `error`, `help`), and action callbacks.
* **Karaoke Active Line Focus (`src/components/KaraokeActiveLine.tsx`)**: Dedicated typography component for real-time synced lyrics.
### 🛡️ External Audit Remediation & Pipeline Hardening
* **Audio DSP Parameter Ingestion Safety (`AUD-DSP-06`)**: Added `DSPState::sanitize` clamping EQ bands, preamp gains, crossfeed, and limiter thresholds to bounded finite values, eliminating `NaN` and infinite gain filter corruption.
* **Limiter Multichannel Expansion Alignment (`AUD-DSP-08`)**: Pre-filled newly expanded channel queues in `LookaheadLimiter` with `window_len` zeros to prevent inter-channel phase skew.
* **EOF Residual Frame Padding (`AUD-CON-06`)**: Zero-padded partial residual frames (< `chunk_size`) at EOF instead of discarding them, eliminating end-of-track audio clipping.
* **Double-Dither Removal (`AUD-DSP-01`)**: Removed premature float dither from the audio pump loop, ensuring triangular dither is applied solely at hardware integer quantization inside WASAPI/CPAL callbacks.
* **Multichannel Downmix Matrix (`AUD-AUD-06`)**: Implemented ITU-R compliant `downmix_to_stereo` properly folding 3.0 center into L/R, 5.1 LFE into L/R (-6dB), and 7.1 rear/side surrounds into stereo.
* **RAM Cache Footprint Guard (`AUD-AUD-05`)**: Implemented `should_bypass_ram_cache` checking uncompressed decoded float footprint (`duration * rate * channels * 4 > 400MB`) to stream high-sample-rate audio directly from disk and prevent out-of-memory crashes.
* **Playback Speed Resampling (`AUD-DSP-02`)**: Fixed playback speed adjustments so they engage even when `file_rate == dev_rate`, and removed the inaccurate `(Pitch Preserved)` toast label.
* **Multichannel Phase Alignment (`AUD-DSP-04`)**: Refactored `PhaseResponseNode` to process all audio channels uniformly through independent allpass cascades.
* **Convolution IR Scaling & Path Caching (`AUD-DSP-07`)**: Cached IR paths immediately to prevent infinite reload attempt loops on missing files, and scaled L/R impulse responses using global max peak normalization to preserve spatial stereo balance.
* **Safe Audio Device Matching (`AUD-HW-06`)**: Implemented `find_best_matching_device_name` prioritizing exact and case-insensitive matches, scoring distinctive model tokens, and preventing generic words (e.g. "Speakers") from hijacking arbitrary endpoints.
* **FFmpeg Fallback Sample Rate & Channel Desync (`AUD-AUD-04`, `AUD-P0-06`)**: Passed dynamic `file_rate` and `file_ch` to background FFmpeg decoding, eliminating 4x chipmunk pitch and speed distortion on DSD and high-res audio.
* **Session Reuse Channel Validation (`AUD-AUD-08`, `AUD-CON-05`)**: Validated output channels in `can_reuse_stream_session` and unflagged `ActiveStreamSession.channels` from dead code, preventing 2ch session reuse on surround tracks.
* **Bit-Perfect Resampled DSP Bypass Correction (`AUD-AUD-01`, `AUD-DSP-10`)**: Passed the evaluated pipeline bit-perfect state `is_bp` rather than raw preference `bp_now` to `should_bypass_dsp_for_bit_perfect`, ensuring user DSP remains active when sample rates differ and audio is resampled.
* **DSD Badge Integrity (`AUD-AUD-02`, `AUD-P0-04`)**: Corrected misleading `DSD NATIVE` label to `DSD` in FullscreenView, reflecting transcode-to-PCM playback.
* **Graceful Player Shutdown (`AUD-CON-11`)**: Added `PlayerCommand::Shutdown` variant handled across all decoder and playback loops, dispatched on `Player::drop` to prevent orphaned background threads.
* **Crossfade Queue Restoration (`AUD-CON-07`)**: Pushed the popped track back to the head of the queue if crossfade decoder or resampler initialization fails.
* **Chromecast HTTP Range Compliance (`AUD-NET-08`)**: Supported open-ended, closed, suffix ranges, and `416 Range Not Satisfiable` in Chromecast streaming server.
* **UPnP Header Formatting & Casting (`AUD-NET-05`, `AUD-NET-06`, `AUD-P0-07`)**: Fixed syntax error in UPnP `protocolInfo`, added DLNA profile identifiers (`FLAC`, `MP3`, `AAC_ISO`), and wired frontend `upnp_play` so UPnP casting streams directly to remote renderers.
* **Dual-Layer Lyric Cache Invalidation (`AUD-PERF-08`)**: Added `clean_stale_lyrics_cache` purging conflicting extensions (`.lrc` vs `.ttml`) and AppData cache layers upon saving lyrics.
* **Modal Accessibility Polish (`AUD-A11Y-01` to `AUD-A11Y-06`)**: Added explicit `aria-label` attributes to icon-only modal close buttons across all dialogs.
* **Copyright & Security Cleanliness (`AUD-LEG-04`, `AUD-UPD-06`, `AUD-UPD-07`)**: Removed stale `updater.json`, purged 22 tracked commercial `.ttml` lyric files from git, pinned external GitHub Actions to immutable SHAs, and ensured minisign `.sig` files are not parsed as SHA-256 sidecars.

---

## 📋 Detailed Commit History (v0.9.6 → v0.9.7)

Here is the complete chronological sequence of the 18 commits merged since release tag `v0.9.6`:

| Commit | Summary |
| :--- | :--- |
| `2331ff4` | **docs**: preserve v0.9.5 changelog in README while highlighting v0.9.6 features |
| `5572037` | **new saved**: major stability improvements, bug fixes, and feature additions |
| `bb63f20` | **new files repo push**: initial integration of newly scaffolded views and utilities |
| `5d4bca0` | **new saved**: state slice refinements and audio math adjustments |
| `8ddad64` | **new saved**: styling polish and responsive layout fixes |
| `730d8bb` | **feat(phase-1)**: pure utilities, audio DSP math, and audio math unit tests |
| `3f0ddd3` | **feat(phase-2)**: UI safety layer, leaf components, smart playlists, and toast overhaul |
| `272d07d` | **fix(phase-3.1)**: replace intrusive taskbar HWND subclassing with safe message loop handling |
| `237d1ea` | **fix(phase-3.2)**: zero-frame/rate guards in sonic analyzer and unwrap protection in WASAPI engine |
| `eea6575` | **fix(phase-3.3)**: mono channel upmix and planar bounds safety in audio decoding pipeline |
| `36a52f2` | **feat(phase-3.4)**: SQLite connection pool, batch playlist downloads, and crash log reporting |
| `0342913` | **test(phase-3)**: locking test suites for playback crash guard, batch downloader, and streaming stability |
| `cae57a0` | **feat(phase-4)**: restore views, modals, and auxiliary tabs (AideoLab, Downloaded, CastSelector, QobuzConnect) |
| `1d6d821` | **feat(phase-5)**: restore core views (AideoView, AlbumsView, LibraryView, FullscreenView, LyricsPanel, SettingsView) |
| `719bf77` | **feat(phase-6)**: restore top-level App, PlayerBar, AudioControlCenter, and style themes |
| `3eb2e9b` | **docs**: restore roadmap and emergency crash handoff documentation |
| `6384694` | **revert(phase-3)**: revert backend DSP, SQLite pool, and taskbar changes to phase-2 baseline |
| `711c9ee` | **new saved**: baseline synchronization with origin/main |

---

## 🧪 Verification & Test Suite Status

All four mandated build and test gates are passing cleanly:

```bash
# 1. Frontend TypeScript Compilation Check
npx tsc --noEmit
# Result: Passed (0 errors)

# 2. Frontend Vitest Unit Test Suite
npx vitest run src/test
# Result: Passed (66 test files passed, 427 tests passed)

# 3. Backend Rust Compilation Check
cargo check --manifest-path src-tauri/Cargo.toml
# Result: Passed (0 errors)

# 4. Backend Rust Unit Test Suite
cargo test --manifest-path src-tauri/Cargo.toml
# Result: Passed (238 passed, 0 failed, 1 ignored)
```

---

## ⚠️ Known Issues & Immediate Remediation Backlog

In keeping with our strict zero-sugarcoating audit policy, the following items remain open for resolution before a public v0.9.7 binary release can be signed and distributed:

1. **Auto-Updater Contract (`H-01`)**: The custom updater in `updater.rs` expects a 64-hex SHA-256 sidecar (`.sha256` / `.sha256sum`). `updater.rs` has been patched to ignore minisign `.sig` files so they are no longer misparsed as checksums, and CI release workflows will publish official `.sha256` sidecars alongside binaries.
2. **Missing Backend Commands (`H-02`)**: The frontend calls `download_playlist_batch` (`cloudSlice.ts`) and `qobuz_open_login_window` (`qobuzSlice.ts`), which need to be registered in `src-tauri/src/lib.rs`.
3. **Event System Mismatch (`M-01`)**: `qobuzSlice` and `tidalSlice` dispatch DOM `CustomEvent`s for auth failure navigation, while `App.tsx` listens via Tauri IPC `listen`.
4. **Dependency Advisories (`H-03`, `H-04`)**: Dependency audits report 9 npm advisories and 2 Cargo advisories (`h2`, `quick-xml`).
5. **Git History Credential Rotation (`C-01`, `C-02`)**: Ensure Context7 and historical Tauri private keys are permanently revoked and rotated.
