import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * THE LOCAL SUPABASE STACK, for the suites that test the database itself.
 *
 * These suites sign real users in and try, as those users, to write rows they
 * should not be able to write. That is only ever done against a DISPOSABLE
 * stack: the Supabase CLI's local one, started from this repo's migrations
 * (`supabase start`). Two things keep it that way.
 *
 *   1. THE GATE. Nothing here runs unless `RLS_LOCAL_STACK=1` is set, so the
 *      ordinary unit and integration runs skip it cleanly with no stack up.
 *   2. THE ADDRESS CHECK. Even with the gate set, the suite refuses to start
 *      unless the Supabase URL is a loopback address. A `.env.local` that names
 *      the real project can therefore not turn this into a test against
 *      production, whatever else is set.
 *
 * The keys are read from the same three variables the app reads. On a local
 * stack they are the CLI's published defaults, not credentials; they are still
 * never written into a committed file.
 */
const URL_VALUE = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';

/** True when the suites should run at all. */
export const RLS_LOCAL_STACK = process.env.RLS_LOCAL_STACK === '1';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** Refuse anything that is not a stack on this machine. Called before any I/O. */
export function assertLocalStack(): void {
  if (!URL_VALUE || !ANON || !SERVICE) {
    throw new Error(
      'RLS_LOCAL_STACK=1 needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and ' +
        'SUPABASE_SERVICE_ROLE_KEY from `supabase status -o env`.',
    );
  }
  const host = new URL(URL_VALUE).hostname;
  if (!LOOPBACK.has(host)) {
    throw new Error(
      `The RLS suites only run against a local stack, and the Supabase URL names "${host}". ` +
        'Nothing was sent.',
    );
  }
}

const SESSIONLESS = { auth: { persistSession: false, autoRefreshToken: false } } as const;

/** The service-role client: bypasses RLS. Used to seed rows and to read the truth back. */
export function adminClient(): SupabaseClient {
  assertLocalStack();
  return createClient(URL_VALUE, SERVICE, SESSIONLESS);
}

/** A visitor holding only the public key: the `anon` role. */
export function anonClient(): SupabaseClient {
  assertLocalStack();
  return createClient(URL_VALUE, ANON, SESSIONLESS);
}

export interface SignedInUser {
  readonly id: string;
  readonly email: string;
  /** A client carrying this user's real session: the `authenticated` role. */
  readonly client: SupabaseClient;
}

/**
 * A throwaway account with a real session. The account is created through the
 * admin API and then SIGNED IN, so the client holds a token the auth server
 * issued, exactly what a browser holds after the sign-in form.
 */
export async function signedInUser(admin: SupabaseClient, tag: string): Promise<SignedInUser> {
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const email = `rls-${tag}-${nonce}@mcproof.test`;
  const password = `Pw-${nonce}-${Math.random().toString(36).slice(2)}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    throw new Error(`could not create the ${tag} account: ${created.error?.message}`);
  }
  const client = createClient(URL_VALUE, ANON, SESSIONLESS);
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`could not sign the ${tag} account in`);
  return { id: created.data.user.id, email, client };
}

/** Remove an account. Its runs, tokens and run records cascade with it. */
export async function removeUser(admin: SupabaseClient, user: SignedInUser | undefined) {
  if (user) await admin.auth.admin.deleteUser(user.id);
}
