import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ISOLATED_CONFIG_FILE, ISOLATED_LAUNCH_COMMAND } from '@/components/connect/ClientSetup';
import { LiveRunConsole } from '@/components/connect/LiveRunConsole';
import { MCP_SERVER_NAME } from '@/lib/mcp/config';
import type { ConnectLiveRunPort, LiveRunTicketView } from '@/components/connect/live-run-port';

/**
 * HOW TO ACTUALLY CONNECT.
 *
 * The console issued a correct endpoint, a correct token and a correct goal, and
 * then told the reader "send it as a bearer token on the connection". That is
 * accurate and useless: it names no transport, gives no command for any client,
 * and assumes the reader already knows how to register a remote Streamable HTTP
 * MCP server with an auth header. A product whose whole promise is "bring your
 * own agent" has to say how to bring one.
 *
 * Six things this suite exists to hold down. The sixth is tested first, because
 * it is the shape everything else hangs on: every client is a numbered list of
 * steps, never paragraphs, and the two Claude Desktop paths are told apart.
 *
 *   1. THERE IS A REAL COMMAND, per client, built from the issued ticket, with
 *      the actual endpoint in it. Not a description of a command.
 *   2. THE COMMAND SURVIVES THE READER'S SHELL. Claude Code registers a server
 *      two ways in the same build. `add-json` breaks in Windows PowerShell, which
 *      strips the quotes inside its JSON, so both are given, labelled by shell,
 *      and the PowerShell reader is told which one to use.
 *   3. THE TOKEN STAYS A SECRET WHILE THE COMMAND STAYS USABLE. Every snippet
 *      copies the real credential and renders a mask, so a screen-shared Connect
 *      page spills nothing and a single click still works.
 *   4. ISOLATION, WITH THE REAL COMMAND. The tools we serve are hostile by
 *      design, so an agent holding real connectors must not be the one that
 *      connects. Claude Code has a flag that loads only the servers in one file
 *      (`--strict-mcp-config` with `--mcp-config`, read off its own help), so the
 *      screen shows that exact launch, says why, keeps the fallbacks for other
 *      clients, and admits the one thing no flag covers: tools built into the
 *      client itself. It still invents nothing.
 *   5. THE READER CAN TELL IT WORKED before wondering why nothing happens.
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

function portWith(): ConnectLiveRunPort {
  return {
    start: vi.fn(async () => ({ ok: true as const, value: TICKET })),
    readState: vi.fn(async () => ({
      ok: true as const,
      value: {
        runId: 'run-77',
        phase: 'waiting' as const,
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

/** Issue a run and wait for the ticket to be on screen. */
async function issued(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /issue run endpoint/i }));
  await screen.findByText(TICKET.endpoint);
}

/** The setup section, as a region a reader could scan on its own. */
const setup = () => screen.getByRole('region', { name: /register .* client/i });

/**
 * Switch the client picker. The names are ANCHORED on purpose: a copy control is
 * named after the snippet it copies ("Copy Claude Code add-json command"), so a
 * loose match would find the copy button as readily as the tab.
 */
async function pick(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(within(setup()).getByRole('button', { name }));
}

/** The four client tabs, in picker order, by their anchored names. */
const TABS = {
  code: /^claude code$/i,
  desktop: /^claude desktop \(chat\)$/i,
  editors: /^cursor \/ vs code$/i,
  generic: /^any mcp client$/i,
} as const;

/** The swapped panel under the picker. */
const panel = () => {
  const el = document.getElementById('connect-client-panel');
  if (!el) throw new Error('client panel is not on screen');
  return el;
};

/** Render, issue a run, and optionally open one tab. */
async function opened(tab?: RegExp) {
  const user = userEvent.setup();
  render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
  await issued(user);
  if (tab) await pick(user, tab);
  return user;
}

