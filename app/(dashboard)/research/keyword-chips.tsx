'use client';

import { useState } from 'react';

interface Props {
  label: string;
  values: string[];
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
  placeholder?: string;
  accent?: 'default' | 'danger';
}

export function KeywordChips({
  label,
  values,
  onAdd,
  onRemove,
  placeholder,
  accent = 'default',
}: Props) {
  const [input, setInput] = useState('');

  const handleAdd = () => {
    const v = input.trim();
    if (v && !values.includes(v)) {
      onAdd(v);
      setInput('');
    }
  };

  const chipColor =
    accent === 'danger'
      ? 'bg-danger/10 text-danger border-danger/20'
      : 'bg-accent-soft text-accent border-accent/20';

  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 mb-2">
        {label}
      </div>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {values.map((v) => (
            <span
              key={v}
              className={`group text-xs px-2 py-1 rounded-full border ${chipColor} flex items-center gap-1`}
            >
              {v}
              <button
                onClick={() => onRemove(v)}
                className="opacity-50 group-hover:opacity-100 ml-1 leading-none"
                aria-label={`Remove ${v}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            }
          }}
          placeholder={placeholder}
          className="flex-1 bg-bg-elev border border-border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <button
          onClick={handleAdd}
          className="text-xs px-3 py-1.5 border border-border rounded-lg hover:border-accent hover:text-accent transition-colors"
        >
          Add
        </button>
      </div>
    </div>
  );
}
