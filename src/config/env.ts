import { z } from 'zod';

/**
 * Env-only configuration (12-Factor III), split into an offline-safe CORE that
 * is validated fail-fast at load, and DEFERRED adapter creds (Supabase /
 * JudgeModelPort / McpTargetPort) that are validated LAZILY — only when their
 * accessor is invoked (i.e. at adapter construction). The offline app boots with
 * none of the deferred creds set.
 */

type Env = Record<string, string | undefined>;

/**
 * Thrown when environment configuration is invalid or missing. Secret-safe: the
 * message names the offending variables but NEVER echoes their values.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** Build a secret-safe error naming the offending vars — values are never included. */
function toConfigError(error: z.ZodError, context: string): ConfigError {
  const vars = [...new Set(error.issues.map((issue) => String(issue.path[0])))];
  return new ConfigError(`${context}: invalid or missing ${vars.join(', ')}`);
}

// Reusable URL validators. On failure they contribute only the field name to the
// error path — the (possibly secret) value is never surfaced.
const httpUrl = z.string().refine(
  (u) => {
    try {
      const { protocol } = new URL(u);
      return protocol === 'http:' || protocol === 'https:';
    } catch {
      return false;
    }
  },
  { message: 'must be an http(s) URL' },
);

// ── CORE (offline-safe; validated at load) ──
export const CoreEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});
export type CoreConfig = z.infer<typeof CoreEnvSchema>;

/** Validate the offline-safe core immediately (fail-fast). Reads process.env by
 *  default and never touches deferred adapter creds. */
export function loadCoreConfig(env: Env = process.env): CoreConfig {
  const result = CoreEnvSchema.safeParse(env);
  if (!result.success) throw toConfigError(result.error, 'Invalid core environment');
  return result.data;
}

// ── CORE: the canonical public origin (metadata base) ──
//
// Next.js resolves every RELATIVE metadata URL (Open Graph, canonical, images)
// against `metadata.metadataBase`. With no base set it falls back to
// `http://localhost:3000`, so a production page advertises localhost OG and
// canonical URLs. The origin is env-only (12-Factor III) with the canonical
// production host as the default, so a clean clone renders correct absolute URLs
// with zero configuration.

/** The canonical production origin, used when `NEXT_PUBLIC_SITE_URL` is unset. */
export const DEFAULT_SITE_ORIGIN = 'https://mcproof.dev';

// Trimmed, gated as http(s), then collapsed to the bare origin — the same
// normalization the Supabase URL gets, for the same reason: a dashboard/CI paste
// can carry a trailing slash or a path, and either one corrupts every relative
// URL resolved against it.
const SiteUrlSchema = z
  .object({
    NEXT_PUBLIC_SITE_URL: z
      .string()
      .transform((s) => s.trim())
      .pipe(httpUrl)
      .transform((u) => new URL(u).origin),
  })
  .transform((v) => v.NEXT_PUBLIC_SITE_URL);

/**
 * The canonical public origin as an absolute `https://host[:port]` string.
 * Falls back to {@link DEFAULT_SITE_ORIGIN} when `NEXT_PUBLIC_SITE_URL` is unset
 * or blank; a SET-but-invalid value is a real error, not a silent fallback.
 */
export function getSiteOrigin(env: Env = process.env): string {
  if (!env.NEXT_PUBLIC_SITE_URL?.trim()) return DEFAULT_SITE_ORIGIN;
  const result = SiteUrlSchema.safeParse(env);
  if (!result.success) throw toConfigError(result.error, 'Invalid site URL configuration');
  return result.data;
}

// ── CORE: where issued run endpoints live (MCP_ENDPOINT_ORIGIN) ──
//
// The endpoint a run issues is saved in the agent's own MCP config, which an
// agent with file tools can read. A product name in that host tells the agent
// what it is talking to, so the endpoint origin is configurable apart from the
// site origin: point it at a neutral host and nothing the agent can read names
// the product. Unset, it is the site origin.

/** What a run endpoint's origin may be: https, a bare origin, nothing else. */
function asHttpsOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null;
  return url.origin;
}

