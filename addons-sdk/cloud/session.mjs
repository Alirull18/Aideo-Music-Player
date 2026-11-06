import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Provider sessions are small JSON files, readable only by the current user.
export function readSessionFile(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) return null;
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function writeSessionFile(filePath, data) {
  if (typeof filePath !== 'string' || !filePath.trim()) return;
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(data), { mode: 0o600 });
  } catch {
    // Ignore disk persistence errors
  }
}
