import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { sampleRun } from '@/data/source';
import { SAMPLE_CATEGORY } from '@/data/sample-category';
import { OPERATOR_HANDLE, agentHandle } from '@/lib/replay/roles';
import { flags } from '@/lib/replay/command-line';
import { LOGO_RING, LOGO_WORDMARK } from '@/components/shell/LogoRing';
import type { Step } from '@/contract';

/**
 * THE LINK PREVIEW CARD (2026-11-04).
 *
 * Sharing mcproof.dev used to show a title and a sentence and no card, because
 * the site had no og:image. This is that image: one PNG, 1200 by 630, drawn
 * by next/og, served at `/opengraph-image` and, the same bytes, at
 * `/twitter-image` (the two route files only re-export this).
 *
 * WHAT IS ON IT. The lockup (the ring and the MCProof wordmark, as `LogoLockup`
 * draws them) and an excerpt of a real replay: the featured
 * sample's opening task, its first tool call, and the step its recorded
 * verdict anchors, in breach red, then COMPROMISED AT STEP n. The excerpt is
 * read off the sample trace and the recorded verdict, never typed, so the card
 * can only say what the replay says. Nothing on it names a person.
 *
 * NO HEADLINE, AND A WIDE MARGIN (option B, 2026-11-04). The card used to carry
 * a 60px headline, which read far too large, and LinkedIn crops the card's
 * sides, which cut it to "an your AI agent". The page's og:title and
 * og:description carry the words; the card carries the lockup and the terminal,
 * and nothing is drawn in the outer tenth of its width (`SHARE_CARD_LAYOUT`).
 * The terminal wraps each line inside its column, so no line can run into that
 * margin; `wrapTerminalLine` counts the rows (never fewer than are drawn) and a
 * line it cannot fit is refused, not drawn.
 *
 * WHERE THE COLOURS COME FROM. next/og draws with its own renderer, which
 * reads no CSS variables, so each colour is the hex of a primitive token in
 * `src/app/globals.css`, named in `SHARE_CARD_TOKENS`, and a unit test holds
 * every value to the stylesheet.
 *
 * THE FONTS are Geist and Geist Mono, the site's own families, read from
 * `assets/og-fonts` (the TTFs of the `geist` package, SIL Open Font License,
 * copied there because the renderer cannot read the woff2 the site serves).
 */

/** The card's size, the one Open Graph and Twitter both draw at 1.91:1. */
export const SHARE_CARD_SIZE = { width: 1200, height: 630 } as const;

/** og:image:alt and twitter:image:alt: what the card shows, in words. */
export const SHARE_CARD_ALT =
  'MCProof. A replay of an AI agent reading a file outside its task, marked compromised at step 6.';

/**
 * Where everything sits, in pixels of the 1200 by 630 card. The renderer takes
 * these as its styles, and the unit test reads the same numbers, so the margin
 * and the fit are checked without decoding the image.
 */
export const SHARE_CARD_LAYOUT = {
  /** Left and right: 10% of the width, so a crop of the sides cuts nothing. */
  marginX: 120,
  marginY: 56,
  ringSize: 52,
  wordmarkSize: 40,
  /** Between the lockup and the terminal. */
  lockupGap: 40,
  terminalFont: 26,
  terminalLineHeight: 1.5,
  terminalPadX: 32,
  terminalPadY: 28,
  /** Between a prompt and its text. */
  promptGap: 12,
  /** Above the verdict line. */
  verdictGap: 12,
  /** Geist Mono's advance width, in ems: 600 of 1000 units, every glyph. */
  monoAdvance: 0.6,
} as const;

/** Which primitive token each colour on the card is. */
export const SHARE_CARD_TOKENS = {
  base: 'navy-950',
  line: 'line-base',
  ring: 'cyan-700',
  nominal: 'cyan-300',
  readout: 'cyan-100',
  ink: 'ink-100',
  prompt: 'amber-200',
  breach: 'red-400',
  breachText: 'red-200',
} as const;

/** The hex of each token, as `globals.css` defines it (held there by test). */
export const SHARE_CARD_COLORS: Record<keyof typeof SHARE_CARD_TOKENS, string> = {
  base: '#05080b',
  line: '#1c2a36',
  ring: '#2b6b7d',
  nominal: '#54d4e6',
  readout: '#b6ecf4',
  ink: '#d3e2ea',
  prompt: '#f4ce8c',
  breach: '#ed576e',
  breachText: '#f8a5b3',
};

