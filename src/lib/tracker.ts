export type TrackerStage =
  | 'researching' | 'contacted' | 'replied' | 'interview' | 'offered' | 'secured' | 'rejected' | 'withdrawn';

export const OPEN_STAGES: { id: TrackerStage; label: string; hint: string }[] = [
  { id: 'researching', label: 'Researching', hint: 'Saved, not contacted yet' },
  { id: 'contacted', label: 'Contacted', hint: 'You’ve sent a message or applied' },
  { id: 'replied', label: 'Replied', hint: 'They got back to you' },
  { id: 'interview', label: 'Interview', hint: 'Interview or visit arranged' },
  { id: 'offered', label: 'Offered', hint: 'They’ve offered you a placement' },
  { id: 'secured', label: 'Secured', hint: 'Placement agreed' },
];
export const CLOSED_STAGES: { id: TrackerStage; label: string }[] = [
  { id: 'rejected', label: 'Not this time' },
  { id: 'withdrawn', label: 'You withdrew' },
];
export const ALL_STAGES = [...OPEN_STAGES, ...CLOSED_STAGES];
export const STAGE_LABEL = Object.fromEntries(ALL_STAGES.map((s) => [s.id, s.label])) as Record<TrackerStage, string>;
export const isStage = (v: string): v is TrackerStage => ALL_STAGES.some((s) => s.id === v);

export interface TrackerItem {
  id: string;
  company_id: string;
  stage: TrackerStage;
  contact_used: string | null;
  contacted_at: string | null;
  follow_up_on: string | null;
  notes: string | null;
  stage_changed_at: string;
  companies: { name: string; data_source: string } | null;
}

/** Follow-up due today or earlier on an application that's still open. */
export function isOverdue(t: Pick<TrackerItem, 'follow_up_on' | 'stage'>, today = new Date().toISOString().slice(0, 10)) {
  return Boolean(t.follow_up_on && t.follow_up_on <= today && !['secured', 'rejected', 'withdrawn'].includes(t.stage));
}
