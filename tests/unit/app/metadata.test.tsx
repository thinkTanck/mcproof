import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Locks the SHIPPED page metadata: the copy contract (no em dashes, no stale
 * claims about UI that no longer exists) and the URL contract (`metadataBase`,
 * without which Next resolves every relative Open Graph / canonical URL against
 * `http://localhost:3000` in production).
 *
 * The em-dash sweep is a SOURCE scan rather than a set of imports, so a new route
 * is covered the moment it is added: no test edit is required for the guard to
 * apply to it.
 */

// next/font/google needs the Next SWC transform; under Vitest the loader call
// would throw at module scope. The layout only needs the CSS-variable names.
vi.mock('next/font/google', () => ({
  Geist: () => ({ variable: '--font-geist-sans', className: 'geist-sans' }),
  Geist_Mono: () => ({ variable: '--font-geist-mono', className: 'geist-mono' }),
}));

const APP_DIR = join(process.cwd(), 'src', 'app');

/** Every .tsx under src/app, recursively (route groups and [params] included). */
function appSources(dir: string = APP_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return appSources(full);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [full] : [];
  });
}

/**
 * The text of the `export const metadata: Metadata = { ... }` object literal, or
 * null when the file exports none. Brace-counted rather than regexed, so a nested
 * object (openGraph, twitter) is captured whole.
 */
function metadataLiteral(source: string): string | null {
  // `PAGE_METADATA` is the same literal on a route whose title depends on its
  // params, where it is returned from `generateMetadata` and cannot be exported.
  const marker = Math.max(
    source.indexOf('export const metadata'),
    source.indexOf('const PAGE_METADATA'),
  );
  if (marker === -1) return null;
  const open = source.indexOf('{', marker);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}

const routeMetadata = appSources()
  .map((file) => ({ file: relative(process.cwd(), file), literal: metadataLiteral(read(file)) }))
  .filter((entry): entry is { file: string; literal: string } => entry.literal !== null);

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

describe('shipped page metadata', () => {
  it('finds a metadata export on every routed screen', () => {
    // A tripwire on the scan itself: if the extraction silently stopped matching,
    // the em-dash sweep below would pass vacuously.
    expect(routeMetadata.length).toBeGreaterThanOrEqual(7);
  });

  it.each(routeMetadata.map((m) => m.file))(
    '%s: no em dash in the metadata title or description',
    (file) => {
      const literal = routeMetadata.find((m) => m.file === file)!.literal;
      // CLAUDE.md / DESIGN.md: em dashes are banned in UI copy (a period, a comma
      // or a colon instead). A page title and description ARE user-visible copy:
      // they render in the browser tab, in search results, and in link previews.
      expect(literal, `${file} metadata must not contain an em dash`).not.toMatch(/—/);
    },
  );

  it('describes the replay hero that actually ships, not the removed orbital core', () => {
    // The WebGL/3D orbital hero was replaced by the agent-transcript console plus
    // the detector-verdict terminal. The description outlived it and was untrue.
    // The PAGE, by name: the route's not-found.tsx exports a title of its own.
    const runPage = routeMetadata.find(
      (m) => m.file.includes('runs') && m.file.endsWith('page.tsx'),
    );
    const literal = runPage?.literal ?? '';
    expect(runPage, 'the /runs/[id] metadata export').toBeDefined();
    expect(literal).not.toMatch(/orbital|3D|WebGL/i);
    expect(literal).toMatch(/transcript|console|verdict/i);
  });
});

describe('root metadata URL contract', () => {
  it('pins a metadataBase at the canonical origin so relative URLs resolve', async () => {
    const { metadata } = await import('@/app/layout');
    // Without metadataBase, Next resolves relative OG/canonical URLs against
    // http://localhost:3000 — so a deployed page advertises localhost.
    const base = metadata.metadataBase;
    expect(base).toBeInstanceOf(URL);
    expect((base as URL).origin).toBe('https://mcproof.dev');
    expect((base as URL).protocol).toBe('https:');
    // A relative metadata URL must now land on the canonical host.
    expect(new URL('/leaderboard', base as URL).href).toBe('https://mcproof.dev/leaderboard');
  });

  it('does not pin a root-level canonical that every child would inherit', async () => {
    const { metadata } = await import('@/app/layout');
    // Metadata merges down the tree: a canonical (or openGraph.url) on the root
    // layout would make /leaderboard, /threats and the rest all claim the same
    // URL. The base plus per-route relative URLs is the correct shape.
    expect(metadata.alternates?.canonical).toBeUndefined();
    expect(
      metadata.openGraph && 'url' in metadata.openGraph ? metadata.openGraph.url : undefined,
    ).toBeUndefined();
  });

  it('carries a title and description into the social cards', async () => {
    const { metadata } = await import('@/app/layout');
    expect(metadata.title).toBe('MCProof · Red-team your MCP agents');
    expect(metadata.openGraph?.title).toBe(metadata.title);
    expect(metadata.openGraph?.description).toBe(metadata.description);
    expect(metadata.twitter?.title).toBe(metadata.title);
  });

  /**
   * A `summary_large_image` card with no image behind it is a declaration the
   * repo cannot honour. Keep the card type honest: it may only be promoted in
   * the same change that adds a real share asset (a Next `opengraph-image.*`
   * convention file, or an explicit `images` entry).
   */
  it('claims a large-image card only when a share image actually exists', async () => {
    const { metadata } = await import('@/app/layout');
    const card = metadata.twitter && 'card' in metadata.twitter ? metadata.twitter.card : undefined;
    if (card !== 'summary_large_image') return;

    const hasDeclaredImage = Boolean(
      metadata.openGraph && 'images' in metadata.openGraph && metadata.openGraph.images,
    );
    const conventionFile = (await import('node:fs'))
      .readdirSync('src/app')
      .some((f) => /^(opengraph|twitter)-image\./.test(f));

    expect(hasDeclaredImage || conventionFile).toBe(true);
  });
});
