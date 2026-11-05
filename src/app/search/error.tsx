'use client';

import Link from 'next/link';

// Shown if ranking fails (for example a database timeout). The technical
// message stays in the server logs; students get a plain next step.
export default function SearchError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-6">
      <h1 className="text-lg font-semibold">Search took too long</h1>
      <p className="text-slate-700">
        We couldn&apos;t rank employers just now. Try again, or narrow the search with your postcode or a smaller
        travel distance.
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
        >
          Try again
        </button>
        <Link href="/" className="rounded-md px-4 py-2 text-brand-700 underline">
          Start a new search
        </Link>
      </div>
    </div>
  );
}
