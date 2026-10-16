import { render, screen, within } from '@testing-library/react';
import Home from '@/app/(hud)/page';
import { getDataSource } from '@/data/source';
import { CORE7 } from '@/components/home/core7';
import { offendingStepLabel } from '@/lib/hud/trace-view';
import {
  MEASURED_CLASSIFICATION,
  MEASURED_CLASSIFICATION_PROVENANCE,
  MEASURED_COMPROMISE,
  MEASURED_COMPROMISE_PROVENANCE,
} from '@/eval/measured';
import { describeLiveRunAllowance, describeLiveRunAllowanceNote } from '@/runs/allowance';
import { SAMPLE_VERDICT_PROVENANCE } from '@/data/fixtures/sample-verdicts';
import { sampleDisplayProvenance } from '@/lib/display/dates';
import {
  classificationDisplayProvenance,
  compromiseDisplayProvenance,
  measuredCopy,
} from '@/lib/display/measured';

/**
 * Home (BRAND register front door). Asserts the landmarks, the pitch + the
 * measured-detector claim, the Core-7 list, the CTAs, and — the load-bearing
 * invariant — that the run id + step total + compromise step are BOUND to the
 * real sample run, never literals.
 */

// Render the async Server Component to its resolved tree.
async function renderHome() {
  render(await Home());
}

describe('Home — landmarks & pitch', () => {
  it('exposes the hero as a region named by the level-1 pitch headline', async () => {
    await renderHome();
    const h1 = screen.getByRole('heading', {
      level: 1,
      name: 'Test your AI agent against known attacks.',
    });
    expect(h1).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: /test your ai agent against known attacks/i }),
    ).toBeInTheDocument();
  });

  it('labels the headline with what the product is (owner ruling 2026-10-15)', async () => {
    await renderHome();
    const h1 = screen.getByRole('heading', { level: 1 });
    const label = h1.previousElementSibling as HTMLElement | null;
    expect(label?.tagName).toBe('P');
    expect(label?.textContent).toBe('Red-team testing for AI agents that use MCP tools');
    expect(label?.className).toMatch(/\bmicro-label\b/);
  });

  /**
   * The headline says what we DO, never what the reader will find. It used to
   * read "Pwn your MCP agent before an attacker does", which promises a
   * compromise we have no evidence for: nothing measured says how often a real
   * agent takes the bait. `tests/unit/app/framing.test.tsx` holds the general
   * rule across all five screens; this pins the specific sentence that broke it.
   */
  it('does not promise the reader a compromise', async () => {
    await renderHome();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent ?? '').not.toMatch(/before an attacker does/i);
  });

  it('states the measured-detector claim in the pitch', async () => {
    await renderHome();
    // The pitch's claim: the detector was tested before it was published, so a
    // reader can see how often it is right (copy pass 2026-10-15). The unsourced
    // "most tools only guess" is gone.
    expect(
      screen.getByText(
        'We tested the detector before we published it, so you can see how often it is right.',
      ),
    ).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/most tools only/i);
  });

  it('couples the word "measured" to a real figure and its full provenance', async () => {
    await renderHome();
    // THE GUARD. The chip sits directly under the precision/recall numbers, so
    // whatever it says is a claim ABOUT THOSE NUMBERS. It once read "measured ·
    // leakage-separated fixture" while the values were illustrative constants no
    // judge had ever produced, which is the pitch's promise leaking onto the
    // evidence. It later read "illustrative" precisely because no measurement
    // existed yet.
    //
    // Both of those states are now wrong: the figures ARE measured. So the guard
    // inverts rather than relaxes. It no longer asks "is the word absent" — it
    // demands the word AND everything needed to check the claim: how many
    // realizations, how many passes, when, and by which judge. A number that
    // loses any part of its provenance fails here, and so does provenance with
    // no number.
    const chip = screen.getByText(/^measured /);
    // Shape, not a pinned count: the exact denominator is coupled to the real
    // fixture count in tests/unit/eval/measured.test.ts, so it moves when fixtures
    // are added and re-measured. Here we only demand the claim is fully provenanced,
    // in the plain-words form of the frozen line (src/lib/display/measured.ts).
    expect(chip.textContent).toBe(compromiseDisplayProvenance());
    expect(chip.textContent).toMatch(/\d+ test runs/);
    expect(chip.textContent).toMatch(/graded 5 times each/);
    expect(chip.textContent).toMatch(/[A-Z][a-z]{2} \d{1,2}, \d{4} \(UTC\)/);
    expect(chip.textContent).toMatch(/detector claude-haiku-4-5/);
    // The figures themselves must be present and non-zero next to it.
    expect(screen.getByText('0.96')).toBeInTheDocument();
    expect(screen.getByText('1.00')).toBeInTheDocument();
  });

  it('never re-labels the measured figures as illustrative or a fixture', async () => {
    await renderHome();
    // The reverse drift: quietly downgrading the claim while leaving real numbers
    // on screen would be just as untrue as the original overclaim.
    const chip = screen.getByText(/^measured /);
    expect(chip.textContent).not.toMatch(/illustrative/i);
    expect(chip.textContent).not.toMatch(/fixture, not a benchmark/i);
  });
});

