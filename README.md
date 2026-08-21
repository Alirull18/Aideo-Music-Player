# 💎 Aideo Music Player v0.9.6

**A High-Performance, Audiophile-Grade Desktop Music Engine with Smart Hardware Auto-Matching, Automatic Storage Management, Real-Time Lyric Translation, and Dynamic Aesthetics.**

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8DB?logo=tauri)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-Backend-000000?logo=rust)](https://www.rust-lang.org)

Aideo is a high-performance desktop music player engineered with **Tauri**, **Rust**, and **React**. Designed specifically for music lovers and audiophiles, it prioritizes pristine sound quality and hardware audio precision while providing a modern, customizable adaptive interface.

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
        <img width="100%" alt="YouTube Discovery Hub" src="https://github.com/user-attachments/assets/0f7f7e51-3ed0-424e-8afe-067b8974faf8" />
      </td>
      <td width="50%" align="center">
        <strong>💎 Aideo Main Player View</strong>
        <br />
        <img width="100%" alt="Main Player View" src="https://github.com/user-attachments/assets/c92ca717-a53b-421c-a571-b77570c00f7f" />
      </td>
    </tr>
  </table>
</div>

---

## ✨ What's New in v0.9.6

Version **0.9.6** is a major audiophile precision, security, and UI stability update designed to deliver flawless sound playback, zero-glitch streaming, and snappy desktop responsiveness:

* 🎧 **Studio Stereo & Spatial Imaging**: Fixed the spatializer dry/wet engine so your stereo tracks maintain 100% of their rich separation, punch, and soundstage at default settings without collapsing to mono.
* 🔊 **True 5.1 & 7.1 Surround Sound**: Multi-speaker setups now route real silence to unassigned surround channels instead of leaking left-ear audio to center and subwoofer channels.
* 🔄 **Zero-Glitch Crossfading**: Crossfading between songs now uses independent stream pipelines, preventing upcoming track buffering from cutting off or stuttering your active music.
* 🛡️ **Silence Gate on Volume Normalizer**: Loudness normalization automatically holds unity gain during song intros and pauses, eliminating loud volume blasts when quiet tracks start.
* ⚡ **Rapid Skip Protection**: Skipping songs quickly now instantly synchronizes lyrics, cover art, and ambient lighting without showing old lyrics or delayed artwork.
* 🔒 **Hardened File & Library Security**: Track deletions are strictly verified and locked within your registered music library folders to protect personal system files.
* 🔐 **Cryptographic Binary Verification**: All streaming helper tools (`yt-dlp`, `ffmpeg`) are checked against official SHA-256 cryptographic signatures before execution.
* 🔋 **Zero GPU Leak & Battery Saver**: Ambient liquid background animations use a synchronized render loop that automatically sleeps when minimized or in background tabs.
* 🚀 **Lighter & Faster Footprint**: Cleaned up legacy unmounted components and pruned unused dependencies, making Aideo faster to start and lighter on system RAM (~75MB).

> 📖 *For the complete release breakdown, see the [**v0.9.6 Release Notes**](docs/RELEASE_NOTES_v0.9.6.md).*

---

## ⌨️ Keyboard Shortcuts & Global Hotkeys

Control your music effortlessly from anywhere in the player with built-in hotkeys:

### 🎵 Playback & Sound Control (Everywhere)
| Shortcut | Action | Description |
| :--- | :--- | :--- |
| **`Space`** | **Play / Pause** | Toggle playback on and off |
| **`ArrowRight`** | **Next Track** | Skip to the next song in queue |
| **`ArrowLeft`** | **Previous Track** | Return to the previous song |
| **`ArrowUp`** | **Volume Up (+5%)** | Smoothly increase audio volume |
| **`ArrowDown`** | **Volume Down (-5%)** | Smoothly decrease audio volume |
| **`M`** | **Mute / Unmute** | Instantly silence or restore audio at previous volume |
| **`B`** | **A/B Sound Compare** | Toggle between Pure Raw Audio and Tuned DSP/AutoEQ |
| **Media Keys** | **Hardware Media** | Supports Windows keyboard media keys (Play, Next, Prev) |

---

### 🌟 Fullscreen Ambient & Zen Mode
| Shortcut | Action | Description |
| :--- | :--- | :--- |
| **`L`** | **Layout Toggle** | Switch between Stage Mode (Lyrics + Art) and Zen Mode (Big Art) |
| **`V`** | **Visualizer Cycle** | Cycle audio visualizer modes (Baseline → Circle → Wave) |
| **`T`** | **Translation Toggle** | Turn real-time synchronized lyrics translation on / off |
| **`R`** | **Romaji Toggle** | Turn Japanese Romaji pronunciation on / off |
| **`M`** | **Mute / Unmute** | Instantly silence or restore audio |
| **`←` / `→`** | **Seek ±5 Seconds** | Jump 5 seconds backward or forward in the song |
| **`↑` / `↓`** | **Volume ±5%** | Adjust volume in fullscreen |
| **`Escape`** | **Exit Fullscreen** | Return to the standard desktop player view |

> 💡 **Custom Keybindings**: You can customize your favorite playback shortcuts anytime in **Settings > Shortcuts & Controls**.

---

## 🚀 Getting Started

1. **Download**: Grab the latest release installer (`Aideo_0.9.6_x64_en-US.msi` or `.exe`) from the [**Releases Page**](https://github.com/Alirul/Aideo-Music-Player/releases/latest).
2. **Install**: Run the Windows installer and launch Aideo.
3. **Enjoy**: Add your music folder or connect Subsonic/Jellyfin cloud streaming to start listening!

---

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Framer Motion, Zustand, Lucide React
- **Backend**: Rust, Tauri v2, Tokio, WASAPI
- **Audio & DSP**: CPAL, Symphonia, Rubato Resampler, Biquad Filter Array, EBU R128 LUFS Loudness Engine
- **Database**: SQLite (via rusqlite), Supabase Cloud Sync
- **Styling**: Vanilla CSS with custom glassmorphism design system

---

## 🙏 Credits & Acknowledgments

Aideo is built on the shoulders of giants. We are deeply grateful to the open-source community, developers, and researchers whose incredible libraries, tools, and services make this player possible:

| Project / Service | Category | Purpose in Aideo |
| :--- | :--- | :--- |
| **[Tauri](https://tauri.app)** | Core Framework | Lightweight, secure desktop application architecture |
| **[Rust](https://www.rust-lang.org)** | Core Language | Safe, high-performance audio processing and multi-threading |
| **[React 19](https://react.dev)** | UI Framework | Declarative, component-driven responsive interface |
| **[TypeScript](https://www.typescriptlang.org)** | Language | Type safety and reliable application logic |
| **[cpal](https://github.com/RustAudio/cpal)** | Audio Engine | Low-level cross-platform audio I/O & WASAPI Exclusive mode |
| **[Symphonia](https://github.com/pdeljanov/Symphonia)** | Audio Codecs | Pure Rust multi-format audio decoding (FLAC, WAV, MP3, AAC, ALAC) |
| **[rubato](https://github.com/HEnquist/rubato)** | Audio DSP | High-precision asynchronous audio sample rate conversion |
| **[AutoEq](https://github.com/jaakkopasanen/AutoEq)** | Acoustics DB | Jaakko Pasanen's dataset of 4,000+ calibrated headphone EQ curves |
| **[Framer Motion](https://www.framer.com/motion/)** | Animation | Fluid view transitions, dynamic modals, and player animations |
| **[Zustand](https://github.com/pmndrs/zustand)** | State Management | Fast, lightweight reactive in-memory state store |
| **[Lucide Icons](https://lucide.dev)** | Design & Icons | Clean, modern vector iconography |
| **[Wanakana](https://github.com/Wanakana/wanakana)** | Localization | Japanese Romaji & Kana transliteration engine |
| **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** | Streaming Proxy | Stream extraction and audio URL decoding |
| **[FFmpeg](https://ffmpeg.org)** | Media Engine | Multi-format audio stream transcoding and processing |
| **[LRCLIB](https://lrclib.net)** | Lyrics API | Community-driven synchronized lyrics database |
| **[MusicBrainz](https://musicbrainz.org)** | Metadata API | Global open music encyclopedia for album & artist metadata |
| **[Last.fm](https://www.lastfm.com/api)** | Web Service | Music discovery, scrobbling, and track similarity recommendations |
| **[ListenBrainz](https://listenbrainz.org)** | Web Service | Open-source music playback logging and analytics |
| **[Supabase](https://supabase.com)** | Cloud Platform | Safe, non-destructive multi-device cloud synchronization |
| **[SQLite / rusqlite](https://github.com/rusqlite/rusqlite)** | Local Database | Embedded high-speed SQLite database for local library tracks |

*Special thanks to all open-source maintainers and contributors who make music technology accessible to everyone.*

---

## 👨‍💻 Note from the Developer

> This project is a labor of love, developed as an educational journey into high-performance desktop application architecture and digital signal processing. As a Computer Science student, I built Aideo to explore the intersection of Rust's safety/performance and modern UI design. It is AI-assisted, serving as a testament to how modern tools can accelerate specialized software development.
> 
> — **Alirul**

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

<div align="center">

**Crafted with ❤️ for the Audiophile Community.**

⭐ *If you find this project useful, please consider giving it a star on [GitHub](https://github.com/Alirull18/Aideo-Music-Player)!*

</div>
