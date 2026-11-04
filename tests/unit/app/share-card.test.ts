// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ogImage from '@/app/opengraph-image';
import * as twitterImage from '@/app/twitter-image';
import {
  SHARE_CARD_ALT,
  SHARE_CARD_COLORS,
  SHARE_CARD_LAYOUT,
  SHARE_CARD_SIZE,
  SHARE_CARD_TERMINAL_BG,
  SHARE_CARD_TOKENS,
  cut,
  mixHex,
  shareCardElement,
  shareCardTranscript,
  fitTerminalLine,
  renderShareCard,
  terminalRows,
  wrapTerminalLine,
  type ShareCardLine,
} from '@/lib/og/share-card';
import { isValidElement, type CSSProperties, type ReactNode } from 'react';
import { logger } from '@/lib/logger';
import { SAMPLE_CATEGORY } from '@/data/sample-category';
import { SAMPLE_VERDICTS } from '@/data/fixtures/sample-verdicts';

/**
 * THE LINK PREVIEW CARD (2026-11-04). Sharing mcproof.dev showed text and no
 * card, because the site had no og:image. One image, 1200 by 630, PNG, built
 * with next/og from the site's own tokens, served as both the Open Graph image
 * and the Twitter image.
 */

/** Width and height off a PNG's IHDR chunk: bytes 16 to 24, big-endian. */
function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A breach line with one 48-letter run and no space or slash in it. */
const UNBROKEN: ShareCardLine = {
  kind: 'breach',
  prompt: 'target-agent@sentinel:~$',
  text: `curl --data=${'A'.repeat(48)}`,
};

/** Today's transcript with its breach line swapped for `UNBROKEN`. */
function withUnbroken(): ShareCardLine[] {
  const lines = shareCardTranscript();
  return [...lines.slice(0, 2), UNBROKEN, lines[3]!];
}

async function render(mod: typeof ogImage) {
  const response = await mod.default();
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { response, bytes };
}

