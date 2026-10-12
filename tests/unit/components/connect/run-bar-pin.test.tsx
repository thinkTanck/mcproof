import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectScreen } from '@/components/connect/ConnectScreen';
import { LiveRunConsole } from '@/components/connect/LiveRunConsole';
import type {
  ConnectLiveRunPort,
  LiveRunStatusView,
  LiveRunTicketView,
} from '@/components/connect/live-run-port';
import {
  RUN_BAR_CLEAR_VAR,
  RUN_BAR_PIN_QUERY,
  useRunBarClearance,
} from '@/components/connect/run-bar-pin';

/**
 * THE RUN BAR ON A PHONE, IN THE DOCUMENT.
 *
 * On a phone held upright the run bar is the last thing on the Connect page and
 * is held at the bottom of the screen until the reader reaches it. The screen
 * draws an empty slot at the end of its column and the console moves the bar
 * into it; everywhere else the bar is where main has it, with main's classes.
 *
 * Where the bar is DRAWN (inside the viewport on load, clear of the last
 * content, clear of a focused control) is measured in a real browser in
 * tests/e2e/phone-run-bar.spec.ts. This file holds what jsdom can see.
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

const STATUS: LiveRunStatusView = {
  runId: 'run-77',
  phase: 'connected',
  connectedAt: null,
  lastSeenAt: null,
  steps: 9,
  toolCalls: 4,
  finishedAt: null,
};

function port(): Required<ConnectLiveRunPort> {
  const refused = {
    ok: false as const,
    refusal: { code: 'RUN_NOT_FOUND' as const, message: 'not found' },
  };
  return {
    start: vi.fn(async () => ({ ok: true as const, value: TICKET })),
    readState: vi.fn(async () => ({ ok: true as const, value: STATUS })),
    finish: vi.fn(async () => refused),
    discard: vi.fn(async () => ({ ok: true as const, value: { runId: 'run-77', steps: 9 } })),
    reattach: vi.fn(async () => refused),
  };
}

function stubPhone(upright: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === RUN_BAR_PIN_QUERY ? upright : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

class FakeResizeObserver {
  static made: FakeResizeObserver[] = [];
  observed: { el: Element; options?: ResizeObserverOptions }[] = [];
  disconnect = vi.fn();
  constructor(public callback: () => void) {
    FakeResizeObserver.made.push(this);
  }
  observe(el: Element, options?: ResizeObserverOptions) {
    this.observed.push({ el, options });
  }
}

const dock = () => screen.getByRole('region', { name: /what we have actually seen/i });
const clearance = () => document.documentElement.style.getPropertyValue(RUN_BAR_CLEAR_VAR);
const sorted = (classes: string) => classes.split(/\s+/).filter(Boolean).sort();

/** Main's bar, with the short-screen unpin #217 added. Nothing here may move. */
const DESKTOP_BAR =
  'sticky top-[calc(var(--header-clear)+8px)] z-40 -mt-3 [@media(max-height:499px)]:static flex flex-col gap-3 rounded-lg border border-line-em bg-solid px-5 py-3';

/** The console with a slot after it, the way the Connect screen draws the two. */
function ConsoleWithSlot() {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <div data-testid="page">
      <LiveRunConsole port={port()} category="ASI01" signedIn barSlot={slot} />
      <div data-testid="slot" ref={setSlot} />
    </div>
  );
}

async function issue() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
  await within(dock()).findByText('AGENT CONNECTED');
  return user;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.style.removeProperty(RUN_BAR_CLEAR_VAR);
});

