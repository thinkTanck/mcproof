import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * CONTROLS AND SMALL LABELS (UI and copy PR, owner ruling 2026-10-15).
 *
 * 1. A button or button-like control writes its label in the main text colour
 *    (`text-ink`, the body tone), never in an accent or a dimmed tone. The two
 *    exceptions carry meaning: a destructive control's red and a caution
 *    control's amber.
 * 2. Small uppercase text is at least 13px: no uppercase class string sits at
 *    the 12px floor or below it.
 *
 * The 7:1 ratios themselves are asserted in tokens.test.tsx.
 *
 * ONE RULED EXCEPTION to rule 1 (AGENT TAB TEXT, owner ruling 2026-10-21): the
 * six Connect agent tabs write their labels in the nominal cyan. Their pressed
 * state still shows by border, fill and aria-pressed, never by colour alone. A
 * tab claims the exception with `data-client-tab`, and only there.
 */
const CYAN_LABEL_ALLOWED = new Map([['components/connect/ClientSetup.tsx', 'data-client-tab']]);

const ROOT = join(process.cwd(), 'src');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx$/.test(entry.name) && !entry.name.endsWith('.e2e.tsx') ? [full] : [];
  });
}

const rel = (file: string) =>
  file
    .slice(ROOT.length + 1)
    .split('\\')
    .join('/');

describe('the shared Button', () => {
  const source = readFileSync(join(ROOT, 'components/hud/Button.tsx'), 'utf8');
  const variant = (name: string) => new RegExp(`${name}:\\s*\\n?\\s*'([^']*)'`).exec(source)?.[1];

  it.each(['primary', 'ghost'])('writes the %s label in the main text colour', (name) => {
    const classes = variant(name);
    expect(classes, `${name} variant found`).toBeDefined();
    expect(classes).toMatch(/(^|\s)text-ink(\s|$)/);
    expect(classes).not.toMatch(/(^|\s)text-(nominal|readout|ink-muted|ink-faint)(\s|$)/);
  });

  it('keeps the destructive label red, because the red is the meaning', () => {
    expect(variant('destructive')).toMatch(/(^|\s)text-breach-text(\s|$)/);
  });
});

describe('button-like controls', () => {
  const all = sources(ROOT).map((file) => ({
    file: rel(file),
    source: readFileSync(file, 'utf8'),
  }));

  it('scans the components, so the guard cannot pass on an empty list', () => {
    expect(all.length).toBeGreaterThan(50);
  });

  it('no <button> or <summary> writes its resting label in an accent or a dimmed tone', () => {
    const offenders: string[] = [];
    for (const { file, source } of all) {
      for (const match of source.matchAll(/<(button|summary)\b/g)) {
        // The opening tag, up to the first `>` outside a JSX expression.
        let depth = 0;
        let end = match.index!;
        for (; end < source.length; end += 1) {
          const ch = source[end];
          if (ch === '{') depth += 1;
          else if (ch === '}') depth -= 1;
          else if (ch === '>' && depth === 0) break;
        }
        const tag = source.slice(match.index!, end);
        const marker = CYAN_LABEL_ALLOWED.get(file);
        const accent =
          marker !== undefined && tag.includes(marker)
            ? /(?<![:\w-])text-(readout|ink-muted|ink-faint)\b/
            : /(?<![:\w-])text-(nominal|readout|ink-muted|ink-faint)\b/;
        if (accent.test(tag)) {
          offenders.push(`${file}:${source.slice(0, match.index!).split('\n').length}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('small uppercase text', () => {
  const all = sources(ROOT).map((file) => ({
    file: rel(file),
    source: readFileSync(file, 'utf8'),
  }));

  it('is never set at the 12px floor or below', () => {
    const offenders: string[] = [];
    for (const { file, source } of all) {
      for (const match of source.matchAll(/(["'`])([^"'`]*\buppercase\b[^"'`]*)\1/g)) {
        const classes = match[2] ?? '';
        if (/text-\(length:--text-floor\)|\btext-xs\b|text-\[(\d|1[0-2])px\]/.test(classes)) {
          offenders.push(`${file}:${source.slice(0, match.index!).split('\n').length}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
