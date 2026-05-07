// PR #32 — Sprint 5.3: Instagram Reels.
//
// Browser-side upload helper. The video file goes DIRECTLY from the
// user's browser to Supabase Storage — Vercel functions never touch
// it. That's important because:
//   1. Vercel serverless functions cap request bodies at 4.5 MB
//      (and 60s timeout). 100 MB videos can't go through the API.
//   2. Direct uploads use the user's auth session, so RLS policies
//      ("upload to your own folder") are enforced naturally.
//
// Path scheme: {userId}/{timestamp}-{random}.{ext}
//   The first folder MUST be the user id — RLS policy 1
//   ("Users can upload to own folder") checks foldername[1] against
//   auth.uid().
import { createClient } from '@/lib/supabase/client';

// Client-side cap. Server-side schedule endpoint enforces a matching
// limit so a hostile client can't bypass.
export const REELS_MAX_BYTES = 100 * 1024 * 1024;

const ALLOWED_MIME = new Set(['video/mp4', 'video/quicktime']);

export interface UploadSuccess {
  url: string; // public URL Meta will fetch
  path: string; // Supabase Storage path (for delete)
}

export interface UploadFailure {
  error: string;
}

export type UploadResult = UploadSuccess | UploadFailure;

function isFailure(r: UploadResult): r is UploadFailure {
  return 'error' in r;
}

export async function uploadReelVideo(
  file: File,
  userId: string
): Promise<UploadResult> {
  if (!ALLOWED_MIME.has(file.type)) {
    return { error: 'Video must be MP4 or MOV (QuickTime).' };
  }
  if (file.size > REELS_MAX_BYTES) {
    return {
      error: `Video too large (${(file.size / (1024 * 1024)).toFixed(
        1
      )} MB). Max ${REELS_MAX_BYTES / (1024 * 1024)} MB.`,
    };
  }

  const supabase = createClient();

  const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${userId}/${stamp}-${rand}.${ext}`;

  const { data, error } = await supabase.storage
    .from('reels')
    .upload(path, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    return { error: error.message };
  }

  // The bucket is public-read (Meta needs to fetch the URL); RLS only
  // gates writes. getPublicUrl is a sync helper that builds the URL
  // from the bucket config — no extra request.
  const { data: urlData } = supabase.storage
    .from('reels')
    .getPublicUrl(data.path);

  return { url: urlData.publicUrl, path: data.path };
}

export async function deleteReelVideo(path: string): Promise<boolean> {
  const supabase = createClient();
  const { error } = await supabase.storage.from('reels').remove([path]);
  return !error;
}

export { isFailure };
