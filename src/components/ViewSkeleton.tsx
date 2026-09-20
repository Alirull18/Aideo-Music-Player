interface ViewSkeletonProps {
  type?: 'albums' | 'charts' | 'settings' | 'generic';
}

export function ViewSkeleton({ type = 'generic' }: ViewSkeletonProps): React.JSX.Element {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        padding: '48px 56px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: 28,
        animation: 'skeleton-fade-in 0.2s ease-out'
      }}
      aria-busy="true"
      aria-label="Loading content..."
    >
      {/* Skeleton Header */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div
          style={{
            width: 240,
            height: 38,
            borderRadius: 8,
            background: 'var(--glass-h, rgba(255, 255, 255, 0.06))',
            animation: 'skeleton-pulse 1.5s ease-in-out infinite'
          }}
        />
        <div
          style={{
            width: 140,
            height: 16,
            borderRadius: 6,
            background: 'var(--glass, rgba(255, 255, 255, 0.03))',
            animation: 'skeleton-pulse 1.5s ease-in-out infinite 0.15s'
          }}
        />
      </div>

      {/* Content Skeleton based on view type */}
      {type === 'albums' ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 20,
            flex: 1,
            overflow: 'hidden'
          }}
        >
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                background: 'var(--glass, rgba(255, 255, 255, 0.03))',
                borderRadius: 14,
                padding: 12,
                border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.08))'
              }}
            >
              <div
                style={{
                  width: '100%',
                  paddingTop: '100%',
                  borderRadius: 10,
                  background: 'var(--glass-h, rgba(255, 255, 255, 0.06))',
                  animation: `skeleton-pulse 1.5s ease-in-out infinite ${(i % 6) * 0.1}s`
                }}
              />
              <div
                style={{
                  width: '75%',
                  height: 14,
                  borderRadius: 4,
                  background: 'var(--glass-h, rgba(255, 255, 255, 0.05))',
                  animation: `skeleton-pulse 1.5s ease-in-out infinite ${(i % 6) * 0.1 + 0.05}s`
                }}
              />
              <div
                style={{
                  width: '50%',
                  height: 12,
                  borderRadius: 4,
                  background: 'var(--glass, rgba(255, 255, 255, 0.03))',
                  animation: `skeleton-pulse 1.5s ease-in-out infinite ${(i % 6) * 0.1 + 0.1}s`
                }}
              />
            </div>
          ))}
        </div>
      ) : type === 'settings' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 720 }}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 12,
                background: 'var(--glass, rgba(255, 255, 255, 0.03))',
                borderRadius: 14,
                padding: 20,
                border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.08))'
              }}
            >
              <div
                style={{
                  width: 180,
                  height: 18,
                  borderRadius: 6,
                  background: 'var(--glass-h, rgba(255, 255, 255, 0.06))',
                  animation: `skeleton-pulse 1.5s ease-in-out infinite ${i * 0.1}s`
                }}
              />
              <div
                style={{
                  width: '90%',
                  height: 12,
                  borderRadius: 4,
                  background: 'var(--glass, rgba(255, 255, 255, 0.03))',
                  animation: `skeleton-pulse 1.5s ease-in-out infinite ${i * 0.1 + 0.05}s`
                }}
              />
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1 }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                padding: '12px 16px',
                borderRadius: 10,
                background: 'var(--glass, rgba(255, 255, 255, 0.03))',
                border: '1px solid var(--glass-border, rgba(255, 255, 255, 0.05))'
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 8,
                  background: 'var(--glass-h, rgba(255, 255, 255, 0.06))',
                  animation: `skeleton-pulse 1.5s ease-in-out infinite ${(i % 5) * 0.1}s`
                }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                <div
                  style={{
                    width: `${50 + (i % 4) * 10}%`,
                    height: 14,
                    borderRadius: 4,
                    background: 'var(--glass-h, rgba(255, 255, 255, 0.05))',
                    animation: `skeleton-pulse 1.5s ease-in-out infinite ${(i % 5) * 0.1 + 0.05}s`
                  }}
                />
                <div
                  style={{
                    width: `${30 + (i % 3) * 10}%`,
                    height: 12,
                    borderRadius: 4,
                    background: 'var(--glass, rgba(255, 255, 255, 0.03))',
                    animation: `skeleton-pulse 1.5s ease-in-out infinite ${(i % 5) * 0.1 + 0.1}s`
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
