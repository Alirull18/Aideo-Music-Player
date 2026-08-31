import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { toast, showToast } from '../utils/toast';
import { ToastContainer } from '../components/Toast';
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
});
