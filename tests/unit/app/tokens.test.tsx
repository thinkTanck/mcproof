import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import ErrorBoundary from '@/app/error';

/**
 * Locks the DTCG two-tier token layer shipped in this increment
 * (src/app/globals.css). These are regression guards for design work that is
 * already done, not RED-first specs:
 *   - every `var(--token)` reference resolves to a defined custom property
 *     (no dangling tokens — incl. the back-compat aliases error.tsx consumes:
 *     --panel / --border / --danger);
 *   - the AA-corrected text tiers actually clear WCAG 2.2 AA on their surfaces;
 *   - the 8-pt --sp-* scale and the global :focus-visible ring exist.
 *
 * The CSS is read as a fixture and resolved by a small local var()/color-mix
 * evaluator, because jsdom does not apply stylesheets or compute custom
 * properties — so a runtime getComputedStyle check would be vacuous here.
 */

// Vitest runs with cwd at the project root (see vitest.config.ts).
const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

/** Narrow away `undefined` from optional lookups (tsconfig noUncheckedIndexedAccess). */
function must<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null) throw new Error(message);
  return value;
}

/** Every file under `dir` (relative to the project root) whose name matches. */
function sourceFiles(dir: string, pattern: RegExp): string[] {
  return readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(rel, pattern);
    return pattern.test(entry.name) ? [rel] : [];
  });
}

const css = read('src/app/globals.css');
// Strip block comments (they carry token values in trailing notes) before parse.
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

// --- token table ----------------------------------------------------------

/** Parse `--name: value;` declarations from the :root block. */
function parseRootVars(source: string): Map<string, string> {
  const block = source.match(/:root\s*\{([\s\S]*?)\}/);
  const body = must(block?.[1], ':root block not found in globals.css');
  const vars = new Map<string, string>();
  for (const decl of body.split(';')) {
    const m = decl.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/s);
    if (m && m[1] && m[2]) vars.set(m[1], m[2].trim());
  }
  return vars;
}

const vars = parseRootVars(cssNoComments);

/** Every `var(--x)` reference anywhere in a source string. */
const tokenRefs = (source: string): string[] => [
  ...new Set(
    [...source.matchAll(/var\(\s*(--[\w-]+)/g)]
      .map((m) => m[1])
      .filter((v): v is string => Boolean(v)),
  ),
];

// --- color resolution + WCAG ----------------------------------------------

type RGB = [number, number, number];

function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.replace(/(.)/g, '$1$1') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * Resolve a CSS color value to an RGB triple, following var() chains and
 * compositing `color-mix(in srgb, X P%, transparent)` over `base` (the surface
 * a translucent panel is painted on).
 */
function resolveColor(value: string, base: RGB): RGB {
  const v = value.trim();

  const varRef = v.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/s);
  if (varRef && varRef[1]) {
    const name = varRef[1];
    const defined = vars.get(name);
    if (defined !== undefined) return resolveColor(defined, base);
    if (varRef[2]) return resolveColor(varRef[2], base);
    throw new Error(`undefined token referenced: ${name}`);
  }

  const mix = v.match(/^color-mix\(\s*in srgb\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*transparent\s*\)$/s);
  if (mix && mix[1] && mix[2]) {
    const fg = resolveColor(mix[1], base);
    const p = parseFloat(mix[2]) / 100;
    return [
      fg[0] * p + base[0] * (1 - p),
      fg[1] * p + base[1] * (1 - p),
      fg[2] * p + base[2] * (1 - p),
    ];
  }

  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) return hexToRgb(v);
  throw new Error(`cannot resolve color value: ${value}`);
}

function relativeLuminance([r, g, b]: RGB): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: RGB, b: RGB): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const surfaceBase = resolveColor('var(--surface-base)', [0, 0, 0]);
// Panel is translucent; its rendered background is composited over the base.
const surfacePanel = resolveColor('var(--surface-panel)', surfaceBase);

// --- specs ----------------------------------------------------------------

