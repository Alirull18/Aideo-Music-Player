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

* 🎨 **4 Selectable Aideo Home Page Layouts**: Switch dynamically in Settings between **Classic Studio**, **Editorial Bento Grid**, **Audiophile Minimalist Deck**, and **Immersive Cinematic Flow** to fit your personal listening style.
* 🎛️ **5 Selectable Player Bar Designs & Glassmorphism**: Personalize the bottom playback bar with **Classic Studio**, **Floating Dynamic Island**, **Audiophile Waveform Deck**, **Minimalist Compact**, or **Retro Vinyl Deck** (featuring dynamic music-adaptive color illumination and frosted glass transparency).
* 🌈 **Global Adaptive Color Synchronization**: Dynamic color palette extraction now syncs seamlessly across all views and modes (including Mini Player, Library, and background views), updating UI accent colors and ambient lighting in real time for every song change.
* 🎧 **Studio Stereo & Spatial Imaging**: Fixed the spatializer dry/wet engine so your stereo tracks maintain 100% of their rich separation, punch, and soundstage at default settings without collapsing to mono.
* 🔊 **True 5.1 & 7.1 Surround Sound**: Multi-speaker setups now route real silence to unassigned surround channels instead of leaking left-ear audio to center and subwoofer channels.
* 🔄 **Zero-Glitch Crossfading**: Crossfading between songs now uses independent stream pipelines, preventing upcoming track buffering from cutting off or stuttering your active music.
* 🛡️ **Silence Gate on Volume Normalizer**: Loudness normalization automatically holds unity gain during song intros and pauses, eliminating loud volume blasts when quiet tracks start.
* ⚡ **Rapid Skip Protection**: Skipping songs quickly now instantly synchronizes lyrics, cover art, and ambient lighting without showing old lyrics or delayed artwork.
* 🔒 **Hardened File & Library Security**: Track deletions are strictly verified and locked within your registered music library folders to protect personal system files.
* 🔐 **Cryptographic Binary Verification**: All streaming helper tools (`yt-dlp`, `ffmpeg`) are checked against official SHA-256 cryptographic signatures before execution.
* 🔋 **Zero GPU Leak & Battery Saver**: Ambient liquid background animations use a synchronized render loop that automatically sleeps when minimized or in background tabs.
* 📜 **Distraction-Free Collapsible Lyrics Header**: Added an intuitive one-click toggle to collapse and hide the top lyric section controls into an unobtrusive glassmorphic pill, expanding vertical screen real-estate for full-height synchronized lyrics.
* 🎮 **Seamless Discord Rich Presence (RPC)**: Broadcast your current music in real-time to Discord with live track titles, artist details, and playback status — fully supporting local library tracks, online webstreams, and Subsonic/Jellyfin cloud cached music.
* 🏷️ **Native In-App ID3 / FLAC Metadata & Cover Tag Editor**: Read and write metadata tags losslessly (FLAC Vorbis, MP3 ID3v2, M4A/AAC atoms, OGG, WAV) using pure Rust without altering audio frames. Includes single/batch editing, drag-and-drop cover art embedding, online artwork search, and one-click auto-tagging via MusicBrainz.
* 🪟 **Floating Transparent Desktop Lyric Bar (HUD)**: Always-on-top transparent lyric bar with smooth sub-frame syllable-level karaoke progress, Japanese Romaji & live translations, custom font scaling, and a Click-Through HUD mode (toggle lock anytime with `Alt + L` or from the Player Bar).
* 📡 **Lossless UPnP / DLNA Network Streamer**: Cast bit-perfect lossless FLAC/WAV/AAC streams across your home network with SSDP multicast discovery, SOAP AVTransport / RenderingControl, and a unified Cast & DLNA selector hub.
* 📁 **M3U / M3U8 Playlist Engine**: Full import and export support for standard and extended `#EXTM3U` playlist formats with fuzzy audio matching and relative path resolution.
* 👁️ **Live Library Directory Watcher**: Native Rust background file system watcher that automatically detects, indexes, and syncs newly added or modified tracks without manual rescanning.
* 🛡️ **Hardened Updater & Checksum Enforcement**: Remote updater strictly validates SHA-256 cryptographic checksums before running installer binaries, preventing unverified execution and purging corrupted payloads.
* 🎯 **Sub-Millisecond Karaoke Sync**: Enhanced LRC relative word-level timestamps (`<mm:ss.xx>`) are mathematically offset for fluid word-by-word karaoke synchronization.
* 🛡️ **Bit-Perfect State Protection & WASAPI Recovery**: Automatic protection keeps Bit-Perfect audio mode engaged safely during DSP adjustments, with proactive WASAPI exclusive mode stream recovery.
* 🚀 **Lighter & Faster Footprint**: Cleaned up legacy unmounted components and pruned unused dependencies, making Aideo faster to start and lighter on system RAM (~75MB).

