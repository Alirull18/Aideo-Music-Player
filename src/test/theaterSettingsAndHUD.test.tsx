import { describe, it, expect } from 'vitest';
import { TheaterModeDesign } from '../store/types';

export const THEATER_MODE_DESIGNS: { id: TheaterModeDesign; title: string; badge: string; desc: string }[] = [
  { id: 'stage', title: 'Stage View', badge: 'MODERN', desc: 'Balanced 2-column layout with large cover art and synced lyrics.' },
  { id: 'zen', title: 'Zen Mode', badge: 'MINIMAL', desc: 'Focused typography with spacious lyric flow and minimal distractions.' },
  { id: 'studio', title: 'Hi-Fi Studio Deck', badge: 'AUDIOPHILE', desc: 'Dual ballistic analog needle VU meters with realtime telemetry and scope.' },
  { id: 'vinyl', title: 'Vinyl Turntable', badge: 'ANALOG WARMTH', desc: 'Realistic 33⅓ RPM spinning vinyl with animated tracking tonearm.' },
  { id: 'poster', title: 'Editorial Poster', badge: 'EDITORIAL', desc: 'Swiss broadsheet layout with bold typography and liner notes archive.' },
  { id: 'scope', title: 'Pure Scope', badge: 'IMMERSIVE', desc: 'Full-bleed 60fps audio reactive vector scope with minimal lyric overlay.' },
];

export function getNextTheaterDesign(current: TheaterModeDesign): TheaterModeDesign {
  const order: TheaterModeDesign[] = ['stage', 'zen', 'studio', 'vinyl', 'poster', 'scope'];
  const idx = order.indexOf(current);
  return order[(idx + 1) % order.length];
}

describe('Theater Settings and HUD cycling', () => {
  it('cycles through all 6 archetypes in correct order', () => {
    expect(getNextTheaterDesign('stage')).toBe('zen');
    expect(getNextTheaterDesign('zen')).toBe('studio');
    expect(getNextTheaterDesign('studio')).toBe('vinyl');
    expect(getNextTheaterDesign('vinyl')).toBe('poster');
    expect(getNextTheaterDesign('poster')).toBe('scope');
    expect(getNextTheaterDesign('scope')).toBe('stage');
  });

  it('defines 6 distinct archetypes with required metadata', () => {
    expect(THEATER_MODE_DESIGNS).toHaveLength(6);
    const ids = THEATER_MODE_DESIGNS.map(d => d.id);
    expect(ids).toEqual(['stage', 'zen', 'studio', 'vinyl', 'poster', 'scope']);
  });
});
