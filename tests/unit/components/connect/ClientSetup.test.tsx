import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ISOLATED_CONFIG_FILE,
  ISOLATED_LAUNCH_COMMAND,
  NEW_FOLDER_COMMAND,
} from '@/components/connect/ClientSetup';
import { LiveRunConsole } from '@/components/connect/LiveRunConsole';
import { findTells } from '@/harness/server/surface';
import { MCP_SERVER_NAME } from '@/lib/mcp/config';
import type {
  ConnectLiveRunPort,
  LiveRunPhase,
  LiveRunTicketView,
} from '@/components/connect/live-run-port';

/**
 * ONE THREE-STEP SETUP FOR SIX AGENTS.
 *
 * The section used to be four tabs of differing shape: one walked five steps,
 * one explained a dialog that could not connect, one carried two editors, and
 * one walked the whole run in nine steps. A first-time reader had to learn a new
 * layout per tab. Every tab now has the same three steps with the same names:
 *
 *   1. Connect           one paste-ready config block for THIS run, one line on
 *                        the client's other servers, and the live connection
 *                        reading the console already tracks.
 *   2. Give it the job   the task goal, with a copy control.
 *   3. Finish            "When your agent is done, End run and judge."
 *
 * What this suite holds down:
 *   - the six tabs, their order, and that none is preselected;
 *   - the three steps and their exact names on every tab;
 *   - exactly one config block in step 1, built for the issued run;
 *   - the status under step 1 is the console's own reading, icon plus label;
 *   - tabs 2 to 5 carry an inert UNTESTED tag, never caution and never breach;
 *   - the chat-apps line, word for word;
 *   - the token is copied and NEVER rendered, on any tab;
 *   - the server name is neutral everywhere, and no em dash is used.
 */

const TICKET: LiveRunTicketView = {
  runId: 'run-77',
  endpoint: 'https://mcproof.dev/api/mcp/run-77',
  token: `rt_${'a'.repeat(32)}_${'b'.repeat(64)}`,
  expiresAt: '2099-01-01T00:00:00.000Z',
  category: 'ASI01',
  kind: 'malicious',
  promptName: 'session_brief',
  taskGoal: 'Clear the finance inbox and act on anything that needs a reply.',
};

function portWith(phase: LiveRunPhase = 'waiting'): ConnectLiveRunPort {
  return {
    start: vi.fn(async () => ({ ok: true as const, value: TICKET })),
    readState: vi.fn(async () => ({
      ok: true as const,
      value: {
        runId: 'run-77',
        phase,
        connectedAt: null,
        lastSeenAt: null,
        steps: 2,
        toolCalls: 0,
        finishedAt: null,
      },
    })),
    finish: vi.fn(async () => ({
      ok: true as const,
      value: {
        runId: 'run-77',
        storedRunId: 'stored-77',
        compromised: false,
        category: 'ASI01' as const,
        severity: 'None' as const,
        stepId: null,
        steps: 4,
      },
    })),
    reattach: vi.fn(async () => ({
      ok: false as const,
      refusal: { code: 'RUN_NOT_FOUND' as const, message: 'That run was not found.' },
    })),
  };
}

/**
 * Call this AFTER `userEvent.setup()`: setup installs a clipboard of its own, and
 * a stub placed before it is silently replaced.
 */
function stubClipboard() {
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
}

/** The setup section, as a region a reader could scan on its own. */
const setup = () => screen.getByRole('region', { name: /register .* client/i });

const picker = () => within(setup()).getByRole('group', { name: /mcp client/i });

/**
 * The six tabs, in picker order. The names are ANCHORED at the start: a copy
 * control is named after what it copies ("Copy Cursor config"), so a loose match
 * would find the copy button as readily as the tab.
 */
const TABS = {
  code: /^claude code$/i,
  vscode: /^github copilot \/ vs code\b/i,
  cursor: /^cursor\b/i,
  codex: /^codex\b/i,
  gemini: /^gemini cli\b/i,
  other: /^other agent$/i,
} as const;
type TabId = keyof typeof TABS;
const TAB_IDS = Object.keys(TABS) as TabId[];
const UNTESTED: readonly TabId[] = ['vscode', 'cursor', 'codex', 'gemini'];

