import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHELL_USER_HEADER } from '@/lib/shell-identity';

/**
 * THE SHELL USER HEADER IS FOR LABELS, NEVER FOR PERMISSION.
 *
 * The middleware forwards the signed-in address to the shell so it can print
 * "signed in as ...". That value is good enough to draw a label with and is not
 * what authorization rests on: a decision about what someone may see or do goes
 * through `getUser()` / `requireUser()`, which ask Supabase with the session
 * cookie, every time.
 *
 * So the header, and the module that reads it, may appear in exactly four
 * places. Anything else that reaches for it fails here, before it can become the
 * shortcut somebody takes instead of the real check.
 */

const ROOT = join(process.cwd(), 'src');

/** The only files that may name the header or import the module that reads it. */
const ALLOWED = [
  'lib/shell-identity.ts', // defines it
  'middleware.ts', // clears the client's value
  'lib/supabase/middleware.ts', // writes the verified one
  'components/shell/AppShell.tsx', // reads it, to draw the label
];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const rel = (file: string) =>
  file
    .slice(ROOT.length + 1)
    .split('\\')
    .join('/');
const mentions = (source: string) =>
  source.includes(SHELL_USER_HEADER) ||
  /from ['"]@\/lib\/shell-identity['"]/.test(source) ||
  /\breadShellAccount\b|\bSHELL_USER_HEADER\b/.test(source);

describe('the shell user header is display only', () => {
  const all = sources(ROOT).map((file) => ({
    file: rel(file),
    source: readFileSync(file, 'utf8'),
  }));

  it('scans the whole of src, so the guard cannot pass on an empty list', () => {
    expect(all.length).toBeGreaterThan(100);
    expect(all.some((f) => f.file === 'lib/auth/user.ts')).toBe(true);
  });

  it('is named or read only by the four files that own it', () => {
    const users = all.filter((f) => mentions(f.source)).map((f) => f.file);

    expect(users.sort()).toEqual([...ALLOWED].sort());
  });

  it('is read by nothing under src/lib/auth', () => {
    const offenders = all
      .filter((f) => f.file.startsWith('lib/auth/'))
      .filter((f) => mentions(f.source) || /x-shell-user/.test(f.source))
      .map((f) => f.file);

    expect(offenders).toEqual([]);
  });

  it('is read by no page, route handler or server action', () => {
    const guards = all.filter(
      (f) =>
        /(^|\/)(page|route|layout)\.tsx?$/.test(f.file) ||
        f.file.startsWith('app/actions/') ||
        /^['"]use server['"]/m.test(f.source),
    );
    expect(guards.length).toBeGreaterThan(8);

    expect(guards.filter((f) => mentions(f.source)).map((f) => f.file)).toEqual([]);
  });

  it('the auth source of truth still asks Supabase, not a header', () => {
    const user = all.find((f) => f.file === 'lib/auth/user.ts')!.source;

    expect(user).toMatch(/supabase\.auth\.getUser\(\)/);
    expect(user).not.toMatch(/headers\(\)/);
  });
});
