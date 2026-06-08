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
}

export interface Playlist {
  id: number;
  name: string;
}

export interface LyricLine {
  time_secs: number;
  text: string;
  romaji?: string;
  translation?: string;
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
  ffmpeg_transcode_quality: 'standard' | 'studio' | 'hires';
  width: number;
  upsample_rate: number;
  dither: boolean;
  exclusive_mode_timing: 'event' | 'polling';

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

  // Dynamics
  subsonic_enabled: boolean;
  night_mode_enabled: boolean;
  r128_enabled: boolean;
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
  last_played_track?: string | null;
  last_poll_time?: number;
}

export interface CustomPromptState {
  open: boolean;
  title: string;
  placeholder: string;
  initialValue?: string;
  actionLabel: string;
  onSubmit: (val: string) => void;
}

export interface PlayerState {
  view: 'library' | 'nowplaying' | 'lastfm' | 'listenbrainz' | 'tidal' | 'aideo' | 'aideo_search' | 'settings' | 'aideo_lab' | 'fullscreen' | 'loved_streams';
  tracks: Track[];
  queue: Track[];
  currentTrackIndex: number;
  currentTrack: Track | null;
  shuffle: boolean;
  repeat: 'none' | 'all' | 'one';
  playHistory: Track[];
  playCounts: Record<string, number>;
  playback: PlaybackState;
  lyrics: LyricLine[];
  lyricOffset: number;
  lyricStatus: 'idle' | 'loading' | 'found' | 'not_found';
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
  isTranslating: boolean;
  showRomaji: boolean;
  scrobbleEnabled: boolean;
  lastfmSessionKey: string | null;
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
  recentlyClearedAutoplayPaths: string[];
  appMode: 'local' | 'hybrid';
  onboardingCompleted: boolean;
  showOnboarding: boolean;

  // actions
  setCustomPrompt: (prompt: Partial<CustomPromptState>) => void;
  setCoverArtModalTrack: (track: Track | null) => void;
  setPlaybackError: (err: string | null) => void;
  setPlaybackSuccess: (msg: string | null) => void;
  setView: (view: 'library' | 'nowplaying' | 'lastfm' | 'listenbrainz' | 'tidal' | 'aideo' | 'aideo_search' | 'settings' | 'aideo_lab' | 'fullscreen' | 'loved_streams') => void;
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
  scanLibrary: () => Promise<void>;
  loadLibrary: () => Promise<void>;
  recordPlaybackTransition: (newTrack: Track | null, playbackSource?: string) => Promise<void>;
  playTrack: (track: Track, isHistory?: boolean, forceResetAutoplay?: boolean, playbackSource?: string) => Promise<void>;
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
  playPrev: () => Promise<void>;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
  toggleAutoplay: () => Promise<void>;
  setAutoplayDiscoveryLevel: (level: 'familiarity' | 'balanced' | 'discovery') => void;
  triggerAutoplayRadio: (track: Track, forceReset?: boolean) => Promise<void>;
  pauseTrack: () => Promise<void>;
  resumeTrack: () => Promise<void>;
  stopTrack: () => Promise<void>;
  setVolume: (vol: number) => Promise<void>;
  seek: (secs: number) => Promise<void>;
  pollStatus: () => Promise<void>;
  toggleProMode: () => void;
  toggleControlCenter: () => void;
  resetProMode: () => void;
  setDSP: (dsp: Partial<DSPState>) => Promise<void>;
  toggleExclusive: () => Promise<void>;
  toggleBitPerfect: () => Promise<void>;
  fetchDevices: () => Promise<void>;
  setAudioDevice: (name: string) => Promise<void>;
  adjustLyricOffset: (ms: number) => void;
  setLyricOffset: (ms: number) => void;
  saveLyrics: (path: string, lrc: string) => Promise<void>;
  autoFetchLyricsOnline: (track: Track) => Promise<void>;
  translateLyrics: () => Promise<void>;
  getRomaji: () => Promise<void>;
  applyOnlineCover: (path: string, url: string) => Promise<void>;
  fetchPlaylists: () => Promise<void>;
  createPlaylist: (name: string) => Promise<void>;
  deletePlaylist: (id: number) => Promise<void>;
  addToPlaylist: (playlistId: number, trackPath: string) => Promise<void>;
  removeFromPlaylist: (playlistId: number, trackPath: string) => Promise<void>;
  loadPlaylistTracks: (playlistId: number) => Promise<void>;
  toggleLoveTrack: (path: string, metadata?: Partial<Track>) => Promise<void>;
  cachedCloudHashes: string[];
  fetchCachedCloudHashes: () => Promise<void>;
  cacheCloudTrack: (streamUrl: string) => Promise<void>;
  generateSmartMix: (mood: string, trendSource: string) => Promise<void>;
  setDriverType: (type: 'WASAPI' | 'ASIO') => void;
  playStream: (url: string, metadata?: { title?: string; artist?: string; duration?: number; cover_url?: string | null }) => Promise<void>;
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
  discoveryData: any;
  isLoadingRecs: boolean;
  activeDiscoveryTab: string;
  setDiscoveryData: (data: any) => void;
  setIsLoadingRecs: (loading: boolean) => void;
  setActiveDiscoveryTab: (tab: string) => void;
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
}

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

export function extractDominantColor(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
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
