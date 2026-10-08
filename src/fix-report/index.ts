/**
 * Module 6 — FIX-REPORT GENERATOR.
 *
 * `generateFixReport(runResult)` turns a live `RunResult` into an engineer-ready
 * report. For a compromised run it emits a finding — the OWASP category (code +
 * title), severity, the offending step id (which must exist in the trace), the
 * detector's rationale, and category-appropriate remediation grounded in the
 * official OWASP Top 10 for Agentic Applications (genai.owasp.org). For a clean
 * run it emits a ROBUSTNESS RESULT: the agent held the line in this run, which is
 * a first-class outcome and not an absence. `toMarkdown` / `toJSON` export it with
 * a stable shape (JSON round-trips). Pure over `RunResult`; never touches
 * `GroundTruth` (a live run has none — leakage separation).
 */
import type { Category, RunResult, Severity, Step } from '@/contract';
import { MEASURED_COMPROMISE } from '@/eval/measured';
import { classificationReliability, type ClassScore } from './classification';

export {
  MEASURED_CLASSIFICATION_BY_CATEGORY,
  classificationReliability,
  type ClassScore,
  type ClassificationReliability,
} from './classification';

/** Typed error for an inconsistent RunResult (offending step missing). */
export class FixReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FixReportError';
  }
}

const CATEGORY_TITLE: Record<Category, string> = {
  ASI01: 'Agent Goal Hijack',
  ASI02: 'Tool Misuse and Exploitation',
  ASI03: 'Identity and Privilege Abuse',
  ASI04: 'Agentic Supply Chain Vulnerabilities',
  ASI05: 'Unexpected Code Execution (RCE)',
  ASI06: 'Memory & Context Poisoning',
  ASI10: 'Rogue Agents',
};

/** Citation for the official OWASP Agentic category catalogue. */
const OWASP_REFERENCE = 'https://genai.owasp.org/ (OWASP Top 10 for Agentic Applications, 2026)';

/**
 * THE CLEAN-RUN SUMMARY. A run ends in one of two first-class results, and this
 * is the other one: the agent was served the hostile surface and did not act on
 * it. It used to open "No findings", which framed a result as a missing report
 * and quietly ranked it below the compromise it renders beside.
 *
 * It is written to fail in NEITHER direction:
 *
 *  - It states what WAS established, and who established it. The locked
 *    validated judge read the whole trace and found no compromising action. That
 *    is a positive fact about this run, not an empty search result.
 *  - It does NOT generalize that into a property of the agent. One clean run is
 *    one run against one staged attack. Per ADR-0009 an agent that read the
 *    payout redirection and stopped one step short of paying scores exactly the
 *    same here as one that never engaged, so "your agent is safe" would be as
 *    unsupported as the bait-taking claims the copy pass removed.
 *
 * It quotes no measured figure on purpose: precision, recall and category
 * accuracy are measured on LABELED fixtures, and a live run has no ground truth
 * to be scored against. No em dashes: this reaches both the findings screen and
 * the exported ticket (locked UI copy rule).
 */
const CLEAN_RUN_SUMMARY =
  'The agent was not compromised in this run: the locked validated judge read the whole trace and found no compromising action. ' +
  'That is one run against one staged attack, and it says nothing about other attacks or other runs.';

/**
 * Category-appropriate remediation, grounded in the OWASP Agentic categories.
 *
 * An ORDERED SEQUENCE, not a paragraph: an engineer works a fix report top to
 * bottom, and numbering the actions is what makes the report actionable rather
 * than merely correct. `Remediation.guidance` still exposes the prose form
 * (`steps.join(' ')`) so a single source of truth serves both the screen's
 * ordered list and the Markdown export.
 */
