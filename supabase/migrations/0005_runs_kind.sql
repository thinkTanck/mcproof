-- MCProof: a run row says which kind of run it was (LAUNCH POLISH, Part 1)
--
-- WHY. The leaderboard scores attack runs only. A benign control served no
-- attack, so it says nothing about how an agent resists one, and counting it
-- put a control and an attack in one cell (the smoke test on 2026-10-21 read
-- n=2 for one attack and one control). Which kind a run was is known when it
-- starts and is kept on its live_runs record, but that record is swept once the
-- run is over (sweepExpired, src/runs/live-run-store.ts), so it cannot be what
-- the leaderboard reads. This column is: public.runs is never updated or
-- deleted from, and the writer (src/runs/run-writes.ts) fills it from the run's
-- own live_runs record when the row is inserted, never from the caller.
--
-- EXISTING ROWS ARE LEFT AS THEY ARE (owner ruling 2026-10-23). No backfill:
-- the kind of a run saved before this column existed was never recorded, and a
-- guess from its trace would be a label nobody measured. Those rows read null,
-- keep their replays and their place in Your runs ("kind not recorded"), and
-- are scored nowhere. Nothing is deleted.
--
-- GRANTS. Unchanged. 0004 left `authenticated` with SELECT on the table, which
-- covers a new column, and only the service role writes. Idempotent like 0001
-- to 0004.

alter table public.runs
  add column if not exists kind text;

alter table public.runs
  drop constraint if exists runs_kind_check;
alter table public.runs
  add constraint runs_kind_check check (kind is null or kind in ('malicious', 'benign'));
