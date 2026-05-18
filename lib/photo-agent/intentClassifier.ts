// PR Sprint D-8 Phase 2 — intent classifier for Photo Studio chat.
//
// Maps free-text user messages → one of the IntentKind enum
// values. Used only when the UI didn't dispatch an explicit
// intent (i.e. the founder typed in the chat box instead of
// clicking a quick-action chip).
//
// Haiku-only: this is a small classification with a fixed output
// vocabulary. Opus would be wasteful. We also gate on prompt
// length — anything under 4 chars goes to 'free_chat' without
// hitting the API.
//
// IMPORTANT: never return 'approve' for ambiguous messages. The
// false-positive cost is high (HeyGen-style auto-render bug — we
// burn a fal.ai call the founder didn't sanction). When unsure,
// return 'modify' or 'free_chat' so the state stays in awaiting_*.

import { anthropic, MODELS } from '@/lib/ai/claude';
import type { IntentKind, PhotoSessionState } from './stateMachine';

// PR Sprint UGC+Photo polish — assetType inference from free
// text. Lifted from the in-route helper so the create endpoint
// can use it too (skip the picker when the founder's first
// prompt is already specific about the format).
//
// Regex is intentionally generous on common synonyms (es + en)
// and conservative on ambiguous words. Returns null when the
// text doesn't clearly imply a single format — falls back to
// the chip picker UI in that case.
export function inferAssetTypeFromText(
  text: string,
): 'photo' | 'carousel' | 'upload' | null {
  const t = text.toLowerCase();
  if (
    /\b(carousel|carrusel|slides?|slideshow|multi[- ]?image|multiple? images?)\b/.test(
      t,
    )
  ) {
    return 'carousel';
  }
  if (
    /\b(upload|subir|mi (foto|imagen|asset)|attach|enviar (foto|imagen))\b/.test(
      t,
    )
  ) {
    return 'upload';
  }
  if (
    /\b(photo|foto|image|imagen|single (photo|image|shot)|just (one|a) (photo|image))\b/.test(
      t,
    )
  ) {
    return 'photo';
  }
  return null;
}

interface ClassifyInput {
  message: string;
  state: PhotoSessionState;
  // Last agent message — gives the classifier context about what
  // question the founder is answering.
  lastAgentMessage: string | null;
}

// Returned by the classifier. `text` is the original message
// (passed back for downstream convenience); `intent` is what the
// caller should act on.
export interface ClassifiedIntent {
  intent: IntentKind;
  text: string;
}

// Conservative keyword pre-pass — catches obvious approvals
// without paying for a Haiku call. Returns null when ambiguous so
// we fall through to the LLM.
function fastPath(message: string): IntentKind | null {
  const lower = message.toLowerCase().trim();
  // Explicit approvals only — anything with conditions ("yes but
  // change X") goes to the classifier.
  const APPROVALS = new Set([
    'yes',
    'approve',
    'looks good',
    'looks great',
    'use it',
    'use this',
    'ship it',
    'go',
    'do it',
    'ok',
    'okay',
    'perfect',
    'sí',
    'aprueba',
    'aprobado',
    'dale',
    'listo',
  ]);
  if (APPROVALS.has(lower)) return 'approve';
  const REJECTIONS = new Set([
    'no',
    'reject',
    'don\'t use',
    'try again',
    'nope',
    'naah',
  ]);
  if (REJECTIONS.has(lower)) return 'reject';
  return null;
}

export async function classifyIntent(
  input: ClassifyInput,
): Promise<ClassifiedIntent> {
  const message = input.message.trim();
  if (message.length < 4) {
    return { intent: 'free_chat', text: message };
  }
  const fast = fastPath(message);
  if (fast) {
    return { intent: fast, text: message };
  }

  // State-aware classification — the valid intents depend on
  // which awaiting_* state we're in. Telling the model the state
  // narrows the vocabulary and reduces the chance of confidently
  // picking the wrong category.
  const validIntents: IntentKind[] = (() => {
    switch (input.state) {
      case 'awaiting_type_choice':
        return ['pick_type', 'free_chat'];
      case 'awaiting_visual_feedback':
        return ['approve', 'modify', 'reject', 'free_chat'];
      case 'awaiting_platform_choice':
        return ['approve', 'pick_platforms', 'free_chat'];
      case 'awaiting_copy_feedback':
        return ['approve', 'modify', 'free_chat'];
      default:
        return ['free_chat'];
    }
  })();

  const system = `You classify a founder's chat reply to a Photo Studio agent into a fixed intent vocabulary.

Current agent state: ${input.state}
Valid intents (pick ONE): ${validIntents.join(' | ')}

Rules:
- "approve" requires UNAMBIGUOUS yes. Conditional approvals ("yes but change X") are "modify".
- "reject" requires UNAMBIGUOUS no. "I'm not sure" is "free_chat".
- "modify" = founder wants iteration with specifics ("brighter", "warmer palette", etc).
- "pick_type" = founder named an asset type ("carousel", "single photo", "let me upload").
- "pick_platforms" = founder mentioned platforms ("add LinkedIn", "drop TikTok").
- When in doubt: "free_chat".

Output ONLY a JSON object: {"intent": "approve"|"reject"|"modify"|"pick_type"|"pick_platforms"|"free_chat"}
No prose, no markdown fences.`;

  const userBlock = [
    input.lastAgentMessage
      ? `Agent just said: "${input.lastAgentMessage.slice(0, 500)}"`
      : null,
    `Founder replied: "${message.slice(0, 500)}"`,
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const response = await anthropic.messages.create({
      model: MODELS.HAIKU,
      max_tokens: 50,
      system,
      messages: [{ role: 'user', content: userBlock }],
    });
    const block = response.content.find((b) => b.type === 'text');
    const raw = block?.type === 'text' ? block.text.trim() : '';
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned) as { intent?: string };
    const intent = (validIntents as string[]).includes(parsed.intent ?? '')
      ? (parsed.intent as IntentKind)
      : 'free_chat';
    return { intent, text: message };
  } catch {
    // Classifier failed — default to free_chat. NEVER default to
    // approve (would risk an auto-render without user consent).
    return { intent: 'free_chat', text: message };
  }
}
