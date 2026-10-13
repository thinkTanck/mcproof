-- MCProof: public.runs is written by the server only (security lane S1b)
--
-- APPLY THIS ONLY AFTER THE S1a CODE IS DEPLOYED. Before S1a the app inserted a
-- finished run through the signed-in user's own session, under runs_insert_own.
-- Since S1a every write to public.runs goes through src/runs/run-writes.ts on the
-- service role, and a user's session only ever READS. Applied to a project still
-- running the pre-S1a code, this migration would make every live run fail to save.
--
-- WHY THIS MIGRATION EXISTS. The anon key is public and a session token is its
-- owner's to copy, so anybody can talk to the REST API directly as themselves.
-- Whatever the database lets the `authenticated` role do, a user can do, whether
-- or not any screen offers it. 0001 gave an owner three policies on their own
-- rows (select, insert, delete), and the platform's default grants gave `anon`
-- and `authenticated` every table privilege on public.runs. Two of those
-- policies were findings of the 2026-10-13 scan:
--
--   * F1, runs_delete_own: an owner could delete their own rows. The lifetime
--     allowance is a count of those rows, so a delete handed a spent free run
--     back, without limit.
--   * F2, runs_insert_own: an owner could insert a row for themselves. That
--     planted a verdict no judge produced and moved the global spend meter,
--     which also counts these rows.
--
-- WHAT IT LEAVES. public.runs is closed at BOTH layers, the way 0002 and 0003
-- closed their tables, with one difference: a signed-in owner keeps SELECT on
-- their own rows, because the account list, the replay and the fix report read
-- through the user's session. Everything else is the service role's alone.
--
-- Apply with `npm run db:push` (or the SQL editor). Idempotent, like 0001 to
-- 0003: every drop is `if exists`, the index is `if not exists`, and a revoke
-- or grant that is already in effect is a no-op.

-- ── The policies ────────────────────────────────────────────────────────────
--
-- F2 and F1. With RLS on and no INSERT or DELETE policy, neither is possible
-- for any role that does not bypass RLS. There was never an UPDATE policy.
drop policy if exists runs_insert_own on public.runs;
drop policy if exists runs_delete_own on public.runs;

-- F13. The owner's read, recreated with two changes and the same meaning:
--
--   * `to authenticated`. 0001 named no role, so the policy applied to `public`
--     (every role) and was evaluated for anonymous requests as well.
--   * `(select auth.uid())` in place of a bare `auth.uid()`. Wrapped in a
--     scalar subquery the planner evaluates it ONCE per statement as an
--     InitPlan; bare, it is called again for every row the scan considers.
--
-- Between the drop and the create the table has no SELECT policy, so a read in
-- that instant returns no rows. It fails closed.
drop policy if exists runs_select_own on public.runs;
create policy runs_select_own on public.runs
  for select to authenticated using (user_id = (select auth.uid()));

-- ── The grants ──────────────────────────────────────────────────────────────
--
-- A policy is the second lock. The first is the table privilege, and both
-- browser roles held all of them, TRUNCATE included. TRUNCATE is the one that
-- matters most: row-level security does not apply to it at all, so no policy
-- above could ever have stopped it. The REST API offers no way to send one,
-- which is the only thing that stood in front of it.
--
-- An anonymous visitor has no business with this table at all.
revoke all on public.runs from anon;

-- A signed-in user reads, and nothing else. Named one by one so the line says
-- what is being closed: the three writes, TRUNCATE, and the two (REFERENCES,
-- TRIGGER) that let a role attach its own objects to the table.
revoke insert, update, delete, truncate, references, trigger on public.runs from authenticated;
grant select on public.runs to authenticated;

-- The writer. The service role already holds these on a project created the
-- usual way; stated here so the file is complete on its own.
grant all on public.runs to service_role;

-- ── The rate-limit sequence ─────────────────────────────────────────────────
--
-- 0003 revoked every privilege on public.otp_rate_limit_hits from the browser
-- roles, but the bigserial behind its `id` is a separate object with its own
-- grants, and those were left: usage, select and update for both. `revoke all`
-- on a sequence covers all three bits, so it removes select (reading the
-- current value, which is a running count of send attempts) and update
-- (setval, moving the counter) as well as usage (nextval). The service role,
-- which makes every insert into that table, keeps its own grant.
revoke all on sequence public.otp_rate_limit_hits_id_seq from anon, authenticated;

-- ── The index ───────────────────────────────────────────────────────────────
--
-- F17. run_tokens.user_id is a foreign key to auth.users with `on delete
-- cascade`, and had no index, so deleting an account scanned the whole table
-- to find that account's tokens. 0003 gave live_runs the same index for the
-- same column.
create index if not exists run_tokens_user_idx on public.run_tokens (user_id);
