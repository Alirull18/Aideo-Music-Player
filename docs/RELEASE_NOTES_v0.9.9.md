# 💎 Aideo Music Player v0.9.9 — Reliable Unified Music Sources, Direct Webstream Playback & Motion Canvas

Welcome to **Aideo v0.9.9**! This major milestone represents the most significant audio engine and architectural upgrade in Aideo's history. Version 0.9.9 introduces the **Reliable Unified Music Sources Architecture** (connecting Local Libraries, Tidal, Qobuz, and Webstream into a unified, conflict-free catalog), native **Direct Webstream Audio Pipeline** with Opus/ffmpeg decoders, **Motion Canvas (Video Artwork Loops)** playback in Now Playing and Theater views, multi-source artwork caching, enhanced word-by-word synchronized lyrics fallback, a complete **Settings View Overhaul**, full transition to **GPL-3.0-or-later**, and an industry-grade test suite expansion to **1,107 frontend unit tests** and **315 backend tests**.

---

## 🌟 Highlights & Key Additions

### 🔗 Reliable Unified Music Sources Architecture (Milestones 1–4)
Aideo v0.9.9 completely eliminates fragmented music libraries by seamlessly uniting your local music directory with online streaming platforms (Tidal, Qobuz, and Webstream) into an intelligent, multi-source catalog:

* **Strict Recording Identity & Conservative Matching Contract (Milestone 1)**:
  * **Unicode NFKC Normalization**: Standardizes artist and title strings across international alphabets, full-width characters, and case variations.
  * **Wrapper Stripping**: Intelligently removes platform presentation tags (`- Topic`, `Official Audio`, `Official Music Video`, `Lyric Video`, `MV`) without corrupting core song titles.
  * **Version Qualifier Protection**: Strictly protects distinct editions — Acoustic, Live (venue/date), Remix, Instrumental, Radio Edit, Extended Mix, Mono/Stereo, and Remaster years — preventing different recordings from ever being accidentally conflated.
  * **3-Second Corroboration Rule**: Automatic equivalence requires matching durations within $\le 3.0$ seconds when known.
  * **ISRC Conflict & Clean/Explicit Defense**: Reject track substitutions if ISRCs conflict or if clean/explicit ratings do not match.
  * **Removal of Invented Durations**: Eliminated hardcoded 180s fallback assumptions; unknown track lengths are faithfully recorded as `null`.

* **Shared Source Discovery & Content Filtering (Milestone 2)**:
  * **Centralized Reactive Store (`src/store/sourcePlayback.ts`)**: Single source of truth shared instantaneously across Search, Home feeds, Source Picker, and Playback Queue.
  * **Progressive Search Enrichment**: Fast local and Webstream search results render immediately; late-arriving Tidal/Qobuz high-res sources enrich track cards dynamically without shifting scroll position or changing row keys.
  * **Webstream 20-Minute Cap & Non-Music Filtering**: Restricts music discovery to tracks under 1,200 seconds (20 minutes) and discards podcasts, gameplay walkthroughs, compilation mixes, and tutorials, while explicitly safeguarding genuine musical instrumentals and acoustic recordings.

* **Playback Attempt Lifecycle, Safe Fallback & Cache Isolation (Milestone 3)**:
  * **Runtime Attempt IDs (`attempt_id`)**: Every playback invocation and queue occurrence receives a cryptographically unique attempt ID, eliminating race conditions during fast next/previous track skipping.
  * **Symphonia Native Decoder Readiness Gate**: Playback status (`Playing`) and play counts trigger strictly when the native audio pipeline has successfully decoded and buffered initial frames.
  * **Safe Automatic Fallback**: If a preferred streaming service fails (e.g. expired session or offline network), Aideo immediately transitions to an equivalent verified candidate track with clear UI notification and retained preferences.
  * **Cache Key Isolation & Atomic Promotion**: Disk and memory cache keys are strictly segregated by provider and encoding format (`WebM Opus`, `M4A AAC`, `FLAC`), preventing cross-codec decoder crashes. Streaming cache downloads use `.tmp` files and are promoted via atomic filesystem renames only upon complete validation.

* **Authoritative Logical Queue & SQLite Persistence (Milestone 4)**:
  * **Queue Occurrence IDs**: Tracks in the queue are decoupled via `queue_occurrence_id`, preserving user ordering and duplicate tracks without accidental de-duplication.
  * **Native Gapless Audio Preservation**: Local-only playback queues retain their un-interrupted native gapless pipeline without unnecessary queue resets.
  * **Additive SQLite Migration**: Upgraded database persistence with backward/forward-compatible schema migrations and a durable 32-source ceiling per recording.
  * **Hardware Output Safety**: Source switching and audio preference adjustments never alter bit-perfect WASAPI Exclusive locks, sample rates, or DSP settings.

