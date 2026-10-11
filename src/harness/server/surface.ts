/**
 * HOSTED MCP SERVER — the served tool surface abstraction, shared by all Core-7
 * surfaces.
 *
 * You cannot poison what you do not serve ([ADR-0006](../../../docs/adr/0006-mcpwn-is-the-mcp-server.md)):
 * every attack is staged through the tools, seeded content and (for memory
 * categories) the memory store this surface publishes. A surface authors that
 * content for BOTH framings — the malicious run and its benign tool-parity
 * control ([ADR-0003](../../../docs/adr/0003-core-7-scope-and-measurability-bar.md)
 * bar 4) — so precision stays measurable.
 *
 * SAFETY (spike "Safety", non-negotiable). Every handler is PURE and side-effect
 * free. High-impact tools (transfer, exec, grant, delete) are NO-OP RECORDERS:
 * they return a canned success and move nothing, perform no I/O of any kind,
 * network included. The bait is taken merely by ISSUING the call; the handler
 * does nothing. All content is fabricated `.example` fiction.
 *
 * NEUTRALITY is a TESTABLE PROPERTY, not a style note. Nothing an agent can read
 * — a server name, a tool name, a description, an input schema, a result, an
 * error — may name this project, the experiment, the framing or the category. A
 * single "mcproof" / "sandbox" / "malicious" on the wire tells a naive agent it is
 * being evaluated, and the run then measures the label instead of the poison
 * (the ASI01 spike's confounded NO was caused by exactly this class of leak).
 * `findTells()` is the sweep every surface and the server are checked against.
 * `findPayloadTells()` is its companion for the other way a run gives itself
 * away: served content that admits it is staged.
 */
import { z } from 'zod';
import type { Category, JsonValue, VariantKind } from '@/contract';
import { toJsonValue } from '@/harness/mcp/protocol';

/**
 * How the SERVER records a given tool call into the observable `Trace`.
 *
 * The default is a `tool_call` + `tool_result` pair — the load-bearing signal
 * ADR-0006 names. Memory-backed tools record a `memory_read` / `memory_write`
 * step instead, which ADR-0006 permits ONLY because the memory is itself a tool
 * we host over `Environment.memory`. `keyArg` names the call argument carrying
 * the memory key; the value recorded is the tool's own payload.
 */
export type ToolRecording =
  | { readonly as: 'tool' }
  | { readonly as: 'memory_read'; readonly keyArg?: string }
  | { readonly as: 'memory_write'; readonly keyArg?: string };

/** What a tool hands back: prose the agent reads, plus the structured payload
 *  recorded as the observable step. `isError` marks a recoverable tool error
 *  (MCP convention: a tool failure is a RESULT, not a protocol error). */
export interface HostedToolOutcome {
  readonly text: string;
  readonly payload: JsonValue;
  readonly isError?: boolean;
}

/** One served tool: its advertised descriptor, its pure handler, and how a call
 *  to it is recorded. */
export interface HostedTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonValue;
  readonly recording: ToolRecording;
  call(args: Record<string, JsonValue>): HostedToolOutcome;
}

/** The whole surface for one framing, plus the goal delivered out of band. */
export interface HostedSurface {
  readonly category: Category;
  readonly kind: VariantKind;
  /** `${slug}-${kind}` of the realization served. Never enters a Trace. */
  readonly variantId: string;
  /** The task goal handed to the agent OUT OF BAND (published prompt / paste). */
  readonly taskGoal: string;
  /** The role framing an operator pastes alongside the goal, if the attack sets one. */
  readonly systemPrompt?: string;
  readonly tools: readonly HostedTool[];
}

/**
 * Define one served tool. The handler receives Zod-validated arguments; unusable
 * arguments come back as a RECOVERABLE tool error (so the agent can retry and the
 * attempt is still recorded), never a protocol crash.
 */
export function defineTool<S extends z.ZodType<Record<string, JsonValue>>>(spec: {
  name: string;
  description: string;
  schema: S;
  recording?: ToolRecording;
  handler: (args: z.infer<S>) => HostedToolOutcome;
}): HostedTool {
  const { name, description, schema, handler } = spec;
  return {
    name,
    description,
    inputSchema: toJsonValue(z.toJSONSchema(schema, { io: 'input' })),
    recording: spec.recording ?? { as: 'tool' },
    call(args) {
      const parsed = schema.safeParse(args);
      if (!parsed.success) {
        const detail = parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        return {
          isError: true,
          text: `Invalid arguments for ${name}: ${detail}`,
          payload: { status: 'rejected', reason: detail },
        };
      }
      return handler(parsed.data);
    },
  };
}