describe('ClientSetup · every client is numbered steps, never paragraphs', () => {
  it('offers four tabs, and none is selected until the reader picks one', async () => {
    await opened();

    const picker = within(setup()).getByRole('group', { name: /mcp client/i });
    const buttons = within(picker).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual([
      'CLAUDE CODE',
      'CLAUDE DESKTOP (CHAT)',
      'CURSOR / VS CODE',
      'ANY MCP CLIENT',
    ]);
    for (const button of buttons) expect(button).toHaveAttribute('aria-pressed', 'false');
    // No steps and no snippet until the reader asks for a client: a preselected
    // tab would make one vendor's command read as the way in.
    expect(within(setup()).queryByRole('list')).toBeNull();
    expect(
      within(setup()).queryByRole('group', { name: /command|configuration|file|header/i }),
    ).toBeNull();
  });

  it.each(Object.entries(TABS))(
    'renders the %s tab as a one-line intro, an ordered list, and its caveats',
    async (_id, tab) => {
      await opened(tab);

      const lists = panel().querySelectorAll('ol');
      // One numbered list per tab. Claude Code alone carries a second one, its
      // separately labelled Code panel route.
      expect(lists).toHaveLength(_id === 'code' ? 2 : 1);
      const steps = lists[0]!.querySelectorAll(':scope > li');
      expect(steps.length).toBeGreaterThanOrEqual(4);
      // Real numerals, not a styled-away list: the reader is told "step 3".
      expect(lists[0]!.className).toMatch(/\blist-decimal\b/);

      // No tab is pure prose. Exactly ONE paragraph of running text sits outside
      // the lists (the intro), and it is a sentence or two, not a block.
      const loose = [...panel().querySelectorAll('p.reading')].filter((p) => !p.closest('li'));
      expect(loose).toHaveLength(1);
      expect((loose[0]!.textContent ?? '').length).toBeLessThan(200);
      expect(
        loose[0]!.compareDocumentPosition(lists[0]!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      // The per-tab caveats are a list too, after the steps, and each tab carries
      // the same two: the token is shown once, and the run must be isolated.
      const caveats = panel().querySelector('ul');
      expect(caveats).not.toBeNull();
      expect(
        lists[0]!.compareDocumentPosition(caveats!) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      const caveatText = caveats!.textContent ?? '';
      expect(caveatText).toMatch(/shown once/i);
      expect(caveatText).toMatch(/attack run/i);

      // Every tab that can connect ends at the same place: the agent gets its
      // task goal. The Desktop chat tab cannot connect, so it ends by sending
      // the reader to a tab that can.
      expect(steps[steps.length - 1]!.textContent ?? '').toMatch(
        _id === 'desktop' ? /Claude Code tab/ : /task goal/i,
      );
    },
  );

  it('keeps every step and caveat in the READING role', async () => {
    const user = await opened();
    for (const tab of Object.values(TABS)) {
      await pick(user, tab);
      const items = panel().querySelectorAll('li');
      expect(items.length).toBeGreaterThan(4);
      for (const li of items) expect(li.className).toMatch(/\breading\b/);
    }
  });

  it('uses no em dash anywhere in the section, on any tab', async () => {
    const user = await opened();
    expect(setup().textContent ?? '').not.toContain('\u2014');
    for (const tab of Object.values(TABS)) {
      await pick(user, tab);
      expect(setup().textContent ?? '').not.toContain('\u2014');
    }
  });
});

describe('ClientSetup · Claude Code', () => {
  /** The INSTRUMENT label printed above a snippet. */
  const labelOf = (group: HTMLElement) =>
    group.closest('div.rounded-lg')?.querySelector('.micro-label')?.textContent ?? '';

  it('says which route the terminal takes and which the Code panel takes', async () => {
    await opened(TABS.code);
    const text = panel().textContent ?? '';
    expect(text).toMatch(/terminal/i);
    expect(text).toMatch(/code panel/i);
    // They no longer share one set of steps, and the copy must not say they do.
    expect(text).not.toMatch(/same steps/i);
    expect(within(panel()).getByText('CODE PANEL ROUTE')).toBeInTheDocument();
  });

  it('orders the terminal steps: save run-mcp.json, then the isolated launch, then check, then the goal', async () => {
    await opened(TABS.code);

    const main = panel().querySelectorAll('ol')[0]!;
    const steps = [...main.querySelectorAll(':scope > li')];
    // (1) save the file the launch reads.
    expect(
      within(steps[0] as HTMLElement).getByRole('group', { name: /Claude Code config file/i }),
    ).toBeInTheDocument();
    expect(steps[0]!.textContent).toContain(ISOLATED_CONFIG_FILE);
    // (2) launch with only that file's servers.
    expect(
      within(steps[1] as HTMLElement).getByRole('group', { name: /isolated launch command/i }),
    ).toHaveTextContent(`claude --strict-mcp-config --mcp-config ${ISOLATED_CONFIG_FILE}`);
    // Then the check and the goal. The endpoint itself contains "/mcp", so the
    // check is found by its verb.
    const text = steps.map((li) => li.textContent ?? '');
    const check = text.findIndex((s) => /type \/mcp/i.test(s));
    expect(check).toBeGreaterThan(1);
    expect(text[check]).toContain(MCP_SERVER_NAME);
    expect(text[check]).toMatch(/nothing else/i);
    expect(text.at(-1)).toMatch(/task goal/i);
    // Registration is NOT a terminal step: the isolated launch ignores every
    // registered server, so registering first was a step that did nothing.
    expect(main.textContent).not.toMatch(/claude mcp add/);
  });

  it('gives the Code panel its own, separately labelled route using claude mcp add --transport http', async () => {
    await opened(TABS.code);

    const [main, route] = [...panel().querySelectorAll('ol')];
    expect(route).toBeDefined();
    const label = within(panel()).getByText('CODE PANEL ROUTE');
    // Labelled, and after the terminal steps, so the two routes never blur.
    expect(main!.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(label.compareDocumentPosition(route!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(route!.className).toMatch(/\blist-decimal\b/);

    const transport = within(route as HTMLElement).getByRole('group', {
      name: /Claude Code transport command/i,
    });
    expect(transport).toHaveTextContent('claude mcp add --transport http');
    expect(transport).toHaveTextContent(TICKET.endpoint);
    expect(transport).toHaveTextContent('--header "Authorization: Bearer');
    // The route ends where every route ends.
    const routeSteps = [...route!.querySelectorAll(':scope > li')];
    expect(routeSteps.at(-1)?.textContent).toMatch(/task goal/i);
    // The JSON form is gone: it was the one command PowerShell broke.
    expect(panel().textContent).not.toMatch(/add-json/);
  });

  it('copies the Code panel command with the real endpoint and token in it', async () => {
    const user = await opened(TABS.code);
    const writeText = stubClipboard();

    await user.click(
      within(panel()).getByRole('button', { name: /copy Claude Code transport command/i }),
    );

    expect(writeText.mock.calls.at(-1)?.[0]).toBe(
      `claude mcp add --transport http ${MCP_SERVER_NAME} ${TICKET.endpoint} ` +
        `--header "Authorization: Bearer ${TICKET.token}"`,
    );
  });

  it('gives the config file the isolated launch reads, and the launch itself', async () => {
    const user = await opened(TABS.code);
    const writeText = stubClipboard();

    const file = within(panel()).getByRole('group', { name: /Claude Code config file/i });
    expect(file).toHaveTextContent('mcpServers');
    expect(file).toHaveTextContent(TICKET.endpoint);
    expect(panel().textContent ?? '').toContain(`SAVE AS ${ISOLATED_CONFIG_FILE}`);

    const launch = within(panel()).getByRole('group', { name: /isolated launch command/i });
    expect(file.compareDocumentPosition(launch) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(
      within(panel()).getByRole('button', { name: /copy Claude Code config file/i }),
    );
    expect(JSON.parse(writeText.mock.calls.at(-1)?.[0] ?? '')).toEqual({
      mcpServers: {
        [MCP_SERVER_NAME]: {
          url: TICKET.endpoint,
          type: 'http',
          headers: { Authorization: `Bearer ${TICKET.token}` },
        },
      },
    });

    // The launch is copied exactly as shown, and it carries no credential.
    await user.click(
      within(panel()).getByRole('button', { name: /copy isolated launch command/i }),
    );
    expect(writeText.mock.calls.at(-1)?.[0]).toBe(ISOLATED_LAUNCH_COMMAND);
    expect(ISOLATED_LAUNCH_COMMAND).not.toContain(TICKET.token);
  });

  it('offers only flags the client really has', async () => {
    await opened(TABS.code);
    const text = panel().textContent ?? '';
    // `--strict-mcp-config` and `--mcp-config` were read off `claude --help`
    // (2.1.286). These two are not flags of any client.
    expect(text).not.toMatch(/--only-mcp|--single-server/);
    expect(text).not.toMatch(/no command-line flag/i);
  });

  it('warns that the header form echoes the token, and says what no flag covers', async () => {
    await opened(TABS.code);
    const caveats = panel().querySelector('ul')?.textContent ?? '';
    expect(caveats).toMatch(/echoes the token/i);
    expect(caveats).toMatch(/built into the client/i);
    expect(caveats).toMatch(/browser extension/i);
    // The command that explains a failed connection.
    expect(caveats).toContain(`claude mcp get ${MCP_SERVER_NAME}`);
  });

  it('labels every command for both bash and PowerShell, on every tab', async () => {
    const user = await opened();
    let seen = 0;
    for (const tab of Object.values(TABS)) {
      await pick(user, tab);
      for (const group of within(panel()).queryAllByRole('group', { name: /command/i })) {
        seen++;
        const label = labelOf(group);
        // Both shells named on the snippet itself, so neither reader has to
        // wonder whether a command is for them.
        expect(label).toMatch(/BASH/);
        expect(label).toMatch(/POWERSHELL/);
      }
    }
    // The Claude Code tab carries two commands: the launch and the Code panel route.
    expect(seen).toBeGreaterThanOrEqual(2);
    // Both forms exist in one build, so the old "newer builds / older builds"
    // framing was wrong and must not come back.
    expect(setup().textContent).not.toMatch(/newer builds|older builds|claude --version/i);
  });
});

describe('ClientSetup · audit: two routes in one tab stay apart', () => {
  it('labels BOTH Claude Code routes, so "step 1" is never ambiguous', async () => {
    await opened(TABS.code);

    const [terminal, panelRoute] = [...panel().querySelectorAll('ol')];
    // Each numbered list is introduced by its own route label, directly above it.
    const labelAbove = (list: Element) =>
      list.previousElementSibling?.classList.contains('micro-label')
        ? list.previousElementSibling.textContent
        : null;
    expect(labelAbove(terminal!)).toBe('TERMINAL ROUTE');
    expect(labelAbove(panelRoute!)).toBe('CODE PANEL ROUTE');
  });

  it('keeps every command label short enough to sit beside its COPY control on a phone', async () => {
    const user = await opened();
    for (const tab of Object.values(TABS)) {
      await pick(user, tab);
      for (const group of within(panel()).queryAllByRole('group', { name: /command/i })) {
        const label =
          group.closest('div.rounded-lg')?.querySelector('.micro-label')?.textContent ?? '';
        // The longest label measured on one line beside COPY at 390px.
        expect(label).toBe('BASH AND POWERSHELL');
      }
    }
  });
});

describe('ClientSetup · one server name, everywhere', () => {
  it('names the server mcp-run in every snippet that names one, and never workspace', async () => {
    const user = await opened();
    const writeText = stubClipboard();
    const copied: string[] = [];
    for (const tab of Object.values(TABS)) {
      await pick(user, tab);
      // queryAll: the Desktop chat tab cannot connect and has nothing to copy.
      for (const button of within(panel()).queryAllByRole('button', { name: /^copy /i })) {
        await user.click(button);
        copied.push(writeText.mock.calls.at(-1)?.[0] ?? '');
      }
    }

    // What actually reaches the reader's client, not what is drawn.
    const naming = copied.filter((v) => /mcpServers|"servers"|claude mcp add/.test(v));
    expect(naming.length).toBeGreaterThanOrEqual(4);
    for (const value of naming) expect(value).toContain(MCP_SERVER_NAME);
    for (const value of copied) expect(value).not.toMatch(/workspace/i);
    // Claude Code reserves `workspace` and refuses to register it.
    expect(MCP_SERVER_NAME).toBe('mcp-run');
  });
});

describe('ClientSetup · Claude Desktop (chat) says what its dialog shows, and that it cannot connect', () => {
  /*
   * Written from the dialog as observed in Claude Desktop (Settings > Connectors >
   * Add custom connector): two fields, "Name" and "MCP server URL", and two
   * buttons, "Cancel" and "Continue". No header field and no Advanced section.
   * An MCProof run refuses every request without its token, so this path cannot
   * reach a run, and the tab says so instead of describing a field that is not there.
   */
  it('names the dialog and its two fields exactly as the app labels them', async () => {
    await opened(TABS.desktop);
    const text = panel().textContent ?? '';
    expect(text).toContain('Add custom connector');
    expect(text).toMatch(/Settings > Connectors/);
    expect(within(panel()).getByText('Name', { selector: 'span' })).toBeInTheDocument();
    expect(within(panel()).getByText('MCP server URL', { selector: 'span' })).toBeInTheDocument();
  });

  it('states plainly that the dialog has no field for the run token, so it cannot connect', async () => {
    await opened(TABS.desktop);
    const text = panel().textContent ?? '';
    expect(text).toMatch(/no field for the run token/i);
    expect(text).toMatch(/cannot connect to an MCProof run/i);
  });

  it('sends the reader to the Claude Code tab or the Any MCP client tab', async () => {
    await opened(TABS.desktop);
    const steps = [...panel().querySelectorAll('ol > li')].map((li) => li.textContent ?? '');
    expect(steps.at(-1)).toMatch(/Claude Code tab/);
    expect(steps.at(-1)).toMatch(/Any MCP client tab/);
  });

  it('never tells the reader to fill a header, authorization or token field', async () => {
    await opened(TABS.desktop);
    const text = panel().textContent ?? '';
    expect(text).not.toMatch(/request headers/i);
    expect(text).not.toMatch(/authorization/i);
    expect(text).not.toMatch(/no sign-in/i);
    // Nothing to paste: no header value, no command, no config.
    expect(within(panel()).queryAllByRole('group')).toHaveLength(0);
    expect(within(panel()).queryAllByRole('button', { name: /^copy /i })).toHaveLength(0);
    // Every sentence that mentions the token says it cannot go in, never to put it in.
    for (const li of panel().querySelectorAll('li')) {
      const line = li.textContent ?? '';
      if (/token/i.test(line)) expect(line).not.toMatch(/\b(enter|paste|fill|type)\b[^.]*token/i);
    }
  });

  it('describes only this screen, and claims nothing about what comes after Continue', async () => {
    await opened(TABS.desktop);
    const text = panel().textContent ?? '';
    expect(text).toMatch(/Cancel/);
    expect(text).not.toMatch(/after Continue|next screen|on the following screen/i);
  });

  it('keeps it distinct from Claude Code: no CLI and no config file', async () => {
    await opened(TABS.desktop);
    const text = panel().textContent ?? '';
    expect(text).toMatch(/not the Code panel/i);
    expect(text).not.toMatch(/claude mcp|--strict-mcp-config|claude_desktop_config|mcpServers/);
  });
});

describe('ClientSetup · Cursor / VS Code', () => {
  it('gives each editor its own file, in the {url, type, headers} shape', async () => {
    const user = await opened(TABS.editors);
    const writeText = stubClipboard();

    const entry = {
      [MCP_SERVER_NAME]: {
        url: TICKET.endpoint,
        type: 'http',
        headers: { Authorization: `Bearer ${TICKET.token}` },
      },
    };

    const cursor = within(panel()).getByRole('group', { name: /Cursor configuration/i });
    expect(cursor).toHaveTextContent('mcpServers');
    expect(cursor).toHaveTextContent(TICKET.endpoint);
    expect(cursor).toHaveTextContent('"type": "http"');
    await user.click(within(panel()).getByRole('button', { name: /copy Cursor configuration/i }));
    expect(JSON.parse(writeText.mock.calls.at(-1)?.[0] ?? '')).toEqual({ mcpServers: entry });

    // VS Code's file differs by one key, so it gets its own block rather than a
    // sentence asking the reader to edit JSON by hand.
    const vscode = within(panel()).getByRole('group', { name: /VS Code configuration/i });
    expect(vscode).not.toHaveTextContent('mcpServers');
    expect(vscode).toHaveTextContent('"servers"');
    await user.click(within(panel()).getByRole('button', { name: /copy VS Code configuration/i }));
    expect(JSON.parse(writeText.mock.calls.at(-1)?.[0] ?? '')).toEqual({ servers: entry });

    const text = panel().textContent ?? '';
    expect(text).toContain('.cursor/mcp.json');
    expect(text).toContain('.vscode/mcp.json');
    expect(text).toMatch(/servers.*instead of.*mcpServers/);
  });
});

describe('ClientSetup · Any MCP client', () => {
  it('gives the generic path as steps: endpoint, bearer header, Streamable HTTP, the prompt', async () => {
    await opened(TABS.generic);

    const text = panel().textContent ?? '';
    expect(text).toMatch(/streamable http/i);
    expect(text).toMatch(/any mcp client/i);
    expect(text).toMatch(/run endpoint/i);
    expect(text).toMatch(/prompt the server publishes/i);
    expect(text).toContain(TICKET.promptName);
    const header = within(panel()).getByRole('group', { name: /authorization header/i });
    expect(header).toHaveTextContent('Authorization: Bearer');
    expect(header.closest('li')).not.toBeNull();
    // The name stays neutral, and the step says why in one clause.
    expect(MCP_SERVER_NAME).not.toMatch(/mcproof|red.?team|attack|test/i);
    expect(text).toContain(MCP_SERVER_NAME);
    expect(text).toMatch(/namespaces/i);
  });

  it('states the one honest caveat: no server-to-client stream, GET answers 405', async () => {
    await opened(TABS.generic);

    const caveats = panel().querySelector('ul')?.textContent ?? '';
    expect(caveats).toMatch(/no server-to-client stream/i);
    expect(caveats).toMatch(/\b405\b/);
    expect(caveats).toMatch(/only POST and DELETE/);
    expect(caveats).toMatch(/separate profile/i);
  });
});

describe('ClientSetup · the token is copyable and never in plain sight', () => {
  it('renders no snippet containing the token, on any client', async () => {
    const user = await opened();

    expect(document.body.textContent ?? '').not.toContain(TICKET.token);
    for (const tab of Object.values(TABS)) {
      await pick(user, tab);
      expect(document.body.textContent ?? '').not.toContain(TICKET.token);
    }
  });

  it('copies the real token out of the Code panel route command', async () => {
    const user = await opened(TABS.code);
    const writeText = stubClipboard();

    await user.click(
      within(panel()).getByRole('button', { name: /copy Claude Code transport command/i }),
    );

    const copied = writeText.mock.calls.at(-1)?.[0] ?? '';
    expect(copied).toContain(TICKET.token);
    expect(copied).toContain(TICKET.endpoint);
    expect(copied).toContain('claude mcp add --transport http');
  });
});

describe('ClientSetup · connect an agent with nothing else attached', () => {
  it('says it above the tabs, in words, before any client is picked', async () => {
    await opened();

    expect(within(setup()).getByText(/no other tools attached/i)).toBeInTheDocument();
    expect(within(setup()).getByText(/reach the real thing/i)).toBeInTheDocument();
    const warning = within(setup()).getByText('ATTACH NOTHING ELSE');
    const picker = within(setup()).getByRole('group', { name: /mcp client/i });
    expect(warning.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('ClientSetup · the reader can tell it worked', () => {
  it('ties the check to the connection panel already on this screen', async () => {
    await opened();

    const text = setup().textContent ?? '';
    // The panel's own two readings, named so the reader knows what to watch.
    expect(text).toContain('AWAITING AGENT');
    expect(text).toContain('AGENT CONNECTED');
  });
});

describe('ClientSetup · a dense screen stays scannable and stays inside its column', () => {
  it('keeps every snippet in its own horizontally scrollable, keyboard reachable box', async () => {
    const user = await opened();

    for (const tab of Object.values(TABS)) {
      await pick(user, tab);
      const blocks = within(panel()).queryAllByRole('group', {
        name: /command|configuration|file|header/i,
      });
      // Every tab that can connect has something to copy; the Desktop chat tab
      // cannot connect, so it has none.
      if (tab !== TABS.desktop) expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        // The snippet scrolls inside its own box, so the page body never does.
        expect(block.className).toMatch(/overflow-x-auto/);
        // A scrollable region has to be reachable without a mouse (WCAG 2.1.1).
        expect(block).toHaveAttribute('tabindex', '0');
      }
    }
  });

  it('keeps the sentences around the code in the READING role, never INSTRUMENT', async () => {
    const user = await opened();

    for (const tab of Object.values(TABS)) {
      await pick(user, tab);
      // Every paragraph in the section is prose and wears a reading role. A
      // sentence rendered at instrument size is a blocking review failure.
      const paragraphs = setup().querySelectorAll('p');
      expect(paragraphs.length).toBeGreaterThan(3);
      for (const p of paragraphs) {
        const role = p.className;
        const prose = /\breading\b/.test(role);
        const label = /\bmicro-label\b|\binstrument/.test(role);
        expect(prose || label).toBe(true);
        // Nothing is both.
        expect(prose && label).toBe(false);
      }
    }
  });

  it('does not survive without the sentences the old panel already had right', async () => {
    await opened();

    const body = document.body.textContent ?? '';
    expect(body).toMatch(/shown once/i);
    expect(body).toMatch(/hostile by design/i);
    expect(body).toMatch(/MCP has no message that lets a server tell an agent what its job is/i);
    expect(body).toMatch(/if your client does not support prompts/i);
  });
});
