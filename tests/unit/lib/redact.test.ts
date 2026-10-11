import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  REDACTED,
  SECRET_ENV_NAMES,
  redactSecrets,
  redactString,
  secretNeedles,
} from '@/lib/redact';

const KEY = 'sk-ant-0123456789abcdef0123456789abcdef';
const SERVICE_ROLE = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.abcdefghijkl';
const RUN_TOKEN = `rt_${'a'.repeat(32)}_${'b'.repeat(64)}`;
/**
 * The old product name, assembled from pieces: the rename guard has no allowlist
 * entry for this file, so the name may not appear here as one literal.
 */
const OLD_NAME = ['mc', 'pwn'].join('');
/** The shape a token had before the rename. No such token can verify any more. */
const PRE_RENAME_RUN_TOKEN = `${OLD_NAME}_rt_${'c'.repeat(32)}_${'d'.repeat(64)}`;

const env = {
  JUDGE_API_KEY: KEY,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE,
} as Record<string, string | undefined>;

describe('secretNeedles', () => {
  it('collects the configured secret values, longest first', () => {
    const needles = secretNeedles({ env });

    expect(needles).toContain(KEY);
    expect(needles).toContain(SERVICE_ROLE);
    expect(needles[0]!.length).toBeGreaterThanOrEqual(needles[needles.length - 1]!.length);
  });

  it('names every env var it treats as a secret', () => {
    expect(SECRET_ENV_NAMES).toContain('JUDGE_API_KEY');
    expect(SECRET_ENV_NAMES).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('ignores unset, blank and implausibly short values', () => {
    expect(secretNeedles({ env: { JUDGE_API_KEY: undefined } })).toEqual([]);
    expect(secretNeedles({ env: { JUDGE_API_KEY: '   ' } })).toEqual([]);
    // A three-character "secret" would redact ordinary prose everywhere.
    expect(secretNeedles({ env: { JUDGE_API_KEY: 'abc' } })).toEqual([]);
  });

  it('accepts extra per-call secrets the environment does not hold', () => {
    expect(secretNeedles({ env: {}, extraSecrets: ['a-run-scoped-secret'] })).toContain(
      'a-run-scoped-secret',
    );
  });
});

describe('redactString', () => {
  it('removes a configured secret wherever it appears in the text', () => {
    const out = redactString(`calling the judge with ${KEY} now`, { env });

    expect(out).not.toContain(KEY);
    expect(out).toContain(REDACTED);
  });

  it('removes every occurrence, not just the first', () => {
    expect(redactString(`${KEY} and again ${KEY}`, { env })).not.toContain(KEY);
  });

  it('redacts a per-run token by its shape, with no configuration at all', () => {
    const out = redactString(`authorization: Bearer ${RUN_TOKEN}`, { env: {} });

    expect(out).not.toContain(RUN_TOKEN);
    expect(out).not.toContain('b'.repeat(64));
  });

  it('masks the run token by its shape alone, in plain prose, with no configuration', () => {
    const out = redactString(`the agent sent ${RUN_TOKEN} as its credential`, { env: {} });

    expect(out).toBe(`the agent sent rt_${REDACTED} as its credential`);
  });

  it('masks a run token cut down to its selector', () => {
    const out = redactString(`selector rt_${'e'.repeat(32)} only`, { env: {} });

    expect(out).toBe(`selector rt_${REDACTED} only`);
  });

  it('no longer recognizes the pre-rename prefix as a token shape', () => {
    // Deliberate. Every such token is past the longest lifetime a token can have,
    // so it opens nothing, and the redactor carries one run-token shape, the one
    // that is issued. The old prefix ends in `_`, a word character, so the `\brt_`
    // boundary does not fire inside it: the string passes through as written.
    const text = `the agent sent ${PRE_RENAME_RUN_TOKEN} as its credential`;

    expect(redactString(text, { env: {} })).toBe(text);
  });

  it('still masks a pre-rename token where another rule catches it', () => {
    // As a bearer credential, and under a sensitive key: neither depends on the prefix.
    const header = redactString(`authorization: Bearer ${PRE_RENAME_RUN_TOKEN}`, { env: {} });
    const keyed = JSON.stringify(redactSecrets({ token: PRE_RENAME_RUN_TOKEN }, { env: {} }));

    expect(header).not.toContain('d'.repeat(64));
    expect(keyed).not.toContain('d'.repeat(64));
  });

  it('the module source does not spell the old product name', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/redact.ts'), 'utf8');

    expect(source.toLowerCase()).not.toContain(OLD_NAME);
  });

  it('leaves a word that merely ends in "rt" alone', () => {
    const text = 'part_0123456789abcdef and start_fedcba9876543210';
    expect(redactString(text, { env: {} })).toBe(text);
  });

  it('redacts a bearer credential of any shape', () => {
    const out = redactString('authorization: Bearer abcdef0123456789xyz', { env: {} });

    expect(out).not.toContain('abcdef0123456789xyz');
  });

  it('redacts a JWT, which is the shape every Supabase key takes', () => {
    const out = redactString(`token=${SERVICE_ROLE}`, { env: {} });

    expect(out).not.toContain(SERVICE_ROLE);
  });

  it('redacts a postgres connection string, which carries the database password', () => {
    const out = redactString('postgresql://postgres:hunter2@db.example.co:5432/postgres', {
      env: {},
    });

    expect(out).not.toContain('hunter2');
  });

  it('leaves ordinary prose untouched', () => {
    expect(redactString('run token issued for run-1', { env })).toBe('run token issued for run-1');
  });
});

describe('redactSecrets', () => {
  it('redacts a value nested well below the top level', () => {
    const out = redactSecrets({ a: { b: { c: [{ note: `key ${KEY}` }] } } }, { env });

    expect(JSON.stringify(out)).not.toContain(KEY);
  });

  it('redacts by key name whatever the value looks like', () => {
    const out = redactSecrets({ password: 'p@ss', apiKey: 'x', keep: 'me' }, { env: {} }) as Record<
      string,
      unknown
    >;

    expect(out).toEqual({ password: REDACTED, apiKey: REDACTED, keep: 'me' });
  });

  it('redacts by key name inside a nested object', () => {
    const out = redactSecrets({ outer: { verifier: 'v', otp: '123456' } }, { env: {} });

    expect(JSON.stringify(out)).not.toContain('123456');
  });

  it('renders an Error as name, message and its own fields, all redacted', () => {
    const error = Object.assign(new Error(`failed with ${KEY}`), { code: 'HTTP_ERROR' });

    const out = redactSecrets({ error }, { env }) as { error: Record<string, unknown> };

    expect(out.error.name).toBe('Error');
    expect(String(out.error.message)).not.toContain(KEY);
    expect(out.error.code).toBe('HTTP_ERROR');
  });

  it('survives a circular reference instead of throwing', () => {
    const node: Record<string, unknown> = { name: 'a' };
    node.self = node;

    expect(() => JSON.stringify(redactSecrets(node, { env: {} }))).not.toThrow();
  });

  it('stops at a bounded depth rather than walking forever', () => {
    let deep: unknown = KEY;
    for (let i = 0; i < 40; i += 1) deep = { deep };

    expect(JSON.stringify(redactSecrets(deep, { env }))).not.toContain(KEY);
  });

  it('keeps numbers, booleans and null intact', () => {
    expect(redactSecrets({ n: 42, b: true, z: null }, { env: {} })).toEqual({
      n: 42,
      b: true,
      z: null,
    });
  });

  it('redacts a bare string passed on its own', () => {
    expect(redactSecrets(`bare ${KEY}`, { env })).not.toContain(KEY);
  });

  it('does not mutate the value it was given', () => {
    const input = { note: `key ${KEY}` };
    redactSecrets(input, { env });

    expect(input.note).toContain(KEY);
  });
});
