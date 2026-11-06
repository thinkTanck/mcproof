import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * EVERY CI JOB HAS A TIME LIMIT OF ITS OWN (owner ruling Q26, 2026-11-05).
 *
 * Without `timeout-minutes` a job that hangs (a Playwright install that never
 * finishes, a browser that never closes) runs until GitHub kills it at six
 * hours, and nothing reports in the meantime. Each job names a limit well above
 * its normal run time. Build & Test takes about 64 minutes (main, 2026-11-05),
 * so it stops at 90; each CWV leg takes about 3 and stops at 20; the
 * authenticated axe scan takes about 3 and stops at 30; the gate job, which
 * only reads results, stops at 10.
 *
 * The workflow is read as text, one job at a time, so the test needs no YAML
 * parser: a job starts at a line with exactly two spaces of indent under
 * `jobs:`, and its own keys sit at four.
 */

const repoRoot = process.cwd();
const workflow = readFileSync(join(repoRoot, '.github/workflows/ci.yml'), 'utf8');

function jobBlocks(text: string): Map<string, string> {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line === 'jobs:');
  const blocks = new Map<string, string>();
  let current: string | null = null;
  let body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const job = /^ {2}([a-z0-9-]+):\s*$/.exec(line);
    if (job) {
      if (current) blocks.set(current, body.join('\n'));
      current = job[1]!;
      body = [];
    } else if (/^\S/.test(line)) {
      break;
    } else if (current) {
      body.push(line);
    }
  }
  if (current) blocks.set(current, body.join('\n'));
  return blocks;
}

const EXPECTED: Record<string, number> = {
  'build-test': 90,
  lighthouse: 20,
  'authed-axe': 30,
  'ci-gate': 10,
};

describe('CI job time limits', () => {
  const blocks = jobBlocks(workflow);

  it('reads every job in the workflow', () => {
    expect([...blocks.keys()].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.entries(EXPECTED))('%s stops after %i minutes', (job, minutes) => {
    const own = blocks
      .get(job)!
      .split('\n')
      .filter((line) => /^ {4}timeout-minutes:/.test(line));
    expect(own).toEqual([`    timeout-minutes: ${minutes}`]);
  });
});
