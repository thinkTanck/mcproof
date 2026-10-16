import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * NO HTML SINKS IN src/ (S5 guard, ruling 2026-10-15 19:45).
 *
 * A stored run is built from what a stranger's agent sent and what the judge
 * wrote about it, and the replay and the report print it. React escapes every
 * string it renders, so that is safe for exactly as long as nothing hands a
 * string to the browser's HTML parser or to a code evaluator. These are the ways
 * to do that, and src/ uses none of them today. A new one fails here, so the
 * choice to add one is made on purpose, in review, and not by accident.
 * `tests/unit/app/markup-renders-as-text.test.tsx` checks the rendered pages.
 */

const ROOT = join(process.cwd(), 'src');

const SINKS: ReadonlyArray<readonly [string, RegExp]> = [
  ['dangerouslySetInnerHTML', /\bdangerouslySetInnerHTML\b/],
  ['innerHTML', /\binnerHTML\b/],
  ['outerHTML', /\bouterHTML\b/],
  ['insertAdjacentHTML', /\binsertAdjacentHTML\b/],
  ['document.write', /\bdocument\s*\.\s*write(ln)?\b/],
  // The call, not the word: src/ has an `@/eval` module and the CSP names
  // 'unsafe-eval', neither of which runs anything.
  ['eval', /\beval\s*\(/],
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name) ? [full] : [];
  });
}

const rel = (file: string) =>
  file
    .slice(ROOT.length + 1)
    .split('\\')
    .join('/');

describe('src/ hands no string to the HTML parser or to eval', () => {
  const all = sources(ROOT).map((file) => ({
    file: rel(file),
    source: readFileSync(file, 'utf8'),
  }));

  it('scans the whole of src, so the guard cannot pass on an empty list', () => {
    expect(all.length).toBeGreaterThan(100);
    expect(all.some((f) => f.file === 'components/replay/Replay.tsx')).toBe(true);
  });

  it.each(SINKS)('no file uses %s', (_name, pattern) => {
    const offenders = all
      .flatMap(({ file, source }) =>
        source.split('\n').map((line, i) => (pattern.test(line) ? `${file}:${i + 1}` : null)),
      )
      .filter((hit): hit is string => hit !== null);
    expect(offenders).toEqual([]);
  });

  it.each([
    ['dangerouslySetInnerHTML', '<div dangerouslySetInnerHTML={{ __html: x }} />'],
    ['innerHTML', 'el.innerHTML = x;'],
    ['outerHTML', 'el.outerHTML = x;'],
    ['insertAdjacentHTML', "el.insertAdjacentHTML('beforeend', x);"],
    ['document.write', 'document.write(x);'],
    ['eval', 'const y = eval(x);'],
  ])('would catch %s', (name, line) => {
    const pattern = SINKS.find(([n]) => n === name)![1];
    expect(pattern.test(line)).toBe(true);
  });

  it('does not mistake the eval module or the CSP keyword for a call', () => {
    const pattern = SINKS.find(([n]) => n === 'eval')![1];
    expect(pattern.test("import { MEASURED } from '@/eval/measured';")).toBe(false);
    expect(pattern.test("`script-src 'self' 'unsafe-eval'`")).toBe(false);
  });
});
