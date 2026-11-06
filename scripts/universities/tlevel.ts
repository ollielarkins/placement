// Reads what a university course page says about T Levels. Pure functions,
// unit-tested in tlevel.test.ts.
//
// Statuses (public.tlevel_status, migration 0024):
//   accepted             the T Level alone meets the requirement
//   accepted_with_maths  needs A level Maths (or similar) as well
//   case_by_case         considered individually / contact admissions
//   not_accepted         the page says T Levels aren't accepted
//   unknown              the page doesn't say, or the wording is unclear
//
// Rules run first and only answer when the wording is plain. Anything mixed
// or unclear stays unknown with its passage kept, so the Claude pass
// (classify-claude.ts) or a person can decide. Every answer keeps the exact
// sentence it came from: nothing is inferred.

export type TLevelStatus = 'accepted' | 'accepted_with_maths' | 'case_by_case' | 'not_accepted' | 'unknown';

export interface Reading {
  status: TLevelStatus;
  requirement: string | null; // e.g. "Distinction" or "D*"
  quote: string | null; // the passage relied on (verbatim from the page text)
  ambiguous: boolean; // a T Level passage exists but rules couldn't decide
}

const T_LEVEL = /\bT[\s-]?Levels?\b/gi;
const HAS_T_LEVEL = /\bT[\s-]?Levels?\b/i;

/**
 * Requirement blocks hidden behind a qualification drop-down (Imperial and
 * similar): <option value="123">T Levels</option> ... <div data-code="123">text</div>.
 * Returned as "T Levels: text" lines so the normal reader sees them.
 */
export function dropdownTLevelText(html: string): string[] {
  const out: string[] = [];
  for (const o of html.matchAll(/<option[^>]*\bvalue="([^"]{1,40})"[^>]*>\s*([^<]*\bT[\s-]?Levels?\b[^<]*?)\s*</gi)) {
    const code = o[1]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const block = new RegExp(`data-(?:code|value|qualification)="${code}"[^>]*>([\\s\\S]{0,2000}?)</(?:div|section|li)>`, 'i').exec(html);
    if (!block) continue;
    const text = block[1]!.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    if (text) out.push(`${o[2]!.trim()}: ${text.slice(0, 500)}`);
  }
  return out;
}

/** Visible text of a page, with line breaks kept at block boundaries. */
export function pageText(html: string): string {
  const hidden = dropdownTLevelText(html);
  return (hidden.length ? `${hidden.join('\n')}\n` : '') + html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\s*(br|\/p|\/li|\/h[1-6]|\/tr|\/div|\/dd|\/dt)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;|&#8217;/g, "'")
    .replace(/&ndash;|&#8211;/g, '-')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/**
 * Passages that mention T Levels: the line containing each mention, plus the
 * next line when the mention is a heading ("T Levels" followed by the
 * requirement). Each at most 600 characters.
 */
export function tLevelPassages(text: string): string[] {
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!HAS_T_LEVEL.test(line)) continue;
    let passage = line;
    // A short heading-like line ("T Levels", "T Level:") carries its detail on the next line(s).
    if (line.replace(T_LEVEL, '').replace(/[^a-z]/gi, '').length < 12 && !gradeIn(line)) {
      passage = [line, lines[i + 1] ?? '', lines[i + 2] ?? ''].join(' ').trim();
    }
    passage = passage.replace(/\s+/g, ' ').trim();
    if (passage.length > 600) {
      const m = passage.search(HAS_T_LEVEL);
      const start = Math.max(0, m - 250);
      passage = passage.slice(start, start + 600).trim();
    }
    if (!out.includes(passage)) out.push(passage);
  }
  return out.slice(0, 6);
}

