import type { Metadata } from 'next';
import { PRIVACY_NOTICE_VERSION } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Privacy notice' };

// Plain-English notice written for 16-18 year olds (ICO Children's Code,
// standard 4: transparency). DRAFT: the items marked "to confirm" need a
// decision (and ideally a legal check) before public launch.
export default function PrivacyPage() {
  return (
    <article className="prose-sm grid max-w-2xl gap-4 text-slate-800">
      <header className="grid gap-1">
        <h1 className="display text-3xl sm:text-4xl">Privacy notice</h1>
        <p className="text-sm text-slate-600">Version {PRIVACY_NOTICE_VERSION}. Draft: being reviewed before launch.</p>
      </header>

      <Section title="The short version">
        <ul className="list-disc pl-5">
          <li>You can search, use the map and read company pages without an account. We don’t store anything about you when you do.</li>
          <li>If you make an account, we keep your email address and what you choose to add. Nothing else.</li>
          <li>We never ask for your date of birth or full postcode, and you never get a public profile.</li>
          <li>We never contact employers for you or share your details with them.</li>
          <li>You can delete your account and everything in it at any time, from your account page.</li>
        </ul>
      </Section>

      <Section title="Who we are">
        <p>
          T Level Pathways is run by Oliver Larkins. Contact:{' '}
          <a className="text-brand-700 underline" href="mailto:studentenquiries.oliverlarkins@gmail.com">studentenquiries.oliverlarkins@gmail.com</a>.
        </p>
      </Section>

      <Section title="Without an account">
        <p>
          If you type a postcode, it’s cut to its first half (for example MK45) straight away and used only to work out
          distances. The full postcode is never stored, logged or put in a web address. Only that first half is sent to
          postcodes.io to find the area’s centre point.
        </p>
        <p>We don’t use advertising or tracking cookies.</p>
      </Section>

      <Section title="With an account">
        <p>We keep:</p>
        <ul className="list-disc pl-5">
          <li>your email address and how you signed in (email link or Google). If you use Google, Google also shares the name and profile picture on your Google account; we don’t show or use them;</li>
          <li>when you confirmed you’re 16 or over, and which version of this notice you saw;</li>
          <li>anything you add later: your T Level and specialism, your college, the first half of your postcode, how far you’ll travel, target companies, your shortlist of employers and university courses with its notes, and what you like or skip in card mode.</li>
        </ul>
        <p>Your account uses cookies that keep you signed in. They’re needed for sign-in to work and aren’t used for anything else.</p>
        <p>We’ll update this notice before adding anything new.</p>
      </Section>

      <Section title="Help drafting messages">
        <p>
          If you ask for a draft message to an employer, we send Claude (an AI made by Anthropic) only what the message
          needs: your T Level, specialism, college, placement dates and pattern, interests, skills and your “about you”
          text, plus what we know about the company. Never your email address, name or postcode. Anthropic processes it
          in the USA to write the draft and does not use it to train its models. [Transfer safeguard for the USA: to
          confirm before launch.] The draft is saved to your account until you delete it. You send any message
          yourself.
        </p>
      </Section>

      <Section title="Who handles the data for us">
        <ul className="list-disc pl-5">
          <li>Supabase: our database and sign-in, stored in Frankfurt, Germany (EU).</li>
          <li>Vercel: hosts the website; the server code runs in Frankfurt.</li>
          <li>Google: only if you choose “Continue with Google”.</li>
          <li>Mapbox: draws the map. Your browser loads map images from Mapbox directly.</li>
          <li>postcodes.io: receives only the first half of a postcode.</li>
          <li>Anthropic: writes draft messages, only when you ask for one (see above).</li>
        </ul>
      </Section>

      <Section title="Why, and for how long">
        <p>
          We use your details only to run your account: saving your shortlist and ranking employers for you. Lawful
          basis: [to confirm before launch]. We keep your account until you delete it. [Policy for accounts that
          haven’t been used for a long time: to confirm before launch.]
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          You can see, correct or delete your data. Deleting your account (on your account page) removes it straight
          away. For anything else, email us. If you’re unhappy with how we’ve handled your data, you can complain to
          the Information Commissioner’s Office at ico.org.uk.
        </p>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2 border-2 border-ink bg-white p-4">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}
