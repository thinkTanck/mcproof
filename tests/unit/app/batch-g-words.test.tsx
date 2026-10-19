import { render, screen, within } from '@testing-library/react';
import Home from '@/app/(hud)/page';
import ThreatsPage from '@/app/(hud)/threats/page';
import { StatusBar } from '@/components/shell/StatusBar';
import { HOW_A_TEST_WORKS } from '@/components/home/HowATestWorks';
import { findTells, NEUTRALITY_TELLS } from '@/harness/server/surface';
import { buildHostedSurface, HOSTED_CATEGORIES } from '@/harness/server/surfaces';
import { SERVER_NAME, TASK_PROMPT_NAME } from '@/harness/server/server';
import { ROLES, SENTINEL_GLOSSARY_ID, SENTINEL_DEFINITION } from '@/lib/replay/roles';

/**
 * WORDS ADDED AND WORDS REMOVED (Batch G, 2026-10-13).
 *
 *  - The glossary says what Sentinel is, in one exact sentence.
 *  - Home says how a test works, in five steps, in order.
 *  - "Sentinel Fields" is the design's internal name and is no longer a label
 *    anyone reads in the header.
 *  - "sentinel" and "proving ground" are now words a reader of this product
 *    sees, so they are tells: neither may reach the agent under test.
 */

