'use client';

import { createPortal } from 'react-dom';

// PR #86 — Sprint 7.10: Video Avatar settings card.
//
// Three radio options:
//   A. Stock — pick from HeyGen's catalog via /api/heygen/avatars
//   B. Photo — upload a JPG/PNG/WebP (direct browser → Supabase
//      Storage 'avatars' bucket), then save the public URL
//   C. Twin — placeholder ("Coming soon"), saved as a preference
//      but the generate route refuses 'twin' until enrollment
//      ships
//
// Save dispatches PATCH /api/projects/{id}/heygen-avatar with the
// subset of fields the chosen option uses. We always send
// `avatarType` so a saved selection always reflects the radio
// state — even when the founder hasn't picked a stock avatar yet,
// they can stage their intent.
//
// PR Sprint 7.25 Phase 2 — repainted on top of the platform redesign
// (orange-glow card, avatar-option radio cards with active-state
// orange glow, primary orange CTA). The picker modal keeps its
// existing Tailwind utility classes because it's a modal layer
// on top of every page — touching it would be a separate scope.
import { useCallback, useEffect, useState } from 'react';
import {
  uploadAvatarPhoto,
  isAvatarUploadFailure,
  AVATAR_MAX_BYTES,
} from '@/lib/storage/avatar-upload';
import type {
  AvatarOption,
  AvatarCategory,
} from '@/app/api/heygen/avatars/route';
import type {
  VoiceOption,
  VoiceGender,
} from '@/app/api/heygen/voices/route';

// PR Sprint 7.25 Phase 11.15 — 'talking_photo' joins the union as
// the saved DB value for HeyGen's modern UGC/Instant Avatar
// catalog. Visually it still uses the "Use a stock avatar" radio
// (because from the founder's POV it's all "pick from our catalog"),
// but the underlying saved avatarType differs so the fire helper
// can build the correct character payload.
type AvatarType = 'stock' | 'photo' | 'twin' | 'talking_photo';

// Category filter for the picker modal. Matches the values
// AvatarOption.category can take (plus 'all' for no filter).
type CategoryFilter = 'all' | AvatarCategory;

interface AvatarSettings {
  avatarType: AvatarType | null;
  avatarId: string | null;
  photoUrl: string | null;
  voiceId: string | null;
  // PR Sprint C — tracked alongside the IDs so the picker can
  // render the match indicator + auto-pick a gender-matched
  // voice when the founder swaps avatars. Hydrated from
  // /api/projects/{id}/heygen-avatar.
  avatarGender: VoiceGender | null;
  voiceGender: VoiceGender | null;
  // PR Sprint D-1 — advanced tuning. All nullable; null means
  // "let fire.ts pick the smart default". Splices into the
  // HeyGen V2 payload (voice.emotion / voice.locale /
  // voice.speed / character.alpha / character.prompt).
  voiceEmotion: string | null;
  voiceLocale: string | null;
  voiceSpeed: string | null; // numeric column, stored as string with 2 decimals
  avatarExpressiveness: 'high' | 'medium' | 'low' | null;
  avatarMotionPrompt: string | null;
}

// PR Sprint D-1 — closed enum sets used by the picker. The
// server validates the same lists (PATCH /heygen-avatar) so we
// don't drift between frontend display + backend acceptance.
const EMOTION_CHOICES = [
  'Excited',
  'Friendly',
  'Serious',
  'Soothing',
  'Broadcaster',
  'Angry',
] as const;
type EmotionChoice = (typeof EMOTION_CHOICES)[number];

const LOCALE_CHOICES: Array<{ value: string; label: string }> = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'es-MX', label: 'Spanish (Mexico)' },
  { value: 'es-ES', label: 'Spanish (Spain)' },
  { value: 'pt-BR', label: 'Portuguese (Brazil)' },
  { value: 'fr-FR', label: 'French (France)' },
  { value: 'de-DE', label: 'German' },
  { value: 'it-IT', label: 'Italian' },
];

const EXPRESSIVENESS_CHOICES: Array<{
  value: 'high' | 'medium' | 'low';
  label: string;
  hint: string;
}> = [
  {
    value: 'high',
    label: 'High',
    hint: 'Best for UGC and energetic delivery (recommended).',
  },
  { value: 'medium', label: 'Medium', hint: 'Balanced — explainers, demos.' },
  {
    value: 'low',
    label: 'Low',
    hint: 'Calmer delivery — meditative or formal content.',
  },
];

// Normalize an arbitrary string (HeyGen returns 'Male' / 'Female'
// / 'Unknown' / '' / null) into the strict 'male' | 'female' |
// 'neutral' shape we store + match against.
function normalizeGender(raw: string | null | undefined): VoiceGender {
  const lower = (raw ?? '').toLowerCase().trim();
  if (lower === 'male') return 'male';
  if (lower === 'female') return 'female';
  return 'neutral';
}

interface Props {
  projectId: string;
  userId: string;
}

