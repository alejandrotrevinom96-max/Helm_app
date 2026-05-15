// Ad-hoc smoke test for the product bridge TS ports.
// Validates module shape + the deterministic quality gate + the
// formatBridgeForPrompt helper. The async LLM calls themselves
// (matchBridgeForPain, generateBridgeDrafts) are not exercised
// here — they require a live Anthropic key + are integration-tested
// by the actual generate-structured / onboarding endpoints in dev.
//
// Run: npx tsx scripts/smoke-product-bridges.mts

const intake = await import('../lib/voice-engine/product-bridge-intake.js');
const matcher = await import('../lib/voice-engine/product-bridge-matcher.js');

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

// === Quality gate: drops buzzwords
{
  const r = intake.passesQualityGate(
    'Distribution is hard',
    'Helm leverages AI to streamline your marketing workflow seamlessly.',
  );
  expect('gate drops "leverage" + "streamline" + "seamlessly"', !r.passed);
}

// === Quality gate: drops verbatim pain == bridge
{
  const r = intake.passesQualityGate(
    'Marketing feels overwhelming for solo founders',
    'Marketing feels overwhelming for solo founders',
  );
  expect('gate drops bridge==pain verbatim', !r.passed);
}

// === Quality gate: accepts a clean concrete bridge
{
  const r = intake.passesQualityGate(
    'Voice drift in AI tools',
    "Helm keeps the founder's tone consistent across drafts by loading the voice fingerprint every time.",
  );
  expect('gate passes a clean concrete bridge', r.passed);
}

// === Quality gate: case-insensitive buzzword match
{
  const r = intake.passesQualityGate(
    'Tool sprawl',
    'Helm UNLOCKS a comprehensive workspace.',
  );
  expect('gate is case-insensitive', !r.passed);
}

// === AUTO_APPROVER_ID constant
expect(
  'AUTO_APPROVER_ID v1 marker',
  intake.AUTO_APPROVER_ID === 'system:llm_intake_v1',
);

// === BridgeIntakeError class
expect(
  'BridgeIntakeError is a constructable Error',
  new intake.BridgeIntakeError('x') instanceof Error,
);

// === matchApplies threshold
{
  expect(
    'matchApplies false when confidence below 0.5',
    !matcher.matchApplies({
      matchedPain: 'x',
      matchedBridge: 'y',
      confidence: 0.4,
      reasoning: '',
    }),
  );
  expect(
    'matchApplies true at exactly 0.5',
    matcher.matchApplies({
      matchedPain: 'x',
      matchedBridge: 'y',
      confidence: 0.5,
      reasoning: '',
    }),
  );
  expect(
    'matchApplies false when bridge null even at 0.9',
    !matcher.matchApplies({
      matchedPain: 'x',
      matchedBridge: null,
      confidence: 0.9,
      reasoning: '',
    }),
  );
}

// === formatBridgeForPrompt empty when match doesn't apply
{
  const out = matcher.formatBridgeForPrompt({
    matchedPain: null,
    matchedBridge: null,
    confidence: 0.2,
    reasoning: 'too low',
  });
  expect('formatBridgeForPrompt empty for non-applying match', out === '');
}

// === formatBridgeForPrompt non-empty when match applies
{
  const out = matcher.formatBridgeForPrompt({
    matchedPain: 'Distribution harder than building',
    matchedBridge: 'Helm handles social so the founder focuses on podcasts.',
    confidence: 0.85,
    reasoning: 'direct match',
  });
  expect(
    'formatBridgeForPrompt includes PRODUCT_RELEVANCE header',
    out.includes('PRODUCT_RELEVANCE'),
  );
  expect(
    'formatBridgeForPrompt includes matched bridge text',
    out.includes('Helm handles social'),
  );
  expect(
    'formatBridgeForPrompt includes INTEGRATION RULES',
    out.includes('INTEGRATION RULES'),
  );
}

console.log(`\nSummary: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
