import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * NO ATTACK CONTENT IN THE BROWSER BUNDLE.
 *
 * `src/attacks` holds the poisoned payloads and the trace builders that produce
 * the held-out ground truth; `src/harness` holds the hosted tool surfaces. A
 * client component that imports either, directly or through any module it pulls
 * in, ships all of it to the browser. The Connect task preview is the reason
 * this guard exists: its goals are built on the server and handed down as plain
 * strings, and this is what keeps that true.
 *
 * It walks the import graph from every `'use client'` module. Type-only imports
 * are erased at compile time and are not followed. A `'use server'` module is
 * a boundary (the browser gets a reference to the action, not its code), so the
 * walk stops there.
 */

const SRC = resolve(process.cwd(), 'src');
const FORBIDDEN = ['attacks', 'harness'].map((dir) => join(SRC, dir));

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

/** The module directive a file opens with, if it has one. */
function directive(code: string): string | null {
  const opening = /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["'](use client|use server)["']/;
  return opening.exec(code)?.[1] ?? null;
}

const FROM = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^"';]*?)\s*from\s*["']([^"']+)["']/g;
const SIDE_EFFECT = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;
const DYNAMIC = /import\(\s*["']([^"']+)["']\s*\)/g;

/** Whether an import clause names nothing but types, as `{ type A, type B }` does. */
function namesOnlyTypes(clause: string): boolean {
  const braces = /^\{([\s\S]*)\}$/.exec(clause.trim());
  if (!braces) return false;
  const names = (braces[1] ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  return names.length > 0 && names.every((name) => /^type\s/.test(name));
}

/** The module specifiers a file imports at run time. */
function runtimeImports(code: string): string[] {
  const found: string[] = [];
  for (const [, typeOnly, clause, specifier] of code.matchAll(FROM)) {
    if (typeOnly === undefined && !namesOnlyTypes(clause ?? '')) found.push(specifier!);
  }
  for (const [, specifier] of code.matchAll(SIDE_EFFECT)) found.push(specifier!);
  for (const [, specifier] of code.matchAll(DYNAMIC)) found.push(specifier!);
  return found;
}

function resolveImport(from: string, specifier: string): string | null {
  const base = specifier.startsWith('@/')
    ? join(SRC, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(from), specifier)
      : null;
  if (base === null) return null; // a package, not our source
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
  return candidates.find((path) => existsSync(path) && statSync(path).isFile()) ?? null;
}

const show = (path: string) => relative(process.cwd(), path).replace(/\\/g, '/');

const clientRoots = (code: Map<string, string>) =>
  [...code].filter(([, text]) => directive(text) === 'use client').map(([file]) => file);

/** Every chain of imports that leads from a client module into forbidden source. */
function leaks(code: Map<string, string>): string[] {
  const chains: string[] = [];
  for (const root of clientRoots(code)) {
    const cameFrom = new Map<string, string | null>([[root, null]]);
    const queue = [root];
    while (queue.length > 0) {
      const file = queue.shift()!;
      if (FORBIDDEN.some((dir) => file.startsWith(dir))) {
        const chain: string[] = [];
        for (let at: string | null = file; at !== null; at = cameFrom.get(at) ?? null) {
          chain.unshift(show(at));
        }
        chains.push(chain.join(' -> '));
        continue;
      }
      const text = code.get(file) ?? '';
      if (file !== root && directive(text) === 'use server') continue;
      for (const specifier of runtimeImports(text)) {
        const next = resolveImport(file, specifier);
        if (next !== null && !cameFrom.has(next)) {
          cameFrom.set(next, file);
          queue.push(next);
        }
      }
    }
  }
  return chains;
}

const readSource = () =>
  new Map(sourceFiles(SRC).map((file) => [file, readFileSync(file, 'utf8')]));

describe('client bundle boundary', () => {
  it('finds the client components it is meant to guard', () => {
    expect(clientRoots(readSource()).map(show)).toContain(
      'src/components/connect/ConnectScreen.tsx',
    );
  });

  it('reads run-time imports and skips type-only ones', () => {
    const code = [
      `'use client';`,
      `import a from '@/a';`,
      `import { b, type C } from '@/b';`,
      `import type { D } from '@/attacks';`,
      `import { type E, type F } from '@/harness/server';`,
      `import './side-effect';`,
      `export { g } from './g';`,
      `const h = await import('@/h');`,
    ].join('\n');

    expect(runtimeImports(code).sort()).toEqual(['./g', './side-effect', '@/a', '@/b', '@/h']);
  });

  it('catches a client component that reaches the attacks through another module', () => {
    const code = readSource();
    const screen = join(SRC, 'components', 'connect', 'ConnectScreen.tsx');
    const helper = join(SRC, 'components', 'connect', 'categories.ts');
    code.set(helper, `${code.get(helper)}\nimport { getAttack } from '@/attacks';\n`);

    expect(leaks(code).some((chain) => chain.startsWith(show(screen)))).toBe(true);
  });

  it('lets no client component reach @/attacks or @/harness', () => {
    expect(leaks(readSource())).toEqual([]);
  });
});
