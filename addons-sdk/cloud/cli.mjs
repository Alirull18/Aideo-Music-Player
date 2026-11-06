import { createServer, loadConfig } from './app.mjs';

/** Starts the adapter described by the environment (PROVIDER, PORT, credentials). Never prints secrets. */
export function run(env = process.env) {
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
