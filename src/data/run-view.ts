import { cache } from 'react';
import type { RunResult } from '@/contract';
import { generateFixReport, type FixReport } from '@/fix-report';
import { getUser } from '@/lib/auth/user';
import { isRowId } from '@/lib/run-id';
import { getDiscardedRunStore } from './discarded-run-store.factory';
import type { StoredDiscardedRun } from './run-repository';
import { getRunRepository } from './run-repository.factory';
import { getDataSource } from './source';

/**
 * WHAT A RUN SCREEN READS THROUGH.
 *
 * `/runs/[id]` and `/findings/[id]` serve two kinds of run, and until now they
 * served only the first:
 *
 *   sample — the no-key demonstration. A builder-constructed trace paired with
 *            the verdict the FROZEN validated judge actually returned for it
 *            (B3). Open to everyone: no sign-in, no database read.
 *   live   — a run the pipeline judged and PERSISTED, read back owner-scoped
 *            through `RunRepository` (RLS enforces the same ownership at the
 *            database). This is the run a user's own agent produced.
 *
 * Sample is tried FIRST, deliberately: it means sample playback never touches
 * auth or Postgres, so the trailer keeps working signed out and offline, exactly
 * as the access model requires.
 *
 * ── PROVENANCE TRAVELS WITH THE VERDICT ──
 *
 * Every view carries the sentence that says where its verdict came from, and the
 * two are resolved together. A sample says it is a constructed demonstration; a
 * live run says it is a live run. Neither label is ever written by a screen: a
 * screen that decides its own provenance is a screen that can be wrong about it.
 *
 * ── ONE FIX-REPORT TYPE ──
 *
 * The report is module 6's `generateFixReport` over whichever `RunResult` was
 * resolved, so both origins go through one generator and one `FixReport` type.
 *
 * ── OBSERVABLE ONLY ──
 *
 * A `RunResult` holds no `GroundTruth` (live runs are unlabeled and the schema is
 * strict), and nothing here adds one. Nothing is synthesized: what is not in the
 * trace does not reach a screen.
 */

/** Where a run on screen came from. */
export type RunOrigin = 'sample' | 'live';

/** A run, with the label its verdict may never travel without. */
export interface RunView {
  readonly run: RunResult;
  readonly origin: RunOrigin;
  readonly provenance: string;
}

/** A fix report, with the same label. */
export interface FixReportView {
  readonly report: FixReport;
  readonly origin: RunOrigin;
  readonly provenance: string;
}

/**
 * How a live verdict is labelled.
 *
 * It names what we can stand behind and nothing more: this run was judged by the
 * operator-locked validated judge, on the date it was recorded. It does NOT
 * quote an accuracy figure (those are measured on labeled fixtures, and a live
 * run is unlabeled) and it does not name a model, because the stored row does not
 * record which one answered.
 */
export const LIVE_VERDICT_PROVENANCE = 'live run · verdict from the locked validated judge';

/** The live label, dated from the stored row. An unparseable date is dropped. */
export function liveVerdictProvenance(createdAt: string): string {
  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) return LIVE_VERDICT_PROVENANCE;
  return `${LIVE_VERDICT_PROVENANCE} · ${at.toISOString().slice(0, 10)}`;
}

/** The sample library: no sign-in, no database. */
async function sampleView(id: string): Promise<RunView | null> {
  const source = getDataSource();
  const [run, provenance] = await Promise.all([source.getRun(id), source.getVerdictProvenance(id)]);
  // A verdict travels with its provenance or not at all. A run the port can serve
  // but cannot label is not shown at all, rather than shown unlabelled.
  if (!run || provenance === null) return null;
  return { run, origin: 'sample', provenance };
}

/** One of the signed-in user's own persisted runs, or nothing. */
async function liveView(id: string): Promise<RunView | null> {
  // An id that is not a uuid cannot be a row, so it is "nothing" without asking.
  // Asked anyway, Postgres rejects the comparison and the adapter throws, which
  // gave a signed-in visitor an error page for a mistyped id where a signed-out
  // one got the not-found page.
  // The middleware already turns such ids away; this is the same check again,
  // for every caller that is not a request through it.
  if (!isRowId(id)) return null;
  const user = await getUser();
  if (!user) return null;
  const repository = await getRunRepository();
  // Scoped by the signed-in user id: another account's run answers `null`, which
  // is the same nothing an unknown id gets. Telling those two apart would say
  // whether a run exists to someone who may not read it.
  const stored = await repository.getRun(user.id, id);
  if (!stored) return null;
  return {
    run: stored.run,
    origin: 'live',
    provenance: liveVerdictProvenance(stored.createdAt),
  };
}

/**
 * The run behind an id: a sample first, then one of your own runs.
 *
 * Cached for the life of one request (React `cache`), because one request asks
 * three times: the shell for its mode chip, the page for its title, and the page
 * for its screen. They get one lookup and, more to the point, one answer.
 */
export const resolveRun = cache(
  async (id: string): Promise<RunView | null> => (await sampleView(id)) ?? (await liveView(id)),
);

/**
 * One of the signed-in user's own DISCARDED runs, or nothing
 * ([ADR-0013](../../docs/adr/0013-a-discarded-run-is-stored-unjudged.md)).
 *
 * A discarded run is deliberately NOT a `RunView`: it has no verdict, so it has
 * no provenance for one, and `resolveRun` answers `null` for it like any id that
 * is not a judged run. That keeps it away from everything built on a `RunView`
 * (the replay, the shell's provenance chip, and `resolveFixReport` below, which
 * therefore never hands one to `generateFixReport`). The two run pages ask this
 * SEPARATELY, only after `resolveRun` found nothing, so they can tell the owner
 * what became of the run instead of saying it does not exist.
 *
 * Owner-scoped exactly like `liveView`: an id that is not a row id, a signed-out
 * visitor and another account's run all answer `null`, the same nothing an id
 * that never existed gets. So for anyone but the owner the page still calls
 * `notFound()`, and the response never says the run is real.
 */
export const resolveDiscardedRun = cache(async (id: string): Promise<StoredDiscardedRun | null> => {
  if (!isRowId(id)) return null;
  const user = await getUser();
  if (!user) return null;
  return (await getDiscardedRunStore()).getDiscardedRun(user.id, id);
});

/** Module 6's report over that run, carrying the same provenance. */
export async function resolveFixReport(id: string): Promise<FixReportView | null> {
  const view = await resolveRun(id);
  if (!view) return null;
  return {
    report: generateFixReport(view.run, { provenance: view.provenance }),
    origin: view.origin,
    provenance: view.provenance,
  };
}
