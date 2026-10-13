import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/**
 * THE RUN-TIME IMPORT GRAPH OF `src/`, walked from every `'use client'` module.
 *
 * Two guards ask the same question about different source: can anything the
 * browser is sent reach this? One asks it about the attack content
 * (`tests/unit/app/client-bundle-boundary.test.ts`), the other about the
 * service-role client (`tests/unit/lib/secret-leakage.guard.test.ts`). The walk
 * lives here so there is one of it.
 *
 * Type-only imports are erased at compile time and are not followed. A
 * `'use server'` module is a boundary (the browser gets a reference to the
 * action, not its code), so the walk stops there.
 */

export const SRC = resolve(process.cwd(), 'src');

export function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

/** The module directive a file opens with, if it has one. */
export function directive(code: string): string | null {
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
export function runtimeImports(code: string): string[] {
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

export const show = (path: string) => relative(process.cwd(), path).replace(/\\/g, '/');

export const clientRoots = (code: Map<string, string>) =>
  [...code].filter(([, text]) => directive(text) === 'use client').map(([file]) => file);

/**
 * Every chain of imports that leads from a client module into source the
 * `forbidden` test names. It is given the file's path and its text.
 */
export function leaks(
  code: Map<string, string>,
  forbidden: (file: string, text: string) => boolean,
): string[] {
  const chains: string[] = [];
  for (const root of clientRoots(code)) {
    const cameFrom = new Map<string, string | null>([[root, null]]);
    const queue = [root];
    while (queue.length > 0) {
      const file = queue.shift()!;
      const text = code.get(file) ?? '';
      if (forbidden(file, text)) {
        const chain: string[] = [];
        for (let at: string | null = file; at !== null; at = cameFrom.get(at) ?? null) {
          chain.unshift(show(at));
        }
        chains.push(chain.join(' -> '));
        continue;
      }
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

export const readSource = () =>
  new Map(sourceFiles(SRC).map((file) => [file, readFileSync(file, 'utf8')]));
