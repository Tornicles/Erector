import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const vocabulary = JSON.parse(await readFile('product/vocabulary.json', 'utf8'));
const checkOnly = process.argv.includes('--check');
async function artifact(path, content) {
  if (checkOnly) assert.equal(await readFile(path, 'utf8'), content, `Generated artifact is stale: ${path}`);
  else await writeFile(path, content);
}
const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key,bucket_id text,name text); alter table storage.objects enable row level security;`);
  for (const file of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()) await db.exec(await readFile('supabase/migrations/'+file,'utf8'));
  const enums = (await db.query("select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as labels from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_namespace n on n.oid=t.typnamespace where n.nspname='tonde' group by t.typname order by t.typname")).rows;
  const columns = (await db.query("select table_name,column_name,data_type,udt_name,is_nullable,column_default from information_schema.columns where table_schema='tonde' order by table_name,ordinal_position")).rows;
  const names = [...new Set(columns.map(c=>c.table_name))];
  const enumNames = new Set(enums.map(e=>e.typname));
  const type = c => enumNames.has(c.udt_name) ? `Database['tonde']['Enums']['${c.udt_name}']` : c.data_type==='jsonb' ? 'Json' : c.data_type==='boolean' ? 'boolean' : /int|numeric|double|real/.test(c.data_type) ? 'number' : c.data_type==='ARRAY' ? 'string[]' : 'string';
  let out = '// Generated from source-controlled PostgreSQL migrations; run node scripts/generate-database-types.mjs.\n';
  out += 'export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];\n';
  out += 'export interface Database {\n  tonde: {\n    Tables: {\n';
  for (const name of names) {
    const cols=columns.filter(c=>c.table_name===name);
    out+=`      ${name}: {\n`;
    for(const mode of ['Row','Insert','Update']) {
      out+=`        ${mode}: {\n`;
      for(const c of cols)out+=`          ${c.column_name}${mode==='Update'||mode==='Insert'&&(c.is_nullable==='YES'||c.column_default!==null)?'?':''}: ${type(c)}${c.is_nullable==='YES'?' | null':''};\n`;
      out+='        };\n';
    }
    out+='        Relationships: [];\n      };\n';
  }
  out += '    };\n    Views: { [_ in never]: never };\n    Functions: {\n';
  out += "      bootstrap_workspace: { Args: Record<string, never>; Returns: string };\n";
  out += "      create_project_with_production: { Args: { target_workspace: string; production_title: string; kind?: Database['tonde']['Enums']['production_type'] }; Returns: string };\n";
  out += '    };\n    Enums: {\n';
  for(const e of enums)out+=`      ${e.typname}: ${e.labels.map(s=>JSON.stringify(s)).join(' | ')};\n`;
  out += '    };\n    CompositeTypes: { [_ in never]: never };\n  };\n}\n';
  await artifact('frontend/src/types/database.ts',out);
  const enumValues = Object.fromEntries(enums.map(e => [e.typname, e.labels]));
  const mappedLabels = { execution_method: 'executionAssignments', production_type: 'productionTypes', approval: 'approvals', result_state: 'resultStates', asset_type: 'assetTypes', reference_rights: 'referenceRights', series_kind: 'seriesKinds', planning_depth: 'planningDepths', sequence_kind: 'sequenceKinds', structure_level: 'structureLevels', generate_horizon: 'generateHorizons', generate_depth: 'generateDepths', dependency_strength: 'dependencyStrengths', dependency_origin: 'dependencyOrigins', impact_class: 'impactClasses', impact_mode: 'impactModes', artifact_kind: 'artifactKinds', stale_state: 'staleStates', continuity_domain: 'continuityDomains', continuity_anchor: 'continuityAnchors', continuity_transition: 'continuityTransitions', continuity_origin: 'continuityOrigins', continuity_finding_kind: 'continuityFindingKinds', continuity_finding_state: 'continuityFindingStates', memory_scope: 'memoryScopes', memory_kind: 'memoryKinds', memory_source: 'memorySources', memory_origin: 'memoryOrigins', branch_state: 'branchStates', branch_change_state: 'branchChangeStates', merge_state: 'mergeStates', access_action: 'accessActions', readiness_state: 'readinessStates', readiness_dimension: 'readinessDimensions', match_verdict: 'matchVerdicts', correction_state: 'correctionStates', correction_recommendation: 'correctionRecommendations', match_origin: 'matchOrigins', publication_state: 'publicationStates', publication_failure_category: 'publicationFailureCategories', export_kind: 'exportActions', export_state: 'exportStates', subscription_state: 'subscriptionStates', entitlement_kind: 'entitlementKinds', entitlement_source: 'entitlementSources', usage_cost_basis: 'usageCostBases', reservation_state: 'reservationStates', webhook_state: 'webhookStates', checkout_state: 'checkoutStates', commercial_actor: 'commercialActors' };
  for (const [name, labels] of Object.entries(mappedLabels)) {
    assert.deepEqual([...enumValues[name]].sort(), Object.keys(vocabulary[labels]).sort(), `Vocabulary differs from SQL enum ${name}`);
  }
  assert.ok(enumValues.execution_method.includes(vocabulary.defaultExecutionFace));
  assert.deepEqual(Object.keys(vocabulary.executionFaces).sort(), enumValues.execution_method.filter(value => value !== 'hybrid').sort());
  let productTypes = '// Generated from PostgreSQL migrations and product/vocabulary.json; do not hand-edit.\n';
  productTypes += 'import type { Database } from "./database";\n';
  productTypes += `export const PRODUCT = ${JSON.stringify(vocabulary, null, 2)} as const;\n`;
  productTypes += `export const DATABASE_VALUES = ${JSON.stringify(enumValues, null, 2)} as const;\n`;
  productTypes += 'export const DEFAULT_EXECUTION_FACE = PRODUCT.defaultExecutionFace;\n';
  productTypes += 'export type ExecutionFace = keyof typeof PRODUCT.executionFaces;\n';
  productTypes += 'export type ExecutionMethod = Database["tonde"]["Enums"]["execution_method"];\n';
  productTypes += 'export type ProductionType = Database["tonde"]["Enums"]["production_type"];\n';
  productTypes += 'export type ApprovalStatus = Database["tonde"]["Enums"]["approval"];\n';
  productTypes += 'export type ResultStatus = Database["tonde"]["Enums"]["result_state"];\n';
  productTypes += 'export type ReferenceRights = Database["tonde"]["Enums"]["reference_rights"];\n';
  productTypes += 'export type DependencyStrength = Database["tonde"]["Enums"]["dependency_strength"];\n';
  productTypes += 'export type DependencyOrigin = Database["tonde"]["Enums"]["dependency_origin"];\n';
  productTypes += 'export type ImpactClass = Database["tonde"]["Enums"]["impact_class"];\n';
  productTypes += 'export type ImpactMode = Database["tonde"]["Enums"]["impact_mode"];\n';
  productTypes += 'export type ArtifactKind = Database["tonde"]["Enums"]["artifact_kind"];\n';
  productTypes += 'export type StaleState = Database["tonde"]["Enums"]["stale_state"];\n';
  productTypes += 'export type ContinuityDomain = Database["tonde"]["Enums"]["continuity_domain"];\n';
  productTypes += 'export type ContinuityAnchor = Database["tonde"]["Enums"]["continuity_anchor"];\n';
  productTypes += 'export type ContinuityTransition = Database["tonde"]["Enums"]["continuity_transition"];\n';
  productTypes += 'export type ContinuityOrigin = Database["tonde"]["Enums"]["continuity_origin"];\n';
  productTypes += 'export type ContinuityFindingKind = Database["tonde"]["Enums"]["continuity_finding_kind"];\n';
  productTypes += 'export type ContinuityFindingState = Database["tonde"]["Enums"]["continuity_finding_state"];\n';
  productTypes += 'export type ClaimKind = typeof PRODUCT.claimKinds[number];\n';
  await artifact('frontend/src/types/product.ts', productTypes);
  let python = '# Generated from PostgreSQL migrations and product/vocabulary.json; do not hand-edit.\nfrom enum import StrEnum\n\n';
  const pythonEnums = { execution_method: 'ExecutionMethod', production_type: 'ProductionType', lifecycle: 'Lifecycle', approval: 'ApprovalStatus', result_state: 'ResultStatus', asset_type: 'AssetCategory', resource_type: 'ResourceCategory', reference_rights: 'ReferenceRights', reference_state: 'ReferenceState', reference_source: 'ReferenceSource', dialogue_kind: 'DialogueKind', scope_inheritance: 'ScopeInheritance', proposal_state: 'ProposalState', series_kind: 'SeriesKind', planning_depth: 'PlanningDepth', sequence_kind: 'SequenceKind', structure_level: 'StructureLevel', generate_horizon: 'GenerateHorizon', generate_depth: 'GenerateDepth', dependency_strength: 'DependencyStrength', dependency_origin: 'DependencyOrigin', impact_class: 'ImpactClass', impact_mode: 'ImpactMode', artifact_kind: 'ArtifactKind', stale_state: 'StaleState', continuity_domain: 'ContinuityDomain', continuity_anchor: 'ContinuityAnchor', continuity_transition: 'ContinuityTransition', continuity_origin: 'ContinuityOrigin', continuity_finding_kind: 'ContinuityFindingKind', continuity_finding_state: 'ContinuityFindingState', memory_scope: 'MemoryScope', memory_kind: 'MemoryKind', memory_source: 'MemorySource', memory_origin: 'MemoryOrigin', branch_state: 'BranchState', branch_change_state: 'BranchChangeState', merge_state: 'MergeState', access_action: 'AccessAction', readiness_state: 'ReadinessState', readiness_dimension: 'ReadinessDimension', match_verdict: 'MatchVerdict', correction_state: 'CorrectionState', correction_recommendation: 'CorrectionRecommendation', match_origin: 'MatchOrigin', publication_state: 'PublicationState', publication_failure_category: 'PublicationFailureCategory', export_kind: 'ExportKind', export_state: 'ExportState', subscription_state: 'SubscriptionState', entitlement_kind: 'EntitlementKind', entitlement_source: 'EntitlementSource', usage_cost_basis: 'UsageCostBasis', reservation_state: 'ReservationState', webhook_state: 'WebhookState', checkout_state: 'CheckoutState', commercial_actor: 'CommercialActor' };
  const emit = (name, values) => { python += `class ${name}(StrEnum):\n`; for (const value of values) python += `    ${value} = ${JSON.stringify(value)}\n`; python += '\n\n'; };
  for (const [name, className] of Object.entries(pythonEnums)) emit(className, enumValues[name]);
  emit('ClaimKind', vocabulary.claimKinds); emit('MediaModality', vocabulary.mediaModalities); emit('AccessState', vocabulary.accessStates);
  emit('CollaborationMode', Object.keys(vocabulary.collaborationModes)); emit('OperationOutcome', vocabulary.operationOutcomes); emit('MutationAction', vocabulary.mutationActions);
  python += `CONSTITUTION_VERSION = ${JSON.stringify(vocabulary.constitutionVersion)}\nDEFAULT_EXECUTION_FACE = ExecutionMethod.${vocabulary.defaultExecutionFace}\n`;
  await artifact('backend/app/domain/vocabulary.py',python);
  console.log(`${checkOnly ? 'Verified' : 'Generated'} ${names.length} tables, ${enums.length} SQL enums and shared product vocabulary.`);
} finally { await db.close(); }
