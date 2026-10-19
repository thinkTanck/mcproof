import type { Metadata } from 'next';
import { SectionLabel } from '@/components/hud';
import { TerminalCard } from '@/components/about/TerminalCard';
import { CareerLine } from '@/components/about/CareerLine';
import { Roadmap } from '@/components/about/Roadmap';
import {
  ABOUT_AGENTRIFI_LINE,
  ABOUT_BIO,
  ABOUT_HEADING,
  ABOUT_LINKEDIN_HREF,
  ABOUT_WHOAMI,
  ROADMAP_NOTE,
} from '@/lib/about/copy';
import { SENTINEL_DEFINITION } from '@/lib/replay/roles';

export const metadata: Metadata = {
  title: 'About · MCProof',
  description: 'Who built MCProof and why, what Sentinel is, and what is planned next.',
};

/**
 * ABOUT (route `/about`, register: BRAND; owner rulings 2026-10-18, plan in
 * claude/reports/about-plan.md). Four parts, in order:
 *
 *  1. "Built by Dameion Ayers": a `whoami` terminal that prints the bio, then
 *     the Agentrifi line and the one link, LinkedIn. No Contact link until an
 *     Agentrifi address exists, no GitHub link, no handle or alias, no photo.
 *  2. "Why \"Sentinel\"": a `man sentinel` terminal printing the one
 *     definition the /threats glossary prints too.
 *  3. The career signal line, through four labelled nodes.
 *  4. "What's next": the roadmap board the line runs into.
 *
 * A Server Component. The motion is two small client islands (the terminals
 * and the reveal) and CSS; every word is in the server's HTML.
 */
export default function AboutPage() {
  return (
    <article className="type-flow mx-auto max-w-[1100px] px-6 py-10 sm:py-12">
      <SectionLabel>About</SectionLabel>
      <h1 className="reading-h1 mt-3">{ABOUT_HEADING}</h1>

      <div className="mt-6 max-w-[760px]">
        <TerminalCard
          id="whoami"
          label="whoami"
          command="whoami"
          lines={[
            { kind: 'out', text: ABOUT_WHOAMI },
            { kind: 'out', text: ABOUT_BIO },
          ]}
        />
      </div>
      <p className="reading measure mt-4 text-ink">{ABOUT_AGENTRIFI_LINE}</p>
      <p className="mt-2">
        <a
          href={ABOUT_LINKEDIN_HREF}
          className="reading target-min inline-flex items-center text-ink underline underline-offset-4"
        >
          LinkedIn
        </a>
      </p>

      <section aria-labelledby="why-sentinel" className="mt-12">
        <h2 id="why-sentinel" className="reading-h2">
          Why &quot;Sentinel&quot;
        </h2>
        <div className="mt-4 max-w-[760px]">
          <TerminalCard
            id="sentinel"
            label="man sentinel"
            command="man sentinel"
            lines={[{ kind: 'out', text: SENTINEL_DEFINITION }]}
          />
        </div>
      </section>

      <CareerLine />

      <section aria-labelledby="whats-next">
        <h2 id="whats-next" className="reading-h2">
          What&apos;s next
        </h2>
        <p className="reading measure mt-2 text-ink-muted">{ROADMAP_NOTE}</p>
        <Roadmap />
      </section>
    </article>
  );
}