export function HeygenAvatarConfig({ projectId, userId }: Props) {
  const [settings, setSettings] = useState<AvatarSettings>({
    avatarType: null,
    avatarId: null,
    photoUrl: null,
    voiceId: null,
    avatarGender: null,
    voiceGender: null,
    voiceEmotion: null,
    voiceLocale: null,
    voiceSpeed: null,
    avatarExpressiveness: null,
    avatarMotionPrompt: null,
  });
  // PR Sprint D-1 — advanced tuning section is collapsed by
  // default so the Settings card stays scannable for founders
  // who don't care. Auto-expanded on first paint when ANY
  // tuning value is non-null (founder previously tuned it).
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [avatars, setAvatars] = useState<AvatarOption[]>([]);
  const [avatarsLoading, setAvatarsLoading] = useState(false);
  const [avatarsError, setAvatarsError] = useState<string | null>(null);
  // PR Sprint C — voices catalog for auto-matching gender to the
  // selected avatar. We lazy-load on first picker open + on first
  // hydrate of a saved talking_photo avatar (whose default voice
  // was probably null when saved, leaving us no gender to display).
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [genderFilter, setGenderFilter] = useState<
    'all' | 'male' | 'female'
  >('all');
  // PR Sprint 7.25 Phase 11.15 — category tabs in the picker.
  // Defaults to 'all' so founders see the full mixed catalog; the
  // route handler already sorts UGC > lifestyle > other >
  // professional, so the modern avatars surface first regardless.
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [envDisabled, setEnvDisabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/heygen-avatar`);
        if (!res.ok) {
          if (!cancelled) setLoading(false);
          return;
        }
        const data = (await res.json()) as {
          avatarType: AvatarType;
          avatarId: string | null;
          photoUrl: string | null;
          voiceId: string | null;
          // PR Sprint C — server may return null for legacy rows
          // whose genders were never stamped. The picker fills
          // them in on next save.
          avatarGender: string | null;
          voiceGender: string | null;
          // PR Sprint D-1 — tuning fields. All nullable.
          voiceEmotion: string | null;
          voiceLocale: string | null;
          voiceSpeed: string | null;
          avatarExpressiveness: string | null;
          avatarMotionPrompt: string | null;
        };
        if (!cancelled) {
          // PR Sprint 7.25 Phase 11.15 — preserve 'talking_photo'
          // as its own avatarType so the fire helper picks the
          // right character payload, but both 'stock' and
          // 'talking_photo' light up the same "Use a stock avatar"
          // radio in the UI (they're both "pick from our catalog"
          // from the founder's perspective).
          let derived: AvatarType | null = null;
          if (data.avatarType === 'photo' && data.photoUrl) {
            derived = 'photo';
          } else if (data.avatarType === 'twin') {
            derived = 'twin';
          } else if (data.avatarType === 'talking_photo' && data.avatarId) {
            derived = 'talking_photo';
          } else if (data.avatarType === 'stock' && data.avatarId) {
            derived = 'stock';
          }
          // PR Sprint D-1 — normalize expressiveness (DB may
          // hold legacy / unexpected values).
          const exp = data.avatarExpressiveness as
            | 'high'
            | 'medium'
            | 'low'
            | null;
          const validExp =
            exp === 'high' || exp === 'medium' || exp === 'low'
              ? exp
              : null;
          setSettings({
            avatarType: derived,
            avatarId: data.avatarId,
            photoUrl: data.photoUrl,
            voiceId: data.voiceId,
            avatarGender: data.avatarGender
              ? normalizeGender(data.avatarGender)
              : null,
            voiceGender: data.voiceGender
              ? normalizeGender(data.voiceGender)
              : null,
            voiceEmotion: data.voiceEmotion,
            voiceLocale: data.voiceLocale,
            voiceSpeed: data.voiceSpeed,
            avatarExpressiveness: validExp,
            avatarMotionPrompt: data.avatarMotionPrompt,
          });
          // PR Sprint D-1 — auto-expand the advanced section
          // when ANY tuning value is set so the founder sees
          // their current overrides on next visit.
          if (
            data.voiceEmotion ||
            data.voiceLocale ||
            data.voiceSpeed ||
            data.avatarExpressiveness ||
            data.avatarMotionPrompt
          ) {
            setAdvancedOpen(true);
          }
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const loadAvatars = useCallback(async () => {
    setAvatarsLoading(true);
    setAvatarsError(null);
    try {
      const res = await fetch('/api/heygen/avatars');
      const data = (await res.json().catch(() => ({}))) as {
        avatars?: AvatarOption[];
        error?: string;
        errorKind?: string;
      };
      if (data.errorKind === 'feature_disabled') {
        setEnvDisabled(true);
        setAvatars([]);
      } else if (!res.ok) {
        setAvatarsError(data.error ?? 'Failed to load avatars');
      } else {
        setAvatars(data.avatars ?? []);
      }
    } catch (e) {
      setAvatarsError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setAvatarsLoading(false);
    }
  }, []);

  // PR Sprint C — voice catalog loader. Used both to auto-match
  // a gender-correct voice when the founder picks an avatar AND
  // to resolve the gender of a saved voiceId that came from
  // HeyGen's per-avatar `default_voice` (we know the id but not
  // its gender without looking it up). Idempotent — short-
  // circuits once the catalog is in memory.
  const loadVoices = useCallback(async (): Promise<VoiceOption[]> => {
    if (voices.length > 0) return voices;
    setVoicesLoading(true);
    try {
      const res = await fetch('/api/heygen/voices');
      const data = (await res.json().catch(() => ({}))) as {
        voices?: VoiceOption[];
        error?: string;
      };
      const list = data.voices ?? [];
      setVoices(list);
      return list;
    } catch {
      return [];
    } finally {
      setVoicesLoading(false);
    }
  }, [voices]);

  useEffect(() => {
    // PR Sprint 7.25 Phase 11.15 — also auto-load the catalog when
    // the saved avatarType is 'talking_photo' since both share the
    // same "stock" radio + picker modal.
    if (
      (settings.avatarType === 'stock' ||
        settings.avatarType === 'talking_photo') &&
      avatars.length === 0
    ) {
      void loadAvatars();
    }
  }, [settings.avatarType, avatars.length, loadAvatars]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    setSaveMessage(null);
    const result = await uploadAvatarPhoto(file, userId, projectId);
    if (isAvatarUploadFailure(result)) {
      setUploadError(result.error);
      setUploading(false);
      return;
    }
    setSettings((prev) => ({ ...prev, photoUrl: result.url }));
    setUploading(false);
  };

  const handleSave = async () => {
    if (!settings.avatarType) {
      setSaveMessage('Pick an option first.');
      return;
    }
    setSaving(true);
    setSaveMessage(null);
    try {
      const body: Partial<{
        avatarType: AvatarType;
        avatarId: string | null;
        photoUrl: string | null;
        voiceId: string | null;
        // PR Sprint C — gender pairs travel with the rest of
        // the avatar config so fire.ts has the data it needs
        // for gender-aware fallbacks + mismatch warnings.
        avatarGender: VoiceGender | null;
        voiceGender: VoiceGender | null;
        // PR Sprint D-1 — tuning. Always sent (even nulls) so
        // unsetting a value in the UI clears it on the server.
        voiceEmotion: string | null;
        voiceLocale: string | null;
        voiceSpeed: number | null;
        avatarExpressiveness: 'high' | 'medium' | 'low' | null;
        avatarMotionPrompt: string | null;
      }> = {
        avatarType: settings.avatarType,
      };
      // PR Sprint 7.25 Phase 11.15 — both 'stock' and 'talking_photo'
      // store their ID in heygenAvatarId; only 'photo' uses
      // heygenPhotoUrl (legacy column name from when 'photo' was
      // the only talking_photo path).
      if (
        settings.avatarType === 'stock' ||
        settings.avatarType === 'talking_photo'
      ) {
        body.avatarId = settings.avatarId;
      }
      if (settings.avatarType === 'photo') {
        body.photoUrl = settings.photoUrl;
      }
      body.voiceId = settings.voiceId;
      body.avatarGender = settings.avatarGender;
      body.voiceGender = settings.voiceGender;
      // PR Sprint D-1 — tuning fields. Coerce voiceSpeed to a
      // number (state holds the DB-shape string with 2 decimals);
      // null clears the field on the server.
      body.voiceEmotion = settings.voiceEmotion;
      body.voiceLocale = settings.voiceLocale;
      body.voiceSpeed = settings.voiceSpeed
        ? Number(settings.voiceSpeed)
        : null;
      body.avatarExpressiveness = settings.avatarExpressiveness;
      body.avatarMotionPrompt = settings.avatarMotionPrompt;

      const res = await fetch(`/api/projects/${projectId}/heygen-avatar`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<
        AvatarSettings & { error: string }
      >;
      if (!res.ok) {
        setSaveMessage(data.error ?? 'Save failed');
      } else {
        const savedType = data.avatarType as AvatarType | undefined;
        let derived: AvatarType | null = null;
        if (savedType === 'photo' && data.photoUrl) derived = 'photo';
        else if (savedType === 'twin') derived = 'twin';
        else if (savedType === 'talking_photo' && data.avatarId)
          derived = 'talking_photo';
        else if (savedType === 'stock' && data.avatarId) derived = 'stock';
        // PR Sprint C — the PATCH response now returns
        // avatarGender + voiceGender too. Normalize and persist.
        // PR Sprint D-1 — same response also round-trips tuning.
        const respExt = data as typeof data & {
          avatarGender?: string | null;
          voiceGender?: string | null;
          voiceEmotion?: string | null;
          voiceLocale?: string | null;
          voiceSpeed?: string | null;
          avatarExpressiveness?: string | null;
          avatarMotionPrompt?: string | null;
        };
        const exp = respExt.avatarExpressiveness;
        const validExp =
          exp === 'high' || exp === 'medium' || exp === 'low'
            ? (exp as 'high' | 'medium' | 'low')
            : null;
        setSettings({
          avatarType: derived,
          avatarId: data.avatarId ?? null,
          photoUrl: data.photoUrl ?? null,
          voiceId: data.voiceId ?? null,
          avatarGender: respExt.avatarGender
            ? normalizeGender(respExt.avatarGender)
            : null,
          voiceGender: respExt.voiceGender
            ? normalizeGender(respExt.voiceGender)
            : null,
          voiceEmotion: respExt.voiceEmotion ?? null,
          voiceLocale: respExt.voiceLocale ?? null,
          voiceSpeed: respExt.voiceSpeed ?? null,
          avatarExpressiveness: validExp,
          avatarMotionPrompt: respExt.avatarMotionPrompt ?? null,
        });
        setSaveMessage('Saved ✓');
      }
    } catch (e) {
      setSaveMessage(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  const pickRadio = (next: AvatarType) =>
    setSettings((prev) => ({ ...prev, avatarType: next }));

  return (
    <section className="platform-card platform-card-glow-orange platform-reveal-4">
      <div className="platform-lbl">Video avatar</div>
      <h2 className="platform-h2">Avatar for AI video generation</h2>
      <p className="platform-desc">
        Helm uses this avatar to turn Reel and UGC scripts into talking-head
        videos. Stock avatars ship immediately; uploaded photos take{' '}
        <b>5–10 minutes per render</b>.
      </p>

      {envDisabled && (
        <div
          className="platform-field-help"
          style={{
            marginTop: '12px',
            padding: '10px 12px',
            borderRadius: '10px',
            background: 'rgba(249,115,22,0.08)',
            border: '1px solid rgba(249,115,22,0.32)',
            color: 'var(--d-orange-2)',
          }}
        >
          AI video isn&apos;t enabled on this deployment yet. Your selection
          will save and apply automatically once we flip the integration on.
        </div>
      )}

      <div style={{ marginTop: '14px' }}>
        {/* Option A — Stock (covers both 'stock' studio avatars
            and 'talking_photo' UGC/Instant avatars — same picker,
            same radio, the underlying saved type just differs
            based on which catalog the picked avatar came from). */}
        <div
          role="radio"
          tabIndex={0}
          aria-checked={
            settings.avatarType === 'stock' ||
            settings.avatarType === 'talking_photo'
          }
          onClick={() => pickRadio('stock')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              pickRadio('stock');
            }
          }}
          className={`platform-avatar-option${
            settings.avatarType === 'stock' ||
            settings.avatarType === 'talking_photo'
              ? ' platform-avatar-option-on'
              : ''
          }`}
        >
          <span className="platform-avatar-radio" aria-hidden />
          <div className="platform-avatar-body">
            <h4>Use a stock avatar</h4>
            <p>
              Pick from our curated catalog — including modern UGC styles.
              Fastest path: videos render in ~2 minutes.
            </p>

            {(settings.avatarType === 'stock' ||
              settings.avatarType === 'talking_photo') && (
              <div className="platform-avatar-body-inner">
                {avatarsLoading && (
                  <div className="platform-field-help">Loading catalog…</div>
                )}
                {avatarsError && (
                  <div className="platform-field-help" style={{ color: 'var(--d-red-2)' }}>
                    {avatarsError}
                  </div>
                )}

                {!avatarsLoading && !avatarsError && (() => {
                  const selected = settings.avatarId
                    ? avatars.find((a) => a.avatarId === settings.avatarId)
                    : null;
                  if (selected) {
                    return (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '14px',
                          padding: '12px 14px',
                          borderRadius: '12px',
                          background: 'rgba(255,255,255,0.03)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        <div
                          style={{
                            width: '56px',
                            height: '56px',
                            borderRadius: '12px',
                            overflow: 'hidden',
                            border: '2px solid var(--d-orange)',
                            flex: '0 0 auto',
                            background: 'var(--bg-elev)',
                          }}
                        >
                          {selected.previewImageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={selected.previewImageUrl}
                              alt={selected.name}
                              style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover',
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: '100%',
                                height: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'var(--text-3)',
                              }}
                            >
                              ◯
                            </div>
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: '14px',
                              fontWeight: 600,
                              color: 'var(--text-1)',
                            }}
                          >
                            {selected.name}
                          </div>
                          {selected.gender && (
                            <div
                              style={{
                                fontFamily: 'JetBrains Mono, monospace',
                                fontSize: '10px',
                                letterSpacing: '0.12em',
                                textTransform: 'uppercase',
                                color: 'var(--text-3)',
                                marginTop: '2px',
                              }}
                            >
                              {selected.gender}
                            </div>
                          )}
                          {/* PR Sprint C — Avatar + voice gender
                              match indicator. Three states:
                                ✓ match — both genders known +
                                  equal (or one side neutral)
                                ⚠ mismatch — both known + opposite
                                ? unknown — at least one side null
                                  (legacy save without gender)
                              Sits above the "Change avatar" link
                              so the founder sees it as part of
                              the selected avatar summary. */}
                          {(() => {
                            const a = settings.avatarGender;
                            const v = settings.voiceGender;
                            const voicePending = voicesLoading && !v;
                            if (voicePending) {
                              return (
                                <div
                                  style={{
                                    fontFamily:
                                      'JetBrains Mono, monospace',
                                    fontSize: '10px',
                                    letterSpacing: '0.12em',
                                    textTransform: 'uppercase',
                                    color: 'var(--text-3)',
                                    marginTop: '4px',
                                  }}
                                >
                                  Matching voice…
                                </div>
                              );
                            }
                            if (!a || !v) return null;
                            const mismatch =
                              a !== v && a !== 'neutral' && v !== 'neutral';
                            return (
                              <div
                                style={{
                                  fontFamily:
                                    'JetBrains Mono, monospace',
                                  fontSize: '10px',
                                  letterSpacing: '0.12em',
                                  textTransform: 'uppercase',
                                  marginTop: '4px',
                                  color: mismatch
                                    ? 'var(--d-red-2)'
                                    : 'var(--d-green-2)',
                                }}
                                title={
                                  mismatch
                                    ? 'Avatar and voice gender differ. The rendered video may sound off.'
                                    : 'Avatar and voice gender match.'
                                }
                              >
                                {mismatch ? '⚠ Voice gender mismatch' : '✓ Voice match'}
                              </div>
                            );
                          })()}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              // PR Sprint C — pre-warm voices
                              // catalog so when the founder
                              // picks a new avatar the gender
                              // match resolves instantly.
                              void loadVoices();
                              setPickerOpen(true);
                            }}
                            className="platform-ghost-link"
                            style={{ marginTop: '6px' }}
                          >
                            Change avatar
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 16 16"
                              fill="none"
                              aria-hidden
                            >
                              <path
                                d="M3 8h10M9 4l4 4-4 4"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        // PR Sprint C — pre-warm voices catalog
                        // so the gender match resolves the
                        // instant the founder picks an avatar.
                        void loadVoices();
                        setPickerOpen(true);
                      }}
                      className="platform-btn platform-btn-ghost"
                      style={{ width: '100%', justifyContent: 'center' }}
                    >
                      🎬 Choose avatar →{' '}
                      <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>
                        ({avatars.length} available)
                      </span>
                    </button>
                  );
                })()}
              </div>
            )}
          </div>
        </div>

        {/* Option B — Photo */}
        <div
          role="radio"
          tabIndex={0}
          aria-checked={settings.avatarType === 'photo'}
          onClick={() => pickRadio('photo')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              pickRadio('photo');
            }
          }}
          className={`platform-avatar-option${
            settings.avatarType === 'photo'
              ? ' platform-avatar-option-on'
              : ''
          }`}
        >
          <span className="platform-avatar-radio" aria-hidden />
          <div className="platform-avatar-body">
            <h4>Use my photo</h4>
            <p>
              Upload a single portrait — Helm turns it into a talking-head
              avatar. JPG, PNG, or WebP. Max{' '}
              {AVATAR_MAX_BYTES / (1024 * 1024)} MB.
            </p>

            {settings.avatarType === 'photo' && (
              <div
                className="platform-avatar-body-inner"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void handleUpload(f);
                  }}
                  disabled={uploading}
                  className="platform-field-help"
                  style={{ color: 'var(--text-2)' }}
                />
                {uploading && (
                  <div className="platform-field-help" style={{ marginTop: '8px' }}>
                    Uploading…
                  </div>
                )}
                {uploadError && (
                  <div
                    className="platform-field-help"
                    style={{ marginTop: '8px', color: 'var(--d-red-2)' }}
                  >
                    {uploadError}
                  </div>
                )}
                {settings.photoUrl && !uploading && (
                  <div
                    style={{
                      marginTop: '10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={settings.photoUrl}
                      alt="Avatar preview"
                      style={{
                        width: '64px',
                        height: '64px',
                        objectFit: 'cover',
                        borderRadius: '12px',
                        border: '1px solid var(--border)',
                      }}
                    />
                    <div className="platform-field-help">
                      Preview · ready to save
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Option C — Digital Twin (locked) */}
        <div
          role="radio"
          aria-checked={false}
          aria-disabled
          className="platform-avatar-option platform-avatar-option-disabled"
        >
          <span className="platform-avatar-radio" aria-hidden />
          <div className="platform-avatar-body">
            <div className="platform-avatar-head-row">
              <h4>Record a video (15s)</h4>
              <span className="platform-pill-soon">coming soon</span>
            </div>
            <p>
              Record a 15-second clip to train your own Digital Twin avatar.
              Available in a future paid plan.
            </p>
          </div>
        </div>
      </div>

      {/* PR Sprint D-1 — Advanced tuning section. Collapsed by
          default so the avatar/voice picker stays the primary
          surface. Auto-expanded on first paint when any tuning
          value is already set (the founder previously tuned it).
          Every control is "Default" + an override — clearing a
          field reverts to fire.ts's smart default. */}
      <div
        style={{
          marginTop: '18px',
          paddingTop: '18px',
          borderTop: '1px solid var(--border)',
        }}
      >
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            color: 'var(--text-2)',
            fontSize: '13px',
            fontFamily: 'inherit',
          }}
          aria-expanded={advancedOpen}
        >
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
            Advanced
          </span>
          <span>Voice & avatar tuning</span>
          <span style={{ marginLeft: 'auto', color: 'var(--text-3)', fontSize: '11px' }}>
            {advancedOpen ? '▾' : '▸'}
          </span>
        </button>
        {advancedOpen && (
          <div
            style={{
              marginTop: '14px',
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '14px',
            }}
          >
            {/* Emotion */}
            <div>
              <label
                className="platform-field-label"
                htmlFor="heygen-emotion"
              >
                Voice emotion
              </label>
              <select
                id="heygen-emotion"
                className="platform-field-input"
                value={settings.voiceEmotion ?? ''}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    voiceEmotion: e.target.value || null,
                  }))
                }
              >
                <option value="">Default (auto-select)</option>
                {EMOTION_CHOICES.map((em: EmotionChoice) => (
                  <option key={em} value={em}>
                    {em}
                  </option>
                ))}
              </select>
              <p className="platform-field-help">
                Friendly for casual UGC, Broadcaster for announcements.
              </p>
            </div>

            {/* Locale */}
            <div>
              <label
                className="platform-field-label"
                htmlFor="heygen-locale"
              >
                Voice locale / accent
              </label>
              <select
                id="heygen-locale"
                className="platform-field-input"
                value={settings.voiceLocale ?? ''}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    voiceLocale: e.target.value || null,
                  }))
                }
              >
                <option value="">Default (voice native)</option>
                {LOCALE_CHOICES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
              <p className="platform-field-help">
                Match your audience&apos;s region — only takes effect
                on multilingual voices.
              </p>
            </div>

            {/* Speed */}
            <div>
              <label
                className="platform-field-label"
                htmlFor="heygen-speed"
              >
                Voice speed:{' '}
                <span className="platform-field-value">
                  {settings.voiceSpeed
                    ? `${Number(settings.voiceSpeed).toFixed(2)}x`
                    : '1.00x (default)'}
                </span>
              </label>
              <input
                id="heygen-speed"
                type="range"
                min={0.8}
                max={1.2}
                step={0.05}
                value={settings.voiceSpeed ? Number(settings.voiceSpeed) : 1.0}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    voiceSpeed: Number(e.target.value).toFixed(2),
                  }))
                }
                style={{ width: '100%' }}
              />
              <button
                type="button"
                onClick={() =>
                  setSettings((prev) => ({ ...prev, voiceSpeed: null }))
                }
                className="platform-ghost-link"
                style={{ marginTop: '4px', fontSize: '11px' }}
              >
                Reset to default
              </button>
            </div>

            {/* Expressiveness — photo/talking_photo avatars only */}
            <div>
              <label
                className="platform-field-label"
                htmlFor="heygen-expressiveness"
              >
                Avatar expressiveness
              </label>
              <select
                id="heygen-expressiveness"
                className="platform-field-input"
                value={settings.avatarExpressiveness ?? ''}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    avatarExpressiveness:
                      (e.target.value as 'high' | 'medium' | 'low' | '') ||
                      null,
                  }))
                }
              >
                <option value="">Default (high)</option>
                {EXPRESSIVENESS_CHOICES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
              <p className="platform-field-help">
                {EXPRESSIVENESS_CHOICES.find(
                  (c) => c.value === settings.avatarExpressiveness,
                )?.hint ??
                  'Higher = more head + facial motion. Best for UGC.'}
              </p>
            </div>

            {/* Motion prompt — spans 2 columns */}
            <div style={{ gridColumn: '1 / -1' }}>
              <label
                className="platform-field-label"
                htmlFor="heygen-motion-prompt"
              >
                Avatar motion prompt{' '}
                <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>
                  (optional)
                </span>
              </label>
              <textarea
                id="heygen-motion-prompt"
                className="platform-field-input"
                rows={2}
                maxLength={500}
                placeholder="e.g. founder speaking directly to camera, gentle hand gestures, no distracting background motion"
                value={settings.avatarMotionPrompt ?? ''}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    avatarMotionPrompt: e.target.value || null,
                  }))
                }
                style={{ resize: 'vertical', minHeight: '60px' }}
              />
              <p className="platform-field-help">
                Natural-language body language hint for Avatar IV.
                Only applies to photo / UGC avatars (not studio
                catalog avatars).
              </p>
            </div>
          </div>
        )}
      </div>

      {/* PR Sprint D-3 — Voice Design. Lives below the avatar
          + tuning sections because it produces a voice_id you
          could just as well plug into the existing picker. The
          flow: describe the voice you want, get up to 3 matches
          from HeyGen's catalog, click "Use this voice" to stamp
          project.heygenVoiceId. Re-using the same voice picker
          + match indicator above so the new voice shows up with
          its gender automatically. */}
      <VoiceDesignSection
        projectId={projectId}
        currentVoiceId={settings.voiceId}
        avatarGender={settings.avatarGender}
        onVoicePicked={(voice) => {
          setSettings((prev) => ({
            ...prev,
            voiceId: voice.voice_id,
            voiceGender: voice.gender,
            voiceLocale: voice.language_hint ?? prev.voiceLocale,
          }));
          setSaveMessage(
            `Voice "${voice.name}" selected. Click Save to apply.`,
          );
        }}
      />

      <div
        className="platform-actions-row"
        style={{
          justifyContent: 'flex-end',
          marginTop: '22px',
          paddingTop: '18px',
          borderTop: '1px solid var(--border)',
        }}
      >
        {saveMessage && (
          <span
            className="platform-field-help"
            style={{
              marginRight: 'auto',
              color:
                saveMessage === 'Saved ✓'
                  ? 'var(--d-green-2)'
                  : 'var(--d-red-2)',
            }}
          >
            {saveMessage}
          </span>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="platform-btn platform-btn-primary"
        >
          {saving ? 'Saving…' : 'Save avatar settings'}
        </button>
      </div>

      {pickerOpen && (
        <AvatarPickerModal
          avatars={avatars}
          selectedId={settings.avatarId}
          genderFilter={genderFilter}
          onGenderFilterChange={setGenderFilter}
          categoryFilter={categoryFilter}
          onCategoryFilterChange={setCategoryFilter}
          onSelect={(picked) => {
            // PR Sprint C — gender-aware voice auto-match.
            //
            // The bug this fixes: talking_photo (UGC) avatars
            // arrive with `defaultVoiceId: null` from HeyGen, so
            // the legacy line `voiceId: picked.defaultVoiceId ??
            // prev.voiceId` left voiceId untouched. fire.ts then
            // silently fell back to DEFAULT_HEYGEN_VOICE_ID (a
            // female en-US voice) → male avatar speaking with a
            // female voice. The uncanny-valley breaker.
            //
            // New behavior:
            //   - Stamp avatarGender from the AvatarOption.
            //   - If avatar has a defaultVoiceId, use it AND
            //     look up that voice's gender from the catalog
            //     (load on demand). We trust HeyGen's per-avatar
            //     default — it's gender-matched on their side.
            //   - If avatar has NO defaultVoiceId, load the
            //     voices catalog and pick the first
            //     en-US-speaking voice matching the avatar's
            //     gender. That's our auto-match.
            //   - Optimistic UI: stamp the local state
            //     immediately with what we know, then update
            //     once the voice lookup resolves.
            const pickedGender = normalizeGender(picked.gender);
            // Optimistic stamp — gender + ids, voice gender
            // unknown until we resolve below.
            setSettings((prev) => ({
              ...prev,
              avatarType:
                picked.kind === 'talking_photo' ? 'talking_photo' : 'stock',
              avatarId: picked.avatarId,
              avatarGender: pickedGender,
              // Tentatively keep the avatar's default voice (if
              // any); the async block below either confirms its
              // gender or replaces both id + gender with a
              // matched pick.
              voiceId: picked.defaultVoiceId ?? prev.voiceId,
              voiceGender: null,
            }));
            setPickerOpen(false);

            // Async resolution. Don't await — keep the picker
            // close instant. The save button surfaces a soft
            // "matching voice…" hint via voicesLoading until
            // this resolves.
            void (async () => {
              const catalog = await loadVoices();
              if (catalog.length === 0) return; // no signal to use
              if (picked.defaultVoiceId) {
                const match = catalog.find(
                  (v) => v.voiceId === picked.defaultVoiceId,
                );
                if (match) {
                  setSettings((prev) => ({
                    ...prev,
                    voiceGender: match.gender,
                  }));
                  return;
                }
                // Fall through — the per-avatar default isn't
                // in the catalog we got back. Re-pick by gender.
              }
              // No defaultVoiceId (or it wasn't in the catalog):
              // find a gender-matched voice. Prefer English; if
              // none, take any voice that matches gender.
              const sameGender = catalog.filter(
                (v) => v.gender === pickedGender,
              );
              const candidates =
                sameGender.length > 0 ? sameGender : catalog;
              const english = candidates.find((v) =>
                v.language.toLowerCase().includes('english'),
              );
              const auto = english ?? candidates[0];
              if (auto) {
                setSettings((prev) => ({
                  ...prev,
                  voiceId: auto.voiceId,
                  voiceGender: auto.gender,
                }));
              }
            })();
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </section>
  );
}

