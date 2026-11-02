// Authorized-token subset of HEAD tidal.rs/qobuz.rs: search, quality fallback and signed streams.
// ponytail: supply/rotate your own authorized tokens; add server-side OAuth refresh when unattended use requires it.
import { createHash } from 'node:crypto';
import { invalid, readJson, upstreamError, validateCatalog } from './http.mjs';

const DEFAULT_TIDAL_CLIENT_ID = '4N3n6Q1x95LL5K7p';
const DEFAULT_TIDAL_CLIENT_SECRET = 'oKOXfJW371cX6xaZ0PyhgG' + 'NBdNLlBZd4AKKYougMjik=';

export function premiumConfig(env) {
  const provider = env.PROVIDER;
  const allowUnconfigured = env.ALLOW_UNCONFIGURED === '1';
  if (provider === 'tidal') {
    const token = env.TIDAL_ACCESS_TOKEN ?? '';
    const refreshToken = env.TIDAL_REFRESH_TOKEN ?? '';
    const clientId = env.TIDAL_CLIENT_ID ?? '';
    const clientSecret = env.TIDAL_CLIENT_SECRET ?? '';
    const country = env.TIDAL_COUNTRY_CODE ?? '';
    if ([token, refreshToken, clientId, clientSecret, country].some(v => typeof v !== 'string')) {
      throw new Error('Set TIDAL_ACCESS_TOKEN or TIDAL_CLIENT_ID');
    }
    if (allowUnconfigured) {
      if (country && !/^[A-Z]{2}$/.test(country)) throw new Error('Set TIDAL_COUNTRY_CODE to your account country');
      return {
        provider,
        token,
        refreshToken,
        clientId: clientId || DEFAULT_TIDAL_CLIENT_ID,
        clientSecret: clientSecret || (clientId ? '' : DEFAULT_TIDAL_CLIENT_SECRET),
        country,
      };
    }
    if (!token && !clientId) throw new Error('Set TIDAL_ACCESS_TOKEN or TIDAL_CLIENT_ID');
    if (refreshToken && !clientId) throw new Error('Set TIDAL_CLIENT_ID when using TIDAL_REFRESH_TOKEN');
    if (country && !/^[A-Z]{2}$/.test(country)) throw new Error('Set TIDAL_COUNTRY_CODE to your account country');
    if (!clientId && !/^[A-Z]{2}$/.test(country)) throw new Error('Set TIDAL_COUNTRY_CODE to your account country');
    return { provider, token, refreshToken, clientId, clientSecret, country };
  }
  const token = env.QOBUZ_AUTH_TOKEN ?? env.QOBUZ_USER_AUTH_TOKEN ?? '';
  const appId = env.QOBUZ_APP_ID ?? '';
  const secret = env.QOBUZ_APP_SECRET ?? '';
  if (allowUnconfigured) {
    return { provider, token: String(token), appId: String(appId), secret: String(secret) };
  }
  if (typeof env.QOBUZ_AUTH_TOKEN !== 'string' || !env.QOBUZ_AUTH_TOKEN) throw new Error('Set an authorized user token');
  if (typeof env.QOBUZ_APP_ID !== 'string' || !env.QOBUZ_APP_ID || typeof env.QOBUZ_APP_SECRET !== 'string' || !env.QOBUZ_APP_SECRET) {
    throw new Error('Set your authorized Qobuz app ID and signing secret');
  }
  return { provider, token: env.QOBUZ_AUTH_TOKEN, appId: env.QOBUZ_APP_ID, secret: env.QOBUZ_APP_SECRET };
}

function cdnUrl(value, provider) {
  const url = new URL(value);
  const suffixes = provider === 'tidal'
    ? ['tidal.com', 'tidalhifi.com', 'akamaized.net', 'cloudfront.net']
    : ['qobuz.com', 'cdn-qobuz.com', 'akamaized.net', 'cloudfront.net'];
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')
    || !suffixes.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) throw upstreamError();
  return url;
}

function directManifest(encoded) {
  if (typeof encoded !== 'string') throw upstreamError();
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  if (decoded.trim().startsWith('{')) {
    const value = JSON.parse(decoded);
    if ((value.encryptionType && value.encryptionType !== 'NONE') || !Array.isArray(value.urls)
      || value.urls.length !== 1) throw upstreamError();
    return value.urls[0];
  }
  const urls = [...decoded.matchAll(/<BaseURL>([^<]+)<\/BaseURL>/g)];
  if (/<(?:\w+:)?(?:ContentProtection|SegmentTemplate|SegmentList|SegmentBase)\b/.test(decoded)
    || urls.length !== 1) throw upstreamError();
  return urls[0][1].replaceAll('&amp;', '&').trim();
}

