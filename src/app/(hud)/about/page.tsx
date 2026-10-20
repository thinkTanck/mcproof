import type { Metadata } from 'next';
import { ManTerminal } from '@/components/about/ManTerminal';
import { Roadmap } from '@/components/about/Roadmap';
import { ROADMAP_NOTE } from '@/lib/about/copy';

export const metadata: Metadata = {
  title: 'About · MCProof',
  description: 'Who built MCProof and why, what Sentinel is, and what is planned next.',
};

/**
 * ABOUT (route `/about`, register: BRAND; owner rulings 2026-10-18, ABOUT
 * REVISION 2026-10-19 and ABOUT FINAL 2026-10-20). In order:
 *
 *  1. one terminal, played on load: `man sentinel` printing the man page whose
 *     description is the one definition the /threats glossary prints too, then
 *     `whoami` printing the name and the bio, then a fresh prompt;
 *  2. "What's next": the roadmap board.
 *
 * The h1 is "About", visually hidden; there is no visible label above the
 * terminal and no heading over the man page. The page has no outbound link.
 *
 * A Server Component. The motion is two small client islands (the terminal and
 * the roadmap reveal) and CSS; every word is in the server's HTML.
 */
export default function AboutPage() {
  return (
    <article className="type-flow mx-auto max-w-[1100px] px-6 py-10 sm:py-12">
      <h1 className="sr-only">About</h1>

      <div className="max-w-[760px]">
        <ManTerminal />
      </div>

      <section aria-labelledby="whats-next" className="mt-12">
        <h2 id="whats-next" className="reading-h2">
          What&apos;s next
        </h2>
        <p className="reading measure mt-2 text-ink-muted">{ROADMAP_NOTE}</p>
        <Roadmap />
      </section>
    </article>
  );
}
