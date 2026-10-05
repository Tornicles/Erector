import { requireSupabase } from '../lib/supabase';
import { AppError, safeError } from './errors';
import type { Row } from '../types/domain';
const categories: Record<string, Row<'media_files'>['file_category']> = {
  'image/jpeg': 'image', 'image/png': 'image', 'image/webp': 'image',
  'video/mp4': 'video', 'video/quicktime': 'video',
  'audio/mpeg': 'audio', 'audio/wav': 'audio', 'audio/mp4': 'audio',
  'application/pdf': 'document', 'text/plain': 'script',
};
export function validateFile(file: Pick<File, 'size' | 'type' | 'name'>) {
  if (!categories[file.type] || file.size < 1 || file.size > 50 * 1024 * 1024 || !file.name || file.name.length > 255) {
    throw new AppError('validation', 'Choose an allowed image, video, audio, PDF, or text file up to 50 MB.');
  }
  return categories[file.type];
}
export const mediaService = {
  async upload(workspaceId: string, file: File, bucket: 'tonde-uploads' | 'tonde-asset-references' | 'tonde-production-media' | 'tonde-results' = 'tonde-uploads') {
    const fileCategory = validateFile(file);
    const client = requireSupabase();
    const id = crypto.randomUUID();
    const objectKey = `${workspaceId}/${id}/source`;
    const { data, error } = await client.from('media_files').insert({ id, workspace_id: workspaceId, bucket, object_key: objectKey, original_filename: file.name, mime_type: file.type, file_category: fileCategory, bytes: file.size }).select().single();
    if (error) throw safeError(error);
    const { error: uploadError } = await client.storage.from(bucket).upload(objectKey, file, { contentType: file.type, upsert: false });
    if (uploadError) {
      const { error: recoveryError } = await client.from('media_files').update({ upload_state: 'failed' }).eq('id', id).eq('workspace_id', workspaceId);
      if (recoveryError) throw new AppError('database', 'Upload failed and its metadata could not be updated. Retry after checking the connection.');
      throw safeError(uploadError);
    }
    const { data: uploaded, error: updateError } = await client.from('media_files').update({ upload_state: 'uploaded' }).eq('id', id).eq('workspace_id', workspaceId).select().single();
    if (updateError) throw safeError(updateError);
    return uploaded ?? data;
  },
  async signedUrl(media: Row<'media_files'>) {
    if (media.storage_provider !== 'supabase' || media.upload_state !== 'uploaded') throw new AppError('validation', 'This media is not available for viewing.');
    const { data, error } = await requireSupabase().storage.from(media.bucket).createSignedUrl(media.object_key, 60);
    if (error) throw safeError(error);
    return data.signedUrl;
  },
};
