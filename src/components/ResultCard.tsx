import Link from 'next/link';
import type { RankedCompany } from '@/types/domain';
import { displayName, miles } from '@/lib/format';
import { SourceBadge } from './SourceBadge';

export function ResultCard({ r, hasOrigin, colleges = [] }: { r: RankedCompany; hasOrigin: boolean; colleges?: string[] }) {
  const dist = hasOrigin ? miles(r.distance_km) : null;
  // Distance and live adverts already show in the meta line; don't repeat them as reasons.
  const reasons = r.reasons.filter((x) => !/\bmiles? away$/i.test(x) && !/live apprenticeship vacanc/i.test(x));
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start gap-4">
        <ScoreRing score={r.score} />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">
            <Link href={`/companies/${r.company_id}`} className="hover:underline">
              {displayName(r.name)}
            </Link>
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <SourceBadge source={r.data_source} verifiedAt={r.verified_at} />
            {dist ? <span>{dist} away</span> : null}
            {r.live_vacancies > 0 ? (
              <span>
                {r.live_vacancies} live apprenticeship {r.live_vacancies === 1 ? 'advert' : 'adverts'}
              </span>
            ) : null}
          </div>
          {colleges.length ? (
            <ul className="mt-2 flex flex-wrap gap-2 text-sm" aria-label="Colleges it works with">
              {colleges.slice(0, 2).map((c) => (
                <li key={c} className="rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-sky-900">
                  {c}
                </li>
              ))}
            </ul>
          ) : null}
          {reasons.length ? (
            <ul className="mt-2 flex flex-wrap gap-2 text-sm" aria-label="Why it matches">
              {reasons.map((reason) => (
                <li key={reason} className="rounded-md bg-brand-50 px-2 py-0.5 text-brand-900">
                  {reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function ScoreRing({ score }: { score: number }) {
  const s = Math.round(score);
  const pct = Math.max(0, Math.min(100, s));
  return (
    <div
      className="grid size-12 shrink-0 place-items-center rounded-full text-sm font-semibold tabular-nums"
      style={{ background: `conic-gradient(var(--color-brand-600) ${pct * 3.6}deg, #e2e8f0 0deg)` }}
      aria-label={`Match score ${s} out of 100`}
      role="img"
    >
      <span className="grid size-9 place-items-center rounded-full bg-white">{s}</span>
    </div>
  );
}
