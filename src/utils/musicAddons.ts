import type { AddonInfo } from '../store/addonSlice';
import type { Track } from '../store/types';

const INTERNAL_ADDONS = ['org.aideo.youtube', 'org.aideo.lyrics', 'org.aideo.translation'];

/** Installed external addons that can both search and stream; internal/lyrics-only entries and duplicates are excluded. */
export function musicAddons(addons: readonly AddonInfo[]): AddonInfo[] {
  return addons.filter((addon, index) => !addon.builtin
    && addon.enabled !== false
    && !INTERNAL_ADDONS.includes(addon.id)
    && addon.resources.includes('search') && addon.resources.includes('stream')
    && addons.findIndex(candidate => candidate.id === addon.id) === index);
}

export function musicSearchOptions(appMode: 'local' | 'hybrid', addons: readonly AddonInfo[], source = 'all') {
  return {
    youtube: appMode !== 'local' && (source === 'all' || source === 'youtube'),
    addons: appMode === 'local' ? [] : musicAddons(addons).filter(addon => source === 'all' || addon.id === source).map(addon => addon.id),
  };
}

export function filterMusicSource(tracks: Track[], source: string): Track[] {
  return source === 'all' ? tracks : tracks.filter(track => track.source_context?.sources.some(candidate =>
    source === 'youtube' ? candidate.provider === 'youtube' : candidate.provider === 'addon' && candidate.id.startsWith(`${source}:`)));
}

export const enabledAddonKey = (addons: readonly AddonInfo[]): string => musicAddons(addons).map(addon => addon.id).sort().join(',');