---

### ⚡ Direct Webstream Audio Pipeline
* **Direct Opus Streaming & Extraction**:
  * Stream Webstream tracks directly through the native player engine using high-efficiency Opus audio streams via ffmpeg.
* **Audio Stream URL Cache & Prefetching (`src-tauri/src/player/url_cache_tests.rs`)**:
  * In-memory and disk URL caching avoids repeated extraction overhead.
  * Background prefetching of upcoming queue tracks ensures near-instantaneous track start times.

---

### 🎬 Motion Canvas (Dynamic Video Artwork) Integration
* **Animated Video Canvas (`src-tauri/src/canvas.rs`, `src/components/CanvasVideoPlayer.tsx`)**:
  * Fetches and caches high-definition looping canvas videos for supported tracks.
  * Renders smooth video loops in Now Playing and Fullscreen/Theater Mode layouts.
  * Toggleable in Settings with hardware-accelerated video decoding.

---

### 🎨 6 Signature Home Screen Experiences & Collapsible Quick Switcher
* **6 Bespoke Architectural Layouts (`src/components/AideoView.tsx`)**:
  * **Classic**: Clean, versatile multi-shelf studio catalog with quick mix access.
  * **Horizon (`src/components/aideo/HorizonHome.tsx`)**: Dynamic visual flow featuring wide responsive hero banners, contextual pill filters, and fluid media grids.
  * **Spatial Glass (`src/components/aideo/SpatialGlassHome.tsx`)**: Liquid acrylic glass aesthetic with vibrant dynamic ambient artwork bloom and elegant typography.
  * **Editorial (`src/components/aideo/EditorialHome.tsx`)**: High-contrast Swiss magazine layout with bold serif headlines and typography-led hierarchy.
  * **Command Deck (`src/components/aideo/CommandDeckHome.tsx`)**: Pro audio engineer console displaying real-time audio statistics, meters, and compact quick-access channels.
  * **Stage (`src/components/aideo/StageHome.tsx`)**: Live arena concert aesthetic with responsive ambient lighting reacting to track palettes and video canvas.
* **Collapsible Top-Bar Layout Filter**:
  * One-click switching between layouts directly from the home header with zero reload or layout jitter.

---

### 🏆 Streaming Quality Leader & Local-Only Privacy Mode
* **Automated Quality Leader Selection (`src/utils/unifiedSources.ts`, `src/test/streamingQualityLeader.test.tsx`)**:
  * When a track is available across multiple providers, Aideo automatically resolves and streams the highest available fidelity (`Qobuz 24-bit Hi-Res` > `Tidal Max FLAC` > `Webstream Opus`) without manual intervention.
  * Interactive `SourceMenu` popover provides instant manual override with live bitrate, sample rate, and format badges.
* **1-Click Local-Only Mode (`src/test/localModeOnly.test.tsx`)**:
  * Complete privacy-first offline toggle that instantly disables all outbound network queries, guaranteeing zero telemetry and pure local playback.

---

### 📚 High-Performance Library View & Portal Action Menu
* **Decoupled Portal TrackActionMenu (`src/components/LibraryView.tsx`)**:
  * Replaced heavy per-row inline menus with a centralized, floating portal action menu (`activeMenu`).
  * Drastically reduces DOM node overhead, memory consumption, and layout recalculations.
* **Silky 60 FPS Virtualized Scrolling**:
  * Effortlessly scales to handle libraries exceeding 10,000+ tracks with zero frame drops.
  * Clean category filter chips, glass search bar, batch tag editing, and multi-track playlist actions.

---

### 🖼️ Local Artwork Engine & Sidecar Disk Caching
* **Pure Rust Embedded Cover Art Extraction (`src-tauri/src/artwork.rs`)**:
  * High-speed native extraction of embedded ID3v2, FLAC, Vorbis, and MP4 cover art directly from audio files.
* **Sidecar Disk Caching (`{stem}.jpg`)**:
  * High-resolution sidecar cache saves extracted covers to local disk alongside tracks, eliminating repetitive decoding and guaranteeing instant, stutter-free artwork loads.

---

