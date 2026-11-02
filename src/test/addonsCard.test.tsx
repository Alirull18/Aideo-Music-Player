/// <reference types="vitest/globals" />
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';
import type { AddonInfo } from '../store/addonSlice';
import { createAddonSlice } from '../store/addonSlice';
import AddonsCard from '../components/AddonsCard';

describe('AddonsCard Component', () => {
  const originalFetch = globalThis.fetch;
  let mockLoadAddons: ReturnType<typeof vi.fn>;
  let mockInstallAddon: ReturnType<typeof vi.fn>;
  let mockRemoveAddon: ReturnType<typeof vi.fn>;
  let mockSetAddonEnabled: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    mockLoadAddons = vi.fn().mockResolvedValue(undefined);
    mockInstallAddon = vi.fn().mockResolvedValue(undefined);
    mockRemoveAddon = vi.fn().mockResolvedValue(undefined);
    mockSetAddonEnabled = vi.fn().mockResolvedValue(undefined);

    useStore.setState({
      addons: [],
      addonBusy: false,
      loadAddons: mockLoadAddons as any,
      installAddon: mockInstallAddon as any,
      removeAddon: mockRemoveAddon as any,
      setAddonEnabled: mockSetAddonEnabled as any,
    });
  });

  afterEach(() => {
    cleanup();
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('calls loadAddons on mount', () => {
    render(<AddonsCard />);
    expect(mockLoadAddons).toHaveBeenCalledTimes(1);
  });

  it('renders internal core addons under Core Sources with locked state', () => {
    const coreAddons: AddonInfo[] = [
      {
        id: 'org.aideo.builtin.yt',
        name: 'Built-in YouTube',
        version: '1.0.0',
        origin: 'internal',
        resources: ['search', 'stream'],
        builtin: true,
        enabled: true,
      },
      {
        id: 'org.aideo.internal.lyrics',
        name: 'Internal Lyrics Engine',
        version: '2.1.0',
        origin: 'internal',
        resources: ['lyrics'],
        builtin: false,
        enabled: true,
      },
    ];

    useStore.setState({ addons: coreAddons });
    render(<AddonsCard />);

    // Section header and count
    expect(screen.getByText('Core Sources')).toBeInTheDocument();
    expect(screen.getByText('Essential built-in sources')).toBeInTheDocument();

    // Verify Addon names & versions
    expect(screen.getByText('Built-in YouTube')).toBeInTheDocument();
    expect(screen.getByText('v1.0.0')).toBeInTheDocument();
    expect(screen.getByText('Internal Lyrics Engine')).toBeInTheDocument();
    expect(screen.getByText('v2.1.0')).toBeInTheDocument();

    // Verify Core Source badge and locked indicators
    const coreBadges = screen.getAllByText('Core Source');
    expect(coreBadges).toHaveLength(2);

    const lockIndicators = screen.getAllByText('Core sources cannot be disabled');
    expect(lockIndicators.length).toBeGreaterThanOrEqual(2);

    // Switches should be disabled with tabIndex -1 and aria-disabled true
    const ytSwitch = screen.getByRole('switch', { name: 'Enable Built-in YouTube' });
    expect(ytSwitch).toHaveAttribute('aria-checked', 'true');
    expect(ytSwitch).toHaveAttribute('aria-disabled', 'true');
    expect(ytSwitch).toHaveAttribute('tabIndex', '-1');

    // Attempting to click switch should not trigger setAddonEnabled
    fireEvent.click(ytSwitch);
    expect(mockSetAddonEnabled).not.toHaveBeenCalled();

    // Core addons should NOT have a remove button
    expect(screen.queryByRole('button', { name: /remove built-in youtube/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove internal lyrics engine/i })).not.toBeInTheDocument();
  });

  it('renders external addons with active sliding toggle and remove action', async () => {
    const externalAddon: AddonInfo = {
      id: 'com.addon.soundcloud',
      name: 'SoundCloud Extension',
      version: '3.4.0',
      origin: 'https://addons.example.com/soundcloud',
      resources: ['search', 'stream'],
      builtin: false,
      enabled: true,
    };

    useStore.setState({ addons: [externalAddon] });
    render(<AddonsCard />);

    // Section header
    expect(screen.getByText('Installed Addons')).toBeInTheDocument();
    expect(screen.getByText('SoundCloud Extension')).toBeInTheDocument();
    expect(screen.getByText('v3.4.0')).toBeInTheDocument();
    expect(screen.getByText('https://addons.example.com/soundcloud')).toBeInTheDocument();

    // Active toggle switch
    const toggleSwitch = screen.getByRole('switch', { name: 'Enable SoundCloud Extension' });
    expect(toggleSwitch).toHaveAttribute('aria-checked', 'true');
    expect(toggleSwitch).toHaveAttribute('aria-disabled', 'false');
    expect(toggleSwitch).toHaveAttribute('tabIndex', '0');

    // Toggle click triggers setAddonEnabled with toggled boolean
    fireEvent.click(toggleSwitch);
    expect(mockSetAddonEnabled).toHaveBeenCalledWith('com.addon.soundcloud', false);

    // Toggle with Space keyboard key
    fireEvent.keyDown(toggleSwitch, { key: ' ' });
    expect(mockSetAddonEnabled).toHaveBeenCalledWith('com.addon.soundcloud', false);

    // Toggle with Enter keyboard key
    fireEvent.keyDown(toggleSwitch, { key: 'Enter' });
    expect(mockSetAddonEnabled).toHaveBeenCalledWith('com.addon.soundcloud', false);

    // Remove button triggers removeAddon
    const removeBtn = screen.getByRole('button', { name: 'Remove SoundCloud Extension' });
    expect(removeBtn).toBeInTheDocument();
    fireEvent.click(removeBtn);
    expect(mockRemoveAddon).toHaveBeenCalledWith('com.addon.soundcloud');
  });

  it('handles manifest URL input and submitting install', async () => {
    render(<AddonsCard />);

    const input = screen.getByPlaceholderText('https://example.com/manifest.json') as HTMLInputElement;
    const installBtn = screen.getByRole('button', { name: /^install$/i });

    // Initially empty and button disabled
    expect(input.value).toBe('');
    expect(installBtn).toBeDisabled();

    // Type valid URL
    fireEvent.change(input, { target: { value: 'https://community.addons.test/manifest.json' } });
    expect(input.value).toBe('https://community.addons.test/manifest.json');
    expect(installBtn).not.toBeDisabled();

    // Click Install button
    fireEvent.click(installBtn);
    expect(mockInstallAddon).toHaveBeenCalledWith('https://community.addons.test/manifest.json');

    // Input cleared after submission
    await waitFor(() => {
      expect(input.value).toBe('');
    });

    // Submitting via Enter key
    fireEvent.change(input, { target: { value: 'https://second.addon.test/manifest.json' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockInstallAddon).toHaveBeenCalledWith('https://second.addon.test/manifest.json');

    await waitFor(() => {
      expect(input.value).toBe('');
    });
  });

  it('displays loading state and spinner when addonBusy is true', () => {
    useStore.setState({ addonBusy: true });
    render(<AddonsCard />);

    const input = screen.getByPlaceholderText('https://example.com/manifest.json');
    expect(input).toBeDisabled();

    const installBtn = screen.getByRole('button', { name: /installing/i });
    expect(installBtn).toBeDisabled();
    expect(screen.getByText('Installing…')).toBeInTheDocument();
  });

  it('renders resource capability badges for search, stream, lyrics, translate and default', () => {
    const multiResourceAddon: AddonInfo = {
      id: 'com.addon.full',
      name: 'Omni Source',
      version: '1.0.0',
      origin: 'https://omni.test',
      resources: ['search', 'stream', 'lyrics', 'translate', 'podcasts'],
      builtin: false,
      enabled: true,
    };

    useStore.setState({ addons: [multiResourceAddon] });
    render(<AddonsCard />);

    expect(screen.getByTestId('resource-badge-search')).toHaveTextContent('Search');
    expect(screen.getByTestId('resource-badge-stream')).toHaveTextContent('Stream');
    expect(screen.getByTestId('resource-badge-lyrics')).toHaveTextContent('Lyrics');
    expect(screen.getByTestId('resource-badge-translate')).toHaveTextContent('Translation');
    expect(screen.getByTestId('resource-badge-podcasts')).toHaveTextContent('podcasts');
  });

  it('renders clean empty state when no external addons are installed', () => {
    // Only core addon
    const coreOnly: AddonInfo[] = [
      {
        id: 'org.aideo.core',
        name: 'Core Player',
        version: '1.0.0',
        origin: 'internal',
        resources: ['stream'],
        builtin: true,
        enabled: true,
      },
    ];

    useStore.setState({ addons: coreOnly });
    render(<AddonsCard />);

    // Empty state should be rendered under Installed Addons
    expect(screen.getByText('No external addons installed')).toBeInTheDocument();
    expect(
      screen.getByText('Enter a manifest URL above to install custom music providers')
    ).toBeInTheDocument();
  });

  it('interacts with @tauri-apps/api/core invoke through real store actions', async () => {
    // Restore real slice actions for this test
    const realSlice = createAddonSlice(useStore.setState, useStore.getState, useStore as any);
    useStore.setState({
      loadAddons: realSlice.loadAddons,
      installAddon: realSlice.installAddon,
      setAddonEnabled: realSlice.setAddonEnabled,
      removeAddon: realSlice.removeAddon,
    });

    const sampleAddon: AddonInfo = {
      id: 'org.real.addon',
      name: 'Real Addon',
      version: '1.0.0',
      origin: 'https://real.test',
      resources: ['stream'],
      builtin: false,
      enabled: true,
    };

    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'addon_list') return [sampleAddon];
      if (command === 'addon_install') return sampleAddon;
      if (command === 'addon_remove') return true;
      if (command === 'addon_set_enabled') return true;
      return null;
    });

    // Call store loadAddons
    await useStore.getState().loadAddons();
    expect(invoke).toHaveBeenCalledWith('addon_list');
    expect(useStore.getState().addons).toEqual([sampleAddon]);

    // Call store setAddonEnabled
    await useStore.getState().setAddonEnabled('org.real.addon', false);
    expect(invoke).toHaveBeenCalledWith('addon_set_enabled', { addonId: 'org.real.addon', enabled: false });

    // Call store removeAddon
    await useStore.getState().removeAddon('org.real.addon');
    expect(invoke).toHaveBeenCalledWith('addon_remove', { addonId: 'org.real.addon' });
  });

  it('drives the Connect Tidal device authorization and polling flow to completion', async () => {
    vi.useFakeTimers();

    const tidalAddon: AddonInfo = {
      id: 'org.aideo.tidal',
      name: 'Tidal Hifi',
      version: '1.0.0',
      origin: 'http://127.0.0.1:7013',
      resources: ['search', 'stream'],
      builtin: false,
      enabled: true,
    };

    const mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'http://127.0.0.1:7013/auth/device' && init?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            userCode: 'WXYZ-9876',
            verificationUriComplete: 'https://link.tidal.com/WXYZ-9876',
            interval: 2,
          }),
        } as Response;
      }
      if (url === 'http://127.0.0.1:7013/auth/poll' && init?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            authenticated: true,
            countryCode: 'US',
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    useStore.setState({ addons: [tidalAddon] });
    render(<AddonsCard />);

    const connectBtn = screen.getByRole('button', { name: 'Connect Tidal' });
    await act(async () => {
      fireEvent.click(connectBtn);
    });

    expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:7013/auth/device', { method: 'POST' });
    expect(screen.getByTestId('tidal-user-code')).toHaveTextContent('WXYZ-9876');

    const link = screen.getByRole('link', { name: 'Open Tidal Link' });
    expect(link).toHaveAttribute('href', 'https://link.tidal.com/WXYZ-9876');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:7013/auth/poll', { method: 'POST' });
    expect(screen.getByText('Connected (US)')).toBeInTheDocument();
  });

  it('renders Featured Addons Catalog, supports 1-click install, and hides already-installed featured addons', () => {
    const installedTidal: AddonInfo = {
      id: 'org.aideo.tidal',
      name: 'Tidal HiFi / MAX',
      version: '1.0.0',
      origin: 'http://127.0.0.1:7013',
      resources: ['search', 'stream'],
      builtin: false,
      enabled: true,
    };

    useStore.setState({ addons: [installedTidal] });
    render(<AddonsCard />);

    expect(screen.getByText('Featured Addons')).toBeInTheDocument();
    // Tidal is already installed so its catalog install button should be hidden
    expect(screen.queryByRole('button', { name: 'Install Tidal HiFi / MAX' })).not.toBeInTheDocument();

    // Qobuz is uninstalled so its catalog install button should be present
    const qobuzInstallBtn = screen.getByRole('button', { name: 'Install Qobuz Studio' });
    expect(qobuzInstallBtn).toBeInTheDocument();

    fireEvent.click(qobuzInstallBtn);
    expect(mockInstallAddon).toHaveBeenCalledWith('http://127.0.0.1:7014/manifest.json');
  });

  it('supports manifest-driven credentials authentication flow', async () => {
    const qobuzAddon: AddonInfo = {
      id: 'org.aideo.qobuz',
      name: 'Qobuz',
      version: '1.0.0',
      description: '24-bit / 192 kHz Studio Masters streaming',
      origin: 'http://127.0.0.1:7014',
      resources: ['search', 'stream'],
      builtin: false,
      enabled: true,
      auth: {
        type: 'credentials',
        label: 'Configure Qobuz',
        helpText: 'Enter your Qobuz credentials',
        fields: [
          { key: 'appId', label: 'App ID', type: 'text', required: true },
          { key: 'userAuthToken', label: 'User Auth Token', type: 'password', required: true },
        ],
      },
    };

    const mockFetch = vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'http://127.0.0.1:7014/auth/login' && init?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            provider: 'qobuz',
            authenticated: true,
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    useStore.setState({ addons: [qobuzAddon] });
    render(<AddonsCard />);

    const configBtn = screen.getByRole('button', { name: 'Configure Qobuz' });
    fireEvent.click(configBtn);

    const appIdInput = screen.getByLabelText('App ID');
    const tokenInput = screen.getByLabelText('User Auth Token');
    fireEvent.change(appIdInput, { target: { value: '950096963' } });
    fireEvent.change(tokenInput, { target: { value: 'secret-token-123' } });

    const saveBtn = screen.getByRole('button', { name: 'Save Qobuz credentials' });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('http://127.0.0.1:7014/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credentials: {
            appId: '950096963',
            userAuthToken: 'secret-token-123',
          },
        }),
      });
    });

    expect(await screen.findByRole('button', { name: 'Qobuz Connected' })).toBeInTheDocument();
  });

  it('supports 1-click Qobuz Browser Login via addon_open_browser_login', async () => {
    const qobuzAddon: AddonInfo = {
      id: 'org.aideo.qobuz',
      name: 'Qobuz',
      version: '1.0.0',
      description: '24-bit / 192 kHz Studio Masters streaming',
      origin: 'http://127.0.0.1:7014',
      resources: ['search', 'stream'],
      builtin: false,
      enabled: true,
      auth: {
        type: 'credentials',
        label: 'Configure Qobuz',
        fields: [
          { key: 'userAuthToken', label: 'User Auth Token', type: 'password', required: false },
        ],
      },
    };

    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue({ ok: true, mode: 'webview' });

    useStore.setState({ addons: [qobuzAddon] });
    render(<AddonsCard />);

    const browserBtn = screen.getByRole('button', { name: 'Sign in to Qobuz with Browser' });
    fireEvent.click(browserBtn);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('addon_open_browser_login', { addonId: 'org.aideo.qobuz' });
    });
  });
});
