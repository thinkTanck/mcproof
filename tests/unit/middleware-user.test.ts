// @vitest-environment node
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';
import { SHELL_USER_HEADER, readShellAccount } from '@/lib/shell-identity';

/**
 * WHO IS SIGNED IN, FOR THE SHELL TO SHOW (sweep 2026-10-07, X2).
 *
 * The shell draws "signed in as ..." and a sign-out control. The middleware
 * already asks Supabase who the visitor is on every page request, to refresh the
 * session, and used to throw the answer away. It now forwards the verified
 * address as a request header, set the same way `x-pathname` is: a value sent by
 * the client is discarded, never trusted.
 *
 * THIS HEADER IS DISPLAY ONLY. It decides what a label says. It never decides
 * what anyone may do: `getUser()` and `requireUser()` stay the only source of
 * that (tests/unit/shell-identity-guard.test.ts holds the line).
 */

const auth = vi.hoisted(() => ({
  configured: true,
  user: null as { email?: string } | null,
  setCookie: false,
}));

vi.mock('@/config/env', async (original) => ({
  ...(await original<typeof import('@/config/env')>()),
  getSupabaseConfig: () =>
    auth.configured ? { url: 'http://127.0.0.1:54321', anonKey: 'anon-key' } : null,
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookies: { setAll: (c: { name: string; value: string; options: object }[]) => void };
    },
  ) => ({
    auth: {
      getUser: async () => {
        // A session refresh writes new cookies through the client it was given.
        if (auth.setCookie) {
          options.cookies.setAll([{ name: 'sb-access-token', value: 'refreshed', options: {} }]);
        }
        return { data: { user: auth.user } };
      },
    },
  }),
}));

const forwarded = (response: Response, name: string) =>
  response.headers.get(`x-middleware-request-${name}`);
/** What the shell would make of the request this response forwards. */
const shellSees = (response: Response) =>
  readShellAccount({ get: (name: string) => forwarded(response, name) });

const at = (path: string, headers: Record<string, string> = {}) =>
  middleware(new NextRequest(`http://localhost${path}`, { headers }));

beforeEach(() => {
  auth.configured = true;
  auth.user = null;
  auth.setCookie = false;
});

describe('middleware: the shell user header', () => {
  it('is named so nobody mistakes it for something to authorize with', () => {
    expect(SHELL_USER_HEADER).toBe('x-shell-user-email');
  });

  it('forwards the verified address, encoded, when someone is signed in', async () => {
    auth.user = { email: 'dame@example.com' };

    const response = await at('/connect');

    expect(forwarded(response, SHELL_USER_HEADER)).toBe('dame%40example.com');
    expect(shellSees(response)).toEqual({ state: 'signed-in', email: 'dame@example.com' });
  });

  it.each([
    ['a unicode local part', 'jürgen.müller@example.com'],
    ['an internationalised domain', 'user@bücher.example'],
    ['a non-latin address', '用户@例子.测试'],
    ['characters a header cannot carry raw', 'odd name+tag@example.com'],
  ])('round-trips %s', async (_what, email) => {
    auth.user = { email };

    const response = await at('/');
    const raw = forwarded(response, SHELL_USER_HEADER)!;

    // Only bytes a header may hold are sent.
    expect(raw).toMatch(/^[\x21-\x7e]+$/);
    expect(raw).toBe(encodeURIComponent(email));
    expect(shellSees(response)).toEqual({ state: 'signed-in', email });
  });

  it('is absent when nobody is signed in', async () => {
    const response = await at('/connect');

    expect(forwarded(response, SHELL_USER_HEADER)).toBeNull();
    expect(shellSees(response)).toEqual({ state: 'signed-out' });
  });

  it('is absent for a signed-in user with no address on record', async () => {
    auth.user = {};

    expect(forwarded(await at('/'), SHELL_USER_HEADER)).toBeNull();
  });

  it('discards one the client sent when nobody is signed in', async () => {
    const response = await at('/account', { [SHELL_USER_HEADER]: 'attacker%40example.com' });

    expect(forwarded(response, SHELL_USER_HEADER)).toBeNull();
    // Left out of the override list, which is how the server drops the value
    // the client sent.
    expect(response.headers.get('x-middleware-override-headers')).not.toContain(SHELL_USER_HEADER);
    expect(shellSees(response)).toEqual({ state: 'signed-out' });
  });

  it('overwrites one the client sent with the verified address', async () => {
    auth.user = { email: 'dame@example.com' };

    const response = await at('/', { [SHELL_USER_HEADER]: 'attacker%40example.com' });

    expect(forwarded(response, SHELL_USER_HEADER)).toBe('dame%40example.com');
  });

  it('discards one the client sent when auth is not configured, and reports PREVIEW', async () => {
    auth.configured = false;

    const response = await at('/', { [SHELL_USER_HEADER]: 'attacker%40example.com' });

    expect(forwarded(response, SHELL_USER_HEADER)).toBeNull();
    expect(readShellAccount({ get: () => null }, { authConfigured: false })).toEqual({
      state: 'preview',
    });
  });

  it('discards one the client sent on a path the middleware rewrites', async () => {
    const response = await at('/runs/does-not-exist', {
      [SHELL_USER_HEADER]: 'attacker%40example.com',
    });

    expect(response.status).toBe(404);
    expect(forwarded(response, SHELL_USER_HEADER)).toBeNull();
  });

  it('keeps the session cookies a refresh wrote, and still carries x-pathname', async () => {
    auth.user = { email: 'dame@example.com' };
    auth.setCookie = true;

    const response = await at('/connect');

    expect(response.headers.get('set-cookie')).toContain('sb-access-token=refreshed');
    expect(forwarded(response, 'x-pathname')).toBe('/connect');
    expect(forwarded(response, SHELL_USER_HEADER)).toBe('dame%40example.com');
  });
});

describe('readShellAccount: what the shell makes of the header', () => {
  const headers = (value: string | null) => ({ get: () => value });

  it('never throws on a value it cannot decode: that is nobody', () => {
    expect(readShellAccount(headers('%E0%A4%A'))).toEqual({ state: 'signed-out' });
  });

  it('treats an empty value as nobody', () => {
    expect(readShellAccount(headers(''))).toEqual({ state: 'signed-out' });
    expect(readShellAccount(headers('%20'))).toEqual({ state: 'signed-out' });
  });

  it('reports PREVIEW whenever auth is not configured, whatever the header says', () => {
    expect(readShellAccount(headers('dame%40example.com'), { authConfigured: false })).toEqual({
      state: 'preview',
    });
  });
});
