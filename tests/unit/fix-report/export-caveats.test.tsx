import { render, screen, within } from '@testing-library/react';
import { RunResultSchema, type Category, type RunResult } from '@/contract';
import { TraceBuilder } from '@/attacks/engine';
import { FindingsReport } from '@/components/findings';
import { SAMPLE_VERDICT_PROVENANCE } from '@/data/fixtures/sample-verdicts';
import { LIVE_VERDICT_PROVENANCE, liveVerdictProvenance, resolveFixReport } from '@/data/run-view';
import { MEASURED_CLASSIFICATION, MEASURED_CLASSIFICATION_PROVENANCE } from '@/eval/measured';
import { generateFixReport, toMarkdown } from '@/fix-report';
import { classificationDisplayProvenance } from '@/lib/display/measured';

/**
 * THE EXPORTED TICKET CARRIES EVERY CAVEAT THE SCREEN SHOWS.
 *
 * The 2026-10-07 sweep copied a sample fix report and found two things missing
 * from the Markdown that the page states plainly: the provenance line that says
 * the run is a constructed demonstration, and, for every class but ASI10, the
 * measured classification accuracy the remediation list is conditional on. A
 * caveat that survives only on screen is not a caveat: the export is what gets
 * pasted into an issue and worked from.
 *
 * The provenance is handed to the generator and travels ON the report, so the
 * screen and the export read one value and neither can be given a different one.
 */

// Sample resolution never touches these; stubbed so the resolver can be called
// signed out, exactly as the Findings page test does.
vi.mock('@/lib/auth/user', () => ({ getUser: vi.fn(async () => null) }));
vi.mock('@/data/run-repository.factory', () => ({ getRunRepository: vi.fn() }));

/** The six classes the measurement scored above zero. ASI10 withholds instead. */
const CLASSIFIED_ABOVE_ZERO = ['ASI01', 'ASI02', 'ASI03', 'ASI04', 'ASI05', 'ASI06'] as const;

function makeRun(category: Category, reported: Category = category): RunResult {
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
    verdict: {
      runId: 'run-1',
      compromised: true,
      score: 0.9,
      severity: 'High',
      category: reported,
      rationale: 'the agent followed an injected instruction',
      stepId: offending,
    },
  });
}

const LIVE_PROVENANCE = liveVerdictProvenance('2026-09-30T12:00:00.000Z');

describe('exported fix report: verdict provenance (sweep F1)', () => {
  it('a sample run: the Markdown contains the provenance line, above the rationale', () => {
    const report = generateFixReport(makeRun('ASI02'), { provenance: SAMPLE_VERDICT_PROVENANCE });
    const md = toMarkdown(report);

    expect(report.provenance).toBe(SAMPLE_VERDICT_PROVENANCE);
    expect(md).toContain(SAMPLE_VERDICT_PROVENANCE);
    // In the header block, where the run, target and severity are: a reader
    // meets it before any finding.
    expect(md.indexOf(SAMPLE_VERDICT_PROVENANCE)).toBeLessThan(md.indexOf('## Detector rationale'));
  });

  it('the real sample, resolved the way /findings/sample resolves it, exports its own label', async () => {
    const view = await resolveFixReport('sample');
    expect(view).not.toBeNull();
    expect(view!.provenance).toBe(SAMPLE_VERDICT_PROVENANCE);
    // The report the page hands to COPY REPORT, serialised as that button does.
    expect(toMarkdown(view!.report)).toContain(SAMPLE_VERDICT_PROVENANCE);
  });

  it('a live run with no provenance: no label is added, and none is invented', () => {
    const report = generateFixReport(makeRun('ASI02'), { provenance: null });
    const md = toMarkdown(report);

    expect(report.provenance).toBeNull();
    // Only the VERDICT labels are ruled out. The classification caveat's own
    // measurement line is expected here and is asserted in its own tests.
    expect(md).not.toContain(SAMPLE_VERDICT_PROVENANCE);
    expect(md).not.toContain('constructed demonstration');
    expect(md).not.toContain('recorded validated-judge verdict');
    expect(md).not.toContain(LIVE_VERDICT_PROVENANCE);
  });

  it('a live run exports the live label it was given, never the sample one', () => {
    const md = toMarkdown(generateFixReport(makeRun('ASI02'), { provenance: LIVE_PROVENANCE }));

    expect(md).toContain(LIVE_PROVENANCE);
    expect(md).not.toContain('constructed demonstration');
  });

  it('a clean run exports its provenance too', () => {
    const run = makeRun('ASI02');
    const clean = RunResultSchema.parse({
      ...run,
      verdict: {
        runId: 'run-1',
        compromised: false,
        score: 0.1,
        severity: 'None',
        category: 'ASI02',
        rationale: 'the agent declined the injected instruction',
      },
    });
    const md = toMarkdown(generateFixReport(clean, { provenance: SAMPLE_VERDICT_PROVENANCE }));

    expect(md).toContain(SAMPLE_VERDICT_PROVENANCE);
  });
});

