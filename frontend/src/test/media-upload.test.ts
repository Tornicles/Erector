import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Row } from '../types/domain';
import { AppError } from '../services/errors';

const mocks = vi.hoisted(() => ({
  request: vi.fn(), uploadToSignedUrl: vi.fn(), createSignedUrl: vi.fn(),
}));
vi.mock('../services/api', () => ({ authenticatedRequest: mocks.request }));
vi.mock('../lib/supabase', () => ({ requireSupabase: () => ({
  storage: { from: vi.fn(() => ({ uploadToSignedUrl: mocks.uploadToSignedUrl, createSignedUrl: mocks.createSignedUrl })) },
}) }));

import { mediaService, validateFile } from '../services/media';

const file = new File(['video-content'], 'take.mp4', { type: 'video/mp4' });
const limits = { purposes: [
  { purpose: 'reference', max_bytes: 1_000_000, supported_mime_types: ['video/mp4'] },
  { purpose: 'result', max_bytes: 10_000_000, supported_mime_types: ['video/mp4'] },
] };
const intent = { intent_id: 'intent-id', media_id: 'media-id', bucket: 'tonde-results',
  object_key: 'workspace-id/media-id/original.mp4', max_bytes: 10_000_000, expected_bytes: file.size };
const signed = { intent_id: 'intent-id', media_id: 'media-id', bucket: 'tonde-results',
  object_key: intent.object_key, token: 'opaque-token',
  upload_url: 'https://project.supabase.co/storage/v1/object/upload/sign/tonde-results/workspace-id/media-id/original.mp4',
  mime_type: 'video/mp4', max_bytes: 10_000_000, expected_bytes: file.size,
  expires_at: '2026-10-10T12:00:00Z', upsert: false as const };

beforeEach(() => { vi.clearAllMocks(); });

describe('intent-bound private media upload', () => {
  it('uses current server limits and rejects invalid files before creating an intent', async () => {
    expect(validateFile(file, limits, 'reference')).toBe('video');
    expect(() => validateFile(new File(['x'], 'x.exe', { type: 'application/x-msdownload' }), limits, 'reference')).toThrow(AppError);
    expect(() => validateFile(file, limits, 'unknown')).toThrow(AppError);
    expect(() => validateFile(file, { purposes: [{ purpose: 'result', max_bytes: 1_000_000, supported_mime_types: ['image/jpeg'] }] }, 'result')).toThrow(AppError);
    mocks.request.mockResolvedValueOnce(limits);
    await expect(mediaService.upload('workspace-id', file, 'unknown' as never)).rejects.toThrow(AppError);
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });

  it('creates an intent, obtains its exact signed token, uploads, and asks the server to verify', async () => {
    mocks.request.mockResolvedValueOnce(limits).mockResolvedValueOnce(intent)
      .mockResolvedValueOnce(signed).mockResolvedValueOnce({ media_id: 'media-id', state: 'verified', job_id: 'job-id' });
    mocks.uploadToSignedUrl.mockResolvedValue({ data: { path: intent.object_key }, error: null });

    const result = await mediaService.upload('workspace-id', file, 'result', 'production-id');

    expect(mocks.request.mock.calls[0][0]).toBe('/api/v1/media/upload-limits');
    expect(mocks.request.mock.calls[1]).toEqual(['/api/v1/workspaces/workspace-id/media/upload-intents', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ purpose: 'result', original_filename: 'take.mp4',
        mime_type: 'video/mp4', expected_bytes: file.size, production_id: 'production-id', resumable: false }),
    })]);
    expect(mocks.request.mock.calls[2][0]).toBe('/api/v1/workspaces/workspace-id/media/upload-intents/intent-id/signed-upload');
    expect(mocks.uploadToSignedUrl).toHaveBeenCalledWith(intent.object_key, 'opaque-token', file,
      { contentType: 'video/mp4', upsert: false });
    expect(mocks.request.mock.calls[3][0]).toBe('/api/v1/workspaces/workspace-id/media/upload-intents/intent-id/complete');
    expect(result).toMatchObject({ id: 'media-id', upload_state: 'verified', processing_state: 'pending' });
  });

  it('does not upload if the returned signed authorization points at a different intent or key', async () => {
    mocks.request.mockResolvedValueOnce(limits).mockResolvedValueOnce(intent)
      .mockResolvedValueOnce({ ...signed, object_key: 'attacker/other.mp4' });
    await expect(mediaService.upload('workspace-id', file, 'result')).rejects.toThrow(/no longer matches this upload intent/);
    expect(mocks.uploadToSignedUrl).not.toHaveBeenCalled();
  });

  it('never marks the intent failed in browser metadata when upload or verification fails', async () => {
    mocks.request.mockResolvedValueOnce(limits).mockResolvedValueOnce(intent).mockResolvedValueOnce(signed);
    mocks.uploadToSignedUrl.mockResolvedValue({ data: null, error: new Error('network interrupted') });
    await expect(mediaService.upload('workspace-id', file, 'result')).rejects.toThrow();
    expect(mocks.request).toHaveBeenCalledTimes(3);
  });

  it('only requests a private signed read URL for server-verified media', async () => {
    const media = { id: 'media-id', storage_provider: 'supabase', upload_state: 'pending', bucket: 'tonde-results',
      object_key: intent.object_key } as Row<'media_files'>;
    await expect(mediaService.signedUrl(media)).rejects.toThrow(AppError);
    media.upload_state = 'verified';
    mocks.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed.example' }, error: null });
    await expect(mediaService.signedUrl(media)).resolves.toBe('https://signed.example');
  });
});
