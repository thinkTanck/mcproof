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
  endpoint: 'https://mcpwn.dev/api/mcp/run-77',
  token: `mcpwn_rt_${'a'.repeat(32)}_${'b'.repeat(64)}`,
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
      expect(lists).toHaveLength(1);
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

      // Every tab ends at the same place: the agent gets its task goal.
      expect(steps[steps.length - 1]!.textContent ?? '').toMatch(/task goal/i);
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
    expect(setup().textContent ?? '').not.toContain('—');
    for (const tab of Object.values(TABS)) {
      await pick(user, tab);
      expect(setup().textContent ?? '').not.toContain('—');
    }
  });
});

describe('ClientSetup · Claude Code', () => {
  it('says the terminal and the Desktop Code panel use the same steps', async () => {
    await opened(TABS.code);
    const text = panel().textContent ?? '';
    expect(text).toMatch(/terminal/i);
    expect(text).toMatch(/code panel/i);
    expect(text).toMatch(/same steps/i);
  });

  it('walks register, isolated launch, the /mcp check, then the goal, in that order', async () => {
    await opened(TABS.code);

    const steps = [...panel().querySelectorAll('ol > li')].map((li) => li.textContent ?? '');
    const at = (pattern: RegExp) => steps.findIndex((s) => pattern.test(s));
    const register = at(/claude mcp add/);
    const launch = at(/--strict-mcp-config/);
    const check = at(/\/mcp/);
    const goal = at(/task goal/i);
    expect(register).toBeGreaterThanOrEqual(0);
    expect(launch).toBeGreaterThan(register);
    expect(check).toBeGreaterThan(launch);
    expect(goal).toBeGreaterThan(check);
    // The check names what a clean result looks like: this server and no other.
    expect(steps[check]).toContain(MCP_SERVER_NAME);
    expect(steps[check]).toMatch(/nothing else/i);
  });

  it('gives the bash add-json form with the issued endpoint in it', async () => {
    await opened(TABS.code);

    const command = within(panel()).getByRole('group', { name: /Claude Code add-json command/i });
    expect(command).toHaveTextContent('claude mcp add-json');
    expect(command).toHaveTextContent(TICKET.endpoint);
    expect(command).toHaveTextContent(MCP_SERVER_NAME);
  });

  it('labels the two registration commands by shell, and tells PowerShell which to use', async () => {
    await opened(TABS.code);

    // The form with no JSON in it is the one that survives Windows PowerShell,
    // which strips the double quotes inside a single-quoted JSON argument.
    const transport = within(panel()).getByRole('group', {
      name: /Claude Code transport command/i,
    });
    expect(transport).toHaveTextContent('claude mcp add --transport http');
    expect(transport).toHaveTextContent(TICKET.endpoint);
    expect(transport).toHaveTextContent('--header "Authorization: Bearer');

    const text = panel().textContent ?? '';
    expect(text).toContain('WINDOWS / POWERSHELL: USE THIS ONE');
    expect(text).toContain('MACOS / LINUX / BASH');
    expect(text).toMatch(/powershell strips the quotes/i);
    // The cause is named, with the error the reader actually sees.
    expect(text).toMatch(/Invalid input/);
    // Both forms exist in one build, so the old "newer builds / older builds"
    // framing was wrong and must not come back.
    expect(text).not.toMatch(/newer builds|older builds|claude --version/i);
    expect(text).not.toMatch(/if your build rejects/i);
  });

  it('copies the PowerShell-safe command with the real endpoint and token in it', async () => {
    const writeText = stubClipboard();
    const user = await opened(TABS.code);

    await user.click(
      within(panel()).getByRole('button', { name: /copy Claude Code transport command/i }),
    );

    expect(writeText.mock.calls.at(-1)?.[0]).toBe(
      `claude mcp add --transport http ${MCP_SERVER_NAME} ${TICKET.endpoint} ` +
        `--header "Authorization: Bearer ${TICKET.token}"`,
    );
  });

  it('gives the config file the isolated launch reads, and the launch itself', async () => {
    const writeText = stubClipboard();
    const user = await opened(TABS.code);

    const file = within(panel()).getByRole('group', { name: /Claude Code config file/i });
    expect(file).toHaveTextContent('mcpServers');
    expect(file).toHaveTextContent(TICKET.endpoint);
    expect(panel().textContent ?? '').toContain(`SAVE AS ${ISOLATED_CONFIG_FILE}`);

    const launch = within(panel()).getByRole('group', { name: /isolated launch command/i });
    expect(launch).toHaveTextContent(
      `claude --strict-mcp-config --mcp-config ${ISOLATED_CONFIG_FILE}`,
    );
    // The file comes before the command that reads it.
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
});

describe('ClientSetup · Claude Desktop (chat) is the OTHER path', () => {
  it('describes the connector path, distinctly from Claude Code', async () => {
    await opened(TABS.desktop);

    const text = panel().textContent ?? '';
    expect(text).toMatch(/Settings > Connectors/);
    expect(text).toMatch(/add custom connector/i);
    expect(text).toMatch(/request headers/i);
    expect(text).toMatch(/new chat/i);
    // It is told apart from the Code panel of the same app in so many words.
    expect(text).toMatch(/not the code panel/i);
    // And nothing from the Claude Code path leaks in: no CLI, no config file.
    expect(text).not.toMatch(/claude mcp|--strict-mcp-config|claude_desktop_config|mcpServers/);
    expect(within(panel()).queryByRole('group', { name: /Claude Code/i })).toBeNull();
  });

  it('walks add connector, bearer header, enable only this one, new chat, then the goal', async () => {
    await opened(TABS.desktop);

    const steps = [...panel().querySelectorAll('ol > li')].map((li) => li.textContent ?? '');
    const at = (pattern: RegExp) => steps.findIndex((s) => pattern.test(s));
    const add = at(/add custom connector/i);
    const header = at(/request headers/i);
    const only = at(/every other connector off/i);
    const goal = at(/task goal/i);
    expect(add).toBeGreaterThanOrEqual(0);
    expect(header).toBeGreaterThan(add);
    expect(only).toBeGreaterThan(header);
    expect(goal).toBeGreaterThan(only);
    expect(steps[only]).toMatch(/new chat/i);
    expect(steps.join(' ')).toContain(MCP_SERVER_NAME);
  });

  it('copies the header value with the Bearer scheme, and renders it masked', async () => {
    const writeText = stubClipboard();
    const user = await opened(TABS.desktop);

    // Claude sends the value exactly as entered, so the scheme has to be in it.
    const value = within(panel()).getByRole('group', { name: /connector header value/i });
    expect(value).toHaveTextContent(/^Bearer /);
    expect(value.textContent ?? '').not.toContain(TICKET.token);

    await user.click(within(panel()).getByRole('button', { name: /copy connector header value/i }));
    expect(writeText.mock.calls.at(-1)?.[0]).toBe(`Bearer ${TICKET.token}`);
  });

  it('warns to switch the other connectors off, and admits when this path is unavailable', async () => {
    await opened(TABS.desktop);
    const caveats = panel().querySelector('ul')?.textContent ?? '';
    expect(caveats).toMatch(/any connector left on/i);
    // Request headers is not on every account. Without it this path cannot send
    // the token, and the reader is sent to the tab that can.
    expect(caveats).toMatch(/no request headers section/i);
    expect(caveats).toMatch(/claude code tab/i);
  });
});

describe('ClientSetup · Cursor / VS Code', () => {
  it('gives each editor its own file, in the {url, type, headers} shape', async () => {
    const writeText = stubClipboard();
    const user = await opened(TABS.editors);

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
    expect(MCP_SERVER_NAME).not.toMatch(/mcpwn|red.?team|attack|test/i);
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

  it('copies the real token out of the bash Claude Code command', async () => {
    const writeText = stubClipboard();
    const user = await opened(TABS.code);

    await user.click(
      within(panel()).getByRole('button', { name: /copy Claude Code add-json command/i }),
    );

    const copied = writeText.mock.calls.at(-1)?.[0] ?? '';
    expect(copied).toContain(TICKET.token);
    expect(copied).toContain(TICKET.endpoint);
    expect(copied).toContain('claude mcp add-json');
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
      const blocks = within(panel()).getAllByRole('group', {
        name: /command|configuration|file|header/i,
      });
      expect(blocks.length).toBeGreaterThan(0);
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