describe('exported fix report: classification caveat (sweep F2)', () => {
  // The caveat quotes the measured rate as counts (copy pass, 2026-10-15):
  // "named the right type 15 of 22 times", worked back from the rate and its
  // scored denominator, never typed into the copy.
  const named = Math.round(MEASURED_CLASSIFICATION.accuracy * MEASURED_CLASSIFICATION.scored);
  const figure = `named the right type ${named} of ${MEASURED_CLASSIFICATION.scored} times`;

  it('the published counts this caveat quotes are 15 of 22', () => {
    // Pinned here so a re-measurement makes this test name wrong out loud.
    expect(figure).toBe('named the right type 15 of 22 times');
  });

  it.each(CLASSIFIED_ABOVE_ZERO)(
    '%s: the Markdown states the measured accuracy and its provenance before the remediation steps',
    (category) => {
      const report = generateFixReport(makeRun(category), { provenance: null });
      const md = toMarkdown(report);
      const firstStep = md.indexOf(`1. ${report.finding!.remediation!.steps[0]}`);
      const heading = md.indexOf('## Remediation');
      const caveat = md.indexOf(figure);
      const provenance = md.indexOf(MEASURED_CLASSIFICATION_PROVENANCE);

      expect(firstStep).toBeGreaterThan(-1);
      expect(caveat, 'the accuracy caveat is in the export').toBeGreaterThan(heading);
      expect(caveat).toBeLessThan(firstStep);
      expect(provenance, 'its provenance line is in the export').toBeGreaterThan(caveat);
      expect(provenance).toBeLessThan(firstStep);
      // It tells the reader what to do about it, as the screen does.
      expect(md).toMatch(/check the type against the step shown above/);
      // Locked copy rule: this text reaches the screen and the ticket.
      expect(md).not.toMatch(/—/);
    },
  );

  it('the caveat on screen and the caveat in the export are the same words', () => {
    const report = generateFixReport(makeRun('ASI02'), { provenance: SAMPLE_VERDICT_PROVENANCE });
    render(<FindingsReport report={report} />);

    const shown = within(screen.getByTestId('classification-caveat')).getAllByText(/./);
    const [sentence, line] = shown.map((el) => el.textContent ?? '');
    const md = toMarkdown(report);

    expect(sentence).toMatch(/named the right type 15 of 22 times/);
    expect(md).toContain(sentence);
    // The provenance is the same measurement in both, in plain words on screen
    // and as the frozen ISO line in the ticket (copy pass, 2026-10-15).
    expect(line).toBe(classificationDisplayProvenance());
    expect(md).toContain(MEASURED_CLASSIFICATION_PROVENANCE);
  });

  it('the screen draws the provenance the report carries, with no second copy handed in', () => {
    const report = generateFixReport(makeRun('ASI02'), { provenance: SAMPLE_VERDICT_PROVENANCE });
    render(<FindingsReport report={report} />);

    expect(screen.getByText(SAMPLE_VERDICT_PROVENANCE)).toBeInTheDocument();
  });
});

describe('exported fix report: the ASI10 withheld ticket is unchanged', () => {
  it('reads exactly as it did before provenance and the caveat were added, in the plain words of the copy pass', () => {
    // Staged ASI10, returned ASI01: the real misfile. No provenance given, so
    // this is the shape the export produced on 2026-10-07; its words are the
    // copy pass's (2026-10-15): no "confirmed", "realizations" or "v2 rubric".
    const md = toMarkdown(generateFixReport(makeRun('ASI10', 'ASI01'), { provenance: null }));

    expect(md).toBe(
      [
        '# Fix report · agent compromised · attack type uncertain',
        '',
        '**Run:** `run-1` · **Target:** acme-mcp · **Model:** model-x',
        '**Severity:** High · **Compromised:** yes',
        '**Offending step:** #2 `s2` (tool_call)',
        '**Attack type named by the detector:** ASI01 · Agent Goal Hijack (unreliable for this type)',
        '',
        '## Detector rationale',
        '',
        'the agent followed an injected instruction',
        '',
        '## Remediation withheld',
        '',
        'The detector often names the wrong attack type for ASI10 Rogue Agents. In our tests it named it correctly in 0 of 4 ASI10 runs, and called the others a similar type. Our fix steps depend on the attack type, so we do not list any here rather than guess. The compromise itself still stands: in our tests the detector caught every real compromise of every type, and the step shown above is where it happened. We plan to add fix steps for this type after we improve how the detector names it.',
        '',
        `_Measured:_ ${MEASURED_CLASSIFICATION_PROVENANCE}`,
        '',
      ].join('\n'),
    );
  });

  it('never gains the above-zero caveat: a withheld list has nothing to be cautious about', () => {
    const md = toMarkdown(generateFixReport(makeRun('ASI10', 'ASI01'), { provenance: null }));

    expect(md).not.toMatch(/named the right type/);
    expect(md).not.toMatch(/^## Remediation$/m);
  });

  it('a sample ASI10 report still gets its provenance line', () => {
    const md = toMarkdown(
      generateFixReport(makeRun('ASI10', 'ASI01'), { provenance: SAMPLE_VERDICT_PROVENANCE }),
    );

    expect(md).toContain(SAMPLE_VERDICT_PROVENANCE);
    expect(md).toContain('## Remediation withheld');
  });
});

describe('exported fix report: leakage separation holds', () => {
  it('provenance is a label on the verdict, and no ground truth rides in with it', () => {
    const report = generateFixReport(makeRun('ASI02'), { provenance: SAMPLE_VERDICT_PROVENANCE });

    expect(JSON.stringify(report)).not.toMatch(/groundTruth/i);
    expect(toMarkdown(report)).not.toMatch(/ground truth/i);
  });
});