/** An sRGB mix of two hex colours, `a` at `weight`, as CSS `color-mix(in srgb)` does. */
export function mixHex(a: string, b: string, weight: number): string {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const mixed = [0, 1, 2].map((i) =>
    Math.round(ch(a, i) * weight + ch(b, i) * (1 - weight))
      .toString(16)
      .padStart(2, '0'),
  );
  return `#${mixed.join('')}`;
}

/**
 * The replay terminal's surface, `--terminal-bg`: `color-mix(in srgb,
 * var(--navy-950) 80%, #000)`, worked out here because the renderer has no
 * color-mix. The unit test holds the stylesheet to that definition.
 */
export const SHARE_CARD_TERMINAL_BG = mixHex(SHARE_CARD_COLORS.base, '#000000', 0.8);

/** One line of the card's terminal. */
export interface ShareCardLine {
  readonly kind: 'input' | 'cmd' | 'breach' | 'verdict';
  /** The shell prompt the line is printed after, as the replay prints it. */
  readonly prompt?: string;
  readonly text: string;
}

/** The longest an operator line may run before it is cut, so it fits two rows. */
const INPUT_CHARS = 58;

/** `text` cut to `max` characters at the last whole word, with an ellipsis. */
export function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const space = head.lastIndexOf(' ');
  return `${(space > 0 ? head.slice(0, space) : head).replace(/[\s,.;:]+$/, '')}…`;
}

/**
 * How a line wraps in the terminal, worked out so it can only OVERCOUNT rows.
 *
 * - Every glyph is measured at `monoAdvance`, the widest advance Geist Mono has
 *   (a unit test reads it off the font), so a row never holds fewer glyphs than
 *   this assumes.
 * - The text breaks only after a space or a slash, and a trailing space is
 *   counted as if it took room. The renderer's text is `wordBreak: 'break-all'`,
 *   so it may break at those places and anywhere else: a greedy wrap with more
 *   places to break never needs more rows.
 * - A run with no space or slash that is wider than the column is `overflow`:
 *   this check will not vouch for it, and the card refuses to draw it.
 */
export function wrapTerminalLine(line: ShareCardLine): { rows: number; overflow: boolean } {
  if (line.kind === 'verdict') return { rows: 1, overflow: false };
  const L = SHARE_CARD_LAYOUT;
  const glyph = L.terminalFont * L.monoAdvance;
  const inner = SHARE_CARD_SIZE.width - 2 * L.marginX - 2 * L.terminalPadX - 2;
  const column = inner - (line.prompt ?? '').length * glyph - L.promptGap;
  const perRow = Math.floor(column / glyph);
  const segments = line.text.match(/[^ /]*[ /]|[^ /]+/g) ?? [];
  let rows = 1;
  let used = 0;
  let overflow = false;
  for (const segment of segments) {
    if (segment.replace(/ $/, '').length > perRow) overflow = true;
    if (used > 0 && used + segment.length > perRow) {
      rows += 1;
      used = 0;
    }
    used += segment.length;
  }
  return { rows, overflow };
}

/** The rows a line takes; throws when a line overflows its column. */
export function terminalRows(line: ShareCardLine): number {
  const { rows, overflow } = wrapTerminalLine(line);
  if (overflow) {
    throw new Error(`share card line overflows its column: ${line.text}`);
  }
  return rows;
}

function commandOf(step: Step): string {
  if (step.type !== 'tool_call') throw new Error(`step ${step.id} is not a tool call`);
  return `${step.tool} ${flags(step.args)}`.trim();
}

/**
 * The excerpt, from the featured sample: its task, its first tool call, the
 * anchored step, and the verdict line. Fails loudly if the sample stops being
 * a compromise anchored on a tool call, rather than draw a card that lies.
 */
export function shareCardTranscript(): ShareCardLine[] {
  const run = sampleRun(SAMPLE_CATEGORY);
  const { steps } = run.trace;
  const anchorId = run.verdict.stepId;
  if (!run.verdict.compromised || anchorId === undefined) {
    throw new Error('the featured sample is no longer a compromise');
  }
  const task = steps.find((s) => s.type === 'principal_instruction');
  const firstCall = steps.find((s) => s.type === 'tool_call');
  const anchor = steps.find((s) => s.id === anchorId);
  if (task?.type !== 'principal_instruction' || !firstCall || !anchor) {
    throw new Error('the featured sample is missing a step the card draws');
  }
  const n = /^s(\d+)$/.exec(anchorId)?.[1];
  if (n === undefined) throw new Error(`unexpected step id ${anchorId}`);
  const agent = `${agentHandle(run.trace.model)}:~$`;
  return [
    { kind: 'input', prompt: `${OPERATOR_HANDLE}:~$`, text: cut(task.content, INPUT_CHARS) },
    { kind: 'cmd', prompt: agent, text: commandOf(firstCall) },
    { kind: 'breach', prompt: agent, text: commandOf(anchor) },
    { kind: 'verdict', text: `COMPROMISED AT STEP ${n}` },
  ];
}

