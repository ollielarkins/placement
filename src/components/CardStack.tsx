'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { clearDislikes, react, unreact, type ItemType } from '@/app/account/liked/actions';
import { RankStats } from '@/components/RankStats';
import type { RankStat } from '@/lib/rank';

export interface CardItem {
  id: string;
  title: string;
  subtitle?: string | null;
  /** Short facts shown as chips. */
  chips?: string[];
  /** A highlighted chip (score, T Level status). */
  badge?: { text: string; tone: 'volt' | 'cobalt' | 'ink' | 'plain' } | null;
  /** Rankings shown as big numbers. */
  stats?: RankStat[];
  /** A sentence worth reading (reasons, T Level quote). */
  note?: string | null;
  href: string;
  external?: boolean;
}

const TONE = {
  volt: 'bg-volt text-ink border-ink',
  cobalt: 'bg-cobalt text-white border-cobalt',
  ink: 'bg-ink text-paper border-ink',
  plain: 'bg-white text-ink border-ink border-dashed',
};

/**
 * Card mode: one result at a time, like or dislike (buttons, arrow keys or a
 * swipe). Saved to the student's account; a dislike only hides the item from
 * card mode. Items already reacted to are skipped.
 */
export function CardStack({
  items,
  itemType,
  nextPageHref,
  label,
}: {
  items: CardItem[];
  itemType: ItemType;
  nextPageHref: string | null;
  label: string; // "placements", "courses", "apprenticeships"
}) {
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'signedOut' | 'ready'>('loading');
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [likedCount, setLikedCount] = useState(0);
  const [hasDislikes, setHasDislikes] = useState(false);
  const [last, setLast] = useState<{ id: string; reaction: 'like' | 'dislike' } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!document.cookie.includes('sb-')) {
      setState('signedOut');
      return;
    }
    let live = true;
    fetch(`/api/reactions?type=${itemType}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { signedIn: boolean; liked: string[]; disliked: string[] }) => {
        if (!live) return;
        if (!d.signedIn) return setState('signedOut');
        setSeen(new Set([...d.liked, ...d.disliked]));
        setLikedCount(d.liked.length);
        setHasDislikes(d.disliked.length > 0);
        setState('ready');
      })
      .catch(() => live && setState('ready'));
    return () => {
      live = false;
    };
  }, [itemType]);

  const queue = items.filter((i) => !seen.has(i.id));
  const current = queue[0] ?? null;

  const decide = useCallback(
    (reaction: 'like' | 'dislike') => {
      if (!current) return;
      const id = current.id;
      // Move on straight away; save in the background.
      setSeen((s) => new Set(s).add(id));
      setLast({ id, reaction });
      setDrag(0);
      if (reaction === 'like') setLikedCount((n) => n + 1);
      else setHasDislikes(true);
      startTransition(async () => {
        const r = await react(itemType, id, reaction);
        if (r === 'ok') return;
        // Put it back and explain.
        setSeen((s) => {
          const n = new Set(s);
          n.delete(id);
          return n;
        });
        if (reaction === 'like') setLikedCount((n) => n - 1);
        const path = window.location.pathname + window.location.search;
        if (r === 'signin') router.push(`/sign-in?next=${encodeURIComponent(path)}`);
        else if (r === 'confirm') router.push(`/welcome?next=${encodeURIComponent(path)}`);
        else setMessage(r === 'full' ? 'You’ve reached the limit of 5,000 likes and dislikes.' : 'That didn’t save. Try again.');
      });
    },
    [current, itemType, router],
  );

  const undo = () => {
    if (!last) return;
    const { id, reaction } = last;
    setSeen((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    if (reaction === 'like') setLikedCount((n) => n - 1);
    setLast(null);
    startTransition(() => unreact(itemType, id));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (state !== 'ready' || (e.target as HTMLElement)?.closest('input, select, textarea')) return;
      if (e.key === 'ArrowRight') decide('like');
      else if (e.key === 'ArrowLeft') decide('dislike');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [decide, state]);

  if (state === 'loading') return <div className="h-80 animate-pulse border-2 border-ink bg-white" aria-busy="true" />;

  if (state === 'signedOut') {
    const next = typeof window === 'undefined' ? '/' : window.location.pathname + window.location.search;
    return (
      <div className="grid gap-3 border-2 border-ink bg-white p-6">
        <h2 className="display text-2xl">Swipe through {label}</h2>
        <p className="text-slate-700">
          Like or skip {label} one at a time, then shortlist the ones you liked. Sign in so your likes are saved to your
          account.
        </p>
        <Link href={`/sign-in?next=${encodeURIComponent(next)}`} className="w-fit border-2 border-ink bg-volt px-4 py-2 font-bold">
          Sign in to start
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          {queue.length} left on this page · <Link href="/account/liked" className="font-semibold underline">{likedCount} liked</Link>
        </span>
        <span className="flex gap-3">
          {last ? (
            <button type="button" onClick={undo} className="underline">
              Undo
            </button>
          ) : null}
          {hasDislikes ? (
            <button
              type="button"
              className="underline"
              onClick={() =>
                startTransition(async () => {
                  await clearDislikes(itemType);
                  window.location.reload();
                })
              }
            >
              Show skipped again
            </button>
          ) : null}
        </span>
      </div>
      {message ? (
        <p role="alert" className="border-2 border-red-700 bg-white p-2 text-sm text-red-800">
          {message}
        </p>
      ) : null}

      {current ? (
        <article
          key={current.id}
          aria-label={current.title}
          className="relative grid min-h-80 touch-pan-y select-none content-start gap-3 border-2 border-ink bg-white p-6 shadow-hard transition-transform"
          style={{ transform: `translateX(${drag}px) rotate(${drag / 30}deg)` }}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).closest('a, button')) return;
            start.current = e.clientX;
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => start.current !== null && setDrag(e.clientX - start.current)}
          onPointerUp={() => {
            if (start.current === null) return;
            start.current = null;
            if (drag > 110) decide('like');
            else if (drag < -110) decide('dislike');
            else setDrag(0);
          }}
          onPointerCancel={() => {
            start.current = null;
            setDrag(0);
          }}
        >
          {drag > 40 ? <span className="absolute right-4 top-4 rotate-6 border-2 border-ink bg-volt px-2 font-bold">LIKE</span> : null}
          {drag < -40 ? <span className="absolute left-4 top-4 -rotate-6 border-2 border-ink bg-ink px-2 font-bold text-paper">SKIP</span> : null}
          {current.badge ? (
            <span className={`w-fit border-2 px-2 py-0.5 text-sm font-bold ${TONE[current.badge.tone]}`}>{current.badge.text}</span>
          ) : null}
          <h2 className="display text-2xl sm:text-3xl">{current.title}</h2>
          {current.subtitle ? <p className="text-lg font-semibold">{current.subtitle}</p> : null}
          {current.stats?.length ? (
            <div className="border-l-8 border-volt py-1 pl-4">
              <RankStats stats={current.stats} size="lg" />
            </div>
          ) : null}
          {current.chips?.length ? (
            <ul className="flex flex-wrap gap-2 text-sm">
              {current.chips.map((c) => (
                <li key={c} className="border border-ink px-2 py-0.5 font-medium">
                  {c}
                </li>
              ))}
            </ul>
          ) : null}
          {current.note ? <p className="border-l-4 border-cobalt pl-3 text-slate-800">{current.note}</p> : null}
          {current.external ? (
            <a href={current.href} rel="noopener noreferrer nofollow" target="_blank" className="w-fit font-semibold underline">
              More details
            </a>
          ) : (
            <Link href={current.href} className="w-fit font-semibold underline">
              More details
            </Link>
          )}
        </article>
      ) : (
        <div className="grid gap-3 border-2 border-dashed border-ink bg-white p-6">
          <p className="font-semibold">That’s everything on this page.</p>
          <div className="flex flex-wrap gap-3">
            {nextPageHref ? (
              <Link href={nextPageHref} className="border-2 border-ink bg-volt px-4 py-2 font-bold">
                Next page of {label}
              </Link>
            ) : null}
            <Link href="/account/liked" className="border-2 border-ink px-4 py-2 font-bold hover:bg-volt">
              See what you liked
            </Link>
          </div>
        </div>
      )}

      {current ? (
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => decide('dislike')}
            className="border-2 border-ink bg-white py-3 text-lg font-bold hover:bg-ink hover:text-paper"
            aria-label={`Skip ${current.title}`}
          >
            ✕ Skip
          </button>
          <button
            type="button"
            onClick={() => decide('like')}
            className="border-2 border-ink bg-volt py-3 text-lg font-bold shadow-hard-sm hover:-translate-y-0.5"
            aria-label={`Like ${current.title}`}
          >
            ♥ Like
          </button>
        </div>
      ) : null}
      <p className="text-xs text-slate-500">Swipe, use the buttons, or press ← and → on a keyboard. Skipped ones only hide from cards.</p>
    </div>
  );
}

/** List / Cards switch for a results page. */
export function ViewToggle({ listHref, cardsHref, cards }: { listHref: string; cardsHref: string; cards: boolean }) {
  const cls = (on: boolean) => `px-3 py-1 font-semibold ${on ? 'bg-ink text-volt' : 'hover:bg-volt'}`;
  return (
    <nav aria-label="View" className="flex w-fit border-2 border-ink text-sm">
      <Link href={listHref} className={cls(!cards)} aria-current={!cards ? 'page' : undefined}>
        List
      </Link>
      <Link href={cardsHref} className={cls(cards)} aria-current={cards ? 'page' : undefined}>
        Cards
      </Link>
    </nav>
  );
}
