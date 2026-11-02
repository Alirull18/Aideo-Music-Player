// Node >=22. Run: node --env-file=your-private.env addons-sdk/cloud/server.mjs
// See the provider .env.example files for server-only credential names.
import { createHash, randomBytes } from 'node:crypto';
import { createServer as httpServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

const origins = new Set(['tauri://localhost', 'http://tauri.localhost',
  'https://tauri.localhost', 'http://localhost:1420']);
import { invalid, readJson, upstreamError, validateCatalog } from './http.mjs';
import { createPremiumAdapter, premiumConfig } from './premium.mjs';

export function loadConfig(env = process.env) {
  const providers = ['subsonic', 'jellyfin', 'tidal', 'qobuz'];
  if (!env || !providers.includes(env.PROVIDER)) throw new Error('Set a supported PROVIDER');
  const provider = env.PROVIDER;
  const port = Number(env.PORT ?? 7011 + providers.indexOf(provider));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
  if (provider === 'tidal' || provider === 'qobuz') return Object.freeze({ ...premiumConfig(env), port });
  const prefix = provider.toUpperCase();
  const rawUrl = env[`${prefix}_URL`];
  const allowUnconfigured = env.ALLOW_UNCONFIGURED === '1';
  if (allowUnconfigured && (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim())) {
    const user = typeof env.SUBSONIC_USER === 'string' ? env.SUBSONIC_USER : '';
    const secret = provider === 'subsonic'
      ? (typeof env.SUBSONIC_PASSWORD === 'string' ? env.SUBSONIC_PASSWORD : '')
      : (typeof env.JELLYFIN_API_KEY === 'string' ? env.JELLYFIN_API_KEY : '');
    return Object.freeze({ provider, url: '', user, secret, port });
  }
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Server URL must be HTTP(S) without credentials, query or fragment');
  }
  const user = env.SUBSONIC_USER;
  const secret = provider === 'subsonic' ? env.SUBSONIC_PASSWORD : env.JELLYFIN_API_KEY;
  if (!allowUnconfigured && (typeof secret !== 'string' || !secret || (provider === 'subsonic' && (typeof user !== 'string' || !user)))) {
    throw new Error(`Set ${prefix} server credentials in the server environment`);
  }
  return Object.freeze({
    provider,
    url: `${url.href.replace(/\/+$/, '')}/`,
    user: typeof user === 'string' ? user : '',
    secret: typeof secret === 'string' ? secret : '',
    port,
  });
}

const text = (value, fallback) => typeof value === 'string' && value ? value : fallback;
const number = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;

export function manifestAuthSpec(provider) {
  switch (provider) {
    case 'tidal':
      return {
        description: 'Lossless & Hi-Res FLAC streaming with OAuth Device Login',
        auth: {
          type: 'device_code',
          label: 'Connect Tidal Account',
          helpText: 'Sign in with your Tidal account via device code or paste an OAuth token.',
          fields: [
            { key: 'clientId', label: 'Client ID (Optional)', type: 'text' },
            { key: 'clientSecret', label: 'Client Secret (Optional)', type: 'password' },
            { key: 'accessToken', label: 'Access Token (Optional)', type: 'password' },
          ],
        },
      };
    case 'qobuz':
      return {
        description: '24-bit / 192 kHz Studio Masters streaming',
        auth: {
          type: 'credentials',
          label: 'Connect Qobuz Account',
          fields: [
            { key: 'appId', label: 'App ID', type: 'text', required: true },
            { key: 'userAuthToken', label: 'User Auth Token (or use Email + Password below)', type: 'password' },
            { key: 'email', label: 'Email / Username', type: 'text' },
            { key: 'password', label: 'Password', type: 'password' },
          ],
        },
      };
    case 'subsonic':
      return {
        description: 'Personal cloud music server (Subsonic / Navidrome API)',
        auth: {
          type: 'credentials',
          label: 'Connect Subsonic / Navidrome Server',
          fields: [
            { key: 'host', label: 'Server URL', type: 'url', placeholder: 'https://music.example.com', required: true },
            { key: 'user', label: 'Username', type: 'text', required: true },
            { key: 'pass', label: 'Password', type: 'password', required: true },
          ],
        },
      };
    case 'jellyfin':
      return {
        description: 'Self-hosted Jellyfin media library',
        auth: {
          type: 'credentials',
          label: 'Connect Jellyfin Server',
          fields: [
            { key: 'host', label: 'Server URL', type: 'url', placeholder: 'https://jellyfin.example.com', required: true },
            { key: 'apiKey', label: 'API Key', type: 'password', required: true },
            { key: 'userId', label: 'User ID (Optional)', type: 'text' },
          ],
        },
      };
    default:
      return {};
  }
}

