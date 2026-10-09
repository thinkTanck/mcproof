/**
 * THE SCHEDULED TRIGGER, at the route.
 *
 * The reaper spends operator money (it asks the judge) and writes to every
 * account's runs, so the door it sits behind is the whole security story of this
 * route. It is a shared secret in an `Authorization` header, compared in constant
 * time, and it FAILS CLOSED: with nothing configured, every caller is refused,
 * including the platform's own scheduler.
 */
import { GET } from '@/app/api/cron/reap-runs/route';

const SECRET = 'cron-secret-value-for-tests';

const reap = vi.fn(async () => ({
  examined: 0,
  judged: 0,
  closed: 0,
  contended: 0,
  refused: 0,
  failed: 0,
  swept: 0,
}));

vi.mock('@/runs/reaper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/runs/reaper')>();
  return { ...actual, reapAbandonedRuns: (...args: unknown[]) => reap(...(args as [])) };
});

function call(header?: string): Promise<Response> {
  const headers = new Headers();
  if (header !== undefined) headers.set('authorization', header);
  return GET(new Request('https://mcproof.test/api/cron/reap-runs', { headers }));
}

beforeEach(() => {
  reap.mockClear();
  vi.unstubAllEnvs();
});

describe('/api/cron/reap-runs', () => {
  it('refuses everyone when no shared secret is configured, and reaps nothing', async () => {
    const response = await call(`Bearer ${SECRET}`);

    expect(response.status).toBe(401);
    expect(reap).not.toHaveBeenCalled();
  });

  it('refuses a caller with no credential', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);

    expect((await call()).status).toBe(401);
    expect(reap).not.toHaveBeenCalled();
  });

  it('refuses a caller presenting the wrong value', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);

    expect((await call('Bearer not-the-value')).status).toBe(401);
    // A near miss of the right LENGTH is refused too, and by the same answer.
    expect((await call(`Bearer ${'x'.repeat(SECRET.length)}`)).status).toBe(401);
    expect(reap).not.toHaveBeenCalled();
  });

  it('runs one pass for the platform scheduler and reports what it did', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);

    const response = await call(`Bearer ${SECRET}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      examined: 0,
      judged: 0,
      closed: 0,
      contended: 0,
      refused: 0,
      failed: 0,
      swept: 0,
    });
    expect(reap).toHaveBeenCalledTimes(1);
  });

  it('never echoes the configured value back, whatever it is asked', async () => {
    vi.stubEnv('CRON_SECRET', SECRET);

    const refused = await (await call('Bearer wrong')).text();
    const allowed = await (await call(`Bearer ${SECRET}`)).text();

    expect(refused).not.toContain(SECRET);
    expect(allowed).not.toContain(SECRET);
  });
});
