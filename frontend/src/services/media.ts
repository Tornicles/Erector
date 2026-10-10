import { authenticatedRequest } from './api';
import { requireSupabase } from '../lib/supabase';
import { AppError, safeError } from './errors';
import type { Row } from '../types/domain';
const categories: Record<string, Row<'media_files'>['file_category']> = {
  'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image', 'image/gif': 'image',
  'image/tiff': 'image', 'image/heic': 'image',
  'video/mp4': 'video', 'video/quicktime': 'video', 'video/webm': 'video',
  'audio/mpeg': 'audio', 'audio/wav': 'audio', 'audio/mp4': 'audio', 'audio/aac': 'audio', 'audio/flac': 'audio',
  'application/pdf': 'document', 'text/plain': 'script', 'application/json': 'document',
  'text/vtt': 'subtitle', 'application/x-subrip': 'subtitle',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document', 'application/zip': 'document',
};
export function validateFile(file: Pick<File, 'size' | 'type' | 'name'>, limits?: { purposes?: Array<{ purpose: string; max_bytes: number; supported_mime_types?: string[] }> }, purpose = 'reference') {
  const configuredPurpose = limits?.purposes?.find(item => item.purpose === purpose);
  const maximum = configuredPurpose?.max_bytes ?? 0;
  if (!categories[file.type] || !configuredPurpose?.supported_mime_types?.includes(file.type)
    || file.size < 1 || file.size > maximum || !file.name || file.name.length > 200 || /[\\/]|\.\./.test(file.name)) {
    throw new AppError('validation', 'Choose a supported file within TONDE’s current server-published upload limit.');
  }
  return categories[file.type];
}
type UploadIntent = { intent_id: string; media_id: string; bucket: string; object_key: string; max_bytes: number; expected_bytes: number | null };
type SignedUpload = { intent_id: string; media_id: string; bucket: string; object_key: string; token: string; upload_url: string; mime_type: string; max_bytes: number; expected_bytes: number | null; expires_at: string; upsert: false };
async function createUploadIntent(workspaceId: string, file: File, purpose: 'result' | 'reference' | 'asset' | 'attachment' | 'export_artifact', productionId?: string) {
  return authenticatedRequest<UploadIntent>(`/api/v1/workspaces/${workspaceId}/media/upload-intents`, {
    method: 'POST', body: JSON.stringify({ purpose, original_filename: file.name, mime_type: file.type,
      expected_bytes: file.size, production_id: productionId ?? null, resumable: false }),
  });
}
export const mediaService = {
  async upload(workspaceId: string, file: File, purpose: 'result' | 'reference' | 'asset' | 'attachment' | 'export_artifact' = 'reference', productionId?: string) {
    const client = requireSupabase();
    const limits = await authenticatedRequest<{ purposes?: Array<{ purpose: string; max_bytes: number; supported_mime_types?: string[] }> }>('/api/v1/media/upload-limits');
    validateFile(file, limits, purpose);
    const intent = await createUploadIntent(workspaceId, file, purpose, productionId);
    try {
      const signed = await authenticatedRequest<SignedUpload>(
        `/api/v1/workspaces/${workspaceId}/media/upload-intents/${intent.intent_id}/signed-upload`, { method: 'POST' });
      if (signed.intent_id !== intent.intent_id || signed.media_id !== intent.media_id || signed.bucket !== intent.bucket || signed.object_key !== intent.object_key) {
        throw new AppError('validation', 'The upload authorization no longer matches this upload intent.');
      }
      if (file.size > signed.max_bytes || file.type !== signed.mime_type) {
        throw new AppError('validation', 'This file is larger than the current Storage limit or no longer has an allowed type.');
      }
      const signedUrl = new URL(signed.upload_url);
      const marker = `/object/upload/sign/${encodeURIComponent(signed.bucket)}/`;
      const markerIndex = signedUrl.pathname.indexOf(marker);
      if (markerIndex < 0) throw new AppError('unavailable', 'The upload token did not include a valid Storage endpoint.');
      const signedObjectPath = signedUrl.pathname.slice(markerIndex + marker.length).split('/').map(decodeURIComponent).join('/');
      const { error: uploadError } = await client.storage.from(signed.bucket)
        .uploadToSignedUrl(signedObjectPath, signed.token, file, { contentType: signed.mime_type, upsert: false });
      if (uploadError) throw safeError(uploadError);
      const verified = await authenticatedRequest<{ media_id: string; state: string; job_id?: string }>(
        `/api/v1/workspaces/${workspaceId}/media/upload-intents/${intent.intent_id}/complete`, { method: 'POST' });
      if (verified.media_id !== intent.media_id || verified.state !== 'verified') {
        throw new AppError('unavailable', 'The uploaded object was not verified. Check its status before using it.');
      }
      return { id: intent.media_id, workspace_id: workspaceId, bucket: signed.bucket,
        object_key: signed.object_key, original_filename: file.name, mime_type: file.type,
        file_category: categories[file.type], bytes: file.size, upload_state: 'verified', processing_state: 'pending' };
    } catch (failure) {
      // The intent remains durable and may be retried or explicitly abandoned; never forge a FAILED
      // upload row from the browser or overwrite server-owned verification state.
      throw failure;
    }
  },
  async signedUrl(media: Row<'media_files'>) {
    if (media.storage_provider !== 'supabase' || media.upload_state !== 'verified') throw new AppError('validation', 'This media is not available for viewing.');
    const { data, error } = await requireSupabase().storage.from(media.bucket).createSignedUrl(media.object_key, 60);
    if (error) throw safeError(error);
    return data.signedUrl;
  },
};
