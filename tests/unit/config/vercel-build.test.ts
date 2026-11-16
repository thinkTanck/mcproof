import { isVercelBuild } from '@/config/env';

/**
 * IS THIS BUILD RUNNING ON VERCEL? Vercel sets `VERCEL=1` in every build and
 * at run time. Read here, in the one config accessor, and nowhere else: the
 * root layout mounts Vercel Web Analytics only when it is true, so a build
 * that is not on Vercel (CI, `next start` locally) loads no
 * `/_vercel/insights/script.js` that does not exist there.
 */
describe('isVercelBuild', () => {
  it('is true when Vercel sets VERCEL=1', () => {
    expect(isVercelBuild({ VERCEL: '1' })).toBe(true);
  });

  it.each([
    ['unset', {}],
    ['empty', { VERCEL: '' }],
    ['0', { VERCEL: '0' }],
    ['true (not what Vercel sets)', { VERCEL: 'true' }],
  ])('is false when VERCEL is %s', (_label, env) => {
    expect(isVercelBuild(env)).toBe(false);
  });

  it('reads process.env by default', () => {
    vi.stubEnv('VERCEL', '1');
    expect(isVercelBuild()).toBe(true);
    vi.stubEnv('VERCEL', '');
    expect(isVercelBuild()).toBe(false);
    vi.unstubAllEnvs();
  });
});
