'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { MCP_SERVER_NAME, addJsonCommand, desktopConfig } from '@/lib/mcp/config';
import { CopyOut } from './CopyOut';
import type { LiveRunTicketView } from './live-run-port';

/**
 * HOW TO ACTUALLY CONNECT — the missing half of the Connect screen.
 *
 * The console already issued a correct endpoint, a correct token and a correct
 * goal, and explained WHAT each one is and WHY it exists. The one action the user
 * has to perform was covered by a single sentence: "Send it as a bearer token on
 * the connection." That is accurate and useless. It names no transport, gives no
 * command for any client, and assumes the reader already knows how to register a
 * remote Streamable HTTP MCP server with an auth header. A first-time reader
 * pastes the URL into a client expecting stdio, gets a connection error, and the
 * screen has nothing to say about it.
 *
 * ── THE FOUR RULES THIS SECTION IS BUILT AROUND ──
 *
 * 1. A REAL COMMAND, NOT A DESCRIPTION OF ONE. Every snippet is built from the
 *    issued ticket, so it is the command for THIS run and not a template with
 *    placeholders to fill in.
 *
 * 2. THE COMMAND HAS TO SURVIVE THE READER'S SHELL. Claude Code registers a
 *    server two ways, and both exist in the same build (verified against 2.1.286;
 *    an earlier version of this section called them "newer" and "older" builds,
 *    which was wrong). What differs is the shell: `add-json` passes JSON in single
 *    quotes, and Windows PowerShell strips the double quotes inside it before the
 *    program sees them, so the command fails there. `--transport http` with a
 *    `--header` carries no JSON and works everywhere. So the two are labelled by
 *    shell, and the PowerShell reader is told which one to use.
 *
 * 3. THE TOKEN IS COPYABLE WITHOUT BEING VISIBLE. A working command has to carry
 *    the credential, and a credential rendered inside a code block undoes the
 *    masking on the token block three inches above it. So each snippet is BUILT
 *    TWICE from the same function: once with the real token (that string is only
 *    ever handed to the clipboard) and once with a constant mask (that string is
 *    the only one that reaches the DOM). It is deliberately not a find-and-replace
 *    over the real command: a replace that misses prints the credential, and a
 *    string built from a mask has never held it.
 *
 * 4. ISOLATION IS STATED FIRST, WITH THE REAL COMMAND. The tools this endpoint
 *    serves are hostile by design, so an agent that also holds live connectors
 *    for mail, files or a cloud account can carry an injected instruction out to
 *    a real system. A reader who registers the server and then launches the
 *    client plainly loads every other server they have alongside it. Claude Code
 *    has a flag for exactly this, `--strict-mcp-config` with `--mcp-config`
 *    (verified against 2.1.286: "Only use MCP servers from --mcp-config, ignoring
 *    all other MCP configurations"). An earlier version of this section told the
 *    reader no such flag existed, and a test forbade the string; both were wrong.
 *    The command sits in the caution callout above everything else, and no flag
 *    is offered that was not read off the client's own help. What no MCP flag
 *    covers is tooling built into the client itself (a browser extension, for
 *    one), and the copy says so rather than implying the isolation is total.
 *
 * 5. THE GENERIC PATH LEADS, THE CLIENTS ARE EXAMPLES. The endpoint is a standard
 *    remote MCP server over Streamable HTTP with a bearer header; any MCP client
 *    can register it. An earlier version defaulted the picker to Claude Code and
 *    opened the verify footer with `claude mcp list`, which read as Claude-only.
 *    Now the protocol facts and the header snippet come first and are always on
 *    screen, no client is selected until the reader picks one, and the universal
 *    check (the connection panel) is stated before any client's own command.
 */

/**
 * A constant stand-in for the credential inside a rendered snippet. Derived from
 * nothing, so it discloses nothing, not even the token's length.
 */
const TOKEN_MASK = '•'.repeat(16);