describe('the glossary entry for Sentinel on /threats', () => {
  it('prints the exact sentence at the anchor the handles link to', async () => {
    render(await ThreatsPage());
    const entry = document.getElementById(SENTINEL_GLOSSARY_ID)!;
    expect(entry, 'an element with the glossary id').not.toBeNull();
    const definition = entry.querySelector('dd')!;
    expect(definition.textContent).toBe(
      "A sentinel is a guard posted to keep watch. Sentinel is MCProof's proving ground: a sealed test environment where your agent meets booby-trapped tools while our detector watches every step. In a replay, anything marked @sentinel happened inside it. MCProof is the proof. Sentinel is where we prove it.",
    );
    expect(definition.textContent).toBe(SENTINEL_DEFINITION);
    expect(entry.querySelector('dt')!.textContent).toBe('Sentinel');
    // Prose, so the reading role.
    expect(definition.className.split(/\s+/)).toContain('reading');
  });

  it('sits in a section headed "Glossary", and the page keeps one level-1 heading', async () => {
    render(await ThreatsPage());
    const heading = screen.getByRole('heading', { name: 'Glossary' });
    expect(heading.tagName).toBe('H2');
    const section = heading.closest('section')!;
    expect(section.contains(document.getElementById(SENTINEL_GLOSSARY_ID))).toBe(true);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

describe('Home: how a test works', () => {
  it('is an ordered list of the five steps, in order', async () => {
    render(await Home());
    const strip = screen.getByTestId('how-a-test-works');
    expect(within(strip).getByRole('heading', { name: 'How a test works' })).toBeInTheDocument();
    const list = within(strip).getByRole('list');
    expect(list.tagName).toBe('OL');
    const items = within(list).getAllByRole('listitem');
    const text = (el: HTMLElement) =>
      [...el.childNodes]
        .filter((n) => !(n instanceof HTMLElement && n.getAttribute('aria-hidden') === 'true'))
        .map((n) => n.textContent ?? '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
    expect(items.map(text)).toEqual([
      'The operator (the person giving the agent a normal task) gives a task',
      'The agent uses the served tools (tools we host for the run)',
      'In an attack run, one served tool carries the attack. In a control run, none does, so you can see how the agent behaves with no attack.',
      'The detector reads every step',
      'You get a fix report or a clean result',
    ]);
    expect(items.map(text)).toEqual(HOW_A_TEST_WORKS.map((step) => step.text));
  });

  it('keeps step 1 in its own words, not the replay Key new Operator text (owner ruling HOME STEP 1)', () => {
    expect(HOW_A_TEST_WORKS[0]!.text).toBe(
      'The operator (the person giving the agent a normal task) gives a task',
    );
    expect(HOW_A_TEST_WORKS[0]!.text).not.toContain('who gives the agent');
    // "Served tool" is the one name for a tool we host (copy pass 2026-10-15).
    expect(HOW_A_TEST_WORKS[1]!.text.toLowerCase()).toContain(
      ROLES.tool.name.toLowerCase().replace(/^served tool$/, 'served tools'),
    );
  });

  it('draws its arrows as decoration, and writes no arrow characters into the words', async () => {
    render(await Home());
    const strip = screen.getByTestId('how-a-test-works');
    const arrows = [...strip.querySelectorAll('[data-step-arrow]')];
    expect(arrows.length).toBeGreaterThanOrEqual(4);
    for (const arrow of arrows) expect(arrow.closest('[aria-hidden="true"]')).not.toBeNull();
    for (const step of HOW_A_TEST_WORKS) expect(step.text).not.toMatch(/->|→|—/);
  });

  it('is words a person reads: the reading role, and no instrument role on a step', async () => {
    render(await Home());
    const strip = screen.getByTestId('how-a-test-works');
    for (const item of within(strip).getAllByRole('listitem')) {
      const worded = item.querySelector('[data-step-text]')!;
      const classes = worded.className.split(/\s+/);
      expect(classes).toContain('reading');
      expect(
        classes.some((c) => /^(instrument|instrument-faint|micro-label|readout)$/.test(c)),
      ).toBe(false);
    }
  });
});

describe('"Sentinel Fields" is not a label in the header', () => {
  const RUN = {
    runId: 'x',
    model: 'some-model',
    category: 'ASI02',
    severity: 'High',
    compromised: true,
  };

  it.each([
    ['a page with no run', <StatusBar key="a" pathname="/" />],
    ['a report', <StatusBar key="b" pathname="/findings/x" mode="sample" />],
    ['the replay', <StatusBar key="c" pathname="/runs/x" mode="sample" runContext={RUN} />],
    ['a live replay', <StatusBar key="d" pathname="/runs/x" mode="live" runContext={RUN} />],
  ])('%s', (_name, bar) => {
    render(bar);
    expect(document.body.textContent ?? '').not.toMatch(/sentinel\s+fields/i);
  });

  it('the front door and the coverage page do not say it either', async () => {
    const { unmount } = render(await Home());
    expect(document.body.textContent ?? '').not.toMatch(/sentinel\s+fields/i);
    unmount();
    render(await ThreatsPage());
    expect(document.body.textContent ?? '').not.toMatch(/sentinel\s+fields/i);
  });
});

describe('the two new product words are tells the agent must never read', () => {
  it('"sentinel" and "proving ground" are on the neutrality list', () => {
    expect(NEUTRALITY_TELLS).toContain('sentinel');
    expect(NEUTRALITY_TELLS).toContain('proving ground');
  });

  it('are found whatever the case', () => {
    expect(findTells('target-agent@Sentinel:~$')).toEqual(['sentinel']);
    expect(findTells('welcome to the Proving Ground')).toEqual(['proving ground']);
  });

  it('and nothing a surface serves carries either', () => {
    const served: string[] = [SERVER_NAME, TASK_PROMPT_NAME];
    for (const category of HOSTED_CATEGORIES) {
      for (const kind of ['malicious', 'benign'] as const) {
        const surface = buildHostedSurface(category, kind);
        served.push(surface.taskGoal, surface.systemPrompt ?? '');
        for (const tool of surface.tools) {
          served.push(tool.name, tool.description, JSON.stringify(tool.inputSchema));
          served.push(JSON.stringify(tool.call({})));
        }
      }
    }
    const lowered = served.join('\n').toLowerCase();
    expect(lowered).not.toContain('sentinel');
    expect(lowered).not.toContain('proving ground');
  });
});
