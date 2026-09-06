# 💎 Aideo Music Player v0.9.8 — Aideo Connect Mobile Remote, Official Tauri v2 Updater & Next-Gen Discovery Hubs

Welcome to **Aideo v0.9.8**! This release delivers transformative additions to the Aideo desktop listening experience, introducing the all-new **Aideo Connect Mobile Remote** with instant QR pairing and touch web controls, the official **Tauri v2 Cryptographic Auto-Updater** with live percentage download progress and Minisign verification, next-generation **Editorial & Stage Discovery Hubs** backed by hardware-accelerated styling, an expanded **Studio Audio Visualizer Engine** with 5 hardware-calibrated ballistic modes, essential **Tidal streaming transport fixes**, and an expanded verification suite of **583 frontend unit tests** and **270 backend tests**.

---

## 🌟 Highlights & Key Additions

### 📱 Aideo Connect Mobile Remote & Instant QR Code Pairing
Transform your smartphone or tablet into a wireless studio remote control for Aideo without installing any mobile app:
* **Built-In Responsive Web Controller (`src-tauri/src/remote_server.rs`)**:
  * An embedded HTTP & WebSocket server serves a mobile-optimized web application to any browser on your local Wi-Fi network.
  * Full touch transport controls: Play/Pause, Next, Previous, responsive Seek scrubbing slider with live timestamps, and Volume slider.
  * Shuffle and Repeat toggle buttons with real-time synchronized state.
  * Live synchronized track metadata (title, artist, album, duration) and album art streaming via base64 data-URL proxying (`ActiveRemoteMetadata`).
* **Frictionless 6-Digit PIN Pairing (`get_or_init_pin`)**:
  * Replaced awkward 32-character hexadecimal hashes with a clean 6-digit numeric PIN for effortless manual entry.
  * **Timing-Attack Hardened (`constant_time_eq`)**: Validates pairing PINs using constant-time byte comparisons to eliminate timing side-channel attacks.
* **Instant QR Code Scanning (`src/components/LocalQRCode.tsx`, `qrcode.react`)**:
  * Desktop display renders an SVG QR code encoding the local connection URL with embedded authentication token.
  * Point your phone's camera at the screen for 1-second instant pairing and playback control.
  * One-click "Copy URL" button with clear copied visual feedback.
* **Resilient LAN IP Subnet Probing (`get_local_ip`)**:
  * Multi-target outbound UDP socket probing determines the true local LAN IPv4 address (filtering out `0.0.0.0`, loopback, and virtual adapter interfaces).

---

### 🔄 Official Tauri v2 Cryptographic Auto-Updater
* **Plugin Migration (`@tauri-apps/plugin-updater` & `tauri-plugin-process`)**:
  * Replaced custom, legacy updater logic with the official Tauri v2 updater ecosystem, fully integrated into the Windows desktop runtime.
  * Cryptographic integrity verified using Minisign public key signatures against official GitHub Releases manifests (`https://github.com/Alirull18/Aideo-Music-Player/releases/latest/download/latest.json`).
* **Stateful Updater Store (`src/store/updaterStore.ts`)**:
  * Clean Zustand store tracking real-time updater states: `idle`, `checking`, `available`, `up-to-date`, `downloading`, `downloaded`, and `error`.
  * Real-time download progress with exact percentage and downloaded/total byte counters (e.g. `14.2 MB / 52.8 MB`).
  * Atomic auto-relaunch after update download finishes via `relaunch()` from `@tauri-apps/plugin-process`.
* **Polished In-App UI (`src/App.tsx`, `src/components/SettingsView.tsx`)**:
  * Dedicated Update Modal displaying version tags, release changelogs, live download progress bar, and single-click installation.
  * Updates card in Settings with manual "Check for Updates" button, current version indicators, and release notes links.

---

### 📰 Discovery Hub (Aideo Home) Next-Gen Redesigns
* **Editorial Home (`src/components/aideo/EditorialHome.tsx`)**:
  * Swiss magazine visual direction featuring high-contrast editorial typography, expansive featured hero banners, bento album cards, and fluid micro-interactions.
* **Stage Home (`src/components/aideo/StageHome.tsx`)**:
  * Concert stage aesthetic with real-time ambient lighting canvas reflecting the energy and mood of playing tracks.
* **GPU-Accelerated CSS Architecture (`src/components/aideo/home.css`)**:
  * Over 730 lines of bespoke, hardware-accelerated animations, glassmorphic card overlays, responsive breakpoints, and smooth hover elevation states.

---