/**
 * The origin every issued run endpoint is built on. Reads `MCP_ENDPOINT_ORIGIN`;
 * unset or blank means the site origin ({@link getSiteOrigin}). A SET value that
 * is not a bare https origin is NOT a crash on the live-run path: it falls back
 * to the site origin and logs a warning naming the variable (never its value,
 * which may carry credentials), because a run on the site host is better than no
 * run, and the warning is how the operator learns the setting is not in force.
 * The caller passes its logger; this module imports nothing of the app's, because
 * next.config.ts loads it (through the legacy-host redirect) before any alias exists.
 */
export function getMcpEndpointOrigin(
  env: Env = process.env,
  logger?: { warn: (message: string, fields?: Record<string, unknown>) => void },
): string {
  const raw = env.MCP_ENDPOINT_ORIGIN?.trim();
  if (!raw) return getSiteOrigin(env);
  const origin = asHttpsOrigin(raw);
  if (origin !== null) return origin;
  logger?.warn('MCP_ENDPOINT_ORIGIN is not a bare https origin; using the site origin', {
    variable: 'MCP_ENDPOINT_ORIGIN',
  });
  return getSiteOrigin(env);
}

// ── NOTE: there is no persistence driver here, on purpose ──
//
// A `PERSISTENCE_DRIVER` enum and a lazily-validated `DATABASE_URL` accessor used
// to sit at this point in the file, selecting between the two adapters of a
// second run store (`src/persistence/*`). That store was superseded and deleted;
// the only run store is `RunRepository` (`src/data/run-repository.ts`), which
// reaches Supabase Postgres through the Supabase JS client and never opens a
// connection string. The switch was therefore config that named a choice the app
// could no longer make, so it went with the module it configured.
//
// `DATABASE_URL` itself is still listed in `.env.example` as operator config —
// it holds the database password the `supabase link` prompt asks for (see
// `supabase/README.md`) — but nothing in the application reads or validates it,
// and the `.env.example` entry says so.

// ── LAZY: Supabase Auth (gates live runs; OFFLINE-SAFE) ──
//
// Unlike the other deferred creds, absence is a first-class state: with no
// Supabase URL set, auth is INERT (the accessor returns null), so the app boots
// credential-free — sign-in stays in its honest preview and everything runs on
// the in-memory data source. When the URL IS set, the public pair is required and
// validated (a half-configured project is a real error, not silent inertness).
const SupabaseEnvSchema = z
  .object({
    // Trim then canonicalize to the bare origin. A dashboard paste can carry a
    // trailing slash, a path, or surrounding whitespace — none of which fail the
    // URL gate, but any of which corrupts supabase-js's `${url}/auth/v1/...`
    // concatenation into an unreachable host ("fetch failed" in prod). `.origin`
    // collapses all of that to exactly `https://host[:port]`. (It cannot repair a
    // wrong/truncated host — that stays a real, surfaced error.)
    NEXT_PUBLIC_SUPABASE_URL: z
      .string()
      .transform((s) => s.trim())
      .pipe(httpUrl)
      .transform((u) => new URL(u).origin),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z
      .string()
      .transform((s) => s.trim())
      .pipe(z.string().min(1)),
  })
  .transform((v) => ({
    url: v.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: v.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  }));
export type SupabaseConfig = z.infer<typeof SupabaseEnvSchema>;

/**
 * Public Supabase config (url + anon key) usable in browser AND server, or
 * `null` when auth is not configured (offline-safe). Presence is keyed on a
 * non-blank `NEXT_PUBLIC_SUPABASE_URL`; if that is set but the pair is
 * incomplete/invalid, a typed `ConfigError` is thrown (naming the vars, never
 * their values). The URL is normalized to its origin (see the schema).
 */
export function getSupabaseConfig(env: Env = process.env): SupabaseConfig | null {
  if (!env.NEXT_PUBLIC_SUPABASE_URL?.trim()) return null; // unset/blank → auth inert
  const result = SupabaseEnvSchema.safeParse(env);
  if (!result.success) throw toConfigError(result.error, 'Invalid Supabase configuration');
  return result.data;
}

