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
  // Unrecoverable error (fal.ai down, Claude error, etc.) —
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
    'generating_visual', // founder picked a type + concept
    'awaiting_type_choice', // founder asked for clarification, re-prompt
    'failed',
  ]),
  generating_visual: new Set([
    'awaiting_visual_feedback', // fal.ai returned
    // PR Sprint D-finish — allow falling back to awaiting_type_
    // choice when fal.ai returns null on a recoverable cause
    // (thin concept, transient Flux error). The founder iterates
    // on the concept and re-fires instead of having to start a
    // brand-new session for what's effectively a "try again".
    'awaiting_type_choice',
    'failed', // fal.ai down / env misconfigured / bad result
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
