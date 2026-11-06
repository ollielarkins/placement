import { ordinal, type RankStat } from '@/lib/rank';

/**
 * Rankings as big numbers: the first thing to read on a course. Each shows
 * where it comes from (the Complete University Guide, or our own rank).
 */
export function RankStats({ stats, size = 'md' }: { stats: RankStat[]; size?: 'md' | 'lg' }) {
  if (!stats.length) return null;
  const big = size === 'lg' ? 'text-5xl sm:text-6xl' : 'text-4xl';
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-3">
      {stats.map((s) => (
        <div key={s.label} className="grid content-start">
          <dt className="sr-only">
            {s.label}, {s.source}
          </dt>
          <dd className={`display leading-none ${big}`}>
            {ordinal(s.position, s.tied)}
            <span className="ml-1 align-baseline font-sans text-base font-bold text-slate-500">/ {s.of}</span>
          </dd>
          <dd className="mt-1 text-sm font-bold leading-tight">{s.label}</dd>
          <dd className={`text-xs font-semibold ${s.source.startsWith('Complete') ? 'text-ink' : 'text-cobalt'}`}>{s.source}</dd>
        </div>
      ))}
    </dl>
  );
}
