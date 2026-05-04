'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useTransition, useEffect } from 'react';
import type { Project } from '@/lib/db/schema';
import { setActiveProject } from '@/app/(dashboard)/actions';
import { ThemeToggle } from '@/components/ui/theme-toggle';

const navItems = [
  { href: '/analytics', label: 'Analytics', icon: AnalyticsIcon },
  { href: '/marketing', label: 'Marketing', icon: MarketingIcon },
  { href: '/research', label: 'Research', icon: ResearchIcon },
  { href: '/validate', label: 'Validate', icon: ValidateIcon },
  { href: '/integrations', label: 'Integrations', icon: IntegrationsIcon },
  { href: '/settings', label: 'Settings', icon: SettingsIcon },
];

export function Sidebar({
  activeProject,
  allProjects,
  user,
}: {
  activeProject: Project | null;
  allProjects: Project[];
  user: { name: string; email: string; avatarUrl: string | null };
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const switchProject = (id: string) => {
    if (id === activeProject?.id) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      await setActiveProject(id);
      setOpen(false);
    });
  };

  return (
    <>
      <header className="md:hidden sticky top-0 z-30 bg-bg/80 backdrop-blur-glass border-b border-border px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="text-text-1"
        >
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <Link href="/analytics" className="flex items-center gap-2">
          <svg viewBox="0 0 32 32" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <circle cx="16" cy="16" r="14" />
            <circle cx="16" cy="16" r="3" fill="var(--accent)" stroke="none" />
            <line x1="16" y1="2" x2="16" y2="8" />
            <line x1="16" y1="24" x2="16" y2="30" />
            <line x1="2" y1="16" x2="8" y2="16" />
            <line x1="24" y1="16" x2="30" y2="16" />
          </svg>
          <span className="font-display text-lg font-medium">Helm</span>
        </Link>
        <div className="w-6" aria-hidden />
      </header>

      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/60 z-40"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={`bg-bg border-r border-border flex flex-col fixed md:sticky top-0 left-0 h-screen w-[280px] md:w-auto z-50 transition-transform duration-200 ease-out ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } md:translate-x-0`}
      >
        <button
          className="md:hidden absolute top-3 right-3 text-text-3 hover:text-text-1 z-10"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>

        <div className="p-4 border-b border-border">
          <Link href="/analytics" className="flex items-center gap-2">
            <svg viewBox="0 0 32 32" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5}>
              <circle cx="16" cy="16" r="14" />
              <circle cx="16" cy="16" r="3" fill="var(--accent)" stroke="none" />
              <line x1="16" y1="2" x2="16" y2="8" />
              <line x1="16" y1="24" x2="16" y2="30" />
              <line x1="2" y1="16" x2="8" y2="16" />
              <line x1="24" y1="16" x2="30" y2="16" />
            </svg>
            <span className="font-display text-xl font-medium">Helm</span>
          </Link>
        </div>

        {activeProject && (
          <div className="relative m-4">
            <button
              onClick={() => setOpen(!open)}
              disabled={isPending}
              className="w-full p-3 glass rounded-xl flex items-center gap-3 hover:border-border-bright transition-colors disabled:opacity-50"
            >
              <div className="w-8 h-8 rounded-lg bg-[image:var(--accent-grad)] flex items-center justify-center font-display font-semibold text-white">
                {activeProject.name[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0 text-left">
                <div className="text-sm font-medium truncate">{activeProject.name}</div>
                <div className="text-xs font-mono text-text-3 truncate">
                  {activeProject.domain || activeProject.githubRepoFullName}
                </div>
              </div>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className={`text-text-3 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {open && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
                <div className="absolute top-full left-0 right-0 mt-1 glass-elevated rounded-xl shadow-editorial-lg z-20 overflow-hidden">
                  {allProjects.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => switchProject(p.id)}
                      disabled={isPending}
                      className={`w-full p-3 flex items-center gap-3 text-left transition-colors disabled:opacity-50 ${
                        p.id === activeProject.id ? 'bg-accent-soft' : 'hover:bg-surface-1'
                      }`}
                    >
                      <div className="w-7 h-7 rounded-md bg-[image:var(--accent-grad)] flex items-center justify-center font-display font-semibold text-white text-sm">
                        {p.name[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{p.name}</div>
                        <div className="text-[11px] font-mono text-text-3 truncate">
                          {p.githubRepoFullName}
                        </div>
                      </div>
                      {p.id === activeProject.id && <span className="text-accent text-xs">✓</span>}
                    </button>
                  ))}
                  <Link
                    href="/onboarding"
                    className="block w-full p-3 border-t border-border text-sm text-accent hover:bg-surface-1 text-center transition-colors"
                    onClick={() => setOpen(false)}
                  >
                    + Add project
                  </Link>
                </div>
              </>
            )}
          </div>
        )}

        <nav className="flex-1 px-3 py-2">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 px-3 mb-2">
            Workspace
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active
                    ? 'bg-accent-soft text-accent'
                    : 'text-text-2 hover:bg-surface-1 hover:text-text-1'
                }`}
              >
                <Icon />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 py-2 border-t border-border">
          <div className="text-[10px] font-mono uppercase tracking-[0.15em] text-text-3 px-3 mb-3">
            System
          </div>
          <div className="px-3 mb-3 flex items-center justify-between">
            <span className="text-xs text-text-2">Theme</span>
            <ThemeToggle />
          </div>
        </div>

        <div className="p-3 border-t border-border">
          <div className="flex items-center gap-3 p-2">
            {user.avatarUrl ? (
              <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-full" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-[image:var(--accent-grad)]" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{user.name}</div>
              <div className="text-xs text-text-3">Free plan</div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

function AnalyticsIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}
function MarketingIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
    </svg>
  );
}
function ResearchIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}
function ValidateIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
    </svg>
  );
}
function IntegrationsIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path d="M14 5l7 7m0 0l-7 7m7-7H3" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.05a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.05a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.05a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
