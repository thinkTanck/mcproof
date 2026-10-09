/**
 * `npm run verify:durable-stores` — drive the durable live-run stores against the
 * REAL Supabase project.
 *
 * WHY THIS EXISTS AS A SCRIPT AND NOT A TEST. The unit suite proves the adapters
 * against a fake, and `tests/integration/durable-store-restart.integration.test.ts`
 * proves the restart story against a fake database. Neither of them touches
 * Postgres, so neither can tell you that the migration was applied, that the
 * service-role client can actually read the tables, that the check constraints
 * accept the rows we write, or that the foreign keys line up. Those are the
 * things that break a deployment, and they are only answerable against the real
 * project. This drives the same code paths the app runs, against it.
 *
 * WHAT IT PROVES, in the order it prints:
 *
 *   0. GRANTS      — whether each table genuinely answers the service-role client,
 *                    and whether it genuinely refuses the anon client. Reported as
 *                    the raw count, status and error code, because a failing read
 *                    that returns an empty result is exactly the failure this
 *                    section exists to make impossible to miss.
 *   a. TOKENS      — a real token is issued, PERSISTS AS A DIGEST (the plaintext
 *                    is asserted absent from the row), verifies once, and is
 *                    refused after `endRun` and after its wall clock passes.
 *   b. TWO INSTANCES — a run started through one host is served by a SECOND,
 *                    independently constructed host, and the trace that comes out
 *                    carries the steps recorded either side of the change.
 *   c. THE REAPER  — a real abandoned row is found and closed, and a second pass
 *                    over the same registry finds nothing.
 *
 * WHAT IS STUBBED, AND WHY THAT IS HONEST. The gate and the judge are stubbed:
 * `preflight` grants, and the detector is a local function. Neither is what this
 * script verifies, and asking the real judge would spend operator money and one
 * of an account's lifetime free runs to learn nothing about a database. The
 * TOKEN STORE and the OPEN-RUN REGISTRY are NOT stubbed: they come from
 * `liveRunDeps()`, so this exercises the exact wiring `src/app/api/mcp/host.ts`
 * hands the pipeline in production. The abandoned run in (c) records no tool call
 * on purpose, so the reaper takes its `abandon()` path and spends nothing.
 *
 * CREDENTIALS. Read from the environment (`.env.local` is loaded automatically):
 * `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
 * `SUPABASE_SERVICE_ROLE_KEY`. They are PRESENCE-CHECKED and never printed. With
 * any of them missing the script exits non-zero rather than reporting a pass it
 * never measured.
 *
 * IT CLEANS UP AFTER ITSELF. Every row it writes hangs off one throwaway auth
 * user, and deleting that user cascades the token rows, the run rows and their
 * event rows. The cleanup runs even when an assertion fails.
 */
import { createHash } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Trace, Verdict } from '@/contract';
import { InMemoryRunRepository } from '@/data/run-repository';
import type { LiveDetector } from '@/detector/resolve';
import { SESSION_HEADER } from '@/harness/server/http';
import { liveRunDeps } from '@/app/api/mcp/host';
import { createLiveRunHost, type LiveRunHost } from '@/runs/live-run';
import { getLiveRunSessionStore, getRunTokenStore } from '@/runs/live-run-stores.factory';
import { issueRunToken, parseRunToken, verifyRunToken } from '@/runs/run-token';
import { reapAbandonedRuns } from '@/runs/reaper';

loadEnvConfig(process.cwd());

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** The five tables the durable stores and the auth path depend on. */
const TABLES = ['runs', 'run_tokens', 'live_runs', 'live_run_events', 'otp_rate_limit_hits'];

const ORIGIN = 'https://verify.invalid';

let failures = 0;

function check(label: string, passed: boolean, detail = ''): void {
  if (!passed) failures += 1;
  const mark = passed ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${label}${detail ? ` -- ${detail}` : ''}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
}

/** A judge stand-in. It never reaches the network and never sees ground truth. */
const stubDetector: LiveDetector = async (trace: Trace): Promise<Verdict> => ({
  runId: trace.runId,
  compromised: false,
  score: 0,
  severity: 'None',
  category: trace.category,
  rationale: 'Stubbed judge. This script verifies the stores, not the detector.',
});

/**
 * One instance of the app, as far as the live-run pipeline is concerned: the
 * REAL stores `host.ts` wires, with the gate and the judge stubbed. Calling it
 * twice is the serverless instance change, because nothing is carried across
 * except what was written to Postgres.
 */
