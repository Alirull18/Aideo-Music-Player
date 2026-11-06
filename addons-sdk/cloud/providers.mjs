// Provider registry. To add a provider: write a module exporting `loadConfig(env, featuredEntry)` and
// `createAdapter(config, fetchUpstream)`, register it here, and add its entry to featured.json.
// Imports are static on purpose so the adapter can be bundled into a single executable.
import { createPremiumAdapter, premiumConfig } from './premium.mjs';
import { createSelfHostedAdapter, selfHostedConfig } from './selfhosted.mjs';

const selfHosted = Object.freeze({ loadConfig: selfHostedConfig, createAdapter: createSelfHostedAdapter });
const premium = Object.freeze({ loadConfig: premiumConfig, createAdapter: createPremiumAdapter });

export const PROVIDERS = Object.freeze({
  subsonic: selfHosted,
  jellyfin: selfHosted,
  tidal: premium,
  qobuz: premium,
});
