# Design Specification: Aideo Music Player "Absolute Cinema" Showcase Website

**Date:** 2026-09-04  
**Status:** Approved  
**Target Location:** `website/` (Completely isolated; `index.html` and `docs/index.html` remain untouched)

---

## 1. Executive Summary & Product Identity
Aideo Music Player v0.9.7 is an audiophile desktop music player for Windows 10/11 engineered for bit-perfect WASAPI Exclusive playback, 4,000+ AutoEQ headphone calibrations, real-time parametric DSP, 5 immersive Theater Mode archetypes, synchronized 60fps Romaji lyrics, and hybrid local/streaming integration.

This project delivers a standalone, showcase landing website located in `website/` that sets a new high-water mark for audio software websites. It synthesizes the mechanical tactile precision of Dieter Rams and Teenage Engineering with the kinetic fluid atmosphere of modern high-end creative interfaces.

---

## 2. File & Component Architecture

All files are created exclusively inside the new `website/` directory:

```text
website/
├── index.html           # Full semantic HTML5 document with structured data & rich metadata
├── style.css            # Custom CSS system (OKLCH, responsive typography, glassmorphism, keyframes)
└── app.js               # Vanilla JS engine powering ballistic VU meters, Web Audio EQ, Theater switcher & lyrics
```

### Constraints:
* **Zero impact on existing files**: `index.html`, `docs/index.html`, `design-test/` remain bit-for-bit unchanged.
* **No external runtime bloat**: Standalone HTML5/CSS3/Vanilla JS (ES6+), referencing high-resolution CDN assets and Google Fonts for maximum loading speed and reliability.

---

## 3. Visual Language & Design System

