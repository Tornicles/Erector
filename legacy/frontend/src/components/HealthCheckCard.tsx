import React, { useEffect, useState } from 'react';
import { fetchHealth, HealthData } from '../services/api';

type Status = 'idle' | 'loading' | 'healthy' | 'degraded' | 'error';

export function HealthCheckCard(): React.ReactElement {
  const [status, setStatus] = useState<Status>('idle');
  const [data, setData] = useState<HealthData | null>(null);
  const [lastChecked, setLastChecked] = useState<string>('');

  const check = async () => {
    setStatus('loading');
    try {
      const resp = await fetchHealth();
      if (resp.success && resp.data) {
        setData(resp.data);
        setStatus(resp.data.status === 'healthy' ? 'healthy' : 'degraded');
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
    setLastChecked(new Date().toLocaleTimeString());
  };

  useEffect(() => { check(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const dot = status === 'healthy'
    ? { color: '#22c55e', label: 'Healthy' }
    : status === 'degraded'
    ? { color: '#eab308', label: 'Degraded' }
    : status === 'loading'
    ? { color: '#3b82f6', label: 'Checking...' }
    : { color: '#ef4444', label: 'Unreachable' };

  return (
    <div
      data-testid="health-check-card"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '24px',
        minWidth: '320px',
        maxWidth: '480px',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
        <div
          data-testid="health-status-dot"
          style={{
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: dot.color,
            boxShadow: `0 0 8px ${dot.color}88`,
          }}
        />
        <span style={{ fontSize: '13px', fontWeight: 600, color: dot.color, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
          {dot.label}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-secondary)' }}>
          API Health
        </span>
      </div>

      {/* Data rows */}
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {[
            ['Version', data.version],
            ['Environment', data.environment],
            ['Database', data.database.connected ? `Connected · ${data.database.name}` : 'Disconnected'],
            ['Mock Auth', data.mock_auth_enabled ? 'Enabled (dev)' : 'Supabase'],
          ].map(([label, value]) => (
            <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
              <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace' }}>{value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div style={{ marginTop: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {lastChecked && (
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
            Last checked: {lastChecked}
          </span>
        )}
        <button
          data-testid="health-refresh-btn"
          onClick={check}
          disabled={status === 'loading'}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--accent)',
            padding: '5px 14px',
            borderRadius: '6px',
            fontSize: '12px',
            cursor: status === 'loading' ? 'not-allowed' : 'pointer',
            opacity: status === 'loading' ? 0.5 : 1,
            transition: 'border-color 0.2s, color 0.2s',
            marginLeft: 'auto',
          }}
        >
          {status === 'loading' ? 'Checking...' : 'Refresh'}
        </button>
      </div>
    </div>
  );
}
