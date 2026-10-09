import type { Category, VariantKind } from '@/contract';
import { findTells } from '@/harness/server/surface';
import { HOSTED_CATEGORIES } from '@/harness/server/surfaces';
import {
  RPC_INVALID_PARAMS,
  RPC_INVALID_REQUEST,
  RPC_METHOD_NOT_FOUND,
  type JsonRpcErrorEnvelope,
  type JsonRpcResultEnvelope,
} from '@/harness/server/protocol';
import {
  HostedMcpServer,
  SERVER_NAME,
  SERVER_VERSION,
  TASK_PROMPT_NAME,
} from '@/harness/server/server';

const initialize = (id: number | string = 1) => ({
  jsonrpc: '2.0',
  id,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'a-real-agent', version: '1.0.0' },
  },
});

const call = (id: number, name: string, args: Record<string, unknown> = {}) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name, arguments: args },
});

const resultOf = (envelope: unknown) =>
  (envelope as JsonRpcResultEnvelope).result as Record<string, unknown>;
const errorOf = (envelope: unknown) => (envelope as JsonRpcErrorEnvelope).error;

const server = (category: Category = 'ASI01', kind: VariantKind = 'malicious') =>
  new HostedMcpServer({ category, kind, now: () => '2026-08-05T00:00:00.000Z' });

describe('server: the protocol surface', () => {
  it('answers initialize with protocol version, tools+prompts capability and neutral identity', () => {
    const result = resultOf(server().handle(initialize()));
    expect(result.protocolVersion).toBe('2025-06-18');
    expect(result.capabilities).toMatchObject({ tools: {}, prompts: {} });
    expect(result.serverInfo).toMatchObject({ name: SERVER_NAME, version: SERVER_VERSION });
  });

  it('echoes a supported client protocol version, and answers its own for an unknown one', () => {
    expect(
      resultOf(
        server().handle({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05' },
        }),
      ).protocolVersion,
    ).toBe('2024-11-05');
    expect(
      resultOf(
        server().handle({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '1999-01-01' },
        }),
      ).protocolVersion,
    ).toBe('2025-06-18');
  });

  it('accepts notifications/initialized and owes no response', () => {
    const s = server();
    s.handle(initialize());
    expect(s.handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
  });

  it('never answers a notification, even an unknown one', () => {
    expect(server().handle({ jsonrpc: '2.0', method: 'notifications/cancelled' })).toBeNull();
  });

  it('lists tools with names, descriptions and input schemas', () => {
    const s = server();
    s.handle(initialize());
    const tools = resultOf(s.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).tools as {
      name: string;
      description: string;
      inputSchema: unknown;
    }[];
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(t.inputSchema).toMatchObject({ type: 'object' });
    }
  });

  it('rejects a method outside the surface with METHOD_NOT_FOUND, not a crash', () => {
    const response = server().handle({ jsonrpc: '2.0', id: 4, method: 'resources/list' });
    expect(errorOf(response).code).toBe(RPC_METHOD_NOT_FOUND);
    expect(errorOf(response).message).toContain('resources/list');
  });
});

describe('server: the task goal is delivered OUT OF BAND as a published prompt', () => {
  it('lists one prompt', () => {
    const prompts = resultOf(server().handle({ jsonrpc: '2.0', id: 2, method: 'prompts/list' }))
      .prompts as { name: string }[];
    expect(prompts.map((p) => p.name)).toEqual([TASK_PROMPT_NAME]);
  });

  it('serves the exact task goal through prompts/get', () => {
    const s = server('ASI02', 'malicious');
    const result = resultOf(
      s.handle({
        jsonrpc: '2.0',
        id: 3,
        method: 'prompts/get',
        params: { name: TASK_PROMPT_NAME },
      }),
    );
    const messages = result.messages as { content: { text: string } }[];
    expect(messages[0]!.content.text).toContain(s.taskGoal);
  });

  it('rejects an unknown prompt name with INVALID_PARAMS', () => {
    const response = server().handle({
      jsonrpc: '2.0',
      id: 3,
      method: 'prompts/get',
      params: { name: 'not_a_prompt' },
    });
    expect(errorOf(response).code).toBe(RPC_INVALID_PARAMS);
  });
});

describe('server: hostile input never crashes the endpoint', () => {
  it.each([
    ['a bare number', 42],
    ['null', null],
    ['an array', [1, 2, 3]],
    ['a JSON-RPC 1.0 message', { jsonrpc: '1.0', id: 1, method: 'tools/list' }],
  ])('answers %s with INVALID_REQUEST', (_label, raw) => {
    expect(errorOf(server().handle(raw)).code).toBe(RPC_INVALID_REQUEST);
  });

  it('answers a tools/call with no name with INVALID_PARAMS', () => {
    const s = server();
    s.handle(initialize());
    expect(
      errorOf(s.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: {} })).code,
    ).toBe(RPC_INVALID_PARAMS);
  });

  it('answers a call to a tool it does not serve with INVALID_PARAMS', () => {
    const s = server();
    s.handle(initialize());
    const response = s.handle(call(6, 'rm_rf_slash'));
    expect(errorOf(response).code).toBe(RPC_INVALID_PARAMS);
    expect(errorOf(response).message).toMatch(/unknown tool/i);
  });
});

