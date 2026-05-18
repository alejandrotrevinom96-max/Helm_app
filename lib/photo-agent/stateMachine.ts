// PR Sprint D-8 Phase 2 — Photo Studio chat-agent state machine.
//
// CRITICAL design rule (learned the hard way from HeyGen V3
// auto_proceed bug, Sprint D-7 fix 84b709d):
//   awaiting_* states NEVER auto-advance. The backend route
//   handler MUST require explicit user input (text, quick-action
//   button, or Approve click) to transition out.
//
// State transitions are enforced by canTransition(). Any
// transition not in the map is rejected with a Sentry-worthy log.
// This is defensive — the UI shouldn't dispatch invalid intents,
// but the backend is the source of truth.

export type PhotoSessionState =
  // Agent has read the brief + brand bible and is composing its
  // first message. Short-lived; flips to awaiting_type_choice as
  // soon as the agent responds.
  | 'understanding'
  // Agent presented options ("photo vs carousel vs upload"); the
  // input is enabled and we're waiting for the founder to pick.
  // Free-text replies route through the intent classifier.
  | 'awaiting_type_choice'
  // PR Sprint UGC+Photo paridad — concept-review checkpoint.
  // Agent has converged on a renderable concept (subject + mood
  // + composition) but HASN'T fired fal.ai yet. Founder reviews
  // in chat, then either:
  //   - "Send feedback" → back to awaiting_type_choice for
  //     iteration (gate clears + refines)
  //   - "✓ Approve & generate" → generating_visual (gate
  //     clears + fal.ai fires)
  // Mirrors the UGC Studio's 'reviewing' state. Approval gate
  // (approvalGateActive on the row) engages whenever we land
  // here so the serializer pins this state for the client.
  | 'reviewing_concept'
  // fal.ai call in flight. Input visible but disabled with a
  // "rendering" placeholder.
  | 'generating_visual'
  // Visual landed; agent showed it + quick-feedback chips. Input
  // enabled — founder approves, iterates by chat, or hits a chip.
  | 'awaiting_visual_feedback'
  // Visual approved; agent suggested 2-3 platforms. Input
  // enabled — founder confirms / adjusts.
  | 'awaiting_platform_choice'
  // Opus call generating per-platform copies in parallel.
  | 'generating_copies'
  // Copies landed; founder can edit, regenerate per-platform, or
  // approve-all to save into Library.
  | 'awaiting_copy_feedback'
  // Saved into Library; the session is read-only.
  | 'finalized'
  // PR Sprint D-bugs — dedicated recovery state when fal.ai
  // returns null / errors but the session is otherwise healthy
  // (concept set, asset type picked, brand bible loaded).
  // Differs from 'failed' (terminal) by being RECOVERABLE: the
  // founder can hit Try Again, refine the concept, or chat to
  // unblock. Lives between generating_visual and either back to
  // generating_visual (retry) or awaiting_type_choice (refine).
  | 'visual_failed'
  // Unrecoverable error (env misconfigured, schema bug, etc.) —
  // founder gets a "start over" affordance.
  | 'failed';

export type IntentKind =
  // Founder said "yes / approve / looks good / use it" in the
  // context of a pending agent question.
  | 'approve'
  // Founder asked for iteration with specifics ("brighter",
  // "warmer palette", "make the TikTok one casual", etc.).
  | 'modify'
  // Founder said "no / don't use it / try something else".
  | 'reject'
  // Founder picked an asset type explicitly via quick-button or
  // free text ("upload", "carousel please").
  | 'pick_type'
  // Founder picked platforms via checkbox or free text.
  | 'pick_platforms'
  // Anything else — agent decides what to do (usually treat as
  // a free-form question / chat reply).
  | 'free_chat';

// Maps current state → set of states the backend may transition
// to in response to a user message. Anything outside this map is
// rejected.
const VALID_TRANSITIONS: Record<PhotoSessionState, Set<PhotoSessionState>> = {
  understanding: new Set([
    'awaiting_type_choice',
    'failed',
  ]),
  awaiting_type_choice: new Set([
    // PR Sprint UGC+Photo paridad — agent converged on a concept
    // → reviewing_concept gate engages instead of firing fal.ai
    // immediately. The old direct-to-generating_visual transition
    // is kept for back-compat with any in-flight session that
    // pre-dates this PR but is otherwise unused.
    'reviewing_concept',
    'generating_visual',
    'awaiting_type_choice',
    'failed',
  ]),
  reviewing_concept: new Set([
    // Approve → fire fal.ai
    'generating_visual',
    // Send feedback → back to chat for refinement
    'awaiting_type_choice',
    // Re-converged on a fresh concept (e.g. founder asked to
    // adjust mood, refiner produced a new concept that's still
    // ready=true). Self-transition is valid; the gate's
    // approvalGateAt bumps so the founder sees the updated
    // concept as a new review.
    'reviewing_concept',
    'failed',
  ]),
  generating_visual: new Set([
    'awaiting_visual_feedback', // fal.ai returned
    // PR Sprint D-bugs — visual_failed replaces the previous
    // awaiting_type_choice fallback. Stale-state ("you already
    // picked a type") was confusing the founder; the dedicated
    // failure state has its own Try-Again chip + chat UI.
    'visual_failed',
    'failed', // env misconfigured / unrecoverable
  ]),
  visual_failed: new Set([
    // Try again with the same concept.
    'generating_visual',
    // Refine the concept first — back to chatting.
    'awaiting_type_choice',
    'failed',
  ]),
  awaiting_visual_feedback: new Set([
    'generating_visual', // founder asked to regenerate
    'awaiting_platform_choice', // founder approved
    'awaiting_visual_feedback', // founder chatted but didn't approve
    'failed',
  ]),
  awaiting_platform_choice: new Set([
    'generating_copies', // founder confirmed platforms
    'awaiting_platform_choice', // founder asked for clarification
    'failed',
  ]),
  generating_copies: new Set([
    'awaiting_copy_feedback', // Opus returned
    'failed',
  ]),
  awaiting_copy_feedback: new Set([
    'generating_copies', // founder asked to regen all (rare)
    'awaiting_copy_feedback', // founder edited one or chatted
    'finalized', // founder approved all → saved to Library
    'failed',
  ]),
  // Terminal states — no transitions out. The founder must start
  // a new session to iterate further. The "Clone & remix" flow
  // (future) seeds a new session with the existing snapshot.
  finalized: new Set([]),
  failed: new Set([]),
};

