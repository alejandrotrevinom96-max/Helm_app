import type { HelmData } from './data-pull';
import type {
  CompassBand,
  CompassDimension,
  CompassRedFlag,
  CompassSubcriterion,
} from '@/lib/types/compass';

// =============================================================
// PRODUCT VALIDATION (25 pts) — replaces Founder dimension from
// Unicorn Screener since indie hackers are usually first-timers.
// =============================================================
export function scoreValidation(
  data: HelmData,
  formData: Record<string, unknown>
): CompassDimension {
  const sub: CompassSubcriterion[] = [];

  // 1. User interviews (6 pts) — form-based
  const interviews = Number(formData.userInterviewsConducted ?? 0);
  let interviewPts = 0;
  if (interviews >= 10) interviewPts = 6;
  else if (interviews >= 4) interviewPts = 3;
  sub.push({
    id: 'interviews',
    name: 'User interviews conducted',
    pts: interviewPts,
    maxPts: 6,
    evidence:
      interviews > 0
        ? `${interviews} interview(s) declared by founder`
        : 'No interviews declared',
    confidence: interviews > 0 ? 'medium' : 'low',
    source: 'form',
  });

  // 2. Waitlist signups (7 pts) — auto
  const signups = data.uniqueWaitlistSignups;
  let signupPts = 0;
  if (signups >= 200) signupPts = 7;
  else if (signups >= 50) signupPts = 5;
  else if (signups >= 10) signupPts = 3;
  sub.push({
    id: 'waitlist-signups',
    name: 'Waitlist signups',
    pts: signupPts,
    maxPts: 7,
    evidence: `${signups} unique email(s) across ${data.waitlistPagesCount} waitlist page(s)`,
    confidence: 'high',
    source: 'auto',
  });

  // 3. Willingness to pay (5 pts) — auto from pricing-test
  const willingCount = data.pricingTestResponses.filter(
    (r) => r.willingToPay
  ).length;
  const totalPricing = data.pricingTestResponses.length;
  let payPts = 0;
  if (totalPricing >= 5 && willingCount / totalPricing >= 0.5) payPts = 5;
  else if (totalPricing > 0 && willingCount > 0) payPts = 2;
  sub.push({
    id: 'willingness-to-pay',
    name: 'Willingness to pay validated',
    pts: payPts,
    maxPts: 5,
    evidence:
      totalPricing > 0
        ? `${willingCount}/${totalPricing} respondents willing to pay`
        : 'No pricing-test responses yet',
    confidence: totalPricing >= 5 ? 'high' : 'low',
    source: 'auto',
  });

  // 4. Founder uses own product (4 pts) — form
  const usage = formData.founderUsesProductDaily as string | undefined;
  const ownPts = usage === 'daily' ? 4 : usage === 'weekly' ? 2 : 0;
  sub.push({
    id: 'founder-usage',
    name: 'Founder uses own product',
    pts: ownPts,
    maxPts: 4,
    evidence: usage ? `Self-reported: ${usage}` : 'Not declared',
    confidence: usage ? 'medium' : 'low',
    source: 'form',
  });

  // 5. Pain validated with quotes (3 pts) — auto from survey-5q
  const painQuotes = data.surveyResponses.length;
  let painPts = 0;
  if (painQuotes >= 3) painPts = 3;
  else if (painQuotes >= 1) painPts = 1;
  sub.push({
    id: 'pain-validated',
    name: 'Pain validated with user quotes',
    pts: painPts,
    maxPts: 3,
    evidence: `${painQuotes} pain quote(s) from survey responses`,
    confidence: painQuotes > 0 ? 'high' : 'low',
    source: 'auto',
  });

  return {
    id: 'validation',
    name: 'Product Validation',
    pts: sub.reduce((s, c) => s + c.pts, 0),
    maxPts: 25,
    subcriteria: sub,
  };
}

