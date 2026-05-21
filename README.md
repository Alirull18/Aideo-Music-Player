# 💎 Aideo Music Player v0.6.0

**A Studio-Grade, Audiophile Music Engine with Dynamic Aesthetics, YTM AI Discovery & Real-Time Social Presence.**

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8DB?logo=tauri)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-Backend-000000?logo=rust)](https://www.rust-lang.org)

Aideo is a high-performance desktop music player engineered with **Tauri**, **Rust**, and **React**. Designed specifically for audiophiles, it prioritizes absolute signal purity and bit-perfect hardware direct transport while providing a gorgeous, glassmorphic adaptive interface.

---

## 📢 What's New in v0.6.0 (The Pro Audio & Discovery Update)

We've completely overhauled Aideo's audio pipeline and added a brand new online music discovery layer.

### 🎛️ Pro Audio Suite & Real-Time DSP Console
Take studio-grade control over your acoustic environment with our new hardware-accelerated DSP pipeline:
- **5-Band High-Fidelity Parametric EQ**: Adjust precise frequencies, gains, and Q-factors with zero audio pops or clicks.
- **AutoEQ Online Headphone Search**: Real-time integration with the official AutoEq index of over **4,000+ calibrated headphone profiles**. Search your model (e.g. *Sennheiser*, *Sony*, *AirPods*, *IEMs*) directly, download corrective curves instantly, and apply them with built-in negative pre-amplifier headroom protection.
- **10-Band Graphic EQ**: Standard ISO graphic sliders featuring quick audiophile acoustic presets (*Vocal Boost*, *Bass Boost*, *Acoustic*, etc.).
- **True Linkwitz/Chu Moy Headphone Crossfeed**: Simulates organic room loudspeaker placement. Re-injects opposite channel signals filtered at a 700Hz corner low-pass (head shadowing) and delayed by 300µs (acoustic travel time around the human head) to completely eliminate headphone listening fatigue.
- **Haas-Effect Spatializer & Early Reflections**: Extends soundstage width organically without clipping or sacrificing mono-compatibility. Combines a 5-12ms precedence delay with four phase-inverted acoustic wall reflection taps.
- **Night Mode Dynamics Compressor**: A soft 2.5:1 ratio compressor with rapid 10ms attack and natural 100ms release curves. Automatically raises soft dialogue and vocals while taming loud transients for late-night listening.
- **Butterworth Subsonic Filter**: A steep 18dB/octave high-pass filter cutting everything below 18Hz to protect high-end headphone diaphragms and reclaim valuable amplifier power.
- **EBU R128 Loudness Normalizer**: Built-in slow-moving Automatic Gain Control (AGC) that smooths out average track volume differences toward -14 LUFS.

### 🌐 YouTube Music Integration & AI Discovery Hub
Stream high-fidelity online tracks directly into your audio pipeline with advanced smart discovery:
- **YouTube 429 Scraping Bypass**: Resolves underlying streams concurrently through a local `yt-dlp` BestAudio proxy, routing audio straight to our decoder and completely avoiding IP rate locks.
- **HTTP 403 Artwork Bypass**: Direct `referrerPolicy="no-referrer"` implementation to bypass Google CDN security locks on high-resolution cover arts.
- **AI Recommendation Engine**: Tauri-powered tokio background tasks fetch recommended tracks based on your top played artists, round-robin interleaving results and screening out duplicate tracks.
- **Double-Layer Duplicate Filters**: High-performance title and ID filters cross-reference offline database tracks so your Discovery carousel contains only fresh recommendations.
- **Duration-Based Filter**: Automatically skips DJ sets, podcasts, and long compilations exceeding 1 hour.

### 🛡️ safety & Driver Hardening
- **WASAPI/CPAL Live Recovery Loop**: Unplugging or switching default audio outputs now emits a beautiful system toast and hot-plugs playback onto the new device after a 250ms driver release cooldown.
- **Rapid-Skip Queue Debouncing**: Rapidly clicking next/previous drains command channels instantly, moving to the final target track immediately while safely deferring volume and DSP settings.
- **Orphan Process Prevention**: Child `ffmpeg.exe` decoders are reaped synchronously inside our Rust execution thread to prevent zombie processes in Windows Task Manager.

---

## 📸 Screenshots

<div align="center">
  <p><b>Main Interface & Dynamic Themes</b></p>
  <img src="https://github.com/user-attachments/assets/f94cd26a-b5fe-407e-b7fe-11810d108155" alt="Main Library View" width="80%"/>
  <br/><br/>
  <p><b>High-Fidelity Lyrics & Audio Engine</b></p>
  <img src="https://github.com/user-attachments/assets/ed834062-d265-4b04-a772-4474494967c7" alt="Now Playing View" width="48%"/>
  <img src="https://github.com/user-attachments/assets/552451ee-927c-4326-89e7-07f4ae33d668" alt="Audio Settings" width="48%"/>
</div>

---

## ⚡ Quick Start (For Users)

1. **Download**: Get the latest v0.6.0 installer from the [**Releases Page**](https://github.com/Alirull18/Aideo-Music-Player/releases/latest).
2. **Install**: Run the Windows installer (`Aideo_0.6.0_x64_en-US.msi`).
3. **Launch**: Add your library directory and experience pristine, bit-perfect sound!

---

## 🛠 Build from Source (For Developers)

### Prerequisites
- **Node.js** (LTS Recommended)
- **Rust Toolchain** (latest stable via [rustup](https://rustup.rs/))
- **Git**

### Installation
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
