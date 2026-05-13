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

interface AvatarSettings {
  avatarType: AvatarType;
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
    avatarType: 'stock',
    avatarId: null,
    photoUrl: null,
    voiceId: null,
  });
  const [loading, setLoading] = useState(true);
  const [avatars, setAvatars] = useState<AvatarOption[]>([]);
  const [avatarsLoading, setAvatarsLoading] = useState(false);
  const [avatarsError, setAvatarsError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  // Feature-flag echo — if HeyGen is disabled at deployment level
  // we still render the card but show a banner explaining the
  // settings persist for when the integration flips on.
  const [envDisabled, setEnvDisabled] = useState(false);

  // Initial load — fetch the saved selection for this project.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/heygen-avatar`);
        if (!res.ok) {
          if (!cancelled) setLoading(false);
          return;
        }
        const data = (await res.json()) as AvatarSettings;
        if (!cancelled) {
          setSettings(data);
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
    setSaving(true);
    setSaveMessage(null);
    try {
      const body: Partial<AvatarSettings> = {
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
        setSettings({
          avatarType: (data.avatarType ?? 'stock') as AvatarType,
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
                <>
                  {avatarsLoading && (
                    <div className="text-xs text-text-3">
                      Loading avatars…
                    </div>
                  )}
                  {avatarsError && (
                    <div className="text-xs text-danger">
                      {avatarsError}
                    </div>
                  )}
                  {!avatarsLoading &&
                    !avatarsError &&
                    avatars.length > 0 && (
                      <select
                        value={settings.avatarId ?? ''}
                        onChange={(e) =>
                          setSettings((prev) => ({
                            ...prev,
                            avatarId: e.target.value || null,
                          }))
                        }
                        className="w-full px-3 py-2 bg-bg border border-border rounded-lg text-sm outline-none focus:border-accent"
                      >
                        <option value="">— Pick an avatar —</option>
                        {avatars.map((a) => (
                          <option key={a.avatarId} value={a.avatarId}>
                            {a.name}
                            {a.gender ? ` · ${a.gender}` : ''}
                            {a.premium ? ' · premium' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                </>
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
    </GlassCard>
  );
}
