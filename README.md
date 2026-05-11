# 💎 Aideo Music Player
{here me the developer from this app .just wanna say that this app is 100% made by ai with Antigravity and for educational purpose only just wanna say that i just build this app for my personal use and learning method .I m currently a student of computer science and i hope that you all will like my app.and if there is any mistake please forgive me .thanks .}

**A High-Fidelity, Audiophile-Grade Music Engine with Dynamic Aesthetics.**

Aideo is a music player built with **Tauri**, **Rust**, and **React**. It is designed for listeners who demand signal purity, bit-perfect playback, and a modern, immersive visual experience.

---

## ✨ Key Features

### 🎧 Audiophile Core
- **Bit-Perfect Playback**: Built on `cpal` and `symphonia` for high-fidelity audio decoding.
- **WASAPI Exclusive Mode**: Bypasses the Windows audio engine for direct-to-hardware signal purity.
- **Studio-Grade EQ**: 10-band parametric equalizer with soft-limiting to prevent clipping.

### 🎨 Dynamic Visuals
- **Adaptive Theming**: The entire UI (accents, gradients, and buttons) automatically shifts its color palette to match the dominant colors of your current album art.
- **Glassmorphic Design**: A sleek, modern "Deep-Space" aesthetic with frosted glass effects and smooth transitions.
- **Animated Focus**: Lyrics and UI elements respond with micro-animations for a "living" interface.

### 📜 Smart Lyrics Engine
- **Lyric Finder**: Search and download lyrics from NetEase and QQMusic directly within the app.
- **Intelligent Auto-Focus**: Lyrics sync perfectly with the music, featuring a "Smart Scroll" that lets you browse manually without losing your place.
- **Transliteration & Translation**: One-click **Romaji** for Japanese/Korean/Chinese tracks and Google Translate integration for international music.

---

## 🗺️ Roadmap & Future Updates

### 🚀 Short-Term (V1.1 - V1.2)
- [ ] **Gapless Playback**: Implement smooth transitions between tracks for an uninterrupted listening experience.
- [ ] **ASIO Support**: Add ASIO driver support for professional-grade low-latency output.
- [ ] **Tray Integration**: Add a system tray icon with media controls and "Now Playing" notifications.
- [ ] **Global Hotkeys**: Customizable keyboard shortcuts (Play/Pause, Next/Prev) that work even when the app is minimized.

### 🎨 Visuals & UI
- [ ] **Visualizer Engine**: Add real-time spectrum analyzers and oscilloscope visualizations.
- [ ] **Folder Explorer**: A dedicated view to browse music by folder structure.
- [ ] **Mini-Player Mode**: A compact, "always-on-top" view for minimal distraction.
- [ ] **Custom Themes**: Save and share custom UI presets and EQ profiles.

### ⚙️ Technical & Performance
- [ ] **SQLite Optimization**: Improve library scanning speed for large collections (10k+ tracks).
- [ ] **DSD/SACD Support**: Native decoding for high-resolution DSD files.
- [ ] **Memory Management**: Profile and optimize memory usage during long playback sessions.
- [ ] **Cross-Platform**: Extend support to Linux (PipeWire/ALSA) and macOS (CoreAudio).

### 🐛 Known Issues & Bug Fixes
- [ ] **WASAPI Stability**: Investigating occasional "Device Busy" errors when switching sample rates.
- [ ] **Lyric Sync Drift**: Fixing minor timing offsets in long tracks (>10 mins).
- [ ] **Album Art Cache**: Improving the reliability of cached artwork retrieval after app restart.
- [ ] **Exclusive Mode Hijack**: Preventing system sounds from interrupting bit-perfect playback.

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (Latest LTS)
- [Rust](https://www.rust-lang.org/) (via rustup)

### Installation
1. **Clone the repository:**
   ```bash
   git clone https://github.com/YourUsername/Aideo_Music_Player.git
   ```
2. **Install dependencies:**
   ```bash
   npm install
   ```
3. **Run in development mode:**
   ```bash
   npm run tauri dev
   ```

---

## 🛠 Tech Stack
- **Frontend**: React, TypeScript, Framer Motion, Zustand
- **Backend**: Rust, Tauri
- **Audio**: cpal (Audio I/O), symphonia (Codecs), rubato (Resampling)
- **Database**: SQLite (via rusqlite)

---

## 📜 License
Personal Project - Built with ❤️ for music lovers.
