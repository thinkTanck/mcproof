import type { Step } from '@/contract';

/**
 * WHO IS SPEAKING IN A REPLAY (Batch G, 2026-10-13).
 *
 * A replay is drawn as a shell session, and every line that is typed sits
 * under a prompt: `user@console`, `target-agent@sentinel`, and on the verdict
 * rail `detector@sentinel`. Nothing said who those are. This is the ONE lookup
 * that does: a handle, or a rule a handle matches, to a role's name and one
 * sentence. The legend above the terminal, the control on each handle and the
 * tests all read it, so the three cannot disagree.
 *
 * HUMAN-FACING ONLY. Nothing here is served to the agent under test. The
 * handles are drawn by the replay from a step's type; they are not in a trace,
 * a verdict or anything the hosted MCP server sends. "sentinel" and "proving
 * ground" are on the list of words the served surface is tested against
 * (`NEUTRALITY_TELLS`), so neither can reach the agent.
 *
 * THE DEFINITIONS ARE THE OWNER'S WORDS, held verbatim by test. The current
 * words are SENTINEL + KEY (B), 2026-10-18, which supersede Batch G's.
 */

export type RoleId = 'operator' | 'agent' | 'detector' | 'tool';

export interface SpeakerRole {
  readonly id: RoleId;
  /** The role, as a short name: "Agent under test". */
  readonly name: string;
  /** One sentence saying who or what that is. */
  readonly definition: string;
}

export const ROLES: Readonly<Record<RoleId, SpeakerRole>> = {
  operator: {
    id: 'operator',
    name: 'Operator',
    definition: 'The person who gives the agent a normal task.',
  },
  agent: {
    id: 'agent',
    name: 'Agent under test',
    definition: 'The AI agent being tested.',
  },
  detector: {
    id: 'detector',
    name: 'MCProof detector',
    // KEY POLISH (owner ruling 2026-10-20): one sentence, the one the legend
    // and every speaker definition print.
    definition: 'Judges the finished run and marks the compromised step, if any.',
  },
  tool: {
    id: 'tool',
    name: 'Served tool',
    definition:
      'A tool MCProof provides for the test. In an attack run, one of them hides the attack.',
  },
};

/** The order the legend draws the roles in: the order a run meets them. */
export const LEGEND_ROLE_ORDER: readonly RoleId[] = ['operator', 'agent', 'detector', 'tool'];

/** The host every prompt inside the test environment is drawn on. */
export const SENTINEL_HOST = 'sentinel';
/** The prompt the operator's instruction is drawn under. */
export const OPERATOR_HANDLE = 'user@console';
/** The prompt the verdict rail is drawn under. */
export const DETECTOR_HANDLE = `detector@${SENTINEL_HOST}`;

/**
 * The prompt the agent's own commands are drawn under: the run's model label
 * at the test environment. For a sample that label is `target-agent`; for a
 * live run it is the name the connecting client gave for itself.
 */
export function agentHandle(model: string): string {
  return `${model}@${SENTINEL_HOST}`;
}

/** Is this one of the prompts drawn on the test environment's host? */
export function isSentinelHandle(handle: string): boolean {
  return handle.endsWith(`@${SENTINEL_HOST}`);
}

/**
 * The role behind a handle. Rules, first match wins:
 *
 *  1. `user@console` is the operator.
 *  2. `detector@sentinel` is the detector. Ahead of rule 3, which it would
 *     also match.
 *  3. anything else at `@sentinel` is the agent under test, whatever the
 *     client called itself.
 *  4. any other handle is a tool or server handle.
 *
 * Rule 4 matches nothing a replay draws today: a tool call is printed as the
 * agent's own command and a tool's answer as an output line, so no tool or
 * server handle is on screen. The rule is here so the first one that is drawn
 * resolves to an entry and does not go unexplained.
 */
export function roleForHandle(handle: string): SpeakerRole {
  if (handle === OPERATOR_HANDLE) return ROLES.operator;
  if (handle === DETECTOR_HANDLE) return ROLES.detector;
  if (isSentinelHandle(handle)) return ROLES.agent;
  return ROLES.tool;
}

/** A handle as it is said aloud: "target-agent at sentinel". */
export function speakHandle(handle: string): string {
  return handle.split('@').join(' at ');
}

/** The name of a handle's control: "target-agent at sentinel, Agent under test". */
export function handleName(handle: string): string {
  return `${speakHandle(handle)}, ${roleForHandle(handle).name}`;
}

/**
 * The handle a step's line is drawn under, or `null` for a line that has none.
 * The operator's instruction is typed at the console; a tool call, a memory
 * write and the end of the run are commands the agent types; reasoning, a
 * tool's answer and a memory read are output lines and carry no prompt.
 */
export function handleForStep(step: Pick<Step, 'type'>, model: string): string | null {
  switch (step.type) {
    case 'principal_instruction':
      return OPERATOR_HANDLE;
    case 'tool_call':
    case 'memory_write':
    case 'task_complete':
      return agentHandle(model);
    case 'agent_reasoning':
    case 'tool_result':
    case 'memory_read':
      return null;
  }
}

/**
 * What Sentinel is, in the owner's words (SENTINEL + KEY, 2026-10-18), held
 * verbatim by test. ONE constant: the /threats glossary entry and the /about
 * "Why \"Sentinel\"" terminal both render it. Human-facing only, like the
 * rest of this file: "sentinel" and "proving ground" are tells the served
 * surface is tested against.
 */
export const SENTINEL_DEFINITION =
  "A sentinel is a guard posted to keep watch. Sentinel is MCProof's proving ground: a sealed test environment where your agent meets booby-trapped tools while our detector watches every step. In a replay, anything marked @sentinel happened inside it. MCProof is the proof. Sentinel is where we prove it.";
/**
 * The Key's last row (SENTINEL + KEY, B): Sentinel itself, in a sentence, with
 * a link to the glossary entry that says more.
 */
export const SENTINEL_KEY_ROW = {
  chip: `@${SENTINEL_HOST}`,
  name: 'Sentinel',
  definition: "MCProof's proving ground, where every test runs.",
  link: 'What is Sentinel?',
} as const;
/** The id of that entry on the page that holds the glossary. */
export const SENTINEL_GLOSSARY_ID = 'sentinel';
/** Where a handle's "@sentinel" links to. */
export const SENTINEL_GLOSSARY_HREF = `/threats#${SENTINEL_GLOSSARY_ID}`;
