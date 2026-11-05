import type { Metadata } from 'next';
import Link from 'next/link';
import { regionCounts } from '@/lib/data';
import { ENGLAND_REGION_LABELS, type EnglandRegion } from '@/types/domain';

export const metadata: Metadata = { title: 'Employers by region' };
export const revalidate = 3600;

export default async function RegionsPage() {
  const rows = await regionCounts();
  const regions = rows.filter((r) => r.county === null).sort((a, b) => b.companies - a.companies);
  const max = Math.max(...regions.map((r) => r.companies), 1);
  const counties = (region: EnglandRegion) =>
    rows.filter((r) => r.region === region && r.county !== null).sort((a, b) => b.companies - a.companies);

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <h1 className="text-2xl font-semibold">Where the employers are</h1>
        <p className="max-w-2xl text-slate-700">
          Engineering employers with a site in each region of England. &quot;Checked&quot; means a person has looked for
          evidence that they take T Level students. Many registered offices are accountants&apos; addresses, so
          London counts run high.
        </p>
      </header>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Region</th>
              <th scope="col" className="px-4 py-2 font-medium">Employers</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Checked</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">With live adverts</th>
            </tr>
          </thead>
          <tbody>
            {regions.map((r) => (
              <tr key={r.region} className="border-t border-slate-100 align-top">
                <td className="px-4 py-2">
                  <Link href={`/search?region=${r.region}`} className="font-medium text-brand-700 underline">
                    {ENGLAND_REGION_LABELS[r.region]}
                  </Link>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-slate-500">Counties and areas</summary>
                    <ul className="mt-1 grid gap-0.5 text-xs text-slate-600">
                      {counties(r.region).map((c) => (
                        <li key={c.county} className="flex justify-between gap-4">
                          <span>{c.county}</span>
                          <span className="tabular-nums">{c.companies.toLocaleString('en-GB')}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 rounded bg-brand-600" style={{ width: `${(r.companies / max) * 10}rem` }} aria-hidden />
                    <span className="tabular-nums">{r.companies.toLocaleString('en-GB')}</span>
                  </div>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{r.verified.toLocaleString('en-GB')}</td>
                <td className="px-4 py-2 text-right tabular-nums">{r.with_vacancies.toLocaleString('en-GB')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
