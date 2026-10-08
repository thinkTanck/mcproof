/**
 * ONE redaction utility for every secret this app touches.
 *
 * `src/runs/run-token.ts` proved the no-log guarantee for a single credential:
 * its tests assert that no log line, no persisted record and no serialized error
 * carries the plaintext token, its verifier or its selector. That proof is real
 * but LOCAL. It holds because that module was written carefully, and it says
 * nothing about the judge API key, the service-role key, an emailed one-time
 * code, or whatever secret is added next. This module is the same guarantee made
 * general, and `tests/unit/lib/secret-leakage.guard.test.ts` is what keeps it
 * true for code nobody has written yet.
 *
 * ── THREE INDEPENDENT WAYS A VALUE IS RECOGNIZED AS SECRET ──
 *
 * 1. BY KEY. `{ password, token, apiKey, verifier, otp, presented, ... }` is
 *    redacted whatever the value looks like. Cheap, and it covers the common
 *    case of a caller passing a credential straight through.
 * 2. BY VALUE. The values actually configured in the environment
 *    ({@link SECRET_ENV_NAMES}) become NEEDLES: any string containing one has it
 *    cut out, at any depth, under any key, including inside the log message
 *    itself. This is what catches `` `POST failed for ${apiKey}` `` — a string
 *    whose key says nothing and whose content is the whole secret.
 * 3. BY SHAPE. Credentials with an unmistakable grammar are redacted with no
 *    configuration at all: our own `rt_..._...` run tokens (and the legacy
 *    `mcpwn_rt_..._...` form still accepted for one token lifetime), `Bearer`
 *    values, JWTs (the shape every Supabase key takes), `sk-`-prefixed API keys,
 *    and Postgres connection strings (which carry the database password). Shape
 *    matching is what protects a per-run secret that exists for one run and is
 *    therefore in no environment variable at all.
 *
 * NEEDLES HAVE A MINIMUM LENGTH (8). A three-character "secret" — the sort a
 * test fixture sets — would otherwise redact ordinary prose everywhere and turn
 * every log line into confetti. Short values are ignored rather than trusted.
 *
 * WHAT THIS IS NOT. It is a last line of defence at the sink, not a licence to
 * hand secrets to loggers. The static half of the guard test still fails a build
 * that passes a secret-named identifier into a log call or an error message,
 * because relying on redaction to catch what discipline should have prevented is
 * one refactor away from a leak.
 */

type Env = Record<string, string | undefined>;

/** What every redacted value is replaced with. */
export const REDACTED = '[REDACTED]';

/** Below this length a "secret" is more likely to be a fixture than a credential. */
export const MIN_NEEDLE_LENGTH = 8;

/** How deep a structure is walked before it is summarized instead. */
const MAX_DEPTH = 6;

/**
 * Environment variables whose VALUES are secret. `NEXT_PUBLIC_SUPABASE_ANON_KEY`
 * is deliberately absent: it is public by design and ships in the browser bundle,
 * so redacting it would only make logs harder to read. `DATABASE_URL` is here
 * because it embeds the database password, even though no application code reads
 * it.
 */
export const SECRET_ENV_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'JUDGE_API_KEY',
  'MCP_TARGET_TOKEN',
  'DATABASE_URL',
] as const;

/**
 * Key names whose value is a secret whatever it looks like. Case-insensitive and
 * anchored, so `hasVerifier` (a presence flag) and `maxTokens` (a count) stay
 * readable while `verifier` and `token` do not.
 */
const SENSITIVE_KEY =
  /^(?:password|passphrase|token|access[_-]?token|refresh[_-]?token|secret|api[_-]?key|service[_-]?role[_-]?key|authorization|auth|credentials?|verifier|otp|otp[_-]?code|one[_-]?time[_-]?code|email[_-]?code|bearer|cookie|set-cookie|presented|plaintext)$/i;

