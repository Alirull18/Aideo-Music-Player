# 💎 Aideo Music Player — Modern Windows Music Player (v0.9.9)

**A fast, lightweight, open-source desktop music player for Windows 10 and Windows 11. Built with Rust and Tauri for bit-perfect WASAPI Exclusive sound, real-time synchronized karaoke lyrics, and a gorgeous glassmorphism interface.**

[![Platform: Windows 10 | 11](https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011-0078D6?logo=windows&logoColor=white)](https://github.com/Alirul/Aideo-Music-Player/releases/latest)
[![Website](https://img.shields.io/badge/Website-alirull18.github.io-8A2BE2?logo=googlechrome&logoColor=white)](https://alirull18.github.io/Aideo-Music-Player/)
[![Download for Windows](https://img.shields.io/badge/Download-Windows%20x64-brightgreen?logo=windows&logoColor=white)](https://github.com/Alirul/Aideo-Music-Player/releases/latest)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8DB?logo=tauri)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-Backend-000000?logo=rust)](https://www.rust-lang.org)
[![Product Hunt](https://img.shields.io/badge/Product%20Hunt-Featured-FF6154?logo=producthunt)](https://www.producthunt.com/products/aideo-music-player)

<div align="center">
  <p>
    <a href="https://alirull18.github.io/Aideo-Music-Player/"><strong>🌐 Official Website</strong></a> &nbsp;•&nbsp;
    <a href="https://github.com/Alirul/Aideo-Music-Player/releases/latest"><strong>📥 Download for Windows (.exe / .msi)</strong></a> &nbsp;•&nbsp;
    <a href="docs/RELEASE_NOTES_v0.9.9.md"><strong>📖 Release Notes</strong></a> &nbsp;•&nbsp;
    <a href="https://www.producthunt.com/products/aideo-music-player"><strong>🚀 Product Hunt</strong></a>
  </p>
  <br/>
  <a href="https://www.producthunt.com/products/aideo-music-player?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-aideo-music-player" target="_blank" rel="noopener noreferrer"><img alt="Aideo Music Player - Fall in love with your music library again | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1222567&amp;theme=light&amp;t=1787490971129"></a>
</div>

**Aideo Music Player** is a modern, lightweight Windows desktop audio player designed for music lovers and audiophiles who want **studio-quality sound**, **bit-perfect WASAPI Exclusive playback**, **word-by-word karaoke lyrics**, and an **adaptive glassmorphism interface** on Windows 10 and Windows 11. Whether you are playing local lossless files (FLAC, WAV, MP3, AAC, ALAC) on your PC or streaming from Webstream, Aideo gives you complete control over your music library.

---

## 📸 See It in Action

<div align="center">
  <strong>Immersive Fullscreen View & Dynamic Album Glow</strong>
  <br />
  <img width="100%" alt="Cinematic Fullscreen HUD" src="https://github.com/user-attachments/assets/b9fd5154-604e-4538-8f22-9a19e0497461" />
  
  <br/><br/>
  
  <table width="100%">
    <tr>
      <td width="50%" align="center">
        <strong>🎛️ Sound Studio: Equalizer & Audio Lab</strong>
        <br />
        <img width="100%" alt="Aideo Lab DSP" src="https://github.com/user-attachments/assets/b1035ae9-7ae2-4d26-9fdd-810c5d82d02f" />
      </td>
      <td width="50%" align="center">
        <strong>📚 Clean Music Library</strong>
        <br />
        <img width="100%" alt="Library View" src="https://github.com/user-attachments/assets/71f7328e-5f57-4783-8df5-47194fc8dd98" />
      </td>
    </tr>
    <tr>
      <td width="50%" align="center">
        <strong>🧙 Sound Setup & Latency Helper</strong>
        <br />
        <img width="100%" alt="Hardware Latency Onboarding" src="https://github.com/user-attachments/assets/b3c199b3-b073-425b-8fda-c95dddc702a6" />
      </td>
      <td width="50%" align="center">
        <strong>🔌 Visualizer & Plugin Manager</strong>
        <br />
        <img width="100%" alt="Visual Plugins Installer" src="https://github.com/user-attachments/assets/481b56df-9c79-4ad9-959c-3f1b0bfae71e" />
      </td>
    </tr>
    <tr>
      <td width="50%" align="center">
        <strong>🌐 Smart Music Discovery Hub</strong>
        <br />
        <img width="100%" alt="Webstream Discovery Hub" src="https://github.com/user-attachments/assets/0f7f7e51-3ed0-424e-8afe-067b8974faf8" />
      </td>
      <td width="50%" align="center">
        <strong>💎 Main Music Player</strong>
        <br />
        <img width="100%" alt="Main Player View" src="https://github.com/user-attachments/assets/c92ca717-a53b-421c-a571-b77570c00f7f" />
      </td>
    </tr>
  </table>
</div>

---

## ✨ What's New in v0.9.9

Version **0.9.9** delivers our largest architectural update yet, introducing the **Reliable Unified Music Sources Architecture**, **6 Signature Home Screen Experiences**, native **Direct Webstream Audio Pipeline**, **Motion Canvas (Video Artwork Loops)**, a high-performance **Library View Overhaul**, complete **Settings View Overhaul**, and a massive verification suite of **1,107 frontend unit tests** and **315 backend tests**:

* 🔗 **Reliable Unified Music Sources Architecture (Milestones 1–4)**:
  * **Unified Multi-Source Catalog**: Harmonious playback across Local lossless files, Tidal, Qobuz, and Webstream without source collision or catalog fragmentation.
  * **Streaming Quality Leader**: Automatically plays the highest-fidelity lossless stream available (Qobuz 24-bit Hi-Res > Tidal Max FLAC > Webstream Opus) with instantaneous manual override.
  * **Interactive Source Switcher (`SourceMenu`)**: Switch playback between Local, Tidal, Qobuz, and Webstream streams with real-time audio format, sample rate, and bitrate badges.
  * **Conservative Recording Matcher Contract**: Unicode NFKC normalization, presentation wrapper stripping (`- Topic`, `Official Audio`, `Lyric Video`), version qualifier preservation (Remix, Acoustic, Live, Edit), 3-second duration corroboration, and ISRC conflict rejection.
  * **Strict Offline / Local-Only Mode**: 1-click toggle ensuring zero outbound network calls, 100% offline privacy, and zero external telemetry.
  * **Centralized Reactive Store & Progressive Enrichment**: Shared source state across Search, Home, and Queue; fast sources render immediately while high-res sources enrich cards without row jumping or layout shift.
  * **Playback Attempt Lifecycle & Native Decoder Readiness**: Cryptographic `attempt_id` tracking, Symphonia native decoder readiness gating, 15s timeout bounds, and safe automatic fallback on provider failure.
  * **Queue Occurrence Decoupling & SQLite Persistence**: Isolated `queue_occurrence_id` preserving intentional track duplicates, native gapless audio retention for local tracks, and additive SQLite persistence with a 32-source ceiling.
* 🎨 **6 Signature Home Screen Experiences & Quick Switcher**:
  * Seamlessly toggle between **Classic**, **Horizon** (fluid card grid & banner hero), **Spatial Glass** (frosted acrylic glass & dynamic artwork glow), **Editorial** (Swiss poster typography), **Command Deck** (pro audio telemetry console), and **Stage** (arena concert lighting) via the new collapsible top-bar Layout Filter.
* ⚡ **Direct Webstream Audio Pipeline**:
  * Direct audio stream extraction with high-efficiency Opus audio via ffmpeg.
  * In-memory/disk URL caching and background prefetching for near-instant track start.
  * Webstream duration cap (20 minutes / 1200s) and non-music content filtering.
* 🎬 **Motion Canvas (Video Artwork Loops) Integration**:
  * High-definition video canvas loops rendering in Now Playing and Fullscreen/Theater Mode.
  * Hardware-accelerated background decoding with an in-app toggle in Settings.
* 📚 **High-Performance Library View & Portal Action Menu**:
  * Overhauled `LibraryView` featuring anchored `TrackActionMenu` portals, instant category filter chips, glass search bar, and silky 60 FPS scrolling across 10,000+ tracks.
* 🖼️ **Local Artwork Engine & Sidecar Disk Caching**:
  * Pure Rust embedded cover art reader for FLAC, MP3, WAV, ALAC, and AAC files with `{stem}.jpg` sidecar disk caching.
* 📊 **Universal Scrobbling Engine (Last.fm & ListenBrainz)**:
  * Unified scrobbler supporting Local tracks, Tidal, Qobuz, and Webstream with normalized metadata and smart duration thresholds.
* 🔔 **Interactive Toast Notification Overhaul**:
  * Glassmorphic notification stack with status icons, interactive action triggers, and audio engine state announcements.
* 🎛️ **Settings View Overhaul**:
  * Redesigned modular layout with dedicated sections for Audio Output & WASAPI Exclusive mode, Audio Visualizer presets, Music Sources management, and App Updates.
* ⚖️ **Open-Source License**:
  * Officially licensed under the **GNU General Public License v3 or later** (`GPL-3.0-or-later`).

> 📖 *Looking for deep technical patch notes? Read the full [**v0.9.9 Release Notes**](docs/RELEASE_NOTES_v0.9.9.md).*

---

## 📜 Previous Release Highlights

<details>
<summary><strong>✨ What Was New in v0.9.8 (Click to expand)</strong></summary>
<br />

* 📱 **Aideo Connect Mobile Remote & Instant QR Pairing**: Web controller for smartphones/tablets, 6-digit numeric PIN, timing-attack hardened comparisons, and QR code pairing.
* 🔄 **Official Tauri v2 Cryptographic Auto-Updater**: In-app updater with Minisign signatures, live progress tracking, and atomic restart.
* 📰 **Discovery Hub (Aideo Home) Next-Gen Redesigns**: Editorial Home and Stage Home with GPU-accelerated styling (`home.css`).
* 🌊 **Studio Audio Visualizer Engine**: 5 ballistic modes (Peak-Decay Bars, Mirror, Ribbon, Halo, LED Dots) and adaptive 64px/140px container.
* ⚡ **Tidal Streaming Stability**: Track boundary EOF fix and proactive token refresh.

> 📖 *Read the [**v0.9.8 Release Notes**](docs/RELEASE_NOTES_v0.9.8.md).*

</details>
<br />

* 🎭 **5 Theater Mode Visual Archetypes**: Stage Mode, Hi-Fi Studio Deck, Vinyl Turntable, Editorial Poster, and Zen Minimalist.
* 🎛️ **Audio Telemetry & Live Signal Path Inspector**: Inspect the exact end-to-end signal chain with a real-time Bit-Perfect badge.
* 📋 **Immersive Up Next Queue Drawer**: Slide-out glassmorphic drawer for seamless queue management inside Theater and Now Playing.
* 🌊 **PureScope Visualizer Overhaul**: Zero-crossing oscilloscope and calibrated phosphor decay FFT spectrum analyzer.
* 🎤 **Silky-Smooth Karaoke Lyrics Engine**: Fluid 60fps word-by-word syllable wipe animations with zero micro-stuttering.
* 🎵 **Lossless Streaming Hub (Qobuz & Tidal)**: Native Qobuz catalog browsing & streaming, persistent Tidal bootstrap on launch via OS keyring.
* 📊 **Top Charts Explorer**: Redesigned charts browser with regional top ranks, trend indicators, and automatic library matching.
* 🔊 **Audio Engine & Bit-Perfect Hardening**: WASAPI Exclusive Buffer Drain Sync, True Bit-Perfect Pipeline, True Gapless Stream Sessions, and Clock Smoothing.

> Read the full [**v0.9.7 Release Notes**](docs/RELEASE_NOTES_v0.9.7.md).
</details>
<br />

<details>
<summary><strong>✨ What Was New in v0.9.6 (Click to expand)</strong></summary>
<br />

* 🎨 **4 Choose-Your-Own Home Page Looks**: Pick how your home screen looks under *Settings > Appearance* — choose between **Classic Studio**, modern **Bento Grid**, minimalist **Audiophile Deck**, or full-screen **Cinematic Flow**.
* 🎛️ **5 Bottom Player Bar Styles**: Customize the playback bar at the bottom with options like **Floating Pill**, **Sleek Minimalist**, **Soundwave Deck**, or a fun **Retro Vinyl Turntable** with a spinning record that lights up with your album colors!
* 🌈 **Smart Dynamic Colors**: The player background and accent colors now smoothly change in real time to match the cover art of whatever song is playing.
* 🎧 **Rich & Spacious Sound**: Improved stereo separation ensures your music sounds wide, punchy, and natural on headphones and speakers without feeling flat.
* 🔊 **Cleaner Surround Sound**: 5.1 and 7.1 home theater setups now route audio cleanly to the correct speakers without annoying background hums or leaks.
* 🔄 **Glitch-Free Smooth Song Fades**: Crossfading between songs is completely seamless — no audio cuts, pops, or stutters.
* 🛡️ **No More Sudden Volume Blasts**: Smart volume protection prevents quiet intros and pauses from suddenly blasting your ears.
* ⚡ **Instant Track Skipping**: When you skip songs quickly, album art, lyrics, and background colors update instantly without lag.
* 🏷️ **Built-in Song & Album Art Editor**: Fix misspelled song names, add artist/album tags, or drag-and-drop new high-resolution cover art directly into your audio files.
* 🪟 **Floating Desktop Lyrics (HUD)**: Sing along while browsing or gaming with a transparent lyrics bar that stays on top of your screen. Press `Alt + L` to lock it so your mouse clicks right through!
* 📡 **Stream to Home Speakers (DLNA / UPnP)**: Cast your songs wirelessly to smart TVs, Hi-Fi sound systems, and Wi-Fi speakers in full studio quality.
* 📁 **Automatic Music Folder Sync**: Add new songs to your computer's music folder, and Aideo instantly detects and adds them without needing to restart.
* 🎮 **Discord Status Sync**: Show your friends what song you're playing on Discord in real time.
* 🔋 **Battery & Laptop Friendly**: Animations and visualizers automatically sleep when Aideo is minimized, keeping your laptop cool and quiet.
* 🚀 **Faster & Lighter**: Starts up in a flash and uses very little computer memory (~75MB RAM).

> 📖 *Read the [**v0.9.6 Release Notes**](docs/RELEASE_NOTES_v0.9.6.md) for more details.*

</details>

<details>
<summary><strong>✨ What Was New in v0.9.5 (Click to expand)</strong></summary>
<br />

* 🧠 **Smarter AI Music Recommendations**: Get 40–75+ songs matched to your taste, without duplicate or unrelated tracks.
* 🚫 **Clean Music Only Filter**: Automatically hides reaction videos, dance covers, and fancams from search results.
* 🎵 **Full Artist Discographies**: Explore an artist's complete collection with tabs for *Popular Hits*, *All Releases*, and songs *In Your Library*.
* ⚡ **Zero-CPU Idle Sleep**: Background timers and visualizers pause when music stops, saving laptop battery.
* 📌 **Always-on-Top Mini Player**: Keep a tiny music widget floating above your work or games.
* 🎨 **Adaptive Cover Art**: Non-square album covers look perfect with dynamic color-matched background blur.
* 🎯 **Multi-Song Selection**: Select multiple tracks at once (`Ctrl + Click` or `Shift + Click`) to play, queue, or add to playlists.
* 🪟 **System Tray & Memory**: Minimizes cleanly to the Windows taskbar tray and remembers your volume and tabs when reopened.

> 📖 *Read the [**v0.9.5 Release Notes**](docs/RELEASE_NOTES_v0.9.5.md) for more details.*

</details>

---

## 🌟 Key Features & Why You'll Love It

### 🎨 Personalize Your Look
* **6 Home Screen Experiences**: Switch effortlessly between **Classic**, **Horizon** (fluid card grid & banner hero), **Spatial Glass** (frosted acrylic glass & dynamic artwork glow), **Editorial** (Swiss poster typography), **Command Deck** (pro audio telemetry console), or **Stage** (arena concert lighting) with an instant collapsible top-bar switcher.
* **5 Theater Mode Archetypes**: Fullscreen immersion with **Stage Mode**, **Hi-Fi Studio Deck** (dual VU meters), **Vinyl Turntable** (groove reflections & tonearm), **Editorial Poster**, and **Zen Minimalist**.
* **5 Playback Bar Styles**: Choose standard desktop controls, an ultra-compact bar, a floating pill, or a retro spinning vinyl record.
* **🎬 Motion Canvas**: Dynamic looping video artwork backgrounds that bring your music to life in Now Playing and Theater Mode.
* **Frosted Glass (Glassmorphism)**: Beautiful transparent backgrounds that let album art, canvas videos, and visualizers shine through.

### 🔗 Reliable Unified Music Catalog & Streaming
* **One Unified Library**: Seamlessly blend your local lossless files with Tidal, Qobuz, and Webstream into a cohesive, conflict-free catalog.
* **Streaming Quality Leader**: Automatically plays the highest-fidelity lossless stream available (Qobuz 24-bit Hi-Res > Tidal Max FLAC > Webstream Opus) with instantaneous manual override.
* **Interactive Source Menu**: Compare and switch audio providers on the fly with live audio format, sample rate, and bitrate badges.
* **100% Offline / Local-Only Mode**: Privacy-first switch that instantly cuts all outbound network queries to keep your listening completely private and offline.

### 🎤 Sing Along with Live Karaoke Lyrics
* **Word-by-Word Sing-Along**: Highlights words in real-time as they are sung (powered by cloud TTML, LRC, and community lyrics).
* **3 Lyric Modes**: Switch with one click between **Word Karaoke**, **Line-by-Line Scroll**, or **Plain Text**.
* **Floating Desktop Bar**: Keep lyrics on your screen while working or gaming. Press `Alt + L` to enable **Click-Through Mode** so it never gets in your way.
* **Instant Translations & Pronunciation**: Translate foreign lyrics on the fly, with automatic pronunciation (Romaji) for Japanese and Korean songs.

### 🔊 Studio-Grade Sound Quality
* **Bit-Perfect Playback**: Delivers uncompressed, exact master sound directly to your headphones or DAC via WASAPI Exclusive mode.
* **Audio Telemetry & Signal Path Inspector**: Live interactive HUD displaying container format, DSP processing, and hardware output with a verified Bit-Perfect badge.
* **Headphone Tuner (AutoEQ)**: Choose from over 4,000 pre-calibrated headphone profiles to make your specific headphones sound their absolute best.
* **Volume Leveling & DSP Suite**: EBU R128 loudness leveling, 10-band equalizer, Haas spatializer, and PureScope ballistic spectrum visualizer.

### 🧭 Smart Music Discovery & Scrobbling
* **7 Smart Mixes**: Automatically created playlists like *High Energy*, *Deep Focus*, *Late Night Chill*, and *Forgotten Gems*.
* **Infinite Radio**: Keep the music going with an endless queue of songs that match your current listening vibe.
* **Universal Scrobbler**: Automatically scrobbles playback history to **Last.fm** and **ListenBrainz** across Local, Tidal, Qobuz, and Webstream.
* **100% Offline Friendly**: Generates smart mixes and browses embedded album art even with no internet connection.

### 📁 Easy Music Management & Fluid Library
* **Fluid 10,000+ Track Library**: Silky-smooth 60 FPS scrolling, instant search, fast category filter chips, and floating portal action menus.
* **Tag & Cover Art Editor**: Rename tracks, fix artist names, and embed square cover art into your audio files.
* **Local Artwork Cache**: Pure Rust embedded album art extraction with `{stem}.jpg` sidecar caching ensures instant, stutter-free browsing.
* **One-Click Auto-Tagger**: Automatically search online music databases to fill in missing track info.
* **Auto-Syncing Folders**: Automatically discovers newly downloaded songs in your music folders.
* **Playlist Support**: Import and export standard `.m3u` and `.m3u8` playlists effortlessly.
* **Cloud & Server Streaming**: Connect your Subsonic or Jellyfin home music server for remote listening.

### 📡 Listen Everywhere
* **Aideo Connect Mobile Remote**: Control playback from any smartphone or tablet on your Wi-Fi network via instant QR code pairing.
* **Cast to Wireless Speakers**: Stream high-quality audio to Wi-Fi speakers, home theater receivers, and smart TVs (DLNA / UPnP).
* **Discord Integration**: Automatically shows what song and artist you're playing on your Discord profile.

---

## ⌨️ Easy Keyboard Shortcuts

Control your music instantly from anywhere in the app:

### 🎵 General Playback
| Key | What it does |
| :--- | :--- |
| **`Space`** | **Play / Pause** the current song |
| **`→` (Right Arrow)** | **Skip to Next Track** |
| **`←` (Left Arrow)** | **Go to Previous Track** |
| **`↑` (Up Arrow)** | **Turn Volume Up** (+5%) |
| **`↓` (Down Arrow)** | **Turn Volume Down** (-5%) |
| **`M`** | **Mute / Unmute** sound |
| **`B`** | **Quick Sound Compare** (Original Raw Sound vs. Tuned Equalizer) |
| **`Alt + L`** | **Lock Desktop Lyrics** (Click-Through mode for gaming) |
| **Media Keys** | Supports keyboard Play/Pause/Next buttons |

---

### 🌟 Fullscreen Mode Controls
| Key | What it does |
| :--- | :--- |
| **`L`** | **Switch View** (Stage Mode with lyrics vs. Zen Mode with big artwork) |
| **`V`** | **Change Visualizer** (Cycle between Wave, Circle, and Baseline) |
| **`T`** | **Toggle Lyric Translation** on or off |
| **`R`** | **Toggle Pronunciation / Romaji** on or off |
| **`←` / `→`** | **Seek** 5 seconds backward or forward |
| **`Escape`** | **Exit Fullscreen** |

> 💡 *Want different keys? You can customize all shortcuts under **Settings > Shortcuts & Controls**.*

---

## 🚀 Download & Installation for Windows

Aideo Music Player is designed natively for 64-bit **Windows 10** and **Windows 11**.

### 📥 Direct Windows Installers
| Package | Format | Architecture | Download Link | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Windows Setup Installer** | `.exe` | `x64` | [**Download Aideo Setup .exe**](https://github.com/Alirul/Aideo-Music-Player/releases/latest) | Recommended for most Windows users (automatic updates) |
| **Windows MSI Installer** | `.msi` | `x64` | [**Download Aideo .msi**](https://github.com/Alirul/Aideo-Music-Player/releases/latest) | Clean enterprise & silent installation |
| **All Release Assets** | Multi | `x64` | [**GitHub Releases**](https://github.com/Alirul/Aideo-Music-Player/releases) | Standalone archives, changelogs, and checksums |

### ⚡ Quick Start
1. **Download & Run**: Grab the `.exe` or `.msi` installer above and run it on your Windows 10/11 PC.
2. **Add Your Music**: Select your local music folders (FLAC, MP3, WAV, AAC, ALAC, Ogg Vorbis) or search Webstream directly.
3. **Enjoy Studio Sound**: Toggle **WASAPI Exclusive mode** under Settings for bit-perfect direct DAC audio.

> 💻 **System Requirements**: Windows 10 (64-bit) or Windows 11 (64-bit), 4 GB RAM, Windows audio device.

---

## 🚀 Featured on Product Hunt

We are featured on **Product Hunt**! If you're enjoying Aideo Music Player, please support our open-source project, share your thoughts, or leave a review:

<div align="center">
  <a href="https://www.producthunt.com/products/aideo-music-player?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-aideo-music-player" target="_blank" rel="noopener noreferrer"><img alt="Aideo Music Player - Fall in love with your music library again | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1222567&amp;theme=light&amp;t=1787490971129"></a>
</div>

---

<details>
<summary><strong>🛠️ Under the Hood (For Developers & Tech Enthusiasts)</strong></summary>
<br />

### Technology Stack
- **Frontend**: React 19, TypeScript, Framer Motion, Zustand, Lucide React (**1,107 automated unit & integration tests**)
- **Desktop Architecture**: Tauri v2, Rust, Tokio Async Runtime, Windows WASAPI (**315 passing Rust unit tests**)
- **Audio & DSP**: CPAL, Symphonia (pure Rust multi-format decoder), Rubato Resampler, Biquad Filter Array, Dynamic Loudness Normalizer (AGC), Direct Opus Webstream pipeline
- **Audio Metadata & Tagging**: Lofty (Pure Rust ID3, FLAC, MP4, Vorbis container editor), native embedded cover art extraction & disk sidecar caching
- **Motion Canvas**: High-definition video canvas loops with hardware-accelerated decoding
- **Network Streaming & Remote**: SSDP, UPnP AVTransport 1.0, Aideo Connect HTTP remote control with constant-time security
- **Database**: SQLite (via rusqlite) with additive migrations, WAL mode indexing, Supabase Cloud Sync
- **Design System**: Hardware-accelerated CSS glassmorphism, 6 signature home layouts, 5 theater archetypes

### Security, Privacy & Transparency
Aideo is 100% open-source, client-side, and privacy-first. Your music library, playback history, and login keys stay securely on your computer.

* **Helper Tools (`yt-dlp`, `ffmpeg`)**: Used to stream and transcode webstream tracks. All helper tools are verified against official SHA-256 checksums before running.
* **Windows System Integrations**: Uses official Windows OS APIs for real-time audio scheduling (MMCSS / WASAPI Exclusive mode), Taskbar thumbnail controls, and secure local credential storage (Windows Credential Manager).

</details>

---

## 🙏 Credits & Acknowledgments

Aideo is built on top of amazing open-source projects, libraries, and community databases. Huge thanks to:

| Project / Service | Purpose |
| :--- | :--- |
| **[Tauri](https://tauri.app)** & **[Rust](https://www.rust-lang.org)** | Fast, lightweight, and secure desktop engine |
| **[React 19](https://react.dev)** & **[TypeScript](https://www.typescriptlang.org)** | Smooth, reactive user interface |
| **[cpal](https://github.com/RustAudio/cpal)** & **[Symphonia](https://github.com/pdeljanov/Symphonia)** | High-resolution audio playback and decoding (FLAC, WAV, MP3, AAC, ALAC) |
| **[lofty-rs](https://github.com/Serial-ATA/lofty-rs)** | Fast, lossless audio tag and album artwork editing |
| **[AutoEq](https://github.com/jaakkopasanen/AutoEq)** | Database of 4,000+ headphone equalizer curves by Jaakko Pasanen |
| **[BiniLyrics](https://github.com/binimum)** & **[Better Lyrics](https://github.com/better-lyrics)** | High-precision word-by-word synchronized karaoke lyrics |
| **[LRCLIB](https://lrclib.net)** | Community-driven synchronized lyrics database |
| **[MusicBrainz](https://musicbrainz.org)** | Open music encyclopedia for album & artist metadata |
| **[Last.fm](https://www.lastfm.com/api)** & **[ListenBrainz](https://listenbrainz.org)** | Music discovery and playback scrobbling |
| **[discord-rich-presence](https://github.com/vion/discord-rich-presence)** | Live Discord status integration |

*Special thanks to all open-source maintainers and contributors who make music technology accessible to everyone.*

---

## 👨‍💻 Note from the Developer

> This project is a labor of love, developed as an educational journey into high-performance desktop software and digital audio processing. As a Computer Science student, I built Aideo to combine high-end sound fidelity with a clean, modern design.
> 
> — **Alirul**

---

## 📈 Star History

<div align="center">
  <a href="https://star-history.com/#alirull18/aideo-music-player&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=alirull18/aideo-music-player&type=date&theme=dark&legend=top-left" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=alirull18/aideo-music-player&type=date&legend=top-left" />
      <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=alirull18/aideo-music-player&type=date&legend=top-left" />
    </picture>
  </a>
</div>

---

## 📄 License & Brand Policy

* **Code License:** Distributed under the [GNU General Public License v3.0 (GPLv3)](LICENSE). All derivative works and forks must remain open-source under GPLv3.
* **Trademark & Branding:** The names **Aideo**, **Aideo Music Player**, logos, and application icons are proprietary trademarks of the author. Forks or redistributions must remove original branding and use their own distinct name and identity.

See [`LICENSE`](LICENSE) for complete legal terms.

---

<div align="center">

<a href="https://www.producthunt.com/products/aideo-music-player?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-aideo-music-player" target="_blank" rel="noopener noreferrer"><img alt="Aideo Music Player - Fall in love with your music library again | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1222567&amp;theme=light&amp;t=1787490971129"></a>

<br/><br/>

**Crafted with ❤️ for the Audiophile Community.**

⭐ *If you find this project useful, please consider giving it a star on [GitHub](https://github.com/Alirull18/Aideo-Music-Player)!*

</div>
