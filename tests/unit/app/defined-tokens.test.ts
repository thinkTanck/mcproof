import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * EVERY TOKEN A COMPONENT REFERENCES IS A TOKEN THAT EXISTS.
 *
 * `var(--cyan-400)` sat in the hero replay's sweep glow for months. The cyan
 * ramp is 100 / 300 / 500 / 700 / 900: there is no 400. A `var()` that resolves
 * to nothing does not fall back to a neighbour, it makes the whole declaration
 * invalid, so the glow painted nothing and nothing failed. The token test for
 * `globals.css` could not see it, because it only reads the stylesheet.
 *
 * This reads the components instead: every `var(--name)` written in `src` has
 * to be declared in `globals.css`.
 */
const root = process.cwd();
const SRC = join(root, 'src');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}

const css = readFileSync(join(SRC, 'app', 'globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const declared = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]!));
// Set at run time, not in the stylesheet: next/font puts these on <html>.
const provided = new Set(['--font-geist-sans', '--font-geist-mono']);

const show = (path: string) => relative(root, path).replace(/\\/g, '/');

describe('design tokens referenced by components', () => {
  it('declares every var(--name) that src refers to', () => {
    const missing: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        for (const [, name] of line.matchAll(/var\(\s*(--[\w-]+)/g)) {
          if (!declared.has(name!) && !provided.has(name!)) {
            missing.push(`${show(file)}:${i + 1} ${name}`);
          }
        }
      });
    }
    expect(missing).toEqual([]);
  });

  it('has no --cyan-400 anywhere: the ramp has no such step', () => {
    expect(declared.has('--cyan-400')).toBe(false);
    const users = sourceFiles(SRC)
      .filter((file) => readFileSync(file, 'utf8').includes('cyan-400'))
      .map(show);
    expect(users).toEqual([]);
  });
});
