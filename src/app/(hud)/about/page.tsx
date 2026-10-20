import type { Metadata } from 'next';
import { SectionLabel } from '@/components/hud';
import { AboutTerminals } from '@/components/about/AboutTerminals';
import { Roadmap } from '@/components/about/Roadmap';
import { ROADMAP_NOTE } from '@/lib/about/copy';

export const metadata: Metadata = {
  title: 'About · MCProof',
  description: 'Who built MCProof and why, what Sentinel is, and what is planned next.',
};

/**
 * ABOUT (route `/about`, register: BRAND; owner rulings 2026-10-18 and ABOUT
 * REVISION, 2026-10-19). In order:
 *
 *  1. a `whoami` terminal that prints the bio, streaming on load;
 *  2. "Why \"Sentinel\"": a `man sentinel` terminal printing the one
 *     definition the /threats glossary prints too, streaming when scrolled to;
 *  3. "What's next": the roadmap board.
 *
 * The h1 is "About", visually hidden: the visible name heading, the Agentrifi
 * line, the LinkedIn link and the career line were removed (19:09, 19:12), so
 * the page has no outbound link. The visible "About" label is hidden from
 * assistive technology, so the word is not read twice.
 *
 * A Server Component. The motion is two small client islands (the terminals
 * and the roadmap reveal) and CSS; every word is in the server's HTML.
 */
export default function AboutPage() {
  return (
    <article className="type-flow mx-auto max-w-[1100px] px-6 py-10 sm:py-12">
      <h1 className="sr-only">About</h1>
      <div aria-hidden="true">
        <SectionLabel>About</SectionLabel>
      </div>

      <AboutTerminals />

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
