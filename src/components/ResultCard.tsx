import Link from 'next/link';
import type { RankedCompany } from '@/types/domain';
import { displayName, miles } from '@/lib/format';
import { SaveButton } from './SaveButton';
import { AdjacentBadge, SourceBadge } from './SourceBadge';

export function ResultCard({ r, hasOrigin, colleges = [] }: { r: RankedCompany; hasOrigin: boolean; colleges?: string[] }) {
  const dist = hasOrigin ? miles(r.distance_km) : null;
  // Distance and live adverts already show in the meta line; don't repeat them as reasons.
  const reasons = r.reasons.filter((x) => !/\bmiles? away$/i.test(x) && !/live apprenticeship vacanc/i.test(x));
  return (
    <li className="border-2 border-ink bg-white p-4 transition hover:-translate-y-0.5 hover:shadow-hard">
      <div className="flex items-start gap-4">
        <ScoreRing score={r.score} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="text-lg font-bold leading-tight">
              <Link href={`/companies/${r.company_id}`} className="hover:underline">
                {displayName(r.name)}
              </Link>
            </h3>
            <SaveButton companyId={r.company_id} compact />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <SourceBadge source={r.data_source} verifiedAt={r.verified_at} />
            {r.engineering_tier === 'adjacent' ? <AdjacentBadge /> : null}
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
                <li key={c} className="bg-cobalt px-2 py-0.5 font-medium text-white">
                  {c}
                </li>
              ))}
            </ul>
          ) : null}
          {reasons.length ? (
            <ul className="mt-2 flex flex-wrap gap-2 text-sm" aria-label="Why it matches">
              {reasons.map((reason) => (
                <li key={reason} className="border border-ink px-2 py-0.5 font-medium">
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
  return (
    <div
      className={`grid size-14 shrink-0 place-items-center border-2 border-ink font-mono text-xl font-bold tabular-nums ${
        s >= 50 ? 'bg-volt' : 'bg-white'
      }`}
      aria-label={`Match score ${s} out of 100`}
      role="img"
    >
      {s}
    </div>
  );
}
