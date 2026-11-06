import { readFileSync } from 'node:fs';

// Single source of truth for the featured addons; the desktop app reads the same file.
// scripts/build-sidecar.mjs replaces this module with the JSON inlined, because a single executable has no files.
export const FEATURED = Object.freeze(JSON.parse(readFileSync(new URL('./featured.json', import.meta.url), 'utf8')));
