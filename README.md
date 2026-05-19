# 💎 Aideo Music Player v0.5.0

**A High-Fidelity, Audiophile-Grade Music Engine with Dynamic Aesthetics & Social Presence.**

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8DB?logo=tauri)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-Backend-000000?logo=rust)](https://www.rust-lang.org)

Aideo is a high-performance desktop music player engineered with **Tauri**, **Rust**, and **React**. Designed specifically for audiophiles, it prioritizes signal purity and bit-perfect playback while delivering a modern, immersive visual experience that adapts dynamically to your music.

---

## 📸 Screenshots

<div align="center">
  <p><b>Main Interface & Dynamic Themes</b></p>
  <img src="[INSERT_MAIN_LIBRARY_SCREENSHOT_HERE]" alt="Main Library View" width="80%"/>
  <br/><br/>
  <p><b>High-Fidelity Lyrics & Audio Engine</b></p>
  <img src="[INSERT_NOW_PLAYING_SCREENSHOT_HERE]" alt="Now Playing View" width="48%"/>
  <img src="[INSERT_AUDIO_SETTINGS_SCREENSHOT_HERE]" alt="Audio Settings" width="48%"/>
</div>

---

## ✨ Key Features

### 🎧 Audio Core
- **Bit-Perfect Playback**: Leverages `cpal` and `symphonia` for low-level, high-fidelity audio decoding.
- **WASAPI Exclusive Mode**: Bypasses the Windows Audio Engine to provide direct-to-hardware signal integrity.
- **High-Fidelity Audio Engine**: (NEW v0.4.0)
  - **Lazy RAM Buffering**: Asynchronous background decoding for instantaneous playback startup.
  - **Hi-Res Upsampling**: Professional Sinc-interpolation upsampling (up to 384kHz) with hardware rate switching.
  - **TPDF Dithering**: High-precision triangular dithering to optimize noise floor on 24-bit/32-bit DACs.
  - **Buffer-Aware Sync**: Sub-millisecond lyric synchronization that accounts for hardware processing delays.
  - **Native WASAPI Fallback**: (NEW v0.5.0) Instant, panic-free recovery to the system default device if your DAC or headphones are unplugged during playback.
- **Studio-Grade DSP**: Features a 10-band parametric equalizer, spatial widening, and headphone crossfeed.
- **High-Res Identification**: Automatic visual badges for lossless formats (FLAC, WAV) and Hi-Res status.
- **Persistent Sync Memory**: Intelligent database that remembers your lyric synchronization offsets for every song.

### 🎨 Dynamic Visual Experience
- **Adaptive UI**: The interface color palette intelligently synchronizes with the dominant hues of album artwork.
- **Glassmorphic Design**: A sleek, "Deep-Space" aesthetic featuring frosted glass effects and fluid motion.
- **Micro-Animations**: Interactive elements respond with high-performance animations for a "living" interface.
- **Smart Thumbnails**: Asynchronous background loading for high-resolution library artwork.
- **Massive Performance Boost**: (NEW v0.5.0) React.memo rendering, UI virtualization, and 100x faster SQLite transactions designed to handle libraries with 10k+ tracks effortlessly. Includes a new real-time search filtering system.

- **Global Support**: Integrated Romaji generation and one-click translation for international libraries.

### 🌐 Social & Intelligent Metadata
- **Discord Rich Presence**: Show your listening status on Discord with high-quality metadata and direct "Download App" buttons.
- **MusicBrainz Magic Match**: One-click library cleaning. Instantly match your tracks with official MusicBrainz metadata to fix titles, artists, and albums.
- **Last.fm Pure Dashboard**: Real-time listening stats and recent activity delivered in a sleek, minimalist "Pure List" design.
- **Dynamic Visualizer**: High-performance, crash-resistant audio spectrum visualization optimized for Windows WebView2.
- **Network Live Streams**: (NEW v0.4.6) Play online radio station URLs natively with built-in PLS and M3U playlist parsing inside Rust.

---

## 🚀 Getting Started

### ⚡ Quick Start (For Users)
1. **Download**: Get the latest version (v0.5.0) from the [**Releases Page**](https://github.com/Alirull18/Aideo-Music-Player/releases/latest).
2. **Install**: Run the installer (`Aideo_0.5.0_x64_en-US.msi`).
3. **Launch**: Open Aideo and start importing your music library!

---

### 🛠 Build from Source (For Developers)

#### Prerequisites
- **Node.js** (LTS Recommended)
- **Rust Toolchain** (latest stable via [rustup](https://rustup.rs/))
- **Git**

#### Installation
1. **Clone the repository:**
   ```bash
   git clone https://github.com/Alirull18/Aideo-Music-Player.git
   cd Aideo-Music-Player
   ```
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Launch Development Environment:**
   ```bash
   npm run tauri dev
   ```

---

## 📖 Usage Guide

### Control Shortcuts

| Action | Keyboard | Mouse |
|--------|----------|-------|
| **Play/Pause** | `Space` | Click Play/Pause |
| **Next Track** | `Arrow Right` | Click Next |
| **Previous Track** | `Arrow Left` | Click Previous |
| **Volume Control** | `Up/Down` | Mouse Wheel on Slider |
| **Seek Position** | `Click Bar` | Drag Progress Bar |

### Setup Workflow
1. **Import Library**: On first launch, select your music directory via the "Import Folder" dialog.
2. **Indexing**: Aideo will build a local SQLite database of your collection (optimized for 10k+ tracks).
3. **Configure Audio**: Navigate to *Settings > Audio* to enable Exclusive Mode or adjust the Parametric EQ.

---

## 🗺️ Roadmap

### 🏁 Short-Term Goals
- [x] **Gapless Playback**: Native event-driven engine for seamless transitions.
- [x] **Soundstage Engine**: Psychoacoustic Mid/Side processing for spatial immersion.
- [x] **Global Media Keys**: System-wide control integration (Play/Pause/Skip).
- [x] **Persistent Sync Memory**: Automatic saving of lyric offsets per-track.
- [x] **Lyric Studio**: Workspace for manual/AI lyric integration.
- [x] **High-Res Badges**: Visual audio quality identification (FLAC/MP3).
- [x] **Auto-Updater**: One-click application updates via GitHub.
- [x] **Discord Rich Presence**: Integrated social listening status.
- [x] **MusicBrainz Integration**: Smart "Magic Match" metadata fixing.

### 🎨 UI & UX Enhancements
- [ ] **Mini-Player Mode**: A compact, always-on-top desktop widget.
- [ ] **Folder Browser**: Direct filesystem navigation.
- [x] **Visualizer Engine**: Real-time FFT spectrum visualization (Optimized v0.4.5).

### ⚙️ Performance & Core (Next-Gen)
- [x] **Bit-Perfect Bypass**: Skip all software processing when rates match.
- [x] **Lazy RAM Buffer**: Asynchronous pre-loading to eliminate I/O jitter and latency.
- [x] **High-Quality Upsampling**: Sinc-based upsampling with hardware rate negotiation.
- [x] **TPDF Dithering**: Signal decorrelation for high-bitrate DACs.
- [ ] **Event-Driven WASAPI**: Pull-based clocking for ultra-stability (Next-Gen).
- [ ] **DSD/SACD Support**: Native DSD decoding (DSF/DFF) via DoP (Next-Gen).
- [ ] **Convolution Engine**: FIR/Impulse Response loader for Headphone Correction (Next-Gen).
- [ ] **Neural Reconstruction**: AI-based high-frequency restoration for compressed audio (Next-Gen).


---

## 🛠 Tech Stack
- **Frontend**: React 19, TypeScript, Framer Motion, Zustand
- **Backend**: Rust (Tauri 2.0 Framework)
- **Audio Engine**: `cpal` (I/O), `symphonia` (Codecs), `rubato` (Resampling)
- **Database**: SQLite (via `rusqlite`)

---

## 👨‍💻 Note from the Developer

> This project is a labor of love, developed as an educational journey into high-performance desktop application architecture and digital signal processing. As a Computer Science student, I built Aideo to explore the intersection of Rust's safety/performance and modern UI design. It is 100% AI-assisted (built with Antigravity), serving as a testament to how modern tools can accelerate specialized software development.
> 
> — **Alirul**

---

## 📝 License
Distributed under the **MIT License**. See `LICENSE` for more information.

---

<div align="center">

**Crafted with ❤️ for the Audiophile Community.**

⭐ *If you find this project useful, please consider giving it a star on [GitHub](https://github.com/Alirull18/Aideo-Music-Player)!*

</div>