> 📖 *For the complete release breakdown, see the [**v0.9.6 Release Notes**](docs/RELEASE_NOTES_v0.9.6.md).*

---

## 📜 Previous Release Highlights

<details>
<summary><strong>✨ What Was New in v0.9.5 (Click to expand)</strong></summary>
<br />

Version **0.9.5** delivered a major upgrade to music discovery, battery & CPU efficiency, full artist discography browsing, and seamless desktop multitasking:

* 🧠 **Smarter AI Discovery Hub**: Enjoy 40–75+ accurate music recommendations tailored to your taste, with smart anti-collision verification that prevents unrelated songs with the same title from appearing.
* 🚫 **Zero-Tolerance Slop Filter**: Search results and recommendations automatically filter out reaction videos, dance covers, and fancams—keeping your feed 100% focused on authentic music.
* 🎵 **Complete Artist Discographies**: Explore an artist's full catalog with instant tabs for **🔥 Popular Hits**, **🎵 All Releases & Singles**, and **📁 In Library**, complete with a live in-profile search filter.
* ⚡ **Whisper-Quiet 0% Idle Engine**: Visualizers, background timers, and lyric sweeps automatically sleep when audio is paused or minimized, saving laptop battery and eliminating idle CPU usage.
* 📌 **Pinned Mini Player & Multi-Screen HUD**: Keep the Mini Player floating above games and work with the new **Always-on-Top Pin**, or enjoy borderless fullscreen on multi-monitor setups without cursor capture.
* 🎨 **Adaptive Artwork & Ambient Blur**: Non-square album covers render in their authentic aspect ratio with dynamic, color-matched ambient blur backdrops.
* 🎯 **Multi-Select & Bulk Actions**: Select multiple songs at once (`Ctrl + Click`, `Shift + Click`) to play, queue, favorite, or add them to playlists with a single click.
* 🔄 **Resilient Reconnection & Auto-Updates**: Network dropouts automatically resume right where you left off, while background streaming helpers update seamlessly.
* 🪟 **System Tray & Session Memory**: Keep audio playing when minimized to the Windows system tray. Aideo automatically restores your volume, tabs, and window layout on startup.

> 📖 *For the complete developer notes and deep technical details, see the [**v0.9.5 Release Notes**](docs/RELEASE_NOTES_v0.9.5.md).*

</details>

---

## 🎨 Selectable Aideo Home Page Layouts

Aideo allows you to personalize your main home portal (`/aideo`) with 4 distinct, custom-engineered UI layouts selectable under **Settings > Appearance**:

* 🏛️ **Classic Studio (`classic`)**: The balanced studio dashboard with greeting telemetry, multi-shelf discovery hubs (*Made For You, Jump Back In, Heavy Rotation, Forgotten Gems*), quick recap cards, recent track carousel, and smart mix builder.
* 🍱 **Editorial Bento Grid (`bento`)**: Modern Apple/Linear style asymmetric grid with a dynamic **Hero Spotlight Card**, 1-click **Mood Soundscapes**, live **Library Pulse & DSP Telemetry**, and a **Heavy Rotation Micro-Stack**.
* 🎛️ **Audiophile Minimalist Deck (`audiophile`)**: Precision HUD and audio telemetry engine with format spec badges (*FLAC 24/96, WAV 24b, Hi-Res DSD, MP3 320k*), audio quality filter chips, and a high-density tabular stream deck.
* 🌌 **Immersive Cinematic Flow (`cinematic`)**: Full-bleed ambient visual stage with sweeping dynamic backdrop glow, display typography, glowing primary playback pill, and rich radial gradient **Cinematic Mood Stations**.

---

## 🎛️ Selectable Player Bar Styles & Glassmorphism

Customize your playback bar interface with 5 distinct, popular player bar layouts and optional hardware-accelerated frosted glass transparency under **Settings > Appearance**:

