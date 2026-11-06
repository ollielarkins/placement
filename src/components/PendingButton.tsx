'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A submit button that shows it's been pressed straight away ("Searching…"
 * and a spinner) while the next page loads. Works with plain forms and
 * next/form. resetKey: anything that changes when the results arrive (the
 * current search), so the button goes back to normal.
 */
export function PendingButton({
  children,
  pendingText = 'Loading…',
  className = '',
  resetKey,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  resetKey?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const on = () => setPending(true);
    form.addEventListener('submit', on);
    // Back button restores the page from cache: don't show it still loading.
    const off = () => setPending(false);
    window.addEventListener('pageshow', off);
    return () => {
      form.removeEventListener('submit', on);
      window.removeEventListener('pageshow', off);
    };
  }, []);

  useEffect(() => setPending(false), [resetKey]);

  // Never stay stuck if a navigation fails.
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(false), 20_000);
    return () => clearTimeout(t);
  }, [pending]);

  return (
    <button ref={ref} type="submit" aria-busy={pending} className={`${className} ${pending ? 'cursor-wait opacity-80' : ''}`}>
      {pending ? (
        <span className="inline-flex items-center justify-center gap-2">
          <span aria-hidden className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {pendingText}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
