import type { NextConfig } from 'next';
import { assertE2eFixturesAllowed, pageExtensionsFor } from './src/config/e2e-fixtures';
import { legacyHostRedirects } from './src/config/legacy-host';
import { securityHeaderRules } from './src/config/security-headers';

// Fixture routes (`page.e2e.tsx`) exist only in a build made with E2E_FIXTURES=1,
// and never on a production deploy. See src/config/e2e-fixtures.ts.
assertE2eFixturesAllowed(process.env);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // No X-Powered-By banner: a response does not need to name its framework.
  poweredByHeader: false,
  pageExtensions: pageExtensionsFor(process.env),
  // Fail production builds on type errors. (Next 16 no longer runs ESLint during
  // build — lint is a dedicated CI step; see .github/workflows/ci.yml.)
  typescript: { ignoreBuildErrors: false },
  // The dev indicator defaults to bottom-left, exactly where the command deck's
  // FLEET STATUS cluster sits — it occludes the caution/breach labels in every
  // dev screenshot and review (it never ships to production). Move it clear.
  devIndicators: { position: 'bottom-right' },
  // The old host's page routes move to the new origin; its /api/* stays served,
  // so a run issued before the rename keeps its endpoint. See src/config/legacy-host.ts.
  async redirects() {
    return legacyHostRedirects();
  },
  // Every static response header, for every route class, comes from one module.
  // The content security policy is not here: its nonce is per request, so the
  // middleware sends it. See src/config/security-headers.ts.
  async headers() {
    return securityHeaderRules();
  },
};

export default nextConfig;
