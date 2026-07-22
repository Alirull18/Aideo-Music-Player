# 💎 Aideo Music Player v0.9.1

**A Studio-Grade, Audiophile Music Engine with Dynamic Aesthetics, YTM AI Discovery & Real-Time Social Presence.**

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8DB?logo=tauri)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-Backend-000000?logo=rust)](https://www.rust-lang.org)

Aideo is a high-performance desktop music player engineered with **Tauri**, **Rust**, and **React**. Designed specifically for audiophiles, it prioritizes absolute signal purity and bit-perfect hardware direct transport while providing a gorgeous, glassmorphic adaptive interface.

---

## 📸 UI Showcase

<div align="center">
  <strong>Immersive Fullscreen HUD & Ambient Liquid Art</strong>
  <br />
  <img width="100%" alt="Cinematic Fullscreen HUD" src="https://github.com/user-attachments/assets/b9fd5154-604e-4538-8f22-9a19e0497461" />
  
  <br/><br/>
  
  <table width="100%">
    <tr>
      <td width="50%" align="center">
        <strong>Aideo Lab: Pro DSP & EQ Graph</strong>
        <br />
        <img width="100%" alt="Aideo Lab DSP" src="https://github.com/user-attachments/assets/b1035ae9-7ae2-4d26-9fdd-810c5d82d02f" />
      </td>
      <td width="50%" align="center">
        <strong>Pristine Library Dashboard</strong>
        <br />
        <img width="100%" alt="Library View" src="https://github.com/user-attachments/assets/71f7328e-5f57-4783-8df5-47194fc8dd98" />
      </td>
    </tr>
    <tr>
      <td width="50%" align="center">
        <strong>🧙 Hardware Latency Onboarding</strong>
        <br />
        <img width="100%" alt="Hardware Latency Onboarding" src="https://github.com/user-attachments/assets/b3c199b3-b073-425b-8fda-c95dddc702a6" />
      </td>
      <td width="50%" align="center">
        <strong>🔌 Visual Plugins Installer</strong>
        <br />
        <img width="100%" alt="Visual Plugins Installer" src="https://github.com/user-attachments/assets/481b56df-9c79-4ad9-959c-3f1b0bfae71e" />
      </td>
    </tr>
    <tr>
      <td width="50%" align="center">
        <strong>🌐 YTM AI Discovery Hub</strong>
        <br />
        <img width="100%"  alt="Screenshot 2026-06-04 133027" src="https://github.com/user-attachments/assets/0f7f7e51-3ed0-424e-8afe-067b8974faf8" />
      </td>
      <td width="50%" align="center">
        <strong>💎 Aideo Main Player View</strong>
        <br />
        <img width="100%" alt="Screenshot 2026-06-04 133152" src="https://github.com/user-attachments/assets/c92ca717-a53b-421c-a571-b77570c00f7f" />
      </td>
    </tr>
  </table>
</div>

---

## 📢 Release Notes: Version 0.9.2

Welcome to **v0.9.2**! This release brings a major visual upgrade to your music library, deeper artist exploration tools, smoother controls, and a smarter radio autoplay experience designed to make listening effortless.

---

### 🎵 Cleaner, Smoother Music Library
* **Simplified Header & Controls**: Enjoy a single clean top header with the search bar, sort menu, and `[ 🎵 Tracks | 💿 Albums ]` view switcher all grouped neatly together.
* **Double Scrollbar Fix**: Removed duplicate scrollbars so scrolling through your library feels completely smooth and natural.
* **Instant Navigation**: Switching to your Loved Songs or Playlists instantly shows your track list without extra clicks.
* **Polished Menus**: Pop-up menus on album cards now open cleanly on top without getting cut off or overlapping neighboring items.

### 🎨 Artist Hub 
* **Interactive Artist Drawer**: Click on any artist's name to open a sleek side panel featuring their full discography, your personal play stats, top tracks, and instant Play/Shuffle buttons.
* **Dynamic Artwork Color Tinting**: When viewing album details, the backdrop dynamically samples the album cover colors to create a beautiful, glowing ambient color gradient.
* **Favorite Albums ("Loved Albums")**: Click the Heart ❤️ icon on any album card or header to bookmark your favorite albums, then filter them anytime using the `[ All Albums | Loved Albums ❤️ ]` toggle.
* **Cloud & Local Album Covers**: Your album cover art loads instantly, whether streaming from Subsonic / Jellyfin cloud servers or playing local files from your disk.

### 💎 Translucent Glass Design & Instant Edits
* **Glass Search & Sort Bar**: Search inputs and sort menus have been redesigned into translucent glass pills with instant search clearing (`X`) and sleek dropdown animations.
* **Instant Deleting & Organizing**: Deleting a song or album instantly removes it from your view—no manual refresh or page switching required.

### 📻 Smarter Autoplay & Reliable Online Search
* **Vibe-Locked Radio Autoplay**: Radio and autoplay recommendations now stay locked to the vibe of the song you started with, so your listening session won't drift off-genre over time.
* **No More Duplicate Songs**: Radio sessions remember what you've heard to prevent repeating songs, automatically resetting whenever you pick a new track.
* **Audio Stalling & Freeze Prevention**: Resolved background playback conflicts to prevent music stuttering, visualizer freezes, or random pauses mid-song.
* **Reliable Cover Art & Stream Search**: Online search result ranking has been refined to prioritize official studio tracks over live/fan covers, ensuring album covers display reliably for every song.

### 🧠 Smart Recommendation Engine (Under the Hood)
* **Hybrid Personalization**: Aideo's algorithm analyzes your local scrobbler history, play counts, and top genres locally on your machine—delivering 100% private, customized recommendations without sending personal listening data to cloud servers.
* **Dynamic "Mixed for You" Shelves**: Automatically generates genre-tailored mixes (e.g., *Chill Mix*, *Synthwave Mix*) based on your listening habits, with smart fallback seeds for new users.
* **Balanced Local + Online Blending**: Blends high-fidelity local library tracks with fresh online discoveries in a balanced 1:1 ratio.
* **Quality & Fake Artist Safeguards**: Filters out low-quality fan edits, sped-up/reverb remixes, and corrupt artist profiles using Last.fm listener validation thresholds (`>= 200` listeners).

---

## 📢 What's New in v0.9.1 (Local Playback Insights, Wrapped Slideshow & Theme Contrast Overhauls)

* **📊 Local Listening Insights Dashboard**: Introduced a completely local, privacy-centric listening analytics dashboard (Aideo Insights). Track total listening time, play count, skip rates, top tracks, top artists, and top genres fully offline with zero cloud dependency.
* **✨ Spotify-Style "Aideo Wrapped" Slideshow**: Launch an interactive, animated fullscreen slideshow summarizing your musical milestones, highlighting top listening stats, and awarding a custom Music Personality badge based on scrobbler telemetry.
* **📈 SVG Activity Peak Heatmaps**: Integrated responsive, lightweight SVG-rendered bar charts visualizing your hourly listening peaks and weekly heatmap distributions.
* **🎨 Ambient Visual & Stacking Fixes**: Fixed a canvas stacking context bug causing Now Playing visualizers to hide behind solid backgrounds in fullscreen theater panels. Corrected text and border contrast ratios under Light Mode in settings, Now Playing, library, Aideo Lab, and media bar controls.

---

## 📢 What's New in v0.9.0 (Web Stream Songs Filter, App Restart Metadata Fix & Latency Optimizations)

* **🎵 Web Stream Songs Filter**: Fixed the YouTube Music Song-only search parser layout to correctly extract artist names and titles when the `"Song •"` subtitle prefix is omitted.
* **🔄 App Restart Metadata Preservation**: Resolved a metadata-wipe bug causing streaming track titles to fall back to generic `"Watch (youtube.com)"` and `"Online Stream"` names after resuming/playing online tracks on app start.
* **⚡ Discovery Hub Latency Optimizations**: Optimized concurrent background search requests from 34 down to 13 (speeding up background refreshing by over **2.5x**) and enabled instant cached recommendations rendering to clear the loading spinner immediately.

---

## ✨ Core Features

* **🎛️ Pro Audio Pipeline**: 5-band Parametric EQ, 10-band Graphic EQ with presets, and AutoEQ correction profiles for over **4,000+ headphones**.
* **🎧 Audiophile Comfort**: Linkwitz headphone crossfeed filter to eliminate fatigue, Haas spatializer for soundstage width, and night compressor/subsonic high-pass filters.
* **🔌 Dynamic Plugins Manager**: Visual downloader for optional external engines (`yt-dlp` and `ffmpeg`) to support high-fidelity stream decoding.
* **🛡️ Security Vault**: Local symmetric XOR-128 obfuscation vault for cloud servers and passwords (no plaintext on disk).
* **💿 Format Support**: Bit-perfect WASAPI/ASIO transport and native downsampling for FLAC, MP3, AAC, DFF, and DSF.

---

## ⚡ Quick Start (For Users)

1. **Download**: Get the latest v0.9.2 installer from the [**Releases Page**](https://github.com/Alirull18/Aideo-Music-Player/releases/latest).
2. **Install**: Run the Windows installer (`Aideo_0.9.2_x64_en-US.msi`).
3. **Launch**: Add your music folder and experience bit-perfect sound!

---

## 🛠️ Build from Source (For Developers)

```bash
# 1. Clone the repository
git clone https://github.com/Alirull18/Aideo-Music-Player.git
cd Aideo-Music-Player

# 2. Install Node dependencies
npm install

# 3. Launch development environment (Vite + Tauri)
npm run tauri dev
```

---

## 🔌 System Architecture & Tech Stack

Aideo splits execution between a secure, fluid web interface and a high-priority native thread:

* **Frontend**: React 19, TypeScript, Framer Motion, Zustand state slices, Lucide Icons, and Wanakana / Kpop transliterators.
* **Backend Core**: Tauri 2.0 (IPC bridge), Symphonia (audio decoding), CPAL (WASAPI/ASIO buffer streams), Rubato (resampling), Biquad (EQ filters), Rusqlite (SQLite migrations), and Reqwest (TLS verified requests).

---

## 🎁 Acknowledgements & Special Thanks

Aideo stands on the shoulders of giants. We express our deepest gratitude to the creators and maintainers of these frameworks, databases, and APIs:

| Library / Tool / Service | Category | Purpose in Aideo |
|:---|:---|:---|
| **[Tauri](https://tauri.app)** | Core Framework | Native IPC bridge & lightweight application wrapper |
| **[Rust CPAL](https://github.com/RustAudio/cpal)** | Backend Library | Low-level WASAPI / ASIO direct hardware audio transport |
| **[Symphonia](https://github.com/pdeljanov/Symphonia)** | Backend Library | Pure Rust audio file decoding (FLAC, MP3, AAC, DSD) |
| **[Rubato](https://github.com/HEnquist/rubato)** | Backend Library | Asynchronous precise multi-channel audio upsampling |
| **[Biquad](https://crates.io/crates/biquad)** | Backend Library | Biquad filter coefficient calculations for Parametric EQ |
| **[Rusqlite](https://github.com/rusqlite/rusqlite)** | Backend Library | Local SQLite database transactions and migrations |
| **[Reqwest](https://github.com/seanmonstar/reqwest)** | Backend Library | Async network queries with TLS certification check |
| **[React 19](https://react.dev)** | Frontend Library | High-performance reactive view renders |
| **[Zustand](https://github.com/pmndrs/zustand)** | Frontend Library | Lightweight in-memory global state slices |
| **[Framer Motion](https://www.framer.com/motion/)** | Frontend Library | Fluid visualizer animations and view transitions |
| **[Lucide Icons (Lucida)](https://lucide.dev)** | Frontend Utility | Premium minimal vector iconography |
| **[Wanakana](https://github.com/Wanakana/wanakana) / Kpop** | Frontend Utility | Japanese (Romaji/Kana) & Korean lyric transliterations |
| **[AutoEq](https://github.com/jaakkopasanen/AutoEq)** | Database | calib databases for 4,000+ headphones |
| **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** | Stream Proxy | Extractor & streaming decoders support |
| **[ffmpeg](https://ffmpeg.org)** | Stream Proxy | Multi-format stream transcoding |
| **[MusicBrainz](https://musicbrainz.org)** | Metadata API | Global music tagging & release lookups |
| **[Last.fm API](https://www.lastfm.com)** | Web Service | Listening scrobbles & taste similarity profile |
| **[ListenBrainz API](https://listenbrainz.org)** | Web Service | Listen logs & music analytics profile |
| **[Tidal API](https://tidal.com)** | Web Service | OAuth2 pairing & direct Lossless FLAC streams |
| **[LRCLIB](https://lrclib.net)** | Web Service | Free and open synced lyrics LRC database API |
| **[Google Translate](https://translate.google.com)** | Web Service | Dynamic lyric translations |
| **[Lucida.to](https://lucida.to)** | Lossless Bypass | Web manual lossless FLAC download search provider |
| **[Squid.wtf](https://squid.wtf)** | Lossless Bypass | Web manual lossless FLAC download search provider |

---

## 👨‍💻 Note from the Developer

> This project is a labor of love, developed as an educational journey into high-performance desktop application architecture and digital signal processing. As a Computer Science student, I built Aideo to explore the intersection of Rust's safety/performance and modern UI design. It is  AI-assisted , serving as a testament to how modern tools can accelerate specialized software development.
> 
> — **Alirul**

---

## 📝 License

Distributed under the **MIT License**. See `LICENSE` for details.
