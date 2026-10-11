import { expect, test, type Page } from '@playwright/test';

// Prompt 9D versioning, branches, restore and merge end-to-end: history is inspectable and
// immutable, a restore creates a new revision instead of rewinding, a branch is an alternative
// whose edits touch nothing on the mainline, and a merge is a reviewed decision in which a conflict
// is shown rather than resolved on the creator's behalf. The API is stubbed at the network
// boundary, so the browser provably never decides any of this itself: it cannot rewind history, it
// cannot apply a conflicted change, it cannot claim a merge is an approval, and it never asks for a
// scope or propagation the API does not support.
const uid = '00000000-0000-4000-8000-000000000001';
const workspace = '00000000-0000-4000-8000-000000000002';
const projectId = '00000000-0000-4000-8000-000000000001';
const productionId = '00000000-0000-4000-8000-000000000003';
const sceneTwo = '00000000-0000-4000-8000-000000000301';
const shotTwelve = '00000000-0000-4000-8000-000000000401';
const storyId = '00000000-0000-4000-8000-000000000601';
const versionOne = '00000000-0000-4000-8000-000000000c01';
const versionTwo = '00000000-0000-4000-8000-000000000c02';
const branchOne = '00000000-0000-4000-8000-000000000d01';
const changeOne = '00000000-0000-4000-8000-000000000d02';
const proposalOne = '00000000-0000-4000-8000-000000000e01';

const RULE = 'A branch is an object-level alternative, not a duplicate Production. Mainline history is never overwritten: a restore and a merge both create a new current revision.';
const LIMITATION = 'Compare shows the meaningful creative fields that differ. It is not a raw JSON diff and it does not judge which version is better.';
const IMMUTABLE = 'Versions are immutable records of what the object was. Historical versions are never edited.';
const NOT_APPROVAL = 'Merging creates revisions and marks dependent artifacts. It is not an approval.';

const envelope = (data: unknown) => ({ success: true, data, errors: null, metadata: { request_id: 'e2e-ver', timestamp: '2026-10-05T00:00:00Z', version: '1' } });
const provider = { provider: 'openai_compatible', configured: false, model_profile: 'default', capabilities: [], notes: [], ffmpeg_available: false, ffmpeg_note: 'ffmpeg is not installed.' };

