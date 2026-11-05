import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'T Level Placement Finder', template: '%s · T Level Placement Finder' },
  description:
    'Find, compare and rank engineering employers in England for your T Level industry placement. Every company shows where its information came from.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0f766e' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen font-sans antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:bg-white focus:p-2">
          Skip to content
        </a>
        <header className="border-b border-slate-200 bg-white">
          <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3" aria-label="Main">
            <Link href="/" className="font-semibold text-brand-700">
              T Level Placement Finder
            </Link>
            <div className="flex gap-4 text-sm">
              <Link href="/search" className="hover:underline">Search</Link>
              <Link href="/map" className="hover:underline">Map</Link>
              <Link href="/regions" className="hover:underline">Regions</Link>
            </div>
            {/* One static link keeps every page cacheable: /account sends signed-out visitors to sign in. */}
            <Link href="/account" className="ml-auto text-sm font-medium text-brand-700 hover:underline">Account</Link>
          </nav>
        </header>
        <main id="main" className="mx-auto max-w-6xl px-4 py-6">
          {children}
        </main>
        <footer className="mx-auto max-w-6xl px-4 pb-10 pt-4 text-xs text-slate-500">
          <p>
            Company data: Companies House and Find an apprenticeship (Open Government Licence v3.0), plus curated
            research with a source for every claim. Your postcode is cut to its first half (for example MK45) before
            anything else happens, and is never stored. <Link href="/privacy" className="underline">Privacy notice</Link>.
          </p>
        </footer>
      </body>
    </html>
  );
}
