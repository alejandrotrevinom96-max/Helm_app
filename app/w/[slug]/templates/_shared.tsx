// Shared bits for the 5 validate templates: a common SuccessState component
// (visually consistent acknowledgement after submit) and a typed shape for
// the page prop the templates receive from the server component.
import type { TemplateConfig } from '@/lib/validate/defaults';

export interface PublicPageData {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  ctaText: string | null;
  template: string | null;
  templateConfig: TemplateConfig | null;
}

export function SuccessState({
  heading,
  message,
}: {
  heading: string;
  message: string;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="w-16 h-16 rounded-full bg-accent-soft border border-accent/20 mx-auto mb-6 flex items-center justify-center">
          <svg
            className="w-7 h-7 text-accent"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="font-display text-3xl font-light mb-3">{heading}</h1>
        <p className="text-text-2">{message}</p>
      </div>
    </div>
  );
}
