'use client';

import { useEffect, useId, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { Button } from '@/components/hud';
import { requestEmailCode, verifyEmailCode, startGitHubOAuth } from '@/lib/auth/actions';

/**
 * Email OTP sign-in (BRAND · pre-auth), wired to Supabase Auth. Two steps in one
 * browser: request a one-time code (requestEmailCode), then type it (verifyEmailCode,
 * which sets the session and redirects). Code-only by design — no clickable link,
 * so an email scanner or a different browser can never break it. When auth is not
 * configured the panel keeps an honest preview state (no send happens).
 *
 * Register discipline (design-system §3.0): sentences a human reads use the
 * READING role (sans, ≥16px); machine labels/field glyphs use the INSTRUMENT
 * role (mono, 12–13px).
 */
/**
 * The input's hard cap is Supabase's CEILING, not the expected length.
 *
 * Capping at the expected length is what caused the original outage: the project
 * emitted 8 digits, the field allowed 6, and the real code was silently sliced
 * into a prefix that looked complete and verified as garbage. Keeping the
 * ceiling means a longer code survives intact, the length mismatch is visible,
 * and the form simply stays shut. Loud beats silent.
 *
 * The EXPECTED length arrives as `codeLength` from `getEmailOtpLength()` and is
 * the single source of truth for the copy, the placeholder, and the submit gate.
 */
const CODE_CEILING = 10;

function EnvelopeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.6 4.4 8 8.6l5.4-4.2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function CautionIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2 14.5 13.5H1.5L8 2Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M8 6.4v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="8" cy="11.4" r="0.7" fill="currentColor" />
    </svg>
  );
}

function BreachIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 4.6v3.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="8" cy="10.9" r="0.7" fill="currentColor" />
    </svg>
  );
}

/** Inline field error: breach-red text PLUS an icon (the project's error contract:
 *  status is a label/icon, never colour alone). `id` links it to the input via
 *  aria-describedby so a screen reader hears the error on the field. */
function ErrorLine({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} role="alert" className="reading flex items-start gap-2 text-breach-text">
      <span aria-hidden="true" className="mt-0.5 shrink-0">
        <BreachIcon />
      </span>
      <span>{children}</span>
    </p>
  );
}

function LockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      className="mt-1 flex-none text-ink-faint"
    >
      <rect x="2.5" y="5" width="7" height="5" rx="1" stroke="currentColor" strokeWidth="1" />
      <path d="M4 5V3.6a2 2 0 0 1 4 0V5" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 1.3a6.7 6.7 0 0 0-2.1 13c.33.06.45-.14.45-.32v-1.1c-1.86.4-2.25-.9-2.25-.9-.3-.77-.74-.98-.74-.98-.6-.41.05-.4.05-.4.67.05 1.02.69 1.02.69.6 1.02 1.56.73 1.94.56.06-.43.23-.73.42-.9-1.48-.17-3.04-.74-3.04-3.3 0-.73.26-1.32.69-1.79-.07-.17-.3-.85.07-1.77 0 0 .56-.18 1.84.68a6.4 6.4 0 0 1 3.34 0c1.28-.86 1.84-.68 1.84-.68.37.92.14 1.6.07 1.77.43.47.69 1.06.69 1.79 0 2.57-1.56 3.13-3.05 3.3.24.2.45.61.45 1.24v1.83c0 .18.12.39.46.32A6.7 6.7 0 0 0 8 1.3z" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M14.5 8.16c0-.46-.04-.9-.12-1.32H8v2.5h3.65a3.12 3.12 0 0 1-1.35 2.05v1.7h2.18c1.28-1.18 2.02-2.92 2.02-4.93z"
        fill="currentColor"
      />
      <path
        d="M8 15c1.83 0 3.36-.6 4.48-1.64l-2.18-1.7c-.6.4-1.38.65-2.3.65-1.77 0-3.27-1.2-3.8-2.8H1.94v1.76A6.75 6.75 0 0 0 8 15z"
        fill="currentColor"
        opacity="0.8"
      />
      <path
        d="M4.2 9.5A4.06 4.06 0 0 1 4.2 6.5V4.74H1.94a6.76 6.76 0 0 0 0 6.52z"
        fill="currentColor"
        opacity="0.55"
      />
      <path
        d="M8 3.9c1 0 1.9.34 2.6 1.02l1.94-1.94A6.73 6.73 0 0 0 1.94 4.74L4.2 6.5C4.73 4.9 6.23 3.9 8 3.9z"
        fill="currentColor"
      />
    </svg>
  );
}

