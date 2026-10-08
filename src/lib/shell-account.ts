/**
 * What the shell's account entry is told about the visitor. A plain shape with
 * nothing in it to read a request from, so the components that DRAW the entry
 * can import it without touching the header that carries the address
 * (`src/lib/shell-identity.ts`, which only the middleware and `AppShell` may use).
 */
export type ShellAccount =
  /** Auth is not configured on this build: sign-in is a preview. */
  | { readonly state: 'preview' }
  | { readonly state: 'signed-out' }
  | { readonly state: 'signed-in'; readonly email: string };
