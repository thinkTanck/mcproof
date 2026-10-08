import { z } from 'zod';

/**
 * Probe endpoint validation.
 *
 * A user-supplied MCP endpoint is external input, so it is validated with Zod
 * before anything is sent to it (CLAUDE.md: Zod on all external inputs). The
 * rules exist for security, not tidiness:
 *
 *  - **HTTPS only.** The bearer credential rides an `Authorization` header; over plain
 *    `http:` it would cross the wire in clear. The single exception is a
 *    loopback host (`localhost`, `127.0.0.1`, `[::1]`) so a developer can point
 *    MCProof at an agent on their own machine.
 *  - **No credentials in the URL.** `https://user:pass@host/` would smuggle a
 *    secret into somewhere it could be logged or persisted.
 *  - **No opaque/unparseable URLs.**
 *
 * `endpointLabel` reduces a validated endpoint to its ORIGIN. That, and only
 * that, is what gets persisted as `RunResult.target` or written to a log line:
 * a path or query string can carry a token, an origin cannot.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** True for a hostname that never leaves the machine (dev exception to HTTPS). */
export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/** Parse + validate a probe endpoint, returning a user-readable reason on failure. */
export function checkEndpoint(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: false, reason: 'Enter the MCP endpoint URL of your agent.' };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return {
      ok: false,
      reason: 'That does not look like a URL. Use the full https:// address of your MCP endpoint.',
    };
  }

  if (url.username !== '' || url.password !== '') {
    return {
      ok: false,
      reason:
        'Remove the username and password from the URL. Send your key in the API key field instead.',
    };
  }

  const secure = url.protocol === 'https:';
  const loopbackDev = url.protocol === 'http:' && isLoopbackHost(url.hostname);
  if (!secure && !loopbackDev) {
    return {
      ok: false,
      reason:
        'Use an https:// endpoint. Plain http is only allowed for localhost during development.',
    };
  }

  return { ok: true, url };
}

/**
 * Zod schema for a probed MCP server endpoint. Emits the trimmed, canonical `href` so a
 * pasted value with stray whitespace cannot produce an unreachable host.
 */
export const ProbeEndpointSchema = z
  .string()
  .max(2048, { message: 'That endpoint URL is too long.' })
  .transform((s, ctx) => {
    const checked = checkEndpoint(s);
    if (!checked.ok) {
      ctx.addIssue({ code: 'custom', message: checked.reason });
      return z.NEVER;
    }
    return checked.url.href;
  });

/**
 * The ORIGIN of a validated endpoint — the only part safe to persist or log.
 * Falls back to `'unknown-target'` rather than throwing, so a label can never
 * take down a run.
 */
export function endpointLabel(endpoint: string): string {
  try {
    return new URL(endpoint).origin;
  } catch {
    return 'unknown-target';
  }
}
