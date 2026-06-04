import { getSupabaseClient } from './supabaseClient';
import { invoke } from '@tauri-apps/api/core';
import { useStore } from '../store';

export async function syncToCloud(): Promise<void> {
  const supabase = getSupabaseClient() as any;
  if (!supabase) return;

  const state = useStore.getState();
  const userId = state.user?.id;
  if (!userId) return;

  useStore.setState({ syncing: true });

  try {
    // 1. Sync unsynced playback history logs
    const unsyncedLogs = await invoke<any[]>('get_unsynced_history');
    if (unsyncedLogs && unsyncedLogs.length > 0) {
      console.log(`[Sync] Pushing ${unsyncedLogs.length} unsynced play logs to Supabase...`);
      const payload = unsyncedLogs.map(log => ({
        user_id: userId,
        track_path: log.track_path,
        title: log.title || 'Unknown Title',
        artist: log.artist || 'Unknown Artist',
        album: log.album || '',
        genre: log.genre || '',
        provider: log.format || 'local',
        duration_listened_secs: Math.round(log.duration_played || 0),
        listened_at: new Date(log.timestamp * 1000).toISOString(),
        playback_source: log.playback_source || 'queue'
      }));

      const { error } = await supabase
        .from('play_logs')
        .insert(payload);

      if (!error) {
        const ids = unsyncedLogs.map(log => log.id);
        await invoke('mark_history_synced', { ids });
        console.log('[Sync] Play logs pushed and marked synced successfully.');
      } else {
        console.error('[Sync] Error pushing play logs:', error.message);
      }
    }

    // 2. Sync liked tracks
    const lovedTracks = state.tracks.filter(t => t.loved === 1);
    console.log('[Sync] Found liked tracks in state.tracks:', lovedTracks.length, lovedTracks.map(t => t.path));
    if (lovedTracks.length > 0) {
      const payload = lovedTracks.map(t => ({
        user_id: userId,
        track_path: t.path,
        title: t.title || 'Unknown Title',
        artist: t.artist || 'Unknown Artist',
        album: t.album || '',
        duration: t.duration || 0,
        format: t.format || 'local',
        cover_url: t.cover_url || ''
      }));

      const { error } = await supabase
        .from('liked_tracks')
        .upsert(payload, { onConflict: 'user_id,track_path' });

      if (error) {
        console.error('[Sync] Error syncing liked tracks to Supabase:', error.message, error);
      } else {
        console.log('[Sync] Liked tracks synced to Supabase successfully.');
      }
    } else {
      console.log('[Sync] No liked tracks to sync to Supabase.');
    }

    // 3. Sync Playlists
    const playlists = state.playlists;
    for (const pl of playlists) {
      const { data, error } = await supabase
        .from('playlists')
        .upsert({ user_id: userId, name: pl.name }, { onConflict: 'user_id,name' })
        .select();

      if (error) {
        console.error(`[Sync] Error upserting playlist ${pl.name}:`, error.message);
        continue;
      }

      const cloudPlaylistId = data?.[0]?.id;
      if (cloudPlaylistId) {
        try {
          const tracks = await invoke<any[]>('get_playlist_tracks', { playlistId: pl.id });
          if (tracks && tracks.length > 0) {
            const trackPayload = tracks.map((t, idx) => ({
              playlist_id: cloudPlaylistId,
              track_path: t.path,
              position: idx,
              title: t.title || 'Unknown Title',
              artist: t.artist || 'Unknown Artist'
            }));

            await supabase.from('playlist_tracks').delete().eq('playlist_id', cloudPlaylistId);
            await supabase.from('playlist_tracks').insert(trackPayload);
          }
        } catch (e) {
          console.error('[Sync] Error fetching playlist tracks:', e);
        }
      }
    }

    // 4. Sync Settings
    const settingsPayload = {
      user_id: userId,
      autoplay_discovery_level: state.autoplayDiscoveryLevel,
      cache_size_limit: state.cacheSizeLimit,
      low_spec_mode: state.lowSpecMode,
      keep_awake: state.keepAwake,
      lastfm_session_key: state.lastfmSessionKey || '',
      listenbrainz_token: state.listenbrainzToken || '',
      updated_at: new Date().toISOString()
    };

    const { error: settingsError } = await supabase
      .from('user_settings')
      .upsert(settingsPayload, { onConflict: 'user_id' });

    if (settingsError) {
      console.error('[Sync] Error syncing settings:', settingsError.message);
    } else {
      console.log('[Sync] App settings synced successfully.');
    }

    // 5. Sync playCounts record mapping
    const playCounts = state.playCounts;
    const playCountsPayload = Object.entries(playCounts).map(([path, count]) => ({
      user_id: userId,
      track_path: path,
      play_count: count
    }));
    if (playCountsPayload.length > 0) {
      const { error } = await supabase
        .from('track_stats')
        .upsert(playCountsPayload, { onConflict: 'user_id,track_path' });
      if (error) {
        console.error('[Sync] Error syncing playCounts:', error.message);
      }
    }

    state.setPlaybackSuccess('Sync to cloud complete!');
  } catch (err: any) {
    console.error('[Sync] Sync to cloud failed:', err);
    state.setPlaybackError(`Sync to cloud failed: ${err.message || err}`);
  } finally {
    useStore.setState({ syncing: false });
  }
}

