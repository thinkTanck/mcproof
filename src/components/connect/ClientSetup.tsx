'use client';

import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import {
  MCP_SERVER_NAME,
  claudeCodeConfig,
  codexConfig,
  cursorConfig,
  geminiConfig,
  genericConfig,
  vsCodeConfig,
} from '@/lib/mcp/config';
import { CopyOut } from './CopyOut';
import type { LiveRunPhase, LiveRunTicketView } from './live-run-port';

/**
 * HOW TO ACTUALLY CONNECT: one three-step setup, the same for six agents.
 *
 * The console issues a correct endpoint, a correct token and a correct goal. This
 * section is the only place that says what the reader has to DO with them. It
 * used to be four tabs of four different shapes (five steps, a dialog that could
 * not connect, two editors in one tab, a nine-step walk of the whole run), so a
 * first-time reader had to learn a new layout for every client. Now every tab is
 * the same three steps under the same three names:
 *
 *   1. Connect           ONE paste-ready config block built for this run, one
 *                        line on the client's other MCP servers, and the live
 *                        connection reading under it.
 *   2. Give it the job   the task goal, with a copy control.
 *   3. Finish            "When your agent is done, End run and judge."
 *
 * ── THE TABS ──
 *
 * Claude Code, GitHub Copilot / VS Code, Cursor, Codex, Gemini CLI, Other agent.
 * No tab is selected until the reader picks one, so no vendor reads as the way
 * in. The Claude desktop app's CHAT side has no tab: its custom connector dialog
 * has no field for a header, so it cannot carry the run token. One line under
 * the tabs says that for every chat app at once.
 *
 * ── THE RULES THIS SECTION IS BUILT AROUND ──
 *
 * 1. A REAL CONFIG, NOT A DESCRIPTION OF ONE. Every block is built from the
 *    issued ticket, so it is the config for THIS run and not a template with
 *    placeholders to fill in. The builders live in `@/lib/mcp/config`, one per
 *    client, each in the format that client's own documentation gives (read
 *    2026-10-10; the URLs are beside the builders).
 *
 * 2. A COMMAND HAS TO SURVIVE THE READER'S SHELL. Every command here is
 *    byte-for-byte the same in bash and in PowerShell, and its label says so.
 *    That is why Claude Code's `add-json` form is not offered (Windows
 *    PowerShell strips the quotes inside its JSON) and why the folder command
 *    uses `;` and not `&&`.
 *
 * 3. THE TOKEN IS COPYABLE WITHOUT BEING VISIBLE. A working config has to carry
 *    the credential, and a credential rendered inside a code block undoes the
 *    masking on the token block above it. So each snippet is BUILT TWICE from
 *    the same function: once with the real token (that string is only ever
 *    handed to the clipboard) and once with a constant mask (that string is the
 *    only one that reaches the DOM). It is deliberately not a find-and-replace
 *    over the real text: a replace that misses prints the credential, and a
 *    string built from a mask has never held it.
 *
 * 4. ISOLATION IS STATED FIRST, AND AGAIN IN EVERY TAB. The tools this endpoint
 *    serves are hostile by design, so an agent that also holds live connectors
 *    can carry an injected instruction out to a real system. The warning sits
 *    above the picker, and step 1 of each tab then carries the one isolation
 *    move its own client really has: Claude Code's `--strict-mcp-config` with
 *    `--mcp-config` (verified against 2.1.286), Gemini CLI's
 *    `--allowed-mcp-server-names`, Codex's `enabled = false`, the server lists
 *    in VS Code and Cursor. No flag is offered that was not read off the
 *    client's own help or documentation. A client that runs from a folder is
 *    started in a new, empty one, so no file of the reader's is in reach.
 *
 * 5. A FILE THAT IS NOT OURS IS ADDED TO, NEVER REPLACED. Four tabs save a new
 *    file inside the new folder. Codex reads a file in the home folder that the
 *    reader may already rely on, so its block is one table to ADD to that file,
 *    and the step says to remove it after the run. Every file holds the token in
 *    plain text, and every tab says so.
 *
 * 6. THE STATUS IS THE CONSOLE'S, NOT A SECOND OPINION. The reading under step 1
 *    is the phase `LiveRunConsole` already polls for and passes down. This
 *    component reads nothing from the server. It replaces the old CHECK IT TOOK
 *    paragraph, which described the connection panel instead of showing it.
 *
 * 7. UNTESTED IS SAID, AND IT IS NOT A WARNING. Four of the six tabs were
 *    written from documentation and have not been run by us. They carry an
 *    UNTESTED tag in the inert fourth state, icon plus label: never caution and
 *    never red, because an untested config is not a failing one.
 *
 * ── THE CODE PANEL ROUTE ──
 *
 * The Claude desktop app's Code panel is Claude Code, and it keeps a route of
 * its own UNDER the Claude Code steps, marked NOT RECOMMENDED: as tested in the
 * desktop app, the panel has no `/mcp` command and loads every connector the app
 * has, so it cannot be limited to the run's server. The warning comes before its
 * steps and sends the reader to the terminal route.
 */

