export interface Track {
  id: number;
  path: string;
  title: string | null;
  artist: string | null;
  album?: string | null;
  duration: number | null;
  format: string | null;
  lyric_offset: number;
  cover_url?: string | null;
  is_autoplay?: boolean;
  loved?: number;
  disliked?: number;
  path_hash?: string | null;
  bpm?: number | null;
  energy?: number | null;
  bass_ratio?: number | null;
  treble_ratio?: number | null;
  track_number?: number | null;
  disc_number?: number | null;
}

export interface CloudTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  cover_url: string | null;
  stream_url: string;
  provider: 'subsonic' | 'jellyfin';
  track_number?: number | null;
  disc_number?: number | null;
}

export interface YoutubeTrack {
  id: string;
  title: string;
  artist: string;
  cover_url: string | null;
  duration_raw: string;
  url: string;
  recommendation_source?: string | null;
}

export interface YoutubeMix {
  id: string;
  title: string;
  description: string;
  cover_url: string | null;
  tracks: YoutubeTrack[];
}

export interface DiscoveryHubData {
  recommendations: YoutubeTrack[];
  global_charts: YoutubeTrack[];
  mixed_for_you: YoutubeMix[];
  recently_played?: YoutubeTrack[];
  heavy_rotation?: YoutubeTrack[];
  forgotten_gems?: YoutubeTrack[];
  playlist_mixes?: YoutubeMix[];
  tidal_hifi?: YoutubeTrack[];
}

export interface Playlist {
  id: number;
  name: string;
}

export interface AudioTagData {
  path: string;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  album_artist?: string | null;
  year?: string | null;
  genre?: string | null;
  track_number?: number | null;
  track_total?: number | null;
  disc_number?: number | null;
  disc_total?: number | null;
  comment?: string | null;
  lyrics?: string | null;
  cover_data_url?: string | null;
  format?: string | null;
  duration_secs?: number | null;
  bitrate?: number | null;
  sample_rate?: number | null;
  channels?: number | null;
}

export interface AudioTagUpdate {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  album_artist?: string | null;
  year?: string | null;
  genre?: string | null;
  track_number?: number | null;
  track_total?: number | null;
  disc_number?: number | null;
  disc_total?: number | null;
  comment?: string | null;
  lyrics?: string | null;
  cover_base64?: string | null;
  remove_cover?: boolean | null;
}

export interface AudioTagBatchUpdate {
  artist?: string | null;
  album?: string | null;
  album_artist?: string | null;
  year?: string | null;
  genre?: string | null;
  comment?: string | null;
  cover_base64?: string | null;
  remove_cover?: boolean | null;
}

export interface UpnpDevice {
  id: string;
  name: string;
  manufacturer: string;
  model_name: string;
  location: string;
  ip: string;
  av_transport_url?: string | null;
  rendering_control_url?: string | null;
  is_connected: boolean;
}

export interface LyricWord {
  time_secs: number;
  duration_secs?: number;
  text: string;
}

export type LyricsDisplayMode = 'karaoke' | 'line_sync' | 'static';

export interface LyricLine {
  time_secs: number;
  text: string;
  romaji?: string;
  translation?: string;
  words?: LyricWord[];
}

export interface EQBand {
  freq: number;
  gain: number;
  q: number;
  band_type: string; // 'lowshelf' | 'peaking' | 'highshelf'
}

export interface DSPState {
  enabled: boolean;
  low_spec_mode: boolean;
  audio_profile: 'low' | 'normal' | 'high' | 'custom';
  resampler_interpolation: 'linear' | 'cubic';
  resampler_sinc_len: 64 | 128 | 256;
  resampler_oversampling: 128 | 256 | 512;
  ffmpeg_transcode_quality: 'standard' | 'studio' | 'hires' | 'native';
  width: number;
  upsample_rate: number;
  dither: boolean;
  exclusive_mode_timing: 'event' | 'polling';
  preamp_gain: number;
  limiter_threshold: number;
  resampler_phase_mode: 'linear' | 'minimum' | 'intermediate';

  // EQ
  eq_enabled: boolean;
  eq_parametric: boolean;
  eq_graphic_gains: number[];
  eq_parametric_bands: EQBand[];

