import { useId } from 'react';
import { motion } from 'framer-motion';
import { Download, X } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { DownloadProgress, UpdaterStatus } from '../store/updaterStore';

const RELEASES_URL = 'https://github.com/Alirull18/Aideo-Music-Player/releases/latest';
const MB = 1024 * 1024;

interface UpdatePopupProps {
  version: string;
  body?: string | null;
  status: UpdaterStatus;
  error: string | null;
  downloadProgress: DownloadProgress;
  onInstall: () => void;
  onDismiss: () => void;
}

function progressText({ percentage, downloadedBytes, totalBytes }: DownloadProgress): string {
  return totalBytes > 0
    ? `${percentage}% (${(downloadedBytes / MB).toFixed(1)} MB of ${(totalBytes / MB).toFixed(1)} MB)`
    : `${percentage}%`;
}

/**
 * Non-modal notice that a new version exists. It appears on its own, so it neither traps focus nor hides the page
 * from assistive technology; it is a labelled dialog, its failure message is announced, and progress is a progressbar.
 */
export default function UpdatePopup({ version, body, status, error, downloadProgress, onInstall, onDismiss }: UpdatePopupProps) {
  const titleId = useId();
  const versionId = useId();
  const detailId = useId();
  const downloading = status === 'downloading';

  return (
    <motion.div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={`${versionId} ${detailId}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onDismiss();
        }
      }}
      initial={{ opacity: 0, scale: 0.9, y: 20 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 20 }}
      style={{
        position: 'fixed',
        bottom: 24,
        right: 24,
        width: 340,
        background: 'var(--glass)',
        backdropFilter: 'blur(24px)',
        border: '1px solid var(--glass-border)',
        borderRadius: 16,
        padding: 24,
        boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
        zIndex: 10000,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ background: error ? '#ef4444' : 'var(--accent)', borderRadius: '50%', padding: 8, display: 'flex' }}>
            <Download size={18} color="white" aria-hidden="true" />
          </div>
          <div>
            <div id={titleId} style={{ fontSize: 15, fontWeight: 600 }}>{error ? 'Update Failed' : 'Update Available'}</div>
            <div id={versionId} style={{ fontSize: 12, color: 'var(--text-dim)' }}>Version {version}</div>
          </div>
        </div>
        <button
          type="button"
          className="modal-close"
          aria-label="Dismiss update notification"
          style={{ padding: 8, margin: -8, cursor: 'pointer' }}
          onClick={(e) => { e.stopPropagation(); onDismiss(); }}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {error ? (
        <div style={{ marginBottom: 20 }}>
          <div role="alert" style={{ fontSize: 13, color: '#f87171', marginBottom: 10, lineHeight: 1.4 }}>
            The automatic installation encountered an issue: {error}
          </div>
          <div id={detailId} style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.4 }}>
            You can retry, or download and install the update manually.
          </div>
        </div>
      ) : (
        <div id={detailId} style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 16, maxHeight: 60, overflowY: 'auto', lineHeight: 1.5 }}>
          {body || 'A new version of Aideo is ready to install.'}
        </div>
      )}

      {downloading && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6, color: 'var(--text-dim)' }}>
            <span>Downloading update...</span>
            <span style={{ fontWeight: 600, color: 'var(--text)' }}>{downloadProgress.percentage}%</span>
          </div>
          <div
            role="progressbar"
            aria-label="Downloading update"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={downloadProgress.percentage}
            aria-valuetext={progressText(downloadProgress)}
            style={{ height: 6, background: 'rgba(255,255,255,0.1)', borderRadius: 3, overflow: 'hidden' }}
          >
            <div
              style={{
                height: '100%',
                width: `${downloadProgress.percentage}%`,
                background: 'var(--accent)',
                transition: 'width 0.2s ease',
              }}
            />
          </div>
          {downloadProgress.totalBytes > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, textAlign: 'right' }} aria-hidden="true">
              {(downloadProgress.downloadedBytes / MB).toFixed(1)} MB / {(downloadProgress.totalBytes / MB).toFixed(1)} MB
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {!error && (
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%', padding: '10px 0', display: 'flex', justifyContent: 'center', gap: 8 }}
            disabled={downloading}
            onClick={onInstall}
          >
            {downloading ? (
              'Downloading & Installing...'
            ) : status === 'downloaded' ? (
              'Restarting Aideo...'
            ) : (
              <>
                <Download size={16} aria-hidden="true" />
                Install Update Now
              </>
            )}
          </button>
        )}

        <button
          type="button"
          className={error ? 'btn btn-primary' : 'btn btn-secondary'}
          style={{ width: '100%', padding: '10px 0', display: 'flex', justifyContent: 'center', gap: 8 }}
          onClick={() => {
            openUrl(RELEASES_URL).catch(() => window.open(RELEASES_URL, '_blank'));
          }}
        >
          <Download size={16} aria-hidden="true" />
          Download Manually from GitHub
        </button>

        {error && (
          <button type="button" className="btn btn-secondary" style={{ width: '100%', padding: '10px 0' }} onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>
    </motion.div>
  );
}
