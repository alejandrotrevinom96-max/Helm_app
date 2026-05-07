'use client';

// PR #23 — Sprint 2.2: Library funcional.
//
// Single-screen archive of every post (drafts, scheduled, published,
// cancelled) for the active project. Tabs filter by status; the search
// box and platform select are shared filters that re-fetch on change.
//
// Why we re-fetch on tab change instead of filtering client-side: the
// counts in tab labels (e.g. "Published (12)") depend on what's actually
// in each bucket, and we don't want to hold every post in memory just to
// show one tab. We let the server return the filtered set and trust it.
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import type { LibraryPost, LibraryStatus } from '@/app/api/marketing/library/route';
import { LibraryFilters } from './filters';
import { LibraryPostCard } from './post-card';
import { PostDetailModal } from './post-detail-modal';

// PR #30 — Sprint 5.2: 'stories' is a sibling tab to the lifecycle
// statuses. It cuts across all statuses (draft / scheduled /
// published) and shows only is_story=true rows. We model it as a
// LibraryTabValue union so existing TabValue users keep working.
type LibraryTabValue = LibraryStatus | 'all' | 'stories';

const TABS: Array<{ value: LibraryTabValue; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'published', label: 'Published' },
  { value: 'stories', label: '📸 Stories' },
];

export function LibraryClient({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [posts, setPosts] = useState<LibraryPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<LibraryTabValue>('all');
  // PR #30 — `type` filter (post / story / '' for both) lets the user
  // subset within a tab. Independent of the activeTab='stories' which
  // pre-applies type=story.
  const [filters, setFilters] = useState({
    platform: '',
    search: '',
    type: '' as '' | 'post' | 'story',
  });
  const [selectedPost, setSelectedPost] = useState<LibraryPost | null>(null);

  // Counts shown in tab labels. Computed from a separate "all" query so
  // the count for "Published (12)" doesn't disappear when you switch to
  // the Drafts tab. We keep them updated only when the tab is "all" or
  // when the user mutates a post (rate / clone), since recalculating
  // every keystroke would double the request volume.
  const [counts, setCounts] = useState<Record<LibraryTabValue | 'cancelled', number>>({
    all: 0,
    draft: 0,
    scheduled: 0,
    published: 0,
    cancelled: 0,
    stories: 0,
  });

  const fetchAll = useCallback(async () => {
    // Pull every post once (no status filter) just to compute counts.
    // Cheap when the founder has < ~500 posts; we'll paginate if it
    // ever becomes a problem.
    try {
      const params = new URLSearchParams({ projectId, status: 'all' });
      const res = await fetch(`/api/marketing/library?${params}`);
      const data: { posts?: LibraryPost[] } = await res.json();
      const all = data.posts ?? [];
      setCounts({
        all: all.length,
        draft: all.filter((p) => p.status === 'draft').length,
        scheduled: all.filter((p) => p.status === 'scheduled').length,
        published: all.filter((p) => p.status === 'published').length,
        cancelled: all.filter((p) => p.status === 'cancelled').length,
        stories: all.filter((p) => p.isStory).length,
      });
    } catch {
      // counts are best-effort; UI still works without them
    }
  }, [projectId]);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // PR #30 — Stories tab is a cross-status filter; the API uses
      // status='all' + type='story'. Other tabs pass through their
      // status as-is. Manual `type` filter from the dropdown overlays
      // on top — we pass it whenever it's set, including when the
      // Stories tab already pinned type=story.
      const isStoriesTab = activeTab === 'stories';
      const apiStatus = isStoriesTab ? 'all' : activeTab;
      const params = new URLSearchParams({
        projectId,
        status: apiStatus,
      });
      if (filters.platform) params.set('platform', filters.platform);
      if (filters.search.trim()) params.set('search', filters.search.trim());
      if (isStoriesTab) {
        params.set('type', 'story');
      } else if (filters.type) {
        params.set('type', filters.type);
      }
      const res = await fetch(`/api/marketing/library?${params}`);
      const data: { posts?: LibraryPost[]; error?: string } = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to load library');
        setPosts([]);
        return;
      }
      setPosts(data.posts ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, activeTab, filters.platform, filters.search, filters.type]);

  // Re-fetch when project changes, tab changes, or filters change.
  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  // Counts only need refreshing when the project changes or after a mutation.
  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Called by the modal after PATCH succeeds — keeps the list and the
  // selected post in sync without a full refetch.
  const handlePostUpdate = (updated: LibraryPost) => {
    setPosts((prev) =>
      prev.map((p) => (p.id === updated.id ? updated : p))
    );
    setSelectedPost(updated);
    fetchAll(); // counts may shift if rating filtered the published bucket
  };

  // Called by the modal after a successful clone — close the modal and
  // bounce to the composer. The composer doesn't currently accept a
  // pre-fill via querystring (PR #24 territory), so for now we just
  // navigate; the new draft is in the Drafts tab next time the user
  // returns.
  const handleClone = () => {
    setSelectedPost(null);
    window.location.href = '/marketing/generate';
  };

  // PR #24 — Sprint 2.3: when the modal deletes or moves a post to
  // drafts, remove it from the in-memory list immediately and refresh
  // the per-tab counts. We don't refetch the whole list to avoid a
  // visible flicker — the optimistic remove is already correct.
  const handleRemove = (id: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== id));
    fetchAll();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <p className="text-sm text-text-2">
          Every post for{' '}
          <span className="text-text-1 font-medium">{projectName}</span>.
          Drafts, scheduled, published — all in one place.
        </p>
      </div>

      {/* Status tabs with counts */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.value;
          const n = counts[tab.value] ?? 0;
          return (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={`
                px-4 py-3 text-sm font-medium transition-colors capitalize
                ${
                  isActive
                    ? 'text-text-1 border-b-2 border-accent -mb-px'
                    : 'text-text-3 hover:text-text-1'
                }
              `}
            >
              {tab.label}{' '}
              <span className="text-text-3 text-xs">({n})</span>
            </button>
          );
        })}
      </div>

      <LibraryFilters filters={filters} onChange={setFilters} />

      {error && (
        <div className="p-4 border border-danger/30 bg-danger/10 rounded-lg text-sm text-danger">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-text-3 text-sm">
          Loading posts…
        </div>
      ) : posts.length === 0 ? (
        <div className="p-12 border border-dashed border-border rounded-xl text-center">
          <p className="text-text-3 text-sm mb-4">
            {activeTab === 'all'
              ? filters.search || filters.platform
                ? 'No posts match those filters.'
                : "No posts yet. Generate your first post."
              : `No ${activeTab} posts${filters.search || filters.platform ? ' match those filters' : ''}.`}
          </p>
          <Link
            href="/marketing/generate"
            className="inline-flex px-4 py-2 bg-accent text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
          >
            → Generate
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {posts.map((post) => (
            <LibraryPostCard
              key={`${post.source}-${post.id}`}
              post={post}
              onClick={() => setSelectedPost(post)}
            />
          ))}
        </div>
      )}

      {selectedPost && (
        <PostDetailModal
          post={selectedPost}
          onClose={() => setSelectedPost(null)}
          onUpdate={handlePostUpdate}
          onClone={handleClone}
          onRemove={handleRemove}
        />
      )}
    </div>
  );
}