  // Crossfeed
  crossfeed_enabled: boolean;
  crossfeed_level: number;
  crossfeed_corner: number;

  // Soundstage
  spatial_enabled: boolean;
  spatial_haas_delay: number;
  spatial_wet: number;
  convolution_enabled: boolean;
  convolution_ir_path: string;
  convolution_wet: number;

  // Dynamics
  subsonic_enabled: boolean;
  night_mode_enabled: boolean;
  r128_enabled: boolean;

  // Aideo Filter
  aideo_filter_enabled: boolean;
  aideo_filter_room_size: number;
  aideo_filter_bass_thump: number;
  aideo_filter_dampening: number;
  auto_headroom: boolean;
  saturation_enabled: boolean;
  saturation_drive: number;
  crossfade_transition_enabled: boolean;
  crossfade_transition_duration: number;
  stream_engine: 'yt-dlp' | 'reqwest';
  lookahead_prebuffer_enabled: boolean;
  track_replaygain_gain?: number;
  playback_rate?: number;
}




export interface PlaybackState {
  status: 'Playing' | 'Paused' | 'Stopped';
  current_track: string | null;
  position_secs: number;
  volume: number;
  exclusive: boolean;
  bit_perfect: boolean;
  dev_rate: number;
  driver_type: 'WASAPI' | 'ASIO';
  last_skip_time?: number;
  last_seek_time?: number;
  last_stop_time?: number;
  last_played_track?: string | null;
  last_poll_time?: number;
  backend_stop_detected_at?: number;
  file_rate?: number;
  file_ch?: number;
  file_format?: string | null;
}

export interface CustomPromptState {
  open: boolean;
  title: string;
  placeholder: string;
  initialValue?: string;
  actionLabel: string;
  onSubmit: (val: string) => void;
}

export interface NetworkTelemetry {
  session_downloaded_bytes: number;
  current_download_rate_bps: number;
  latency_ms: number;
  active_stream_buffered_bytes: number;
  active_stream_total_bytes: number;
}

export interface PlayerState {
  view: 'library' | 'albums' | 'nowplaying' | 'lastfm' | 'listenbrainz' | 'tidal' | 'aideo' | 'aideo_search' | 'settings' | 'aideo_lab' | 'fullscreen' | 'loved_streams' | 'insights' | 'charts';
  networkTelemetry: NetworkTelemetry | null;
  tracks: Track[];
  queue: Track[];
  currentTrackIndex: number;
  currentTrack: Track | null;
  shuffle: boolean;
  repeat: 'none' | 'all' | 'one';
  playHistory: Track[];
  playCounts: Record<string, number>;
  playback: PlaybackState;
  isMuted: boolean;
  mutedPrevVolume: number;
  lyrics: LyricLine[];
  lyricOffset: number;
  lyricStatus: 'idle' | 'loading' | 'found' | 'not_found';
  lyricsDisplayMode: LyricsDisplayMode;
  coverArt: string | null;
  accentColor: string;
  showProMode: boolean;
  showControlCenter: boolean;
  showSettings: boolean;
  showQueue: boolean;
  dsp: DSPState;
  devices: string[];
  currentDevice: string | null;
  scanDirs: string[];
  scanStatus: string;
  librarySearchQuery: string;
  setLibrarySearchQuery: (query: string) => void;
  isTranslating: boolean;
  showRomaji: boolean;
  showTranslation: boolean;
  showLyricsHeader: boolean;
  scrobbleEnabled: boolean;
  lastfmSessionKey: string | null;
  tidalConnected: boolean;
  tidalSearching: boolean;
  tidalSearchResults: Track[];
  pendingSettingsTab: string | null;
  checkTidalStatus: () => Promise<void>;
  searchTidal: (query: string) => Promise<void>;
  playTidalResult: (track: Track) => Promise<void>;
  downloadTidalTrack: (track: Track) => Promise<void>;

