import { describe, expect, it } from 'vitest';
import { DATABASE_VALUES, DEFAULT_EXECUTION_FACE, PRODUCT } from '../types/product';
import { destinations } from '../components/AppLayout';

describe('TONDE constitutional vocabulary', () => {
  it('preserves product identity, normal Real default and hybrid assignment without a third face', () => {
    expect(PRODUCT.identity.name).toBe('TONDE');
    expect(PRODUCT.identity.promise).toBe('Show TONDE what you want to make. TONDE tells you exactly how to make it.');
    expect(DEFAULT_EXECUTION_FACE).toBe('real');
    expect(Object.keys(PRODUCT.executionFaces)).toEqual(['real', 'ai']);
    expect(DATABASE_VALUES.execution_method).toEqual(['real', 'ai', 'hybrid']);
    expect(PRODUCT.executionAssignments.hybrid).toBe('SHOOT + AI');
  });
  it('covers every production classification with canonical labels including Product Film, Trailer and YouTube', () => {
    expect(DATABASE_VALUES.production_type).toHaveLength(24);
    expect(Object.keys(PRODUCT.productionTypes).sort()).toEqual([...DATABASE_VALUES.production_type].sort());
    expect(PRODUCT.productionTypes.product_film).toBe('Product Film');
    expect(PRODUCT.productionTypes.trailer).toBe('Trailer');
    expect(PRODUCT.productionTypes.youtube).toBe('YouTube');
  });
  it('Production Kit excludes environments while reusable Assets contain them; Settings is not inventory', () => {
    expect(DATABASE_VALUES.resource_type).not.toContain('environment');
    expect(DATABASE_VALUES.asset_type).toContain('environment');
    expect(DATABASE_VALUES.resource_type).toContain('ai_tool');
    expect(PRODUCT.areas.settings.responsibility).toBe('Application and account configuration');
    expect(PRODUCT.areas.setup.title).toBe('Production Kit');
    expect(PRODUCT.areas.setup.responsibility).toContain('creator can create with');
  });
  it('canonical navigation exactly implements the seven responsibility destinations', () => {
    expect(destinations.map(item => item.path)).toEqual(['/home', '/studio', '/projects', '/discover', '/assets', '/setup', '/settings']);
    expect(destinations.map(item => item.title)).toEqual(Object.values(PRODUCT.areas).map(area => area.title));
    expect(PRODUCT.areas.home.responsibility).toBe('Start + Action Queue');
    expect(PRODUCT.areas.projects.responsibility).toBe('Find and manage Productions');
  });
  it('approval and actual result lifecycle are separate canonical dimensions', () => {
    expect(DATABASE_VALUES.approval).toEqual(['draft', 'needs_review', 'approved', 'changed_after_approval']);
    expect(DATABASE_VALUES.result_state).toEqual(['raw', 'needs_review', 'approved', 'rejected', 'final']);
    expect(Object.keys(PRODUCT.resultStates)).toEqual([...DATABASE_VALUES.result_state]);
    expect(PRODUCT.approvals.changed_after_approval).toBe('Changed After Approval');
  });
  it('rights, partial evidence, collaboration and export actions stay explicit', () => {
    expect(PRODUCT.referenceRights.unknown).toBe('Unknown / unconfirmed');
    expect(DATABASE_VALUES.reference_rights).toContain('third_party_inspiration');
    expect(PRODUCT.claimKinds).toEqual(['observed', 'estimated', 'recommended']);
    expect(PRODUCT.mediaModalities).toContain('video_frames');
    expect(Object.values(PRODUCT.collaborationModes)).toEqual(['Guide Me Step-by-Step', 'Build It, Stop at Major Decisions', 'Build Complete First Draft']);
    expect(PRODUCT.exportActions.full_document).not.toEqual(PRODUCT.exportActions.production_package);
  });
});