const REMEDIATION_STEPS: Record<Category, readonly string[]> = {
  ASI01: [
    'Pin the agent to its authorized objective.',
    'Treat tool results and retrieved content as untrusted data, never as instructions.',
    'Validate every action against the original task before executing it.',
    'Require confirmation for high-impact operations the user did not request.',
  ],
  ASI02: [
    'Enforce least-privilege tool access with per-tool allow-lists and argument validation.',
    'Reject tool calls whose targets fall outside the declared scope (e.g. path traversal).',
    'Require explicit authorization for destructive or high-impact tools.',
  ],
  ASI03: [
    'Enforce least-privilege, task-scoped identities.',
    'Issue short-lived credentials bound to the current task.',
    'Never reuse or inherit credentials or sessions across tasks and tools.',
    'Verify authorization for every privileged tool call against the active task.',
    'Segment and revoke sessions so the agent cannot escalate into out-of-scope privileged actions.',
  ],
  ASI04: [
    'Pin and cryptographically verify every tool, plugin, and model dependency.',
    'Vet third-party MCP servers before granting them to an agent.',
    'Prefer signed and verified packages over convenience sources.',
    'Refuse to load unsigned, typosquatted, or unexpected components at run time.',
  ],
  ASI05: [
    'Never pass untrusted or attacker-influenced input into exec, shell, or eval tools.',
    'Run any required code in a sandbox with an explicit command allow-list.',
    'Parameterize and escape arguments instead of string-concatenating them.',
    'Disable dynamic code-execution paths the task does not need.',
    'Validate and neutralize inputs before they can reach a command interpreter.',
  ],
  ASI06: [
    'Isolate and validate memory and context on both write and read.',
    'Namespace memory per task or session, and sanitize it before persisting.',
    'Never let stored memory silently override the current instructions.',
    'Never let stored memory authorize an action on its own.',
  ],
  ASI10: [
    'Bound the agent lifecycle: stop all tool use at task completion.',
    'Deny post-task and out-of-scope actions.',
    'Require truthful completion reporting.',
    'Monitor for self-directed or covert behavior so a rogue agent cannot act beyond its mandate.',
  ],
};

/** Category-appropriate remediation guidance + its OWASP citation. */
export interface Remediation {
  category: Category;
  categoryTitle: string;
  /** The remediation as an ordered sequence of actions. */
  steps: readonly string[];
  /** The same steps as one prose paragraph (the Markdown/summary form). */
  guidance: string;
  reference: string;
}

/**
 * What this report is entitled to claim about its own category, and why.
 *
 * The category is a PREDICTION: the judge's blind read of the trace, never a
 * label. Everything derived from it inherits that uncertainty, so the figure
 * travels with the finding instead of being left for a reader to guess at.
 */
export interface Classification {
  /** The Core-7 scenario this run STAGED (the environment our endpoint served). */
  staged: Category;
  /** Its pinned OWASP title (ADR-0003). */
  stagedTitle: string;
  /** MEASURED aggregate category accuracy and its denominator (imported). */
  accuracy: number;
  scored: number;
  /** How that figure was obtained. Rendered beside it, never apart from it. */
  provenance: string;
  /** The staged class's own measured tally: correct of scored. */
  classScore: ClassScore;
  /**
   * false when the staged class classified at ZERO. Category-derived guidance is
   * withheld rather than guessed, and `remediation` is null.
   */
  reliable: boolean;
  /** Plain note stating what is withheld and why. Present iff `!reliable`. */
  note: string | null;
  /**
   * The sentence that qualifies a remediation list derived from the category.
   * Present iff `reliable`. Built here, once, so the screen and the exported
   * ticket print the same words: it used to be written in the screen alone, and
   * the copied report shipped the list with nothing said about it.
   */
  caveat: string | null;
}

/** An engineer-ready finding for one compromised run. */
export interface Finding {
  category: Category;
  categoryTitle: string;
  severity: Severity;
  stepId: string;
  /**
   * 1-based position of the offending step in the trace — the number the replay
   * timeline shows, so a reader can find it without counting.
   */
  stepIndex: number;
  /**
   * The offending step itself, quoted verbatim from the OBSERVABLE trace. The
   * report is evidence, and an engineer cannot act on a step id alone; this is
   * what the agent actually did. Never synthesized, never a label.
   */
  step: Step;
  rationale: string;
  /**
   * Category-derived remediation, or NULL when the staged class's classification
   * measured zero. Null is the honest answer there: the alternative is printing
   * a neighbouring category's actions for an engineer to work top to bottom.
   */
  remediation: Remediation | null;
  /** What may be claimed about the category this finding was filed under. */
  classification: Classification;
}

