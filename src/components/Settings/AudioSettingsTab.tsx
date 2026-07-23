import React from 'react';
import { Volume2, Laptop, RefreshCw } from 'lucide-react';
import { useStore } from '../../store';

export const AudioSettingsTab: React.FC = () => {
  const {
    playback,
    toggleExclusive,
    devices,
    currentDevice,
    setAudioDevice,
    fetchDevices
  } = useStore();


  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Volume2 className="w-5 h-5 text-purple-400" /> Output Device & Drivers
          </h3>
          <p className="text-xs text-white/60">Manage bit-perfect hardware access and device upsampling.</p>
        </div>
        <button
          onClick={() => fetchDevices()}
          className="px-3 py-1.5 text-xs bg-white/10 hover:bg-white/20 rounded-lg transition-all flex items-center gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh Devices
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Device selector */}
        <div className="bg-white/5 border border-white/10 p-4 rounded-xl space-y-3">
          <label className="text-xs font-semibold text-white/80 flex items-center gap-1.5">
            <Laptop className="w-4 h-4 text-purple-400" /> Selected Hardware Endpoint
          </label>
          <select
            value={currentDevice || '[System Default Device]'}
            onChange={(e) => setAudioDevice(e.target.value)}
            className="w-full bg-black/40 border border-white/15 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-400"
          >
            {devices.map((d) => (
              <option key={d} value={d}>
                {d === '[System Default Device]' ? 'System Default Device' : d}
              </option>
            ))}
          </select>
        </div>

        {/* Bit-Perfect & Exclusive Mode Toggle */}
        <div className="bg-white/5 border border-white/10 p-4 rounded-xl flex items-center justify-between">
          <div>
            <h4 className="text-sm font-medium text-white">WASAPI Exclusive Mode</h4>
            <p className="text-xs text-white/60">Bypass Windows Audio Mixer for direct bit-perfect transport.</p>
          </div>
          <input
            type="checkbox"
            checked={playback.exclusive || false}
            onChange={() => toggleExclusive()}
            className="toggle toggle-primary"
          />
        </div>
      </div>
    </div>
  );
};
