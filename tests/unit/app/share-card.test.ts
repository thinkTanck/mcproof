// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ogImage from '@/app/opengraph-image';
import * as twitterImage from '@/app/twitter-image';
import {
  SHARE_CARD_ALT,
  SHARE_CARD_COLORS,
  SHARE_CARD_HEADLINE,
  SHARE_CARD_TERMINAL_BG,
  SHARE_CARD_TOKENS,
  cut,
  mixHex,
  shareCardTranscript,
} from '@/lib/og/share-card';
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

describe('the share card words', () => {
  it('carries the line, word for word', () => {
    expect(SHARE_CARD_HEADLINE).toBe('Can your AI agent be tricked into misusing its tools?');
  });

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

  it('uses no em dash and names no person, anywhere on the card', () => {
    const text = [
      SHARE_CARD_HEADLINE,
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
