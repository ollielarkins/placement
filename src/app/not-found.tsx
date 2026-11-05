import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="grid gap-3">
      <h1 className="display text-3xl sm:text-4xl">Page not found</h1>
      <p className="text-slate-700">
        That employer or page isn&apos;t here. It may have closed or been removed.{' '}
        <Link href="/search" className="text-brand-700 underline">Search employers</Link>
      </p>
    </div>
  );
}
