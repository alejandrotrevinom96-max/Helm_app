// Ad-hoc smoke test for lib/voice-engine/text-post-validator.ts.
// Validates the TS port against the same cases the Python upstream
// runner covers. Not a permanent test fixture — just enough to
// guarantee the port behaves at parity before shipping.
//
// Run: npx tsx scripts/smoke-text-post-validator.mts
// Dynamic import sidesteps a tsx static-export resolution quirk on
// Windows where the named-import check fires before the .ts file is
// fully transformed. Runtime behavior is identical.
const {
  validateTextPost,
  countXNotYPatterns,
  checkTricolon,
  checkMaxHeaders,
  checkAuthenticityMarkers,
  flattenStructuredContentForValidation,
} = await import('../lib/voice-engine/text-post-validator.js');

let pass = 0;
let fail = 0;
function expect(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++;
    console.log(`[ok] ${name}`);
  } else {
    fail++;
    console.log(`[!!] ${name}${detail ? ' — ' + detail : ''}`);
  }
}

expect(
  'C1 x-not-y (period chiastic)',
  countXNotYPatterns(
    'The skill that got you to a working product is almost the opposite of ' +
      "the skill that gets people to use it. It's not a productivity problem. " +
      "It's a systems problem. Specific decisions, not generic lessons.",
  ) >= 3,
);

expect(
  'Patch 1 comma chiastic',
  countXNotYPatterns(
    'If your distribution plan requires you to become a different person, ' +
      "it's not a plan, it's a costume.",
  ) >= 1,
);

expect(
  'Patch 1 tricolon (same first word)',
  checkTricolon('Not a content calendar. Not a funnel diagram. Not a buyer persona.')
    .length >= 1,
);

expect(
  'Patch 1 tricolon (no false positive on 2 sentences)',
  checkTricolon('Build it. Ship it.').length === 0,
);

expect(
  'C7 max headers Reddit (3 > 2)',
  checkMaxHeaders('## A\ncontent\n## B\ncontent\n## C\ncontent', {
    platform: 'reddit',
  }).length >= 1,
);

expect(
  'C7 max headers no platform default (5)',
  checkMaxHeaders('## A\ncontent\n## B\ncontent\n## C\ncontent').length === 0,
);

expect(
  'C6 reddit missing markers',
  checkAuthenticityMarkers(
    'Spent 14 months building. Distribution is harder than I thought.',
    'reddit',
  ).length >= 1,
);

expect(
  'C6 reddit with marker (tbh)',
  checkAuthenticityMarkers(
    'Spent 14 months building. Distribution is harder than I thought tbh.',
    'reddit',
  ).length === 0,
);

expect(
  'C6 linkedin no requirement',
  checkAuthenticityMarkers('Clean LinkedIn copy without markers.', 'linkedin').length === 0,
);

const flat = flattenStructuredContentForValidation({
  opening: 'tbh I cut my marketing stack from 7 to 1.',
  body: 'Lost some muscle memory. Gained around 3 hours per week.',
  closing: 'Anyway, what worked for you?',
});
expect(
  'flatten preserves all string fields',
  flat.includes('tbh') && flat.includes('Anyway') && flat.includes('muscle memory'),
);

const authenticReddit =
  'Cut my tool stack from 7 to 1 (give or take) over the last couple ' +
  'months. tbh the consolidation was easier than I expected. anyway, ' +
  'revenue is up around 12%. fwiw.';
expect(
  'validateTextPost authentic Reddit passes',
  validateTextPost(authenticReddit, { platform: 'reddit' }).length === 0,
);

const aiShapedReddit =
  '## What I expected\n\n' +
  "If your distribution plan requires you to become a different person, it's not a plan, it's a costume.\n\n" +
  '## What actually happened\n\n' +
  'Not a content calendar. Not a funnel diagram. Not a buyer persona.\n\n' +
  '## The numbers\n\n' +
  '14 months. 0 outbound. 142 paid.\n\n' +
  '## What I am trying next\n\n' +
  'Cold DMs. What worked for you? Specifically: did anyone crack a channel?';
const aiFailures = validateTextPost(aiShapedReddit, { platform: 'reddit' });
expect(
  'validateTextPost AI-shaped Reddit catches multiple issues',
  aiFailures.length >= 4,
  `got ${aiFailures.length} failures`,
);

console.log(`\nSummary: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
