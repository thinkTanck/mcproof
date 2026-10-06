import type { Metadata } from 'next';
import Link from 'next/link';
import { LogoLockup } from '@/components/shell/LogoRing';
import { SignInPanel } from '@/components/signin/SignInPanel';
import { getEmailOtpLength, isAuthEnabled, isGithubOAuthEnabled } from '@/config/env';

export const metadata: Metadata = {
  title: 'Sign in · MCPwn',
  description:
    'Sign in to MCPwn to live red-team your own MCP agent against the Core-7. A one-time code emailed to you gates live runs; sample playback stays open to everyone.',
};

/**
 * Sign-in (BRAND · front door · pre-auth). Standalone route — outside the (hud)
 * shell — so the signed-out gate owns its own `main` landmark and never renders
 * the authenticated command deck / fleet status. A calm Sentinel Fields brand
 * frame (wordmark + radial ambience), not a generic auth card.
 */
export default async function SignIn({
  searchParams,
}: {
  /** `?error=auth` is set by the auth callback when GitHub OAuth fails to
   *  exchange — surfaced to the panel so the visitor gets a reason and a
   *  try-again action, not a silent blank form. `?next=` is the post-sign-in
   *  destination (sanitized server-side in verifyEmailCode). */
  searchParams?: Promise<{ error?: string; next?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const authError = sp.error === 'auth';

  return (
    <main className="type-flow relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-5 py-12">
      {/* Sentinel Fields ambience — top-anchored radial wash, non-interactive. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 90% at 50% -10%, color-mix(in srgb, var(--line-emphasis) 16%, transparent), transparent 60%)',
        }}
      />

      {/* Brand lockup — the front-door wordmark, links home. */}
      <Link
        href="/"
        aria-label="MCPwn home"
        className="relative mb-9 inline-flex min-h-11 items-center gap-2.5 rounded-md"
      >
        <LogoLockup />
      </Link>

      {/* The panel column is its OWN query container, so `--reading-h1`'s `5cqi`
          resolves against the 380px column the headline actually sits in. The
          page <main> is a full-bleed centring frame, so a container established
          only there made `cqi` behave as `vw` — the exact substitution CLAUDE.md
          bans — and rendered a 44px headline in a 380px panel where the design
          reference sets 34px. Scoped here, the token settles on its 32px floor
          and holds at every viewport, which is what a fixed-width panel wants. */}
      <div className="type-flow relative w-full max-w-[380px]">
        <SignInPanel
          authEnabled={isAuthEnabled()}
          githubEnabled={isGithubOAuthEnabled()}
          authError={authError}
          next={sp.next}
          codeLength={getEmailOtpLength()}
        />
      </div>
    </main>
  );
}
