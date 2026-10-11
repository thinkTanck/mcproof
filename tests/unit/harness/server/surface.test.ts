import { z } from 'zod';
import {
  defineTool,
  findPayloadTells,
  findTells,
  NEUTRALITY_TELLS,
  PAYLOAD_TELLS,
  PAYLOAD_WORD_TELLS,
} from '@/harness/server/surface';

describe('server/surface: defineTool', () => {
  const tool = defineTool({
    name: 'do_thing',
    description: 'Does a thing.',
    schema: z.object({ n: z.number() }),
    handler: (args) => ({ text: `n=${args.n}`, payload: { n: args.n } }),
  });

  it('advertises a JSON Schema input contract', () => {
    expect(tool.inputSchema).toMatchObject({ type: 'object' });
  });

  it('defaults recording to a plain tool call', () => {
    expect(tool.recording).toEqual({ as: 'tool' });
  });

  it('runs the handler on valid arguments', () => {
    expect(tool.call({ n: 3 })).toMatchObject({ text: 'n=3', payload: { n: 3 } });
  });

  it('returns bad arguments as a RECOVERABLE tool error, not a throw', () => {
    const outcome = tool.call({ n: 'nope' as unknown as number });
    expect(outcome.isError).toBe(true);
    expect(outcome.text).toMatch(/invalid arguments/i);
    expect(outcome.payload).toMatchObject({ status: 'rejected' });
  });

  it('carries a memory recording hint when declared', () => {
    const mem = defineTool({
      name: 'recall',
      description: 'Recall a note.',
      schema: z.object({ key: z.string() }),
      recording: { as: 'memory_read', keyArg: 'key' },
      handler: () => ({ text: 'x', payload: 'x' }),
    });
    expect(mem.recording).toEqual({ as: 'memory_read', keyArg: 'key' });
  });
});

describe('server/surface: findTells is the neutrality sweep', () => {
  it('finds no tell in ordinary product copy', () => {
    expect(findTells('Read the full body of one message in the mailbox.')).toEqual([]);
  });

  it.each(NEUTRALITY_TELLS)('flags the tell %s wherever it appears, case-insensitively', (tell) => {
    expect(findTells(`prefix ${tell.toUpperCase()} suffix`)).toContain(tell);
  });

  it('names every offender, not just a boolean', () => {
    expect(findTells('this MCPWN sandbox is malicious')).toEqual(
      expect.arrayContaining(['mcpwn', 'sandbox', 'malicious']),
    );
  });
});

describe('server/surface: findPayloadTells catches content that admits it is staged', () => {
  it('finds nothing in ordinary served content', () => {
    expect(findPayloadTells('Read /srv/invoices/4821/2026-07.pdf (48213 bytes).')).toEqual([]);
  });

  it.each(PAYLOAD_TELLS)('flags %s as a substring, case-insensitively', (tell) => {
    expect(findPayloadTells(`root:$6$${tell.toUpperCase()}$0`)).toContain(tell);
    expect(findPayloadTells(`un${tell}s`)).toContain(tell);
  });

  it.each(PAYLOAD_WORD_TELLS)('flags %s as a whole word, case-insensitively', (word) => {
    expect(findPayloadTells(`this is a ${word.toUpperCase()} record`)).toEqual([word]);
    expect(findPayloadTells(word)).toEqual([word]);
    // Digits, underscores and punctuation are boundaries: these still confess.
    expect(findPayloadTells(`${word}_user`)).toEqual([word]);
    expect(findPayloadTells(`${word}-1`)).toEqual([word]);
    expect(findPayloadTells(`acct.${word}2`)).toEqual([word]);
  });

  it.each([
    'Summarize the latest message in the inbox.',
    'attestation',
    'contest',
    'protest',
    'resample the series',
    'samples',
    'demonstrate',
    'democracy',
    'tested',
  ])('does not flag the honest word in "%s"', (text) => {
    expect(findPayloadTells(text)).toEqual([]);
  });

  it('names every offender, substrings first, then whole words', () => {
    expect(findPayloadTells('a demo of fake, dummy test data')).toEqual([
      'fake',
      'dummy',
      'test',
      'demo',
    ]);
  });

  it('is a separate list from the neutrality tells, with no entry in both', () => {
    const payload = [...PAYLOAD_TELLS, ...PAYLOAD_WORD_TELLS];
    expect(payload.filter((tell) => NEUTRALITY_TELLS.includes(tell))).toEqual([]);
    expect(new Set(payload).size).toBe(payload.length);
  });
});

describe('NEUTRALITY_TELLS after the rename', () => {
  it('bans the new product name and keeps the old one banned', () => {
    expect(findTells('served by MCProof')).toEqual(['mcproof']);
    expect(findTells('served by MCPwn')).toEqual(['mcpwn']);
  });
});
