# Supabase — database + migrations

The database schema lives in [`migrations/`](migrations/) and is the **single
source of truth**. On a clean clone, the whole schema is reproducible from these
files via the Supabase CLI — never hand-edited in the dashboard.

## One-time setup

1. **Install the Supabase CLI** (it is intentionally not an npm dependency, so CI
   stays lean): `scoop install supabase` / `brew install supabase/tap/supabase`
   / `npm i -g supabase` — see https://supabase.com/docs/guides/cli.
2. **Log in** (opens a browser): `supabase login`
3. **Link this repo to the project**: `npm run db:link`
   (runs `supabase link --project-ref ovsznqyynlxhrdnfywjx`; it prompts for the
   database password — the one in your `.env.local` `DATABASE_URL`).

## Everyday commands

| Command                 | What it does                                                            |
| ----------------------- | ----------------------------------------------------------------------- |
| `npm run db:push`       | Apply every unapplied migration in `migrations/` to the linked project. |
| `npm run db:new <name>` | Scaffold a new timestamped migration file.                              |
| `npm run db:diff`       | Diff the linked DB against the local migrations.                        |

## Applying the current schema

```bash
npm run db:link      # once
npm run db:push      # applies every migration the project has not recorded yet
```

**Verify, do not assume.** `npm run verify:durable-stores` drives the real
adapters against the linked project and reports, per table, whether the
service-role client can actually read it and whether `anon` is actually shut out.
Run it after any `db:push`. It exists because a missing table is easy to mistake
for an empty one: a `head: true` count request against a table PostgREST cannot
see comes back **status 204 with `error: null` and `count: null`**, while the
same query as an ordinary `select` returns **404 `PGRST205`**. The first shape
looks exactly like an empty table.

| Migration                          | What it adds                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0001_runs.sql`                    | `public.runs` — a user's finished live runs, owner-scoped by RLS. The app only ever READS it with a user's session; every insert is made server-side with the service role (`src/runs/run-writes.ts`). Its insert and delete policies and its open grants are removed by `0004`.                                                                                                                                                       |
| `0002_run_tokens.sql`              | `public.run_tokens` — the per-run, per-account connection credential (ADR-0006). Stores a SHA-256 digest, never a token. RLS on with **zero policies**: server-side only.                                                                                                                                                                                                                                                              |
| `0003_durable_stores.sql`          | `public.live_runs` + `public.live_run_events` (the open-run registry and its observable steps) and `public.otp_rate_limit_hits` (the sign-up rate-limit counters). Same posture as 0002: RLS on with zero policies **and** an explicit revoke from `anon` and `authenticated`.                                                                                                                                                         |
| `0004_runs_server_only_writes.sql` | Adds no table. Closes `public.runs` to everything but the service role: drops the owner insert and delete policies, scopes the owner select policy to `authenticated` on `(select auth.uid())`, revokes every grant from `anon` and every grant but SELECT from `authenticated`, revokes the browser roles from the rate-limit sequence, and indexes `run_tokens(user_id)`. **Apply only after the S1a code is deployed** (see below). |

All four are idempotent (they use `if not exists` / `drop policy if exists`), so they
are safe whether first applied by hand in the SQL Editor or by `db push` — the CLI
records applied versions in `supabase_migrations.schema_migrations` and skips ones
already run.

**Apply `0004_runs_server_only_writes.sql` only after the S1a code is deployed**
(the release in which every write to `public.runs` goes through
`src/runs/run-writes.ts` on the service role). Before that release the app
inserted a finished run through the signed-in user's own session, and with the
insert policy and grant gone every live run would fail to save. After it,
`public.runs` is server-written only: a signed-in user can read their own rows
and nothing else, and `anon` cannot touch the table at all.

`0002_run_tokens.sql` has **no application caller yet**: it is the store
`src/runs/run-token.ts` lands on, and the MCP server that will issue and verify
against it is unbuilt (plan.md B2). Applying it early is harmless (an empty,
closed table); leaving it unapplied until the server lands is equally fine.

## Testing the policies against a local stack

`tests/integration/rls/` asks the database directly, as a signed-in owner, a
signed-in stranger and an anonymous visitor, to insert, update and delete, and
drives the app's own write paths over real Postgres. It also reads the catalog
(the policy on `public.runs`, each role's table privileges including TRUNCATE,
the sequence grants, the `run_tokens(user_id)` index) with `psql` inside the
local stack's database container, which is why `docker` has to be on the PATH.
It needs Docker and the local stack, and is skipped without `RLS_LOCAL_STACK=1`. It refuses to run
against any URL that is not loopback, so it cannot be pointed at the real
project by accident. From the repo root, in bash:

```bash
npx --yes supabase@2.120.0 start -x studio,imgproxy,storage-api,edge-runtime,logflare,vector,realtime
eval "$(npx --yes supabase@2.120.0 status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')" \
  && RLS_LOCAL_STACK=1 NEXT_PUBLIC_SUPABASE_URL="$API_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" \
     SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" npx vitest run tests/integration/rls
npx --yes supabase@2.120.0 stop
```

`supabase start` and `supabase db reset` only ever touch the local database.
Never run `supabase link` or `db push` as part of this.

## Conventions

- **Never edit schema in the dashboard.** Add a migration (`npm run db:new`),
  commit it, and `db push`.
- Migrations are **forward-only** and should be **idempotent** where practical.
- Secrets (`.env.local`, `.env.keys`) are gitignored; `config.toml` is committed.
