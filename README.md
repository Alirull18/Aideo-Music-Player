# 💎 Aideo Music Player v0.9.3

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

## 📢 Release Notes: Version 0.9.3

Welcome to **v0.9.3**! This update introduces smart hardware device matching, automated disk storage management, instant lyric translation controls, and audio visualizer optimizations for an effortless music experience.

---

### 🎧 Smart Headphone & Speaker Hardware Matching
* **Exact Audio Device Selection**: Automatically detects and distinguishes your specific DAC or headphone hardware (like FiiO, K9 Pro, or Amgrass DACs) without getting confused when multiple headphones are plugged in.
* **[System Default Device] Selection**: Easily revert to your Windows default audio output anytime with a dedicated **[System Default Device]** option in audio settings and quick controls.
* **Hot-Plug & Device Safeguards**: Seamlessly handles plugging in or unplugging headphones on the fly without stopping your listening session.

---

### 🧹 Smart Storage & Automatic Cache Cleaner
* **Customizable Cache Storage Limit**: Set your preferred cache storage cap (from 2.0 GB to 10.0 GB, defaulting to 5.0 GB) using a simple slider in **Settings -> System**.
* **Automatic Background Cleanup**: When cached songs and stream files exceed your selected storage limit, Aideo automatically cleans up your oldest, least recently played cache files in the background down to a safe threshold.
* **Live Storage Metrics**: View your real-time cache size, total cached files, and disk space usage directly inside Settings.

---

### 🌐 Instant Lyric Translation & Romaji Controls
* **One-Click Lyric Translations**: Instantly translate international songs line-by-line using AI translation in both Now Playing view and Fullscreen player mode.
* **Synchronized ON / OFF Toggles**: Toggle translations and Romaji transliteration subtext ON or OFF with a single click. Your preference stays 100% in sync across all player views.
* **Auto-Reveal Output**: Translated and Romaji text appear instantly on screen as soon as processing completes.

---

### 🎛️ Vibrant Audio Visualizers & Seamless Playback
* **Pre-DSP FFT Spectrum Visualizer**: Audio visualizer bars stay tall, responsive, and vibrant even when sound equalization (DSP, AutoEQ, or Limiter) is active.
* **Seamless Gapless Audio**: Transitions between songs seamlessly without silent gaps or pauses between tracks.
* **AutoEQ & Headphone Calibration**: Calibrate your headphones with over 4,000+ AutoEQ profiles, 10-band parametric EQ, Crossfeed, and Haas Spatializer modes.

---

### 🎵 Dynamic Library & Artist Hub
* **Interactive Artist Hub**: Click any artist name to view their complete discography, top tracks, and play stats in a sleek side drawer.
* **Translucent Glass Interface**: Enjoy responsive glassmorphic cards, custom accent themes, dynamic album backdrop color tinting, and intuitive search controls.

---

## 🚀 Getting Started

1. **Download**: Grab the latest release installer (`Aideo_0.9.3_x64_en-US.msi` or `.exe`) from the [**Releases Page**](https://github.com/Alirull18/Aideo-Music-Player/releases/latest).
2. **Install**: Run the Windows installer and launch Aideo.
3. **Enjoy**: Add your music folder or connect Subsonic/Jellyfin cloud streaming to start listening!

---

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Framer Motion, Lucide React
- **Backend**: Rust, Tauri v2, Tokio, WASAPI
- **DSP Engine**: Biquad Filter Array, EBU R128 LUFS Loudness Engine, FFT Spectrum Extractor
- **Styling**: Vanilla CSS with custom glassmorphism design system

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