describe('the share card image', () => {
  it('declares 1200 by 630, PNG, with alt text', () => {
    expect(ogImage.size).toEqual({ width: 1200, height: 630 });
    expect(ogImage.contentType).toBe('image/png');
    expect(ogImage.alt).toBe(SHARE_CARD_ALT);
    expect(SHARE_CARD_ALT.length).toBeGreaterThan(20);
  });

  it('renders a 200 image/png that is really 1200 by 630', async () => {
    const { response, bytes } = await render(ogImage);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect([...bytes.slice(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(pngSize(bytes)).toEqual({ width: 1200, height: 630 });
  }, 30_000);

  it('is the same image as the Twitter image', async () => {
    expect(twitterImage.size).toEqual(ogImage.size);
    expect(twitterImage.contentType).toBe(ogImage.contentType);
    expect(twitterImage.alt).toBe(ogImage.alt);
    const [a, b] = await Promise.all([render(ogImage), render(twitterImage)]);
    expect(Buffer.from(b.bytes).equals(Buffer.from(a.bytes))).toBe(true);
  }, 30_000);
});

/**
 * The card's element tree, with every function component called, so a test can
 * read what is drawn and how it is placed without decoding pixels.
 */
interface Drawn {
  style: CSSProperties;
  text: string[];
  children: Drawn[];
}

function expand(node: ReactNode): Drawn[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') {
    return [{ style: {}, text: [String(node)], children: [] }];
  }
  if (Array.isArray(node)) return node.flatMap(expand);
  if (!isValidElement(node)) return [];
  const props = node.props as { style?: CSSProperties; children?: ReactNode };
  if (typeof node.type === 'function') {
    return expand((node.type as (p: unknown) => ReactNode)(props));
  }
  return [{ style: props.style ?? {}, text: [], children: expand(props.children) }];
}

function allText(d: Drawn[]): string {
  return d.map((n) => [...n.text, allText(n.children)].join('')).join('\n');
}

function allStyles(d: Drawn[]): CSSProperties[] {
  return d.flatMap((n) => [n.style, ...allStyles(n.children)]);
}

/**
 * OPTION B (2026-11-04). The headline was far too large, and LinkedIn crops the
 * card's sides, which cut it to "an your AI agent". The card is now the lockup
 * and the replay terminal, and nothing is drawn in the outer tenth of its width.
 */
describe('the share card layout', () => {
  const root = expand(shareCardElement(shareCardTranscript()))[0]!;
  const L = SHARE_CARD_LAYOUT;
  const contentWidth = SHARE_CARD_SIZE.width - 2 * L.marginX;

  it('draws no headline: the lockup and the terminal only', () => {
    const text = allText([root]);
    expect(text).not.toMatch(/tricked|misusing/i);
    expect(SHARE_CARD_ALT).not.toMatch(/tricked|misusing/i);
    expect(root.children).toHaveLength(2);
  });

  it('keeps every text and the logo out of the outer 10% on each side', () => {
    expect(L.marginX).toBeGreaterThanOrEqual(SHARE_CARD_SIZE.width * 0.1);
    // The one box everything is drawn in is padded by that margin.
    expect(root.style.paddingLeft).toBe(L.marginX);
    expect(root.style.paddingRight).toBe(L.marginX);
    for (const style of allStyles([root])) {
      // Nothing is lifted out of the flow, pulled outward, or wider than the box.
      expect(style.position).not.toBe('absolute');
      for (const key of ['marginLeft', 'marginRight', 'left', 'right'] as const) {
        const v = style[key];
        if (typeof v === 'number') expect(v).toBeGreaterThanOrEqual(0);
      }
      for (const key of ['width', 'maxWidth', 'minWidth'] as const) {
        const v = style[key];
        if (typeof v === 'number' && style !== root.style) {
          expect(v).toBeLessThanOrEqual(contentWidth);
        }
      }
    }
  });

  it('fits the whole terminal on the card, every line wrapped inside its box', () => {
    const lines = shareCardTranscript();
    const rows = lines.reduce((sum, line) => sum + terminalRows(line), 0);
    const lineBox = L.terminalFont * L.terminalLineHeight;
    const terminalHeight = rows * lineBox + L.verdictGap + 2 * L.terminalPadY + 2;
    const available = SHARE_CARD_SIZE.height - 2 * L.marginY - L.ringSize - L.lockupGap;
    expect(terminalHeight).toBeLessThanOrEqual(available);
    // No line runs past three rows, so none is a wall of text.
    for (const line of lines) expect(terminalRows(line)).toBeLessThanOrEqual(3);
  });

  it("wraps today's featured lines with no overflow, at the row counts drawn now", () => {
    const wrapped = shareCardTranscript().map((line) => wrapTerminalLine(line));
    expect(wrapped.map((w) => w.overflow)).toEqual([false, false, false, false]);
    expect(wrapped.map((w) => w.rows)).toEqual([2, 2, 2, 1]);
  });

  it('breaks only at spaces and slashes, and calls an unbroken token wider than the line overflow', () => {
    const agent = shareCardTranscript()[1]!.prompt;
    // A path with slashes wraps at a slash.
    expect(
      wrapTerminalLine({
        kind: 'cmd',
        prompt: agent,
        text: 'cat /srv/invoices/4821/2026-07/receipts/x.pdf',
      }),
    ).toEqual({ rows: 2, overflow: false });
    // One token with no space and no slash, longer than the column: overflow.
    // This is the gate: it fails the test run, never the page.
    expect(wrapTerminalLine(UNBROKEN).overflow).toBe(true);
    expect(() => terminalRows(UNBROKEN)).toThrow(/overflow/);
  });

  it('never throws at runtime: an overflowing line is cut at its last full row and ends in an ellipsis', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const fitted = fitTerminalLine(UNBROKEN);
      expect(fitted.text.endsWith('…')).toBe(true);
      expect(fitted.text.length).toBeLessThan(UNBROKEN.text.length);
      expect(UNBROKEN.text.startsWith(fitted.text.slice(0, -1))).toBe(true);
      expect(wrapTerminalLine(fitted).overflow).toBe(false);
      expect(() => shareCardElement(withUnbroken())).not.toThrow();
      // Today's lines are drawn exactly as they are.
      for (const line of shareCardTranscript()) expect(fitTerminalLine(line)).toBe(line);
    } finally {
      warn.mockRestore();
    }
  });

  it('still renders a 200 image/png at 1200 by 630 through the runtime path, with one warning', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      const response = await renderShareCard(withUnbroken());
      const bytes = new Uint8Array(await response.arrayBuffer());
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect([...bytes.slice(0, 8)]).toEqual(PNG_SIGNATURE);
      expect(pngSize(bytes)).toEqual({ width: 1200, height: 630 });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]![0])).toMatch(/share card/);
    } finally {
      warn.mockRestore();
    }
  }, 30_000);

  it('measures every glyph at the widest advance Geist Mono has, so it can only overcount', () => {
    const ttf = readFileSync(join(process.cwd(), 'assets', 'og-fonts', 'GeistMono-Regular.ttf'));
    const tables = new Map<string, number>();
    for (let i = 0; i < ttf.readUInt16BE(4); i += 1) {
      const at = 12 + i * 16;
      tables.set(ttf.toString('latin1', at, at + 4), ttf.readUInt32BE(at + 8));
    }
    const head = tables.get('head')!;
    const hhea = tables.get('hhea')!;
    const unitsPerEm = ttf.readUInt16BE(head + 18);
    const advanceWidthMax = ttf.readUInt16BE(hhea + 10);
    expect(L.monoAdvance).toBeGreaterThanOrEqual(advanceWidthMax / unitsPerEm);
  });

  it('sets the terminal larger than before, now that the headline is gone', () => {
    expect(L.terminalFont).toBeGreaterThan(19);
  });
});

