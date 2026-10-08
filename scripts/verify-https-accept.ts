/**
 * The per-run token, exercised over REAL HTTPS against the DEPLOYED endpoint.
 *
 * Every earlier exercise of this path ran in-memory inside one process, so the
 * token never crossed a network and the host was never a different machine.
 * Here the token is issued into the SHARED durable store and then presented over
 * TLS to production, which has only ever seen it through Postgres. That is the
 * point: this is the first test that could fail because of the wire.
 *
 * IT CLEANS UP AFTER ITSELF. Every row hangs off one throwaway auth account, and
 * deleting that account cascades the token, the run and its events.
 *
 *   npx tsx --env-file=.env.local scripts/verify-https-accept.ts
 */
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { InMemoryRunRepository } from '@/data/run-repository';
import { liveRunDeps } from '@/app/api/mcp/host';
import { createLiveRunHost } from '@/runs/live-run';
import { getLiveRunSessionStore } from '@/runs/live-run-stores.factory';
import { reapAbandonedRuns } from '@/runs/reaper';

const BASE = process.env.VERIFY_BASE_URL ?? 'https://mcproof.dev';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let pass = 0;
let fail = 0;

function check(ok: boolean, label: string, detail = ''): void {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ' -- ' + detail : ''}`);
  if (ok) pass += 1;
  else fail += 1;
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/** Stubbed judge. This script verifies the wire and the stores, never the detector. */
async function stubDetector(trace: { runId: string; category: string }) {
  return {
    runId: trace.runId,
    compromised: false,
    score: 0,
    severity: 'None' as const,
    category: trace.category as never,
    rationale: 'Stubbed judge. This script verifies the HTTPS token path, not the detector.',
  };
}

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'https-verify', version: '1' },
  },
};

async function rpc(
  runId: string,
  token: string | undefined,
  body: unknown,
  sessionId?: string,
): Promise<{ status: number; text: string; session: string | null }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (sessionId) headers['mcp-session-id'] = sessionId;

  const res = await fetch(`${BASE}/api/mcp/${runId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, text: await res.text(), session: res.headers.get('mcp-session-id') };
}

function newHost() {
  return createLiveRunHost({
    ...liveRunDeps(),
    preflight: async () => ({ allowed: true }),
    resolveDetector: () => stubDetector,
    repository: new InMemoryRunRepository(),
    origin: BASE,
    sleep: async () => {},
  });
}

