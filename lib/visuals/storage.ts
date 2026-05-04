import { createServiceClient } from '@/lib/supabase/server';

const BUCKET = 'helm-visuals';

interface UploadResult {
  publicUrl: string;
  path: string;
}

// Download a transient image URL (e.g. fal.ai's signed CDN URL) and re-host
// it in Supabase Storage so it survives past the provider's TTL. Uses the
// service-role client so we don't need RLS rules per user folder.
//
// Returns null on any failure (network, missing bucket, RLS denial, etc.) —
// callers should fall back to the original fal.ai URL when this fails so
// the user still sees the image during the session even if persistence
// isn't set up yet.
export async function uploadVisualFromUrl(
  imageUrl: string,
  userId: string,
  postId: string,
  extension: 'jpg' | 'png' | 'webp' = 'jpg'
): Promise<UploadResult | null> {
  try {
    const imageRes = await fetch(imageUrl, {
      signal: AbortSignal.timeout(30000),
    });
    if (!imageRes.ok) {
      console.error(
        '[visuals/storage] failed to fetch image',
        imageRes.status,
        imageRes.statusText
      );
      return null;
    }

    const arrayBuffer = await imageRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Path is namespaced by userId so listing by prefix works for cleanup
    // jobs later. Timestamp keeps regenerations from colliding.
    const path = `${userId}/${postId}-${Date.now()}.${extension}`;

    const supabase = createServiceClient();
    const contentType = `image/${extension === 'jpg' ? 'jpeg' : extension}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType, upsert: false });

    if (uploadError) {
      console.error(
        '[visuals/storage] supabase upload error:',
        uploadError.message
      );
      return null;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(BUCKET).getPublicUrl(path);

    return { publicUrl, path };
  } catch (e) {
    console.error(
      '[visuals/storage] upload failed:',
      e instanceof Error ? e.message : String(e)
    );
    return null;
  }
}

// Same as above but takes a Buffer/Uint8Array directly. Used by the carousel
// renderer which already has the PNG bytes from the screenshot.
export async function uploadVisualBuffer(
  buffer: Buffer,
  userId: string,
  postId: string,
  extension: 'png' | 'jpg' | 'webp' = 'png'
): Promise<UploadResult | null> {
  try {
    const path = `${userId}/${postId}-${Date.now()}.${extension}`;
    const supabase = createServiceClient();
    const contentType = `image/${extension === 'jpg' ? 'jpeg' : extension}`;

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType, upsert: false });

    if (error) {
      console.error('[visuals/storage] buffer upload error:', error.message);
      return null;
    }

    const {
      data: { publicUrl },
    } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return { publicUrl, path };
  } catch (e) {
    console.error(
      '[visuals/storage] buffer upload failed:',
      e instanceof Error ? e.message : String(e)
    );
    return null;
  }
}
