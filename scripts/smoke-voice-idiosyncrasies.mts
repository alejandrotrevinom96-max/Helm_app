// Ad-hoc smoke test for lib/voice-engine/voice-idiosyncrasy-extractor.ts.
//
// We can't exercise the DB-touching maybe-refresh-idiosyncrasies
// helper without a live test DB. We CAN exercise the pure extractor
// against synthetic post texts and verify the stats land in the
// right ballpark.
//
// Run: npx tsx scripts/smoke-voice-idiosyncrasies.mts

const mod = await import(
  '../lib/voice-engine/voice-idiosyncrasy-extractor.js'
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

// ============================================================
// Cold start: < 10 posts → null
// ============================================================
{
  const result = mod.extractVoiceIdiosyncrasies([
    { text: 'hello world' },
    { text: 'second post' },
  ]);
  expect('< 10 posts returns null', result === null);
}

// ============================================================
// 10+ posts with informal markers → captures them
// ============================================================
{
  const posts: { text: string }[] = [];
  for (let i = 0; i < 12; i++) {
    posts.push({
      text:
        'ok so tbh i think the marketing stack is broken (around 9 tools). ' +
        'anyway, idk what to do next. fwiw.',
    });
  }
  const idio = mod.extractVoiceIdiosyncrasies(posts);
  if (!idio) {
    expect('extracts non-null for 12 posts', false);
  } else {
    expect('extracts non-null for 12 posts', true);
    expect('captures tbh in fillers', 'tbh' in idio.commonFillerWords);
    expect('captures idk in fillers', 'idk' in idio.commonFillerWords);
    expect('captures fwiw in fillers', 'fwiw' in idio.commonFillerWords);
    expect(
      'captures ok so as opener',
      idio.commonOpeners.includes('ok so'),
    );
    expect(
      'captures fwiw as closer',
      idio.commonClosers.includes('fwiw'),
    );
    expect(
      'lowercase first letter ratio > 0.5',
      idio.lowercaseFirstLetterRatio > 0.5,
    );
    expect(
      'hedging ratio > 0 (around 9 tools)',
      idio.hedgingRatio > 0,
    );
    expect(
      'parenthetical aside per 1000 words > 0',
      idio.parentheticalAsidePer1000Words > 0,
    );
  }
}

// ============================================================
// Outlier trimming: 18 short + 2 huge outliers → stats reflect
// the short majority (fragmentRatio stays high)
// ============================================================
{
  const shortText = 'tbh anyway. idk fwiw. ok so.';
  const longSentence =
    'this is a much longer essay sentence that runs well past the fragment heuristic threshold of four words.';
  const longText = (longSentence + ' ').repeat(100);

  const posts: { text: string }[] = [];
  for (let i = 0; i < 18; i++) posts.push({ text: shortText });
  posts.push({ text: longText });
  posts.push({ text: longText });

  const idio = mod.extractVoiceIdiosyncrasies(posts);
  if (!idio) {
    expect('outlier trim leaves enough for extraction', false);
  } else {
    expect(
      `outlier trim: fragmentRatio stays high (${idio.fragmentRatio})`,
      idio.fragmentRatio >= 0.5,
    );
  }
}

// ============================================================
// Format helper: produces a non-empty WRITER VOICE PROFILE block
// ============================================================
{
  const idio = mod.extractVoiceIdiosyncrasies(
    Array.from({ length: 12 }, () => ({
      text: 'ok so tbh quick observation here. anyway, idk.',
    })),
  );
  if (!idio) {
    expect('format helper has source idio', false);
  } else {
    const block = mod.formatIdiosyncrasiesAsPromptRules(idio);
    expect(
      'WRITER VOICE PROFILE header present',
      block.includes('WRITER VOICE PROFILE'),
    );
    expect(
      'PUNCTUATION PATTERNS section present',
      block.includes('PUNCTUATION PATTERNS'),
    );
    expect(
      'STRUCTURE section present',
      block.includes('STRUCTURE:'),
    );
    expect(
      'APPLICATION RULES section present',
      block.includes('APPLICATION RULES'),
    );
    expect(
      'block reasonable size (under 3000 chars)',
      block.length < 3000,
      `actual ${block.length} chars`,
    );
  }
}

// ============================================================
// Staleness helper
// ============================================================
{
  const fresh: import('../lib/types/brand.js').VoiceIdiosyncrasies = {
    sampleSize: 12,
    extractedAt: new Date().toISOString(),
    emDashPer1000Words: 0,
    ellipsisPer1000Words: 0,
    semicolonPer1000Words: 0,
    parentheticalAsidePer1000Words: 0,
    lowercaseFirstLetterRatio: 0,
    commonFillerWords: {},
    commonProfanity: [],
    profanityPer1000Words: 0,
    avgSentenceLengthWords: 0,
    fragmentRatio: 0,
    emojiPerPost: 0,
    commonEmojis: [],
    commonOpeners: [],
    commonClosers: [],
    hedgingRatio: 0,
    selfCorrectionCount: 0,
  };
  expect('fresh idio is not stale', !mod.isIdiosyncrasiesStale(fresh));

  const old = {
    ...fresh,
    extractedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
  };
  expect('8-day-old idio is stale', mod.isIdiosyncrasiesStale(old));
}

console.log(`\nSummary: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
