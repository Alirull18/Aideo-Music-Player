import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { toast, showToast } from '../utils/toast';
import { ToastContainer, clearRecentToasts } from '../components/Toast';
import { scheduleOsTrackNotification, cancelOsTrackNotification } from '../utils/notifications';
import { sendNotification } from '@tauri-apps/plugin-notification';
import { useStore } from '../store';

describe('Toast Notification System Overhaul', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useStore.setState({
      notificationsEnabled: true,
      developerNotifications: false,
      playback: {
        status: 'Stopped',
        current_track: null,
        position_secs: 0,
        volume: 1.0,
        exclusive: false,
        bit_perfect: false,
        dev_rate: 0,
        driver_type: 'WASAPI',
        is_buffering: false,
      },
      queue: [],
      tracks: [],
    });
  });

  afterEach(() => {
    clearRecentToasts();
    cancelOsTrackNotification();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('dispatches custom event on toast.info, success, warning, error, and help', () => {
    const listener = vi.fn();
    window.addEventListener('ui-toast', listener);

    toast.info('Info notification', { title: 'Info Title' });
    expect(listener).toHaveBeenCalled();
    expect(listener.mock.calls[0][0].detail).toMatchObject({
      message: 'Info notification',
      title: 'Info Title',
      type: 'info',
    });

    toast.success('Success notification', { title: 'Success Title' });
    expect(listener.mock.calls[1][0].detail).toMatchObject({
      message: 'Success notification',
      title: 'Success Title',
      type: 'success',
    });

    toast.warning('Warning notification', { title: 'Warning Title' });
    expect(listener.mock.calls[2][0].detail).toMatchObject({
      message: 'Warning notification',
      title: 'Warning Title',
      type: 'warning',
    });

    toast.error('Error notification', { title: 'Error Title' });
    expect(listener.mock.calls[3][0].detail).toMatchObject({
      message: 'Error notification',
      title: 'Error Title',
      type: 'error',
    });

    toast.help('Help notification', { title: 'Guide' });
    expect(listener.mock.calls[4][0].detail).toMatchObject({
      message: 'Help notification',
      title: 'Guide',
      type: 'help',
    });

    showToast('Direct string message', 'info');
    expect(listener.mock.calls[5][0].detail).toMatchObject({
      message: 'Direct string message',
      type: 'info',
    });

    window.removeEventListener('ui-toast', listener);
  });

  it('renders toast cards with titles, icons, and messages in ToastContainer', async () => {
    render(<ToastContainer />);

    act(() => {
      toast.success('Settings saved successfully', { title: 'Configuration' });
    });

    expect(screen.getByText('Configuration')).toBeDefined();
    expect(screen.getByText('Settings saved successfully')).toBeDefined();
  });

  it('supports interactive action buttons and dismiss button', () => {
    render(<ToastContainer />);
    const actionMock = vi.fn();

    act(() => {
      toast.warning('Queue is empty', {
        title: 'Playback',
        action: {
          label: 'Browse Library',
          onClick: actionMock,
        },
      });
    });

    const actionBtn = screen.getByText('Browse Library');
    expect(actionBtn).toBeDefined();

    act(() => {
      fireEvent.click(actionBtn);
    });
    expect(actionMock).toHaveBeenCalledTimes(1);
  });

  it('deduplicates rapid identical toasts within the deduplication window', () => {
    render(<ToastContainer />);

    act(() => {
      toast.info('Repeated message', { dedupKey: 'test-dedup' });
      toast.info('Repeated message', { dedupKey: 'test-dedup' });
      toast.info('Repeated message', { dedupKey: 'test-dedup' });
    });

    const matches = screen.getAllByText('Repeated message');
    expect(matches.length).toBe(1);
  });

  it('formats raw errors cleanly in consumer mode and provides diagnostics in dev mode', () => {
    useStore.setState({ developerNotifications: false });
    const { unmount } = render(<ToastContainer />);

    act(() => {
      toast.error('Audio engine cpal device failed to start stream');
    });

    expect(
      screen.getByText(
        'Audio playback system encountered an error. Aideo is attempting to automatically recover.'
      )
    ).toBeDefined();

    unmount();

    // Now test with developerNotifications = true
    useStore.setState({ developerNotifications: true });
    render(<ToastContainer />);

    act(() => {
      toast.error('Audio engine cpal device failed to start stream', { dedupKey: 'dev-test' });
    });

    expect(screen.getByText('Audio Engine (player.rs)')).toBeDefined();
  });

  it('suppresses toasts when notificationsEnabled is false', () => {
    useStore.setState({ notificationsEnabled: false });
    render(<ToastContainer />);

    act(() => {
      toast.info('Should not show');
    });

    expect(screen.queryByText('Should not show')).toBeNull();
  });

  it('handles toggleExclusive and toggleBitPerfect in playbackSlice with helpful feedback', async () => {
    const listener = vi.fn();
    window.addEventListener('ui-toast', listener);

    await useStore.getState().toggleExclusive();
    expect(listener).toHaveBeenCalled();
    const exclusiveCall = listener.mock.calls[listener.mock.calls.length - 1][0].detail;
    expect(exclusiveCall.title).toBe('Exclusive Mode');

    await useStore.getState().toggleBitPerfect();
    expect(listener).toHaveBeenCalled();
    const bitPerfectCall = listener.mock.calls[listener.mock.calls.length - 1][0].detail;
    expect(bitPerfectCall.title).toBe('Bit-Perfect Mode');

    window.removeEventListener('ui-toast', listener);
  });

  it('caps maximum concurrent toasts at 3 to prevent visual clutter', () => {
    render(<ToastContainer />);

    act(() => {
      toast.info('Toast Item 1');
      toast.info('Toast Item 2');
      toast.info('Toast Item 3');
      toast.info('Toast Item 4');
    });

    // Toast 1 was displaced to maintain max 3
    expect(screen.queryByText('Toast Item 1')).toBeNull();
    expect(screen.getByText('Toast Item 2')).toBeDefined();
    expect(screen.getByText('Toast Item 3')).toBeDefined();
    expect(screen.getByText('Toast Item 4')).toBeDefined();
  });

  it('safely coerces non-string or object message payloads without throwing', () => {
    render(<ToastContainer />);

    expect(() => {
      act(() => {
        window.dispatchEvent(
          new CustomEvent('ui-toast', {
            detail: { message: { error: 'Network timeout', code: 504 } as any, type: 'error' },
          })
        );
      });
    }).not.toThrow();

    expect(screen.getByText(/Network timeout/)).toBeDefined();
  });

  it('auto-dismisses buffering state after safety timeout so it never stays permanently stuck', async () => {
    render(<ToastContainer />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent('ui-stream-buffering', {
          detail: { active: true, title: 'Buffering Test Track' },
        })
      );
    });

    expect(screen.getByText('Buffering Test Track')).toBeDefined();

    // Advance beyond the 10000ms safety timeout and allow framer-motion transition
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10500);
    });

    expect(screen.queryByText('Buffering Test Track')).toBeNull();
  });

  it('debounces OS track notifications and suppresses when window has focus', async () => {
    const sendNotificationMock = vi.mocked(sendNotification);
    sendNotificationMock.mockClear();

    const focusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(true);

    scheduleOsTrackNotification(
      { id: 1, path: 'focused-track.flac', title: 'Focused Track', artist: 'Artist A', duration: 180, format: 'FLAC', lyric_offset: 0 },
      { enabled: true, backgroundOnly: true, debounceMs: 800 }
    );

    // Fast-forward past debounce
    await act(async () => {
      vi.advanceTimersByTime(900);
    });

    // Suppressed because window has focus (user is looking at Aideo)
    expect(sendNotificationMock).not.toHaveBeenCalled();

    focusSpy.mockRestore();
  });

  it('sends OS track notification when app window is not focused (in background)', async () => {
    const sendNotificationMock = vi.mocked(sendNotification);
    sendNotificationMock.mockClear();

    const focusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(false);

    scheduleOsTrackNotification(
      { id: 2, path: 'bg-track.flac', title: 'Background Track', artist: 'Artist B', duration: 200, format: 'FLAC', lyric_offset: 0 },
      { enabled: true, backgroundOnly: true, debounceMs: 800 }
    );

    // Before debounce expires, notification is pending
    expect(sendNotificationMock).not.toHaveBeenCalled();

    // Fast-forward past debounce
    await act(async () => {
      vi.advanceTimersByTime(900);
    });

    // Successfully sent since app was running in background
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    expect(sendNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Background Track',
        body: 'Artist B',
      })
    );

    focusSpy.mockRestore();
  });

  it('cancels prior pending notification when rapidly skipping tracks', async () => {
    const sendNotificationMock = vi.mocked(sendNotification);
    sendNotificationMock.mockClear();

    const focusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(false);

    // Rapid skip 1
    scheduleOsTrackNotification(
      { id: 10, path: 'skip1.flac', title: 'Skip Track 1', artist: 'Artist 1', duration: 100, format: 'FLAC', lyric_offset: 0 },
      { enabled: true, backgroundOnly: true, debounceMs: 800 }
    );

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // Rapid skip 2 before debounce finishes
    scheduleOsTrackNotification(
      { id: 11, path: 'skip2.flac', title: 'Final Settled Track', artist: 'Artist 2', duration: 100, format: 'FLAC', lyric_offset: 0 },
      { enabled: true, backgroundOnly: true, debounceMs: 800 }
    );

    await act(async () => {
      vi.advanceTimersByTime(900);
    });

    // Only the final settled track was notified, avoiding spam!
    expect(sendNotificationMock).toHaveBeenCalledTimes(1);
    expect(sendNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Final Settled Track',
      })
    );

    focusSpy.mockRestore();
  });

  it('supports toggling OS track notifications and background-only settings', () => {
    const store = useStore.getState();
    const initialOsEnabled = store.osTrackNotificationsEnabled;
    const initialBgOnly = store.osNotifyBackgroundOnly;

    act(() => {
      store.toggleOsTrackNotifications();
    });
    expect(useStore.getState().osTrackNotificationsEnabled).toBe(!initialOsEnabled);

    act(() => {
      store.toggleOsNotifyBackgroundOnly();
    });
    expect(useStore.getState().osNotifyBackgroundOnly).toBe(!initialBgOnly);
  });
});
