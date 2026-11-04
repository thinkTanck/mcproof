/**
 * Ask a DEPLOYED origin for Home and its share card as each link-preview
 * crawler does, and say what each one got.
 *
 *   npx tsx scripts/check-link-preview.ts https://mcproof.dev
 *
 * The same checks `tests/e2e/link-preview.spec.ts` makes against the build
 * under test, made against a real deployment, where a firewall rule or the
 * platform's bot protection could answer a crawler differently from a browser.
 * It changes nothing anywhere: it only reads. The image is fetched from the URL
 * the page's own og:image names, as a crawler would. Exits non-zero if any
 * crawler is refused or missing a tag.
 */
import { LINK_PREVIEW_CRAWLERS } from './link-preview-crawlers';

const origin = (process.argv[2] ?? '').replace(/\/$/, '');
if (!/^https:\/\/[^/]+$/.test(origin)) {
  console.error('usage: npx tsx scripts/check-link-preview.ts https://<origin>');
  process.exit(2);
}

function meta(html: string, key: string): string | null {
  const tag = new RegExp(
    `<meta[^>]+(?:property|name)="${key.replace(/[:.]/g, '\\$&')}"[^>]*>`,
  ).exec(html)?.[0];
  return tag ? (/content="([^"]*)"/.exec(tag)?.[1]?.replace(/&amp;/g, '&') ?? null) : null;
}

const TAGS = [
  'og:title',
  'og:description',
  'og:image',
  'og:image:width',
  'og:image:height',
  'og:image:type',
  'og:image:alt',
  'twitter:card',
  'twitter:image',
] as const;

async function check(name: string, userAgent: string): Promise<boolean> {
  const problems: string[] = [];
  const page = await fetch(`${origin}/`, { headers: { 'user-agent': userAgent } });
  const html = await page.text();
  if (page.status !== 200) problems.push(`page ${page.status}`);
  for (const tag of TAGS) if (!meta(html, tag)) problems.push(`no ${tag}`);
  if (meta(html, 'twitter:card') !== 'summary_large_image') problems.push('card not large');
  const image = meta(html, 'og:image');
  let imageLine = 'image not fetched';
  if (image) {
    if (!image.startsWith('https://')) problems.push(`og:image not absolute https: ${image}`);
    const res = await fetch(image, { headers: { 'user-agent': userAgent } });
    const bytes = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type');
    const size = bytes.length >= 24 ? `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}` : '?';
    imageLine = `image ${res.status} ${type} ${size}`;
    if (res.status !== 200) problems.push(`image ${res.status}`);
    if (type !== 'image/png') problems.push(`image type ${type}`);
    if (size !== '1200x630') problems.push(`image size ${size}`);
  }
  const verdict = problems.length === 0 ? 'OK' : `FAIL (${problems.join('; ')})`;
  console.log(`${name}: page ${page.status}, ${imageLine}: ${verdict}`);
  return problems.length === 0;
}

async function main(): Promise<void> {
  const results: boolean[] = [];
  for (const { name, userAgent } of LINK_PREVIEW_CRAWLERS)
    results.push(await check(name, userAgent));
  process.exit(results.every(Boolean) ? 0 : 1);
}

void main();