* 🎙️ **Classic Studio (`classic`)**: The balanced 3-column desktop layout featuring a responsive interactive waveform seekbar, synchronized live lyric peek, audio bit-depth badge, and complete quick utility drawer.
* 🏝️ **Floating Dynamic Island (`floating`)**: Suspended glassmorphic pill capsule elevated above the viewport with centered fluid controls, circular artwork thumbnail, and soft ambient back-glow.
* 📊 **Audiophile Waveform Deck (`waveform`)**: Upper-deck 64-bar interactive audio waveform scrubbing deck with hover timestamp preview and live audiophile hardware telemetry HUD (`[WASAPI / ASIO · 96.0kHz · BIT-PERFECT]`).
* ⚡ **Minimalist Compact (`minimal`)**: Ultra-slim 48px low-profile distraction-free bar with top hairline scrubbing line and inline metadata, maximizing screen real estate for your library.
* 📻 **Retro Vinyl Deck (`vinyl`)**: Vintage turntable aesthetic featuring a **spinning vinyl record disc** (spins while playing, pauses on standby), mechanical tactile transport buttons, glowing analog status LEDs, and **adaptive colors** that dynamically illuminate to match the currently playing music's cover art palette.
* 🪟 **Transparent Glass Playbar**: Optional glassmorphic frosted backdrop-blur (`backdrop-filter: blur(24px) saturate(180%)`) allowing liquid visualizers and ambient artwork to flow underneath the playback controls.

---

## 🧭 Discovery Hub & Dynamic Multi-Shelf Layouts

Aideo features an algorithmic **Discovery Hub** that adapts to your listening habits whether you are connected to high-res cloud streams or listening 100% offline to your local library:

* 🗂️ **Dual Layout Modes**: Switch effortlessly between **Multi-Shelf View** (categorized shelves grouped by context) and **Unified Feed View** (dense discovery track matrix).
* 📐 **Adaptive Square Grid Sizing**: Real-time slider to customize album card dimensions from compact mini-squares to full-size showcase tiles.
* ⚡ **7 Dynamic Algorithmic Smart Mixes**: Automatically generated mood categories including *High Energy Flow*, *Deep Focus & Flow*, *Late Night Chill*, *Moody Reflections*, *My Supermix*, *Discovery Mix*, and *Top Artist Spotlight*.
* ⏳ **Library Intelligence Shelves**:
  * **Jump Back In**: Quickly resume recent listening history across all sessions.
  * **Heavy Rotation**: Track rankings derived from your highest play counts.
  * **Time Capsule (Forgotten Gems)**: Rediscover loved songs and past favorites you haven't listened to recently.
  * **Playlist Blends**: Curated blend mixes created directly from your custom playlists.
* 🏠 **100% Offline Local Mode**: Generates rich personalized discovery shelves, algorithmic mixes, and loads embedded ID3/FLAC cover artwork with zero network dependencies.

---

## 📻 Infinite Autoplay & Smart Radio Engine

Aideo includes an intelligent **Autoplay & Infinite Radio Engine** that keeps your music playing seamlessly:

* 🔄 **Dynamic Seed Evolution**: As tracks progress, the recommendation engine evolves with your current vibe, ensuring an endless queue that never exhausts or repeats prematurely.
* 🎯 **Taste-Weighted Deduplication**: Evaluates candidate tracks using similarity scoring, artist matching, and your playback history while automatically filtering out disliked songs.
* 🌐 **Universal Source Support**: Seed radios from YouTube Music, Tidal, Subsonic/Jellyfin cloud streams, or your local library audio files.
* ⚡ **Pre-Buffering & Rapid Skip Protection**: Asynchronous lookahead pre-resolving and concurrency tracking eliminate audio stutter and queue race conditions during fast track skips.

---

## 🎤 Word-by-Word Karaoke & Desktop Floating HUD

Stay immersed in your music with professional, studio-grade karaoke lyrics:

* 🎤 **60fps Word-by-Word Syllable Sync**: Fluid intra-syllable gradient wipe animations powered by a comprehensive multi-tier provider cascade:
  * **BiniLyrics** (Official Apple Music TTML with 100% global top-song coverage)
  * **Better Lyrics / Unison** (Community crowdsourced word-sync TTML)
  * **NetEase Cloud Music** (YRC karaoke lyrics with millisecond precision)
  * **Kugou Music** (KRC decrypted karaoke streams)
  * **QQ Music** (QRC syllable timestamp parsing)
  * **LRCLIB** (Community line-synchronized lyrics)
