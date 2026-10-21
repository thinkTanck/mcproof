import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A REPLAY NEVER MOVES THE PAGE (owner ruling REPLAY SCROLL, 2026-10-20).
 *
 * On desktop the terminal called `scrollIntoView({ block: 'center' })` on every
 * step. That scrolls every scrolling ancestor, the page included, so a viewer
 * who had scrolled down to the step card and the controls was pulled back up
 * on each step. The terminal now scrolls only itself (`followStepInside`), at
 * every width, and so does a speaker definition when it opens.
 *
 * So no module behind a replay, the detector panel, the verdict reveal or the
 * Home hero may call `scrollIntoView`, scroll the window, or move focus
 * without `{ preventScroll: true }`. The one exception: a definition the
 * viewer opens while the replay is NOT playing may be brought on screen.
 * Comments are ignored.
 */
const ROOTS = ['src/components/replay', 'src/components/home'];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const sources = ROOTS.flatMap(files).map((path) => ({
  path,
  code: withoutComments(readFileSync(path, 'utf8')),
}));

/** The one allowed call: a definition, only when the replay is not playing. */
const ALLOWED =
  /if \(!panel\.closest\('\[data-replay-playing\]'\)[^;{]*\{\s*panel\.scrollIntoView\(/g;

describe('no replay or Home module moves the page', () => {
  it('reads the modules it guards', () => {
    expect(sources.some((s) => s.path.endsWith('ReplayTerminal.tsx'))).toBe(true);
    expect(sources.some((s) => s.path.endsWith('SpeakerHandle.tsx'))).toBe(true);
    expect(sources.some((s) => s.path.endsWith('VerdictRail.tsx'))).toBe(true);
  });

  it('never calls scrollIntoView, except a definition opened while the replay is not playing', () => {
    const offenders = sources
      .filter((s) => {
        const calls = (s.code.match(/\.scrollIntoView\s*\(/g) ?? []).length;
        const allowed = s.path.endsWith('SpeakerHandle.tsx')
          ? (s.code.match(ALLOWED) ?? []).length
          : 0;
        return calls > allowed;
      })
      .map((s) => s.path);
    expect(offenders).toEqual([]);
  });

  it('marks a replay that is playing, which is what the definition reads', () => {
    const replay = sources.find((s) => s.path.endsWith('Replay.tsx'))!;
    expect(replay.code).toMatch(/data-replay-playing=\{playing && !atEnd \? '' : undefined\}/);
  });

  it('never scrolls the window or the document', () => {
    const offenders = sources
      .filter(
        (s) =>
          /\b(window|document\.(documentElement|body)|scrollingElement)\s*\.\s*scroll(To|By)?\s*\(/.test(
            s.code,
          ) || /(^|[^.\w])scroll(To|By)?\s*\(/m.test(s.code),
      )
      .map((s) => s.path);
    expect(offenders).toEqual([]);
  });

  it('never moves focus without preventScroll', () => {
    const offenders = sources.flatMap((s) =>
      [...s.code.matchAll(/\.focus\(([^)]*)\)/g)]
        .filter((m) => !/preventScroll:\s*true/.test(m[1]!))
        .map(() => s.path),
    );
    expect(offenders).toEqual([]);
  });
});
