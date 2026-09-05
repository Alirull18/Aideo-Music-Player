# 💎 Aideo Music Player v0.9.7 — Studio Visualizer Engine, Gapless Transport & Theater Mode Archetypes

Welcome to **Aideo v0.9.7**! This release marks a major evolution of Aideo Music Player beyond the v0.9.6 baseline, introducing an overhauled **Studio Audio Visualizer Engine** with 5 ballistic modes and idle breathing physics, **True Gapless Stream Sessions** with sample-accurate delay trimming, **True Bit-Perfect Mode** with complete DSP bypass, five bespoke **Theater Mode Visual Archetypes**, an interactive **Audio Telemetry & Signal Path Inspector**, a silky-smooth overhaul of the **PureScope Visualizer**, de-stuttered **Karaoke Lyrics Rendering**, **WASAPI Exclusive Mode buffer drain synchronization**, a full **Top Charts Overhaul**, official **Qobuz Lossless Streaming**, local-first playback routing, and an expanded verification suite of **533 frontend tests** and **274 backend tests**.

---

## 🌟 Highlights & Key Additions

### 🌊 Studio Audio Visualizer Overhaul & Ballistic Physics Engine
The visualizer engine across Now Playing and Theater Mode has been thoroughly upgraded to adhere to Aideo's "Dark Obsidian Studio" hardware aesthetic, featuring 5 distinct visualizer modes, real-time physics, and ambient state transitions:
* **5 Hardware-Inspired Visual Styles (`src/components/Visualizer.tsx`)**:
  * **Studio Peak-Decay Bars (`bars`)**: 64 high-resolution vertical frequency bars with independent floating peak caps governed by realistic gravity physics (`velocity += 0.15px/frame`) and a 12-frame peak hold duration.
  * **Bilateral Mirror Spectrum (`mirror`)**: Symmetrical stereo frequency analyzer radiating outward from center, mirrored across the horizontal centerline for a studio mastering console aesthetic.
  * **Analog Oscilloscope Silk Ribbon (`wave`)**: Continuous smooth Bezier spline passing through audio wave points with glowing bloom stroke, area gradient fill, and analog drift simulation.
  * **Radial Halo Orbit (`circle`)**: Circular halo ring reacting dynamically to bass kick and frequency spokes, cleanly scaling between compact (32 spokes) and expanded (64 spokes) dimensions.
  * **Phosphor LED Dot-Matrix (`dots`)**: Vintage Japanese audiophile rack equipment (Pioneer/Technics fluorescent spectrum displays) with discrete stacked glowing pill dots and peak hold LEDs.
* **Ballistic Physics & Smooth Idle Decay**:
  * Exponential audio level decay (`smoothedBands[i] *= 0.88`) toward 0 over ~200–300ms on pause, preventing jarring canvas blackouts.
  * Ambient resting state: subtle 1px breathing baseline or minimalist concentric circle when audio is paused or stopped, maintaining visual elegance while dropping CPU/GPU consumption to 0%.
* **Adaptive 64px / 140px Container & Quick Toggle (`src/components/NowPlayingView.tsx`)**:
  * Compact 64px docked height in Now Playing with 1-click hover expander toggle to 140px panoramic stage view.
  * Dedicated toggle button in the player bar to quickly hide or reveal the visualizer on the fly.
* **Dedicated Audio Visualizer Settings (`src/components/SettingsView.tsx`, `src/store/uiSlice.ts`)**:
  * Direct style selector chips, decay profile selector (Snappy / Balanced / Silky), 30/60/120 FPS limiter, and player bar toggle visibility controls.
  * High-DPI canvas scaling with `window.devicePixelRatio` auto-detection and low-spec performance safeguards.

### ⚡ True Gapless Stream Sessions & Bit-Perfect Transport
* **Encoder Delay & Padding Trimming (`src-tauri/src/player/stream_session.rs`)**: Integrated sample-accurate trimming of encoder preroll and trailing padding frames (e.g. iTunSMPB metadata), eliminating audible clicks, pops, and micro-pauses between consecutive tracks on live albums and classical movements.
* **True Bit-Perfect Transport (`feat(audio): commit 31425b1`)**: Enforced strict bit-perfect execution with complete DSP bypass (EQ, crossfeed, pitch, limiter), unity 1.0 digital volume, and dither suppression when input format matches output hardware. Output-mode preferences persist across sessions; disabling Exclusive Mode also clears Bit-Perfect Mode.
* **1:53 Stutter & Snap-Back Elimination (`fix(audio): commit 412caad`)**: Resolved playback micro-stutters and position jump-backs using monotonic clock smoothing and proactive stream pre-buffering.