// =============================================================
// STRATEGIC POSITION (20 pts)
// =============================================================
export function scoreStrategy(
  data: HelmData,
  formData: Record<string, unknown>
): CompassDimension {
  const sub: CompassSubcriterion[] = [];

  // 1. Why now (5 pts) — form
  const whyNow = (formData.whyNow as string | undefined) ?? '';
  let timingPts = 0;
  if (
    whyNow.length > 80 &&
    /\b(20\d{2}|recent|just|now|emerging|new)\b/i.test(whyNow)
  ) {
    timingPts = 5;
  } else if (whyNow.length > 30) {
    timingPts = 3;
  }
  sub.push({
    id: 'why-now',
    name: 'Why now / Timing catalyst',
    pts: timingPts,
    maxPts: 5,
    evidence: whyNow ? whyNow.slice(0, 120) : 'No timing rationale provided',
    confidence: timingPts >= 3 ? 'medium' : 'low',
    source: 'form',
  });

  // 2. Unfair advantage (5 pts) — form OR inferred from anti-positioning
  const unfair = (formData.unfairAdvantage as string | undefined) ?? '';
  const antiPos = data.brandBible?.messaging?.antiPositioning ?? [];
  let advPts = 0;
  if (unfair.length > 60) advPts = 5;
  else if (unfair.length > 20) advPts = 2;
  else if (antiPos.length >= 2) advPts = 3;
  sub.push({
    id: 'unfair-advantage',
    name: 'Unfair advantage',
    pts: advPts,
    maxPts: 5,
    evidence: unfair
      ? unfair.slice(0, 120)
      : antiPos.length > 0
        ? `Inferred from anti-positioning: ${antiPos.length} statements`
        : 'Not articulated',
    confidence: unfair ? 'high' : 'low',
    source: unfair ? 'form' : 'auto',
  });

  // 3. Competitive landscape (4 pts) — auto
  const competitors = data.competitorsConfigured;
  let compPts = 0;
  if (competitors.length >= 3) compPts = 4;
  else if (competitors.length >= 1) compPts = 2;
  sub.push({
    id: 'competitive-landscape',
    name: 'Competitive landscape understood',
    pts: compPts,
    maxPts: 4,
    evidence:
      competitors.length > 0
        ? `Tracking: ${competitors.slice(0, 5).join(', ')}`
        : 'No competitors found in research scans',
    confidence: 'high',
    source: 'auto',
  });

  // 4. Vision clarity / tagline test (3 pts) — auto
  const tagline = data.brandBible?.identity?.tagline;
  const taglineWords = tagline ? tagline.split(/\s+/).filter(Boolean).length : 0;
  let visionPts = 0;
  if (tagline && taglineWords >= 3 && taglineWords <= 10) visionPts = 3;
  else if (tagline && taglineWords <= 15) visionPts = 1;
  sub.push({
    id: 'vision-clarity',
    name: 'Vision clarity (tagline test)',
    pts: visionPts,
    maxPts: 3,
    evidence: tagline
      ? `"${tagline}" (${taglineWords} words)`
      : 'No tagline configured',
    confidence: 'high',
    source: 'auto',
  });

  // 5. Near-term roadmap (3 pts) — form
  const roadmap = (formData.nearTermRoadmap as string | undefined) ?? '';
  let rmPts = 0;
  if (roadmap.length > 100) rmPts = 3;
  else if (roadmap.length > 30) rmPts = 1;
  sub.push({
    id: 'roadmap',
    name: 'Near-term roadmap (3-6 months)',
    pts: rmPts,
    maxPts: 3,
    evidence: roadmap ? roadmap.slice(0, 120) : 'No roadmap provided',
    confidence: roadmap ? 'medium' : 'low',
    source: 'form',
  });

  return {
    id: 'strategy',
    name: 'Strategic Position',
    pts: sub.reduce((s, c) => s + c.pts, 0),
    maxPts: 20,
    subcriteria: sub,
  };
}

