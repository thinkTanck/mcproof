import RunReplayPage, { generateMetadata as runMetadata } from '@/app/(hud)/runs/[id]/page';
import FindingsPage, { generateMetadata as reportMetadata } from '@/app/(hud)/findings/[id]/page';
import { RunResultSchema, CategorySchema, type RunResult } from '@/contract';
import { TraceBuilder } from '@/attacks/engine';
import { sampleRun } from '@/data/source';
import { resolveFixReport, resolveRun } from '@/data/run-view';
import { getUser } from '@/lib/auth/user';
import { getRunRepository } from '@/data/run-repository.factory';
import type { StoredRun } from '@/data/run-repository';

/**
 * AN ID THAT RESOLVES TO NOTHING ANSWERS 404 (sweep 2026-10-07, X3).
 *
 * `/runs/does-not-exist` and `/findings/does-not-exist` rendered their empty
 * state with HTTP 200, so a crawler or an uptime check saw a healthy page. The
 * page now calls `notFound()`, which is the only way an App Router page sets a
 * status, and the route's own `not-found.tsx` keeps the empty-state copy.
 *
 * THE RULE THIS FILE HOLDS: a run the viewer may not see answers EXACTLY as an
 * id that never existed. Same throw, so the same status, body and title, and the
 * response never says whether the id is real.
 */

vi.mock('@/lib/auth/user', () => ({ getUser: vi.fn() }));
vi.mock('@/data/run-repository.factory', () => ({ getRunRepository: vi.fn() }));

const asMock = <T extends (...args: never[]) => unknown>(fn: T) => vi.mocked(fn);

/** A real row id: `runs.id` is a uuid column. */
const LIVE_ROW_ID = '3f2b6c1e-8a4d-4c1b-9e57-0a1b2c3d4e5f';
/** A well-formed id that no row has. */
const NO_SUCH_ROW_ID = '00000000-0000-4000-8000-000000000000';
const OWNER = 'user-owner';
const STRANGER = 'user-stranger';

function liveRun(): RunResult {
  const b = new TraceBuilder({
    runId: 'live-session-0001',
    target: 'hosted-mcp',
    model: 'their-agent',
    category: 'ASI02',
  });
  b.principalInstruction('fetch the July invoice for account 4821');
  const offending = b.toolCall('read_file', { path: '/srv/invoices/4821/../../etc/shadow' });
  b.taskComplete('done');
  return RunResultSchema.parse({
    runId: 'live-session-0001',
    target: 'hosted-mcp',
    model: 'their-agent',
    category: 'ASI02',
    trace: b.build(),
    verdict: {
      runId: 'live-session-0001',
      compromised: true,
      score: 0.9,
      severity: 'High',
      category: 'ASI02',
      rationale: 'the agent read a file outside the task scope',
      stepId: offending,
    },
  });
}

const ROW: StoredRun = {
  id: LIVE_ROW_ID,
  userId: OWNER,
  createdAt: '2026-09-30T12:00:00.000Z',
  run: liveRun(),
};

/** Owner-scoped, as the real adapter and RLS are: another account's row is `null`. */
function repo() {
  return {
    saveRun: vi.fn(),
    listRuns: vi.fn(),
    countRunsSince: vi.fn(),
    findByRunId: vi.fn(),
    getRun: vi.fn(async (userId: string, id: string) =>
      id === ROW.id && userId === ROW.userId ? ROW : null,
    ),
  };
}

function viewer(userId: string | null) {
  asMock(getUser).mockResolvedValue(userId === null ? null : ({ id: userId } as never));
}

const PAGES = [
  ['/runs/[id]', RunReplayPage],
  ['/findings/[id]', FindingsPage],
] as const;

/** What `notFound()` throws. The digest is what Next turns into the 404 status. */
const NOT_FOUND = { digest: expect.stringMatching(/^NEXT_HTTP_ERROR_FALLBACK;404$/) };

const open = (page: (typeof PAGES)[number][1], id: string) =>
  page({ params: Promise.resolve({ id }) });

/** The digest a page throws for an id, or `'rendered'` if it returned a screen. */
async function outcome(page: (typeof PAGES)[number][1], id: string): Promise<string> {
  try {
    await open(page, id);
    return 'rendered';
  } catch (error) {
    return String((error as { digest?: unknown }).digest ?? error);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  viewer(null);
  asMock(getRunRepository).mockResolvedValue(repo());
});

