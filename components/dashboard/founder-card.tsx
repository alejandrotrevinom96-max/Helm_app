'use client';

// PR #33 — Sprint 6.1.
//
// Avatar card at the bottom of the sidebar, converted into a dropdown
// trigger so the user can sign out (the #1 piece of feedback: "no
// tenemos un botón de log out"). Pre-PR-33 this was a static block.
//
// Dropdown items:
//   - Account settings → /settings (existing page)
//   - Sign out          → supabase.auth.signOut() + redirect /login
//
// Click-outside closes the dropdown. The Supabase browser client
// handles the sign-out + cookie clearing automatically; we just
// router.push + router.refresh so the middleware sees the cleared
// session and redirects.
import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronUp, Settings, LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';

interface Props {
  user: {
    name: string;
    email: string;
    avatarUrl: string | null;
  };
}

export function FounderCard({ user }: Props) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } finally {
      // Even if signOut throws, push to /login — the middleware will
      // bounce back to login if the session is still alive.
      router.push('/login');
      router.refresh();
    }
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-surface-1 transition-colors text-left"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {user.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarUrl}
            alt=""
            className="w-8 h-8 rounded-full"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-[image:var(--accent-grad)]" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{user.name}</div>
          <div className="text-xs text-text-3">Free plan</div>
        </div>
        <ChevronUp
          className={`w-4 h-4 text-text-3 transition-transform ${
            open ? '' : 'rotate-180'
          }`}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 right-0 mb-2 bg-bg-elev border border-border rounded-lg shadow-editorial-lg overflow-hidden z-50"
        >
          {/* User email header — small affordance so the user can
              confirm which account is signed in before clicking
              destructive actions. */}
          <div className="px-3 py-2 border-b border-border">
            <div className="text-[10px] font-mono uppercase tracking-[0.1em] text-text-3">
              Signed in as
            </div>
            <div className="text-xs text-text-2 truncate">{user.email}</div>
          </div>
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-surface-1 transition-colors"
            role="menuitem"
          >
            <Settings className="w-4 h-4 text-text-3" />
            Account settings
          </Link>
          <div className="border-t border-border" />
          <button
            type="button"
            onClick={handleSignOut}
            disabled={signingOut}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-danger hover:bg-danger/10 transition-colors disabled:opacity-50"
            role="menuitem"
          >
            <LogOut className="w-4 h-4" />
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}
