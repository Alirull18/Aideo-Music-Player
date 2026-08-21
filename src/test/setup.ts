import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock Tauri IPC window and invoke APIs for unit tests
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
  save: vi.fn().mockResolvedValue(null),
}));

vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue('granted'),
  sendNotification: vi.fn().mockResolvedValue(undefined),
  registerActionTypes: vi.fn().mockResolvedValue(undefined),
  pending: vi.fn().mockResolvedValue([]),
  cancel: vi.fn().mockResolvedValue(undefined),
  cancelAll: vi.fn().mockResolvedValue(undefined),
  active: vi.fn().mockResolvedValue([]),
  removeActive: vi.fn().mockResolvedValue(undefined),
  removeAllActive: vi.fn().mockResolvedValue(undefined),
  createChannel: vi.fn().mockResolvedValue(undefined),
  removeChannel: vi.fn().mockResolvedValue(undefined),
  channels: vi.fn().mockResolvedValue([]),
  onNotificationReceived: vi.fn().mockResolvedValue(() => {}),
  onAction: vi.fn().mockResolvedValue(() => {}),
}));

