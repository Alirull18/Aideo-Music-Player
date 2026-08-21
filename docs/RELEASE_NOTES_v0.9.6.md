# 💎 Aideo Music Player v0.9.6 — The Audiophile Engine & Reliability Release

Welcome to **Aideo v0.9.6**! This release is a major stability, audio precision, and security update that fixes core DSP filter behaviors, eliminates playback glitches, hardens backend transactions, and delivers seamless frontend responsiveness across your entire music library.

---

## 🌟 Highlights & Key Features

### 🎧 Pure Studio Audio & Spatial Precision
* **Stereo Separation Preservation**: Fixed the spatializer dry/wet engine so stereo tracks retain 100% of their wide stereo separation and punch at default settings, without collapsing to mono.
* **True 5.1 & 7.1 Surround Mapping**: Multi-channel speaker configurations now properly route silence (`0.0`) to unassigned surround channels rather than leaking left-channel audio to center and subwoofer channels.
* **Zero-Interruption Crossfading**: Crossfade stream buffering now uses isolated decoder process pipelines, ensuring that upcoming song transitions never kill or stutter active online streams.
* **Silence Gate on Volume Normalizer**: Added an automatic silence threshold to the EBU R128 loudness normalizer, preventing sudden +6dB volume blasts when audio resumes after quiet song intros or silent tracks.
* **Micro-Click Elimination on Clock Drift**: Rubato sinc resampling preserves internal interpolation filter history during DAC clock micro-adjustments, ensuring crystal-clear high-res playback without clicks.
* **Sub-Hz Parametric Filter Protection**: Equalizer biquad filters are mathematically clamped against low sample rates and invalid Q-factors, preventing audio thread panics.

### ⚡ Seamless UI Synchronization & Performance
* **Rapid-Skip Lyric & Cover Protection**: Monotonic sequence tracking ensures that skipping tracks rapidly never leaves behind stale cover art, incorrect accents, or desynchronized lyrics from previous songs.
* **Zero GPU Canvas & Battery Leaks**: The ambient liquid background visualizer uses a single synchronized loop that automatically pauses when minimized, saving laptop battery and GPU cycles.
* **Race-Free Queue Operations**: Shuffling large playlists or triggering "Play All" is now strictly serialized through promise queues, eliminating dropped songs or queue corruption.
* **Live System & Audio Driver Alerts**: Connected backend operational events directly to the on-screen toast notification system so you're immediately informed of WASAPI fallbacks, device changes, or offline mode.
* **Accurate Large File Seeking**: Seeking through massive (>150MB) lossless audio tracks (FLAC/WAV/DSD) accurately updates the position timer without snapping back.

### 🛡️ Hardened Security & Leaner Footprint
* **Library-Confined Track Deletion**: File deletion commands now canonicalize target paths and strictly enforce boundary containment within registered music library folders to safeguard your system files.
* **Cryptographic Download Verification**: All streaming helper binaries (`yt-dlp`, `ffmpeg`) are verified against official SHA-256 checksums before execution.
* **OAuth Webview Sandboxing**: External authentication flows are sandboxed to trusted provider domains.
* **Atomic SQLite Database Safety**: Playlist modifications and loved track toggles are executed within atomic database transactions, preventing database corruption if closed unexpectedly.
* **Orphaned Code & Dependency Pruning**: Removed ~1,000 lines of obsolete components and pruned unused dependencies (`libloading`, `kpop`, `wanakana`, `@tauri-apps/plugin-updater`), making Aideo lighter and faster to load.

---

## 📥 Download & Installation

| Package | Architecture | Description |
| :--- | :--- | :--- |
| **`Aideo_0.9.6_x64_en-US.msi`** | Windows x64 | Official Windows Installer (Recommended) |
| **`Aideo_0.9.6_x64.exe`** | Windows x64 | Standalone executable |

1. Download the installer from the [**Releases Page**](https://github.com/Alirul/Aideo-Music-Player/releases/latest).
2. Run the installer and launch **Aideo**.
3. Enjoy bit-perfect, glitch-free audio playback!

---

## 🛠️ System Requirements
* **OS**: Windows 10 (1809+) or Windows 11 (64-bit)
* **Audio**: WASAPI Exclusive / DirectSound supported audio hardware
* **Memory**: ~75MB idle RAM
