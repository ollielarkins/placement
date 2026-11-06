// moderate-post (Supabase edge function, Deno)
//
// POST { kind: 'review' | 'submission', id } with the student's Authorization
// header (supabase.functions.invoke from the app does this), straight after
// the student posts; admins can call it again from the moderation queue.
//
// Screens the post with Claude against a strict rubric (lib.ts) and saves the
// verdict:
// * Review: published only if every check is clean and the model is sure;
//   otherwise held for an admin. A safeguarding flag holds it and raises an
//   admin alert with escalation guidance. The database guard
//   (guard_review_status, 0002) refuses any other publish.
// * Submission: the verdict is saved for the admin; obvious spam or abuse is
//   rejected, everything else waits for an admin (or was already matched to a
//   company we hold).
// Without ANTHROPIC_API_KEY, or if the model fails, the post is held for an
// admin: nothing is ever published unscreened.
//
// Secrets: ANTHROPIC_API_KEY, ANTHROPIC_MODEL (optional). SUPABASE_URL,
// SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import {
  SAFEGUARDING_GUIDANCE,
  SYSTEM_PROMPT,
  VERDICT_TOOL,
  buildPrompt,
  localChecks,
  normalise,
  reviewStatus,
  unscreened,
  type Kind,
  type Verdict,
} from './lib.ts';

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-haiku-5-5';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function ask(prompt: string): Promise<Verdict | null> {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return null;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      tools: [VERDICT_TOOL],
      tool_choice: { type: 'tool', name: VERDICT_TOOL.name },
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const out = await res.json().catch(() => null);
  const call = (out?.content ?? []).find((b: { type: string }) => b.type === 'tool_use');
  return call ? (call.input as Verdict) : null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const { data: who } = await asUser.auth.getUser();
  const user = who.user;
  if (!user) return json(401, { error: 'signin' });
  const isAdmin = user.app_metadata?.role === 'admin';

  let input: { kind?: string; id?: string };
  try {
    input = await req.json();
  } catch {
    return json(400, { error: 'input' });
  }
  const kind = input.kind as Kind;
  if ((kind !== 'review' && kind !== 'submission') || !input.id || !/^[0-9a-f-]{36}$/i.test(input.id)) {
    return json(400, { error: 'input' });
  }

  if (kind === 'review') {
    const { data: r } = await admin
      .from('reviews')
      .select('id, user_id, status, body, tips, companies(name)')
      .eq('id', input.id)
      .single();
    if (!r || (r.user_id !== user.id && !isAdmin)) return json(404, { error: 'not_found' });
    // Students can only have their own new review screened; admins can re-screen held ones.
    if (r.status !== 'pending' && !(isAdmin && r.status === 'held')) return json(409, { error: 'already_screened', status: r.status });

    const text = `${r.body}\n${r.tips ?? ''}`;
    const local = localChecks(text);
    const company = (r.companies as unknown as { name: string } | null)?.name ?? null;
    const raw = await ask(buildPrompt('review', company, { review: r.body, tips: r.tips }));
    const v = raw ? normalise(raw, local) : unscreened('Not screened automatically: the model was unavailable. Please read it.');
    const status = reviewStatus(v);
    const moderation = { ...v, model: raw ? MODEL : null, screened_at: new Date().toISOString() };
    const { error } = await admin.from('reviews').update({ moderation, status }).eq('id', r.id);
    if (error) return json(500, { error: 'save' });
    if (v.checks.safeguarding) {
      await admin.from('admin_alerts').insert({ kind: 'safeguarding', target_type: 'review', target_id: r.id, message: SAFEGUARDING_GUIDANCE });
    } else if (!raw) {
      await admin.from('admin_alerts').insert({
        kind: 'moderation_failed', target_type: 'review', target_id: r.id,
        message: 'This review could not be screened automatically and is waiting for you.',
      });
    }
    return json(200, { status });
  }

  const { data: s } = await admin
    .from('company_submissions')
    .select('id, user_id, status, payload, moderation')
    .eq('id', input.id)
    .single();
  if (!s || (s.user_id !== user.id && !isAdmin)) return json(404, { error: 'not_found' });
  if (s.moderation && !isAdmin) return json(409, { error: 'already_screened', status: s.status });

  const p = s.payload as Record<string, string | undefined>;
  const local = localChecks(`${p.why ?? ''} ${p.location ?? ''}`);
  const raw = await ask(buildPrompt('submission', null, { company_name: p.name, website: p.website, location: p.location, why_suitable: p.why }));
  const v = raw ? normalise(raw, local) : unscreened('Not screened automatically: the model was unavailable.');
  const moderation = { ...v, model: raw ? MODEL : null, screened_at: new Date().toISOString() };
  // Clear spam or abuse is turned away; everything else waits for a person.
  const reject = Boolean(raw) && !v.uncertain && (v.checks.spam || v.checks.abuse);
  const status = reject ? 'rejected' : s.status;
  const { error } = await admin.from('company_submissions').update({ moderation, status }).eq('id', s.id);
  if (error) return json(500, { error: 'save' });
  if (v.checks.safeguarding) {
    await admin.from('admin_alerts').insert({ kind: 'safeguarding', target_type: 'submission', target_id: s.id, message: SAFEGUARDING_GUIDANCE });
  }
  return json(200, { status });
});
