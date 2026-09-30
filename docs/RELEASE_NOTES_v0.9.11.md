# 💎 Aideo Music Player v0.9.11 — WASAPI Clock Diagnostics, Infinite Radio Overhaul, Streaming Token Lifecycle & WinGet Automation

Welcome to **Aideo v0.9.11**! This milestone delivers critical reliability and precision upgrades across the audio playback core, an intelligent overhaul of our Infinite Autoplay Radio recommendation engine, seamless background Tidal session auto-restoration, hardware-verified WASAPI Exclusive clock diagnostics, UPnP/DLNA streaming protocol integration, and automated WinGet package distribution.

---

## 🌟 Highlights & Key Additions

### 🔊 WASAPI Exclusive Hardware Clock Diagnostics & Strict Bit-Perfect Telemetry (`src-tauri/src/wasapi_engine.rs`, `src/components/AudioControlCenter.tsx`)
* **Hardware Device Clock Alignment (`IAudioClock`)**:
  - Implemented 5-second sampling rate diagnostic windows logged directly to `%APPDATA%/com.alirul.music-player/logs/aideo.log`.
  - Compares frames written per elapsed wall-clock second against negotiated DAC sample rates and WASAPI device-clock position deltas, detecting clock drift and sample rate mismatch without guessing.
* **Transparent Audio Telemetry & Signal Path Inspector**:
  - Displays the active output route, source/output formats, applied transformations, and exact reason codes whenever strict bit-perfect mode is bypassed.
  - Clarified software-derived bit-perfect verification indicators in the Audio Control Center and Theater Signal Path HUD.

---

### 🧭 Infinite Autoplay Radio & Queue Progression Overhaul (`src/store/playbackSlice.ts`, `src-tauri/src/youtube/mod.rs`, `src/test/autoplayRadio.test.ts`)
* **Multi-Tier Recommendation Fallback Cascade**:
  - Recommendation engine now traverses Last.fm track similarities -> related artist discographies -> seed artist top catalog.
* **Seed Affinity Scoring & Slop Filtering**:
  - Strict candidate scoring penalizes non-music artifacts, spoken-word tracks, low-fidelity bootlegs, and live clutter.
  - Dynamic skip and recently-played penalty matrix prevents looping or repetitive queue injection.
* **Intelligent Queue Handling**:
  - **Repeat-One Preservation**: Repeating a track no longer drains or pollutes upcoming radio recommendations.
  - **Manual Queue Priority**: Explicit user queues and curated mixes always execute ahead of dynamic radio suggestions.
  - **Auto-Refill**: Seamlessly fetches new candidates in the background when the upcoming queue runs thin, stopping gracefully if recommendations are exhausted.

---

### 🌊 Tidal Stream Lifecycle & Automatic Session Bootstrap (`src-tauri/src/tidal.rs`, `src/App.tsx`, `src/test/tidalBootstrap.test.tsx`)
* **App Boot Session Auto-Restoration**:
  - Verifies and restores authenticated Tidal sessions immediately on application boot without requiring the user to open Settings.
* **Stream Token Auto-Refresh & Expiry Gates**:
  - Token refresh cooldown gates and active stream token refreshing mitigate HTTP 401/403 expiry and eliminate stream EOF hangs during multi-hour listening sessions.
* **Strict Continuous Track Progression**:
  - Audio pipeline ensures remote streaming tracks transition smoothly into subsequent queue items.

---

### 🛡️ Playback Lifecycle State Machine & Atomic Stop Race Guard (`src-tauri/src/player/mod.rs`, `src-tauri/src/player/playback_lifecycle_tests.rs`)
* **Atomic Stop-Button Race Guard**:
  - Eliminated race conditions between asynchronous frontend stop dispatches and background buffer drains, completely preventing accidental track resurrection.
* **Correlation ID Event Tracking (`attempt_id`)**:
  - Tauri IPC events (`track-ended`, `playback-error`, `track-transitioned`, `stream-buffering-start`, `stream-buffering-end`) carry track attempt identifiers to immediately discard stale events from superseded tracks.
* **Process Lifecycle Safety**:
  - Explicit child process cancellation tokens and teardown guards prevent orphan processes during rapid track skipping.

---

### 📡 UPnP / DLNA Network Audio Casting Protocol Bridge (`src-tauri/src/lib.rs`, `src/test/upnpStreamer.test.ts`)
* **Native UPnP/DLNA Casting**:
  - Implemented AVTransport and RenderingControl protocol bridges for high-fidelity audio casting to DLNA/UPnP network receivers.
  - Device discovery, metadata XML generation, and HTTP byte-range streaming for seamless remote hi-fi playback.

---

### 📦 Official WinGet Automation & Distribution Hardening (`.github/workflows/winget.yml`, `.github/workflows/publish.yml`)
* **Automated WinGet Package Updates**:
  - GitHub Actions workflow (`winget.yml`) automatically pushes package manifests to the Microsoft Windows Package Manager Community Repository upon release (`winget install Alirul.Aideo`).
* **CI/CD Secrets Propagation**:
  - Release workflows now propagate Supabase configuration (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) for secure cloud sync and authentication in production builds.
* **Pillar 4 Roadmap**:
  - Outlined extensible pluggable song sources and unified discovery card architecture (`sourceProviders.ts`, `SourceBadge`) in `AIDEO_ROADMAP.md`.

---

## 🧪 Verification & Quality Gate

| Verification Gate | Result | Notes |
|---|---|---|
| **Frontend TypeScript Typecheck** | `PASSED (0 errors)` | `npx tsc --noEmit` across all React 19 / TS components |
| **Frontend Unit & Integration Tests** | `PASSED (1,204/1,204)` | `npx vitest run src/test` across **116 test files** (100% passing) |
| **Backend Rust Check** | `PASSED (0 errors)` | `cargo check --quiet --manifest-path src-tauri/Cargo.toml` |
| **Backend Rust Test Suite** | `PASSED (341/345)` | `cargo test --quiet --manifest-path src-tauri/Cargo.toml` (341 passed, 4 ignored [2 live network, 2 host audio device], 0 failed) |

---

## 📋 Detailed Commit History (v0.9.10 → v0.9.11)

* `feat(wasapi)`: implement hardware device clock diagnostics (`IAudioClock`) with 5-second rate window logging and bit-perfect telemetry verification
* `feat(radio)`: overhaul infinite autoplay radio with multi-tier recommendation cascade, seed affinity scoring, and repeat-one preservation
* `feat(tidal)`: add automatic session bootstrap on startup, token auto-refresh cooldown gates, and stream EOF hang mitigation
* `feat(player)`: implement atomic stop race guard and correlation ID (`attempt_id`) tracking across playback lifecycle events
* `feat(upnp)`: add native UPnP / DLNA streaming protocol bridge with device discovery and AVTransport control
* `feat(ci)`: add automated WinGet release workflow and propagate Supabase environment variables in release builds
* `docs`: update README, DISTRIBUTION_GUIDE, AIDEO_ROADMAP, and website for v0.9.11
* `test`: add `autoplayRadio.test.ts`, `tidalBootstrap.test.tsx`, `upnpStreamer.test.ts`, and `playback_lifecycle_tests.rs`
* `chore`: bump version to v0.9.11 across `package.json`, `Cargo.toml`, and `tauri.conf.json`
