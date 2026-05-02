// Vercel REST API client
// Docs: https://vercel.com/docs/rest-api

const BASE = 'https://api.vercel.com';

interface VercelProject {
  id: string;
  name: string;
  accountId: string;
  link?: {
    type: string;
    repo?: string;
    repoId?: number;
  };
  targets?: {
    production?: {
      domain?: string;
    };
  };
}

export async function listVercelProjects(token: string, teamId?: string) {
  const url = new URL(`${BASE}/v9/projects`);
  if (teamId) url.searchParams.set('teamId', teamId);

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Vercel API error: ${res.status}`);
  const data = await res.json();
  return data.projects as VercelProject[];
}

/**
 * Find Vercel project that matches a GitHub repo
 */
export async function matchVercelProject(
  token: string,
  githubRepoFullName: string,
  teamId?: string
) {
  const projects = await listVercelProjects(token, teamId);
  return projects.find(
    (p) => p.link?.type === 'github' && p.link.repo === githubRepoFullName
  );
}

/**
 * Fetch web analytics for a project.
 * NOTE: Web Analytics requires Vercel Pro plan on the user's side.
 * Falls back to gracefully if unavailable.
 */
export async function getVercelAnalytics(
  token: string,
  projectId: string,
  teamId: string | undefined,
  days: number = 30
) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const until = new Date();

  const url = new URL(`${BASE}/v1/web/insights/${projectId}`);
  if (teamId) url.searchParams.set('teamId', teamId);
  url.searchParams.set('since', since.toISOString());
  url.searchParams.set('until', until.toISOString());

  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      // Web Analytics not enabled for this project — return null gracefully
      return null;
    }
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch deployment list for activity feed
 */
export async function getVercelDeployments(
  token: string,
  projectId: string,
  teamId?: string,
  limit: number = 10
) {
  const url = new URL(`${BASE}/v6/deployments`);
  if (teamId) url.searchParams.set('teamId', teamId);
  url.searchParams.set('projectId', projectId);
  url.searchParams.set('limit', limit.toString());

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.deployments || [];
}
