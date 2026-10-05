import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Home, Clapperboard, Folder, Compass, Layers, Camera, Settings, Menu, X, LogOut, User, HelpCircle, Search, Bell, ArrowUpRight, Settings as SettingsIcon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useModalFocus } from '../hooks/useModalFocus';
import { authService } from '../services/auth';
import { safeError } from '../services/errors';
import { productionService } from '../services/productions';
import type { Production } from '../types/domain';
import { PRODUCT } from '../types/product';
const areaIcons = { home: Home, studio: Clapperboard, projects: Folder, discover: Compass, assets: Layers, setup: Camera, settings: Settings };
export const destinations = (Object.keys(PRODUCT.areas) as Array<keyof typeof PRODUCT.areas>).map(area => ({ ...PRODUCT.areas[area], icon: areaIcons[area] }));
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
  const [collapsed,setCollapsed]=useState(()=>localStorage.getItem('tonde:navigation-collapsed')==='true');
  const [appearance]=useState(()=>{const value=localStorage.getItem('tonde:appearance');return value==='light'||value==='system'?value:'dark';});
  const [reducedMotion]=useState(()=>localStorage.getItem('tonde:reduced-motion')==='true');
  const toggleCollapsed=()=>setCollapsed(value=>{localStorage.setItem('tonde:navigation-collapsed',String(!value));return !value;});
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
  useEffect(()=>{document.documentElement.dataset.appearance=appearance;document.documentElement.dataset.reducedMotion=String(reducedMotion);},[appearance,reducedMotion]);
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
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [commandOpen]);
  // Modal dialog: move focus in, keep Tab inside, and restore focus to the trigger on close.
  useModalFocus(commandOpen, searchRestoreTarget, dialogRef, '#command-search');
  useModalFocus(notificationsOpen, notificationRestoreTarget, notificationDialogRef);
  const commands = [
    { label: 'Go to Home', detail: 'Start or continue production', path: '/home' },
    { label: 'Go to Projects', detail: 'Find or manage Productions', path: '/projects' },
    { label: 'Open Projects to search Productions', detail: 'Find or manage existing work', path: '/projects' },
    { label: 'Start a Production on Home', detail: 'Describe an idea and Direct This', path: '/home' },
    { label: 'Open Studio', detail: 'Choose a Production to open', path: '/studio' },
    { label: 'Go to Assets', detail: 'Reusable production entities', path: '/assets' },
    { label: 'Open Assets to search', detail: 'Browse reusable production entities', path: '/assets' },
    { label: 'Open Setup', detail: 'Cameras, software and tools', path: '/setup' },
    { label: 'Open Setup to add a camera', detail: 'Add a production tool to your capabilities', path: '/setup' },
    { label: 'Open Discover', detail: 'Production knowledge and references', path: '/discover' },
    { label: 'Open Settings', detail: 'Application and account preferences', path: '/settings' },
  ].filter(command => `${command.label} ${command.detail}`.toLowerCase().includes(query.toLowerCase()));
  const exactCommand = commands.find(command => command.label.toLowerCase() === query.trim().toLowerCase());
  const visibleCommands = exactCommand ? [exactCommand] : commands;
  const go = (path: string) => { setCommandOpen(false); setQuery(''); navigate(path); };
  const title = destinations.find(d => location.pathname.startsWith(d.path))?.title ?? 'TONDE';
  useEffect(() => { document.title = `${title} · TONDE`; }, [title]);
  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to main content</a>
    <header className="mobile-bar"><span className="wordmark">TONDE<span>®</span></span><button aria-label={open ? 'Close navigation' : 'Open navigation'} aria-expanded={open} aria-controls="app-navigation" onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button></header>    <aside className={`sidebar ${open ? 'is-open' : ''} ${collapsed?'is-collapsed':''}`}>
      <button className="collapse-nav" type="button" aria-label={collapsed?'Expand navigation':'Collapse navigation'} aria-expanded={!collapsed} onClick={toggleCollapsed}>{collapsed?'Expand':'Collapse'}</button><NavLink className="wordmark" to="/home">TONDE<span>®</span></NavLink>
      {localPreview ? <p className="sidebar-label">TONDE — LOCAL DEVELOPMENT PREVIEW</p> : <p className="sidebar-label">PRODUCTION WORKSPACE</p>}
      <nav id="app-navigation" aria-label="Main navigation">{destinations.map(({ path, title: label, icon: Icon }) => <NavLink key={path} to={path} title={label} aria-label={label} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon size={18} aria-hidden="true" /><span>{label}</span></NavLink>)}</nav>
      <div className="sidebar-bottom"><div className="workspace-mark"><span className="status-dot" /> {localPreview ? 'Local preview — no live project' : 'Personal workspace'}</div>
        {localPreview ? <div className="profile-menu"><span className="avatar">{session?.user.email?.slice(0, 1).toUpperCase() ?? 'L'}</span><span>Local preview</span><NavLink to="/settings/connections"><SettingsIcon size={15} /> Connection settings</NavLink></div> : <details className="profile-menu"><summary><span className="avatar">{session?.user.email?.slice(0, 1).toUpperCase() ?? 'T'}</span><span>My account</span></summary>
          <NavLink to="/account"><User size={15} /> Account / profile</NavLink><NavLink to="/help"><HelpCircle size={15} /> Help / support</NavLink>
          <button onClick={() => { void authService.signOut().catch(e => setError(safeError(e).message)); }}><LogOut size={15} /> Log out</button>
        </details>}
{error && <p role="alert" className="error-text">{error}</p>}
      </div>
    </aside>
    <main id="main" className={`main-content ${location.pathname.startsWith('/studio/') ? 'studio-main' : ''}`}><header className="global-bar"><span>{destinations.find(d => location.pathname.startsWith(d.path))?.title ?? 'TONDE'}</span><div><button ref={searchTrigger} aria-label="Open global search" title="Search · Ctrl/⌘ K" onClick={() => { setSearchRestoreTarget(document.activeElement as HTMLElement); setCommandOpen(true); }}><Search size={17}/><span>Search</span><kbd>⌘ K</kbd></button><button ref={notificationTrigger} aria-label="Notifications" aria-expanded={notificationsOpen} onClick={()=>{if(!notificationsOpen)setNotificationRestoreTarget(document.activeElement as HTMLElement);setNotificationsOpen(value=>!value);}}><Bell size={17}/></button></div></header><Outlet /></main>
    {notificationsOpen&&<div className="command-scrim notification-scrim" onMouseDown={event=>{if(event.target===event.currentTarget)setNotificationsOpen(false);}}><section ref={notificationDialogRef} className="notification-dialog" role="dialog" aria-modal="true" aria-labelledby="notification-title"><div className="notification-heading"><h2 id="notification-title">Notifications</h2><button aria-label="Close notifications" onClick={()=>{setNotificationsOpen(false);notificationTrigger.current?.focus();}}><X size={17}/></button></div><p className="subtle">No new notifications. Processing and review notices will appear here when those services are available.</p></section></div>}
    {commandOpen&&<div className="command-scrim" onMouseDown={event=>{if(event.target===event.currentTarget)setCommandOpen(false);}}><section ref={dialogRef} className="command-dialog" role="dialog" aria-modal="true" aria-labelledby="command-title"><h2 id="command-title" className="sr-only">Global search and commands</h2><label className="sr-only" htmlFor="command-search">Search or go to a TONDE area</label><div className="command-input"><Search size={19}/><input ref={commandRef} id="command-search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search or go to…"/><kbd>ESC</kbd></div><div className="command-results" role="listbox" aria-label="Navigation and Production results">{visibleCommands.map(command=><button key={`${command.path}-${command.label}`} role="option" aria-selected="false" onClick={()=>go(command.path)}><span><strong>{command.label}</strong><small>{command.detail}</small></span><ArrowUpRight size={15}/></button>)}{query.trim().length>=2&&<>{searchingProductions&&<p role="status">Searching Productions…</p>}{productionSearchError&&<p role="alert">Production search failed: {productionSearchError}</p>}{!searchingProductions&&!productionSearchError&&productionResults.map(production=><button key={production.id} role="option" aria-selected="false" onClick={()=>go(`/studio/${production.id}`)}><span><strong>{production.title}</strong><small>{PRODUCT.productionTypes[production.production_type]} · {PRODUCT.approvals[production.approval]}</small></span><ArrowUpRight size={15}/></button>)}{!searchingProductions&&!productionSearchError&&!visibleCommands.length&&!productionResults.length&&<p>No matching commands or Productions. Try another name.</p>}</>}{!visibleCommands.length&&query.trim().length<2&&<p>No matching commands. Try “Projects” or “Setup”.</p>}</div><p className="command-footer">Navigate TONDE or open a matching Production by name · Press Escape to close</p></section></div>}
  </div>;
}
