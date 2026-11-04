import { test, expect, type APIRequestContext } from '@playwright/test';
import { LINK_PREVIEW_CRAWLERS } from '../../scripts/link-preview-crawlers';

/**
 * LINK PREVIEWS, ON THE REAL SERVER (2026-11-04).
 *
 * A link shared in iMessage, Slack, LinkedIn, Facebook or X is unfurled by a
 * crawler that reads the page's Open Graph tags and then fetches the image they
 * name. This asks for Home as each of those crawlers does, by its user agent,
 * and holds the production build to what each one needs: a 200, the og and
 * twitter tags in the HTML, an absolute https image URL, and that image itself
 * served as a 1200 by 630 PNG.
 *
 * Request-level only, so it runs once, in Chromium.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The content of `<meta property|name="key" content="...">`, or null. */
function meta(html: string, key: string): string | null {
  const tag = new RegExp(
    `<meta[^>]+(?:property|name)="${key.replace(/[:.]/g, '\\$&')}"[^>]*>`,
  ).exec(html)?.[0];
  return tag ? (/content="([^"]*)"/.exec(tag)?.[1] ?? null) : null;
}

async function home(request: APIRequestContext, userAgent: string) {
  const res = await request.get('/', { headers: { 'user-agent': userAgent } });
  return { res, html: await res.text() };
}

test.describe('link previews', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'request-level, engine independent');

  for (const crawler of LINK_PREVIEW_CRAWLERS) {
    test(`${crawler.name} gets Home with the card tags, and the card`, async ({ request }) => {
      const { res, html } = await home(request, crawler.userAgent);
      expect(res.status()).toBe(200);

      const image = meta(html, 'og:image');
      expect(image, 'og:image').not.toBeNull();
      const url = new URL(image!.replace(/&amp;/g, '&'));
      expect(url.protocol).toBe('https:');
      expect(url.pathname).toBe('/opengraph-image');
      expect(meta(html, 'og:image:width')).toBe('1200');
      expect(meta(html, 'og:image:height')).toBe('630');
      expect(meta(html, 'og:image:type')).toBe('image/png');
      expect(meta(html, 'og:image:alt')?.length ?? 0).toBeGreaterThan(20);
      expect(meta(html, 'og:title')).toBeTruthy();
      expect(meta(html, 'og:description')).toBeTruthy();
      expect(meta(html, 'twitter:card')).toBe('summary_large_image');
      expect(new URL(meta(html, 'twitter:image')!.replace(/&amp;/g, '&')).pathname).toBe(
        '/twitter-image',
      );

      // The image the tag names, fetched from THIS server: the absolute URL
      // points at the canonical host, which is not the build under test.
      const card = await request.get(`${url.pathname}${url.search}`, {
        headers: { 'user-agent': crawler.userAgent },
      });
      expect(card.status()).toBe(200);
      expect(card.headers()['content-type']).toBe('image/png');
      const bytes = await card.body();
      expect([...bytes.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
      expect(bytes.readUInt32BE(16)).toBe(1200);
      expect(bytes.readUInt32BE(20)).toBe(630);
      // Fetched by other sites' clients, like the email logo.
      expect(card.headers()['cross-origin-resource-policy']).toBe('cross-origin');
    });
  }
});
