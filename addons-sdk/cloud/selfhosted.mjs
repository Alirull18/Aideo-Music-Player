// Subsonic / Navidrome and Jellyfin: the user's own server, authorized by a server-side password or API key.
import { createHash, randomBytes } from 'node:crypto';
import { invalid, readJson, upstreamError, validateCatalog } from './http.mjs';
import { readSessionFile, writeSessionFile } from './session.mjs';

/** Reads `<PROVIDER>_URL` and credentials from the environment. The caller adds `port`. */
export function selfHostedConfig(env, { provider }) {
  const prefix = provider.toUpperCase();
  const rawUrl = env[`${prefix}_URL`];
  const allowUnconfigured = env.ALLOW_UNCONFIGURED === '1';
  const sessionFile = typeof env.SESSION_FILE === 'string' && env.SESSION_FILE.trim() ? env.SESSION_FILE.trim() : '';
  if (allowUnconfigured && (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim())) {
    const user = typeof env.SUBSONIC_USER === 'string' ? env.SUBSONIC_USER : '';
    const secret = provider === 'subsonic'
      ? (typeof env.SUBSONIC_PASSWORD === 'string' ? env.SUBSONIC_PASSWORD : '')
      : (typeof env.JELLYFIN_API_KEY === 'string' ? env.JELLYFIN_API_KEY : '');
    return { provider, url: '', user, secret, ...(sessionFile ? { sessionFile } : {}) };
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
  return {
    provider,
    url: `${url.href.replace(/\/+$/, '')}/`,
    user: typeof user === 'string' ? user : '',
    secret: typeof secret === 'string' ? secret : '',
    ...(sessionFile ? { sessionFile } : {}),
  };
}

const text = (value, fallback) => typeof value === 'string' && value ? value : fallback;
const number = (value, fallback = 0) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;

export function createSelfHostedAdapter(config, fetchUpstream = fetch) {
  const { provider } = config;
  const saved = readSessionFile(config.sessionFile);
  let base = config.url || (typeof saved?.base === 'string' ? saved.base : '');
  let user = config.user || (typeof saved?.user === 'string' ? saved.user : '');
  let secret = config.secret || (typeof saved?.secret === 'string' ? saved.secret : '');
  let token = config.token || (typeof saved?.token === 'string' ? saved.token : '');
  let salt = config.salt || (typeof saved?.salt === 'string' ? saved.salt : '');
  let userId = config.userId || (typeof saved?.userId === 'string' ? saved.userId : '');
  const subsonic = provider === 'subsonic';

  function persistSession() {
    if (!config.sessionFile) return;
    writeSessionFile(config.sessionFile, { base, user, secret, token, salt, userId });
  }

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
      persistSession();
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
      if (config.sessionFile) writeSessionFile(config.sessionFile, {});
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

