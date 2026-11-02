import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';
import { createAdapter, createServer, loadConfig } from './server.mjs';

const tidal = { PROVIDER: 'tidal', TIDAL_ACCESS_TOKEN: 'authorized-token', TIDAL_COUNTRY_CODE: 'MY' };
const qobuz = { PROVIDER: 'qobuz', QOBUZ_AUTH_TOKEN: 'authorized-token', QOBUZ_APP_ID: 'authorized-app',
  QOBUZ_APP_SECRET: 'authorized-secret' };
const json = value => new Response(JSON.stringify(value));
const manifest = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64');

test('premium configuration requires authorized tokens and Qobuz signing credentials, with no built-in credentials', () => {
  assert.equal(loadConfig(tidal).provider, 'tidal');
  assert.equal(loadConfig(qobuz).provider, 'qobuz');
  assert.equal(loadConfig(tidal).port, 7013);
  assert.equal(loadConfig(qobuz).port, 7014);
  const refreshMode = loadConfig({ PROVIDER: 'tidal', TIDAL_CLIENT_ID: 'client-1', TIDAL_REFRESH_TOKEN: 'ref-1' });
  assert.equal(refreshMode.clientId, 'client-1');
  assert.equal(refreshMode.refreshToken, 'ref-1');
  assert.equal(refreshMode.country, '');
  const deviceMode = loadConfig({ PROVIDER: 'tidal', TIDAL_CLIENT_ID: 'client-1', TIDAL_CLIENT_SECRET: 'sec-1' });
  assert.equal(deviceMode.clientId, 'client-1');
  assert.equal(deviceMode.clientSecret, 'sec-1');
  for (const env of [
    { ...tidal, TIDAL_ACCESS_TOKEN: '' },
    { ...tidal, TIDAL_COUNTRY_CODE: 'not-country' },
    { PROVIDER: 'tidal', TIDAL_REFRESH_TOKEN: 'ref-only', TIDAL_COUNTRY_CODE: 'MY' },
    { PROVIDER: 'tidal', TIDAL_CLIENT_ID: 'client-1', TIDAL_COUNTRY_CODE: 'usa' },
    { ...qobuz, QOBUZ_AUTH_TOKEN: '' },
    { ...qobuz, QOBUZ_APP_ID: '' },
    { ...qobuz, QOBUZ_APP_SECRET: '' },
  ]) {
    assert.throws(() => loadConfig(env));
  }
});

test('Tidal search carries bearer auth, pagination, region and versioned metadata', async () => {
  const calls = [];
  const adapter = createAdapter(loadConfig(tidal), async (url, options) => {
    calls.push({ url: new URL(url), options });
    return json({ tracks: { items: [{ id: 42, title: 'Title', version: 'Live',
      artist: { name: 'Artist' }, album: { title: 'Album', cover: 'a-b-c' }, duration: 123,
      trackNumber: 3, volumeNumber: 2 }] } });
  });
  const tracks = await adapter.catalog('雪 & +', 25, 50);
  assert.equal(tracks[0].id, '42');
  assert.equal(tracks[0].title, 'Title (Live)');
  assert.equal(tracks[0].artist, 'Artist');
  assert.equal(tracks[0].coverId, '42');
  assert.equal(tracks[0].duration, 123);
  assert.equal(tracks[0].trackNumber, 3);
  assert.equal(tracks[0].discNumber, 2);
  assert.equal(calls[0].url.origin, 'https://api.tidal.com');
  assert.equal(calls[0].url.pathname, '/v1/search');
  assert.equal(calls[0].url.searchParams.get('query'), '雪 & +');
  assert.equal(calls[0].url.searchParams.get('countryCode'), 'MY');
  assert.equal(calls[0].url.searchParams.get('offset'), '25');
  assert.equal(calls[0].url.searchParams.get('limit'), '50');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer authorized-token');
  assert.equal(calls[0].options.redirect, 'error');
  await assert.rejects(adapter.catalog(null));
});

