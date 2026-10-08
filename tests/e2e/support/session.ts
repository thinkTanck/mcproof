import { expect, type Page } from '@playwright/test';

/**
 * A REAL SIGNED-IN SESSION, ESTABLISHED THE WAY A REAL USER ESTABLISHES ONE.
 *
 * The signed-in `/connect` console and `/account` were the only shipped screens
 * with no axe scan at all, because reaching them needs a session and the suite
 * had no way to create one. Their accessibility evidence was unit tests over
 * roles and names, which is not the same thing as scanning the rendered page.
 *
 * ── WHY THIS CANNOT BECOME A PRODUCTION HOLE ──
 *
 * Because it adds NOTHING to production. There is no test-only route, no
 * bypass, no signed cookie minted behind the app's back, and no flag that
 * relaxes auth. Not one line of `src/` changed to make this work. The helper
 * below types an address into the real `/sign-in` form, clicks the real send
 * button, reads the code out of the email that was really sent, types it into
 * the real code field, and lets the real `verifyEmailCode` set the real session
 * cookies. Every guard production has still runs: the rate limiter, the
 * implicit-flow sender, GoTrue's own verification. If any of them breaks, this
 * test goes red — which is the point of running it.
 *
 * What CI supplies is not a credential, it is a whole disposable Supabase: the
 * `supabase` CLI's local stack, started on the runner and destroyed with it. Its
 * anon and service-role keys are the CLI's published local defaults, so there is
 * no secret to commit, to leak, or to rotate, and nothing this test touches
 * exists anywhere outside that runner.
 *
 * ── WHY THE CODE COMES OUT OF THE MAILBOX AND NOT OUT OF THE ADMIN API ──
 *
 * `admin.generateLink()` would hand us an OTP with one call and no mail server.
 * It would also make this test PASS while the real send path is broken, which is
 * not a hypothetical: the PKCE bug that shipped to production stored a
 * flow-state code instead of `sha224(email + otp)`, so every emailed code failed
 * to verify while the admin path kept working perfectly. A test that reads the
 * admin token would have been green throughout. Reading the code a user would
 * actually have received is the only version of this test that could have caught
 * it, so that is the version we run.
 */

/** Where the local stack's mail catcher listens. Absent means no local stack. */
export const MAIL_URL = process.env.E2E_AUTH_MAIL_URL?.trim() ?? '';

/** True when a signed-in scan is possible at all. */
export const AUTH_STACK_CONFIGURED = MAIL_URL !== '';

/**
 * Set by the CI job that OWNS this coverage. It turns "no local stack" from a
 * skip into a failure, so the job cannot go green having scanned nothing. A
 * developer running the suite without a stack still gets a visible skip.
 */
export const AUTH_STACK_REQUIRED = process.env.E2E_REQUIRE_AUTH === '1';

/** A throwaway address, unique per run so every sign-in is a fresh account. */
export function throwawayEmail(): string {
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `axe-scan-${nonce}@mcpwn.test`;
}

type MailBody = { body: string; source: 'mailpit' | 'inbucket' };

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

/**
 * Read the newest message addressed to `address`. The Supabase CLI has shipped
 * two different mail catchers (Inbucket, then Mailpit) with different APIs, so
 * both are tried and the one that answers wins. A failure names which APIs were
 * attempted rather than leaving a bare timeout.
 */
