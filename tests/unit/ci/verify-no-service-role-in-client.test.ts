// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * THE BUILD-LEVEL CHECK, CHECKED.
 *
 * `scripts/verify-no-service-role-in-client.ts` reads the built client bundle
 * and fails if the service-role key's name or value is in it. A check like that
 * is only worth running if it can fail, so it is run here against small
 * directories that stand in for `.next/static`: a clean one, one that names the
 * key, one that carries its value, and one that is not there at all.
 */

const SCRIPT = join(process.cwd(), 'scripts', 'verify-no-service-role-in-client.ts');
const TSX = join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
const NAME = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');
/** A stand-in with the shape of a key. Not a credential. */
const VALUE = `sentinel-${'k'.repeat(40)}`;

let root: string;

function bundle(files: Record<string, string>): string {
  const dir = mkdtempSync(join(root, 'static-'));
  mkdirSync(join(dir, 'chunks'), { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

function run(dir: string, value?: string) {
  const env = { ...process.env };
  delete env[NAME];
  if (value !== undefined) env[NAME] = value;
  const result = spawnSync(process.execPath, [TSX, SCRIPT, '--dir', dir], {
    env,
    encoding: 'utf8',
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'service-role-check-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('scripts/verify-no-service-role-in-client.ts', () => {
  it('passes a bundle with no trace of the key, and says the value was checked', () => {
    const dir = bundle({ 'chunks/app.js': 'console.log("hello")' });

    const { status, output } = run(dir, VALUE);

    expect(status).toBe(0);
    expect(output).toContain('value checked');
  }, 60_000);

  it('says so when there is no value to check, rather than implying it looked', () => {
    const dir = bundle({ 'chunks/app.js': 'console.log("hello")' });

    const { status, output } = run(dir);

    expect(status).toBe(0);
    expect(output).toContain('not checked');
  }, 60_000);

  it('fails a bundle that names the key', () => {
    const dir = bundle({ 'chunks/app.js': `const k = process.env.${NAME};` });

    const { status, output } = run(dir);

    expect(status).toBe(1);
    expect(output).toContain('NAMED');
    expect(output).toContain('app.js');
  }, 60_000);

  it('fails a bundle that carries the value, without printing it', () => {
    const dir = bundle({ 'chunks/app.js': `fetch(url, { headers: { apikey: "${VALUE}" } })` });

    const { status, output } = run(dir, VALUE);

    expect(status).toBe(1);
    expect(output).toContain('VALUE');
    expect(output).not.toContain(VALUE);
  }, 60_000);

  it('fails when there is no bundle to read, so it cannot pass by reading nothing', () => {
    expect(run(join(root, 'does-not-exist')).status).toBe(1);
    expect(run(mkdtempSync(join(root, 'empty-'))).status).toBe(1);
  }, 60_000);
});
