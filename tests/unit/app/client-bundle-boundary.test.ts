import { join } from 'node:path';
import {
  SRC,
  clientRoots,
  leaks as leaksInto,
  readSource,
  runtimeImports,
  show,
} from '../../helpers/import-graph';

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

const FORBIDDEN = ['attacks', 'harness'].map((dir) => join(SRC, dir));

/** Every chain of imports that leads from a client module into forbidden source. */
const leaks = (code: Map<string, string>) =>
  leaksInto(code, (file) => FORBIDDEN.some((dir) => file.startsWith(dir)));

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
