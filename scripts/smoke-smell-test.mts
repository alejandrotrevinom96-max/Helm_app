// Ad-hoc smoke test for lib/voice-engine/authenticity-smell-test.ts.
// We can't easily exercise the live Haiku call here (would need an
// API key + actual generation), so we test the result-parsing and
// helper logic instead. The real call is exercised by the
// /api/ai/generate-structured endpoint in dev.
//
// Run: npx tsx scripts/smoke-smell-test.mts

const mod = await import(
  '../lib/voice-engine/authenticity-smell-test.js'
);

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

// smellTestPasses threshold
expect(
  'smellTestPasses true at 70',
  mod.smellTestPasses({
    score: 70,
    verdict: 'pass',
    primaryIssues: [],
    whatWouldMakeItHuman: '',
  }),
);
expect(
  'smellTestPasses false at 69',
  !mod.smellTestPasses({
    score: 69,
    verdict: 'borderline',
    primaryIssues: [],
    whatWouldMakeItHuman: '',
  }),
);
expect(
  'smellTestPasses custom threshold 80',
  !mod.smellTestPasses(
    {
      score: 75,
      verdict: 'pass',
      primaryIssues: [],
      whatWouldMakeItHuman: '',
    },
    80,
  ),
);

// SmellTestError class
expect(
  'SmellTestError is a constructable Error',
  new mod.SmellTestError('x') instanceof Error,
);

console.log(`\nSummary: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