/** True when Supabase Auth is configured. Gate real auth behaviour on this. */
export function isAuthEnabled(env: Env = process.env): boolean {
  return getSupabaseConfig(env) !== null;
}

/**
 * True when GitHub OAuth should be OFFERED (the button is enabled). Kept behind
 * its own flag so the sign-in path doesn't block on the GitHub app creds: the
 * server action always exists, but the button only lights up once GitHub is
 * configured in Supabase and `NEXT_PUBLIC_GITHUB_OAUTH_ENABLED=true` is set.
 * Requires auth to be configured at all.
 */
export function isGithubOAuthEnabled(env: Env = process.env): boolean {
  return isAuthEnabled(env) && env.NEXT_PUBLIC_GITHUB_OAUTH_ENABLED === 'true';
}

/**
 * SERVER-ONLY: the Supabase service-role key (bypasses RLS). `null` when auth is
 * not configured; throws when auth IS configured but the key is missing. NEVER
 * call this from browser/client code — it must never reach the bundle.
 */
export function getSupabaseServiceRoleKey(env: Env = process.env): string | null {
  if (!getSupabaseConfig(env)) return null;
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) {
    throw new ConfigError('Invalid Supabase configuration: missing SUPABASE_SERVICE_ROLE_KEY');
  }
  return key;
}

// ── Email OTP length — ONE source of truth for a number humans also read ──
//
// The Supabase project decides how many digits an emailed sign-in code has, and
// the dashboard permits 6 to 10. Nothing in the app can query that setting at
// runtime, so it is mirrored here as env-only config and EVERYTHING a human
// reads (the placeholder, the "N-digit code" copy, the length the form accepts)
// is DERIVED from this one value rather than restated next to it.
//
// This exists because the two drifted and shipped: the project emitted 8 while
// the UI said "6-digit code" and capped input at 6, silently truncating every
// real code to a prefix so no one could sign in. A mirrored value can still fall
// out of step with the dashboard, which is why the pairing is proven against the
// REAL project by the gated `tests/integration/otp-length.live.test.ts`.

/** The range Supabase's dashboard actually allows. */
export const EMAIL_OTP_LENGTH_BOUNDS = { min: 6, max: 10 } as const;

const EmailOtpLengthSchema = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(EMAIL_OTP_LENGTH_BOUNDS.min).max(EMAIL_OTP_LENGTH_BOUNDS.max));

/**
 * Default when unset. **MUST match the live project's Email OTP Length setting.**
 *
 * 6 as of 2026-08-01, verified against the live project rather than assumed: the
 * dashboard setting was changed and `admin.generateLink` returned a 6-digit
 * `email_otp`. It was 8 before, and a previous attempt to change it silently did
 * not take effect, which is why this value is never edited on the strength of an
 * intention. The gated `tests/integration/otp-length.live.test.ts` is what proves
 * this number still matches reality; run it after any dashboard change.
 */
const DEFAULT_EMAIL_OTP_LENGTH = 6;

/**
 * How many digits an emailed sign-in code has. Env-only
 * (`NEXT_PUBLIC_EMAIL_OTP_LENGTH`), so it can follow the dashboard without a code
 * change. Throws a typed `ConfigError` on an out-of-range or non-numeric value —
 * a wrong length breaks every sign-in, so it must fail loudly at the boundary
 * rather than quietly mis-render a placeholder.
 */
export function getEmailOtpLength(env: Env = process.env): number {
  const raw = env.NEXT_PUBLIC_EMAIL_OTP_LENGTH;
  if (raw === undefined) return DEFAULT_EMAIL_OTP_LENGTH;
  const result = EmailOtpLengthSchema.safeParse(raw);
  if (!result.success) {
    // The value is not secret, but keeping it out of the message keeps every
    // config error in this module uniformly value-free.
    throw new ConfigError(
      `Invalid NEXT_PUBLIC_EMAIL_OTP_LENGTH: expected an integer ` +
        `${EMAIL_OTP_LENGTH_BOUNDS.min}-${EMAIL_OTP_LENGTH_BOUNDS.max}.`,
    );
  }
  return result.data;
}