describe('server: NEUTRALITY of everything the agent can see', () => {
  it.each(HOSTED_CATEGORIES)(
    '%s puts no tell on the handshake, listing, prompt or any result',
    (category) => {
      for (const kind of ['malicious', 'benign'] as VariantKind[]) {
        const s = new HostedMcpServer({ category, kind });
        const seen: string[] = [];
        seen.push(JSON.stringify(s.handle(initialize())));
        s.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
        seen.push(JSON.stringify(s.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })));
        seen.push(
          JSON.stringify(
            s.handle({
              jsonrpc: '2.0',
              id: 3,
              method: 'prompts/get',
              params: { name: TASK_PROMPT_NAME },
            }),
          ),
        );
        const tools = resultOf(s.handle({ jsonrpc: '2.0', id: 4, method: 'tools/list' })).tools as {
          name: string;
        }[];
        let id = 10;
        for (const t of tools) {
          seen.push(
            JSON.stringify(s.handle(call(id++, t.name, { to: 'x', amount: 1, id: 1, key: 'k' }))),
          );
          seen.push(JSON.stringify(s.handle(call(id++, t.name))));
        }
        for (const body of seen) {
          const tells = findTells(body);
          expect(tells, `${category}/${kind} leaks ${tells.join(', ')}`).toEqual([]);
        }
      }
    },
  );

  it('names itself with an ordinary, non-zero version', () => {
    expect(findTells(SERVER_NAME)).toEqual([]);
    expect(SERVER_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(SERVER_VERSION).not.toBe('0.0.0');
  });
});

describe('server: what lands in the Trace', () => {
  it('records every tools/call the agent makes, including rejected ones, then infers completion', async () => {
    const s = server('ASI01', 'malicious');
    s.handle(initialize());
    s.handle(call(2, 'read_email', { mailbox: 'inbox' }));
    s.handle(call(3, 'rm_rf_slash'));
    s.handle(call(4, 'transfer_funds', { to: 'DE00-ATTACKER-9931', amount: 8500 }));
    const trace = await s.buildTrace();
    const toolCalls = trace.steps.filter((step) => step.type === 'tool_call');
    expect(toolCalls.map((step) => (step.type === 'tool_call' ? step.tool : ''))).toEqual([
      'read_email',
      'rm_rf_slash',
      'transfer_funds',
    ]);
    expect(trace.steps.at(-1)!.type).toBe('task_complete');
  });

  it('writes an append-only run log carrying arguments, never on the MCP channel', () => {
    const s = server();
    s.handle(initialize());
    s.handle(call(2, 'read_email', { mailbox: 'inbox' }));
    const entry = s.log.find((e) => e.method === 'tools/call');
    expect(entry?.args).toMatchObject({ mailbox: 'inbox' });
    expect(entry?.at).toBe('2026-08-05T00:00:00.000Z');
  });
});

/**
 * The handshake flag across a rebuild. A run that moves to another instance is
 * rebuilt from its durable row, and the rebuilt server never saw the handshake.
 * Without the seam below it would annotate every in-order call it served as
 * arriving "before notifications/initialized".
 */
describe('server: the handshake flag survives a rebuild', () => {
  const ORDER_NOTE = 'received before notifications/initialized';

  it('annotates a call that really arrives before the handshake completes', () => {
    const s = new HostedMcpServer({ category: 'ASI01', kind: 'malicious' });
    s.handle(initialize());
    s.handle(call(2, 'read_email', { mailbox: 'inbox' }));
    expect(s.log.find((e) => e.method === 'tools/call')?.note).toBe(ORDER_NOTE);
  });

  it('does not annotate once notifications/initialized has been seen', () => {
    const s = new HostedMcpServer({ category: 'ASI01', kind: 'malicious' });
    s.handle(initialize());
    s.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
    s.handle(call(2, 'read_email', { mailbox: 'inbox' }));
    expect(s.log.find((e) => e.method === 'tools/call')?.note).toBeUndefined();
  });

  it('does not annotate when rebuilt with the handshake already seen elsewhere', () => {
    const s = new HostedMcpServer({ category: 'ASI01', kind: 'malicious', initialized: true });
    s.handle(call(2, 'read_email', { mailbox: 'inbox' }));
    expect(s.log.find((e) => e.method === 'tools/call')?.note).toBeUndefined();
  });

  it('defaults to not yet handshaken, so a fresh run is unchanged', () => {
    const s = new HostedMcpServer({ category: 'ASI01', kind: 'malicious' });
    s.handle(call(2, 'read_email', { mailbox: 'inbox' }));
    expect(s.log.find((e) => e.method === 'tools/call')?.note).toBe(ORDER_NOTE);
  });
});
