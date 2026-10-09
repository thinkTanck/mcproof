import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { BootSplash } from '@/components/splash/BootSplash';
import { getSiteOrigin } from '@/config/env';

/**
 * `display: 'optional'` with next/font's metric-matched fallback: text paints
 * immediately in the size-adjusted fallback, and the web font is only swapped in
 * if it arrives inside a short block window (otherwise it loads to cache for the
 * next navigation). This removes the FOUT reflow that `swap` causes: under CWV
 * throttling, swapping Geist into wrapping prose changed line counts and shifted
 * everything below (a ~0.2 CLS). The fallback is metric-matched, so the type
 * scale and measures are preserved; only the exact glyph shapes differ until the
 * cached font is used. CLS from fonts is then ~0 across every screen.
 */
const geistSans = Geist({ subsets: ['latin'], display: 'optional', variable: '--font-geist-sans' });
const geistMono = Geist_Mono({
  subsets: ['latin'],
  display: 'optional',
  variable: '--font-geist-mono',
});

const TITLE = 'MCProof · Red-team your MCP agents';
const DESCRIPTION =
  'MCProof red-teams an MCP-tool-using AI agent against the OWASP Top 10 for Agentic Applications (2026): live attack replay, per-model robustness leaderboard, and engineer-ready fix reports.';

/**
 * `metadataBase` is the origin every RELATIVE metadata URL resolves against.
 * Without it Next.js falls back to `http://localhost:3000`, so a deployed page
 * advertises localhost Open Graph and canonical URLs. The origin is env-only
 * (`NEXT_PUBLIC_SITE_URL`, defaulting to the canonical host) — see
 * `getSiteOrigin`.
 *
 * Deliberately NOT set here: `alternates.canonical` and `openGraph.url`. Next
 * merges metadata down the tree, so a value pinned on the root layout would make
 * EVERY page that does not override it claim the same canonical URL. A base plus
 * per-route relative URLs is the correct shape.
 *
 * The Open Graph / Twitter card is the SITE-level card, shared by every route
 * that does not override it. A screen behind sign-in has no link-preview
 * audience of its own, so one honest product card beats eight near-identical
 * ones; a route that earns a distinct share card sets its own `openGraph`.
 */
export const metadata: Metadata = {
  metadataBase: new URL(getSiteOrigin()),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: 'website',
    siteName: 'MCProof',
    title: TITLE,
    description: DESCRIPTION,
  },
  // `summary`, not `summary_large_image`: the repo ships no `opengraph-image.*`
  // and no static share asset, and a large-image card with no image behind it is
  // a declaration we cannot honour. Promote it in the same change that adds the
  // image, never before.
  twitter: {
    card: 'summary',
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh antialiased">
        {children}
        {/* First-visit boot splash — a client fade-over that mounts after
            hydration, so it never blocks Home's SSR paint or LCP. */}
        <BootSplash />
      </body>
    </html>
  );
}
