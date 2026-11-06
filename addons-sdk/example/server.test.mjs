import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { test } from 'node:test';
import { createServer, wav } from './server.mjs';

async function serve(t) {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('manifest satisfies the host rules for a music addon', async (t) => {
  const base = await serve(t);
  const manifest = await (await fetch(`${base}/manifest.json`)).json();
  // Same id grammar as valid_addon_id in src-tauri/src/addons/mod.rs.
  assert.match(manifest.id, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
  assert.ok(manifest.id.length <= 128 && manifest.name.length <= 128 && manifest.version.length <= 64);
  assert.ok(manifest.resources.includes('search') && manifest.resources.includes('stream'));
});

test('search filters by title and returns the fields the host reads', async (t) => {
  const base = await serve(t);
  const all = (await (await fetch(`${base}/search?q=`)).json()).tracks;
  assert.equal(all.length, 3);
  const [track] = (await (await fetch(`${base}/search?q=a4`)).json()).tracks;
  assert.equal(track.id, 'tone-440');
  for (const key of ['id', 'title', 'artist']) assert.equal(typeof track[key], 'string');
  assert.ok(track.id.length <= 512 && !/[\x00-\x1f]/.test(track.id));
});

test('stream returns a private-network URL that serves a full WAV and honours ranges', async (t) => {
  const base = await serve(t);
  const stream = await (await fetch(`${base}/stream/tone-440`)).json();
  assert.ok(stream.url.startsWith(base), 'loopback addons may return loopback stream URLs');
  assert.ok(!new URL(stream.url).username, 'stream URLs must not carry credentials');

  const full = Buffer.from(await (await fetch(stream.url)).arrayBuffer());
  assert.deepEqual(full, wav(440));
  assert.equal(full.subarray(0, 4).toString(), 'RIFF');

  const part = await fetch(stream.url, { headers: { Range: 'bytes=0-43' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 0-43/${full.length}`);
  assert.equal((await part.arrayBuffer()).byteLength, 44);

  const bad = await fetch(stream.url, { headers: { Range: `bytes=${full.length + 10}-` } });
  assert.equal(bad.status, 416);
});

test('unknown tracks and routes return 404; non-GET returns 405', async (t) => {
  const base = await serve(t);
  assert.equal((await fetch(`${base}/stream/nope`)).status, 404);
  assert.equal((await fetch(`${base}/audio/nope`)).status, 404);
  assert.equal((await fetch(`${base}/nothing`)).status, 404);
  assert.equal((await fetch(`${base}/manifest.json`, { method: 'POST' })).status, 405);
});

test('foreign Host headers are rejected (DNS-rebinding guard)', async (t) => {
  const base = await serve(t);
  const status = await new Promise((resolve, reject) => {
    const req = httpRequest(`${base}/manifest.json`, { headers: { Host: 'evil.test' } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 403);
});
