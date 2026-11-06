// Node >=22. Run: node --env-file=your-private.env addons-sdk/cloud/server.mjs
// See the provider .env.example files for server-only credential names.
import { pathToFileURL } from 'node:url';
import { run } from './cli.mjs';

export * from './app.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
