import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { useShallow } from 'zustand/react/shallow';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { Wand2, Plus, Trash2, X, Sparkles } from 'lucide-react';
import { Track } from '../store/types';

interface RuleRow {
  id: string;
  field: string;
  operator: string;
  value: string;
}

interface SmartPlaylistBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (id: number) => void;
}

export function SmartPlaylistBuilderModal({ isOpen, onClose, onCreated }: SmartPlaylistBuilderModalProps) {
  const { createSmartPlaylist, setView } = useStore(useShallow(s => ({
    createSmartPlaylist: s.createSmartPlaylist,
    setView: s.setView,
  })));

  const [name, setName] = useState('');
  const [matchAll, setMatchAll] = useState(true);
  const [rules, setRules] = useState<RuleRow[]>([
    { id: '1', field: 'artist', operator: 'contains', value: '' }
  ]);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const addRule = () => {
    setRules(prev => [
      ...prev,
      { id: Math.random().toString(36).substring(2, 9), field: 'title', operator: 'contains', value: '' }
    ]);
  };

  const removeRule = (id: string) => {
    if (rules.length <= 1) return;
    setRules(prev => prev.filter(r => r.id !== id));
  };

  const updateRule = (id: string, updates: Partial<RuleRow>) => {
    setRules(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
  };

  // Live preview matching track count
  useEffect(() => {
    if (!isOpen) return;
    const validRules = rules.filter(r => r.value.trim().length > 0);
    if (validRules.length === 0) {
      setPreviewCount(null);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setPreviewLoading(true);
        const rulesPayload = {
          match_all: matchAll,
          rules: validRules.map(r => ({
            field: r.field,
            operator: r.operator,
            value: r.value.trim()
          }))
        };
        const matched = await invoke<Track[]>('execute_smart_playlist', {
          rulesJson: JSON.stringify(rulesPayload)
        });
        setPreviewCount(matched.length);
      } catch (err) {
        console.error('Smart rule preview error:', err);
        setPreviewCount(null);
      } finally {
        setPreviewLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [rules, matchAll, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: 'Please provide a smart playlist name', type: 'warning' }
      }));
      return;
    }

    const validRules = rules.filter(r => r.value.trim().length > 0);
    if (validRules.length === 0) {
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: 'Please fill in at least one rule condition', type: 'warning' }
      }));
      return;
    }

    try {
      setSaving(true);
      const rulesPayload = {
        match_all: matchAll,
        rules: validRules.map(r => ({
          field: r.field,
          operator: r.operator,
          value: r.value.trim()
        }))
      };
      const id = await createSmartPlaylist(name.trim(), rulesPayload);
      const playlistId = id ?? Date.now();

      // Immediately execute and view
      const matched = await invoke<Track[]>('execute_smart_playlist', {
        rulesJson: JSON.stringify(rulesPayload)
      });
      useStore.setState({ 
        currentPlaylist: { id: -playlistId, name: `⚡ ${name.trim()}` }, 
        tracks: matched 
      });
      setView('library');

      onClose();
      if (onCreated && id !== undefined) onCreated(id);
    } catch (err: any) {
      window.dispatchEvent(new CustomEvent('ui-toast', {
        detail: { message: `Failed to create smart playlist: ${err}`, type: 'error' }
      }));
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.7)',
      backdropFilter: 'blur(12px)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16
    }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        style={{
          width: 520,
          maxWidth: '100%',
          maxHeight: '90vh',
          background: '#12121a',
          border: '1px solid var(--glass-border)',
          borderRadius: 20,
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.6)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '20px 24px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: 'linear-gradient(135deg, var(--accent) 0%, #a855f7 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(168, 85, 247, 0.3)'
            }}>
              <Wand2 size={18} color="#fff" />
            </div>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#fff' }}>
                Smart Playlist Rule Builder
              </h2>
              <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                Dynamic rule-based auto-updating playlist
              </span>
            </div>
          </div>
          <button 
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 4 }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{
          padding: '20px 24px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          overflowY: 'auto'
        }}>
          {/* Playlist Name Input */}
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
              Playlist Name
            </label>
            <input
              type="text"
              placeholder="e.g. 90s Lossless Rock, High-BPM Workout..."
              value={name}
              onChange={e => setName(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid var(--glass-border)',
                background: 'rgba(255, 255, 255, 0.04)',
                color: '#fff',
                fontSize: 13,
                outline: 'none'
              }}
              autoFocus
            />
          </div>

          {/* Match Logic Switcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Match:</span>
            <button
              type="button"
              onClick={() => setMatchAll(true)}
              style={{
                padding: '4px 12px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                background: matchAll ? 'var(--accent)' : 'rgba(255, 255, 255, 0.06)',
                color: matchAll ? '#fff' : 'var(--text-dim)',
                border: 'none'
              }}
            >
              ALL Conditions (AND)
            </button>
            <button
              type="button"
              onClick={() => setMatchAll(false)}
              style={{
                padding: '4px 12px',
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                background: !matchAll ? 'var(--accent)' : 'rgba(255, 255, 255, 0.06)',
                color: !matchAll ? '#fff' : 'var(--text-dim)',
                border: 'none'
              }}
            >
              ANY Condition (OR)
            </button>
          </div>

          {/* Condition Rows */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>
              Rules ({rules.length})
            </label>

            {rules.map((rule) => (
              <div key={rule.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'rgba(255, 255, 255, 0.02)',
                padding: 8,
                borderRadius: 10,
                border: '1px solid rgba(255, 255, 255, 0.04)'
              }}>
                {/* Field */}
                <select
                  value={rule.field}
                  onChange={e => updateRule(rule.id, { field: e.target.value })}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--glass-border)',
                    background: '#1a1a26',
                    color: '#fff',
                    fontSize: 12,
                    outline: 'none',
                    minWidth: 100
                  }}
                >
                  <option value="artist">Artist</option>
                  <option value="title">Title</option>
                  <option value="album">Album</option>
                  <option value="format">Format (FLAC, MP3...)</option>
                  <option value="loved">Loved (1 or 0)</option>
                  <option value="bpm">BPM</option>
                  <option value="duration">Duration (secs)</option>
                </select>

                {/* Operator */}
                <select
                  value={rule.operator}
                  onChange={e => updateRule(rule.id, { operator: e.target.value })}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--glass-border)',
                    background: '#1a1a26',
                    color: '#fff',
                    fontSize: 12,
                    outline: 'none',
                    minWidth: 110
                  }}
                >
                  <option value="contains">Contains</option>
                  <option value="equals">Equals</option>
                  <option value="greater_than">Greater than (&gt;)</option>
                  <option value="less_than">Less than (&lt;)</option>
                </select>

                {/* Value */}
                <input
                  type="text"
                  placeholder="Value..."
                  value={rule.value}
                  onChange={e => updateRule(rule.id, { value: e.target.value })}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--glass-border)',
                    background: 'rgba(255, 255, 255, 0.04)',
                    color: '#fff',
                    fontSize: 12,
                    outline: 'none'
                  }}
                />

                {/* Delete button */}
                <button
                  type="button"
                  onClick={() => removeRule(rule.id)}
                  disabled={rules.length <= 1}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: rules.length > 1 ? '#ef4444' : 'rgba(255,255,255,0.1)',
                    cursor: rules.length > 1 ? 'pointer' : 'default',
                    padding: 6
                  }}
                  title="Remove Rule"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={addRule}
              style={{
                alignSelf: 'flex-start',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 8,
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px dashed var(--glass-border)',
                color: 'var(--accent)',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              <Plus size={14} /> Add Condition
            </button>
          </div>

          {/* Live Preview Match Badge */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderRadius: 10,
            background: 'rgba(139, 92, 246, 0.08)',
            border: '1px solid rgba(139, 92, 246, 0.2)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-dim)' }}>
              <Sparkles size={16} style={{ color: 'var(--accent)' }} />
              <span>Matching tracks:</span>
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>
              {previewLoading ? 'Checking...' : previewCount !== null ? `${previewCount} tracks found` : 'Enter values to preview'}
            </span>
          </div>

          {/* Footer Actions */}
          <div style={{
            display: 'flex',
            gap: 12,
            marginTop: 8,
            paddingTop: 12,
            borderTop: '1px solid rgba(255, 255, 255, 0.06)'
          }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              style={{ flex: 1, padding: '10px 0', fontSize: 13 }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving}
              style={{
                flex: 1,
                padding: '10px 0',
                fontSize: 13,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8
              }}
            >
              <Wand2 size={16} />
              {saving ? 'Creating...' : 'Save & Execute'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