function instance(repository: InMemoryRunRepository): LiveRunHost {
  const deps = liveRunDeps();
  return createLiveRunHost({
    ...deps,
    preflight: async () => ({ allowed: true }),
    resolveDetector: () => stubDetector,
    repository,
    origin: ORIGIN,
    sleep: async () => {},
  });
}

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', clientInfo: { name: 'verify-script', version: '1' } },
};

function post(
  host: LiveRunHost,
  endpoint: string,
  payload: unknown,
  opts: { token?: string; sessionId?: string } = {},
): Promise<Response> {
  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  });
  if (opts.token !== undefined) headers.set('authorization', `Bearer ${opts.token}`);
  if (opts.sessionId !== undefined) headers.set(SESSION_HEADER, opts.sessionId);
  return host.handle(
    new Request(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) }),
  );
}

/** Open a session and call one tool, exactly as a real MCP client would. */
async function callTool(
  host: LiveRunHost,
  ticket: { endpoint: string; token: string },
  name: string,
  args: Record<string, unknown>,
): Promise<void> {
  const opened = await post(host, ticket.endpoint, initialize, { token: ticket.token });
  const sessionId = opened.headers.get(SESSION_HEADER);
  const common = { token: ticket.token, ...(sessionId === null ? {} : { sessionId }) };
  await post(
    host,
    ticket.endpoint,
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    common,
  );
  await post(
    host,
    ticket.endpoint,
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } },
    common,
  );
}

/**
 * SECTION 0 — is each table actually readable by the service role, and actually
 * closed to the browser role?
 *
 * It reports `count`, `status` and the PostgREST error code side by side because
 * a `null` count on its own is ambiguous: it is what you get from a refused read
 * AND what you can get from a response with no range header. Printing the error
 * next to it is the difference between "empty" and "we were not allowed to look".
 */
async function verifyGrants(admin: SupabaseClient, anon: SupabaseClient): Promise<void> {
  section('0. GRANTS -- can the service role read these tables at all?');

  for (const table of TABLES) {
    const head = await admin.from(table).select('*', { count: 'exact', head: true });
    const rows = await admin.from(table).select('*').limit(1);
    const readable = head.error === null && rows.error === null;
    console.log(
      `  ${table.padEnd(20)} head: count=${String(head.count)} status=${head.status} ` +
        `err=${head.error?.code ?? 'none'} | select: rows=${rows.data?.length ?? 'null'} ` +
        `err=${rows.error?.code ?? 'none'}`,
    );
    check(`service role can read public.${table}`, readable, head.error?.message ?? '');
  }

  console.log('');
  for (const table of TABLES) {
    const probe = await anon.from(table).select('*').limit(1);
    // `runs` is the one table with owner policies, so an anonymous read is
    // ALLOWED to succeed and simply return nothing. The other four have RLS on
    // with zero policies AND a revoke, so anon must see nothing either way.
    const closed = probe.error !== null || (probe.data ?? []).length === 0;
    check(
      `anon reaches nothing in public.${table}`,
      closed,
      `err=${probe.error?.code ?? 'none'} rows=${probe.data?.length ?? 'null'}`,
    );
  }
}