/**
 * Credentials with a grammar distinctive enough to recognize on sight. Each
 * pattern is anchored on a prefix or separator that ordinary prose does not
 * carry, so a false positive costs a redacted log line and never a wrong value.
 */
const SECRET_SHAPES: readonly (readonly [RegExp, string])[] = [
  // Our own per-run token, under the current `rt_` prefix or the legacy
  // `mcpwn_rt_` one. Matched on the selector alone too, so a truncated or
  // partially quoted token is still caught. The word boundary keeps `part_` and
  // `start_` out of it.
  [/\b((?:mcpwn_)?rt)_[0-9a-f]{8,}(?:_[0-9a-f]{8,})?/gi, `$1_${REDACTED}`],
  // An HTTP authorization credential of any scheme we use.
  [/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${REDACTED}`],
  // A JWT. Every Supabase key is one, as are session tokens.
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, REDACTED],
  // Provider API keys that announce themselves.
  [/\bsk-[A-Za-z0-9_-]{12,}/g, REDACTED],
  // A database connection string carries the password in its authority section.
  [/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/\S+/gi, REDACTED],
];

/** Options every entry point accepts. */
export interface RedactOptions {
  /** Where configured secrets are read from. Defaults to `process.env`. */
  readonly env?: Env;
  /** Secrets known only to the caller, e.g. a token issued for this one run. */
  readonly extraSecrets?: readonly (string | undefined | null)[];
}

/**
 * The secret VALUES to cut out of any string, longest first.
 *
 * Longest first matters: if one secret is a substring of another (a key and the
 * header line containing it), redacting the shorter one first would leave the
 * longer one half-intact and unrecognizable to the next pass.
 */
export function secretNeedles(options: RedactOptions = {}): string[] {
  const env = options.env ?? process.env;
  const candidates = [
    ...SECRET_ENV_NAMES.map((name) => env[name]),
    ...(options.extraSecrets ?? []),
  ];
  const unique = new Set<string>();
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && value.length >= MIN_NEEDLE_LENGTH) unique.add(value);
  }
  return [...unique].sort((a, b) => b.length - a.length);
}

function cut(text: string, needles: readonly string[]): string {
  let out = text;
  for (const needle of needles) out = out.split(needle).join(REDACTED);
  for (const [pattern, replacement] of SECRET_SHAPES) out = out.replace(pattern, replacement);
  return out;
}

/** Redact a single string: configured values first, then recognizable shapes. */
export function redactString(text: string, options: RedactOptions = {}): string {
  return cut(text, secretNeedles(options));
}

/** True when a key's value must go, whatever that value is. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

function walk(
  value: unknown,
  needles: readonly string[],
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (typeof value === 'string') return cut(value, needles);
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint' || typeof value === 'symbol') return cut(String(value), needles);
  if (typeof value === 'function') return '[FUNCTION]';

  const object = value as object;
  if (seen.has(object)) return '[CIRCULAR]';
  if (depth >= MAX_DEPTH) return '[DEPTH]';
  seen.add(object);

  try {
    if (Array.isArray(value)) return value.map((item) => walk(item, needles, depth + 1, seen));

    const out: Record<string, unknown> = {};
    // An Error's name and message are not own enumerable properties, so they are
    // lifted explicitly. The stack is dropped on purpose: a multi-frame path dump
    // belongs in an error tracker, not in a one-line structured log.
    if (value instanceof Error) {
      out.name = value.name;
      out.message = cut(value.message, needles);
    }
    for (const [key, entry] of Object.entries(object)) {
      out[key] = isSensitiveKey(key) ? REDACTED : walk(entry, needles, depth + 1, seen);
    }
    return out;
  } finally {
    seen.delete(object);
  }
}

/**
 * Redact anything, at any depth: strings, arrays, plain objects, class instances
 * and Errors. Returns a NEW value; the input is never mutated, because a caller
 * that logs an object usually still needs it.
 */
export function redactSecrets(value: unknown, options: RedactOptions = {}): unknown {
  return walk(value, secretNeedles(options), 0, new WeakSet());
}
