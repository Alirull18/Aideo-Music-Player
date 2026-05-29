# Product Requirement Document (PRD): Aideo Music Player

## 1. Document Control
- **Document Title**: Product Requirement Document (PRD) for Aideo Music Player
- **Status**: Draft / Under Review
- **Target Release**: v2.x Production
- **Owner**: Product Management & System Architect

---

## 2. Product Vision & Goals
Aideo is a high-fidelity desktop audio player and streaming hybrid, specifically engineered for audiophiles and music lovers. Traditional media players present a compromise: they either focus exclusively on bit-perfect local file playbacks (with complex, dated interfaces) or rely fully on closed cloud platforms that offer compressed streams and ignore local libraries.

Aideo breaks this compromise by combining a **state-of-the-art native audio engine (WASAPI Exclusive, ASIO, Bit-Perfect DSP, parametric EQ)** with a **premium, fluid frontend web view (React, Zustand, Framer Motion)**, integrating seamlessly with YouTube Music (via InnerTube), Tidal, Last.fm, and ListenBrainz.

### Key Business & Technical Goals
1. **Audiophile Fidelity**: Zero-latency, bit-perfect local and streaming audio bypasses OS mixers to talk directly to hardware DACs.
2. **Universal Library**: Unify local FLAC, WAV, and MP3 collections with cloud files (Jellyfin, Subsonic) and external streaming caches.
3. **Immersive Aesthetics**: Present an animated, glassmorphic layout that transitions smoothly using dynamic, cover art-responsive accent styling.
4. **Intelligent Discoveries**: Incorporate collaborative filtering engines and Last.fm/ListenBrainz feeds to supply taste-weighted local and YouTube autoplay lists.

---

## 3. User Personas
### Persona A: "The Pure Audiophile" (Julian, 34)
- **Background**: Owns high-end studio headphones and a specialized external USB DAC. His collection consists of 500GB of 24-bit/96kHz local FLAC/DSD albums.
- **Pain Points**: Windows audio mixer forcibly upsamples/downsamples his music, distorting quality. Media player equalizers cause clipping and phase jank.
- **Goal in Aideo**: Lock his DAC in WASAPI Exclusive mode, listen to bit-perfect native rates, and use soft gain ramping and high-res parametric equalizers.

### Persona B: "The Taste Explorer" (Maya, 24)
- **Background**: Listens to an eccentric mix of indie music, vaporwave uploads, and foreign anime soundtracks. Relies heavily on community lists and translation widgets.
- **Pain Points**: Standard streaming apps lack obscure music uploads. Finding synchronized lyrics in different languages is painful.
- **Goal in Aideo**: Search YouTube Music, download high-quality local copies via yt-dlp, view synced Romanized lyrics, and explore collaborative recommendation nodes.

---

## 4. Key Product Features & Functional Requirements

### 4.1. The Audiophile DSP Engine
- **WASAPI Exclusive Mode**: Absolute hardware locking. The backend probes bit-perfect rates (F32, I32, I24, I16) to output unmodified sound.
- **Bit-Perfect Pipeline**: Bypasses the digital resamplers, dithering, and mixing matrices, providing pure pass-through output.
- **High-Fidelity Parametric Equalizer**: 10-band EQ using peaking, lowshelf, and highshelf parametric filters calculated in real-time.
- **Spatial Processing & Audio Protection**:
  - *Haas Effect Delay & Crossfeed*: Smooths headphone listening by crossfeeding frequencies with subtle time delays.
  - *Loudness Normalization*: Integrates EBU R128 to match subjective track volume levels.
  - *RAM Safety Cache*: Streams tracks >150MB or >15 mins directly from disk, preventing memory overflow.
  - *Pop/Click Prevention*: Smooths gain transitions with a 256-frame (~5.8ms) soft volume ramp.

### 4.2. Universal Metadata & Local Library Manager
- **Reactive Indexer & Scanner**: Recursively scans directories for metadata extraction (using Symphonia) and updates an optimized SQLite database.
- **Metadata Editor**: Edit title, artist, and album entries.
- **Cover Art Extractor**: Extracts embedded ID3/Vorbis cover buffers or applies online JPG covers next to audio files.
- **Dual-State Playback Queue**: Frontend maintains a Zustand-based rich metadata queue; backend maintains a lightweight path queue, synchronized over Tauri IPC.

### 4.3. Dual-Engine Synced Lyric Suite
- **Interactive Timed LRC**: Karaoke-style lyric auto-scrolling with color highlights. Clicking a lyric seeks playback to that exact second.
- **Unified Lyric Scrapers**: Queries LRCLIB, NetEase, and QQ Music concurrently.
- **Instant Translation & Transliteration**: Translates lyrics to English on the fly and generates Romaji/Transliterated lines via Google Translation API.

### 4.4. Streaming, Cloud & Discovery Integrations
- **YouTube Music Discovery**: Uses InnerTube API to search and recommend tracks.
- **Taste-Weighted Autoplay Re-ranking**: Combines seed audio coordinates with Last.fm similar artist indices, filtering out instrumentals, karaoke, and long mixes via RegEx.
- **Tidal Hi-Fi Integration**: Authentic OAuth Device Code pairing flow allowing users to search, stream, and download lossless FLAC files.
- **Cloud Connections**: Fast Subsonic and Jellyfin server pinging, scanning, and direct streaming.
- **Dependency Installer**: Visual setup manager that automatically downloads and keeps `yt-dlp` and `ffmpeg` up to date.

### 4.5. OS Platform & Companion Features
- **System Media Transport Controls (SMTC)**: Standard Windows hardware hotkey integration (Play, Pause, Skip, Track info overlay).
- **Keep Awake Power Hold**: Prevents the PC from entering sleep mode during music playback.
- **Discord Rich Presence (RPC)**: Broadcasts "Now Playing" metadata with dynamic album art to Discord.
- **Onboarding Setup Wizard**: Guides user through choosing their mode ("Local File Only" or "Hybrid Streaming") and configures hardware defaults.

---

## 5. Non-Functional Requirements (NFR)

### 5.1. Performance & Memory Guardrails
- **DSP Thread Priority**: Audio decoding runs on a real-time thread scheduled at `THREAD_PRIORITY_TIME_CRITICAL` using Win32 API hooks.
- **UI Responsiveness**: Large libraries (200+ tracks) must render within 120ms by utilizing deferred React mounting loops and table skeleton indicators.
- **FFT Visualizer Refresh**: FFT bin packages (128 to 512 channels) must stream to the UI at up to 60fps over Tauri events without blocking state rendering.

### 5.2. Portability & Compliance
- **Operating System**: Primary compatibility for Microsoft Windows 10/11 x64, with portable builds.
- **Reliability (Self-Healing)**: Mutex poisoning recovery keeps the Tauri application running even if a third-party codec parser throws a thread panic.

---

## 6. Future Roadmap & Success Metrics
### Key Performance Indicators (KPIs)
- **Zero-Glitch Playback**: Zero reported audio crackles or stuttering under heavy multi-tasking.
- **Onboarding Completion**: >90% wizard completion rate.
- **Library Scalability**: Instantly scale indexing to 50,000+ local FLAC tracks with sub-second search filters.

### Upcoming Milestones
- **Phase 3 (Mobile Web Remote)**: A lightweight local websocket client that turns mobile phones into playback controllers.
- **Phase 4 (Offline Native AI Smart Mix)**: Spawns tiny local LLMs/embeddings to group songs by tempo and micro-genre coordinates.
