import { getAttack } from '@/attacks';
import type { Category, VariantKind } from '@/contract';
import { HostedMcpServer, TASK_PROMPT_NAME } from '@/harness/server/server';
import { buildHostedSurface, HOSTED_CATEGORIES } from '@/harness/server/surfaces';
import { SCOPED_INVOICE, TRAVERSAL_TARGET } from '@/harness/server/surfaces/asi02';
import { UNTRUSTED_PACKAGE } from '@/harness/server/surfaces/asi04';

/**
 * THE WHOLE AGENT-VISIBLE SURFACE, AS ONE SNAPSHOT.
 *
 * Everything the agent under test can read from a hosted run, for all seven
 * categories in both framings: the handshake (server name and version), the
 * tool listing (names, descriptions, input schemas), the published prompt
 * listing and the prompt itself (the task goal), every payload each tool
 * returns (both sides of each branch, no arguments, and wrongly typed
 * arguments), the error sentences the server writes, and the scenario each
 * attack declares (its goal and its environment, seeded memory included).
 *
 * The snapshot beside this file was generated on unchanged `origin/main`
 * (92d7a21) BEFORE any human-facing change in the batch that added it. A
 * change to human-facing copy must leave it byte-identical: if this test
 * fails, something the agent can read has moved, and that is never a
 * snapshot to update by reflex.
 */

const KINDS: VariantKind[] = ['malicious', 'benign'];

/** A memory key no surface seeds, so a read answers with its miss. */
const UNSEEDED_KEY = 'quarterly_notes';

const ARG_BANK = {
  to: 'x@y.example',
  amount: 100,
  path: TRAVERSAL_TARGET,
  id: 4471,
  name: UNTRUSTED_PACKAGE,
  key: 'standing_instructions',
  value: 'a note',
  command: 'echo hi',
  query: 'q',
  userId: 'u',
  role: 'admin',
  customerId: 'c',
  mailbox: 'inbox',
  job: 'pending',
  quarter: 'Q3',
  account: 'primary',
  source: 'x',
};

/** Every field wrong in type: whatever a schema requires is rejected. */
const BAD_ARGS = { to: 7, amount: 'x', id: 'x', key: 7, path: 7, name: 7 };

const ERRORS: [string, unknown][] = [
  [
    'unknown tool',
    {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'archive_folder', arguments: { id: 1 } },
    },
  ],
  [
    'unknown prompt',
    { jsonrpc: '2.0', id: 7, method: 'prompts/get', params: { name: 'weekly_digest' } },
  ],
  ['method outside the surface', { jsonrpc: '2.0', id: 8, method: 'resources/list' }],
  ['tools/call with no name', { jsonrpc: '2.0', id: 9, method: 'tools/call', params: {} }],
  [
    'initialize with unusable params',
    { jsonrpc: '2.0', id: 10, method: 'initialize', params: { protocolVersion: 7 } },
  ],
  ['not JSON-RPC 2.0', { jsonrpc: '1.0', id: 11, method: 'tools/list' }],
  ['a bare number', 42],
];

const newServer = (category: Category, kind: VariantKind) =>
  new HostedMcpServer({ category, kind, now: () => '2026-08-05T00:00:00.000Z' });

function wire(category: Category, kind: VariantKind): Record<string, unknown> {
  const s = newServer(category, kind);
  const out: Record<string, unknown> = {};
  out.initialize = s.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'a-real-agent', version: '1.0.0' },
    },
  });
  s.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  out.toolsList = s.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  out.promptsList = s.handle({ jsonrpc: '2.0', id: 3, method: 'prompts/list' });
  out.promptsGet = s.handle({
    jsonrpc: '2.0',
    id: 4,
    method: 'prompts/get',
    params: { name: TASK_PROMPT_NAME },
  });

  // Each tool, straight off the surface, so no call here is coloured by an
  // earlier one (a memory write would otherwise change a later read).
  const calls: Record<string, unknown> = {};
  for (const tool of buildHostedSurface(category, kind).tools) {
    const otherBranch =
      tool.recording.as === 'memory_write'
        ? { ...ARG_BANK, path: SCOPED_INVOICE }
        : { ...ARG_BANK, path: SCOPED_INVOICE, key: UNSEEDED_KEY };
    const variants: [string, Record<string, unknown>][] = [
      ['bank', ARG_BANK],
      ['other branch', otherBranch],
      ['no arguments', {}],
      ['wrong types', BAD_ARGS],
    ];
    for (const [label, args] of variants) {
      const fresh = buildHostedSurface(category, kind).tools.find((t) => t.name === tool.name)!;
      calls[`${tool.name} (${label})`] = fresh.call(args as Record<string, never>);
    }
    // The same call as the agent receives it, wrapped by the server.
    calls[`${tool.name} (on the wire)`] = newServer(category, kind).handle({
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: { name: tool.name, arguments: ARG_BANK },
    });
    calls[`${tool.name} (on the wire, wrong types)`] = newServer(category, kind).handle({
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: { name: tool.name, arguments: BAD_ARGS },
    });
  }
  out.calls = calls;

  const errors: Record<string, unknown> = {};
  for (const [label, raw] of ERRORS) errors[label] = newServer(category, kind).handle(raw);
  out.errors = errors;

  const surface = buildHostedSurface(category, kind);
  out.outOfBand = { taskGoal: surface.taskGoal, systemPrompt: surface.systemPrompt ?? null };
  out.scenario = getAttack(category).scenario(kind);
  return out;
}

describe('the agent-visible surface is byte-identical to main', () => {
  it('covers exactly the seven Core-7 categories', () => {
    expect([...HOSTED_CATEGORIES].sort()).toEqual([
      'ASI01',
      'ASI02',
      'ASI03',
      'ASI04',
      'ASI05',
      'ASI06',
      'ASI10',
    ]);
  });

  for (const category of HOSTED_CATEGORIES) {
    for (const kind of KINDS) {
      it(`${category} ${kind}: handshake, tools, prompts, payloads, errors, scenario`, () => {
        expect(JSON.stringify(wire(category, kind), null, 2)).toMatchSnapshot();
      });
    }
  }
});
