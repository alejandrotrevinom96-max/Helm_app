// PR Sprint D-8 Phase 2 — concept builder for Photo Studio.
//
// Two responsibilities:
//
//   buildFirstMessage()
//     Greets the founder + sets up the conversation. Three flavors
//     depending on what context the session arrived with:
//       - no context     → asks what kind of asset they want
//       - pain point     → opens with the real audience quote +
//                          suggests 3 angles
//       - free prompt    → confirms the agent's interpretation
//     Output is the agent's first chat message (plain text), kept
//     under ~120 words so the founder isn't reading a wall of
//     text before they reply.
//
//   refineConcept()
//     Given the running chat thread + brand bible + current
//     concept (if any), produces:
//       - an updated `concept` string ready to pass to
//         lib/visuals/generate.ts as postContent, AND
//       - an agent reply for the chat thread that explains what
//         it's about to do
//     Concept refinement is conservative: if the founder hasn't
//     actually narrowed enough for a Flux call, the function
//     returns ready=false and the agent's reply asks one
//     clarifying question instead of generating.
//
// CRITICAL: this module produces the CONCEPT only. It never
// builds the actual Flux prompt — that's the job of
// lib/visuals/generate.ts (which has the IR pipeline +
// brand-aware visual builder already battle-tested).

import { anthropic, MODELS, cachedSystem } from '@/lib/ai/claude';
import type { BrandBible } from '@/lib/types/brand';

interface FirstMessageInput {
  founderFirstName: string | null;
  brandBible: BrandBible | null;
  rawPrompt: string;
  painPoint: {
    theme: string;
    sampleQuote: string;
    actionableAngle: string;
  } | null;
}

function brandArchetype(b: BrandBible | null): string {
  return b?.archetype?.primary ?? 'your brand';
}

function audienceDescription(b: BrandBible | null): string {
  return b?.audience?.primary?.description ?? 'your audience';
}

export async function buildFirstMessage(
  input: FirstMessageInput,
): Promise<string> {
  const { founderFirstName, brandBible, rawPrompt, painPoint } = input;
  const name = founderFirstName?.split(' ')[0] ?? 'there';

  // PAIN-POINT case: the agent has a real audience quote to work
  // with. Open with it, then suggest concrete angles.
  if (painPoint) {
    const system = `You are a visual content director for a founder's brand. The founder just opened a session with a specific audience pain point in mind. Your first message:

1. Greet by first name (warm, single line)
2. Echo the pain point theme verbatim
3. Quote the real audience sample (in quotes)
4. Suggest THREE concrete visual angles, each one short (≤15 words). Pick angles that play to the brand's archetype.
5. End with a question that invites the founder to pick or describe their own angle.

Brand archetype: ${brandArchetype(brandBible)}
Audience: ${audienceDescription(brandBible)}

Tone: peer-to-peer, never salesy. Under 120 words total.`;

    const user = `Founder first name: ${name}
Pain point theme: ${painPoint.theme}
Real audience quote: "${painPoint.sampleQuote}"
${painPoint.actionableAngle ? `Suggested angle from research: ${painPoint.actionableAngle}` : ''}

Write the agent's first chat message.`;

    const r = await anthropic.messages.create({
      model: MODELS.HAIKU,
      max_tokens: 400,
      system: cachedSystem(system),
      messages: [{ role: 'user', content: user }],
    });
    const block = r.content.find((b) => b.type === 'text');
    return block?.type === 'text' ? block.text.trim() : fallbackFirstMessage(name);
  }

  // FREE PROMPT case: confirm interpretation, ask once before
  // generating.
  if (rawPrompt.trim().length > 4) {
    const system = `You are a visual content director for a founder's brand. The founder typed a prompt to start a Photo Studio session. Your first message:

1. Greet by first name (warm, single line)
2. Restate what you understand the brief to be (1 sentence, in your own words)
3. Mention 1-2 specific visual choices you'd make (composition / palette / mood) that fit the brand archetype
4. End with a direct yes/no question: "Sound right, or should I go a different direction?"

Brand archetype: ${brandArchetype(brandBible)}

Tone: confident but not pushy. Under 100 words total.`;

    const user = `Founder first name: ${name}
Founder's prompt: "${rawPrompt}"

Write the agent's first chat message.`;

    const r = await anthropic.messages.create({
      model: MODELS.HAIKU,
      max_tokens: 350,
      system: cachedSystem(system),
      messages: [{ role: 'user', content: user }],
    });
    const block = r.content.find((b) => b.type === 'text');
    return block?.type === 'text' ? block.text.trim() : fallbackFirstMessage(name);
  }

  // NO CONTEXT case: simple greeting + asset-type question. No
  // LLM call needed — deterministic copy is plenty.
  return [
    `Hi ${name}! I'm your photo agent.`,
    brandBible?.archetype?.primary
      ? `I know your brand is ${brandBible.archetype.primary} for ${audienceDescription(brandBible)}.`
      : null,
    '',
    'What would you like to create?',
    '  • A carousel (5-7 slides)',
    '  • A single photo with caption',
    '  • Upload a product photo and I\'ll build around it',
    '',
    'Or just describe what you have in mind.',
  ]
    .filter((l) => l !== null)
    .join('\n');
}

function fallbackFirstMessage(name: string): string {
  return `Hi ${name}! I'm your photo agent. What would you like to create today? (carousel / single photo / upload an asset)`;
}

interface RefineConceptInput {
  brandBible: BrandBible | null;
  // The full chat so far. Newest message LAST.
  messages: Array<{ role: 'user' | 'agent'; content: string }>;
  // Previous concept (null when this is the first refinement).
  currentConcept: string | null;
  assetType: 'photo' | 'carousel' | 'upload' | null;
}

