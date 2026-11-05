import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireUser, sessionDb } from '@/lib/auth/session';
import { referenceData } from '@/lib/data';
import { PATTERNS, PROFILE_COLUMNS, TRAVEL_KM, TRAVEL_MODES, collegeOptions, type Profile } from '@/lib/profile';
import { ENGLAND_REGION_LABELS, DEFAULT_WEIGHTS, type EnglandRegion } from '@/types/domain';
import { saveProfile } from './actions';

export const metadata: Metadata = { title: 'Your profile' };

type Props = { searchParams: Promise<Record<string, string | undefined>> };

const ERRORS: Record<string, string> = {
  route: 'Pick a T Level from the list.',
  spec: 'That specialism isn’t part of the T Level you picked.',
  postcode: 'We couldn’t find that postcode. Try just the first half, like MK45.',
  dates: 'Check the placement dates: the end date must be after the start date.',
  weights: 'At least one of “what matters most” needs to be above zero.',
  save: 'We couldn’t save your profile just now. Try again.',
};

const input = 'rounded-md border border-slate-300 bg-white px-3 py-2';

export default async function ProfilePage({ searchParams }: Props) {
  const p = await searchParams;
  const { user, ageConfirmed } = await requireUser('/account/profile');
  if (!ageConfirmed) redirect('/welcome?next=/account/profile');
  const db = await sessionDb();
  const [{ data }, ref, colleges] = await Promise.all([
    db.from('profiles').select(PROFILE_COLUMNS).eq('user_id', user.id).single(),
    referenceData(),
    collegeOptions(),
  ]);
  const pr = data as Profile;
  const w = { ...DEFAULT_WEIGHTS, ...pr.weights };
  const byRegion = new Map<string, typeof colleges>();
  for (const c of colleges) {
    const k = c.region ? ENGLAND_REGION_LABELS[c.region as EnglandRegion] : 'Other';
    byRegion.set(k, [...(byRegion.get(k) ?? []), c]);
  }

  return (
    <div className="grid max-w-2xl gap-6">
      <header className="grid gap-1">
        <p className="text-sm"><Link href="/account" className="text-brand-700 underline">Your account</Link></p>
        <h1 className="display text-3xl sm:text-4xl">Your profile</h1>
        <p className="text-sm text-slate-600">
          Everything here is optional and only you can see it. It sets up your searches and, later, helps draft
          messages to employers.
        </p>
      </header>
      {p.error && ERRORS[p.error] ? (
        <p role="alert" className="border-2 border-red-700 bg-white p-3 text-sm font-medium text-red-800">{ERRORS[p.error]}</p>
      ) : null}

      <form action={saveProfile} className="grid gap-6">
        <Fieldset legend="Your T Level">
          <Field label="T Level">
            <select name="route" defaultValue={pr.route_id ?? ''} className={input}>
              <option value="">Not chosen yet</option>
              {ref.routes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <Field label="Occupational specialism">
            <select name="spec" defaultValue={pr.specialism ?? ''} className={input}>
              <option value="">Not sure yet</option>
              {ref.routes.map((r) => (
                <optgroup key={r.id} label={r.name}>
                  {r.specialisms.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>
          <Field label="College">
            <select name="college" defaultValue={pr.college_id ?? ''} className={input}>
              <option value="">Prefer not to say</option>
              {[...byRegion.entries()].map(([region, list]) => (
                <optgroup key={region} label={region}>
                  {list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>
        </Fieldset>

        <Fieldset legend="Getting there">
          <Field label="Your postcode" hint={`We only keep the first half${pr.home_outcode ? ` (now ${pr.home_outcode})` : ', e.g. MK45'}.`}>
            <input name="postcode" defaultValue={pr.home_outcode ?? ''} maxLength={9} autoComplete="postal-code" className={input} />
          </Field>
          <Field label="How far will you travel?">
            <select name="km" defaultValue={String(Math.round(Number(pr.max_travel_km) || 25))} className={input}>
              {TRAVEL_KM.map((t) => <option key={t.km} value={t.km}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="How will you get there?">
            <select name="travel" defaultValue={pr.travel_mode ?? ''} className={input}>
              <option value="">Not sure yet</option>
              {TRAVEL_MODES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Field>
        </Fieldset>

        <Fieldset legend="Your placement">
          <Field label="Pattern">
            <select name="pattern" defaultValue={pr.placement_pattern ?? ''} className={input}>
              <option value="">Not sure yet</option>
              {PATTERNS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts"><input type="date" name="starts" defaultValue={pr.placement_starts_on ?? ''} className={input} /></Field>
            <Field label="Ends"><input type="date" name="ends" defaultValue={pr.placement_ends_on ?? ''} className={input} /></Field>
          </div>
        </Fieldset>

        <Fieldset legend="What matters most to you">
          {([
            ['wr', 'A route onward (apprenticeship, job)', w.route_onward],
            ['ws', 'Fits my specialism', w.specialism_fit],
            ['wp', 'Practicalities (distance, takes students)', w.practicalities],
            ['wb', 'Size and reputation', w.brand],
          ] as const).map(([name, label, value]) => (
            <Field key={name} label={label}>
              <input type="range" name={name} min={0} max={100} step={5} defaultValue={value} className="accent-brand-600" />
            </Field>
          ))}
        </Fieldset>

        <Fieldset legend="About you (for drafting messages later)">
          <Field label="Interests" hint="Separate with commas, e.g. robotics, renewable energy. Up to 10.">
            <input name="interests" defaultValue={pr.interests.join(', ')} maxLength={500} className={input} />
          </Field>
          <Field label="Skills" hint="Separate with commas, e.g. soldering, CAD, Python. Up to 20.">
            <input name="skills" defaultValue={pr.skills.join(', ')} maxLength={800} className={input} />
          </Field>
          <Field label="A few lines about you" hint="Up to 1,000 characters. Don’t include your address, phone number or date of birth.">
            <textarea name="about" defaultValue={pr.about ?? ''} maxLength={1000} rows={4} className={input} />
          </Field>
        </Fieldset>

        <div className="flex gap-3">
          <button type="submit" className="border-2 border-ink bg-ink px-4 py-2 font-bold text-volt hover:bg-volt hover:text-ink">Save profile</button>
          <Link href="/account" className="rounded-md px-4 py-2 text-brand-700 underline">Cancel</Link>
        </div>
      </form>
    </div>
  );
}

function Fieldset({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-3 border-2 border-ink bg-white p-4 shadow-hard-sm">
      <legend className="display bg-ink px-2 py-1 text-sm text-volt">{legend}</legend>
      {children}
    </fieldset>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}
