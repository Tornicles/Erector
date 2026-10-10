import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
const read=path=>readFile(path,'utf8');
test('authoritative versioned constitution is discoverable and records conflict/amendment governance',async()=>{
  const constitution=await read('docs/product/constitution.md');
  for(const phrase of ['# TONDE Product Constitution','1.2.0','2026-10-08','When implementation behavior','explicitly resolved','Revision history','TONDE — Your AI Production Director','Show TONDE what you want to make. TONDE tells you exactly how to make it.'])assert.ok(constitution.includes(phrase),phrase);
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
  assert.equal(new Set(ids).size,54);
  for(let id=1;id<=54;id++)assert.ok(ids.includes(`INV-${String(id).padStart(2,'0')}`));
  assert.ok(source.includes('policy entries')&&source.includes('require workflow/output evaluation'));
});
test('constitution covers every product responsibility, safety boundary and decision dimension',async()=>{
  const source=await read('docs/product/constitution.md');
  for(const phrase of ['Shot Match production loop','Create from Scratch','Image','Replace Subject','Intelligent Brief','Generate Ahead','Character Lock','World Lock','Product Lock','Style Bible','Voice cloning','semantic production timeline','Production Memory','Readiness','Non-goals','Deterministic application','Decision and amendment','Observed','Estimated','Recommended','DOWNLOAD FULL DOCUMENT','EXPORT PRODUCTION PACKAGE','PROPOSE → PREVIEW IMPACT → APPLY','Production Kit','Reference Truth','Creator Purpose','Audio Plan','Music Direction','Sound Direction'])assert.ok(source.toLowerCase().includes(phrase.toLowerCase()),phrase);
  for(const area of ['HOME','STUDIO','PROJECTS','DISCOVER','ASSETS','SETUP','SETTINGS'])assert.ok(source.includes(`| ${area} |`));
  const glossary=await read('docs/product/glossary.md');
  for(const term of ['Project','Production','Series','Episode','Act','Sequence','Scene','Shot','Reference','Asset','Production Kit','Settings','Lock','Approval','Version','Result','Shot Match','Real Execution','AI Execution','Hybrid','Production Bible','Audio Plan','Music Direction','Sound Direction'])assert.ok(glossary.includes(`| ${term}`),term);
});
test('product vocabulary pins constitutional version, exact category boundaries and separates display/SQL semantics',async()=>{
  const vocabulary=JSON.parse(await read('product/vocabulary.json'));
  assert.equal(vocabulary.constitutionVersion,'1.3.0');assert.equal(vocabulary.effectiveDate,'2026-10-09');assert.equal(vocabulary.defaultExecutionFace,'real');
  assert.equal(Object.keys(vocabulary.productionTypes).length,24);
  assert.deepEqual(Object.keys(vocabulary.areas),['home','studio','projects','discover','assets','setup','settings']);
  assert.equal(vocabulary.areas.setup.title,'Production Kit');
  assert.deepEqual(Object.keys(vocabulary.executionFaces),['real','ai']);
  assert.equal(vocabulary.executionAssignments.hybrid,'SHOOT + AI');
  // TONDE directs the creator's external execution rather than generating the media itself.
  assert.equal(vocabulary.executionAssignments.ai,'AI PLAYBOOK');
  for(const path of ['frontend/src/types/product.ts','backend/app/domain/vocabulary.py'])assert.ok((await read(path)).startsWith(path.endsWith('.py')?'# Generated':'// Generated'));
});
test('amendment D records the external publication, export and commercial laws with their invariants',async()=>{
  const constitution=await read('docs/product/constitution.md');
  for(const phrase of ['Amendment D — External publication, export and commercial integrity','A publication pins exact truth',
    'Publication is a creator act','External systems are evidence, not truth','Unknown stays unknown',
    'Retries must not duplicate real-world actions','No credential lives in TONDE','Billing is server-authoritative',
    'Money keeps its meanings apart','Exports pin their version','External actions keep provenance and stay auditable',
    'destination state unknown','not a social-media scheduler'])
    assert.ok(constitution.includes(phrase),phrase);
  const invariants=await read('docs/product/invariants.md');
  assert.ok(invariants.includes('1.2.0 adds INV-40–48'));
  const glossary=await read('docs/product/glossary.md');
  for(const term of ['Publication','Publishing authorization','Destination connection','Destination state unknown',
    'Reconciliation','Export artifact','Entitlement','Usage event','Subscription','Webhook receipt'])
    assert.ok(glossary.includes(`| ${term} |`),term);
  const compliance=await read('docs/product/compliance.md');
  assert.ok(compliance.includes('1.2.0 (2026-10-08)')&&compliance.includes('Prompt 10 constitutional amendment (v1.2.0)'));
  assert.ok(compliance.includes('BLOCKED hosted')&&compliance.includes('two real authenticated users'));
});

test('amendment E records the Director law with its invariants, vocabulary and compliance entry',async()=>{
  const constitution=await read('docs/product/constitution.md');
  for(const phrase of ['Amendment E — TONDE is the Director, not the media generator',
    'TONDE is the production Director, not the final media-generation engine',
    'The product loop ends in a check, not a render','AI Creation is an execution strategy TONDE directs',
    'Documented knowledge is not a connection','External AI tools are execution destinations, not TONDE Production truth',
    'Every Result returns to TONDE','TONDE bills for the TONDE service only','The optional connector stays optional'])
    assert.ok(constitution.includes(phrase),phrase);
  const invariants=await read('docs/product/invariants.md');
  assert.ok(invariants.includes('1.3.0 adds INV-49–54'));
  for(const id of ['INV-49','INV-50','INV-51','INV-52','INV-53','INV-54'])
    assert.ok(invariants.includes(`| ${id} |`),id);
  const glossary=await read('docs/product/glossary.md');
  for(const term of ['Director','AI Playbook','AI Tool Knowledge','External AI tool','Result check','External tool cost','TONDE cost'])
    assert.ok(glossary.includes(`| ${term} |`),term);
  const compliance=await read('docs/product/compliance.md');
  assert.ok(compliance.includes('1.3.0 (2026-10-09)')&&compliance.includes('Prompt 11 constitutional amendment (v1.3.0, the Director correction)'));
  // The vocabulary names the AI execution strategy as a playbook the creator runs, not a TONDE render.
  const vocabulary=JSON.parse(await read('product/vocabulary.json'));
  assert.equal(vocabulary.executionAssignments.ai,'AI PLAYBOOK');
  assert.equal(vocabulary.concepts.director,'Director');
  assert.equal(vocabulary.concepts.toolKnowledge,'AI Tool Knowledge');
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