/** SECTION a — the per-run token, end to end, against the real table. */
async function verifyTokens(admin: SupabaseClient, userId: string): Promise<void> {
  section('a. TOKENS -- issued, stored as a digest, verified once, then refused');

  const store = getRunTokenStore();
  const runId = `verify-token-${Date.now()}`;
  const { token, record } = issueRunToken({ runId, userId, ttlMs: 60 * 60_000 });
  await store.save(record);

  const row = await admin.from('run_tokens').select('*').eq('selector', record.selector).single();
  check('the row is there', row.error === null, row.error?.message ?? '');

  const serialized = JSON.stringify(row.data ?? {});
  const parsed = parseRunToken(token);
  check('the PLAINTEXT token is NOT in the row', !serialized.includes(token));
  check(
    'the VERIFIER half is NOT in the row',
    parsed !== null && !serialized.includes(parsed.verifier),
  );
  check(
    'what is stored is sha256(verifier)',
    parsed !== null &&
      createHash('sha256').update(parsed.verifier).digest('hex') ===
        (row.data as { verifier_hash?: string } | null)?.verifier_hash,
  );

  const accepted = await verifyRunToken({
    store: getRunTokenStore(),
    presented: token,
    runId,
    userId,
  });
  check('a correct token verifies', accepted.valid);

  const forged = await verifyRunToken({
    store: getRunTokenStore(),
    presented: `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`,
    runId,
    userId,
  });
  check(
    'a forged verifier is refused as UNKNOWN',
    !forged.valid && forged.error.code === 'UNKNOWN',
    forged.valid ? 'accepted' : forged.error.code,
  );

  await getRunTokenStore().endRun(runId, new Date());
  const afterEnd = await verifyRunToken({
    store: getRunTokenStore(),
    presented: token,
    runId,
    userId,
  });
  check(
    'the same token is refused once the run ended',
    !afterEnd.valid && afterEnd.error.code === 'RUN_ENDED',
    afterEnd.valid ? 'still accepted' : afterEnd.error.code,
  );

  // A genuinely past wall clock, written as a real row: issued two hours ago
  // with a one hour lifetime, then checked against the actual current time. No
  // injected clock and no sleeping.
  const staleRunId = `verify-token-stale-${Date.now()}`;
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000);
  const stale = issueRunToken({
    runId: staleRunId,
    userId,
    now: twoHoursAgo,
    ttlMs: 60 * 60_000,
  });
  await getRunTokenStore().save(stale.record);
  const afterExpiry = await verifyRunToken({
    store: getRunTokenStore(),
    presented: stale.token,
    runId: staleRunId,
    userId,
  });
  check(
    'a token past its wall clock is refused as EXPIRED',
    !afterExpiry.valid && afterExpiry.error.code === 'EXPIRED',
    afterExpiry.valid ? 'still accepted' : afterExpiry.error.code,
  );
}

/** SECTION b — the serverless case: two independently constructed hosts, one run. */
async function verifyTwoInstances(admin: SupabaseClient, userId: string): Promise<string | null> {
  section('b. TWO INSTANCES -- one run, served either side of an instance change');

  const repository = new InMemoryRunRepository();
  const first = instance(repository);
  const started = await first.start({ userId, category: 'ASI01', kind: 'malicious' });
  if (!started.ok) {
    check('the first instance started a run', false, started.error.code);
    return null;
  }
  const ticket = started.value;
  check('the first instance started a run', true, `runId=${ticket.runId}`);
  await callTool(first, ticket, 'read_email', { mailbox: 'inbox' });

  // ---- the instance goes away here. Nothing below shares state with it. ----
  const second = instance(repository);
  await callTool(second, ticket, 'transfer_funds', {
    to: 'DE00-VERIFY-0001',
    amount: 1,
    currency: 'EUR',
  });

  const trace = await second.getTrace({ runId: ticket.runId, userId });
  if (!trace.ok) {
    check('the second instance resolved the run', false, trace.error.code);
    return ticket.runId;
  }
  check('the second instance resolved the run', true);

  const tools = trace.value.steps
    .filter((s) => s.type === 'tool_call')
    .map((s) => (s.type === 'tool_call' ? s.tool : ''));
  check(
    'ONE trace carries the steps from BOTH instances',
    tools.join(',') === 'read_email,transfer_funds',
    `tool calls: [${tools.join(', ')}]`,
  );

  const events = await admin
    .from('live_run_events')
    .select('idx')
    .eq('run_id', ticket.runId)
    .order('idx', { ascending: true });
  // `task_complete` is INFERRED by the recorder, not observed, so it is never an
  // event row. Every step that WAS observed has one, and the difference between
  // the two counts is exactly the one inferred step the contract says is inferred.
  const observed = trace.value.steps.filter((s) => s.type !== 'task_complete');
  check(
    'every OBSERVED step is a durable row, not process memory',
    (events.data ?? []).length === observed.length,
    `rows=${events.data?.length ?? 'null'} observed=${observed.length} steps=${trace.value.steps.length}`,
  );

  const other = await second.getTrace({ runId: ticket.runId, userId: 'someone-else' });
  check(
    'another account still cannot resolve it',
    !other.ok && other.error.code === 'RUN_NOT_FOUND',
    other.ok ? 'resolved' : other.error.code,
  );

  return ticket.runId;
}