describe('Home — category classification is a SECOND, separate measurement', () => {
  it('renders the classification accuracy under its own label, not among the P/R figures', async () => {
    await renderHome();
    // Its own label. The compromise readout is labelled "Catching compromises",
    // for the question it answers; a category accuracy sitting under a shared
    // heading would be read as part of the same number, which is exactly the
    // conflation this screen must not commit.
    const block = screen.getByRole('group', { name: 'Naming the attack type' });
    expect(
      within(block).getByText(MEASURED_CLASSIFICATION.accuracy.toFixed(2)),
    ).toBeInTheDocument();
    // And the P/R figures are NOT inside it.
    expect(within(block).queryByText(/precision/i)).not.toBeInTheDocument();
    expect(within(block).queryByText(/recall/i)).not.toBeInTheDocument();
  });

  it('renders the classification provenance line verbatim, beside its own figure', async () => {
    await renderHome();
    const block = screen.getByRole('group', { name: 'Naming the attack type' });
    // The plain-words form of the frozen line (src/lib/display/measured.ts).
    expect(within(block).getByText(classificationDisplayProvenance())).toBeInTheDocument();
    expect(MEASURED_CLASSIFICATION_PROVENANCE).toMatch(/^category accuracy ·/);
    // The two provenance lines are both present and remain distinct.
    expect(screen.getByText(/^measured /)).toBeInTheDocument();
    expect(screen.getByText(/^attack type measured /)).toBeInTheDocument();
  });

  it('never presents the classification figure as precision or recall', async () => {
    await renderHome();
    const chip = screen.getByText(/^attack type measured /);
    expect(chip.textContent).not.toMatch(/precision|recall/i);
  });
});