// PR Sprint 7.13 hotfix v2 — picker modal extracted into its
// own component to keep the main HeyGenAvatarConfig render tree
// readable. Listens for Esc to close + locks body scroll while
// open. Kept on Tailwind utilities (not the platform-* class
// set) because it's a modal layer that floats above every page
// — restyling it falls outside the per-card Settings redesign.
function AvatarPickerModal({
  avatars,
  selectedId,
  genderFilter,
  onGenderFilterChange,
  categoryFilter,
  onCategoryFilterChange,
  onSelect,
  onClose,
}: {
  avatars: AvatarOption[];
  selectedId: string | null;
  genderFilter: 'all' | 'male' | 'female';
  onGenderFilterChange: (v: 'all' | 'male' | 'female') => void;
  // PR Sprint 7.25 Phase 11.15 — category tabs (All / UGC /
  // Professional / Lifestyle). Driven by AvatarOption.category
  // which the route handler heuristically assigns from name +
  // tags + kind (talking_photo always lands in 'ugc').
  categoryFilter: CategoryFilter;
  onCategoryFilterChange: (v: CategoryFilter) => void;
  // onSelect now receives the full AvatarOption so the caller can
  // read both `kind` (drives avatarType) and `defaultVoiceId`
  // (stamps voice).
  onSelect: (picked: AvatarOption) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // PR Sprint 7.25 Phase 11.8 — lock scroll on BOTH document.body
  // AND the dashboard's main scroll container. The dashboard
  // layout puts pages inside <main className="overflow-y-auto"> —
  // so locking body alone doesn't stop the page behind the modal
  // from scrolling when the founder wheels over the avatar grid.
  // We also lock html for safety.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const main = document.querySelector(
      'main.overflow-y-auto',
    ) as HTMLElement | null;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    const prevMain = main?.style.overflow ?? '';
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    if (main) main.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
      if (main) main.style.overflow = prevMain;
    };
  }, []);

  // PR Sprint 7.25 Phase 11.8 — render in a portal to document.body
  // so the modal escapes any ancestor that's creating a containing
  // block for `position: fixed`. The Settings page lives inside
  // <AmbientBackground> + the dashboard layout's <main> wrapper —
  // any one of those (or their children) with a `transform`,
  // `filter`, or `contain` value silently turns our fixed modal
  // into an absolute one. Portaling sidesteps the issue entirely:
  // the modal sits at the document root, fixed positioning works
  // against the viewport unconditionally.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return null;

  // PR Sprint 7.25 Phase 11.15 — compound filter: category × gender.
  // Both default to 'all' so the modal opens with the unfiltered
  // catalog (already pre-sorted UGC-first by the route).
  const filtered = avatars.filter((a) => {
    if (categoryFilter !== 'all' && a.category !== categoryFilter) {
      return false;
    }
    if (genderFilter !== 'all') {
      const g = (a.gender ?? '').toLowerCase();
      if (!g.startsWith(genderFilter[0])) return false;
    }
    return true;
  });

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-2 md:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-modal="true"
      role="dialog"
    >
      <div className="bg-bg-elev border border-border rounded-2xl w-[96vw] max-w-screen-2xl max-h-[95vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="px-5 md:px-7 py-4 border-b border-border flex items-start justify-between gap-4 shrink-0">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
              Stock catalog
            </div>
            <h3 className="font-display text-xl md:text-2xl font-light">
              Choose an avatar
            </h3>
            <p className="text-xs text-text-3 mt-1">
              {filtered.length} of {avatars.length} avatars · click one to
              select
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-3 hover:text-text-1 text-2xl leading-none p-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* PR Sprint 7.25 Phase 11.15 — category tabs. UGC surfaces
            the modern talking_photo styles (Annie, Terry, Christina
            etc); Professional is the legacy studio catalog;
            Lifestyle is the in-between casual-but-not-UGC bucket.
            Sits ABOVE the gender row because category is the
            primary axis founders care about — gender is a refinement
            within a vibe. */}
        <div className="px-5 md:px-7 py-3 border-b border-border flex flex-wrap items-center gap-2 shrink-0">
          <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mr-1">
            Vibe
          </span>
          {(
            [
              ['all', 'All'],
              ['ugc', 'UGC'],
              ['professional', 'Professional'],
              ['lifestyle', 'Lifestyle'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => onCategoryFilterChange(key)}
              className={`px-3 py-1.5 rounded text-[11px] font-mono uppercase tracking-[0.1em] transition-colors ${
                categoryFilter === key
                  ? 'bg-accent text-white'
                  : 'bg-bg border border-border text-text-2 hover:border-border-bright'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="px-5 md:px-7 py-3 border-b border-border flex flex-wrap items-center gap-2 shrink-0">
          <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mr-1">
            Gender
          </span>
          {(
            [
              ['all', 'All'],
              ['male', 'Male'],
              ['female', 'Female'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => onGenderFilterChange(key)}
              className={`px-3 py-1.5 rounded text-[11px] font-mono uppercase tracking-[0.1em] transition-colors ${
                genderFilter === key
                  ? 'bg-accent text-white'
                  : 'bg-bg border border-border text-text-2 hover:border-border-bright'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 md:px-7 py-5">
          {filtered.length === 0 ? (
            <div className="text-sm text-text-3 text-center py-12">
              No avatars match this filter.
            </div>
          ) : (
            <div
              className="grid gap-5"
              style={{
                gridTemplateColumns:
                  'repeat(auto-fill, minmax(260px, 1fr))',
              }}
            >
              {filtered.map((a) => {
                const selected = a.avatarId === selectedId;
                const genderLabel = a.gender
                  ? a.gender.charAt(0).toUpperCase()
                  : null;
                return (
                  <button
                    key={a.avatarId}
                    type="button"
                    onClick={() => onSelect(a)}
                    className={`group relative aspect-[3/4] rounded-xl overflow-hidden border-2 transition-all text-left ${
                      selected
                        ? 'border-accent ring-2 ring-accent/40 scale-[0.98]'
                        : 'border-border hover:border-border-bright hover:scale-[1.02]'
                    }`}
                    aria-pressed={selected}
                  >
                    {a.previewImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={a.previewImageUrl}
                        alt={a.name}
                        className="w-full h-full object-cover bg-bg-elev"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-bg-elev text-text-3 text-4xl">
                        ◯
                      </div>
                    )}

                    {genderLabel && (
                      <span className="absolute top-2.5 right-2.5 text-xs font-mono font-bold px-2 py-1 rounded-md bg-bg/90 text-text-1 backdrop-blur-sm">
                        {genderLabel}
                      </span>
                    )}

                    {a.premium && (
                      <span className="absolute top-2.5 left-2.5 text-[11px] font-mono uppercase tracking-[0.08em] font-bold px-2 py-1 rounded-md bg-accent text-white">
                        Premium
                      </span>
                    )}

                    <div className="absolute bottom-0 inset-x-0 p-3 bg-gradient-to-t from-black/85 via-black/50 to-transparent">
                      <div className="text-base font-medium text-white truncate leading-tight">
                        {a.name}
                      </div>
                    </div>

                    {selected && (
                      <div className="absolute inset-0 flex items-center justify-center bg-accent/20 pointer-events-none">
                        <div className="w-14 h-14 rounded-full bg-accent text-white flex items-center justify-center text-2xl">
                          ✓
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-5 md:px-7 py-3 border-t border-border text-[11px] text-text-3 shrink-0">
          Selecting an avatar updates the form. Remember to click{' '}
          <span className="text-text-1">Save avatar settings</span> to persist
          between sessions.
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ============================================================
// PR Sprint D-3 — Voice Design section
// ============================================================
//
// Sits at the bottom of HeyGenAvatarConfig. Collapsible — closed
// by default so the picker stays the primary surface for
// founders who haven't outgrown HeyGen's pre-made voices.
//
// Founder describes the voice they want in plain English; we hit
// HeyGen's /v3/voices design endpoint, surface up to 3 matches
// with preview-audio players, and let them click "Use this
// voice" to stamp project.heygenVoiceId via the parent's
// onVoicePicked callback. The Save button (parent) then PATCHes
// the project.

interface PickedVoice {
  voice_id: string;
  name: string;
  gender: VoiceGender;
  language_hint: string | null;
}

interface DesignedVoiceRaw {
  voice_id: string;
  name: string;
  language: string;
  gender: string;
  preview_audio_url: string | null;
  support_pause: boolean;
  support_locale: boolean;
  type: 'public' | 'private';
}

function VoiceDesignSection({
  projectId,
  currentVoiceId,
  avatarGender,
  onVoicePicked,
}: {
  projectId: string;
  currentVoiceId: string | null;
  avatarGender: VoiceGender | null;
  onVoicePicked: (v: PickedVoice) => void;
}) {
  void projectId; // currently unused; reserved for per-project favorites in a follow-up
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  // Pre-fill the gender filter from the avatar so the founder
  // doesn't accidentally re-introduce a gender mismatch via this
  // surface. The select is still overridable.
  const [genderFilter, setGenderFilter] = useState<'any' | 'male' | 'female'>(
    avatarGender === 'male' || avatarGender === 'female'
      ? avatarGender
      : 'any',
  );
  const [localeFilter, setLocaleFilter] = useState<string>('');
  const [seed, setSeed] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<DesignedVoiceRaw[]>([]);

  const runDesign = async (nextSeed: number) => {
    if (loading) return;
    if (prompt.trim().length < 1) {
      setError('Describe the voice you want.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        prompt: prompt.trim(),
        seed: nextSeed,
      };
      if (genderFilter !== 'any') body.gender = genderFilter;
      if (localeFilter) body.locale = localeFilter;
      const res = await fetch('/api/heygen/voices/design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        voices?: DesignedVoiceRaw[];
        seed?: number;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? `Design failed (${res.status})`);
        setResults([]);
        return;
      }
      setResults(data.voices ?? []);
      setSeed(data.seed ?? nextSeed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        marginTop: '18px',
        paddingTop: '18px',
        borderTop: '1px solid var(--border)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          color: 'var(--text-2)',
          fontSize: '13px',
          fontFamily: 'inherit',
          width: '100%',
        }}
        aria-expanded={open}
      >
        <span
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: '10px',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--text-3)',
          }}
        >
          Design
        </span>
        <span>Custom voice from description</span>
        <span
          style={{
            marginLeft: 'auto',
            color: 'var(--text-3)',
            fontSize: '11px',
          }}
        >
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div style={{ marginTop: '14px' }}>
          <p
            style={{
              fontSize: '12px',
              color: 'var(--text-3)',
              marginBottom: '10px',
            }}
          >
            Describe the voice you want. Helm returns up to 3
            matches; click <em>Use this voice</em> to stamp it on
            your project.
          </p>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. warm, confident male narrator with a slight Mexican accent"
            rows={2}
            maxLength={1000}
            className="platform-field-input"
            style={{ resize: 'vertical', minHeight: '52px' }}
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '10px',
              marginTop: '8px',
            }}
          >
            <select
              value={genderFilter}
              onChange={(e) =>
                setGenderFilter(e.target.value as 'any' | 'male' | 'female')
              }
              className="platform-field-input"
            >
              <option value="any">Any gender</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
            <select
              value={localeFilter}
              onChange={(e) => setLocaleFilter(e.target.value)}
              className="platform-field-input"
            >
              <option value="">Any locale</option>
              <option value="en-US">English (US)</option>
              <option value="en-GB">English (UK)</option>
              <option value="es-MX">Spanish (Mexico)</option>
              <option value="es-ES">Spanish (Spain)</option>
              <option value="pt-BR">Portuguese (Brazil)</option>
              <option value="fr-FR">French (France)</option>
              <option value="de-DE">German</option>
              <option value="it-IT">Italian</option>
            </select>
          </div>
          <div
            style={{
              display: 'flex',
              gap: '8px',
              marginTop: '12px',
              flexWrap: 'wrap',
            }}
          >
            <button
              type="button"
              onClick={() => void runDesign(0)}
              disabled={loading || prompt.trim().length === 0}
              className="platform-btn platform-btn-primary"
            >
              {loading ? 'Designing…' : 'Find voices'}
            </button>
            {results.length > 0 && (
              <button
                type="button"
                onClick={() => void runDesign(seed + 1)}
                disabled={loading}
                className="platform-btn platform-btn-ghost"
              >
                ↻ Try different voices
              </button>
            )}
          </div>

          {error && (
            <div
              style={{
                marginTop: '10px',
                padding: '8px 12px',
                borderRadius: '8px',
                background: 'rgba(220,38,38,0.08)',
                border: '1px solid rgba(220,38,38,0.3)',
                color: 'var(--d-red-2)',
                fontSize: '12px',
              }}
            >
              {error}
            </div>
          )}

          {results.length > 0 && (
            <div
              style={{
                marginTop: '14px',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: '10px',
              }}
            >
              {results.map((v) => {
                const isCurrent = v.voice_id === currentVoiceId;
                return (
                  <div
                    key={v.voice_id}
                    style={{
                      padding: '12px',
                      border: '1px solid',
                      borderColor: isCurrent
                        ? 'var(--d-orange)'
                        : 'var(--border)',
                      borderRadius: '10px',
                      background: isCurrent
                        ? 'rgba(249,115,22,0.06)'
                        : 'var(--bg)',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: 600,
                        color: 'var(--text-1)',
                      }}
                    >
                      {v.name}
                    </div>
                    <div
                      style={{
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: '10px',
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        color: 'var(--text-3)',
                        marginTop: '2px',
                      }}
                    >
                      {v.language} · {v.gender}
                    </div>
                    {v.preview_audio_url && (
                      <audio
                        src={v.preview_audio_url}
                        controls
                        preload="none"
                        style={{
                          width: '100%',
                          marginTop: '8px',
                          height: '32px',
                        }}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        onVoicePicked({
                          voice_id: v.voice_id,
                          name: v.name,
                          gender: normalizeGender(v.gender),
                          language_hint: v.language,
                        });
                      }}
                      disabled={isCurrent}
                      className="platform-btn platform-btn-ghost"
                      style={{
                        width: '100%',
                        marginTop: '8px',
                        fontSize: '11px',
                      }}
                    >
                      {isCurrent ? '✓ In use' : 'Use this voice'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
