// PR #60 — Sprint 7.0.4: read the global content_types catalog.
//
// No auth requirement — these are seed-data templates, not
// project-specific. The UI's only consumer is the Generate page
// surfacing checkbox options for the selected platform.
import { db } from '@/lib/db';
import { contentTypes } from '@/lib/db/schema';
import { eq, asc } from 'drizzle-orm';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const platform = url.searchParams.get('platform');

  const baseSelect = db
    .select({
      id: contentTypes.id,
      platform: contentTypes.platform,
      type: contentTypes.type,
      displayName: contentTypes.displayName,
      description: contentTypes.description,
      guidelines: contentTypes.guidelines,
      maxLength: contentTypes.maxLength,
      defaultEnabled: contentTypes.defaultEnabled,
      displayOrder: contentTypes.displayOrder,
    })
    .from(contentTypes);

  const rows = platform
    ? await baseSelect
        .where(eq(contentTypes.platform, platform))
        .orderBy(asc(contentTypes.displayOrder))
    : await baseSelect.orderBy(
        asc(contentTypes.platform),
        asc(contentTypes.displayOrder),
      );

  return NextResponse.json({ types: rows });
}