describe('the share card words', () => {
  it('ends its terminal on the step the recorded verdict anchors, from the featured sample', () => {
    const lines = shareCardTranscript();
    const anchor = SAMPLE_VERDICTS[SAMPLE_CATEGORY].stepId;
    expect(anchor).toBe('s6');
    expect(lines.at(-1)).toEqual({ kind: 'verdict', text: 'COMPROMISED AT STEP 6' });
    // The line before the verdict is the anchored step itself, in breach.
    const anchored = lines.at(-2)!;
    expect(anchored.kind).toBe('breach');
    expect(anchored.text).toContain('read_file');
    expect(anchored.text).toContain('/etc/shadow');
    // It opens on the operator's task, as the replay does.
    expect(lines[0]!.prompt).toBe('user@console:~$');
  });

  it('cuts the operator line at a whole word', () => {
    const first = shareCardTranscript()[0]!.text;
    expect(first.endsWith('…')).toBe(true);
    expect(first).toMatch(/ [a-z0-9]+…$/i);
    expect(cut('a copy of their invoice', 14)).toBe('a copy of…');
    expect(cut('short', 14)).toBe('short');
  });

  it('alt text says what the card shows', () => {
    expect(SHARE_CARD_ALT).toMatch(/^MCProof\./);
    expect(SHARE_CARD_ALT).toMatch(/compromised at step 6/);
  });

  it('uses no em dash and names no person, anywhere on the card', () => {
    const text = [
      SHARE_CARD_ALT,
      ...shareCardTranscript().flatMap((l) => [l.prompt ?? '', l.text]),
    ].join('\n');
    expect(text).not.toContain('—');
    expect(text).not.toMatch(/Dameion|Ayers/i);
  });
});

describe('the share card colours are the site tokens', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8');
  const primitive = (name: string) =>
    new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1]?.toLowerCase();

  it.each(Object.entries(SHARE_CARD_TOKENS))('%s is --%s from globals.css', (key, token) => {
    expect(primitive(token)).toBeDefined();
    expect(SHARE_CARD_COLORS[key as keyof typeof SHARE_CARD_COLORS]).toBe(primitive(token));
  });

  it('draws the terminal on --terminal-bg, worked out as the stylesheet defines it', () => {
    expect(css).toMatch(/--terminal-bg:\s*color-mix\(in srgb, var\(--navy-950\) 80%, #000\)/);
    expect(SHARE_CARD_TERMINAL_BG).toBe(mixHex(primitive('navy-950')!, '#000000', 0.8));
    expect(mixHex('#ffffff', '#000000', 0.5)).toBe('#808080');
  });
});
