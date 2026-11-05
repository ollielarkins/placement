'use client';

import { useState } from 'react';

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          /* clipboard blocked: the student can still select the text */
        }
      }}
      className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50"
    >
      {done ? 'Copied' : 'Copy message'}
    </button>
  );
}
