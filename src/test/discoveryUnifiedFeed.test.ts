import { describe, it, expect } from 'vitest';
import {
  trackSignature,
  dedupeTracks,
  buildMergedFeed,
  buildUnifiedTabs,
  getUnifiedTabTracks,
} from '../utils/discoveryFeed';
import { DiscoveryHubData, YoutubeTrack } from '../store/types';

const mockTrack = (
  id: string,
  title: string,
  artist: string,
  source: string,
): YoutubeTrack => ({
  id,
  title,
  artist,
  cover_url: null,
  duration_raw: '3:00',
  url: `/music/${id}.flac`,
  recommendation_source: source,
});

const emptyData = (): DiscoveryHubData => ({
  recommendations: [],
  global_charts: [],
  mixed_for_you: [],
  recently_played: [],
  heavy_rotation: [],
  forgotten_gems: [],
  playlist_mixes: [],
});

describe('discoveryFeed helpers', () => {
  describe('trackSignature', () => {
    it('is case and whitespace insensitive on artist + title', () => {
      expect(trackSignature(mockTrack('a', 'Nightcall', 'Kavinsky', 'x'))).toBe(
        trackSignature(mockTrack('b', 'nightcall', ' Kavinsky ', 'y')),
      );
    });

    it('differs when the song differs', () => {
      expect(trackSignature(mockTrack('a', 'Nightcall', 'Kavinsky', 'x'))).not.toBe(
        trackSignature(mockTrack('b', 'Outrun', 'Kavinsky', 'y')),
      );
    });
  });

  describe('dedupeTracks', () => {
    it('removes later duplicates of the same artist + title', () => {
      const merged = dedupeTracks([
        mockTrack('local_1', 'Nightcall', 'Kavinsky', 'Recently Played'),
        mockTrack('yt_9', 'Nightcall', 'Kavinsky', 'Global Top Hits'),
        mockTrack('other', 'Crescendo', 'Perturbator', 'Heavy Rotation'),
      ]);
      expect(merged).toHaveLength(2);
      expect(merged[0].id).toBe('local_1');
    });
  });

  describe('buildMergedFeed', () => {
    it('includes tracks from every personal shelf plus recommendations and global charts', () => {
      const data = emptyData();
      data.recommendations = [mockTrack('rec1', 'Rec Song', 'E', "Similar to 'Loved Song'")];
      data.recently_played = [mockTrack('r1', 'Recent Song', 'A', 'Recently Played')];
      data.heavy_rotation = [mockTrack('h1', 'Rotation Song', 'B', 'Heavy Rotation')];
      data.forgotten_gems = [mockTrack('g1', 'Gem Song', 'C', 'Time Capsule')];
      data.global_charts = [mockTrack('c1', 'Chart Song', 'D', 'Global Top Hits')];

      const feed = buildMergedFeed(data);
      expect(feed).toHaveLength(5);
      const ids = feed.map(t => t.id);
      expect(ids).toEqual(expect.arrayContaining(['rec1', 'r1', 'h1', 'g1', 'c1']));
    });

    it('interleaves categories instead of concatenating blocks', () => {
      const data = emptyData();
      data.recently_played = [
        mockTrack('r1', 'R One', 'A', 'Recently Played'),
        mockTrack('r2', 'R Two', 'A', 'Recently Played'),
        mockTrack('r3', 'R Three', 'A', 'Recently Played'),
      ];
      data.global_charts = [
        mockTrack('c1', 'C One', 'D', 'Global Top Hits'),
        mockTrack('c2', 'C Two', 'D', 'Global Top Hits'),
        mockTrack('c3', 'C Three', 'D', 'Global Top Hits'),
      ];

      const feed = buildMergedFeed(data);
      // Strict block concat would be [r1,r2,r3,c1,c2,c3]; interleave must not be.
      expect(feed.map(t => t.id)).toEqual(['r1', 'c1', 'r2', 'c2', 'r3', 'c3']);
    });

    it('deduplicates songs shared between shelves while merging', () => {
      const data = emptyData();
      data.recently_played = [mockTrack('r1', 'Overlap Song', 'Shared Artist', 'Recently Played')];
      data.heavy_rotation = [mockTrack('h1', 'Overlap Song', 'shared artist', 'Heavy Rotation')];

      const feed = buildMergedFeed(data);
      expect(feed).toHaveLength(1);
      expect(feed[0].id).toBe('r1');
    });

    it('never emits more than one consecutive track from the same category', () => {
      const data = emptyData();
      data.recently_played = [
        mockTrack('r1', 'R One', 'A', 'Recently Played'),
        mockTrack('r2', 'R Two', 'A', 'Recently Played'),
      ];
      data.heavy_rotation = [
        mockTrack('h1', 'H One', 'B', 'Heavy Rotation'),
        mockTrack('h2', 'H Two', 'B', 'Heavy Rotation'),
      ];
      data.forgotten_gems = [mockTrack('g1', 'G One', 'C', 'Time Capsule')];

      const feed = buildMergedFeed(data);
      for (let i = 1; i < feed.length; i++) {
        if (feed[i].recommendation_source === feed[i - 1].recommendation_source) {
          // Only allowed once the other lists are exhausted
          const remainingSources = new Set(feed.slice(i).map(t => t.recommendation_source));
          expect(remainingSources.size).toBeLessThanOrEqual(2);
          break;
        }
      }
    });

    it('handles an empty hub without throwing', () => {
      expect(buildMergedFeed(emptyData())).toEqual([]);
    });
  });

  describe('buildUnifiedTabs', () => {
    it('reports per-category counts and the merged total for All', () => {
      const data = emptyData();
      data.recommendations = [mockTrack('rec1', 'Rec Song', 'E', "Similar to 'Loved Song'")];
      data.recently_played = [
        mockTrack('r1', 'R One', 'A', 'Recently Played'),
        mockTrack('r2', 'R Two', 'A', 'Recently Played'),
      ];
      data.heavy_rotation = [mockTrack('h1', 'H One', 'B', 'Heavy Rotation')];
      data.forgotten_gems = [mockTrack('g1', 'G One', 'C', 'Time Capsule'), mockTrack('g2', 'G Two', 'C', 'Time Capsule')];
      data.global_charts = [mockTrack('c1', 'C One', 'D', 'Global Top Hits')];

      const tabs = buildUnifiedTabs(data);
      const byId = Object.fromEntries(tabs.map(t => [t.id, t.count]));

      // rec + r1/r2 + h1 + g1/g2 + c1, all unique -> All = 7
      expect(byId['all']).toBe(7);
      expect(byId['recs']).toBe(1);
      expect(byId['recent']).toBe(2);
      expect(byId['rotation']).toBe(1);
      expect(byId['gems']).toBe(2);
      expect(byId['charts']).toBe(1);
    });

    it('always exposes the six unified tabs in stable order', () => {
      const tabs = buildUnifiedTabs(emptyData());
      expect(tabs.map(t => t.id)).toEqual(['all', 'recs', 'recent', 'rotation', 'gems', 'charts']);
    });
  });

  describe('getUnifiedTabTracks', () => {
    it("returns the exact shelf content for a category tab so both layouts match", () => {
      const data = emptyData();
      data.recommendations = [mockTrack('rec1', 'Rec Song', 'E', "Similar to 'Loved Song'")];
      data.recently_played = [mockTrack('r1', 'R One', 'A', 'Recently Played')];
      data.global_charts = [mockTrack('c1', 'C One', 'D', 'Global Top Hits')];

      expect(getUnifiedTabTracks(data, 'recs')).toEqual(data.recommendations);
      expect(getUnifiedTabTracks(data, 'recent')).toEqual(data.recently_played);
      expect(getUnifiedTabTracks(data, 'charts')).toEqual(data.global_charts);
    });

    it("returns the merged feed for the 'all' tab", () => {
      const data = emptyData();
      data.recently_played = [mockTrack('r1', 'R One', 'A', 'Recently Played')];
      data.global_charts = [mockTrack('c1', 'C One', 'D', 'Global Top Hits')];

      expect(getUnifiedTabTracks(data, 'all')).toEqual(buildMergedFeed(data));
    });
  });
});
