import React, { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { invoke } from '@tauri-apps/api/core';
import {
  Link,
  Plus,
  Loader2,
  Search,
  Music,
  FileText,
  Languages,
  Lock,
  Trash2,
  Puzzle,
} from 'lucide-react';
import { useStore } from '../store';
import { FEATURED_ADDON_CATALOG, type AddonAuthSpec, type AddonInfo } from '../store/addonSlice';

type TidalDeviceAuthState =
  | { status: 'idle' }
  | { status: 'starting'; addonId: string }
  | {
      status: 'polling';
      addonId: string;
      origin: string;
      userCode: string;
      verificationUriComplete: string;
    }
  | { status: 'connected'; addonId: string; countryCode: string | null }
  | { status: 'error'; addonId: string; message: string };

interface SlidingSwitchProps {
  checked: boolean;
  disabled?: boolean;
  ariaLabel: string;
  onChange?: (checked: boolean) => void;
}

function SlidingSwitch({ checked, disabled = false, ariaLabel, onChange }: SlidingSwitchProps) {
  const handleToggle = () => {
    if (!disabled && onChange) {
      onChange(!checked);
    }
  };

  return (
    <div
      role="switch"
      aria-checked={checked}
      aria-disabled={disabled}
      aria-label={ariaLabel}
      tabIndex={disabled ? -1 : 0}
      onClick={handleToggle}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          handleToggle();
        }
      }}
      style={{
        width: 38,
        height: 22,
        borderRadius: 11,
        background: disabled
          ? (checked ? 'rgba(var(--accent-rgb, 139, 92, 246), 0.35)' : 'rgba(255, 255, 255, 0.08)')
          : (checked ? 'var(--accent, #8b5cf6)' : 'rgba(255, 255, 255, 0.12)'),
        border: '1px solid var(--glass-border)',
        padding: 2,
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        boxSizing: 'border-box',
        transition: 'background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
        boxShadow: (!disabled && checked) ? '0 0 10px rgba(var(--accent-rgb, 139, 92, 246), 0.3)' : 'none',
        opacity: disabled ? 0.65 : 1,
      }}
    >
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: '#ffffff',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
          transform: checked ? 'translateX(16px)' : 'translateX(0px)',
          transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      />
    </div>
  );
}

function ResourceBadge({ resource }: { resource: string }) {
  const res = resource.toLowerCase();
  let label = resource;
  let icon: React.ReactNode = null;
  let badgeStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 7px',
    borderRadius: 6,
    fontSize: 10,
    fontWeight: 600,
    background: 'rgba(255, 255, 255, 0.04)',
    color: 'var(--text-dim)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
  };

  if (res === 'search') {
    label = 'Search';
    icon = <Search size={10} />;
    badgeStyle = {
      ...badgeStyle,
      background: 'rgba(14, 165, 233, 0.1)',
      color: '#38bdf8',
      border: '1px solid rgba(14, 165, 233, 0.25)',
    };
  } else if (res === 'stream' || res === 'audio') {
    label = 'Stream';
    icon = <Music size={10} />;
    badgeStyle = {
      ...badgeStyle,
      background: 'rgba(139, 92, 246, 0.1)',
      color: 'var(--accent, #a78bfa)',
      border: '1px solid rgba(139, 92, 246, 0.25)',
    };
  } else if (res === 'lyrics') {
    label = 'Lyrics';
    icon = <FileText size={10} />;
    badgeStyle = {
      ...badgeStyle,
      background: 'rgba(16, 185, 129, 0.1)',
      color: '#34d399',
      border: '1px solid rgba(16, 185, 129, 0.25)',
    };
  } else if (res === 'translate' || res === 'translation') {
    label = 'Translation';
    icon = <Languages size={10} />;
    badgeStyle = {
      ...badgeStyle,
      background: 'rgba(245, 158, 11, 0.1)',
      color: '#fbbf24',
      border: '1px solid rgba(245, 158, 11, 0.25)',
    };
  }

  return (
    <span style={badgeStyle} data-testid={`resource-badge-${res}`}>
      {icon}
      <span>{label}</span>
    </span>
  );
}