test('Qobuz search carries app/token headers, preserves version metadata and excludes unstreamable tracks', async () => {
  const calls = [];
  const adapter = createAdapter(loadConfig(qobuz), async (url, options) => {
    calls.push({ url: new URL(url), options });
    return json({ tracks: { items: [null, { id: 0, streamable: false }, { id: 42, title: 'Title',
      version: 'Live', performer: { name: 'Artist' }, album: { title: 'Album', image: { small: 'https://static.qobuz.com/image.jpg' } },
      duration: 123, track_number: 3, media_number: 2 }] } });
  });
  const tracks = await adapter.catalog('雪 & +', 25, 50);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].title, 'Title (Live)');
  assert.equal(tracks[0].artist, 'Artist');
  assert.equal(tracks[0].coverId, '42');
  assert.equal(tracks[0].trackNumber, 3);
  assert.equal(tracks[0].discNumber, 2);
  assert.equal(calls[0].url.pathname, '/api.json/0.2/track/search');
  assert.equal(calls[0].url.searchParams.get('query'), '雪 & +');
  assert.equal(calls[0].options.headers['X-App-Id'], 'authorized-app');
  assert.equal(calls[0].options.headers['X-User-Auth-Token'], 'authorized-token');
  assert.equal(calls[0].url.searchParams.has('user_auth_token'), false);
});

test('Tidal quality fallback rejects encryption, segmented and non-HTTPS manifests before proxying usable audio', async () => {
  const calls = [];
  const invalid = [
    { encryptionType: 'OLD_AES', urls: ['https://audio.tidal.com/one'] },
    { urls: ['https://audio.tidal.com/one', 'https://audio.tidal.com/two'] },
    { urls: ['file:///private'] },
    { urls: ['https://127.0.0.1/private'] },
  ];
  const adapter = createAdapter(loadConfig(tidal), async (url, options) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, options });
    if (parsed.pathname.includes('playbackinfopostpaywall')) {
      return json({ manifest: manifest(invalid.shift() ?? { encryptionType: 'NONE', urls: ['https://audio.tidal.com/usable?secret=cdn'] }) });
    }
    return new Response('audio');
  });
  assert.equal(await (await adapter.media('42', false, { Range: 'bytes=0-9' })).text(), 'audio');
  assert.deepEqual(calls.slice(0, 5).map(call => call.url.searchParams.get('audioquality')),
    ['HI_RES_LOSSLESS', 'HI_RES', 'LOSSLESS', 'HIGH', 'LOW']);
  assert.equal(calls.at(-1).url.href, 'https://audio.tidal.com/usable?secret=cdn');
  assert.equal(calls.at(-1).options.headers.Authorization, undefined);
  assert.equal(calls.at(-1).options.headers.Range, 'bytes=0-9');
});

test('Tidal refuses encrypted/segmented XML but accepts a single unencrypted BaseURL', async () => {
  for (const xml of [
    '<MPD><ContentProtection/><BaseURL>https://audio.tidal.com/audio</BaseURL></MPD>',
    '<MPD><SegmentTemplate/><BaseURL>https://audio.tidal.com/audio</BaseURL></MPD>',
    '<MPD><BaseURL>https://audio.tidal.com/audio</BaseURL><BaseURL>https://audio.tidal.com/other</BaseURL></MPD>',
  ]) {
    const adapter = createAdapter(loadConfig(tidal), async () => json({ manifest: manifest(xml) }));
    await assert.rejects(adapter.media('42', false));
  }
  const adapter = createAdapter(loadConfig(tidal), async url => new URL(url).hostname === 'api.tidal.com'
    ? json({ manifest: manifest('<MPD><BaseURL>https://audio.tidal.com/audio?a=1&amp;b=2</BaseURL></MPD>') })
    : new Response('audio'));
  assert.equal(await (await adapter.media('42', false)).text(), 'audio');
});

test('Qobuz signs exactly the extracted HEAD formula and falls back through authorized formats', async () => {
  const calls = [];
  const adapter = createAdapter(loadConfig(qobuz), async (url, options) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, options });
    if (parsed.pathname.endsWith('getFileUrl')) return parsed.searchParams.get('format_id') === '5'
      ? json({ url: 'https://streaming-qobuz-std.akamaized.net/audio?secret=cdn' })
      : new Response('subscription restriction', { status: 403 });
    return new Response('audio');
  });
  assert.equal(await (await adapter.media('42', false)).text(), 'audio');
  assert.deepEqual(calls.slice(0, 4).map(call => call.url.searchParams.get('format_id')), ['27', '7', '6', '5']);
  const signed = calls[0].url.searchParams;
  assert.equal(signed.get('request_sig'), createHash('md5').update(
    `trackgetFileUrlformat_id27intentstreamtrack_id42${signed.get('request_ts')}authorized-secret`,
  ).digest('hex'));
  assert.equal(calls.at(-1).options.headers['X-User-Auth-Token'], undefined);
  assert.equal(calls.at(-1).options.headers['X-App-Id'], undefined);
});