/** SECTION c — the reaper, over a real abandoned row. */
async function verifyReaper(admin: SupabaseClient, userId: string): Promise<void> {
  section('c. THE REAPER -- a real abandoned row is found, closed, and then gone');

  const repository = new InMemoryRunRepository();
  const host = instance(repository);
  const started = await host.start({ userId, category: 'ASI02', kind: 'malicious' });
  if (!started.ok) {
    check('a run to abandon was started', false, started.error.code);
    return;
  }
  const { runId } = started.value;
  check('a run to abandon was started', true, `runId=${runId}`);

  // Age the row so its whole window has passed. This is what "the user closed
  // the tab an hour ago" looks like from the registry's side. `started_at` moves
  // with it because the table's own check constraint insists a run expires after
  // it starts, which is the constraint doing its job.
  const startedAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
  const past = new Date(Date.now() - 60 * 60_000).toISOString();
  const aged = await admin
    .from('live_runs')
    .update({ started_at: startedAt, expires_at: past })
    .eq('run_id', runId);
  check('the row was aged past its window', aged.error === null, aged.error?.message ?? '');

  const sessions = getLiveRunSessionStore();
  const stale = await sessions.findStale(new Date());
  check(
    'findStale sees the abandoned run',
    stale.some((r) => r.runId === runId),
    `stale=[${stale.map((r) => r.runId).join(', ')}]`,
  );

  const firstPass = await reapAbandonedRuns({ sessions: getLiveRunSessionStore(), host });
  console.log(`  pass 1 report: ${JSON.stringify(firstPass)}`);
  check('the pass examined it', firstPass.examined >= 1);
  check(
    'it was CLOSED without a judge call, because it recorded no tool call',
    firstPass.closed >= 1 && firstPass.judged === 0,
  );
  check('nothing threw, so the sweep ran', firstPass.failed === 0 && firstPass.swept !== null);

  const gone = await admin.from('live_runs').select('run_id').eq('run_id', runId);
  check(
    'the swept row is gone from live_runs',
    (gone.data ?? []).length === 0,
    `rows=${gone.data?.length ?? 'null'}`,
  );

  const secondPass = await reapAbandonedRuns({ sessions: getLiveRunSessionStore(), host });
  console.log(`  pass 2 report: ${JSON.stringify(secondPass)}`);
  check(
    'a second pass finds nothing left to settle',
    secondPass.examined === 0 && secondPass.judged === 0 && secondPass.closed === 0,
  );
}

async function main(): Promise<void> {
  if (!URL_ || !ANON || !SERVICE) {
    console.error(
      'Missing Supabase configuration. This script measures the REAL project, so it ' +
        'refuses to report a result it did not measure.\n' +
        `  NEXT_PUBLIC_SUPABASE_URL      ${URL_ ? 'set' : 'MISSING'}\n` +
        `  NEXT_PUBLIC_SUPABASE_ANON_KEY ${ANON ? 'set' : 'MISSING'}\n` +
        `  SUPABASE_SERVICE_ROLE_KEY     ${SERVICE ? 'set' : 'MISSING'}`,
    );
    process.exit(1);
  }

  const admin = createClient(URL_, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(URL_, ANON, { auth: { persistSession: false } });

  console.log('MCProof -- durable live-run stores, verified against the real project');
  console.log(`project: ${new URL(URL_).host}`);
  console.log(`at:      ${new Date().toISOString()}`);

  await verifyGrants(admin, anon);

  // One throwaway account owns every row this script writes. Deleting it
  // cascades the tokens, the runs and their events.
  const email = `mcproof-verify-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error || !created.data.user) {
    console.error(`\nCould not provision a throwaway account: ${created.error?.message}`);
    process.exit(1);
  }
  const userId = created.data.user.id;
  console.log(`\nthrowaway account provisioned (id withheld from the log)`);

  try {
    await verifyTokens(admin, userId);
    await verifyTwoInstances(admin, userId);
    await verifyReaper(admin, userId);
  } finally {
    section('CLEANUP');
    const deleted = await admin.auth.admin.deleteUser(userId);
    check(
      'the throwaway account and its cascaded rows are gone',
      !deleted.error,
      deleted.error?.message ?? '',
    );
    for (const table of ['run_tokens', 'live_runs']) {
      const left = await admin.from(table).select('*', { count: 'exact', head: true });
      console.log(`  ${table.padEnd(20)} rows remaining: ${String(left.count)}`);
    }
  }

  console.log('');
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED.`);
    process.exit(1);
  }
  console.log('All checks passed.');
}

void main();
