'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { saveCompany } from '@/app/account/shortlist/actions';
import { saveCourse } from '@/app/account/shortlist/course-actions';

type State = 'idle' | 'saved' | 'full' | 'error';

/** "Save to shortlist". Works on cached public pages: status is fetched per student in the browser. */
export function SaveButton({ companyId, compact = false }: { companyId: string; compact?: boolean }) {
  return <SaveToggle id={companyId} kind="company" compact={compact} />;
}

/** "Save course" on the Universities pages. */
export function SaveCourseButton({ courseId, compact = false }: { courseId: string; compact?: boolean }) {
  return <SaveToggle id={courseId} kind="course" compact={compact} />;
}

function SaveToggle({ id: companyId, kind, compact }: { id: string; kind: 'company' | 'course'; compact: boolean }) {
  const [state, setState] = useState<State>('idle');
  const [pending, start] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (!document.cookie.includes('sb-')) return; // signed out: nothing to check
    let live = true;
    fetch(`/api/${kind === 'course' ? 'courses' : 'shortlist'}/status?ids=${companyId}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { saved: string[] }) => live && d.saved.includes(companyId) && setState('saved'))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [companyId, kind]);

  if (state === 'saved') {
    return (
      <Link href={kind === 'course' ? '/account/shortlist#courses' : '/account/shortlist'} className={`${compact ? 'text-xs' : 'text-sm'} bg-volt px-2 py-0.5 font-bold text-ink`}>
        ✓ On your shortlist
      </Link>
    );
  }

  const onClick = () =>
    start(async () => {
      const r = kind === 'course' ? await saveCourse(companyId) : await saveCompany(companyId);
      // Back to exactly this page (search filters included) after signing in.
      const path = window.location.pathname + window.location.search;
      if (r === 'saved' || r === 'already') setState('saved');
      else if (r === 'signin') router.push(`/sign-in?next=${encodeURIComponent(path)}`);
      else if (r === 'confirm') router.push(`/welcome?next=${encodeURIComponent(path)}`);
      else setState(r);
    });

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className={`border-2 border-ink font-bold hover:bg-volt disabled:opacity-60 ${
          compact ? 'px-2 py-0.5 text-xs' : 'px-3 py-1.5 text-sm'
        }`}
      >
        {pending ? 'Saving…' : kind === 'course' ? 'Save course' : 'Save to shortlist'}
      </button>
      {state === 'full' ? <span className="text-xs text-red-700">Your shortlist is full ({kind === 'course' ? 100 : 300}).</span> : null}
      {state === 'error' ? <span className="text-xs text-red-700">Couldn’t save. Try again.</span> : null}
    </span>
  );
}