// =============================================================
// EXECUTION VELOCITY (15 pts)
// =============================================================
export function scoreExecution(
  data: HelmData,
  formData: Record<string, unknown>
): CompassDimension {
  const sub: CompassSubcriterion[] = [];

  // 1. Public activity cadence (5 pts) — auto
  const days = data.daysSinceLastPost;
  let activityPts = 0;
  if (days !== null) {
    if (days <= 7) activityPts = 5;
    else if (days <= 30) activityPts = 3;
    else if (days <= 90) activityPts = 1;
  }
  sub.push({
    id: 'public-activity',
    name: 'Public activity cadence',
    pts: activityPts,
    maxPts: 5,
    evidence:
      days !== null
        ? `Last activity ${days} day(s) ago`
        : 'No public activity tracked',
    confidence: 'high',
    source: 'auto',
  });

  // 2. Shipping cadence (5 pts) — form
  const shipFreq = formData.shippingFrequency as string | undefined;
  let shipPts = 0;
  if (shipFreq === 'weekly') shipPts = 5;
  else if (shipFreq === 'biweekly') shipPts = 4;
  else if (shipFreq === 'monthly') shipPts = 3;
  else if (shipFreq === 'quarterly') shipPts = 1;
  sub.push({
    id: 'shipping-cadence',
    name: 'Shipping cadence',
    pts: shipPts,
    maxPts: 5,
    evidence: shipFreq ? `Self-reported: ${shipFreq}` : 'Not declared',
    confidence: shipFreq ? 'medium' : 'low',
    source: 'form',
  });

  // 3. Content publication (3 pts) — auto
  const postsPerWeek = data.scheduledPostsLast30d / 4.3;
  let contentPts = 0;
  if (postsPerWeek >= 1) contentPts = 3;
  else if (data.scheduledPostsLast30d >= 1) contentPts = 1;
  sub.push({
    id: 'content-publication',
    name: 'Content publication',
    pts: contentPts,
    maxPts: 3,
    evidence: `${data.scheduledPostsLast30d} post(s) in last 30 days (~${postsPerWeek.toFixed(1)}/week)`,
    confidence: 'high',
    source: 'auto',
  });

  // 4. Iteration on feedback (2 pts) — auto from PR #13 ratings
  const totalRated = data.ratedPostsWorkedCount + data.ratedPostsFloppedCount;
  const iterPts = totalRated >= 5 ? 2 : totalRated >= 1 ? 1 : 0;
  sub.push({
    id: 'feedback-iteration',
    name: 'Iteration on feedback',
    pts: iterPts,
    maxPts: 2,
    evidence: `${totalRated} post(s) rated for performance feedback`,
    confidence: totalRated >= 5 ? 'high' : 'low',
    source: 'auto',
  });

  return {
    id: 'execution',
    name: 'Execution Velocity',
    pts: sub.reduce((s, c) => s + c.pts, 0),
    maxPts: 15,
    subcriteria: sub,
  };
}

