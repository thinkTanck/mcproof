import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LiveRunConsole } from '@/components/connect/LiveRunConsole';
import type {
  ConnectLiveRunPort,
  LiveRunStatusView,
  LiveRunSummaryView,
  LiveRunTicketView,
} from '@/components/connect/live-run-port';

/**
 * THE CONNECTED BAR ON A PHONE: TWO ROWS, A SHORT LABEL, THE SAME MEANING
 * (sweep 2026-10-07, C3).
 *
 * jsdom lays nothing out, so heights and rows are measured in a browser
 * (tests/e2e/connected-run-bar.spec.ts). What is held here is the part that does
 * not depend on layout: what the control is called, what the status region
 * contains, and that only the connected state takes the phone layout.
 */

const TICKET: LiveRunTicketView = {
  runId: 'run-77',
  endpoint: 'https://mcpwn.dev/api/mcp/run-77',
  token: 'mcpwn_rt_secret',
  expiresAt: '2099-01-01T00:00:00.000Z',
  category: 'ASI01',
  kind: 'malicious',
  promptName: 'session_brief',
  taskGoal: 'Clear the finance inbox.',
};

const status = (phase: LiveRunStatusView['phase']): LiveRunStatusView => ({
  runId: 'run-77',
  phase,
  connectedAt: null,
  lastSeenAt: null,
  steps: 9,
  toolCalls: 4,
  finishedAt: null,
});

const SUMMARY: LiveRunSummaryView = {
  runId: 'run-77',
  storedRunId: '3f2b6c1e-8a4d-4c1b-9e57-0a1b2c3d4e5f',
  compromised: false,
  category: 'ASI01',
  severity: 'None',
  stepId: null,
  steps: 9,
};

function portWith(phase: LiveRunStatusView['phase'], finish?: ConnectLiveRunPort['finish']) {
  return {
    start: vi.fn(async () => ({ ok: true as const, value: TICKET })),
    readState: vi.fn(async () => ({ ok: true as const, value: status(phase) })),
    finish: finish ?? vi.fn(async () => ({ ok: true as const, value: SUMMARY })),
    reattach: vi.fn(async () => ({
      ok: false as const,
      refusal: { code: 'RUN_NOT_FOUND' as const, message: 'not found' },
    })),
  } satisfies ConnectLiveRunPort;
}

const dock = () => screen.getByRole('region', { name: /what we have actually seen/i });

async function issue(port: ConnectLiveRunPort, settle: string) {
  const user = userEvent.setup();
  render(<LiveRunConsole port={port} category="ASI01" signedIn />);
  await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
  await within(dock()).findByText(settle);
  return user;
}

describe('connected: the end-run control', () => {
  it('is named "End run and judge", with the same tooltip, at every width', async () => {
    await issue(portWith('connected'), 'AGENT CONNECTED');
    const button = within(dock()).getByRole('button', { name: 'End run and judge' });

    expect(button).toHaveAttribute('title', 'End run and judge');
  });

  it('shows END RUN below 640px and the full words from 640px up', async () => {
    await issue(portWith('connected'), 'AGENT CONNECTED');
    const button = within(dock()).getByRole('button', { name: 'End run and judge' });

    const short = within(button).getByText('END RUN', { exact: true });
    const full = within(button).getByText('END RUN AND JUDGE', { exact: true });
    expect(short.className).toMatch(/\bsm:hidden\b/);
    expect(full.className).toMatch(/\bhidden\b/);
    expect(full.className).toMatch(/\bsm:inline\b/);
    // Label in name (WCAG 2.5.3), for both visible labels.
    for (const visible of ['END RUN', 'END RUN AND JUDGE']) {
      expect('End run and judge'.toLowerCase()).toContain(visible.toLowerCase());
    }
  });

  it('while judging reads JUDGING, and is named by what it shows', async () => {
    let answer!: (v: { ok: true; value: LiveRunSummaryView }) => void;
    const finish = vi.fn(
      () =>
        new Promise<{ ok: true; value: LiveRunSummaryView }>((resolve) => {
          answer = resolve;
        }),
    );
    const user = await issue(portWith('connected', finish), 'AGENT CONNECTED');
    await user.click(within(dock()).getByRole('button', { name: 'End run and judge' }));

    const judging = within(dock()).getByRole('button', { name: 'JUDGING' });
    expect(judging).toHaveTextContent('JUDGING');
    expect(judging).not.toHaveAttribute('aria-label');
    answer({ ok: true, value: SUMMARY });
  });
});

