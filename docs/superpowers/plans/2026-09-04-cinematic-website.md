# Aideo Music Player "Absolute Cinema" Showcase Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a brand-new, standalone "Absolute Cinema" showcase website in `website/` for Aideo Music Player v0.9.7 with interactive ballistic VU meters, 5-archetype Theater Mode preview, real-time Web Audio DSP & AutoEQ curve generator, and 60fps Romaji lyrics player.

**Architecture:** A lightweight, high-performance static frontend architecture living entirely within `website/`. It uses semantic HTML5, modern CSS3 with OKLCH color profiles, and vanilla ES6 JavaScript with Web Audio and Canvas/SVG APIs, with zero modifications to existing project files.

**Tech Stack:** HTML5, CSS3 (OKLCH, CSS Grid, Flexbox, backdrop-filter), Vanilla JavaScript (ES6, Web Audio API, Canvas 2D / SVG), FontAwesome & Google Fonts CDN.

**Spec:** [`docs/superpowers/specs/2026-09-04-cinematic-website-design.md`](file:///C:/Users/Alirul/Aideo-Music-Player/docs/superpowers/specs/2026-09-04-cinematic-website-design.md)

## Global Constraints
- Target directory is strictly `website/` — never modify root `index.html`, `docs/index.html`, or `design-test/`.
- Color system: OKLCH color spaces with deep obsidian background (`oklch(0.12 0.015 260)`), phosphor cyan, acoustic emerald, and vacuum-tube amber.
- Typography: Bricolage Grotesque (display), Plus Jakarta Sans (body), and JetBrains Mono (audio telemetry).
- Verified via browser testing, responsive layout checks, and `git status`.

---

### Task 1: Scaffolding and Semantic HTML Structure

**Files:**
- Create: `website/index.html`

**Interfaces:**
- Consumes: Asset URLs from repository and GitHub Releases.
- Produces: Complete semantic DOM elements matching all sections in the spec.

- [ ] **Step 1: Write `website/index.html`**
  - Document head with Open Graph metadata, Twitter cards, and JSON-LD SoftwareApplication schema.
  - Command Header Navigation (`<nav class="cinema-nav">`).
  - Hero Section (`<header class="cinema-hero">`) with dual-needle VU meter stage and high-res screenshot tabs.
  - Theater Archetypes Showcase (`<section id="theater">`) with 5 archetype cards and interactive viewport.
  - Signal Path Telemetry Lab (`<section id="signal-path">`) with interactive A/B comparison grid and oscilloscope canvas.
  - Real-time Web Audio DSP & AutoEQ Lab (`<section id="dsp-lab">`) with 10-band sliders, SVG curve graph, and preset chips.
  - Silky 60fps Romaji Lyrics Engine (`<section id="lyrics">`) with word-by-word karaoke and Kanji/Romaji/English toggle.
  - Hybrid Streaming & Unified Engine Bento (`<section id="hybrid">`).
  - Aideo Connect Mobile LAN Remote (`<section id="remote">`).
  - Performance & Architecture Blueprint (`<section id="specs">`).
  - Interactive FAQ & System Requirements (`<section id="faq">`).
  - Download Masthead & Cinematic Footer (`<footer class="cinema-footer">`).

- [ ] **Step 2: Validate HTML structure**
  - Verify all tags are properly closed, IDs match navigation anchors, and image URLs are accessible.

- [ ] **Step 3: Commit Task 1**
  ```powershell
  git add website/index.html ; git commit -m "feat(website): scaffold semantic HTML structure for cinematic showcase"
  ```

---

### Task 2: Cinematic CSS Architecture & Design System

**Files:**
- Create: `website/style.css`

**Interfaces:**
- Consumes: Classes and semantic elements defined in `website/index.html`.
- Produces: Visual styling, OKLCH color variables, responsive typography, glassmorphism, and animations.

- [ ] **Step 1: Write `website/style.css`**
  - Reset, OKLCH CSS Custom Properties, and fluid typography clamps (`clamp()`).
  - Glassmorphic panels, frosted acrylic borders, and ambient phosphor glow overlays.
  - High-precision layouts for the Hero, dual VU meters, and floating screenshot showcase.
  - Interactive 5 Theater Archetype selector styles and realistic vinyl record spinning animation.
  - Signal Path comparison cards with status pills and oscilloscope canvas styling.
  - 10-band parametric equalizer sliders and live frequency curve container.
  - 60fps lyric text gradient animation with active syllable highlight.
  - Bento grid cards with hover lighting effects.
  - Mobile responsive breakpoints (mobile <768px, tablet 768-1024px, desktop >1024px) ensuring no horizontal overflow.

- [ ] **Step 2: Verify CSS rendering**
  - Inspect visual layout, typography scaling, color contrast, and responsive behavior.

- [ ] **Step 3: Commit Task 2**
  ```powershell
  git add website/style.css ; git commit -m "feat(website): implement cinematic OKLCH styling and responsive layouts"
  ```

---

### Task 3: Interactive JS Engine (VU Meters, Web Audio DSP, Lyrics & Switchers)

**Files:**
- Create: `website/app.js`

**Interfaces:**
- Consumes: DOM controls from `website/index.html`.
- Produces: Live animations, interactive audio simulations, Web Audio EQ filter nodes, and dynamic UI state.

- [ ] **Step 1: Write `website/app.js`**
  - **Ballistic VU Meter Engine**: Damped spring physics model calculating needle angle (in dBFS: -20 to +3 dB) with realistic overshoot and inertia.
  - **Screenshot Showcase Tabs**: Tab switching between Fullscreen HUD, Pro DSP, Library, Discovery, and Main Player.
  - **5-Theater Mode Archetype Switcher**: Interactive selector dynamically rendering the active archetype view (VU meters, rotating 33⅓ RPM vinyl with tonearm, stage lights, Swiss editorial poster, zen minimalist).
  - **Signal Path A/B Oscilloscope**: Canvas 2D waveform generator contrasting jittery Windows mixer vs pure 384kHz sine wave.
  - **Interactive 10-Band EQ & AutoEQ**: Real-time frequency response curve rendering using SVG bezier curves, preset loaders (Sennheiser HD600, Sony WH-1000XM5, Moondrop Blessing 2, Flat), and Equalizer APO configuration exporter.
  - **60fps Romaji Lyrics Karaoke**: Timed syllable highlighter with 3-way toggle (Japanese Kanji, Romaji transliteration, English translation).
  - **FAQ Accordion & Smooth Navigation**: Polished smooth scrolling and fluid question expand/collapse.

- [ ] **Step 2: Test interactivity**
  - Check browser console for errors, verify needle motion, slider dragging, and tab switching.

- [ ] **Step 3: Commit Task 3**
  ```powershell
  git add website/app.js ; git commit -m "feat(website): implement interactive ballistic VU meters, Web Audio DSP, and lyrics engine"
  ```

---

### Task 4: Polish, Audit & Verification

**Files:**
- Modify: `website/index.html`, `website/style.css`, `website/app.js` (refinements only)

- [ ] **Step 1: Cross-browser & Mobile verification**
  - Verify layout on various aspect ratios and screen widths.
  - Ensure zero horizontal scrollbars and accessible touch targets.

- [ ] **Step 2: Non-destructive verification**
  - Run `git status` and verify that root `index.html` and `docs/index.html` are completely untouched.

- [ ] **Step 3: Commit final polish**
  ```powershell
  git add website/ ; git commit -m "feat(website): complete absolute cinema showcase website"
  ```
