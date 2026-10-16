import { render } from '@testing-library/react';
import RunReplayPage from '@/app/(hud)/runs/[id]/page';
import FindingsPage from '@/app/(hud)/findings/[id]/page';
import { RunResultSchema, type RunResult } from '@/contract';
import { TraceBuilder } from '@/attacks/engine';
import { getUser } from '@/lib/auth/user';
import { getRunRepository } from '@/data/run-repository.factory';
import type { StoredRun } from '@/data/run-repository';

/**
 * S5 guard (ruling 2026-10-15 19:45): a stored run is written from what a
 * stranger's agent sent us and what the judge said about it, so every string in
 * it is untrusted. The replay and the report must print it as text. These tests
 * put markup in the model, the step text and the judge's rationale and assert
 * that it reaches the page as characters and creates no element and no handler.
 */

vi.mock('@/lib/auth/user', () => ({ getUser: vi.fn() }));
vi.mock('@/data/run-repository.factory', () => ({ getRunRepository: vi.fn() }));

const asMock = <T extends (...args: never[]) => unknown>(fn: T) => vi.mocked(fn);

const SCRIPT = '<script>window.__s5=1</script>';
const IMG = '<img src="s5-missing" onerror="window.__s5=2">';
const BREAKOUT = '" onfocus="window.__s5=3" autofocus data-s5="';

const ROW_ID = '55555555-5555-4555-8555-555555555555';

function markupRun(): RunResult {
  const b = new TraceBuilder({
    runId: 'markup-run-0001',
    target: '/api/mcp',
    model: `model ${SCRIPT}${BREAKOUT}`,
    category: 'ASI02',
  });
  b.principalInstruction(`summarize ${SCRIPT} ${IMG} ${BREAKOUT}`);
  const offending = b.toolCall('read_file', { path: `${IMG}${BREAKOUT}` });
  b.toolResult('read_file', `contents ${SCRIPT} ${IMG}`);
  b.taskComplete(`done ${IMG} ${BREAKOUT}`);
  const trace = b.build();
  return RunResultSchema.parse({
    runId: 'markup-run-0001',
    target: '/api/mcp',
    model: trace.model,
    category: 'ASI02',
    trace,
    verdict: {
      runId: 'markup-run-0001',
      compromised: true,
      score: 0.9,
      severity: 'High',
      category: 'ASI02',
      rationale: `The agent read ${SCRIPT} ${IMG} ${BREAKOUT} outside scope.`,
      stepId: offending,
    },
  });
}

function signedInOwnerOf(run: RunResult) {
  const row: StoredRun = { id: ROW_ID, userId: 'user-1', createdAt: '2026-10-15T00:00:00Z', run };
  asMock(getUser).mockResolvedValue({ id: 'user-1' } as never);
  asMock(getRunRepository).mockResolvedValue({
    saveRun: vi.fn(),
    listRuns: vi.fn(),
    countRunsSince: vi.fn(),
    findByRunId: vi.fn(),
    getRun: vi.fn(async (userId: string, id: string) =>
      userId === row.userId && id === row.id ? row : null,
    ),
  } as never);
}

/** No element, attribute or handler the payloads could have created. */
function expectNoInjectedMarkup(root: HTMLElement) {
  expect(root.querySelectorAll('script')).toHaveLength(0);
  expect(root.querySelector('img[src="s5-missing"]')).toBeNull();
  expect(root.querySelector('[data-s5]')).toBeNull();
  expect(root.querySelector('[autofocus]')).toBeNull();
  for (const el of root.querySelectorAll('*')) {
    for (const attr of el.getAttributeNames()) {
      expect(attr.startsWith('on'), `${el.tagName} carries ${attr}`).toBe(false);
    }
  }
  expect((window as { __s5?: unknown }).__s5).toBeUndefined();
}

beforeEach(() => {
  vi.clearAllMocks();
  delete (window as { __s5?: unknown }).__s5;
});

describe('the check itself', () => {
  // The page tests pass today, so this is what proves they can fail: the same
  // payloads, parsed as HTML instead of printed as text, must trip the check.
  it.each([
    ['a script element', SCRIPT],
    ['an image with an error handler', IMG],
    ['an attribute breakout', `<span data-x="${BREAKOUT}"></span>`],
  ])('catches %s that was parsed as markup', (_name, payload) => {
    const parsed = document.createElement('div');
    parsed.innerHTML = payload;
    expect(() => expectNoInjectedMarkup(parsed)).toThrow();
  });
});

describe('/runs/[id]: a stored run whose strings hold markup', () => {
  it('prints the model and the step text as characters', async () => {
    const run = markupRun();
    signedInOwnerOf(run);
    const { container } = render(await RunReplayPage({ params: Promise.resolve({ id: ROW_ID }) }));

    const text = container.textContent ?? '';
    expect(text).toContain(run.model);
    expect(text).toContain(`summarize ${SCRIPT} ${IMG} ${BREAKOUT}`);
  });

  it('creates no element, attribute or handler from it', async () => {
    signedInOwnerOf(markupRun());
    const { container } = render(await RunReplayPage({ params: Promise.resolve({ id: ROW_ID }) }));

    expectNoInjectedMarkup(container);
  });
});

describe('/findings/[id]: a stored run whose strings hold markup', () => {
  it("prints the judge's rationale and the model as characters", async () => {
    const run = markupRun();
    signedInOwnerOf(run);
    const { container } = render(await FindingsPage({ params: Promise.resolve({ id: ROW_ID }) }));

    const text = container.textContent ?? '';
    expect(text).toContain(run.verdict.rationale);
    expect(text).toContain(run.model);
  });

  it('creates no element, attribute or handler from it', async () => {
    signedInOwnerOf(markupRun());
    const { container } = render(await FindingsPage({ params: Promise.resolve({ id: ROW_ID }) }));

    expectNoInjectedMarkup(container);
  });
});