test('premium auth failures stop retries and malformed responses fail without credential leakage', async () => {
  for (const config of [tidal, qobuz]) {
    let calls = 0;
    const adapter = createAdapter(loadConfig(config), async () => {
      calls++; return new Response('authorized-token', { status: 401 });
    });
    await assert.rejects(adapter.media('42', false), error => !error.message.includes('authorized-token'));
    assert.equal(calls, 1);
    await assert.rejects(adapter.media('../42', false));
    assert.equal(calls, 1);
    await assert.rejects(adapter.catalog(), error => !error.message.includes('authorized-token'));
    const malformed = createAdapter(loadConfig(config), async () => json({}));
    await assert.rejects(malformed.catalog());
    await assert.rejects(malformed.media('42', false));
    const network = createAdapter(loadConfig(config), async () => { throw new Error('authorized-token'); });
    await assert.rejects(network.catalog(), error => !error.message.includes('authorized-token'));
  }
});

test('premium artwork proxy uses provider metadata rather than client-supplied URLs', async () => {
  for (const [config, metadata, image] of [
    [tidal, { album: { cover: 'a-b-c' } }, 'https://resources.tidal.com/images/a/b/c/320x320.jpg'],
    [qobuz, { album: { image: { large: 'https://static.qobuz.com/image.jpg' } } }, 'https://static.qobuz.com/image.jpg'],
  ]) {
    const calls = [];
    const adapter = createAdapter(loadConfig(config), async (url, options) => {
      calls.push({ url: new URL(url), options });
      return calls.length === 1 ? json(metadata) : new Response('image');
    });
    assert.equal(await (await adapter.media('42', true)).text(), 'image');
    assert.equal(calls.at(-1).url.href, image);
    assert.deepEqual(calls.at(-1).options.headers, {});
  }
});