### 🎭 Theater Mode Visual Archetypes & Floating Playback HUD
Instead of a generic fullscreen player bar, Theater Mode now features 5 handcrafted visual designs selectable in **Settings → Appearance** (`theaterModeDesign`) or cyclable on the fly with the HUD switch button and `H` keyboard shortcut:
* **Stage Mode (`src/components/theater/StageLayout.tsx`)**: High-impact immersive concert atmosphere with dynamic ambient lighting, large track titles, and floating glassmorphic transport controls.
* **Hi-Fi Studio Deck (`src/components/theater/HiFiDeckLayout.tsx`)**: Skeuomorphic professional audio rack aesthetic featuring brushed anodized aluminum faceplates, responsive dual-needle ballistic VU meters (peak + RMS response), and tactile hardware-style toggle buttons.
* **Vinyl Turntable (`src/components/theater/TurntableLayout.tsx`)**: Realistic interactive turntable featuring a 33⅓ RPM spinning vinyl with physical groove reflections, dynamic tone arm tracking across track progress, stylus needle drop/lift states, and a rolling lyric ticker.
* **Editorial Poster (`src/components/theater/EditorialPosterLayout.tsx`)**: Swiss editorial layout with high-contrast typography, dominant color extraction (`src/utils/colorExtractor.ts`), large album sleeve art, and an integrated liner notes drawer.
* **Zen Minimalist (`src/components/theater/ZenLayout.tsx`)**: Distraction-free typography-first listening sanctuary with ambient breathing text and subtle hover-revealed playback controls.
* **Tailored Floating Playback HUD (`src/test/theaterPlayerBarAntiSlop.test.tsx`)**: Replaced standard docked bottom player bars in Theater Mode with design-tailored floating HUD controls containing Shuffle, Repeat, Autoplay, Volume, and Favorite actions.
* **Immersive Up Next Queue Drawer (`src/components/theater/TheaterQueueDrawer.tsx`)**: Slide-out glassmorphic drawer for immediate queue inspection, reordering, and track selection without leaving Theater Mode.

### 🎛️ Audio Telemetry & Signal Path Inspector HUD
* **Live Signal Path Modal (`src/components/theater/TheaterSignalPathModal.tsx`, `src/utils/audioPath.ts`)**: Built an interactive inspector revealing the exact end-to-end signal chain from source container (e.g. FLAC 96kHz/24-bit) through the DSP pipeline (EQ, crossfeed, resampling) to the active output endpoint (WASAPI Exclusive, ASIO, DirectSound).
* **Bit-Perfect Verification Badge**: Clear visual indicator showing whether the active playback stream is operating in true bit-perfect mode or undergoing sample rate conversion / DSP processing.

### 🌊 PureScope Visualizer Overhaul
* **Stabilized Oscilloscope & FFT Spectrum (`src/components/theater/PureScopeLayout.tsx`)**: Completely overhauled the PureScope visualizer to eliminate erratic frame jumping and line flickering. Implemented zero-crossing waveform synchronization, dual-mode spectral analysis, calibrated phosphor decay, and smooth RequestAnimationFrame (RAF) canvas interpolation.

### 🎤 Karaoke Lyrics Engine Polish & De-Stuttering
* **Ultra-Smooth Syllable Progression (`src/components/KaraokeActiveLine.tsx`, `src/components/FullscreenView.tsx`)**: Re-engineered real-time karaoke text highlighting to eliminate micro-stuttering and font flickering.
* **Synchronized Render Pipeline**: Replaced jitter-prone timeupdate intervals with RAF-interpolated playback clocks and optimized CSS background-clip masking, restoring fluid 60fps word-by-word lyric wipe animations matching the v0.9.6 baseline.
* **Seek and Track-Change Re-Anchoring**: Forward/backward seeks, changed lyric lines, and trailing whitespace now reset and re-anchor word progress cleanly without a frozen gradient or stale highlight.