describe('the query that pins the bar to the bottom', () => {
  it('is the same query the `phone-tall:` CSS variant is built on', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
    const variant = /@custom-variant phone-tall \{\s*@media ([^{]+?)\s*\{/.exec(css);
    expect(variant?.[1]).toBe(RUN_BAR_PIN_QUERY);
  });

  it('is a phone held upright: under 768px wide, and not under 500px tall', () => {
    // Under 500px of height the bar is not pinned at all (#217), top or bottom.
    expect(RUN_BAR_PIN_QUERY).toBe('(max-width: 767.98px) and (min-height: 500px)');
  });
});

describe('the document clears the pinned bar', () => {
  it('pads the bottom of the scrollport by the measured bar, and by nothing until one is measured', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
    expect(css).toMatch(/scroll-padding-bottom:\s*var\(--run-bar-clear, 0px\);/);
    // Written by script only, never declared: a set value would pad every screen.
    expect(css).not.toMatch(/--run-bar-clear:/);
  });
});

describe('on a phone held upright', () => {
  beforeEach(() => {
    stubPhone(true);
    FakeResizeObserver.made = [];
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  });

  it('draws the bar in the slot, after everything else, and only once', async () => {
    render(<ConsoleWithSlot />);
    await issue();

    const slot = screen.getByTestId('slot');
    expect(slot).toContainElement(dock());
    expect(screen.getAllByRole('region', { name: /what we have actually seen/i })).toHaveLength(1);
    // Last in the document: every other control of the run comes before it.
    const copy = screen.getByRole('button', { name: /copy task goal/i });
    expect(copy.compareDocumentPosition(dock()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the one live region, in the bar, and the heading that names it', async () => {
    render(<ConsoleWithSlot />);
    await issue();

    const statuses = within(dock()).getAllByRole('status');
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toHaveTextContent('AGENT CONNECTED');
    expect(screen.getByRole('heading', { name: 'What we have actually seen.' })).toBeVisible();
  });

  it('is not sticky itself and never fixed: the slot is what holds it', async () => {
    render(<ConsoleWithSlot />);
    await issue();

    const classes = sorted(dock().className);
    expect(classes).not.toContain('sticky');
    expect(classes).not.toContain('fixed');
    // Room for the home indicator, wherever the viewport reaches under it.
    expect(dock().className).toContain('env(safe-area-inset-bottom)');
  });

  it('keeps END RUN in the bar and DISCARD RUN out of it, before it in the document', async () => {
    render(<ConsoleWithSlot />);
    await issue();

    expect(within(dock()).getByRole('button', { name: /end run and judge/i })).toBeVisible();
    const narrow = within(screen.getByTestId('discard-run-narrow')).getByRole('button');
    expect(dock()).not.toContainElement(narrow);
    expect(narrow.compareDocumentPosition(dock()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens the discard question outside the bar, with KEEP RUNNING focused', async () => {
    render(<ConsoleWithSlot />);
    const user = await issue();
    await user.click(within(screen.getByTestId('discard-run-narrow')).getByRole('button'));

    const group = screen.getByRole('group', { name: /discard this run/i });
    expect(dock()).not.toContainElement(group);
    expect(group.compareDocumentPosition(dock()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(group).getByRole('button', { name: 'KEEP RUNNING' })).toHaveFocus();
  });

  it('drops the scroll margin that cleared a bar pinned at the top', async () => {
    render(<ConsoleWithSlot />);
    await issue();

    const column = screen.getByRole('heading', {
      name: 'What we have actually seen.',
    }).parentElement!;
    expect(sorted(column.className)).toContain(
      'phone-tall:[&_:is(a,button,[tabindex])]:scroll-mt-0',
    );
  });

  it('writes the measured bar height, plus a small gap, for the scroll padding', async () => {
    const original = HTMLElement.prototype.getBoundingClientRect;
    let barHeight = 96;
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      return this.getAttribute('aria-labelledby') === 'connect-state'
        ? ({ height: barHeight } as DOMRect)
        : original.call(this);
    };
    try {
      const { unmount } = render(<ConsoleWithSlot />);
      await issue();
      expect(clearance()).toBe('104px');

      const observer = FakeResizeObserver.made.at(-1)!;
      expect(observer.observed.at(-1)!.el).toBe(dock());
      barHeight = 170.4;
      observer.callback();
      expect(clearance()).toBe('179px');

      unmount();
      expect(clearance()).toBe('');
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original;
    }
  });

  it('stays in the column when no slot was handed over', async () => {
    render(<LiveRunConsole port={port()} category="ASI01" signedIn />);
    await issue();

    expect(sorted(dock().className)).toEqual(sorted(DESKTOP_BAR));
    expect(clearance()).toBe('');
  });
});

describe('everywhere else', () => {
  beforeEach(() => stubPhone(false));

  it('leaves the bar in the column with the classes it has on main, and the slot empty', async () => {
    render(<ConsoleWithSlot />);
    await issue();

    expect(screen.getByTestId('slot')).toBeEmptyDOMElement();
    expect(sorted(dock().className)).toEqual(sorted(DESKTOP_BAR));
    const column = dock().parentElement!;
    expect(column.className).toContain('panel-in');
    // It leads the column, directly after the heading that names it.
    expect(dock().previousElementSibling).toBe(
      screen.getByRole('heading', { name: 'What we have actually seen.' }),
    );
    expect(clearance()).toBe('');
  });
});

describe('the hook that measures the bar', () => {
  function Probe({ active }: { active: boolean }) {
    const ref = useRunBarClearance(active);
    return <div ref={ref} />;
  }

  it('writes nothing while the bar is not pinned, and nothing where there is no ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    render(<Probe active={false} />);
    expect(clearance()).toBe('');

    vi.stubGlobal('ResizeObserver', undefined);
    render(<Probe active />);
    expect(clearance()).toBe('');
  });
});

describe('the Connect screen', () => {
  it('ends with the empty slot the bar is moved into, sticky at the bottom', () => {
    const { container } = render(<ConnectScreen signedIn={false} />);
    const slot = screen.getByTestId('run-bar-slot');

    expect(container.firstElementChild!.lastElementChild).toBe(slot);
    expect(slot).toBeEmptyDOMElement();
    const classes = sorted(slot.className);
    expect(classes).toContain('sticky');
    expect(classes).toContain('bottom-0');
    // Empty at every other size, and then it takes no room at all.
    expect(classes).toContain('empty:hidden');
    expect(classes).not.toContain('fixed');
  });
});
