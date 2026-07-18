import { useStore } from '../store';
import { Play, Pause, SkipBack, SkipForward, Maximize2, Volume2, Heart, ThumbsDown } from 'lucide-react';
import defaultCover from '../assets/default_cover.png';
import { baseName } from '../utils';

export function MiniPlayer() {
  const {
    playback,
    currentTrack,
    coverArt,
    pauseTrack,
    resumeTrack,
    playNext,
    playPrev,
    setVolume,
    setMiniPlayerMode,
    toggleLoveTrack,
    toggleDislikeTrack
  } = useStore();

  const current = currentTrack;

  return (
    <div className="mini-player-container" data-tauri-drag-region>
      {/* Background Cover Blur */}
      <div 
        className="mini-player-blur-bg" 
        style={{ backgroundImage: `url(${coverArt || defaultCover})` }} 
      />

      <div className="mini-player-content" data-tauri-drag-region>
        {/* Cover Art Section */}
        <div className="mini-cover-wrapper">
          <img src={coverArt || defaultCover} alt="" className="mini-cover" />
          <button 
            className="mini-btn-restore" 
            onClick={() => setMiniPlayerMode(false)}
            title="Restore Player size"
          >
            <Maximize2 size={12} />
          </button>
        </div>

        {/* Info & Controls Section */}
        <div className="mini-right-panel" data-tauri-drag-region>
          <div className="mini-info" data-tauri-drag-region>
            <div className="mini-title" title={current?.title || baseName(playback.current_track)}>
              {current?.title || baseName(playback.current_track) || 'Not Playing'}
            </div>
            <div className="mini-artist" title={current?.artist || 'Unknown Artist'}>
              {current?.artist || 'Unknown Artist'}
            </div>
          </div>

          {/* Controls Row */}
          <div className="mini-controls">
            <button className="mini-btn" onClick={playPrev} title="Previous">
              <SkipBack size={14} fill="currentColor" />
            </button>
            <button 
              className="mini-btn play-pause" 
              onClick={playback.status === 'Playing' ? pauseTrack : resumeTrack}
              title={playback.status === 'Playing' ? 'Pause' : 'Play'}
            >
              {playback.status === 'Playing' ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" style={{ marginLeft: 2 }} />}
            </button>
            <button className="mini-btn" onClick={playNext} title="Next">
              <SkipForward size={14} fill="currentColor" />
            </button>
          </div>

          {/* Volume & Feedback Row */}
          <div className="mini-bottom-row" data-tauri-drag-region>
            {current && (
              <div className="mini-feedback">
                <button 
                  className={`mini-fb-btn ${current.loved === 1 ? 'loved' : ''}`}
                  onClick={() => toggleLoveTrack(current.path, current)}
                  title="Love track"
                >
                  <Heart size={11} fill={current.loved === 1 ? '#10b981' : 'transparent'} />
                </button>
                <button 
                  className={`mini-fb-btn ${current.disliked === 1 ? 'disliked' : ''}`}
                  onClick={() => toggleDislikeTrack(current.path, current)}
                  title="Dislike track"
                >
                  <ThumbsDown size={11} fill={current.disliked === 1 ? '#f43f5e' : 'transparent'} />
                </button>
              </div>
            )}
            <div className="mini-volume">
              <Volume2 size={11} color="var(--text-dim)" />
              <input 
                className="mini-vol-slider" 
                type="range" 
                min={0} 
                max={1} 
                step={0.05} 
                value={playback.volume} 
                onChange={e => setVolume(+e.target.value)} 
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
