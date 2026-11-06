'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { sessionDb } from '@/lib/auth/session';

const UUID = /^[0-9a-f-]{36}$/i;
export type ItemType = 'company' | 'course' | 'vacancy';
const TYPES: ItemType[] = ['company', 'course', 'vacancy'];
export type ReactResult = 'ok' | 'signin' | 'confirm' | 'full' | 'error';

/** Like or dislike from card mode. Saved in the student's account (0029). */
export async function react(itemType: ItemType, itemId: string, reaction: 'like' | 'dislike'): Promise<ReactResult> {
  if (!TYPES.includes(itemType) || !UUID.test(itemId) || (reaction !== 'like' && reaction !== 'dislike')) return 'error';
  const db = await sessionDb();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return 'signin';
  const { error } = await db
    .from('reactions')
    .upsert({ user_id: auth.user.id, item_type: itemType, item_id: itemId, reaction }, { onConflict: 'user_id,item_type,item_id' });
  if (!error) {
    if (reaction === 'like') revalidatePath('/account/liked');
    return 'ok';
  }
  if (error.code === '42501') return 'confirm';
  if (error.code === '54000') return 'full';
  return 'error';
}

/** Undo the last swipe. */
export async function unreact(itemType: ItemType, itemId: string): Promise<void> {
  if (!TYPES.includes(itemType) || !UUID.test(itemId)) return;
  const db = await sessionDb();
  await db.from('reactions').delete().eq('item_type', itemType).eq('item_id', itemId);
  revalidatePath('/account/liked');
}

/** "Show disliked again" in card mode. */
export async function clearDislikes(itemType: ItemType): Promise<void> {
  if (!TYPES.includes(itemType)) return;
  const db = await sessionDb();
  await db.from('reactions').delete().eq('item_type', itemType).eq('reaction', 'dislike');
}

/** Remove from the Liked area. */
export async function removeLike(f: FormData) {
  const itemType = String(f.get('item_type') ?? '') as ItemType;
  const itemId = String(f.get('item_id') ?? '');
  if (TYPES.includes(itemType) && UUID.test(itemId)) {
    const db = await sessionDb();
    await db.from('reactions').delete().eq('item_type', itemType).eq('item_id', itemId);
  }
  revalidatePath('/account/liked');
  redirect('/account/liked');
}
