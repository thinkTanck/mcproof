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
 * Five things this suite exists to hold down:
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
        requests: 0,
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

describe('ClientSetup · there is a real command, per client', () => {
  it('gives the newer Claude Code form with the issued endpoint in it', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issued(user);
    await pick(user, /^claude code$/i);

    const command = within(setup()).getByRole('group', { name: /Claude Code add-json command/i });
    expect(command).toHaveTextContent('claude mcp add-json');
    expect(command).toHaveTextContent(TICKET.endpoint);
    expect(command).toHaveTextContent(MCP_SERVER_NAME);
  });

  it('labels the two registration commands by shell, and tells PowerShell which to use', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issued(user);
    await pick(user, /^claude code$/i);

    // The form with no JSON in it is the one that survives Windows PowerShell,
    // which strips the double quotes inside a single-quoted JSON argument.
    const transport = within(setup()).getByRole('group', {
      name: /Claude Code transport command/i,
    });
    expect(transport).toHaveTextContent('claude mcp add --transport http');
    expect(transport).toHaveTextContent(TICKET.endpoint);
    expect(transport).toHaveTextContent('--header "Authorization: Bearer');

    const text = setup().textContent ?? '';
    expect(text).toContain('WINDOWS / POWERSHELL: USE THIS ONE');
    expect(text).toContain('MACOS / LINUX / BASH');
    expect(text).toMatch(/powershell strips the quotes/i);
    // Both forms exist in one build, so the old "newer builds / older builds"
    // framing was wrong and must not come back.
    expect(text).not.toMatch(/newer builds|older builds|claude --version/i);
  });

  it('copies the PowerShell-safe command with the real endpoint and token in it', async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issued(user);
    await pick(user, /^claude code$/i);

    await user.click(
      within(setup()).getByRole('button', { name: /copy Claude Code transport command/i }),
    );

    expect(writeText.mock.calls.at(-1)?.[0]).toBe(
      `claude mcp add --transport http ${MCP_SERVER_NAME} ${TICKET.endpoint} ` +
        `--header "Authorization: Bearer ${TICKET.token}"`,
    );
  });

  it('gives Claude Code the config file the isolated launch reads, before any registration', async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issued(user);
    await pick(user, /^claude code$/i);

    const file = within(setup()).getByRole('group', { name: /Claude Code config file/i });
    expect(file).toHaveTextContent('mcpServers');
    expect(file).toHaveTextContent(TICKET.endpoint);
    expect(setup().textContent ?? '').toContain(`SAVE AS ${ISOLATED_CONFIG_FILE}`);
    // The isolated path comes first in the example: the file, then registration.
    const register = within(setup()).getByRole('group', { name: /Claude Code add-json command/i });
    expect(file.compareDocumentPosition(register) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(
      within(setup()).getByRole('button', { name: /copy Claude Code config file/i }),
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
  });

  it('gives Claude Desktop its config block, and says no bridge is needed', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issued(user);
    await pick(user, /^claude desktop$/i);

    const config = within(setup()).getByRole('group', { name: /Claude Desktop configuration/i });
    expect(config).toHaveTextContent('mcpServers');
    expect(config).toHaveTextContent(TICKET.endpoint);
    expect(within(setup()).getByText(/claude_desktop_config\.json/)).toBeInTheDocument();
    expect(within(setup()).getByText(/no bridge/i)).toBeInTheDocument();
  });

  it('leads with the generic path, on screen before any client is picked', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issued(user);

    // Nothing picked, and the protocol facts plus the header snippet are
    // already there: a remote Streamable HTTP server, a bearer header, the goal
    // as a published prompt.
    const region = setup();
    expect(within(region).getByText(/streamable http/i)).toBeInTheDocument();
    expect(within(region).getByText(/any mcp client/i)).toBeInTheDocument();
    expect(within(region).getByText(/prompt the server publishes/i)).toBeInTheDocument();
    const header = within(region).getByRole('group', { name: /authorization header/i });
    expect(header).toHaveTextContent('Authorization: Bearer');

    // And it sits ABOVE the client examples, not behind one of them.
    const picker = within(region).getByRole('group', { name: /mcp client example/i });
    expect(header.compareDocumentPosition(picker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('states the one honest caveat: no server-to-client stream, GET answers 405', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issued(user);

    const text = setup().textContent ?? '';
    expect(text).toMatch(/no server-to-client stream/i);
    expect(text).toMatch(/\b405\b/);
    expect(text).toMatch(/only POST and DELETE/);
  });

  it('selects no client example by default', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issued(user);

    const picker = within(setup()).getByRole('group', { name: /mcp client example/i });
    const buttons = within(picker).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual([
      'CLAUDE CODE',
      'CLAUDE DESKTOP',
      'CURSOR / VS CODE',
    ]);
    for (const button of buttons) expect(button).toHaveAttribute('aria-pressed', 'false');
    // No registration command or config block is on screen until the reader
    // asks for one. (The isolated launch command in the caution callout is the
    // one command that IS always shown, and it carries no credential.)
    expect(
      within(setup()).queryByRole('group', {
        name: /add-json command|transport command|configuration|config file/i,
      }),
    ).toBeNull();
  });

  it('gives Cursor and VS Code the same server entry, and says where each reads it', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issued(user);
    await pick(user, /^cursor/i);

    const config = within(setup()).getByRole('group', { name: /Cursor configuration/i });
    expect(config).toHaveTextContent('mcpServers');
    expect(config).toHaveTextContent(TICKET.endpoint);
    expect(config).toHaveTextContent('"type": "http"');
    const text = setup().textContent ?? '';
    expect(text).toContain('.cursor/mcp.json');
    expect(text).toContain('.vscode/mcp.json');
    // VS Code's file differs by one key, and the copy says so rather than
    // pretending one JSON drops into both.
    expect(text).toMatch(/servers.*instead of.*mcpServers/);
  });

  it('names the server neutrally everywhere, and says why in one clause', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issued(user);

    // A project-naming id would be read by the agent at connect time.
    expect(MCP_SERVER_NAME).not.toMatch(/mcpwn|red.?team|attack|test/i);
    expect(within(setup()).getByText(/namespaces/i)).toBeInTheDocument();
    await pick(user, /^claude code$/i);
    expect(
      within(setup()).getByRole('group', { name: /Claude Code add-json command/i }),
    ).toHaveTextContent(MCP_SERVER_NAME);
  });
});

