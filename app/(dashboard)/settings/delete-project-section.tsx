'use client';

// PR Sprint 7.19 — Danger Zone section on /settings.
//
// Renders at the bottom of the Settings page. Single button
// "Delete project" opens <DeleteProjectModal> which gates the
// destructive action behind a type-to-confirm prompt.
//
// PR Sprint 7.25 Phase 2 — repainted on top of the platform redesign
// (red-glow danger card, danger eyebrow, btn-danger CTA). The modal
// itself keeps its existing styling — restyling it sits outside
// the per-card Settings redesign scope.

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
        className="platform-card platform-card-danger platform-card-glow-red platform-reveal-5"
        aria-label="Danger zone"
      >
        <div className="platform-lbl platform-lbl-danger">Danger zone</div>
        <h2 className="platform-h2" style={{ marginBottom: '12px' }}>
          Delete project
        </h2>
        <div className="platform-danger-row">
          <p className="platform-desc">
            Permanently delete <b>{projectName}</b> and all its content,
            drafts, scheduled posts, and data.{' '}
            <b style={{ color: 'var(--d-red-2)' }}>
              This action cannot be undone.
            </b>
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="platform-btn platform-btn-danger"
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