### 🌊 Studio Audio Visualizer Engine & Settings
* **5 Hardware-Inspired Ballistic Modes (`src/components/Visualizer.tsx`)**:
  * **Studio Peak-Decay Bars (`bars`)**: 64 high-resolution frequency bars with independent floating peak caps governed by gravity physics (`0.15px/frame`) and a 12-frame peak hold.
  * **Bilateral Mirror Spectrum (`mirror`)**: Centered symmetrical frequency spectrum analyzer mirrored across the horizontal midline.
  * **Analog Oscilloscope Ribbon (`wave`)**: Continuous Bezier wave spline with ambient glow bloom and analog drift simulation.
  * **Radial Halo Orbit (`circle`)**: Circular halo ring reacting dynamically to bass transients.
  * **Phosphor LED Dot-Matrix (`dots`)**: Vintage Japanese rack equipment spectrum analyzer with discrete glowing pill LEDs.
* **Ambient Idle Breathing & Physics Decay**:
  * Exponential level decay on pause (`* 0.88`) prevents jarring canvas cutoffs.
  * Minimalist resting baseline during pause/stop transitions dropping CPU/GPU utilization to 0%.
* **Adaptive 64px / 140px Container & Quick Toggle (`src/components/NowPlayingView.tsx`)**:
  * Compact docked height with 1-click expander toggle to 140px panoramic stage view.
* **Dedicated Audio Visualizer Settings (`src/components/SettingsView.tsx`)**:
  * Style selector chips, decay profile tuning (Snappy / Balanced / Silky), 30/60/120 FPS limiter, and player bar toggle visibility.

---

### ⚡ Tidal Streaming Stability Fixes
* **Stream EOF Stall Elimination (`fix(player): commit d096ed5`)**:
  * Resolved an issue where Tidal stream playback would stall on EOF at track boundary without triggering continuous progression to the next track in the queue.
* **Proactive Token Refresh Lifecycle (`fix(tidal): commit d392d12`)**:
  * Implemented token expiry handling to refresh stream access tokens automatically, preventing authorization failures during extended listening sessions.

---

### 🧭 Navigation & UI Ergonomics Polish
* **Floating Scroll to Top Button (`src/components/ScrollToTopButton.tsx`)**:
  * Spring-animated floating action button with smooth scroll position threshold detection across all scrollable containers (`data-scroll-container="true"`).
* **Interactive Now Playing Artwork Flip (`src/components/NowPlayingView.tsx`)**:
  * Click-to-flip interaction between large album sleeve artwork and track technical telemetry / signal path specs.
* **Cast & Remote Selector Polish (`src/components/CastSelector.tsx`)**:
  * Refined cast device picker and feedback animations.

---

## 🧪 Verification & Test Suite Metrics

| Verification Gate | Result | Notes |
|---|---|---|
| **Frontend TypeScript Typecheck** | `PASSED (0 errors)` | `npx tsc --noEmit` across entire React/TS application |
| **Frontend Unit & Integration Tests** | `PASSED (583/583)` | `npx vitest run src/test` across **90 test files** (+50 tests since v0.9.7) |
| **Backend Rust Check** | `PASSED (0 errors)` | `cargo check --manifest-path src-tauri/Cargo.toml` |
| **Backend Rust Test Suite** | `PASSED (269/270)` | `cargo test --manifest-path src-tauri/Cargo.toml` (269 passed, 1 ignored) |
| **Security & Timing Defense** | `PASSED` | Constant-time PIN comparison; Minisign updater signature verification |

---

## 📋 Detailed Commit History (v0.9.7 → v0.9.8)

* `feat(updater)`: integrate official `@tauri-apps/plugin-updater` and `tauri-plugin-updater` with Minisign verification and `updaterStore`
* `feat(remote)`: overhaul `remote_server.rs` with mobile web controller, 6-digit PIN, constant-time verification, and real-time metadata/cover streaming
* `feat(remote)`: add `LocalQRCode.tsx` with dynamic QR code pairing and copyable LAN connection URL
* `feat(home)`: redesign Discovery Hub with Editorial Home and Stage Home layouts and hardware-accelerated `home.css`
* `feat(visualizer)`: overhaul visualizer engine with 5 styles, peak-decay gravity physics, and adaptive 64px/140px container
* `feat(settings)`: add Audio Visualizer settings card and Tauri v2 Updater management card to `SettingsView.tsx`
* `fix(player)`: resolve Tidal stream EOF hang and ensure continuous track progression (`d096ed5`)
* `fix(tidal)`: prevent stream token expiry and enable reliable track transitions (`d392d12`)
* `feat(ui)`: add spring-animated floating `ScrollToTopButton` with view-specific container tracking
* `feat(ui)`: add interactive artwork flip in `NowPlayingView` with track telemetry inspection
* `test`: add `aideoConnect.test.ts`, `localQRCode.test.tsx`, `scrollToTopButton.test.tsx`, `aideoHomeRedesigns.test.tsx`, `visualizer.test.ts`, and migrate `updater.test.tsx`
* `chore`: bump version to v0.9.8 across package.json, Cargo.toml, tauri.conf.json, and documentation manifests

---

*Thank you for listening with Aideo Music Player. Enjoy pure, uncompromised sound!*
