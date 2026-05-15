// Ad-hoc smoke test for lib/voice-engine/variety-injector.ts.
// Validates the deterministic decision logic (cold start, cooldown,
// archetype rotation) using a seeded RNG so behavior is reproducible.
//
// Run: npx tsx scripts/smoke-variety-injector.mts

const mod = await import('../lib/voice-engine/variety-injector.js');

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

const now = () => new Date().toISOString();

// ============================================================
// shouldInjectVariety
// ============================================================

// Cold start: < 5 usages → never fires regardless of RNG.
{
  const result = mod.shouldInjectVariety({
    recentArchetypes: [
      { archetype: 'essay', usedAt: now(), wasVarietyInjected: false },
      { archetype: 'essay', usedAt: now(), wasVarietyInjected: false },
    ],
    config: { injectionProbability: 1.0 }, // force max prob
    rng: () => 0, // force pass
  });
  expect('cold start (< 5 usages) blocks variety', !result);
}

// 5+ usages + force RNG pass + no cooldown → fires.
{
  const result = mod.shouldInjectVariety({
    recentArchetypes: Array.from({ length: 6 }, () => ({
      archetype: 'essay' as const,
      usedAt: now(),
      wasVarietyInjected: false,
    })),
    rng: () => 0,
  });
  expect('5+ usages + force RNG pass fires variety', result);
}

// Probability not met → does not fire.
{
  const result = mod.shouldInjectVariety({
    recentArchetypes: Array.from({ length: 6 }, () => ({
      archetype: 'essay' as const,
      usedAt: now(),
      wasVarietyInjected: false,
    })),
    config: { injectionProbability: 0.15 },
    rng: () => 0.99,
  });
  expect('rng above probability blocks variety', !result);
}

// Cooldown active (recent variety injection) → blocks.
{
  const recents = Array.from({ length: 6 }, () => ({
    archetype: 'essay' as const,
    usedAt: now(),
    wasVarietyInjected: false,
  }));
  recents.push({
    archetype: 'shitpost' as const,
    usedAt: now(),
    wasVarietyInjected: true,
  });
  const result = mod.shouldInjectVariety({
    recentArchetypes: recents,
    rng: () => 0,
  });
  expect('recent variety injection triggers cooldown', !result);
}

// Disabled in config → never fires.
{
  const result = mod.shouldInjectVariety({
    recentArchetypes: Array.from({ length: 10 }, () => ({
      archetype: 'essay' as const,
      usedAt: now(),
      wasVarietyInjected: false,
    })),
    config: { enabled: false },
    rng: () => 0,
  });
  expect('enabled=false blocks variety', !result);
}

// ============================================================
// selectVarietyArchetype
// ============================================================

// Never picks essay (variety means "not the default").
{
  for (let i = 0; i < 20; i++) {
    const picked = mod.selectVarietyArchetype({
      recentArchetypes: [],
      rng: () => i / 20,
    });
    if (picked === 'essay') {
      expect('selectVarietyArchetype never returns essay', false);
      break;
    }
  }
  expect('selectVarietyArchetype never returns essay (20 trials)', true);
}

// Prefers archetypes not in the sliding window.
{
  const recents = [
    { archetype: 'shitpost' as const, usedAt: now(), wasVarietyInjected: false },
    { archetype: 'contrarian' as const, usedAt: now(), wasVarietyInjected: false },
    { archetype: 'vulnerable' as const, usedAt: now(), wasVarietyInjected: false },
  ];
  for (let i = 0; i < 30; i++) {
    const picked = mod.selectVarietyArchetype({
      recentArchetypes: recents,
      rng: () => i / 30,
    });
    if (
      picked === 'shitpost' ||
      picked === 'contrarian' ||
      picked === 'vulnerable'
    ) {
      expect(
        'selectVarietyArchetype avoids recent archetypes',
        false,
        `picked recent ${picked} on trial ${i}`,
      );
      break;
    }
  }
  expect(
    'selectVarietyArchetype avoids recent archetypes (30 trials)',
    true,
  );
}

// All non-essay used → falls back to LRU.
{
  const allUsedRecents = (
    [
      'shitpost',
      'contrarian',
      'vulnerable',
      'observation',
      'data_drop',
      'story',
      'question',
      'meta',
    ] as const
  ).map((archetype, idx) => ({
    archetype,
    usedAt: new Date(Date.UTC(2024, 0, idx + 1)).toISOString(),
    wasVarietyInjected: false,
  }));
  const picked = mod.selectVarietyArchetype({
    recentArchetypes: allUsedRecents,
  });
  // Oldest is shitpost (Jan 1), so LRU should pick it.
  expect(
    'LRU fallback when all archetypes recently used',
    picked === 'shitpost',
    `picked ${picked}`,
  );
}

// ============================================================
// recordArchetypeUsage
// ============================================================

// Appends with the right metadata + trims to cap.
{
  const start = Array.from({ length: 25 }, (_, i) => ({
    archetype: 'essay' as const,
    usedAt: new Date(Date.UTC(2024, 0, i + 1)).toISOString(),
    wasVarietyInjected: false,
  }));
  const next = mod.recordArchetypeUsage(start, 'shitpost', true);
  expect(
    'appended record has wasVarietyInjected=true',
    next[next.length - 1]?.wasVarietyInjected === true,
  );
  expect(
    'appended record has the new archetype',
    next[next.length - 1]?.archetype === 'shitpost',
  );
  // Window cap is max(2*10, 20) = 20 by default; start had 25,
  // appending 1 → 26 → trimmed to 20.
  expect(
    `recent window trimmed to cap (expected 20, got ${next.length})`,
    next.length === 20,
  );
}

// ============================================================
// getVarietyInstruction
// ============================================================

const archetypes = [
  'essay',
  'shitpost',
  'contrarian',
  'vulnerable',
  'observation',
  'data_drop',
  'story',
  'question',
  'meta',
] as const;
let allHaveInstructions = true;
for (const a of archetypes) {
  const ins = mod.getVarietyInstruction(a);
  if (!ins.includes('VARIETY MODE') || ins.length < 100) {
    allHaveInstructions = false;
    console.log(`[!!] ${a} instruction too short or missing`);
  }
}
expect('every archetype has a non-empty VARIETY MODE instruction', allHaveInstructions);

console.log(`\nSummary: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
