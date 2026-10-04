import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE E2E FIXTURE ROUTES EXIST ONLY IN A BUILD THAT ASKED FOR THEM.
 *
 * A fixture route renders a real screen over fake data so a browser test can
 * reach a state no CI run can produce on its own (a finished live run needs a
 * signed-in user, a connected agent and a judge). It must never ship. So it is
 * excluded at BUILD time, not hidden at run time: its file carries an extension
 * (`page.e2e.tsx`) that Next only treats as a page when E2E_FIXTURES=1 is set for
 * the build, and the config refuses that flag on a production deploy outright.
 */

interface FixturesModule {
  isE2eFixturesEnabled: (env: Record<string, string | undefined>) => boolean;
  pageExtensionsFor: (env: Record<string, string | undefined>) => string[];
  assertE2eFixturesAllowed: (env: Record<string, string | undefined>) => void;
  findFixtureRoutes: (routes: Record<string, string>) => string[];
}

// String-typed so `tsc` does not resolve the module before it exists.
const MODULE: string = '../../../src/config/e2e-fixtures';
const load = async () => (await import(MODULE)) as FixturesModule;

const DEFAULT_EXTENSIONS = ['tsx', 'ts', 'jsx', 'js'];

describe('e2e fixtures · page extensions decide whether the route is built at all', () => {
  it('builds only the default page extensions without the flag', async () => {
    const { pageExtensionsFor } = await load();
    expect(pageExtensionsFor({})).toEqual(DEFAULT_EXTENSIONS);
  });

  it('adds the e2e page extension only when E2E_FIXTURES is exactly 1', async () => {
    const { pageExtensionsFor } = await load();
    expect(pageExtensionsFor({ E2E_FIXTURES: '1' })).toEqual([...DEFAULT_EXTENSIONS, 'e2e.tsx']);
    // Anything else is off: a flag that half-reads as on is how fixtures leak.
    for (const value of ['0', 'true', 'yes', '', ' 1']) {
      expect(pageExtensionsFor({ E2E_FIXTURES: value })).toEqual(DEFAULT_EXTENSIONS);
    }
  });

  it('reports the flag the same way the route checks it', async () => {
    const { isE2eFixturesEnabled } = await load();
    expect(isE2eFixturesEnabled({ E2E_FIXTURES: '1' })).toBe(true);
    expect(isE2eFixturesEnabled({})).toBe(false);
    expect(isE2eFixturesEnabled({ E2E_FIXTURES: 'true' })).toBe(false);
  });
});

describe('e2e fixtures · the guard refuses a production deploy', () => {
  it('throws when the flag is set on a Vercel production build', async () => {
    const { assertE2eFixturesAllowed } = await load();
    expect(() => assertE2eFixturesAllowed({ E2E_FIXTURES: '1', VERCEL_ENV: 'production' })).toThrow(
      /E2E_FIXTURES.*production/i,
    );
  });

  it('allows the flag in CI and on previews, and allows production without it', async () => {
    const { assertE2eFixturesAllowed } = await load();
    expect(() => assertE2eFixturesAllowed({ E2E_FIXTURES: '1' })).not.toThrow();
    expect(() =>
      assertE2eFixturesAllowed({ E2E_FIXTURES: '1', VERCEL_ENV: 'preview' }),
    ).not.toThrow();
    expect(() => assertE2eFixturesAllowed({ VERCEL_ENV: 'production' })).not.toThrow();
  });

  it('is wired into next.config: loading it with the flag on production throws', async () => {
    const saved = { flag: process.env.E2E_FIXTURES, vercel: process.env.VERCEL_ENV };
    try {
      process.env.E2E_FIXTURES = '1';
      process.env.VERCEL_ENV = 'production';
      vi.resetModules();
      await expect(import('../../../next.config')).rejects.toThrow(/E2E_FIXTURES/);

      process.env.VERCEL_ENV = 'preview';
      vi.resetModules();
      const config = (await import('../../../next.config')).default;
      expect(config.pageExtensions).toContain('e2e.tsx');

      delete process.env.E2E_FIXTURES;
      vi.resetModules();
      const plain = (await import('../../../next.config')).default;
      expect(plain.pageExtensions).toEqual(DEFAULT_EXTENSIONS);
    } finally {
      if (saved.flag === undefined) delete process.env.E2E_FIXTURES;
      else process.env.E2E_FIXTURES = saved.flag;
      if (saved.vercel === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = saved.vercel;
      vi.resetModules();
    }
  });
});

describe('e2e fixtures · the build manifest check', () => {
  it('finds a fixture route in a routes manifest, and nothing in a clean one', async () => {
    const { findFixtureRoutes } = await load();
    expect(
      findFixtureRoutes({
        '/(hud)/connect/page': '/connect',
        '/(hud)/e2e/connect-states/page': '/e2e/connect-states',
      }),
    ).toEqual(['/e2e/connect-states']);
    expect(findFixtureRoutes({ '/(hud)/connect/page': '/connect' })).toEqual([]);
  });

  it('is run by CI against the production-shaped build, before the fixture build', () => {
    const ci = readFileSync(join(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
    const verify = ci.indexOf('scripts/verify-no-e2e-routes.ts');
    const fixtureBuild = ci.indexOf('E2E_FIXTURES:');
    const upload = ci.indexOf('Upload the built app for the CWV gate');
    expect(verify).toBeGreaterThan(-1);
    // The CWV gate measures the build that was proven clean, not the fixture one.
    expect(upload).toBeGreaterThan(verify);
    expect(fixtureBuild).toBeGreaterThan(upload);
  });
});
