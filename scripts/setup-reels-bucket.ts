// PR #32 — Sprint 5.3: Instagram Reels.
//
// One-shot operator script that creates the "reels" Supabase Storage
// bucket if missing and prints the RLS policies the operator must
// apply manually in Supabase Dashboard.
//
// Bucket settings:
//   - public: true (Meta needs to fetch the URL)
//   - fileSizeLimit: 100 MB (Vercel/Supabase cost cap; Meta API
//     accepts up to 1 GB but we keep it tight in Sprint 5.3)
//   - allowedMimeTypes: video/mp4, video/quicktime
//
// RLS: bucket is created with default policies; the privacy
// constraints (each user only writes to userId/* paths) MUST be
// added by hand — Supabase JS API doesn't expose policy CRUD.
//
// Required env: SUPABASE_SERVICE_ROLE_KEY (admin). The script bails
// gracefully when missing so it doesn't crash a fresh checkout.
import { loadEnvConfig } from '@next/env';

async function main() {
  loadEnvConfig(process.cwd());

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    console.error('✗ NEXT_PUBLIC_SUPABASE_URL is not set.');
    process.exit(1);
  }
  if (!serviceKey) {
    console.error(
      '✗ SUPABASE_SERVICE_ROLE_KEY is not set in your environment.\n' +
        '  Get it from Supabase Dashboard → Project Settings → API → service_role.\n' +
        '  Add it to .env.local (NOT to a public file or the repo).'
    );
    process.exit(1);
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(url, serviceKey);

  const { data: existing, error: listErr } =
    await supabase.storage.listBuckets();
  if (listErr) {
    console.error('✗ Could not list buckets:', listErr.message);
    process.exit(1);
  }

  const reelsBucket = existing?.find((b) => b.name === 'reels');
  if (reelsBucket) {
    console.log('✓ Bucket "reels" already exists.');
  } else {
    // We DON'T set fileSizeLimit on the bucket — Supabase Free caps
    // bucket-level limits and the create call fails with "exceeded
    // maximum allowed size" if we exceed it. Instead we enforce
    // 100 MB on both the client (UploadHelper) and the schedule
    // endpoint, which is more flexible and lets ops change the cap
    // by editing one constant.
    const { error } = await supabase.storage.createBucket('reels', {
      public: true,
      allowedMimeTypes: ['video/mp4', 'video/quicktime'],
    });
    if (error) {
      console.error('✗ Could not create bucket:', error.message);
      process.exit(1);
    }
    console.log('✓ Bucket "reels" created.');
  }

  console.log(`
═══════════════════════════════════════════════════════════════
RLS POLICIES — apply manually in Supabase Dashboard
   Storage → reels → Policies
═══════════════════════════════════════════════════════════════

POLICY 1 — "Users can upload to own folder" (INSERT)
  Target: storage.objects
  USING / WITH CHECK:
    bucket_id = 'reels'
    AND (storage.foldername(name))[1] = auth.uid()::text

POLICY 2 — "Public read" (SELECT)
  Target: storage.objects
  USING:
    bucket_id = 'reels'
  Why: Meta's Graph API fetches the video URL anonymously to
  process it. Without this Meta returns "Cannot fetch video".

POLICY 3 — "Users can delete own files" (DELETE)
  Target: storage.objects
  USING:
    bucket_id = 'reels'
    AND (storage.foldername(name))[1] = auth.uid()::text

═══════════════════════════════════════════════════════════════
  `);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
