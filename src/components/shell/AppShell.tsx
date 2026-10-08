import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { isAuthEnabled } from '@/config/env';
import { resolveRun } from '@/data/run-view';
import { readShellAccount } from '@/lib/shell-identity';
import { Graticule } from './Graticule';
import { StatusBar } from './StatusBar';
import { CommandDeck } from './CommandDeck';

/**
 * The HUD frame: status bar + command deck + main. A Server Component with NO
 * client JS — the active nav comes from the `x-pathname` request header
 * (middleware) and the mobile drawer is a native popover. Uses natural document
 * flow with a sticky header/rail (not a fixed-height overflow container), which
 * avoids the synchronous-layout cost that was delaying LCP.
 */
export async function AppShell({ children }: { children: ReactNode }) {
  const headerList = await headers();
  const pathname = headerList.get('x-pathname') ?? '/';
  // On a run screen, resolve the run server-side so the status bar can show the
  // run-context telemetry (RUN · TARGET · DETECTOR + outcome + severity). It goes
  // through the SAME resolver the replay screen uses, so the chrome and the
  // screen can never disagree about which run is on show: reading the sample
  // library alone left a persisted live run with no telemetry at all, and left
  // the mode badge saying SAMPLE over a run that was not one.
  //
  // The fix report is run-scoped too, and resolves its id through this same
  // resolver, so it is resolved here as well. The RUN telemetry stays with the
  // replay: the report states all of it in its own header.
  const [, scope, runId] = /^\/(runs|findings)\/([^/]+)/.exec(pathname) ?? [];
  const view = runId ? await resolveRun(runId) : null;
  const run = scope === 'runs' ? view?.run : undefined;
  const runContext = run
    ? {
        runId: run.runId,
        model: run.model,
        category: run.verdict.category,
        severity: run.verdict.severity,
        compromised: run.verdict.compromised,
      }
    : undefined;
  // The badge is provenance: it says where the run on show came from. A screen
  // with no run, or an id that resolves to nothing, has no origin to state, so
  // it gets no badge. It used to default to SAMPLE, which printed SAMPLE over
  // every screen that was not showing a run at all.
  const mode = view?.origin;
  // Who the account entry says is signed in. A LABEL, read from the header the
  // middleware set from the visitor it had already verified; it decides nothing
  // about access (`src/lib/shell-identity.ts`).
  const account = readShellAccount(headerList, { authConfigured: isAuthEnabled() });
  return (
    <div className="relative min-h-dvh bg-base font-sans text-ink">
      {/* Skip link (WCAG 2.4.1) — first focusable element, so a keyboard user can
          bypass the six-item deck straight to content. Off-screen until focused. */}
      <a
        href="#main"
        className="sr-only rounded-md border border-line-em bg-solid px-4 py-2 font-mono text-xs tracking-[0.06em] text-nominal focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[60]"
      >
        Skip to content
      </a>
      <Graticule />
      <StatusBar pathname={pathname} mode={mode} runContext={runContext} account={account} />
      <div className="flex min-h-[calc(100dvh-var(--header-h))]">
        <CommandDeck pathname={pathname} account={account} />
        <main
          id="main"
          tabIndex={-1}
          className="type-flow relative min-w-0 flex-1 overflow-x-clip focus:outline-none"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
