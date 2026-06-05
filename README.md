# 💎 Aideo Music Player v0.8.1

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

## 📢 What's New in v0.8.1 (Atlas OS Portability & Hotfixes)



* **☁️ Supabase Cloud Synchronization & Settings Restore**: Bidirectional database sync for library tracks, playlists, configurations, and settings. Restoring supports granular imports (e.g. Liked Songs, Playlists, Player configurations, Scrobble stats).
* **📊 Wrapped Play Logging**: Detailed play telemetry logging (`play_logs` schema) tracking duration listened, timestamp, and format, ready for year-end Wrapped.
* **🔑 OAuth-First Logins**: Redesigned login flow prioritizing 1-click Google and GitHub integrations.
* **🧠 Discovery Hub State Caching**: Caches recommendations state in the Zustand store to make tab switching instantaneous.
* **🎵 Global Charts Seekability**: Concurrently resolves missing durations for global discovery charts to enable seek bar tracking.
* **📺 Native OS Fullscreen Fixes**: Configured Tauri capability permissions to allow standard window resizing and fullscreen commands.
* **⚡ Autoplay Recommendation Regeneration**: Clearing the queue stops the active stream, saves cleared tracks to a blacklist to avoid repeats, fetches a fresh list of recommendations, and plays the first one.

---

## ✨ Core Features

* **🎛️ Pro Audio Pipeline**: 5-band Parametric EQ, 10-band Graphic EQ with presets, and AutoEQ correction profiles for over **4,000+ headphones**.
* **🎧 Audiophile Comfort**: Linkwitz headphone crossfeed filter to eliminate fatigue, Haas spatializer for soundstage width, and night compressor/subsonic high-pass filters.
* **🔌 Dynamic Plugins Manager**: Visual downloader for optional external engines (`yt-dlp` and `ffmpeg`) to support high-fidelity stream decoding.
* **🛡️ Security Vault**: Local symmetric XOR-128 obfuscation vault for cloud servers and passwords (no plaintext on disk).
* **💿 Format Support**: Bit-perfect WASAPI/ASIO transport and native downsampling for FLAC, MP3, AAC, DFF, and DSF.

---

## ⚡ Quick Start (For Users)

1. **Download**: Get the latest v0.8.1 installer from the [**Releases Page**](https://github.com/Alirull18/Aideo-Music-Player/releases/latest).
2. **Install**: Run the Windows installer (`Aideo_0.8.1_x64_en-US.msi`).
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

> This project is a labor of love, developed as an educational journey into high-performance desktop application architecture and digital signal processing. As a Computer Science student, I built Aideo to explore the intersection of Rust's safety/performance and modern UI design. It is 100% AI-assisted (built with Antigravity), serving as a testament to how modern tools can accelerate specialized software development.
> 
> — **Alirul**

---

## 📝 License

Distributed under the **MIT License**. See `LICENSE` for details.
