'use client';

import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { MCP_SERVER_NAME, desktopConfig, vsCodeConfig } from '@/lib/mcp/config';
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
 * ── THE SIX RULES THIS SECTION IS BUILT AROUND ──
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
 *    `--header` carries no JSON and works everywhere. So `add-json` is not offered
 *    at all: every command left on this screen is byte-for-byte the same in bash
 *    and in PowerShell, and its label says so, so neither reader has to wonder
 *    whether a command is for them.
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
 * 4. ISOLATION IS STATED FIRST, AND AGAIN IN EVERY TAB. The tools this endpoint
 *    serves are hostile by design, so an agent that also holds live connectors
 *    for mail, files or a cloud account can carry an injected instruction out to
 *    a real system. The warning sits above the picker, and each tab then carries
 *    the isolation move its own client really has: Claude Code's
 *    `--strict-mcp-config` with `--mcp-config` (verified against 2.1.286: "Only
 *    use MCP servers from --mcp-config, ignoring all other MCP configurations"),
 *    the per-chat connector toggles in Claude Desktop, the editor's own MCP
 *    settings. No flag is offered that was not read off the client's own help.
 *    What no MCP flag covers is tooling built into the client itself (a browser
 *    extension, for one), and the copy says so rather than implying the isolation
 *    is total.
 *
 * 5. NO VENDOR IS THE WAY IN. The endpoint is a standard remote MCP server over
 *    Streamable HTTP with a bearer header; any MCP client can register it. So no
 *    tab is selected until the reader picks one, the generic path is a tab of its
 *    own and not a footnote, and the universal check (the connection panel) is
 *    stated outside every tab.
 *
 * 6. STEPS, NOT PARAGRAPHS. Every tab is one line of intro, a NUMBERED list and a
 *    short list of caveats. The earlier version explained each client in prose,
 *    which a reader who has never registered an MCP server could not follow: the
 *    order of operations was buried in sentences. A step that needs a value
 *    carries its snippet inside the step.
 *
 * ── THE TWO CLAUDE DESKTOP PATHS ──
 *
 * The Claude desktop app holds two different agents. Its Code panel is Claude
 * Code and takes the Claude Code steps (its own Code panel route). Its CHAT side
 * adds a remote server through a custom connector (Settings > Connectors > Add
 * custom connector). That dialog, as observed, has two fields, "Name" and "MCP
 * server URL", and no field for a header, so it cannot carry the run token and
 * cannot connect to a run. The tab says exactly that and points to the tabs that
 * can. An earlier version of this tab told the reader to fill a Request headers
 * section taken from documentation; the observed dialog has none.
 */

/**
 * A constant stand-in for the credential inside a rendered snippet. Derived from
 * nothing, so it discloses nothing, not even the token's length.
 */
const TOKEN_MASK = '•'.repeat(16);

/**
 * `claude mcp add --transport http`: the Claude Code form that carries no JSON,
 * so it survives every shell, Windows PowerShell included. It is the Code panel
 * route's registration command. The config files are built by the shared config module
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

type ClientId = 'claude-code' | 'claude-desktop-chat' | 'editors' | 'generic';

const CLIENTS: [ClientId, string][] = [
  ['claude-code', 'CLAUDE CODE'],
  ['claude-desktop-chat', 'CLAUDE DESKTOP (CHAT)'],
  ['editors', 'CURSOR / VS CODE'],
  ['generic', 'ANY MCP CLIENT'],
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

/** An inline machine string inside a sentence: a command, a file, a menu path. */
const Code = ({ children }: { children: ReactNode }) => <span className="readout">{children}</span>;

/**
 * One numbered step. The sentence is READING; whatever the step needs the reader
 * to copy sits inside the same list item, so "step 2" and its value never drift
 * apart.
 */
function Step({ children, snippets }: { children: ReactNode; snippets?: ReactNode }) {
  return (
    <li className="reading pl-1.5">
      {children}
      {snippets && <div className="mt-2.5 flex flex-col gap-2.5">{snippets}</div>}
    </li>
  );
}

/** A numbered list of steps. Real numerals, kept as list semantics. */
const STEP_LIST = 'max-w-[72ch] list-decimal space-y-4 pl-7 marker:font-mono marker:text-nominal';

/** The snippet label for a command that is the same in both shells (rule 2). */
const BOTH_SHELLS = 'BASH AND POWERSHELL';

/**
 * The shape every tab has, and the only shape a tab may have (rule 6): one line
 * of intro, the numbered steps, the caveats. `list-decimal` keeps real numerals
 * AND the list semantics a `list-none` reset would cost some screen readers.
 */
function ClientSteps({
  intro,
  children,
  route,
  caveats,
}: {
  intro: ReactNode;
  children: ReactNode;
  /**
   * A second, separately labelled route through the same client, when one
   * surface of it cannot take the main steps. Numbered on its own, so the two
   * routes never blur into one list.
   */
  route?: {
    /** Names the main list, once there are two, so "step 1" is never ambiguous. */
    mainLabel: string;
    label: string;
    steps: ReactNode;
  };
  caveats: ReactNode[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="reading max-w-[68ch]">{intro}</p>
      <div>
        {route && <p className="micro-label">{route.mainLabel}</p>}
        <ol className={cn(STEP_LIST, route && 'mt-3')}>{children}</ol>
      </div>
      {route && (
        <div className="mt-2">
          <p className="micro-label">{route.label}</p>
          <ol className={cn(STEP_LIST, 'mt-3')}>{route.steps}</ol>
        </div>
      )}
      <div>
        <p className="micro-label">KEEP IN MIND</p>
        <ul className="mt-2 max-w-[68ch] list-disc space-y-1.5 pl-6 marker:text-ink-faint">
          {caveats.map((caveat, i) => (
            <li key={i} className="reading pl-1 text-ink-muted">
              {caveat}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function ClientSetup({ ticket }: { ticket: LiveRunTicketView }) {
  // No client is selected until the reader picks one: a preselected tab would
  // make one vendor's command read as the way in.
  const [client, setClient] = useState<ClientId | null>(null);

  return (
    <section
      aria-labelledby="connect-client"
      className="flex flex-col gap-3 border-t border-line pt-6"
    >
      <h3 id="connect-client" className="reading-h3">
        Register the endpoint in your client.
      </h3>

      {/* THE HIGHEST-VALUE SENTENCE ON THE PAGE, above the steps rather than
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
      </div>

      <p className="micro-label mt-1">YOUR CLIENT</p>

      {/* A pressed-button group, not a tablist: it is the same control the MODE
          picker on this screen already uses, and one component vocabulary beats a
          roving-tabindex tablist for four buttons. `aria-controls` still names
          what each one changes, so a screen reader is told where the panel it
          just swapped actually is. Nothing is pressed until the reader chooses. */}
      <div className="flex flex-wrap gap-2.5" role="group" aria-label="MCP client">
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

      <div id={PANEL_ID} className="mt-1">
        {client === null && (
          <p className="reading max-w-[68ch] text-ink-muted">
            Pick the client your agent runs in to see its steps.
          </p>
        )}
        {client === 'claude-code' && <ClaudeCode ticket={ticket} />}
        {client === 'claude-desktop-chat' && <ClaudeDesktopChat />}
        {client === 'editors' && <CursorOrVsCode ticket={ticket} />}
        {client === 'generic' && <AnyClient ticket={ticket} />}
      </div>

      <Verify />
    </section>
  );
}

// ── Claude Code: a terminal, or the Code panel of the desktop app ──

function ClaudeCode({ ticket }: { ticket: LiveRunTicketView }) {
  return (
    <ClientSteps
      intro="For Claude Code in a terminal. The Code panel of the Claude desktop app has no launch command to add flags to, so it takes its own route, below."
      route={{
        mainLabel: 'TERMINAL ROUTE',
        label: 'CODE PANEL ROUTE',
        steps: (
          <>
            <Step
              snippets={
                <Snippet
                  label={BOTH_SHELLS}
                  name="Claude Code transport command"
                  build={addTransportCommand}
                  ticket={ticket}
                />
              }
            >
              Register the endpoint once from a terminal. The command is the same in bash and in
              PowerShell.
            </Step>
            <Step>
              Open a new session in the Code panel and type <Code>/mcp</Code>. Switch off every
              server it lists except <Code>{MCP_SERVER_NAME}</Code>.
            </Step>
            <Step>
              Paste the task goal from the next section, or fetch the published prompt named there.
            </Step>
          </>
        ),
      }}
      caveats={[
        'The token is shown once. Every command here carries it, so copy what you need before you leave this page.',
        <>
          Keep the attack run away from your real tools. A plain <Code>claude</Code> loads every
          other server you have alongside this one.
        </>,
        'The Code panel route echoes the token back in the confirmation your shell prints. Keep that output off a shared terminal and out of an issue report.',
        'No flag covers tools built into the client itself, a browser extension for example. Disable those yourself for a clean run.',
        <>
          If the server does not connect, <Code>claude mcp get {MCP_SERVER_NAME}</Code> prints the
          reason.
        </>,
      ]}
    >
      <Step
        snippets={
          <Snippet
            label={`SAVE AS ${ISOLATED_CONFIG_FILE}`}
            name="Claude Code config file"
            build={desktopConfig}
            ticket={ticket}
          />
        }
      >
        Save this file as <Code>{ISOLATED_CONFIG_FILE}</Code> in the folder you start Claude Code
        from. The next step loads this file and ignores every other server you have.
      </Step>
      <Step
        snippets={
          <CopyOut
            label={BOTH_SHELLS}
            name="isolated launch command"
            tone="code"
            value={ISOLATED_LAUNCH_COMMAND}
          />
        }
      >
        Start Claude Code with only that file&apos;s server loaded. The command is the same in bash
        and in PowerShell.
      </Step>
      <Step>
        Type <Code>/mcp</Code> in the session. It should list <Code>{MCP_SERVER_NAME}</Code> and
        nothing else. If another server is listed, switch it off there before you go on.
      </Step>
      <Step>
        Paste the task goal from the next section, or fetch the published prompt named there.
      </Step>
    </ClientSteps>
  );
}

// ── Claude Desktop, chat side: a custom connector, not Claude Code's config ──

/**
 * Written from the dialog as observed in Claude Desktop (Settings > Connectors >
 * Add custom connector): two fields, "Name" and "MCP server URL", and the buttons
 * "Cancel" and "Continue". There is no header field and no Advanced section, so
 * nothing on it can carry the run token. The tab describes only that screen and
 * claims nothing about what follows Continue.
 */
function ClaudeDesktopChat() {
  return (
    <ClientSteps
      intro="For the chat side of the Claude desktop app, not the Code panel. Its custom connector dialog cannot carry the run token."
      caveats={[
        'The token is shown once, on this page. Copy it into a client that can carry it before you leave.',
        'A connector added without the token is refused by the run endpoint, so it never reaches the attack run.',
      ]}
    >
      <Step>
        Open <Code>Settings &gt; Connectors</Code> and select <Code>Add custom connector</Code>.
      </Step>
      <Step>
        The dialog asks for two things, <Code>Name</Code> and <Code>MCP server URL</Code>, and
        offers <Code>Cancel</Code> and <Code>Continue</Code>.
      </Step>
      <Step>
        It has no field for the run token, and every request to an MCPwn run has to carry that
        token. So this dialog cannot connect to an MCPwn run. Select <Code>Cancel</Code>.
      </Step>
      <Step>
        Connect from the Claude Code tab instead, whose Code panel route works inside the Claude
        desktop app, or from the Any MCP client tab.
      </Step>
    </ClientSteps>
  );
}

// ── Cursor and VS Code: the same server entry, one key apart ──

function CursorOrVsCode({ ticket }: { ticket: LiveRunTicketView }) {
  return (
    <ClientSteps
      intro="Cursor and VS Code each read one small JSON file and speak to a remote HTTP server natively. There is nothing to install."
      caveats={[
        'The token is shown once, and the file holds it in plain text. Delete the file after the run and never commit it.',
        'Any other server or extension the editor agent can use is within reach of the attack run. Switch them off first.',
      ]}
    >
      <Step>Open an empty folder in the editor, so the agent has no project files in reach.</Step>
      <Step
        snippets={
          <>
            <Snippet
              label="CURSOR · .cursor/mcp.json"
              name="Cursor configuration"
              build={desktopConfig}
              ticket={ticket}
            />
            <Snippet
              label="VS CODE · .vscode/mcp.json"
              name="VS Code configuration"
              build={vsCodeConfig}
              ticket={ticket}
            />
          </>
        }
      >
        Save the file for your editor in that folder. VS Code reads the same entry under a{' '}
        <Code>servers</Code> key instead of <Code>mcpServers</Code>, so it has its own block.
      </Step>
      <Step>
        Open the MCP settings of the editor, switch every other server off, and check that{' '}
        <Code>{MCP_SERVER_NAME}</Code> shows as connected.
      </Step>
      <Step>Start a new agent chat and paste the task goal from the next section.</Step>
    </ClientSteps>
  );
}

// ── Any MCP client: the protocol facts, with no vendor in them ──

function AnyClient({ ticket }: { ticket: LiveRunTicketView }) {
  return (
    <ClientSteps
      intro="This is a standard remote MCP server over Streamable HTTP, so any MCP client can register it."
      caveats={[
        'The token is shown once. Copy the header before you leave this page.',
        'Any other tool your agent holds is within reach of the attack run. Connect from a separate profile that holds only this endpoint, or switch the others off.',
        'The server opens no server-to-client stream, so a GET on the endpoint answers 405 and only POST and DELETE are served. A client that follows the specification carries on over POST.',
      ]}
    >
      <Step>
        Add a remote server with the Streamable HTTP transport and point it at the RUN ENDPOINT from
        the top of this page. There is no stdio command to run and no local process.
      </Step>
      <Step
        snippets={
          <Snippet
            label="REQUEST HEADER"
            name="authorization header"
            build={authorizationHeader}
            ticket={ticket}
          />
        }
      >
        Send this header on every request.
      </Step>
      <Step>
        Name the server <Code>{MCP_SERVER_NAME}</Code>. Your client namespaces the tools with that
        name and your agent reads it, so keep it neutral.
      </Step>
      <Step>Make this the only server the agent has loaded.</Step>
      <Step>
        Read the task goal from the prompt the server publishes, <Code>{ticket.promptName}</Code>,
        or paste it from the next section.
      </Step>
    </ClientSteps>
  );
}

// ── Did it work? ──

/**
 * Deliberately UNFRAMED and outside every tab: the connection panel is the one
 * check that holds for every client, so it is said once. The micro-label carries
 * the scan cue instead of another bordered box.
 */
function Verify() {
  return (
    <div className="mt-1">
      <p className="micro-label">CHECK IT TOOK</p>
      <p className="reading mt-2 max-w-[68ch]">
        In any client, the reading that settles it is the connection panel on this screen. It stays
        on AWAITING AGENT until your agent really reaches this endpoint, and it moves to AGENT
        CONNECTED the first time it does.
      </p>
    </div>
  );
}
