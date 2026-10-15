#!/usr/bin/env node
// Builds ONE idempotent, whole-system Supabase schema SQL file out of
// supabase/migrations/*.sql.
//
// Why: the migrations are ordered, apply-once files. Re-running one against a
// database that already carries its objects fails with `already exists`. This
// script re-emits the same statements in a state-tolerant form, so a single
// paste (Dashboard SQL editor) or `psql -f` run succeeds whether the target
// database is empty, partly migrated, or already complete.
//
// The transformation is mechanical and meaning-preserving. It never rewrites an
// expression, only adds an existence guard (IF NOT EXISTS / DROP IF EXISTS / a
// catalog lookup) or swaps CREATE for CREATE OR REPLACE.
//
// Usage:
//   node scripts/build-idempotent-schema.mjs             # write the built file
//   node scripts/build-idempotent-schema.mjs --check     # verify the built file
//   node scripts/build-idempotent-schema.mjs --inventory  # classify every statement
//   node scripts/build-idempotent-schema.mjs --list <kind[,kind]>

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');

// The artifact is named for the migration range it actually covers, so adding a
// migration renames the output instead of silently leaving a stale file behind.
function coveredRange() {
  const files = migrationFiles();
  if (files.length === 0) throw new Error(`no migrations found in ${MIGRATIONS_DIR}`);
  const short = (f) => String(Number(f.slice(8, 12))).padStart(3, '0');
  return {
    first: files[0].slice(0, 12),
    last: files[files.length - 1].slice(0, 12),
    firstShort: short(files[0]),
    lastShort: short(files[files.length - 1]),
  };
}
export function outputRelative() {
  const { first, lastShort } = coveredRange();
  return `supabase/manual-apply/${first}_to_${lastShort}_full_schema_idempotent.sql`;
}
const OUT_REL = outputRelative();
const OUTPUT_FILE = join(ROOT, OUT_REL);

// Dollar tags for generated guards. The migrations themselves only ever use a
// bare $$, so these cannot collide (asserted below).
const IDEM = '$tonde_idem$';
const DDL = '$tonde_idem_ddl$';

// ---------------------------------------------------------------------------
// Tokenizer: split a migration into top-level statements.
// Respects line comments, (nestable) block comments, single-quoted strings,
// E'...' strings with backslash escapes, "quoted identifiers" and $$ quoting, so
// a semicolon inside any of those never splits a statement.
// ---------------------------------------------------------------------------

const isIdentChar = (ch) => ch !== undefined && /[A-Za-z0-9_$]/.test(ch);

// Returns the index just past a comment / string / dollar-quoted span starting at
// i, or -1 when text[i] does not begin one.
function skipToken(text, i, label) {
  const c = text[i];
  const n = text.length;

  if (c === '-' && text[i + 1] === '-') {
    while (i < n && text[i] !== '\n') i++;
    return i;
  }

  if (c === '/' && text[i + 1] === '*') {
    let depth = 1;
    i += 2;
    while (i < n && depth > 0) {
      if (text[i] === '/' && text[i + 1] === '*') {
        depth++;
        i += 2;
      } else if (text[i] === '*' && text[i + 1] === '/') {
        depth--;
        i += 2;
      } else i++;
    }
    return i;
  }

  if (c === '$') {
    const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(i));
    if (!m) return -1;
    const end = text.indexOf(m[0], i + m[0].length);
    if (end === -1) throw new Error(`${label}: unterminated dollar quote ${m[0]}`);
    return end + m[0].length;
  }

  // E'...' before a bare '...' so the E stays part of the token.
  if ((c === 'E' || c === 'e') && text[i + 1] === "'" && !isIdentChar(text[i - 1])) {
    i += 2;
    while (i < n) {
      if (text[i] === '\\') {
        i += 2;
        continue;
      }
      if (text[i] === "'") {
        if (text[i + 1] === "'") {
          i += 2;
          continue;
        }
        return i + 1;
      }
      i++;
    }
    return i;
  }

  if (c === "'") {
    i++;
    while (i < n) {
      if (text[i] === "'") {
        if (text[i + 1] === "'") {
          i += 2;
          continue;
        }
        return i + 1;
      }
      i++;
    }
    return i;
  }

  if (c === '"') {
    i++;
    while (i < n) {
      if (text[i] === '"') {
        if (text[i + 1] === '"') {
          i += 2;
          continue;
        }
        return i + 1;
      }
      i++;
    }
    return i;
  }

  return -1;
}

function splitStatements(sql, label) {
  const out = [];
  const n = sql.length;
  let start = 0;
  let i = 0;
  let line = 1;
  let startLine = 1;

  const push = (end) => {
    const text = sql.slice(start, end);
    if (text.trim()) out.push({ text, line: startLine });
  };

  while (i < n) {
    const skipped = skipToken(sql, i, label);
    if (skipped !== -1) {
      line += (sql.slice(i, skipped).match(/\n/g) || []).length;
      i = skipped;
      continue;
    }

    if (sql[i] === ';') {
      push(i + 1);
      i++;
      start = i;
      startLine = line;
      continue;
    }

    if (sql[i] === '\n') line++;
    i++;
  }

  push(n);
  return out;
}

// A string literal must be followed by a delimiter, never directly by an identifier
// character or another quote. Catches an unescaped quote inside a generated literal
// (e.g. `= 'a='b''`), which tokenizes but is not valid SQL.
function badLiteralAdjacencies(text, label) {
  const bad = [];
  const okNext = /[\s,);\]:.\-+*/%<>=!|&^?~#@{\[]/;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const isEscapedString =
      (c === 'E' || c === 'e') && text[i + 1] === "'" && !isIdentChar(text[i - 1]);
    if (c === "'" || isEscapedString) {
      const end = skipToken(text, i, label);
      const next = text[end];
      if (next !== undefined && !okNext.test(next)) {
        bad.push(`${JSON.stringify(next)} after a string literal near: ${text.slice(Math.max(0, end - 70), end + 10).replace(/\s+/g, ' ')}`);
      }
      i = end;
      continue;
    }
    const skipped = skipToken(text, i, label);
    if (skipped !== -1) {
      i = skipped;
      continue;
    }
    i++;
  }
  return bad;
}

// Net parenthesis depth, ignoring parens inside comments, strings and dollar quotes.
function netParens(text, label) {
  let depth = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const skipped = skipToken(text, i, label);
    if (skipped !== -1) {
      i = skipped;
      continue;
    }
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    i++;
  }
  return depth;
}

// ---------------------------------------------------------------------------
// Statement classification
// ---------------------------------------------------------------------------

function splitLead(text) {
  let i = 0;
  const n = text.length;
  for (;;) {
    while (i < n && /\s/.test(text[i])) i++;
    if (text.startsWith('--', i)) {
      const nl = text.indexOf('\n', i);
      i = nl === -1 ? n : nl + 1;
      continue;
    }
    if (text.startsWith('/*', i)) {
      let depth = 0;
      let j = i;
      for (; j < n; j++) {
        if (text.startsWith('/*', j)) {
          depth++;
          j++;
        } else if (text.startsWith('*/', j)) {
          depth--;
          j++;
          if (depth === 0) {
            j++;
            break;
          }
        }
      }
      i = j;
      continue;
    }
    break;
  }
  return { lead: text.slice(0, i), body: text.slice(i) };
}

export function normalize(text) {
  const { body } = splitLead(text);
  return body.replace(/\s+/g, ' ').trim();
}