* 🎛️ **3 Display Modes with 1-Click Toggle**: Effortlessly cycle between **🎤 Karaoke** (word-by-word gradient wipe), **⏱️ Line Sync** (smooth active line highlighting), and **📄 Plain Text** (scrollable reading mode).
* 🪟 **Always-On-Top Floating Desktop HUD**: Borderless, transparent glassmorphic desktop lyrics bar that floats above all applications and full-screen games with interactive font scaling (`+/-`), subtitle support, and hover playback transport controls.
* 🔒 **Click-Through Desktop Lock Mode (`Alt+L`)**: Lock the overlay to make it click-through, preventing any accidental mouse interference while gaming or typing.
* 🌐 **High-Speed Batch Translation**: Multi-line batch translation with 4-tier fallback protection (Google Web Batch ➔ Google API ➔ Google Mobile ➔ MyMemory) that completely eliminates rate limiting (`HTTP 429`).
* 🎌 **0ms Instant Local Romanizer**: 100% offline mathematical **Korean Hangul Romanization** (Revised Romanization of Korean) and **Japanese Hepburn Romanization** (Hiragana/Katakana) for instant, latency-free Romaji rendering.
* 📜 **Collapsible Lyric Controls**: One-click toggle to collapse toolbar controls into a sleek floating pill for an uninterrupted, full-height lyric viewing stage.
* 🎨 **Dynamic Glow & Palette Adaptation**: Synchronizes lyric highlight colors in real-time to match the active song's album art.

---

## 📡 Lossless UPnP / DLNA Network Streaming

Cast your audio across your home network without quality compromises:

* 🔊 **Hi-Res Bit-Perfect Streaming**: Stream raw lossless FLAC, WAV, AAC, and MP3 audio directly over local HTTP endpoints without lossy transcoding.
* 🔍 **Auto SSDP Device Discovery**: Fast multicast UDP discovery (`239.255.255.250:1900`) identifying DLNA MediaRenderers (Marantz, Denon, Yamaha, WiiM, Sonos, Pioneer, Smart TVs).
* 🎛️ **Full Remote Transport Sync**: Complete UPnP AVTransport 1.0 and RenderingControl implementation supporting Play, Pause, Stop, Seek, Volume control, and position polling.
* 📱 **Unified Cast Hub (`CastSelector.tsx`)**: Seamlessly switch between Google Cast and UPnP/DLNA Hi-Res devices with network latency telemetry.

---

## 🏷️ Audio Tag & Metadata Studio

Manage your music library tags directly within Aideo:

* ✏️ **Lossless Container Tagging**: Powered by pure Rust (`lofty`), reading and writing ID3v2.3/v2.4, FLAC Vorbis comments, MP4 atoms, RIFF/AIFF, and Opus metadata safely without touching audio frames.
* 📦 **Single & Batch Tag Editing**: Update track titles, artists, albums, genres, release years, and track/disc numbers across multiple files at once in atomic SQLite transactions.
* 🖼️ **Cover Art Embedding Engine**: Drag-and-drop new cover art directly into audio files, search high-resolution square covers online (MusicBrainz, NetEase, QQ Music, YouTube), or extract existing embedded art.
* 🤖 **MusicBrainz Auto-Tagger**: One-click automatic metadata search and tagging to pull official catalog releases, album titles, and track numbers.
* 📜 **Embedded Lyrics**: Save synchronized and unsynchronized lyrics directly into your local audio containers.

---

## 📁 M3U / M3U8 Playlists & Real-Time Directory Watcher

Manage external playlists and stay in sync with your local file system automatically:

* 📄 **Universal M3U & M3U8 Import/Export**: Import custom playlist files (`.m3u`, `.m3u8`) with automatic UTF-8 fallback, extended `#EXTINF` metadata parsing, relative-to-absolute path resolution, and fuzzy title/artist library matching. Export your in-app playlists directly to standard `.m3u` or extended `#EXTM3U` format with one click.
* 👁️ **Native Rust Library Watcher**: Low-overhead asynchronous file system monitoring (`notify` in Rust) continuously watches your registered music folders, instantly indexing new downloads, updated audio files, and cleaning up removed items in real-time.

---

## 🎮 Discord Rich Presence (RPC)

Showcase your listening vibe directly on your Discord profile:

* 🎵 **Universal Track Broadcast**: Accurately shares whatever you are playing—whether it's high-res local audio files, online webstreams, YouTube previews, or offline cached songs from Subsonic & Jellyfin.
* ⚡ **Live Status & State Synchronization**: Automatically updates your activity status (Playing, Paused, Idle) and provides interactive rich presence action buttons (*"Listen with Aideo"* and *"Download App"*).
* 🔒 **One-Click Privacy Toggle**: Enable or disable Discord Rich Presence anytime with a single click in **Settings > General** or during initial onboarding.

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
| **`Alt+L`** | **Desktop Lyrics Lock** | Lock / unlock click-through mode on the Desktop Lyric Bar |
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
- **Audio Metadata & Tagging**: Lofty (Pure Rust ID3, FLAC, MP4, Vorbis container editor)
- **Network Streaming**: SSDP (Simple Service Discovery Protocol), UPnP AVTransport 1.0 SOAP Engine
- **Database**: SQLite (via rusqlite), Supabase Cloud Sync
- **Styling**: Vanilla CSS with custom glassmorphism design system

