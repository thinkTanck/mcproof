import { buildSecurityTxt } from '@/config/security-txt';

/** The text never changes between builds, so it is rendered once, at build time. */
export const dynamic = 'force-static';

/** GET /.well-known/security.txt: where to report a vulnerability (RFC 9116). */
export function GET(): Response {
  return new Response(buildSecurityTxt(), {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
