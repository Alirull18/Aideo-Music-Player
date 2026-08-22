# Design

## Theme
Dark obsidian studio. Physical scene: 11pm at a desk, headphones on, single warm lamp on a matte black console, vinyl sleeve leaning against the monitor, VU needle barely moving. The room is dark so the music's air is visible. That forces a near-black ground, with light coming from the content and from two precise colors.

## Palette
Strategy: Committed dark. The surface is the night, the brand carries the signal.

```css
:root {
  --bg: oklch(0.08 0 0);              /* obsidian */
  --surface: oklch(0.13 0.006 205);   /* lifted obsidian with 0.006 teal tint */
  --surface-2: oklch(0.16 0.009 205);
  --ink: oklch(0.97 0.012 205);        /* near-white, cool 1.2% chroma */
  --muted: oklch(0.64 0.012 205);      /* 40% toward bg */
  --line: oklch(0.19 0.008 205);
  --primary: oklch(0.68 0.13 206);     /* seed hue 200 → 206, bright cyan-teal */
  --primary-strong: oklch(0.62 0.15 206);
  --accent: oklch(0.78 0.16 68);       /* amber record light, distinct hue+lightness */
  --accent-2: oklch(0.72 0.14 62);
  --success: oklch(0.72 0.14 145);
}
```

Contrast: ink on bg 15.8:1, muted on bg 7.2:1, white text on primary fill.

## Typography
Single family with deliberate weight span. Reflex-reject bypass: Bricolage Grotesque (not on ban list), chosen for its ink-trapped grotesque that reads both mechanical and warm, like stamped hardware labels.

- Display: Bricolage Grotesque 700-800, tight -0.03em, text-wrap balance
- Body: Bricolage Grotesque 400-500, 1.65 line-height (dark bg +0.08)
- Mono for specs only: JetBrains Mono 400, tabular nums for rates/bit-depth

Scale: clamp headings, 1.285 ratio, hero max 5.5rem. Line length 64ch max.

## Components
Solid borders, no ghost shadow+border combo. Radius 14px cards, pill for tags. Focus ring 2px primary. Motion 180-240ms expo out, prefers-reduced-motion crossfade.

## Layout
Asymmetric. Grid for hero (1.05fr / 0.95fr), staggered feature rows, full-bleed imagery. Z-scale: dropdown 10, sticky 20, backdrop 30, modal 40, toast 50.
