#!/usr/bin/env node
/**
 * Repo-wide link audit.
 *
 * Reports broken internal links across:
 *  - Markdown documents (relative file/asset targets, incl. anchors)
 *  - frontend/public HTML (href/src, excluding the immutable preserved originals)
 *  - frontend/src SPA navigation (Link `to`, `navigate(...)`, `href`)
 *  - frontend/public/sitemap.xml vs the marketing route table
 *  - legacy marketing navigation intents vs resolveLegacyNav
 *  - package.json / docs script references
 *
 * Usage: node scripts/check-links.mjs
 * Exit code 1 when any broken link is found.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const report = (file, detail) => problems.push(`${file}: ${detail}`);
const stats = { md: 0, anchors: 0, mdPaths: 0, publicHtml: 0, srcNav: 0, sitemap: 0, robots: 0, pkg: 0 };

// `legacy/` is historical archive, not runtime: the boundary check owns it.
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.vite', 'coverage', 'test-results', 'playwright-report', 'legacy']);

function walk(dir, filter, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.github') {
      if (entry.isDirectory()) continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      walk(full, filter, out);
    } else if (filter(entry.name, full)) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------- markdown
const mdFiles = walk(ROOT, (name) => name.endsWith('.md'));

function stripCode(md) {
  return md.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

/** GitHub-flavoured heading slug (punctuation dropped, spaces to hyphens). */
function headingSlugs(md) {
  const slugs = new Set();
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    slugs.add(
      m[1]
        .toLowerCase()
        .replace(/<[^>]+>/g, '')
        .replace(/[`*_]/g, '')
        .replace(/[^\w\- ]/g, '')
        .replace(/ /g, '-'),
    );
  }
  return slugs;
}

for (const file of mdFiles) {
  const text = stripCode(readFileSync(file, 'utf8'));
  const rel = relative(ROOT, file);
  const links = [];
  // [text](target)
  for (const m of text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) links.push(m[1]);
  // <a href="target">
  for (const m of text.matchAll(/<a\s[^>]*href="([^"]+)"/g)) links.push(m[1]);
  for (const raw of links) {
    if (/^(https?:|mailto:|tel:|\/\/)/.test(raw)) continue;
    // same-document anchor: the heading must exist in this file
    if (raw.startsWith('#')) {
      const fragment = raw.slice(1);
      if (!fragment || /^L\d+/.test(fragment)) continue;
      stats.anchors++;
      if (!headingSlugs(text).has(fragment.toLowerCase())) {
        report(rel, `link anchor not found -> ${raw}`);
      }
      continue;
    }
    const target = raw.split('#')[0];
    if (!target) continue;
    stats.md++;
    const base = target.startsWith('/') ? join(ROOT, target) : resolve(dirname(file), target);
    const candidates = [base, `${base}.md`, join(base, 'README.md'), `${base}.mjs`, `${base}.sql`];
    const hit = candidates.find((c) => existsSync(c));
    if (!hit) {
      report(rel, `broken link -> ${raw}`);
      continue;
    }
    // A fragment pointing into a local markdown file must name a real heading.
    const fragment = raw.split('#')[1];
    if (!fragment || !hit.endsWith('.md')) continue;
    if (/^L\d+/.test(fragment)) continue; // GitHub line anchors
    stats.anchors++;
    if (!headingSlugs(readFileSync(hit, 'utf8')).has(fragment.toLowerCase())) {
      report(rel, `link anchor not found -> ${raw}`);
    }
  }
}

// ------------------------------------------- inline-code repo paths in md
// Documentation frequently names a path in backticks instead of linking it;
// a name that no longer resolves is just as broken as a dead link.
const PATH_PREFIXES = [
  'docs/',
  'scripts/',
  'tests/',
  'supabase/',
  'frontend/src/',
  'frontend/public/',
  'frontend/e2e/',
  'backend/app/',
  'backend/tests/',
  'product/',
];
const PATH_EXCEPTIONS = [/^tests\/test_/, /^backend\/app\/models\//];
for (const file of mdFiles) {
  const rel = relative(ROOT, file);
  if (rel.split(/[\\/]/)[0] === 'legacy') continue; // historical, not runtime
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/`([A-Za-z0-9_@./-]+)`/g)) {
    const raw = m[1];
    if (!PATH_PREFIXES.some((p) => raw.startsWith(p))) continue;
    if (/[*<>{}]/.test(raw)) continue;
    const clean = raw.replace(/[.,;:)]+$/, '');
    if (/^test-results\//.test(clean)) continue;
    if (PATH_EXCEPTIONS.some((re) => re.test(clean))) continue;
    stats.mdPaths++;
    if (existsSync(join(ROOT, clean)) || existsSync(join(ROOT, clean.replace(/\/$/, '')))) continue;
    report(rel, `names a path that does not exist -> ${raw}`);
  }
}

// ------------------------------------------------- frontend/public HTML
const isOriginal = (f) => f.split(/[\\/]/).join('/').includes('/marketing/originals/');
const publicHtml = walk(join(ROOT, 'frontend', 'public'), (name) => name.endsWith('.html')).filter(
  (f) => !isOriginal(f),
);
for (const file of publicHtml) {
  const rel = relative(ROOT, file);
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/\s(?:href|src)\s*=\s*"([^"]*)"/g)) {
    const raw = m[1].trim();
    if (!raw || /^(https?:|mailto:|tel:|#|data:|\/\/)/.test(raw)) continue;
    const target = raw.split('#')[0].split('?')[0];
    if (!target) continue;
    const base = target.startsWith('/')
      ? join(ROOT, 'frontend', 'public', target.replace(/^\//, ''))
      : resolve(dirname(file), target);
    if (!existsSync(base) && !existsSync(join(ROOT, 'frontend', 'public', target.replace(/^\//, '')))) {
      report(rel, `broken asset -> ${raw}`);
    }
  }
}

// ------------------------------------------------- frontend/public assets
// any /foo.ext reference inside public HTML must resolve inside public/
for (const file of publicHtml) {
  const rel = relative(ROOT, file);
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/["'(]([A-Za-z0-9_\-./]+\.(?:svg|png|jpg|jpeg|webp|gif|ico|css|js|json|webmanifest))["')]/g)) {
    const raw = m[1];
    if (/^https?:/.test(raw) || raw.startsWith('//')) continue;
    if (raw.includes('/')) {
      const base = raw.startsWith('/')
        ? join(ROOT, 'frontend', 'public', raw.replace(/^\//, ''))
        : resolve(dirname(file), raw);
      if (!existsSync(base) && !existsSync(join(ROOT, 'frontend', 'public', raw.replace(/^\//, '')))) {
        report(rel, `missing asset -> ${raw}`);
      }
    }
  }
}

// ------------------------------------------------- frontend/index.html
// The Vite entry document names its own script and favicon; both must exist.
const indexHtml = readFileSync(join(ROOT, 'frontend', 'index.html'), 'utf8');
for (const m of indexHtml.matchAll(/\s(?:href|src)\s*=\s*"([^"]+)"/g)) {
  const raw = m[1];
  if (!raw.startsWith('/')) continue;
  const inSrc = join(ROOT, 'frontend', raw.replace(/^\//, ''));
  const inPublic = join(ROOT, 'frontend', 'public', raw.replace(/^\//, ''));
  if (!existsSync(inSrc) && !existsSync(inPublic)) {
    report('frontend/index.html', `broken reference -> ${raw}`);
  }
}

// ------------------------------------------------ SPA route definitions
const siteTs = readFileSync(join(ROOT, 'frontend', 'src', 'marketing', 'content', 'site.ts'), 'utf8');
const marketingPaths = [...siteTs.matchAll(/^\s*(?:embed|native)\(\s*'([^']+)'/gm)].map((m) => m[1]);
const appTs = readFileSync(join(ROOT, 'frontend', 'src', 'App.tsx'), 'utf8');
const appPaths = [...appTs.matchAll(/path:\s*'([^']+)'/g)].map((m) => m[1]);

// A marketing route that repeats an app route would shadow the authenticated app
// (marketing is mounted first), so every public path must stay distinct.
for (const p of marketingPaths) {
  if (appPaths.includes(p) && p !== '/') {
    report('frontend/src/marketing/content/site.ts', `marketing route shadows an app route -> ${p}`);
  }
}

const knownExact = new Set([...marketingPaths, ...appPaths]);
const knownPrefixes = appPaths.filter((p) => p.includes(':')).map((p) => p.replace(/:[^/]+/g, ''));

function routeExists(path) {
  const clean = path.split('#')[0].replace(/\/+$/, '') || '/';
  if (knownExact.has(clean)) return true;
  return knownPrefixes.some((p) => clean.startsWith(p));
}

// ------------------------------------------------- SPA navigation in src
const srcFiles = walk(join(ROOT, 'frontend', 'src'), (name) => /\.(ts|tsx)$/.test(name));
for (const file of srcFiles) {
  if (file.includes(`${posix.sep}marketing${posix.sep}native${posix.sep}runners${posix.sep}`)) continue;
  const rel = relative(ROOT, file);
  const text = readFileSync(file, 'utf8');
  const targets = [];
  for (const m of text.matchAll(/\bto=(?:"([^"]+)"|'([^']+)'|\{`([^`]+)`\})/g)) targets.push(m[1] ?? m[2] ?? m[3]);
  // route tables: `{ label: 'x', to: '/path' }` in site.ts and similar maps
  for (const m of text.matchAll(/\bto:\s*'([^']+)'/g)) targets.push(m[1]);
  for (const m of text.matchAll(/\bnavigate\(\s*'([^']+)'/g)) targets.push(m[1]);
  for (const m of text.matchAll(/\bhref="(\/[^"]*)"/g)) targets.push(m[1]);
  stats.srcNav += targets.length;
  for (const raw of targets) {
    if (!raw || raw.includes('${') || raw.startsWith('http') || raw.startsWith('#')) continue;
    if (!routeExists(raw)) report(rel, `unknown SPA route -> ${raw}`);
  }
}

// ------------------------------------------------- sitemap vs route table
const sitemap = readFileSync(join(ROOT, 'frontend', 'public', 'sitemap.xml'), 'utf8');
const sitemapPaths = [...sitemap.matchAll(/<loc>https:\/\/tonde\.io([^<]*)<\/loc>/g)].map((m) => m[1] || '/');
stats.sitemap = sitemapPaths.length;
for (const p of sitemapPaths) {
  const clean = p.replace(/\/+$/, '') || '/';
  if (!marketingPaths.includes(clean)) report('frontend/public/sitemap.xml', `URL not in marketing route table -> ${p}`);
}
for (const p of marketingPaths) {
  const inSitemap = sitemapPaths.some((s) => (s.replace(/\/+$/, '') || '/') === p);
  if (!inSitemap) report('frontend/public/sitemap.xml', `missing route -> ${p}`);
}

// ------------------------------------------------- robots.txt sanity
const robots = readFileSync(join(ROOT, 'frontend', 'public', 'robots.txt'), 'utf8');
for (const m of robots.matchAll(/^Disallow:\s*(\S+)/gm)) {
  const raw = m[1];
  stats.robots++;
  const p = raw.replace(/\/+$/, '') || '/';
  if (p === '/') continue;
  const staticDir = join(ROOT, 'frontend', 'public', raw.replace(/^\//, ''));
  const isRoute =
    knownExact.has(p) ||
    knownPrefixes.some((pre) => (p + '/').startsWith(pre)) ||
    [...knownExact].some((route) => route.startsWith(p + '/'));
  if (!isRoute && !existsSync(staticDir)) {
    report('frontend/public/robots.txt', `disallow target is neither a route nor a public path -> ${raw}`);
  }
}

// ------------------------------------------------- legacy nav intents
const areaAnchor = new Map();
for (const m of siteTs.matchAll(/(?:embed|native)\(\s*'([^']+)'[\s\S]*?AREA([1-4]),\s*'([^']+)'\s*\)/g)) {
  areaAnchor.set(`area${m[2]}#${m[3]}`, m[1]);
}
const runnerDir = join(ROOT, 'frontend', 'src', 'marketing', 'native', 'runners');
function readLiteral(mod, name) {
  const start = mod.indexOf(`export const ${name} = `);
  if (start === -1) throw new Error(`missing ${name}`);
  const from = start + `export const ${name} = `.length;
  let i = from + 1;
  for (; i < mod.length; i++) {
    const ch = mod[i];
    if (ch === '\\') i++;
    else if (ch === '"') break;
  }
  return JSON.parse(mod.slice(from, i + 1));
}
for (const area of ['area1', 'area2', 'area3', 'area4']) {
  const mod = readFileSync(join(runnerDir, `${area}.ts`), 'utf8');
  const script = readLiteral(mod, 'SCRIPT');
  const staticHtml = readLiteral(mod, 'STATIC_HTML');
  const combined = `${staticHtml}\n${script}`;
  const intents = [];
  for (const m of combined.matchAll(/\bgo\('([^'$]+)'\)/g)) intents.push({ file: area, hash: m[1] });
  for (const m of combined.matchAll(/\barea([1-4])\('([^'$]+)'\)/g)) intents.push({ file: `area${m[1]}`, hash: m[2] });
  const validAreaHash = (f, h) => areaAnchor.has(`${f}#${h}`);
  for (const intent of intents) {
    const { file: f, hash: h } = intent;
    if (['login', 'signup', 'forgot', '__auth__'].includes(h)) continue;
    // In-area legacy sub-views (guide detail, auth panels) are not SPA routes,
    // but cross-area helpers must resolve.
    if (f === area) continue;
    if (!validAreaHash(f, h) && !validAreaHash(area, h)) {
      report(`frontend/src/marketing/native/runners/${area}.ts`, `unresolvable legacy nav -> ${f}#${h}`);
    }
  }
}

// ------------------------------------------------- CI workflow commands
const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
for (const m of ci.matchAll(/\bnode\s+((?:scripts|tests)\/[\w./-]+\.mjs)/g)) {
  if (!existsSync(join(ROOT, m[1]))) report('.github/workflows/ci.yml', `missing script -> ${m[1]}`);
}
// `npm run <script>` must exist in the package.json of the step's working directory.
const ciLines = ci.split(/\r?\n/);
for (let i = 0; i < ciLines.length; i++) {
  const m = ciLines[i].match(/\bnpm run ([\w:-]+)/);
  if (!m) continue;
  let dir = '';
  for (let j = i; j >= 0; j--) {
    const wd = ciLines[j].match(/^\s*working-directory:\s*(\S+)/);
    if (wd) {
      dir = wd[1];
      break;
    }
  }
  const pkgPath = dir ? join(ROOT, dir, 'package.json') : join(ROOT, 'package.json');
  const pkgScripts = JSON.parse(readFileSync(pkgPath, 'utf8')).scripts ?? {};
  if (!(m[1] in pkgScripts)) {
    report('.github/workflows/ci.yml', `unknown npm script "${m[1]}" for ${dir || 'the repository root'}`);
  }
}

// ------------------------------------------------- package.json scripts
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
  for (const m of String(cmd).matchAll(/(?:^|\s)((?:\.\/)?(?:scripts|tests)\/[\w./-]+\.(?:mjs|js|ts))/g)) {
    if (!existsSync(join(ROOT, m[1]))) report('package.json', `script "${name}" -> missing ${m[1]}`);
  }
}

stats.publicHtml = publicHtml.length;
const coverage =
  `${mdFiles.length} markdown files (${stats.md} document links, ${stats.anchors} heading anchors, ${stats.mdPaths} inline paths), ` +
  `${stats.publicHtml} public HTML pages, ${srcFiles.length} frontend source files (${stats.srcNav} navigation targets), ` +
  `${stats.sitemap} sitemap URLs, ${stats.robots} robots disallows, ${Object.keys(pkg.scripts ?? {}).length} scripts`;

if (problems.length === 0) {
  console.log(`link audit: no broken links found (${coverage})`);
  process.exit(0);
}
console.log(`link audit: ${problems.length} problem(s)\n`);
for (const p of problems) console.log('  ✗ ' + p);
process.exit(1);
