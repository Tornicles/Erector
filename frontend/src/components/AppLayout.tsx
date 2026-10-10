import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Home, Clapperboard, Folder, Compass, Layers, Camera, Settings, Menu, X, LogOut, User, Users, HelpCircle, Search, Bell, ArrowUpRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useModalFocus } from '../hooks/useModalFocus';
import { authService } from '../services/auth';
import { safeError } from '../services/errors';
import { productionService } from '../services/productions';
import type { Production } from '../types/domain';

// Canonical v5 navigation: Home, Studio, Projects, Discover, Assets, Production Kit, Settings.
// Studio opens the workspace selector (/studio); Production Kit keeps the legacy /setup route.
export const destinations = [
  { path: '/home', title: 'Home', icon: Home },
  { path: '/studio', title: 'Studio', icon: Clapperboard },
  { path: '/projects', title: 'Projects', icon: Folder },
  { path: '/discover', title: 'Discover', icon: Compass },
  { path: '/assets', title: 'Assets', icon: Layers },
  { path: '/setup', title: 'Production Kit', icon: Camera },
  { path: '/settings', title: 'Settings', icon: Settings },
];

export function AppLayout() {
  const auth = useAuth();
  const { session, workspaceId } = auth;
  const { localPreview } = auth;

  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [productionResults, setProductionResults] = useState<Production[]>([]);
  const [productionSearchError, setProductionSearchError] = useState<string | null>(null);
  const [searchingProductions, setSearchingProductions] = useState(false);
  const [appearance] = useState(() => {
    const value = localStorage.getItem('tonde:appearance');
    return value === 'light' || value === 'system' ? value : 'dark';
  });
  const [reducedMotion] = useState(() => localStorage.getItem('tonde:reduced-motion') === 'true');
  const commandRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const notificationTrigger = useRef<HTMLButtonElement>(null);
  const notificationDialogRef = useRef<HTMLElement>(null);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [searchRestoreTarget, setSearchRestoreTarget] = useState<HTMLElement | null>(null);
  const [notificationRestoreTarget, setNotificationRestoreTarget] = useState<HTMLElement | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    document.documentElement.dataset.appearance = appearance;
    document.documentElement.dataset.reducedMotion = String(reducedMotion);
  }, [appearance, reducedMotion]);
  useEffect(() => {
    const term = query.trim();
    if (!commandOpen || term.length < 2 || !workspaceId) {
      setProductionResults([]);
      setProductionSearchError(null);
      setSearchingProductions(false);
      return;
    }
    let active = true;
    setSearchingProductions(true);
    setProductionResults([]);
    setProductionSearchError(null);
    const timer = window.setTimeout(() => {
      productionService.list(workspaceId, 0, { search: term }).then(items => {
        if (active) setProductionResults(items.slice(0, 8));
      }).catch(failure => {
        if (active) { setProductionResults([]); setProductionSearchError(safeError(failure).message); }
      }).finally(() => { if (active) setSearchingProductions(false); });
    }, 150);
    return () => { active = false; window.clearTimeout(timer); };
  }, [commandOpen, query, workspaceId]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (commandOpen) setCommandOpen(false);
        else { setSearchRestoreTarget(document.activeElement as HTMLElement); setCommandOpen(true); }
      }
      if (event.key === 'Escape') { setOpen(false); setCommandOpen(false); setNotificationsOpen(false); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [commandOpen]);
  useModalFocus(commandOpen, searchRestoreTarget, dialogRef, '#command-search');
  useModalFocus(notificationsOpen, notificationRestoreTarget, notificationDialogRef);

  const commands = [
    { label: 'Go to Home', detail: 'Start or continue production', path: '/home' },
    { label: 'Open Studio', detail: 'Choose a Production to open', path: '/studio' },
    { label: 'Go to Projects', detail: 'Find or manage Productions', path: '/projects' },
    { label: 'Go to Discover', detail: 'Production knowledge and references', path: '/discover' },
    { label: 'Go to Assets', detail: 'Reusable production entities', path: '/assets' },
    { label: 'Open Production Kit', detail: 'Cameras, software and tools', path: '/setup' },
    { label: 'Open Team', detail: 'Members and invite links', path: '/team' },
    { label: 'Open Jobs', detail: 'Durable processing status', path: '/jobs' },
    { label: 'Open Settings', detail: 'Application and account preferences', path: '/settings' },
  ].filter(command => `${command.label} ${command.detail}`.toLowerCase().includes(query.toLowerCase()));
  const go = (path: string) => { setCommandOpen(false); setQuery(''); navigate(path); };
  const title = [...destinations, { path: '/team', title: 'Team' }].find(d => location.pathname.startsWith(d.path))?.title ?? 'TONDE';
  useEffect(() => { document.title = `${title} · TONDE`; }, [title]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">Skip to main content</a>
      <header className="mobile-bar">
        <span className="wordmark">TONDE<span>®</span></span>
        <button aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} aria-controls="app-navigation" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
      </header>
      <aside className={`sidebar ${open ? 'is-open' : ''}`} aria-label="Production workspace">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">T</div>
          <div><div className="brand-word">TONDE</div><div className="brand-sub">Your AI Production Director</div></div>
        </div>
        <p className="sidebar-label">{localPreview ? 'TONDE — LOCAL DEVELOPMENT PREVIEW' : 'PRODUCTION WORKSPACE'}</p>
        <nav id="app-navigation" aria-label="Main navigation" className="nav">
          {destinations.map(({ path, title: label, icon: Icon }) => (
            <NavLink key={path} to={path} title={label} aria-label={label} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <Icon size={16} aria-hidden="true" /><span>{label}</span>
              {label === 'Studio' && <span className="count">LIVE</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="side-card">
          <strong><span className="side-dot" aria-hidden="true" />Director online</strong>
          <p>One Master Production. Real, AI and hybrid execution stay connected.</p>
        </div>
        <div className="sidebar-bottom">
          <div className="workspace-mark">
            <span className="status-dot" />
            {localPreview ? 'Local preview — no live project' : 'Personal workspace'}
            <NavLink to="/team" title="Team" aria-label="Team"><Users size={15} aria-hidden="true" /><span>Team</span></NavLink>
          </div>
          {localPreview ? (
            <div className="profile-menu">
              <span className="avatar">{session?.user.email?.slice(0, 1).toUpperCase() ?? 'L'}</span>
              <span>Local preview</span>
            </div>
          ) : (
            <details className="profile-menu">
              <summary><span className="avatar">{session?.user.email?.slice(0, 1).toUpperCase() ?? 'T'}</span><span>My account</span></summary>
              <NavLink to="/account"><User size={15} /> Account / profile</NavLink>
              <NavLink to="/help"><HelpCircle size={15} /> Help / support</NavLink>
              <button onClick={() => { void authService.signOut().catch(e => setError(safeError(e).message)); }}><LogOut size={15} /> Log out</button>
            </details>
          )}
          {error && <p role="alert" className="error-text">{error}</p>}
        </div>
      </aside>
      <div className="workspace">
        <header className="global-bar">
          <span className="location">{title}</span>
          <div className="global-actions">
            <button ref={searchTrigger} aria-label="Open global search" title="Search · Ctrl/⌘ K" onClick={() => { setSearchRestoreTarget(document.activeElement as HTMLElement); setCommandOpen(true); }}>
              <Search size={15} /><span className="search-label">Search &amp; commands</span><kbd className="kbd">⌘ K</kbd>
            </button>
            <button ref={notificationTrigger} aria-label="Notifications" aria-expanded={notificationsOpen} onClick={() => { if (!notificationsOpen) setNotificationRestoreTarget(document.activeElement as HTMLElement); setNotificationsOpen(v => !v); }}>
              <Bell size={15} />
            </button>
          </div>
        </header>
        <main id="main" className={`main-content ${location.pathname.startsWith('/studio/') ? 'studio-main' : ''}`}><Outlet /></main>
      </div>
      {notificationsOpen && (
        <div className="command-scrim notification-scrim" onMouseDown={event => { if (event.target === event.currentTarget) setNotificationsOpen(false); }}>
          <section ref={notificationDialogRef} className="notification-dialog" role="dialog" aria-modal="true" aria-labelledby="notification-title">
            <div className="notification-heading"><h2 id="notification-title">Notifications</h2><button aria-label="Close notifications" onClick={() => { setNotificationsOpen(false); notificationTrigger.current?.focus(); }}><X size={17} /></button></div>
            <p className="subtle">No new notifications. Processing and review notices will appear here when those services are available.</p>
          </section>
        </div>
      )}
      {commandOpen && (
        <div className="command-scrim" onMouseDown={event => { if (event.target === event.currentTarget) setCommandOpen(false); }}>
          <section ref={dialogRef} className="command-dialog" role="dialog" aria-modal="true" aria-labelledby="command-title">
            <h2 id="command-title" className="sr-only">Global search and commands</h2>
            <label className="sr-only" htmlFor="command-search">Search or go to a TONDE area</label>
            <div className="command-input"><Search size={19} /><input ref={commandRef} id="command-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search or go to…" /><kbd>ESC</kbd></div>
            <div className="command-results" role="listbox" aria-label="Navigation and Production results">
              {commands.map(command => (
                <button key={`${command.path}-${command.label}`} role="option" aria-selected="false" onClick={() => go(command.path)}>
                  <span><strong>{command.label}</strong><small>{command.detail}</small></span><ArrowUpRight size={15} />
                </button>
              ))}
              {query.trim().length >= 2 && (
                <>
                  {searchingProductions && <p role="status">Searching Productions…</p>}
                  {productionSearchError && <p role="alert">Production search failed: {productionSearchError}</p>}
                  {!searchingProductions && !productionSearchError && productionResults.map(production => (
                    <button key={production.id} role="option" aria-selected="false" onClick={() => go(`/studio/${production.id}`)}>
                      <span><strong>{production.title}</strong><small>{production.production_type} · {production.approval}</small></span><ArrowUpRight size={15} />
                    </button>
                  ))}
                </>
              )}
            </div>
            <p className="command-footer">Navigate TONDE or open a matching Production by name · Press Escape to close</p>
          </section>
        </div>
      )}
    </div>
  );
}
