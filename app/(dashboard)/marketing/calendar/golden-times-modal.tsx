'use client';

// PR #24 — Sprint 2.3.
//
// Shown when the user drops a post on a day in the calendar. Offers
// 4 "golden time" presets validated by public engagement research:
//   - 9 AM:  morning commute & coffee scrolling peak
//   - 12 PM: lunch break peak
//   - 5 PM:  end-of-workday peak
//   - 8 PM:  evening leisure peak
//
// Plus an "Or pick a custom time" escape hatch using the native
// time input, which respects the user's locale and timezone.
import { useState } from 'react';

interface Props {
  date: Date;
  onConfirm: (time: string) => void;
  onCancel: () => void;
}

const GOLDEN_TIMES = [
  {
    time: '09:00',
    label: '9:00 AM',
    description: 'Morning peak — commute & coffee',
    emoji: '☕',
  },
  {
    time: '12:00',
    label: '12:00 PM',
    description: 'Lunch break peak',
    emoji: '🍱',
  },
  {
    time: '17:00',
    label: '5:00 PM',
    description: 'End-of-workday peak',
    emoji: '🚪',
  },
  {
    time: '20:00',
    label: '8:00 PM',
    description: 'Evening leisure peak',
    emoji: '🌙',
  },
] as const;

export function GoldenTimesModal({ date, onConfirm, onCancel }: Props) {
  const [showCustom, setShowCustom] = useState(false);
  const [customTime, setCustomTime] = useState('15:00');
  const dateStr = date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-bg-elev border border-border rounded-xl p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="mb-5">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-accent mb-1">
            Reschedule
          </div>
          <h3 className="font-display text-2xl font-light mb-1">
            Pick a golden time
          </h3>
          <p className="text-sm text-text-2">
            Schedule for{' '}
            <span className="text-text-1 font-medium">{dateStr}</span>.
            These are peak engagement windows.
          </p>
        </div>

        <div className="space-y-2 mb-5">
          {GOLDEN_TIMES.map((slot) => (
            <button
              key={slot.time}
              type="button"
              onClick={() => onConfirm(slot.time)}
              className="w-full p-4 border border-border rounded-lg hover:bg-bg hover:border-accent transition-colors text-left flex items-center gap-4"
            >
              <span className="text-2xl">{slot.emoji}</span>
              <div className="flex-1">
                <div className="font-mono text-base">{slot.label}</div>
                <div className="text-xs text-text-3">{slot.description}</div>
              </div>
              <span className="text-text-3">→</span>
            </button>
          ))}
        </div>

        {showCustom ? (
          <div className="p-4 border border-border rounded-lg space-y-3">
            <label className="text-xs font-mono uppercase tracking-[0.1em] text-text-3 block">
              Custom time (24h)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={customTime}
                onChange={(e) => setCustomTime(e.target.value)}
                className="flex-1 p-2 bg-bg border border-border rounded-lg text-sm outline-none focus:border-accent [color-scheme:dark]"
              />
              <button
                type="button"
                onClick={() => onConfirm(customTime)}
                className="px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:opacity-90"
              >
                Schedule
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowCustom(true)}
            className="w-full text-xs text-text-3 hover:text-accent underline py-2"
          >
            Or pick a custom time
          </button>
        )}

        <div className="flex justify-end pt-4 mt-2 border-t border-border">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-text-3 hover:text-text-1"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
