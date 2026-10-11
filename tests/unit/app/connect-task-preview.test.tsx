import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ConnectPage from '@/app/(hud)/connect/page';
import { CategorySchema } from '@/contract';
import { buildHostedSurface } from '@/harness/server/surfaces';
import { getUser } from '@/lib/auth/user';

vi.mock('@/lib/auth/user', () => ({ getUser: vi.fn() }));

// Mocked for the same reason as in connect-signed-in.test.tsx: this file tests
// what the route hands the screen, not what the actions do.
vi.mock('@/app/actions/live-run', () => ({
  startLiveRun: vi.fn(async () => ({ ok: false, code: 'INVALID_REQUEST', message: 'no' })),
  getLiveRunStatus: vi.fn(async () => ({ ok: false, code: 'RUN_NOT_FOUND', message: 'no' })),
  finishLiveRun: vi.fn(async () => ({ ok: false, code: 'RUN_NOT_FOUND', message: 'no' })),
  getLiveRunReattach: vi.fn(async () => ({ ok: false, code: 'RUN_NOT_FOUND', message: 'no' })),
  discardLiveRun: vi.fn(async () => ({ ok: false, code: 'RUN_NOT_FOUND', message: 'no' })),
}));

/**
 * THE ROUTE BUILDS THE GOAL MAP, AND IT IS THE GOAL A RUN REALLY SERVES.
 *
 * The preview is only worth having if it shows the same sentence the hosted
 * endpoint will hand the agent. So this compares what the route renders against
 * `buildHostedSurface(category, kind).taskGoal`, the lookup the live pipeline
 * itself uses when a run is minted.
 */
describe('Connect page · the task preview shows the goal a live run serves', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUser).mockResolvedValue(null as never);
  });

  it.each(CategorySchema.options)('previews the served goal for %s', async (category) => {
    const user = userEvent.setup();
    render(await ConnectPage());

    await user.click(screen.getByRole('radio', { name: new RegExp(category) }));

    expect(screen.getByRole('group', { name: /task preview/i })).toHaveTextContent(
      buildHostedSurface(category, 'malicious').taskGoal,
    );
  });

  /*
   * The map is keyed by category alone, which is only honest while the attack
   * run and the control run of a category share one goal. They do today. If a
   * pinned pair ever gives them different goals this fails, and the map has to
   * grow a run-type key before the preview can be trusted again.
   */
  it.each(CategorySchema.options)(
    'serves %s the same goal for the attack run and the control run',
    (category) => {
      expect(buildHostedSurface(category, 'benign').taskGoal).toBe(
        buildHostedSurface(category, 'malicious').taskGoal,
      );
    },
  );
});