const RULES = [
  ['tx', /^(begin|commit|rollback)\b/i],
  ['create_schema', /^create schema\b/i],
  ['create_extension', /^create extension\b/i],
  ['create_table', /^create table\b/i],
  ['create_index', /^create (unique )?index\b/i],
  ['create_function', /^create (or replace )?function\b/i],
  ['create_procedure', /^create (or replace )?procedure\b/i],
  ['create_policy', /^create policy\b/i],
  ['create_trigger', /^create (constraint )?trigger\b/i],
  ['create_type', /^create type\b/i],
  ['create_view', /^create (or replace )?view\b/i],
  ['create_sequence', /^create sequence\b/i],
  ['alter_table_add_column', /^alter table [^;]*\badd column\b/i],
  ['alter_table_add_constraint', /^alter table [^;]*\badd constraint\b/i],
  [
    'alter_table_add_other',
    /^alter table [^;]*\badd (foreign key|unique|primary key|check|exclude)\b/i,
  ],
  ['alter_table_drop_constraint', /^alter table [^;]*\bdrop constraint\b/i],
  ['alter_table_drop_column', /^alter table [^;]*\bdrop column\b/i],
  [
    'alter_table_attach',
    /^alter table [^;]*\b(enable|disable|force|no force|validate|owner to|replica identity|cluster)\b/i,
  ],
  ['alter_table_other', /^alter table\b/i],
  ['alter_type_add_value', /^alter type [^;]*\badd value\b/i],
  ['alter_type_other', /^alter type\b/i],
  ['alter_function_set_schema', /^alter function [^;]*\bset schema\b/i],
  ['alter_function_other', /^alter function\b/i],
  ['drop_policy', /^drop policy\b/i],
  ['drop_trigger', /^drop trigger\b/i],
  ['drop_function', /^drop function\b/i],
  ['drop_type', /^drop type\b/i],
  ['drop_index', /^drop index\b/i],
  ['insert', /^insert into\b/i],
  ['do_block', /^do\b/i],
  ['grant', /^grant\b/i],
  ['revoke', /^revoke\b/i],
  ['select', /^select\b/i],
  ['create_or_replace_other', /^create or replace\b/i],
  ['comment_on', /^comment on\b/i],
  ['set', /^set\b/i],
  ['reset', /^reset\b/i],
  ['alter_default_privileges', /^alter default privileges\b/i],
  ['alter_schema', /^alter schema\b/i],
  ['alter_policy', /^alter policy\b/i],
  ['security_label', /^security label\b/i],
  ['update', /^update\b/i],
  ['delete', /^delete\b/i],
];

