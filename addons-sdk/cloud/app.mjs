// Node >=22. Run: node --env-file=your-private.env addons-sdk/cloud/server.mjs
// See the provider .env.example files for server-only credential names.
import { createHmac } from 'node:crypto';
import { createServer as httpServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export { FEATURED };
const featuredFor = provider => FEATURED.find(entry => entry.provider === provider);

const origins = new Set(['tauri://localhost', 'http://tauri.localhost',
  'https://tauri.localhost', 'http://localhost:1420']);
import { invalid } from './http.mjs';
import { FEATURED } from './featured.mjs';
import { PROVIDERS } from './providers.mjs';

export function loadConfig(env = process.env) {
  const featured = env && FEATURED.find(entry => entry.provider === env.PROVIDER);
  if (!featured) throw new Error('Set a supported PROVIDER');
  const impl = PROVIDERS[featured.provider];
  if (!impl) throw new Error(`No adapter registered for ${featured.provider}`);
  const port = Number(env.PORT ?? featured.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
  // The desktop app passes a per-launch secret so it can tell this process from anything else holding the port.
  const sidecarSecret = typeof env.AIDEO_SIDECAR_SECRET === 'string' && env.AIDEO_SIDECAR_SECRET.length >= 32
    ? env.AIDEO_SIDECAR_SECRET : '';
  return Object.freeze({ ...impl.loadConfig(env, featured), port, sidecarSecret });
}

export function manifestFor(provider) {
  const { id, name, description, resources, auth } = featuredFor(provider);
  return { id, version: '1.0.0', name, description, resources, contentType: 'music', auth };
}

export function createAdapter(config, fetchUpstream = fetch) {
  const impl = PROVIDERS[config.provider];
  if (!impl) throw new Error('Set a supported PROVIDER');
  return impl.createAdapter(config, fetchUpstream);
}

function send(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function parseId(encoded, provider) {
  let value;
  try { value = decodeURIComponent(encoded); } catch { throw invalid(); }
  const prefix = `${provider}:`;
  const id = value.slice(prefix.length);
  if (!value.startsWith(prefix) || !id || id.length > 512 || /[\x00-\x1f\x7f]/.test(id)
    || id.split(/[\\/]/).some(part => part === '.' || part === '..')) throw invalid();
  return id;
}

async function proxy(adapter, id, cover, request, response) {
  const range = request.headers.range;
  if (range && !/^bytes=\d*-\d*(,\s*\d*-\d*)*$/.test(range)) throw invalid();
  const upstream = await adapter.media(id, cover, range ? { Range: range } : {});
  if (!upstream.ok) {
    await upstream.body?.cancel();
    send(response, upstream.status === 416 ? 416 : 502, { error: 'Upstream request failed' });
    return;
  }
  for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
    const value = upstream.headers.get(name);
    if (value) response.setHeader(name, value);
  }
  response.setHeader('Cache-Control', 'no-store');
  response.writeHead(upstream.status);
  if (!upstream.body) { response.end(); return; }
  await pipeline(Readable.fromWeb(upstream.body), response);
}

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw invalid();
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw invalid();
  }
}