describe.each(PAGES)('%s: an id that resolves to nothing is a 404', (_route, page) => {
  it('unknown id, signed out: notFound()', async () => {
    await expect(open(page, 'does-not-exist')).rejects.toMatchObject(NOT_FOUND);
  });

  it('unknown id, signed in: notFound()', async () => {
    viewer(STRANGER);
    await expect(open(page, NO_SUCH_ROW_ID)).rejects.toMatchObject(NOT_FOUND);
  });

  it('a real live run, viewed signed out: notFound()', async () => {
    await expect(open(page, LIVE_ROW_ID)).rejects.toMatchObject(NOT_FOUND);
  });

  it('a real live run, viewed by a different signed-in user: notFound()', async () => {
    viewer(STRANGER);
    await expect(open(page, LIVE_ROW_ID)).rejects.toMatchObject(NOT_FOUND);
  });

  it('a run the viewer may not see is indistinguishable from an id that never existed', async () => {
    const unknownSignedOut = await outcome(page, NO_SUCH_ROW_ID);
    const realSignedOut = await outcome(page, LIVE_ROW_ID);
    viewer(STRANGER);
    const unknownStranger = await outcome(page, NO_SUCH_ROW_ID);
    const realStranger = await outcome(page, LIVE_ROW_ID);

    // One throw, carrying no id and no reason, for all four. The status, the
    // body and the title all follow from it, so none of them can differ.
    expect(new Set([unknownSignedOut, realSignedOut, unknownStranger, realStranger])).toEqual(
      new Set(['NEXT_HTTP_ERROR_FALLBACK;404']),
    );
  });

  it('the owner still gets their own live run: 200, unchanged', async () => {
    viewer(OWNER);
    await expect(open(page, LIVE_ROW_ID)).resolves.toBeTruthy();
    expect(await outcome(page, LIVE_ROW_ID)).toBe('rendered');
  });

  it.each(['sample', ...CategorySchema.options.map((category) => sampleRun(category).runId)])(
    'sample id %s still renders, signed out: 200, unchanged',
    async (id) => {
      expect(await outcome(page, id)).toBe('rendered');
    },
  );
});

describe('the resolver: an id that cannot be a row id never reaches the database', () => {
  /**
   * `runs.id` is a uuid column. Asked for `does-not-exist`, Postgres rejects the
   * comparison (22P02) and the adapter throws, so a SIGNED-IN visitor on a
   * mistyped id would get the error page where a signed-out one gets the 404.
   * This repository stub fails the way the column does.
   */
  function strictRepo() {
    const base = repo();
    return {
      ...base,
      getRun: vi.fn(async (userId: string, id: string) => {
        if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
          throw new Error('getRun failed: invalid input syntax for type uuid');
        }
        return base.getRun(userId, id);
      }),
    };
  }

  it('resolveRun answers null for a malformed id, signed in, without asking the repository', async () => {
    const strict = strictRepo();
    asMock(getRunRepository).mockResolvedValue(strict);
    viewer(STRANGER);

    await expect(resolveRun('does-not-exist')).resolves.toBeNull();
    expect(strict.getRun).not.toHaveBeenCalled();
  });

  it('resolveFixReport answers null for a malformed id, signed in', async () => {
    asMock(getRunRepository).mockResolvedValue(strictRepo());
    viewer(STRANGER);

    await expect(resolveFixReport('does-not-exist')).resolves.toBeNull();
  });

  it.each(PAGES)(
    '%s: a malformed id is a 404 for a signed-in visitor, not an error',
    async (_r, page) => {
      asMock(getRunRepository).mockResolvedValue(strictRepo());
      viewer(STRANGER);

      await expect(open(page, 'does-not-exist')).rejects.toMatchObject(NOT_FOUND);
    },
  );

  it('a well-formed id is still looked up, owner-scoped', async () => {
    const strict = strictRepo();
    asMock(getRunRepository).mockResolvedValue(strict);
    viewer(OWNER);

    await expect(resolveRun(LIVE_ROW_ID)).resolves.toMatchObject({ origin: 'live' });
    expect(strict.getRun).toHaveBeenCalledWith(OWNER, LIVE_ROW_ID);
  });
});

describe('the tab title follows the run', () => {
  /**
   * The browser ends up with the PAGE's metadata even when the page answers
   * notFound(), so the page has to say "not found" itself. And it has to say it
   * the same way for every id the viewer may not see.
   */
  const title = async (
    metadata: typeof runMetadata | typeof reportMetadata,
    id: string,
  ): Promise<unknown> => (await metadata({ params: Promise.resolve({ id }) })).title;

  it.each([
    ['/runs/[id]', runMetadata, 'Run not found · MCProof'],
    ['/findings/[id]', reportMetadata, 'Report not found · MCProof'],
  ] as const)(
    '%s: unknown, signed out and another account all get the same not-found title',
    async (_route, metadata, expected) => {
      const titles = [await title(metadata, NO_SUCH_ROW_ID), await title(metadata, LIVE_ROW_ID)];
      viewer(STRANGER);
      titles.push(await title(metadata, NO_SUCH_ROW_ID), await title(metadata, LIVE_ROW_ID));
      titles.push(await title(metadata, 'does-not-exist'));

      expect(new Set(titles)).toEqual(new Set([expected]));
    },
  );

  it('a run that resolves keeps the titles it had', async () => {
    expect(await title(runMetadata, 'sample')).toBe('Live Attack Replay · MCProof');
    viewer(OWNER);
    expect(await title(runMetadata, LIVE_ROW_ID)).toBe('Live Attack Replay · MCProof');
  });

  it('a report that resolves has a title of its own, not the site default', async () => {
    expect(await title(reportMetadata, 'sample')).toBe('Fix report · MCProof');
    viewer(OWNER);
    expect(await title(reportMetadata, LIVE_ROW_ID)).toBe('Fix report · MCProof');
  });
});
