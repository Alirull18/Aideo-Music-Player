# 💎 Aideo Music Player

[![CI/CD Pipeline](https://github.com/Alirull18/Aideo-Music-Player/workflows/CI%2FCD%20Pipeline/badge.svg)](https://github.com/Alirull18/Aideo-Music-Player/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub Stars](https://img.shields.io/github/stars/Alirull18/Aideo-Music-Player?style=social)](https://github.com/Alirull18/Aideo-Music-Player)
[![GitHub Forks](https://img.shields.io/github/forks/Alirull18/Aideo-Music-Player?style=social)](https://github.com/Alirull18/Aideo-Music-Player)

**A High-Fidelity, Audiophile-Grade Music Engine with Dynamic Aesthetics.**

Aideo is a premium music player built with **Tauri**, **Rust**, and **React**. Engineered for audiophiles and music enthusiasts who demand bit-perfect playback, advanced audio processing, and a visually stunning interface that adapts to your music.

---

## ✨ Key Features

### 🎧 Audiophile Core
- **Bit-Perfect Playback**: Built on `cpal` and `symphonia` for lossless, transparent audio decoding
- **WASAPI Exclusive Mode**: Bypasses the Windows audio engine for direct-to-hardware signal purity
- **Studio-Grade EQ**: 10-band parametric equalizer with soft-limiting to prevent clipping and distortion
- **Multi-Format Support**: MP3, FLAC, WAV, OGG, AAC, and more via Symphonia
- **High-Resolution Ready**: Supports 24-bit and 32-bit audio (DSD/SACD coming soon)

### 🎨 Dynamic Visuals
- **Adaptive Theming**: The entire UI automatically shifts its color palette to match the dominant colors of your current album art
- **Glassmorphic Design**: Sleek, modern "Deep-Space" aesthetic with frosted glass effects and smooth transitions
- **Animated Focus**: Lyrics and UI elements respond with micro-animations for a "living" interface
- **Real-Time Visualizer**: Spectrum analyzers and oscilloscope visualizations (planned)

### 📜 Smart Lyrics Engine
- **Lyric Finder**: Search and download lyrics from NetEase and QQMusic directly within the app
- **Intelligent Auto-Focus**: Lyrics sync perfectly with the music, featuring smart scrolling
- **Transliteration & Translation**: 
  - One-click **Romaji** for Japanese/Korean/Chinese tracks
  - Google Translate integration for international music
- **Lyric Cache**: Offline access to previously loaded lyrics

### 📚 Library Management
- **Fast Library Scanning**: SQLite-optimized indexing for 10k+ tracks
- **Advanced Metadata**: Browse by artist, album, genre, year, or folder structure
- **Playlist Support**: Create, manage, and organize custom playlists
- **Recent Plays Tracking**: Keep track of your favorite listening history

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

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Desktop Framework** | Tauri | Lightweight native app wrapper |
| **Frontend** | React + TypeScript | Reactive UI with type safety |
| **UI Animation** | Framer Motion | Smooth, performant animations |
| **State Management** | Zustand | Lightweight global state |
| **Backend** | Rust | High-performance audio processing |
| **Audio I/O** | cpal | Cross-platform audio device access |
| **Audio Codecs** | symphonia | Multi-format decoding (FLAC, MP3, WAV, OGG, AAC) |
| **Resampling** | rubato | High-quality audio resampling |
| **Database** | SQLite | Fast local music library storage |
| **Styling** | Tailwind CSS | Utility-first CSS framework |

---

## 🏗️ Architecture

For a detailed overview of the system architecture, see [**ARCHITECTURE.md**](docs/ARCHITECTURE.md), which covers:

- System design and data flow
- Audio pipeline explanation
- Library management & database schema
- Theming system implementation
- Tauri IPC commands
- Performance optimizations

### Quick Overview

```
User Interface (React/TypeScript)
         ↓
    Tauri IPC Bridge
         ↓
  Rust Backend
    ├── Audio Pipeline (WASAPI/cpal)
    ├── Codec Decoder (symphonia)
    ├── Lyrics Engine (NetEase/QQMusic)
    └── Database (SQLite)
         ↓
Audio Device & External APIs
```

---

## 📋 Roadmap

### 🚀 Short-Term (V1.1 - V1.2)
- [ ] **Gapless Playback**: Seamless transitions between tracks
- [ ] **ASIO Support**: Professional low-latency output (Windows)
- [ ] **Tray Integration**: System tray icon with media controls
- [ ] **Global Hotkeys**: Customizable keyboard shortcuts (works when minimized)
- [ ] **Playlist Management**: Enhanced playlist organization and sharing

### 🎨 Visuals & UI
- [ ] **Visualizer Engine**: Real-time spectrum analyzers and oscilloscope displays
- [ ] **Folder Explorer**: Browse music by directory structure
- [ ] **Mini-Player Mode**: Compact, always-on-top window
- [ ] **Custom Themes**: Save and share custom UI presets and EQ profiles
- [ ] **Dark/Light Mode**: Automatic theme switching based on system preferences

### ⚙️ Technical & Performance
- [ ] **DSD/SACD Support**: Native decoding for high-resolution files
- [ ] **Memory Optimization**: Profile and optimize for long listening sessions
- [ ] **Cross-Platform**: Linux (PipeWire/ALSA) and macOS (CoreAudio) support
- [ ] **Metadata Editing**: Edit ID3 tags and FLAC metadata
- [ ] **Scrobbling**: Last.fm integration

### 🐛 Known Issues & Bug Fixes
- [ ] **WASAPI Stability**: Occasional "Device Busy" errors with sample rate switching
- [ ] **Lyric Sync Drift**: Minor timing offsets in long tracks (>10 minutes)
- [ ] **Album Art Cache**: Improving reliability after app restart
- [ ] **Exclusive Mode Hijack**: System sounds interrupting bit-perfect playback

---

## 📦 Building & Deployment

### Development Build

```bash
# Start development server with hot reload
npm run tauri dev
```

### Production Build

```bash
# Build optimized release executable
npm run tauri build
```

Output location:
- **Windows**: `src-tauri/target/release/bundle/msi/`
- **macOS**: `src-tauri/target/release/bundle/macos/`
- **Linux**: `src-tauri/target/release/bundle/deb/` (or AppImage)

### Code Quality

```bash
# Format Rust code
cargo fmt

# Lint Rust code
cargo clippy

# Format TypeScript/React
npm run format

# Lint TypeScript/React
npm run lint

# Run all tests
cargo test && npm run test
```

---

## 🤝 Contributing

We welcome contributions from the community! Whether it's bug fixes, new features, documentation, or translations, your help is greatly appreciated.

### Getting Started with Contributing

1. **Fork the repository** and clone your fork
2. **Create a feature branch**: `git checkout -b feature/your-feature`
3. **Make your changes** following our [CONTRIBUTING.md](CONTRIBUTING.md) guidelines
4. **Test thoroughly** on multiple audio formats and devices
5. **Submit a Pull Request** with a clear description

### Contribution Guidelines

For detailed guidelines on:
- Code style and conventions
- Testing requirements
- Commit message formats
- Pull request process

See [**CONTRIBUTING.md**](CONTRIBUTING.md).

### Areas We Need Help With

- 🐛 **Bug Fixes**: Help squash existing issues
- ✨ **New Features**: Implement features from the roadmap
- 📚 **Documentation**: Improve guides and API docs
- 🌍 **Translations**: Add support for new languages
- 🧪 **Testing**: Test on different OS and audio devices

---

## 🙋 Support & Community

- **Report Bugs**: [Open an Issue](https://github.com/Alirull18/Aideo-Music-Player/issues/new?template=bug_report.yml)
- **Request Features**: [Create a Feature Request](https://github.com/Alirull18/Aideo-Music-Player/issues/new?template=feature_request.yml)
- **Ask Questions**: [GitHub Discussions](https://github.com/Alirull18/Aideo-Music-Player/discussions)
- **Contact**: azrul18work@gmail.com

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
