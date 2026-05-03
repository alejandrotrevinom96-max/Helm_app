'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

export async function setTheme(theme: 'light' | 'dark') {
  const cookieStore = await cookies();
  cookieStore.set('helm-theme', theme, {
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
    path: '/',
  });
  revalidatePath('/', 'layout');
}