  // Qobuz Streaming (Experimental)
  qobuzExperimentalEnabled: boolean;
  toggleQobuzExperimental: () => void;
  qobuzConnected: boolean;
  qobuzSearching: boolean;
  qobuzSearchResults: Track[];
  checkQobuzStatus: () => Promise<void>;
  searchQobuz: (query: string) => Promise<void>;
  playQobuzResult: (track: Track) => Promise<void>;
  downloadQobuzTrack: (track: Track) => Promise<void>;
  lastfmToken: string | null;
  scrobbledCurrent: boolean;
  lastScrobble: { artist: string; track: string } | null;
  scrobbleThreshold: number;
  playlists: Playlist[];
  currentPlaylist: Playlist | null;
  playbackError: string | null;
  playbackSuccess: string | null;
  customPrompt: CustomPromptState;
  coverArtModalTrack: Track | null;
  currentHistoryId: number | null;
  autoplayEnabled: boolean;
  autoplayDiscoveryLevel: 'familiarity' | 'balanced' | 'discovery';
  autoplaySeedTrack: Track | null;
  autoplaySessionHistory: Track[];
  recentlyClearedAutoplayPaths: string[];
  appMode: 'local' | 'hybrid';
  onboardingCompleted: boolean;
  showOnboarding: boolean;

  // Chromecast State
  chromecast_devices: { name: string; ip: string; port: number }[];
  chromecast_active_device: string | null;
  chromecast_scanning: boolean;
  chromecast_connected: boolean;

  // Lossless UPnP / DLNA State
  upnp_devices: UpnpDevice[];
  upnp_active_device: string | null;
  upnp_scanning: boolean;
  upnp_connected: boolean;

  // Tag Editor State
  tagEditorTrack: Track | null;
  tagEditorBatchTracks: Track[];

  // Desktop Lyrics State
  desktopLyricsOpen: boolean;
  desktopLyricsLocked: boolean;

