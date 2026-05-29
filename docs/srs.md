# Software Requirements Specification (SRS): Aideo Music Player

## 1. Introduction
- **System Name**: Aideo Music Player
- **Version**: 2.x
- **Date**: May 2026

### 1.1. Purpose
This document specifies the complete software requirements for the Aideo Music Player desktop application. It acts as the definitive engineering reference for the hybrid Tauri (Rust) and React (TypeScript) architecture, defining communication interfaces, serialization models, data storage schemas, and operational constraints.

### 1.2. Scope
Aideo is a high-fidelity desktop audio playback and streaming companion application. The scope encompasses the core multi-threaded Rust audio DSP engine, Windows WASAPI Exclusive Mode integrations, asynchronous scraper modules (yt-dlp, InnerTube YouTube Music, Tidal, Last.fm, ListenBrainz), and the React view-controller state machine.

---

## 2. Technical Architecture & System Interfaces

### 2.1. User Interface (UI) Requirements
- **Theme Engine**: Dynamically matches album art accent colors. Requires extraction of primary vibrant, muted, and dominant RGB tones from cover art images at track transition.
- **Rendering Performance**: Main view loops must maintain an absolute target of 60fps. Visual overlays must use Hardware Accelerated CSS transitions and Framer Motion spring physics.
- **Visualizer Layout**: Supports 128 to 512-channel live audio spectrum analysis rendering inside React Canvas contexts.

### 2.2. Hardware & Driver Interfaces
- **WASAPI Exclusive Access**: Direct lock on the audio endpoint device. Negotiates output stream constraints (sample rate, channels, bit depth) directly with the soundcard.
- **Bit-Depth Precision**: Support for 32-bit Float (`f32`), 32-bit Integer (`i32`), 24-bit Integer wrapped in 32-bit containers (with a strict `<< 8` left-shift formatting alignment and bitwise silent masking), and 16-bit (`i16`) PCM output.
- **Fallbacks**: If the targeted Exclusive hardware parameters are rejected by the soundcard driver, the engine must catch the panic and transition playback to a shared mixer device via CPAL.

### 2.3. Software Interfaces
- **Relational Storage (SQLite)**: SQLite serves as the indexing vault for local collections.
- **Native OS Power APIs (Win32)**: Prevents computer sleep and hibernation during audio playback using direct thread power reservation loops:
  ```rust
  windows::Win32::System::Power::SetThreadExecutionState(
      ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED | ES_CONTINUOUS
  );
  ```
- **External Decoders**: Operates background child processes of `yt-dlp` and `ffmpeg` to resolve and transcode remote streams.

### 2.4. Communication Interfaces (Tauri IPC Bridge)
Frontend and backend exchange state packets through two primary paradigms:
1. **Invoked Commands**: Asynchronous JSON request-response RPC bridge (`invoke(command_name, arguments)`).
2. **Real-time Event Broadcasts**: Push notification channels from the Rust audio thread to the UI (FFT visualizer bins, playhead progress tick, track transitions, background downloading percentiles).

---

## 3. Data Schemas & Serialization Models

### 3.1. Master DSP & Audio State (`DSPState`)
All parameters driving digital signal processing must serialize across the IPC bridge inside a unified schema:

```json
{
  "enabled": "boolean",
  "low_spec_mode": "boolean",
  "audio_profile": "string", 
  "resampler_interpolation": "string",
  "resampler_sinc_len": "number",
  "resampler_oversampling": "number",
  "ffmpeg_transcode_quality": "string",
  "width": "number",
  "upsample_rate": "number",
  "dither": "boolean",
  "exclusive_mode_timing": "string",
  "eq_enabled": "boolean",
  "eq_parametric": "boolean",
  "eq_graphic_gains": "number[]",
  "eq_parametric_bands": [
    {
      "freq": "number",
      "gain": "number",
      "q": "number",
      "band_type": "string"
    }
  ],
  "crossfeed_enabled": "boolean",
  "crossfeed_level": "number",
  "crossfeed_corner": "number",
  "spatial_enabled": "boolean",
  "spatial_haas_delay": "number",
  "spatial_wet": "number",
  "subsonic_enabled": "boolean",
  "night_mode_enabled": "boolean",
  "r128_enabled": "boolean"
}
```

### 3.2. Local Indexing SQLite Schema
The local database schema maintains relational tables for tracks, playlists, and playback listening history:

```sql
CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    title TEXT,
    artist TEXT,
    album TEXT,
    duration REAL,
    format TEXT,
    lyric_offset INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id INTEGER,
    track_path TEXT,
    position INTEGER,
    PRIMARY KEY(playlist_id, track_path),
    FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS playback_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    track_path TEXT NOT NULL,
    title TEXT,
    artist TEXT,
    album TEXT,
    duration REAL,
    format TEXT,
    timestamp INTEGER NOT NULL,
    duration_played REAL DEFAULT 0.0,
    skipped INTEGER DEFAULT 0
);
```

---

## 4. Detailed Functional Requirements

### 4.1. Audio Stream Lifecycle & Control
- **Play Command**: Command must launch audio thread, probe DAC formats, load the track, and apply **Soft Gain Ramping** over 256 samples to suppress speaker crackles.
- **RAM Protection Threshold**:
  - If track size on disk exceeds **150MB** OR length exceeds **15 minutes**:
  - The engine **MUST bypass the RAM cache** and stream in buffered chunks directly from disk.
- **Seeking**: Support for absolute float seconds seeking using Symphonia's precision seek packets.

### 4.2. Synchronized Lyrics Engine
- **LRC Timeline Matching**: Evaluates current playhead float position against lyric line arrays at a precision threshold of `16ms` (to match screen refresh frames).
- **Auto-Scroll Action**: Highlight the active lyric row and center it in the Lyrics Panel via CSS dynamic offset alignments.
- **Google Translate Connector**: Translate lines on-demand into English and generate Romanized Romaji/Transliterations.

### 4.3. Taste-Weighted Recommendations System
- **Autoplay Recommendations**: 
  - Seeds the playback queue with artist profiles, similar tracking weights from Last.fm, and ListenBrainz stats.
  - Excludes tracks previously played or marked as skipped.
  - Leverages RegEx parsing to filter out long loop files, instrumental arrangements, synthesia covers, and karaoke recordings.

---

## 5. Non-Functional Requirements (NFR)

### 5.1. Performance & Latency Targets
- **Engine Context Switching**: UI control inputs (Play, Pause, Volume Change) must register in the Rust playback loop within **< 5ms**.
- **Skip-Skip Skipping (Command Debouncing)**: Drains all intermediate `Play` command calls from the IPC receiver queue, jumping immediately to the final target track.
- **Scan Indexing Throughput**: Directory indexing scanner must maintain a scanning throughput threshold of **> 100 tracks per second** under standard local SSD speeds.

### 5.2. Safety, Reliability & Self-Healing
- **Poisoned Mutex Recovery**: If a background thread crashes while holding a lock on shared resources, target loops must catch the error and invoke `.into_inner()` on the poisoned mutex to recover memory safety.
- **Process Memory Leaks**: Thread allocation must clean up and release file handles immediately upon track unload or stream transitions.

### 5.3. Build & Portability Configurations
- **Framework**: Tauri v2, Vite, React 18, Rust (Cargo).
- **OS Platform Targets**: Windows 10/11 x64, with support for portable standalone directory executions.
