# 💎 Aideo Music Player

**A High-Fidelity, Audiophile-Grade Music Engine with Dynamic Aesthetics.**

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8DB?logo=tauri)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-Backend-000000?logo=rust)](https://www.rust-lang.org)

Aideo is a high-performance desktop music player engineered with **Tauri**, **Rust**, and **React**. Designed specifically for audiophiles, it prioritizes signal purity and bit-perfect playback while delivering a modern, immersive visual experience that adapts dynamically to your music.

---

## 📸 Screenshots

<div align="center">
  <p><b>Main Interface & Dynamic Themes</b></p>
  <img src="<img width="1918" height="1137" alt="Screenshot 2026-05-11 134651" src="https://github.com/user-attachments/assets/16daf271-533c-4485-a6fc-baf3ade720e4" />"/>
  <br/><br/>
  <p><b>High-Fidelity Lyrics & Audio Engine</b></p>
  <img src="<img width="1918" height="1142" alt="Screenshot 2026-05-11 134716" src="https://github.com/user-attachments/assets/b1f80bfc-551e-4317-ae64-d5772728968d" />"/>
  <img src="<img width="1918" height="1142" alt="Screenshot 2026-05-11 134716" src="https://github.com/user-attachments/assets/b1f80bfc-551e-4317-ae64-d5772728968d" />"/>
</div>

---

## ✨ Key Features

### 🎧 Audio Core
- **Bit-Perfect Playback**: Leverages `cpal` and `symphonia` for low-level, high-fidelity audio decoding.
- **WASAPI Exclusive Mode**: Bypasses the Windows Audio Engine to provide direct-to-hardware signal integrity.
- **Studio-Grade DSP**: Features a 10-band parametric equalizer with real-time soft-limiting to prevent digital clipping.
- **High-Res Support**: Native support for lossless formats including FLAC, WAV, and ALAC.

### 🎨 Dynamic Visual Experience
- **Adaptive UI**: The interface color palette intelligently synchronizes with the dominant hues of current album artwork.
- **Glassmorphic Design**: A sleek, "Deep-Space" aesthetic featuring frosted glass effects and fluid motion.
- **Micro-Animations**: Interactive elements and lyrics respond with subtle, high-performance animations for a "living" interface.
- **Real-Time Visualization**: Integrated spectrum analyzers and oscilloscope views (Experimental).

### 📜 Intelligent Metadata & Lyrics
- **Smart Lyric Engine**: High-speed retrieval from multiple global providers with perfect synchronization.
- **Automated Focus**: Smart-scrolling logic that maintains sync while allowing manual browsing.
- **Global Support**: Integrated transliteration (Romaji/Pinyin) and one-click translation for international libraries.

---

## 🚀 Getting Started

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

4. **Build Production Binary:**
   ```bash
   npm run tauri build
   ```
   *The executable will be located in `src-tauri/target/release/`.*

---

## 📖 Usage Guide

### Control Shortcuts

| Action | Keyboard | Mouse |
|--------|----------|-------|
| **Play/Pause** | `Space` | Click Play/Pause |
| **Next Track** | `Right Arrow` | Click Next |
| **Previous Track** | `Left Arrow` | Click Previous |
| **Volume Control** | `Ctrl + Up/Down` | Mouse Wheel on Slider |
| **Seek Position** | `Ctrl + Left/Right` | Click Progress Bar |

### Setup Workflow
1. **Import Library**: On first launch, select your music directory via the "Import Folder" dialog.
2. **Indexing**: Aideo will build a local SQLite database of your collection (optimized for 10k+ tracks).
3. **Configure Audio**: Navigate to *Settings > Audio* to enable Exclusive Mode or adjust the Parametric EQ.

---

## 🗺️ Roadmap

### 🏁 Short-Term Goals
- [ ] **Gapless Playback**: Native event-driven engine for seamless transitions.
- [ ] **ASIO Support**: Professional-grade driver support for low-latency interfaces.
- [ ] **Global Media Keys**: System-wide control integration even when minimized.

### 🎨 UI & UX Enhancements
- [ ] **Mini-Player Mode**: A compact, always-on-top desktop widget.
- [ ] **Folder Browser**: Direct filesystem navigation for unorganized libraries.
- [ ] **Custom Theme Engine**: User-definable CSS variables for personalized styling.

### ⚙️ Performance & Core
- [ ] **DSD/SACD Support**: Native DSD decoding (DSF/DFF).
- [ ] **Memory Optimization**: Enhanced buffer management for long-duration playback.
- [ ] **Cross-Platform Support**: Implementation for macOS (CoreAudio) and Linux (PipeWire).

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
