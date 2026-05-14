export interface Track {
  id: number;
  path: string;
  title: string | null;
  artist: string | null;
  duration: number | null;
  format: string | null;
  lyric_offset: number;
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

export interface DSPState {
  width: number;
  enabled: boolean;
  upsample_rate: number;
  dither: boolean;
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
  view: 'library' | 'nowplaying' | 'lastfm';
  tracks: Track[];
  currentTrackIndex: number;
  shuffle: boolean;
  playback: PlaybackState;
  lyrics: LyricLine[];
  lyricOffset: number;
  lyricStatus: 'idle' | 'loading' | 'found' | 'not_found';
  coverArt: string | null;
  accentColor: string;
  showProMode: boolean;
  showControlCenter: boolean;
  showSettings: boolean;
  dsp: DSPState;
  devices: string[];
  currentDevice: string | null;
  scanDirs: string[];
  scanStatus: string;
  isTranslating: boolean;
  showRomaji: boolean;
  isTransitioning: boolean;
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

  // actions
  setCustomPrompt: (prompt: Partial<CustomPromptState>) => void;
  setPlaybackError: (err: string | null) => void;
  setPlaybackSuccess: (msg: string | null) => void;
  setView: (view: 'library' | 'nowplaying' | 'lastfm') => void;
  updateDiscordPresence: () => void;
  addScanDir: (dir: string) => void;
  removeScanDir: (dir: string) => void;
  setScrobbleThreshold: (val: number) => void;
  toggleSettings: () => void;
  toggleScrobble: () => void;
  setLastFmSession: (key: string | null) => void;
  setShowRomaji: (val: boolean) => void;
  scanLibrary: () => Promise<void>;
  loadLibrary: () => Promise<void>;
  playTrack: (track: Track) => Promise<void>;
  handleTrackTransition: (path: string) => Promise<void>;
  playNext: () => Promise<void>;
  playPrev: () => Promise<void>;
  toggleShuffle: () => void;
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
  saveLyrics: (path: string, lrc: string) => Promise<void>;
  translateLyrics: () => Promise<void>;
  getRomaji: () => Promise<void>;
  applyOnlineCover: (path: string, url: string) => Promise<void>;
  fetchPlaylists: () => Promise<void>;
  createPlaylist: (name: string) => Promise<void>;
  deletePlaylist: (id: number) => Promise<void>;
  addToPlaylist: (playlistId: number, trackPath: string) => Promise<void>;
  removeFromPlaylist: (playlistId: number, trackPath: string) => Promise<void>;
  loadPlaylistTracks: (playlistId: number) => Promise<void>;
  setDriverType: (type: 'WASAPI' | 'ASIO') => void;
  playStream: (url: string) => Promise<void>;
  fetchLastfmDashboard: () => Promise<void>;
  matchMetadata: (track: Track) => Promise<any>;
  lastfmUser: any | null;
  lastfmRecent: any[];
  lastfmTopArtists: any[];
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
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < data.length; i += 4) {
        r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
      }
      r = Math.round(r / count); g = Math.round(g / count); b = Math.round(b / count);
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const lightness = (max + min) / 510;
      if (lightness > 0.85 || lightness < 0.1) { resolve('#8b5cf6'); return; }
      resolve(`rgb(${r},${g},${b})`);
    };
    img.onerror = () => resolve('#8b5cf6');
    img.src = dataUrl;
  });
}