test('premium health uses authenticated session endpoints; HTTP streams contain only loopback proxy URLs', async t => {
  for (const config of [tidal, qobuz]) {
    const calls = [];
    const server = createServer(loadConfig(config), async url => { calls.push(new URL(url)); return json({}); });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/health`)).status, 200);
    const stream = await (await fetch(`${base}/stream/42`)).json();
    assert.ok(stream.url.startsWith(`${base}/audio/`));
    assert.ok(!JSON.stringify(stream).includes('authorized'));
    assert.ok(calls[0].pathname.endsWith(config.PROVIDER === 'tidal' ? '/sessions' : '/user/get'));
  }
});

test('Tidal proactive refresh deduplicates concurrent calls and resolves country from OAuth or sessions', async () => {
  const tokenPosts = [];
  const apiCalls = [];
  const config = loadConfig({
    PROVIDER: 'tidal', TIDAL_CLIENT_ID: 'client-id', TIDAL_CLIENT_SECRET: 'client-secret',
    TIDAL_REFRESH_TOKEN: 'initial-refresh',
  });
  const adapter = createAdapter(config, async (url, options) => {
    const parsed = new URL(url);
    if (parsed.hostname === 'auth.tidal.com') {
      tokenPosts.push({ url: parsed, options });
      return json({
        access_token: 'fresh-access-token',
        refresh_token: 'rotated-refresh-token',
        expires_in: 3600,
        user: { countryCode: 'JP' },
      });
    }
    apiCalls.push({ url: parsed, options });
    return json({ tracks: { items: [{ id: 10, title: 'Song', artist: { name: 'Art' }, album: { title: 'Alb' }, duration: 100 }] } });
  });
  const [first, second] = await Promise.all([adapter.catalog('one'), adapter.catalog('two')]);
  assert.equal(first[0].id, '10');
  assert.equal(second[0].id, '10');
  assert.equal(tokenPosts.length, 1);
  const body = new URLSearchParams(tokenPosts[0].options.body);
  assert.equal(body.get('grant_type'), 'refresh_token');
  assert.equal(body.get('refresh_token'), 'initial-refresh');
  assert.equal(body.get('client_id'), 'client-id');
  assert.equal(body.get('client_secret'), 'client-secret');
  assert.equal(apiCalls.length, 2);
  for (const call of apiCalls) {
    assert.equal(call.options.headers.Authorization, 'Bearer fresh-access-token');
    assert.equal(call.url.searchParams.get('countryCode'), 'JP');
  }

  let sessionCalls = 0;
  const fallbackAdapter = createAdapter(loadConfig({
    PROVIDER: 'tidal', TIDAL_CLIENT_ID: 'client-id', TIDAL_REFRESH_TOKEN: 'ref-2',
  }), async url => {
    const parsed = new URL(url);
    if (parsed.hostname === 'auth.tidal.com') return json({ access_token: 'tok-2', expires_in: 3600 });
    if (parsed.pathname.endsWith('/sessions')) { sessionCalls++; return json({ countryCode: 'GB' }); }
    assert.equal(parsed.searchParams.get('countryCode'), 'GB');
    return json({ tracks: { items: [] } });
  });
  await fallbackAdapter.catalog('test');
  await fallbackAdapter.catalog('test2');
  assert.equal(sessionCalls, 1);
});

test('Tidal reactive 401 refreshes token once and retries, stopping without leaking secrets if retry 401s', async () => {
  const calls = [];
  const config = loadConfig({
    PROVIDER: 'tidal', TIDAL_ACCESS_TOKEN: 'expired-token', TIDAL_REFRESH_TOKEN: 'secret-refresh-token',
    TIDAL_CLIENT_ID: 'client-id', TIDAL_COUNTRY_CODE: 'US',
  });
  let refreshed = false;
  const adapter = createAdapter(config, async (url, options) => {
    const parsed = new URL(url);
    calls.push({ url: parsed, options });
    if (parsed.hostname === 'auth.tidal.com') {
      refreshed = true;
      return json({ access_token: 'renewed-token', refresh_token: 'new-refresh-secret', expires_in: 3600 });
    }
    if (options.headers.Authorization === 'Bearer expired-token') {
      return new Response('expired-token', { status: 401 });
    }
    if (parsed.pathname.includes('playbackinfopostpaywall')) {
      return json({ manifest: manifest({ encryptionType: 'NONE', urls: ['https://audio.tidal.com/flac'] }) });
    }
    if (parsed.hostname === 'audio.tidal.com') return new Response('flac-bytes');
    return json({ tracks: { items: [{ id: 7, title: 'Recovered', duration: 90 }] } });
  });
  const tracks = await adapter.catalog('retry');
  assert.equal(tracks[0].title, 'Recovered');
  assert.ok(refreshed);
  assert.equal(await (await adapter.media('7', false)).text(), 'flac-bytes');

  let authAttempts = 0;
  let apiAttempts = 0;
  const failingAdapter = createAdapter(config, async url => {
    const parsed = new URL(url);
    if (parsed.hostname === 'auth.tidal.com') {
      authAttempts++;
      return json({ access_token: 'still-unauthorized-secret', expires_in: 3600 });
    }
    apiAttempts++;
    return new Response('still-unauthorized-secret', { status: 401 });
  });
  await assert.rejects(failingAdapter.catalog('fail'), err => {
    return !err.message.includes('still-unauthorized-secret') && !err.message.includes('secret-refresh-token');
  });
  assert.equal(authAttempts, 1);
  assert.equal(apiAttempts, 2);
});

test('Tidal loopback HTTP Device Authorization flow authenticates and enables catalog and stream', async t => {
  let pollCount = 0;
  const server = createServer(loadConfig({
    PROVIDER: 'tidal', TIDAL_CLIENT_ID: 'device-client-id', TIDAL_CLIENT_SECRET: 'device-secret',
  }), async (url, options) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/v1/oauth2/device_authorization') {
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('client_id'), 'device-client-id');
      assert.equal(body.get('scope'), 'r_usr w_usr w_sub');
      return json({
        deviceCode: 'dev-code-123',
        userCode: 'ABCD-1234',
        verificationUri: 'link.tidal.com',
        verificationUriComplete: 'link.tidal.com/ABCD-1234',
        expiresIn: 300,
        interval: 2,
      });
    }
    if (parsed.pathname === '/v1/oauth2/token') {
      pollCount++;
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('device_code'), 'dev-code-123');
      assert.equal(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:device_code');
      if (pollCount === 1) {
        return new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 400 });
      }
      return json({
        access_token: 'device-access-token',
        refresh_token: 'device-refresh-token',
        expires_in: 3600,
        user: { countryCode: 'DE' },
      });
    }
    if (parsed.pathname === '/v1/search') {
      assert.equal(options.headers.Authorization, 'Bearer device-access-token');
      assert.equal(parsed.searchParams.get('countryCode'), 'DE');
      return json({ tracks: { items: [{ id: 42, title: 'Device Track', duration: 180 }] } });
    }
    if (parsed.pathname.includes('playbackinfopostpaywall')) {
      assert.equal(options.headers.Authorization, 'Bearer device-access-token');
      return json({ manifest: manifest({ encryptionType: 'NONE', urls: ['https://audio.tidal.com/stream42'] }) });
    }
    return new Response('device-audio-stream');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;

  assert.equal((await fetch(`${base}/auth/poll`, { method: 'POST' })).status, 400);

  const startRes = await fetch(`${base}/auth/device`, { method: 'POST' });
  assert.equal(startRes.status, 200);
  const startData = await startRes.json();
  assert.deepEqual(startData, {
    userCode: 'ABCD-1234',
    verificationUri: 'link.tidal.com',
    verificationUriComplete: 'https://link.tidal.com/ABCD-1234',
    expiresIn: 300,
    interval: 2,
  });

  const pendingRes = await fetch(`${base}/auth/poll`, { method: 'POST' });
  assert.equal(pendingRes.status, 200);
  assert.deepEqual(await pendingRes.json(), { authenticated: false, pending: true });

  const authRes = await fetch(`${base}/auth/poll`, { method: 'POST' });
  assert.equal(authRes.status, 200);
  assert.deepEqual(await authRes.json(), { authenticated: true, countryCode: 'DE' });

  const searchRes = await fetch(`${base}/search?q=test`);
  assert.equal(searchRes.status, 200);
  const searchData = await searchRes.json();
  assert.equal(searchData.tracks[0].id, '42');

  const streamRes = await fetch(`${base}/stream/42`);
  assert.equal(streamRes.status, 200);
  const streamData = await streamRes.json();
  const audioRes = await fetch(streamData.url);
  assert.equal(await audioRes.text(), 'device-audio-stream');
});

test('premium manifest auth spec, /auth/status, /auth/login, /auth/logout and Hi-Res search metadata', async t => {
  const server = createServer(loadConfig(qobuz), async url => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/user/login')) {
      assert.equal(parsed.searchParams.get('email'), 'user@example.com');
      assert.equal(parsed.searchParams.get('password'), 'pass-123');
      return json({ user_auth_token: 'logged-in-qobuz-token' });
    }
    if (parsed.pathname.endsWith('/track/search')) {
      return json({
        tracks: {
          items: [{
            id: 99,
            title: 'Master Track',
            version: 'Studio Master',
            performer: { name: 'Performer' },
            album: { title: 'Hi-Res Album', upc: '009988776655' },
            duration: 210,
            isrc: 'FRZ112233445',
            parental_warning: true,
            maximum_sampling_rate: 192,
            maximum_bit_depth: 24,
          }],
        },
      });
    }
    return json({});
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;

  const manifestData = await (await fetch(`${base}/manifest.json`)).json();
  assert.equal(manifestData.description, '24-bit / 192 kHz Studio Masters streaming');
  assert.equal(manifestData.auth?.type, 'credentials');

  const status1 = await (await fetch(`${base}/auth/status`)).json();
  assert.equal(status1.authenticated, true);

  const logout = await (await fetch(`${base}/auth/logout`, { method: 'POST' })).json();
  assert.equal(logout.authenticated, false);

  const loginRes = await fetch(`${base}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credentials: { appId: 'authorized-app', email: 'user@example.com', password: 'pass-123' } }),
  });
  assert.equal(loginRes.status, 200);
  const loginStatus = await loginRes.json();
  assert.equal(loginStatus.authenticated, true);

  const searchData = await (await fetch(`${base}/search?q=master`)).json();
  assert.equal(searchData.tracks.length, 1);
  assert.equal(searchData.tracks[0].lossless, true);
  assert.equal(searchData.tracks[0].codec, 'FLAC');
  assert.equal(searchData.tracks[0].sampleRate, 192000);
  assert.equal(searchData.tracks[0].bitDepth, 24);
  assert.equal(searchData.tracks[0].isrc, 'FRZ112233445');
  assert.equal(searchData.tracks[0].upc, '009988776655');
  assert.equal(searchData.tracks[0].version, 'Studio Master');
  assert.equal(searchData.tracks[0].explicit, true);
});