/**
 * `claude mcp add --transport http`: the Claude Code form that carries no JSON,
 * so it survives every shell, Windows PowerShell included. The `add-json`
 * command and the Claude Desktop entry are built by the shared config module
 * (`@/lib/mcp/config`), which owns the server name and the config shape; this form
 * builds no server config of its own, so it stays here, named from the same
 * shared constant.
 */
export function addTransportCommand(endpoint: string, token: string): string {
  return (
    `claude mcp add --transport http ${MCP_SERVER_NAME} ${endpoint} ` +
    `--header "Authorization: Bearer ${token}"`
  );
}

/**
 * The file the isolated launch reads. A neutral name for the same reason the
 * server name is neutral: nothing the agent could see should say what this is.
 */
export const ISOLATED_CONFIG_FILE = 'run-mcp.json';

/**
 * Launch Claude Code with ONLY the servers in the named file. Both flags were
 * read off `claude --help` (2.1.286): `--mcp-config` loads servers from a JSON
 * file and `--strict-mcp-config` ignores every other MCP configuration. It
 * carries no credential (the token lives in the file), so it is rendered and
 * copied as is.
 */
export const ISOLATED_LAUNCH_COMMAND = `claude --strict-mcp-config --mcp-config ${ISOLATED_CONFIG_FILE}`;

/** What every other client needs on every request. */
export function authorizationHeader(_endpoint: string, token: string): string {
  return `Authorization: Bearer ${token}`;
}

/** The swapped panel, named so each picker button can point at it. */
const PANEL_ID = 'connect-client-panel';

type ClientId = 'claude-code' | 'claude-desktop' | 'cursor';

const CLIENTS: [ClientId, string][] = [
  ['claude-code', 'CLAUDE CODE'],
  ['claude-desktop', 'CLAUDE DESKTOP'],
  ['cursor', 'CURSOR / VS CODE'],
];

const WarningIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
    <path
      d="M7 1.5 13 12.5H1L7 1.5Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinejoin="round"
    />
    <path d="M7 5.6v3.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <circle cx="7" cy="10.6" r="0.75" fill="currentColor" />
  </svg>
);

/**
 * One snippet. `build` is called twice: once with the real token for the
 * clipboard, once with the mask for the screen. See rule 3 above.
 */
function Snippet({
  label,
  name,
  build,
  ticket,
}: {
  label: string;
  name: string;
  build: (endpoint: string, token: string) => string;
  ticket: LiveRunTicketView;
}) {
  return (
    <CopyOut
      label={label}
      name={name}
      tone="code"
      value={build(ticket.endpoint, ticket.token)}
      display={build(ticket.endpoint, TOKEN_MASK)}
    />
  );
}

