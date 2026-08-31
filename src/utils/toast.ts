export type ToastType = 'info' | 'success' | 'warning' | 'error' | 'help';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  message: string;
  title?: string;
  type?: ToastType;
  duration?: number;
  action?: ToastAction;
  dedupKey?: string;
}

export interface ToastDetail extends ToastOptions {
  id?: string;
  timestamp?: number;
}

export function showToast(optionsOrMessage: ToastOptions | string, type: ToastType = 'info'): void {
  const options: ToastOptions =
    typeof optionsOrMessage === 'string'
      ? { message: optionsOrMessage, type }
      : { ...optionsOrMessage, type: optionsOrMessage.type || type };

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<ToastDetail>('ui-toast', {
        detail: {
          ...options,
          timestamp: Date.now(),
        },
      })
    );
  }
}

export const toast = Object.assign(
  (optionsOrMessage: ToastOptions | string) => showToast(optionsOrMessage),
  {
    info: (message: string, options?: Omit<ToastOptions, 'message' | 'type'>) =>
      showToast({ ...options, message, type: 'info' }),
    success: (message: string, options?: Omit<ToastOptions, 'message' | 'type'>) =>
      showToast({ ...options, message, type: 'success' }),
    warning: (message: string, options?: Omit<ToastOptions, 'message' | 'type'>) =>
      showToast({ ...options, message, type: 'warning' }),
    error: (message: string, options?: Omit<ToastOptions, 'message' | 'type'>) =>
      showToast({ ...options, message, type: 'error' }),
    help: (message: string, options?: Omit<ToastOptions, 'message' | 'type'>) =>
      showToast({ ...options, message, type: 'help' }),
  }
);
