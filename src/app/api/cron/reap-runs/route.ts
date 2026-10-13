/**
 * THE SCHEDULED TRIGGER for the abandoned-run reaper.
 *
 * There is no scheduler inside this app, so the schedule is declared where the
 * platform reads it (`vercel.json`, `crons`) and it calls this route. See
 * [ADR-0012](../../../../../docs/adr/0012-abandoned-runs-are-completed-not-discarded.md)
 * for why abandoned runs are finished at all, and for exactly what is running
 * versus what still needs an operator to arm it.
 *
 * ── THIS DOOR IS THE WHOLE SECURITY STORY ──
 *
 * The job behind it asks the judge (operator money) and writes results into
 * accounts that are not the caller's, so the route is not something a stranger
 * may run. It is guarded by a shared value the operator configures as
 * `CRON_SECRET`, presented as a bearer credential, compared in constant time.
 *
 * It FAILS CLOSED, and that is the honest state of a fresh deployment: with
 * nothing configured, EVERY caller is refused, including the platform's own
 * scheduler. A cron route that ran for anyone who found the URL would be a
 * public button wired to the spend controls.
 *
 * Nothing about the configured value is logged, echoed, or named in a response.
 * The refusal says the same thing whatever was wrong with the request.
 *
 * ── WHY THE JOB DOES NOT USE THE CALLER'S IDENTITY ──
 *
 * A scheduled request carries no user session, so the cookie-bound Supabase
 * client would read nothing and the per-account allowance would count zero runs
 * for everybody — a gate that silently passes. The job is therefore wired to the
 * SERVICE-ROLE client, and the accounts are read off the run rows themselves.
 * Ownership is still set in code, twice: the host refuses a run that does not
 * belong to the account it was asked about, and the run writer
 * (`src/runs/run-writes.ts`, the one module that inserts into `public.runs`)
 * writes the owner the registry recorded and refuses any other.
 */
import { timingSafeEqual } from 'node:crypto';
import { resolveLiveDetector } from '@/detector/resolve';
import { logger } from '@/lib/logger';
import { createLiveRunHost } from '@/runs/live-run';
import { getLiveRunSessionStore, getRunTokenStore } from '@/runs/live-run-stores.factory';
import { checkLiveRunPreflight } from '@/runs/preflight';
import { reapAbandonedRuns } from '@/runs/reaper';
import { getRunRecordStore } from '@/runs/run-writes';

/** `node:crypto` compares the credential, so this route runs on Node, not the Edge. */
export const runtime = 'nodejs';
/** A maintenance pass answers for the state of the registry right now. */
export const dynamic = 'force-dynamic';

/** The one refusal this route gives, whatever was actually wrong with the request. */
const REFUSAL = 'This endpoint refused the request.';

/** The presented value, straight off the wire and untrusted. */
function presented(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header === null) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/**
 * Constant-time comparison against the configured value.
 *
 * `timingSafeEqual` throws on differing lengths, so the length is checked first
 * and a mismatch refuses. That does leak the configured length to somebody
 * measuring very carefully, which buys them nothing against a value the operator
 * generates at random.
 */
function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET;
  // Unconfigured means unarmed. Nobody gets in, including the scheduler.
  if (expected === undefined || expected.length === 0) return false;
  const actual = presented(request);
  if (actual === null) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** One pass over the registry, wired to the durable stores. */
async function reap(): Promise<Response> {
  const sessions = getLiveRunSessionStore();
  // The run store for a caller with no session: service-role, with the owner
  // of every write taken from the run record and never from this request.
  const repository = getRunRecordStore();
  const host = createLiveRunHost({
    // The SAME gate the interactive path passes, counted against the same rows,
    // just read with a client that has no session to be scoped to.
    preflight: async ({ userId, now }) =>
      checkLiveRunPreflight({ userId, repository, ...(now === undefined ? {} : { now }) }),
    tokens: getRunTokenStore(),
    sessions,
    repository,
    resolveDetector: () => resolveLiveDetector(),
    logger,
  });

  const report = await reapAbandonedRuns({ sessions, host, logger });
  return Response.json(report);
}

/** The platform scheduler calls GET. So does an operator running it by hand. */
export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return new Response(JSON.stringify({ error: REFUSAL }), {
      status: 401,
      headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' },
    });
  }
  return reap();
}
