import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SRC, readSource, show } from '../../helpers/import-graph';

/**
 * EVERY WRITE TO `public.runs` GOES THROUGH ONE MODULE.
 *
 * The rules that module enforces (`tests/unit/runs/run-writes.test.ts`) are only
 * worth something while nothing writes around it. This is the static half: it
 * reads `src/` and fails if a second write path appears, so the next person to
 * reach for `.from('runs').insert(...)` from a page or an action is stopped
 * here rather than in a security review.
 */

const WRITER = 'src/runs/run-writes.ts';
const ADAPTER = 'src/data/run-repository.supabase.ts';

/** Comments blanked, so prose that discusses a write is not read as one. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

const sources = () => [...readSource()].map(([file, text]) => ({ file: show(file), text }));

/** A mutation of `runs` through supabase-js, however the chain is laid out. */
const RUNS_MUTATION = /\.from\(\s*['"`]runs['"`]\s*\)\s*\.(insert|update|upsert|delete)\s*\(/;

describe('writes to public.runs', () => {
  it('scans a real number of files, so a broken walk cannot pass by finding nothing', () => {
    expect(sources().length).toBeGreaterThan(100);
  });

  it('are made by the Supabase adapter and by no other file', () => {
    const writers = sources()
      .filter(({ text }) => RUNS_MUTATION.test(code(text)))
      .map(({ file }) => file);

    expect(writers).toEqual([ADAPTER]);
  });

  it('are inserts only: a run is never updated or deleted by the app', () => {
    const adapter = code(readFileSync(join(SRC, 'data', 'run-repository.supabase.ts'), 'utf8'));
    const kinds = [...adapter.matchAll(new RegExp(RUNS_MUTATION.source, 'g'))].map((m) => m[1]);

    expect(kinds).toEqual(['insert', 'insert']);
  });

  it('the write-capable adapter is constructed in the server-only writer and nowhere else', () => {
    const builders = sources()
      .filter(({ text }) => /new\s+SupabaseRunRepository\s*\(/.test(code(text)))
      .map(({ file }) => file);

    expect(builders).toEqual([WRITER]);
  });

  it('catches a second write path when one is seeded', () => {
    const seeded = `await supabase\n  .from('runs')\n  .delete()\n  .eq('id', id);`;

    expect(RUNS_MUTATION.test(code(seeded))).toBe(true);
    expect(RUNS_MUTATION.test(code(`// supabase.from('runs').insert(row)`))).toBe(false);
    expect(RUNS_MUTATION.test(code(`supabase.from('runs').select('id')`))).toBe(false);
  });
});

describe('the server-only run writer', () => {
  const writer = () => code(readFileSync(join(SRC, 'runs', 'run-writes.ts'), 'utf8'));

  it('builds its client from the service role, never from the caller’s cookie session', () => {
    expect(writer()).toMatch(/createAdminSupabase\s*\(/);
    expect(writer()).not.toMatch(/createServerSupabase/);
    expect(writer()).not.toMatch(/@supabase\/ssr/);
  });

  it('takes the account from getUser(), and from nothing a client can set', () => {
    const text = writer();

    expect(text).toMatch(/from ['"]@\/lib\/auth\/user['"]/);
    expect(text).toMatch(/\bgetUser\s*\(/);
    expect(text).not.toMatch(/\bgetSession\s*\(/);
    expect(text).not.toMatch(/next\/headers|\bheaders\s*\(|\bcookies\s*\(/);
    expect(text).not.toMatch(/shell-identity|x-shell-user/i);
    expect(text).not.toMatch(/request\.(json|headers|body)|formData/);
  });

  it('is imported by the two server callers that write runs, and by nothing else', () => {
    const importers = sources()
      .filter(({ text }) => /['"]@\/runs\/run-writes['"]/.test(code(text)))
      .map(({ file }) => file)
      .sort();

    expect(importers).toEqual(['src/app/api/cron/reap-runs/route.ts', 'src/app/api/mcp/host.ts']);
  });
});

describe('the run-lifecycle actions take no account from the caller', () => {
  const actions = () => code(readFileSync(join(SRC, 'app', 'actions', 'live-run.ts'), 'utf8'));

  it('every exported action takes one untyped input and nothing else', () => {
    const signatures = [...actions().matchAll(/export async function (\w+)\(([^)]*)\)/g)].map(
      (m) => [m[1], m[2]!.replace(/\s+/g, ' ').trim().replace(/,$/, '')],
    );

    expect(signatures.map(([name]) => name).sort()).toEqual([
      'discardLiveRun',
      'finishLiveRun',
      'getLiveRunReattach',
      'getLiveRunStatus',
      'startLiveRun',
    ]);
    for (const [, params] of signatures) expect(params).toBe('input: unknown');
  });

  it('reads the account from the verified session in every one of them', () => {
    const bodies = actions()
      .split(/export async function /)
      .slice(1);

    expect(bodies).toHaveLength(5);
    for (const body of bodies) expect(body).toMatch(/await currentUserId\(\)/);
    expect(actions()).not.toMatch(/next\/headers|\bheaders\s*\(|\bcookies\s*\(/);
  });
});