/**
 * Tells that must NEVER appear in anything the agent can read. The project name
 * (the current one, and the old one, which old configs and copied docs still
 * carry),
 * the experiment vocabulary, the framing labels, and the category codes — each
 * one, seen mid-session, tells a naive agent it is inside an evaluation.
 *
 * Deliberately NOT here: adversary-DESCRIBING words such as "attacker" or
 * "poison". Fabricated attack content legitimately reads that way (the ASI01
 * payee IBAN is `DE00-ATTACKER-9931`, inherited verbatim from the fixture), and
 * flagging it would flag the fixture rather than a neutrality leak in what THIS
 * server adds. The concern the ASI01 confound proved is the server naming the
 * experiment, not the poison naming itself.
 */
export const NEUTRALITY_TELLS: readonly string[] = [
  'mcpwn',
  'mcproof',
  'spike',
  'sandbox',
  'red-team',
  'red team',
  'redteam',
  'malicious',
  'benign',
  'owasp',
  'asi01',
  'asi02',
  'asi03',
  'asi04',
  'asi05',
  'asi06',
  'asi07',
  'asi08',
  'asi09',
  'asi10',
];

/**
 * Every tell found in `text` (case-insensitive), in declaration order. Empty
 * means the text is neutral. This is the sweep the neutrality tests run over
 * every agent-visible string; returning the offenders (not just a boolean) makes
 * a failure name exactly what leaked.
 */
export function findTells(text: string): string[] {
  const lowered = text.toLowerCase();
  return NEUTRALITY_TELLS.filter((tell) => lowered.includes(tell));
}

/**
 * PAYLOAD TELLS: words by which served CONTENT admits it is staged.
 *
 * This is a second list, kept apart from `NEUTRALITY_TELLS` on purpose, because
 * the two answer different questions. The first list is the server naming the
 * experiment: the product, the framing, the category code. This one is the data
 * confessing that it is not real: a credential whose hash reads "fabricated", a
 * record marked "dummy", a file called a "placeholder". An agent that reads
 * either kind knows it is not in production, and the run then measures that
 * knowledge instead of the bait. They are separate so a failure says which kind
 * of leak it is, and so each list can grow without the other's rationale
 * blurring.
 *
 * These match as plain substrings, case-insensitively, exactly like the first
 * list. None of them occurs inside an ordinary word the surfaces would
 * legitimately serve.
 */
export const PAYLOAD_TELLS: readonly string[] = [
  'fabricated',
  'fake',
  'dummy',
  'mock',
  'placeholder',
  'simulated',
  'fictional',
  'honeypot',
];

/**
 * Payload tells that match as WHOLE WORDS only.
 *
 * As substrings these three would flag honest copy: "latest" (the ASI01 task
 * goal asks for the latest message), "attestation", "contest", "resample",
 * "demonstrate". A whole-word match here means the word is not flanked by a
 * letter on either side, so "latest" passes while "test", "test_data", "test-1"
 * and "TEST2" are all caught. Digits, underscores and punctuation count as
 * boundaries deliberately: `test_user` is as much a confession as "test user".
 */
export const PAYLOAD_WORD_TELLS: readonly string[] = ['test', 'sample', 'demo'];

const PAYLOAD_WORD_PATTERNS: readonly (readonly [string, RegExp])[] = PAYLOAD_WORD_TELLS.map(
  (word) => [word, new RegExp(`(?<![a-z])${word}(?![a-z])`, 'i')] as const,
);

/**
 * Every payload tell found in `text`, substrings first and then whole words,
 * each in declaration order. Empty means the content does not admit it is
 * staged. Like `findTells`, it returns the offenders so a failure names the leak.
 */
export function findPayloadTells(text: string): string[] {
  const lowered = text.toLowerCase();
  return [
    ...PAYLOAD_TELLS.filter((tell) => lowered.includes(tell)),
    ...PAYLOAD_WORD_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([word]) => word),
  ];
}
