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
- **Adaptive Theming**: The entire UI automatically shifts its color palette to match the dominant colors of your current album art
- **Glassmorphic Design**: Sleek, modern "Deep-Space" aesthetic with frosted glass effects and smooth transitions
- **Animated Focus**: Lyrics and UI elements respond with micro-animations for a "living" interface
- **Real-Time Visualizer**: Spectrum analyzers and oscilloscope visualizations (planned)

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

- **Node.js** v18 or higher – [Download](https://nodejs.org/)
- **Rust** (latest stable) – [Install via rustup](https://www.rust-lang.org/tools/install)
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

3. **Run in development mode:**
   ```bash
   npm run tauri dev
   ```

4. **Build for production:**
   ```bash
   npm run tauri build
   ```

The compiled executable will be in `src-tauri/target/release/`.

### First Run

1. Open Aideo after installation
2. Click the **Import Folder** button to add your music library
3. Aideo will scan and index your music files
4. Start playing your favorite tracks!

---

## 📖 Usage Guide

### Basic Controls

| Action | Keyboard | Mouse |
|--------|----------|-------|
| Play/Pause | `Space` | Click play button |
| Next Track | `Right Arrow` | Click next button |
| Previous Track | `Left Arrow` | Click previous button |
| Volume Up | `Ctrl + Up` | Scroll on volume slider |
| Volume Down | `Ctrl + Down` | Scroll on volume slider |
| Seek Forward | `Right Ctrl + Right` | Click on progress bar |
| Seek Backward | `Left Ctrl + Left` | Click on progress bar |

### Lyrics Feature

1. **Find Lyrics**:
   - Open the Lyrics Panel (right sidebar)
   - Click **"Find Lyrics"** to search
   - Select from search results

2. **Translation**:
   - Click the **Translate** button for non-English tracks
   - Choose your language for translation

3. **Manual Scrolling**:
   - Scroll through lyrics manually
   - Lyrics stay synced without forcing position

### Audio Settings

1. **Equalizer**:
   - Open Settings → Audio
   - Adjust 10-band parametric EQ
   - Save custom presets

2. **Output Device**:
   - Select your audio interface or DAC
   - Enable WASAPI Exclusive Mode for bit-perfect output (Windows)

3. **Sample Rate**:
   - Match your hardware's native sampling rate for best quality
   - Aideo auto-resamples if needed

---

## 🛠 Tech Stack
- **Frontend**: React, TypeScript, Framer Motion, Zustand
- **Backend**: Rust, Tauri
- **Audio**: cpal (Audio I/O), symphonia (Codecs), rubato (Resampling)
- **Database**: SQLite (via rusqlite)

---

## 📝 License

This project is licensed under the **MIT License** – see the [LICENSE](LICENSE) file for details.

This means:
- ✅ You can use it for personal and commercial projects
- ✅ You can modify and distribute the code
- ✅ You must include the license and copyright notice
- ❌ The authors are not liable for any issues

---

## 💡 Why Aideo?

- **Transparent Audio**: No compromise on sound quality
- **Modern Stack**: Rust for performance, React for beautiful UI
- **Developer-Friendly**: Open-source, well-documented codebase
- **Visually Stunning**: UI that adapts to your music
- **Feature-Rich**: Everything an audiophile needs in one app
- **Active Development**: Regular updates and new features
- **Community-Driven**: Your feedback shapes the roadmap

---

## 📊 Project Stats

- **Language**: Rust (Backend), TypeScript/React (Frontend)
- **Lines of Code**: 5,000+ (and growing!)
- **Supported Formats**: MP3, FLAC, WAV, OGG, AAC, M4A
- **Database**: SQLite with async queries
- **UI Framework**: React 18+ with modern hooks
- **Build Time**: ~2-3 minutes

---

## 🎵 For Music Lovers & Developers

Whether you're an audiophile seeking lossless playback or a developer interested in desktop app architecture, Aideo offers something for everyone. Join our community and help shape the future of music players!

---

## 🔗 Quick Links

- [📚 Architecture Documentation](docs/ARCHITECTURE.md)
- [🤝 Contributing Guide](CONTRIBUTING.md)
- [📋 Code of Conduct](CODE_OF_CONDUCT.md)
- [🐛 Report an Issue](https://github.com/Alirull18/Aideo-Music-Player/issues)
- [💡 Request a Feature](https://github.com/Alirull18/Aideo-Music-Player/discussions)

---

<div align="center">

**Made with ❤️ for music lovers and developers.**

*Aideo – The Future of Audiophile Music Players*

⭐ If you love this project, please give it a star! [Star on GitHub](https://github.com/Alirull18/Aideo-Music-Player)

</div>
