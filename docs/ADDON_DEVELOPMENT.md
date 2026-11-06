# Building an Aideo addon

An addon is a small HTTP server. Aideo installs it from a manifest URL, then calls it for search, streaming,
lyrics or translation. You do not need to change this repository to ship one.

The protocol is [Eclipse](https://eclipsemusic.app/docs)-compatible for music (`search` + `stream`).
`lyrics` and `translate` are Aideo extensions. The reference for what the host accepts is
`src-tauri/src/addons/eclipse.rs`; this page is derived from it.

- [Quick start](#quick-start)
- [Manifest](#manifest)
- [Endpoints](#endpoints)
- [Authentication](#authentication)
- [Limits the host enforces](#limits-the-host-enforces)
- [Security checklist for addon authors](#security-checklist-for-addon-authors)
- [Contributing a featured addon to this repo](#contributing-a-featured-addon-to-this-repo)

## Quick start

```bash
node addons-sdk/example/server.mjs      # Node >= 22, prints the manifest URL
```

Copy the printed `http://127.0.0.1:7100/manifest.json` into the Addons card in Aideo and install it.
`addons-sdk/example/server.mjs` is about 160 lines with no dependencies and a test file next to it
(`node --test addons-sdk/example/server.test.mjs`). Copy it as a starting point.

Installing stores the base URL in the OS keyring. The URL may carry a token in its path or query, and it is never
sent to the UI. Users can disable an addon or remove it at any time.

## Manifest

`GET /manifest.json`

```json
{
  "id": "com.example.myaddon",
  "name": "My Addon",
  "version": "1.0.0",
  "description": "Optional one-liner",
  "icon": "https://example.com/icon.png",
  "resources": ["search", "stream"],
  "contentType": "music",
  "auth": { "type": "credentials", "label": "Connect", "fields": [] }
}
```

| Field | Rule |
|---|---|
| `id` | Required. Lowercase, at least one dot, segments use `a-z 0-9 -`, at most 128 chars. `org.aideo.*` ids are used by the app itself. |
| `name` | Required, 1–128 chars, no control characters. |
| `version` | Required, 1–64 chars, no control characters. |
| `resources` | Must include `search` **and** `stream`, or `lyrics`, or `translate`. Anything else is rejected at install. |
| `icon` | Optional. Dropped unless it is an `http(s)` URL of at most 2048 chars. |
| `auth` | Optional, see [Authentication](#authentication). |

A different server cannot take over an installed id. Remove the addon first to move it to a new origin.
Track ids the user sees are `<addonId>:<trackId>`; your endpoints always receive the raw `<trackId>`.

## Endpoints

Implement only the ones for the `resources` you declared. Every endpoint is a `GET` unless noted.

### `search`: `GET /search?q=<text>`

```json
{ "tracks": [{
  "id": "123", "title": "Song", "artist": "Artist", "album": "Album", "duration": 215,
  "artworkURL": "https://example.com/cover.jpg",
  "isrc": "USRC17607839", "upc": "...", "version": "Live", "explicit": false,
  "codec": "flac", "lossless": true, "sampleRate": 44100, "bitDepth": 16
}] }
```

- Required per track: `id` (string or number, at most 512 chars), `title` (at most 512 chars), `artist`.
- `duration` is seconds. `artworkURL` is dropped unless `http(s)`.
- `lossless` is optional; if omitted it is inferred from `codec`/`format` being `flac`, `alac` or `wav`.
- Extra fields are ignored. A malformed track is skipped and does not fail the batch. Only the first 200 are used.

### `search` (optional): `GET /album/{id}` and `GET /artist/{id}`

Same `{ "tracks": [...] }` response. Used for album and artist pages.

### `stream`: `GET /stream/{trackId}[?quality=...]`

```json
{ "url": "https://cdn.example.com/a.flac", "codec": "flac", "sampleRate": 96000, "bitDepth": 24 }
```

- `quality` is one of `best_available`, `standard_lossless`, `data_saver`. You may ignore it.
- The URL is validated again by the host: see [limits](#limits-the-host-enforces).
- Encrypted streams and DASH manifests (`"encrypted": true`, `"manifest": "dash"`) are not supported.

### `lyrics` (Aideo extension): `GET /lyrics?q=&title=&artist=&album=&duration=`

```json
{ "lyrics": [{ "id": "1", "title": "Song", "artist": "Artist", "duration": 215,
               "syncedLyrics": "[00:01.00]line", "plainLyrics": "line" }] }
```

At most 10 results are read. The first non-empty of `syncedLyrics`, `raw_lrc`, `plainLyrics`, `lyrics` is used and
may be up to 512 KB.

### `translate` (Aideo extension): `GET /translate?q=<line>`

```json
{ "translation": "Translated line" }
```

At most 8192 bytes. Aideo calls it once per line and keeps the original line if you time out.

## Authentication

Declare how users sign in with `auth` in the manifest; the app renders the form.

```json
{ "type": "credentials", "label": "Connect My Service", "helpText": "Where to find your key",
  "fields": [
    { "key": "host", "label": "Server URL", "type": "url", "placeholder": "https://…", "required": true },
    { "key": "apiKey", "label": "API Key", "type": "password", "required": true }
  ] }
```

`type` is `credentials`, `device_code` or `token`. Field `type` is a hint for the input, for example `text`, `url` or `password`.

| Call | Purpose | Expected response |
|---|---|---|
| `GET /auth/status` | Is the user signed in | `{ "authenticated": true }` |
| `POST /auth/login` with `{ "credentials": { "<key>": "<value>", … } }` | `credentials` / `token` sign-in | `{ "authenticated": true }`. Respond `400` with `{ "error": "message" }` to show a message. |
| `POST /auth/device` | Start device-code sign-in | `{ "userCode", "verificationUriComplete", "interval" }` (`interval` in seconds) |
| `POST /auth/poll` | Called every `interval` | `{ "authenticated": false, "pending": true }`, then `{ "authenticated": true, "countryCode": "US" }` |
| `POST /auth/logout` | Sign out | `{ "authenticated": false }` |

Any non-2xx response with a JSON `{ "error": "…" }` body shows that message to the user. Keep it free of secrets.
Auth calls have a 5 second budget. Aideo forwards the form values to your `/auth/login` and does not persist them; keep the resulting session on your server.

## Limits the host enforces

| Rule | Value |
|---|---|
| Response body | 2 MB |
| Tracks per response | 200 |
| Manifest / search / catalog | 5 s |
| `/stream/{id}` | 3 s |
| Install (to survive a free-tier cold start) | 30 s |
| Redirects | Never followed. Return the final URL. |
| Scheme | `https`. Plain `http` only for `localhost` and private/LAN addresses. |
| URL credentials | `https://user:pass@host` is rejected. Put tokens in the path or query. |
| Private-network URLs | A stream URL may point to a private address only if the addon itself is on a private address. Link-local, multicast and unspecified addresses are never allowed. |
| YouTube URLs | Rejected as stream URLs. |

If your stream URL redirects (a CDN hop), resolve it server-side. The player follows only public `http(s)` hops and
refuses any hop that resolves to a private address.

## Security checklist for addon authors

- Bind to `127.0.0.1` unless you are deliberately hosting remotely behind TLS.
- Check the `Host` header against your own address (DNS-rebinding guard; see the example).
- Read credentials from environment variables or user login, never from source. Never log tokens.
- Reject anything you do not recognise: validate ids (length, control characters, `..`), cap request bodies, rate-limit.
- Return generic errors for upstream failures. Do not echo upstream responses.
- Support `Range` requests on audio you proxy. Seeking depends on it.

## Contributing a featured addon to this repo

Featured addons (Tidal, Qobuz, Subsonic, Jellyfin) are a local Node adapter in `addons-sdk/cloud/`, one loopback process
per provider on its own port. Release builds bundle the adapter with Node as a single executable, `aideo-addons`
(about 88 MB, built by `npm run build:sidecar`, see `scripts/build-sidecar.mjs`). The app starts the right process on demand
and stops them when it exits. Debug builds use the bundled executable if you built it, and otherwise run
`node addons-sdk/cloud/server.mjs` from the checkout. Release builds never run scripts from the working directory.

The featured ports are fixed, so the app checks that whatever answers on one is the process it started. It gives each
adapter a random per-launch secret (`AIDEO_SIDECAR_SECRET`) and, before trusting the port, sends a fresh nonce to
`GET /sidecar-proof?nonce=<hex>`; the adapter must reply `{ "proof": HMAC-SHA256(secret, nonce) }` in hex. If another
program holds the port, the app refuses with "Port N is already in use by another program" instead of sending it
credentials. While the app runs it keeps each adapter's stdin open, and an adapter started with `AIDEO_EXIT_WITH_PARENT=1`
exits when that pipe closes, so a crashed app does not leave adapters behind. In a debug build you can run your own
adapter on a featured port by setting `AIDEO_TRUST_EXTERNAL_ADDON_SERVERS=1`; release builds ignore that variable.
Prefer an [external addon](#quick-start) unless the adapter needs to live here.

1. **Catalog entry**: add the provider to `addons-sdk/cloud/featured.json` (`provider`, `id`, `name`, a unique `port`,
   `description`, `resources`, `auth`). The Node adapter, the Rust host and the UI catalog all read this file, so ids, ports,
   names and auth forms are defined once. The Rust host also uses it to auto-start the adapter in dev builds.
2. **Adapter**: add a module in `addons-sdk/cloud/` exporting `loadConfig(env, featuredEntry)` (returns the provider's
   config; the server adds `port`) and `createAdapter(config, fetchUpstream)`, then register it in
   `addons-sdk/cloud/providers.mjs`. Nothing in `server.mjs` needs to change. An adapter provides `status()`, `login()`,
   `logout()`, `catalog()`, `media()` and `ping()`; see `selfhosted.mjs` for the smallest complete one. Optional
   capabilities are declared on the adapter: `supportsDeviceAuth` (plus `startDeviceAuth()` / `pollDeviceAuth()` and an
   optional `deviceAuthHint`) enables the device-code endpoints, and `acceptsPartialLogin(creds)` lets a login that is not
   yet authenticated succeed. Imports in the registry are static so the adapter can be bundled into a single executable;
   do not load providers dynamically.
3. **Config**: add `<provider>.env.example` with server-side variable names only. Credentials come from the environment or a
   login. They are never hardcoded, and real `.env` files are gitignored.
4. **Sidecar**: nothing extra to do. The registry and `featured.json` are bundled automatically. Run
   `npm run build:sidecar` once to build the executable and smoke-test it. Do not load providers dynamically or read files
   next to the module at runtime (use `featured.mjs` for shared data); a single executable has no files beside it.
5. **Tests**: add `*.test.mjs` next to the adapter and list it in the "Cloud addon tests" step of
   `.github/workflows/check.yml`. Cover search, stream, auth failure, and that errors do not leak secrets.
6. **Run the full gate** (see [CONTRIBUTING.md](../CONTRIBUTING.md#before-you-open-a-pull-request)).

Changes to how the host talks to addons live in `src-tauri/src/addons/`. Those need a Rust test that locks the behavior in.
