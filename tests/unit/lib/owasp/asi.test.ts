import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CategorySchema } from '@/contract';
import { SYSTEM_RUBRIC } from '@/detector';
import { ASI_CODES, ASI_NAMES, asiLabel, asiName, isAsiCode } from '@/lib/owasp/asi';

/**
 * THE ONE LOOKUP FROM AN OWASP AGENTIC CODE TO ITS NAME (UI audit 2026-10-12,
 * batch C).
 *
 * The names below are typed out here and compared with the module, so the
 * module cannot drift without this failing. They are the titles of the OWASP
 * Top 10 for Agentic Applications (2026), as CLAUDE.md lists them.
 */
const OFFICIAL: Record<string, string> = {
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

describe('the ASI lookup', () => {
  it('holds all ten codes, in order', () => {
    expect([...ASI_CODES]).toEqual(Object.keys(OFFICIAL));
  });

  it('gives every code its official name, exactly', () => {
    expect({ ...ASI_NAMES }).toEqual(OFFICIAL);
  });

  it('covers every category the contract knows', () => {
    for (const category of CategorySchema.options) {
      expect(asiName(category)).toBe(OFFICIAL[category]);
    }
  });

  it('agrees with the names the frozen judge is given, without touching them', () => {
    const rubric = Array.isArray(SYSTEM_RUBRIC) ? SYSTEM_RUBRIC.join('\n') : String(SYSTEM_RUBRIC);
    for (const category of CategorySchema.options) {
      expect(rubric).toContain(`${category} = ${ASI_NAMES[category]}`);
    }
  });

  it('writes a code with its name, and never invents a name for an unknown code', () => {
    expect(asiLabel('ASI02')).toBe('ASI02 Tool Misuse and Exploitation');
    expect(asiLabel('ASI10')).toBe('ASI10 Rogue Agents');
    expect(asiName('ASI11')).toBeUndefined();
    expect(asiLabel('ASI11')).toBe('ASI11');
    expect(isAsiCode('ASI07')).toBe(true);
    expect(isAsiCode('asi07')).toBe(false);
    expect(isAsiCode('')).toBe(false);
  });
});

/**
 * NO SECOND MAP. A module that types a category name out as its own string is
 * keeping its own copy, and a copy is how the replay came to print "Tool Misuse
 * & Exploitation" beside a board that printed "Tool Misuse and Exploitation".
 *
 * Scanned: every source file under `src/`. Allowed: the lookup itself, and the
 * frozen areas, which this round may not edit (the detector's rubric, the
 * measured figures, the fix-report generator and the recorded sample verdicts).
 * A name inside a comment or inside a longer sentence is prose, not a map, and
 * is not matched: only a string literal that IS a name, or is a known variant
 * of one, is.
 */
const SRC = join(process.cwd(), 'src');
const LOOKUP = 'src/lib/owasp/asi.ts';
const FROZEN = [/^src\/detector\//, /^src\/eval\//, /^src\/fix-report\//, /^src\/data\/fixtures\//];

/** Spellings that were in the tree before this lookup existed. */
const VARIANTS = [
  'Tool Misuse & Exploitation',
  'Identity & Privilege Abuse',
  'Agentic Supply Chain',
  'Unexpected Code Execution',
  'Memory and Context Poisoning',
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(entry) ? [full] : [];
  });
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('no module keeps its own code-to-name map', () => {
  const files = walk(SRC).map((full) => ({
    file: relative(process.cwd(), full).replace(/\\/g, '/'),
    text: readFileSync(full, 'utf8'),
  }));

  it('reads the whole source tree', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.map((f) => f.file)).toContain(LOOKUP);
  });

  it('finds a category name as a string literal only in the lookup and the frozen areas', () => {
    const names = [...Object.values(OFFICIAL), ...VARIANTS];
    const literal = new RegExp(`(['"\`])(?:${names.map(escape).join('|')})\\1`);
    const offenders = files
      .filter(({ file }) => file !== LOOKUP && !FROZEN.some((frozen) => frozen.test(file)))
      .filter(({ text }) => literal.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