async function main(): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error(
      'Missing Supabase configuration. This script measures the REAL project, so it ' +
        'refuses to report a result it did not measure.\n' +
        `  NEXT_PUBLIC_SUPABASE_URL  ${SUPABASE_URL ? 'set' : 'MISSING'}\n` +
        `  SUPABASE_SERVICE_ROLE_KEY ${SERVICE_KEY ? 'set' : 'MISSING'}`,
    );
    process.exit(1);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log('MCProof -- the per-run token over real HTTPS, against the deployed endpoint');
  console.log(`endpoint: ${BASE}`);
  console.log(`project:  ${new URL(SUPABASE_URL).host}`);
  console.log(`at:       ${new Date().toISOString()}`);

  const email = `mcproof-https-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error || !created.data.user) {
    console.error(`\nCould not provision a throwaway account: ${created.error?.message}`);
    process.exit(1);
  }
  const userId = created.data.user.id;
  console.log('\nthrowaway account provisioned (id withheld from the log)');

  try {
    const host = newHost();

    section('ISSUE -- a real token, written only to Postgres');
    const started = await host.start({ userId, category: 'ASI01', kind: 'malicious' });
    if (!('value' in started) || !started.value) {
      console.error(`  could not start a run: ${JSON.stringify(started)}`);
      process.exit(1);
    }
    const { runId, token, endpoint } = started.value;
    check(endpoint.startsWith(BASE), 'the issued endpoint points at the deployed host', endpoint);

    const row = await admin.from('run_tokens').select('*').eq('run_id', runId).single();
    check(!!row.data, 'the token row is in the shared store');
    check(!JSON.stringify(row.data ?? {}).includes(token), 'the PLAINTEXT token is NOT in the row');

    section('ACCEPT -- production has only ever seen this token via Postgres');
    const good = await rpc(runId, token, INITIALIZE);
    check(
      good.status === 200,
      'production ACCEPTS the real token over HTTPS',
      `HTTP ${good.status}`,
    );
    check(!!good.session, 'it returns an Mcp-Session-Id', good.session ?? 'none');
    const sid = good.session ?? undefined;

    section('REJECT -- every refusal is the same refusal');
    const forged = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
    const bodies = new Set<string>();
    const refusals: ReadonlyArray<readonly [string, string, string | undefined]> = [
      ['a forged verifier', runId, forged],
      ['a valid token for ANOTHER run', randomUUID(), token],
      ['no token at all', runId, undefined],
    ];
    for (const [label, id, tok] of refusals) {
      const r = await rpc(id, tok, INITIALIZE);
      bodies.add(r.text);
      check(r.status === 401, `${label} is REFUSED`, `HTTP ${r.status}`);
    }
    check(
      bodies.size === 1,
      'all three refusals are byte-identical',
      `distinct bodies=${bodies.size}`,
    );

    section('SERVE + RECORD -- the trace is written by production, not by us');
    const listed = await rpc(
      runId,
      token,
      { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      sid,
    );
    const names = [...listed.text.matchAll(/"name":"([a-zA-Z_]+)"/g)].map((m) => m[1] as string);
    check(
      listed.status === 200 && names.length > 0,
      'tools/list returns the served surface',
      names.slice(0, 6).join(', '),
    );

    const tool = names.find((n) => n.startsWith('read')) ?? (names[0] as string);
    const called = await rpc(
      runId,
      token,
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: tool, arguments: {} } },
      sid,
    );
    check(
      called.status === 200,
      `tools/call (${tool}) is served over HTTPS`,
      `HTTP ${called.status}`,
    );

    await new Promise((resolve) => setTimeout(resolve, 2500));
    const events = await admin.from('live_run_events').select('*').eq('run_id', runId).order('idx');
    const steps = (events.data ?? []).map(
      (e) => (e as { event: { type: string; tool?: string } }).event,
    );
    const calls = steps.filter((s) => s?.type === 'tool_call').map((s) => s.tool);
    check(
      steps.length > 0,
      'production RECORDED the trace into live_run_events',
      `rows=${steps.length}`,
    );
    check(
      steps[0]?.type === 'principal_instruction',
      'the first recorded step is principal_instruction',
      steps[0]?.type ?? 'none',
    );
    check(
      calls.includes(tool),
      'the recorded trace holds the call made over the wire',
      `[${calls.join(', ')}]`,
    );
    check(!steps.some((s) => s?.type === 'agent_reasoning'), 'no agent_reasoning was synthesized');

    section('REAPER -- a real abandoned row, closed');
    // The table enforces expires_at > started_at, so an abandoned run is aged by
    // moving BOTH ends back, not by dragging the expiry behind its own start.
    const startedAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
    const past = new Date(Date.now() - 60 * 60_000).toISOString();
    const aged = await admin
      .from('live_runs')
      .update({ started_at: startedAt, expires_at: past })
      .eq('run_id', runId)
      .select('run_id, expires_at, finished_at');
    check(
      (aged.data ?? []).length === 1,
      'the row was aged past its window',
      aged.error?.message ?? JSON.stringify(aged.data?.[0] ?? {}),
    );

    const stale = await getLiveRunSessionStore().findStale(new Date());
    check(
      stale.some((s) => s.runId === runId),
      'findStale sees the abandoned run',
      `stale=${stale.length}`,
    );

    const reaped = await reapAbandonedRuns({ sessions: getLiveRunSessionStore(), host: newHost() });
    console.log(`  pass 1 report: ${JSON.stringify(reaped)}`);
    check(reaped.examined >= 1, 'the reaper examined the abandoned run');

    const after = await admin.from('live_runs').select('run_id').eq('run_id', runId);
    check((after.data ?? []).length === 0, 'the swept row is gone from live_runs');

    const refusedNow = await rpc(runId, token, INITIALIZE);
    check(
      refusedNow.status === 401,
      'production REFUSES the token once the run is gone',
      `HTTP ${refusedNow.status}`,
    );
  } finally {
    section('CLEANUP');
    const deleted = await admin.auth.admin.deleteUser(userId);
    check(
      !deleted.error,
      'the throwaway account and its cascaded rows are gone',
      deleted.error?.message ?? '',
    );
    for (const table of ['run_tokens', 'live_runs', 'live_run_events']) {
      const { count } = await admin.from(table).select('*', { count: 'exact', head: true });
      console.log(`  ${table.padEnd(18)} rows remaining: ${count}`);
    }
  }

  console.log(
    `\n${fail === 0 ? `All ${pass} checks passed.` : `${fail} of ${pass + fail} CHECK(S) FAILED`}`,
  );
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  const e = error as { stack?: string; message?: string };
  console.error('ERROR', e?.stack ?? e?.message ?? String(error));
  process.exit(1);
});
