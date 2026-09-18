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

### 🎨 Theater Mode & UI Polish
* **High-Fidelity Fullscreen Archetypes**:
  * Enhanced **Editorial Poster Layout** with bold Swiss typography and liner notes.
  * Polished **Stage Layout** with real-time responsive ambient lighting reactive to track palette and canvas animations.
  * Integrated track telemetry and audio signal path inspector.
* **Interactive Source Switcher (`src/components/SourceMenu.tsx`)**:
  * Instant popover menu on any track card or row to switch between Local, Tidal, Qobuz, or Webstream streams, with live bitrate and format indicators.

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
* `feat(webstream)`: add native Opus direct audio pipeline with URL caching, prefetching, and duration filtering
* `feat(canvas)`: add Motion Canvas video artwork extraction, caching, and `CanvasVideoPlayer` component
* `feat(ui)`: add interactive `SourceMenu` popover with Auto/Manual selection and format badges
* `feat(settings)`: comprehensive redesign of `SettingsView.tsx` with tabs for Audio, Visualizer, Sources, and Updates
* `feat(theater)`: enhance `EditorialPosterLayout` and `StageLayout` with Canvas video backdrop integration
* `feat(lyrics)`: expand multi-tier lyrics fallback with word-by-word TTML and romanization
* `test`: add `e2e_unified_sources.test.ts` (235 tests), `milestone1_matching.test.ts`, `milestone4_queue_persistence.test.ts`, `m1_adversarial_matcher.test.ts`, `sourcePlayback.test.ts`, and `canvas.test.ts`
* `license`: update project license to GPL-3.0-or-later across repository manifests
* `chore`: bump version to v0.9.9 across `package.json`, `Cargo.toml`, `tauri.conf.json`, and documentation
