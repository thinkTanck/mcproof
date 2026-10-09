/**
 * THE RENAME GUARD: MCPwn is MCProof.
 *
 * The product was renamed on 2026-10-08. This scans every tracked text file in
 * the living parts of the repo and fails on the old name in any case, and on the
 * old split wordmark (`MCP` + an accented `wn`), so the name cannot drift back in
 * through a copied string, a fixture URL or a new screen.
 *
 * What may still say it is listed below, one entry per reason, and an entry
 * removes ONLY the exact text it names from that file before the scan. Kept on
 * purpose and out of scope: the ADRs and dated plans under `docs/` (records of
 * decisions as made), the migrations (applied, immutable), the design artifact.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

const SCANNED_DIRS = ['src/', 'tests/', 'scripts/', 'supabase/templates/'];
const SCANNED_FILES = [
  'README.md',
  'PRODUCT.md',
  'DESIGN.md',
  'CLAUDE.md',
  'NOTICE',
  'package.json',
  '.env.example',
  '.husky/pre-push',
  'supabase/config.toml',
  'next.config.ts',
];
const BINARY = /\.(png|jpe?g|gif|ico|webp|avif|woff2?|ttf|otf|pdf|zip)$/i;

/** The frozen judge path. It names neither product and the rename never touches it. */
const FROZEN = ['src/detector/', 'src/eval/', 'src/fix-report/', 'src/data/fixtures/'];

interface Allowed {
  readonly path: RegExp;
  readonly text: RegExp;
  readonly reason: string;
}

const ALLOWED: readonly Allowed[] = [
  {
    path: /.*/,
    text: /0006-mcpwn-is-the-mcp-server/g,
    reason: 'the ADR keeps its file name, and every link to it says so',
  },
  {
    path: /.*/,
    text: /MCPwn Sentinel v2\.dc\.html/g,
    reason: 'the frozen design artifact keeps its file name (ADR-0004)',
  },
  {
    path: /^src\/harness\/server\/surface\.ts$/,
    text: /'mcpwn',/g,
    reason: 'the old name stays banned from anything the agent can read',
  },
  {
    path: /^tests\/unit\/harness\/server\/surface\.test\.ts$/,
    text: /MCPWN|MCPwn|'mcpwn'/g,
    reason: 'asserts the old name is still caught as a tell',
  },
  {
    path: /^(src\/runs\/run-token\.ts|src\/lib\/redact\.ts|tests\/unit\/runs\/run-token\.test\.ts|tests\/unit\/lib\/redact\.test\.ts|tests\/unit\/lib\/secret-leakage\.guard\.test\.ts)$/,
    text: /\(\?:mcpwn_\)\?rt|mcpwn_rt/gi,
    reason: 'tokens issued before the rename carry the legacy prefix until they expire',
  },
  {
    path: /^src\/lib\/auth\/otp-rate-limit\.ts$/,
    text: /'mcpwn\/otp-rate-limit\/v1'/g,
    reason: 'the salt of stored rate-limit hashes; changing it orphans the counters',
  },
  {
    path: /^supabase\/config\.toml$/,
    text: /project_id = "mcpwn"/g,
    reason: 'the local stack identity; renaming discards the local database volume',
  },
  {
    path: /^(src\/config\/legacy-host\.ts|tests\/unit\/config\/legacy-host\.test\.ts|tests\/e2e\/legacy-host\.spec\.ts)$/,
    text: /mcpwn/gi,
    reason: 'the redirect config for the old host, which must keep serving /api/mcp/*',
  },
  {
    path: /^(README\.md|NOTICE|CLAUDE\.md)$/,
    text: /formerly MCPwn|`mcpwn_rt`|`mcpwn\.dev`/g,
    reason: 'so the old name, the legacy prefix and the old host stay findable in the docs',
  },
];

function trackedFiles(): string[] {
  // Tracked files AND new, unignored ones, so a local run sees a file before it is committed.
  const out = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: ROOT,
      encoding: 'utf8',
    },
  );
  return out
    .split('\0')
    .filter(Boolean)
    .filter((f) => !BINARY.test(f))
    .filter((f) => f !== 'tests/unit/rename-guard.test.ts')
    .filter((f) => SCANNED_FILES.includes(f) || SCANNED_DIRS.some((d) => f.startsWith(d)));
}

function read(file: string): string | null {
  try {
    return readFileSync(join(ROOT, file), 'utf8');
  } catch {
    // Tracked but deleted in the working tree: nothing to scan.
    return null;
  }
}

function strip(file: string, content: string): string {
  return ALLOWED.filter((a) => a.path.test(file)).reduce((c, a) => c.replace(a.text, ''), content);
}

describe('rename guard: MCPwn is MCProof', () => {
  const files = trackedFiles();

  it('scans the living repo', () => {
    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain('src/components/shell/LogoRing.tsx');
  });

  it('no living file names MCPwn outside the allowlist', () => {
    const hits: string[] = [];
    for (const file of files) {
      const content = read(file);
      if (content === null) continue;
      strip(file, content)
        .split('\n')
        .forEach((line, i) => {
          if (/mcpwn/i.test(line)) hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
        });
    }
    expect(hits).toEqual([]);
  });

  it('no source draws the old split wordmark, MCP plus an accented "wn"', () => {
    const hits = files
      .filter((f) => f.startsWith('src/'))
      .filter((f) => {
        const c = read(f);
        return c !== null && (/MCP<span[^>]*>\s*wn\s*</.test(c) || />wn</.test(c));
      });
    expect(hits).toEqual([]);
  });

  it('the frozen judge path names neither product, and nothing is allowlisted there', () => {
    const judge = files.filter((f) => FROZEN.some((p) => f.startsWith(p)));
    expect(judge.length).toBeGreaterThan(0);
    for (const file of judge) {
      expect(read(file) ?? '', file).not.toMatch(/mcpwn|mcproof/i);
      for (const a of ALLOWED) {
        if (a.path.source === '.*') continue;
        expect(a.path.test(file), `${file} is allowlisted`).toBe(false);
      }
    }
  });
});
