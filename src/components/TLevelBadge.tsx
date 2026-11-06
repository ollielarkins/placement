import { TLEVEL_STATUS, type TLevelStatus } from '@/lib/opportunities';

const STYLE: Record<TLevelStatus, string> = {
  accepted: 'bg-volt text-ink border-ink',
  accepted_with_maths: 'bg-cobalt text-white border-cobalt',
  case_by_case: 'bg-paper text-ink border-ink',
  not_accepted: 'bg-ink text-paper border-ink',
  unknown: 'bg-white text-slate-700 border-dashed border-slate-500',
};

/** What the course page says about T Levels. */
export function TLevelBadge({ status, requirement, large = false }: { status: TLevelStatus; requirement?: string | null; large?: boolean }) {
  const s = TLEVEL_STATUS[status];
  const req = requirement && (status === 'accepted' || status === 'accepted_with_maths') ? ` · ${requirement}` : '';
  return (
    <span
      title={s.help}
      className={`inline-block border-2 font-bold ${large ? 'px-3 py-1 text-base' : 'px-2 py-0.5 text-xs'} ${STYLE[status]}`}
    >
      {large ? s.label : s.short}
      {req}
    </span>
  );
}
