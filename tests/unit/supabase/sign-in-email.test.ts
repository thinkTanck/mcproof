import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE SIGN-IN EMAIL (LAUNCH POLISH, Part 7; owner ruling SIGN-IN EMAIL,
 * 2026-10-21). One file, `supabase/templates/sign-in-code.html`: the local
 * stack sends it (supabase/config.toml), and the owner pastes the same HTML
 * into the hosted project's Confirm signup and Magic Link templates.
 *
 * Email-safe: tables and inline styles only, nothing external but the logo
 * image. Code-only: no link carries the token, and the one link is the plain
 * site address. The copy is the ruling's, word for word.
 */
const ROOT = process.cwd();
const html = readFileSync(join(ROOT, 'supabase/templates/sign-in-code.html'), 'utf8');
const text = (fragment: string) =>
  fragment
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

describe('the sign-in email: email-safe markup', () => {
  it('has no style sheet, script, external stylesheet or class, only inline styles', () => {
    expect(html).not.toMatch(/<style\b/i);
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/\sclass=/i);
    expect(html).not.toMatch(/@import|url\(/i);
  });

  it('is laid out in tables, with a card at most 600px wide on a light gray page', () => {
    expect(html.match(/<table\b/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toMatch(/display:\s*(flex|grid)/);
    expect(html).toMatch(
      /max-width: 600px; background-color: #ffffff; border: 1px solid #[0-9a-f]{6}; border-radius: \d+px/,
    );
    expect(html).toMatch(/<body style="[^"]*background-color: #f2f4f7/);
  });

  it('opens with the logo on the dark band, an absolute URL with alt text and a set size', () => {
    expect(html).toContain('background-color: #05080b');
    const img = /<img\b[^>]*>/.exec(html)?.[0] ?? '';
    expect(img).toContain('src="https://mcproof.dev/email/mcproof-logo.png"');
    expect(img).toContain('alt="MCProof"');
    expect(img).toMatch(/width="\d+"/);
    expect(img).toMatch(/height="\d+"/);
  });

  it('serves a logo twice the size the image tag draws it at', () => {
    const png = readFileSync(join(ROOT, 'public/email/mcproof-logo.png'));
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    const img = /<img\b[^>]*>/.exec(html)?.[0] ?? '';
    const w = Number(/width="(\d+)"/.exec(img)?.[1]);
    const h = Number(/height="(\d+)"/.exec(img)?.[1]);
    expect(width).toBe(2 * w);
    expect(height).toBe(2 * h);
  });
});

describe('the sign-in email: the words', () => {
  it('says exactly what the ruling says, in order', () => {
    const body = text(html);
    const lines = [
      'Hi,',
      'Use the code below to sign in to MCProof.',
      '{{ .Token }}',
      'This code expires in 15 minutes.',
      'If you did not request this code, you can ignore this email.',
      'MCProof · mcproof.dev',
      'You received this because someone entered this address on mcproof.dev.',
    ];
    let at = 0;
    for (const line of lines) {
      const found = body.indexOf(line, at);
      expect(found, line).toBeGreaterThanOrEqual(0);
      at = found + line.length;
    }
  });

  it('carries the hidden preheader', () => {
    expect(html).toMatch(
      /<div\s+style="display: none;[^"]*"\s*>\s*Your MCProof sign-in code\s*<\/div>/,
    );
  });

  it('shows the code in a large, letter-spaced monospace, centred in a shaded box', () => {
    const cell = /<td\b[^>]*>\s*\{\{ \.Token \}\}\s*<\/td>/.exec(html)?.[0] ?? '';
    expect(cell).toContain('align="center"');
    expect(cell).toMatch(/background-color: #[0-9a-f]{6}/);
    expect(cell).toMatch(/monospace/);
    expect(cell).toMatch(/font-size: (2[4-9]|3\d)px/);
    expect(cell).toMatch(/letter-spacing: [1-9]\d*px/);
  });

  it('has no em dash', () => {
    expect(html).not.toContain('—');
  });
});

describe('the sign-in email: code-only', () => {
  it('prints the token once and carries no link or hash that could spend it', () => {
    expect(html.match(/\{\{ \.Token \}\}/g)).toHaveLength(1);
    expect(html).not.toMatch(/ConfirmationURL|TokenHash|RedirectTo|SiteURL/);
  });

  it('has one link, and it is the plain site address', () => {
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual(['https://mcproof.dev']);
  });

  it('holds no other run of six or more digits, so the code is the only one a reader or a test finds', () => {
    expect(html.replace('{{ .Token }}', '').match(/\d{6,}/g)).toBeNull();
  });
});
