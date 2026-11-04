/**
 * How a step's payload is printed as a shell line, written once. The replay's
 * transcript terminal prints every step with these, and the link preview card
 * (`src/lib/og/share-card.tsx`) prints its excerpt with them, so a tool call on
 * the card reads exactly as it does in the replay.
 */

/** A value on one line: strings as they are, anything else as JSON, capped. */
export function compact(v: unknown): string {
  let s: string;
  if (typeof v === 'string') s = v;
  else {
    try {
      s = JSON.stringify(v);
    } catch {
      s = String(v);
    }
  }
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > 220 ? `${s.slice(0, 219)}…` : s;
}

/** A tool call's arguments as command-line flags: `--path="/srv/..."`. */
export function flags(args: unknown): string {
  if (args && typeof args === 'object' && !Array.isArray(args)) {
    return Object.entries(args as Record<string, unknown>)
      .map(([k, v]) => `--${k}=${typeof v === 'string' ? `"${v}"` : compact(v)}`)
      .join(' ');
  }
  return compact(args);
}
