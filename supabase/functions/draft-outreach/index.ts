// draft-outreach (Supabase edge function, Deno)
//
// POST { company_id, channel, purpose } with the student's Authorization
// header (supabase.functions.invoke from the app does this). Drafts a message
// with Claude for the student to edit and send themselves; the app never
// contacts employers.
//
// * Signed-in, age-confirmed students only; 10 requests per rolling 24 hours.
// * Claude gets only the profile fields a message needs (no email address, no
//   postcode, no name) and the company's checked facts.
// * The result is sanitised (no invented contacts, links or pay) and saved to
//   outreach_drafts.
//
// Secrets: ANTHROPIC_API_KEY (required), ANTHROPIC_MODEL (optional).
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided
// by Supabase.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import {
  CHANNEL_RULES,
  DRAFT_TOOL,
  SYSTEM_PROMPT,
  buildUserPrompt,
  cleanSubject,
  sanitise,
  type Channel,
  type CompanyFacts,
  type Purpose,
  type StudentFacts,
} from './lib.ts';

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-haiku-5-5';
const DAILY_LIMIT = 10;
const PATTERN_LABEL: Record<string, string> = {
  block: 'block (several weeks in a row)',
  day_release: 'day release (a day or two a week)',
  mixed: 'a mix of block and day release',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const uk = (d: string | null) => (d ? d.split('-').reverse().join('/') : null);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'method' });

  const auth = req.headers.get('Authorization') ?? '';
  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const { data: who } = await asUser.auth.getUser();
  const user = who.user;
  if (!user) return json(401, { error: 'signin' });

  let input: { company_id?: string; channel?: string; purpose?: string };
  try {
    input = await req.json();
  } catch {
    return json(400, { error: 'input' });
  }
  const channel = input.channel as Channel;
  const purpose: Purpose = input.purpose === 'follow_up' ? 'follow_up' : 'placement';
  if (!input.company_id || !/^[0-9a-f-]{36}$/i.test(input.company_id) || !(channel in CHANNEL_RULES)) {
    return json(400, { error: 'input' });
  }

  // Profile (also the age check) and the daily limit.
  const { data: profile } = await admin
    .from('profiles')
    .select('age_confirmed_at, route_id, specialism, college_id, placement_pattern, placement_starts_on, placement_ends_on, interests, skills, about')
    .eq('user_id', user.id)
    .single();
  if (!profile?.age_confirmed_at) return json(403, { error: 'confirm' });
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await admin
    .from('outreach_requests')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', since);
  if ((count ?? 0) >= DAILY_LIMIT) return json(429, { error: 'limit' });

  // Company facts (active companies only) and reference names.
  const [{ data: company }, { data: routes }, { data: college }, { data: links }, { data: tracker }] = await Promise.all([
    admin
      .from('companies')
      .select('id, name, data_source, summary, specialisms, takes_tlevel, routes_onward, early_careers_programme, how_to_apply, website, status')
      .eq('id', input.company_id)
      .single(),
    admin.from('tlevel_routes').select('id, name, specialism_labels'),
    profile.college_id ? admin.from('colleges').select('name').eq('id', profile.college_id).single() : Promise.resolve({ data: null }),
    admin.from('company_college_links').select('kind, mainly_from_this_college, colleges(name)').eq('company_id', input.company_id),
    admin.from('tracker_items').select('id').eq('user_id', user.id).eq('company_id', input.company_id).maybeSingle(),
  ]);
  if (!company || company.status !== 'active') return json(404, { error: 'company' });

  const route = routes?.find((r) => r.id === profile.route_id);
  const specName = (id: string) => {
    for (const r of routes ?? []) {
      const n = (r.specialism_labels as Record<string, string>)?.[id];
      if (n) return n;
    }
    return null;
  };
  const student: StudentFacts = {
    tLevel: route?.name ?? null,
    specialism: profile.specialism ? specName(profile.specialism) : null,
    college: (college as { name: string } | null)?.name ?? null,
    placementPattern: profile.placement_pattern ? PATTERN_LABEL[profile.placement_pattern] ?? null : null,
    placementStarts: uk(profile.placement_starts_on),
    placementEnds: uk(profile.placement_ends_on),
    interests: profile.interests ?? [],
    skills: profile.skills ?? [],
    about: profile.about,
  };
  const label = (kind: string, name: string, mainly: boolean) =>
    mainly ? `Takes placements mainly from ${name}`
    : kind === 'tlevel_placements' ? `Has hosted T Level students from ${name}`
    : kind === 'industry_placements' ? `Has hosted placement students from ${name}`
    : kind === 'apprenticeships' ? `Trains apprentices with ${name}`
    : `Partner employer of ${name}`;
  const facts: CompanyFacts = {
    name: company.name,
    checked: company.data_source === 'verified',
    summary: company.summary,
    specialisms: (company.specialisms ?? []).map((s: string) => specName(s)).filter(Boolean) as string[],
    hostedTLevelStudents: company.takes_tlevel === 'yes',
    collegeLinks: (links ?? []).map((l) =>
      label(l.kind, (l.colleges as unknown as { name: string } | null)?.name ?? 'a college', l.mainly_from_this_college),
    ),
    runsApprenticeships: (company.routes_onward ?? []).includes('apprenticeship'),
    earlyCareersProgramme: Boolean(company.early_careers_programme),
    howToApply: company.how_to_apply,
    website: company.website,
  };

  // Log the request first, so a failing or slow model still counts.
  const { data: logged } = await admin
    .from('outreach_requests')
    .insert({ user_id: user.id, company_id: company.id, channel, ok: false })
    .select('id')
    .single();

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      tools: [DRAFT_TOOL],
      tool_choice: { type: 'tool', name: DRAFT_TOOL.name },
      messages: [{ role: 'user', content: buildUserPrompt(channel, purpose, student, facts) }],
    }),
    signal: AbortSignal.timeout(45_000),
  }).catch(() => null);
  if (!res?.ok) return json(502, { error: 'model' });
  const out = await res.json();
  const call = (out.content ?? []).find((b: { type: string }) => b.type === 'tool_use');
  const body = typeof call?.input?.body === 'string' ? sanitise(call.input.body, CHANNEL_RULES[channel].maxChars) : '';
  if (!body) return json(502, { error: 'model' });

  const { data: draft, error } = await admin
    .from('outreach_drafts')
    .insert({
      user_id: user.id,
      company_id: company.id,
      tracker_item_id: tracker?.id ?? null,
      channel,
      subject: CHANNEL_RULES[channel].subject ? cleanSubject(call.input.subject) : null,
      body,
      model: MODEL,
    })
    .select('id')
    .single();
  if (error || !draft) return json(500, { error: 'save' });
  if (logged) await admin.from('outreach_requests').update({ ok: true }).eq('id', logged.id);

  return json(200, { id: draft.id, left: Math.max(0, DAILY_LIMIT - (count ?? 0) - 1) });
});