// =============================================================
// TRACTION MOMENTUM (20 pts)
// =============================================================
export function scoreTraction(
  data: HelmData,
  formData: Record<string, unknown>
): CompassDimension {
  const sub: CompassSubcriterion[] = [];

  // 1. User growth signal (7 pts) — auto
  const growth = data.signupGrowthRate7d;
  let growthPts = 0;
  if (growth >= 50) growthPts = 7;
  else if (growth >= 10) growthPts = 5;
  else if (growth > 0) growthPts = 3;
  else if (data.totalWaitlistResponses > 0) growthPts = 1;
  sub.push({
    id: 'user-growth',
    name: 'User growth (7-day)',
    pts: growthPts,
    maxPts: 7,
    evidence:
      data.totalWaitlistResponses > 0
        ? `${growth >= 0 ? '+' : ''}${growth}% week-over-week (${data.uniqueWaitlistSignups} total)`
        : 'No signups yet',
    confidence: data.totalWaitlistResponses >= 10 ? 'high' : 'low',
    source: 'auto',
  });

  // 2. Press / mentions (4 pts) — auto from research
  const mentions = data.competitorMentions;
  let pressPts = 0;
  if (mentions >= 5) pressPts = 4;
  else if (mentions >= 1) pressPts = 2;
  sub.push({
    id: 'press-mentions',
    name: 'Third-party mentions',
    pts: pressPts,
    maxPts: 4,
    evidence: `${mentions} competitor mention(s) found in research scans`,
    confidence: 'medium',
    source: 'auto',
  });

  // 3. Community / engaged audience (4 pts) — form
  const followers = Number(formData.engagedFollowers ?? 0);
  let commPts = 0;
  if (followers >= 500) commPts = 4;
  else if (followers >= 100) commPts = 2;
  else if (followers >= 25) commPts = 1;
  sub.push({
    id: 'community',
    name: 'Community / engaged audience',
    pts: commPts,
    maxPts: 4,
    evidence:
      followers > 0
        ? `${followers} engaged followers/subscribers (self-reported)`
        : 'No community declared',
    confidence: followers > 0 ? 'medium' : 'low',
    source: 'form',
  });

  // 4. Revenue (3 pts) — form
  const payingUsers = Number(formData.payingUsers ?? 0);
  const monthlyRevenue = Number(formData.monthlyRevenueUsd ?? 0);
  let revPts = 0;
  if (monthlyRevenue >= 1000 || payingUsers >= 10) revPts = 3;
  else if (payingUsers >= 1) revPts = 2;
  sub.push({
    id: 'revenue',
    name: 'Revenue / paid users',
    pts: revPts,
    maxPts: 3,
    evidence:
      payingUsers > 0
        ? `${payingUsers} paying user(s), $${monthlyRevenue}/mo MRR`
        : 'No paid users yet',
    confidence: payingUsers > 0 ? 'high' : 'low',
    source: 'form',
  });

  // 5. Investor interest (2 pts) — form
  const invInterest = formData.investorInterest as string | undefined;
  let invPts = 0;
  if (invInterest === 'active') invPts = 2;
  else if (invInterest === 'soft') invPts = 1;
  sub.push({
    id: 'investor-interest',
    name: 'Investor interest',
    pts: invPts,
    maxPts: 2,
    evidence:
      invInterest === 'active'
        ? 'Active conversations with investors'
        : invInterest === 'soft'
          ? 'Soft inbound interest'
          : 'No investor activity',
    confidence: 'low',
    source: 'form',
  });

  return {
    id: 'traction',
    name: 'Traction Momentum',
    pts: sub.reduce((s, c) => s + c.pts, 0),
    maxPts: 20,
    subcriteria: sub,
  };
}

// =============================================================
// MARKET & SCALABILITY (20 pts)
// =============================================================
export function scoreMarket(
  data: HelmData,
  formData: Record<string, unknown>
): CompassDimension {
  // Market intentionally has fewer auto-pull subcriteria — most of these
  // are claims the founder makes that no Helm data can verify.
  void data;
  const sub: CompassSubcriterion[] = [];

  // 1. TAM (6 pts) — form
  const tam = Number(formData.tamUsd ?? 0);
  let tamPts = 0;
  if (tam >= 10_000_000_000) tamPts = 6;
  else if (tam >= 1_000_000_000) tamPts = 4;
  else if (tam >= 100_000_000) tamPts = 2;
  sub.push({
    id: 'tam',
    name: 'TAM size',
    pts: tamPts,
    maxPts: 6,
    evidence:
      tam > 0
        ? `$${(tam / 1_000_000_000).toFixed(1)}B TAM (self-reported)`
        : 'TAM not provided',
    confidence: tam > 0 ? 'medium' : 'low',
    source: 'form',
  });

  // 2. Innovation factor (5 pts) — form
  const innov = formData.innovationLevel as string | undefined;
  let innoPts = 0;
  if (innov === 'category-creating') innoPts = 5;
  else if (innov === 'novel-approach') innoPts = 3;
  else if (innov === 'incremental') innoPts = 1;
  sub.push({
    id: 'innovation',
    name: 'Innovation factor',
    pts: innoPts,
    maxPts: 5,
    evidence: innov ? `Self-classified: ${innov}` : 'Not declared',
    confidence: innov ? 'medium' : 'low',
    source: 'form',
  });

  // 3. Defensibility / moat (5 pts) — form
  const moat = (formData.moat as string | undefined) ?? '';
  let moatPts = 0;
  if (moat.length > 100) moatPts = 5;
  else if (moat.length > 30) moatPts = 2;
  sub.push({
    id: 'defensibility',
    name: 'Defensibility / moat',
    pts: moatPts,
    maxPts: 5,
    evidence: moat ? moat.slice(0, 120) : 'No moat articulated',
    confidence: moat ? 'medium' : 'low',
    source: 'form',
  });

  // 4. Path to $10M ARR (4 pts) — form
  const path = (formData.pathToScale as string | undefined) ?? '';
  let pathPts = 0;
  if (path.length > 150) pathPts = 4;
  else if (path.length > 50) pathPts = 1;
  sub.push({
    id: 'path-to-scale',
    name: 'Path to $10M ARR',
    pts: pathPts,
    maxPts: 4,
    evidence: path ? path.slice(0, 120) : 'No scale plan articulated',
    confidence: path ? 'medium' : 'low',
    source: 'form',
  });

  return {
    id: 'market',
    name: 'Market & Scalability',
    pts: sub.reduce((s, c) => s + c.pts, 0),
    maxPts: 20,
    subcriteria: sub,
  };
}