async function readNewestMessage(address: string): Promise<MailBody> {
  const attempts: string[] = [];

  // Mailpit.
  try {
    const listed = (await fetchJson(`${MAIL_URL}/api/v1/messages?limit=50`)) as {
      messages?: { ID: string; To?: { Address?: string }[] }[];
    };
    const match = listed.messages?.find((message) =>
      message.To?.some((to) => to.Address?.toLowerCase() === address),
    );
    if (match) {
      const full = (await fetchJson(`${MAIL_URL}/api/v1/message/${match.ID}`)) as {
        HTML?: string;
        Text?: string;
      };
      return { body: `${full.HTML ?? ''}\n${full.Text ?? ''}`, source: 'mailpit' };
    }
    attempts.push('mailpit: listed, no message for this address yet');
  } catch (error) {
    attempts.push(`mailpit: ${(error as Error).message}`);
  }

  // Inbucket, which files mail under the local part of the address.
  try {
    const mailbox = address.split('@')[0];
    const listed = (await fetchJson(`${MAIL_URL}/api/v1/mailbox/${mailbox}`)) as { id: string }[];
    const newest = listed.at(-1);
    if (newest) {
      const full = (await fetchJson(`${MAIL_URL}/api/v1/mailbox/${mailbox}/${newest.id}`)) as {
        body?: { html?: string; text?: string };
      };
      return {
        body: `${full.body?.html ?? ''}\n${full.body?.text ?? ''}`,
        source: 'inbucket',
      };
    }
    attempts.push('inbucket: mailbox empty');
  } catch (error) {
    attempts.push(`inbucket: ${(error as Error).message}`);
  }

  throw new Error(`No message for ${address} at ${MAIL_URL}. Tried — ${attempts.join(' | ')}`);
}

/**
 * Pull the one-time code out of an email body.
 *
 * The template also carries a confirmation LINK whose token is a long hex hash,
 * and a hex hash can contain a run of digits the same length as the code. Links
 * are therefore removed before matching, and the match must be unique: two
 * candidates means the template changed and the test should say so rather than
 * guess.
 */
export function extractCode(body: string, codeLength: number): string {
  const withoutLinks = body
    .replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, ' ')
    .replace(/href\s*=\s*"[^"]*"/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ');
  const pattern = new RegExp(`(?<!\\d)\\d{${codeLength}}(?!\\d)`, 'g');
  const found = [...new Set(withoutLinks.match(pattern) ?? [])];
  const [code] = found;
  if (found.length !== 1 || code === undefined) {
    throw new Error(
      `Expected exactly one ${codeLength}-digit code in the email, found ${found.length}. ` +
        'The Supabase email template probably changed.',
    );
  }
  return code;
}

/** Poll the mailbox until the code arrives. Delivery is asynchronous. */
async function waitForCode(address: string, codeLength: number): Promise<string> {
  const deadline = Date.now() + 20_000;
  let last = 'never attempted';
  while (Date.now() < deadline) {
    try {
      const { body } = await readNewestMessage(address);
      return extractCode(body, codeLength);
    } catch (error) {
      last = (error as Error).message;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Timed out waiting for the sign-in code. Last attempt — ${last}`);
}

/**
 * Sign in through the real form and land on `next`. Returns the address used, so
 * a caller can assert the page really is showing that account.
 *
 * ONE EMAIL PER CALL, deliberately. GoTrue's local stack caps outgoing mail per
 * hour (`[auth.rate_limit] email_sent`), so the signed-in scan signs in once and
 * visits both screens on that session rather than signing in per screen.
 */
export async function signInThroughTheRealForm(page: Page, next = '/account'): Promise<string> {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  return completeTheSignInForm(page, next);
}

/**
 * The same sign-in, from a sign-in page the test ALREADY reached, by following a
 * link the way a visitor does. `next` is where that link said to come back to;
 * it is asserted, not supplied: the page was opened by the app, not by the test.
 */
export async function completeTheSignInForm(page: Page, next: string): Promise<string> {
  const address = throwawayEmail();

  await page.getByLabel('Email').fill(address);
  await page.getByRole('button', { name: /email me a code/i }).click();

  // The code step is up once its field exists. Its PLACEHOLDER is the app's own
  // `getEmailOtpLength()` rendered as zeroes, so the length the test matches on
  // is read off the app rather than restated here — the project's rule that the
  // OTP length has exactly one source of truth applies to the test too.
  const codeField = page.getByLabel('Code');
  await expect(codeField).toBeVisible({ timeout: 20_000 });
  const placeholder = (await codeField.getAttribute('placeholder')) ?? '';
  expect(placeholder, 'the code field advertises the expected code length').toMatch(/^0+$/);

  await codeField.fill(await waitForCode(address, placeholder.length));
  await page.getByRole('button', { name: /verify and continue/i }).click();

  await page.waitForURL(`**${next}`, { timeout: 20_000 });
  return address;
}
