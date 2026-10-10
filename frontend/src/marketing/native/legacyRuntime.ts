/**
 * Scoped runtime for the ported legacy marketing area scripts.
 *
 * Each area script (`native/runners/area*.ts`, generated from the preserved
 * `tonde_unified_site` designs) was written as a standalone page script that
 * renders into its own document. Here it runs inside a sandbox:
 *
 * - `document` is scoped to the component root (unmatched ids yield a shared
 *   inert dummy so dropped standalone chrome cannot crash rendering).
 * - `history`/`location` are stubbed per mounted anchor; navigation intent is
 *   recorded and drained to the SPA router (`onNavigate`), so legacy
 *   `go()/area1()…/external()` calls become real client-side route changes.
 * - `window.parent/top.postMessage` is swallowed (the iframe bridge is gone;
 *   `notice` payloads are surfaced through `onNotice`).
 * - Inline `on*` attributes are rewritten to `data-legacy-on-*` and dispatched
 *   through one delegated listener into the script scope.
 * - `submitAuth` (prototype auth) is neutralised: those anchors are served by
 *   the real AuthPage, and any residual call routes to `/login`.
 */
export interface LegacyApi {
  /** Resolve a recorded navigation intent to an SPA path (or null to ignore). */
  onNavigate: (intent: { file: string; hash: string } | { href: string }) => void;
  onNotice: (message: string) => void;
}

export interface LegacyHandle {
  dispose: () => void;
}

const HANDLER_ATTRS = ['click', 'input', 'change', 'keyup', 'keydown', 'submit', 'focus', 'blur'];

function makeDummy(): any {
  const dummy: any = {
    textContent: '',
    innerHTML: '',
    value: '',
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getAttribute: () => null,
    scrollIntoView() {},
    focus() {},
    click() {},
  };
  return dummy;
}

/** Rewrite inline `on*="fn(...)"` attributes to dispatchable data attributes. */
export function rewriteHandlers(html: string): string {
  return html.replace(
    /\s+on(click|input|change|keyup|keydown|submit|focus|blur)\s*=\s*("([^"]*)"|'([^']*)')/g,
    (_, kind: string, _q: string, dq: string, sq: string) => ` data-legacy-on-${kind}="${(dq ?? sq).replace(/"/g, '&quot;')}"`,
  );
}

function parseCall(expr: string): { fn: string; args: string[] } | null {
  const m = expr.trim().match(/^([A-Za-z_$][\w$]*)\(([\s\S]*)\)$/);
  if (!m) return null;
  const raw = m[2].trim();
  if (!raw) return { fn: m[1], args: [] };
  // Split top-level commas (string literals use single quotes in legacy code).
  const args: string[] = [];
  let cur = '';
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (quote) {
      cur += ch;
      if (ch === quote && raw[i - 1] !== '\\') quote = null;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      cur += ch;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
      cur += ch;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      cur += ch;
    } else if (ch === ',' && depth === 0) {
      args.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) args.push(cur.trim());
  return { fn: m[1], args };
}

/** Evaluate member chains rooted at `this`, `event[.target]`, or `document.getElementById(id)`. */
function evalChain(base: unknown, chain: string): unknown {
  let current: unknown = base;
  const op = /\.([A-Za-z_$][\w$]*)|\.getAttribute\(\s*'([^']*)'\s*\)|\.getAttribute\(\s*"([^"]*)"\s*\)/g;
  let m: RegExpExecArray | null;
  let consumed = 0;
  while ((m = op.exec(chain)) !== null) {
    if (m.index !== consumed) return undefined;
    consumed = m.index + m[0].length;
    if (current === null || current === undefined) return undefined;
    if (m[1] !== undefined) current = (current as Record<string, unknown>)[m[1]];
    else current = (current as Element).getAttribute?.(m[2] ?? m[3]);
  }
  return consumed === chain.length ? current : undefined;
}

