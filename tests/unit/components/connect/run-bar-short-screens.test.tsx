import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LiveRunConsole } from '@/components/connect/LiveRunConsole';
import type {
  ConnectLiveRunPort,
  LiveRunStatusView,
  LiveRunTicketView,
} from '@/components/connect/live-run-port';
import { DISCARD_CONFIRM_NO, DISCARD_RUN_LABEL } from '@/runs/discard-copy';

/**
 * THE RUN BAR ON A SHORT SCREEN, AND THE DISCARD QUESTION UNDER IT
 * (mobile sweep 2026-10-10, S1).
 *
 * jsdom applies no media queries and lays nothing out, so whether the bar is
 * pinned at a given height, and where the question lands, is measured in a
 * browser (tests/e2e/run-bar-short-screens.spec.ts, Chromium and WebKit). What
 * is held here is the markup that decides it: the class that unpins the bar
 * under 500px of height, every other class of the bar exactly as on main, and
 * the question as a block of its own after the bar, never inside it.
 */

const TICKET: LiveRunTicketView = {
  runId: 'run-77',
  endpoint: 'https://mcproof.dev/api/mcp/run-77',
  token: 'rt_secret',
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
  toolCalls: phase === 'waiting' ? 0 : 4,
  finishedAt: null,
});

function portWith(phase: LiveRunStatusView['phase']): Required<ConnectLiveRunPort> {
  return {
    start: vi.fn(async () => ({ ok: true as const, value: TICKET })),
    readState: vi.fn(async () => ({ ok: true as const, value: status(phase) })),
    finish: vi.fn(async () => ({
      ok: false as const,
      refusal: { code: 'RUN_NOT_FOUND' as const, message: 'not found' },
    })),
    discard: vi.fn(async () => ({ ok: true as const, value: { runId: 'run-77', steps: 9 } })),
    reattach: vi.fn(async () => ({
      ok: false as const,
      refusal: { code: 'RUN_NOT_FOUND' as const, message: 'not found' },
    })),
  };
}

const dock = () => screen.getByRole('region', { name: /what we have actually seen/i });
const confirm = () => screen.getByRole('group', { name: /discard this run/i });

async function issue(phase: LiveRunStatusView['phase'], settle: string) {
  const user = userEvent.setup();
  render(<LiveRunConsole port={portWith(phase)} category="ASI01" signedIn />);
  await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
  await within(dock()).findByText(settle);
  return user;
}

/**
 * The bar's class attribute on main (253010f), before this change. One token
 * has moved since: the pin offset reads `--header-clear`, the header's measured
 * height, which is `--header-h` at normal text size (tests/unit/app/header-height.test.ts).
 */
const MAIN_BAR =
  'sticky top-[calc(var(--header-clear)+8px)] z-40 -mt-3 flex flex-col gap-3 rounded-lg border border-line-em bg-solid px-5 py-3';
/** The one class this change adds: under 500px of height the bar is not pinned. */
const SHORT_SCREEN_UNPIN = '[@media(max-height:499px)]:static';

const sorted = (classes: string) => classes.split(/\s+/).filter(Boolean).sort();

describe('the run bar under 500px of height', () => {
  for (const [phase, settle] of [
    ['connected', 'AGENT CONNECTED'],
    ['waiting', 'AWAITING AGENT'],
  ] as const) {
    it(`${phase}: is unpinned by a height query, and is otherwise main's bar exactly`, async () => {
      await issue(phase, settle);
      const classes = sorted(dock().className);

      expect(classes).toContain(SHORT_SCREEN_UNPIN);
      // Nothing else moved: take the one added class away and it is main's bar.
      expect(classes.filter((c) => c !== SHORT_SCREEN_UNPIN)).toEqual(sorted(MAIN_BAR));
      // Pinned by `sticky`, never `fixed` (a transformed ancestor re-anchors fixed).
      expect(classes).not.toContain('fixed');
      // The only height-gated class is the one that unpins it.
      expect(classes.filter((c) => /max-height|min-height/.test(c))).toEqual([SHORT_SCREEN_UNPIN]);
    });
  }
});

describe("the column's scroll margin under 500px of height", () => {
  it('drops the margin that clears the pinned bar, because the bar is not pinned there', async () => {
    await issue('connected', 'AGENT CONNECTED');
    const classes = sorted(dock().parentElement!.className);

    // From 500px up, focus still lands clear of the pinned bar, as before.
    // (15rem, capped at half the screen's height so enlarged text cannot make
    // it taller than the screen; the cap is above 15rem from 500px up.)
    expect(classes).toContain('[&_:is(a,button,[tabindex])]:scroll-mt-[min(15rem,50dvh)]');
    // Under it only the header is pinned, and the page's scroll padding clears that.
    expect(classes).toContain(
      '[@media(max-height:499px)]:[&_:is(a,button,[tabindex])]:scroll-mt-0',
    );
  });
});

describe('the discard question sits after the bar, never inside it', () => {
  it('opened from the bar copy of the control (the wide layout)', async () => {
    const user = await issue('connected', 'AGENT CONNECTED');
    await user.click(within(dock()).getByRole('button', { name: DISCARD_RUN_LABEL }));

    const group = confirm();
    expect(dock()).not.toContainElement(group);
    expect(group.parentElement).toBe(dock().parentElement);
    expect(dock().compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() =>
      expect(within(group).getByRole('button', { name: DISCARD_CONFIRM_NO })).toHaveFocus(),
    );
  });

  it('opened from the narrow copy, it follows the control that was pressed', async () => {
    const user = await issue('waiting', 'AWAITING AGENT');
    const narrow = screen.getByTestId('discard-run-narrow');
    await user.click(within(narrow).getByRole('button', { name: DISCARD_RUN_LABEL }));

    const group = confirm();
    expect(dock()).not.toContainElement(group);
    expect(group.parentElement).toBe(dock().parentElement);
    // Bar, then the narrow control, then the question.
    expect(narrow.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(narrow.nextElementSibling).toBe(group);
    await waitFor(() =>
      expect(within(group).getByRole('button', { name: DISCARD_CONFIRM_NO })).toHaveFocus(),
    );
  });

  it('is not pinned itself: no sticky or fixed class on it', async () => {
    const user = await issue('connected', 'AGENT CONNECTED');
    await user.click(within(dock()).getByRole('button', { name: DISCARD_RUN_LABEL }));

    expect(sorted(confirm().className)).not.toContain('sticky');
    expect(sorted(confirm().className)).not.toContain('fixed');
  });
});
