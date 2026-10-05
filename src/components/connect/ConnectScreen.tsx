'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import { SAMPLE_CATEGORY } from '@/data/sample-category';
import { CORE7 } from './categories';
import { RUN_TYPES } from './run-kinds';
import { LiveRunConsole } from './LiveRunConsole';
import { readActiveRunId, subscribeActiveRunId, writeActiveRunId } from './active-run-store';
import {
  createConnectLiveRunPort,
  notWiredLiveRunPort,
  type ConnectLiveRunActions,
  type ConnectLiveRunPort,
} from './live-run-port';
import type { Category, VariantKind } from '@/contract';

/**
 * CONNECT / RUN SETUP — the targeting console (register: PRODUCT).
 *
 * ── THE INVERSION THIS SCREEN EXISTS TO EXPRESS ──
 *
 * The retired console asked for the user's agent endpoint and API key so that we
 * could call their agent. [ADR-0006](docs/adr/0006-mcpwn-is-the-mcp-server.md)
 * reversed that: MCPwn IS the MCP server, and the user's agent connects to US.
 * So the screen no longer TAKES a target, it ISSUES one — a per-run endpoint and
 * a per-run token — and then waits on the real connection.
 *
 * The clearest signal of the inversion is what is missing: there is no field on
 * this screen at all. Nothing to type, nothing to paste, no credential of the
 * user's for us to promise to look after.
 *
 * ── ONE CATEGORY PER RUN ──
 *
 * The old console offered a seven-box checklist, which made sense when a run was
 * a batch of calls we made. It does not now: a run is ONE hosted endpoint serving
 * ONE attack `Environment`, because the environment IS the attack. So the
 * checklist is a radio group, and the same choice drives both modes — in sample
 * it picks which recorded run plays, in live it picks which surface we serve.
 *
 * ── TYPE ROLES ──
 *
 * Every sentence is a READING role (sans). Labels, chips and machine values are
 * INSTRUMENT (mono, 12-13px). The one DISPLAY value on the screen is the recorded
 * step count in the live console, which is evidence and is therefore printed as
 * read, never animated.
 */

type Mode = 'sample' | 'live';

/** Which recorded run each category plays. Resolved on the server; see the route. */
export type SampleRunIds = Partial<Record<Category, string>>;

/**
 * The task each category's live run hands the agent, as plain strings.
 *
 * Built on the server (see the route) and handed down, never looked up here:
 * the goals live beside the poisoned payloads and the trace builders, and
 * importing those into this client component would ship them to the browser.
 */
export type CategoryGoals = Partial<Record<Category, string>>;

/** The sample the screens ship with, when no per-category id was resolved. */
const CANONICAL_SAMPLE = 'sample';

/**
 * The category the console starts on: the FEATURED sample category, so the connect
 * default can never drift from the homepage hero or the Findings/sample alias. It
 * is derived from the single source (`@/data/sample-category`), never a literal.
 */
const DEFAULT_CATEGORY: Category = SAMPLE_CATEGORY;

const MODES: [Mode, string][] = [
  ['sample', 'SAMPLE · no sign-in'],
  ['live', 'LIVE · your agent connects to us'],
];

/**
 * A section heading. The ordinal is OPTIONAL and that is the point.
 *
 * Numbered section markers are a known scaffolding tell, and they earn their
 * place only when the sections really are an ordered sequence. Setting a run up
 * IS one: pick how you are running, pick what you are running against, then get
 * your run. The DETECTOR band carries no number because it is not a step — it is
 * a fact stated at the point it matters, and numbering it would have told the
 * reader there was a fourth thing to do.
 */
function SectionHead({ n, label, id }: { n?: string; label: string; id: string }) {
  return (
    <h2 id={id} className="mb-4 flex items-baseline gap-3.5">
      {n && (
        <span className="font-sans text-[20px] font-semibold tracking-tight text-ink-hi">{n}</span>
      )}
      <span className="micro-label">{label}</span>
    </h2>
  );
}

function Section({ children, labelledBy }: { children: ReactNode; labelledBy: string }) {
  return (
    <section aria-labelledby={labelledBy} className="border-t border-line py-5 pb-6">
      {children}
    </section>
  );
}

/**
 * One single-choice row: a mono code, then what it is in sans.
 *
 * Shared by the two choices in section 02 on purpose. They are the same kind of
 * decision at the same level of the setup ("what does this run serve"), so they
 * wear the same control rather than a second vocabulary, and the reader learns
 * one interaction instead of two.
 */
