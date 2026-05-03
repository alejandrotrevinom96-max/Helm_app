import { db } from '@/lib/db';
import { waitlistPages } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import type { TemplateConfig } from '@/lib/validate/defaults';
import type { PublicPageData } from './templates/_shared';
import { MinimalTemplate } from './templates/minimal';
import { BetaTesterTemplate } from './templates/beta-tester';
import { FeatureVoteTemplate } from './templates/feature-vote';
import { PricingTestTemplate } from './templates/pricing-test';
import { Survey5QTemplate } from './templates/survey-5q';

export default async function WaitlistPublicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const [page] = await db
    .select()
    .from(waitlistPages)
    .where(eq(waitlistPages.slug, slug))
    .limit(1);

  if (!page || !page.isActive) notFound();

  // Server data → plain object the client templates can consume.
  const pageData: PublicPageData = {
    id: page.id,
    slug: page.slug,
    title: page.title,
    subtitle: page.subtitle,
    ctaText: page.ctaText,
    template: page.template,
    templateConfig: (page.templateConfig as TemplateConfig | null) ?? null,
  };

  switch (page.template) {
    case 'beta-tester':
      return <BetaTesterTemplate slug={slug} page={pageData} />;
    case 'feature-vote':
      return <FeatureVoteTemplate slug={slug} page={pageData} />;
    case 'pricing-test':
      return <PricingTestTemplate slug={slug} page={pageData} />;
    case 'survey-5q':
      return <Survey5QTemplate slug={slug} page={pageData} />;
    case 'minimal':
    default:
      return <MinimalTemplate slug={slug} page={pageData} />;
  }
}