const NOT_ACCEPTED_BEFORE = /\b(do(es)?\s+not|don't|doesn't|cannot|can't|are\s+unable\s+to|is\s+unable\s+to|unable\s+to|(are|is)\s+(currently\s+)?not)\s+(currently\s+)?(accept|consider)\w*\s+(the\s+)?(any\s+)?T[\s-]?Levels?/i;
const NOT_ACCEPTED_AFTER = /\bT[\s-]?Levels?\b([^.]{0,80}?)\b((are|is)\s+not\s+(currently\s+)?(accepted|acceptable|considered|suitable|eligible)|not\s+(accepted|acceptable|considered))/i;
function saysNotAccepted(p: string): boolean {
  if (NOT_ACCEPTED_BEFORE.test(p)) return true;
  const m = NOT_ACCEPTED_AFTER.exec(p);
  // "Other T-level subjects are not accepted": the named ones are.
  if (m && /\b(other|any\s+other|remaining)\s+$/i.test(p.slice(Math.max(0, m.index - 20), m.index))) return false;
  // "T Level Access to HE Diploma Not accepted": the refusal belongs to the other qualification.
  return !!m && !OTHER_QUAL.test(m[1] ?? '');
}
const CASE_BY_CASE = [
  /\bcase[\s-]by[\s-]case\b/i,
  /\bindividual\s+basis\b/i,
  /\bconsidered\s+individually\b/i,
  /\b(on|by)\s+(their|its)\s+(own\s+)?merits?\b/i,
  /\b(please\s+)?contact\s+(our\s+|the\s+)?(admissions|admissions\s+team|admissions\s+office)\b/i,
  /\bmay\s+be\s+considered\b/i,
];
// Maths alongside the T Level.
const WITH_MATHS = [
  /\bT[\s-]?Levels?\b[^.]{0,160}(\b(plus|with|alongside|and|in\s+addition\s+to|together\s+with|as\s+well\s+as)\b|\+)[^.]{0,60}\bA[\s-]?levels?\s+(in\s+)?(Further\s+)?(Mathematics|Maths)\b/i,
  /\bT[\s-]?Levels?\b[^.]{0,160}\b(plus|with|alongside|and|in\s+addition\s+to|together\s+with|as\s+well\s+as)\b[^.]{0,30}\b(Mathematics|Maths)\b[^.]{0,20}\bA[\s-]?level\b/i,
  /\bA[\s-]?levels?\s+(in\s+)?(Mathematics|Maths)\b[^.]{0,60}\b(is\s+)?(also\s+)?required\b[^.]{0,60}\bT[\s-]?Levels?\b/i,
  /\bA[\s-]?levels?\s+(in\s+)?(Mathematics|Maths)\b[^.]{0,60}\b(in\s+addition\s+to|alongside|as\s+well\s+as|together\s+with)\b[^.]{0,30}\bT[\s-]?Levels?\b/i,
  /\bA[\s-]?levels?\s+(in\s+)?(Mathematics|Maths)\b[^.]{0,40}\b(needed|required|necessary|essential)\b[^.]{0,30}\b(alongside|with|in\s+addition\s+to)\b[^.]{0,10}\bT[\s-]?Levels?\b/i,
  /\bT[\s-]?Levels?\b[^]{0,200}?\bA[\s-]?levels?\s+(in\s+)?(Mathematics|Maths)\b[^.]{0,30}\b(is|are)\s+(still\s+|also\s+)?(required|needed|essential)\b/i,
  /\bT[\s-]?Levels?\b[^.]{0,120}\bunless\b[^.]{0,80}\bA[\s-]?levels?\b[^.]{0,40}\b(Mathematics|Maths)\b/i,
];
const GRADE = /\b(Distinction\*|Distinction|Merit|Pass)\b(\s*\(\s*(A\*|[A-E]\*?|D\*?|M|P)\s*\))?|\b(D\*|D)(?=[\s,.;)]|$)/;
const ACCEPT_WORDS = /\b(accept\w*|consider\w*|welcome\w*|suitable|eligible|meet\w*|require\w*|grade|overall|typical\s+offer|entry\s+requirements?)\b/i;
// The page is about engineering T Levels, or T Levels in general.
const OTHER_ROUTE_ONLY = /\bT[\s-]?Levels?\s+in\s+(Health|Healthcare|Science|Education|Childcare|Digital|Accounting|Finance|Legal|Agriculture|Hair|Catering|Management|Media|Onsite|Building\s+Services)\b/i;
export const ENGINEERING_ROUTE = /\b(Engineering|Manufacturing|Design\s+and\s+Development|Maintenance,?\s+Installation|Processing\s+and\s+Control)\b/i;

/** The requirement wording near the T Level mention, e.g. "Distinction" or "D*". */
const LETTER_GRADE = /\b(?:Grade|overall(?:\s+grade)?(?:\s+of)?)\s+(D\*|D|M|P)(?=[\s,.;)]|$)|\bT[\s-]?Levels?\s*:?\s+(D\*|D|M|P)(?=[\s,.;)-]|$)/i;
const LETTER_NAME: Record<string, string> = { 'D*': 'Distinction*', D: 'Distinction', M: 'Merit', P: 'Pass' };