/**
 * A constant stand-in for the credential inside a rendered snippet. Derived from
 * nothing, so it discloses nothing, not even the token's length.
 */
const TOKEN_MASK = '•'.repeat(16);

/**
 * `claude mcp add --transport http`: the Claude Code form that carries no JSON,
 * so it survives every shell, Windows PowerShell included. It is the Code panel
 * route's registration command. It builds no server config of its own, so it
 * stays here, named from the shared constant.
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

/** Where VS Code reads its workspace MCP servers from. Shown and typed in this case. */
export const VSCODE_CONFIG_FILE = '.vscode/mcp.json';

/** Where Cursor reads its project MCP servers from. */
export const CURSOR_CONFIG_FILE = '.cursor/mcp.json';

/**
 * Where Codex reads its MCP servers from: a file in the home folder, shared by
 * every Codex session. It is added to, never saved over.
 */
export const CODEX_CONFIG_FILE = '~/.codex/config.toml';

/** Where Gemini CLI reads a project's settings from. */
export const GEMINI_CONFIG_FILE = '.gemini/settings.json';

/**
 * Launch Claude Code with ONLY the servers in the named file. Both flags were
 * read off `claude --help` (2.1.286): `--mcp-config` loads servers from a JSON
 * file and `--strict-mcp-config` ignores every other MCP configuration. It
 * carries no credential (the token lives in the file), so it is rendered and
 * copied as is.
 */
export const ISOLATED_LAUNCH_COMMAND = `claude --strict-mcp-config --mcp-config ${ISOLATED_CONFIG_FILE}`;

/**
 * Launch Gemini CLI with only the run's server allowed for the session. The flag
 * is in Gemini CLI's configuration reference: "A comma-separated list of MCP
 * server names to allow for the session." It carries no credential.
 */
export const GEMINI_LAUNCH_COMMAND = `gemini --allowed-mcp-server-names ${MCP_SERVER_NAME}`;

/**
 * A new, empty folder to work in, first in every route that runs from a folder.
 * An agent can read the folder it was started in, so starting it among real
 * project files puts those files in reach of the run. One command for both
 * shells: `;` and not `&&`, which Windows PowerShell 5.1 does not have. The
 * name is neutral for the same reason the server name is.
 */
export const NEW_FOLDER = 'run-folder';
export const NEW_FOLDER_COMMAND = `mkdir ${NEW_FOLDER}; cd ${NEW_FOLDER}`;

/** The header every request carries, and the value that goes in it. */
export const AUTHORIZATION_HEADER_NAME = 'Authorization';
export function authorizationValue(_endpoint: string, token: string): string {
  return `Bearer ${token}`;
}

/** The swapped panel, named so each picker button can point at it. */
const PANEL_ID = 'connect-client-panel';

type ClientId = 'claude-code' | 'vscode' | 'cursor' | 'codex' | 'gemini' | 'other';

/**
 * The tabs, in the order they are offered. `untested` marks a client whose steps
 * were written from its documentation and have not been run by us.
 */
