import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
const read=path=>readFile(path,'utf8');
test('authoritative versioned constitution is discoverable and records conflict/amendment governance',async()=>{
  const constitution=await read('docs/product/constitution.md');
  for(const phrase of ['# TONDE Product Constitution','1.0.0','2026-10-05','When implementation behavior','explicitly resolved','Revision history','TONDE — Your AI Production Director','Show TONDE what you want to make. TONDE tells you exactly how to make it.'])assert.ok(constitution.includes(phrase),phrase);
  for(const path of ['README.md','AGENTS.md','docs/architecture.md','docs/schema-evolution.md'])assert.ok((await read(path)).includes('constitution.md'),`${path} does not reference authority`);
});
test('every Prompt 2 numbered requirement is accounted for as PASS or external BLOCKED',async()=>{
  const report=await read('docs/product/compliance.md');const covered=new Set();
  for(const line of report.split('\n')){
    const match=line.match(/^\| (\d+)(?:[–-](\d+))? \| (.+?) \|/);if(!match)continue;
    const start=Number(match[1]),end=Number(match[2]??match[1]);assert.match(match[3],/^PASS/);
    for(let id=start;id<=end;id++){assert.ok(!covered.has(id),`Duplicate requirement ${id}`);covered.add(id);}
  }
  assert.deepEqual([...covered].sort((a,b)=>a-b),Array.from({length:110},(_,i)=>i+1));
  assert.ok(report.includes('BLOCKED hosted')&&report.includes('two real authenticated users'));
});
test('stable invariant register includes all minimum non-negotiable rules and future-policy distinction',async()=>{
  const source=await read('docs/product/invariants.md');
  const ids=[...source.matchAll(/^\| (INV-\d+) \|/gm)].map(m=>m[1]);
  assert.equal(new Set(ids).size,32);
  for(let id=1;id<=32;id++)assert.ok(ids.includes(`INV-${String(id).padStart(2,'0')}`));
  assert.ok(source.includes('policy entries')&&source.includes('require workflow/output evaluation'));
});
test('constitution covers every product responsibility, safety boundary and decision dimension',async()=>{
  const source=await read('docs/product/constitution.md');
  for(const phrase of ['Shot Match production loop','Create from Scratch','Image','Replace Subject','Intelligent Brief','Generate Ahead','Character Lock','World Lock','Product Lock','Style Bible','Voice cloning','semantic production timeline','Production Memory','Readiness','Non-goals','Deterministic application','Decision and amendment','Observed','Estimated','Recommended','DOWNLOAD FULL DOCUMENT','EXPORT PRODUCTION PACKAGE','PROPOSE → PREVIEW IMPACT → APPLY'])assert.ok(source.toLowerCase().includes(phrase.toLowerCase()),phrase);
  for(const area of ['HOME','STUDIO','PROJECTS','DISCOVER','ASSETS','SETUP','SETTINGS'])assert.ok(source.includes(`| ${area} |`));
  const glossary=await read('docs/product/glossary.md');
  for(const term of ['Project','Production','Series','Episode','Act','Sequence','Scene','Shot','Reference','Asset','Setup','Settings','Lock','Approval','Version','Result','Shot Match','Real Execution','AI Execution','Hybrid','Production Bible'])assert.ok(glossary.includes(`| ${term}`),term);
});
test('product vocabulary pins constitutional version, exact category boundaries and separates display/SQL semantics',async()=>{
  const vocabulary=JSON.parse(await read('product/vocabulary.json'));
  assert.equal(vocabulary.constitutionVersion,'1.0.0');assert.equal(vocabulary.defaultExecutionFace,'real');
  assert.equal(Object.keys(vocabulary.productionTypes).length,24);
  assert.deepEqual(Object.keys(vocabulary.areas),['home','studio','projects','discover','assets','setup','settings']);
  assert.deepEqual(Object.keys(vocabulary.executionFaces),['real','ai']);
  assert.equal(vocabulary.executionAssignments.hybrid,'SHOOT + AI');
  for(const path of ['frontend/src/types/product.ts','backend/app/domain/vocabulary.py'])assert.ok((await read(path)).startsWith(path.endsWith('.py')?'# Generated':'// Generated'));
});
test('documentation links resolve inside the workspace rather than relying on chats',async()=>{
  for(const path of ['README.md','AGENTS.md','docs/product/constitution.md','docs/product/glossary.md','docs/product/invariants.md','docs/product/compliance.md']){
    const source=await read(path);
    for(const match of source.matchAll(/\]\(([^)]+)\)/g)){
      const target=match[1].split('#')[0];if(!target||/^https?:/.test(target))continue;
      const base=path.includes('/')?path.slice(0,path.lastIndexOf('/')+1):'';
      await access(base+target);
    }
  }
});