export function gradeIn(passage: string): string | null {
  const l = LETTER_GRADE.exec(passage);
  const m = GRADE.exec(passage);
  if (l && (!m || l.index < m.index)) {
    const g = (l[1] ?? l[2]!).toUpperCase();
    return LETTER_NAME[g] ?? g;
  }
  if (!m) return null;
  if (!m[1]) return LETTER_NAME[m[4]!.toUpperCase()] ?? m[4]!;
  return m[0].replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** A case-by-case phrase that is about T Levels, not another qualification run into the same block. */
function caseByCase(p: string): boolean {
  const t = HAS_T_LEVEL.exec(p);
  if (!t) return false;
  for (const r of CASE_BY_CASE) {
    const m = r.exec(p);
    if (!m) continue;
    const between = m.index > t.index ? p.slice(t.index + t[0].length, m.index) : '';
    if (!OTHER_QUAL.test(between)) return true;
  }
  return false;
}

/** "T Levels: Distinction ..." - a grade within 60 characters after the mention. */
const OTHER_QUAL = /\b(GCSEs?|BTEC|Extended\s+Diploma|Diploma|Access\s+to\s+HE|A[\s-]?levels?|IB|International\s+Baccalaureate|Baccalaureate|Scottish|Highers?|Irish\s+Leaving|Cambridge\s+Technical|UCAS\s+points)\b/i;
function gradeSoonAfterTLevel(p: string): boolean {
  const m = HAS_T_LEVEL.exec(p);
  if (!m) return false;
  const after = p.slice(m.index + m[0].length, m.index + m[0].length + 40);
  const g = GRADE.exec(after);
  // "T Levels GCSEs Extended Diploma: Merit" - the grade belongs to another qualification.
  return !!g && !OTHER_QUAL.test(after.slice(0, g.index));
}

/** Rules-only reading of a page's T Level passages. */
export function readTLevels(passages: string[]): Reading {
  if (!passages.length) return { status: 'unknown', requirement: null, quote: null, ambiguous: false };

  const found: { status: TLevelStatus; passage: string }[] = [];
  for (const p of passages) {
    // A passage naming only non-engineering T Levels says nothing about ours.
    if (OTHER_ROUTE_ONLY.test(p) && !ENGINEERING_ROUTE.test(p)) continue;
    if (WITH_MATHS.some((r) => r.test(p))) found.push({ status: 'accepted_with_maths', passage: p });
    else if (saysNotAccepted(p)) found.push({ status: 'not_accepted', passage: p });
    else if (gradeSoonAfterTLevel(p)) found.push({ status: 'accepted', passage: p });
    else if (caseByCase(p)) found.push({ status: 'case_by_case', passage: p });
    else if (gradeIn(p) && ACCEPT_WORDS.test(p)) found.push({ status: 'accepted', passage: p });
  }
  const statuses = new Set(found.map((f) => f.status));
  // Specific readings outrank generic "contact admissions" text; a page that
  // both accepts and refuses stays unclear.
  const accepting = statuses.has('accepted') || statuses.has('accepted_with_maths');
  const pick: TLevelStatus | null =
    statuses.size === 1 ? [...statuses][0]!
    : statuses.has('not_accepted') && accepting ? null
    : statuses.has('accepted_with_maths') ? 'accepted_with_maths'
    : statuses.has('accepted') ? 'accepted'
    : null;
  if (pick) {
    const f = found.find((x) => x.status === pick)!;
    return {
      status: f.status,
      requirement: f.status === 'accepted' || f.status === 'accepted_with_maths' ? gradeIn(f.passage) : null,
      quote: f.passage,
      ambiguous: false,
    };
  }
  return { status: 'unknown', requirement: null, quote: passages[0]!, ambiguous: true };
}

/** "AAB", "ABB including Maths", "A*AA including Mathematics and Physics" near "A level". */
export function aLevelRequirement(text: string): string | null {
  const m = /\bA[\s-]?levels?\s*[:\-–]?\s*(?:grades?\s+)?((?:A\*|[A-E]){3,4})\b((?:\s*,?\s*(?:including|incl\.?|to\s+include)\s+[^.\n;]{2,80}))?/i.exec(text);
  if (!m) return null;
  let incl = m[2] ? m[2].trim().replace(/^,\s*/, '') : '';
  // "including Maths and one of the following subjects" - the list itself is cut off.
  if (/\bfollowing(\s+subjects?)?[\s:]*$/i.test(incl)) incl = `${incl.replace(/[\s:]+$/, '')} (list on the course page)`;
  return `${m[1]!.toUpperCase()}${incl ? ` ${incl}` : ''}`.slice(0, 200);
}
