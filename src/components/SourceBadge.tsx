import type { DataSource } from '@/types/domain';
import { DATA_SOURCE_HELP, DATA_SOURCE_LABEL, ukDate } from '@/lib/format';

const STYLE: Record<DataSource, string> = {
  verified: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  imported: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  student_submitted: 'bg-amber-50 text-amber-800 ring-amber-600/20',
};

export function SourceBadge({ source, verifiedAt }: { source: DataSource; verifiedAt?: string | null }) {
  const date = source === 'verified' ? ukDate(verifiedAt) : null;
  return (
    <span
      title={DATA_SOURCE_HELP[source]}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLE[source]}`}
    >
      {DATA_SOURCE_LABEL[source]}
      {date ? <span className="ml-1 font-normal">· checked {date}</span> : null}
    </span>
  );
}
