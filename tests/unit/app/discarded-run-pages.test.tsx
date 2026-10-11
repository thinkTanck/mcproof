/**
 * WHAT THE SCREENS SAY ABOUT A DISCARDED RUN.
 *
 * A discarded run has no verdict, so there is nothing to replay and nothing to
 * report. Its owner is told that in one plain sentence, with a 200; everybody
 * else gets the answer an id that never existed gets. It never reaches the
 * leaderboard, and on the account list it reads as discarded, not as a result.
 */
import { render, screen, within } from '@testing-library/react';
import RunReplayPage, { generateMetadata as runMetadata } from '@/app/(hud)/runs/[id]/page';
import FindingsPage, { generateMetadata as reportMetadata } from '@/app/(hud)/findings/[id]/page';
import AccountPage from '@/app/(hud)/account/page';
import LeaderboardPage from '@/app/(hud)/leaderboard/page';
import { InMemoryRunRepository, type DiscardedRun } from '@/data/run-repository';
import { getDiscardedRunStore } from '@/data/discarded-run-store.factory';
import { getRunRepository } from '@/data/run-repository.factory';
import { resolveRun } from '@/data/run-view';
import { getDataSource } from '@/data/source';
import { generateFixReport } from '@/fix-report';
import { getUser, requireUser } from '@/lib/auth/user';
import { RUN_DISCARDED_SENTENCE, RUN_DISCARDED_TITLE } from '@/runs/discard-copy';

vi.mock('@/lib/auth/user', () => ({ getUser: vi.fn(), requireUser: vi.fn() }));
vi.mock('@/lib/auth/actions', () => ({ signOut: vi.fn() }));
vi.mock('@/data/run-repository.factory', () => ({ getRunRepository: vi.fn() }));
vi.mock('@/data/discarded-run-store.factory', () => ({ getDiscardedRunStore: vi.fn() }));
vi.mock('@/fix-report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/fix-report')>();
  return { ...actual, generateFixReport: vi.fn(actual.generateFixReport) };
});

const OWNER = 'user-owner';
const STRANGER = 'user-stranger';
const NO_SUCH_ROW_ID = '00000000-0000-4000-8000-000000000000';

const DISCARDED: DiscardedRun = {
  discarded: true,
  runId: 'hosted-run-9',
  category: 'ASI05',
  model: 'manual-client',
  steps: 3,
  toolCalls: 1,
  discardedAt: '2026-10-09T10:00:00.000Z',
};

let repository: InMemoryRunRepository;
let discardedId: string;

function viewer(userId: string | null) {
  const user = userId === null ? null : { id: userId, email: 'a@b.com' };
  vi.mocked(getUser).mockResolvedValue(user as never);
  vi.mocked(requireUser).mockResolvedValue(user as never);
}

beforeEach(async () => {
  vi.clearAllMocks();
  repository = new InMemoryRunRepository();
  discardedId = (await repository.saveDiscardedRun(OWNER, DISCARDED)).id;
  // One table behind both ports, as in production.
  vi.mocked(getRunRepository).mockResolvedValue(repository);
  vi.mocked(getDiscardedRunStore).mockResolvedValue(repository);
  viewer(OWNER);
});

const PAGES = [
  ['/runs/[id]', RunReplayPage, runMetadata],
  ['/findings/[id]', FindingsPage, reportMetadata],
] as const;

type Page = (typeof PAGES)[number][1];
const open = (page: Page, id: string) => page({ params: Promise.resolve({ id }) });

async function outcome(page: Page, id: string): Promise<string> {
  try {
    await open(page, id);
    return 'rendered';
  } catch (error) {
    return String((error as { digest?: unknown }).digest ?? error);
  }
}

describe.each(PAGES)('%s: a discarded run, for its owner', (_route, page, metadata) => {
  it('says so in one plain sentence, as a rendered page and not a 404', async () => {
    render(await open(page, discardedId));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(RUN_DISCARDED_SENTENCE);
    expect(RUN_DISCARDED_SENTENCE).toBe('This run was discarded and not judged.');
  });

  it('sets the sentence in the READING role and the badge as an inert label with an icon', async () => {
    const { container } = render(await open(page, discardedId));

    const sentence = screen.getByRole('heading', { level: 1 });
    expect(sentence.className).toMatch(/\breading/);
    expect(sentence.className).not.toMatch(/micro-label|instrument|font-mono/);

    const badge = screen.getByText('RUN DISCARDED');
    expect(badge.className).toMatch(/\bmicro-label\b/);
    expect(badge.getAttribute('style')).toContain('--status-inert');
    expect(badge.querySelector('svg')).not.toBeNull();
    // Discarded is not a breach, and it is not a warning either.
    expect(container.innerHTML).not.toMatch(/breach|caution/);
  });

  it('shows no verdict, no replay and no report, and never builds a fix report', async () => {
    const { container } = render(await open(page, discardedId));

    expect(container.textContent).not.toMatch(/COMPROMISED|NOT COMPROMISED|CLEAR\b|severity/i);
    expect(screen.queryByRole('list', { name: /step timeline/i })).not.toBeInTheDocument();
    expect(generateFixReport).not.toHaveBeenCalled();
  });

  it('has a real page title', async () => {
    const meta = await metadata({ params: Promise.resolve({ id: discardedId }) });

    expect(meta.title).toBe(RUN_DISCARDED_TITLE);
    expect(RUN_DISCARDED_TITLE).toBe('Run discarded · MCProof');
  });

  it('offers a way on that is a full-size target', async () => {
    render(await open(page, discardedId));

    const link = screen.getByRole('link', { name: /connect your agent/i });
    expect(link).toHaveAttribute('href', '/connect');
    expect(link.className).toMatch(/\bmin-h-11\b/);
  });
});

