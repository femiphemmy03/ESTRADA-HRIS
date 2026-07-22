import { createClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

// Service-role client — server-side only, never exposed to the frontend.
export const supabase = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

/**
 * Uploads a file buffer to Supabase Storage and returns a public URL + storage path.
 * @param {Buffer} buffer
 * @param {string} destinationPath e.g. `employees/{employeeId}/cv.pdf`
 * @param {string} contentType
 */
export async function uploadToSupabase(buffer, destinationPath, contentType) {
  const bucket = env.supabaseStorageBucket;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(destinationPath, buffer, { contentType, upsert: true });

  if (error) throw new Error(`Supabase upload failed: ${error.message}`);

  const { data: publicUrlData } = supabase.storage.from(bucket).getPublicUrl(destinationPath);

  return { url: publicUrlData.publicUrl, path: destinationPath };
}

export async function removeFromSupabase(destinationPath) {
  const bucket = env.supabaseStorageBucket;
  const { error } = await supabase.storage.from(bucket).remove([destinationPath]);
  if (error) throw new Error(`Supabase remove failed: ${error.message}`);
}

/**
 * Returns a time-limited signed URL, useful for sensitive documents
 * instead of relying on a public bucket.
 */
export async function getSignedUrl(destinationPath, expiresInSeconds = 3600) {
  const bucket = env.supabaseStorageBucket;
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(destinationPath, expiresInSeconds);
  if (error) throw new Error(`Supabase signed URL failed: ${error.message}`);
  return data.signedUrl;
}
