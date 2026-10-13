// @vitest-environment node
/**
 * The two files published for machines and for people who find a hole:
 * `/robots.txt` and `/.well-known/security.txt` (RFC 9116).
 */
import robots from '@/app/robots';
import { GET } from '@/app/.well-known/security.txt/route';
import {
  SECURITY_CONTACT,
  SECURITY_TXT_EXPIRES,
  SECURITY_TXT_PATH,
  buildSecurityTxt,
} from '@/config/security-txt';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('/robots.txt', () => {
  it('has one group, for every crawler', () => {
    const { rules } = robots();

    expect(Array.isArray(rules)).toBe(false);
    expect(rules).toMatchObject({ userAgent: '*' });
  });

  it('allows the site, and the sample replay inside the closed /runs/ tree', () => {
    expect(robots().rules).toMatchObject({ allow: ['/', '/runs/sample'] });
  });

  it('closes /api/ and /runs/', () => {
    expect(robots().rules).toMatchObject({ disallow: ['/api/', '/runs/'] });
  });

  it('names no sitemap and no host: neither exists', () => {
    const file = robots();

    expect(file.sitemap).toBeUndefined();
    expect(file.host).toBeUndefined();
  });
});

describe('/.well-known/security.txt', () => {
  it('is plain text in UTF-8', async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await response.text()).toBe(buildSecurityTxt());
  });

  it('has the four fields, one per line, in this order', () => {
    expect(buildSecurityTxt('https://mcproof.dev').split('\n')).toEqual([
      'Contact: mailto:thinktanck@gmail.com',
      `Expires: ${SECURITY_TXT_EXPIRES}`,
      'Preferred-Languages: en',
      'Canonical: https://mcproof.dev/.well-known/security.txt',
      '',
    ]);
  });

  it('builds the canonical URL on the configured site origin', () => {
    expect(buildSecurityTxt('https://example.test')).toContain(
      'Canonical: https://example.test/.well-known/security.txt\n',
    );
    expect(SECURITY_TXT_PATH).toBe('/.well-known/security.txt');
    expect(SECURITY_CONTACT).toBe('mailto:thinktanck@gmail.com');
  });

  it('states Expires as a full ISO 8601 timestamp', () => {
    expect(SECURITY_TXT_EXPIRES).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date(SECURITY_TXT_EXPIRES).toISOString()).toBe(SECURITY_TXT_EXPIRES);
  });

  // THE ROT GUARD. A security.txt past its Expires is one a researcher is told
  // to distrust. This fails 30 days BEFORE that happens, so the date gets
  // bumped while the published file is still valid. Fix: move
  // SECURITY_TXT_EXPIRES in src/config/security-txt.ts about a year out.
  it('is more than 30 days from expiring', () => {
    const left = new Date(SECURITY_TXT_EXPIRES).getTime() - Date.now();

    expect(left, 'bump SECURITY_TXT_EXPIRES in src/config/security-txt.ts').toBeGreaterThan(
      30 * DAY_MS,
    );
  });

  it('is never dated more than a year out, which RFC 9116 advises against', () => {
    const left = new Date(SECURITY_TXT_EXPIRES).getTime() - Date.now();

    expect(left).toBeLessThanOrEqual(366 * DAY_MS);
  });
});
