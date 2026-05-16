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
  });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [avatars, setAvatars] = useState<AvatarOption[]>([]);
  const [avatarsLoading, setAvatarsLoading] = useState(false);
  const [avatarsError, setAvatarsError] = useState<string | null>(null);
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
          setSettings({
            avatarType: derived,
            avatarId: data.avatarId,
            photoUrl: data.photoUrl,
            voiceId: data.voiceId,
          });
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
        setSettings({
          avatarType: derived,
          avatarId: data.avatarId ?? null,
          photoUrl: data.photoUrl ?? null,
          voiceId: data.voiceId ?? null,
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
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
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
            // PR Sprint 7.25 Phase 11.12 — also stamp the avatar's
            // recommended voice so the next HeyGen call has a
            // valid voice_id. The /v2 API rejects payloads without
            // one. AvatarOption.defaultVoiceId comes from HeyGen's
            // own per-avatar default; falls back to null and the
            // server then uses DEFAULT_HEYGEN_VOICE_ID.
            //
            // PR Sprint 7.25 Phase 11.15 — stamp avatarType from
            // the AvatarOption's `kind` so the save endpoint and
            // fire helper know whether to build an /v2/avatars or
            // /v2/talking_photo payload. The "Stock" radio is the
            // visual UI; the saved DB value carries the catalog
            // origin so the right HeyGen API is called downstream.
            setSettings((prev) => ({
              ...prev,
              avatarType:
                picked.kind === 'talking_photo' ? 'talking_photo' : 'stock',
              avatarId: picked.avatarId,
              voiceId: picked.defaultVoiceId ?? prev.voiceId,
            }));
            setPickerOpen(false);
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
