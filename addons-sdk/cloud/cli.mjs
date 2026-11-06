import { createServer, loadConfig } from './app.mjs';

/** Starts the adapter described by the environment (PROVIDER, PORT, credentials). Never prints secrets. */
export function run(env = process.env) {
  if (env.AIDEO_EXIT_WITH_PARENT === '1') exitWhenParentDies();
  try {
    const config = loadConfig(env);
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

/**
 * The desktop app keeps this process's stdin pipe open for as long as it lives. When the app exits or crashes the
 * operating system closes the pipe, and an adapter nobody can reach any more should not keep its port.
 */
function exitWhenParentDies() {
  const stop = () => process.exit(0);
  process.stdin.on('end', stop).on('close', stop).on('error', stop).resume();
}
