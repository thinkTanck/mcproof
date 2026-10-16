import { test, expect, type APIResponse, type Page } from '@playwright/test';
import { suppressBootSplash } from './support/screen';

/**
 * RESPONSE SECURITY HEADERS, ON THE REAL SERVER (security lane S3).
 *
 * `tests/unit/config/security-headers.test.ts` reads the rules as data. This
 * reads what a client is actually sent by the production build, per route class:
 *
 *  - a page, an API route, a static asset and a 404 carry the base set plus the
 *    opener and resource policies, each exactly once;
 *  - a page also carries the content security policy, REPORT-ONLY, with a nonce
 *    that is on every script tag and is new for every response;
 *  - `/api/mcp/*` answers a request from another origin exactly as it did before
 *    this lane, and carries no policy, no opener policy and no resource policy;
 *  - `robots.txt`, `security.txt` and the icon exist and can be fetched from
 *    another origin;
 *  - no page of the site reports a single policy violation while it is used.
 *
 * "Another origin" needs no second server: `localhost` and `127.0.0.1` are the
 * same machine and two different origins, so a page opened on one that fetches
 * the other is a real cross-origin fetch in a real browser.
 */

const PORT = Number(process.env.PORT ?? 3000);
const OTHER_ORIGIN = `http://127.0.0.1:${PORT}`;
const THIS_ORIGIN = `http://localhost:${PORT}`;
const FIXTURES_BUILT = process.env.E2E_FIXTURES === '1';

const BASE: Record<string, string> = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
};
const COOP = 'cross-origin-opener-policy';
const CORP = 'cross-origin-resource-policy';
const CSP = 'content-security-policy';
const CSP_REPORT_ONLY = 'content-security-policy-report-only';

const PAGES = [
  '/',
  '/sign-in',
  '/connect',
  '/runs/sample',
  '/findings/sample',
  '/leaderboard',
  '/threats',
];

/** Every value sent for `name`. More than one means a header went out twice. */
function values(response: APIResponse, name: string): string[] {
  return response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === name)
    .map((header) => header.value);
}

/** The one value of `name`, or `null` when the header is absent. Fails on a duplicate. */
function header(response: APIResponse, name: string): string | null {
  const all = values(response, name);
  expect(all.length, `${name} on ${response.url()} is sent at most once`).toBeLessThanOrEqual(1);
  return all[0] ?? null;
}

function expectBase(response: APIResponse) {
  for (const [name, value] of Object.entries(BASE)) {
    expect(header(response, name), `${name} on ${response.url()}`).toBe(value);
  }
  expect(header(response, 'x-powered-by'), `x-powered-by on ${response.url()}`).toBeNull();
}

function expectSameOrigin(response: APIResponse) {
  expectBase(response);
  expect(header(response, COOP), `${COOP} on ${response.url()}`).toBe('same-origin');
  expect(header(response, CORP), `${CORP} on ${response.url()}`).toBe('same-origin');
}

/** The nonce in a policy, after checking the policy is the one this lane ships. */
function nonceIn(policy: string | null): string {
  expect(policy).not.toBeNull();
  const nonce = /'nonce-([A-Za-z0-9+/]+={0,2})'/.exec(policy ?? '')?.[1] ?? '';
  expect(nonce.length).toBeGreaterThanOrEqual(22);
  expect((policy ?? '').split('; ')).toEqual([
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ]);
  return nonce;
}

