import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE RELEASE BLOCKERS RUN ONLY ON THE RELEASE PULL REQUEST (P0).
 *
 * `npm run test:release` fails until the booking link, the legal sign-off and
 * the security contact are all done, so it must never run on ordinary branch
 * CI. It runs inside the CI Gate job, which main already requires, and only
 * for a pull request from release/monetization into main. The default suite
 * must not collect tests/release.
 */

const repoRoot = process.cwd();
const read = (file: string) => readFileSync(join(repoRoot, file), 'utf8');

describe('release gate wiring', () => {
  it('package.json runs the release suite with its own config', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['test:release']).toBe('vitest run --config vitest.release.config.ts');
  });

  it('the default suite never collects tests/release', () => {
    const config = read('vitest.config.ts');
    expect(config).not.toMatch(/tests\/release/);
    expect(read('vitest.release.config.ts')).toMatch(
      /include: \['tests\/release\/\*\*\/\*\.test\.ts'\]/,
    );
  });

  it('the CI Gate job runs it only for release/monetization into main', () => {
    const workflow = read('.github/workflows/ci.yml');
    const gate = workflow.slice(workflow.indexOf('\n  ci-gate:'));
    expect(gate).toContain('npm run test:release');
    expect(gate).toContain(
      "if: github.event_name == 'pull_request' && github.base_ref == 'main' && github.head_ref == 'release/monetization'",
    );
    const guarded = gate.match(/if: github\.event_name == 'pull_request'[^\n]*/g) ?? [];
    // Every step that installs or runs the release suite carries the same guard.
    const steps = gate.split(/\n {6}- name: /).slice(1);
    const releaseSteps = steps.filter((s) => !s.startsWith('All gates passed'));
    expect(releaseSteps.length).toBeGreaterThan(0);
    for (const step of releaseSteps)
      expect(step).toMatch(
        /\n {8}if: github\.event_name == 'pull_request' && github\.base_ref == 'main' && github\.head_ref == 'release\/monetization'\n/,
      );
    expect(guarded.length).toBe(releaseSteps.length);
  });
});