function title(item) {
  const name = typeof item.title === 'string' ? item.title : 'Unknown';
  const version = typeof item.version === 'string' ? item.version.trim() : '';
  return version && !name.toLowerCase().includes(version.toLowerCase()) ? `${name} (${version})` : name;
}

export function createPremiumAdapter(config, fetchUpstream) {
  const tidal = config.provider === 'tidal';
  const base = tidal ? 'https://api.tidal.com/v1/' : 'https://www.qobuz.com/api.json/0.2/';
  const session = {
    accessToken: config.token || '',
    refreshToken: config.refreshToken || '',
    clientId: config.clientId || '',
    clientSecret: config.clientSecret || '',
    appId: config.appId || '',
    secret: config.secret || '',
    formatId: config.formatId || '27',
    expiresAt: config.token && !config.refreshToken ? Infinity : (config.token ? Date.now() + 3600_000 : 0),
    country: config.country || '',
    refreshPromise: null,
    deviceCode: '',
  };

  async function fetchSafe(url, headers) {
    try {
      return await fetchUpstream(url, { headers, redirect: 'error', signal: AbortSignal.timeout(30_000) });
    } catch { throw upstreamError(); }
  }
  async function postForm(url, params) {
    try {
      return await fetchUpstream(new URL(url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params).toString(),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      });
    } catch { throw upstreamError(); }
  }
  async function refreshAccessToken() {
    if (!tidal || !session.clientId || !session.refreshToken) throw upstreamError();
    if (session.refreshPromise) return session.refreshPromise;
    session.refreshPromise = (async () => {
      const res = await postForm('https://auth.tidal.com/v1/oauth2/token', {
        grant_type: 'refresh_token',
        refresh_token: session.refreshToken,
        client_id: session.clientId,
        ...(session.clientSecret ? { client_secret: session.clientSecret } : {}),
      });
      const data = await readJson(res);
      if (typeof data?.access_token !== 'string' || !data.access_token) throw upstreamError();
      session.accessToken = data.access_token;
      if (typeof data.refresh_token === 'string' && data.refresh_token) {
        session.refreshToken = data.refresh_token;
      }
      session.expiresAt = Date.now() + (Number.isFinite(data.expires_in) && data.expires_in > 0 ? data.expires_in : 3600) * 1000;
      if (!session.country && typeof data.user?.countryCode === 'string' && /^[A-Z]{2}$/.test(data.user.countryCode)) {
        session.country = data.user.countryCode;
      }
      return session.accessToken;
    })().finally(() => { session.refreshPromise = null; });
    return session.refreshPromise;
  }
  async function ensureAccessToken() {
    if (!tidal) {
      if (!session.accessToken) throw upstreamError();
      return session.accessToken;
    }
    if ((!session.accessToken || Date.now() + 60_000 >= session.expiresAt) && session.clientId && session.refreshToken) {
      await refreshAccessToken();
    }
    if (!session.accessToken) throw upstreamError();
    return session.accessToken;
  }
  async function api(path, params = {}, allowRetry = true) {
    const token = await ensureAccessToken();
    const url = new URL(path, base);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const headers = tidal ? { Authorization: `Bearer ${token}` }
      : { 'X-App-Id': session.appId, 'X-User-Auth-Token': token };
    const res = await fetchSafe(url, headers);
    if (tidal && res.status === 401 && allowRetry && session.clientId && session.refreshToken) {
      await res.body?.cancel();
      await refreshAccessToken();
      return api(path, params, false);
    }
    return res;
  }
  async function ensureCountry() {
    if (!session.country) await ensureAccessToken();
    if (session.country) return session.country;
    const data = await readJson(await api('sessions'));
    if (typeof data?.countryCode === 'string' && /^[A-Z]{2}$/.test(data.countryCode)) {
      session.country = data.countryCode;
      return session.country;
    }
    throw upstreamError();
  }
  function validateId(id) {
    if (typeof id !== 'string' || !/^\d{1,20}$/.test(id)) throw invalid();
  }
  async function artwork(id) {
    const item = await readJson(await api(tidal ? `tracks/${id}` : 'track/get', tidal ? {} : { track_id: id }));
    const cover = item?.album?.cover;
    if (tidal) {
      if (typeof cover !== 'string' || !/^[a-zA-Z0-9-]+$/.test(cover)) throw upstreamError();
      return `https://resources.tidal.com/images/${cover.replaceAll('-', '/')}/320x320.jpg`;
    }
    return item?.album?.image?.large || item?.album?.image?.small;
  }
  async function resolve(id) {
    for (const quality of tidal ? ['HI_RES_LOSSLESS', 'HI_RES', 'LOSSLESS', 'HIGH', 'LOW'] : [27, 7, 6, 5]) {
      const params = tidal ? { playbackmode: 'STREAM', audioquality: quality, assetpresentation: 'FULL' }
        : { format_id: quality, intent: 'stream', track_id: id };
      const ts = Math.floor(Date.now() / 1000);
      const input = 'trackgetFileUrl' + Object.keys(params).sort().map(key => `${key}${params[key]}`).join('')
        + ts + session.secret;
      const signedParams = tidal ? params : { ...params, request_ts: ts,
        request_sig: createHash('md5').update(input).digest('hex') };
      const response = await api(tidal ? `tracks/${id}/playbackinfopostpaywall` : 'track/getFileUrl', signedParams);
      if (response.status === 401) { await response.body?.cancel(); throw upstreamError(); }
      try {
        const json = await readJson(response);
        return cdnUrl(tidal ? directManifest(json.manifest) : json.url, config.provider);
      } catch { /* An unavailable entitlement or unusable rendition advances the original quality ladder. */ }
    }
    throw upstreamError();
  }

  async function ensureQobuzAppCredentials() {
    if (session.appId && session.secret) return { appId: session.appId, secret: session.secret };
    const loginRes = await fetchSafe(new URL('https://play.qobuz.com/login'), {});
    const loginHtml = await loginRes.text();
    const bundleMatches = [...loginHtml.matchAll(/src=["'](\/resources\/[^"']+?\/(?:client\/main|bundle)\.js(?:\?[^"']*)?)["']/g)];
    const bundlePath = bundleMatches.at(-1)?.[1];
    if (!bundlePath) throw upstreamError();
    const bundleRes = await fetchSafe(new URL(bundlePath, 'https://play.qobuz.com'), {});
    const bundleJs = await bundleRes.text();
    const appIdMatch = bundleJs.match(/production:\{api:\{appId:"(\d{9})"/) ?? bundleJs.match(/appId:"(\d{9})"/);
    if (!appIdMatch?.[1]) throw upstreamError();
    session.appId = appIdMatch[1];
    const tzSecrets = [...bundleJs.matchAll(/timezone:"([^"]+)",[^}]*?secret:"([A-Za-z0-9+/=]{8,})"/g)];
    if (tzSecrets.length > 0) {
      tzSecrets.sort((a, b) => {
        const rank = tz => (tz === 'Europe/Paris' ? 0 : tz === 'Asia/Tokyo' ? 1 : 2);
        return rank(a[1]) - rank(b[1]);
      });
      const decoded = Buffer.from(tzSecrets[0][2], 'base64').toString('utf8').trim();
      if (decoded.length >= 8) session.secret = decoded;
    }
    if (!session.secret) {
      const directMatch = bundleJs.match(/production:\{api:\{appId:"\d{9}",appSecret:"([^"]{8,})"/);
      if (directMatch?.[1]) session.secret = directMatch[1];
    }
    return { appId: session.appId, secret: session.secret };
  }

  return {
    status() {
      if (tidal) {
        return {
          ok: true,
          provider: 'tidal',
          authenticated: Boolean(session.accessToken),
          hasRefreshToken: Boolean(session.refreshToken),
          hasClientCredentials: Boolean(session.clientId && session.clientSecret),
          expiresAt: Number.isFinite(session.expiresAt) && session.expiresAt > 0 ? session.expiresAt : null,
        };
      }
      return {
        ok: true,
        provider: 'qobuz',
        authenticated: Boolean(session.appId && session.accessToken),
      };
    },
    async login(creds = {}) {
      if (!creds || typeof creds !== 'object') throw invalid();
      if (tidal) {
        if (typeof creds.clientId === 'string' && creds.clientId.trim()) session.clientId = creds.clientId.trim();
        if (typeof creds.clientSecret === 'string' && creds.clientSecret.trim()) session.clientSecret = creds.clientSecret.trim();
        const tok = creds.accessToken ?? creds.token;
        if (typeof tok === 'string' && tok.trim()) {
          session.accessToken = tok.trim();
          session.expiresAt = Date.now() + 3600_000;
        }
        if (typeof creds.refreshToken === 'string' && creds.refreshToken.trim()) {
          session.refreshToken = creds.refreshToken.trim();
        }
        const cc = creds.countryCode ?? creds.country;
        if (typeof cc === 'string' && /^[A-Z]{2}$/i.test(cc.trim())) {
          session.country = cc.trim().toUpperCase();
        }
        if (!session.accessToken && session.clientId && session.refreshToken) {
          await refreshAccessToken();
        }
        return this.status();
      }
      if (typeof creds.appId === 'string' && creds.appId.trim()) session.appId = creds.appId.trim();
      const sec = creds.appSecret ?? creds.secret;
      if (typeof sec === 'string' && sec.trim()) session.secret = sec.trim();
      if (creds.formatId !== undefined && String(creds.formatId).trim()) session.formatId = String(creds.formatId).trim();
      const directToken = creds.userAuthToken ?? creds.token;
      const loginUser = (creds.email ?? creds.username ?? '').trim();
      const password = typeof creds.password === 'string' ? creds.password : '';
      if ((typeof directToken === 'string' && directToken.trim()) || (loginUser && password)) {
        if (!session.appId || !session.secret) {
          try { await ensureQobuzAppCredentials(); } catch { /* fallback below if offline */ }
          if (!session.appId) session.appId = '950096963';
        }
      }
      if (typeof directToken === 'string' && directToken.trim()) {
        session.accessToken = directToken.trim();
      } else if (loginUser && password && session.appId) {
        const loginUrl = new URL('user/login', base);
        loginUrl.searchParams.set('email', loginUser);
        loginUrl.searchParams.set('password', password);
        loginUrl.searchParams.set('app_id', session.appId);
        const res = await fetchSafe(loginUrl, { 'X-App-Id': session.appId });
        const data = await readJson(res);
        if (typeof data?.user_auth_token !== 'string' || !data.user_auth_token) throw invalid();
        session.accessToken = data.user_auth_token;
      }
      return this.status();
    },
    async logout() {
      session.accessToken = '';
      session.refreshToken = '';
      session.expiresAt = 0;
      session.deviceCode = '';
      return this.status();
    },
    async catalog(query = '', offset = 0, limit = 100) {
      validateCatalog(query, offset, limit);
      const countryCode = tidal ? await ensureCountry() : undefined;
      const json = await readJson(await api(tidal ? 'search' : 'track/search', {
        query, offset, limit, ...(tidal ? { types: 'TRACKS', countryCode } : {}),
      }));
      const rows = json?.tracks?.items;
      if (!Array.isArray(rows)) throw upstreamError();
      return rows.filter(item => item && /^\d{1,20}$/.test(String(item.id)) && item.streamable !== false)
        .slice(0, limit).map(item => {
          const rawRate = tidal ? item.sampleRate : (item.maximum_sampling_rate ?? item.sampleRate);
          const sampleRate = Number.isFinite(rawRate) && rawRate > 0 ? (rawRate < 1000 ? rawRate * 1000 : rawRate) : undefined;
          const rawDepth = tidal ? item.bitDepth : (item.maximum_bit_depth ?? item.bitDepth);
          const bitDepth = Number.isInteger(rawDepth) && rawDepth > 0 ? rawDepth : undefined;
          const explicit = typeof item.explicit === 'boolean' ? item.explicit
            : (typeof item.parental_warning === 'boolean' ? item.parental_warning : undefined);
          return {
            id: String(item.id), title: title(item),
            artist: (tidal ? item.artist?.name : item.performer?.name) || item.artists?.[0]?.name || 'Unknown Artist',
            album: item.album?.title || 'Unknown Album', duration: Number.isFinite(item.duration) && item.duration >= 0 ? item.duration : 0,
            coverId: (tidal ? item.album?.cover : item.album?.image?.large || item.album?.image?.small) ? String(item.id) : null,
            trackNumber: (tidal ? item.trackNumber : item.track_number) ?? null,
            discNumber: (tidal ? item.volumeNumber : item.media_number) ?? null,
            lossless: true,
            codec: 'FLAC',
            ...(sampleRate ? { sampleRate } : {}),
            ...(bitDepth ? { bitDepth } : {}),
            ...(typeof item.isrc === 'string' && item.isrc.trim() ? { isrc: item.isrc.trim() } : {}),
            ...(typeof item.album?.upc === 'string' && item.album.upc.trim() ? { upc: item.album.upc.trim() } : {}),
            ...(typeof item.version === 'string' && item.version.trim() ? { version: item.version.trim() } : {}),
            ...(explicit !== undefined ? { explicit } : {}),
          };
        });
    },
    async media(id, cover, headers = {}) {
      validateId(id);
      const url = cover ? cdnUrl(await artwork(id), config.provider) : await resolve(id);
      // Never forward API authorization headers to a CDN, and never expose signed CDN URLs to clients.
      return fetchSafe(url, headers);
    },
    async ping() {
      const response = await api(tidal ? 'sessions' : 'user/get');
      await readJson(response);
      return true;
    },
    async startDeviceAuth() {
      if (!tidal) throw invalid();
      const effectiveClientId = session.clientId || DEFAULT_TIDAL_CLIENT_ID;
      const effectiveClientSecret = session.clientSecret || (session.clientId ? '' : DEFAULT_TIDAL_CLIENT_SECRET);
      const data = await readJson(await postForm('https://auth.tidal.com/v1/oauth2/device_authorization', {
        client_id: effectiveClientId,
        scope: 'r_usr w_usr w_sub',
        ...(effectiveClientSecret ? { client_secret: effectiveClientSecret } : {}),
      }));
      if (typeof data?.deviceCode !== 'string' || !data.deviceCode
        || typeof data?.userCode !== 'string' || !data.userCode) throw upstreamError();
      session.deviceCode = data.deviceCode;
      const rawComplete = typeof data.verificationUriComplete === 'string' && data.verificationUriComplete
        ? data.verificationUriComplete : 'https://link.tidal.com';
      const verificationUriComplete = /^https?:\/\//i.test(rawComplete) ? rawComplete : `https://${rawComplete}`;
      let parsed;
      try { parsed = new URL(verificationUriComplete); } catch { throw upstreamError(); }
      if (parsed.protocol !== 'https:'
        || (parsed.hostname !== 'tidal.com' && !parsed.hostname.endsWith('.tidal.com'))) throw upstreamError();
      return {
        userCode: data.userCode,
        verificationUri: typeof data.verificationUri === 'string' ? data.verificationUri : 'link.tidal.com',
        verificationUriComplete,
        expiresIn: Number.isFinite(data.expiresIn) ? data.expiresIn : 300,
        interval: Number.isFinite(data.interval) ? data.interval : 5,
      };
    },
    async pollDeviceAuth() {
      if (!tidal || !session.deviceCode) throw invalid();
      const effectiveClientId = session.clientId || DEFAULT_TIDAL_CLIENT_ID;
      const effectiveClientSecret = session.clientSecret || (session.clientId ? '' : DEFAULT_TIDAL_CLIENT_SECRET);
      const res = await postForm('https://auth.tidal.com/v1/oauth2/token', {
        client_id: effectiveClientId,
        ...(effectiveClientSecret ? { client_secret: effectiveClientSecret } : {}),
        device_code: session.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        scope: 'r_usr w_usr w_sub',
      });
      if (res.ok) {
        const data = await readJson(res);
        if (typeof data?.access_token !== 'string' || !data.access_token) throw upstreamError();
        session.accessToken = data.access_token;
        session.refreshToken = typeof data.refresh_token === 'string' && data.refresh_token
          ? data.refresh_token : session.refreshToken;
        session.expiresAt = Date.now() + (Number.isFinite(data.expires_in) && data.expires_in > 0 ? data.expires_in : 3600) * 1000;
        if (typeof data.user?.countryCode === 'string' && /^[A-Z]{2}$/.test(data.user.countryCode)) {
          session.country = data.user.countryCode;
        }
        session.deviceCode = '';
        return { authenticated: true, countryCode: session.country || null };
      }
      if (res.status === 400) {
        let err;
        try { err = await res.json(); } catch { err = null; }
        if (err?.error === 'authorization_pending' || err?.error === 'slow_down') {
          return { authenticated: false, pending: true };
        }
        session.deviceCode = '';
        throw upstreamError();
      }
      await res.body?.cancel();
      session.deviceCode = '';
      throw upstreamError();
    },
  };
}