export async function syncFromCloud(options?: {
  likedTracks?: boolean;
  playlists?: boolean;
  settings?: boolean;
  playCounts?: boolean;
}): Promise<void> {
  const supabase = getSupabaseClient() as any;
  if (!supabase) return;

  const state = useStore.getState();
  const userId = state.user?.id;
  if (!userId) return;

  useStore.setState({ syncing: true });

  const syncLikes = options ? !!options.likedTracks : true;
  const syncPlaylists = options ? !!options.playlists : true;
  const syncSettings = options ? !!options.settings : true;
  const syncPlayCounts = options ? !!options.playCounts : true;

  try {
    if (syncLikes) {
      console.log('[Sync] Pulling liked tracks from cloud...');
      const { data: cloudLikes, error: likesError } = await supabase
        .from('liked_tracks')
        .select('*')
        .eq('user_id', userId);

      console.log('[Sync] Retrieved liked tracks from Supabase:', cloudLikes?.length, cloudLikes, likesError);

      if (!likesError && cloudLikes) {
        for (const t of cloudLikes) {
          const currentTracks = useStore.getState().tracks;
          const localTrack = currentTracks.find(lt => lt.path === t.track_path);
          console.log('[Sync] Restoring liked track:', t.track_path, 'Local match:', localTrack);
          if (!localTrack || localTrack.loved !== 1) {
            console.log('[Sync] Invoking toggle_love_track for:', t.track_path);
            await invoke('toggle_love_track', {
              path: t.track_path,
              loved: true,
              title: t.title || null,
              artist: t.artist || null,
              album: t.album || null,
              duration: t.duration || null,
              format: t.format || null,
              coverUrl: t.cover_url || null
            });
          }
        }
      }
    }

    if (syncSettings) {
      console.log('[Sync] Pulling settings from cloud...');
      const { data: cloudSettings, error: settingsError } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (!settingsError && cloudSettings) {
        if (cloudSettings.autoplay_discovery_level) {
          state.setAutoplayDiscoveryLevel(cloudSettings.autoplay_discovery_level);
        }
        if (cloudSettings.cache_size_limit) {
          state.setCacheSizeLimit(cloudSettings.cache_size_limit);
        }
        if (cloudSettings.low_spec_mode !== undefined && cloudSettings.low_spec_mode !== state.lowSpecMode) {
          state.toggleLowSpecMode();
        }
        if (cloudSettings.keep_awake !== undefined && cloudSettings.keep_awake !== state.keepAwake) {
          await state.toggleKeepAwake();
        }
        if (cloudSettings.lastfm_session_key && cloudSettings.lastfm_session_key !== state.lastfmSessionKey) {
          state.setLastFmSession(cloudSettings.lastfm_session_key);
        }
        if (cloudSettings.listenbrainz_token && cloudSettings.listenbrainz_token !== state.listenbrainzToken) {
          state.setListenbrainzToken(cloudSettings.listenbrainz_token);
        }
      }
    }

    if (syncPlaylists) {
      console.log('[Sync] Pulling playlists from cloud...');
      const { data: cloudPlaylists, error: plError } = await supabase
        .from('playlists')
        .select('*')
        .eq('user_id', userId);

      if (!plError && cloudPlaylists) {
        for (const pl of cloudPlaylists) {
          let currentPlaylists = await invoke<any[]>('get_playlists');
          let localPl = currentPlaylists.find(p => p.name === pl.name);

          if (localPl) {
            await invoke('delete_playlist', { id: localPl.id });
          }

          await invoke('create_playlist', { name: pl.name });
          
          currentPlaylists = await invoke<any[]>('get_playlists');
          const newLocalPl = currentPlaylists.find(p => p.name === pl.name);

          if (newLocalPl) {
            const { data: cloudTracks, error: tracksError } = await supabase
              .from('playlist_tracks')
              .select('*')
              .eq('playlist_id', pl.id)
              .order('position', { ascending: true });

            if (!tracksError && cloudTracks) {
              for (const ct of cloudTracks) {
                await invoke('add_to_playlist', { playlistId: newLocalPl.id, path: ct.track_path });
              }
            }
          }
        }
        const finalPlaylists = await invoke<any[]>('get_playlists');
        useStore.setState({ playlists: finalPlaylists });
      }
    }

    if (syncPlayCounts) {
      console.log('[Sync] Pulling track stats playCounts...');
      const { data: cloudStats, error: statsError } = await supabase
        .from('track_stats')
        .select('*')
        .eq('user_id', userId);

      if (!statsError && cloudStats) {
        const mergedCounts = { ...state.playCounts };
        let changed = false;
        for (const stat of cloudStats) {
          const currentLocal = mergedCounts[stat.track_path] || 0;
          if (stat.play_count > currentLocal) {
            mergedCounts[stat.track_path] = stat.play_count;
            changed = true;
          }
        }
        if (changed) {
          localStorage.setItem('aideo_play_counts', JSON.stringify(mergedCounts));
          useStore.setState({ playCounts: mergedCounts });
        }
      }
    }

    await state.loadLibrary();
    state.setPlaybackSuccess('Sync from cloud complete!');
  } catch (err: any) {
    console.error('[Sync] Sync from cloud failed:', err);
    state.setPlaybackError(`Sync from cloud failed: ${err.message || err}`);
  } finally {
    useStore.setState({ syncing: false });
  }
}