### 🎵 Qobuz & Tidal Lossless Streaming
* **Qobuz Lossless Integration (`src-tauri/src/qobuz.rs`, `src/store/qobuzSlice.ts`)**: Native Qobuz API client with streaming URL extraction, format inspection, catalog search, and secure credential handling.
* **Qobuz Login Window & Bundle Compatibility (`src-tauri/src/qobuz.rs`)**: Added an embedded login/callback flow and support for current Qobuz `bundle.js` layouts and direct production app secrets.
* **Persistent Tidal Bootstrap (`src/test/tidalBootstrap.test.tsx`, `src/store/tidalSlice.ts`)**: Tidal sessions now restore automatically on application boot via OS keyring without requiring navigation to Settings.
* **Tidal Manifest and Quality Fallback (`src-tauri/src/tidal.rs`)**: Added JSON/XML manifest decoding, direct HTTPS URL validation, quality-ladder fallback for unusable or unauthorized high-quality variants, and clearer subscription-entitlement errors.
* **Interactive Connect Cards**: Dedicated connection and login modals in `src/components/QobuzConnectCard.tsx` and `src/components/TidalConnectCard.tsx`.

### 📊 Top Charts Overhaul
* **Overhauled Charts View (`src/components/ChartsView.tsx`, `src/components/ChartsView.css`, `src/utils/charts.ts`)**: Modernized charts explorer with Last.fm, Billboard, and ListenBrainz provider tabs; worldwide, genre, country, and time-range scopes; trend badges (gainers/droppers); paged rank loading; validated artwork; and seamless playback/queue actions for matched tracks.
* **Published-Rank Integrity**: Unavailable playback matches remain visible at their published rank, while only verified playable entries are sent to playback or the queue. Provider failures expose an explicit fallback source instead of silently presenting the wrong chart.

### 🧭 Redesigned Aideo Discovery Hubs
* **Three Dedicated Discovery Layouts (`src/components/aideo/`)**:
  * **Command Deck (`CommandDeckHome.tsx`)**: High-density audiophile dashboard with DSP presets, streaming quick-access, and recent favorites.
  * **Editorial Home (`EditorialHome.tsx`)**: Magazine-style visual layout highlighting featured albums, curated playlists, and artist deep-dives.
  * **Stage Home (`StageHome.tsx`)**: Minimalist visual showcase prioritizing high-resolution album artwork and current playback status.
* **Unified Discovery Feed (`src/utils/discoveryFeed.ts`)**: Algorithmic blending of local library tracks, Tidal suggestions, and YouTube autoplay recommendations with local fallback playback.
* **Personalized Shelves & Playable Spotlight**: Added local **My Supermix**, **Artist Spotlight**, **Forgotten Favorites**, and **On Repeat** shelves, with clickable spotlight cards and discovery rows.
* **Discovery Layout Controls**: Added persistent shelves/unified-feed selection, grid/list presentation, and a clamped 100–360px discovery-card size control for different displays.
* **Local-First Playback Routing (`src/utils.ts`, `src/store/playbackSlice.ts`, `src/store/librarySlice.ts`)**: Local paths and owned library matches now use native `playTrack` with preserved FLAC/MP3 metadata; numeric Tidal/Qobuz IDs resolve only through their provider; web URLs remain explicitly labeled as Web Stream.

### 🖼️ Interactive Listening & Aideo Lab Polish
* **Interactive Now Playing Artwork (`src/components/NowPlayingView.tsx`)**: Added pointer-responsive artwork tilt plus an accessible info toggle that reveals track position, source, codec, sample rate, channels, track/disc metadata, BPM, energy, and other audio details.
* **Fullscreen Scope and HUD Polish (`src/components/FullscreenView.tsx`)**: Added the pitch-black PureScope surface, stable top-bar controls, and design-aware floating playback controls that remain consistent across all Theater layouts.
* **Aideo Lab Refinement (`src/components/AideoLabView.tsx`)**: Added persistent AutoEQ collapse state, proportional frequency/dB graph scaling, and a magnetic 0dB detent for tactile EQ adjustments.
* **Album Collaboration Grouping (`src/utils/albumUtils.ts`)**: Album grouping now normalizes comma-, ampersand-, slash-, semicolon-, and `x`-separated collaborator credits instead of splitting one release into duplicate albums.
* **Global Navigation Polish (`src/components/ScrollToTopButton.tsx`)**: Added an unobtrusive scroll-to-top control for long library, discovery, chart, and settings surfaces.

### 💾 Offline Storage & Download Manager
* **Downloaded Tracks View (`src/components/DownloadedView.tsx`)**: Dedicated view for monitoring local disk space utilization, managing cached offline streams, and inspecting downloaded library tracks.
* **Smart Playlist Builder Modal (`src/components/SmartPlaylistBuilderModal.tsx`)**: Visual rule builder allowing users to create dynamic offline smart mixes based on artists, genres, release years, play counts, and audio formats.