const production = { id: productionId, workspace_id: workspace, project_id: projectId, title: 'Marquee film', production_type: 'short_film', custom_type: null, execution_method: 'real', lifecycle: 'active', approval: 'draft', locked_at: null, planned_duration_ms: 600000, calculated_duration_ms: 600000, start_ms: 0, end_ms: null, created_by: uid, revision: 7, created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:00:00Z' };
const shot = { id: shotTwelve, scene_id: sceneTwo, order: 1, sort_order: 1024, title: 'Marcus close-up', description: 'Marcus leaves.', action: '', purpose: 'product', subject: 'Marcus', framing: 'medium close up', angle: 'eye level', movement: 'static', composition: 'lower third', transition: 'cut', story_relationship: 'proves the decision', story_beat: 'Break', creative_notes: '', execution_method: 'real', planned_duration_ms: 8000, approval: 'draft', locked_at: null, revision: 4, updated_at: '2026-10-05T00:00:00Z', result_count: 0, bindings: [] };

const studioModel = {
  production: { id: productionId, workspace_id: workspace, title: production.title, production_type: 'short_film', custom_type: null, execution_method: 'real', planned_duration_ms: 600000, calculated_duration_ms: 600000, approval: 'draft', locked_at: null, revision: 7, lifecycle: 'active', updated_at: '2026-10-05T00:00:00Z' },
  scenes: [{
    id: sceneTwo, order: 1, sort_order: 1024, title: 'Scene 2 Kitchen', purpose: 'The reveal', story_beat: 'Break',
    description: 'Marcus decides to stay.', action_lines: [], opening_state: 'Packed bag', ending_state: 'Bag unpacked',
    visual_intent: 'One soft source', dialogue_notes: '', environment_asset_id: null, planned_duration_ms: 20000,
    duration_ms: 20000, timing: 'derived', approval: 'draft', locked_at: null, revision: 5, updated_at: '2026-10-05T00:00:00Z',
    character_asset_ids: [], dialogue_lines: 0, shot_count: 1, bindings: [], shots: [shot],
  }],
  orphan_shots: [],
  assets: [],
  documents: {
    story: { document_id: storyId, title: 'Story', content: 'Marcus leaves.', revision: 2, updated_at: '2026-10-05T00:00:00Z' },
  },
  timing: { total_ms: 600000, target_ms: 600000, delta_ms: 0, status: 'fits', scene_states: [{ scene_id: sceneTwo, order: 1024, duration_ms: 20000, shots: 1, timing: 'derived' }] },
  runtime_conflict: false,
  timeline: [{ scene_id: sceneTwo, order: 1, title: 'Scene 2 Kitchen', duration_ms: 20000, timing: 'derived', approval: 'draft', locked: false, execution_methods: ['real'], shots: [{ shot_id: shotTwelve, order: 1, title: 'Marcus close-up', duration_ms: 8000, execution_method: 'real', approval: 'draft', locked: false }] }],
  status_summary: { production_approval: 'draft', production_locked: false, scenes: 1, shots: 1, scenes_locked: 0, shots_locked: 0, approval_counts: { draft: 2 }, needs_attention: 0 },
  truncated: false, provider,
  capabilities: { frame_extraction: false, frame_extraction_note: 'ffmpeg is not installed.', timeline_editing: true, shot_execution: true, ai_prompt_compilation: true, note: 'Prompt 9D versioning.' },
};
const directorSurface = { production: { id: productionId, title: production.title, production_type: 'short_film', execution_method: 'real', planned_duration_ms: 600000, approval: 'draft', locked_at: null, revision: 7 }, brief: null, brief_revision: null, brief_producer: null, story: null, story_variation: null, story_producer: null, scenes: [], runtime_fit: { target_ms: 600000, assigned_ms: 600000, dialogue_ms: 0, action_ms: 0, slack_ms: 0, status: 'fits' }, documents: {}, reality: null, reality_source_revision: null, setup_listed: [], reality_used_setup: false, references: [], techniques: [], decisions: [], operations: [], provider, reference_roles: {} };

const vocabulary = {
  scopes: [{ scope: 'story', label: 'Story' }, { scope: 'scene', label: 'Scene' }, { scope: 'shot', label: 'Shot' }, { scope: 'asset', label: 'Asset' }],
  branch_states: [{ state: 'open', label: 'Open alternative' }, { state: 'merged', label: 'Merged' }, { state: 'abandoned', label: 'Abandoned' }],
  change_states: [{ state: 'pending', label: 'Ready to merge' }, { state: 'conflicted', label: 'Conflicted, needs your edit' }],
  merge_states: [{ state: 'proposed', label: 'Waiting for your decision' }, { state: 'merged', label: 'Merged' }],
  source_actions: [{ action: 'insert', label: 'Created' }, { action: 'update', label: 'Edited' }, { action: 'restore', label: 'Restored from an older version' }, { action: 'merge', label: 'Merged from a branch' }],
  propagation_modes: [
    { mode: 'update_all', label: 'Update every affected dependent' },
    { mode: 'review_changes', label: 'Only the dependents I select' },
    { mode: 'change_only_this', label: 'Change only this and record the rest as unresolved' },
  ],
  branchable_kinds: [{ kind: 'scene', label: 'Scene', fields: [{ field: 'title', label: 'Title' }, { field: 'description', label: 'Description' }] }],
  rule: RULE, limitation: LIMITATION,
};

const history = {
  object_id: storyId, object_kind: 'creative_document', object_label: 'Story', branch: 'main', current_revision: 2,
  items: [
    { version_id: versionTwo, object_id: storyId, revision: 2, branch: 'main', parent_version_id: versionOne, actor_type: 'user', actor_user_id: uid, source_action: 'update', created_at: '2026-10-05T10:00:00Z', is_current: true, source_action_label: 'Edited', current_line: 'This is the current revision.' },
    { version_id: versionOne, object_id: storyId, revision: 1, branch: 'main', parent_version_id: null, actor_type: 'user', actor_user_id: uid, source_action: 'insert', created_at: '2026-10-04T10:00:00Z', is_current: false, source_action_label: 'Created', current_line: 'History: this is not the current revision.' },
  ],
  total: 2, limit: 50, offset: 0, truncated: false, note: IMMUTABLE,
};

const branchRow = { branch_id: branchOne, name: 'Ending A', scope: 'story', scope_object_id: storyId,
  scope_object_label: 'Story', source_version_id: versionTwo, source_revision: 2, state: 'open',
  reason: 'Marcus stays.', merged_at: null, merged_proposal_id: null, changes: 1,
  created_at: '2026-10-05T10:00:00Z', state_label: 'Open alternative', scope_label: 'Story',
  changes_line: '1 proposed change(s) are waiting to be merged.' };

const branchDetail = {
  ...branchRow,
  changes: [{ change_id: changeOne, target_object_id: storyId, target_label: 'Story', target_kind: 'creative_document',
    base_version_id: versionTwo, base_revision: 2, patch: { content: 'Ending A: Marcus stays and unpacks.' },
    changed_fields: ['content'], note: 'Choose this ending.', state: 'pending', applied_version_id: null,
    applied_revision: null, current_revision: 2, state_label: 'Ready to merge',
    changed_field_labels: ['Content'] }],
  change_count: 1,
  note: 'Branch edits never change the mainline. Only an accepted merge does.',
};

const cleanPreview = {
  proposal_id: proposalOne, branch_id: branchOne, branch_name: 'Ending A', structure_revision: 42,
  items: [{ change_id: changeOne, target_object_id: storyId, target_label: 'Story', target_kind: 'creative_document',
    base_revision: 2, current_revision: 2, changed_fields: ['content'], status: 'clean', conflicts: [], state_label: 'Ready to merge' }],
  conflicts: [], counts: { clean: 1, conflicted: 0, total: 1 },
  impact: { targets: { [storyId]: { direct: 1, downstream: 2, potential: 0, total: 3, truncated: false } },
    note: 'Impact is computed, never applied, by this preview.' },
  state: 'proposed', note: 'Merge is a proposal. Conflicted changes are never resolved automatically.',
  counts_line: '1 change(s) can merge cleanly.',
  conflict_line: 'No conflict: the mainline has not moved since these changes were written.',
};

const conflictedPreview = {
  ...cleanPreview,
  items: [{ ...cleanPreview.items[0], status: 'conflict', state_label: 'Conflicted',
    conflicts: [{ field: 'content', label: 'Content', branch_value: 'Ending A: Marcus stays and unpacks.',
      main_value: 'Ending B: Marcus leaves for good.', base_value: 'Marcus leaves.' }] }],
  conflicts: [{ change_id: changeOne, target_object_id: storyId, target_label: 'Story', base_revision: 2,
    current_revision: 3, reason: 'The mainline moved after this branch change was written.',
    fields: [{ field: 'content', label: 'Content', branch_value: 'a', main_value: 'b', base_value: 'c' }] }],
  counts: { clean: 0, conflicted: 1, total: 1 },
  counts_line: '0 change(s) can merge cleanly and 1 conflict(s) need your decision.',
  conflict_line: 'A conflict is shown, never resolved automatically: the mainline and this branch both changed the same field.',
};

const decision = {
  proposal_id: proposalOne, branch_id: branchOne, state: 'merged',
  applied: [{ change_id: changeOne, target_object_id: storyId, target_label: 'Story', revision: 3,
    changed_fields: ['content'], changed_field_labels: ['Content'] }],
  applied_count: 1, skipped: [], propagation: 'review_changes',
  impact: [{ object_id: storyId, analysis_id: '00000000-0000-4000-8000-000000000f01', mode: 'review_changes',
    counts: { direct: 1, downstream: 2, total: 3 }, marked: 1, requiring_review: [], locked_skipped: [],
    unresolved_count: 0, mode_label: 'Only the dependents I select',
    impact_line: '1 direct and 2 downstream object(s) depend on this; 1 artifact marker(s) were recorded.' }],
  note: 'New mainline revisions were created. Branch history is preserved.',
  applied_line: '1 new mainline revision(s) were created. Branch history is preserved.', state_label: 'Merged',
};

async function platform(page: Page) {
  await page.route('https://tonde-test.supabase.co/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path === '/auth/v1/user') return route.fulfill({ json: { id: uid, email: 'creator@example.com' } });
    if (path === '/rest/v1/productions') {
      const single = request.headers().accept?.includes('vnd.pgrst.object');
      if (request.method() === 'PATCH') return route.fulfill({ json: { ...production, ...request.postDataJSON(), revision: 8 } });
      return route.fulfill({ json: single ? production : [production] });
    }
    return route.fulfill({ json: [] });
  });
  await page.addInitScript(({ uid }) => {
    const payload = btoa(JSON.stringify({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600 }));
    localStorage.setItem('sb-tonde-test-auth-token', JSON.stringify({ access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.test-only`, refresh_token: 'test-only', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: uid, email: 'creator@example.com', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-10-05T00:00:00Z' } }));
  }, { uid });
}

type Write = { path: string; body: Record<string, unknown> };

/** Stub the versioning API and record every write. */
async function versioningApi(page: Page, writes: Write[], state: { conflicted: boolean; merged: boolean }) {
  await page.route('http://127.0.0.1:8001/api/v1/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    const body = (request.postDataJSON?.() ?? {}) as Record<string, unknown>;
    const method = request.method();
    if (path.endsWith('/director/studio')) return route.fulfill({ json: envelope(directorSurface) });
    if (path.endsWith('/studio')) return route.fulfill({ json: envelope(studioModel) });
    if (path.endsWith('/versions/vocabulary')) return route.fulfill({ json: envelope(vocabulary) });
    if (path.endsWith('/versions/branches') && method === 'GET') {
      return route.fulfill({ json: envelope({ items: [state.merged ? { ...branchRow, state: 'merged', state_label: 'Merged' } : branchRow],
        total: 1, limit: 50, offset: 0, truncated: false, rule: RULE }) });
    }
    if (path.endsWith('/versions/branches') && method === 'POST') {
      writes.push({ path, body });
      return route.fulfill({ json: envelope({ ...branchRow, note: 'The branch is an alternative. Nothing on the mainline changed.' }) });
    }
    if (path.endsWith('/merge-preview')) {
      writes.push({ path, body });
      return route.fulfill({ json: envelope(state.conflicted ? conflictedPreview : cleanPreview) });
    }
    if (path.endsWith('/decide')) {
      writes.push({ path, body });
      state.merged = body.decision === 'merge';
      return route.fulfill({ json: envelope(state.merged ? decision
        : { proposal_id: proposalOne, branch_id: branchOne, state: 'rejected', applied: [],
            note: 'The merge was rejected. The mainline and the branch are unchanged.' }) });
    }
    if (path.endsWith('/clear')) {
      writes.push({ path, body });
      return route.fulfill({ json: envelope({ change_id: changeOne, state: 'rejected',
        note: 'The proposed change was discarded. It stays readable as branch history.' }) });
    }
    if (path.endsWith('/versions/compare')) {
      return route.fulfill({ json: envelope({ object_id: storyId, object_kind: 'creative_document', object_label: 'Story',
        left_version_id: versionOne, left_revision: 1, right_version_id: versionTwo, right_revision: 2,
        changes: [{ field: 'content', label: 'Content', before: 'Marcus leaves.', after: 'Marcus leaves for good.' }],
        change_count: 1, note: 'Only meaningful creative fields are shown, not a raw JSON diff.', limitation: LIMITATION }) });
    }
    if (path.endsWith('/restore')) {
      writes.push({ path, body });
      return route.fulfill({ json: envelope({ object_id: storyId, restored_from_version_id: versionOne,
        restored_from_revision: 1, new_revision: 3, changed_fields: ['content'], changed_field_labels: ['Content'],
        note: 'A new current revision was created from an older version. Nothing was rewound and no history was deleted.' }) });
    }
    if (path.includes('/versions/branches/') && path.endsWith('/changes') && method === 'POST') {
      writes.push({ path, body });
      return route.fulfill({ json: envelope({ change_id: changeOne, target_object_id: storyId, target_label: 'Story',
        target_kind: 'creative_document', base_version_id: versionTwo, base_revision: 2,
        patch: body.patch ?? {}, changed_fields: Object.keys((body.patch ?? {}) as Record<string, unknown>),
        note: body.note ?? '', state: 'pending', applied_version_id: null, applied_revision: null,
        state_label: 'Ready to merge', changed_field_labels: ['Content'] }) });
    }
    if (path.includes('/versions/branches/') && method === 'GET') {
      return route.fulfill({ json: envelope(branchDetail) });
    }
    if (path.endsWith('/versions') || path.includes('/versions?')) {
      return route.fulfill({ json: envelope(history) });
    }
    return route.fulfill({ json: envelope(null) });
  });
}

test('history is immutable, a branch stays an alternative, and a merge is a reviewed decision (9D)', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await platform(page);
  const writes: Write[] = [];
  const state = { conflicted: false, merged: false };
  await versioningApi(page, writes, state);

  await page.goto(`/studio/${productionId}?tool=Versions`);

  // 1. The surface states what a branch is and what compare does and does not do.
  await expect(page.getByText(/A branch is an object-level alternative, not a duplicate Production/)).toBeVisible();
  await expect(page.getByText(LIMITATION)).toBeVisible();

  // 2. History is listed, and the current revision is distinguished from history.
  await expect(page.getByText('This is the current revision.')).toBeVisible();
  await expect(page.getByText('History: this is not the current revision.')).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Edited' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Created' })).toBeVisible();
  await expect(page.getByText(/Versions are immutable records of what the object was/)).toBeVisible();

  // 3. The current revision cannot be restored; an older one can, and the result says it is a NEW revision.
  const restoreButtons = page.getByRole('button', { name: /Restore this version/ });
  await expect(restoreButtons).toHaveCount(2);
  await expect(restoreButtons.nth(0)).toBeDisabled();
  await restoreButtons.nth(1).click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/restore'))).toBe(true);
  const restoreWrite = writes.find(write => write.path.endsWith('/restore'));
  expect(restoreWrite?.path).toContain(`/versions/${versionOne}/restore`);
  await expect(page.getByText(/was created from revision 1/)).toBeVisible();

  // 4. Compare sends both versions and shows the meaningful field that differs.
  await page.getByRole('button', { name: /Compare versions/ }).click();
  await expect(page.getByText('Marcus leaves for good.')).toBeVisible();
  await expect(page.getByText(/1 field\(s\) changed between revision 1 and revision 2/)).toBeVisible();

  // 5. A branch is labelled an alternative and says what it proposes.
  await expect(page.getByText('Open alternative')).toBeVisible();
  await expect(page.getByText(/1 proposed change\(s\) are waiting to be merged\./)).toBeVisible();
  await expect(page.getByText(/1 alternative\(s\) are open/)).toBeVisible();

  // 6. Creating a branch posts its name, scope, source version and reason.
  // The branch is created against the selected object, so choose the Story document first.
  await page.getByLabel('Version object').selectOption(storyId);
  await page.getByLabel('Branch name').fill('Ending A');
  await page.getByLabel('Branch scope').selectOption('story');
  await page.getByLabel('Branch source version').selectOption(versionTwo);
  await page.getByLabel('Branch reason').fill('Marcus stays.');
  await page.getByRole('button', { name: /Create branch/ }).click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/versions/branches'))).toBe(true);
  const branchWrite = writes.find(write => write.path.endsWith('/versions/branches'));
  expect(branchWrite?.path).toBe(`/api/v1/workspaces/${workspace}/productions/${productionId}/versions/branches`);
  expect(branchWrite?.body).toEqual({ scope_object_id: storyId, scope: 'story', name: 'Ending A',
    source_version_id: versionTwo, reason: 'Marcus stays.' });
  await expect(page.getByText(/Nothing on the mainline changed/)).toBeVisible();

  // 7. A proposal on the branch is labelled a proposal, and the surface states the mainline is untouched.
  await page.getByRole('button', { name: /Open this branch/ }).click();
  await expect(page.getByText(/Branch edits never change the mainline/)).toBeVisible();
  await expect(page.getByLabel('Branch proposals').getByText('Content')).toBeVisible();
  await page.getByLabel('Branch change target').selectOption(storyId);
  await page.getByLabel('Branch change field').selectOption('content');
  await page.getByLabel('Branch change value').fill('Ending A: Marcus stays and unpacks.');
  await page.getByRole('button', { name: 'Propose change' }).click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/changes'))).toBe(true);
  const changeWrite = writes.find(write => write.path.endsWith('/changes'));
  expect(changeWrite?.path).toBe(`/api/v1/workspaces/${workspace}/productions/${productionId}/versions/branches/${branchOne}/changes`);
  expect(changeWrite?.body).toEqual({ target_object_id: storyId,
    patch: { content: 'Ending A: Marcus stays and unpacks.' }, note: '' });

  // 8. A conflict is shown with both values and is never resolved on the creator's behalf.
  state.conflicted = true;
  await page.getByRole('button', { name: /Preview merge/ }).click();
  await expect(page.getByText(/0 change\(s\) can merge cleanly and 1 conflict\(s\) need your decision\./).first()).toBeVisible();
  await expect(page.getByText(/shown, never resolved automatically/).first()).toBeVisible();
  await expect(page.getByText(/Ending B: Marcus leaves for good\./).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /Merge selected changes/ })).toBeDisabled();

  // 9. With no conflict, the merge decision posts the scope and the propagation the creator chose.
  state.conflicted = false;
  await page.getByRole('button', { name: /Preview merge/ }).click();
  await expect(page.getByText(/1 change\(s\) can merge cleanly\./).first()).toBeVisible();
  // 9a. The merge proposal states out loud that it is not an approval.
  await expect(page.getByText(NOT_APPROVAL).first()).toBeVisible();
  await page.getByLabel('Merge propagation').selectOption('review_changes');
  await page.getByLabel('Merge decision note').fill('Choose Ending A.');
  await page.getByRole('button', { name: /Merge selected changes/ }).click();
  await expect.poll(() => writes.some(write => write.path.endsWith('/decide'))).toBe(true);
  const decideWrite = writes.find(write => write.path.endsWith('/decide'));
  expect(decideWrite?.path).toBe(`/api/v1/workspaces/${workspace}/productions/${productionId}/versions/merges/${proposalOne}/decide`);
  expect(decideWrite?.body).toEqual({ decision: 'merge', selected_change_ids: [changeOne],
    propagation: 'review_changes', note: 'Choose Ending A.' });
  await expect(page.getByText(/1 new mainline revision\(s\) were created/).first()).toBeVisible();
  await expect(page.getByText(/1 direct and 2 downstream object\(s\) depend on this/)).toBeVisible();

  // 10. Nothing here is an approval.
  await expect(page.getByRole('button', { name: /^Approve/ })).toHaveCount(0);

  // 11. A narrow viewport keeps the surface usable and never overflows horizontally.
  // The drawer is ephemeral by design, so reopening after reload goes through the same link.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.goto(`/studio/${productionId}?tool=Versions`);
  await expect(page.getByText(/A branch is an object-level alternative/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  expect(errors).toEqual([]);
});