### 3.1 Color Palette (OKLCH Native)
* **Surface Background Deep**: `oklch(0.12 0.015 260)` (#07070d)
* **Surface Card Elevate**: `oklch(0.16 0.02 260 / 0.72)` (Deep frosted slate)
* **Surface Card Border**: `oklch(1 0 0 / 0.08)` / `oklch(0.7 0.15 155 / 0.3)` on hover
* **Acoustic Emerald (Hardware Lock)**: `oklch(0.78 0.19 152)` (#10b981 / #34d399)
* **Analog Amber (Vacuum Tube)**: `oklch(0.78 0.16 68)` (#f59e0b / #fbbf24)
* **Precision Cyan (DSP & Telemetry)**: `oklch(0.80 0.14 210)` (#06b6d4 / #38bdf8)
* **Text Pure**: `oklch(0.98 0.005 260)` (#f8fafc)
* **Text Muted**: `oklch(0.70 0.02 260)` (#94a3b8)
* **Text Faint**: `oklch(0.50 0.02 260)` (#64748b)

### 3.2 Typography
* **Display / Headings**: `Bricolage Grotesque`, sans-serif (fluid `clamp(2.5rem, 6vw, 4.75rem)`, tracking `-0.025em`)
* **Body**: `Plus Jakarta Sans` or `Inter`, sans-serif (line length 65–75ch, high contrast against backgrounds)
* **Telemetry / Data / Numbers**: `JetBrains Mono`, monospace (tabular figures, crisp audio specs)

### 3.3 Motion & Interaction Craft
* **Ballistic VU Meter Simulation**: Damped mechanical spring equations modeling inertia, peak hold decay, and overshoot on dual analog needles.
* **60fps Syllable Karaoke Wipe**: CSS linear-gradient text background clipping animated smoothly along with playback time.
* **Dynamic Perspective Tilt**: Subtle 3D mouse parallax on hero hardware elements without hover-scale layout jank.

---

## 4. Detailed Section Breakdown

### Section 1: Command Header (`<nav>`)
* Logo badge with animated status LED (`WASAPI 384kHz Exclusive`).
* Smooth-scroll anchors: *Signal Path*, *Theater*, *DSP Lab*, *Lyrics*, *Specs*, *FAQ*.
* External links: GitHub Stars badge + Download CTA pill.

### Section 2: Hero — The Audiophile Console (`<header>`)
* Eyebrow status: `● VERSION 0.9.7 RELEASED • BIT-PERFECT WASAPI EXCLUSIVE CORE`.
* Main Headline: **"Sound Without Compromise. Music the Way It Was Mastered."**
* Primary action button: *Download for Windows 10/11 (Free, Open Source)*.
* Secondary action button: *Test Interactive Audio Lab*.
* **Interactive Ballistic VU Meters Deck**: Dual analog needles (Left/Right Peak & RMS) with dynamic audio level fluctuations and interactive toggle button to cycle signals.
* **Floating 3D Viewport**: High-resolution screenshot showcase with interactive tabs switching between:
  1. Cinematic Fullscreen HUD
  2. Aideo Lab Pro DSP & 10-Band EQ
  3. Pristine Library Dashboard
  4. YouTube & AI Discovery Hub
  5. Main Player Interface

### Section 3: The 5 Theater Mode Archetypes (`<section id="theater">`)
Showcase of v0.9.7's flagship feature with an interactive mode selector:
1. **Hi-Fi Studio Deck**: Dual-needle ballistic VU meters + brushed aluminum faceplate.
2. **Vinyl Turntable**: 33⅓ RPM rotating vinyl record, tonearm tracking, groove reflection.
3. **Stage Mode**: Immersive concert lighting and ambient color extraction.
4. **Editorial Poster**: Bold Swiss typography and dominant album palette.
5. **Zen Sanctuary**: Distraction-free typography with breathing ambient glow.

### Section 4: Signal Path Telemetry Lab (`<section id="signal-path">`)
Interactive A/B comparator contrasting:
* **The Windows Shared Mixer Problem**: Uncontrolled 48kHz resampling, CAudioLimiter dynamic compression, and dithering distortion.
* **Aideo WASAPI Exclusive Direct Transport**: Unbroken hardware lock directly addressing DAC registers at native 384kHz / 32-bit float or DSD256 DoP.
* Interactive toggle simulating oscilloscope waveforms (jittery clipped wave vs pristine sine wave).

### Section 5: Real-time Web Audio Parametric DSP & AutoEQ (`<section id="dsp-lab">`)
* Interactive 10-band slider interface (31Hz to 16kHz).
* Real-time SVG frequency curve rendered dynamically as sliders move.
* 1-Click AutoEQ Headphone Profile Presets:
  * Sennheiser HD 600 (Harman Neutral Target)
  * Sony WH-1000XM5 (Bass Clarity & Treble Restoration)
  * Moondrop Blessing 2 (Diffuse-Field In-Ear Reference)
  * Flat Audiophile Reference
* Equalizer APO export copy snippet preview.

### Section 6: Silky 60fps Romaji & Karaoke Lyrics (`<section id="lyrics">`)
* Realistic interactive lyric player with word-by-word syllable wipe.
* Live 3-way toggle button:
  * Original Japanese Kanji / Kana (`夜に駆ける`)
  * Romanized Romaji (`Yoru ni kakeru`)
  * English Translation (`Racing into the night`)
* Desktop Floating Lyrics HUD simulation preview.

### Section 7: Hybrid Streaming & Unified Engine Bento (`<section id="hybrid">`)
Bento grid featuring:
* Local Bit-Perfect Audio (FLAC, ALAC, WAV, DSD256).
* Lossless Streaming (Tidal Hi-Fi, Qobuz, YouTube Music).
* Personal Cloud (Subsonic, Navidrome, Jellyfin).
* Tag & High-Res Cover Art Editor.

### Section 8: Aideo Connect (Mobile LAN Remote) (`<section id="remote">`)
* Interactive smartphone card previewing browser-based Wi-Fi remote.
* Simulated QR code pairing modal with live transport controls.

### Section 9: Performance Blueprint & Privacy Matrix (`<section id="specs">`)
* 75MB typical RAM footprint.
* 0% idle GPU usage (smart render sleeping).
* 100% offline privacy (zero telemetry, zero analytic tracking, zero accounts).
* Full Windows 10 & 11 compatibility (x64, native desktop).

### Section 10: Interactive FAQ & System Requirements (`<section id="faq">`)
* Architectural accordion covering bit-perfect audio, AutoEQ, foobar2000 comparison, and mobile remote.
* Hardware and OS compatibility matrix.

### Section 11: Cinematic Footer (`<footer>`)
* Primary Windows Download button + GitHub release link.
* MIT License indicator, developer credits, and release verification badge.

---

## 5. Quality & Verification Gates
1. **Validation**: Check for clean semantic HTML5, zero broken links, responsive layout across mobile (<768px), tablet (768px-1024px), and desktop (>1024px).
2. **CSS Performance**: GPU-accelerated transforms and opacity, zero heavy layout thrashing on scroll.
3. **Audio / Interaction Test**: VU meters, EQ sliders, Theater switcher, and Romaji lyrics toggle operate fluidly without console errors.
4. **Non-destructive**: Root `index.html` and `docs/index.html` verified untouched via `git status`.