export function classify(text) {
  const norm = normalize(text);
  if (!norm) return 'comment_only';
  for (const [name, re] of RULES) if (re.test(norm)) return name;
  return 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// Constraint-definition normalization
//
// Mirrors, in SQL and in JS, one canonical form for a constraint definition so
// an already-present constraint can be recognised without knowing the name
// PostgreSQL auto-generated for it. Both sides go through the same six steps:
//
//   1. lower-case            4. x <> ALL (ARRAY[...])  ->  x not in [...]
//   2. drop "tonde."         5. x = ANY (ARRAY[...])   ->  x in [...]
//   3. drop whitespace, ( ) [ ]   6. drop "::text"
//
// Step 4/5 exist because PostgreSQL deparses IN (...) as = ANY (ARRAY[...]).
// ---------------------------------------------------------------------------

// Casts are removed while whitespace still separates tokens: collapsing whitespace
// first would let `::text` swallow the following keyword (`...::text or ...`).
function sqlNormalize(expr) {
  let s = `lower(${expr})`;
  s = `regexp_replace(${s}, 'tonde\\.', '', 'g')`;
  s = `regexp_replace(${s}, '::[a-z_][a-z0-9_.]*', '', 'g')`;
  s = `regexp_replace(${s}, '[\\s()\\[\\]]', '', 'g')`;
  s = `regexp_replace(${s}, '''', '', 'g')`;
  s = `regexp_replace(${s}, '<>allarray', 'notin', 'g')`;
  s = `regexp_replace(${s}, '=anyarray', 'in', 'g')`;
  return s;
}

function jsNormalize(text) {
  return text
    .toLowerCase()
    .replace(/tonde\./g, '')
    .replace(/::[a-z_][a-z0-9_.]*/g, '')
    .replace(/[\s()[\]]/g, '')
    .replace(/'/g, '')
    .replace(/<>allarray/g, 'notin')
    .replace(/=anyarray/g, 'in');
}

// A DO block that iterates a catalog query sees whatever tables exist at the time it
// runs, so re-running one over a populated database would create objects a first run
// never created. Pinning the loop to the tables present at this point in the migration
// order makes it behave identically either way.
function pinCatalogTableLoops(body, ctx) {
  if (!ctx.tables) return body;
  return body.replace(
    /from\s+information_schema\.columns\s+where\s+table_schema\s*=\s*'([A-Za-z_]\w*)'/gi,
    (match, schema) => {
      const list = ctx.tables.get(schema) || [];
      if (!list.length) return match;
      const names = list.map((t) => `'${t.slice(t.indexOf('.') + 1)}'`).join(',');
      return `${match}\n      and table_name::text = any(array[${names}])`;
    },
  );
}

// ---------------------------------------------------------------------------
// Guard builders
// ---------------------------------------------------------------------------

function guardDo(predicateSql, innerStatement) {
  return [
    `do ${IDEM}`,
    `begin`,
    `  if ${predicateSql} then`,
    `    execute ${DDL}${innerStatement}${DDL};`,
    `  end if;`,
    `end`,
    `${IDEM};`,
  ].join('\n');
}

function guardType(innerStatement) {
  return [
    `do ${IDEM}`,
    `begin`,
    `  execute ${DDL}${innerStatement}${DDL};`,
    `exception when duplicate_object then null;`,
    `end`,
    `${IDEM};`,
  ].join('\n');
}

function stripSemicolon(s) {
  return s.replace(/;\s*$/, '');
}

// ---------------------------------------------------------------------------
// Dynamic DDL (`execute format('...')`) inside DO blocks
// ---------------------------------------------------------------------------

function createdFunctionIdentity(statement) {
  const { body } = splitLead(statement);
  const match = /^create\s+(?:or\s+replace\s+)?function\s+([A-Za-z_]\w*\.[A-Za-z_]\w*)\s*\(/i.exec(body);
  if (!match) return null;

  const open = match[0].lastIndexOf('(');
  let depth = 1;
  let close = open + 1;
  while (close < body.length && depth > 0) {
    const skipped = skipToken(body, close, 'function declaration');
    if (skipped !== -1) {
      close = skipped;
      continue;
    }
    if (body[close] === '(') depth++;
    else if (body[close] === ')') depth--;
    close++;
  }
  if (depth !== 0) throw new Error(`unterminated function declaration: ${normalize(body).slice(0, 120)}`);

  const types = splitTopLevelCommas(body.slice(open + 1, close - 1)).flatMap((declaration) => {
    let argument = declaration.trim();
    if (!argument) return [];
    argument = argument.replace(/\s+default\s+[\s\S]*$/i, '').replace(/\s*=\s*[\s\S]*$/, '').trim();
    const mode = /^(inout|in|out|variadic)\s+/i.exec(argument);
    const isOutput = mode?.[1].toLowerCase() === 'out';
    if (mode) argument = argument.slice(mode[0].length).trim();
    if (isOutput) return [];
    const named = /^[A-Za-z_]\w*\s+([\s\S]+)$/.exec(argument);
    return [named ? named[1].trim() : argument];
  });
  return `${match[1]}(${types.join(',')})`;
}

function splitTopLevelCommas(s) {
  const out = [];
  let depth = 0;
  let inStr = false;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      cur += c;
      if (c === "'") {
        if (s[i + 1] === "'") {
          cur += s[++i];
          continue;
        }
        inStr = false;
      }
      continue;
    }
    if (c === "'") {
      inStr = true;
      cur += c;
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

function unquoteSqlLiteral(lit) {
  const t = lit.trim();
  if (!t.startsWith("'") || !t.endsWith("'")) return t;
  return t.slice(1, -1).replace(/''/g, "'");
}

function placeholdersOf(text) {
  const list = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '%') continue;
    if (text[i + 1] === '%') {
      i++;
      continue;
    }
    if ('Ils'.includes(text[i + 1])) {
      list.push({ pos: i, spec: text[i + 1] });
      i++;
    }
  }
  return list;
}

function placeholderArgIndex(formatText, posInFormatText) {
  return placeholdersOf(formatText).findIndex((p) => p.pos === posInFormatText);
}

// Rewrites one `execute format(...)` call so the DDL it runs is repeat-safe.
function guardDynamicDdl(callText, formatLiteral, args) {
  const fmt = unquoteSqlLiteral(formatLiteral);
  const argFor = (idx) => args[idx + 1];

  // create trigger <name> ... on <prefix>%I ...
  let m = /^create\s+(?:constraint\s+)?trigger\s+([A-Za-z_][A-Za-z0-9_"]*)\s+[\s\S]*?\bon\s+([\s\S]*?)%I/i.exec(fmt);
  if (m) {
    const name = m[1];
    const prefix = m[2];
    const idx = placeholderArgIndex(fmt, m.index + m[0].length - 2);
    const target = argFor(idx);
    if (target === undefined) throw new Error(`cannot resolve trigger target for: ${fmt}`);
    return (
      `execute format('drop trigger if exists ${name} on ${prefix}%I', ${target});\n` + callText
    );
  }

  // create policy <name> on <prefix>%I ...
  //
  // Policies are created only when absent, never dropped and re-created. Several of
  // them name helpers that migration 010 later moves into tonde_private, so
  // re-creating one would have to resolve a name that no longer exists. A policy
  // that is already in its final (post-move) form must simply be left alone.
  m = /^create\s+policy\s+([A-Za-z_][A-Za-z0-9_"]*)\s+on\s+([\s\S]*?)([A-Za-z_]\w*)\.%I/i.exec(fmt);
  if (m) {
    const name = m[1];
    const schema = m[3];
    const idx = placeholderArgIndex(fmt, m.index + m[0].length - 2);
    const target = argFor(idx);
    if (target === undefined) throw new Error(`cannot resolve policy target for: ${fmt}`);
    // Ends without a semicolon: the original call's trailing `;` closes `end if`.
    return [
      `if not exists (`,
      `      select 1 from pg_policies`,
      `      where schemaname = ${sqlString(schema)} and tablename = ${target} and policyname = ${sqlString(name)}`,
      `    ) then`,
      `      ${callText};`,
      `    end if`,
    ].join('\n');
  }

  // alter table <prefix>%I add constraint %I ...
  m = /^alter\s+table\s+([\s\S]*?)%I\s+add\s+constraint\s+%I/i.exec(fmt);
  if (m) {
    const prefix = m[1];
    const tableIdx = placeholderArgIndex(fmt, m.index + m[0].length - 2 - ' add constraint %I'.length);
    const nameIdx = placeholderArgIndex(fmt, m.index + m[0].length - 2);
    const tableArg = argFor(tableIdx);
    const nameArg = argFor(nameIdx);
    if (tableArg === undefined || nameArg === undefined) {
      throw new Error(`cannot resolve constraint target for: ${fmt}`);
    }
    // Ends without a semicolon on purpose: the original call's trailing `;`
    // terminates the generated `end if`, and the inner execute gets its own.
    return [
      `if not exists (`,
      `      select 1 from pg_constraint`,
      `      where conrelid = format('${prefix}%I', ${tableArg})::regclass`,
      `        and conname = ${nameArg}`,
      `    ) then`,
      `      ${callText};`,
      `    end if`,
    ].join('\n');
  }

  return callText;
}

function rewriteDoBlock(body) {
  let out = '';
  let i = 0;
  const n = body.length;
  const marker = 'execute format(';
  while (i < n) {
    const idx = body.indexOf(marker, i);
    if (idx === -1) {
      out += body.slice(i);
      break;
    }
    let j = idx + marker.length;
    let depth = 1;
    let inStr = false;
    while (j < n && depth > 0) {
      const c = body[j];
      if (inStr) {
        if (c === "'") {
          if (body[j + 1] === "'") {
            j += 2;
            continue;
          }
          inStr = false;
        }
        j++;
        continue;
      }
      if (c === "'") {
        inStr = true;
        j++;
        continue;
      }
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) break;
      }
      j++;
    }
    const callText = body.slice(idx, j + 1);
    const inner = body.slice(idx + marker.length, j);
    const args = splitTopLevelCommas(inner);
    out += body.slice(i, idx) + guardDynamicDdl(callText, args[0], args);
    i = j + 1;
  }
  return out;
}

// `alter table S.T alter column C type NEWTYPE using ...`
//
// Re-running this on a column that already has NEWTYPE is meant to be a no-op, but it
// is not one: PostgreSQL refuses to alter a column used in a policy definition (0A000)
// regardless of whether the type actually changes. So the conversion is guarded on the
// column still carrying a different type, and the policy that migration 006 drops for
// the same reason is guarded identically - otherwise the drop would strip a policy that
// can no longer be re-created, because its expression names a helper 010 has since
// moved out of the exposed schema.
function columnConversion(body) {
  // Takes raw statement text too, so normalize before matching: a statement always
  // carries the newline that ended the previous one.
  const m = /^alter\s+table\s+([A-Za-z_]\w*)\s*\.\s*([A-Za-z_]\w*)\s+alter\s+column\s+([A-Za-z_]\w*)\s+type\s+([A-Za-z_][\w.]*)\s+using\b/i.exec(
    normalize(body),
  );
  if (!m) return null;
  const [, schema, table, column, targetType] = m;
  return {
    table,
    predicate:
      `(select a.atttypid from pg_attribute a` +
      `\n      where a.attrelid = to_regclass(${sqlString(`${schema}.${table}`)}) and a.attname = ${sqlString(column)})` +
      `\n    is distinct from to_regtype(${sqlString(targetType)})`,
  };
}

// The conversion a migration performs on `table`, if it performs one.
function pairedConversion(ctx, table) {
  for (let i = ctx.index + 1; i < ctx.statements.length; i++) {
    const conversion = columnConversion(ctx.statements[i].text);
    if (conversion && conversion.table === table) return conversion;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Statement transformation
// ---------------------------------------------------------------------------

// Matches `schema.name(arg types)` as GRANT/REVOKE statements spell a function.
const FUNCTION_SIGNATURE_RE = /\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(([^)]*)\)/g;

const UPSERT_CONFLICT_TARGET = {
  'storage.buckets': 'id',
  'tonde.ai_providers': 'key',
};

// Functions a later migration MOVES out of the schema that created them (the five
// membership/storage helpers migration 010 relocates into tonde_private).
//
// Without special handling these break re-runnability: the creating migration would
// happily recreate the pre-move copy in the exposed schema, and the later
// `alter function ... set schema` would then collide with the function that already
// lives at the destination (42723 duplicate_function). So the creator is guarded on
// the DESTINATION already existing, and the move additionally refuses to run when the
// destination is occupied.
let MOVED_FUNCTIONS = new Map(); // "schema.name" -> destination schema

function collectMovedFunctions(migrations) {
  const moved = new Map();
  for (const m of migrations) {
    for (const st of m.statements) {
      const mm = /^alter\s+function\s+([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\([^)]*\)\s+set\s+schema\s+([A-Za-z_]\w*)/i.exec(
        normalize(st.text),
      );
      if (mm) moved.set(`${mm[1]}.${mm[2]}`, mm[3]);
    }
  }
  return moved;
}

export function transformStatement(text, ctx = {}) {
  const { lead, body } = splitLead(text);
  const kind = classify(text);
  return lead + transformBody(kind, body, ctx);
}

function transformBody(kind, body, ctx = {}) {
  const namedConstraint = /^alter\s+table\s+([A-Za-z_][\w.]*)\s+(?:add|drop)\s+constraint\s+([A-Za-z_][\w]*)/i.exec(body);
  if (namedConstraint && ctx.finalConstraints?.has(`${namedConstraint[1]}.${namedConstraint[2]}`)) {
    const final = ctx.finalConstraints.get(`${namedConstraint[1]}.${namedConstraint[2]}`);
    const isFinalAdd = kind === 'alter_table_add_constraint' && normalize(body) === final;
    if (!isFinalAdd) {
      return guardDo(`not exists (select 1 from pg_constraint c where c.conrelid=to_regclass(${sqlString(namedConstraint[1])})
        and c.conname=${sqlString(namedConstraint[2])} and ${sqlNormalize('pg_get_constraintdef(c.oid)')}=${sqlString(jsNormalize(stripSemicolon(final.replace(/^alter\s+table\s+\S+\s+add\s+constraint\s+\S+\s+/i,''))))})`,
        kind === 'alter_table_drop_constraint' ? stripSemicolon(body.replace(/drop constraint /i,'drop constraint if exists '))
          : stripSemicolon(body));
    }
  }
  switch (kind) {
    case 'create_schema':
      return body.replace(/^(create\s+schema\s+)/i, '$1if not exists ');

    case 'create_extension':
      return body.replace(/^(create\s+extension\s+)/i, '$1if not exists ');

    case 'create_table':
      if (/^create\s+table\s+if\s+not\s+exists\b/i.test(body)) return body;
      return body.replace(/^(create\s+table\s+)/i, '$1if not exists ');

    case 'create_index':
      if (/^create\s+(unique\s+)?index\s+if\s+not\s+exists\b/i.test(body)) return body;
      return body.replace(/^(create\s+unique\s+index\s+|create\s+index\s+)/i, (m) => `${m}if not exists `);

    case 'create_function': {
      const out = /^create\s+or\s+replace\s+function\b/i.test(body)
        ? body
        : body.replace(/^(create\s+)function\b/i, '$1or replace function');
      const mm = /^create\s+or\s+replace\s+function\s+([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(/i.exec(out);
      const destination = mm ? MOVED_FUNCTIONS.get(`${mm[1]}.${mm[2]}`) : undefined;
      if (!destination) return out;
      return guardDo(
        `not exists (\n    select 1 from pg_proc p\n    join pg_namespace n on n.oid = p.pronamespace\n    where n.nspname = '${destination}'\n      and p.proname = '${mm[2]}'\n  )`,
        stripSemicolon(out),
      );
    }

    case 'create_type':
      return guardType(stripSemicolon(body));

    case 'create_policy': {
      const m = /^create\s+policy\s+([A-Za-z_][A-Za-z0-9_"]*)\s+on\s+([A-Za-z_]\w*)\s*\.\s*([A-Za-z_][A-Za-z0-9_"]*)/i.exec(body);
      if (!m) throw new Error(`create policy not understood: ${normalize(body).slice(0, 120)}`);
      const [, name, schema, table] = m;
      return guardDo(
        `not exists (\n    select 1 from pg_policies\n    where schemaname = ${sqlString(schema)}\n      and tablename = ${sqlString(table)}\n      and policyname = ${sqlString(name)}\n  )`,
        stripSemicolon(body),
      );
    }

    case 'create_trigger': {
      const m = /^create\s+(?:constraint\s+)?trigger\s+([A-Za-z_][A-Za-z0-9_"]*)\s+[\s\S]*?\bon\s+([A-Za-z_][A-Za-z0-9_."]*)/i.exec(body);
      if (!m) throw new Error(`create trigger not understood: ${normalize(body).slice(0, 120)}`);
      return `drop trigger if exists ${m[1]} on ${m[2]};\n${body}`;
    }

    case 'alter_table_add_column': {
      // PostgreSQL only accepts IF NOT EXISTS on a single ADD COLUMN action, so a
      // multi-action ALTER TABLE is emitted as one guarded statement per action. The
      // resulting schema is identical; only the statement count changes.
      const head = /^(alter\s+table\s+[A-Za-z_][A-Za-z0-9_."]*\s+)/i.exec(body);
      if (!head) return body;
      const actions = splitTopLevelCommas(stripSemicolon(body).slice(head[1].length));
      return actions
        .map((action) => {
          const guarded = /^add\s+column\s+if\s+not\s+exists\b/i.test(action)
            ? action
            : action.replace(/^add\s+column\s+/i, 'add column if not exists ');
          return `${head[1]}${guarded};`;
        })
        .join('\n');
    }

    case 'alter_table_add_constraint': {
      const m = /^alter\s+table\s+([A-Za-z_][A-Za-z0-9_."]*)\s+add\s+constraint\s+([A-Za-z_][A-Za-z0-9_"]*)/i.exec(body);
      if (!m) throw new Error(`add constraint not understood: ${normalize(body).slice(0, 120)}`);
      const [, table, name] = m;
      return guardDo(
        `not exists (\n    select 1 from pg_constraint\n    where conrelid = to_regclass('${table}') and conname = '${name}'\n  )`,
        stripSemicolon(body),
      );
    }

    case 'alter_table_add_other': {
      const m = /^alter\s+table\s+([A-Za-z_][A-Za-z0-9_."]*)\s+add\s+([\s\S]+)$/i.exec(body);
      if (!m) throw new Error(`unnamed constraint not understood: ${normalize(body).slice(0, 120)}`);
      const table = m[1];
      const def = stripSemicolon(m[2]);
      // Constraint definitions routinely contain string literals (e.g. `bucket <> 'x'`),
      // so the expected value must be a properly escaped SQL literal.
      const expected = sqlString(jsNormalize(def));
      return guardDo(
        `not exists (\n    select 1 from pg_constraint c\n    where c.conrelid = to_regclass('${table}')\n      and ${sqlNormalize('pg_get_constraintdef(c.oid)')}\n        = ${expected}\n  )`,
        stripSemicolon(body),
      );
    }

    case 'alter_table_drop_constraint':
      if (/\bdrop\s+constraint\s+if\s+exists\b/i.test(body)) return body;
      return body.replace(/\bdrop\s+constraint\s+/i, 'drop constraint if exists ');

    case 'drop_policy': {
      // The migrations drop a policy exactly once, in migration 006, immediately before
      // re-creating it after a column changes type. That drop is only meaningful while
      // the policy still names a pre-move helper; once it carries the final references,
      // dropping it would just force a re-create that can no longer resolve them.
      const m = /^drop\s+policy\s+(?:if\s+exists\s+)?([A-Za-z_][A-Za-z0-9_"]*)\s+on\s+([A-Za-z_]\w*)\s*\.\s*([A-Za-z_][A-Za-z0-9_"]*)/i.exec(body);
      if (m && ctx.statements) {
        const paired = pairedConversion(ctx, m[3]);
        if (paired) return guardDo(paired.predicate, stripSemicolon(body));
      }
      if (/\bdrop\s+policy\s+if\s+exists\b/i.test(body)) return body;
      return body.replace(/\bdrop\s+policy\s+/i, 'drop policy if exists ');
    }

    case 'drop_trigger':
      if (/\bdrop\s+trigger\s+if\s+exists\b/i.test(body)) return body;
      return body.replace(/\bdrop\s+trigger\s+/i, 'drop trigger if exists ');

    case 'alter_function_set_schema': {
      const m = /^alter\s+function\s+([\s\S]+?)\s+set\s+schema\s+([A-Za-z_][A-Za-z0-9_."]*)\s*$/i.exec(stripSemicolon(body));
      if (!m) throw new Error(`set schema not understood: ${normalize(body).slice(0, 120)}`);
      const signature = m[1].trim();
      const destination = m[2];
      // The argument list of `alter function` is types only, so the destination
      // signature is the same argument list under the destination schema.
      const dot = signature.indexOf('.');
      const moved = `${destination}.${signature.slice(dot + 1)}`;
      return guardDo(
        `to_regprocedure('${signature}') is not null\n    and to_regprocedure('${moved}') is null`,
        stripSemicolon(body),
      );
    }

    case 'alter_type_add_value': {
      const m = /^alter\s+type\s+([A-Za-z_][A-Za-z0-9_."]*)\s+add\s+value\s+'([^']*)'/i.exec(body);
      if (!m) throw new Error(`add value not understood: ${normalize(body).slice(0, 120)}`);
      const [, qualified, label] = m;
      const dot = qualified.indexOf('.');
      const schema = dot === -1 ? 'public' : qualified.slice(0, dot);
      const typeName = dot === -1 ? qualified : qualified.slice(dot + 1);
      // A plain subselect on pg_namespace rather than to_regnamespace(), so the guard
      // depends on nothing beyond the catalog itself.
      return guardDo(
        `not exists (\n    select 1 from pg_enum e\n    join pg_type t on t.oid = e.enumtypid\n    where t.typnamespace = (select oid from pg_namespace where nspname = '${schema}')\n      and t.typname = '${typeName}'\n      and e.enumlabel = '${label}'\n  )`,
        stripSemicolon(body),
      );
    }

    case 'insert': {
      const m = /^insert\s+into\s+([A-Za-z_][A-Za-z0-9_."]*)/i.exec(body);
      if (!m) return body;
      const target = m[1];
      if (/\bon\s+conflict\b/i.test(body)) return body;
      // A backfill `insert ... select` that proves the row is absent carries its own
      // idempotency, so it needs no conflict target - and must not be given one: those
      // rows are keyed by a composite, so a single-column ON CONFLICT would be wrong.
      if (backfillProvesAbsent(normalize(body))) return body;
      const column = UPSERT_CONFLICT_TARGET[target];
      if (!column) throw new Error(`insert has no declared conflict target: ${target}`);
      return stripSemicolon(body) + `\non conflict (${column}) do nothing;\n`;
    }

    case 'grant':
    case 'revoke': {
      // `grant ... on all tables in schema X` is a wildcard: it covers whatever tables
      // exist when it runs. Re-running it over a database that already has later tables
      // would silently widen the role's privileges, so it is expanded to the exact set
      // of tables that existed at this point in the migration order - which is the same
      // set it covered the first time round.
      const normalized = normalize(body);
      const functionWildcard = /^grant\s+execute\s+on\s+all\s+functions\s+in\s+schema\s+([A-Za-z_]\w*)\s+to\s+([\s\S]+)$/i.exec(normalized);
      if (functionWildcard && ctx.functions) {
        const [, schema, roles] = functionWildcard;
        const list = ctx.functions.get(schema) || [];
        if (!list.length) return `-- no functions existed in schema ${schema} at this migration point\n`;
        return `grant execute on function ${list.join(', ')} to ${stripSemicolon(roles)};\n`;
      }

      const wildcard = /^grant\s+([\s\S]+?)\s+on\s+all\s+tables\s+in\s+schema\s+([A-Za-z_]\w*)\s+to\s+([\s\S]+)$/i.exec(
        normalized,
      );
      if (wildcard && ctx.tables) {
        const [, privileges, schema, roles] = wildcard;
        const list = ctx.tables.get(schema) || [];
        if (list.length) {
          return `grant ${privileges} on table ${list.join(', ')} to ${stripSemicolon(roles)};\n`;
        }
      }

      // GRANT/REVOKE name objects by signature and fail outright when one is missing.
      // These statements run before migration 010 moves the five helpers, so on a
      // re-run their pre-move names no longer resolve. Skipping is safe: 010 asserts
      // the final ACLs on the moved functions itself, and grants already made persist.
      const refs = [...body.matchAll(FUNCTION_SIGNATURE_RE)].map((m) =>
        `${m[1]}.${m[2]}(${m[3].replace(/\s+/g, ' ').trim()})`,
      );
      if (!refs.some((r) => MOVED_FUNCTIONS.has(r.slice(0, r.indexOf('('))))) return body;
      const predicate = refs
        .map((r) => `to_regprocedure(${sqlString(r)}) is not null`)
        .join('\n    and ');
      return guardDo(predicate, stripSemicolon(body));
    }

    case 'alter_table_other': {
      const conversion = columnConversion(body);
      if (!conversion) return body;
      return guardDo(conversion.predicate, stripSemicolon(body));
    }

    case 'do_block':
      return pinCatalogTableLoops(guardBareTriggers(rewriteDoBlock(body)), ctx);

    default:
      return body;
  }
}

// ---------------------------------------------------------------------------
// Migration discovery
// ---------------------------------------------------------------------------

export function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{12}_.*\.sql$/.test(f))
    .sort();
}

export function readMigrations() {
  return migrationFiles().map((file) => {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    return { file, sql, statements: splitStatements(sql, file) };
  });
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function banner(text) {
  const line = '-- ' + '='.repeat(74);
  return `${line}\n-- ${text}\n${line}\n`;
}

function build() {
  const migrations = readMigrations();
  const range = coveredRange();
  MOVED_FUNCTIONS = collectMovedFunctions(migrations);

  for (const m of migrations) {
    if (m.sql.includes(IDEM) || m.sql.includes(DDL)) {
      throw new Error(`${m.file} already contains a generated guard tag`);
    }
  }

  // Objects that exist at each point in the migration order, so wildcard grants can be
  // pinned to the same set they covered when the migration was first applied.
  const runningTables = new Map(); // schema -> ordered table names
  const runningFunctions = new Map(); // schema -> ordered function identity signatures
  const finalConstraints = new Map();
  const constraintVersions = new Map();
  for (const migration of migrations) for (const statement of migration.statements) {
    const text = normalize(statement.text);
    const match = /^alter table (\S+) add constraint (\S+) /i.exec(text);
    if (match) {
      const key = `${match[1]}.${match[2]}`;
      finalConstraints.set(key,text);
      constraintVersions.set(key,(constraintVersions.get(key)||0)+1);
    }
  }
  for (const [key,count] of constraintVersions) if (count<2) finalConstraints.delete(key);

  const sections = [];
  migrations.forEach((m, mi) => {
    const parts = m.statements.map((st, index) => {
      const out = transformStatement(st.text, {
        statements: m.statements,
        index,
        tables: runningTables,
        functions: runningFunctions,
        finalConstraints,
      }).trimEnd();
      const created = /^create\s+table\s+(?:if\s+not\s+exists\s+)?([A-Za-z_]\w*)\s*\.\s*([A-Za-z_]\w*)/i.exec(
        normalize(st.text),
      );
      if (created) {
        const [, schema, table] = created;
        if (!runningTables.has(schema)) runningTables.set(schema, []);
        const list = runningTables.get(schema);
        if (!list.includes(table)) list.push(`${schema}.${table}`);
      }
      const functionIdentity = createdFunctionIdentity(st.text);
      if (functionIdentity) {
        const movedTo = MOVED_FUNCTIONS.get(functionIdentity.slice(0, functionIdentity.indexOf('(')));
        const finalIdentity = movedTo
          ? `${movedTo}.${functionIdentity.slice(functionIdentity.indexOf('.') + 1)}`
          : functionIdentity;
        const dot = finalIdentity.indexOf('.');
        const schema = finalIdentity.slice(0, dot);
        if (!runningFunctions.has(schema)) runningFunctions.set(schema, []);
        const list = runningFunctions.get(schema);
        if (!list.includes(finalIdentity)) list.push(finalIdentity);
      }
      return out;
    });
    const head = banner(m.file);
    // Keep the file's very first bytes executable SQL: lift migration 001's `begin;`
    // above its own leading comment and banner.
    let prefix = '';
    if (mi === 0 && /^begin\s*;$/i.test(normalize(parts[0]))) {
      const { lead, body } = splitLead(parts.shift());
      prefix = `${body.trim()}\n${lead}`;
    }
    sections.push(`${prefix}${head}\n${parts.join('\n')}\n`);
  });

  // Names only. Function argument lists carry defaults with string literals
  // (`default 'custom'`), which cannot be embedded in the verification array without
  // escaping, and to_regprocedure() does not accept argument names or defaults anyway.
  const tables = new Set();
  const rpcs = new Set();
  for (const m of migrations) {
    for (const st of m.statements) {
      const kind = classify(st.text);
      if (kind === 'create_table') {
        const mm = /^create\s+table\s+(?:if\s+not\s+exists\s+)?([A-Za-z_][A-Za-z0-9_."]*)/i.exec(
          normalize(st.text),
        );
        if (mm) tables.add(mm[1]);
      }
      if (kind === 'create_function') {
        const mm = /^create\s+(?:or\s+replace\s+)?function\s+([A-Za-z_][A-Za-z0-9_."]*)\s*\(/i.exec(
          normalize(st.text),
        );
        if (mm) rpcs.add(MOVED_FUNCTIONS.has(mm[1]) ? mm[1].replace(/^tonde\./, 'tonde_private.') : mm[1]);
      }
    }
  }

  // Deliberately no leading banner: the file must begin with executable SQL, per
  // supabase/manual-apply/README.md (a dropped first character then shows up as a
  // loud `syntax error at or near "egin"` instead of silently corrupting a comment).
  const header = '';

  const ledgerBlock = [
    banner('Optional: record these migrations in the Supabase ledger'),
    `-- The Dashboard SQL editor does not record migration history. If you apply this file`,
    `-- by hand and later want supabase CLI operations to agree that ${range.firstShort}-${range.lastShort} are applied,`,
    `-- uncomment the block at the very bottom and run just that block. It is repeat-safe.`,
    ``,
  ].join('\n');

  const ledgerSql = [
    banner('Optional ledger repair (commented out - run only if you applied this by hand)'),
    `-- insert into supabase_migrations.schema_migrations (version, name) values`,
    migrations
      .map((m, i) => {
        const version = m.file.slice(0, 12);
        const name = m.file.slice(13).replace(/\.sql$/, '');
        const comma = i === migrations.length - 1 ? '' : ',';
        return `--   ('${version}', '${name}')${comma}`;
      })
      .join('\n'),
    `-- on conflict (version) do nothing;`,
    ``,
  ].join('\n');

  const verify = [
    banner('Verification - every row must read OK'),
    `-- Any MISSING row means the object above did not get created; re-run after fixing the`,
    `-- reported error. A second run of this whole file never reports an error.`,
    ``,
    `select kind, name, case when present then 'OK' else 'MISSING' end as result`,
    `from (`,
    `  select 'table' as kind, n as name, to_regclass(n) is not null as present`,
    `  from unnest(array[`,
    ...chunk([...tables], 3).map((row, i, all) => {
      const items = row.map((t) => sqlString(t)).join(', ');
      const comma = i === all.length - 1 ? '' : ',';
      return `    ${items}${comma}`;
    }),
    `  ]) as n`,
    `  union all`,
    `  -- functions are matched by schema and name; overloads are not distinguished`,
    `  select 'function', n, exists (`,
    `    select 1 from pg_proc p`,
    `    join pg_namespace ns on ns.oid = p.pronamespace`,
    `    where ns.nspname = split_part(n, '.', 1)`,
    `      and p.proname = split_part(n, '.', 2)`,
    `  )`,
    `  from unnest(array[`,
    ...chunk([...rpcs], 3).map((row, i, all) => {
      const items = row.map((r) => sqlString(r)).join(', ');
      const comma = i === all.length - 1 ? '' : ',';
      return `    ${items}${comma}`;
    }),
    `  ]) as n`,
    `) checks`,
    `order by kind, name;`,
    ``,
  ].join('\n');

  const footer = [
    banner('TONDE - complete Supabase schema, idempotent single-run apply'),
    `-- Generated by scripts/build-idempotent-schema.mjs from supabase/migrations/`,
    `-- (${range.first} .. ${range.last}). Do not edit by hand; edit the migrations and`,
    `-- regenerate with:  node scripts/build-idempotent-schema.mjs`,
    `--`,
    `-- This is the whole system in one file, written so that ONE run succeeds whether the`,
    `-- target database is empty, partly migrated, or already complete. Existing objects are`,
    `-- skipped or reconciled only by the explicit guards below; an incompatible same-name`,
    `-- object is NOT silently treated as success and may still produce a real SQL error.`,
    `-- Every statement is state-tolerant:`,
    `--`,
    `-- Each source migration begins its own transaction; this bundle retains that order.`,
    `-- If any statement fails, stop and inspect that error before retrying; later migrations`,
    `-- may not have run. This file does not edit the Supabase migration ledger.`,
    `--   * create schema / table / index   ->  IF NOT EXISTS`,
    `--   * create [or replace] function    ->  CREATE OR REPLACE FUNCTION`,
    `--   * create policy / trigger         ->  DROP ... IF EXISTS, then CREATE`,
    `--   * create type                     ->  guarded, duplicate_object is ignored`,
    `--   * alter table add column          ->  ADD COLUMN IF NOT EXISTS`,
    `--   * alter table add [constraint]    ->  skipped when an equivalent constraint`,
    `--                                         already exists (matched by name, or by a`,
    `--                                         normalized pg_get_constraintdef)`,
    `--   * alter table drop constraint     ->  DROP CONSTRAINT IF EXISTS`,
    `--   * alter type ... add value        ->  skipped when the label already exists`,
    `--   * alter function ... set schema   ->  skipped when the function already moved`,
    `--   * insert into seeded tables       ->  ON CONFLICT DO NOTHING`,
    `--`,
    `-- IF NOT EXISTS skips duplicate-object errors but does not validate that an existing`,
    `-- same-name object has the intended definition. Incompatible drift is allowed to fail`,
    `-- loudly; do not blanket-catch SQL errors or mark missing verification rows OK.`,
    `--`,
    `-- Existing rows, and objects created by an earlier partial run, are preserved where`,
    `-- statements are guarded. Each migration keeps its own transaction; if a statement`,
    `-- fails, stop and inspect it before retrying: later migrations may not have run.`,
    `--`,
    `-- Run it with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f <this file>`,
    `-- or paste it into the Supabase Dashboard SQL editor.`,
    `-- Manual application will not update Supabase's migration history; reconcile it only`,
    `-- after verifying the actual schema, never just to silence a pending-migration list.`,
    `--`,
    `-- This file is deliberately byte-faithful to supabase/migrations/*.sql apart from the`,
    `-- added guards, so it inherits the two non-ASCII characters those files contain`,
    `-- (a '\u00b7' separator literal and a '\u00a7' in a comment, both in migration 016).`,
    `-- They are preserved rather than transliterated because the separator is used at run`,
    `-- time; the file is UTF-8.`,
    ``,
  ].join('\n');

  const body = [header, ...sections, ledgerBlock, verify, ledgerSql, footer]
    .filter((part) => part !== '')
    .join('\n');

  return { body, tables, rpcs };
}

// A DO block may hold plain DDL rather than dynamic SQL. A bare `create trigger` in one is
// made repeat-safe exactly like a top-level trigger - drop it first - and the drop has to
// repeat the create's own ON clause, because a trigger name is only unique per table.
function guardBareTriggers(body) {
  const out = [];
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    // Copy comments and string literals verbatim, so a commented-out or quoted
    // `create trigger` is never mistaken for executable DDL.
    if (c === '-' && body[i + 1] === '-') {
      const end = body.indexOf('\n', i);
      const stop = end === -1 ? body.length : end;
      out.push(body.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === '/' && body[i + 1] === '*') {
      const end = body.indexOf('*/', i + 2);
      const stop = end === -1 ? body.length : end + 2;
      out.push(body.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < body.length) {
        if (body[j] === "'") {
          if (body[j + 1] === "'") {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      out.push(body.slice(i, j));
      i = j;
      continue;
    }
    if (/^create\s+trigger\s/i.test(body.slice(i, i + 20))) {
      const m = /^create\s+trigger\s+([A-Za-z_][A-Za-z0-9_"]*)[\s\S]*?\bon\s+([A-Za-z_][A-Za-z0-9_."]*)/i.exec(
        body.slice(i),
      );
      if (m) out.push(`drop trigger if exists ${m[1]} on ${m[2]};\n  `);
    }
    out.push(c);
    i++;
  }
  return out.join('');
}

// A SQL single-quoted string literal with embedded quotes doubled.
function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// True when a top-level `insert ... select` proves the row it inserts is absent, which
// makes the statement repeat-safe without an ON CONFLICT clause. This is the shape a
// later migration uses to backfill rows for existing records rather than inventing data.
function backfillProvesAbsent(text) {
  const m = /^insert\s+into\s+([A-Za-z_][A-Za-z0-9_."]*)/i.exec(text);
  if (!m || !/\bselect\b/i.test(text) || !/not\s+exists/i.test(text)) return false;
  const bare = m[1].slice(m[1].indexOf('.') + 1).toLowerCase();
  return text.toLowerCase().includes(bare);
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function check() {
  if (!existsSync(OUTPUT_FILE)) {
    console.error(`missing ${OUT_REL}`);
    process.exit(1);
  }
  const sql = readFileSync(OUTPUT_FILE, 'utf8');
  const statements = splitStatements(sql, OUT_REL);
  const migrations = readMigrations();
  const problems = [];
  if (sql !== build().body) problems.push('artifact differs byte-for-byte from the current migration build; regenerate it');

  // The file must begin with executable SQL, not a comment: see the "Copying safely"
  // section of supabase/manual-apply/README.md.
  if (!/^begin\s*;/i.test(sql)) problems.push('file does not start with executable SQL');

  // The build must not introduce any character the migrations did not already contain.
  const srcNonAscii = new Set();
  for (const m of migrations) for (const ch of m.sql) if (ch.charCodeAt(0) > 127) srcNonAscii.add(ch);
  const outNonAscii = new Set();
  for (const ch of sql) if (ch.charCodeAt(0) > 127) outNonAscii.add(ch);
  for (const ch of outNonAscii) {
    if (!srcNonAscii.has(ch)) {
      const cp = ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0');
      problems.push(`non-ASCII character U+${cp} introduced by the build`);
    }
  }

  for (let si = 0; si < statements.length; si++) {
    const st = statements[si];
    const kind = classify(st.text);
    const norm = normalize(st.text);
    const prevNorm = si > 0 ? normalize(statements[si - 1].text) : '';
    const lc = norm.toLowerCase();

    if (kind === 'UNKNOWN') problems.push(`unclassified statement: ${norm.slice(0, 100)}`);
    if (/;;/.test(st.text)) problems.push(`empty statement (;;): ${norm.slice(0, 100)}`);
    if (kind === 'create_table' && !/^create table if not exists\b/i.test(norm)) {
      problems.push(`unguarded create table: ${norm.slice(0, 100)}`);
    }
    if (kind === 'create_index' && !/^create (unique )?index if not exists\b/i.test(norm)) {
      problems.push(`unguarded create index: ${norm.slice(0, 100)}`);
    }
    if (kind === 'create_function' && !/^create or replace function\b/i.test(norm)) {
      problems.push(`unguarded create function: ${norm.slice(0, 100)}`);
    }
    if (kind === 'create_schema' && !/^create schema if not exists\b/i.test(norm)) {
      problems.push(`unguarded create schema: ${norm.slice(0, 100)}`);
    }
    if (kind === 'alter_table_add_column' && !/\badd column if not exists\b/i.test(norm)) {
      problems.push(`unguarded add column: ${norm.slice(0, 100)}`);
    }
    if (kind === 'alter_table_drop_constraint' && !/\bdrop constraint if exists\b/i.test(norm)) {
      problems.push(`unguarded drop constraint: ${norm.slice(0, 100)}`);
    }
    if (kind === 'drop_policy' && !/^drop policy if exists\b/i.test(norm)) {
      problems.push(`unguarded drop policy: ${norm.slice(0, 100)}`);
    }

    // A policy is created only when absent (never dropped and re-created), so it must
    // be inside a generated guard rather than preceded by a drop.
    if (kind === 'create_policy' && !lc.startsWith('do ')) {
      problems.push(`unguarded create policy: ${norm.slice(0, 100)}`);
    }
    // A trigger is dropped and re-created, so the drop must be the previous statement.
    if (kind === 'create_trigger') {
      const m = /^create (?:constraint )?trigger ([A-Za-z_][\w"]*)[\s\S]*?\bon ([A-Za-z_][\w."]*)/i.exec(norm);
      const expected = m ? `drop trigger if exists ${m[1]} on ${m[2]}`.toLowerCase() : null;
      if (!expected || !prevNorm.toLowerCase().startsWith(expected)) {
        problems.push(`create trigger not immediately preceded by its drop: ${norm.slice(0, 100)}`);
      }
    }

    if (kind === 'create_type' && !lc.startsWith('do ')) {
      problems.push(`unguarded create type: ${norm.slice(0, 100)}`);
    }
    if ((kind === 'alter_table_add_constraint' || kind === 'alter_table_add_other') && !lc.startsWith('do ')) {
      problems.push(`unguarded add constraint: ${norm.slice(0, 100)}`);
    }
    if (kind === 'insert' && !/\bon conflict\b/i.test(norm) && !backfillProvesAbsent(norm)) {
      problems.push(`insert without conflict handling: ${norm.slice(0, 100)}`);
    }
    if (kind === 'alter_type_add_value' && !lc.startsWith('do ')) {
      problems.push(`unguarded alter type add value: ${norm.slice(0, 100)}`);
    }
    if (kind === 'alter_function_set_schema' && !lc.startsWith('do ')) {
      problems.push(`unguarded alter function set schema: ${norm.slice(0, 100)}`);
    }

    // Dynamic DDL inside a DO block needs a guard: a drop immediately earlier for
    // triggers, an enclosing `if not exists` for policies.
    if (kind === 'do_block') {
      const textLc = st.text.toLowerCase();
      // Plain DDL inside the block is guarded the same way as at the top level: a drop
      // immediately before the create, naming the same table.
      for (const m of st.text.matchAll(
        /create\s+trigger\s+([A-Za-z_][A-Za-z0-9_"]*)[\s\S]*?\bon\s+([A-Za-z_][A-Za-z0-9_."]*)/gi,
      )) {
        const needed = `drop trigger if exists ${m[1]} on ${m[2]}`.toLowerCase();
        if (!st.text.slice(0, m.index).toLowerCase().includes(needed)) {
          problems.push(`create trigger in a DO block without a drop: ${m[1]} on ${m[2]}`);
        }
      }
      for (const [create, drop, label] of [
        ["execute format('create trigger", "execute format('drop trigger", 'trigger'],
        ["execute format('create policy", "execute format('drop policy", 'policy'],
      ]) {
        const idx = textLc.indexOf(create);
        if (idx === -1) continue;
        const recent = textLc.slice(Math.max(0, idx - 400), idx);
        if (!recent.includes(drop) && !(label === 'policy' && recent.includes('if not exists ('))) {
          problems.push(`dynamic create ${label} without a drop or guard: ${norm.slice(0, 100)}`);
        }
      }
    }
  }

  // Every generated guard must be a well-formed block holding exactly one guarded call.
  const guardBlocks = [...sql.matchAll(/do \$tonde_idem\$([\s\S]*?)\$tonde_idem\$;/g)].map((x) => x[1]);
  if (guardBlocks.length === 0) problems.push('no generated guard blocks found');
  for (const g of guardBlocks) {
    // IF EXISTS inside a quoted DDL payload is not a PL/pgSQL branch.
    const control = g.replace(/\$tonde_idem_ddl\$[\s\S]*?\$tonde_idem_ddl\$/g, '')
      .replace(/'(?:''|[^'])*'/g, '');
    const opens = (control.match(/(?<!end )\bif\b/g) || []).length;
    const closes = (control.match(/\bend if\b/g) || []).length;
    const short = g.replace(/\s+/g, ' ').slice(0, 90);
    if (opens !== closes) problems.push(`guard has unbalanced if/end if: ${short}`);
    const executes = (g.match(/execute \$tonde_idem_ddl\$/g) || []).length;
    if (executes !== 1) problems.push(`guard does not hold exactly one guarded call: ${short}`);
    if (opens === 0 && !/exception when duplicate_object then null;/.test(g)) {
      problems.push(`guard neither checks nor handles an existing object: ${short}`);
    }
  }

  // Guarded payloads must be non-empty and must not carry their own delimiter.
  for (const m of sql.matchAll(/\$tonde_idem_ddl\$([\s\S]*?)\$tonde_idem_ddl\$/g)) {
    if (!m[1].trim()) problems.push('empty guarded statement payload');
    if (m[1].includes('$tonde_idem_ddl$')) problems.push('guarded payload contains its own delimiter');
  }

  // Parentheses must balance in every statement, and no string literal may run into
  // the token that follows it.
  for (const st of statements) {
    const depth = netParens(st.text, OUT_REL);
    if (depth !== 0) problems.push(`unbalanced parentheses (${depth}): ${normalize(st.text).slice(0, 90)}`);
    for (const b of badLiteralAdjacencies(st.text, OUT_REL)) {
      problems.push(`malformed string literal: ${b}`);
    }
  }

  // Object-set conservation: every object the migrations create must appear.
  const expectedTables = new Set();
  const expectedRpcs = new Set();
  const expectedTypes = new Set();
  const expectedPolicies = new Set();
  const expectedIndexes = new Set();
  for (const m of migrations) {
    for (const st of m.statements) {
      const n = normalize(st.text);
      let mm;
      if ((mm = /^create table (if not exists )?([A-Za-z_][\w."]*)/i.exec(n))) expectedTables.add(mm[2]);
      if ((mm = /^create (?:or replace )?function ([A-Za-z_][\w."]*)\s*\(([^)]*)\)/i.exec(n))) {
        expectedRpcs.add(`${mm[1]}(${mm[2].trim()})`);
      }
      if ((mm = /^create type ([A-Za-z_][\w."]*)/i.exec(n))) expectedTypes.add(mm[1]);
      if ((mm = /^create policy ([A-Za-z_][\w"]*) on ([A-Za-z_][\w."]*)/i.exec(n))) {
        expectedPolicies.add(`${mm[1]} on ${mm[2]}`);
      }
      if ((mm = /^create (?:unique )?index ([A-Za-z_][\w"]*)/i.exec(n))) expectedIndexes.add(mm[1]);
    }
  }

  const seen = { tables: new Set(), rpcs: new Set(), types: new Set(), policies: new Set(), indexes: new Set() };
  for (const st of statements) {
    if (classify(st.text) === 'comment_only') continue;
    const n = normalize(st.text);
    let mm;
    if ((mm = /^create table if not exists ([A-Za-z_][\w."]*)/i.exec(n))) seen.tables.add(mm[1]);
    // functions may be wrapped in a guard, so scan the whole statement body
    for (const f of st.text.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([A-Za-z_][\w."]*)\s*\(([^)]*)\)/gi)) {
      seen.rpcs.add(`${f[1]}(${f[2].replace(/\s+/g, ' ').trim()})`);
    }
    // policies are wrapped in a guard, so scan the whole statement body
    for (const p of st.text.matchAll(/create\s+policy\s+([A-Za-z_][\w"]*)\s+on\s+([A-Za-z_][\w."]*)/gi)) {
      seen.policies.add(`${p[1]} on ${p[2]}`);
    }
    if ((mm = /^create (?:unique )?index if not exists ([A-Za-z_][\w"]*)/i.exec(n))) {
      seen.indexes.add(mm[1]);
    }
    // created types are wrapped in a guard, so scan the whole statement body
    for (const t of st.text.matchAll(/create\s+type\s+([A-Za-z_][\w."]*)/gi)) seen.types.add(t[1]);
  }

  for (const [label, expected, actual] of [
    ['table', expectedTables, seen.tables],
    ['rpc', expectedRpcs, seen.rpcs],
    ['type', expectedTypes, seen.types],
    ['policy', expectedPolicies, seen.policies],
    ['index', expectedIndexes, seen.indexes],
  ]) {
    for (const name of expected) if (!actual.has(name)) problems.push(`missing ${label} in output: ${name}`);
  }

  const counts = {
    migrations: migrations.length,
    statements: statements.length,
    tables: seen.tables.size,
    rpcs: seen.rpcs.size,
    types: seen.types.size,
    policies: seen.policies.size,
    indexes: seen.indexes.size,
  };

  if (outNonAscii.size) {
    const cps = [...outNonAscii]
      .map((c) => `U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
      .join(', ');
    console.log(`note: preserved non-ASCII characters from the migrations: ${cps} (informational)`);
  }

  if (problems.length) {
    console.error(`FAILED - ${problems.length} problem(s):`);
    for (const p of problems.slice(0, 40)) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log('OK - output is fully guarded and object-complete.');
  console.log(JSON.stringify(counts, null, 2));
}

// ---------------------------------------------------------------------------
// Inventory / listing
// ---------------------------------------------------------------------------

function inventory() {
  const migrations = readMigrations();
  const counts = new Map();
  const unknown = [];
  for (const m of migrations) {
    for (const st of m.statements) {
      const kind = classify(st.text);
      counts.set(kind, (counts.get(kind) || 0) + 1);
      if (kind === 'UNKNOWN') unknown.push(`${m.file}:${st.line}  ${normalize(st.text).slice(0, 140)}`);
    }
  }
  const total = migrations.reduce((a, m) => a + m.statements.length, 0);
  console.log(`files: ${migrations.length}   statements: ${total}\n`);
  for (const [kind, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${kind}`);
  }
  console.log(unknown.length ? `\nUNKNOWN (${unknown.length}):\n  ${unknown.join('\n  ')}` : '\nNo UNKNOWN statements.');
}

function listKind(kinds) {
  for (const m of readMigrations()) {
    for (const st of m.statements) {
      const kind = classify(st.text);
      if (kinds.includes(kind)) {
        console.log(`${kind}\t${m.file}:${st.line}\t${normalize(st.text).slice(0, 300)}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--inventory')) {
    inventory();
  } else if (args.includes('--list')) {
    listKind(args[args.indexOf('--list') + 1].split(','));
  } else if (args.includes('--check')) {
    check();
  } else {
    const { body, tables, rpcs } = build();
    writeFileSync(OUTPUT_FILE, body, 'utf8');
    console.log(`wrote ${OUT_REL}`);
    console.log(`  tables: ${tables.size}  functions: ${rpcs.size}  bytes: ${body.length}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

export { OUTPUT_FILE, OUT_REL, splitStatements, build, check };