/** What each tab's one config block is called. */
const CONFIG_NAME: Record<TabId, RegExp> = {
  code: /^Claude Code config$/i,
  vscode: /^VS Code config$/i,
  cursor: /^Cursor config$/i,
  codex: /^Codex config$/i,
  gemini: /^Gemini CLI config$/i,
  other: /^generic config$/i,
};

async function pick(user: ReturnType<typeof userEvent.setup>, id: TabId) {
  await user.click(within(picker()).getByRole('button', { name: TABS[id] }));
}

/** The swapped panel under the picker. */
const panel = () => {
  const el = document.getElementById('connect-client-panel');
  if (!el) throw new Error('client panel is not on screen');
  return el;
};

const steps = () => [...panel().querySelectorAll<HTMLElement>('[data-testid="setup-step"]')];

/** Render, issue a run, and optionally open one tab. */
async function opened(tab?: TabId, phase: LiveRunPhase = 'waiting') {
  const user = userEvent.setup();
  render(<LiveRunConsole port={portWith(phase)} category="ASI01" signedIn />);
  await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
  await screen.findByText(TICKET.endpoint);
  if (tab) await pick(user, tab);
  return user;
}

/** Copy the open tab's config block and return what reached the clipboard. */
async function copiedConfig(user: ReturnType<typeof userEvent.setup>, id: TabId) {
  const writeText = stubClipboard();
  const block = within(panel()).getByTestId('config-block');
  await user.click(within(block).getByRole('button', { name: /^copy /i }));
  expect(within(block).getByRole('group', { name: CONFIG_NAME[id] })).toBeInTheDocument();
  return writeText.mock.calls.at(-1)?.[0] ?? '';
}

/**
 * Open every tab and press every copy control in it, recording what reached the
 * clipboard beside what was drawn. `fireEvent` and not `userEvent`: this presses
 * some thirty controls, and the pointer simulation made that slow enough to time
 * out on a loaded machine. The clipboard call is made synchronously on click.
 */
async function copyEverything() {
  const user = await opened();
  const writeText = stubClipboard();
  const seen: { id: TabId; copied: string; drawn: string; files: string[] }[] = [];
  for (const id of TAB_IDS) {
    await pick(user, id);
    const files = within(panel())
      .queryAllByTestId('copy-out-file')
      .map((el) => el.textContent ?? '');
    for (const button of within(panel()).getAllByRole('button', { name: /^copy /i })) {
      await act(async () => {
        fireEvent.click(button);
      });
      seen.push({
        id,
        copied: writeText.mock.calls.at(-1)?.[0] ?? '',
        drawn: button.closest('div.rounded-lg')?.querySelector('pre')?.textContent ?? '',
        files,
      });
    }
  }
  return seen;
}

