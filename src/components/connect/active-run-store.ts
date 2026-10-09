/**
 * The id of the run this browser tab has open, kept so that coming back to
 * Connect by a plain `/connect` link finds it again.
 *
 * ONLY THE ID IS STORED. The token is a secret shown once and lives in the
 * console's memory and nowhere else; an id on its own opens nothing, because the
 * reattach read also checks that the run belongs to the signed-in account.
 *
 * `sessionStorage`, not `localStorage`: a run belongs to the tab that issued it
 * and should not follow the user into another one, or outlive the session.
 *
 * It is shaped as an external store (`subscribe` plus a snapshot read) so the
 * screen can read it with `useSyncExternalStore`: the server snapshot is "no
 * run", the client one is whatever is stored, and hydration never mismatches.
 */

export const ACTIVE_RUN_STORAGE_KEY = 'mcproof.connect.active-run';

const listeners = new Set<() => void>();

export function subscribeActiveRunId(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The stored id, or null. Blocked storage reads as "nothing stored". */
export function readActiveRunId(): string | null {
  try {
    return window.sessionStorage.getItem(ACTIVE_RUN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Store an id, or forget the stored one with `null`. */
export function writeActiveRunId(runId: string | null): void {
  try {
    if (runId === null) window.sessionStorage.removeItem(ACTIVE_RUN_STORAGE_KEY);
    else window.sessionStorage.setItem(ACTIVE_RUN_STORAGE_KEY, runId);
  } catch {
    /* storage blocked: the URL still carries the id, which covers a reload */
  }
  listeners.forEach((listener) => listener());
}