export function createAdapter(config, fetchUpstream = fetch) {
  if (['tidal', 'qobuz'].includes(config.provider)) return createPremiumAdapter(config, fetchUpstream);
  const { provider } = config;
  let base = config.url || '';
  let user = config.user || '';
  let secret = config.secret || '';
  let token = config.token || '';
  let salt = config.salt || '';
  let userId = config.userId || '';
  const subsonic = provider === 'subsonic';

  async function request(path, params = {}, headers = {}) {
    if (!base || (subsonic ? !user || (!secret && !(token && salt)) : !secret)) throw upstreamError();
    const url = new URL(path, base);
    const authHeaders = subsonic ? {} : { 'X-Emby-Token': secret };
    if (subsonic) {
      const reqSalt = secret ? randomBytes(16).toString('hex') : salt;
      const reqToken = secret ? createHash('md5').update(secret + reqSalt).digest('hex') : token;
      for (const [key, value] of Object.entries({ u: user, t: reqToken, s: reqSalt, v: '1.16.1', c: 'aideo', f: 'json' })) {
        url.searchParams.set(key, value);
      }
    }
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    try {
      return await fetchUpstream(url, {
        headers: { ...authHeaders, ...headers }, redirect: 'error', signal: AbortSignal.timeout(30_000),
      });
    } catch { throw upstreamError(); }
  }

  return {
    status() {
      if (subsonic) {
        return {
          ok: true,
          provider: 'subsonic',
          authenticated: Boolean(base && user && (secret || (token && salt))),
          host: base || null,
          user: user || null,
        };
      }
      return {
        ok: true,
        provider: 'jellyfin',
        authenticated: Boolean(base && secret),
        host: base || null,
        userId: userId || null,
      };
    },
    async login(creds = {}) {
      if (!creds || typeof creds !== 'object') throw invalid();
      const rawHost = creds.host ?? creds.url;
      if (typeof rawHost === 'string' && rawHost.trim()) {
        let parsed;
        try { parsed = new URL(rawHost.trim()); } catch { throw invalid(); }
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
          throw invalid();
        }
        base = `${parsed.href.replace(/\/+$/, '')}/`;
      }
      if (subsonic) {
        if (typeof creds.user === 'string' && creds.user.trim()) user = creds.user.trim();
        const pass = creds.pass ?? creds.password ?? creds.secret;
        if (typeof pass === 'string' && pass) secret = pass;
        if (typeof creds.token === 'string' && creds.token.trim()) token = creds.token.trim();
        if (typeof creds.salt === 'string' && creds.salt.trim()) salt = creds.salt.trim();
      } else {
        const key = creds.apiKey ?? creds.secret ?? creds.token;
        if (typeof key === 'string' && key.trim()) secret = key.trim();
        if (typeof creds.userId === 'string') userId = creds.userId.trim();
      }
      return this.status();
    },
    async logout() {
      if (subsonic) {
        secret = '';
        token = '';
        salt = '';
      } else {
        secret = '';
      }
      return this.status();
    },
    async catalog(query = '', offset = 0, limit = 100) {
      validateCatalog(query, offset, limit);
      const response = subsonic
        ? await request('rest/search3.view', { query: query || '*', songOffset: offset, songCount: limit })
        : await request('Items', { searchTerm: query, IncludeItemTypes: 'Audio', Recursive: true,
          SortBy: 'SortName', SortOrder: 'Ascending', StartIndex: offset, Limit: limit,
          Fields: 'PrimaryImageAspectRatio,SortName' });
      const json = await readJson(response);
      const root = subsonic ? json?.['subsonic-response'] : json;
      if (!root || (subsonic ? root.status !== 'ok' : !Array.isArray(root.Items))) throw upstreamError();
      const rows = subsonic ? root.searchResult3?.song ?? [] : root.Items;
      if (!Array.isArray(rows)) throw upstreamError();
      return rows.filter(row => row && typeof (subsonic ? row.id : row.Id) === 'string'
        && (subsonic ? row.id : row.Id)).slice(0, limit).map(row => subsonic ? {
        id: row.id, title: text(row.title, 'Unknown'), artist: text(row.artist, 'Unknown Artist'),
        album: text(row.album, 'Unknown Album'), duration: number(row.duration),
        coverId: text(row.coverArt, row.id), trackNumber: number(row.track, null), discNumber: number(row.discNumber, null),
      } : {
        id: row.Id, title: text(row.Name, 'Unknown'),
        artist: (Array.isArray(row.Artists) ? row.Artists.filter(value => typeof value === 'string').join(', ') : '')
          || text(row.AlbumArtist, 'Unknown Artist'),
        album: text(row.Album, 'Unknown Album'), duration: number(row.RunTimeTicks) / 10_000_000,
        coverId: typeof row.ImageTags?.Primary === 'string' ? row.Id : null,
        trackNumber: number(row.IndexNumber, null), discNumber: number(row.ParentIndexNumber, null),
      });
    },
    media(id, cover, headers = {}) {
      return subsonic
        ? request(cover ? 'rest/getCoverArt.view' : 'rest/stream.view', { id }, headers)
        : request(cover ? `Items/${encodeURIComponent(id)}/Images/Primary` : `Audio/${encodeURIComponent(id)}/stream`, {}, headers);
    },
    async ping() {
      const response = await request(subsonic ? 'rest/ping.view' : 'System/Info');
      if (subsonic) {
        if ((await readJson(response))?.['subsonic-response']?.status !== 'ok') throw upstreamError();
      } else {
        await response.body?.cancel();
        if (!response.ok) throw upstreamError();
      }
      return true;
    },
  };
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
        if (provider !== 'tidal') throw invalid();
        try {
          send(response, 200, await adapter.startDeviceAuth());
        } catch (error) {
          if (error.status === 400) {
            send(response, 400, { error: 'Configure your Tidal Client ID or Access Token in Credentials first' });
            return;
          }
          throw error;
        }
        return;
      }
      if (path === '/auth/poll') {
        if (provider !== 'tidal') throw invalid();
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
        if (!status?.authenticated && !(provider === 'tidal' && typeof creds.clientId === 'string' && creds.clientId.trim())) {
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
      send(response, 200, {
        id: `org.aideo.${provider}`, version: '1.0.0', name: `Aideo ${provider}`,
        resources: ['search', 'stream'], contentType: 'music',
        ...manifestAuthSpec(provider),
      }); return;
    }
    if (path === '/auth/status') {
      const status = adapter.status ? await adapter.status() : { ok: true, authenticated: true };
      send(response, 200, status); return;
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
      send(response, 200, { url: `${base}/audio/${encodeURIComponent(`${provider}:${id}`)}` }); return;
    }
    const media = path.match(/^\/(audio|cover)\/(.+)$/);
    if (media) { await proxy(adapter, parseId(media[2], provider), media[1] === 'cover', request, response); return; }
    send(response, 404, { error: 'Not found' });
  }
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = loadConfig();
    const server = createServer(config);
    server.on('error', () => { process.stderr.write('Adapter server failed to bind\n'); process.exitCode = 1; });
    server.listen(config.port, '127.0.0.1', () => {
      process.stdout.write(`Manifest: http://127.0.0.1:${config.port}/manifest.json\n`);
    });
  } catch {
    process.stderr.write('Invalid server environment; check PROVIDER, server URL, credentials and PORT\n');
    process.exitCode = 1;
  }
}
