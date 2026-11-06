export interface BigFact {
  value: string;
  /** Small text after the value: "/ year", "days". */
  unit?: string;
  label: string;
  tone?: 'normal' | 'urgent' | 'muted';
}

/** A row of large figures (wage, closing date, distance): the first things to read on an advert. */
export function BigFacts({ facts, size = 'md' }: { facts: BigFact[]; size?: 'md' | 'lg' }) {
  if (!facts.length) return null;
  const big = size === 'lg' ? 'text-4xl sm:text-5xl' : 'text-3xl';
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-3">
      {facts.map((f) => (
        <div key={f.label} className="grid content-start">
          <dt className="order-2 mt-1 text-xs font-bold uppercase tracking-wide text-slate-600">{f.label}</dt>
          <dd
            className={`order-1 leading-none ${f.tone === 'muted' ? 'text-lg font-bold' : `display ${big}`} ${
              f.tone === 'urgent' ? 'text-red-700' : ''
            }`}
          >
            {f.value}
            {f.unit ? <span className="ml-1 font-sans text-sm font-bold text-slate-500">{f.unit}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
