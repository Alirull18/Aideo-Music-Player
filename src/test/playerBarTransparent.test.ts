import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createElement } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { PlayerBar } from '../components/PlayerBar';
import { useStore } from '../store';
import type { PlayerBarDesign } from '../store/types';

const cssPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'App.css');
const css = readFileSync(cssPath, 'utf-8');

const DESIGNS: PlayerBarDesign[] = ['classic', 'floating', 'waveform', 'minimal', 'vinyl'];

describe('Player Bar Transparent Mode Contract', () => {
  beforeEach(() => {
    const { setPlayerBarDesign } = useStore.getState();
    setPlayerBarDesign('classic');
  });

  // ---------------------------------------------------------------
  // Component-level: transport controls exist in every design
  // ---------------------------------------------------------------
  it.each(DESIGNS)('%s design renders a Stop button', (design) => {
    useStore.getState().setPlayerBarDesign(design);
    cleanup();
    render(createElement(PlayerBar));
    expect(screen.getByTitle('Stop')).toBeInTheDocument();
    cleanup();
  });

  it('floating island renders the Endless Autoplay toggle', () => {
    useStore.getState().setPlayerBarDesign('floating');
    render(createElement(PlayerBar));
    expect(screen.getByTitle(/Endless Autoplay/)).toBeInTheDocument();
    cleanup();
  });

  it('vinyl deck progress track supports hover scrubbing', () => {
    useStore.getState().setPlayerBarDesign('vinyl');
    render(createElement(PlayerBar));
    expect(screen.getByTitle('Scrub Track')).toBeInTheDocument();
    cleanup();
  });

  // ---------------------------------------------------------------
  // Stylesheet contract: Full-height sidebar & column 2 player bar
  // ---------------------------------------------------------------
  it('sidebar spans full 100vh height across both grid rows in column 1', () => {
    const sidebarRule = css.match(
      /\.app-sidebar\s*\{[^}]*\}/
    );
    expect(sidebarRule).not.toBeNull();
    expect(sidebarRule![0]).toMatch(/grid-row:\s*1\s*\/\s*3/);
    expect(sidebarRule![0]).toMatch(/grid-column:\s*1/);
    expect(sidebarRule![0]).toMatch(/height:\s*100vh/);
  });

  it('all 5 player bar variants are docked in column 2 alongside the sidebar', () => {
    expect(css).toMatch(/\.player-bar\s*\{[^}]*grid-column:\s*2/);
    expect(css).toMatch(/\.player-bar\.design-floating\s*\{[^}]*grid-column:\s*2/);
    expect(css).toMatch(/\.player-bar\.design-waveform\s*\{[^}]*grid-column:\s*2/);
    expect(css).toMatch(/\.player-bar\.design-minimal\s*\{[^}]*grid-column:\s*2/);
    expect(css).toMatch(/\.player-bar\.design-vinyl\s*\{[^}]*grid-column:\s*2/);
  });

  it('main content spans full height in column 2 for smooth underlap', () => {
    const mainRule = css.match(
      /\.app-main\s*\{[^}]*\}/
    );
    expect(mainRule).not.toBeNull();
    expect(mainRule![0]).toMatch(/grid-row:\s*1\s*\/\s*3/);
    expect(mainRule![0]).toMatch(/grid-column:\s*2/);
    expect(mainRule![0]).toMatch(/height:\s*100vh/);
  });

  // ---------------------------------------------------------------
  // Stylesheet contract: Frosted glassmorphism in transparent mode
  // ---------------------------------------------------------------
  it('transparent mode applies frosted glassmorphism backdrop blur to player bar', () => {
    const rule = css.match(
      /\.playerbar-transparent \.player-bar\s*\{[^}]*\}/
    );
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/backdrop-filter:\s*blur\(24px\)/);
  });

  it('floating island capsule drops top border and adds high blur when transparent', () => {
    const barRule = css.match(
      /\.playerbar-transparent \.player-bar\.design-floating\s*\{[^}]*\}/
    );
    expect(barRule).not.toBeNull();
    expect(barRule![0]).toMatch(/border-top:\s*none\s*!important/);

    const capsuleRule = css.match(
      /\.playerbar-transparent \.player-bar\.design-floating \.floating-island-capsule\s*\{[^}]*\}/
    );
    expect(capsuleRule).not.toBeNull();
    expect(capsuleRule![0]).toMatch(/backdrop-filter:\s*blur\(32px\)/);
  });

  it('light theme transparent mode provides clean frosted light glass', () => {
    const lightRule = css.match(
      /\.light-theme\.playerbar-transparent \.player-bar\s*\{[^}]*\}/
    );
    expect(lightRule).not.toBeNull();
    expect(lightRule![0]).toMatch(/backdrop-filter:\s*blur\(24px\)/);
  });
});
