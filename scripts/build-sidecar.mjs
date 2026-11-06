// Builds the desktop addon sidecar: addons-sdk/cloud bundled with Node into one executable
// (Node single-executable application) at src-tauri/bin/aideo-addons-<target-triple>[.exe].
// Tauri bundles it as an externalBin; the Rust host starts one process per featured provider.
//
//   npm run build:sidecar                  build for the host target and smoke-test the result
//   npm run build:sidecar -- --no-verify   skip the smoke test
//   npm run build:sidecar -- --target <triple>
import { build } from 'esbuild';
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inject } from 'postject';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cloud = join(root, 'addons-sdk', 'cloud');
const binDir = join(root, 'src-tauri', 'bin');
const workDir = join(root, 'src-tauri', 'target', 'sidecar-build');
// Fixed by Node's SEA documentation: the sentinel the Node binary is built with.
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const args = process.argv.slice(2);
const verify = !args.includes('--no-verify');
const targetFlag = args.indexOf('--target');

/**
 * Injecting the blob invalidates Node's Authenticode signature, and postject warns about it. Drop the certificate
 * table (and the now-meaningless checksum) from the PE header so the file is cleanly unsigned instead of corrupt.
 */
function stripAuthenticode(file) {
  const image = readFileSync(file);
  const peHeader = image.readUInt32LE(0x3c);
  if (image.toString('latin1', peHeader, peHeader + 4) !== 'PE\0\0') throw new Error('Not a PE executable');
  const optional = peHeader + 24;
  if (image.readUInt16LE(optional) !== 0x20b) throw new Error('Expected a PE32+ (64-bit) executable');
  const securityDirectory = optional + 112 + 4 * 8; // data directory #4: certificate table (file offset + size)
  const offset = image.readUInt32LE(securityDirectory);
  const size = image.readUInt32LE(securityDirectory + 4);
  if (offset === 0 || size === 0) return;
  if (offset + size !== image.length) throw new Error('Certificate table is not at the end of the file');
  image.writeUInt32LE(0, securityDirectory);
  image.writeUInt32LE(0, securityDirectory + 4);
  image.writeUInt32LE(0, optional + 64); // CheckSum
  writeFileSync(file, image.subarray(0, offset));
}

function hostTriple() {
  const match = /^host: (.+)$/m.exec(execFileSync('rustc', ['-vV'], { encoding: 'utf8' }));
  if (!match) throw new Error('Could not read the host target from `rustc -vV`');
  return match[1].trim();
}

const triple = targetFlag >= 0 ? args[targetFlag + 1] : hostTriple();
if (!triple) throw new Error('--target needs a value');
if (process.platform !== 'win32' ? triple.includes('windows') : !triple.includes('windows')) {
  throw new Error(`Cannot build a ${triple} sidecar on ${process.platform}: it embeds the local Node binary`);
}
const exeName = `aideo-addons-${triple}${triple.includes('windows') ? '.exe' : ''}`;
const exePath = join(binDir, exeName);

/** featured.mjs reads a file next to itself; a single executable has none, so inline the JSON instead. */
const inlineFeatured = {
  name: 'inline-featured',
  setup(b) {
    b.onResolve({ filter: /[\\/]featured\.mjs$/ }, (resolveArgs) => ({
      path: resolve(resolveArgs.resolveDir, resolveArgs.path),
      namespace: 'inline-featured',
    }));
    b.onLoad({ filter: /.*/, namespace: 'inline-featured' }, () => ({
      loader: 'js',
      contents: `export const FEATURED = Object.freeze(${readFileSync(join(cloud, 'featured.json'), 'utf8')});`,
    }));
  },
};

async function bundle() {
  const outfile = join(workDir, 'sidecar.cjs');
  await build({
    entryPoints: [join(cloud, 'sidecar.mjs')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs', // SEA main scripts are CommonJS
    target: 'node22',
    legalComments: 'none',
    logLevel: 'warning',
    plugins: [inlineFeatured],
  });
  return outfile;
}

async function makeExecutable(script) {
  const config = join(workDir, 'sea-config.json');
  const blob = join(workDir, 'sea-prep.blob');
  writeFileSync(config, JSON.stringify({ main: script, output: blob, disableExperimentalSEAWarning: true }));
  execFileSync(process.execPath, ['--experimental-sea-config', config], { stdio: 'inherit' });

  mkdirSync(binDir, { recursive: true });
  copyFileSync(process.execPath, exePath);
  if (triple.includes('windows')) stripAuthenticode(exePath);
  await inject(exePath, 'NODE_SEA_BLOB', readFileSync(blob), { sentinelFuse: SEA_FUSE });
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

/** Starts the built executable the way the app does and checks it serves the right manifest. */
async function smokeTest() {
  const port = await freePort();
  const child = spawn(exePath, [], {
    env: { ...process.env, PROVIDER: 'subsonic', PORT: String(port), ALLOW_UNCONFIGURED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolveReady, reject) => {
      const timer = setTimeout(() => reject(new Error('Sidecar did not start within 10 s')), 10_000);
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`Sidecar exited early with code ${code}`)));
      child.stdout.on('data', (chunk) => {
        if (String(chunk).includes('Manifest:')) {
          clearTimeout(timer);
          resolveReady();
        }
      });
    });
    const manifest = await (await fetch(`http://127.0.0.1:${port}/manifest.json`)).json();
    const featured = JSON.parse(readFileSync(join(cloud, 'featured.json'), 'utf8')).find((e) => e.provider === 'subsonic');
    if (manifest.id !== featured.id || manifest.name !== featured.name) {
      throw new Error(`Unexpected manifest from the sidecar: ${JSON.stringify(manifest)}`);
    }
  } finally {
    child.removeAllListeners('exit');
    child.kill();
  }
}

rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });
await makeExecutable(await bundle());
if (verify) {
  await smokeTest();
  console.log('sidecar smoke test passed');
}
console.log(`built ${exePath}`);