export interface ConceptRefineResult {
  // Updated concept string. Pass this to generateVisual() as
  // postContent. Empty when ready=false.
  concept: string;
  // True when the concept is specific enough to generate. False
  // when the agent needs more info — the chatReply asks a single
  // clarifying question.
  ready: boolean;
  // What the agent says back to the founder. Always non-empty.
  chatReply: string;
}

export async function refineConcept(
  input: RefineConceptInput,
): Promise<ConceptRefineResult> {
  const { brandBible, messages, currentConcept, assetType } = input;

  // Cap the chat thread we send to keep prompt size sane on long
  // sessions. The most recent ~10 turns capture all the relevant
  // intent; older turns are background.
  const recent = messages.slice(-10);
  const threadText = recent
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n');

  // PR Sprint D-bugs — pick out the latest user message so the
  // system prompt can demand an explicit acknowledgement of what
  // the founder just said. Pre-fix the agent rendered a generic
  // "tell me more" loop regardless of how concrete the input
  // was; founders interpreted that as their input being ignored.
  const lastUser = [...recent].reverse().find((m) => m.role === 'user');

  const system = `You are a visual content director refining a concept for an image-generation pipeline. Output ONLY valid JSON.

CRITICAL RULES (read these first):

0. NEVER mention upstream tooling (Flux, fal, fal.ai, HeyGen, Claude, Anthropic, OpenAI, Midjourney, Stable Diffusion, etc.) in chatReply. Talk about "the image generator" or "the render" generically. The founder must never see the provider name in your reply.

1. ACKNOWLEDGE the founder's most recent message in chatReply. If they said "metaphorical images with light colors", your chatReply MUST start by paraphrasing that ("Got it — metaphorical, light palette..."). NEVER respond with a generic "Can you tell me more?" — that's the loop bug we're fixing.

2. BE EAGER TO MARK ready=true. The bar is "do I have enough to produce a decent image concept?", NOT "do I have a brief good enough to win a design award?". If the founder gives you:
   - Subject (what the image is OF) + ANY one other hint (mood OR palette OR composition OR metaphor OR audience reference), set ready=true and ship the concept.
   - A pain point handoff from Research already counts as subject + audience context — that alone is enough to ship.
   - "carousel about productivity" with no other detail → still ready=true; the concept can be "Carousel about productivity, modern photographic style, warm tones, founder-relatable composition."

3. ONLY return ready=false when the founder has literally given NO subject (e.g. they just said "ok" or "hi" or "make video"). In that single case, ask ONE specific question naming what's missing ("What's the subject — a product, a person, a metaphor?"), not the generic "tell me more".

4. Build the concept by ACCUMULATING context across turns. Each new founder message adds detail to the previous concept; don't reset.

Brand archetype: ${brandArchetype(brandBible)}
Asset type: ${assetType ?? 'unspecified — assume single photo'}

Output schema:
{"concept": string, "ready": boolean, "chatReply": string}
- concept: ≤280 chars, ready-to-render description. Include subject + mood + composition cues.
- ready: true unless the founder literally gave you no subject.
- chatReply: 1-3 sentences. ALWAYS acknowledge what the founder said. If ready=true, end with "Generating now…" or similar. If ready=false, end with ONE specific question.`;

  const userBlock = [
    `Chat thread so far:\n${threadText}`,
    currentConcept
      ? `\nPrevious concept (extend with new detail — don't replace from scratch): "${currentConcept}"`
      : '',
    lastUser
      ? `\nFounder's LATEST message (this is what your chatReply must explicitly acknowledge): "${lastUser.content.slice(0, 500)}"`
      : '',
    `\nProduce the JSON now.`,
  ].join('\n');

  try {
    const r = await anthropic.messages.create({
      model: MODELS.HAIKU,
      max_tokens: 500,
      system: cachedSystem(system),
      messages: [{ role: 'user', content: userBlock }],
    });
    const block = r.content.find((b) => b.type === 'text');
    const raw = block?.type === 'text' ? block.text.trim() : '';
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned) as {
      concept?: string;
      ready?: boolean;
      chatReply?: string;
    };
    // PR Sprint D-bugs — if the founder sent at least 2 turns and
    // the model STILL says ready=false, force-ship anyway. The
    // worst case is a slightly weaker concept; the previous
    // behavior was an infinite "tell me more" loop. Cap to 2
    // turns so a single-message session doesn't bypass the
    // clarifier on a literal empty input.
    const userTurns = recent.filter((m) => m.role === 'user').length;
    const forceShip =
      userTurns >= 2 &&
      !Boolean(parsed.ready) &&
      (String(parsed.concept ?? '').length > 0 ||
        (currentConcept ?? '').length > 0);
    return {
      concept: String(
        parsed.concept ?? currentConcept ?? lastUser?.content ?? '',
      ).slice(0, 280),
      ready: Boolean(parsed.ready) || forceShip,
      chatReply:
        String(parsed.chatReply ?? '').trim() ||
        (lastUser
          ? `Got it — "${lastUser.content.slice(0, 80)}". Generating now…`
          : 'Generating now…'),
    };
  } catch {
    // Conservative fallback — never auto-generate on classifier
    // failure. Force one more turn so the founder can clarify.
    return {
      concept: currentConcept ?? '',
      ready: false,
      chatReply: lastUser
        ? `Got "${lastUser.content.slice(0, 60)}". What subject should the image show — a product, person, or metaphor?`
        : 'What subject should the image show — a product, person, or metaphor?',
    };
  }
}
