import React from 'react';

interface Props {
  onNavigateToHealth: () => void;
}

export default function WelcomePage({ onNavigateToHealth }: Props): React.ReactElement {
  return (
    <div
      data-testid="welcome-page"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '5vw',
        background: 'var(--bg-primary)',
      }}
    >
      {/* Badge */}
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        background: '#22c55e15',
        border: '1px solid #22c55e33',
        borderRadius: '20px',
        padding: '4px 12px',
        marginBottom: '32px',
      }}>
        <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#22c55e' }} />
        <span style={{ fontSize: '11px', color: '#22c55e', fontFamily: 'monospace', letterSpacing: '0.08em' }}>
          PROMPT A1 · SCAFFOLD
        </span>
      </div>

      {/* Heading */}
      <h1 style={{
        fontSize: 'clamp(2.5rem, 6vw, 5rem)',
        fontWeight: 800,
        color: 'var(--text-primary)',
        margin: '0 0 16px 0',
        letterSpacing: '-0.03em',
        lineHeight: 1.05,
      }}>
        Erector
      </h1>

      <p style={{
        fontSize: 'clamp(1rem, 2vw, 1.2rem)',
        color: 'var(--text-secondary)',
        maxWidth: '560px',
        lineHeight: 1.7,
        margin: '0 0 48px 0',
      }}>
        Reality Simulation, Validation &amp; Execution Intelligence Platform.
        Validate any business idea against 30 economies, 25 DNA dimensions, and 27 engines.
      </p>

      {/* CTA */}
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <button
          data-testid="view-health-btn"
          onClick={onNavigateToHealth}
          style={{
            background: '#22c55e',
            color: '#0a0f0d',
            border: 'none',
            borderRadius: '8px',
            padding: '12px 24px',
            fontSize: '14px',
            fontWeight: 700,
            cursor: 'pointer',
            letterSpacing: '0.02em',
            transition: 'background 0.2s, transform 0.1s',
          }}
          onMouseOver={e => (e.currentTarget.style.background = '#16a34a')}
          onMouseOut={e => (e.currentTarget.style.background = '#22c55e')}
        >
          View API Health
        </button>

        <a
          data-testid="api-docs-link"
          href="/api/docs"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            background: 'transparent',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '12px 24px',
            fontSize: '14px',
            fontWeight: 600,
            cursor: 'pointer',
            textDecoration: 'none',
            transition: 'border-color 0.2s, color 0.2s',
          }}
        >
          API Docs
        </a>
      </div>

      {/* Stat strip */}
      <div style={{
        marginTop: '64px',
        display: 'flex',
        gap: '40px',
        flexWrap: 'wrap',
      }}>
        {[
          ['30', 'Economy Types'],
          ['25', 'DNA Dimensions'],
          ['27', 'Engines'],
          ['46', 'Collections'],
        ].map(([num, label]) => (
          <div key={label}>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: '#22c55e', lineHeight: 1 }}>
              {num}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
