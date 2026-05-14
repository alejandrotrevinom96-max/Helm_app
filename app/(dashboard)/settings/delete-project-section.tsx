'use client';

// PR Sprint 7.19 — Danger Zone section on /settings.
//
// Renders at the bottom of the Settings page. Single button
// "Delete project" opens <DeleteProjectModal> which gates the
// destructive action behind a type-to-confirm prompt.
//
// Why client (not server): the modal has its own state machine
// (closed → open → typing → submitting → success → redirect).
// Keeping the wrapper as a client component means the section
// + modal share open/close state directly without prop-drilling
// or context.

import { useState } from 'react';
import { DeleteProjectModal } from './delete-project-modal';

interface Props {
  projectId: string;
  projectName: string;
}

export function DeleteProjectSection({ projectId, projectName }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <section
        className="rounded-2xl p-5 md:p-6 border border-danger/30"
        style={{ background: 'rgba(232, 89, 63, 0.04)' }}
        aria-label="Danger zone"
      >
        <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-danger mb-3">
          Danger zone
        </div>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-light mb-1">
              Delete project
            </h3>
            <p className="text-sm text-text-2 leading-relaxed">
              Permanently delete{' '}
              <strong className="text-text-1">{projectName}</strong>{' '}
              and all its content, drafts, scheduled posts, and data.
              This action cannot be undone.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 inline-flex items-center justify-center px-4 py-2 bg-danger text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Delete project
          </button>
        </div>
      </section>

      {open && (
        <DeleteProjectModal
          projectId={projectId}
          projectName={projectName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
