export function safeGetStorage(key: string, fallback: string | null = null): string | null {
  try {
    const val = localStorage.getItem(key);
    return val !== null ? val : fallback;
  } catch {
    return fallback;
  }
}

export function safeSetStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage quota exceeded or disabled
  }
}

export function safeRemoveStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage disabled
  }
}
