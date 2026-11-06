// Tidal/Qobuz backends were removed (source addons replace them). Tracks saved
// in queues/playlists by those providers keep a bare provider ID as `path` and
// can no longer be resolved to a stream.
export const isRetiredCloudTrack = (t: { format?: string | null; path: string }): boolean =>
  (t.format === 'Tidal FLAC' || t.format === 'Qobuz FLAC') && !/^https?:\/\//.test(t.path);

export const RETIRED_PROVIDER_MESSAGE =
  'Tidal and Qobuz are no longer built in. Install a source addon in Settings to play this track.';