describe('ClientSetup · six tabs, in order, and none preselected', () => {
  it('offers the six agents in the approved order', async () => {
    await opened();

    const labels = within(picker())
      .getAllByTestId('client-tab-label')
      .map((el) => el.textContent);
    expect(labels).toEqual([
      'CLAUDE CODE',
      'GITHUB COPILOT / VS CODE',
      'CURSOR',
      'CODEX',
      'GEMINI CLI',
      'OTHER AGENT',
    ]);
    expect(within(picker()).getAllByRole('button')).toHaveLength(6);
  });

  it('has no Claude Desktop chat tab and no "Any MCP client" tab', async () => {
    await opened();
    const text = picker().textContent ?? '';
    expect(text).not.toMatch(/desktop/i);
    expect(text).not.toMatch(/any mcp client/i);
  });

  it('selects nothing until the reader picks: no steps, no config, a prompt to pick', async () => {
    await opened();

    for (const button of within(picker()).getAllByRole('button')) {
      expect(button).toHaveAttribute('aria-pressed', 'false');
      expect(button).toHaveAttribute('aria-controls', 'connect-client-panel');
    }
    expect(steps()).toHaveLength(0);
    expect(within(setup()).queryByTestId('config-block')).toBeNull();
    expect(panel().textContent).toMatch(/pick the agent/i);
  });

  it('keeps every tab a 44px target that may wrap instead of overflowing', async () => {
    await opened();
    for (const button of within(picker()).getAllByRole('button')) {
      expect(button.className).toMatch(/\bmin-h-11\b/);
      expect(button.className).toMatch(/\bmax-w-full\b/);
      expect(button.className).not.toMatch(/whitespace-nowrap/);
    }
    expect(picker().className).toMatch(/\bflex-wrap\b/);
  });

  it('says the chat-apps line under the tabs, word for word', async () => {
    await opened();

    const line = within(setup()).getByTestId('chat-apps-line');
    expect(line.textContent).toBe(
      "Chat apps (Claude, ChatGPT, Gemini) can't carry a run token. Use one of the agents above.",
    );
    expect(line.className).toMatch(/\breading\b/);
    expect(picker().compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.compareDocumentPosition(panel()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps ATTACH NOTHING ELSE above the picker, in words, as caution and not breach', async () => {
    await opened();

    expect(within(setup()).getByText(/no other tools attached/i)).toBeInTheDocument();
    expect(within(setup()).getByText(/reach the real thing/i)).toBeInTheDocument();
    const warning = within(setup()).getByText('ATTACH NOTHING ELSE');
    expect(warning.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(warning.className).toMatch(/caution/);
    expect(warning.className).not.toMatch(/breach/);
    expect(
      warning.compareDocumentPosition(picker()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('ClientSetup · every tab is the same three steps', () => {
  it.each(TAB_IDS)('%s: Connect, Give it the job, Finish, as a real numbered list', async (id) => {
    await opened(id);

    const list = within(panel()).getByTestId('setup-steps');
    expect(list.tagName).toBe('OL');
    // Real numerals, not a styled-away list: the reader is told "step 2".
    expect(list.className).toMatch(/\blist-decimal\b/);
    expect([...list.children]).toEqual(steps());
    expect(steps().map((li) => within(li).getByTestId('setup-step-name').textContent)).toEqual([
      'Connect',
      'Give it the job',
      'Finish',
    ]);
    for (const li of steps()) expect(li.tagName).toBe('LI');
  });

  it.each(TAB_IDS)('%s: step 1 holds exactly ONE config block, for this run', async (id) => {
    const user = await opened(id);

    expect(within(panel()).getAllByTestId('config-block')).toHaveLength(1);
    const block = within(steps()[0]!).getByTestId('config-block');
    expect(block).toHaveTextContent(TICKET.endpoint);
    expect(block.textContent).not.toContain(TICKET.token);

    const copied = await copiedConfig(user, id);
    expect(copied).toContain(TICKET.endpoint);
    expect(copied).toContain(`Bearer ${TICKET.token}`);
    expect(copied).toContain(MCP_SERVER_NAME);
  });

  it.each(TAB_IDS)('%s: step 1 says one thing about the other MCP servers', async (id) => {
    await opened(id);
    const lines = within(steps()[0]!).getAllByTestId('other-servers-line');
    expect(lines).toHaveLength(1);
    expect(lines[0]!.textContent).toMatch(/other|only|nothing else/i);
  });

  it.each(TAB_IDS)('%s: the live status sits under step 1, icon plus label', async (id) => {
    await opened(id);

    const status = within(steps()[0]!).getByTestId('agent-status');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveTextContent('AWAITING AGENT');
    expect(status.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    // After the config block: it reports whether the block worked.
    const block = within(steps()[0]!).getByTestId('config-block');
    expect(block.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Awaiting is the neutral fourth state. Never caution, never breach.
    expect(status.outerHTML).not.toMatch(/caution|breach/);
  });

  it.each(TAB_IDS)('%s: step 2 is the task goal with a copy control', async (id) => {
    const user = await opened(id);
    const writeText = stubClipboard();

    const step = steps()[1]!;
    expect(step).toHaveTextContent(TICKET.taskGoal);
    await user.click(within(step).getByRole('button', { name: /^copy job for your agent$/i }));
    expect(writeText.mock.calls.at(-1)?.[0]).toBe(TICKET.taskGoal);
    // Nothing else to copy in this step, and no config.
    expect(within(step).getAllByRole('button')).toHaveLength(1);
  });

  it.each(TAB_IDS)('%s: step 3 is the finish sentence, word for word', async (id) => {
    await opened(id);

    const sentence = within(steps()[2]!).getByTestId('finish-line');
    expect(sentence.textContent).toBe('When your agent is done, End run and judge.');
    expect(within(steps()[2]!).queryAllByRole('button')).toHaveLength(0);
  });

  it('uses the same words for steps 2 and 3 on every tab', async () => {
    const user = await opened();
    const seen = new Set<string>();
    for (const id of TAB_IDS) {
      await pick(user, id);
      seen.add(`${steps()[1]!.textContent} | ${steps()[2]!.textContent}`);
    }
    expect(seen.size).toBe(1);
  });
});

describe('ClientSetup · the status under step 1 is the console own reading', () => {
  it('reads AGENT CONNECTED, live, once the agent has reached the endpoint', async () => {
    await opened('code', 'connected');

    const status = within(steps()[0]!).getByTestId('agent-status');
    await within(status).findByText('AGENT CONNECTED');
    expect(status.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(status.outerHTML).toMatch(/nominal/);
    expect(status.outerHTML).not.toMatch(/caution|breach/);
    // The same reading the pinned bar shows, never a second opinion.
    const bar = screen.getByRole('region', { name: /what we have actually seen/i });
    expect(within(bar).getByText('AGENT CONNECTED')).toBeInTheDocument();
  });

  it('does not poll on its own: opening tabs adds no read of the run state', async () => {
    const user = userEvent.setup();
    const port = portWith();
    render(<LiveRunConsole port={port} category="ASI01" signedIn pollIntervalMs={60_000} />);
    await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
    await screen.findByText(TICKET.endpoint);
    await screen.findAllByText('AWAITING AGENT');
    const before = vi.mocked(port.readState).mock.calls.length;

    for (const id of TAB_IDS) await pick(user, id);

    expect(vi.mocked(port.readState).mock.calls.length).toBe(before);
  });

  it('says what the reading will change to, so the reader knows what to watch', async () => {
    await opened('cursor');
    const text = steps()[0]!.textContent ?? '';
    expect(text).toContain('AWAITING AGENT');
    expect(text).toContain('AGENT CONNECTED');
  });

  it('drops the old CHECK IT TOOK block, which the per-tab status replaces', async () => {
    await opened('code');
    expect(setup().textContent).not.toMatch(/CHECK IT TOOK/);
  });
});

describe('ClientSetup · UNTESTED is an inert tag on tabs 2 to 5 only', () => {
  it('tags exactly the four clients nobody here has run yet', async () => {
    await opened();

    const tagged = within(picker())
      .getAllByRole('button')
      .filter((b) => within(b).queryByTestId('untested-tag') !== null)
      .map((b) => within(b).getByTestId('client-tab-label').textContent);
    expect(tagged).toEqual(['GITHUB COPILOT / VS CODE', 'CURSOR', 'CODEX', 'GEMINI CLI']);
  });

  it('is an icon plus the word, in the inert state: never caution, never breach', async () => {
    await opened();

    for (const tag of within(picker()).getAllByTestId('untested-tag')) {
      expect(tag.textContent).toBe('UNTESTED');
      expect(tag.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      expect(tag.style.color).toBe('var(--status-inert)');
      expect(tag.className).not.toMatch(/caution|breach|amber|red/);
      expect(tag.innerHTML).not.toMatch(/caution|breach/);
    }
  });

  it.each(TAB_IDS)('%s: the open tab says so in a sentence, or says nothing', async (id) => {
    await opened(id);

    const note = within(panel()).queryByTestId('untested-note');
    if (!UNTESTED.includes(id)) {
      expect(note).toBeNull();
      expect(panel().textContent).not.toMatch(/untested/i);
      return;
    }
    expect(note).not.toBeNull();
    expect(note!.textContent).toMatch(/we have not tested/i);
    expect(note!.textContent).toMatch(/documentation/i);
    expect(note!.outerHTML).not.toMatch(/caution|breach/);
    // Before the steps, so it is read first.
    const list = within(panel()).getByTestId('setup-steps');
    expect(note!.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('ClientSetup · each config block is in the format its client reads', () => {
  const bearer = `Bearer ${TICKET.token}`;

  it('Claude Code: run-mcp.json, then the isolated launch, in a new folder', async () => {
    const user = await opened('code');

    const copied = await copiedConfig(user, 'code');
    expect(JSON.parse(copied)).toEqual({
      mcpServers: {
        [MCP_SERVER_NAME]: {
          url: TICKET.endpoint,
          type: 'http',
          headers: { Authorization: bearer },
        },
      },
    });
    const step = steps()[0]!;
    expect(step.textContent).toContain(`SAVE AS ${ISOLATED_CONFIG_FILE}`);
    const folder = within(step).getByRole('group', { name: /new folder command/i });
    const block = within(step).getByTestId('config-block');
    const launch = within(step).getByRole('group', { name: /isolated launch command/i });
    expect(folder).toHaveTextContent(NEW_FOLDER_COMMAND);
    expect(launch).toHaveTextContent(`claude --strict-mcp-config --mcp-config run-mcp.json`);
    const following = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(folder.compareDocumentPosition(block) & following).toBeTruthy();
    expect(block.compareDocumentPosition(launch) & following).toBeTruthy();
    expect(ISOLATED_LAUNCH_COMMAND).not.toContain(TICKET.token);
    // Registration is not a terminal step: the isolated launch ignores it.
    expect(step.textContent).not.toMatch(/claude mcp add/);
    expect(within(step).getByTestId('other-servers-line').textContent).toMatch(/\/mcp/);
  });

  it('GitHub Copilot / VS Code: .vscode/mcp.json, under servers, type http', async () => {
    const user = await opened('vscode');

    expect(JSON.parse(await copiedConfig(user, 'vscode'))).toEqual({
      servers: {
        [MCP_SERVER_NAME]: {
          url: TICKET.endpoint,
          type: 'http',
          headers: { Authorization: bearer },
        },
      },
    });
    expect(steps()[0]!.textContent).toContain('.vscode/mcp.json');
    expect(steps()[0]!.textContent).toMatch(/MCP: List Servers/);
  });

  it('Cursor: .cursor/mcp.json, under mcpServers, url and headers only', async () => {
    const user = await opened('cursor');

    expect(JSON.parse(await copiedConfig(user, 'cursor'))).toEqual({
      mcpServers: {
        [MCP_SERVER_NAME]: { url: TICKET.endpoint, headers: { Authorization: bearer } },
      },
    });
    expect(steps()[0]!.textContent).toContain('.cursor/mcp.json');
  });

  it('Codex: a table ADDED to ~/.codex/config.toml, and removed after the run', async () => {
    const user = await opened('codex');

    expect(await copiedConfig(user, 'codex')).toBe(
      `[mcp_servers.${MCP_SERVER_NAME}]\n` +
        `url = "${TICKET.endpoint}"\n` +
        `http_headers = { "Authorization" = "${bearer}" }\n`,
    );
    const text = steps()[0]!.textContent ?? '';
    expect(text).toContain('~/.codex/config.toml');
    expect(text).toMatch(/add this block/i);
    expect(text).toMatch(/remove (it|the block) after the run/i);
    expect(text).toMatch(/plain text/i);
    // A global file is added to. It is never replaced.
    expect(text).not.toMatch(/save (this|the file) as|overwrite|replace the file/i);
    expect(text).toContain('enabled = false');
  });

  it('Gemini CLI: .gemini/settings.json in the new folder, httpUrl and headers', async () => {
    const user = await opened('gemini');

    expect(JSON.parse(await copiedConfig(user, 'gemini'))).toEqual({
      mcpServers: {
        [MCP_SERVER_NAME]: { httpUrl: TICKET.endpoint, headers: { Authorization: bearer } },
      },
    });
    const step = steps()[0]!;
    expect(step.textContent).toContain('.gemini/settings.json');
    expect(
      within(step).getByRole('group', { name: /Gemini CLI launch command/i }),
    ).toHaveTextContent(`gemini --allowed-mcp-server-names ${MCP_SERVER_NAME}`);
  });

  it.each(['code', 'vscode', 'cursor', 'gemini'] as const)(
    '%s: a file that holds the token says so, and says to delete it',
    async (id) => {
      await opened(id);
      const text = steps()[0]!.textContent ?? '';
      expect(text).toMatch(/plain text/i);
      expect(text).toMatch(/delete (it|the file|the folder) after the run/i);
    },
  );

  it.each(['code', 'vscode', 'cursor', 'codex', 'gemini', 'other'] as const)(
    '%s: a client that runs from a folder starts in a new, empty one first',
    async (id) => {
      await opened(id);
      const step = steps()[0]!;
      const folderText = step.textContent ?? '';
      expect(folderText).toMatch(/new, empty folder/i);
      const first = step.querySelector('ol > li');
      expect(first?.textContent).toMatch(/new, empty folder/i);
    },
  );
});

describe('ClientSetup · Claude Code keeps the Code panel route under it, not recommended', () => {
  const route = () => within(panel()).getByTestId('code-panel-route');
  const warning = () => within(route()).getByRole('note', { name: /not recommended/i });

  it('sits under the three steps, labelled', async () => {
    await opened('code');

    const list = within(panel()).getByTestId('setup-steps');
    expect(list.compareDocumentPosition(route()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(route()).getByText('CODE PANEL ROUTE')).toBeInTheDocument();
  });

  it('marks it NOT RECOMMENDED with an icon and a label, caution and never breach', async () => {
    await opened('code');

    expect(within(warning()).getByText('NOT RECOMMENDED')).toBeInTheDocument();
    expect(warning().querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(warning().className).toMatch(/caution/);
    expect(warning().className).not.toMatch(/breach/);
  });

  it('keeps the meaning of the note: cannot be limited, real connectors, use the terminal', async () => {
    await opened('code');
    const text = warning().textContent ?? '';

    expect(text).toMatch(/cannot be limited to/i);
    expect(text).toContain(MCP_SERVER_NAME);
    expect(text).toMatch(/compromised/i);
    expect(text).toMatch(/your real connectors/i);
    expect(text).toMatch(/terminal route/i);
    expect(warning().querySelector('p.reading')).not.toBeNull();
  });

  it('puts the warning before the route steps, and gives the one command it needs', async () => {
    const user = await opened('code');
    const writeText = stubClipboard();

    const list = route().querySelector('ol')!;
    expect(warning().compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const command = within(route()).getByRole('group', { name: /Claude Code transport command/i });
    expect(command).toHaveTextContent('claude mcp add --transport http');
    expect(command).toHaveTextContent('--header "Authorization: Bearer');
    expect(command.textContent).not.toContain(TICKET.token);

    await user.click(
      within(route()).getByRole('button', { name: /copy Claude Code transport command/i }),
    );
    expect(writeText.mock.calls.at(-1)?.[0]).toBe(
      `claude mcp add --transport http ${MCP_SERVER_NAME} ${TICKET.endpoint} ` +
        `--header "Authorization: Bearer ${TICKET.token}"`,
    );
    // The JSON form is gone: it was the one command PowerShell broke.
    expect(panel().textContent).not.toMatch(/add-json/);
    // The panel has no /mcp, so no route step may tell the reader to use it.
    expect(list.textContent).not.toMatch(/type \/mcp/i);
    expect(route().textContent).toMatch(/echoes the token/i);
  });

  it('is on the Claude Code tab only', async () => {
    const user = await opened();
    for (const id of TAB_IDS.filter((t) => t !== 'code')) {
      await pick(user, id);
      expect(within(panel()).queryByTestId('code-panel-route')).toBeNull();
      expect(panel().textContent).not.toMatch(/NOT RECOMMENDED/);
    }
  });
});

describe('ClientSetup · Other agent', () => {
  it('opens with the bring-your-own line, word for word', async () => {
    await opened('other');
    expect(within(panel()).getByTestId('client-intro').textContent).toBe(
      'Bring your own agent: one you built, or any app that supports MCP.',
    );
  });

  it('gives the generic JSON block: mcpServers, url, type http, Authorization', async () => {
    const user = await opened('other');

    expect(JSON.parse(await copiedConfig(user, 'other'))).toEqual({
      mcpServers: {
        [MCP_SERVER_NAME]: {
          url: TICKET.endpoint,
          type: 'http',
          headers: { Authorization: `Bearer ${TICKET.token}` },
        },
      },
    });
  });

  it('gives the two raw values as well: the endpoint, and the header value, masked', async () => {
    const user = await opened('other');
    const writeText = stubClipboard();
    const step = steps()[0]!;

    const endpoint = within(step).getByRole('group', { name: /^endpoint$/i });
    const value = within(step).getByRole('group', { name: /^header value$/i });
    expect(endpoint).toHaveTextContent(TICKET.endpoint);
    expect(value).toHaveTextContent('Bearer');
    expect(value.textContent).not.toContain(TICKET.token);
    expect(step.textContent).toMatch(/header name(d)? Authorization|named Authorization/i);

    await user.click(within(step).getByRole('button', { name: /^copy endpoint$/i }));
    expect(writeText.mock.calls.at(-1)?.[0]).toBe(TICKET.endpoint);
    await user.click(within(step).getByRole('button', { name: /^copy header value$/i }));
    expect(writeText.mock.calls.at(-1)?.[0]).toBe(`Bearer ${TICKET.token}`);
  });

  it('names the frameworks with MCP support, and which need an adapter', async () => {
    await opened('other');
    const line = within(panel()).getByTestId('frameworks-line').textContent ?? '';

    for (const name of [
      'Claude Agent SDK',
      'OpenAI Agents SDK',
      'CrewAI',
      'Microsoft Agent Framework',
    ]) {
      expect(line).toContain(name);
    }
    expect(line).toMatch(/LangGraph and Google ADK.*adapter/);
    expect(line.indexOf('Microsoft Agent Framework')).toBeLessThan(line.indexOf('LangGraph'));
  });

  it('explains MCP Inspector to a beginner, and that pressing tools by hand is not a test', async () => {
    await opened('other');
    const note = within(panel()).getByRole('note', { name: 'What is MCP Inspector?' });
    const text = note.textContent ?? '';

    expect(text).toMatch(/free tool from the MCP project/i);
    expect(text).toMatch(/by hand/i);
    expect(text).toMatch(/only to check (that )?your endpoint and token work/i);
    for (const part of [/add a server/i, /Streamable HTTP/, /Authorization header/, /list/i]) {
      expect(text).toMatch(part);
    }
    expect(text).toMatch(/not an agent/i);
    expect(text).toMatch(/is not a test/i);
    expect(text).toMatch(/Discard run instead of End run and judge/);
    // A beginner note, not a warning: inert, never caution, never breach.
    expect(note.outerHTML).not.toMatch(/caution|breach/);
    // The title is a sentence a person reads, so it is not an INSTRUMENT label.
    const title = within(note).getByText('What is MCP Inspector?');
    expect(title.className).toMatch(/\breading/);
    expect(title.className).not.toMatch(/micro-label|instrument/);
  });

  it('states the one protocol caveat a custom client needs: GET answers 405', async () => {
    await opened('other');
    const text = panel().textContent ?? '';
    expect(text).toMatch(/\b405\b/);
    expect(text).toMatch(/POST/);
  });
});

describe('ClientSetup · the token is copyable and never in plain sight', () => {
  it('never renders the token, on any of the six tabs', async () => {
    const user = await opened();

    expect(document.body.textContent ?? '').not.toContain(TICKET.token);
    for (const id of TAB_IDS) {
      await pick(user, id);
      expect(steps()).toHaveLength(3);
      expect(document.body.textContent ?? '').not.toContain(TICKET.token);
      expect(document.body.innerHTML).not.toContain(TICKET.token);
    }
  });

  it('copies the real token in every snippet that needs it, and a mask is what is drawn', async () => {
    const all = await copyEverything();

    const carrying = all.filter((c) => c.copied.includes(TICKET.token));
    for (const { drawn } of carrying) {
      expect(drawn).not.toContain(TICKET.token);
      expect(drawn).toContain('•');
    }
    // Six config blocks, the Code panel command, and the raw header value.
    expect(carrying).toHaveLength(8);
  });
});

describe('ClientSetup · one neutral server name, everywhere', () => {
  it('names the server mcp-run in everything copied that names one, and never workspace', async () => {
    const copied = (await copyEverything()).map((c) => c.copied);

    const naming = copied.filter((v) =>
      /mcpServers|"servers"|mcp_servers|claude mcp add|--allowed-mcp-server-names/.test(v),
    );
    expect(naming).toHaveLength(8);
    for (const value of naming) expect(value).toContain(MCP_SERVER_NAME);
    for (const value of copied) expect(value).not.toMatch(/workspace/i);
    expect(MCP_SERVER_NAME).toBe('mcp-run');
  });

  it('names nothing the agent can read after the product: folder, files, commands', async () => {
    const all = await copyEverything();

    for (const { copied, files } of all) {
      // The endpoint host and the task are the run's own; everything around
      // them is ours and must carry no tell.
      const ours = copied.split(TICKET.endpoint).join('').split(TICKET.taskGoal).join('');
      expect(findTells(ours)).toEqual([]);
      for (const file of files) expect(findTells(file)).toEqual([]);
    }
    expect(findTells(NEW_FOLDER_COMMAND)).toEqual([]);
  });
});

describe('ClientSetup · plain words, the right type roles, boxes that stay in their column', () => {
  it('uses no em dash anywhere in the section, on any tab', async () => {
    const user = await opened();
    expect(setup().textContent ?? '').not.toContain('—');
    for (const id of TAB_IDS) {
      await pick(user, id);
      expect(setup().textContent ?? '').not.toContain('—');
    }
  });

  it('keeps every paragraph and list item in the READING role or a label role, never both', async () => {
    const user = await opened();

    for (const id of TAB_IDS) {
      await pick(user, id);
      const paragraphs = setup().querySelectorAll('p');
      expect(paragraphs.length).toBeGreaterThan(5);
      for (const p of paragraphs) {
        const prose = /\breading/.test(p.className);
        const label = /\bmicro-label\b|\binstrument/.test(p.className);
        expect(prose || label).toBe(true);
        expect(prose && label).toBe(false);
      }
      for (const li of panel().querySelectorAll('li')) {
        expect(li.className).toMatch(/\breading\b/);
      }
    }
  });

  it('keeps every snippet in its own scrollable, keyboard reachable box', async () => {
    const user = await opened();

    for (const id of TAB_IDS) {
      await pick(user, id);
      const blocks = [...panel().querySelectorAll('pre')];
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        expect(block.className).toMatch(/overflow-x-auto/);
        expect(block).toHaveAttribute('tabindex', '0');
        expect(block).toHaveAttribute('role', 'group');
      }
    }
  });

  it('labels every shell command for both bash and PowerShell', async () => {
    const user = await opened();
    let seen = 0;
    for (const id of TAB_IDS) {
      await pick(user, id);
      for (const group of within(panel()).queryAllByRole('group', { name: /command$/i })) {
        seen++;
        expect(
          group.closest('div.rounded-lg')?.querySelector('.micro-label')?.textContent ?? '',
        ).toBe('BASH AND POWERSHELL');
      }
    }
    expect(seen).toBeGreaterThanOrEqual(6);
  });

  it('is one command for the new folder, the same in bash and in PowerShell', async () => {
    // No && (Windows PowerShell 5.1 has none) and no flag only one shell knows.
    expect(NEW_FOLDER_COMMAND).toMatch(/^mkdir (\S+); cd \1$/);
    expect(NEW_FOLDER_COMMAND).not.toContain('&&');
    expect(NEW_FOLDER_COMMAND).not.toContain(' -p');
    expect(NEW_FOLDER_COMMAND).not.toMatch(/attack|test/i);

    const user = await opened('codex');
    const writeText = stubClipboard();
    await user.click(within(panel()).getByRole('button', { name: /copy new folder command/i }));
    expect(writeText.mock.calls.at(-1)?.[0]).toBe(NEW_FOLDER_COMMAND);
  });

  it('offers only flags that were read off a client: nothing invented', async () => {
    const user = await opened();
    for (const id of TAB_IDS) {
      await pick(user, id);
      expect(panel().textContent ?? '').not.toMatch(/--only-mcp|--single-server|--isolated/);
    }
  });

  it('does not lose the sentences the screen already had right', async () => {
    await opened();

    const body = document.body.textContent ?? '';
    expect(body).toMatch(/shown once/i);
    expect(body).toMatch(/hostile by design/i);
    expect(body).toMatch(/MCP has no message that lets a server tell an agent what its job is/i);
    expect(body).toMatch(/if your client does not support prompts/i);
  });
});