function evalArg(root: Element, arg: string, element: Element, event: Event): unknown {
  const t = arg.trim();
  if (t === 'this') return element;
  const thisChain = t.match(/^this((?:\.[A-Za-z_$][\w$]*|\.getAttribute\((?:'[^']*'|"[^"]*"\)))*)$/);
  if (thisChain) return evalChain(element, thisChain[1]);
  const eventChain = t.match(/^event\.target((?:\.[A-Za-z_$][\w$]*)*)$/);
  if (eventChain) return evalChain(event.target, eventChain[1]);
  const byId = t.match(/^document\.getElementById\(\s*'([^']*)'\s*\)((?:\.[A-Za-z_$][\w$]*)*)$/);
  if (byId) return evalChain(root.querySelector(`#${CSS.escape(byId[1])}`), byId[2]);
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/&quot;/g, '"');
  }
  if (t === 'event') return event;
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return undefined;
}

export function mountLegacy(params: {
  root: HTMLElement;
  staticHtml: string;
  script: string;
  anchor: string;
  fileKey: string;
  api: LegacyApi;
}): LegacyHandle {
  const { root, staticHtml, script, anchor, fileKey, api } = params;
  const disposers: Array<() => void> = [];
  const navigations: Array<{ file: string; hash: string } | { href: string }> = [];
  const dummy = makeDummy();

  const rewriteRoot = () => {
    // Rewrite inline handlers on the root's current markup. Scripts render
    // fresh markup on every interaction, so observe and rewrite additions too.
    for (const el of root.querySelectorAll('[onclick],[oninput],[onchange],[onkeyup],[onkeydown],[onsubmit],[onfocus],[onblur]')) {
      for (const kind of HANDLER_ATTRS) {
        const attr = `on${kind}`;
        const value = el.getAttribute(attr);
        if (value !== null) {
          el.removeAttribute(attr);
          el.setAttribute(`data-legacy-on-${kind}`, value);
        }
      }
      if (el instanceof HTMLElement) {
        for (const kind of HANDLER_ATTRS) {
          try {
            (el as unknown as Record<string, unknown>)[`on${kind}`] = null;
          } catch {
            /* non-configurable handler slots are left inert */
          }
        }
      }
    }
  };
  root.innerHTML = rewriteHandlers(staticHtml);
  rewriteRoot();
  const observer = new MutationObserver(() => rewriteRoot());
  observer.observe(root, { childList: true, subtree: true });
  disposers.push(() => observer.disconnect());

  const scopedGetById = (id: string): HTMLElement | null => {
    const found = root.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    return found ?? null;
  };
  const strictGetById = (id: string): any => scopedGetById(id) ?? dummy;

  const docHandler = {
    get(target: Document, prop: string | symbol, receiver: unknown) {
      if (prop === 'getElementById') return (id: string) => strictGetById(id);
      if (prop === 'querySelectorAll') return (sel: string) => root.querySelectorAll(sel);
      if (prop === 'querySelector') return (sel: string) => root.querySelector(sel);
      if (prop === 'addEventListener')
        return (type: string, listener: EventListener, options?: AddEventListenerOptions) => {
          document.addEventListener(type, listener, options);
          disposers.push(() => document.removeEventListener(type, listener, options));
        };
      if (prop === 'body')
        return { dataset: {}, scrollHeight: root.scrollHeight, style: {} as CSSStyleDeclaration };
      if (prop === 'documentElement') return { scrollHeight: root.scrollHeight };
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  };
  const docHandlerWithSet: ProxyHandler<Document> = {
    ...docHandler,
    // Native setters (e.g. document.title) reject proxy receivers with
    // "Illegal invocation"; forward with the genuine document as receiver.
    set(target: Document, prop: string | symbol, value: unknown) {
      if (prop === 'title' && typeof value === 'string') {
        document.title = value;
        return true;
      }
      return Reflect.set(target, prop, value, target);
    },
  };
  const scopedDocument = new Proxy(document, docHandlerWithSet);

  // `location` stub: reads report the mounted anchor; writes record navigation.
  const navState = { hash: `#${anchor}` };
  const locStub: { hash: string; href: string } = {} as { hash: string; href: string };
  Object.defineProperty(locStub, 'hash', {
    get: () => navState.hash,
    // Legacy routers assign location.hash directly (go/technique selection).
    set: (value: string) => {
      const hash = String(value).replace(/^#/, '');
      navState.hash = `#${hash}`;
      navigations.push({ file: fileKey, hash });
    },
    enumerable: true,
  });
  Object.defineProperty(locStub, 'href', {
    get: () => `https://tonde.io/${navState.hash}`,
    set: (value: string) => {
      const m = String(value).match(/([^/#?]+?)(?:\.html?)?(?:#([^#]*))?$/);
      if (m) navigations.push({ file: m[1], hash: m[2] ?? '' });
    },
    enumerable: true,
  });
  const histStub = {
    pushState(_d: unknown, _t: string, url?: string | URL | null) {
      if (typeof url === 'string' && url.startsWith('#')) navigations.push({ file: fileKey, hash: url.slice(1) });
    },
    replaceState(_d: unknown, _t: string, url?: string | URL | null) {
      if (typeof url === 'string' && url.startsWith('#')) navigations.push({ file: fileKey, hash: url.slice(1) });
    },
    length: 1,
    back() {},
    forward() {},
    go() {},
  };
  const winHandler = {
    get(target: Window, prop: string | symbol, receiver: unknown) {
      if (prop === 'parent' || prop === 'top')
        return {
          postMessage: (msg: { tonde?: string; message?: string }) => {
            if (msg && typeof msg === 'object' && msg.tonde === 'notice' && msg.message) {
              api.onNotice(msg.message);
            }
          },
        };
      if (prop === 'location') return locStub;
      if (prop === 'history') return histStub;
      if (prop === 'addEventListener')
        return (type: string, listener: EventListener, options?: AddEventListenerOptions) => {
          window.addEventListener(type, listener, options);
          disposers.push(() => window.removeEventListener(type, listener, options));
        };
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target: Window, prop: string | symbol, value: unknown) {
      if (prop === 'location' || prop === 'history') return true;
      return Reflect.set(target, prop as never, value);
    },
  };
  const scopedWindow = new Proxy(window, winHandler);

  // Expose the script scope so the dispatcher can invoke widget handlers.
  const factory = new Function(
    'document',
    'window',
    'localStorage',
    'location',
    'history',
    'navigate',
    'notice',
    `${script}\nfunction __assign(name, value){ try { eval(name + ' = value'); } catch (e) { /* unknown binding */ } }\nreturn { ${collectApi(script)}, "__assign": __assign };`,
  );
  // Drop any navigation recorded by the initial render (normalisation writes).
  const drainInitial = () => {
    navigations.length = 0;
  };
  const scope: Record<string, (...a: never[]) => unknown> = factory(
    scopedDocument,
    scopedWindow,
    window.localStorage,
    locStub,
    histStub,
    (intent: { file: string; hash: string } | { href: string }) => navigations.push(intent),
    (message: string) => api.onNotice(message),
  );
  drainInitial();

  const NAV_FNS = new Set(['go', 'area1', 'area2', 'area3', 'area4', 'external', 'directThis', 'directGuide']);

  // Placeholder navigator stubs (e.g. area3's area4, which only ever showed
  // an "Area Four will be built next" alert) are never executed: the SPA
  // fallback below performs the real navigation instead.
  const PLACEHOLDER_NAV = new Set<string>();
  {
    // Collect every candidate definition first: a body window would otherwise
    // swallow sibling definitions and hide their alerts.
    const defs = [...script.matchAll(/function\s+(area\d|external|go)\s*\([^)]*\)\s*\{/g)];
    defs.forEach((m, i) => {
      const start = (m.index ?? 0) + m[0].length;
      const nextFn = script.indexOf('function', start);
      const end = Math.min(start + 300, nextFn === -1 ? script.length : nextFn);
      if (/\balert\s*\(/.test(script.slice(start, end))) PLACEHOLDER_NAV.add(m[1]);
    });
  }

  function drainNavigations() {
    if (navigations.length === 0) return;
    const last = navigations[navigations.length - 1];
    navigations.length = 0;
    api.onNavigate(last);
  }

  /** Placeholder modal copy from the standalone prototypes names unbuilt areas. */
  function placeholderRoute(title: string, text: string): string | null {
    if (!/will contain/i.test(text)) return null;
    const hay = `${title} ${text}`.toLowerCase();
    if (hay.includes('area two') || hay.includes('creation')) return '/create/real-production';
    if (hay.includes('area three') || hay.includes('discover') || hay.includes('solution')) return '/solutions';
    if (hay.includes('area four') || hay.includes('guide') || hay.includes('pricing')) return '/resources/guides';
    return '/';
  }

  /**
   * Interceptions that must never reach the legacy scope. Returns true when
   * the call was handled (navigation recorded, no legacy execution).
   */
  function intercept(call: { fn: string; args: string[] }, element: Element, event: Event): boolean {
    // Prototype auth is never executed: route to real authentication instead.
    if (call.fn === 'submitAuth') {
      navigations.push({ file: fileKey, hash: '__auth__' });
      return true;
    }
    // Unfinished-area placeholder modals become navigation to the real route.
    if (call.fn === 'openFuture') {
      const args = call.args.map((a) => evalArg(root, a, element, event));
      if (typeof args[1] === 'string') {
        const target = placeholderRoute(String(args[0] ?? ''), args[1]);
        if (target) {
          navigations.push({ href: target });
          return true;
        }
      }
    }
    return false;
  }

  function callScope(call: { fn: string; args: string[] }, element: Element, event: Event, recordNav: boolean) {
    void recordNav;
    const args = call.args.map((a) => evalArg(root, a, element, event));
    if (intercept(call, element, event)) return;
    try {
      (scope[call.fn] as ((...a: unknown[]) => unknown) | undefined)?.(...args);
    } catch {
      /* inert dummy targets absorb dropped-chrome writes */
    }
  }

  function runStatement(stmt: string, element: Element, event: Event) {
    const text = stmt.trim();
    if (!text) return;
    const timer = text.match(/^setTimeout\(\s*\(\)\s*=>\s*([\s\S]+?),\s*(\d+)\s*\)$/);
    if (timer) {
      const body = timer[1];
      const delay = Number(timer[2]);
      window.setTimeout(() => runStatement(body, element, event), delay);
      return;
    }
    const assign = text.match(/^([A-Za-z_$][\w$]*)\s*=\s*('([^']*)'|"([^"]*)"|(-?\d+(\.\d+)?))$/);
    if (assign) {
      const value = assign[3] ?? assign[4] ?? Number(assign[5]);
      try {
        (scope.__assign as (n: string, v: unknown) => void)?.(assign[1], value);
      } catch {
        /* unknown binding */
      }
      return;
    }
    const domCall = text.match(/^document\.getElementById\(\s*'([^']*)'\s*\)\s*\?\.\s*(focus|click|scrollIntoView)\(\)$/)
      ?? text.match(/^document\.getElementById\(\s*'([^']*)'\s*\)\.(focus|click|scrollIntoView)\(\)$/);
    if (domCall) {
      const el = root.querySelector<HTMLElement>(`#${CSS.escape(domCall[1])}`);
      if (domCall[2] === 'scrollIntoView') el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else (el as HTMLElement | null)?.[domCall[2] as 'focus' | 'click']?.();
      return;
    }
    const call = parseCall(text);
    if (call) callScope(call, element, event, false);
  }

  function dispatch(expr: string, element: Element, event: Event) {
    const source = expr.replace(/&quot;/g, '"');
    // Split multi-statement handlers on top-level semicolons.
    const statements: string[] = [];
    let cur = '';
    let quote: string | null = null;
    let depth = 0;
    for (let i = 0; i < source.length; i++) {
      const ch = source[i];
      if (quote) {
        cur += ch;
        if (ch === quote && source[i - 1] !== '\\') quote = null;
      } else if (ch === "'" || ch === '"' || ch === '`') {
        quote = ch;
        cur += ch;
      } else if (ch === '(' || ch === '[' || ch === '{') {
        depth++;
        cur += ch;
      } else if (ch === ')' || ch === ']' || ch === '}') {
        depth--;
        cur += ch;
      } else if (ch === ';' && depth === 0) {
        statements.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    if (cur.trim()) statements.push(cur);
    if (statements.length > 1) {
      for (const stmt of statements) runStatement(stmt, element, event);
      drainNavigations();
      return;
    }
    const call = parseCall(source);
    if (!call) {
      runStatement(source, element, event);
      drainNavigations();
      return;
    }
    if (intercept(call, element, event)) {
      drainNavigations();
      return;
    }
    const args = call.args.map((a) => evalArg(root, a, element, event));
    if (NAV_FNS.has(call.fn)) {
      // Run the legacy function for its state side-effects (e.g. localStorage
      // intent in directThis/openGuide), then honour recorded navigation.
      if (!PLACEHOLDER_NAV.has(call.fn)) {
        try {
          scope[call.fn]?.(...(args as never[]));
        } catch {
          /* unreachable anchors fall through to navigation */
        }
      }
      // Legacy cross-file helpers assign location.href directly; our location
      // is a stub, so translate the known file#hash convention here.
      if (navigations.length === 0 && (call.fn === 'area1' || call.fn === 'area2' || call.fn === 'area3' || call.fn === 'area4')) {
        const target = String(args[0] ?? '');
        if (target) navigations.push({ file: call.fn, hash: target });
      }
      if (navigations.length === 0) {
        // `external(file, hash)` and hash-less navigations.
        if (call.fn === 'external' && args[0]) {
          navigations.push({ file: String(args[0]), hash: String(args[1] ?? '') });
        } else if (typeof args[0] === 'string' && args[0]) {
          navigations.push({ file: fileKey, hash: args[0] });
        }
      }
      drainNavigations();
      return;
    }
    try {
      scope[call.fn]?.(...(args as never[]));
    } catch {
      /* inert dummy targets absorb dropped-chrome writes */
    }
    // Widget handlers record navigation via the location/history stubs.
    drainNavigations();
  }

  const onEvent = (kind: string) => (event: Event) => {
    const target = event.target as Element | null;
    const el = target?.closest?.(`[data-legacy-on-${kind}]`);
    if (!el || !root.contains(el)) return;
    if (kind === 'submit') event.preventDefault();
    const expr = el.getAttribute(`data-legacy-on-${kind}`);
    if (expr) dispatch(expr, el, event);
  };
  const listeners: Array<[string, EventListener]> = HANDLER_ATTRS.map((kind) => [kind, onEvent(kind)]);
  for (const [kind, listener] of listeners) {
    root.addEventListener(kind, listener);
    disposers.push(() => root.removeEventListener(kind, listener));
  }
  root.dataset.legacyListeners = String(listeners.length);

  return {
    dispose() {
      while (disposers.length) disposers.pop()?.();
      delete root.dataset.legacyListeners;
      root.innerHTML = '';
    },
  };
}

/** Collect top-level function names so the dispatcher can call them. */
function collectApi(script: string): string {
  const names = new Set<string>();
  // Scripts are minified: declarations follow `}` without separators.
  for (const m of script.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    names.add(m[1]);
  }
  return [...names]
    .map(
      (n) =>
        `${JSON.stringify(n)}: (typeof ${n} !== 'undefined' ? (...a) => { try { return ${n}(...a); } catch (e) { console.error('[legacy-scope]', ${JSON.stringify(n)}, e); throw e; } } : undefined)`,
    )
    .join(', ');
}
