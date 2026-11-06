import type { Metadata, Viewport } from 'next';
import { Archivo } from 'next/font/google';
import Link from 'next/link';
import './globals.css';

// One variable family: normal width for text, expanded for headlines.
const archivo = Archivo({ subsets: ['latin'], axes: ['wdth'], variable: '--font-archivo', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'T Level Pathways', template: '%s · T Level Pathways' },
  description:
    'Placements, apprenticeships and degrees for Engineering and Manufacturing T Level students in England. Every employer ranked for you, every source shown.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#111111' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={archivo.variable}>
      <body className="flex min-h-screen flex-col font-sans antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:bg-white focus:p-2">
          Skip to content
        </a>
        <header className="border-b-2 border-ink bg-paper">
          <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3" aria-label="Main">
            <Link href="/" className="group flex items-center gap-2" aria-label="T Level Pathways, home">
              <span aria-hidden className="grid size-8 place-items-center border-2 border-ink bg-volt text-lg leading-none shadow-hard-sm transition group-hover:-translate-y-0.5">
                ◆
              </span>
              <span className="grid leading-none">
                <span className="text-[10px] font-semibold tracking-[0.2em]">T LEVEL</span>
                <span className="display text-base sm:text-lg">Pathways</span>
              </span>
            </Link>
            <div className="flex gap-1 text-sm font-semibold">
              {(
                [
                  ['/search', 'Placements'],
                  ['/map', 'Map'],
                  ['/apprenticeships', 'Apprenticeships'],
                  ['/universities', 'Universities'],
                ] as const
              ).map(([href, label]) => (
                <Link key={href} href={href} className="px-2 py-1 hover:bg-volt">
                  {label}
                </Link>
              ))}
            </div>
            {/* One static link keeps every page cacheable: /account sends signed-out visitors to sign in. */}
            <Link href="/account" className="ml-auto border-2 border-ink bg-ink px-3 py-1 text-sm font-semibold text-volt shadow-hard-sm hover:bg-volt hover:text-ink">
              Account
            </Link>
          </nav>
        </header>
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
          {children}
        </main>
        <footer className="mt-10 border-t-2 border-ink bg-ink text-paper">
          <div className="mx-auto grid max-w-6xl gap-4 px-4 py-8 text-sm sm:grid-cols-[1fr_auto]">
            <div className="grid gap-2">
              <p className="display text-2xl text-volt">T Level Pathways</p>
              <p className="max-w-xl text-paper/80">
                Built by a T Level student, for T Level students. Company data: Companies House and Find an
                apprenticeship (Open Government Licence v3.0), plus research with a source for every claim. Courses:
                Discover Uni (HESA and the Office for Students, CC BY 4.0).
              </p>
              <p className="max-w-xl text-paper/80">
                Your postcode is cut to its first half (for example MK45) before anything else happens, and is never
                stored.
              </p>
            </div>
            <nav aria-label="Footer" className="flex flex-wrap gap-4 self-end font-semibold">
              <Link href="/privacy" className="underline decoration-volt decoration-2 underline-offset-4">Privacy</Link>
              <Link href="/regions" className="underline decoration-volt decoration-2 underline-offset-4">Regions</Link>
              <Link href="/submit" className="underline decoration-volt decoration-2 underline-offset-4">Suggest a company</Link>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