  // actions
  setCustomPrompt: (prompt: Partial<CustomPromptState>) => void;
  setCoverArtModalTrack: (track: Track | null) => void;
  setTagEditorTrack: (track: Track | null) => void;
  setTagEditorBatchTracks: (tracks: Track[]) => void;
  toggleDesktopLyrics: () => Promise<void>;
  toggleDesktopLyricsLocked: () => Promise<void>;
  discoverUpnpDevices: () => Promise<void>;
  connectUpnpDevice: (device: UpnpDevice) => Promise<void>;
  disconnectUpnpDevice: () => Promise<void>;
  setPlaybackError: (err: string | null) => void;
  setPlaybackSuccess: (msg: string | null) => void;
  setView: (view: 'library' | 'albums' | 'nowplaying' | 'lastfm' | 'listenbrainz' | 'tidal' | 'aideo' | 'aideo_search' | 'settings' | 'aideo_lab' | 'fullscreen' | 'loved_streams' | 'insights' | 'charts') => void;
  setAppMode: (mode: 'local' | 'hybrid') => void;
  setOnboardingCompleted: (completed: boolean) => void;
  setShowOnboarding: (show: boolean) => void;
  updateDiscordPresence: () => void;
  addScanDir: (dir: string) => void;
  removeScanDir: (dir: string) => void;
  setScrobbleThreshold: (val: number) => void;
  toggleSettings: () => void;
  toggleQueue: () => void;
  toggleScrobble: () => void;
  keepAwake: boolean;
  toggleKeepAwake: () => Promise<void>;
  discordEnabled: boolean;
  toggleDiscord: () => void;
  lowSpecMode: boolean;
  toggleLowSpecMode: () => void;
  sidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;
  sidebarLastfmVisible: boolean;
  sidebarListenbrainzVisible: boolean;
  toggleSidebarLastfmVisible: () => void;
  toggleSidebarListenbrainzVisible: () => void;
  liquidBackgroundEnabled: boolean;
  toggleLiquidBackground: () => void;
  showSmartMixWidget: boolean;
  toggleSmartMixWidget: () => void;
  setLastFmSession: (key: string | null) => void;
  setShowRomaji: (val: boolean) => void;
  setShowTranslation: (val: boolean) => void;
  setShowLyricsHeader: (val: boolean) => void;
  toggleLyricsHeader: () => void;
  scanLibrary: () => Promise<void>;
  loadLibrary: () => Promise<void>;
  deleteTrack: (path: string) => Promise<void>;
  recordPlaybackTransition: (newTrack: Track | null, playbackSource?: string) => Promise<void>;
  playTrack: (track: Track, isHistory?: boolean, forceResetAutoplay?: boolean, playbackSource?: string, startPos?: number) => Promise<void>;
  playDynamicMix: (mixType: 'supermix' | 'recap' | 'discovery' | 'chill') => Promise<void>;
  addToQueue: (track: Track) => Promise<void>;
  playNextInQueue: (track: Track) => Promise<void>;
  playFromQueue: (index: number) => Promise<void>;
  removeFromQueue: (index: number) => Promise<void>;
  clearQueue: () => Promise<void>;
  reorderQueue: (from: number, to: number) => Promise<void>;
  initializeQueue: () => Promise<void>;
  fetchQueue: () => Promise<void>;
  handleTrackTransition: (path: string) => Promise<void>;
  playNext: () => Promise<void>;
  getNextTrackToPlay: () => Track | null;
  getNextTracksToPlay: (count?: number) => Track[];
  preCacheNextTracks: () => Promise<void>;
  playPrev: () => Promise<void>;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  toggleAutoplay: () => Promise<void>;
  setAutoplayDiscoveryLevel: (level: 'familiarity' | 'balanced' | 'discovery') => void;
  triggerAutoplayRadio: (track: Track, forceReset?: boolean) => Promise<void>;
  pauseTrack: () => Promise<void>;
  resumeTrack: () => Promise<void>;
  resumeLastSession: () => Promise<boolean>;
  resumePosition: number;
  dismissResumePrompt: () => void;
  stopTrack: () => Promise<void>;
  setVolume: (vol: number) => Promise<void>;
  toggleMute: () => Promise<void>;
  seek: (secs: number) => Promise<void>;
  pollStatus: () => Promise<void>;
  toggleProMode: () => void;
  toggleControlCenter: () => void;
  resetProMode: () => void;
  setDSP: (dsp: Partial<DSPState>) => Promise<void>;
  toggleDspAB: () => Promise<void>;
  toggleExclusive: () => Promise<void>;
  toggleBitPerfect: () => Promise<void>;
  fetchDevices: () => Promise<void>;
  setAudioDevice: (name: string) => Promise<void>;
  playbackRate: number;
  setPlaybackRate: (rate: number) => Promise<void>;
  adjustLyricOffset: (ms: number) => void;
  setLyricOffset: (ms: number) => void;
  setLyricsDisplayMode: (mode: LyricsDisplayMode) => void;
  saveLyrics: (path: string, lrc: string) => Promise<void>;
  autoFetchLyricsOnline: (track: Track) => Promise<void>;
  translateLyrics: () => Promise<void>;
  getRomaji: () => Promise<void>;
  applyOnlineCover: (path: string, url: string) => Promise<void>;
  fetchPlaylists: () => Promise<void>;
  createPlaylist: (name: string) => Promise<void>;
  deletePlaylist: (id: number) => Promise<void>;
  smartPlaylists: any[];
  fetchSmartPlaylists: () => Promise<void>;
  createSmartPlaylist: (name: string, rules: any) => Promise<void>;
  deleteSmartPlaylist: (id: number) => Promise<void>;
  addToPlaylist: (playlistId: number, trackPath: string) => Promise<void>;
  removeFromPlaylist: (playlistId: number, trackPath: string) => Promise<void>;
  reorderPlaylistTracks: (playlistId: number, fromIndex: number, toIndex: number) => Promise<void>;
  loadPlaylistTracks: (playlistId: number) => Promise<void>;
  toggleLoveTrack: (path: string, metadata?: Partial<Track>) => Promise<void>;
  toggleDislikeTrack: (path: string, metadata?: Partial<Track>) => Promise<void>;
  resetDislikedTracks: () => Promise<void>;
  cachedCloudHashes: string[];
  fetchCachedCloudHashes: () => Promise<void>;
  cacheCloudTrack: (track: any) => Promise<void>;
  deleteCachedTrack: (streamUrl: string) => Promise<void>;
  generateSmartMix: (mood: string, trendSource: string) => Promise<void>;
  setDriverType: (type: 'WASAPI' | 'ASIO') => void;
  playStream: (url: string, metadata?: { title?: string; artist?: string; duration?: number; cover_url?: string | null }, triggerAutoplay?: boolean) => Promise<void>;
  fetchLastfmDashboard: () => Promise<void>;
  matchMetadata: (track: Track) => Promise<any>;
  lastfmUser: any | null;
  lastfmRecent: any[];
  lastfmTopArtists: any[];
  listenbrainzToken: string | null;
  listenbrainzUsername: string | null;
  listenbrainzEnabled: boolean;
  listenbrainzRecent: any[];
  listenbrainzRecs: any[];
  listenbrainzListenCount: number | null;
  setListenbrainzToken: (token: string | null) => void;
  validateAndSetListenbrainzToken: (token: string) => Promise<boolean>;
  toggleListenbrainzScrobble: () => void;
  fetchListenbrainzDashboard: () => Promise<void>;