### 🛠️ Diagnostics & Diagnostic Telemetry
* **Live System Diagnostics Modal (`src/components/DebugLogsModal.tsx`)**: Integrated in-app diagnostics viewer displaying memory usage, active audio backend, log streams with level filtering (INFO, WARN, ERROR, DEBUG), and one-click diagnostic report export.
* **Persistent Structured Logger (`src-tauri/src/logger.rs`)**: High-performance log ring buffer with automatic log rotation, file persistence, and safe formatting.

### 🛡️ UI Safety, Library Scale & Resilience
* **React Error Boundaries (`src/components/ErrorBoundary.tsx`)**: Isolated discovery, library, playback, settings, charts, downloads, lyrics, and fullscreen surfaces so one rendering failure does not take down the whole window.
* **Toast Notification Engine (`src/utils/toast.ts`, `src/components/Toast.tsx`)**: Added deduplication, severity categories (`info`, `success`, `warning`, `error`, `help`), titles, and action callbacks for consistent recovery feedback.
* **SQLite Reader Pool & Paginated Library Queries (`src-tauri/src/db.rs`, `src-tauri/src/lib.rs`)**: Added WAL-friendly pooled readers, filtered/sorted page queries, and total-count IPC for large libraries without loading every row for each view.
* **Batch Playlist Downloads & Defensive IPC Registration**: Registered and covered `download_playlist_batch` and `qobuz_open_login_window`, so the frontend’s batch download and Qobuz login actions have their native command implementations.

---

## 🔊 Audio Engine, DSP & Pipeline Hardening

* **WASAPI Exclusive Mode Track Finish Synchronization (`src-tauri/src/player/mod.rs`, `src-tauri/src/wasapi_engine.rs`)**: Fixed an issue where tracks in exclusive mode skipped to the next song before the current track finished playing. Implemented hardware buffer drain verification before dispatching EOF track progression events.
* **True Bit-Perfect Pipeline (`feat(audio): commit 31425b1`)**: Enforced strict bit-perfect execution when enabled. Guarantees complete DSP bypass (EQ, crossfeed, pitch, limiter), unity 1.0 digital volume, and triangular dither suppression when input format matches output device format. Output-mode preferences persist across sessions; disabling Exclusive Mode also clears Bit-Perfect Mode.
* **True Gapless Stream Sessions (`feat(audio): commit be94f37`)**: Integrated encoder delay and padding trimming (iTunSMPB / gapless info) into the audio stream session pipeline, eliminating audible clicks and gaps between consecutive album tracks.
* **1:53 Stutter & Snap-Back Elimination (`fix(audio): commit 412caad`)**: Resolved playback micro-stutters and position jump-backs using monotonic clock smoothing and proactive stream pre-buffering.
* **Windows Crash Guard & Power Throttling Opt-Out (`src-tauri/src/taskbar.rs`, `src-tauri/src/lib.rs`)**:
  * Replaced intrusive taskbar HWND subclassing with safe message loop handling to prevent shell crashes.
  * Opted audio threads out of Windows 10/11 `ThreadPowerThrottling` (EcoQoS) to prevent the OS from frequency-capping audio processing when running on Battery Saver.
  * Enforced 1ms timer precision via RAII `TimePeriodGuard` (`timeBeginPeriod(1)`) to eliminate 15.6ms timer drift on ring buffer wait loops, and registered the audio pump with MMCSS `"Audio"` at `THREAD_PRIORITY_TIME_CRITICAL`.