---

## 🔒 Security, Privacy & Transparency

Aideo is 100% open-source, client-side, and privacy-first. Your music library, playback telemetry, and keys remain under your control.

### 🛡️ Understanding Desktop Security & Code Scanners
If you run automated code security or web-repository scanners (such as *ScanRepo*) on this repository, you may encounter warnings for patterns like *Command Execution*, *Unsafe Blocks*, or *Network Signing*. In a native desktop application, these are standard, legitimate operating system integrations:

* **Native Process Execution (`std::process::Command`)**: Used exclusively to manage local helper utilities — updating the local `yt-dlp` tool (`yt-dlp -U`), opening Windows File Explorer to the cache folder (`explorer <cache_dir>`), and executing in-app self-updater binary swaps.
* **Native Win32 FFI & Unsafe Blocks (`unsafe`)**: Required to interface directly with Windows OS services, such as MMCSS (`AvSetMmThreadCharacteristicsW` for real-time *Pro Audio* thread scheduling in bit-perfect WASAPI playback), reading DWM window styling registry values, and rendering media control buttons (`ExtractIconW`) on the Windows Taskbar thumbnail preview.
* **API Signing & OS Keyring**: Web services like Last.fm require request signing (`api_sig`) via MD5 hash as mandated by their official authentication protocol. Cloud credentials and passwords are stored securely using the native operating system's Credential Manager / Keychain (`keyring`).
* **Cryptographic Binary Verification**: All downloaded external helper tools (`yt-dlp`, `ffmpeg`) are verified against official SHA-256 cryptographic signatures prior to execution.

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
| **[lofty-rs](https://github.com/Serial-ATA/lofty-rs)** | Audio Metadata | Pure Rust audio metadata reading and writing engine |
| **[rubato](https://github.com/HEnquist/rubato)** | Audio DSP | High-precision asynchronous audio sample rate conversion |
| **[AutoEq](https://github.com/jaakkopasanen/AutoEq)** | Acoustics DB | Jaakko Pasanen's dataset of 4,000+ calibrated headphone EQ curves |
| **[Framer Motion](https://www.framer.com/motion/)** | Animation | Fluid view transitions, dynamic modals, and player animations |
| **[Zustand](https://github.com/pmndrs/zustand)** | State Management | Fast, lightweight reactive in-memory state store |
| **[Lucide Icons](https://lucide.dev)** | Design & Icons | Clean, modern vector iconography |
| **[Wanakana](https://github.com/Wanakana/wanakana)** | Localization | Japanese Romaji & Kana transliteration engine |
| **[yt-dlp](https://github.com/yt-dlp/yt-dlp)** | Streaming Proxy | Stream extraction and audio URL decoding |
| **[FFmpeg](https://ffmpeg.org)** | Media Engine | Multi-format audio stream transcoding and processing |
| **[BiniLyrics](https://github.com/binimum)** | Lyrics CDN | High-fidelity Apple Music word-by-word TTML lyrics database |
| **[Better Lyrics](https://github.com/better-lyrics)** | Lyrics Engine | Open-source syllable & word-level karaoke timing specifications |
| **[LRCLIB](https://lrclib.net)** | Lyrics API | Community-driven synchronized lyrics database |
| **[MusicBrainz](https://musicbrainz.org)** | Metadata API | Global open music encyclopedia for album & artist metadata |
| **[Last.fm](https://www.lastfm.com/api)** | Web Service | Music discovery, scrobbling, and track similarity recommendations |
| **[ListenBrainz](https://listenbrainz.org)** | Web Service | Open-source music playback logging and analytics |
| **[Supabase](https://supabase.com)** | Cloud Platform | Safe, non-destructive multi-device cloud synchronization |
| **[SQLite / rusqlite](https://github.com/rusqlite/rusqlite)** | Local Database | Embedded high-speed SQLite database for local library tracks |
| **[discord-rich-presence](https://github.com/vion/discord-rich-presence)** | Integration | Discord Rich Presence IPC client implementation |

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