  // Cloud Connections State
  subsonicUrl: string;
  subsonicUser: string;
  subsonicPass: string;
  subsonicConnected: boolean;
  subsonicLoading: boolean;
  jellyfinUrl: string;
  jellyfinConnected: boolean;
  jellyfinLoading: boolean;

  // Cloud Connections Actions
  connectSubsonic: (url: string, user: string, pass: string) => Promise<boolean>;
  disconnectSubsonic: () => void;
  loadSubsonicPassword: () => Promise<void>;
  connectJellyfin: (url: string, apiKey: string) => Promise<boolean>;
  disconnectJellyfin: () => void;

  // Notification Preferences
  notificationsEnabled: boolean;
  developerNotifications: boolean;
  toggleNotificationsEnabled: () => void;
  toggleDeveloperNotifications: () => void;

  // Discovery Hub State
  discoveryData: DiscoveryHubData | null;
  isLoadingRecs: boolean;
  activeDiscoveryTab: string;
  discoveryLayout: 'shelves' | 'unified';
  setDiscoveryData: (data: DiscoveryHubData | null) => void;
  setIsLoadingRecs: (loading: boolean) => void;
  setActiveDiscoveryTab: (tab: string) => void;
  setDiscoveryLayout: (layout: 'shelves' | 'unified') => void;
  cacheSizeLimit: number;
  setCacheSizeLimit: (limit: number) => void;

