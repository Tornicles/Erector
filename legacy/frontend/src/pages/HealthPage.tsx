import React from 'react';
import { HealthCheckCard } from '../components/HealthCheckCard';

interface Props {
  onBack: () => void;
}

export default function HealthPage({ onBack }: Props): React.ReactElement {
  return (
    <div
      data-testid="health-page"
      style={{
        minHeight: '100vh',
        padding: '5vw',
        background: 'var(--bg-primary)',
      }}
    >
      {/* Back */}
      <button
        data-testid="health-page-back-btn"
        onClick={onBack}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--text-secondary)',
          cursor: 'pointer',
          fontSize: '13px',
          padding: '0',
          marginBottom: '40px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          letterSpacing: '0.02em',
        }}
      >
        ← Back
      </button>

      <h2 style={{
        fontSize: '1.8rem',
        fontWeight: 700,
        color: 'var(--text-primary)',
        margin: '0 0 8px 0',
      }}>
        API Health
      </h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: '0 0 32px 0' }}>
        Live status of the Erector backend and database.
      </p>

      <HealthCheckCard />

      {/* Route reference */}
      <div style={{
        marginTop: '40px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '20px',
        maxWidth: '480px',
      }}>
        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '12px', letterSpacing: '0.08em', fontFamily: 'monospace' }}>
          A1 ENDPOINTS
        </div>
        {[
          ['GET', '/api/health'],
          ['POST', '/api/v1/auth/magic-link'],
          ['GET', '/api/v1/auth/verify'],
          ['POST', '/api/v1/auth/refresh'],
          ['POST', '/api/v1/auth/logout'],
          ['GET', '/api/v1/auth/me'],
        ].map(([method, path]) => (
          <div key={path} style={{ display: 'flex', gap: '12px', marginBottom: '8px', fontSize: '13px', fontFamily: 'monospace' }}>
            <span style={{ color: method === 'GET' ? '#22c55e' : '#3b82f6', minWidth: '40px' }}>{method}</span>
            <span style={{ color: 'var(--text-secondary)' }}>{path}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