export function createServer(config, fetchUpstream = fetch) {
  const adapter = createAdapter(config, fetchUpstream);
  const { provider } = config;
  // ponytail: one authorized user's loopback server; use authenticated TLS hosting before allowing remote clients.
  let windowStart = Date.now();
  let requests = 0;
  const server = httpServer((request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    void handle(request, response).catch(error => {
      if (response.headersSent) { response.destroy(); return; }
      send(response, error.status === 400 ? 400 : 502, {
        error: error.status === 400 ? 'Invalid request' : 'Upstream request failed',
      });
    });
  });

  async function handle(request, response) {
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(request.headers.host)
      || (request.headers.origin && !origins.has(request.headers.origin))) {
      send(response, 403, { error: 'Loopback desktop clients only' }); return;
    }
    if (request.headers.origin) {
      response.setHeader('Access-Control-Allow-Origin', request.headers.origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
      response.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
    }
    if (Date.now() - windowStart > 60_000) { windowStart = Date.now(); requests = 0; }
    if (++requests > 600) { send(response, 429, { error: 'Too many requests' }); return; }
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    const path = new URL(request.url, base).pathname;
    if (request.method === 'POST') {
      if (path === '/auth/device') {
        if (!adapter.supportsDeviceAuth) throw invalid();
        try {
          send(response, 200, await adapter.startDeviceAuth());
        } catch (error) {
          if (error.status === 400) {
            send(response, 400, { error: adapter.deviceAuthHint ?? 'Configure the addon in Credentials first' });
            return;
          }
          throw error;
        }
        return;
      }
      if (path === '/auth/poll') {
        if (!adapter.supportsDeviceAuth) throw invalid();
        send(response, 200, await adapter.pollDeviceAuth()); return;
      }
      if (path === '/auth/login') {
        const body = await readRequestBody(request);
        const creds = body && typeof body === 'object' && body.credentials && typeof body.credentials === 'object'
          ? body.credentials
          : body;
        if (!creds || typeof creds !== 'object' || Array.isArray(creds)) throw invalid();
        let status;
        try {
          status = await adapter.login(creds);
        } catch {
          send(response, 400, { ok: false, authenticated: false, error: 'Authentication failed' });
          return;
        }
        if (!status?.authenticated && !adapter.acceptsPartialLogin?.(creds)) {
          send(response, 400, { ...status, ok: false, error: 'Authentication failed' });
          return;
        }
        send(response, 200, status); return;
      }
      if (path === '/auth/logout') {
        send(response, 200, await adapter.logout()); return;
      }
      send(response, 405, { error: 'GET required' }); return;
    }
    if (request.method !== 'GET') { send(response, 405, { error: 'GET required' }); return; }
    // Eclipse protocol: /manifest.json, /search?q=, /stream/{id} (the Aideo host namespaces ids itself).
    if (path === '/manifest.json') {
      send(response, 200, manifestFor(provider)); return;
    }
    if (path === '/auth/status') {
      const status = adapter.status ? await adapter.status() : { ok: true, authenticated: true };
      send(response, 200, status); return;
    }
    if (path === '/sidecar-proof' && config.sidecarSecret) {
      // Proof of possession of the launch secret: HMAC-SHA256(secret, nonce). The secret itself is never sent.
      const nonce = new URL(request.url, base).searchParams.get('nonce') ?? '';
      if (!/^[0-9a-f]{16,128}$/.test(nonce)) throw invalid();
      send(response, 200, { proof: createHmac('sha256', config.sidecarSecret).update(nonce).digest('hex') }); return;
    }
    if (path === '/health') { await adapter.ping(); send(response, 200, { ok: true }); return; }
    if (path === '/search') {
      const query = new URL(request.url, base).searchParams.get('q') ?? '';
      const tracks = await adapter.catalog(query, 0);
      send(response, 200, { tracks: tracks.map(track => ({
        id: track.id, title: track.title, artist: track.artist, album: track.album, duration: track.duration,
        ...(track.coverId ? { artworkURL: `${base}/cover/${encodeURIComponent(`${provider}:${track.coverId}`)}` } : {}),
        ...(track.isrc ? { isrc: track.isrc } : {}),
        ...(track.upc ? { upc: track.upc } : {}),
        ...(track.version ? { version: track.version } : {}),
        ...(typeof track.explicit === 'boolean' ? { explicit: track.explicit } : {}),
        ...(typeof track.lossless === 'boolean' ? { lossless: track.lossless } : {}),
        ...(track.codec ? { codec: track.codec } : {}),
        ...(Number.isFinite(track.sampleRate) && track.sampleRate > 0 ? { sampleRate: track.sampleRate } : {}),
        ...(Number.isInteger(track.bitDepth) && track.bitDepth > 0 ? { bitDepth: track.bitDepth } : {}),
      })) }); return;
    }
    const stream = path.match(/^\/stream\/(.+)$/);
    if (stream) {
      let id;
      try { id = decodeURIComponent(stream[1]); } catch { throw invalid(); }
      parseId(`${provider}:${id}`, provider);
      send(response, 200, {
        url: `${base}/audio/${encodeURIComponent(`${provider}:${id}`)}`,
        ...(adapter.streamMeta ? adapter.streamMeta(id) : {}),
      }); return;
    }
    const media = path.match(/^\/(audio|cover)\/(.+)$/);
    if (media) { await proxy(adapter, parseId(media[2], provider), media[1] === 'cover', request, response); return; }
    send(response, 404, { error: 'Not found' });
  }
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return server;
}