export default function AddonsCard() {
  const { addons, addonBusy, loadAddons, installAddon, removeAddon, setAddonEnabled } = useStore(
    useShallow((s) => ({
      addons: s.addons,
      addonBusy: s.addonBusy,
      loadAddons: s.loadAddons,
      installAddon: s.installAddon,
      removeAddon: s.removeAddon,
      setAddonEnabled: s.setAddonEnabled,
    }))
  );
  const [url, setUrl] = useState('');
  const [tidalAuth, setTidalAuth] = useState<TidalDeviceAuthState>({ status: 'idle' });
  const [expandedCreds, setExpandedCreds] = useState<Record<string, boolean>>({});
  const [credInputs, setCredInputs] = useState<Record<string, Record<string, string>>>({});
  const [connectedMap, setConnectedMap] = useState<Record<string, boolean>>({});
  const [credErrorMap, setCredErrorMap] = useState<Record<string, string | null>>({});
  const [credBusyMap, setCredBusyMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void loadAddons();
  }, [loadAddons]);

  useEffect(() => {
    if (tidalAuth.status !== 'polling') return;
    const { addonId, origin } = tidalAuth;
    let cancelled = false;

    const timer = setInterval(async () => {
      try {
        const res = await fetch(`${origin}/auth/poll`, { method: 'POST' });
        if (cancelled) return;
        if (!res.ok) {
          setTidalAuth({
            status: 'error',
            addonId,
            message: 'Tidal authorization expired or failed',
          });
          return;
        }
        const data = (await res.json()) as {
          authenticated?: boolean;
          pending?: boolean;
          countryCode?: string | null;
        };
        if (cancelled) return;
        if (data.authenticated === true) {
          setTidalAuth({
            status: 'connected',
            addonId,
            countryCode: data.countryCode ?? null,
          });
          setConnectedMap((prev) => ({ ...prev, [addonId]: true }));
          window.dispatchEvent(
            new CustomEvent('ui-toast', {
              detail: { message: 'Tidal connected', type: 'success' },
            })
          );
        }
      } catch {
        if (!cancelled) {
          setTidalAuth({
            status: 'error',
            addonId,
            message: 'Tidal authorization expired or failed',
          });
        }
      }
    }, 2000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [tidalAuth]);

  const startTidalDeviceAuth = async (a: AddonInfo) => {
    const cleanOrigin = a.origin.replace(/\/+$/, '');
    setTidalAuth({ status: 'starting', addonId: a.id });
    try {
      const res = await fetch(`${cleanOrigin}/auth/device`, { method: 'POST' });
      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        if (res.status === 400) {
          setExpandedCreds((prev) => ({ ...prev, [a.id]: true }));
        }
        throw new Error(errData.error || 'Failed to start Tidal device login');
      }
      const data = (await res.json()) as {
        userCode: string;
        verificationUriComplete: string;
        interval?: number;
      };
      setTidalAuth({
        status: 'polling',
        addonId: a.id,
        origin: cleanOrigin,
        userCode: data.userCode,
        verificationUriComplete: data.verificationUriComplete,
      });
    } catch (e: any) {
      if (e instanceof TypeError) {
        try {
          const data = await invoke<{
            userCode?: string;
            verificationUriComplete?: string;
          } | null>('addon_auth_start_device', { addonId: a.id });
          if (data?.userCode && data?.verificationUriComplete) {
            setTidalAuth({
              status: 'polling',
              addonId: a.id,
              origin: cleanOrigin,
              userCode: data.userCode,
              verificationUriComplete: data.verificationUriComplete,
            });
            return;
          }
        } catch (ipcErr: any) {
          const msg = typeof ipcErr === 'string' ? ipcErr : ipcErr?.message;
          if (msg && msg.includes('Credentials')) {
            setExpandedCreds((prev) => ({ ...prev, [a.id]: true }));
          }
          setTidalAuth({
            status: 'error',
            addonId: a.id,
            message: msg || 'Failed to start Tidal device login',
          });
          return;
        }
      }
      setTidalAuth({
        status: 'error',
        addonId: a.id,
        message: e?.message || 'Failed to start Tidal device login',
      });
    }
  };

  const toggleCredForm = (addonId: string) => {
    setExpandedCreds((prev) => ({ ...prev, [addonId]: !prev[addonId] }));
    setCredErrorMap((prev) => ({ ...prev, [addonId]: null }));
  };

  const updateCredField = (addonId: string, key: string, value: string) => {
    setCredInputs((prev) => ({
      ...prev,
      [addonId]: { ...(prev[addonId] || {}), [key]: value },
    }));
  };

  const handleSaveCredentials = async (a: AddonInfo) => {
    const credentials = credInputs[a.id] || {};
    const cleanOrigin = a.origin ? a.origin.replace(/\/+$/, '') : '';
    setCredBusyMap((prev) => ({ ...prev, [a.id]: true }));
    setCredErrorMap((prev) => ({ ...prev, [a.id]: null }));
    try {
      if (cleanOrigin && /^https?:\/\//i.test(cleanOrigin)) {
        try {
          const res = await fetch(`${cleanOrigin}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credentials }),
          });
          const data = (await res.json().catch(() => ({}))) as { authenticated?: boolean; error?: string };
          if (!res.ok || data.authenticated === false) {
            throw new Error(data.error || `Failed to authenticate ${a.name}`);
          }
        } catch (fetchErr: any) {
          if (fetchErr instanceof TypeError) {
            const data = await invoke<{ authenticated?: boolean; error?: string } | null>('addon_auth_login', {
              addonId: a.id,
              credentials,
            });
            if (data && data.authenticated === false) {
              throw new Error(data.error || `Failed to authenticate ${a.name}`);
            }
          } else {
            throw fetchErr;
          }
        }
      } else {
        await invoke('addon_auth_login', { addonId: a.id, credentials });
      }
      setConnectedMap((prev) => ({ ...prev, [a.id]: true }));
      setExpandedCreds((prev) => ({ ...prev, [a.id]: false }));
      window.dispatchEvent(
        new CustomEvent('ui-toast', {
          detail: { message: `${a.name} connected`, type: 'success' },
        })
      );
    } catch (e: any) {
      setCredErrorMap((prev) => ({
        ...prev,
        [a.id]: e?.message || `Failed to authenticate ${a.name}`,
      }));
    } finally {
      setCredBusyMap((prev) => ({ ...prev, [a.id]: false }));
    }
  };

  const handleDisconnect = async (a: AddonInfo) => {
    const cleanOrigin = a.origin ? a.origin.replace(/\/+$/, '') : '';
    try {
      if (cleanOrigin && /^https?:\/\//i.test(cleanOrigin)) {
        await fetch(`${cleanOrigin}/auth/logout`, { method: 'POST' });
      } else {
        await invoke('addon_auth_logout', { addonId: a.id });
      }
    } catch {
      // Ignore logout network error
    }
    setConnectedMap((prev) => ({ ...prev, [a.id]: false }));
    if (tidalAuth.status !== 'idle' && tidalAuth.addonId === a.id) {
      setTidalAuth({ status: 'idle' });
    }
  };

  const handleInstallCatalogItem = async (manifestUrl: string) => {
    if (addonBusy) return;
    await installAddon(manifestUrl);
  };

  const submit = async () => {
    const value = url.trim();
    if (!value || addonBusy) return;
    await installAddon(value);
    setUrl('');
  };

  const isCore = (a: AddonInfo) => Boolean(a.builtin || a.origin === 'internal');
  const isTidalAddon = (a: AddonInfo) =>
    !isCore(a) && (a.id === 'org.aideo.tidal' || a.id.endsWith('.tidal') || a.name.trim().toLowerCase() === 'tidal');

  const getEffectiveAuth = (a: AddonInfo): AddonAuthSpec | null => {
    if (isCore(a)) return null;
    if (a.auth) return a.auth;
    if (isTidalAddon(a)) return { type: 'device_code', label: 'Connect Tidal' };
    return null;
  };

  const coreAddons = addons.filter(isCore);
  const externalAddons = addons.filter((a) => !isCore(a));
  const installedIds = new Set(addons.map((a) => a.id.toLowerCase()));
  const uninstalledFeatured = FEATURED_ADDON_CATALOG.filter(
    (item) => !installedIds.has(item.id.toLowerCase())
  );

  const renderAddonCard = (a: AddonInfo) => {
    const core = isCore(a);
    const isEnabled = a.enabled !== false;
    const isTidal = isTidalAddon(a);
    const authSpec = getEffectiveAuth(a);
    const isDeviceCode = authSpec?.type === 'device_code';
    const isCredsOrToken = authSpec?.type === 'credentials' || authSpec?.type === 'token';
    const isThisDeviceAuth = isDeviceCode && tidalAuth.status !== 'idle' && tidalAuth.addonId === a.id;
    const isCredExpanded = Boolean(expandedCreds[a.id]);
    const isConnected = Boolean(connectedMap[a.id]) || (isThisDeviceAuth && tidalAuth.status === 'connected');
    const credError = credErrorMap[a.id];
    const credBusy = Boolean(credBusyMap[a.id]);

    return (
      <div
        key={a.id}
        className="addon-card-item"
        data-testid={`addon-card-${a.id}`}
        style={{
          background: 'var(--glass)',
          border: '1px solid var(--glass-border)',
          borderRadius: 12,
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          transition: 'background-color 0.2s ease, border-color 0.2s ease',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                {a.name}
              </span>
              <span
                style={{
                  background: 'rgba(255, 255, 255, 0.06)',
                  borderRadius: 9999,
                  padding: '1px 7px',
                  fontSize: 10,
                  fontWeight: 500,
                  color: 'var(--text-dim)',
                  whiteSpace: 'nowrap',
                }}
              >
                v{a.version}
              </span>
              {core ? (
                <span
                  title="Core sources cannot be disabled"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 8px',
                    borderRadius: 6,
                    fontSize: 10,
                    fontWeight: 600,
                    background: 'rgba(255, 255, 255, 0.08)',
                    color: 'var(--text-dim)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                  }}
                >
                  <Lock size={12} />
                  <span>Core Source</span>
                </span>
              ) : (
                <span
                  title={a.origin}
                  style={{
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.06)',
                    borderRadius: 6,
                    padding: '1px 6px',
                    fontSize: 10,
                    color: 'var(--text-dim)',
                    maxWidth: 200,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {a.origin}
                </span>
              )}
            </div>

            {a.description && (
              <div className="addons-row-meta" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                {a.description}
              </div>
            )}

            {a.resources && a.resources.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {a.resources.map((res) => (
                  <ResourceBadge key={res} resource={res} />
                ))}
              </div>
            )}

            {isThisDeviceAuth && tidalAuth.status === 'polling' && (
              <div
                style={{
                  marginTop: 4,
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: 'rgba(14, 165, 233, 0.08)',
                  border: '1px solid rgba(14, 165, 233, 0.25)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                  fontSize: 11,
                }}
              >
                <span style={{ color: 'var(--text-dim)' }}>Pair code:</span>
                <code
                  data-testid="tidal-user-code"
                  style={{
                    fontWeight: 700,
                    color: '#38bdf8',
                    background: 'rgba(0, 0, 0, 0.25)',
                    padding: '2px 6px',
                    borderRadius: 4,
                  }}
                >
                  {tidalAuth.userCode}
                </code>
                <a
                  href={tidalAuth.verificationUriComplete}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: '#38bdf8',
                    fontWeight: 600,
                    textDecoration: 'underline',
                  }}
                >
                  Open Tidal Link
                </a>
                <button
                  type="button"
                  aria-label="Cancel Tidal login"
                  className="settings-btn"
                  onClick={() => setTidalAuth({ status: 'idle' })}
                  style={{
                    padding: '2px 8px',
                    fontSize: 10,
                  }}
                >
                  Cancel
                </button>
              </div>
            )}

            {isThisDeviceAuth && tidalAuth.status === 'error' && (
              <div
                role="alert"
                style={{
                  marginTop: 4,
                  padding: '6px 10px',
                  borderRadius: 8,
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  color: '#f87171',
                  fontSize: 11,
                }}
              >
                {tidalAuth.message}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            {core ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-dim)', opacity: 0.75 }}>
                  Core sources cannot be disabled
                </span>
                <SlidingSwitch
                  checked={isEnabled}
                  disabled={true}
                  ariaLabel={`Enable ${a.name}`}
                />
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {isDeviceCode && (
                  <>
                    {isThisDeviceAuth && tidalAuth.status === 'connected' ? (
                      <>
                        <span
                          style={{
                            padding: '4px 8px',
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 600,
                            background: 'rgba(16, 185, 129, 0.12)',
                            color: '#34d399',
                            border: '1px solid rgba(16, 185, 129, 0.28)',
                          }}
                        >
                          {tidalAuth.countryCode
                            ? `Connected (${tidalAuth.countryCode})`
                            : 'Connected'}
                        </span>
                        <button
                          type="button"
                          className="settings-btn"
                          aria-label={isTidal ? 'Reconnect Tidal' : `Reconnect ${a.name}`}
                          onClick={() => void startTidalDeviceAuth(a)}
                          style={{
                            padding: '6px 12px',
                            fontSize: 11,
                          }}
                        >
                          {isTidal ? 'Reconnect Tidal' : `Reconnect ${a.name}`}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="settings-btn"
                        aria-label={isTidal ? 'Connect Tidal' : (authSpec?.label || `Connect ${a.name}`)}
                        disabled={tidalAuth.status === 'starting'}
                        onClick={() => void startTidalDeviceAuth(a)}
                        style={{
                          padding: '6px 12px',
                          fontSize: 11,
                        }}
                      >
                        {tidalAuth.status === 'starting' && tidalAuth.addonId === a.id
                          ? 'Connecting…'
                          : tidalAuth.status === 'polling' && tidalAuth.addonId === a.id
                            ? 'Restart Pair'
                            : isTidal
                              ? 'Connect Tidal'
                              : (authSpec?.label || `Connect ${a.name}`)}
                      </button>
                    )}
                    {authSpec?.fields && authSpec.fields.length > 0 && (
                      <button
                        type="button"
                        className="settings-btn addons-auth-btn"
                        onClick={() => toggleCredForm(a.id)}
                        style={{ padding: '6px 10px', fontSize: 11 }}
                      >
                        {connectedMap[a.id] ? `${a.name} Connected` : 'Use Credentials / Token'}
                      </button>
                    )}
                  </>
                )}

                {isCredsOrToken && (
                  <button
                    type="button"
                    className="settings-btn addons-auth-btn"
                    onClick={() => toggleCredForm(a.id)}
                    style={{
                      padding: '6px 12px',
                      fontSize: 11,
                      ...(isConnected
                        ? {
                            background: 'rgba(16, 185, 129, 0.12)',
                            color: '#34d399',
                            border: '1px solid rgba(16, 185, 129, 0.28)',
                          }
                        : {}),
                    }}
                  >
                    {isConnected ? `${a.name} Connected` : (authSpec?.label || `Configure ${a.name}`)}
                  </button>
                )}

                <SlidingSwitch
                  checked={isEnabled}
                  disabled={false}
                  ariaLabel={`Enable ${a.name}`}
                  onChange={(nextChecked) => void setAddonEnabled(a.id, nextChecked)}
                />
                <button
                  type="button"
                  className="settings-btn settings-btn-danger"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => void removeAddon(a.id)}
                  style={{
                    padding: '6px 12px',
                    fontSize: 11,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Trash2 size={14} />
                  <span>Remove</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Expandable Credentials / Token Form */}
        {!core && isCredExpanded && authSpec && (
          <form
            className="addons-cred-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSaveCredentials(a);
            }}
            style={{
              marginTop: 4,
              padding: '12px 14px',
              borderRadius: 10,
              background: 'rgba(0, 0, 0, 0.2)',
              border: '1px solid var(--glass-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {authSpec.helpText && (
              <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{authSpec.helpText}</div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              {(authSpec.fields ?? []).map((field) => (
                <label
                  key={field.key}
                  style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--text-dim)' }}
                >
                  <span>{field.label}</span>
                  <input
                    aria-label={field.label}
                    type={field.type || 'text'}
                    placeholder={field.placeholder || ''}
                    required={Boolean(field.required)}
                    value={credInputs[a.id]?.[field.key] ?? ''}
                    onChange={(e) => updateCredField(a.id, field.key, e.target.value)}
                    style={{
                      padding: '6px 10px',
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid var(--glass-border)',
                      borderRadius: 8,
                      color: 'var(--text)',
                      fontSize: 12,
                      outline: 'none',
                    }}
                  />
                </label>
              ))}
            </div>
            {credError && (
              <div
                role="alert"
                style={{
                  padding: '6px 10px',
                  borderRadius: 8,
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.25)',
                  color: '#f87171',
                  fontSize: 11,
                }}
              >
                {credError}
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
              {isConnected && (
                <button
                  type="button"
                  className="settings-btn settings-btn-danger"
                  aria-label={`Disconnect ${a.name}`}
                  onClick={() => void handleDisconnect(a)}
                  style={{ padding: '6px 12px', fontSize: 11 }}
                >
                  Disconnect
                </button>
              )}
              <button
                type="submit"
                className="settings-btn"
                aria-label={`Save ${a.name} credentials`}
                disabled={credBusy}
                style={{ padding: '6px 14px', fontSize: 11 }}
              >
                {credBusy ? 'Saving…' : 'Save & Connect'}
              </button>
            </div>
          </form>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* Manifest URL Input Row */}
      <div style={{ marginBottom: 16 }}>
        <label
          htmlFor="addon-manifest-url"
          className="settings-ctrl-title"
          style={{ display: 'block', marginBottom: 8 }}
        >
          Addon manifest URL
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center' }}>
            <Link
              size={15}
              style={{
                position: 'absolute',
                left: 12,
                color: 'var(--text-dim)',
                pointerEvents: 'none',
                opacity: 0.8,
              }}
            />
            <input
              id="addon-manifest-url"
              type="url"
              value={url}
              placeholder="https://example.com/manifest.json"
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              disabled={addonBusy}
              style={{
                width: '100%',
                padding: '8px 12px 8px 36px',
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid var(--glass-border)',
                borderRadius: 10,
                color: 'var(--text)',
                fontSize: 12,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <button
            type="button"
            className="settings-btn"
            disabled={addonBusy || !url.trim()}
            onClick={() => void submit()}
            style={{
              padding: '8px 16px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              minWidth: 84,
              justifyContent: 'center',
            }}
          >
            {addonBusy ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Installing…</span>
              </>
            ) : (
              <>
                <Plus size={14} />
                <span>Install</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Featured Addons Catalog */}
      {uninstalledFeatured.length > 0 && (
        <div className="addons-catalog-section" style={{ marginTop: 20 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 10,
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--text)',
                letterSpacing: '-0.2px',
              }}
            >
              Featured Addons
            </span>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              1-click local sidecar catalog
            </span>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 8,
            }}
          >
            {uninstalledFeatured.map((item) => (
              <div
                key={item.id}
                className="addons-catalog-item"
                style={{
                  background: 'var(--glass)',
                  border: '1px solid var(--glass-border)',
                  borderRadius: 12,
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text)' }}>
                      {item.name}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        padding: '1px 6px',
                        borderRadius: 6,
                        background: 'rgba(255, 255, 255, 0.06)',
                        color: 'var(--text-dim)',
                      }}
                    >
                      {item.resources.join(', ')}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.35 }}>
                    {item.description}
                  </div>
                </div>
                <button
                  type="button"
                  className="settings-btn addons-catalog-install-btn"
                  aria-label={`Install ${item.name}`}
                  disabled={addonBusy}
                  onClick={() => void handleInstallCatalogItem(item.manifestUrl)}
                  style={{
                    padding: '6px 12px',
                    fontSize: 11,
                    flexShrink: 0,
                  }}
                >
                  Install
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Core Sources Section */}
      {coreAddons.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'var(--text)',
                  letterSpacing: '-0.2px',
                }}
              >
                Core Sources
              </span>
              <span
                style={{
                  fontSize: 10,
                  padding: '2px 7px',
                  borderRadius: 9999,
                  background: 'rgba(255, 255, 255, 0.06)',
                  color: 'var(--text-dim)',
                  fontWeight: 600,
                }}
              >
                {coreAddons.length}
              </span>
            </div>
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-dim)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Lock size={11} /> Essential built-in sources
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {coreAddons.map(renderAddonCard)}
          </div>
        </div>
      )}

      {/* Installed Addons Section */}
      <div style={{ marginTop: 22 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--text)',
                letterSpacing: '-0.2px',
              }}
            >
              Installed Addons
            </span>
            {externalAddons.length > 0 && (
              <span
                style={{
                  fontSize: 10,
                  padding: '2px 7px',
                  borderRadius: 9999,
                  background: 'rgba(var(--accent-rgb, 139, 92, 246), 0.15)',
                  color: 'var(--accent, #8b5cf6)',
                  fontWeight: 600,
                }}
              >
                {externalAddons.length}
              </span>
            )}
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            Third-party extensions
          </span>
        </div>

        {externalAddons.length === 0 ? (
          <div
            className="addon-empty-state"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '28px 20px',
              background: 'var(--glass)',
              border: '1px dashed var(--glass-border)',
              borderRadius: 12,
              textAlign: 'center',
              gap: 6,
            }}
          >
            <Puzzle size={24} style={{ color: 'var(--text-dim)', opacity: 0.5, marginBottom: 2 }} />
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)' }}>
              No external addons installed
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', opacity: 0.7 }}>
              Enter a manifest URL above to install custom music providers
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {externalAddons.map(renderAddonCard)}
          </div>
        )}
      </div>
    </div>
  );
}
