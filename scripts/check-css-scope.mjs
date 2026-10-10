// Prints unscoped selectors in the ported legacy CSS.
import { readFileSync } from 'node:fs';
const css = readFileSync('frontend/src/marketing/styles/legacy-areas.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const bad = [];
const check = (selector, context) => {
  for (const part of selector.split(',').map((s) => s.trim())) {
    if (!part || part.startsWith('@')) continue;
    if (/^(from|to|\d+%)$/.test(part)) continue;
    if (!part.startsWith('.tmk')) bad.push(`${context}${part}`.slice(0, 100));
  }
};
let depth = 0;
let selStart = 0;
let bodyStart = -1;
for (let k = 0; k < css.length; k++) {
  const ch = css[k];
  if (ch === '{') {
    if (depth === 0) bodyStart = k;
    depth++;
  } else if (ch === '}') {
    depth--;
    if (depth === 0 && bodyStart !== -1) {
      const sel = css.slice(selStart, bodyStart).trim();
      if (sel.startsWith('@media')) {
        const inner = css.slice(bodyStart + 1, k);
        for (const m of inner.matchAll(/([^{}]+)\{/g)) check(m[1].trim(), '@media ');
      } else if (!sel.startsWith('@keyframes')) {
        check(sel, '');
      }
      selStart = k + 1;
      bodyStart = -1;
    }
  }
}
console.log(`unscoped: ${bad.length}`);
console.log(bad.slice(0, 20).join('\n'));