/**
 * The report for one run: a finding (compromised) or a robustness result (the
 * agent was not compromised in this run). Both are results; neither is the
 * failure case.
 */
export interface FixReport {
  runId: string;
  target: string;
  model: string;
  compromised: boolean;
  finding: Finding | null;
  summary: string;
  /**
   * Where this run's verdict came from, in the words of whoever resolved the run
   * (a constructed demonstration, or a live run), or `null` when nobody said.
   * It rides ON the report so the screen and the export read one value: it used
   * to be handed to the screen beside the report, and the copied ticket lost it.
   * Never authored here, and never a label on the trace.
   */
  provenance: string | null;
}

/**
 * What this run's category may be claimed to mean, indexed by the class the run
 * STAGED (which is what the measurement is indexed by). The authored note is
 * built from the measured tally rather than quoting a numeral, so it can never
 * drift from the figure it cites.
 */
function classificationFor(staged: Category): Classification {
  const r = classificationReliability(staged);
  const stagedTitle = CATEGORY_TITLE[staged];
  const note = r.reliable
    ? null
    : [
        `Category classification is unreliable for ${staged} ${stagedTitle}.`,
        `On our labeled set the detector filed ${r.classScore.correct} of ${r.classScore.scored}`,
        `${staged} realizations under that code, reading them as neighbouring categories instead.`,
        'Remediation is derived from the category, so it is withheld here rather than guessed.',
        'What was measured still holds: this compromise is confirmed, the detector missed no',
        `compromise in any category (recall ${MEASURED_COMPROMISE.recall.toFixed(4)}), and the`,
        // ABOVE: the offending step is drawn before this note, on the screen and in
        // the exported ticket (tests/unit/fix-report/direction-words.test.tsx).
        'offending step above is its own anchor.',
        'Category specific guidance for this class is pending a category-v2 rubric.',
      ].join(' ');
  // No em dashes: this reaches both the findings screen and the exported ticket.
  const caveat = r.reliable
    ? 'The category above is the detector’s own blind classification of the trace, and these ' +
      `steps follow from it. Measured accuracy on our labeled set is ${r.accuracy.toFixed(2)}, so ` +
      'confirm the category against the offending step before you act on this list.'
    : null;
  return {
    staged,
    stagedTitle,
    accuracy: r.accuracy,
    scored: r.scored,
    provenance: r.provenance,
    classScore: r.classScore,
    reliable: r.reliable,
    note,
    caveat,
  };
}

function remediationFor(category: Category): Remediation {
  const steps = REMEDIATION_STEPS[category];
  return {
    category,
    categoryTitle: CATEGORY_TITLE[category],
    steps,
    guidance: steps.join(' '),
    reference: OWASP_REFERENCE,
  };
}

/**
 * Build an engineer-ready fix report from a live `RunResult`. Pure over
 * `RunResult`; never references `GroundTruth`.
 *
 * `provenance` is REQUIRED, with no default. Every caller decides: the label
 * the run was resolved with, or an explicit `null` where no reader will ever
 * see the report. An optional argument is how the label went missing before.
 *
 * @throws {FixReportError} if a compromised verdict has no offending step
 *   present in the trace.
 */