* **Audio DSP Parameter Ingestion Safety (`AUD-DSP-06`)**: Added `DSPState::sanitize` clamping EQ bands, preamp gains, crossfeed, and limiter thresholds to bounded finite values, eliminating `NaN` and infinite gain filter corruption.
* **Limiter Multichannel Expansion Alignment (`AUD-DSP-08`)**: Pre-filled newly expanded channel queues in `LookaheadLimiter` with `window_len` zeros to prevent inter-channel phase skew.
* **EOF Residual Frame Padding (`AUD-CON-06`)**: Zero-padded partial residual frames (< `chunk_size`) at EOF instead of discarding them, eliminating end-of-track audio clipping.
* **Double-Dither Removal (`AUD-DSP-01`)**: Removed premature float dither from the audio pump loop, ensuring triangular dither is applied solely at hardware integer quantization inside WASAPI/CPAL callbacks.
* **Multichannel Downmix Matrix (`AUD-AUD-06`)**: Implemented ITU-R compliant `downmix_to_stereo` properly folding 3.0 center into L/R, 5.1 LFE into L/R (-6dB), and 7.1 rear/side surrounds into stereo.
* **RAM Cache Footprint Guard (`AUD-AUD-05`)**: Implemented `should_bypass_ram_cache` checking uncompressed decoded float footprint (`duration * rate * channels * 4 > 400MB`) to stream high-sample-rate audio directly from disk and prevent out-of-memory crashes.
* **Playback Speed Resampling (`AUD-DSP-02`)**: Fixed playback speed adjustments so they engage even when `file_rate == dev_rate` and remain synchronized with the active output rate.
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
* **Chromecast Library Path Allowlist**: Chromecast’s local HTTP server now serves only existing files authorized by the indexed library database, rejecting directories, unknown files, and traversal attempts.
* **UPnP Header Formatting & Casting (`AUD-NET-05`, `AUD-NET-06`, `AUD-P0-07`)**: Fixed syntax error in UPnP `protocolInfo`, added DLNA profile identifiers (`FLAC`, `MP3`, `AAC_ISO`), and wired frontend `upnp_play` so UPnP casting streams directly to remote renderers.
* **Dual-Layer Lyric Cache Invalidation (`AUD-PERF-08`)**: Added `clean_stale_lyrics_cache` purging conflicting extensions (`.lrc` vs `.ttml`) and AppData cache layers upon saving lyrics.
* **Plain-Lyrics Fallback**: LRCLIB and other providers that return unsynchronized plain text now produce displayable lyric blocks instead of an empty “No Lyrics” state.
* **Native Connectivity Ownership (`WEB_STREAM_AUDIT`)**: Removed false `navigator.onLine` playback blockers; native backend reachability now decides whether an online stream can start.
* **Provider Resolution Guards**: Tidal and Qobuz tracks must resolve to an HTTP(S) stream before `play_track`, queue insertion, or queue-next operations, preventing raw catalog IDs from reaching the decoder after an auth or network failure.
* **Bounded Lyrics Translation & Safe Text Writes**: Capped concurrent lyric translation requests at four and restricted playlist/lyrics text writes to approved extensions while rejecting traversal and Windows system paths.
* **Defensive Decoder and Analyzer Guards**: Added zero-frame/rate protection, mono upmix and planar-buffer bounds checks, and safer fallback behavior for malformed or incomplete media input.
* **Modal Accessibility Polish (`AUD-A11Y-01` to `AUD-A11Y-06`)**: Added explicit `aria-label` attributes to icon-only modal close buttons across all dialogs.
* **Copyright & Security Cleanliness (`AUD-LEG-04`, `AUD-UPD-06`, `AUD-UPD-07`)**: Removed stale `updater.json`, purged tracked commercial `.ttml` lyric files from git, pinned external GitHub Actions to immutable SHAs, and ensured minisign `.sig` files are not parsed as SHA-256 sidecars.

---

## 📋 Detailed Commit History (v0.9.6 → v0.9.7)

Below is the complete chronological sequence of 34 commits merged since release tag `v0.9.6`:

