import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CopyOut } from '@/components/connect/CopyOut';
import { LiveRunConsole } from '@/components/connect/LiveRunConsole';
import {
  claudeCodeConfig,
  codexConfig,
  cursorConfig,
  geminiConfig,
  genericConfig,
  vsCodeConfig,
} from '@/lib/mcp/config';
import type { ConnectLiveRunPort, LiveRunTicketView } from '@/components/connect/live-run-port';

/**
 * WHEN COPYING FAILS, THE READER CAN STILL GET A CONFIG THAT WORKS.
 *
 * A config block draws its token as a mask and copies the real one. If the
 * clipboard refuses (no async clipboard on a plain-http address, an in-app
 * browser, a denied write), the old fallback told the reader to "Reveal the
 * value and select it by hand", but a config block has no reveal, and selecting
 * what it draws gives a config whose bearer is a row of bullets.
 *
 * The approved exception to "the real token never reaches the DOM": ONLY after a
 * copy has failed AND the reader presses SHOW CONFIG is the real config drawn,
 * beside the sentence "This contains your run token. Don't share it." Every other
 * path keeps the mask, and every fallback sentence names a control that exists.
 */

const TICKET: LiveRunTicketView = {
  runId: 'run-91',
  endpoint: 'https://mcproof.dev/api/mcp/run-91',
  token: `rt_${'c'.repeat(32)}_${'d'.repeat(64)}`,
  expiresAt: '2099-01-01T00:00:00.000Z',
  category: 'ASI02',
  kind: 'malicious',
  promptName: 'session_brief',
  taskGoal: 'Tidy the shared drive and report what you moved.',
};

const WARNING = "This contains your run token. Don't share it.";

function port(): ConnectLiveRunPort {
  return {
    start: vi.fn(async () => ({ ok: true as const, value: TICKET })),
    readState: vi.fn(async () => ({
      ok: true as const,
      value: {
        runId: 'run-91',
        phase: 'waiting' as const,
        connectedAt: null,
        lastSeenAt: null,
        steps: 0,
        toolCalls: 0,
        finishedAt: null,
      },
    })),
    finish: vi.fn(async () => ({
      ok: false as const,
      refusal: { code: 'RUN_NOT_FOUND' as const, message: 'That run was not found.' },
    })),
    reattach: vi.fn(async () => ({
      ok: false as const,
      refusal: { code: 'RUN_NOT_FOUND' as const, message: 'That run was not found.' },
    })),
  };
}

/** A clipboard that refuses every write, as a denied permission does. */
function denyClipboard() {
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => {
    throw new DOMException('Write permission denied.', 'NotAllowedError');
  });
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

/** No async clipboard at all, as on a plain-http LAN address. */
function removeClipboard() {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
}

