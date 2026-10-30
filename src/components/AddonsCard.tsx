import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../store';

export default function AddonsCard() {
  const { addons, addonBusy, loadAddons, installAddon, removeAddon, setAddonEnabled } = useStore(useShallow(s => ({
    addons: s.addons, addonBusy: s.addonBusy, loadAddons: s.loadAddons, installAddon: s.installAddon, removeAddon: s.removeAddon,
    setAddonEnabled: s.setAddonEnabled,
  })));
  const [url, setUrl] = useState('');

  useEffect(() => { void loadAddons(); }, [loadAddons]);

  const submit = async () => {
    const value = url.trim();
    if (!value) return;
    await installAddon(value);
    setUrl('');
  };

  return (
    <div>
      <label htmlFor="addon-manifest-url" className="settings-ctrl-title">Addon manifest URL</label>
      <div style={{ display: 'flex', gap: 8, margin: '8px 0 12px' }}>
        <input
          id="addon-manifest-url"
          type="url"
          value={url}
          placeholder="https://example.com/manifest.json"
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') void submit(); }}
          style={{ flex: 1 }}
        />
        <button type="button" className="settings-btn" disabled={addonBusy || !url.trim()} onClick={() => void submit()}>
          {addonBusy ? 'Installing…' : 'Install'}
        </button>
      </div>
      {addons.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>No addons installed.</div>}
      {addons.map(a => (
        <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div>{a.name} <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>v{a.version}</span></div>
            <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>{a.origin}</div>
          </div>
          <label style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              type="checkbox"
              aria-label={`Enable ${a.name}`}
              checked={a.enabled !== false}
              disabled={a.builtin}
              onChange={e => void setAddonEnabled(a.id, e.target.checked)}
            />
            Enabled
          </label>
          {!a.builtin && (
            <button type="button" className="settings-btn" aria-label={`Remove ${a.name}`} onClick={() => void removeAddon(a.id)}>Remove</button>
          )}
        </div>
      ))}
    </div>
  );
}
