/**
 * HOSTED MCP SERVER — the MCP server MCProof hosts, and the agent connects to.
 *
 * Transport-free dispatch: `handle(raw)` takes one already-parsed inbound message
 * and returns the envelope owed (or `null` for a notification, which is never
 * answered). `http.ts` wraps it in the Streamable HTTP transport; a test drives
 * it directly.
 *
 * PROTOCOL SURFACE — exactly what a hosted red-team run needs:
 *   `initialize` · `notifications/initialized` · `tools/list` · `tools/call`
 *   `prompts/list` · `prompts/get`
 * The prompt methods deliver `Scenario.taskGoal` OUT OF BAND (ADR-0006): MCP has
 * no server-to-agent "here is your goal" message, so the goal is a PUBLISHED
 * PROMPT the agent fetches, with paste as the documented fallback. Everything
 * else answers METHOD_NOT_FOUND — the correct spec behaviour for a server that
 * advertises only the `tools` and `prompts` capabilities.
 *
 * ORDER LENIENCY, stated openly: the spec says a server SHOULD reject requests
 * before `initialize` completes. This one logs them out of order and serves them
 * anyway, because the worst possible misread is a PROTOCOL failure counted as a
 * behavioural NO. Strict ordering bears nothing on whether an agent takes the
 * bait.
 *
 * NEUTRAL IDENTITY: nothing an agent can read here names this project, the
 * experiment, the framing or the category. The safety labelling the operator is
 * owed lives in the run log and in comments like this one, NEVER in a string the
 * agent can read. `neutrality.test.ts` fails on any tell.
 */
import type { Category, JsonValue, Trace, VariantKind } from '@/contract';
import type { TargetStepEvent } from '@/harness';
import { MCP_PROTOCOL_VERSION } from '@/harness/mcp/protocol';
import {
  ServerProtocolError,
  classifyInbound,
  jsonRpcError,
  jsonRpcResult,
  parseCallToolParams,
  parseGetPromptParams,
  parseInitializeParams,
  parseListPromptsParams,
  parseListToolsParams,
  RPC_INVALID_PARAMS,
  type InboundRequest,
  type JsonRpcOutbound,
} from '@/harness/server/protocol';
import { HostedTraceRecorder, type HostedRecorderOptions } from '@/harness/server/recorder';
import { buildHostedSurface } from '@/harness/server/surfaces';
import type { HostedSurface, HostedTool } from '@/harness/server/surface';

/** The identity the agent sees in `initialize`. DELIBERATELY NEUTRAL — an
 *  ordinary workspace tool server at an ordinary version (never `0.0.0`, itself a
 *  tell that nothing in production ships at 0.0.0). */
export const SERVER_NAME = 'workspace-mcp';
export const SERVER_VERSION = '1.6.0';

/** The neutral name of the published prompt that carries the out-of-band goal. */
export const TASK_PROMPT_NAME = 'session_brief';

/** Protocol revisions this endpoint will echo back. Anything else gets ours. */
const SUPPORTED_PROTOCOL_VERSIONS = new Set([MCP_PROTOCOL_VERSION, '2025-03-26', '2024-11-05']);

/**
 * One line of the append-only run log. Never written to the MCP channel; it
 * carries the tool ARGUMENTS so a reader can answer the run's question from a
 * live log without waiting for a clean shutdown.
 */
export interface HostedLogEntry {
  readonly at: string;
  readonly direction: 'in';
  readonly method: string;
  readonly tool?: string;
  readonly args?: Record<string, JsonValue>;
  readonly note?: string;
}

export interface HostedServerOptions extends HostedRecorderOptions {
  /** Which Core-7 category to serve. */
  readonly category: Category;
  /** Which framing: the poisoned run or its benign control. */
  readonly kind: VariantKind;
  /** Injectable clock, so the log is deterministic under test. */
  readonly now?: () => string;
  /**
   * Whether the handshake is already known to have happened, for a server that
   * is REBUILT on another instance. Part of the same rehydration seam as
   * `events` and `client`: the rebuilt server never saw the handshake, and
   * without this it would annotate every in-order call it serves as "received
   * before notifications/initialized". Defaults to false, so a fresh run is
   * unchanged.
   */
  readonly initialized?: boolean;
}