function allowClipboard() {
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

const TABS = {
  code: { tab: /^claude code$/i, build: claudeCodeConfig },
  vscode: { tab: /^github copilot \/ vs code\b/i, build: vsCodeConfig },
  cursor: { tab: /^cursor\b/i, build: cursorConfig },
  codex: { tab: /^codex\b/i, build: codexConfig },
  gemini: { tab: /^gemini cli\b/i, build: geminiConfig },
  other: { tab: /^other agent$/i, build: genericConfig },
} as const;
type TabId = keyof typeof TABS;
const TAB_IDS = Object.keys(TABS) as TabId[];

const picker = () => screen.getByRole('group', { name: /mcp client/i });
const block = () => screen.getByTestId('config-block');
const body = () => `${document.body.textContent ?? ''}${document.body.innerHTML}`;

async function opened() {
  const user = userEvent.setup();
  render(<LiveRunConsole port={port()} category="ASI02" signedIn />);
  await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
  await screen.findByText(TICKET.endpoint);
  return user;
}

async function pick(user: ReturnType<typeof userEvent.setup>, id: TabId) {
  await user.click(within(picker()).getByRole('button', { name: TABS[id].tab }));
}

/** Press a button and let its async clipboard call settle. */
async function press(button: HTMLElement) {
  await act(async () => {
    fireEvent.click(button);
  });
}

const copyConfig = () => press(within(block()).getByRole('button', { name: /^copy /i }));
const showButton = () => within(block()).queryByRole('button', { name: /^show config$/i });
const hideButton = () => within(block()).queryByRole('button', { name: /^hide config$/i });

describe('copy failed · a config block offers SHOW CONFIG, and only then', () => {
  it.each(TAB_IDS)(
    '%s: a denied copy offers SHOW CONFIG, which draws exactly the copied config and the warning',
    async (id) => {
      const user = await opened();
      await pick(user, id);
      const writeText = denyClipboard();

      expect(showButton()).toBeNull();
      await copyConfig();

      // The copy really was attempted with the real config.
      const expected = TABS[id].build(TICKET.endpoint, TICKET.token);
      expect(writeText).toHaveBeenCalledWith(expected);

      // Before SHOW CONFIG is pressed, the token is still nowhere in the page.
      expect(showButton()).toBeInTheDocument();
      expect(body()).not.toContain(TICKET.token);
      expect(within(block()).queryByText(WARNING)).toBeNull();

      await press(showButton()!);

      const drawn = within(block()).getByRole('group', { name: /config$/i });
      expect(drawn.textContent).toBe(expected);
      expect(within(block()).getByText(WARNING)).toBeInTheDocument();

      // HIDE takes it back off the page.
      await press(hideButton()!);
      expect(body()).not.toContain(TICKET.token);
      expect(within(block()).queryByText(WARNING)).toBeNull();
      expect(showButton()).toBeInTheDocument();
    },
  );

  it('works the same when there is no async clipboard at all', async () => {
    const user = await opened();
    await pick(user, 'codex');
    removeClipboard();

    await copyConfig();
    expect(body()).not.toContain(TICKET.token);
    await press(showButton()!);
    expect(within(block()).getByRole('group', { name: /config$/i }).textContent).toBe(
      codexConfig(TICKET.endpoint, TICKET.token),
    );
  });

  it('never offers SHOW CONFIG when copying works, on any tab', async () => {
    const user = await opened();
    const writeText = allowClipboard();
    for (const id of TAB_IDS) {
      await pick(user, id);
      for (const button of within(document.getElementById('connect-client-panel')!).getAllByRole(
        'button',
        { name: /^copy /i },
      )) {
        await press(button);
      }
      expect(screen.queryByRole('button', { name: /^show /i })).toBeNull();
      expect(body()).not.toContain(TICKET.token);
    }
    expect(writeText).toHaveBeenCalled();
  });

  it('a failed copy alone reveals nothing: the token stays off the page on every tab', async () => {
    const user = await opened();
    denyClipboard();
    for (const id of TAB_IDS) {
      await pick(user, id);
      for (const button of within(document.getElementById('connect-client-panel')!).getAllByRole(
        'button',
        { name: /^copy /i },
      )) {
        await press(button);
      }
      expect(body()).not.toContain(TICKET.token);
    }
  });

  it('switching tabs masks it again', async () => {
    const user = await opened();
    await pick(user, 'cursor');
    denyClipboard();
    await copyConfig();
    await press(showButton()!);
    expect(body()).toContain(TICKET.token);

    await pick(user, 'gemini');
    expect(body()).not.toContain(TICKET.token);
    await pick(user, 'cursor');
    expect(body()).not.toContain(TICKET.token);
    expect(showButton()).toBeNull();
  });

  it('the revealed config is selectable text in the same scrollable, keyboard reachable box', async () => {
    const user = await opened();
    await pick(user, 'vscode');
    denyClipboard();
    await copyConfig();
    await press(showButton()!);

    const pre = within(block()).getByRole('group', { name: /config$/i });
    expect(pre.tagName).toBe('PRE');
    expect(pre.className).toMatch(/overflow-x-auto/);
    expect(pre.className).not.toMatch(/select-none/);
    expect(pre).toHaveAttribute('tabindex', '0');
    // The warning is a sentence a person reads: READING role, never a label.
    const warning = within(block()).getByText(WARNING);
    expect(warning.className).toMatch(/\breading\b/);
    expect(warning.className).not.toMatch(/micro-label|instrument/);
    // The control is a real 44px button.
    expect(hideButton()!.className).toMatch(/\bmin-h-11\b/);
  });

  it('says to press SHOW CONFIG, a control that is there, and not "Reveal the value"', async () => {
    const user = await opened();
    await pick(user, 'code');
    denyClipboard();
    await copyConfig();

    const text = block().textContent ?? '';
    expect(text).not.toMatch(/reveal the value/i);
    expect(text).toMatch(/SHOW CONFIG/);
  });
});

describe('copy failed · every other box names a control it really has', () => {
  it('the masked Code panel command offers SHOW COMMAND, with the same rules', async () => {
    const user = await opened();
    await pick(user, 'code');
    denyClipboard();
    const route = screen.getByTestId('code-panel-route');
    await press(within(route).getByRole('button', { name: /copy claude code transport command/i }));

    expect(body()).not.toContain(TICKET.token);
    await press(within(route).getByRole('button', { name: /^show command$/i }));
    const drawn = within(route).getByRole('group', { name: /transport command$/i });
    expect(drawn.textContent).toBe(
      `claude mcp add --transport http mcp-run ${TICKET.endpoint} ` +
        `--header "Authorization: Bearer ${TICKET.token}"`,
    );
    expect(within(route).getByText(WARNING)).toBeInTheDocument();
  });

  it('the masked header value offers SHOW VALUE, with the same rules', async () => {
    const user = await opened();
    await pick(user, 'other');
    denyClipboard();
    await press(screen.getByRole('button', { name: /copy header value/i }));

    expect(body()).not.toContain(TICKET.token);
    await press(screen.getByRole('button', { name: /^show value$/i }));
    expect(screen.getByRole('group', { name: /^header value$/i }).textContent).toBe(
      `Bearer ${TICKET.token}`,
    );
  });

  it('the run token box points at its own REVEAL control', async () => {
    await opened();
    denyClipboard();
    await press(screen.getByRole('button', { name: /copy run token/i }));

    const box = screen
      .getByRole('button', { name: /reveal run token/i })
      .closest('div.rounded-lg')!;
    const text = box.textContent ?? '';
    expect(text).toMatch(/Press REVEAL, then select the run token by hand/);
    expect(text).not.toMatch(/SHOW/);
    // The failure itself reveals nothing.
    expect(body()).not.toContain(TICKET.token);
  });

  it('a box already in full view says to select it, and names no reveal at all', async () => {
    await opened();
    denyClipboard();
    await press(screen.getByRole('button', { name: /copy run endpoint/i }));

    const box = screen
      .getByRole('button', { name: /copy run endpoint/i })
      .closest('div.rounded-lg')!;
    const text = box.textContent ?? '';
    expect(text).toMatch(/copying did not work/i);
    expect(text).not.toMatch(/reveal|SHOW/i);
  });

  it('no box anywhere still says "Reveal the value"', async () => {
    const user = await opened();
    denyClipboard();
    for (const id of TAB_IDS) {
      await pick(user, id);
      for (const button of screen.getAllByRole('button', { name: /^copy /i })) await press(button);
      expect(document.body.textContent ?? '').not.toMatch(/reveal the value/i);
    }
  });
});

describe('copy failed · CopyOut on its own', () => {
  it('a new value masks it again and forgets the failure', async () => {
    denyClipboard();
    const { rerender } = render(
      <CopyOut
        label="X"
        name="test config"
        tone="code"
        value="real-1"
        display="mask"
        reveal="CONFIG"
      />,
    );
    await press(screen.getByRole('button', { name: /copy test config/i }));
    await press(screen.getByRole('button', { name: /^show config$/i }));
    expect(screen.getByRole('group').textContent).toBe('real-1');

    rerender(
      <CopyOut
        label="X"
        name="test config"
        tone="code"
        value="real-2"
        display="mask"
        reveal="CONFIG"
      />,
    );
    expect(screen.getByRole('group').textContent).toBe('mask');
    expect(document.body.textContent).not.toContain('real-');
    expect(screen.queryByRole('button', { name: /^show config$/i })).toBeNull();
  });

  it('a later successful copy hides it again', async () => {
    denyClipboard();
    render(
      <CopyOut
        label="X"
        name="test config"
        tone="code"
        value="real-1"
        display="mask"
        reveal="CONFIG"
      />,
    );
    await press(screen.getByRole('button', { name: /copy test config/i }));
    await press(screen.getByRole('button', { name: /^show config$/i }));
    allowClipboard();
    await press(screen.getByRole('button', { name: /copy test config/i }));
    expect(document.body.textContent).not.toContain('real-1');
  });

  it('logs nothing when a copy fails or the config is shown', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    denyClipboard();
    render(
      <CopyOut
        label="X"
        name="test config"
        tone="code"
        value="real-1"
        display="mask"
        reveal="CONFIG"
      />,
    );
    await press(screen.getByRole('button', { name: /copy test config/i }));
    await press(screen.getByRole('button', { name: /^show config$/i }));
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});
