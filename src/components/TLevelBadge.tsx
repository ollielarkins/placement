import { TLEVEL_STATUS, tlevelTagText, type TLevelStatus } from '@/lib/opportunities';

const STYLE: Record<TLevelStatus, string> = {
  accepted: 'bg-volt text-ink border-ink',
  accepted_with_maths: 'bg-cobalt text-white border-cobalt',
  case_by_case: 'bg-paper text-ink border-ink',
  not_accepted: 'bg-ink text-paper border-ink',
  unknown: 'bg-white text-slate-700 border-dashed border-slate-500',
};

/** What the course page says about T Levels, with the grade and any A level needed alongside. */
export function TLevelBadge({
  status,
  requirement,
  alevel,
  large = false,
}: {
  status: TLevelStatus;
  requirement?: string | null;
  alevel?: string | null;
  large?: boolean;
}) {
  return (
    <span
      title={TLEVEL_STATUS[status].help}
      className={`inline-block border-2 font-bold ${large ? 'px-3 py-1 text-base' : 'px-2 py-0.5 text-xs'} ${STYLE[status]}`}
    >
      {tlevelTagText(status, requirement, alevel, large)}
    </span>
  );
}