describe('Home: the three measured figures share one component (UI audit batch D)', () => {
  it('draws precision, recall and classification accuracy through Metric, each with its meaning', async () => {
    await renderHome();
    const metrics = [...document.querySelectorAll('[data-metric]')];
    expect(metrics.map((m) => m.getAttribute('data-metric'))).toEqual([
      'precision',
      'recall',
      'classification-accuracy',
    ]);
    const value = (id: string) =>
      document.querySelector(`[data-metric="${id}"] [data-metric-value]`)!.textContent;
    expect(value('precision')).toBe(MEASURED_COMPROMISE.precision.toFixed(2));
    expect(value('recall')).toBe(MEASURED_COMPROMISE.recall.toFixed(2));
    expect(value('classification-accuracy')).toBe(MEASURED_CLASSIFICATION.accuracy.toFixed(2));
    // A label (the count behind the figure) and a sentence a reader who has never
    // met the words precision and recall can follow (copy pass 2026-10-15).
    const copy = measuredCopy();
    const part = (id: string, which: string) =>
      document.querySelector(`[data-metric="${id}"] [data-metric-${which}]`)!.textContent;
    expect(part('precision', 'label')).toBe(copy.precisionLabel);
    expect(part('precision', 'meaning')).toBe(copy.precision);
    expect(part('recall', 'label')).toBe(copy.recallLabel);
    expect(part('recall', 'meaning')).toBe(copy.recall);
    expect(part('classification-accuracy', 'label')).toBe(copy.classificationLabel);
    expect(part('classification-accuracy', 'meaning')).toBe(copy.classification);
    for (const metric of metrics) {
      expect(metric.querySelector('[data-metric-label]')!.textContent!.length).toBeGreaterThan(3);
      expect(metric.querySelector('[data-metric-meaning]')!.textContent).toMatch(/^[A-Z].*\.$/);
    }
    // No figure is drawn outside the component at a size of its own.
    const classes = (selector: string) =>
      new Set([...document.querySelectorAll(selector)].map((el) => el.className));
    expect(classes('[data-metric-value]').size).toBe(1);
    expect(classes('[data-metric-label]').size).toBe(1);
    expect(classes('[data-metric-meaning]').size).toBe(1);
  });

  it('never calls the classification figure plain "accuracy"', async () => {
    await renderHome();
    const metric = document.querySelector('[data-metric="classification-accuracy"]')!;
    // Named for what it is, the attack type, and never "accuracy" on its own.
    expect(metric.textContent ?? '').not.toMatch(/accuracy/i);
    expect(metric.querySelector('[data-metric-meaning]')).toHaveTextContent(/right attack type/);
  });

  it('states how five grades per run became one result, and the day in UTC', async () => {
    await renderHome();
    const compromise = screen.getByRole('group', { name: 'Catching compromises' });
    expect(within(compromise).getByText(measuredCopy().intro)).toBeInTheDocument();
    expect(measuredCopy().intro).toMatch(/On Aug 24, 2026 \(UTC\), /);
    expect(measuredCopy().intro).toMatch(/kept the answer it gave most often/);
  });

  it('says the figures test the detector, not how well any agent resists', async () => {
    await renderHome();
    expect(
      screen.getByText(
        'These numbers test our detector on runs we built, not how well any agent resists attacks.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(measuredCopy().condition)).toBeInTheDocument();
  });

  it('draws the two group headings in one colour (owner ruling 2026-10-15)', async () => {
    await renderHome();
    const colour = (id: string) =>
      document
        .getElementById(id)!
        .className.split(/\s+/)
        .filter((c) => /^text-[a-z][a-z-]*$/.test(c));
    const compromise = colour('metric-compromise-label');
    expect(compromise).toHaveLength(1);
    expect(colour('metric-classification-label')).toEqual(compromise);
  });

  it('keeps the two measurements in two groups, each with its own provenance line', async () => {
    await renderHome();
    const compromise = screen.getByRole('group', { name: 'Catching compromises' });
    const classification = screen.getByRole('group', { name: 'Naming the attack type' });
    expect(compromise).not.toBe(classification);
    expect(compromise.contains(classification)).toBe(false);
    expect(classification.contains(compromise)).toBe(false);
    // Number and provenance move together: each group holds its own line.
    expect(within(compromise).getByText(compromiseDisplayProvenance())).toBeInTheDocument();
    expect(within(classification).getByText(classificationDisplayProvenance())).toBeInTheDocument();
    expect(within(compromise).queryByText(classificationDisplayProvenance())).toBeNull();
    expect(within(classification).queryByText(compromiseDisplayProvenance())).toBeNull();
    expect(MEASURED_COMPROMISE_PROVENANCE).not.toBe(MEASURED_CLASSIFICATION_PROVENANCE);
    expect(compromise.querySelectorAll('[data-metric]')).toHaveLength(2);
    expect(classification.querySelectorAll('[data-metric]')).toHaveLength(1);
    // The denominator the classification figure was scored over stays on screen.
    expect(classification).toHaveTextContent(
      new RegExp(`${MEASURED_CLASSIFICATION.scored} compromised test runs`),
    );
  });

  it('puts "Read the full results" after the figures, as the only thing in its block', async () => {
    await renderHome();
    const link = screen.getByRole('link', { name: /^read the full results/i });
    const last = [...document.querySelectorAll('[data-metric]')].at(-1)!;
    expect(last.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // A block of its own: not a link inside a sentence, and not inline.
    expect(link.closest('p')).toBeNull();
    expect(link.className.split(/\s+/)).toContain('flex');
    expect(link.className.split(/\s+/)).toContain('underline');
    // One link to the writeup on the page, not one under the finding and another here.
    expect(document.querySelectorAll('a[href$="RESULTS.md"]')).toHaveLength(1);
  });
});

describe('Home: the free-runs note beside "Connect your agent" (UI audit batch D)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['unset', undefined],
    ['0', '0'],
    ['empty', ''],
    ['not a number', 'lots'],
  ])('is not drawn when LIVE_RUN_ALLOWANCE is %s', async (_name, raw) => {
    if (raw === undefined) delete process.env.LIVE_RUN_ALLOWANCE;
    else vi.stubEnv('LIVE_RUN_ALLOWANCE', raw);
    await renderHome();
    expect(document.querySelector('[data-free-runs-note]')).toBeNull();
    expect(screen.queryByText(/free live run/i)).toBeNull();
  });

  it('is drawn from the configured value, in the block that holds the call to action', async () => {
    vi.stubEnv('LIVE_RUN_ALLOWANCE', '7');
    await renderHome();
    const note = document.querySelector('[data-free-runs-note]')!;
    expect(note).toHaveTextContent(describeLiveRunAllowanceNote({ LIVE_RUN_ALLOWANCE: '7' })!);
    expect(note).toHaveTextContent(describeLiveRunAllowance(7));
    const cta = screen.getByRole('link', { name: 'Connect your agent' });
    // The same block, and after the button: it is read as a note on the action.
    expect(note.parentElement!.contains(cta)).toBe(true);
    expect(cta.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('Home — Core-7 list', () => {
  it('lists all seven Core-7 categories with their pinned ids + titles', async () => {
    await renderHome();
    const nav = screen.getByRole('navigation', { name: /core-7 sample runs/i });
    expect(CORE7).toHaveLength(7);
    for (const c of CORE7) {
      expect(within(nav).getByText(c.id)).toBeInTheDocument();
      expect(within(nav).getByText(c.title)).toBeInTheDocument();
    }
  });

  it('pins the OWASP titles verbatim (and/&/(RCE) spellings)', () => {
    const byId = Object.fromEntries(CORE7.map((c) => [c.id, c.title]));
    expect(byId.ASI02).toBe('Tool Misuse and Exploitation');
    expect(byId.ASI03).toBe('Identity and Privilege Abuse');
    expect(byId.ASI04).toBe('Agentic Supply Chain Vulnerabilities');
    expect(byId.ASI05).toBe('Unexpected Code Execution (RCE)');
    expect(byId.ASI06).toBe('Memory & Context Poisoning');
  });
});

describe('Home — CTAs', () => {
  it('links "Try the sample" (PLAY) to /runs/sample, featuring the ASI02 sample', async () => {
    await renderHome();
    const play = screen.getByRole('link', { name: /play asi02 sample/i });
    expect(play).toHaveAttribute('href', '/runs/sample');
  });

  it('links "Connect your agent" to /connect', async () => {
    await renderHome();
    const connect = screen.getByRole('link', { name: /connect your agent/i });
    expect(connect).toHaveAttribute('href', '/connect');
  });
});

describe('Home — hero micro-replay', () => {
  it('renders the featured trace as a micro-replay in the hero slot', async () => {
    await renderHome();
    // The hero is a live micro-replay of the ASI02 finding, not generic decoration.
    expect(
      screen.getByRole('img', { name: /ASI02 Tool Misuse and Exploitation sample replay/i }),
    ).toBeInTheDocument();
  });

  it('has retired the particle-globe sentinel core from the hero', async () => {
    await renderHome();
    expect(screen.queryByLabelText(/sentinel core/i)).not.toBeInTheDocument();
  });

  it('keeps the Core-7 launcher and its "Tap to watch" cue', async () => {
    await renderHome();
    expect(screen.getByRole('navigation', { name: /core-7 sample runs/i })).toBeInTheDocument();
    expect(screen.getByText(/tap to watch/i)).toBeInTheDocument();
  });
});

describe('Home — the featured ASI02 finding', () => {
  it('shows no measured ASI02 live finding until the fixed trap is re-measured', async () => {
    await renderHome();
    // V1 (2026-10-14): the "5 of 10 / 6 of 10" finding came from a live trap that
    // served the fabricated credential on the task's own first read, so it
    // measured the trap, not the agent. It stays off Home until re-measured.
    expect(screen.queryByText(/measured finding/i)).toBeNull();
    const main = document.body.textContent ?? '';
    expect(main).not.toMatch(/\b[56] of 10\b/);
    expect(main).not.toMatch(/unscoped path/i);
  });

  it('offers a one-click link to the full RESULTS writeup', async () => {
    await renderHome();
    const results = screen.getByRole('link', { name: /^read the full results/i });
    // The words on screen are the start of its name, and the name says where
    // the results are, for a reader who meets the link out of context.
    expect(results).toHaveAccessibleName(/^read the full results on github/i);
    expect(results).toHaveAttribute('data-results-link');
    expect(results).toHaveAttribute(
      'href',
      'https://github.com/thinkTanck/mcproof/blob/main/RESULTS.md',
    );
    // It leaves the app, so it opens beside it, like the OWASP links do.
    expect(results).toHaveAttribute('target', '_blank');
    expect(results).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('Home — sample binding (never literals)', () => {
  it('binds the run id + step total + compromise step to the real sample run', async () => {
    const run = await getDataSource().getRun('sample');
    if (!run) throw new Error('sample run missing');
    const total = run.trace.steps.length;
    const idx = run.trace.steps.findIndex((s) => s.id === run.verdict.stepId) + 1;
    const offending = run.trace.steps[idx - 1]!;
    // The offending step is whatever the RECORDED verdict anchored: for the ASI02
    // sample that is the out-of-scope read_file tool call, so the label comes from
    // the shared helper rather than assuming a particular step type.
    const tool = offendingStepLabel(offending);

    const { container } = render(await Home());

    // Run id is surfaced (bound, not hardcoded RG-0472).
    expect(screen.getByText(run.runId)).toBeInTheDocument();

    // Step total is bound: the trailer draws exactly one dot per real step.
    const dots = container.querySelectorAll('[data-testid="trailer-dot"]');
    expect(dots).toHaveLength(total);

    // Compromise step index + offending tool are derived from verdict.stepId.
    expect(
      screen.getByText(new RegExp(`${idx}\\D+${tool}, compromised here`, 'i')),
    ).toBeInTheDocument();
    // The step-total readout matches the real length.
    expect(screen.getByText(new RegExp(`${total}\\s+steps`, 'i'))).toBeInTheDocument();
  });

  /**
   * The trailer shows a compromise on the FRONT DOOR. Unlabelled, a breach dot
   * there reads as a captured live agent, which the sample has never been: it is
   * a builder-constructed trace carrying a verdict the frozen judge really
   * returned. The label is the sample library's own constant, so it cannot be
   * softened here.
   */
  it('labels the trailer with the sample provenance, so it never reads as a live capture', async () => {
    await renderHome();
    expect(screen.getByText(sampleDisplayProvenance())).toBeInTheDocument();
    expect(SAMPLE_VERDICT_PROVENANCE).toMatch(/constructed demonstration/i);
  });

  it('marks exactly one dot as the compromise step', async () => {
    const { container } = render(await Home());
    const breachDots = container.querySelectorAll(
      '[data-testid="trailer-dot"][data-breach="true"]',
    );
    expect(breachDots).toHaveLength(1);
  });
});

describe('the repository is named in one place', () => {
  it('points at the renamed repo', async () => {
    const { REPO_URL } = await import('@/config/repo');
    expect(REPO_URL).toBe('https://github.com/thinkTanck/mcproof');
  });
});

/**
 * WORDS AND MEANING (UI audit 2026-10-12, batch C). The front door says what
 * the product does in one sentence, says what it maps to, explains that, and
 * never prints a category code without its name.
 */
describe('Home — what the product is, in words', () => {
  it('puts a plain paragraph directly under the headline', async () => {
    await renderHome();
    const h1 = screen.getByRole('heading', { level: 1 });
    const subhead = screen.getByTestId('home-subhead');
    expect(h1.nextElementSibling).toBe(subhead);
    expect(subhead.tagName).toBe('P');
    expect(subhead.className).toMatch(/\breading-lead\b/);
    const text = (subhead.textContent ?? '').replace(/\s+/g, ' ').trim();
    // What the product does, keeping both results open (owner ruling
    // 2026-10-15, Home hero). Still no number.
    expect(text).toBe(
      'We hide an attack inside the MCP tools your agent uses, then show you the exact step where it was fooled, or proof that it held.',
    );
    expect(text).not.toMatch(/—|\d/);
  });

  it('carries the OWASP badge and its explanation in the headline block', async () => {
    await renderHome();
    const hero = screen.getByRole('region', { name: /test your ai agent/i });
    const badge = within(hero).getByRole('link', { name: 'Maps to OWASP Agentic Top 10' });
    expect(badge).toHaveAttribute('href', '/threats');
    expect(within(hero).getByTestId('owasp-explainer').tagName).toBe('DETAILS');
  });

  it('names the featured category where the play button points', async () => {
    await renderHome();
    const play = screen.getByRole('link', { name: /play asi02 sample/i });
    const ids = (play.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    expect(ids.length).toBeGreaterThan(0);
    const described = ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    expect(described).toContain('ASI02 Tool Misuse and Exploitation');
  });
});
