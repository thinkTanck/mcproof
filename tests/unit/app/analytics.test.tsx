import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { Analytics } from '@vercel/analytics/next';

/**
 * VERCEL WEB ANALYTICS IS MOUNTED ONCE, IN THE ROOT LAYOUT, ON VERCEL ONLY.
 *
 * The root layout is the one component every route renders, so the Analytics
 * component placed there counts every page view and nowhere else needs it. In a
 * production build it injects one deferred script from this site's own origin,
 * `/_vercel/insights/script.js`, and sends its beacons there too, so the
 * report-only policy needs no change: the script is added by Next's nonce'd
 * chunks (`'strict-dynamic'`) and its requests are same-origin (`connect-src
 * 'self'`). It sets no cookie and does not identify individual visitors.
 *
 * That script exists only on Vercel, so the component is rendered only when the
 * build runs there (`isVercelBuild()`, `VERCEL=1`). A build anywhere else, CI's
 * e2e server included, renders nothing and requests no missing script.
 */

vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: '--font-geist-sans' }),
  Geist_Mono: () => ({ variable: '--font-geist-mono' }),
}));

/** Every element in a rendered tree, depth first. */
function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const children = (node.props as { children?: ReactNode }).children;
  return [node, ...elements(children)];
}

async function renderLayout() {
  const { default: RootLayout } = await import('@/app/layout');
  return elements(RootLayout({ children: null }));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('root layout: Vercel Web Analytics', () => {
  describe('on Vercel (VERCEL=1)', () => {
    beforeEach(() => {
      vi.stubEnv('VERCEL', '1');
    });

    it('renders the Analytics component exactly once, inside <body>', async () => {
      const all = await renderLayout();
      expect(all.filter((el) => el.type === Analytics)).toHaveLength(1);
      const body = all.find((el) => el.type === 'body');
      expect(body).toBeDefined();
      expect(elements(body).filter((el) => el.type === Analytics)).toHaveLength(1);
    });

    it('is given no props, so it uses the same-origin default script and no custom endpoint', async () => {
      const analytics = (await renderLayout()).find((el) => el.type === Analytics);
      expect(analytics?.props).toEqual({});
    });
  });

  describe('anywhere else (VERCEL unset)', () => {
    beforeEach(() => {
      vi.stubEnv('VERCEL', '');
    });

    it('renders no Analytics component, so no missing script is requested', async () => {
      const all = await renderLayout();
      expect(all.filter((el) => el.type === Analytics)).toHaveLength(0);
      // The rest of the body is untouched.
      expect(all.find((el) => el.type === 'body')).toBeDefined();
    });
  });
});