test.describe('headers per route class', () => {
  for (const path of PAGES) {
    test(`page ${path}: base set, same-origin policies, report-only policy with its nonce`, async ({
      request,
    }) => {
      const response = await request.get(path);

      expect(response.status()).toBe(200);
      expectSameOrigin(response);
      expect(header(response, CSP), 'the policy is never enforcing in this lane').toBeNull();

      const nonce = nonceIn(header(response, CSP_REPORT_ONLY));
      const html = await response.text();
      const scripts = html.match(/<script\b[^>]*>/g) ?? [];
      expect(scripts.length).toBeGreaterThan(0);
      for (const tag of scripts) {
        expect(tag, 'every script tag carries this response nonce').toContain(`nonce="${nonce}"`);
      }
      expect(html, 'no style tag is rendered without the nonce').not.toMatch(
        /<style\b(?![^>]*\bnonce=)/,
      );
    });
  }

  test('a nonce is never reused between two responses', async ({ request }) => {
    const nonces = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      nonces.add(nonceIn(header(await request.get('/'), CSP_REPORT_ONLY)));
    }

    expect(nonces.size).toBe(5);
  });

  test('a policy the client sends does not choose the nonce', async ({ request }) => {
    const response = await request.get('/', {
      headers: { 'content-security-policy': "script-src 'nonce-Y2hvc2VuYnl0aGVjYWxsZXIwMDAw'" },
    });

    const nonce = nonceIn(header(response, CSP_REPORT_ONLY));
    expect(nonce).not.toBe('Y2hvc2VuYnl0aGVjYWxsZXIwMDAw');
    expect(await response.text()).not.toContain('Y2hvc2VuYnl0aGVjYWxsZXIwMDAw');
  });

  for (const path of ['/nope', '/runs/does-not-exist']) {
    test(`404 ${path}: the same headers as any page`, async ({ request }) => {
      const response = await request.get(path);

      expect(response.status()).toBe(404);
      expectSameOrigin(response);
      expect(header(response, CSP)).toBeNull();
      nonceIn(header(response, CSP_REPORT_ONLY));
    });
  }

  test('/api/health: base set and same-origin policies, and no policy on JSON', async ({
    request,
  }) => {
    const response = await request.get('/api/health');

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expectSameOrigin(response);
    expect(header(response, CSP)).toBeNull();
    expect(header(response, CSP_REPORT_ONLY)).toBeNull();
  });

  test('static assets: base set and same-origin policies, with their long cache kept', async ({
    request,
  }) => {
    const html = await (await request.get('/')).text();
    const assets = [
      /\/_next\/static\/[^"' ]+\.js/.exec(html)?.[0],
      /\/_next\/static\/[^"' ]+\.css/.exec(html)?.[0],
      /\/_next\/static\/[^"' ]+\.woff2/.exec(html)?.[0],
    ];

    for (const asset of assets) {
      expect(asset, 'the home page links a script, a stylesheet and a font').toBeTruthy();
      const response = await request.get(asset as string);

      expect(response.status(), asset).toBe(200);
      expectSameOrigin(response);
      expect(header(response, CSP)).toBeNull();
      expect(header(response, CSP_REPORT_ONLY), 'no nonce work on an asset').toBeNull();
      expect(header(response, 'cache-control')).toContain('immutable');
    }
  });
});

test.describe('robots.txt and security.txt', () => {
  test('/robots.txt allows the site and closes /api/ and /runs/ except the sample', async ({
    request,
  }) => {
    const response = await request.get('/robots.txt');

    expect(response.status()).toBe(200);
    expect(header(response, 'content-type')).toMatch(/^text\/plain/);
    expect((await response.text()).trim().split(/\r?\n/)).toEqual([
      'User-Agent: *',
      'Allow: /',
      'Allow: /runs/sample',
      'Disallow: /api/',
      'Disallow: /runs/',
    ]);
    expectBase(response);
    expect(header(response, CORP)).toBe('cross-origin');
  });

  test('/.well-known/security.txt names the contact, an expiry ahead of today, and itself', async ({
    request,
  }) => {
    const response = await request.get('/.well-known/security.txt');

    expect(response.status()).toBe(200);
    expect(header(response, 'content-type')).toBe('text/plain; charset=utf-8');
    const lines = (await response.text()).trimEnd().split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('Contact: mailto:thinktanck@gmail.com');
    expect(lines[1]).toMatch(/^Expires: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(new Date((lines[1] ?? '').slice('Expires: '.length)).getTime()).toBeGreaterThan(
      Date.now(),
    );
    expect(lines[2]).toBe('Preferred-Languages: en');
    expect(lines[3]).toMatch(/^Canonical: https:\/\/[^/]+\/\.well-known\/security\.txt$/);
    expectBase(response);
    expect(header(response, CORP)).toBe('cross-origin');
  });

  test('the icon can be embedded by another site', async ({ request }) => {
    const response = await request.get('/icon.svg');

    expect(response.status()).toBe(200);
    expectBase(response);
    expect(header(response, CORP)).toBe('cross-origin');
  });
});

/**
 * THE MCP ENDPOINT IS LEFT AS IT WAS.
 *
 * An agent's MCP client calls `/api/mcp/<run>` from anywhere. Recorded on main
 * (92d7a21) before this lane, for a request carrying another site's `Origin`:
 * every method answers the one refusal, `401` with the body and the two headers
 * below and no CORS header, and `OPTIONS` answers `204` with an `Allow` list.
 * That is asserted here unchanged. What this lane adds to those responses is the
 * base set only, which a non-browser client ignores.
 */
test.describe('/api/mcp is unaffected', () => {
  const RUN = '2b1c0e4a-0000-4000-8000-000000000001';
  const ENDPOINT = `/api/mcp/${RUN}`;
  const FOREIGN = { origin: 'https://agent.example' };
  const REFUSAL = {
    error:
      'This run endpoint refused the connection. Use the endpoint and token issued for this run, and start a new run if this one has finished.',
  };
  const INITIALIZE = { jsonrpc: '2.0', id: 1, method: 'initialize' };

  /** Headers a server or proxy adds for transport, which say nothing about the route. */
  const TRANSPORT = ['date', 'connection', 'keep-alive', 'transfer-encoding', 'content-length'];
  const names = (response: APIResponse) =>
    [...new Set(response.headersArray().map((h) => h.name.toLowerCase()))]
      .filter((name) => !TRANSPORT.includes(name))
      .sort();

  function expectNothingInTheWay(response: APIResponse) {
    expectBase(response);
    for (const name of [CSP, CSP_REPORT_ONLY, COOP, CORP]) {
      expect(header(response, name), `${name} on ${response.url()}`).toBeNull();
    }
  }

  const calls = [
    ['POST', 'no token', {}],
    ['POST', 'a token that is not one', { authorization: 'Bearer rt_not-a-token.aaaaaaaaaaaa' }],
    ['GET', 'no token', {}],
    ['DELETE', 'a token that is not one', { authorization: 'Bearer rt_not-a-token.aaaaaaaaaaaa' }],
  ] as const;

  for (const [method, token, auth] of calls) {
    test(`${method} from another origin with ${token}: the same 401, body and headers as before`, async ({
      request,
    }) => {
      const response = await request.fetch(ENDPOINT, {
        method,
        headers: {
          ...FOREIGN,
          ...auth,
          accept: 'application/json, text/event-stream',
          ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
        },
        ...(method === 'POST' ? { data: INITIALIZE } : {}),
      });

      expect(response.status()).toBe(401);
      expect(await response.json()).toEqual(REFUSAL);
      expect(header(response, 'content-type')).toBe('application/json');
      expect(header(response, 'www-authenticate')).toBe('Bearer');
      expectNothingInTheWay(response);
      // main's set (content-type, vary, www-authenticate) plus the base set, and nothing else.
      expect(names(response)).toEqual(
        ['content-type', 'vary', 'www-authenticate', ...Object.keys(BASE)].sort(),
      );
    });
  }

  test('OPTIONS preflight from another origin: the same 204 and Allow list, still no CORS header', async ({
    request,
  }) => {
    const response = await request.fetch(ENDPOINT, {
      method: 'OPTIONS',
      headers: {
        ...FOREIGN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type',
      },
    });

    expect(response.status()).toBe(204);
    expect(await response.text()).toBe('');
    expect(header(response, 'allow')).toBe('DELETE, GET, HEAD, OPTIONS, POST');
    expect(header(response, 'access-control-allow-origin')).toBeNull();
    expectNothingInTheWay(response);
    expect(names(response)).toEqual(['allow', 'vary', ...Object.keys(BASE)].sort());
  });

  test('a run id outside the grammar and an oversize body are still answered as before', async ({
    request,
  }) => {
    const badId = await request.post('/api/mcp/not%20a%20run', {
      headers: FOREIGN,
      data: INITIALIZE,
    });
    const tooLarge = await request.post(ENDPOINT, {
      headers: FOREIGN,
      data: { pad: 'x'.repeat(70 * 1024) },
    });

    expect(badId.status()).toBe(401);
    expect(await badId.json()).toEqual(REFUSAL);
    expectNothingInTheWay(badId);
    expect(tooLarge.status()).toBe(413);
    expect(await tooLarge.json()).toMatchObject({
      jsonrpc: '2.0',
      error: { message: 'Request body is too large.' },
    });
    expectNothingInTheWay(tooLarge);
  });

  /**
   * The browser's own verdict. A resource policy of `same-origin` makes a
   * browser refuse a cross-origin `no-cors` fetch outright, so the same fetch is
   * made against three targets from a page on the other origin: the MCP endpoint
   * and the icon must come back, and `/api/health`, which does carry
   * `same-origin`, must be refused. The refusal is what proves the other two
   * results mean something.
   */
  test('a browser on another origin can still reach the endpoint, and is refused where the policy says so', async ({
    page,
  }) => {
    await page.goto(`${OTHER_ORIGIN}/api/health`);

    const reached = await page.evaluate(
      async ({ origin, endpoint }) => {
        const attempt = (url: string, init: RequestInit) =>
          fetch(url, { mode: 'no-cors', ...init }).then(
            (response) => response.type,
            () => 'refused',
          );
        return {
          endpoint: await attempt(`${origin}${endpoint}`, {
            method: 'POST',
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
          }),
          icon: await attempt(`${origin}/icon.svg`, {}),
          health: await attempt(`${origin}/api/health`, {}),
        };
      },
      { origin: THIS_ORIGIN, endpoint: ENDPOINT },
    );

    expect(reached).toEqual({ endpoint: 'opaque', icon: 'opaque', health: 'refused' });
  });
});

/**
 * ZERO POLICY VIOLATIONS WHILE THE SITE IS USED.
 *
 * The policy is report-only, so a violation breaks nothing and is easy to miss.
 * Each page gets a listener for the browser's `securitypolicyviolation` event
 * before any of its own script runs, and the console is read for the browser's
 * own policy messages. The list is empty, or the test fails naming the page, the
 * directive, what was blocked and where it came from.
 *
 * EXPLAINED is the allowlist: a message that is understood and accepted goes
 * there with its reason. It holds no violation, only two notes WebKit prints
 * about the policy itself.
 */
interface Violation {
  page: string;
  directive: string;
  blocked: string;
  source: string;
  sample: string;
}

const EXPLAINED: { directive: RegExp; blocked: RegExp; reason: string }[] = [
  {
    directive: /^console$/,
    blocked: /'frame-ancestors' is ignored when delivered in a report-only policy/,
    reason:
      'WebKit notes this on every page. It is not a violation: the directive is kept for the day the policy is enforced, and X-Frame-Options: DENY forbids framing until then.',
  },
  {
    directive: /^console$/,
    blocked: /was delivered in report-only mode, but does not specify a 'report-(to|uri)'/,
    reason:
      'WebKit notes this on every page. It is not a violation: there is no report collector in this lane, by decision. WebKit still raises the violation event, which the first test below proves.',
  },
];

async function collectViolations(page: Page): Promise<Violation[]> {
  const seen: Violation[] = [];
  await page.exposeFunction('__reportPolicyViolation', (violation: Violation) => {
    seen.push(violation);
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const report = (window as unknown as Record<string, (v: unknown) => void>)
        .__reportPolicyViolation;
      report?.({
        page: location.pathname + location.search,
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
        source: `${event.sourceFile ?? ''}:${event.lineNumber}`,
        sample: event.sample,
      });
    });
  });
  page.on('console', (message) => {
    if (!/content[- ]security[- ]policy/i.test(message.text())) return;
    seen.push({
      page: new URL(page.url()).pathname,
      directive: 'console',
      blocked: message.text(),
      source: message.location().url,
      sample: '',
    });
  });
  return seen;
}

const unexplained = (seen: Violation[]) =>
  seen.filter(
    (v) => !EXPLAINED.some((e) => e.directive.test(v.directive) && e.blocked.test(v.blocked)),
  );

/** Fonts in, two frames drawn, and a moment for anything started on idle. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.waitForTimeout(400);
}

test.describe('no policy violation on any page', () => {
  test('the listener really hears one', async ({ page }) => {
    const seen = await collectViolations(page);
    await page.goto('/threats');

    await page.evaluate(() => {
      const style = document.createElement('style');
      style.textContent = '.policy-probe{color:inherit}';
      document.head.append(style);
    });

    await expect.poll(() => seen.filter((v) => v.directive === 'style-src-elem').length).toBe(1);
  });

  for (const path of [...PAGES, '/account', '/nope', '/runs/does-not-exist']) {
    test(`${path} loads with none`, async ({ page }) => {
      await suppressBootSplash(page);
      const seen = await collectViolations(page);

      await page.goto(path);
      await settle(page);

      expect(unexplained(seen)).toEqual([]);
    });
  }

  test('the boot splash on a first visit', async ({ page }) => {
    const seen = await collectViolations(page);

    await page.goto('/');
    await settle(page);
    await page.waitForTimeout(2500);

    expect(unexplained(seen)).toEqual([]);
  });

  test('the other sample runs and their reports', async ({ page }) => {
    await suppressBootSplash(page);
    const seen = await collectViolations(page);

    for (const id of ['asi01-goal-hijack', 'asi06-run', 'asi10-goal-drift']) {
      await page.goto(`/runs/${id}`);
      await settle(page);
      await page.goto(`/findings/${id}`);
      await settle(page);
    }

    expect(unexplained(seen)).toEqual([]);
  });

  test('the replay while it plays, steps and changes speed', async ({ page }) => {
    await suppressBootSplash(page);
    const seen = await collectViolations(page);
    await page.goto('/runs/sample');

    await page.getByRole('button', { name: 'Play' }).click();
    await page.waitForTimeout(2500);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await settle(page);

    expect(unexplained(seen)).toEqual([]);
  });

  test('moving between pages without a full load', async ({ page }) => {
    await suppressBootSplash(page);
    const seen = await collectViolations(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');

    for (const name of ['Leaderboard', 'Threat model', 'Connect']) {
      const link = page.getByRole('navigation', { name: 'Command deck' }).getByRole('link', {
        name: new RegExp(name, 'i'),
      });
      if ((await link.count()) === 0) continue;
      await link.first().click();
      await settle(page);
    }

    expect(unexplained(seen)).toEqual([]);
  });

  test('the Connect states a real run reaches', async ({ page }) => {
    test.skip(!FIXTURES_BUILT, 'needs the fixture build (E2E_FIXTURES=1)');
    await suppressBootSplash(page);
    const seen = await collectViolations(page);

    for (const state of ['waiting', 'connected']) {
      await page.goto(`/e2e/connect-states?state=${state}`);
      await page.getByRole('button', { name: /^LIVE/ }).click();
      await page.getByRole('button', { name: /start a run/i }).click();
      await expect(
        page.getByRole('region', { name: /what we have recorded so far/i }),
      ).toBeVisible();
      await settle(page);
    }
    for (const url of [
      '/e2e/connect-states?state=run-discarded',
      '/e2e/connect-states?state=report-discarded',
      '/e2e/header-states?mode=live',
      '/e2e/free-runs-note?where=home&allowance=3',
    ]) {
      await page.goto(url);
      await settle(page);
    }

    expect(unexplained(seen)).toEqual([]);
  });
});