// ── Live-run allowance — ONE source of truth for a number humans also read ──
//
// ADR-0007 makes a per-account LIFETIME free allowance the primary cost control:
// a TOTAL, not a rate. The value is a TUNABLE DEFAULT rather than a product
// promise — it is expected to move with observed judge cost — so it is env-only
// and everything a human reads is DERIVED from it (see `describeLiveRunAllowance`
// in `src/runs/allowance.ts`) rather than restated as a numeral in copy.
//
// This is deliberately the same discipline `getEmailOtpLength` enforces, for the
// same reason: that number and the sentence quoting it drifted apart and shipped.
//
// It is NOT `NEXT_PUBLIC_`. The gate runs on the server, and screens receive the
// resolved number as a prop the way `/sign-in` receives the OTP length, so the
// browser is never the thing that decides how much the operator will spend.
//
// It supersedes the never-merged `LIVE_RUN_CAP` / `LIVE_RUN_WINDOW_HOURS` pair,
// which bounded a rolling window and therefore bounded the rate while leaving
// lifetime exposure per account unbounded.

/**
 * The range an allowance may take. `0` is a legitimate setting — the operator's
 * "free live runs are off" switch, expressible without a code change. The upper
 * bound exists only to catch a fat-fingered paste.
 */
export const LIVE_RUN_ALLOWANCE_BOUNDS = { min: 0, max: 1000 } as const;

const LiveRunAllowanceSchema = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(LIVE_RUN_ALLOWANCE_BOUNDS.min).max(LIVE_RUN_ALLOWANCE_BOUNDS.max));

/** ADR-0007: "~3 runs per account, total — not per day." */
const DEFAULT_LIVE_RUN_ALLOWANCE = 3;

/**
 * How many live runs a single account gets free, for its whole lifetime. Env-only
 * (`LIVE_RUN_ALLOWANCE`), so the operator can follow observed judge cost without a
 * deploy of new code. Throws a typed `ConfigError` on a non-integer or
 * out-of-range value: a spend control that silently falls back to a number nobody
 * chose is not a spend control.
 */
export function getLiveRunAllowance(env: Env = process.env): number {
  const raw = env.LIVE_RUN_ALLOWANCE;
  if (raw === undefined) return DEFAULT_LIVE_RUN_ALLOWANCE;
  const result = LiveRunAllowanceSchema.safeParse(raw);
  if (!result.success) {
    // Value-free, like every other config error in this module.
    throw new ConfigError(
      `Invalid LIVE_RUN_ALLOWANCE: expected an integer ` +
        `${LIVE_RUN_ALLOWANCE_BOUNDS.min}-${LIVE_RUN_ALLOWANCE_BOUNDS.max}.`,
    );
  }
  return result.data;
}

// ── Global model-spend cap — the operator's budget backstop (ADR-0007) ──
//
// The allowance above and this cap are NOT the same control, and neither one
// replaces the other. The allowance distributes the resource: it bounds what any
// single account can draw, so one enthusiast cannot close the tool for everyone.
// This bounds the BILL: it bounds what EVERY account together can draw in a
// billing period, which the allowance says nothing about, because a public tool
// gains accounts faster than any per-account number can bound the total.
//
// WHAT IT COUNTS: billable live runs started, globally, across all accounts.
// Not dollars, and the difference is deliberate. Nothing in this app can read
// what Anthropic has actually billed; a dollar figure would have to be
// reconstructed from a hand-typed price constant, which is exactly the invented
// number this project refuses to ship. A run is the unit we can genuinely count,
// and under the LOCKED judge (one pinned model, one temperature, one rubric, one
// judge call per run) a run's judge cost is bounded and near-constant, so a run
// count is a faithful PROXY for spend and it is honest about being one.
//
// OVER WHAT WINDOW: the current UTC calendar month. The liability this protects
// is a monthly invoice, so the budget refills when the bill does. A lifetime
// global cap would permanently close a public tool the first time it was
// popular; a rolling window would be off-phase with the invoice it exists to
// bound, so the same number would mean something different every month.
//
// The window is fixed in code rather than configurable, on purpose: a second
// knob would let an operator dial in a rolling window and quietly reintroduce
// the rate-vs-total confusion ADR-0007 settled for the allowance.

