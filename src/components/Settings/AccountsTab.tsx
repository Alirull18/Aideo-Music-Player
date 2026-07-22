import React from 'react';
import { User, Radio, Sparkles } from 'lucide-react';
import { useStore } from '../../store';

export const AccountsTab: React.FC = () => {
  const {
    lastfmSessionKey,
    listenbrainzUsername
  } = useStore();


  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <User className="w-5 h-5 text-amber-400" /> Connected Services & Scrobblers
        </h3>
        <p className="text-xs text-white/60">Configure Last.fm, ListenBrainz, and Cloud Server pairings.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Last.fm Scrobbler */}
        <div className="bg-white/5 border border-white/10 p-4 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-white flex items-center gap-1.5">
              <Radio className="w-4 h-4 text-red-400" /> Last.fm Scrobbler
            </h4>
            <span
              className={`px-2 py-0.5 text-[10px] font-semibold border rounded-full ${
                lastfmSessionKey
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  : 'bg-white/10 text-white/60 border-white/10'
              }`}
            >
              {lastfmSessionKey ? 'Connected' : 'Not Paired'}
            </span>
          </div>
          <p className="text-xs text-white/60">Synchronize listening logs to your global Last.fm taste profile.</p>
        </div>

        {/* ListenBrainz Scrobbler */}
        <div className="bg-white/5 border border-white/10 p-4 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-white flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-amber-400" /> ListenBrainz
            </h4>
            <span
              className={`px-2 py-0.5 text-[10px] font-semibold border rounded-full ${
                listenbrainzUsername
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  : 'bg-white/10 text-white/60 border-white/10'
              }`}
            >
              {listenbrainzUsername ? listenbrainzUsername : 'Not Connected'}
            </span>
          </div>
          <p className="text-xs text-white/60">Open-source music telemetry analytics through MusicBrainz.</p>
        </div>
      </div>
    </div>
  );
};
