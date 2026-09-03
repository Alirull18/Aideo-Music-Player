# Accessibility and visual QA audit

**Snapshot:** `be94f376930cadd288b987183ee3486c6d36abbd`  
**Verdict:** **NO-GO**  
**Scope actually completed:** static React/CSS review and test-output inspection  
**Rendered/browser/screen-reader scope:** **BLOCKED / NOT PERFORMED**

## Honest boundary

The available in-app browser controller reported that no browser runtime was available. A Vite process was briefly used only to check availability and was stopped. No rendered screenshot set, accessibility tree, computed contrast, focus-order trace, screen-reader session, zoom/DPI run or responsive visual comparison was produced.

Accordingly, this report does **not** claim a full accessibility or visual pass. Static defects below are real release blockers; the unperformed rendered checks remain unknown.

## Static inventory

An audit script inspected all 55 `.tsx` files:

- **113 candidate** `<div>`, `<span>`, `<li>` or `<img>` click handlers without `role` or `tabIndex` in the opening tag;
- **12 candidate** icon/dynamic buttons without a static accessible-name attribute; manual review confirmed at least **7 definite unnamed icon/toggle buttons**;
- **0** `<img>` elements missing an `alt` attribute under the same heuristic;
- only four elements were found with explicit `role`/`aria-*` semantics: an Aideo card-size control, ErrorBoundary alert, MiniPlayer restore label and Toast live region;
- **12** CSS declarations remove outlines;
- **0** `:focus-visible` rules found;
- **0** `prefers-reduced-motion` rules found.

Regex counts are triage indicators, not a standards conformance engine. The manually confirmed examples and systemic absence of keyboard semantics are sufficient to require correction.

Top candidate nonsemantic-click files:

| File | Candidate count |
|---|---:|
| `LibraryView.tsx` | 17 |
| `PlayerBar.tsx` | 15 |
| `SettingsView.tsx` | 13 |
| `AlbumsView.tsx` | 11 |
| `AideoView.tsx` | 8 |
| `AudioControlCenter.tsx` | 7 |
| `LyricsPanel.tsx` | 5 |
| `Sidebar.tsx` | 5 |

## Findings

### AUD-A11Y-01 — Core interactions are pointer-only nonsemantic elements

**Severity:** P0 accessibility blocker  
**Evidence:** STATIC-HIGH

Examples include custom device selectors/options, exclusive/bit-perfect/dither toggles, cards, rows and overlay dismiss targets. `AudioControlCenter.tsx:1048-1101,1143-1177,1251-1254` uses clickable `div` elements without button roles, keyboard handlers or tab stops.

Native buttons supply keyboard activation and semantics. If a custom element must act as a button, the ARIA Authoring Practices require button role, focusability, an accessible name, and activation on both Enter and Space ([WAI-ARIA button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/button/)). Prefer real `<button>` elements.

### AUD-A11Y-02 — At least seven icon/toggle buttons have no accessible name

**Severity:** P1  
**Evidence:** STATIC-HIGH

Confirmed examples:

- `AideoPrompt.tsx:35` — close
- `SmartPlaylistBuilderModal.tsx:200` — close
- `QueueView.tsx:193` — close
- `TagEditorModal.tsx:417` — close
- `AudioControlCenter.tsx:379` — close
- `AudioControlCenter.tsx:479` — EQ toggle
- `AideoLabView.tsx:730` — EQ toggle

An SVG icon alone does not reliably supply a control name. Add contextual `aria-label`/visible text and expose toggle state with `aria-pressed` or a native checkbox/switch pattern.

### AUD-A11Y-03 — Nested/indirect interactivity breaks keyboard behavior

**Severity:** P1  
**Evidence:** STATIC-HIGH

`AudioControlCenter.tsx:477-499` places a visual `<button>` inside a clickable parent whose handler owns the action. The inner button has no action/name while the outer element is not focusable. Similar patterns make a UI look like a control without behaving like one to keyboard or assistive technology.

### AUD-A11Y-04 — Modal semantics and focus management are absent

**Severity:** P1  
**Evidence:** STATIC-HIGH

The source search found no `role="dialog"` or `aria-modal`. Overlay components dismiss on pointer click but do not demonstrate initial focus placement, focus trapping, return focus, labelled dialog names, or consistent Escape behavior. This affects Audio Control Center, prompts, tag editor, queue and playlist builder.

### AUD-A11Y-05 — Visible focus is not systematically protected

**Severity:** P0 keyboard blocker  
**Evidence:** STATIC-HIGH

CSS removes outlines in 12 locations and defines no `:focus-visible` system. A few component-specific focus styles do not cover the app's hundreds of controls. WCAG requires a visible focus indicator for keyboard-operable interfaces ([WCAG 2.2 Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible)).

### AUD-A11Y-06 — Motion has no reduced-motion path

**Severity:** P1  
**Evidence:** STATIC-HIGH

The interface uses Framer Motion, animated backgrounds, visualizers and transitions but contains no `prefers-reduced-motion` handling. Provide a global policy and component fallbacks. WCAG guidance addresses motion/animation triggered by interaction and the need to disable nonessential motion ([WCAG animation from interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions)).

### AUD-A11Y-07 — Live status coverage is too narrow

**Severity:** P1  
**Evidence:** STATIC-RISK

Toast has `aria-live="polite"`, and ErrorBoundary uses `role="alert"`, which are positives. Playback errors, connection state, buffering, download progress, scan progress, track changes and device-mode changes are not shown to have coherent live-region behavior. Avoid flooding; define priority and deduplication.

### AUD-A11Y-08 — No contrast or high-contrast claim can be made

**Severity:** untested release gate  
**Evidence:** UNTESTED

The UI combines translucent layers, adaptive cover-derived colors, dim text and multiple themes. Static hex inspection cannot calculate final composited contrast. WCAG contrast must be evaluated on the rendered foreground/background combination ([WCAG Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)). Windows High Contrast/forced-colors behavior is also unknown.

## Visual QA not performed

The following remain **UNTESTED**:

- 100%, 125%, 150%, 200% Windows scaling;
- 320/640/1000/1440/4K window sizes and minimum resize behavior;
- light/dark/custom/adaptive cover themes;
- long titles, CJK/RTL, missing art and extreme library/queue sizes;
- overlays, z-index, clipping, tooltips and context menus;
- offline/loading/empty/error/disabled/focus/hover/pressed states;
- animation jank, flashing and reduced motion;
- Windows forced colors;
- screenshot regressions across every route.

## Required acceptance gate

1. Replace pointer-only elements with native controls; preserve Enter/Space/arrow conventions ([WAI-ARIA keyboard interface guidance](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)).
2. Give every icon control a name and every toggle a programmatic state.
3. Implement accessible dialog semantics, labelled titles, focus trap, Escape and return focus.
4. Add a consistent `:focus-visible` design; never remove an outline without an equal-or-better replacement.
5. Implement reduced-motion behavior for Framer/CSS/canvas visualizers.
6. Run axe or equivalent on every rendered route/state, then manually verify keyboard-only use.
7. Test NVDA + Firefox/Chrome and Narrator + Edge/WebView2, including playback/status announcements.
8. Measure rendered contrast and forced-colors behavior; fix adaptive themes at their worst sampled colors.
9. Capture and review a visual matrix at the sizes/scales/themes above.

Static cleanup alone cannot close this report; rendered manual and automated evidence is mandatory.