export function generateFixReport(
  run: RunResult,
  { provenance }: { provenance: string | null },
): FixReport {
  const { runId, target, model, trace, verdict } = run;

  if (!verdict.compromised) {
    return {
      runId,
      target,
      model,
      compromised: false,
      finding: null,
      summary: CLEAN_RUN_SUMMARY,
      provenance,
    };
  }

  const { stepId } = verdict;
  const stepIndex = stepId === undefined ? -1 : trace.steps.findIndex((s) => s.id === stepId);
  if (stepId === undefined || stepIndex < 0) {
    throw new FixReportError(
      `Compromised verdict for run "${runId}" has no offending step present in the trace.`,
    );
  }

  // The category is checked against the MEASUREMENT before anything is derived
  // from it. A class measured at zero gets no remediation, because remediation
  // keyed to a code that has never been right is guidance in name only.
  const classification = classificationFor(run.category);

  const finding: Finding = {
    category: verdict.category,
    categoryTitle: CATEGORY_TITLE[verdict.category],
    severity: verdict.severity,
    stepId,
    stepIndex: stepIndex + 1,
    step: trace.steps[stepIndex]!,
    rationale: verdict.rationale,
    remediation: classification.reliable ? remediationFor(verdict.category) : null,
    classification,
  };

  // The summary leads with whatever is actually reliable. For a class that
  // classified at zero that is the compromise and its anchor, never the code.
  const summary = classification.reliable
    ? `Compromised: ${verdict.category} (${finding.categoryTitle}), severity ${verdict.severity}. Offending step: ${stepId}.`
    : `Compromised: confirmed, severity ${verdict.severity}. Offending step: ${stepId}. Category classification is unreliable for ${classification.staged}, so category remediation is withheld.`;

  return { runId, target, model, compromised: true, finding, summary, provenance };
}

/** The verdict's provenance as a header line, or nothing when none was given. */
function provenanceLine(report: FixReport): string[] {
  return report.provenance === null ? [] : [`**Verdict:** ${report.provenance}`];
}

/** Render a `FixReport` as engineer-ready Markdown. */
export function toMarkdown(report: FixReport): string {
  if (report.finding === null) {
    // The ticket for a clean run is a RESULT, headed like one. A ticket headed
    // "No findings" is filed and forgotten as the report that never arrived,
    // which is the same demotion the screens were reframed to stop; the export
    // is the artifact an engineer keeps, so it has to say what the screen says.
    return [
      `# Run result · \`${report.runId}\``,
      '',
      `**Target:** ${report.target} · **Model:** ${report.model}`,
      `**Compromised:** no`,
      ...provenanceLine(report),
      '',
      '## Robustness result',
      '',
      report.summary,
      '',
      'A live run is unlabeled, so this is a verdict on this run and not a score checked against a known answer. The trace is the record of what the agent actually did.',
      '',
    ].join('\n');
  }

  const f = report.finding;
  const c = f.classification;

  // The ticket says the same thing the screen does. A caveat that survives only
  // on screen is not a caveat: the exported artifact is what gets pasted into an
  // issue and worked from.
  const remediationSection = f.remediation
    ? [
        '## Remediation',
        '',
        c.caveat ?? '',
        '',
        `_Measured:_ ${c.provenance}`,
        '',
        ...f.remediation.steps.map((step, i) => `${i + 1}. ${step}`),
        '',
        `_Category:_ ${f.remediation.category} · ${f.remediation.categoryTitle}. _Reference:_ ${f.remediation.reference}`,
      ]
    : ['## Remediation withheld', '', c.note ?? '', '', `_Measured:_ ${c.provenance}`];

  return [
    c.reliable
      ? `# Fix report · ${f.category} · ${f.categoryTitle}`
      : `# Fix report · compromise confirmed · category unresolved`,
    '',
    `**Run:** \`${report.runId}\` · **Target:** ${report.target} · **Model:** ${report.model}`,
    `**Severity:** ${f.severity} · **Compromised:** yes`,
    `**Offending step:** #${f.stepIndex} \`${f.stepId}\` (${f.step.type})`,
    c.reliable
      ? `**Category:** ${f.category} · ${f.categoryTitle}`
      : `**Category returned by the detector:** ${f.category} · ${f.categoryTitle} (classification unreliable for this class)`,
    ...provenanceLine(report),
    '',
    '## Detector rationale',
    '',
    f.rationale,
    '',
    ...remediationSection,
    '',
  ].join('\n');
}

/** Serialize a `FixReport` as JSON. `JSON.parse(toJSON(r))` round-trips to `r`. */
export function toJSON(report: FixReport): string {
  return JSON.stringify(report, null, 2);
}
