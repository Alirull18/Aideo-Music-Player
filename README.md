# 💎 Aideo Music Player v0.7.1

**A Studio-Grade, Audiophile Music Engine with Dynamic Aesthetics, YTM AI Discovery & Real-Time Social Presence.**

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8DB?logo=tauri)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-Backend-000000?logo=rust)](https://www.rust-lang.org)

Aideo is a high-performance desktop music player engineered with **Tauri**, **Rust**, and **React**. Designed specifically for audiophiles, it prioritizes absolute signal purity and bit-perfect hardware direct transport while providing a gorgeous, glassmorphic adaptive interface.

---

## 📸 Screenshots & UI Showcase

<div align="center">
  <p align="center">
    <strong>Immersive Fullscreen HUD & Ambient Liquid Art</strong>
    <br />
    <img width="1918" height="1113" alt="Screenshot 2026-05-30 140713" src="https://github.com/user-attachments/assets/b9fd5154-604e-4538-8f22-9a19e0497461" />
  </p>
  <br />
  
  <table width="100%">
    <tr>
      <td width="50%" align="center">
        <strong>Aideo Lab: Pro DSP & EQ Graph</strong>
        <br />
        <img width="1918" height="1115" alt="Screenshot 2026-05-30 141042" src="https://github.com/user-attachments/assets/b1035ae9-7ae2-4d26-9fdd-810c5d82d02f" />
      </td>
      <td width="50%" align="center">
        <strong>Pristine Library Dashboard</strong>
        <br />
        <img width="1918" height="1115" alt="Screenshot 2026-05-30 140809" src="https://github.com/user-attachments/assets/71f7328e-5f57-4783-8df5-47194fc8dd98" />
      </td>
    </tr>
    <tr>
      <td width="50%" align="center">
        <strong>🧙 Hardware Latency Onboarding</strong>
        <br />
        <img width="1918" height="1116" alt="Screenshot 2026-05-30 140741" src="https://github.com/user-attachments/assets/cfc693d1-eda4-4ef7-87bc-0af18680f212" />
      </td>
      <td width="50%" align="center">
        <strong>🔌 Visual Plugins Installer</strong>
        <br />
        <img width="1918" height="1116" alt="Screenshot 2026-05-30 140741" src="https://github.com/user-attachments/assets/481b56df-9c79-4ad9-959c-3f1b0bfae71e" />
      </td>
    </tr>
  </table>
</div>

---

## 📢 What's New in v0.7.1 (The Auto-Updater & Manual Fallback Update)

### 🚀 Auto-Updater & Process Launcher Hardening
- **Windows Escaping Resolution**: Uses Windows-native `.raw_arg()` process-spawning logic to pass target commands directly to `cmd.exe /C`, resolving the folder path backslash/network-escaping bug that crashed the auto-updater under prior environments.
- **Interactive Manual Fallback UI**: Dynamically transforms the updater dialog into an error fallback UI showing the direct exception trace and presenting manual browser download links if local installation routines are blocked.

### 🎨 Advanced Cover Art Manager & Upload Center (from v0.7.0)
- **iTunes High-Res Search Integration**: Keyless, high-fidelity online cover lookup resolving global and K-Pop artists (e.g. *IVE*, *ive iam*) instantly with 600x600px high-definition graphics.
- **Track-Specific Naming**: Saves covers as `{track_filename}.jpg/png` alongside songs instead of a folder-wide generic `cover.jpg` file, fully preventing artwork leakages in flat folders.
- **Generic Album Fallbacks**: Intelligently auto-resolves generic directory cover images (`cover.jpg`, `folder.png`, etc.) if no embedded tag images are present.
- **Drag-and-Drop / Browse Uploads**: Supports local drag-and-drop drops of custom cover sleeve images straight onto the modal view.

### 🔔 Custom Notifications & Diagnostic Settings
- **Notifications Muting Center**: Added toggles in settings to completely enable or disable all real-time overlay toast alerts across the player.
- **Developer Diagnostics Mode**: Prepend internal backend function contexts (e.g., `Audio Engine (player.rs)`, `MagicMatch Metadata (scanner.rs)`) and raw exception trace codes to error logs in an elegant monospace font container.
- **Consumer Friendly Formatting**: Dynamically translates highly technical system and driver errors into readable, reassuring, and helpful consumer descriptions.### 📺 Immersive Fullscreen HUD & Ambient Backdrop
- **Cinematic Canvas**: A stunning, borderless fullscreen dashboard displaying high-fidelity artwork overlays, dynamic center-aligned lyrics, and real-time playback control suites.
- **Ambient Visualizer Aura**: Integrates the Interactive Liquid Art visualizer into a full-bleed background, reacting dynamically with audio frequencies and dominant cover hues.
- **Keyboard Shortcuts**: Fully responsive media controls optimized for large monitors and living room playback.

### 🧠 AI Smart Mix Playlist Builder
- **Mood-Based Curation**: Dynamically generates taste-weighted custom playlists based on user moods, current trends, or scrobble frequencies.
- **Autoplay Taste Interleaving**: Real-time collaborative taste-weighting and ranking algorithms that automatically keep your queue alive with fresh recommendations.

### ❤️ Favorite & Loved Songs Engine
- **1-Click Track Favoriting**: Native favoriting system mapped to a database flag (`loved`) inside the SQLite schema.
- **Dynamic Favorite Songs Playlist**: Automatically generates and updates a dedicated, sidebar-accessible *"Favorite Songs"* playlist on-the-fly.
- **Last.fm Love Synchronization**: Integrates immediately with external scrobbling networks, pushing "Love" telemetry updates to connected profiles.

### 🧙 Onboarding & Setup Wizard
- **First-Boot Setup**: A premium multi-step onboarding walkthrough welcoming new users on startup.
- **Acoustic Profiling**: Guides users to automatically pre-tune bit-perfect audio configurations, scan initial music directories, and select their optimal app mode (Local File Only vs. Hybrid Lossless Cloud).

### 🔌 Dynamic Runtime Plugins Manager
- **Visual Dependency Downloader**: A robust visual installer inside Settings to manage, inspect, install, or uninstall optional external engines (`yt-dlp` and `ffmpeg`).
- **On-The-Fly Backend Updates**: Installs direct stream decoders and downloader proxies dynamically at runtime, avoiding manual developer setup steps.

### 🔒 Secure Credentials Obfuscation Vault
- **Zero-Plaintext Storage**: Eliminated insecure cleartext storage of Subsonic and music server passwords in `localStorage`.
- **Symmetric XOR-128 Encryption**: Engineered a backend symmetric XOR-128 encryption vault in `cloud.rs` that writes encrypted bytes directly to local native `AppData` (`subsonic_pass.enc`).
- **In-Memory Store Streams**: Decrypted credentials are bound strictly to active Zustand state slices in-memory at boot, preventing persistent plain-text disk footprints.

### 🗃️ SQLite Database Hardening & Migrations
- **Hybrid Streaming Playlists**: Dropped database path foreign-key constraints on custom playlists, letting you mix online web streams, Tidal Lossless tracks, and offline local files in the same playlist seamlessly.
- **Non-Destructive DB Migration**: Written an auto-running SQLite schema migration step within `init_db()` in `db.rs` that safely modifies table structures at startup without risking any user library data.

### 🛡️ Platform Logic & Security Hardening
- **HTTPS TLS Certificate Verification**: Hardened remote communication by restoring strict TLS certificate verification on all online artwork queries.
- **Dynamic Last.fm & Tidal Tokens**: Removed hardcoded fallback keys, resolving client credentials dynamically from runtime environments via secure `.env` parsers.
- **Extension-Aware Downloads**: Refactored the local downloader to parse incoming yt-dlp media containers dynamically, preserving correct file extensions (e.g. `webm`, `opus`, `aac`) instead of hardcoding fallback rules.
- **Discord Loop Cooldown**: Restrained the background Discord rich presence thread reconnection attempts to a maximum of 30 cycles (5 minutes) to completely avoid taskbar thread bloat.
- **MusicBrainz Compliant Headers**: Dynamically resolve the client User-Agent version using modern crate compilers (`env!("CARGO_PKG_VERSION")`) to meet Web API specs.

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

1. **Download**: Get the latest v0.7.1 installer from the [**Releases Page**](https://github.com/Alirull18/Aideo-Music-Player/releases/latest).
2. **Install**: Run the Windows installer (`Aideo_0.7.1_x64_en-US.msi`).
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

## 🛠️ System Architecture & Deep Tech Stack

Aideo is built on a highly optimized hybrid architecture split between a secure, fluid web UI and a high-priority native audio thread:

### 🎨 Frontend Layer (Aesthetics & Interaction)
- **[React 19](https://react.dev)**: Next-generation reactive view orchestrations and rendering.
- **[TypeScript](https://www.typescriptlang.org)**: Complete compile-time type-safety across UI modules and IPC channels.
- **[Framer Motion](https://www.framer.com/motion/)**: Liquid visualizer backdrops, custom control center slide transitions, and physics-based animations.
- **[Zustand](https://github.com/pmndrs/zustand)**: Clean, lightweight in-memory global state management and slices logic.
- **[Lucide React](https://lucide.dev)**: Elegant, modern vector icon library.
- **[Kpop & Wanakana](https://github.com/Wanakana/wanakana)**: Full-featured romaji/katakana/hangul lyric transliteration.

### 🦀 Backend Core (Rust Engine)
- **[Tauri 2.0](https://tauri.app)**: Highly secure native IPC bridge and webview container.
- **[Symphonia](https://github.com/pdeljanov/Symphonia)**: 100% pure Rust audio decoding, tag indexing, and file-parsing framework (FLAC, MP3, AAC, DFF, DSF).
- **[CPAL (Cross-Platform Audio Library)](https://github.com/RustAudio/cpal)**: Low-level audio hardware interface executing ASIO and WASAPI direct buffers.
- **[Rubato](https://github.com/HEnquist/rubato)**: Asynchronous, highly precise multi-channel sample rate upsampler.
- **[Biquad](https://crates.io/crates/biquad)**: Mathematical biquad filter calculations powering the Parametric EQ and subsonic high-pass.
- **[Rusqlite](https://github.com/rusqlite/rusqlite)**: High-speed, secure local database transactions and migrations framework.
- **[Reqwest](https://github.com/seanmonstar/reqwest)**: High-performance asynchronous network queries.

---

## 🎁 Acknowledgements & Special Thanks

Aideo would not be possible without the incredible contributions of the open-source audiophile, software development, and Web communities. We would like to extend our deepest gratitude to the creators and maintainers of:

| Library / Tool / Service | Category | Purpose in Aideo | Special Thanks For |
|:---|:---|:---|:---|
| **[AutoEq](https://github.com/jaakkopasanen/AutoEq)** | Database | Corrective headphone curves | Maintaining 4,000+ headphone calibration presets |
| **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** | Utility | YouTube Music streaming | Dynamic extraction bypass and robust proxy connections |
| **[ffmpeg](https://ffmpeg.org)** | Multimedia | Audio transcoding | Asynchronous high-fidelity format streaming |
| **[MusicBrainz](https://musicbrainz.org)** | Service | Metadata tagging | Unifying global open music recording lookups |
| **[Last.fm API](https://www.lastfm.com)** | Service | Social Scrobbler | Scrobble logging and taste similarity matrices |
| **[ListenBrainz API](https://listenbrainz.org)** | Service | Social Analytics | Listening feed aggregations and recommendations |
| **[Tidal API](https://tidal.com)** | Service | Lossless Streaming | OAuth2 pairing and direct FLAC streaming access |
| **[Google Translate](https://translate.google.com)** | Service | Translation | Real-time lyric translation bridges |
| **[LRCLIB](https://lrclib.net)** | Service | Lyrics Database | Free, open, and synced LRC lookup APIs |

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
