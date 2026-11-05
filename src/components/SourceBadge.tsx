import type { DataSource } from '@/types/domain';
import { DATA_SOURCE_HELP, DATA_SOURCE_LABEL, ukDate } from '@/lib/format';

const STYLE: Record<DataSource, string> = {
  verified: 'bg-ink text-volt',
  imported: 'border border-ink/40 text-slate-700',
  student_submitted: 'border border-ink border-dashed text-ink',
};

export function SourceBadge({ source, verifiedAt }: { source: DataSource; verifiedAt?: string | null }) {
  const date = source === 'verified' ? ukDate(verifiedAt) : null;
  return (
    <span
      title={DATA_SOURCE_HELP[source]}
      className={`inline-flex items-center px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wide ${STYLE[source]}`}
    >
      {DATA_SOURCE_LABEL[source]}
      {date ? <span className="ml-1 font-normal">· checked {date}</span> : null}
    </span>
  );
}
