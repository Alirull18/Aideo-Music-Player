import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const config = JSON.parse(readFileSync(resolve(__dirname, '../../src-tauri/tauri.conf.json'), 'utf8'));
const csp: string = config.app.security.csp;

const directives = new Map(
  csp
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [name, ...sources] = part.split(/\s+/);
      return [name, sources] as const;
    })
);

describe('Content Security Policy (src-tauri/tauri.conf.json)', () => {
  it('lets the webview reach the backend over IPC and the network only over https', () => {
    const connect = directives.get('connect-src');
    expect(connect).toBeDefined();
    expect(connect).toEqual(expect.arrayContaining(["'self'", 'ipc:', 'http://ipc.localhost', 'https:']));
  });

  it('does not allow plaintext http or WebSocket connections to arbitrary hosts', () => {
    const connect = directives.get('connect-src') ?? [];
    // Nothing in the webview needs them: addon traffic goes through IPC and no code opens a WebSocket.
    for (const scheme of ['http:', 'ws:', 'wss:', '*']) {
      expect(connect, `connect-src must not contain ${scheme}`).not.toContain(scheme);
    }
  });

  it('keeps scripts to the app itself', () => {
    const script = directives.get('script-src') ?? [];
    expect(script).toContain("'self'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(script).not.toContain('https:');
  });

  it('still lets artwork and audio load from LAN and loopback servers', () => {
    expect(directives.get('img-src')).toContain('http:');
    expect(directives.get('media-src')).toContain('http:');
  });
});
