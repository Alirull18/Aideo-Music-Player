import { describe, expect, it } from 'vitest';
import {
  buildChartRequest,
  chartEntryToTrack,
  getPlayableChartEntries,
  isArtworkValid,
  mergeChartEntries,
  resolveChartArtwork,
  type ChartEntry,
} from '../utils/charts';

function makeEntry(rank: number, playable = true): ChartEntry {
  return {
    chart_id: `lastfm:${rank}:artist-${rank}:song-${rank}`,
    rank,
    title: `Song ${rank}`,
    artist: `Artist ${rank}`,
    artwork_url: null,
    previous_rank: rank + 1,
    weeks_on_chart: null,
    listen_count: rank * 1_000,
    recording_mbid: null,
    playback_track: playable
      ? {
          id: `video-${rank}`,
          title: `Song ${rank}`,
          artist: `Artist ${rank}`,
          cover_url: null,
          duration_raw: '3:05',
          url: `https://youtube.test/watch?v=video-${rank}`,
          recommendation_source: 'Last.fm chart',
        }
      : null,
  };
}

describe('Top Charts data model', () => {
  it('sends one Last.fm scope at a time', () => {
    expect(buildChartRequest({
      source: 'lastfm',
      scope: 'genre',
      genre: 'rock',
      country: 'Malaysia',
      range: 'week',
      offset: 0,
      limit: 20,
    })).toEqual({
      genre: 'rock',
      country: null,
      source: 'lastfm',
      range: null,
      offset: 0,
      limit: 20,
    });

    expect(buildChartRequest({
      source: 'lastfm',
      scope: 'country',
      genre: 'rock',
      country: 'Malaysia',
      range: 'week',
      offset: 0,
      limit: 20,
    })).toMatchObject({ genre: '', country: 'Malaysia' });
  });

  it('uses ListenBrainz range but clears Last.fm-only controls', () => {
    expect(buildChartRequest({
      source: 'listenbrainz',
      scope: 'country',
      genre: 'pop',
      country: 'Japan',
      range: 'month',
      offset: 40,
      limit: 20,
    })).toEqual({
      genre: '',
      country: null,
      source: 'listenbrainz',
      range: 'month',
      offset: 40,
      limit: 20,
    });
  });

  it('preserves source ranks while merging later pages', () => {
    const merged = mergeChartEntries(
      [makeEntry(1), makeEntry(2, false)],
      [makeEntry(2), makeEntry(3)],
    );

    expect(merged.map((entry) => entry.rank)).toEqual([1, 2, 3]);
    expect(merged[1].playback_track?.id).toBe('video-2');
  });

  it('keeps unavailable rows visible but excludes them from playback', () => {
    const entries = [makeEntry(1, false), makeEntry(2), makeEntry(3, false)];

    expect(entries).toHaveLength(3);
    expect(getPlayableChartEntries(entries).map((entry) => entry.rank)).toEqual([2]);
    expect(chartEntryToTrack(entries[0])).toBeNull();
    expect(chartEntryToTrack(entries[1])).toMatchObject({
      path: 'https://youtube.test/watch?v=video-2',
      title: 'Song 2',
      duration: 185,
      format: 'YouTube Web Stream',
    });
  });

  it('rejects Last.fm placeholder hash and falls back to playback track cover', () => {
    const placeholderUrl = 'https://lastfm-img.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png';
    const realCoverUrl = 'https://i.ytimg.com/vi/video-1/hqdefault.jpg';

    expect(isArtworkValid(placeholderUrl)).toBe(false);
    expect(isArtworkValid(realCoverUrl)).toBe(true);
    expect(isArtworkValid('')).toBe(false);
    expect(isArtworkValid(null)).toBe(false);

    const entryWithPlaceholder: ChartEntry = {
      ...makeEntry(1),
      artwork_url: placeholderUrl,
      playback_track: {
        id: 'video-1',
        title: 'Song 1',
        artist: 'Artist 1',
        cover_url: realCoverUrl,
        duration_raw: '3:05',
        url: 'https://youtube.test/watch?v=video-1',
        recommendation_source: 'Last.fm chart',
      },
    };

    expect(resolveChartArtwork(entryWithPlaceholder)).toBe(realCoverUrl);
    expect(chartEntryToTrack(entryWithPlaceholder)?.cover_url).toBe(realCoverUrl);
  });
});
