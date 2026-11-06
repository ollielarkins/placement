/** Placeholder while a results page loads, so a click shows something at once. */
export function ResultsSkeleton({ title, sidebar = true }: { title?: string; sidebar?: boolean }) {
  return (
    <div className="grid gap-6" aria-busy="true" aria-live="polite">
      {title ? <h1 className="display text-3xl sm:text-4xl">{title}</h1> : null}
      <p className="sr-only">Loading…</p>
      <div className={`grid gap-6 ${sidebar ? 'lg:grid-cols-[18rem_1fr]' : ''}`}>
        {sidebar ? <div className="hidden h-96 animate-pulse border-2 border-ink bg-white lg:block" /> : null}
        <div className="grid content-start gap-3">
          <div className="h-6 w-48 animate-pulse bg-slate-200" />
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="grid gap-2 border-2 border-ink bg-white p-4">
              <div className="h-5 w-2/3 animate-pulse bg-slate-200" />
              <div className="h-4 w-1/3 animate-pulse bg-slate-100" />
              <div className="flex gap-2">
                <div className="h-5 w-24 animate-pulse bg-slate-100" />
                <div className="h-5 w-20 animate-pulse bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