describe('ClientSetup · the token is copyable and never in plain sight', () => {
  it('renders no snippet containing the token, on any client', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issued(user);

    // Before any pick (the generic header snippet is already on screen) and
    // after each one.
    expect(document.body.textContent ?? '').not.toContain(TICKET.token);
    for (const tab of [/^claude code$/i, /^claude desktop$/i, /^cursor/i]) {
      await pick(user, tab);
      expect(document.body.textContent ?? '').not.toContain(TICKET.token);
    }
  });

  it('copies the real token out of the newer Claude Code command', async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issued(user);
    await pick(user, /^claude code$/i);

    await user.click(
      within(setup()).getByRole('button', { name: /copy Claude Code add-json command/i }),
    );

    const copied = writeText.mock.calls.at(-1)?.[0] ?? '';
    expect(copied).toContain(TICKET.token);
    expect(copied).toContain(TICKET.endpoint);
    expect(copied).toContain('claude mcp add-json');
  });

  it('copies the real token out of the Claude Desktop configuration', async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issued(user);
    await pick(user, /^claude desktop$/i);

    await user.click(
      within(setup()).getByRole('button', { name: /copy Claude Desktop configuration/i }),
    );

    const copied = writeText.mock.calls.at(-1)?.[0] ?? '';
    expect(JSON.parse(copied)).toEqual({
      mcpServers: {
        [MCP_SERVER_NAME]: {
          url: TICKET.endpoint,
          type: 'http',
          headers: { Authorization: `Bearer ${TICKET.token}` },
        },
      },
    });
  });

  it('warns that the header form echoes the token back in the shell', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issued(user);
    await pick(user, /^claude code$/i);

    expect(within(setup()).getByText(/echoes the token/i)).toBeInTheDocument();
  });
});

