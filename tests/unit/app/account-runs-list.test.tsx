import { render, screen, within } from '@testing-library/react';
import AccountPage from '@/app/(hud)/account/page';
import type { RunResult } from '@/contract';
import { getDiscardedRunStore } from '@/data/discarded-run-store.factory';
import { InMemoryRunRepository, type DiscardedRun } from '@/data/run-repository';
import { getRunRepository } from '@/data/run-repository.factory';
import { getDataSource } from '@/data/source';
import { UNKNOWN_CLIENT } from '@/harness/server/recorder';
import { requireUser } from '@/lib/auth/user';
import { localDateTime } from '@/lib/display/dates';

/**
 * LAUNCH POLISH, Part 4 (owner rulings YOUR RUNS LIST, 2026-10-21, and
 * 2026-10-23). Each row of Your runs says whether it was an attack or a
 * control, or that its kind was not recorded (a run saved before the kind was
 * kept); a run no agent connected to says so rather than printing the
 * recorder's placeholder; the date carries the local time and its zone. The
 * discarded row keeps DISCARDED, NOT GRADED and no replay link.
 */
vi.mock('@/lib/auth/user', () => ({ requireUser: vi.fn() }));
vi.mock('@/lib/auth/actions', () => ({ signOut: vi.fn() }));
vi.mock('@/data/run-repository.factory', () => ({ getRunRepository: vi.fn() }));
vi.mock('@/data/discarded-run-store.factory', () => ({ getDiscardedRunStore: vi.fn() }));

const OWNER = 'u1';
let repository: InMemoryRunRepository;

async function sample(model?: string): Promise<RunResult> {
  const run = await getDataSource().getRun('sample');
  if (!run) throw new Error('sample run missing');
  return model === undefined ? run : { ...run, model, trace: { ...run.trace, model } };
}

const marker = (model: string): DiscardedRun => ({
  discarded: true,
  runId: 'hosted-9',
  category: 'ASI05',
  model,
  steps: 2,
  toolCalls: 0,
  discardedAt: '2026-10-21T10:00:00.000Z',
});

beforeEach(() => {
  vi.clearAllMocks();
  repository = new InMemoryRunRepository();
  vi.mocked(getRunRepository).mockResolvedValue(repository);
  vi.mocked(getDiscardedRunStore).mockResolvedValue(repository);
  vi.mocked(requireUser).mockResolvedValue({ id: OWNER, email: 'a@b.com' } as never);
});

const kindOf = (item: HTMLElement) => item.querySelector('[data-run-kind]')?.textContent ?? null;

describe('Your runs: attack, control, or kind not recorded', () => {
  it('says attack, control, or kind not recorded on each row', async () => {
    const run = await sample();
    await repository.saveRun(OWNER, run, 'malicious');
    await repository.saveRun(OWNER, run, 'benign');
    await repository.saveRun(OWNER, run, null);

    render(await AccountPage());

    const kinds = screen.getAllByRole('listitem').map(kindOf).sort();
    expect(kinds).toEqual(['attack', 'control', 'kind not recorded']);
  });

  it('keeps an old run with no recorded kind openable in its replay', async () => {
    const stored = await repository.saveRun(OWNER, await sample(), null);
    render(await AccountPage());
    const item = screen.getByRole('listitem');
    expect(kindOf(item)).toBe('kind not recorded');
    expect(within(item).getByRole('link', { name: /replay/i })).toHaveAttribute(
      'href',
      `/runs/${stored.id}`,
    );
  });

  it('says it on a discarded row too, which keeps DISCARDED, NOT GRADED and no link', async () => {
    await repository.saveDiscardedRun(OWNER, marker('claude-code'), 'benign');
    render(await AccountPage());
    const item = screen.getByRole('listitem');
    expect(kindOf(item)).toBe('control');
    expect(within(item).getByText('DISCARDED')).toBeInTheDocument();
    expect(within(item).getByText(/not graded/i)).toBeInTheDocument();
    expect(within(item).queryByRole('link')).toBeNull();
  });
});

describe('Your runs: a run no agent connected to', () => {
  it('reads "no agent connected", never the recorder placeholder', async () => {
    await repository.saveRun(OWNER, await sample(UNKNOWN_CLIENT), 'malicious');
    await repository.saveDiscardedRun(OWNER, marker(UNKNOWN_CLIENT), 'malicious');
    const { container } = render(await AccountPage());
    expect(screen.getAllByText('no agent connected')).toHaveLength(2);
    expect(container.textContent).not.toContain(UNKNOWN_CLIENT);
  });

  it('prints a named agent as it was reported', async () => {
    await repository.saveRun(OWNER, await sample('claude-code'), 'malicious');
    render(await AccountPage());
    expect(screen.getByText('claude-code')).toBeInTheDocument();
  });
});

describe('Your runs: the date includes the local time and its zone', () => {
  it('reads like "run Oct 21, 2026, 7:09 PM CDT", in a <time> holding the stored ISO value', async () => {
    const stored = await repository.saveRun(OWNER, await sample(), 'malicious');
    render(await AccountPage());
    const time = screen.getByText(`run ${localDateTime(stored.createdAt)}`);
    expect(time.tagName).toBe('TIME');
    expect(time).toHaveAttribute('dateTime', stored.createdAt);
    expect(time.textContent).toMatch(/^run [A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M \S+$/);
  });

  it('formats the example from the ruling exactly, in Central time', () => {
    expect(localDateTime('2026-10-22T00:09:00.000Z', 'America/Chicago')).toBe(
      'Oct 21, 2026, 7:09 PM CDT',
    );
  });
});
