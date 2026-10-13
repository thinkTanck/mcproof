/**
 * THE ONE LOOKUP FROM AN OWASP AGENTIC CODE TO ITS NAME.
 *
 * Every screen that prints a category code reads its name from here, so a code
 * is never shown without its name and the name is spelled one way everywhere
 * (UI audit 2026-10-12, batch C). Before this there were five tables: the
 * coverage board, the leaderboard axis, the Home launcher, the Connect picker
 * and the replay header, and the replay's had drifted ("Tool Misuse &
 * Exploitation", "Agentic Supply Chain").
 *
 * All TEN categories are here, not only the Core-7 the product tests, because
 * the coverage board names the three it does not measure as well.
 *
 * Codes and titles are (c) OWASP GenAI Security Project, Top 10 for Agentic
 * Applications 2026 (CC BY-SA 4.0), verbatim and pinned per docs/adr/0003. Do
 * not rewrite one against a secondary source.
 *
 * Two copies of the Core-7 names remain outside this file, on purpose: the
 * detector's rubric (`src/detector`) and the fix-report generator
 * (`src/fix-report`). Both are frozen with the judge they were measured with.
 * `tests/unit/lib/owasp/asi.test.ts` holds this table to the rubric's spelling
 * and fails if any other module in `src/` types a name out for itself.
 *
 * A leaf module: no imports, so a client component reads a name for the cost of
 * the strings alone.
 */
export const ASI_CODES = [
  'ASI01',
  'ASI02',
  'ASI03',
  'ASI04',
  'ASI05',
  'ASI06',
  'ASI07',
  'ASI08',
  'ASI09',
  'ASI10',
] as const;

export type AsiCode = (typeof ASI_CODES)[number];

export const ASI_NAMES: Readonly<Record<AsiCode, string>> = {
  ASI01: 'Agent Goal Hijack',
  ASI02: 'Tool Misuse and Exploitation',
  ASI03: 'Identity and Privilege Abuse',
  ASI04: 'Agentic Supply Chain Vulnerabilities',
  ASI05: 'Unexpected Code Execution (RCE)',
  ASI06: 'Memory & Context Poisoning',
  ASI07: 'Insecure Inter-Agent Communication',
  ASI08: 'Cascading Agent Failures',
  ASI09: 'Human-Agent Trust Exploitation',
  ASI10: 'Rogue Agents',
};

export function isAsiCode(value: string): value is AsiCode {
  return Object.prototype.hasOwnProperty.call(ASI_NAMES, value);
}

/** The name of a code, or `undefined` for a code this list does not hold. */
export function asiName(code: string): string | undefined {
  return isAsiCode(code) ? ASI_NAMES[code] : undefined;
}

/**
 * A code with its name, as one string: `ASI02 Tool Misuse and Exploitation`.
 * An unknown code comes back bare, never with an invented name.
 */
export function asiLabel(code: string, separator = ' '): string {
  const name = asiName(code);
  return name === undefined ? code : `${code}${separator}${name}`;
}