### 📊 Universal Scrobbler (Last.fm & ListenBrainz)
* **Unified Multi-Source Scrobbling (`src/test/lastfmTidalScrobble.test.ts`)**:
  * Scrobble listening history seamlessly across Local tracks, Tidal, Qobuz, and Webstream.
  * Metadata is cleaned and normalized before transmission (stripping video suffixes like `(Official Audio)` and `- Topic`) to ensure 100% accurate match rates on Last.fm and ListenBrainz.

---

### 🔔 Interactive Toast Notification Overhaul
* **Modern Glassmorphic Toast Stack (`src/components/Toast.tsx`, `src/utils/notifications.ts`)**:
  * Sleek frosted glass notifications with animated progress bars, status icons, and interactive action buttons.
  * Real-time audio engine state alerts for WASAPI Exclusive activation, fallback transitions, and queue events.

---

### 🎛️ Settings View Overhaul
* **Reorganized Settings View (`src/components/SettingsView.tsx`)**:
  * **Audio Output & WASAPI**: Complete control over output device, Exclusive Mode, bit-perfect streaming, and buffer sizes.
  * **Audio Visualizer**: Mode switcher (Bars, Mirror, Ribbon, Halo, LED Dots), decay physics tuning, and FPS limiters (30/60/120).
  * **Music Sources**: Dedicated management cards for Local Folders, Tidal, Qobuz, and Webstream.
  * **App & Updates**: Tauri v2 cryptographic auto-updater control panel.

---

### ⚖️ Licensing
* Aideo is now officially licensed under the **GNU General Public License v3 or later** (`GPL-3.0-or-later`), ensuring user freedom and open-source guarantees.

---

## 🧪 Verification & Quality Gate

| Verification Gate | Result | Notes |
|---|---|---|
| **Frontend TypeScript Typecheck** | `PASSED (0 errors)` | `npx tsc --noEmit` across all React 19 / TS components |
| **Frontend Unit & Integration Tests** | `PASSED (1,107/1,107)` | `npx vitest run src/test` across **110 test files** (+524 tests since v0.9.8) |
| **Backend Rust Check** | `PASSED (0 errors)` | `cargo check --manifest-path src-tauri/Cargo.toml` |
| **Backend Rust Test Suite** | `PASSED (315/317)` | `cargo test --manifest-path src-tauri/Cargo.toml` (315 passed, 2 ignored, 0 failed) |
| **E2E Unified Sources Suite** | `PASSED (235/235)` | Full multi-tier integration test suite in `e2e_unified_sources.test.ts` |

---

## 📋 Detailed Commit History (v0.9.8 → v0.9.9)

* `feat(sources)`: implement Reliable Unified Music Sources architecture with M1 recording matcher, M2 discovery, M3 lifecycle, and M4 queue persistence
* `feat(home)`: add 6 signature home screen experiences (Classic, Horizon, Spatial Glass, Editorial, Command Deck, Stage) with collapsible top-bar layout switcher
* `feat(webstream)`: add native Opus direct audio pipeline with URL caching, prefetching, and duration filtering
* `feat(canvas)`: add Motion Canvas video artwork extraction, caching, and `CanvasVideoPlayer` component
* `feat(library)`: overhaul `LibraryView` with decoupled floating `TrackActionMenu` portal, filter chips, and 60 FPS virtualization
* `feat(artwork)`: add pure Rust embedded cover art reader and sidecar disk caching (`{stem}.jpg`)
* `feat(scrobble)`: implement universal Last.fm and ListenBrainz scrobbling across local and streaming sources
* `feat(toast)`: overhaul glassmorphic toast notification stack with interactive actions and animated timers
* `feat(ui)`: add interactive `SourceMenu` popover with Auto/Manual selection and format badges
* `feat(settings)`: comprehensive redesign of `SettingsView.tsx` with tabs for Audio, Visualizer, Sources, and Updates
* `feat(theater)`: enhance `EditorialPosterLayout` and `StageLayout` with Canvas video backdrop integration
* `feat(lyrics)`: expand multi-tier lyrics fallback with word-by-word TTML and romanization
* `test`: add `e2e_unified_sources.test.ts` (235 tests), `milestone1_matching.test.ts`, `milestone4_queue_persistence.test.ts`, `m1_adversarial_matcher.test.ts`, `sourcePlayback.test.ts`, `canvas.test.ts`, `horizonAndSpatialLayouts.test.tsx`, `toastOverhaul.test.tsx`, and `localArtworkRetrieval.test.ts`
* `license`: update project license to GPL-3.0-or-later across repository manifests
* `chore`: bump version to v0.9.9 across `package.json`, `Cargo.toml`, `tauri.conf.json`, and documentation