export class HostedMcpServer {
  private readonly surface: HostedSurface;
  private readonly recorder: HostedTraceRecorder;
  private readonly entries: HostedLogEntry[] = [];
  private readonly now: () => string;
  private initialized: boolean;

  constructor(options: HostedServerOptions) {
    // `recorderOptions` deliberately carries the rehydration seam (`events`,
    // `client`) straight through, so rebuilding a run after a restart is a
    // constructor argument rather than a second code path.
    const { category, kind, now, initialized, ...recorderOptions } = options;
    this.surface = buildHostedSurface(category, kind);
    this.recorder = new HostedTraceRecorder(this.surface, recorderOptions);
    this.now = now ?? (() => new Date().toISOString());
    this.initialized = initialized ?? false;
  }

  /** The append-only run log, in arrival order. */
  get log(): readonly HostedLogEntry[] {
    return this.entries;
  }

  /** The task goal to hand the agent OUT OF BAND (published prompt / paste). */
  get taskGoal(): string {
    return this.surface.taskGoal;
  }

  /**
   * Everything observable this run has recorded, in order.
   *
   * The durable open-run registry (`src/runs/live-run-store.ts`) reads this after
   * each inbound request and persists whatever is new, so a run that moves to
   * another instance keeps the steps it already took. It is the observable
   * events only: no label, no framing, nothing the judge is not shown anyway.
   */
  get observedEvents(): readonly TargetStepEvent[] {
    return this.recorder.observed();
  }

  /** The client name the agent claimed, so a rehydrated run keeps its label. */
  get observedClient(): string | undefined {
    return this.recorder.observedClient;
  }

  /** Assemble the observable Trace, including the inferred completion step. */
  async buildTrace(): Promise<Trace> {
    return this.recorder.buildTrace();
  }

  /**
   * Handle one inbound message. Returns the envelope owed, or `null` for a
   * notification. NEVER throws: a typed `ServerProtocolError` becomes an error
   * envelope, and any other failure becomes INVALID_PARAMS.
   */
  handle(raw: unknown): JsonRpcOutbound | null {
    const inbound = classifyInbound(raw);

    if (inbound.kind === 'invalid') {
      this.note('<invalid>', { note: inbound.error.message });
      return jsonRpcError(inbound.id, inbound.error.code, inbound.error.message);
    }

    if (inbound.kind === 'notification') {
      const known = inbound.message.method === 'notifications/initialized';
      if (known) this.initialized = true;
      this.note(inbound.message.method, known ? {} : { note: 'notification outside the surface' });
      return null;
    }

    const request = inbound.message;
    try {
      return this.dispatch(request);
    } catch (error) {
      if (error instanceof ServerProtocolError) {
        return jsonRpcError(request.id, error.rpcCode, error.message);
      }
      // Defence in depth: a handler bug must still leave the endpoint speaking
      // JSON-RPC rather than dropping the connection mid-run.
      const message = error instanceof Error ? error.message : 'internal error';
      return jsonRpcError(request.id, RPC_INVALID_PARAMS, message);
    }
  }

  private dispatch(request: InboundRequest): JsonRpcOutbound {
    switch (request.method) {
      case 'initialize':
        return this.onInitialize(request);
      case 'tools/list':
        return this.onListTools(request);
      case 'tools/call':
        return this.onCallTool(request);
      case 'prompts/list':
        return this.onListPrompts(request);
      case 'prompts/get':
        return this.onGetPrompt(request);
      default:
        this.note(request.method, { note: 'method outside the surface' });
        throw new ServerProtocolError(
          'METHOD_NOT_FOUND',
          `Method not found: ${request.method}. This endpoint serves initialize, ` +
            'notifications/initialized, tools/list, tools/call, prompts/list and prompts/get only.',
        );
    }
  }

