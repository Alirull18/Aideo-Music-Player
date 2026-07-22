import React from 'react';
import { Puzzle, DownloadCloud } from 'lucide-react';

export const PluginsTab: React.FC = () => {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Puzzle className="w-5 h-5 text-emerald-400" /> External Engine Plugins
        </h3>
        <p className="text-xs text-white/60">
          Manage dynamic audio decoders and stream extractors (`yt-dlp` and `ffmpeg`).
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* yt-dlp binary status */}
        <div className="bg-white/5 border border-white/10 p-4 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-white">yt-dlp Stream Extractor</h4>
            <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full">
              Active / Ready
            </span>
          </div>
          <p className="text-xs text-white/60">Extracts YouTube & web media stream URLs directly.</p>
          <button
            onClick={() => {}}
            className="w-full py-2 bg-white/10 hover:bg-white/20 text-xs rounded-lg transition-all flex items-center justify-center gap-1.5 text-white"
          >
            <DownloadCloud className="w-4 h-4" /> Update yt-dlp Binary
          </button>
        </div>

        {/* ffmpeg decoder status */}
        <div className="bg-white/5 border border-white/10 p-4 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-white">ffmpeg Transcoder</h4>
            <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full">
              Installed
            </span>
          </div>
          <p className="text-xs text-white/60">Enables high-fidelity format conversion and stream playback.</p>
          <button
            onClick={() => {}}
            className="w-full py-2 bg-white/10 hover:bg-white/20 text-xs rounded-lg transition-all flex items-center justify-center gap-1.5 text-white"
          >
            <DownloadCloud className="w-4 h-4" /> Check ffmpeg Installation
          </button>
        </div>
      </div>
    </div>
  );
};
