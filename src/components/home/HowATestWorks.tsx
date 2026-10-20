import { HOW_A_TEST_WORKS_TITLE } from '@/lib/site-copy';

/**
 * HOW A TEST WORKS, in five steps (Batch G, 2026-10-13).
 *
 * The hero replay shows a run; nothing beside it said what the parts of a run
 * are. Five short steps, in order, as an ordered list. The two role names it
 * shares with the replay (the operator, the agent under test) come from the
 * roles lookup, so the front door and the replay's legend use one name for
 * one thing.
 *
 * It describes the MECHANISM of a test and promises nothing about its result:
 * in an attack run one served tool carries the attack, and whether the agent
 * uses it is what the run measures; in a benign control run no tool does. So
 * it says "the detector reads every step", never what the detector will find
 * (tests/unit/app/framing.test.tsx).
 *
 * The arrows are decoration and are hidden from assistive technology: the
 * list is ordered, and that is what carries the sequence. Right from one step
 * to the next where the steps sit in a row, down where they are stacked. No
 * icon, no motion.
 */
/**
 * Step 1 names the operator and what they do, once (owner ruling 2026-10-19
 * 17:47: the earlier "gives a task" said task twice). It keeps its own words
 * and does not read the replay Key's Operator text (owner ruling HOME STEP 1).
 */

export const HOW_A_TEST_WORKS: readonly { id: string; text: string }[] = [
  { id: 'operator', text: 'The operator gives the agent a normal task.' },
  { id: 'agent', text: 'The agent uses the served tools (tools we host for the run)' },
  {
    id: 'tool',
    text: 'In an attack run, one served tool carries the attack. In a control run, none does, so you can see how the agent behaves with no attack.',
  },
  { id: 'detector', text: 'The detector reads every step' },
  { id: 'report', text: 'You get a fix report or a clean result' },
];

export function HowATestWorks() {
  return (
    <section
      aria-labelledby="how-a-test-works-title"
      data-testid="how-a-test-works"
      className="border-t border-line pt-3"
    >
      <h2 id="how-a-test-works-title" className="micro-label text-nominal">
        {HOW_A_TEST_WORKS_TITLE}
      </h2>
      <ol className="measure mt-(--instrument-stack-rows) flex flex-col gap-x-2 gap-y-1 sm:flex-row sm:flex-wrap sm:items-baseline">
        {HOW_A_TEST_WORKS.map((step, i) => (
          <li key={step.id} className="flex items-baseline gap-2">
            <span aria-hidden="true" className="instrument-faint one-line tabular-nums">
              {i + 1}
            </span>
            <span data-step-text="" className="reading">
              {step.text}
            </span>
            {i < HOW_A_TEST_WORKS.length - 1 && (
              <span aria-hidden="true" className="instrument-faint one-line">
                <span data-step-arrow="" className="sm:hidden">
                  ↓
                </span>
                <span data-step-arrow="" className="max-sm:hidden">
                  →
                </span>
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