export function ClientSetup({ ticket }: { ticket: LiveRunTicketView }) {
  // No client is selected until the reader picks one: the generic path above
  // the picker is complete on its own, and a preselected tab would again make
  // one vendor's command read as the way in.
  const [client, setClient] = useState<ClientId | null>(null);

  return (
    <section
      aria-labelledby="connect-client"
      className="flex flex-col gap-3 border-t border-line pt-6"
    >
      <h3 id="connect-client" className="reading-h3">
        Register the endpoint in your client.
      </h3>

      {/* THE HIGHEST-VALUE SENTENCE ON THE PAGE, above the commands rather than
          beside them. CAUTION amber, with an icon and a label, never colour
          alone: this is an elevated state, not a breach, so it is never red. */}
      <div className="rounded-lg border border-caution/40 bg-caution/5 px-4 py-3.5">
        <p className="micro-label flex items-center gap-2 text-caution">
          <WarningIcon />
          ATTACH NOTHING ELSE
        </p>
        <p className="reading mt-2 max-w-[68ch]">
          Connect an agent that has no other tools attached. A run here can carry an instruction
          aimed at whatever your agent can reach, so if the same agent is also holding a live
          connector for mail, files, a browser or a cloud account, an instruction it takes on this
          endpoint can reach the real thing.
        </p>
        <p className="micro-label mt-3 text-caution">RUN IT ISOLATED</p>
        <p className="reading mt-2 max-w-[68ch]">
          Launch your client with only this server loaded, so the attack run can only reach this
          trap, nothing else in your setup. Registering the server and then starting the client the
          usual way loads every other server you have alongside it. In Claude Code the isolated
          launch is one command, using the config file from the Claude Code example below.
        </p>
        <div className="mt-2">
          <CopyOut
            label="ISOLATED LAUNCH"
            name="isolated launch command"
            tone="code"
            value={ISOLATED_LAUNCH_COMMAND}
          />
        </div>
        <p className="reading mt-2 max-w-[68ch] text-ink-muted">
          In any other client, connect from a separate profile that holds only this endpoint, or
          switch the other servers off before you start (in Claude Code,{' '}
          <span className="readout">/mcp</span> inside a session does it).
        </p>
        <p className="reading mt-2 max-w-[68ch] text-ink-muted">
          One thing no flag covers: tools built into the client itself, a browser extension for
          example, can still load. Disable those yourself for a clean run.
        </p>
      </div>

      {/* THE GENERIC PATH, always on screen and above every client. These are
          the protocol facts any MCP client needs, and nothing here names a
          vendor. */}
      <p className="reading max-w-[68ch]">
        This is a standard remote MCP server over Streamable HTTP, so any MCP client can register
        it. Point the client at the run endpoint above, send this header on every request, and read
        the task goal from the prompt the server publishes. There is no stdio command to run and no
        local process involved.
      </p>
      <Snippet
        label="REQUEST HEADER"
        name="authorization header"
        build={authorizationHeader}
        ticket={ticket}
      />
      <p className="reading max-w-[68ch] text-ink-muted">
        One thing to expect: the server opens no server-to-client stream, so a GET on the endpoint
        answers 405 and only POST and DELETE are served. A client that follows the specification
        treats that as normal and carries on over POST.
      </p>

      <p className="reading max-w-[68ch]">
        Each example below is built from the run you just issued and names the server{' '}
        <span className="readout">{MCP_SERVER_NAME}</span>. Keep that name neutral: your client
        namespaces the tools with it and your agent reads the name when it connects, so an id like
        mcpwn or red-team tells the agent it is being tested.
      </p>

      <p className="micro-label">CLIENT EXAMPLES</p>

      {/* A pressed-button group, not a tablist: it is the same control the MODE
          picker on this screen already uses, and one component vocabulary beats a
          roving-tabindex tablist for three buttons. `aria-controls` still names
          what each one changes, so a screen reader is told where the panel it
          just swapped actually is. Nothing is pressed until the reader chooses. */}
      <div className="flex flex-wrap gap-2.5" role="group" aria-label="MCP client example">
        {CLIENTS.map(([id, label]) => {
          const active = client === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              aria-controls={PANEL_ID}
              onClick={() => setClient(id)}
              className={cn(
                'min-h-11 rounded-md border px-4 py-2.5 font-mono text-[13px] tracking-[0.08em] transition-colors',
                active
                  ? 'border-nominal bg-nominal/10 text-readout shadow-glow-nominal'
                  : 'border-line bg-transparent text-ink-muted hover:border-line-em hover:text-ink',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div id={PANEL_ID}>
        {client === 'claude-code' && <ClaudeCode ticket={ticket} />}
        {client === 'claude-desktop' && <ClaudeDesktop ticket={ticket} />}
        {client === 'cursor' && <CursorOrVsCode ticket={ticket} />}
      </div>

      <Verify />
    </section>
  );
}

// ── Claude Code: the isolated launch first, then registration by shell ──

function ClaudeCode({ ticket }: { ticket: LiveRunTicketView }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="reading max-w-[68ch]">
        The isolated launch needs no registration. Save this as{' '}
        <span className="readout">{ISOLATED_CONFIG_FILE}</span> in the folder you start from, then
        run the isolated launch command above. It works the same in every shell, because nothing is
        quoted on the command line.
      </p>
      <Snippet
        label={`SAVE AS ${ISOLATED_CONFIG_FILE}`}
        name="Claude Code config file"
        build={desktopConfig}
        ticket={ticket}
      />
      <p className="reading max-w-[68ch]">
        If you would rather register the server, the command depends on your shell. Windows
        PowerShell strips the quotes inside the JSON before Claude Code sees them, so{' '}
        <span className="readout">add-json</span> fails there and the{' '}
        <span className="readout">--transport http</span> form is the one to use.
      </p>
      <Snippet
        label="MACOS / LINUX / BASH"
        name="Claude Code add-json command"
        build={addJsonCommand}
        ticket={ticket}
      />
      <Snippet
        label="WINDOWS / POWERSHELL: USE THIS ONE"
        name="Claude Code transport command"
        build={addTransportCommand}
        ticket={ticket}
      />
      <p className="reading max-w-[68ch] text-ink-muted">
        The header form echoes the token back in the confirmation your shell prints, so keep that
        output off a shared terminal and out of an issue report. Once registered, still start Claude
        Code with the isolated launch, not a plain <span className="readout">claude</span>.
      </p>
    </div>
  );
}

// ── Claude Desktop: a config file, and no bridge ──

function ClaudeDesktop({ ticket }: { ticket: LiveRunTicketView }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="reading max-w-[68ch]">
        Claude Desktop reads its servers from{' '}
        <span className="readout">claude_desktop_config.json</span>. Add this entry and restart the
        app. It speaks to a remote HTTP server natively, so there is no bridge to install and
        nothing to run on your own machine.
      </p>
      <Snippet
        label="CONFIG FILE ENTRY"
        name="Claude Desktop configuration"
        build={desktopConfig}
        ticket={ticket}
      />
    </div>
  );
}

// ── Cursor and VS Code: the same server entry, in a project config file ──

function CursorOrVsCode({ ticket }: { ticket: LiveRunTicketView }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="reading max-w-[68ch]">
        Cursor reads <span className="readout">.cursor/mcp.json</span> in the project, or{' '}
        <span className="readout">~/.cursor/mcp.json</span> for every project, in this shape. VS
        Code reads <span className="readout">.vscode/mcp.json</span> with the same server entry
        placed under a <span className="readout">servers</span> key instead of{' '}
        <span className="readout">mcpServers</span>. Both speak to a remote HTTP server natively, so
        there is nothing to install and nothing to run on your own machine.
      </p>
      <Snippet
        label="CONFIG FILE ENTRY"
        name="Cursor configuration"
        build={desktopConfig}
        ticket={ticket}
      />
    </div>
  );
}

// ── Did it work? ──

/**
 * Deliberately UNFRAMED. Four stacked bordered boxes in one section is the
 * thin-border panel soup PRODUCT.md lists as an anti-reference, and of the four
 * this is the one with the weakest claim to a frame: the caution callout is a
 * warning and the snippets are copyable artifacts, while this is two closing
 * sentences. The micro-label carries the scan cue instead.
 */
function Verify() {
  return (
    <div className="mt-1">
      <p className="micro-label">CHECK IT TOOK</p>
      <p className="reading mt-2 max-w-[68ch]">
        In any client, the reading that settles it is the connection panel below. It stays on
        AWAITING AGENT until your agent really reaches this endpoint, and it moves to AGENT
        CONNECTED the first time it does.
      </p>
      <p className="reading mt-2 max-w-[68ch] text-ink-muted">
        Clients have their own checks as well. In Claude Code, for example,{' '}
        <span className="readout">claude mcp list</span> should show{' '}
        <span className="readout">{MCP_SERVER_NAME}</span> as connected, and when it does not,{' '}
        <span className="readout">claude mcp get {MCP_SERVER_NAME}</span> prints the reason it gave.
      </p>
    </div>
  );
}
