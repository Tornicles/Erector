// Generates supabase/migrations/202610050030_conflict_sqlstate.sql.
//
// Supabase documents (troubleshooting, "SQLSTATE 40001 (serialization_failure) in an RPC function
// causes infinite retries", last edited 2026-10-08) that raising a custom 40001 tells PostgREST the
// failure is transient, so PostgREST retries the transaction forever: the request never returns, one
// API call becomes several transactions, and the project burns CPU. PostgREST 14 has the behaviour;
// 16 fixes it. The documented repair is a code that maps to the intended HTTP status: the `PT` prefix
// maps to `PTxxx` → HTTP xxx, so `PT409` keeps the conflict an HTTP 409 conflict.
//
// TONDE raises `40001` for optimistic-concurrency conflicts, which is correct as product semantics and
// wrong as a transport signal. This generator reads the *latest* definition of every function that
// still raises it and emits one `create or replace function` per function with only that code changed,
// so the messages, bodies, security mode and search_path are the applied ones byte for byte.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { splitStatements } from './build-idempotent-schema.mjs';

// A non-global pattern is used for detection so `lastIndex` can never leak between statements.
const RETRYABLE_TEST = /errcode\s*=\s*'40001'/;
const RETRYABLE = /errcode\s*=\s*'40001'/g;
const OUTPUT = 'supabase/migrations/202610050030_conflict_sqlstate.sql';
const HEADER = `create function tonde_private.conflict_code() returns text`;
// Trim first: a blank line before a comment block would otherwise defeat the anchor.
const stripLeadingComments = text => text.trim().replace(/^(?:[ \t]*--[^\n]*\n)+/, '').trim();

const latest = new Map();
for (const file of readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort()) {
  if (file.startsWith('202610050030')) continue;
  for (const statement of splitStatements(readFileSync(`supabase/migrations/${file}`, 'utf8'), file)) {
    const text = stripLeadingComments(statement.text);
    const header = text.match(/^create\s+(?:or\s+replace\s+)?function\s+([a-z_]+\.[a-z_]+)\s*\(([^)]*)\)/i);
    if (!header || !RETRYABLE_TEST.test(text)) continue;
    const identity = `${header[1]}(${header[2].replace(/\s+/g, ' ').trim()})`;
    latest.set(identity, { file, text });
  }
}
if (latest.size === 0) throw new Error('No function still raises the retryable conflict code');

const severity = [...latest.values()].filter(v => splitStatements(v.text, v.file).length !== 1);
const siteCount = [...latest.values()].reduce((total, v) => total + (v.text.match(RETRYABLE)?.length ?? 0), 0);
const bodies = [...latest.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([identity, { file, text }]) => {
  const replaced = text.replace(RETRYABLE, "errcode = 'PT409'");
  if (replaced.includes("'40001'")) throw new Error(`${identity} still contains the retryable code`);
  const withReplace = replaced.replace(/^create\s+function\b/i, 'create or replace function');
  return `-- from ${file}\n${withReplace}`;
});

const migration = `-- Forward repair: optimistic-concurrency conflicts were raised with SQLSTATE 40001, which
-- PostgREST treats as a transient serialization failure and retries indefinitely. The request then
-- never returns (reproduced on the linked project: a stale-revision approval did not answer in 60 s
-- while the same statement completed in milliseconds when executed directly), one API call becomes
-- several Postgres transactions, and the project burns CPU. Supabase documents the behaviour and its
-- repair: \"SQLSTATE 40001 (serialization_failure) in an RPC function causes infinite retries\", last
-- edited 2026-10-08 - present in PostgREST 14, fixed in 16; use a code that maps to the intended HTTP
-- status. The PT prefix maps PTxxx to HTTP xxx, so a conflict becomes PT409 and stays an HTTP 409.
--
-- Nothing else changes: the product rule is identical (a stale revision is refused, nothing is
-- applied, no newer state is overwritten, the caller is told to reload), the messages are unchanged,
-- and each function keeps the body, security mode and search_path it already had. These are
-- re-definitions of ${latest.size} applied functions, so migration 029 and every earlier migration stay untouched.
${
  severity.length ? `-- (verified single-statement definitions: ${severity.length === latest.size ? 'all' : `${latest.size - severity.length}/${latest.size}`})\n` : ''
}begin;

${bodies.join('\n\n')}

commit;
`;

writeFileSync(OUTPUT, migration);
console.log(`wrote ${OUTPUT}: ${latest.size} functions re-defined, ${siteCount} conflict raises updated`);
for (const identity of [...latest.keys()].sort()) console.log(' ', identity.slice(0, 100));