const FONT_DIR = join(process.cwd(), 'assets', 'og-fonts');

async function font(file: string): Promise<ArrayBuffer> {
  const bytes = await readFile(join(FONT_DIR, file));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const C = SHARE_CARD_COLORS;
const MONO = 'Geist Mono';
const SANS = 'Geist';

/** The logo ring, from `LogoRing`'s own geometry, at rest (the card does not turn). */
function Ring({ size }: { size: number }) {
  const { center, radius } = LOGO_RING;
  return (
    <svg width={size} height={size} viewBox={LOGO_RING.viewBox}>
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={C.ring}
        strokeWidth={LOGO_RING.trackWidth}
      />
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={C.nominal}
        strokeWidth={LOGO_RING.arcWidth}
        strokeLinecap="round"
        strokeDasharray={LOGO_RING.arcDash}
      />
      <circle cx={center} cy={center} r={LOGO_RING.hubRadius} fill={C.nominal} />
    </svg>
  );
}

/** The breach diamond the replay draws beside the compromise step. */
function Diamond({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10">
      <path d="M5 0.6 9.4 5 5 9.4 0.6 5Z" fill={C.breach} />
    </svg>
  );
}

const L = SHARE_CARD_LAYOUT;

function TerminalLine({ line }: { line: ShareCardLine }) {
  if (line.kind === 'verdict') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', marginTop: L.verdictGap, gap: 14 }}>
        <Diamond size={20} />
        <span style={{ color: C.breach, fontWeight: 600, letterSpacing: '0.08em' }}>
          {line.text}
        </span>
      </div>
    );
  }
  const breach = line.kind === 'breach';
  return (
    <div style={{ display: 'flex' }}>
      <span style={{ color: C.prompt, marginRight: L.promptGap, flexShrink: 0 }}>
        {line.prompt}
      </span>
      <span
        style={{
          color: breach ? C.breachText : C.readout,
          flexGrow: 1,
          flexShrink: 1,
          wordBreak: 'break-all',
        }}
      >
        {line.text}
      </span>
    </div>
  );
}

/** The card's element tree: the lockup over the terminal, inside the margins. */
export function shareCardElement(lines: readonly ShareCardLine[]) {
  // A line this check cannot fit is refused, not drawn past its box.
  for (const line of lines) terminalRows(line);
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        paddingTop: L.marginY,
        paddingBottom: L.marginY,
        paddingLeft: L.marginX,
        paddingRight: L.marginX,
        background: C.base,
        fontFamily: SANS,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Ring size={L.ringSize} />
        <div
          style={{
            display: 'flex',
            fontFamily: MONO,
            fontWeight: 600,
            fontSize: L.wordmarkSize,
            letterSpacing: '0.09em',
            color: C.ink,
          }}
        >
          {LOGO_WORDMARK.lead}
          <span style={{ color: C.nominal }}>{LOGO_WORDMARK.accent}</span>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          flexGrow: 1,
          marginTop: L.lockupGap,
          paddingTop: L.terminalPadY,
          paddingBottom: L.terminalPadY,
          paddingLeft: L.terminalPadX,
          paddingRight: L.terminalPadX,
          borderRadius: 12,
          border: `1px solid ${C.line}`,
          background: SHARE_CARD_TERMINAL_BG,
          fontFamily: MONO,
          fontSize: L.terminalFont,
          lineHeight: L.terminalLineHeight,
          overflow: 'hidden',
        }}
      >
        {lines.map((line) => (
          <TerminalLine key={line.kind} line={line} />
        ))}
      </div>
    </div>
  );
}

/** The card, as an image response. Both route files return exactly this. */
export async function renderShareCard(): Promise<ImageResponse> {
  const [mono, monoBold, sansBold] = await Promise.all([
    font('GeistMono-Regular.ttf'),
    font('GeistMono-SemiBold.ttf'),
    font('Geist-SemiBold.ttf'),
  ]);
  return new ImageResponse(shareCardElement(shareCardTranscript()), {
    ...SHARE_CARD_SIZE,
    fonts: [
      { name: MONO, data: mono, weight: 400, style: 'normal' },
      { name: MONO, data: monoBold, weight: 600, style: 'normal' },
      { name: SANS, data: sansBold, weight: 600, style: 'normal' },
    ],
  });
}
