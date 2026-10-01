import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AideoLabView } from '../components/AideoLabView';
import { useStore } from '../store';

const root = 'https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results/';
const profiles = [
  { path: 'crinacle/711/Moondrop%20Aria', source: 'crinacle on 711' },
  { path: 'crinacle/IEC60318/Moondrop%20Aria', source: 'crinacle on IEC60318' },
  { path: 'oratory1990/Moondrop%20Aria', source: 'oratory1990' },
].map(profile => ({
  ...profile,
  url: `${root}${profile.path}/Moondrop%20Aria%20ParametricEQ.txt`,
}));
const index = profiles.map(profile => `- [Moondrop Aria](./${profile.path}) by ${profile.source}`).join('\n');
const profileText = 'Preamp: -4 dB\nFilter 1: ON PK Fc 1000 Hz Gain 2 dB Q 1';
const originalState = useStore.getState();
let setDSP: Mock;
let fetchMock: Mock;

function profileButton(source: string) {
  return screen.getByRole('button', { name: `Apply Moondrop Aria (${source})` });
}

beforeEach(() => {
  localStorage.clear();
  setDSP = vi.fn().mockResolvedValue(undefined);
  useStore.setState({ lowSpecMode: true, setDSP });
  fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    text: async () => url.endsWith('INDEX.md') ? index : profileText,
  }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  useStore.setState(originalState);
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('AutoEQ profile selection', () => {
  it('selects only the requested same-name profile and restores its exact URL after remount', async () => {
    const toast = vi.fn();
    window.addEventListener('ui-toast', toast);
    try {
      const view = render(<AideoLabView />);
      await screen.findByRole('button', { name: `Apply Moondrop Aria (${profiles[0].source})` });
      fireEvent.click(profileButton(profiles[0].source));
      await waitFor(() => expect(profileButton(profiles[0].source)).toHaveAttribute('aria-pressed', 'true'));
      expect(profileButton(profiles[1].source)).toHaveAttribute('aria-pressed', 'false');
      expect(profileButton(profiles[2].source)).toHaveAttribute('aria-pressed', 'false');

      fireEvent.click(profileButton(profiles[1].source));
      await waitFor(() => expect(profileButton(profiles[1].source)).toHaveAttribute('aria-pressed', 'true'));
      expect(profileButton(profiles[0].source)).toHaveAttribute('aria-pressed', 'false');
      expect(profileButton(profiles[2].source)).toHaveAttribute('aria-pressed', 'false');
      expect(localStorage.getItem('aideo_active_autoeq_model')).toBe(profiles[1].url);
      expect((toast.mock.calls[toast.mock.calls.length - 1][0] as CustomEvent).detail.message).toContain(profiles[1].source);
      expect(screen.getByText(`AutoEQ: Moondrop Aria (${profiles[1].source})`)).toBeInTheDocument();

      view.unmount();
      setDSP.mockClear();
      render(<AideoLabView />);
      await screen.findByRole('button', { name: `Apply Moondrop Aria (${profiles[1].source})` });
      expect(profileButton(profiles[1].source)).toHaveAttribute('aria-pressed', 'true');
      expect(profileButton(profiles[0].source)).toHaveAttribute('aria-pressed', 'false');
      expect(profileButton(profiles[2].source)).toHaveAttribute('aria-pressed', 'false');
      expect(setDSP).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('ui-toast', toast);
    }
  });

  it('keeps the previous active profile and persistence when the next profile fetch fails', async () => {
    render(<AideoLabView />);
    await screen.findByRole('button', { name: `Apply Moondrop Aria (${profiles[0].source})` });
    fireEvent.click(profileButton(profiles[0].source));
    await waitFor(() => expect(profileButton(profiles[0].source)).toHaveAttribute('aria-pressed', 'true'));
    setDSP.mockClear();
    fetchMock.mockResolvedValueOnce({ ok: false });

    fireEvent.click(profileButton(profiles[1].source));
    await screen.findByText('Could not retrieve corrective EQ profile.');
    expect(profileButton(profiles[0].source)).toHaveAttribute('aria-pressed', 'true');
    expect(profileButton(profiles[1].source)).toHaveAttribute('aria-pressed', 'false');
    expect(localStorage.getItem('aideo_active_autoeq_model')).toBe(profiles[0].url);
    expect(setDSP).not.toHaveBeenCalled();
  });

  it('does not map an ambiguous legacy model name to any profile', async () => {
    localStorage.setItem('aideo_active_autoeq_model', 'Moondrop Aria');
    render(<AideoLabView />);
    await screen.findByRole('button', { name: `Apply Moondrop Aria (${profiles[0].source})` });
    for (const profile of profiles) {
      expect(profileButton(profile.source)).toHaveAttribute('aria-pressed', 'false');
    }
    expect(screen.queryByText(/^AutoEQ: Moondrop Aria/)).not.toBeInTheDocument();
    expect(setDSP).not.toHaveBeenCalled();
  });
});