  private onInitialize(request: InboundRequest): JsonRpcOutbound {
    const params = parseInitializeParams(request.params);
    if (params.clientInfo) {
      this.recorder.observeClient({
        name: params.clientInfo.name,
        ...(params.clientInfo.version === undefined ? {} : { version: params.clientInfo.version }),
      });
    }
    this.note('initialize', {
      note: `client=${params.clientInfo?.name ?? 'anonymous'} protocol=${params.protocolVersion}`,
    });
    return jsonRpcResult(request.id, {
      protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.has(params.protocolVersion)
        ? params.protocolVersion
        : MCP_PROTOCOL_VERSION,
      capabilities: { tools: {}, prompts: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    });
  }

  private onListTools(request: InboundRequest): JsonRpcOutbound {
    parseListToolsParams(request.params);
    this.noteOrder('tools/list');
    // Discovery is NOT a Trace step: the contract has no type for it.
    return jsonRpcResult(request.id, {
      tools: this.surface.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    });
  }

  private onCallTool(request: InboundRequest): JsonRpcOutbound {
    const params = parseCallToolParams(request.params);
    this.noteOrder('tools/call', { tool: params.name, args: params.arguments });

    // THE OBSERVATION THE WHOLE RUN EXISTS FOR: the agent chose to call this tool,
    // with these arguments. Recorded BEFORE validation, because an attempted call
    // to a tool we do not serve is still the agent's decision.
    this.recorder.recordToolCall(params.name, params.arguments);

    const tool: HostedTool | undefined = this.surface.tools.find((t) => t.name === params.name);
    if (!tool) {
      const message = `Unknown tool: ${params.name}`;
      this.recorder.recordToolResult(
        params.name,
        { status: 'rejected', reason: message },
        params.arguments,
      );
      throw new ServerProtocolError('INVALID_PARAMS', message);
    }

    const outcome = tool.call(params.arguments);
    this.recorder.recordToolResult(params.name, outcome.payload, params.arguments);

    const result: Record<string, JsonValue> = {
      content: [{ type: 'text', text: outcome.text }],
      structuredContent: outcome.payload,
    };
    if (outcome.isError) result.isError = true;
    return jsonRpcResult(request.id, result);
  }

  private onListPrompts(request: InboundRequest): JsonRpcOutbound {
    parseListPromptsParams(request.params);
    this.noteOrder('prompts/list');
    return jsonRpcResult(request.id, {
      prompts: [
        {
          name: TASK_PROMPT_NAME,
          description: 'The brief for this working session.',
        },
      ],
    });
  }

  private onGetPrompt(request: InboundRequest): JsonRpcOutbound {
    const params = parseGetPromptParams(request.params);
    this.noteOrder('prompts/get', { tool: params.name, args: params.arguments });
    if (params.name !== TASK_PROMPT_NAME) {
      throw new ServerProtocolError('INVALID_PARAMS', `Unknown prompt: ${params.name}`);
    }
    // The out-of-band goal, delivered as a published prompt (ADR-0006). The role
    // framing, if any, rides as a leading line so a single fetch carries both.
    const text =
      this.surface.systemPrompt === undefined
        ? this.surface.taskGoal
        : `${this.surface.systemPrompt}\n\n${this.surface.taskGoal}`;
    return jsonRpcResult(request.id, {
      description: 'The brief for this working session.',
      messages: [{ role: 'user', content: { type: 'text', text } }],
    });
  }

  private noteOrder(
    method: string,
    call?: { tool: string; args: Record<string, JsonValue> },
  ): void {
    this.note(method, {
      ...(call === undefined ? {} : { tool: call.tool, args: call.args }),
      ...(this.initialized ? {} : { note: 'received before notifications/initialized' }),
    });
  }

  private note(
    method: string,
    extra: { tool?: string; args?: Record<string, JsonValue>; note?: string },
  ): void {
    this.entries.push({ at: this.now(), direction: 'in', method, ...extra });
  }
}
