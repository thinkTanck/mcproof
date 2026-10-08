import type { Metadata } from 'next';
import { SectionLabel } from '@/components/hud';
import { CoverageLegend } from '@/components/threats/CoverageLegend';
import { CoverageIcon } from '@/components/threats/CoverageIcon';
import { ThreatEntry } from '@/components/threats/ThreatEntry';
import { THREATS } from '@/components/threats/threat-data';
import { getDataSource } from '@/data/source';

export const metadata: Metadata = {
  title: 'Threat Model / Coverage · MCProof',
  description:
    'All ten OWASP Agentic categories, stated plainly. Seven are observable inside a single run, so we test them. Three complete where our trace cannot see, so we say so.',
};

/**
 * /threats — Threat Model / Coverage. An honest, editorial reference across all
 * ten OWASP Agentic categories: seven COVERED (the Core-7) and three NOT
 * MEASURABLE under the current contract. Register: PRODUCT, editorial — the
 * explanations are READING roles; codes, labels, and chips are INSTRUMENT.
 */
export default async function ThreatsPage() {
  // category id -> its own sample run id, from the sample library (never a
  // literal), the same server-derive the homepage uses. Each covered row's
  // "watch" button opens ITS OWN category's run, not the featured one; a missing
  // id falls back to the featured sample alias.
  const runs = await getDataSource().listRuns();
  const runIdByCategory = Object.fromEntries(runs.map((r) => [r.category, r.runId]));
  const sampleHref = (code: string) =>
    runIdByCategory[code] ? `/runs/${runIdByCategory[code]}` : '/runs/sample';

  return (
    <div className="type-flow mx-auto max-w-[1440px] px-6 py-12">
      <SectionLabel>Threat Model · Coverage</SectionLabel>

      <h1 className="reading-h1 mt-3 max-w-[20ch]">What we test. And what we honestly can’t.</h1>

      <p className="reading-lead measure mt-5">
        All ten OWASP Agentic categories, stated plainly. Seven are observable inside a single run,
        so we test them. Three complete somewhere our trace cannot see, so we say so rather than
        fake a verdict.
      </p>

      {/* The measurability bar — the rule the whole board is judged against.
          Anchored so the not-measurable rows can link back to the definition (ADR-0003). */}
      <div
        id="measurability"
        className="mt-8 flex scroll-mt-24 items-start gap-3 rounded-lg border border-line-em bg-nominal/5 px-5 py-4"
      >
        <span className="mt-0.5 text-nominal">
          <CoverageIcon kind="covered" size={16} />
        </span>
        <p className="reading measure">
          A category is <span className="text-readout">testable</span> only if the compromise is
          observable in the agent’s own steps, inside one bounded run, with a crisp{' '}
          <span className="font-mono text-nominal">compromised at step N, or not</span>.
        </p>
      </div>

      <div className="mt-6">
        <CoverageLegend />
      </div>

      {/* The coverage board — all ten categories, in OWASP order. */}
      <div className="mt-6 border-t border-line">
        {THREATS.map((threat) => (
          <ThreatEntry key={threat.code} threat={threat} sampleHref={sampleHref(threat.code)} />
        ))}
      </div>

      <footer className="instrument-faint mt-6 max-w-[760px] border-t border-line pt-4 leading-relaxed">
        Category codes and titles © OWASP GenAI Security Project, Top 10 for Agentic Applications
        (CC BY-SA 4.0). The explanations above are our own.{' '}
        <a
          href="https://genai.owasp.org"
          target="_blank"
          rel="noopener noreferrer"
          className="text-nominal underline underline-offset-2"
        >
          genai.owasp.org →
        </a>
      </footer>
    </div>
  );
}