export function canTransition(
  from: PhotoSessionState,
  to: PhotoSessionState,
): boolean {
  return VALID_TRANSITIONS[from]?.has(to) ?? false;
}

// Helper for the UI: which states should show the chat input as
// visible + enabled. Anything generating_* is visible-but-disabled
// (we want the founder to SEE the workflow continues, just can't
// type mid-render). Terminal states hide the input.
export type InputUiMode = 'enabled' | 'disabled' | 'hidden';

export function inputModeFor(state: PhotoSessionState): InputUiMode {
  if (
    state === 'understanding' ||
    state === 'generating_visual' ||
    state === 'generating_copies'
  ) {
    return 'disabled';
  }
  if (state === 'finalized' || state === 'failed') {
    return 'hidden';
  }
  // visual_failed is RECOVERABLE — input enabled so the founder
  // can refine the concept inline without restarting the session.
  // reviewing_concept is the explicit-approval checkpoint —
  // input enabled so feedback can flow before fal.ai fires.
  return 'enabled';
}

// Quick-action chips per awaiting state. The UI uses this to
// surface contextual shortcuts the founder can hit instead of
// typing. Each chip pre-fills the text input with a seed message
// the founder can tweak before sending — same UX pattern as the
// UGC Studio (Sprint D-7).
export type QuickAction = {
  label: string;
  seed: string;
  // When intent is set, the backend skips the classifier and
  // treats this as the chosen action directly.
  intent?: IntentKind;
};

export function quickActionsFor(state: PhotoSessionState): QuickAction[] {
  switch (state) {
    case 'awaiting_type_choice':
      return [
        { label: '📸 Single photo', seed: 'A single photo', intent: 'pick_type' },
        { label: '📑 Carousel', seed: 'A carousel (5-7 slides)', intent: 'pick_type' },
        { label: '📤 Upload my asset', seed: 'I want to upload my own photo', intent: 'pick_type' },
      ];
    case 'reviewing_concept':
      return [
        // PR Sprint UGC+Photo paridad — explicit-approval chips.
        // Approve fires fal.ai; the others pre-fill the textarea
        // with a starter for iteration. Founder edits then sends.
        { label: '✓ Approve & generate', seed: 'Approve the concept and generate.', intent: 'approve' },
        { label: '🎨 Adjust style', seed: 'Adjust the style: ' },
        { label: '📐 Different composition', seed: 'Try a different composition: ' },
        { label: '🔄 New concept', seed: 'Start with a different concept: ' },
      ];
    case 'visual_failed':
      return [
        // PR Sprint D-bugs — recovery affordances. Try again uses
        // the same concept (retry); Refine concept reopens the
        // chat so the founder can change what they want.
        { label: '🔄 Try again', seed: 'Try generating again with the same concept.', intent: 'approve' },
        { label: '✏️ Refine concept first', seed: 'Let me refine the concept: ' },
      ];
    case 'awaiting_visual_feedback':
      return [
        { label: '✓ Approve visual', seed: 'Looks great — approve and continue.', intent: 'approve' },
        { label: '🌅 Brighter', seed: 'Make it brighter, ' },
        { label: '🌆 Darker', seed: 'Make it darker, ' },
        { label: '🎨 Different palette', seed: 'Change the palette to ' },
        { label: '📐 Different angle', seed: 'Try a different angle, ' },
        { label: '🖼️ Change background', seed: 'Change the background to ' },
        { label: '🔄 Try again', seed: 'Try a completely different take.', intent: 'modify' },
      ];
    case 'awaiting_platform_choice':
      return [
        { label: '✓ Use these', seed: 'Use the suggested platforms.', intent: 'approve' },
        { label: '+ Add Instagram feed', seed: 'Add Instagram feed.', intent: 'pick_platforms' },
        { label: '+ Add LinkedIn', seed: 'Add LinkedIn.', intent: 'pick_platforms' },
        { label: '⚙️ Adjust', seed: 'I want to adjust the platforms: ' },
      ];
    case 'awaiting_copy_feedback':
      return [
        { label: '✓ Approve all', seed: 'Approve all and save to Library.', intent: 'approve' },
        { label: '✏️ Edit one', seed: 'Edit the [platform] one: ' },
        { label: '🔄 Regenerate one', seed: 'Regenerate the [platform] copy with ' },
        { label: '🎚️ More casual', seed: 'Make them more casual.' },
        { label: '🎩 More professional', seed: 'Make them more professional.' },
      ];
    default:
      return [];
  }
}