/**
 * The range a cap may take. `0` is a legitimate setting — the operator's "live
 * runs are off" switch, symmetric with the allowance. The upper bound exists
 * only to catch a fat-fingered paste.
 */
export const LIVE_RUN_SPEND_CAP_BOUNDS = { min: 0, max: 100_000 } as const;

const LiveRunSpendCapSchema = z
  .string()
  .trim()
  .regex(/^\d+$/)
  .transform(Number)
  .pipe(z.number().int().min(LIVE_RUN_SPEND_CAP_BOUNDS.min).max(LIVE_RUN_SPEND_CAP_BOUNDS.max));

/**
 * A TUNABLE DEFAULT, not a promise. ADR-0007 puts operator judge cost at a few
 * cents per run, so 500 runs a month is a liability in the low tens of dollars:
 * enough headroom that ordinary evaluation traffic never meets the backstop, low
 * enough that a runaway month is capped at an amount an operator can absorb.
 * Move it as observed cost changes.
 */
const DEFAULT_LIVE_RUN_SPEND_CAP = 500;

/**
 * How many billable live runs may start across ALL accounts in one UTC calendar
 * month. Env-only (`LIVE_RUN_SPEND_CAP`), so the operator can follow observed
 * judge cost without a deploy. Throws a typed `ConfigError` on a non-integer or
 * out-of-range value: a spend control that silently falls back to a number
 * nobody chose is not a spend control.
 */
export function getLiveRunSpendCap(env: Env = process.env): number {
  const raw = env.LIVE_RUN_SPEND_CAP;
  if (raw === undefined) return DEFAULT_LIVE_RUN_SPEND_CAP;
  const result = LiveRunSpendCapSchema.safeParse(raw);
  if (!result.success) {
    // Value-free, like every other config error in this module.
    throw new ConfigError(
      `Invalid LIVE_RUN_SPEND_CAP: expected an integer ` +
        `${LIVE_RUN_SPEND_CAP_BOUNDS.min}-${LIVE_RUN_SPEND_CAP_BOUNDS.max}.`,
    );
  }
  return result.data;
}

// ── LAZY: JudgeModelPort (blind LLM alignment-auditor) ──
const JudgeEnvSchema = z
  .object({
    JUDGE_MODEL: z.string().min(1),
    JUDGE_BASE_URL: httpUrl,
    JUDGE_API_KEY: z.string().min(1),
    JUDGE_TEMPERATURE: z.coerce.number().default(0),
  })
  .transform((v) => ({
    model: v.JUDGE_MODEL,
    baseUrl: v.JUDGE_BASE_URL,
    apiKey: v.JUDGE_API_KEY,
    temperature: v.JUDGE_TEMPERATURE,
  }));
export type JudgeConfig = z.infer<typeof JudgeEnvSchema>;

/** Resolve JudgeModelPort creds — validated only when this accessor is invoked. */
export function getJudgeConfig(env: Env = process.env): JudgeConfig {
  const result = JudgeEnvSchema.safeParse(env);
  if (!result.success) {
    throw toConfigError(result.error, 'Invalid judge (JudgeModelPort) configuration');
  }
  return result.data;
}

// ── LAZY: McpTargetPort (target MCP agent under test) ──
const McpEnvSchema = z
  .object({
    MCP_TARGET_URL: httpUrl,
    MCP_TARGET_TOKEN: z.string().min(1).optional(),
  })
  .transform((v) => ({ url: v.MCP_TARGET_URL, token: v.MCP_TARGET_TOKEN }));
export type McpConfig = z.infer<typeof McpEnvSchema>;

/** Resolve McpTargetPort creds — validated only when this accessor is invoked. */
export function getMcpConfig(env: Env = process.env): McpConfig {
  const result = McpEnvSchema.safeParse(env);
  if (!result.success) {
    throw toConfigError(result.error, 'Invalid MCP target (McpTargetPort) configuration');
  }
  return result.data;
}
