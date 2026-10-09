import type { JsonValue, Scenario } from '@/contract';
import type { McpTargetPort, TargetStepEvent } from '@/harness';
import { McpTargetError } from './errors';
import { endpointLabel } from './endpoint';
import { CallToolResultSchema, ToolsListResultSchema, loggingText, toJsonValue } from './protocol';
import { openMcpSession, type McpSession, type McpTransportOptions } from './transport';

/**
 * HTTP adapter for `McpTargetPort` — drives a REMOTE MCP endpoint over JSON-RPC
 * and emits the observable `TargetStepEvent`s that `record()` turns into a
 * marker-free `Trace`. Same port as the offline mock, so module 3 (runner) is
 * unchanged.
 *
 * **SCOPE: probing a target MCP _server_, not driving a user's agent.** Per
 * [ADR-0006](../../../docs/adr/0006-mcpwn-is-the-mcp-server.md) the live agent
 * path is inbound — the agent connects to a server we host — because we cannot
 * poison a tool surface we do not serve. The observability notes below are the
 * evidence for that decision, and they are why this adapter is scoped to the
 * ASI02 / ASI05 server surfaces rather than presented as the agent path.
 *
 * WHAT IS AND IS NOT OBSERVABLE FROM HERE (see
 * `docs/superpowers/specs/2026-07-27-byok-live-target-design.md`):
 *
 *  - `principal_instruction` — OBSERVABLE. It is the scenario framing THIS
 *    adapter sends on the principal's behalf, so it is recorded by construction,
 *    not inferred.
 *  - `tool_call` / `tool_result` — OBSERVABLE. The adapter makes the call and
 *    reads the result off the wire.
 *  - `agent_reasoning` — OBSERVABLE ONLY IF the target chooses to emit MCP
 *    `notifications/message` (the spec's logging channel) while serving the
 *    call. Nothing is synthesized when it does not: an unnarrated target simply
 *    produces a trace with no reasoning steps.
 *  - `memory_read` / `memory_write` — NOT OBSERVABLE through an outbound client.
 *    The agent's memory lives on the agent's side of the wire. Recording those
 *    honestly requires the inverted architecture (MCProof hosting the MCP server
 *    the agent connects to), which is the spike's conclusion.
 *  - `task_complete` — OBSERVABLE (the call returned).
 *
 * This adapter is therefore NOT a full agent observer. It is verified against an
 * in-process fake MCP server only; it has never been run against a real MCP
 * agent, and nothing in the product presents it as measured.
 */

/** The MCP tool name this adapter treats as the agent's task entrypoint. */
export const DEFAULT_AGENT_TOOL = 'agent';

export interface HttpMcpTargetOptions extends McpTransportOptions {
  /**
   * Name of the target's MCP tool that accepts a task. MCP has no standard
   * "give an agent a goal" method (it is a client → server tool protocol), so
   * the entrypoint is a named convention the operator supplies.
   */
  agentTool?: string;
}

/** Scenario framing sent to the target, recorded verbatim as the principal
 *  instruction step: it is the task goal, on the channel we control. */
function principalInstructionContent(scenario: Scenario): string {
  const { taskGoal, environment } = scenario;
  const lines = [`TASK: ${taskGoal}`, `TOOLS: ${environment.tools.join(', ')}`];
  if (environment.systemPrompt) lines.push(`SYSTEM: ${environment.systemPrompt}`);
  if (environment.memory) lines.push(`MEMORY: ${JSON.stringify(environment.memory)}`);
  return lines.join('\n');
}

/** Scenario → the tool arguments actually sent (contract-shaped JSON). */
function agentToolArgs(scenario: Scenario): Record<string, JsonValue> {
  const args: Record<string, JsonValue> = {
    goal: scenario.taskGoal,
    tools: [...scenario.environment.tools],
  };
  if (scenario.environment.systemPrompt) args.systemPrompt = scenario.environment.systemPrompt;
  if (scenario.environment.memory) {
    args.memory = toJsonValue(scenario.environment.memory);
  }
  return args;
}

/** Best-effort one-line summary of a tool result, for `task_complete`. */
function summarize(result: unknown): string | undefined {
  const parsed = CallToolResultSchema.safeParse(result);
  if (!parsed.success) return undefined;
  const first = parsed.data.content?.find(
    (block): block is { type: string; text: string } =>
      block.type === 'text' && typeof (block as { text?: unknown }).text === 'string',
  );
  if (!first) return undefined;
  const text = first.text.trim();
  return text === '' ? undefined : text.slice(0, 500);
}

export class HttpMcpTarget implements McpTargetPort {
  private readonly agentTool: string;

  constructor(private readonly options: HttpMcpTargetOptions) {
    this.agentTool = options.agentTool ?? DEFAULT_AGENT_TOOL;
  }

  /** Label safe to persist / log: the endpoint ORIGIN, never the path or key. */
  get label(): string {
    return endpointLabel(this.options.endpoint);
  }

  async *run(scenario: Scenario): AsyncIterable<TargetStepEvent> {
    const session: McpSession = await openMcpSession(this.options);
    try {
      const listed = ToolsListResultSchema.safeParse((await session.request('tools/list')).result);
      if (!listed.success) {
        throw new McpTargetError(
          'MALFORMED_RESPONSE',
          `The MCP target at ${this.label} returned an unreadable tools/list.`,
        );
      }
      if (!listed.data.tools.some((tool) => tool.name === this.agentTool)) {
        throw new McpTargetError(
          'TOOL_NOT_FOUND',
          `The MCP target at ${this.label} does not expose a "${this.agentTool}" tool to accept the task.`,
        );
      }

      // What we sent is observable by construction.
      yield { type: 'principal_instruction', content: principalInstructionContent(scenario) };

      const args = agentToolArgs(scenario);
      yield { type: 'tool_call', tool: this.agentTool, args };

      // A tool call is not guaranteed idempotent, so a transport fault here is
      // surfaced rather than silently replayed against the user's agent.
      const outcome = await session.request(
        'tools/call',
        { name: this.agentTool, arguments: args },
        { retryable: false },
      );

      // The MCP logging channel is the only spec-defined narration a remote
      // target can emit. Absent it, no reasoning step is invented.
      for (const notification of outcome.notifications) {
        if (notification.method !== 'notifications/message') continue;
        const text = loggingText(notification.params);
        if (text !== null) yield { type: 'agent_reasoning', content: text };
      }

      yield { type: 'tool_result', tool: this.agentTool, result: toJsonValue(outcome.result) };

      const summary = summarize(outcome.result);
      yield summary === undefined ? { type: 'task_complete' } : { type: 'task_complete', summary };
    } finally {
      await session.close();
    }
  }
}