describe.each(PAGES)('%s: a discarded run, for anybody else', (_route, page, metadata) => {
  it('answers another account exactly as it answers an id that never existed', async () => {
    viewer(STRANGER);

    const theirs = await outcome(page, discardedId);
    const unknown = await outcome(page, NO_SUCH_ROW_ID);

    expect(theirs).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
    expect(theirs).toBe(unknown);
  });

  it('answers a signed-out visitor the same way', async () => {
    viewer(null);

    expect(await outcome(page, discardedId)).toBe('NEXT_HTTP_ERROR_FALLBACK;404');
  });

  it('titles it as not found for them, never as discarded', async () => {
    viewer(STRANGER);

    const theirs = await metadata({ params: Promise.resolve({ id: discardedId }) });
    const unknown = await metadata({ params: Promise.resolve({ id: NO_SUCH_ROW_ID }) });

    expect(theirs.title).toBe(unknown.title);
    expect(theirs.title).not.toBe(RUN_DISCARDED_TITLE);
  });
});

describe('a discarded run is never a run view', () => {
  it('resolves to no run, so the shell draws no provenance chip for it', async () => {
    expect(await resolveRun(discardedId)).toBeNull();
  });
});

describe('/leaderboard: discarded runs never appear', () => {
  it('stays empty when the only stored row is a discarded run', async () => {
    render(await LeaderboardPage());

    expect(screen.getByText(/no measurement yet/i)).toBeInTheDocument();
    expect(screen.queryByText('manual-client')).not.toBeInTheDocument();
  });

  it('tallies the judged run and leaves the discarded one out', async () => {
    const judged = await getDataSource().getRun('sample');
    if (!judged) throw new Error('sample run missing');
    await repository.saveRun(OWNER, judged);

    const { container } = render(await LeaderboardPage());

    expect(screen.queryByText(/no measurement yet/i)).not.toBeInTheDocument();
    expect(container.textContent).toContain(judged.model);
    expect(container.textContent).not.toContain('manual-client');
  });
});

describe('/account: a discarded run reads as discarded, not as a result', () => {
  it('lists it with its category and the word DISCARDED, and no verdict', async () => {
    render(await AccountPage());

    const item = screen.getByText('DISCARDED').closest('li')!;
    expect(within(item).getByText('ASI05')).toBeInTheDocument();
    expect(item.textContent).not.toMatch(/COMPROMISED|CLEAR/);
    expect(screen.queryByText(/no runs yet/i)).not.toBeInTheDocument();
    // Inert, never the breach red and never the all-clear cyan.
    expect(within(item).getByText('DISCARDED').className).not.toMatch(/breach|nominal/);
  });

  it('offers no replay for it', async () => {
    render(await AccountPage());

    expect(screen.queryByRole('link', { name: /replay/i })).not.toBeInTheDocument();
  });

  it('lists judged and discarded runs together, newest first', async () => {
    const judged = await getDataSource().getRun('sample');
    if (!judged) throw new Error('sample run missing');
    await new Promise((r) => setTimeout(r, 5));
    const later = await repository.saveRun(OWNER, judged);

    render(await AccountPage());

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain(judged.category);
    expect(within(items[0]!).getByRole('link', { name: /replay/i })).toHaveAttribute(
      'href',
      `/runs/${later.id}`,
    );
    expect(items[1]!.textContent).toContain('DISCARDED');
  });
});

describe('the discarded state on its own', () => {
  it('prints what the run served and the day it was discarded, as stored', async () => {
    const { RunDiscarded } = await import('@/components/replay');
    render(
      <RunDiscarded surface="replay" category="ASI05" discardedAt="2026-10-09T10:00:00.000Z" />,
    );

    expect(screen.getByText('ASI05')).toBeInTheDocument();
    expect(screen.getByText('2026-10-09')).toBeInTheDocument();
  });

  it('prints neither when it was handed neither, and drops a date it cannot read', async () => {
    const { RunDiscarded } = await import('@/components/replay');
    const { container, rerender } = render(<RunDiscarded surface="report" />);
    expect(container.textContent).not.toMatch(/SERVED|DISCARDED \d/);

    rerender(<RunDiscarded surface="report" discardedAt="not a date" />);
    expect(container.textContent).not.toMatch(/Invalid|NaN/);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(RUN_DISCARDED_SENTENCE);
  });
});
