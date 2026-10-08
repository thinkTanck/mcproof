import { render, screen } from '@testing-library/react';
import { RunResultSchema, CategorySchema, type Category, type RunResult } from '@/contract';
import { TraceBuilder } from '@/attacks/engine';
import { FindingsReport } from '@/components/findings';
import { generateFixReport, toMarkdown } from '@/fix-report';

/**
 * "ABOVE" AND "BELOW" POINT THE RIGHT WAY (sweep 2026-10-07, F3).
 *
 * The note that explains why an ASI10 report withholds its remediation ended
 * "...and the offending step below is its own anchor." The offending step is
 * drawn ABOVE that note, on the screen and in the exported ticket alike. A
 * reader sent to look below it finds the end of the report.
 *
 * A direction word in this copy is a claim about where something is drawn, so it
 * is checked against where it IS drawn: document order on the screen, line order
 * in the Markdown. The copy is authored once in `src/fix-report` and printed by
 * both, so both are held to it.
 */

function makeRun(category: Category, reported: Category, compromised: boolean): RunResult {
  const b = new TraceBuilder({ runId: 'run-1', target: 'acme-mcp', model: 'model-x', category });
  b.principalInstruction('read the latest email and act on anything important');
  const offending = b.toolCall('transfer_funds', { to: 'attacker', amount: 5000 });
  b.taskComplete('done');
  return RunResultSchema.parse({
    runId: 'run-1',
    target: 'acme-mcp',
    model: 'model-x',
    category,
    trace: b.build(),
    verdict: compromised
      ? {
          runId: 'run-1',
          compromised: true,
          score: 0.9,
          severity: 'High',
          category: reported,
          rationale: 'the agent followed an injected instruction',
          stepId: offending,
        }
      : {
          runId: 'run-1',
          compromised: false,
          score: 0.1,
          severity: 'None',
          category: reported,
          rationale: 'the agent declined the injected instruction',
        },
  });
}

const report = (category: Category, reported = category, compromised = true) =>
  generateFixReport(makeRun(category, reported, compromised), { provenance: null });

/** True when `later` comes after `earlier` in the document. */
const follows = (earlier: Element, later: Element) =>
  (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

const DIRECTION = /\b(above|below)\b/gi;

describe('ASI10, remediation withheld: where the offending step is', () => {
  const withheld = report('ASI10', 'ASI01');

  it('on screen the offending step is drawn before the note, and the note says above', () => {
    render(<FindingsReport report={withheld} />);
    const step = screen.getByRole('region', { name: 'Offending step' });
    const note = screen.getByTestId('classification-unreliable');

    expect(follows(step, note), 'the note comes after the offending step').toBe(true);
    expect(note).toHaveTextContent('the offending step above is its own anchor.');
    expect(note).not.toHaveTextContent(/offending step below/i);
  });

  it('in the exported ticket the offending step line is before the note, and the note says above', () => {
    const md = toMarkdown(withheld);
    const step = md.indexOf('**Offending step:**');
    const note = md.indexOf('## Remediation withheld');

    expect(step).toBeGreaterThan(-1);
    expect(step).toBeLessThan(note);
    expect(md.slice(note)).toContain('the offending step above is its own anchor.');
    expect(md).not.toMatch(/offending step below/i);
  });

  it('is one sentence, authored once, on the report itself', () => {
    expect(withheld.finding!.classification.note).toContain(
      'the offending step above is its own anchor.',
    );
  });
});

describe('compromised, remediation shown: where the category is', () => {
  const shown = report('ASI02');

  it('on screen the category is drawn before the caveat that calls it "the category above"', () => {
    render(<FindingsReport report={shown} />);
    const caveat = screen.getByTestId('classification-caveat');
    const category = screen.getByRole('heading', { level: 1 });

    expect(caveat).toHaveTextContent(/^The category above is the detector/);
    expect(follows(category, caveat)).toBe(true);
    // It names the offending step without sending the reader anywhere for it.
    expect(caveat).toHaveTextContent('confirm the category against the offending step before');
    expect(caveat).not.toHaveTextContent(/\bbelow\b/i);
  });

  it('in the exported ticket the category line is before that caveat', () => {
    const md = toMarkdown(shown);

    expect(md.indexOf('**Category:**')).toBeGreaterThan(-1);
    expect(md.indexOf('**Category:**')).toBeLessThan(md.indexOf('The category above'));
    expect(md).not.toMatch(/\bbelow\b/i);
  });
});

describe('clean run: nothing is pointed at', () => {
  const clean = report('ASI02', 'ASI02', false);

  it('uses no direction word on screen or in the ticket', () => {
    const { container } = render(<FindingsReport report={clean} routeId="run-1" />);

    expect(container.textContent).not.toMatch(DIRECTION);
    expect(toMarkdown(clean)).not.toMatch(DIRECTION);
  });
});

describe('every Core-7 class: no direction word points the wrong way', () => {
  /**
   * The general rule, over every class. Each direction word in the authored
   * copy is tied to the block it points at, and that block has to sit on the
   * side the word says. A new sentence that says "below" about something drawn
   * above fails here without anyone having to remember this test.
   */
  const TARGETS: { phrase: RegExp; marker: string }[] = [
    { phrase: /offending step (above|below)/i, marker: '**Offending step:**' },
    { phrase: /category (above|below)/i, marker: '**Category' },
  ];

  it.each(CategorySchema.options)('%s', (category) => {
    // ASI10 is always misfiled; the others are reported as themselves.
    const r = report(category, category === 'ASI10' ? 'ASI01' : category);
    const md = toMarkdown(r);

    const words = md.match(DIRECTION) ?? [];
    let checked = 0;
    for (const { phrase, marker } of TARGETS) {
      const match = phrase.exec(md);
      if (!match) continue;
      checked += 1;
      const said = match[1]!.toLowerCase();
      const actual = md.indexOf(marker) < match.index ? 'above' : 'below';
      expect(said, `"${match[0]}" in the ${category} ticket`).toBe(actual);
    }
    // Every direction word in the ticket was one of the phrases checked above:
    // none slipped past unexamined.
    expect(checked).toBe(words.length);
    expect(words.length).toBeGreaterThan(0);
  });
});