export function SignInPanel({
  authEnabled = false,
  githubEnabled = false,
  authError = false,
  next,
  codeLength,
}: {
  /** Real Supabase auth is wired (else the honest preview state). */
  authEnabled?: boolean;
  /** GitHub OAuth is configured + enabled (else the button stays disabled). */
  githubEnabled?: boolean;
  /** The visitor arrived from a failed `/auth/callback` (`?error=auth`) — a prior
   *  sign-in (GitHub OAuth) could not be completed. Explain it instead of
   *  bouncing them onto a silent, blank form. */
  authError?: boolean;
  /** Post-verify destination (sanitized server-side); flows from `?next=`. */
  next?: string;
  /** Digits in an emailed code, from getEmailOtpLength(). The SINGLE source of
   *  truth: the copy, the placeholder and the accepted length all derive from
   *  it, so a stated number and an accepted number cannot disagree. */
  codeLength: number;
}) {
  const emailId = useId();
  const codeId = useId();
  const helpId = useId();
  const errorId = useId();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [previewSent, setPreviewSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [pending, startTransition] = useTransition();
  const codeRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  /**
   * Armed only by a deliberate return to step 1 ("Use a different email"), so the
   * focus handoff is symmetric: forward to the code field, back to the email
   * field. Without it, going back re-rendered step 1 with focus still on the
   * removed button, which the browser resets to <body> — dropping a keyboard or
   * screen-reader user at the top of the document with no announcement. A ref
   * (not state) because first mount must NOT steal focus.
   */
  const returnToEmail = useRef(false);

  // One countdown for the whole code step; requesting/resending re-arms it to 45.
  useEffect(() => {
    if (step !== 'code') return;
    const t = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(t);
  }, [step]);

  // Keyboard-first focus handoff, both ways: to the code field when it appears,
  // and back to the email field when the visitor returns to step 1. `previewSent`
  // is a dependency because the unconfigured-auth preview leaves `step` at
  // 'email' and swaps the whole panel, so `step` alone never changes.
  useEffect(() => {
    if (step === 'code') {
      codeRef.current?.focus();
    } else if (returnToEmail.current) {
      returnToEmail.current = false;
      emailRef.current?.focus();
    }
  }, [step, previewSent]);

  const requestCode = () => {
    setError(null);
    // Honest preview when auth is not configured: no send happens.
    if (!authEnabled) {
      setPreviewSent(true);
      return;
    }
    const isResend = step === 'code';
    startTransition(async () => {
      const res = await requestEmailCode(email);
      if (res.ok) {
        setStep('code');
        setCode('');
        setCooldown(45);
        // A resend gives no visible reply otherwise; announce it politely.
        setNotice(isResend ? 'New code sent.' : null);
      } else {
        setError(res.error);
      }
    });
  };

  const verify = () => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await verifyEmailCode(email, code, next);
      // A successful verify redirects server-side; only a failure returns here.
      if (!res.ok) setError(res.error);
    });
  };

  const backToEmail = () => {
    returnToEmail.current = true;
    setStep('email');
    setCode('');
    setError(null);
    setNotice(null);
  };

  // Honest preview confirmation (auth not configured): no send happened.
  if (previewSent) {
    return (
      <div className="w-full max-w-[380px]" role="status" aria-live="polite">
        <div className="border-t border-line pt-7">
          <span aria-hidden="true" className="mb-2 inline-flex text-nominal">
            <EnvelopeIcon />
          </span>
          <h1 className="reading-h1">That is the flow.</h1>
          <p className="reading mt-3">
            In the live app, a {codeLength}-digit code lands at{' '}
            <span className="font-mono text-readout">{email || 'your inbox'}</span> and expires
            shortly after. No email is sent in this preview; sign-in wiring ships with the hosted
            release.
          </p>
        </div>
        <Button
          variant="ghost"
          className="mt-6 w-full uppercase"
          onClick={() => {
            returnToEmail.current = true;
            setPreviewSent(false);
            setEmail('');
          }}
        >
          Use a different email
        </Button>
      </div>
    );
  }

  // Code step: type the emailed code (verified in this same browser).
  if (step === 'code') {
    return (
      <div className="w-full max-w-[380px]">
        <div className="border-t border-line pt-7">
          <span aria-hidden="true" className="mb-2 inline-flex text-nominal">
            <EnvelopeIcon />
          </span>
          <h1 className="reading-h1">Enter your code.</h1>
          <p className="reading mt-3">
            We emailed a {codeLength}-digit code to{' '}
            <span className="font-mono text-readout">{email}</span>. Enter it below to finish
            signing in. Codes expire, so use the newest one.
          </p>
        </div>

        <form
          className="mt-6 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            verify();
          }}
        >
          <div className="flex flex-col gap-2">
            <label
              htmlFor={codeId}
              className="font-mono text-[13px] uppercase tracking-[0.12em] text-ink-faint"
            >
              Code
            </label>
            <input
              id={codeId}
              ref={codeRef}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={CODE_CEILING}
              required
              placeholder={'0'.repeat(codeLength)}
              value={code}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_CEILING))}
              className="w-full rounded-md border border-line bg-base px-3 py-3 text-center font-mono text-[18px] tracking-[0.4em] text-readout placeholder:text-ink-faint focus-visible:border-nominal"
            />
          </div>

          <Button
            type="submit"
            disabled={pending || code.length !== codeLength}
            className="w-full gap-2.5 uppercase tracking-[0.06em]"
          >
            {pending ? 'Verifying…' : 'Verify and continue'}
          </Button>

          {error && <ErrorLine id={errorId}>{error}</ErrorLine>}
        </form>

        {/* Resend is otherwise silent; announce it politely for everyone. */}
        <p role="status" aria-live="polite" className="reading mt-3 text-nominal">
          {notice}
        </p>

        <div className="mt-2 flex gap-2.5">
          <Button
            variant="ghost"
            disabled={cooldown > 0 || pending}
            onClick={requestCode}
            className="flex-1 border-line text-ink"
          >
            {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
          </Button>
          <Button variant="ghost" onClick={backToEmail} className="flex-1 border-line text-ink">
            Use a different email
          </Button>
        </div>

        <p className="reading mt-4 text-ink-muted">
          Did not get the code? Check your spam folder, then resend above.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[380px]">
      <div className="border-t border-line pt-7">
        <h1 className="reading-h1">Continue to MCProof.</h1>
        <p className="reading mt-3">
          Sign-in gates live runs against your own agent, with a small free-run cap that keeps
          things fair and affordable. Sample playback stays open to everyone.
        </p>
      </div>

      {/* Arrived from a failed callback (GitHub OAuth): the sign-in could not be
          completed. Say so (caution, not breach — a failed sign-in is not a
          compromise) and point at the form as the try-again action, so the user
          is never dropped on a silent, blank sign-in page. */}
      {authError && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2.5 rounded-md border border-caution/45 bg-caution/5 px-3 py-2.5"
        >
          <span aria-hidden="true" className="mt-0.5 shrink-0 text-caution">
            <CautionIcon />
          </span>
          <span className="reading text-ink">
            We could not complete that sign-in. Request a new code below.
          </span>
        </div>
      )}

      {/* Honest preview state only when auth is NOT configured: the screen is
          labelled a preview rather than asserting a send that never happens. */}
      {!authEnabled && (
        <div className="mt-4 flex items-center gap-2.5 rounded-md border border-line-em bg-nominal/5 px-3 py-2.5">
          <span className="shrink-0 rounded border border-line-em px-1.5 py-0.5 font-mono text-[13px] uppercase tracking-[0.12em] text-nominal">
            Preview
          </span>
          <span className="reading text-ink-muted">
            Sign-in wiring ships with the hosted release; no email is sent yet.
          </span>
        </div>
      )}

      <form
        className="mt-6 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          requestCode();
        }}
      >
        <div className="flex flex-col gap-2">
          <label
            htmlFor={emailId}
            className="font-mono text-[13px] uppercase tracking-[0.12em] text-ink-faint"
          >
            Email
          </label>
          <input
            id={emailId}
            ref={emailRef}
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${helpId} ${errorId}` : helpId}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-line bg-base px-3 py-3 font-mono text-[14px] text-readout placeholder:text-ink-faint focus-visible:border-nominal"
          />
        </div>

        <Button
          type="submit"
          disabled={pending}
          className="w-full gap-2.5 uppercase tracking-[0.06em]"
        >
          <EnvelopeIcon />
          {pending ? 'Sending…' : 'Email me a code'}
        </Button>

        {error && <ErrorLine id={errorId}>{error}</ErrorLine>}

        <p id={helpId} className="reading mt-1 flex items-start gap-2">
          <LockIcon />
          <span>
            No password. We email a {codeLength}-digit code that expires soon after, so there is
            nothing to remember and nothing to leak.
          </span>
        </p>
      </form>

      <div className="my-5 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        <span className="font-mono text-[13px] uppercase tracking-[0.14em] text-ink-faint">
          Or continue with
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>

      {/* GitHub is wired behind config: enabled only when isGithubOAuthEnabled, so
          it never blocks on the GitHub app creds. Google stays disabled (unwired)
          rather than a silent no-op. */}
      <div className="flex gap-2.5">
        {githubEnabled ? (
          <form action={startGitHubOAuth} className="flex-1">
            <Button
              variant="ghost"
              type="submit"
              aria-label="Continue with GitHub"
              className="w-full gap-2 border-line text-ink"
            >
              <GitHubIcon />
              GitHub
            </Button>
          </form>
        ) : (
          <Button
            variant="ghost"
            disabled
            aria-label="Continue with GitHub (available with the hosted release)"
            className="flex-1 gap-2 border-line text-ink"
          >
            <GitHubIcon />
            GitHub
          </Button>
        )}
        <Button
          variant="ghost"
          disabled
          aria-label="Continue with Google (available with the hosted release)"
          className="flex-1 gap-2 border-line text-ink"
        >
          <GoogleIcon />
          Google
        </Button>
      </div>

      {/* The copy promises the sample is open to everyone; give it a door. */}
      <p className="reading mt-6 text-ink-muted">
        Just exploring?{' '}
        <Link href="/runs/sample" className="text-nominal hover:underline">
          Watch the sample run
        </Link>
        , no sign-in needed.
      </p>
    </div>
  );
}
