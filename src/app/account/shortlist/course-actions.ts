'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { sessionDb } from '@/lib/auth/session';
import type { SaveResult } from './actions';

const UUID = /^[0-9a-f-]{36}$/i;
export type CourseStage = 'interested' | 'open_day' | 'applying' | 'applied' | 'offer' | 'firm' | 'insurance' | 'not_for_me';
const STAGES: CourseStage[] = ['interested', 'open_day', 'applying', 'applied', 'offer', 'firm', 'insurance', 'not_for_me'];

/** "Save course" on the Universities pages. Same results as saveCompany. */
export async function saveCourse(courseId: string): Promise<SaveResult> {
  if (!UUID.test(courseId)) return 'error';
  const db = await sessionDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return 'signin';
  const { error } = await db.from('course_shortlist').insert({ course_id: courseId });
  if (!error) {
    revalidatePath('/account/shortlist');
    return 'saved';
  }
  if (error.code === '23505') return 'already';
  if (error.code === '42501') return 'confirm';
  if (error.code === '54000') return 'full';
  return 'error';
}

export async function updateCourse(f: FormData) {
  const id = String(f.get('course_id') ?? '');
  const stage = String(f.get('stage') ?? '') as CourseStage;
  if (!UUID.test(id) || !STAGES.includes(stage)) redirect('/account/shortlist?error=1#courses');
  const db = await sessionDb();
  const { error } = await db
    .from('course_shortlist')
    .update({ stage, notes: String(f.get('notes') ?? '').trim().slice(0, 1000) || null })
    .eq('course_id', id);
  if (error) redirect('/account/shortlist?error=1#courses');
  revalidatePath('/account/shortlist');
  redirect(`/account/shortlist?saved=1#c-${id}`);
}

export async function removeCourse(f: FormData) {
  const id = String(f.get('course_id') ?? '');
  if (!UUID.test(id)) redirect('/account/shortlist?error=1#courses');
  const db = await sessionDb();
  await db.from('course_shortlist').delete().eq('course_id', id);
  revalidatePath('/account/shortlist');
  redirect('/account/shortlist?removed=1#courses');
}
