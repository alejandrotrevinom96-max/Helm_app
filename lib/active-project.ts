import { cookies } from 'next/headers';
import { db } from './db';
import { projects } from './db/schema';
import { eq, and, asc } from 'drizzle-orm';

const COOKIE_NAME = 'active_project_id';

export async function getActiveProject(userId: string) {
  const cookieStore = await cookies();
  const activeId = cookieStore.get(COOKIE_NAME)?.value;

  if (activeId) {
    const [proj] = await db
      .select()
      .from(projects)
      .where(and(eq(projects.id, activeId), eq(projects.userId, userId)))
      .limit(1);
    if (proj) return proj;
  }

  // Fallback: oldest project owned by the user
  const [first] = await db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(asc(projects.createdAt))
    .limit(1);
  return first ?? null;
}

export async function getAllUserProjects(userId: string) {
  return db
    .select()
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(asc(projects.createdAt));
}
