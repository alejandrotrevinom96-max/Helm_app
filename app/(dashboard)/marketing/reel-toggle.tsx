'use client';

// PR #32 — Sprint 5.3: Instagram Reels.
//
// Renders next to the platforms picker in Generate, parallel to
// StoryToggle. Only Instagram supports Reels; the no-op guard
// returns null for other platforms.
//
// Two interactions:
//   1. Checkbox: marks `isReel` on the parent (top-level state).
//   2. File input: validates client-side, uploads directly to
//      Supabase Storage, and reports back the public URL +
//      metadata to the parent.
//
// Mutually exclusive with Stories: the parent reset isStory when
// isReel flips on (and vice versa).
import { useState } from 'react';
import { Film, AlertCircle, Upload, X, Loader2 } from 'lucide-react';
import {
  getVideoMetadata,
  validateReelVideo,
  type VideoMetadata,
} from '@/lib/meta/video-validator';
import { uploadReelVideo, isFailure } from '@/lib/storage/reels-upload';

interface Props {
  platform: string;
  userId: string;
  isReel: boolean;
  videoUrl: string | null;
  videoMetadata: VideoMetadata | null;
  onChangeReel: (next: boolean) => void;
  onChangeVideo: (
    url: string | null,
    metadata: VideoMetadata | null
  ) => void;
}

export function ReelToggle({
  platform,
  userId,
  isReel,
  videoUrl,
  videoMetadata,
  onChangeReel,
  onChangeVideo,
}: Props) {
  if (platform !== 'instagram') return null;

  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  const handleFileSelect = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;

    setErrors([]);
    setWarnings([]);

    const meta = await getVideoMetadata(file);
    if (!meta) {
      setErrors([
        "Couldn't read this video. Make sure it's a valid MP4 or MOV file.",
      ]);
      return;
    }

    const v = validateReelVideo(meta);
    if (!v.valid) {
      setErrors(v.errors);
      setWarnings(v.warnings);
      return;
    }
    setWarnings(v.warnings);

    if (!userId) {
      setErrors(['No user session. Sign out and back in.']);
      return;
    }

    setUploading(true);
    try {
      const result = await uploadReelVideo(file, userId);
      if (isFailure(result)) {
        setErrors([result.error]);
        return;
      }
      onChangeVideo(result.url, meta);
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = () => {
    onChangeVideo(null, null);
    setErrors([]);
    setWarnings([]);
  };

  return (
    <div className="space-y-2 mt-3">
      <label className="flex items-start gap-3 cursor-pointer p-3 border border-border rounded-lg hover:border-accent transition-colors">
        <input
          type="checkbox"
          checked={isReel}
          onChange={(e) => onChangeReel(e.target.checked)}
          className="w-4 h-4 mt-0.5 accent-accent"
        />
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <Film className="w-4 h-4 text-purple-500 mt-0.5 shrink-0" />
          <div>
            <div className="text-sm font-medium">
              Post as Instagram Reel
            </div>
            <div className="text-xs text-text-3">
              9:16 video · 3-90s · max 100 MB · Goes only to Instagram
            </div>
          </div>
        </div>
      </label>

      {isReel && (
        <div className="space-y-2 pl-7">
          {!videoUrl ? (
            <label className="flex flex-col items-center justify-center gap-2 p-6 border border-dashed border-border rounded-lg cursor-pointer hover:border-accent transition-colors">
              <Upload className="w-6 h-6 text-text-3" />
              <div className="text-sm text-text-2">
                {uploading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Uploading to Supabase…
                  </span>
                ) : (
                  <>Click to upload video</>
                )}
              </div>
              <div className="text-xs text-text-3">
                MP4 or MOV · 9:16 · 3-90s · max 100 MB
              </div>
              <input
                type="file"
                accept="video/mp4,video/quicktime"
                onChange={handleFileSelect}
                disabled={uploading}
                className="hidden"
              />
            </label>
          ) : (
            <div className="p-3 bg-bg-elev border border-border rounded-lg">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Film className="w-4 h-4 text-purple-500 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      Video uploaded
                    </div>
                    {videoMetadata && (
                      <div className="text-xs text-text-3 truncate">
                        {videoMetadata.width}×{videoMetadata.height} ·{' '}
                        {videoMetadata.duration.toFixed(1)}s ·{' '}
                        {(videoMetadata.sizeBytes / (1024 * 1024)).toFixed(
                          1
                        )}{' '}
                        MB
                      </div>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRemove}
                  className="text-text-3 hover:text-danger shrink-0"
                  title="Remove video"
                  aria-label="Remove video"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                src={videoUrl}
                controls
                playsInline
                className="mt-3 w-full max-w-xs rounded bg-bg"
                style={{ aspectRatio: '9/16' }}
              />
            </div>
          )}

          {errors.map((err, i) => (
            <div
              key={`err-${i}`}
              className="flex items-start gap-2 p-3 bg-danger/10 border border-danger/30 rounded-lg"
            >
              <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              <div className="text-xs text-danger">{err}</div>
            </div>
          ))}
          {warnings.map((w, i) => (
            <div
              key={`warn-${i}`}
              className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg"
            >
              <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-500">{w}</div>
            </div>
          ))}

          {isReel && !videoUrl && errors.length === 0 && (
            <div className="flex items-start gap-2 p-3 bg-danger/10 border border-danger/30 rounded-lg">
              <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
              <div className="text-xs text-danger">
                Reels require a video. Upload one before scheduling.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
