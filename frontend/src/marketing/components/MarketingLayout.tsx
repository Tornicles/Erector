import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import {
  MARKETING_FINEPRINT,
  MARKETING_FOOTER,
  MARKETING_NAV,
  MARKETING_TAGLINE,
} from '../content/site';
import '../styles/marketing.css';

/**
 * Public marketing shell: one nav (Product | Create | Solutions | Discover |
 * Resources | Pricing), Sign In + Start Creating actions, shared footer.
 * Scoped under `.tmk`; never wraps authenticated app screens.
 */
export function MarketingLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { session } = useAuth();
  return (
    <div className="tmk">
      <a className="skip" href="#tmk-main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="shell header-row">
          <Link className="logo" to="/" aria-label="TONDE home">
            TONDE<span>●</span>
          </Link>
          <nav aria-label="Primary" className="site-nav">
            {MARKETING_NAV.map((item) => (
              <Link key={item.to} to={item.to}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="header-actions">
            <Link to="/login">Sign in</Link>
            <Link className="cta" to={session ? '/home' : '/signup'}>
              Start creating
            </Link>
          </div>
          <button
            className="menu-btn"
            aria-expanded={open}
            aria-controls="tmk-mobile-nav"
            onClick={() => setOpen((value) => !value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false);
            }}
          >
            Menu
          </button>
        </div>
        <nav
          id="tmk-mobile-nav"
          className={`mobile-nav${open ? ' open' : ''}`}
          aria-label="Mobile"
        >
          {MARKETING_NAV.map((item) => (
            <Link key={item.to} to={item.to} onClick={() => setOpen(false)}>
              {item.label}
            </Link>
          ))}
          <Link to="/login" onClick={() => setOpen(false)}>
            Sign in
          </Link>
          <Link
            to={session ? '/home' : '/signup'}
            onClick={() => setOpen(false)}
          >
            Start creating
          </Link>
        </nav>
      </header>
      <main id="tmk-main">{children}</main>
      <footer className="site-footer">
        <div className="shell footer-cols">
          <div>
            <Link to="/" className="logo">
              TONDE<span>●</span>
            </Link>
            <p>{MARKETING_TAGLINE}</p>
          </div>
          {MARKETING_FOOTER.map((column) => (
            <div key={column.heading}>
              <h2>{column.heading}</h2>
              {column.links.map((item) => (
                <Link key={item.to} to={item.to}>
                  {item.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
        <div className="shell fineprint">{MARKETING_FINEPRINT}</div>
      </footer>
    </div>
  );
}
