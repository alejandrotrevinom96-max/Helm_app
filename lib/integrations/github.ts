import { Octokit } from '@octokit/rest';

export function createGithubClient(accessToken: string) {
  return new Octokit({ auth: accessToken });
}

export interface DetectedStack {
  isSaaS: boolean;
  framework: 'next' | 'astro' | 'remix' | 'sveltekit' | 'nuxt' | 'unknown';
  hasSupabase: boolean;
  hasStripe: boolean;
  hasVercelConfig: boolean;
  hasMetaSdk: boolean;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Scans user's recent repos and returns the ones that look like SaaS projects.
 */
export async function scanUserRepos(token: string) {
  const gh = createGithubClient(token);

  const { data: repos } = await gh.repos.listForAuthenticatedUser({
    sort: 'pushed',
    per_page: 30,
    affiliation: 'owner,collaborator',
  });

  const candidates = [];

  for (const repo of repos) {
    if (repo.archived || repo.fork) continue;
    if (!repo.pushed_at) continue;
    const daysSince =
      (Date.now() - new Date(repo.pushed_at).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > 180) continue;

    try {
      const stack = await detectStack(gh, repo.owner.login, repo.name);
      if (stack.isSaaS) {
        candidates.push({
          repo: {
            id: repo.id,
            name: repo.name,
            fullName: repo.full_name,
            description: repo.description,
            htmlUrl: repo.html_url,
            pushedAt: repo.pushed_at,
            language: repo.language,
            isPrivate: repo.private,
          },
          stack,
        });
      }
    } catch (err) {
      // Skip repos we can't read
      continue;
    }
  }

  return candidates;
}

async function detectStack(
  gh: Octokit,
  owner: string,
  repo: string
): Promise<DetectedStack> {
  const pkgJson = await getFileJson<PackageJson>(gh, owner, repo, 'package.json');
  if (!pkgJson) {
    return {
      isSaaS: false,
      framework: 'unknown',
      hasSupabase: false,
      hasStripe: false,
      hasVercelConfig: false,
      hasMetaSdk: false,
    };
  }

  const deps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
  const has = (name: string) => Object.keys(deps).some((d) => d.includes(name));

  let framework: DetectedStack['framework'] = 'unknown';
  if (has('next')) framework = 'next';
  else if (has('astro')) framework = 'astro';
  else if (has('@remix-run')) framework = 'remix';
  else if (has('@sveltejs/kit')) framework = 'sveltekit';
  else if (has('nuxt')) framework = 'nuxt';

  const hasSupabase = has('@supabase/supabase-js') || has('@supabase/ssr');
  const hasStripe = has('stripe') || has('@stripe/stripe-js');
  const hasMetaSdk = has('facebook-nodejs-business-sdk');
  const hasVercelConfig = await fileExists(gh, owner, repo, 'vercel.json');

  // Heuristic: any web framework with at least one of these → likely SaaS
  const isSaaS =
    framework !== 'unknown' &&
    (hasSupabase || hasStripe || hasVercelConfig || hasMetaSdk);

  return { isSaaS, framework, hasSupabase, hasStripe, hasVercelConfig, hasMetaSdk };
}

async function getFileJson<T>(
  gh: Octokit,
  owner: string,
  repo: string,
  path: string
): Promise<T | null> {
  try {
    const { data } = await gh.repos.getContent({ owner, repo, path });
    if ('content' in data) {
      const content = Buffer.from(data.content, 'base64').toString('utf-8');
      return JSON.parse(content) as T;
    }
    return null;
  } catch {
    return null;
  }
}

async function fileExists(
  gh: Octokit,
  owner: string,
  repo: string,
  path: string
): Promise<boolean> {
  try {
    await gh.repos.getContent({ owner, repo, path });
    return true;
  } catch {
    return false;
  }
}
