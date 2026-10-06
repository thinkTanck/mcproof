import type { Metadata } from 'next';
import Link from 'next/link';
import { LogoLockup } from '@/components/shell/LogoRing';
import { headers } from 'next/headers';

export const metadata: Metadata = {
  title: 'Not found · MCPwn',
  description: 'No MCPwn route or run at this address.',
};

/**
 * Custom 404 — a bare console that tried to RESOLVE the requested path and
 * failed. It speaks MCPwn's own terminal language (the run-page transcript
 * shell: soft-yellow host prompt, cyan I/O, blinking caret), so a dead end still
 * feels like the product. Register: BRAND.
 *
 * A root-level not-found renders inside the root layout only (no command deck),
 * so it must carry its own wayfinding — the `suggest --routes` block is that
 * contract. Colour discipline (ADR-0003): a missing route is a SYSTEM state, so
 * the 404 marker wears the neutral `--status-inert` plane, NEVER breach-red.
 *
 * `headers()` reads the middleware `x-pathname`, so the console echoes the real
 * path the visitor tried — a small, honest touch. SVG-free; the caret is a
 * CSS-only blink, and every line is visible without JS.
 */
const ROUTES = [
  { href: '/', cmd: 'home', hint: 'the front door' },
  { href: '/runs/sample', cmd: 'runs/sample', hint: 'watch the sample run' },
  { href: '/connect', cmd: 'connect', hint: 'connect your agent' },
] as const;

const PROMPT = 'mcpwn@sentinel:~$';

export default async function NotFound() {
  const path = (await headers()).get('x-pathname') || '/…';

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-base px-6 py-16">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'radial-gradient(120% 80% at 50% -10%, color-mix(in srgb, var(--status-inert) 12%, transparent), transparent 55%)',
        }}
      />

      <div className="w-full max-w-[620px]">
        {/* Brand lockup — front-door wordmark, links home. */}
        <Link
          href="/"
          aria-label="MCPwn home"
          className="mb-7 inline-flex min-h-11 items-center gap-2.5 rounded-md"
        >
          <LogoLockup />
        </Link>

        {/* The console. */}
        <div
          className="overflow-hidden rounded-lg px-5 py-4 font-mono text-[15px] leading-[1.75]"
          style={{ background: 'var(--terminal-bg)' }}
        >
          {/* Resolve the requested path → 404. */}
          <div className="break-words">
            <span style={{ color: 'var(--terminal-prompt)' }}>{PROMPT}</span>{' '}
            <span className="text-readout">resolve {path}</span>
          </div>
          <h1
            className="pl-4 font-mono text-[15px] font-normal"
            style={{ color: 'var(--status-inert)' }}
          >
            404 · route not found
          </h1>
          <div className="pl-4 text-ink-muted">no MCPwn route or run at this address.</div>

          {/* Suggest routes → the wayfinding, as command output. */}
          <div className="mt-3 break-words">
            <span style={{ color: 'var(--terminal-prompt)' }}>{PROMPT}</span>{' '}
            <span className="text-readout">suggest --routes</span>
          </div>
          <nav aria-label="Where to next" className="mt-0.5 flex flex-col">
            {ROUTES.map((r) => (
              <Link
                key={r.href}
                href={r.href}
                className="group grid grid-cols-[auto_auto_minmax(0,1fr)] items-baseline gap-x-2 rounded-sm py-0.5 pl-4 pr-2 transition-colors hover:bg-[color-mix(in_srgb,var(--status-nominal)_7%,transparent)]"
              >
                <span aria-hidden="true" style={{ color: 'var(--terminal-prompt)' }}>
                  →
                </span>
                <span className="text-readout underline-offset-2 group-hover:underline">
                  {r.cmd}
                </span>
                <span className="truncate text-ink-faint">{r.hint}</span>
              </Link>
            ))}
          </nav>

          {/* Waiting prompt + caret. */}
          <div className="mt-3">
            <span style={{ color: 'var(--terminal-prompt)' }}>{PROMPT}</span>{' '}
            <span
              aria-hidden="true"
              className="ml-px inline-block h-[1.05em] w-[0.55ch] translate-y-[0.18em] motion-safe:[animation:cursor-blink_1.05s_step-end_infinite]"
              style={{ background: 'var(--text-readout)' }}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