function Choice({
  code,
  label,
  checked,
  onSelect,
}: {
  code: string;
  label: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        'flex min-h-11 items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors',
        checked ? 'border-line-em bg-nominal/5' : 'border-line hover:border-line-em',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
          checked ? 'border-nominal text-nominal' : 'border-line text-transparent',
        )}
      >
        <span className="h-2 w-2 rounded-full bg-current" />
      </span>
      <span className="shrink-0 font-mono text-[13px] text-ink-hi">{code}</span>
      <span className="font-sans text-[15px] text-ink">{label}</span>
    </button>
  );
}

const LockIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
    <rect
      x="2.5"
      y="5"
      width="7"
      height="5"
      rx="1"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
    />
    <path d="M4 5V3.6a2 2 0 0 1 4 0V5" fill="none" stroke="currentColor" strokeWidth="1" />
  </svg>
);

export function ConnectScreen({
  signedIn = false,
  sampleRunIds,
  categoryGoals,
  sampleProvenance,
  liveActions,
  livePort,
  initialRunId,
}: {
  signedIn?: boolean;
  /**
   * A run named in the URL (`?run=<id>`) as the SERVER saw it, to reopen. It is
   * only a seed: the live URL and the stored id are read here as well, because
   * the server's view is stale on Back and absent on a plain `/connect` link.
   */
  initialRunId?: string;
  /** Category to recorded-run id. Absent entries fall back to the canonical sample. */
  sampleRunIds?: SampleRunIds;
  /** Category to the task its live run serves. Absent means no preview is drawn. */
  categoryGoals?: CategoryGoals;
  /** What the sample IS, in the sample library's own words. */
  sampleProvenance?: string;
  /**
   * The live-run server actions, bound by the route. They are adapted into
   * the screen's port HERE and nowhere else, so the screen itself never learns
   * the server's shape. Absent means nothing is bound, and the console refuses
   * plainly rather than pretending.
   */
  liveActions?: ConnectLiveRunActions;
  /** A ready-made port. Tests inject one; the route passes actions instead. */
  livePort?: ConnectLiveRunPort;
}) {
  // THE ACTIVE RUN, BY ID. It is held here, above the console, because the
  // console unmounts when the mode switches to SAMPLE and a run that lived only
  // inside it was lost on the way back. Only the id is kept: the token stays in
  // the console's memory and nowhere else.
  //
  // WHERE THE ID COMES FROM, in order. It used to be read once, from the server
  // prop, and both ways back to this screen lost it: the nav link goes to plain
  // `/connect`, and Back restores the router tree the page was first rendered
  // with, which has no `?run=` in it even though the address bar does. So:
  //
  //   1. the LIVE URL, which is right on a reload and on Back;
  //   2. the id stored for this tab, which is what a plain `/connect` link finds;
  //   3. the server's prop, a seed that is dropped the moment a run changes here.
  //
  // A signed-out visitor is offered nothing from storage: a run is reopened for
  // the account that issued it, and the gate is all they are shown.
  const searchParams = useSearchParams() as ReturnType<typeof useSearchParams> | null;
  const urlRunId = searchParams?.get('run')?.trim() || null;
  const storedRunId = useSyncExternalStore(subscribeActiveRunId, readActiveRunId, () => null);
  const [seedRunId, setSeedRunId] = useState<string | null>(initialRunId ?? null);
  // A run that is over here: ended, let go, or unknown to the server. Its id may
  // still be in the URL, and it is not put back into storage from there.
  const [settledRunId, setSettledRunId] = useState<string | null>(null);
  const activeRunId = urlRunId ?? (signedIn ? storedRunId : null) ?? seedRunId;

  const [mode, setMode] = useState<Mode>(activeRunId === null ? 'sample' : 'live');
  // A run that turns up after the first render (the stored id is only readable
  // once the page is in the browser, and the URL changes on navigation) opens
  // the live console, exactly as one named at load does.
  const [shownRunId, setShownRunId] = useState(activeRunId);
  if (activeRunId !== shownRunId) {
    setShownRunId(activeRunId);
    if (activeRunId !== null) setMode('live');
  }

  /** Stop remembering a run. Its URL, if it has one, is left alone. */
  const forgetRun = useCallback((runId: string) => {
    if (readActiveRunId() === runId) writeActiveRunId(null);
    setSettledRunId(runId);
  }, []);

  const onRunChange = useCallback(
    (runId: string | null) => {
      setSeedRunId(null);
      // Letting a run go settles it; issuing one starts afresh.
      setSettledRunId(runId === null ? activeRunId : null);
      writeActiveRunId(runId);
      const { pathname } = window.location;
      window.history.replaceState(
        null,
        '',
        runId === null ? pathname : `${pathname}?run=${encodeURIComponent(runId)}`,
      );
    },
    [activeRunId],
  );

  // KEEP THE TWO COPIES IN STEP. A run found in storage is put back in the URL,
  // so a reload from here reopens it; a run found in the URL is stored, so a
  // trip to another screen comes back to it. A settled run is left out of both.
  useEffect(() => {
    if (activeRunId === null || activeRunId === settledRunId) return;
    if (signedIn && storedRunId === null) writeActiveRunId(activeRunId);
    if (urlRunId === null) {
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}?run=${encodeURIComponent(activeRunId)}`,
      );
    }
  }, [activeRunId, settledRunId, signedIn, storedRunId, urlRunId]);
  const [category, setCategory] = useState<Category>(DEFAULT_CATEGORY);
  // The attack, unless the user says otherwise: the same default the pipeline
  // already applies, so the existing one-click path is unchanged.
  const [kind, setKind] = useState<VariantKind>('malicious');

  // Memoized because the console polls on an effect keyed by the port: a fresh
  // object every render would tear the interval down and rebuild it every time.
  const port = useMemo(
    () => livePort ?? (liveActions ? createConnectLiveRunPort(liveActions) : notWiredLiveRunPort),
    [livePort, liveActions],
  );

  const live = mode === 'live';
  const sampleHref = `/runs/${sampleRunIds?.[category] ?? CANONICAL_SAMPLE}`;
  const previewGoal = categoryGoals?.[category];
  const hasRun = activeRunId !== null && activeRunId !== settledRunId;

  return (
    <div className="type-flow mx-auto max-w-[1440px] px-6 py-10">
      <p className="micro-label mb-2.5 tracking-[0.18em] text-nominal">CONNECT / RUN</p>
      <h1 className="reading-h2 mb-2.5">Set up a red-team run.</h1>
      <p className="reading-lead mb-4 max-w-[68ch]">
        Watch a recorded sample, or run live: you point your own MCP agent at an endpoint we host,
        and we record every tool call it chooses to make. The same fixed, blind detector judges
        either trace.
      </p>
      {/* WHAT COMES BACK, both ways round, before anything is set up. Stated here
          because a console that only ever describes the compromise path teaches the
          reader that a clean run is a non-result. It is the other half of the
          measurement, and it is what the leaderboard is made of. */}
      <p className="reading mb-7 max-w-[68ch] text-ink-muted">
        The verdict comes back one of two ways: a compromise anchored to the step it happened at,
        which becomes a fix report, or a clean run, which becomes a robustness result. We measure
        which one you get. We do not predict it.
      </p>

      {/* 01 · Mode */}
      <Section labelledBy="connect-mode-head">
        <SectionHead id="connect-mode-head" n="01" label="MODE" />
        <div className="flex max-w-[560px] flex-wrap gap-2.5" role="group" aria-label="Run mode">
          {MODES.map(([m, label]) => {
            const active = mode === m;
            return (
              <button
                key={m}
                type="button"
                aria-pressed={active}
                onClick={() => setMode(m)}
                className={cn(
                  'min-h-11 flex-1 rounded-md border px-4 py-2.5 font-mono text-[13px] tracking-[0.08em] transition-colors',
                  active
                    ? 'border-nominal bg-nominal/10 text-readout shadow-glow-nominal'
                    : 'border-line bg-transparent text-ink-muted hover:border-line-em hover:text-ink',
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
        <p className="reading mt-3 text-ink-muted">
          Sample playback needs no sign-in and no key. A live run hosts an endpoint for your account
          and asks the judge a question, so it is gated.
        </p>
      </Section>

      {/* 02 · Category */}
      <Section labelledBy="connect-category-head">
        <SectionHead
          id="connect-category-head"
          n="02"
          label="ATTACK CATEGORY · OWASP AGENTIC TOP-10"
        />
        <p className="reading mb-4 max-w-[68ch]">
          One run serves one attack surface, because the surface is the attack. Pick the one you
          want to test.
        </p>
        <div
          className="grid gap-2.5 md:grid-cols-2"
          role="radiogroup"
          aria-label="Attack category (OWASP Agentic Top 10)"
        >
          {CORE7.map((c) => (
            <Choice
              key={c.id}
              code={c.id}
              label={c.title}
              checked={category === c.id}
              onSelect={() => setCategory(c.id)}
            />
          ))}
        </div>

        {/* THE TASK PREVIEW. The category decides what the agent is asked to do,
            so the task is shown where the category is chosen and follows every
            change of the picker. It always describes the SELECTION, never the
            issued run: a run keeps the goal the server gave it, printed with its
            copy control in the last step, and this lines up the next one. There
            is no copy control here on purpose. Nothing can use the goal until a
            run exists, and one place to copy it from is one place to trust. */}
        {previewGoal !== undefined && (
          <div
            role="group"
            aria-labelledby="connect-task-preview"
            className="mt-4 rounded-lg border border-line bg-panel/60 px-4 py-3.5"
          >
            <p id="connect-task-preview" className="micro-label mb-2">
              TASK PREVIEW
            </p>
            <p className="reading max-w-[68ch]" aria-live="polite">
              {previewGoal}
            </p>
            <p className="reading mt-2 max-w-[68ch] text-ink-muted">
              {!live
                ? 'A live run of this category gives your agent this task.'
                : hasRun
                  ? 'Lined up for your next run. The run you issued keeps its own task, shown in the last step.'
                  : 'Issue a run to get your endpoint and token.'}
            </p>
          </div>
        )}

        {/* THE CONTROL RUN. Live only, because every recorded sample IS an attack
            run: offering a control the sample library cannot play would be a
            choice that does not exist. It sits inside this section rather than
            becoming a numbered step of its own, so the setup still reads as the
            short sequence it is: how you are running, what we serve, then the
            run. */}
        {live && (
          <div className="mt-7 border-t border-line/60 pt-6">
            {/* The label is VISIBLE and it is also the group's accessible name.
                An `aria-label` here would have been a second string saying the
                same thing, free to drift from the one on screen, and a screen
                reader user sitting beside a sighted one would hear a different
                word. The seven-item group above keeps its `aria-label` because
                it has no visible label to point at. */}
            <p id="connect-run-type" className="micro-label mb-3">
              RUN TYPE
            </p>
            <div
              className="grid gap-2.5 md:grid-cols-2"
              role="radiogroup"
              aria-labelledby="connect-run-type"
            >
              {RUN_TYPES.map((option) => (
                <Choice
                  key={option.kind}
                  code={option.label}
                  label={option.gloss}
                  checked={kind === option.kind}
                  onSelect={() => setKind(option.kind)}
                />
              ))}
            </div>
            <p className="reading mt-4 max-w-[68ch]">
              Both runs serve the same tools, with the same capability. The control run is not a
              safer sandbox and not a weaker attack: it is the same surface with no attack staged on
              it.
            </p>
            <p className="reading mt-2 max-w-[68ch]">
              Run the control to see how your agent behaves there when nothing is trying to hijack
              it, which is the only way to tell an agent that refuses everything apart from one
              using judgment.
            </p>
            <p className="reading mt-2 max-w-[68ch] text-ink-muted">
              In our own docs and in the measured results these two are the malicious realization
              and the benign control.
            </p>
          </div>
        )}
      </Section>

      {/* Detector — a stated fact, never a control, and never a numbered step */}
      <Section labelledBy="connect-detector-head">
        <SectionHead id="connect-detector-head" label="DETECTOR" />
        <div className="grid gap-5 md:grid-cols-2">
          <div className="flex items-center gap-2.5 rounded-md border border-line-em bg-nominal/5 px-3.5 py-3">
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              aria-hidden="true"
              className="shrink-0 text-nominal"
            >
              <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
              <circle cx="8" cy="8" r="2" fill="currentColor" />
            </svg>
            <span className="font-mono text-[13px] tracking-[0.08em] text-nominal">BLIND</span>
            <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[13px] tracking-[0.06em] text-ink-faint">
              <LockIcon />
              LOCKED
            </span>
          </div>
          <p className="reading">
            One fixed, validated judge, never user-swappable. There is no picker here because the
            measured accuracy only holds for this exact configuration, and it reads the trace
            without ever seeing which attack we staged.
          </p>
        </div>
      </Section>

      {/* 03 · The run itself */}
      <section aria-labelledby="connect-run-head" className="border-t border-line pt-5">
        <SectionHead
          id="connect-run-head"
          n="03"
          label={live ? 'YOUR RUN ENDPOINT' : 'RECORDED PLAYBACK'}
        />
        {live ? (
          <LiveRunConsole
            port={port}
            category={category}
            kind={kind}
            signedIn={signedIn}
            reattachRunId={activeRunId ?? undefined}
            onRunChange={onRunChange}
            onRunOver={forgetRun}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <p className="reading max-w-[68ch]">
              The sample is a constructed run judged by the real frozen detector. It shows what a
              finding looks like; it is not a capture of a live agent, and it never claims to be.
            </p>
            {sampleProvenance && <p className="instrument-faint">{sampleProvenance}</p>}
            <div className="flex flex-wrap items-center gap-4">
              <Link
                href={sampleHref}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-nominal bg-nominal/10 px-5 py-3 font-mono text-[14px] leading-6 tracking-[0.08em] text-readout shadow-glow-nominal transition-colors hover:bg-nominal/20"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                  <polygon points="2,1 11,6 2,11" fill="currentColor" />
                </svg>
                PLAY SAMPLE RUN
              </Link>
              <span className="instrument">streams into Live Attack Replay</span>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