const CLIENTS: readonly { id: ClientId; label: string; untested: boolean }[] = [
  { id: 'claude-code', label: 'CLAUDE CODE', untested: false },
  { id: 'vscode', label: 'GITHUB COPILOT / VS CODE', untested: true },
  { id: 'cursor', label: 'CURSOR', untested: true },
  { id: 'codex', label: 'CODEX', untested: true },
  { id: 'gemini', label: 'GEMINI CLI', untested: true },
  { id: 'other', label: 'OTHER AGENT', untested: false },
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
 * UNTESTED, in the inert fourth state: a dashed ring and the word. Never caution
 * and never red. Nothing is wrong with an untested config; nobody here has run
 * it yet, and that is all the tag says.
 */
function UntestedTag() {
  return (
    <span
      data-testid="untested-tag"
      className="inline-flex items-center gap-1.5 font-mono text-[12px] tracking-[0.08em]"
      style={{ color: 'var(--status-inert)' }}
    >
      <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
        <circle
          cx="7"
          cy="7"
          r="5.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeDasharray="2.4 2"
        />
      </svg>
      UNTESTED
    </span>
  );
}

/** The same words the pinned run bar uses for the same phases. */
const STATUS_LABELS: Record<Exclude<LiveRunPhase, 'finished'>, string> = {
  waiting: 'AWAITING AGENT',
  connected: 'AGENT CONNECTED',
};

/**
 * THE LIVE READING UNDER STEP 1. It is handed the phase the console already
 * polls for, so it is the bar's own reading drawn a second time, beside the
 * config it reports on. An icon plus a label, never colour alone: a hollow ring
 * in the inert state while nobody has connected, a ticked ring in the normal
 * state once an agent has. It is never caution and never red.
 *
 * A finished run draws no setup at all, so that phase never reaches this.
 */
function AgentStatus({ phase }: { phase: LiveRunPhase | null }) {
  const connected = phase === 'connected';
  const label =
    phase === 'waiting' || phase === 'connected' ? STATUS_LABELS[phase] : 'READING RUN STATE';
  return (
    <div className="flex flex-col gap-2">
      <div
        role="status"
        data-testid="agent-status"
        className={cn(
          'inline-flex items-center gap-2 font-mono text-[13px] tracking-[0.08em]',
          connected && 'text-nominal',
        )}
        style={connected ? undefined : { color: 'var(--status-inert)' }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className="shrink-0">
          <circle cx="7" cy="7" r="5.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
          {connected && (
            <path
              d="M4.4 7.2 6.3 9l3.4-3.8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
        {label}
      </div>
      <p className="reading measure text-ink-muted">
        {connected
          ? 'Your agent has reached the endpoint. Go on to step 2.'
          : phase === 'waiting'
            ? 'This reading changes to AGENT CONNECTED when your agent reaches the endpoint. If it does not change, the connection did not take.'
            : 'We are reading the state of this run from the server.'}
      </p>
    </div>
  );
}

/**
 * One snippet. `build` is called twice: once with the real token for the
 * clipboard, once with the mask for the screen. See rule 3 above.
 */
function Snippet({
  label,
  file,
  name,
  build,
  ticket,
}: {
  label: string;
  /** A file name the label ends with, kept in its own case. See `CopyOut`. */
  file?: string;
  name: string;
  build: (endpoint: string, token: string) => string;
  ticket: LiveRunTicketView;
}) {
  return (
    <CopyOut
      label={label}
      file={file}
      name={name}
      tone="code"
      value={build(ticket.endpoint, ticket.token)}
      display={build(ticket.endpoint, TOKEN_MASK)}
    />
  );
}

/** THE config block of a tab. There is exactly one, and a test counts it. */
function ConfigBlock(props: Parameters<typeof Snippet>[0]) {
  return (
    <div data-testid="config-block">
      <Snippet {...props} />
    </div>
  );
}

/** An inline machine string inside a sentence: a command, a file, a menu path. */
const Code = ({ children }: { children: ReactNode }) => <span className="readout">{children}</span>;

/** The snippet label for a command that is the same in both shells (rule 2). */
const BOTH_SHELLS = 'BASH AND POWERSHELL';

/** The three steps. Real numerals, kept as list semantics. */
const STEP_LIST = 'list-decimal space-y-6 pl-7 marker:font-mono marker:text-nominal';

/** The actions inside one step: lettered, so "step 1" still means one thing. */
const ACTION_LIST = 'list-[lower-alpha] space-y-4 pl-6 marker:font-mono marker:text-ink-muted';

/**
 * One of the three steps. The name is a short phrase a person reads, so it wears
 * a READING role; everything the step needs sits inside the same list item.
 */
function SetupStep({ name, children }: { name: string; children: ReactNode }) {
  return (
    <li data-testid="setup-step" className="reading pl-1.5">
      <p data-testid="setup-step-name" className="reading-lead font-medium">
        {name}
      </p>
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </li>
  );
}

/**
 * One lettered action inside step 1. Only the sentence takes the reading
 * measure: the snippet under it is a copy-out box, and those keep the width of
 * the list.
 */
function Action({ children, snippets }: { children: ReactNode; snippets?: ReactNode }) {
  return (
    <li className="reading pl-1">
      <div className="measure">{children}</div>
      {snippets && <div className="mt-2.5 flex flex-col gap-2.5">{snippets}</div>}
    </li>
  );
}

/** The first action of every route that starts from a terminal. */
function NewFolderAction({ children }: { children: ReactNode }) {
  return (
    <Action
      snippets={
        <CopyOut
          label={BOTH_SHELLS}
          name="new folder command"
          tone="code"
          value={NEW_FOLDER_COMMAND}
        />
      }
    >
      {children}
    </Action>
  );
}

/** The sentence every saved file carries: it holds the token, so it goes. */
const FILE_HOLDS_TOKEN = 'It holds the token in plain text, so delete it after the run.';

/**
 * THE SHAPE EVERY TAB HAS, and the only shape a tab may have: an optional tag,
 * one line of intro, then the three steps. A tab supplies step 1's actions and
 * its one line about other servers; steps 2 and 3 are the same words everywhere.
 */
function ThreeSteps({
  intro,
  untested = false,
  actions,
  otherServers,
  ticket,
  phase,
  children,
}: {
  intro: string;
  untested?: boolean;
  /** Step 1's lettered actions. Exactly one of them holds the config block. */
  actions: ReactNode;
  /** The one line on turning off this client's other MCP servers. */
  otherServers: ReactNode;
  ticket: LiveRunTicketView;
  phase: LiveRunPhase | null;
  /** Anything a tab adds UNDER the three steps. */
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      {untested && (
        <div
          data-testid="untested-note"
          className="flex flex-col gap-1.5 rounded-lg border border-line bg-panel/60 px-4 py-3.5"
        >
          <UntestedTag />
          <p className="reading measure">
            We have not tested this client ourselves yet. These steps follow its own documentation.
            The status under step 1 shows whether it connected.
          </p>
        </div>
      )}
      <p data-testid="client-intro" className="reading measure">
        {intro}
      </p>
      <ol data-testid="setup-steps" className={STEP_LIST}>
        <SetupStep name="Connect">
          <ol className={ACTION_LIST}>{actions}</ol>
          <p data-testid="other-servers-line" className="reading measure">
            {otherServers}
          </p>
          <AgentStatus phase={phase} />
        </SetupStep>
        <SetupStep name="Give it the job">
          <p className="reading measure">Paste this into your agent. It is the whole task.</p>
          {/* The label carries the ISSUED run's category: this is the task of the
              run, not of whatever the picker above now has selected. */}
          <CopyOut
            label={`TASK GOAL · ${ticket.category}`}
            name="job for your agent"
            value={ticket.taskGoal}
            tone="prose"
          />
        </SetupStep>
        <SetupStep name="Finish">
          <p data-testid="finish-line" className="reading measure">
            When your agent is done, End run and judge.
          </p>
        </SetupStep>
      </ol>
      {children}
    </div>
  );
}

export function ClientSetup({
  ticket,
  phase = null,
}: {
  ticket: LiveRunTicketView;
  /**
   * The connection phase the console last read, or `null` before its first
   * read. Passed down, never fetched here: there is one poller for a run.
   */
  phase?: LiveRunPhase | null;
}) {
  // No client is selected until the reader picks one: a preselected tab would
  // make one vendor's config read as the way in.
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
        <p className="reading mt-2 measure">
          Connect an agent that has no other tools attached. A run here can carry an instruction
          aimed at whatever your agent can reach, so if the same agent is also holding a live
          connector for mail, files, a browser or a cloud account, an instruction it takes on this
          endpoint can reach the real thing.
        </p>
      </div>

      <p className="micro-label mt-1">YOUR AGENT</p>

      {/* A pressed-button group, not a tablist: it is the same control the MODE
          picker on this screen already uses, and one component vocabulary beats a
          roving-tabindex tablist. `aria-controls` still names what each one
          changes. Nothing is pressed until the reader chooses.

          SIX BUTTONS HAVE TO FIT A 320px PHONE. The group wraps, each button is
          capped at the width of the group, and a label may wrap inside its own
          button, so the longest one (with its tag) never pushes the page
          sideways. */}
      <div className="flex flex-wrap gap-2.5" role="group" aria-label="MCP client">
        {CLIENTS.map(({ id, label, untested }) => {
          const active = client === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              aria-controls={PANEL_ID}
              onClick={() => setClient(id)}
              className={cn(
                'inline-flex min-h-11 max-w-full flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md border px-4 py-2.5 text-left font-mono text-[13px] tracking-[0.08em] transition-colors',
                active
                  ? 'border-nominal bg-nominal/10 text-readout shadow-glow-nominal'
                  : 'border-line bg-transparent text-ink-muted hover:border-line-em hover:text-ink',
              )}
            >
              <span data-testid="client-tab-label">{label}</span>
              {/* The space is for the accessible name, which would otherwise run
                  the label and the tag together as one word. The button is a
                  flex row, so it draws nothing. */}
              {untested && (
                <>
                  {' '}
                  <UntestedTag />
                </>
              )}
            </button>
          );
        })}
      </div>

      <p data-testid="chat-apps-line" className="reading measure text-ink-muted">
        Chat apps (Claude, ChatGPT, Gemini) can&apos;t carry a run token. Use one of the agents
        above.
      </p>

      <div id={PANEL_ID} className="mt-1">
        {client === null && (
          <p className="reading measure text-ink-muted">
            Pick the agent you will use to see its steps.
          </p>
        )}
        {client === 'claude-code' && <ClaudeCode ticket={ticket} phase={phase} />}
        {client === 'vscode' && <VsCode ticket={ticket} phase={phase} />}
        {client === 'cursor' && <Cursor ticket={ticket} phase={phase} />}
        {client === 'codex' && <Codex ticket={ticket} phase={phase} />}
        {client === 'gemini' && <GeminiCli ticket={ticket} phase={phase} />}
        {client === 'other' && <OtherAgent ticket={ticket} phase={phase} />}
      </div>
    </section>
  );
}

interface TabProps {
  ticket: LiveRunTicketView;
  phase: LiveRunPhase | null;
}

// ── Claude Code: a terminal, with the Code panel route under it ──

function ClaudeCode({ ticket, phase }: TabProps) {
  return (
    <ThreeSteps
      intro="For Claude Code in a terminal."
      ticket={ticket}
      phase={phase}
      actions={
        <>
          <NewFolderAction>
            Open a terminal. Make a new, empty folder and move into it, so the agent starts with no
            files of yours in reach.
          </NewFolderAction>
          <Action
            snippets={
              <ConfigBlock
                label="SAVE AS"
                file={ISOLATED_CONFIG_FILE}
                name="Claude Code config"
                build={claudeCodeConfig}
                ticket={ticket}
              />
            }
          >
            Save this file in that folder. {FILE_HOLDS_TOKEN}
          </Action>
          <Action
            snippets={
              <CopyOut
                label={BOTH_SHELLS}
                name="isolated launch command"
                tone="code"
                value={ISOLATED_LAUNCH_COMMAND}
              />
            }
          >
            Start Claude Code with this command.
          </Action>
        </>
      }
      otherServers={
        <>
          The command loads only this file, so your other MCP servers stay off. Type{' '}
          <Code>/mcp</Code> to check: it should list <Code>{MCP_SERVER_NAME}</Code> and nothing
          else.
        </>
      }
    >
      <div data-testid="code-panel-route" className="mt-2 flex flex-col gap-3">
        <p className="micro-label">CODE PANEL ROUTE</p>
        {/* CAUTION amber with an icon and a label, never colour alone, and never
            red: an unsafe way to run a test is not a breach. */}
        <div
          role="note"
          aria-labelledby="code-panel-warning"
          className="rounded-lg border border-caution/40 bg-caution/5 px-4 py-3.5"
        >
          <p id="code-panel-warning" className="micro-label flex items-center gap-2 text-caution">
            <WarningIcon />
            NOT RECOMMENDED
          </p>
          <p className="reading mt-2 measure">
            The Code panel of the Claude desktop app cannot be limited to{' '}
            <Code>{MCP_SERVER_NAME}</Code>. It loads every connector your Claude app has and gives
            you no way to switch them off, so an agent that is compromised in a run there can reach
            your real connectors. To run a test, use the terminal route above. The steps below are
            for anyone who still chooses the Code panel.
          </p>
        </div>
        <ol className="list-decimal space-y-4 pl-7 marker:font-mono marker:text-ink-muted">
          <NewFolderAction>
            Open a terminal. Make a new, empty folder and move into it.
          </NewFolderAction>
          <Action
            snippets={
              <Snippet
                label={BOTH_SHELLS}
                name="Claude Code transport command"
                build={addTransportCommand}
                ticket={ticket}
              />
            }
          >
            Register the endpoint from that folder. Your shell echoes the token back when it
            confirms, so keep that output off a shared screen.
          </Action>
          <Action>
            Open a new session in the Code panel, in that folder. The panel has no <Code>/mcp</Code>{' '}
            command, so the other connectors it loaded stay on.
          </Action>
          <Action>Then carry on from step 2 above.</Action>
        </ol>
      </div>
    </ThreeSteps>
  );
}

// ── GitHub Copilot in VS Code: `.vscode/mcp.json`, under `servers` ──

function VsCode({ ticket, phase }: TabProps) {
  return (
    <ThreeSteps
      untested
      intro="For GitHub Copilot Chat in VS Code."
      ticket={ticket}
      phase={phase}
      actions={
        <>
          <Action>
            Open a new, empty folder in VS Code, so the agent has no project files in reach.
          </Action>
          <Action
            snippets={
              <ConfigBlock
                label="SAVE AS"
                file={VSCODE_CONFIG_FILE}
                name="VS Code config"
                build={vsCodeConfig}
                ticket={ticket}
              />
            }
          >
            Save this file in that folder. {FILE_HOLDS_TOKEN}
          </Action>
          <Action>
            Open Copilot Chat in agent mode. VS Code asks whether you trust the new server the first
            time it starts.
          </Action>
        </>
      }
      otherServers={
        <>
          Run <Code>MCP: List Servers</Code> from the Command Palette and stop every other server,
          so <Code>{MCP_SERVER_NAME}</Code> is the only one running.
        </>
      }
    />
  );
}

// ── Cursor: `.cursor/mcp.json`, `url` and `headers` ──

function Cursor({ ticket, phase }: TabProps) {
  return (
    <ThreeSteps
      untested
      intro="For the agent in Cursor."
      ticket={ticket}
      phase={phase}
      actions={
        <>
          <Action>
            Open a new, empty folder in Cursor, so the agent has no project files in reach.
          </Action>
          <Action
            snippets={
              <ConfigBlock
                label="SAVE AS"
                file={CURSOR_CONFIG_FILE}
                name="Cursor config"
                build={cursorConfig}
                ticket={ticket}
              />
            }
          >
            Save this file in that folder. {FILE_HOLDS_TOKEN}
          </Action>
          <Action>Start a new agent chat in that folder.</Action>
        </>
      }
      otherServers={
        <>
          Open <Code>Customize</Code> in the sidebar and switch off every other MCP server, so{' '}
          <Code>{MCP_SERVER_NAME}</Code> is the only one on.
        </>
      }
    />
  );
}

// ── Codex: one table added to the config file in the home folder ──

function Codex({ ticket, phase }: TabProps) {
  return (
    <ThreeSteps
      untested
      intro="For the Codex CLI in a terminal."
      ticket={ticket}
      phase={phase}
      actions={
        <>
          <NewFolderAction>
            Open a terminal. Make a new, empty folder and move into it, so the agent starts with no
            files of yours in reach.
          </NewFolderAction>
          <Action
            snippets={
              <ConfigBlock
                label="ADD TO"
                file={CODEX_CONFIG_FILE}
                name="Codex config"
                build={codexConfig}
                ticket={ticket}
              />
            }
          >
            Add this block to the end of the Codex config file in your home folder, and keep
            everything that is already in it. The block holds the token in plain text, so remove it
            after the run.
          </Action>
          <Action>
            Start Codex in the new folder with <Code>codex</Code>.
          </Action>
        </>
      }
      otherServers={
        <>
          For this run, add <Code>enabled = false</Code> under every other{' '}
          <Code>[mcp_servers]</Code> table in that file, so <Code>{MCP_SERVER_NAME}</Code> is the
          only one on.
        </>
      }
    />
  );
}

// ── Gemini CLI: a project settings file, `httpUrl` and `headers` ──

function GeminiCli({ ticket, phase }: TabProps) {
  return (
    <ThreeSteps
      untested
      intro="For Gemini CLI in a terminal."
      ticket={ticket}
      phase={phase}
      actions={
        <>
          <NewFolderAction>
            Open a terminal. Make a new, empty folder and move into it, so the agent starts with no
            files of yours in reach.
          </NewFolderAction>
          <Action
            snippets={
              <ConfigBlock
                label="SAVE AS"
                file={GEMINI_CONFIG_FILE}
                name="Gemini CLI config"
                build={geminiConfig}
                ticket={ticket}
              />
            }
          >
            Save this file in that folder. {FILE_HOLDS_TOKEN}
          </Action>
          <Action
            snippets={
              <CopyOut
                label={BOTH_SHELLS}
                name="Gemini CLI launch command"
                tone="code"
                value={GEMINI_LAUNCH_COMMAND}
              />
            }
          >
            Start Gemini CLI with this command. If it asks whether you trust the folder, say yes, or
            it will not read the file.
          </Action>
        </>
      }
      otherServers={
        <>
          The command allows only <Code>{MCP_SERVER_NAME}</Code> for this session, so your other MCP
          servers stay off. Type <Code>/mcp</Code> to check.
        </>
      }
    />
  );
}

// ── Other agent: the generic block, the two raw values, and what Inspector is ──

function OtherAgent({ ticket, phase }: TabProps) {
  return (
    <ThreeSteps
      intro="Bring your own agent: one you built, or any app that supports MCP."
      ticket={ticket}
      phase={phase}
      actions={
        <>
          <NewFolderAction>
            If your agent starts from a folder, make a new, empty folder and start it there, so it
            has no files of yours in reach.
          </NewFolderAction>
          <Action
            snippets={
              <>
                <ConfigBlock
                  label="JSON CONFIG"
                  name="generic config"
                  build={genericConfig}
                  ticket={ticket}
                />
                <CopyOut label="ENDPOINT" name="endpoint" tone="code" value={ticket.endpoint} />
                <Snippet
                  label="HEADER VALUE"
                  name="header value"
                  build={authorizationValue}
                  ticket={ticket}
                />
              </>
            }
          >
            Add this server to your agent. Paste the JSON block if it takes one. If it asks for the
            values one at a time, they are under the block: the endpoint, and the value of a header
            named <Code>{AUTHORIZATION_HEADER_NAME}</Code>. The transport is Streamable HTTP.
          </Action>
        </>
      }
      otherServers="Make this the only MCP server your agent has loaded, with no other tools attached."
    >
      <p data-testid="frameworks-line" className="reading measure">
        Frameworks with MCP support include Claude Agent SDK, OpenAI Agents SDK, CrewAI and
        Microsoft Agent Framework. LangGraph and Google ADK connect through adapters.
      </p>
      <p className="reading measure text-ink-muted">
        If you are writing your own client: the server opens no server-to-client stream, so a GET on
        the endpoint answers 405. A client that follows the MCP specification carries on over POST.
      </p>
      {/* A BEGINNER NOTE, not a warning: the neutral panel, no caution and no
          red. Its title is a question a person reads, so it wears a READING
          role and not a label. */}
      <div
        role="note"
        aria-labelledby="inspector-note"
        className="flex flex-col gap-2 rounded-lg border border-line bg-panel/60 px-4 py-3.5"
      >
        <p id="inspector-note" className="reading-lead font-medium">
          What is MCP Inspector?
        </p>
        <p className="reading measure">
          MCP Inspector is a free tool from the MCP project. It lets you connect to a server
          yourself and press its tools by hand.
        </p>
        <p className="reading measure">
          Use it only to check that your endpoint and token work: add a server, choose Streamable
          HTTP, paste the endpoint, add the Authorization header, connect, then list the tools.
        </p>
        <p className="reading measure">
          It is not an agent, so pressing tools yourself is not a test. For that run, use Discard
          run instead of End run and judge.
        </p>
      </div>
    </ThreeSteps>
  );
}