  // Auth & Cloud Sync State
  supabaseUrl: string;
  supabaseKey: string;
  user: any | null;
  session: any | null;
  authLoading: boolean;
  syncing: boolean;
  setSupabaseCredentials: (url: string, key: string) => void;
  signIn: (email: string, pass: string) => Promise<boolean>;
  signUp: (email: string, pass: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  checkSession: () => Promise<void>;
  signInWithOAuth: (provider: 'google' | 'github') => Promise<void>;
  syncToCloud: () => Promise<void>;
  syncFromCloud: (options?: {
    likedTracks?: boolean;
    playlists?: boolean;
    settings?: boolean;
    playCounts?: boolean;
  }) => Promise<void>;

  // Chromecast Actions
  discoverCastDevices: () => Promise<void>;
  connectCastDevice: (device: { name: string; ip: string; port: number }) => Promise<void>;
  disconnectCastDevice: () => Promise<void>;

  // Mini Player
  miniPlayerMode: boolean;
  setMiniPlayerMode: (mini: boolean) => Promise<void>;

  // Keyboard Shortcuts
  shortcuts: Record<string, string>;
  setShortcut: (action: string, binding: string) => void;

  // Global Hotkeys (work when app is not focused)
  globalHotkeys: Record<string, string | null>;
  setGlobalHotkey: (action: string, binding: string | null) => void;
  initGlobalHotkeys: () => void;

  // Sleep Timer
  sleepTimer: { duration: number; remaining: number; active: boolean };
  startSleepTimer: (duration: number) => void;
  stopSleepTimer: () => void;

  // Color Scheme Theme Mode
  colorScheme: 'dark' | 'light' | 'system';
  setColorScheme: (mode: 'dark' | 'light' | 'system') => void;

  // Album Art Fit Mode
  albumArtFit: 'cover' | 'contain';
  setAlbumArtFit: (fit: 'cover' | 'contain') => void;

  // Player Bar Design Layout
  playerBarDesign: PlayerBarDesign;
  setPlayerBarDesign: (design: PlayerBarDesign) => void;

  // Aideo Page Design Layout
  aideoPageDesign: AideoPageDesign;
  setAideoPageDesign: (design: AideoPageDesign) => void;

  // Player Bar Transparency (Glassmorphism)
  playerBarTransparent: boolean;
  setPlayerBarTransparent: (transparent: boolean) => void;
  togglePlayerBarTransparent: () => void;
}

export type PlayerBarDesign = 'classic' | 'floating' | 'waveform' | 'minimal' | 'vinyl';
export type AideoPageDesign = 'classic' | 'editorial' | 'command' | 'stage';

// Design ids that existed before the 2026 home redesign. Stored values from
// these are migrated to 'classic' on load.
export const LEGACY_AIDEO_PAGE_DESIGNS = ['bento', 'audiophile', 'cinematic'] as const;

function rgbToHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToRgb(h: number, s: number, l: number) {
  h /= 360; s /= 100; l /= 100;
  let r = l;
  let g = l;
  let b = l;

  if (s !== 0) {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
}

export function extractDominantColor(dataUrl: string | null | undefined): Promise<string> {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.trim()) {
    return Promise.resolve('#8b5cf6');
  }
  return new Promise((resolve) => {
    const img = new Image();
    if (!dataUrl.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 10; canvas.height = 10;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve('#8b5cf6'); return; }
      ctx.drawImage(img, 0, 0, 10, 10);
      const data = ctx.getImageData(0, 0, 10, 10).data;
      
      // 1. Group pixels into 3D RGB histogram bins (each channel divided by 32, giving 8^3 = 512 bins)
      const bins: Record<string, { r: number, g: number, b: number, count: number }> = {};
      for (let i = 0; i < data.length; i += 4) {
        const pr = data[i];
        const pg = data[i+1];
        const pb = data[i+2];
        const pa = data[i+3];
        if (pa < 128) continue; // skip transparent pixels
        
        // Skip extreme whites and blacks to focus on actual colors
        const l = (Math.max(pr, pg, pb) + Math.min(pr, pg, pb)) / 2;
        if (l > 240 || l < 20) continue;
        
        const binKey = `${pr >> 5},${pg >> 5},${pb >> 5}`;
        if (!bins[binKey]) {
          bins[binKey] = { r: pr, g: pg, b: pb, count: 1 };
        } else {
          bins[binKey].r += pr;
          bins[binKey].g += pg;
          bins[binKey].b += pb;
          bins[binKey].count++;
        }
      }
      
      // 2. Find the bin with the highest frequency count
      let dominantColor = '#8b5cf6';
      let maxCount = 0;
      for (const key in bins) {
        const bin = bins[key];
        if (bin.count > maxCount) {
          maxCount = bin.count;
          const avgR = Math.round(bin.r / bin.count);
          const avgG = Math.round(bin.g / bin.count);
          const avgB = Math.round(bin.b / bin.count);
          
          // Adjust color for visibility on dark-themed layouts
          const hsl = rgbToHsl(avgR, avgG, avgB);
          
          // Clamp lightness to 50% - 75% for optimum legibility on dark background
          const targetL = Math.max(50, Math.min(75, hsl.l));
          
          // Boost saturation to at least 55% to keep it vibrant, or leave at 0 if mono grayscale
          const targetS = hsl.s < 10 ? 0 : Math.max(55, Math.min(95, hsl.s));
          
          const adjustedRgb = hslToRgb(hsl.h, targetS, targetL);
          dominantColor = `rgb(${adjustedRgb.r},${adjustedRgb.g},${adjustedRgb.b})`;
        }
      }
      resolve(dominantColor);
    };
    img.onerror = () => resolve('#8b5cf6');
    img.src = dataUrl;
  });
}
