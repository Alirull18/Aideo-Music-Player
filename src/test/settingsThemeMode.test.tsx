import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useStore } from '../store';
import { SettingsView } from '../components/SettingsView';

describe('SettingsView Theme Mode Segmented Control', () => {
  beforeEach(() => {
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    useStore.setState({
      colorScheme: 'dark',
    });
  });

  it('renders theme mode segmented control with Dark, Light, and System options', () => {
    render(<SettingsView />);
    expect(screen.getByRole('radiogroup', { name: /theme mode/i })).toBeInTheDocument();
    
    const darkBtn = screen.getByRole('radio', { name: /dark/i });
    const lightBtn = screen.getByRole('radio', { name: /light/i });
    const systemBtn = screen.getByRole('radio', { name: /system/i });

    expect(darkBtn).toBeInTheDocument();
    expect(lightBtn).toBeInTheDocument();
    expect(systemBtn).toBeInTheDocument();

    expect(darkBtn).toHaveAttribute('aria-checked', 'true');
    expect(lightBtn).toHaveAttribute('aria-checked', 'false');
    expect(systemBtn).toHaveAttribute('aria-checked', 'false');
  });

  it('updates colorScheme in store when Light mode is selected', () => {
    render(<SettingsView />);
    const lightBtn = screen.getByRole('radio', { name: /light/i });
    act(() => {
      fireEvent.click(lightBtn);
    });

    expect(useStore.getState().colorScheme).toBe('light');
    expect(lightBtn).toHaveAttribute('aria-checked', 'true');
  });

  it('updates colorScheme in store when System mode is selected', () => {
    render(<SettingsView />);
    const systemBtn = screen.getByRole('radio', { name: /system/i });
    act(() => {
      fireEvent.click(systemBtn);
    });

    expect(useStore.getState().colorScheme).toBe('system');
    expect(systemBtn).toHaveAttribute('aria-checked', 'true');
  });
});
