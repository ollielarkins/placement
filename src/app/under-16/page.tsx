import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Account deleted' };

export default function UnderSixteenPage() {
  return (
    <section className="mx-auto grid max-w-md gap-3 rounded-xl border border-slate-200 bg-white p-6">
      <h1 className="text-xl font-semibold">We’ve deleted your account</h1>
      <p className="text-slate-700">
        Accounts are for students aged 16 and over, so we’ve removed it and kept nothing. You can still search
        employers, use the map and read company pages without an account.
      </p>
      <Link href="/search" className="text-brand-700 underline">Search employers</Link>
    </section>
  );
}
