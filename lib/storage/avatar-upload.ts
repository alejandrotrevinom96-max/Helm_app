// PR #86 — Sprint 7.10: client-side avatar photo upload helper.
//
// Matches the pattern from reels-upload.ts: the photo goes
// directly from the browser to Supabase Storage so Vercel's 4.5MB
// serverless body cap is never the bottleneck (even though 5MB
// photos are right at that edge), and so RLS policies can scope
// writes by auth.uid().
//
// Path scheme: {userId}/{projectId}/avatar-{stamp}.{ext}
//   - First folder is the user id so the RLS "users can write to
//     their own folder" policy holds.
//   - Second folder is the project id — one avatar per project.
//   - Trailing timestamp prevents stale browser caching when the
//     founder re-uploads (we don't `upsert` because Supabase's
//     getPublicUrl returns the same URL even after overwrite,
//     which means HeyGen would fetch the cached old image).
import { createClient } from '@/lib/supabase/client';

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const AVATAR_ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export interface AvatarUploadSuccess {
  url: string;
  path: string;
}
export interface AvatarUploadFailure {
  error: string;
}
export type AvatarUploadResult = AvatarUploadSuccess | AvatarUploadFailure;

export function isAvatarUploadFailure(
  r: AvatarUploadResult,
): r is AvatarUploadFailure {
  return 'error' in r;
}

export async function uploadAvatarPhoto(
  file: File,
  userId: string,
  projectId: string,
): Promise<AvatarUploadResult> {
  if (!AVATAR_ALLOWED_MIME.has(file.type)) {
    return { error: 'Photo must be JPG, PNG, or WebP.' };
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return {
      error: `Photo is ${(file.size / (1024 * 1024)).toFixed(
        1,
      )} MB. Max ${AVATAR_MAX_BYTES / (1024 * 1024)} MB.`,
    };
  }

  const supabase = createClient();

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const stamp = Date.now();
  const path = `${userId}/${projectId}/avatar-${stamp}.${ext}`;

  const { data, error } = await supabase.storage
    .from('avatars')
    .upload(path, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    return { error: error.message };
  }

  const { data: urlData } = supabase.storage
    .from('avatars')
    .getPublicUrl(data.path);

  return { url: urlData.publicUrl, path: data.path };
}
