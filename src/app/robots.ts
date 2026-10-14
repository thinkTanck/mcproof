import type { MetadataRoute } from 'next';

/**
 * `/robots.txt`. Everything is open to crawlers except the API and the run
 * replays, and inside the closed `/runs/` tree the sample replay is opened
 * again.
 *
 * `Allow: /runs/sample` and `Disallow: /runs/` both match `/runs/sample`. A
 * crawler that follows RFC 9309 (Google, Bing) takes the LONGEST matching rule,
 * so the allow wins there and every other `/runs/<id>` stays closed. The order of
 * the lines does not decide it.
 *
 * No sitemap is named because the site has none.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/runs/sample'],
      disallow: ['/api/', '/runs/'],
    },
  };
}