describe('ClientSetup · connect an agent with nothing else attached', () => {
  it('says it before the commands, in words, not as an aside', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issued(user);

    expect(within(setup()).getByText(/no other tools attached/i)).toBeInTheDocument();
    expect(within(setup()).getByText(/reach the real thing/i)).toBeInTheDocument();
  });

  it('gives the isolated launch command, prominently, with the reason in one line', async () => {
    const user = userEvent.setup();
    const writeText = stubClipboard();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issued(user);

    // On screen with no client picked: it lives in the caution callout, above
    // the generic path and above every example.
    const launch = within(setup()).getByRole('group', { name: /isolated launch command/i });
    expect(launch).toHaveTextContent(
      `claude --strict-mcp-config --mcp-config ${ISOLATED_CONFIG_FILE}`,
    );
    const header = within(setup()).getByRole('group', { name: /authorization header/i });
    expect(launch.compareDocumentPosition(header) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const text = setup().textContent ?? '';
    expect(text).toContain('RUN IT ISOLATED');
    expect(text).toMatch(/can only reach this trap, nothing else in your setup/i);
    // What goes wrong otherwise, stated rather than implied.
    expect(text).toMatch(/loads every other server you have/i);

    // It is copied exactly as shown, and it carries no credential.
    await user.click(
      within(setup()).getByRole('button', { name: /copy isolated launch command/i }),
    );
    expect(writeText.mock.calls.at(-1)?.[0]).toBe(ISOLATED_LAUNCH_COMMAND);
    expect(ISOLATED_LAUNCH_COMMAND).not.toContain(TICKET.token);
  });

  it('offers only flags the client really has, and keeps the fallbacks', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issued(user);

    const text = setup().textContent ?? '';
    // `--strict-mcp-config` and `--mcp-config` were read off `claude --help`
    // (2.1.286). An earlier version of this test FORBADE the first one as an
    // invented flag; it is real. These two are still not flags of any client.
    expect(text).not.toMatch(/--only-mcp|--single-server/);
    // The fallbacks for any other client stay.
    expect(text).toMatch(/\/mcp/);
    expect(text).toMatch(/separate profile/i);
    // And the false sentence is gone.
    expect(text).not.toMatch(/no command-line flag/i);
  });

  it('says what no flag covers: tools built into the client itself', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issued(user);

    const text = setup().textContent ?? '';
    expect(text).toMatch(/built into the client/i);
    expect(text).toMatch(/browser extension/i);
    expect(text).toMatch(/disable those yourself/i);
  });
});

describe('ClientSetup · the reader can tell it worked', () => {
  it('gives the check command and the command that explains a failure, as one client example', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issued(user);

    const text = setup().textContent ?? '';
    expect(text).toContain('claude mcp list');
    expect(text).toContain(`claude mcp get ${MCP_SERVER_NAME}`);
    // The universal check (the connection panel) is stated first; the Claude
    // Code command follows as an example, so the footer never reads Claude-only.
    expect(text.indexOf('AWAITING AGENT')).toBeLessThan(text.indexOf('claude mcp list'));
    expect(text).toMatch(/for example/i);
  });

  it('ties the check to the connection panel already on this screen', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issued(user);

    const text = setup().textContent ?? '';
    // The panel's own two readings, named so the reader knows what to watch.
    expect(text).toContain('AWAITING AGENT');
    expect(text).toContain('AGENT CONNECTED');
  });
});

describe('ClientSetup · a dense screen stays scannable and stays inside its column', () => {
  it('keeps every snippet in its own horizontally scrollable, keyboard reachable box', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issued(user);

    const blocks = within(setup()).getAllByRole('group', { name: /command|configuration|header/i });
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      // The snippet scrolls inside its own box, so the page body never does.
      expect(block.className).toMatch(/overflow-x-auto/);
      // A scrollable region has to be reachable without a mouse (WCAG 2.1.1).
      expect(block).toHaveAttribute('tabindex', '0');
    }
  });

  it('keeps the sentences around the code in the READING role, never INSTRUMENT', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issued(user);

    // Every paragraph in the section is prose and wears a reading role. A
    // sentence rendered at instrument size is a blocking review failure.
    const paragraphs = setup().querySelectorAll('p');
    expect(paragraphs.length).toBeGreaterThan(4);
    for (const p of paragraphs) {
      const role = p.className;
      const prose = /\breading\b/.test(role);
      const label = /\bmicro-label\b|\binstrument/.test(role);
      expect(prose || label).toBe(true);
      // Nothing is both.
      expect(prose && label).toBe(false);
    }
  });

  it('does not survive without the sentences the old panel already had right', async () => {
    const user = userEvent.setup();
    render(<LiveRunConsole port={portWith()} category="ASI01" signedIn />);
    await issued(user);

    const body = document.body.textContent ?? '';
    expect(body).toMatch(/shown once/i);
    expect(body).toMatch(/hostile by design/i);
    expect(body).toMatch(/MCP has no message that lets a server tell an agent what its job is/i);
    expect(body).toMatch(/if your client does not support prompts/i);
  });
});