// =============================================================
// MAIN SCORING + BAND MAPPING
// =============================================================
export function scoreToBand(score: number): CompassBand {
  if (score >= 90) return 'strong';
  if (score >= 75) return 'clear';
  if (score >= 60) return 'steady';
  if (score >= 45) return 'uncertain';
  return 'off-course';
}

export function bandLabel(band: CompassBand): string {
  return {
    strong: 'Strong heading',
    clear: 'Clear heading',
    steady: 'Steady heading',
    uncertain: 'Uncertain heading',
    'off-course': 'Off course',
  }[band];
}

export function computeScore(
  data: HelmData,
  formData: Record<string, unknown>
): {
  totalScore: number;
  band: CompassBand;
  dimensions: CompassDimension[];
  redFlags: CompassRedFlag[];
  dataQuality: number;
} {
  const dims: CompassDimension[] = [
    scoreValidation(data, formData),
    scoreStrategy(data, formData),
    scoreExecution(data, formData),
    scoreTraction(data, formData),
    scoreMarket(data, formData),
  ];
  const totalScore = dims.reduce((s, d) => s + d.pts, 0);
  const band = scoreToBand(totalScore);

  const redFlags: CompassRedFlag[] = [];
  if (data.uniqueWaitlistSignups === 0) {
    redFlags.push({
      severity: 'warning',
      message: 'Zero waitlist signups — validation gap',
    });
  }
  if (data.daysSinceLastPost !== null && data.daysSinceLastPost > 60) {
    redFlags.push({
      severity: 'warning',
      message: `${data.daysSinceLastPost} days since last public activity — momentum risk`,
    });
  }
  if (!data.brandBible?.identity?.tagline) {
    redFlags.push({
      severity: 'warning',
      message: 'No tagline configured — vision clarity gap',
    });
  }
  if (!data.brandBible?.archetype?.primary) {
    redFlags.push({
      severity: 'warning',
      message: 'Brand archetype not defined',
    });
  }
  if (
    data.uniqueWaitlistSignups > 50 &&
    data.pricingTestResponses.length === 0
  ) {
    redFlags.push({
      severity: 'critical',
      message:
        '50+ signups but no willingness-to-pay validation — risk of zombie waitlist',
    });
  }

  // Data quality: weighted % of subcriteria with high/medium confidence.
  const allSub = dims.flatMap((d) => d.subcriteria);
  const qualitySum = allSub.reduce((s, c) => {
    if (c.confidence === 'high') return s + 1;
    if (c.confidence === 'medium') return s + 0.6;
    if (c.confidence === 'low') return s + 0.2;
    return s;
  }, 0);
  const dataQuality =
    allSub.length > 0
      ? Math.round((qualitySum / allSub.length) * 100)
      : 0;

  return { totalScore, band, dimensions: dims, redFlags, dataQuality };
}
