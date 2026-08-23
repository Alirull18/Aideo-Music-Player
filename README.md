# 💎 Aideo Music Player v0.9.6

**A beautiful, crystal-clear desktop music player built for pure sound, real-time karaoke lyrics, and a listening experience that looks as good as it feels.**

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-24C8DB?logo=tauri)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-Backend-000000?logo=rust)](https://www.rust-lang.org)
[![Product Hunt](https://img.shields.io/badge/Product%20Hunt-Featured-FF6154?logo=producthunt)](https://www.producthunt.com/products/aideo-music-player)

<div align="center">
  <a href="https://www.producthunt.com/products/aideo-music-player?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-aideo-music-player" target="_blank" rel="noopener noreferrer"><img alt="Aideo Music Player - Fall in love with your music library again | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1222567&amp;theme=light&amp;t=1787490971129"></a>
</div>

Aideo is a modern, lightweight desktop music player designed for music lovers who want **studio-quality audio**, **word-by-word karaoke lyrics**, and a **gorgeous interface** that adapts to their taste. Whether you're listening to local files on your computer or streaming from your cloud collection, Aideo makes every track sound and look its best.

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
        <img width="100%" alt="YouTube Discovery Hub" src="https://github.com/user-attachments/assets/0f7f7e51-3ed0-424e-8afe-067b8974faf8" />
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

## ✨ What's New in v0.9.6

Version **0.9.6** brings huge improvements to sound quality, visual customization, and everyday speed:

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

> 📖 *Looking for deep technical patch notes? Read the full [**v0.9.6 Release Notes**](docs/RELEASE_NOTES_v0.9.6.md).*

---

## 📜 Previous Release Highlights

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
* **4 Home Screen Layouts**: Pick the layout that fits your mood — from a clean grid to an immersive cinematic background.
* **5 Playback Bar Styles**: Choose standard desktop controls, an ultra-compact bar, a floating pill, or a retro spinning vinyl record.
* **Frosted Glass (Glassmorphism)**: Beautiful transparent backgrounds that let album art and visualizers shine through.

### 🎤 Sing Along with Live Karaoke Lyrics
* **Word-by-Word Sing-Along**: Highlights words in real-time as they are sung (powered by Apple Music & community lyrics).
* **3 Lyric Modes**: Switch with one click between **Word Karaoke**, **Line-by-Line Scroll**, or **Plain Text**.
* **Floating Desktop Bar**: Keep lyrics on your screen while working or gaming. Press `Alt + L` to enable **Click-Through Mode** so it never gets in your way.
* **Instant Translations & Pronunciation**: Translate foreign lyrics on the fly, with automatic pronunciation (Romaji) for Japanese and Korean songs.

### 🔊 Studio-Grade Sound Quality
* **Bit-Perfect Playback**: Delivers uncompressed, exact master sound directly to your headphones or DAC.
* **Headphone Tuner (AutoEQ)**: Choose from over 4,000 pre-calibrated headphone profiles to make your specific headphones sound their absolute best.
* **Volume Leveling**: Keeps song volume consistent across different albums so you don't have to constantly adjust the volume knob.
* **Wide Stereo & Spatial Sound**: Enjoy a wide, immersive soundstage without losing vocal clarity.

### 🧭 Smart Music Discovery
* **7 Smart Mixes**: Automatically created playlists like *High Energy*, *Deep Focus*, *Late Night Chill*, and *Forgotten Gems*.
* **Infinite Radio**: Keep the music going with an endless queue of songs that match your current listening vibe.
* **100% Offline Friendly**: Generates smart mixes and browses embedded album art even with no internet connection.

### 📁 Easy Music Management
* **Tag & Cover Art Editor**: Rename tracks, fix artist names, and embed square cover art into your audio files.
* **One-Click Auto-Tagger**: Automatically search online music databases to fill in missing track info.
* **Auto-Syncing Folders**: Automatically discovers newly downloaded songs in your music folders.
* **Playlist Support**: Import and export standard `.m3u` and `.m3u8` playlists effortlessly.
* **Cloud & Server Streaming**: Connect your Subsonic or Jellyfin home music server for remote listening.

### 📡 Listen Everywhere
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

## 🚀 How to Get Started

1. **Download**: Grab the latest installer (`.msi` or `.exe`) from the [**Releases Page**](https://github.com/Alirul/Aideo-Music-Player/releases/latest).
2. **Install**: Run the installer on your Windows PC and open Aideo.
3. **Listen**: Select your music folder (or connect your cloud server) and enjoy your music!

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
- **Frontend**: React 19, TypeScript, Framer Motion, Zustand, Lucide React
- **Desktop Architecture**: Tauri v2, Rust, Tokio Async Runtime, Windows WASAPI
- **Audio & DSP**: CPAL, Symphonia (pure Rust multi-format decoder), Rubato Resampler, Biquad Filter Array, EBU R128 LUFS Loudness Engine
- **Audio Metadata & Tagging**: Lofty (Pure Rust ID3, FLAC, MP4, Vorbis container editor)
- **Network Streaming**: SSDP (Simple Service Discovery Protocol), UPnP AVTransport 1.0 SOAP Engine
- **Database**: SQLite (via rusqlite), Supabase Cloud Sync
- **Design System**: Hardware-accelerated CSS glassmorphism

### Security, Privacy & Transparency
Aideo is 100% open-source, client-side, and privacy-first. Your music library, playback history, and login keys stay securely on your computer.

* **Helper Tools (`yt-dlp`, `ffmpeg`)**: Used to stream and transcode online tracks. All helper tools are verified against official SHA-256 cryptographic signatures before running.
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

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

<div align="center">

<a href="https://www.producthunt.com/products/aideo-music-player?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-aideo-music-player" target="_blank" rel="noopener noreferrer"><img alt="Aideo Music Player - Fall in love with your music library again | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1222567&amp;theme=light&amp;t=1787490971129"></a>

<br/><br/>

**Crafted with ❤️ for the Audiophile Community.**

⭐ *If you find this project useful, please consider giving it a star on [GitHub](https://github.com/Alirull18/Aideo-Music-Player)!*

</div>
