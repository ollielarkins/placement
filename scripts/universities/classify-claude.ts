// Claude reads T Level passages the rules couldn't decide (tlevel.ts).
//
// The model sees only the passages from the course page (never student
// data), must answer through a forced tool, and must quote the passage it
// relied on. The quote is checked against the page passages; an answer whose
// quote isn't on the page is thrown away and the course stays "unknown".
//
// Needs ANTHROPIC_API_KEY; ANTHROPIC_MODEL is optional.

import type { Reading, TLevelStatus } from './tlevel.ts';

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-5-5';

export const SYSTEM_PROMPT = `You read short passages from a UK university course page and report what they say about entry with an Engineering and Manufacturing T Level (the T Levels in Design and Development for Engineering and Manufacturing; Engineering, Manufacturing, Processing and Control; or Maintenance, Installation and Repair for Engineering and Manufacturing).

Choose one status:
- accepted: an engineering T Level (or T Levels in general) meets the entry requirement on its own.
- accepted_with_maths: it is accepted only together with A level Maths (or another named maths qualification).
- case_by_case: applicants with T Levels are considered individually, or told to contact admissions.
- not_accepted: the passages say T Levels (or the engineering T Levels) are not accepted for this course.
- unknown: the passages don't say, only cover other T Level subjects, or contradict each other.

Rules: use only the passages. Never guess. "quote" must be copied exactly from the passages (one sentence or phrase, at most 300 characters). "requirement" is the grade wording for the T Level if stated (e.g. "Distinction", "D*", "Merit"), else empty.`;

export const TOOL = {
  name: 'report_tlevel_entry',
  description: 'Report what the passages say about entry with an Engineering and Manufacturing T Level.',
  input_schema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['accepted', 'accepted_with_maths', 'case_by_case', 'not_accepted', 'unknown'] },
      requirement: { type: 'string', description: 'T Level grade wording if stated, else empty' },
      quote: { type: 'string', description: 'Exact text copied from the passages' },
    },
    required: ['status', 'requirement', 'quote'],
  },
} as const;

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Accept the model's answer only if its quote is really in the passages. */
export function validateAnswer(
  answer: { status?: string; requirement?: string; quote?: string },
  passages: string[],
): Reading | null {
  const statuses: TLevelStatus[] = ['accepted', 'accepted_with_maths', 'case_by_case', 'not_accepted', 'unknown'];
  if (!answer.status || !statuses.includes(answer.status as TLevelStatus)) return null;
  const status = answer.status as TLevelStatus;
  const quote = (answer.quote ?? '').trim().slice(0, 600);
  if (status !== 'unknown') {
    if (quote.length < 8 || !passages.some((p) => squash(p).includes(squash(quote)))) return null;
  }
  const req = (answer.requirement ?? '').trim().slice(0, 120);
  return {
    status,
    requirement: (status === 'accepted' || status === 'accepted_with_maths') && req ? req : null,
    quote: status === 'unknown' ? null : quote,
    ambiguous: false,
  };
}

export async function classifyWithClaude(
  passages: string[],
  course: { title: string; university: string },
  apiKey: string,
): Promise<Reading | null> {
  const user =
    `Course: ${course.title} at ${course.university}\n\nPassages from the course page:\n` +
    passages.map((p, i) => `[${i + 1}] ${p}`).join('\n');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL.name },
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { content: { type: string; input?: Record<string, string> }[] };
  const call = body.content.find((c) => c.type === 'tool_use');
  return call?.input ? validateAnswer(call.input, passages) : null;
}
