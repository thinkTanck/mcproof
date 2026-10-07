import { headers } from 'next/headers';

/**
 * The id a `/runs/[id]` or `/findings/[id]` request asked for, read from the
 * path, for the one place that cannot be handed it: a route-level
 * `not-found.tsx` takes no props.
 *
 * It reads `x-pathname`, which the middleware sets from the real URL on every
 * page request and overwrites if the client sent one (`src/middleware.ts`). It
 * reads NOTHING else: no session and no run lookup. So the page it feeds draws
 * the same thing for a run on someone else's account as for an id nobody has,
 * and cannot say which of the two it was.
 *
 * A path that cannot be decoded is shown as it was sent. React escapes it either
 * way, so an id is only ever text.
 */
export async function requestedRouteId(segment: 'runs' | 'findings'): Promise<string> {
  const pathname = (await headers()).get('x-pathname') ?? '';
  const raw = new RegExp(`^/${segment}/([^/]+)`).exec(pathname)?.[1] ?? '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