describe('connected: the status region', () => {
  it('holds the phase reading and the count, and no control', async () => {
    await issue(portWith('connected'), 'AGENT CONNECTED');
    const region = within(dock()).getByRole('status');

    expect(region).toHaveTextContent('AGENT CONNECTED');
    expect(region).toHaveTextContent('4tool calls');
    expect(within(region).queryByRole('button')).not.toBeInTheDocument();
  });

  it('lays the reading and the count on the bar grid below 640px, and as before from 640px up', async () => {
    await issue(portWith('connected'), 'AGENT CONNECTED');
    const region = within(dock()).getByRole('status');

    // A subgrid of the bar's row, so its two pieces line up with the control
    // without leaving the one region a screen reader announces.
    expect(region.className).toMatch(/\bgrid-cols-subgrid\b/);
    expect(region.className).toMatch(/\bgrid-rows-subgrid\b/);
    // From 640px up, the flex row it always was.
    expect(region.className).toMatch(/\bsm:flex\b/);
    expect(region.className).toMatch(/\bsm:flex-1\b/);
  });
});

describe('every other state keeps the bar it had', () => {
  it.each([
    ['waiting', 'AWAITING AGENT'],
    ['finished', 'RUN FINISHED'],
  ] as const)('%s: no phone grid', async (phase, settle) => {
    await issue(portWith(phase), settle);
    const region = within(dock()).getByRole('status');

    expect(region.className).toBe('flex flex-1 flex-wrap items-center gap-x-4 gap-y-2');
    expect(within(dock()).queryByRole('button', { name: 'End run and judge' })).toBeNull();
  });
});

/**
 * FROM 640px UP THE BAR IS MAIN'S BAR, CLASS FOR CLASS.
 *
 * A pixel height is no guard: Windows and the Linux CI runner render the
 * fallback font at different sizes, and a height measured on one is not a fact
 * about the other. What decides the layout at 640px and up is the set of classes
 * that apply there, so that is what is compared. Every phone-only class is
 * written `max-sm:`, every class for 640px up `sm:` (or unprefixed when it holds
 * at every width), so the set that applies at 640px and up can be read off the
 * markup exactly.
 *
 * The lists below are the class attributes of these five elements on main
 * (8fcdefc), copied from `src/components/connect/LiveRunConsole.tsx` there.
 */
const MAIN_AT_SM_AND_UP = {
  row: 'flex min-h-11 flex-wrap items-center gap-x-5 gap-y-3',
  status: 'flex flex-1 flex-wrap items-center gap-x-4 gap-y-2',
  label: 'font-mono text-[13px] tracking-[0.08em]',
  count: 'flex items-baseline gap-2',
  button:
    'inline-flex min-h-11 items-center gap-2.5 rounded-md border border-nominal bg-nominal/10 px-5 py-3 font-mono text-[14px] tracking-[0.08em] text-readout shadow-glow-nominal transition-colors hover:bg-nominal/20',
};

/** The classes that apply at 640px and up: unprefixed ones, plus `sm:` ones without the prefix. */
function atSmAndUp(el: Element): string[] {
  const tokens = el.className.split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    // Only the two prefixes this rule is written in. Anything else would need
    // its own reading and is refused rather than guessed at.
    expect(t, `unexpected variant in "${t}"`).toMatch(/^(?:(?:max-)?sm:)?[^:]+$|^hover:[^:]+$/);
  }
  const resolved = tokens
    .filter((t) => !t.startsWith('max-sm:'))
    .map((t) => (t.startsWith('sm:') ? t.slice(3) : t));
  // A `sm:` class and an unprefixed class of the same utility would both be
  // listed; neither occurs here, and a duplicate would fail the comparison.
  return resolved.sort();
}

const sorted = (classes: string) => classes.split(/\s+/).sort();

describe('connected: from 640px up the bar keeps main classes exactly', () => {
  it('row, status region, phase reading, count and end-run control', async () => {
    await issue(portWith('connected'), 'AGENT CONNECTED');
    const region = within(dock()).getByRole('status');
    const row = region.parentElement!;
    const label = within(region).getByText('AGENT CONNECTED');
    const count = within(region).getByText('tool calls').parentElement!;
    const button = within(dock()).getByRole('button', { name: 'End run and judge' });

    expect(atSmAndUp(row)).toEqual(sorted(MAIN_AT_SM_AND_UP.row));
    expect(atSmAndUp(region)).toEqual(sorted(MAIN_AT_SM_AND_UP.status));
    expect(atSmAndUp(label)).toEqual(sorted(MAIN_AT_SM_AND_UP.label));
    expect(atSmAndUp(count)).toEqual(sorted(MAIN_AT_SM_AND_UP.count));
    expect(atSmAndUp(button)).toEqual(sorted(MAIN_AT_SM_AND_UP.button));
  });

  it('every phone-only class is written max-sm:, so none of it can reach 640px and up', async () => {
    await issue(portWith('connected'), 'AGENT CONNECTED');
    const region = within(dock()).getByRole('status');

    for (const el of [region.parentElement!, region]) {
      const unprefixed = el.className.split(/\s+/).filter((t) => t && !/^(max-)?sm:/.test(t));
      expect(unprefixed, el.className).toEqual([]);
    }
  });
});