describe('DTCG token layer (globals.css)', () => {
  it('defines every custom property referenced in globals.css (no undefined tokens)', () => {
    // Injected at runtime by next/font on <html> (with a font-stack fallback in
    // the --font-* declarations), so not defined in the :root token block.
    // `--header-live-h` is the same kind: HeaderHeightSync writes the header's
    // measured height on <html> at runtime, and `--header-clear` falls back to
    // `--header-h` until it does. `--run-bar-clear` is a third: the run bar a
    // phone holds at the bottom writes its measured height there while it is
    // pinned, and the scroll padding that reads it falls back to 0.
    const externallyProvided = new Set([
      '--font-geist-sans',
      '--font-geist-mono',
      '--header-live-h',
      '--run-bar-clear',
    ]);
    const missing = tokenRefs(cssNoComments).filter(
      (name) => !vars.has(name) && !externallyProvided.has(name),
    );
    expect(missing).toEqual([]);
  });

  it('lifts the approved "Sentinel v2" primitive ramps verbatim', () => {
    const approved: Record<string, string> = {
      '--navy-950': '#05080b',
      '--navy-850': '#101823',
      '--navy-800': '#17212d',
      '--line-base': '#1c2a36',
      '--cyan-100': '#b6ecf4',
      '--cyan-300': '#54d4e6',
      '--cyan-700': '#2b6b7d',
      '--amber-400': '#ebb561',
      '--red-200': '#f58ea0',
      '--red-400': '#ed576e',
      '--ink-100': '#d3e2ea',
      '--ink-300': '#99b8c7',
      '--ink-500': '#708c9e',
      '--ink-700': '#6a8798',
    };
    for (const [name, hex] of Object.entries(approved)) {
      expect(vars.get(name)?.toLowerCase(), name).toBe(hex);
    }
  });

  it('defines and resolves the back-compat aliases error.tsx depends on', () => {
    // The audit's "error.tsx token fix": these aliases must exist and bottom
    // out in a real color, incl. the previously-undefined --panel/--border/--danger.
    for (const name of ['--panel', '--border', '--danger', '--accent', '--bg', '--fg', '--muted']) {
      expect(vars.has(name), `${name} defined`).toBe(true);
    }
    for (const name of ['--panel', '--border', '--danger']) {
      expect(() => resolveColor(`var(${name})`, surfaceBase)).not.toThrow();
    }
  });

  it('every active text role clears WCAG 2.2 AA (>=4.5:1) on base AND panel', () => {
    // --text-pending is inactive-only (WCAG 1.4.3 exempts not-reached/disabled), excluded.
    for (const token of [
      '--text',
      '--text-hi',
      '--text-muted',
      '--text-faint',
      '--text-readout',
      '--text-breach',
      '--reading-color',
      '--reading-color-hi',
      '--instrument-color',
      '--instrument-color-faint',
      '--display-color',
    ]) {
      const fg = resolveColor(`var(${token})`, surfaceBase);
      expect(contrast(fg, surfaceBase), `${token} on --surface-base`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(fg, surfacePanel), `${token} on --surface-panel`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the INERT fourth state clears AA on base AND panel and is never the breach red', () => {
    // --status-inert labels "not measurable" categories (ASI07/08/09 on /threats).
    // It carries icon + label + text, so it must clear AA as text, and it must
    // never be red (ADR-0003: red is reserved for an actual breach).
    const inert = resolveColor('var(--status-inert)', surfaceBase);
    expect(contrast(inert, surfaceBase), '--status-inert on --surface-base').toBeGreaterThanOrEqual(
      4.5,
    );
    expect(
      contrast(inert, surfacePanel),
      '--status-inert on --surface-panel',
    ).toBeGreaterThanOrEqual(4.5);
    const breach = resolveColor('var(--status-breach)', surfaceBase);
    expect(inert, '--status-inert must not be the breach red').not.toEqual(breach);
  });

  it('no READING (prose) size role resolves below the 16px floor', () => {
    const pxMin = (value: string): number => {
      const pxs = [...value.matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) =>
        parseFloat(must(m[1], 'px')),
      );
      if (pxs.length === 0) throw new Error(`no px value in reading size: ${value}`);
      return Math.min(...pxs);
    };
    for (const token of [
      '--reading-body',
      '--reading-lead',
      '--reading-h3',
      '--reading-h2',
      '--reading-h1',
    ]) {
      const v = must(vars.get(token), `${token} defined`);
      expect(pxMin(v), `${token} (${v}) is below the 16px prose floor`).toBeGreaterThanOrEqual(16);
    }
  });

  it('INSTRUMENT (telemetry) sizes are mono and within the 13–14px band', () => {
    expect(vars.get('--instrument-label')).toBe('13px');
    expect(vars.get('--instrument-base')).toBe('14px');
    expect(must(vars.get('--reading-font'), 'reading font')).toContain('sans');
    expect(must(vars.get('--instrument-font'), 'instrument font')).toContain('mono');
  });

  describe('INSTRUMENT line spacing: wrapping text breathes, one-line controls keep their size', () => {
    /** The declarations of the FIRST rule whose selector list is exactly `selector`. */
    const ruleBody = (selector: string): string => {
      const escaped = selector
        .split(',')
        .map((part) => part.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('\\s*,\\s*');
      const match = cssNoComments.match(new RegExp(`(?:^|[}{;])\\s*${escaped}\\s*\\{([^}]*)\\}`));
      return must(match?.[1], `no rule for ${selector} in globals.css`);
    };
    const lineHeightOf = (selector: string) =>
      must(ruleBody(selector).match(/line-height:\s*([^;]+);/)?.[1], `${selector} line-height`);

    it('the wrapping line-height is at least 1.5 (WCAG 1.4.12)', () => {
      // Small mono text that holds one line on a desk wraps on a phone. The
      // role default is the value that is safe to wrap, so a new label is
      // spaced correctly without anyone remembering to ask.
      const line = Number(must(vars.get('--instrument-line'), '--instrument-line'));
      expect(line).toBeGreaterThanOrEqual(1.5);
    });

    it('every INSTRUMENT role class takes the wrapping line-height by default', () => {
      // No role hardcodes a tighter number of its own (`.micro-label` used to,
      // at 1.2): a literal here is a role that has drifted off the token.
      for (const role of ['.instrument', '.instrument-faint', '.readout', '.micro-label']) {
        expect(lineHeightOf(role), role).toBe('var(--instrument-line)');
      }
    });

    it('the one-line control variant keeps exactly the values the roles had before', () => {
      // A chip, tag, button or bar readout that holds ONE line is sized by that
      // line. These are the pre-2026-10-10 role values, kept by name so those
      // boxes measure what they always did. Changing either resizes controls.
      expect(vars.get('--instrument-line-single')).toBe('1.3');
      expect(vars.get('--instrument-line-single-label')).toBe('1.2');
      expect(
        lineHeightOf('.instrument.one-line, .instrument-faint.one-line, .readout.one-line'),
      ).toBe('var(--instrument-line-single)');
      expect(lineHeightOf('.micro-label.one-line')).toBe('var(--instrument-line-single-label)');
    });

    it('the one-line variant is tighter than the wrapping one, so it can never be the default', () => {
      const wrapping = Number(vars.get('--instrument-line'));
      expect(Number(vars.get('--instrument-line-single'))).toBeLessThan(wrapping);
      expect(Number(vars.get('--instrument-line-single-label'))).toBeLessThan(wrapping);
    });

    it('stacked small-text blocks get more room than the 4px they had, from tokens', () => {
      // In rem: 16px root, so 0.75rem is 12px between blocks and 0.5rem is 8px
      // between the rows of one list. Rem and not px on purpose (see the role
      // distinctness spec below, which reads bare px `--instrument-*` as sizes).
      const rem = (name: string) => {
        const value = must(vars.get(name), name);
        expect(value, name).toMatch(/^\d*\.?\d+rem$/);
        return parseFloat(value) * 16;
      };
      const blocks = rem('--instrument-stack');
      const rows = rem('--instrument-stack-rows');
      expect(rows).toBeGreaterThan(4);
      expect(blocks).toBeGreaterThan(rows);
      // "A little more", not a new layout: still under one line of body text.
      expect(blocks).toBeLessThanOrEqual(16);
    });
  });

  it('READING body is the design 17px; h1 scales with the CONTAINER (cqi), never vw', () => {
    // THE PRINCIPLE (CLAUDE.md / ADR-0004): the design is the default reference
    // and a token role DESCRIBES it, it does not silently redesign it. DESIGN.md
    // §type sets body 17px / lead 18px and the CLAUDE.md READING scale reads
    // "17 body / 18 lead"; the token had drifted to an 18px "editorial target",
    // which is the role overruling the reference — the same failure mode as the
    // 65–75ch measure cap and DISPLAY-pinned-to-mono. 16px stays the AA floor,
    // asserted separately above; it is not the design's value.
    expect(vars.get('--reading-body')).toBe('17px');
    // Body and lead are distinct steps in the design, not one size twice: at 18/18
    // the lead paragraph had no size contrast with the prose under it at all.
    const pxOf = (name: string) => parseFloat(must(vars.get(name), name));
    expect(pxOf('--reading-lead')).toBeGreaterThan(pxOf('--reading-body'));
    const h1 = must(vars.get('--reading-h1'), '--reading-h1 defined');
    expect(h1, `${h1} must use a container unit (cqi/cqw), not the viewport`).toMatch(/cq[iwbh]/);
    expect(h1, `${h1} must not use vw — the deck-collapse overflow bug`).not.toMatch(/vw/);
    // The container is established on the shell <main> via .type-flow.
    expect(cssNoComments).toMatch(/\.type-flow\s*\{[^}]*container-type:\s*inline-size/);
  });

  it('NO type-size token anywhere uses a viewport unit', () => {
    // CLAUDE.md locks it for the whole scale, not just h1: "headline sizing is
    // cqi, never vw — the column tracks the command deck, not the viewport". A
    // viewport unit on any type size reintroduces the deck-collapse overflow, so
    // the guard sweeps every READING / INSTRUMENT / DISPLAY size token rather
    // than naming one.
    const sizeTokens = [...vars.entries()].filter(([name]) =>
      /^--(reading|instrument|display)-(body|lead|h1|h2|h3|label|base|sm|md|lg|xl)$/.test(name),
    );
    expect(sizeTokens.length, 'type-size tokens found').toBeGreaterThanOrEqual(11);
    for (const [name, value] of sizeTokens) {
      expect(value, `${name} (${value}) must not use a viewport unit`).not.toMatch(
        /\d(vw|vh|vmin|vmax|dvw|dvh|svw|svh|lvw|lvh)\b/,
      );
    }
  });

  it('DISPLAY (focal data values) is a display scale whose FAMILY the design owns', () => {
    expect(vars.get('--display-sm')).toBe('15px'); // heatmap cell value
    expect(vars.get('--display-md')).toBe('20px'); // OVERALL column
    expect(vars.get('--display-lg')).toBe('28px');
    expect(vars.get('--display-xl')).toBe('40px'); // hero counter
    // The role must NOT pin a family. The frozen design owns it (sans hero
    // counters, mono readouts); pinning mono rewrote the design. See ADR-0004.
    expect(vars.has('--display-font'), 'DISPLAY must not pin a font-family').toBe(false);
  });

  it('the THREE roles are distinct systems, not one mush', () => {
    // READING is the only sans register; INSTRUMENT is mono chrome; DISPLAY is
    // separated by SCALE (its family follows the design, so it cannot be the axis).
    expect(must(vars.get('--reading-font'), 'reading')).toContain('sans');
    expect(must(vars.get('--instrument-font'), 'instrument')).toContain('mono');
    const px = (name: string) => parseFloat(must(vars.get(name), name));

    // The INSTRUMENT ceiling is DERIVED from the instrument scale, not named —
    // CLAUDE.md's hard rule is that `--display-sm` and `--reading-body` both sit
    // above it, and pinning one token as "the ceiling" would let a NEW instrument
    // size be added above it without a single assertion moving. So this takes
    // every `--instrument-*` token whose value is a bare px length (the non-size
    // ones — font, line, tracking, colour — are stacks, ratios, em or var()
    // refs, and drop out on their own) and uses the largest.
    const instrumentSizes = [...vars.entries()]
      .filter(([name, value]) => name.startsWith('--instrument-') && /^\d+(\.\d+)?px$/.test(value))
      .map(([, value]) => parseFloat(value));
    expect(instrumentSizes.length, 'INSTRUMENT size tokens found').toBeGreaterThanOrEqual(2);
    const instrumentCeiling = Math.max(...instrumentSizes);

    // DISPLAY starts above the INSTRUMENT ceiling, so a focal value can never be
    // mistaken for a label, and prose never reaches down into either.
    expect(px('--display-sm'), 'DISPLAY floor above the INSTRUMENT ceiling').toBeGreaterThan(
      instrumentCeiling,
    );
    expect(px('--reading-body'), 'READING body above the INSTRUMENT ceiling').toBeGreaterThan(
      instrumentCeiling,
    );
  });

  it('READING pins no measure cap — the frozen design owns layout width', () => {
    // A 65–75ch role-level cap fought the design's columns (dead side-margins).
    expect(vars.has('--reading-measure'), 'READING must not pin a measure').toBe(false);
    expect(cssNoComments).not.toMatch(/max-inline-size:\s*var\(--reading-measure\)/);
  });

  it('exposes the full 8-pt --sp-* spacing scale in px', () => {
    const sp = [...vars.keys()].filter((k) => /^--sp-\d+$/.test(k));
    expect(sp.length).toBeGreaterThanOrEqual(8);
    for (const k of sp) {
      expect(must(vars.get(k), `${k} is a px value`)).toMatch(/^\d+px$/);
    }
    // 8-pt base anchor present and correct.
    expect(vars.get('--sp-8')).toBe('8px');
    expect(vars.get('--sp-16')).toBe('16px');
  });

  it('registers a global :focus-visible ring driven by the focus token', () => {
    const rule = cssNoComments.match(/:focus-visible[^{]*\{([^}]*)\}/);
    const decls = must(rule?.[1], ':focus-visible rule present');
    expect(decls).toMatch(/outline/);
    expect(decls).toMatch(/var\(--focus-ring\)/);
    expect(vars.has('--focus-ring')).toBe(true);
  });

  describe('THE TEXT FLOOR: nothing is set smaller than 12px (UI audit 2026-10-12)', () => {
    const floor = () => must(vars.get('--text-floor'), '--text-floor defined');

    it('the floor is a token, in px, and at least 12', () => {
      // In px on purpose: a floor that followed the root font size would sink
      // with it, which is the one case a floor exists for.
      expect(floor()).toMatch(/^\d+(\.\d+)?px$/);
      expect(parseFloat(floor())).toBeGreaterThanOrEqual(12);
    });

    it('no type-size token of any role resolves below the floor', () => {
      const min = parseFloat(floor());
      const sizeTokens = [...vars.entries()].filter(([name]) =>
        /^--(reading|instrument|display)-(body|lead|h1|h2|h3|label|base|sm|md|lg|xl)$/.test(name),
      );
      expect(sizeTokens.length, 'type-size tokens found').toBeGreaterThanOrEqual(11);
      for (const [name, value] of sizeTokens) {
        const pxs = [...value.matchAll(/(\d+(?:\.\d+)?)px/g)].map((m) =>
          parseFloat(must(m[1], 'px')),
        );
        expect(pxs.length, `${name} (${value}) names a px size`).toBeGreaterThan(0);
        expect(Math.min(...pxs), `${name} (${value}) is under the floor`).toBeGreaterThanOrEqual(
          min,
        );
      }
    });

    it('the smallest Tailwind step (text-xs) is clamped to the floor, so it cannot follow a small root below it', () => {
      // `text-xs` is 0.75rem: 12px at the default root, 9px in a browser whose
      // text size is turned down to 12. max() keeps the rem (so enlarged text
      // still grows) and stops it at the floor on the way down.
      const theme = must(
        cssNoComments.match(/@theme inline\s*\{([\s\S]*?)\}/)?.[1],
        '@theme inline block',
      );
      expect(theme).toMatch(/--text-xs:\s*max\(\s*0\.75rem\s*,\s*var\(--text-floor\)\s*\)/);
    });

    it('no component sets a literal size at or under the floor: 12px is spelled as the token', () => {
      // A class-list guard. `text-[12px]` is the floor written as a number, and
      // anything smaller is under it; both are spelled `text-(length:--text-floor)`
      // or a role class instead. Also catches rem and em literals under 0.75.
      const min = parseFloat(floor());
      const offenders: string[] = [];
      for (const file of sourceFiles('src', /\.tsx?$/)) {
        const source = read(file);
        for (const m of source.matchAll(/text-\[(\d*\.?\d+)(px|rem|em)\]/g)) {
          const px = parseFloat(must(m[1], 'size')) * (m[2] === 'px' ? 1 : 16);
          if (px <= min) offenders.push(`${file}: ${m[0]}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  describe('THE FOCUS RING: one ring, from tokens, on everything the keyboard can reach', () => {
    /** Every rule in globals.css whose selector mentions :focus-visible. */
    const focusRules = () =>
      [...cssNoComments.matchAll(/(?:^|[}{;])\s*([^{};]*:focus-visible[^{};]*)\{([^}]*)\}/g)].map(
        (m) => ({ selector: must(m[1], 'selector').trim(), body: must(m[2], 'body') }),
      );
    const ringRules = () => focusRules().filter((rule) => /(^|[;\s])outline\s*:/.test(rule.body));

    it('the ring tokens exist: a width of at least 2px, an outside offset and an inside one', () => {
      expect(parseFloat(must(vars.get('--focus-ring-width'), 'width'))).toBeGreaterThanOrEqual(2);
      expect(must(vars.get('--focus-ring-width'), 'width')).toMatch(/^\d+px$/);
      expect(must(vars.get('--focus-ring-offset'), 'offset')).toMatch(/^\d+px$/);
      // Inside a box that clips, the ring is drawn just inside the control: the
      // negative of its own width, derived, so the two can never disagree.
      expect(must(vars.get('--focus-ring-offset-inside'), 'inside offset')).toBe(
        'calc(var(--focus-ring-width) * -1)',
      );
      // What the rule reads. Outside by default; `focus-inside` swaps it.
      expect(vars.get('--focus-ring-place')).toBe('var(--focus-ring-offset)');
    });

    it('the ring colour is at least 3:1 on every surface a control sits on', () => {
      const ring = resolveColor('var(--focus-ring)', surfaceBase);
      for (const surface of [
        '--surface-base',
        '--surface-panel',
        '--surface-solid',
        '--surface-raised',
        '--terminal-chrome',
      ]) {
        const bg = resolveColor(`var(${surface})`, surfaceBase);
        expect(contrast(ring, bg), `--focus-ring on ${surface}`).toBeGreaterThanOrEqual(3);
      }
    });

    it('exactly ONE rule draws the ring, and it is the bare :focus-visible', () => {
      // Bare, so nothing focusable is left out: links, buttons, inputs, tabs,
      // summary, anything with a tabindex. A list of tag names is a list that
      // someone forgets to extend.
      const rules = ringRules();
      expect(rules.map((rule) => rule.selector)).toEqual([':focus-visible']);
    });

    it('the ring is an outline and nothing else, so focus can never move the layout', () => {
      // outline and outline-offset take no room in the layout and survive
      // forced-colors. A border, a shadow or a radius here would redraw the
      // control itself; the old rule set a radius and overrode every control's own.
      const props = must(ringRules()[0], 'ring rule')
        .body.split(';')
        .map((decl) => decl.split(':')[0]?.trim())
        .filter(Boolean);
      expect(props.sort()).toEqual(['outline', 'outline-offset']);
      const body = must(ringRules()[0], 'ring rule').body;
      expect(body).toMatch(/outline:\s*var\(--focus-ring-width\)\s+solid\s+var\(--focus-ring\)/);
      expect(body).toMatch(/outline-offset:\s*var\(--focus-ring-place\)/);
    });

    it('the ring rule is not inside a layer, so no utility beside it can switch it off', () => {
      // Unlayered beats every layer (see the note on the role classes above).
      const at = cssNoComments.indexOf(':focus-visible {');
      expect(at).toBeGreaterThan(-1);
      const before = cssNoComments.slice(0, at);
      const opens = (before.match(/\{/g) ?? []).length;
      const closes = (before.match(/\}/g) ?? []).length;
      expect(opens - closes, 'the ring rule sits at the top level').toBe(0);
    });

    it('the inside placement is a utility that only moves the offset', () => {
      const utility = must(
        cssNoComments.match(/@utility focus-inside\s*\{([^}]*)\}/)?.[1],
        '@utility focus-inside',
      );
      expect(utility.trim()).toBe('--focus-ring-place: var(--focus-ring-offset-inside);');
    });

    it('no component removes the ring or draws one of its own', () => {
      // `focus:outline-none` beside a control was dead code (the unlayered rule
      // won) and read as if the ring were off; a `focus-visible:outline-*` or a
      // `ring-*` is a second ring. Either is a per-component focus style.
      const offenders: string[] = [];
      for (const file of sourceFiles('src', /\.tsx?$/)) {
        const source = read(file);
        for (const m of source.matchAll(
          /\b(?:focus|focus-visible|focus-within):(?:outline|ring)[\w\-[\]:().]*|\boutline-(?:none|hidden)\b/g,
        )) {
          offenders.push(`${file}: ${m[0]}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  describe('POINTER TARGETS: at least 44px, from a token (UI audit 2026-10-12, batch B)', () => {
    it('the smallest target is a token, in px, and at least 44', () => {
      const min = must(vars.get('--target-min'), '--target-min defined');
      // px, not rem: a target must not shrink when the browser text is turned down.
      expect(min).toMatch(/^\d+px$/);
      expect(parseFloat(min)).toBeGreaterThanOrEqual(44);
    });

    it('target-min sets the width and the height from the token and nothing else', () => {
      const utility = must(
        cssNoComments.match(/@utility target-min\s*\{([^}]*)\}/)?.[1],
        '@utility target-min',
      );
      const decls = utility
        .split(';')
        .map((decl) => decl.trim())
        .filter(Boolean);
      expect(decls).toEqual(['min-width: var(--target-min)', 'min-height: var(--target-min)']);
    });

    it('target-area lays a hit area of the token size over the control and takes no room', () => {
      const utility = must(
        cssNoComments.match(/@utility target-area\s*\{([\s\S]*?\})\s*\}/)?.[1],
        '@utility target-area',
      );
      // The control only becomes the box the hit area is placed against.
      expect(utility.split('&::after')[0]?.trim()).toBe('position: relative;');
      const after = must(utility.match(/&::after\s*\{([^}]*)\}/)?.[1], 'the ::after rule');
      // Out of the flow, so it moves nothing; at least the token each way; centred.
      expect(after).toMatch(/position:\s*absolute/);
      expect(after).toMatch(/width:\s*max\(\s*100%\s*,\s*var\(--target-min\)\s*\)/);
      expect(after).toMatch(/height:\s*max\(\s*100%\s*,\s*var\(--target-min\)\s*\)/);
      expect(after).toMatch(/transform:\s*translate\(-50%,\s*-50%\)/);
    });

    it('the place the run-controls skip link lands draws its ring inside and takes no scroll margin', () => {
      const rule = must(cssNoComments.match(/#run-controls\s*\{([^}]*)\}/)?.[1], '#run-controls');
      const decls = rule
        .split(';')
        .map((decl) => decl.trim())
        .filter(Boolean);
      expect(decls).toEqual([
        '--focus-ring-place: var(--focus-ring-offset-inside)',
        'scroll-margin-top: 0',
      ]);
    });

    it('the bar beside the current nav item is a token, in px, at least 2', () => {
      const width = must(vars.get('--nav-indicator-width'), '--nav-indicator-width defined');
      expect(width).toMatch(/^\d+px$/);
      expect(parseFloat(width)).toBeGreaterThanOrEqual(2);
    });

    it('no control is held to a floor smaller than the token', () => {
      // `min-h-6` (24px) was the WCAG 2.5.8 minimum, spelled beside three
      // controls; the owner's floor is 44. A control that needs a floor takes
      // the token (`target-min`, `min-h-(--target-min)`) or the 44px step.
      const offenders: string[] = [];
      for (const file of sourceFiles('src', /\.tsx$/)) {
        const source = read(file);
        for (const m of source.matchAll(/\bmin-[hw]-(?:[1-9]|10)\b(?![.\d])/g)) {
          offenders.push(`${file}: ${m[0]}`);
        }
      }
      expect(offenders).toEqual([]);
    });
  });

  describe('HEADLINE LINE-HEIGHT: 1.2 to 1.3, from tokens (UI audit 2026-10-12, batch D)', () => {
    // A headline that wraps needs room between its lines. The page headline was
    // at 1.1, where the descenders of one line touch the capitals of the next,
    // and the smallest heading was at 1.35. Each heading role now reads its
    // line-height from a token of its own, and every one sits in the band.
    const HEADINGS = ['h1', 'h2', 'h3'] as const;
    const body = (selector: string): string => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = cssNoComments.match(new RegExp(`(?:^|[}{;])\\s*${escaped}\\s*\\{([^}]*)\\}`));
      return must(match?.[1], `no rule for ${selector} in globals.css`);
    };

    it.each(HEADINGS)('--reading-%s-line is a bare ratio between 1.2 and 1.3', (h) => {
      const value = must(vars.get(`--reading-${h}-line`), `--reading-${h}-line defined`);
      // Unitless on purpose: a ratio follows the heading's own size at any zoom.
      expect(value).toMatch(/^\d(\.\d+)?$/);
      expect(parseFloat(value)).toBeGreaterThanOrEqual(1.2);
      expect(parseFloat(value)).toBeLessThanOrEqual(1.3);
    });

    it.each(HEADINGS)('.reading-%s takes its line-height from its token, not a literal', (h) => {
      const lineHeight = must(
        body(`.reading-${h}`).match(/line-height:\s*([^;]+);/)?.[1],
        `.reading-${h} line-height`,
      );
      expect(lineHeight.trim()).toBe(`var(--reading-${h}-line)`);
    });

    it('a larger heading is never looser than a smaller one', () => {
      const ratio = (h: string) => parseFloat(must(vars.get(`--reading-${h}-line`), h));
      expect(ratio('h1')).toBeLessThanOrEqual(ratio('h2'));
      expect(ratio('h2')).toBeLessThanOrEqual(ratio('h3'));
    });

    it('a focal value is not a headline: DISPLAY keeps its own tight line', () => {
      // The step numeral and the one-line readouts are sized by one line.
      expect(vars.get('--display-line')).toBe('1.05');
    });

    it('body prose keeps its own, looser line', () => {
      expect(vars.get('--reading-line')).toBe('1.6');
    });
  });
});

describe('error boundaries consume only defined tokens', () => {
  it.each(['src/app/error.tsx', 'src/app/global-error.tsx'])(
    '%s references only defined tokens',
    (rel) => {
      const missing = tokenRefs(read(rel)).filter((name) => !vars.has(name));
      expect(missing).toEqual([]);
    },
  );

  it('renders error.tsx with defined, resolvable tokens', () => {
    render(<ErrorBoundary error={new Error('boom')} reset={() => {}} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    for (const name of tokenRefs(read('src/app/error.tsx'))) {
      expect(vars.has(name), `token ${name} is defined`).toBe(true);
    }
  });
});