| Commit | Summary |
| :--- | :--- |
| `3996805` | **feat(theater)**: implement interactive Audio Telemetry & Signal Path Inspector HUD |
| `e63634a` | **feat(theater)**: implement immersive Up Next Queue Drawer in Theater and Now Playing views |
| `8981ec7` | **fix(theater)**: resolve tsc types and clean up unused declarations in theater layouts |
| `afc5784` | **feat(theater)**: integrate Theater Mode archetypes in Settings Appearance and Fullscreen HUD |
| `f806792` | **feat(theater)**: implement EditorialPoster, PureScope, and TheaterLayoutSwitch |
| `ee1ac70` | **feat(theater)**: implement Vinyl Turntable layout with animated tonearm |
| `340e159` | **feat(theater)**: implement Hi-Fi Studio Deck layout with ballistic VU meters |
| `cbf3abc` | **feat(theater)**: implement modular StageLayout and ZenLayout |
| `368f8fe` | **feat(store)**: add theaterModeDesign state and persistence |
| `58af169` | **docs**: add implementation plan for theater mode visual archetypes |
| `e35a0f1` | **docs**: add design spec for theater mode visual archetypes |
| `9c8eca2` | **new saved**: working tree snapshot and stabilization |
| `be94f37` | **feat(audio)**: implement true gapless stream session pipeline with encoder delay trimming |
| `31425b1` | **feat(audio)**: enforce true bit-perfect mode with complete DSP bypass, unity volume, and dither suppression |
| `412caad` | **fix(audio)**: eliminate 1:53 stutter and snap-back via monotonic clock smoothing and stream pre-buffering |
| `d4e135d` | **new saved**: working tree state snapshot |
| `711c9ee` | **new saved**: baseline synchronization with origin/main |
| `6384694` | **revert(phase-3)**: revert backend DSP, SQLite pool, and taskbar changes to phase-2 baseline |
| `3eb2e9b` | **docs**: restore roadmap and emergency crash handoff documentation |
| `719bf77` | **feat(phase-6)**: restore top-level App, PlayerBar, AudioControlCenter, and style themes |
| `1d6d821` | **feat(phase-5)**: restore core views (AideoView, AlbumsView, LibraryView, FullscreenView, LyricsPanel, SettingsView) |
| `cae57a0` | **feat(phase-4)**: restore views, modals, and auxiliary tabs (AideoLab, Downloaded, CastSelector, QobuzConnect) |
| `0342913` | **test(phase-3)**: add locking test suites for playback crash guard, batch downloader, and streaming stability |
| `36a52f2` | **feat(phase-3.4)**: integrate SQLite connection pool, batch playlist downloads, and crash log reporting |
| `eea6575` | **fix(phase-3.3)**: implement mono channel upmix and planar bounds safety in audio decoding pipeline |
| `237d1ea` | **fix(phase-3.2)**: add zero-frame/rate guards in sonic analyzer and unwrap protection in WASAPI engine |
| `272d07d` | **fix(phase-3.1)**: replace intrusive taskbar HWND subclassing with safe message loop handling |
| `3f0ddd3` | **feat(phase-2)**: integrate UI safety, leaf components, smart playlists, and toast overhaul |
| `730d8bb` | **feat(phase-1)**: integrate pure utilities, DSP math, and audio math unit tests |
| `8ddad64` | **new saved**: styling polish and responsive layout fixes |
| `5d4bca0` | **new saved**: state slice refinements and audio math adjustments |
| `bb63f20` | **new files repo push**: initial integration of newly scaffolded views and utilities |
| `5572037` | **new saved**: major stability improvements, bug fixes, and feature additions |
| `2331ff4` | **docs**: preserve v0.9.5 changelog in README while highlighting v0.9.6 features |

---

## 🧪 Verification & Test Suite Status

All build, typecheck, and test gates pass with 100% success across both frontend and backend:

```bash
# 1. Frontend TypeScript Compilation Check
npx tsc --noEmit
# Result: Passed (0 errors)

# 2. Frontend Vitest Unit Test Suite
npx vitest run src/test
# Result: Passed (84 test files passed, 533 tests passed)

# 3. Backend Rust Compilation Check
cargo check --manifest-path src-tauri/Cargo.toml
# Result: Passed (0 errors)

# 4. Backend Rust Unit Test Suite
cargo test --manifest-path src-tauri/Cargo.toml
# Result: Passed (274 passed, 0 failed, 1 ignored)
```

---

## ⚠️ Known Issues & Immediate Remediation Backlog

In keeping with our strict zero-sugarcoating audit policy, the following items remain open for resolution before a public v0.9.7 binary release can be signed and distributed:

1. **Auto-Updater Contract (`H-01`)**: The custom updater in `updater.rs` expects a 64-hex SHA-256 sidecar (`.sha256` / `.sha256sum`). `updater.rs` has been patched to ignore minisign `.sig` files so they are no longer misparsed as checksums, and CI release workflows will publish official `.sha256` sidecars alongside binaries.
2. **Event System Mismatch (`M-01`)**: `qobuzSlice` and `tidalSlice` dispatch DOM `CustomEvent`s for auth failure navigation, while `App.tsx` listens via Tauri IPC `listen`.
3. **Dependency Advisories (`H-03`, `H-04`)**: Dependency audits report 9 npm advisories and 2 Cargo advisories (`h2`, `quick-xml`).
4. **Git History Credential Rotation (`C-01`, `C-02`)**: Ensure Context7 and historical Tauri private keys are permanently revoked and rotated.
