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
 * draws them), one line of copy, and an excerpt of a real replay: the featured
 * sample's opening task, its first tool call, and the step its recorded
 * verdict anchors, in breach red, then COMPROMISED AT STEP n. The excerpt is
 * read off the sample trace and the recorded verdict, never typed, so the card
 * can only say what the replay says. Nothing on it names a person.
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

/** The line under the lockup, word for word. */
export const SHARE_CARD_HEADLINE = 'Can your AI agent be tricked into misusing its tools?';

/** og:image:alt and twitter:image:alt: what the card shows, in words. */
export const SHARE_CARD_ALT =
  'MCProof. Can your AI agent be tricked into misusing its tools? A replay of an AI agent ' +
  'reading a file outside its task, marked compromised at step 6.';

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

/** The longest an operator line may run before it is cut, so it fits one row. */
const INPUT_CHARS = 58;

/** `text` cut to `max` characters at the last whole word, with an ellipsis. */
export function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const space = head.lastIndexOf(' ');
  return `${(space > 0 ? head.slice(0, space) : head).replace(/[\s,.;:]+$/, '')}…`;
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

function TerminalLine({ line }: { line: ShareCardLine }) {
  if (line.kind === 'verdict') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 10, gap: 12 }}>
        <Diamond size={16} />
        <span style={{ color: C.breach, fontWeight: 600, letterSpacing: '0.08em' }}>
          {line.text}
        </span>
      </div>
    );
  }
  const breach = line.kind === 'breach';
  return (
    <div style={{ display: 'flex', whiteSpace: 'nowrap' }}>
      <span style={{ color: C.prompt, marginRight: 12 }}>{line.prompt}</span>
      <span style={{ color: breach ? C.breachText : C.readout }}>{line.text}</span>
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
  const lines = shareCardTranscript();
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '56px 64px',
        background: C.base,
        fontFamily: SANS,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <Ring size={52} />
        <div
          style={{
            display: 'flex',
            fontFamily: MONO,
            fontWeight: 600,
            fontSize: 40,
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
          fontSize: 60,
          fontWeight: 600,
          lineHeight: 1.15,
          letterSpacing: '-0.01em',
          color: C.ink,
          maxWidth: 1000,
        }}
      >
        {SHARE_CARD_HEADLINE}
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          padding: '22px 28px',
          borderRadius: 12,
          border: `1px solid ${C.line}`,
          background: SHARE_CARD_TERMINAL_BG,
          fontFamily: MONO,
          fontSize: 19,
          lineHeight: 1.6,
          overflow: 'hidden',
        }}
      >
        {lines.map((line) => (
          <TerminalLine key={line.kind} line={line} />
        ))}
      </div>
    </div>,
    {
      ...SHARE_CARD_SIZE,
      fonts: [
        { name: MONO, data: mono, weight: 400, style: 'normal' },
        { name: MONO, data: monoBold, weight: 600, style: 'normal' },
        { name: SANS, data: sansBold, weight: 600, style: 'normal' },
      ],
    },
  );
}
