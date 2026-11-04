/**
 * The link-preview crawlers a shared mcproof.dev link meets, by the user agent
 * each one sends. One list, read by `tests/e2e/link-preview.spec.ts` (against
 * the build under test) and by `scripts/check-link-preview.ts` (against a
 * deployed origin), so the two ask as the same clients.
 *
 * iMessage unfurls a link on the sender's device with the first string, which
 * names facebookexternalhit and Twitterbot inside a Safari string; Applebot is
 * Apple's own crawler. The others are each service's documented agent.
 */
export const LINK_PREVIEW_CRAWLERS = [
  {
    name: 'iMessage',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0',
  },
  {
    name: 'Applebot',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)',
  },
  {
    name: 'facebookexternalhit',
    userAgent: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  },
  {
    name: 'LinkedInBot',
    userAgent:
      'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
  },
  {
    name: 'Slackbot',
    userAgent: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  },
  {
    name: 'Twitterbot',
    userAgent: 'Twitterbot/1.0',
  },
] as const;
