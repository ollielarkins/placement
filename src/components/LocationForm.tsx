import type { ReferenceData } from '@/lib/data';

// Plain HTML form: works without JavaScript and POSTs the postcode so it never
// appears in a URL. The server keeps only the outward code (see /go).
export function LocationForm({
  reference,
  defaults,
  dest = 'search',
  compact = false,
}: {
  reference: ReferenceData;
  defaults?: { oc?: string | null; km?: number; route?: string | null; spec?: string | null };
  dest?: 'search' | 'map';
  compact?: boolean;
}) {
  return (
    <form method="post" action="/go" className={`grid gap-3 ${compact ? 'sm:grid-cols-2 lg:grid-cols-[minmax(7rem,9rem)_minmax(8rem,10rem)_minmax(0,1fr)_minmax(0,1fr)_auto]' : 'sm:grid-cols-2'}`}>
      <input type="hidden" name="dest" value={dest} />
      <label className="grid min-w-0 content-start gap-1 text-sm">
        <span className="font-bold">Your postcode</span>
        <input
          name="postcode"
          defaultValue={defaults?.oc ?? ''}
          placeholder="e.g. MK45 1AB or MK45"
          autoComplete="postal-code"
          inputMode="text"
          maxLength={9}
          className="w-full min-w-0 truncate rounded-md border border-slate-300 bg-white px-3 py-2"
        />
        <span className="text-xs text-slate-500">We only keep the first half, e.g. MK45.</span>
      </label>
      <label className="grid min-w-0 content-start gap-1 text-sm">
        <span className="font-bold">How far will you travel?</span>
        <select name="km" defaultValue={String(defaults?.km ?? 25)} className="w-full min-w-0 truncate rounded-md border border-slate-300 bg-white px-3 py-2">
          <option value="8">5 miles</option>
          <option value="16">10 miles</option>
          <option value="25">15 miles</option>
          <option value="40">25 miles</option>
          <option value="65">40 miles</option>
        </select>
      </label>
      <label className="grid min-w-0 content-start gap-1 text-sm">
        <span className="font-bold">Your T Level</span>
        <select name="route" defaultValue={defaults?.route ?? ''} className="w-full min-w-0 truncate rounded-md border border-slate-300 bg-white px-3 py-2">
          <option value="">Any Engineering T Level</option>
          {reference.routes.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </label>
      <label className="grid min-w-0 content-start gap-1 text-sm">
        <span className="font-bold">Your specialism</span>
        <select name="spec" defaultValue={defaults?.spec ?? ''} className="w-full min-w-0 truncate rounded-md border border-slate-300 bg-white px-3 py-2">
          <option value="">Not sure yet</option>
          {reference.routes.map((r) => (
            <optgroup key={r.id} label={r.name}>
              {r.specialisms.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <div className={compact ? 'flex items-start sm:col-span-2 lg:col-span-1 lg:pt-6' : 'sm:col-span-2'}>
        <button type="submit" className="w-full whitespace-nowrap border-2 border-ink bg-volt px-5 py-2 font-bold uppercase tracking-wide text-ink shadow-hard-sm transition hover:-translate-y-0.5 hover:shadow-hard sm:w-auto">
          {dest === 'map' ? 'Show on map →' : 'Find placements →'}
        </button>
      </div>
    </form>
  );
}
