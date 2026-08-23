# Product

## Register

product

## Users

Desktop music listeners on Windows who care about audio quality. Two overlapping groups: local-library owners (FLAC/DSD collections, bit-perfect playback, DSP/EQ tuning) and streamers (YouTube discovery, charts, scrobbling to Last.fm/ListenBrainz). They live in this app for long sessions, often alongside other work, sometimes in bright rooms where a dark-only UI glares.

## Product Purpose

Aideo is a Tauri v2 desktop music player combining a local library with streaming discovery: WASAPI-exclusive bit-perfect output, per-track DSP/Audio Lab, synced lyrics, queue management, listening insights, and scrobbling. Success is effortless daily driving: find music fast, play it back exactly right, keep the window open all day.

## Brand Personality

Precise, calm, enthusiast. Confident like measurement gear, relaxed like a listening room. Voice is short and concrete; the UI never competes with album art.

## Anti-references

- Gamer-audio RGB soup: glowing gradients everywhere, neon on neon.
- Dashboard clutter: stat cards stacked on stat cards, chrome thicker than content.
- Gray-on-gray light themes where muted text fails contrast on tinted near-white.

## Design Principles

1. Album art is the hero; chrome recedes. Immersive surfaces (Now Playing cinema, Wrapped) stay art-driven dark even in light mode.
2. Elevation over decoration in light mode: crisp near-white canvas, white raised surfaces, hairline borders, soft layered shadows. No muddy tinted panels.
3. Accent is information, not garnish: primary actions, active states, playing row. One accent at a time (the user's dynamic accent).
4. Every state exists: hover, active, selected, disabled, error. Same button shape everywhere.
5. Light mode is a first-class theme, not inverted dark: tokens first, targeted overrides second, contrast >= 4.5:1 for body text.

## Accessibility & Inclusion

WCAG AA targets: body text >= 4.5:1 against its surface in both themes; large text >= 3:1. Dynamic accent colors are tuned for dark backgrounds, so light mode must darken the accent for legibility. Respect reduced motion where animation exists. Keyboard operability for player controls and navigation.
