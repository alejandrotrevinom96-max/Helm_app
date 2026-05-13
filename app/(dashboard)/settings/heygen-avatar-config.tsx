'use client';

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
import { useCallback, useEffect, useState } from 'react';
import { GlassCard } from '@/components/ui/glass-card';
import {
  uploadAvatarPhoto,
  isAvatarUploadFailure,
  AVATAR_MAX_BYTES,
} from '@/lib/storage/avatar-upload';
import type { AvatarOption } from '@/app/api/heygen/avatars/route';

type AvatarType = 'stock' | 'photo' | 'twin';

// PR Sprint 7.13 hotfix v2 — local state widens avatarType to
// `AvatarType | null` so the UI can express the "no option
// chosen yet" state. The API still persists one of the three
// concrete strings (DB column defaults to 'stock'); we just
// don't pre-check any radio at first render unless the saved
// row has actual selection data (avatarId or photoUrl) backing
// it.
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
  // PR Sprint 7.13 hotfix v2 — the larger picker lives in a
  // modal overlay, not inline. Opens via a "Choose avatar" /
  // "Change avatar" button under the stock option. Keeps the
  // Settings card compact while giving the founder enough
  // canvas to actually compare faces at a useful size.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [avatars, setAvatars] = useState<AvatarOption[]>([]);
  const [avatarsLoading, setAvatarsLoading] = useState(false);
  const [avatarsError, setAvatarsError] = useState<string | null>(null);
  // PR Sprint 7.13 hotfix — gender filter on the avatar grid.
  // 'all' is the default; the buttons toggle to 'male' or
  // 'female' which filters the rendered grid client-side
  // (HeyGen's /v2/avatars already returns the full list).
  const [genderFilter, setGenderFilter] = useState<
    'all' | 'male' | 'female'
  >('all');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  // Feature-flag echo — if HeyGen is disabled at deployment level
  // we still render the card but show a banner explaining the
  // settings persist for when the integration flips on.
  const [envDisabled, setEnvDisabled] = useState(false);

  // Initial load — fetch the saved selection for this project.
  // PR Sprint 7.13 hotfix v2: derive avatarType from whether
  // the saved row has an actual avatarId / photoUrl. Pre-fix
  // the API would default avatarType='stock' for every founder
  // (because the DB column defaults to 'stock') even though no
  // stock avatar had ever been picked — making the radio pre-
  // check feel like an arbitrary opinion. Now: no selection
  // signal in the row → no radio pre-checked.
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
          let derived: AvatarType | null = null;
          if (data.avatarType === 'photo' && data.photoUrl) {
            derived = 'photo';
          } else if (data.avatarType === 'twin') {
            // Twin is locked but we honor a saved selection so
            // the founder sees their intent persisted.
            derived = 'twin';
          } else if (data.avatarType === 'stock' && data.avatarId) {
            // Only pre-check 'stock' when an avatarId is
            // ACTUALLY saved — distinguishes "default fired" from
            // "user picked stock".
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

  // Lazy-load the stock avatar list only when the user is on the
  // stock option (saves an upstream HeyGen call for photo-avatar
  // users).
  useEffect(() => {
    if (settings.avatarType === 'stock' && avatars.length === 0) {
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
    // PR Sprint 7.13 hotfix v2: refuse to save when no option
    // is selected. The previous default-to-stock behavior meant
    // the founder could click Save without picking anything and
    // the DB would land with avatarType='stock' + avatarId=null
    // (which the gate then treats as "not ready" anyway). Now
    // we surface a clear message instead of a confusing save.
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
      if (settings.avatarType === 'stock') {
        body.avatarId = settings.avatarId;
      }
      if (settings.avatarType === 'photo') {
        body.photoUrl = settings.photoUrl;
      }
      // Voice is optional across both flows.
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
        // Mirror the same derive-from-saved-data rule as the
        // initial load so a save → reload → save round-trip is
        // idempotent.
        const savedType = data.avatarType as AvatarType | undefined;
        let derived: AvatarType | null = null;
        if (savedType === 'photo' && data.photoUrl) derived = 'photo';
        else if (savedType === 'twin') derived = 'twin';
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

  return (
    <GlassCard className="p-6">
      <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
        Video Avatar
      </div>
      <h3 className="font-display text-xl font-light mb-1">
        Avatar for HeyGen video generation
      </h3>
      <p className="text-sm text-text-2 mb-5">
        Helm uses this avatar to turn Reel and UGC scripts into talking-
        head videos. Stock avatars ship immediately; uploaded photos use
        HeyGen&apos;s Avatar IV pipeline (5 - 10 minutes per render).
      </p>

      {envDisabled && (
        <div className="mb-5 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-600">
          HeyGen isn&apos;t enabled on this deployment yet. Your selection
          will save and apply automatically once we flip the integration
          on.
        </div>
      )}

      <div className="space-y-3">
        {/* Option A — Stock */}
        <label
          className={`block p-4 rounded-lg border cursor-pointer transition-colors ${
            settings.avatarType === 'stock'
              ? 'border-accent bg-accent-soft'
              : 'border-border hover:border-border-bright'
          }`}
        >
          <div className="flex items-start gap-3">
            <input
              type="radio"
              name="avatarType"
              value="stock"
              checked={settings.avatarType === 'stock'}
              onChange={() =>
                setSettings((prev) => ({ ...prev, avatarType: 'stock' }))
              }
              className="mt-1"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-text-1 mb-1">
                Use a stock avatar
              </div>
              <div className="text-xs text-text-3 mb-3">
                Pick from HeyGen&apos;s curated catalog. Fastest path —
                videos render in ~2 minutes.
              </div>

              {settings.avatarType === 'stock' && (
                <div className="space-y-3">
                  {/* PR Sprint 7.13 hotfix v2 — picker moved to a
                      full-width modal. The inline section is now
                      compact: shows the SELECTED avatar (or a
                      single "Choose avatar →" CTA when none is
                      picked yet) plus a "Change" button that
                      opens the picker. Bigger thumbnails inside
                      the modal let the founder actually see
                      faces at a useful resolution. */}
                  {avatarsLoading && (
                    <div className="flex items-center gap-3">
                      <div className="w-24 h-24 rounded-lg bg-bg-elev animate-pulse" />
                      <div className="space-y-2 flex-1">
                        <div className="h-3 w-32 rounded bg-bg-elev animate-pulse" />
                        <div className="h-2 w-20 rounded bg-bg-elev animate-pulse" />
                      </div>
                    </div>
                  )}
                  {avatarsError && (
                    <div className="text-xs text-danger">
                      {avatarsError}
                    </div>
                  )}

                  {!avatarsLoading && !avatarsError && (
                    <>
                      {(() => {
                        const selected = settings.avatarId
                          ? avatars.find(
                              (a) => a.avatarId === settings.avatarId,
                            )
                          : null;
                        if (selected) {
                          return (
                            <div className="flex items-center gap-4">
                              <div className="relative shrink-0 w-24 h-24 rounded-lg overflow-hidden border-2 border-accent">
                                {selected.previewImageUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={selected.previewImageUrl}
                                    alt={selected.name}
                                    className="w-full h-full object-cover bg-bg-elev"
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center bg-bg-elev text-text-3">
                                    ◯
                                  </div>
                                )}
                                {selected.premium && (
                                  <span className="absolute top-1 left-1 text-[8px] font-mono uppercase tracking-[0.08em] font-bold px-1 py-0.5 rounded bg-accent text-white">
                                    Premium
                                  </span>
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-text-1 truncate">
                                  {selected.name}
                                </div>
                                {selected.gender && (
                                  <div className="text-[11px] font-mono uppercase tracking-[0.1em] text-text-3 mt-0.5">
                                    {selected.gender}
                                  </div>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setPickerOpen(true)}
                                  className="mt-2 text-xs text-accent hover:underline"
                                >
                                  Change avatar →
                                </button>
                              </div>
                            </div>
                          );
                        }
                        return (
                          <button
                            type="button"
                            onClick={() => setPickerOpen(true)}
                            className="w-full p-4 rounded-lg border border-dashed border-border-bright hover:border-accent hover:bg-accent-soft transition-colors text-sm text-text-2 hover:text-text-1"
                          >
                            🎬 Choose avatar →
                            <span className="block text-[11px] text-text-3 mt-1">
                              Browse HeyGen&apos;s stock avatar catalog
                              ({avatars.length} available)
                            </span>
                          </button>
                        );
                      })()}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </label>

        {/* Option B — Photo Avatar IV */}
        <label
          className={`block p-4 rounded-lg border cursor-pointer transition-colors ${
            settings.avatarType === 'photo'
              ? 'border-accent bg-accent-soft'
              : 'border-border hover:border-border-bright'
          }`}
        >
          <div className="flex items-start gap-3">
            <input
              type="radio"
              name="avatarType"
              value="photo"
              checked={settings.avatarType === 'photo'}
              onChange={() =>
                setSettings((prev) => ({ ...prev, avatarType: 'photo' }))
              }
              className="mt-1"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-text-1 mb-1">
                Use my photo
              </div>
              <div className="text-xs text-text-3 mb-3">
                Upload a single portrait — Helm sends it to HeyGen&apos;s
                Avatar IV model. JPG, PNG, or WebP. Max{' '}
                {AVATAR_MAX_BYTES / (1024 * 1024)} MB.
              </div>

              {settings.avatarType === 'photo' && (
                <div className="space-y-3">
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void handleUpload(f);
                    }}
                    disabled={uploading}
                    className="block text-xs text-text-2 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:bg-accent file:text-white file:hover:opacity-90 file:cursor-pointer cursor-pointer disabled:opacity-50"
                  />
                  {uploading && (
                    <div className="text-xs text-text-3">Uploading…</div>
                  )}
                  {uploadError && (
                    <div className="text-xs text-danger">{uploadError}</div>
                  )}
                  {settings.photoUrl && !uploading && (
                    <div className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={settings.photoUrl}
                        alt="Avatar preview"
                        className="w-20 h-20 object-cover rounded-lg border border-border"
                      />
                      <div className="text-xs text-text-3">
                        Preview · ready to save
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </label>

        {/* Option C — Digital Twin (locked) */}
        <label
          className={`block p-4 rounded-lg border border-border opacity-60 cursor-not-allowed`}
        >
          <div className="flex items-start gap-3">
            <input
              type="radio"
              name="avatarType"
              value="twin"
              disabled
              checked={false}
              readOnly
              className="mt-1"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-medium text-text-1">
                  Record a video (15s)
                </span>
                <span className="text-[10px] font-mono uppercase tracking-[0.15em] px-2 py-0.5 bg-text-3/15 text-text-2 rounded">
                  Coming soon
                </span>
              </div>
              <div className="text-xs text-text-3">
                Record a 15-second clip to train your own Digital Twin
                avatar. Available in a future paid plan.
              </div>
            </div>
          </div>
        </label>
      </div>

      <div className="flex items-center justify-between mt-5 pt-5 border-t border-border">
        <div className="text-xs text-text-3">
          {saveMessage && (
            <span
              className={
                saveMessage === 'Saved ✓'
                  ? 'text-emerald-500'
                  : 'text-danger'
              }
            >
              {saveMessage}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save avatar settings'}
        </button>
      </div>

      {/* PR Sprint 7.13 hotfix v2 — avatar picker modal. Renders
          a full-screen overlay with the HeyGen catalog at a much
          larger thumbnail size than the compact Settings card
          allowed. Click a card → selects + closes (in-memory;
          the founder still hits "Save avatar settings" to
          persist). Backdrop click + Esc both dismiss without
          changing the selection. */}
      {pickerOpen && (
        <AvatarPickerModal
          avatars={avatars}
          selectedId={settings.avatarId}
          genderFilter={genderFilter}
          onGenderFilterChange={setGenderFilter}
          onSelect={(id) => {
            setSettings((prev) => ({ ...prev, avatarId: id }));
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </GlassCard>
  );
}

// PR Sprint 7.13 hotfix v2 — picker modal extracted into its
// own component to keep the main HeyGenAvatarConfig render tree
// readable. Listens for Esc to close + locks body scroll while
// open. Cards are deliberately larger than the inline grid
// (aspect-[3/4] portrait, 2 cols mobile / 3 tablet / 4-5
// desktop) so the founder can compare faces at a useful
// resolution.
function AvatarPickerModal({
  avatars,
  selectedId,
  genderFilter,
  onGenderFilterChange,
  onSelect,
  onClose,
}: {
  avatars: AvatarOption[];
  selectedId: string | null;
  genderFilter: 'all' | 'male' | 'female';
  onGenderFilterChange: (v: 'all' | 'male' | 'female') => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Lock body scroll while the modal is open so the
  // background page doesn't bounce when the user scrolls
  // through 50+ avatars.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const filtered = avatars.filter((a) => {
    if (genderFilter === 'all') return true;
    const g = (a.gender ?? '').toLowerCase();
    return g.startsWith(genderFilter[0]);
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 md:p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-modal="true"
      role="dialog"
    >
      <div className="bg-bg-elev border border-border rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-5 md:px-7 py-4 border-b border-border flex items-start justify-between gap-4 shrink-0">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-1">
              HeyGen stock catalog
            </div>
            <h3 className="font-display text-xl md:text-2xl font-light">
              Choose an avatar
            </h3>
            <p className="text-xs text-text-3 mt-1">
              {filtered.length} of {avatars.length} avatars · click
              one to select
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

        {/* Filter row */}
        <div className="px-5 md:px-7 py-3 border-b border-border flex flex-wrap gap-2 shrink-0">
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

        {/* Grid */}
        <div className="flex-1 overflow-y-auto px-5 md:px-7 py-5">
          {filtered.length === 0 ? (
            <div className="text-sm text-text-3 text-center py-12">
              No avatars match this filter.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {filtered.map((a) => {
                const selected = a.avatarId === selectedId;
                const genderLabel = a.gender
                  ? a.gender.charAt(0).toUpperCase()
                  : null;
                return (
                  <button
                    key={a.avatarId}
                    type="button"
                    onClick={() => onSelect(a.avatarId)}
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

                    {/* Gender badge (top-right) */}
                    {genderLabel && (
                      <span className="absolute top-2 right-2 text-[11px] font-mono font-bold px-2 py-0.5 rounded bg-bg/90 text-text-1 backdrop-blur-sm">
                        {genderLabel}
                      </span>
                    )}

                    {/* Premium badge (top-left) */}
                    {a.premium && (
                      <span className="absolute top-2 left-2 text-[10px] font-mono uppercase tracking-[0.08em] font-bold px-2 py-0.5 rounded bg-accent text-white">
                        Premium
                      </span>
                    )}

                    {/* Name (bottom gradient) */}
                    <div className="absolute bottom-0 inset-x-0 p-3 bg-gradient-to-t from-black/85 via-black/40 to-transparent">
                      <div className="text-sm font-medium text-white truncate">
                        {a.name}
                      </div>
                    </div>

                    {/* Selected overlay */}
                    {selected && (
                      <div className="absolute inset-0 flex items-center justify-center bg-accent/20 pointer-events-none">
                        <div className="w-12 h-12 rounded-full bg-accent text-white flex items-center justify-center text-xl">
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

        {/* Footer hint */}
        <div className="px-5 md:px-7 py-3 border-t border-border text-[11px] text-text-3 shrink-0">
          Selecting an avatar updates the form. Remember to click{' '}
          <span className="text-text-1">Save avatar settings</span>{' '}
          to persist between sessions.
        </div>
      </div>
    </div>
  );
}
