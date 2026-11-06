// Entry point of the bundled desktop sidecar (see scripts/build-sidecar.mjs). The app starts one process per
// provider with PROVIDER, PORT and, optionally, SESSION_FILE in the environment.
import { run } from './cli.mjs';

run();
