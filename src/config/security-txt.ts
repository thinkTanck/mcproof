import { getSiteOrigin } from './env';

/**
 * `/.well-known/security.txt` (RFC 9116): where to report a vulnerability.
 *
 * The text is built here so the route stays a three-line file and the content
 * can be tested without a server.
 */

/** Where the file is served. RFC 9116 fixes the path. */
export const SECURITY_TXT_PATH = '/.well-known/security.txt';

/** The owner's stated contact for security reports. */
export const SECURITY_CONTACT = 'mailto:thinktanck@gmail.com';

/**
 * When this file stops being trustworthy. RFC 9116 requires the field and
 * advises a date less than a year out.
 *
 * BUMP THIS ABOUT ONCE A YEAR. It is a fixed date on purpose (a date computed at
 * build time would never expire, which defeats the field), so it has to be moved
 * by hand. `tests/unit/app/robots-and-security-txt.test.ts` fails 30 days before
 * it passes, while the published file is still valid: set it roughly a year
 * ahead of the day you edit it, never more.
 */
export const SECURITY_TXT_EXPIRES = '2027-10-13T00:00:00.000Z';

/** The file's text. `origin` is the site origin the canonical URL is built on. */
export function buildSecurityTxt(origin: string = getSiteOrigin()): string {
  return [
    `Contact: ${SECURITY_CONTACT}`,
    `Expires: ${SECURITY_TXT_EXPIRES}`,
    'Preferred-Languages: en',
    `Canonical: ${origin}${SECURITY_TXT_PATH}`,
    '',
  ].join('\n');
}
