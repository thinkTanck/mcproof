import { render, screen, within } from '@testing-library/react';
import { LeaderboardHeatmap } from '@/components/leaderboard';
import type { BoardProvenance, Leaderboard, LeaderboardCell } from '@/data/source';

/**
 * The heatmap must be GENERIC over `categories.length` (the Core-7 makes it 7)
 * and it must never let one cell state pass for another. Three states, and the
 * tests below hold each one to a visible, non-colour channel:
 *
 *   MEASURED - the value plus its run count.
 *   FIXTURE  - the value, no run count, "fixture data" in the accessible name.
 *   NO DATA  - the words "No data", never a 0.00 and never breach red.
 */
const cell = (
  model: string,
  category: string,
  robustness: number,
  state: BoardProvenance = 'fixture',
  runs = 25,
): LeaderboardCell => ({ model, category, state, robustness, runs });

const noData = (model: string, category: string): LeaderboardCell => ({
  model,
  category,
  state: 'none',
  robustness: null,
  runs: 0,
});

const CATS = [
  { id: 'ASI01', full: 'Agent Goal Hijack' },
  { id: 'ASI02', full: 'Tool Misuse and Exploitation' },
  { id: 'ASI03', full: 'Identity and Privilege Abuse' },
  { id: 'ASI04', full: 'Agentic Supply Chain Vulnerabilities' },
  { id: 'ASI05', full: 'Unexpected Code Execution' },
  { id: 'ASI06', full: 'Memory & Context Poisoning' },
  { id: 'ASI10', full: 'Rogue Agents' },
];

const sevenColMock: Leaderboard = {
  source: 'fixture',
  runs: 350,
  categories: CATS,
  rows: [
    {
      model: 'M1',
      overall: 0.62,
      runs: 175,
      state: 'fixture',
      cells: [
        cell('M1', 'ASI01', 0.91), // nominal
        cell('M1', 'ASI02', 0.78), // caution
        cell('M1', 'ASI03', 0.4), // breach
        cell('M1', 'ASI04', 0.55),
        cell('M1', 'ASI05', 0.83),
        cell('M1', 'ASI06', 0.34),
        cell('M1', 'ASI10', 0.69),
      ],
    },
    {
      model: 'M2',
      overall: 0.71,
      runs: 175,
      state: 'fixture',
      cells: [
        cell('M2', 'ASI01', 0.88),
        cell('M2', 'ASI02', 0.6),
        cell('M2', 'ASI03', 0.72),
        cell('M2', 'ASI04', 0.49),
        cell('M2', 'ASI05', 0.9),
        cell('M2', 'ASI06', 0.51),
        cell('M2', 'ASI10', 0.81),
      ],
    },
  ],
};

/** A measured board with one covered category and six untouched ones. */
const measuredMock: Leaderboard = {
  source: 'measured',
  runs: 4,
  categories: CATS,
  rows: [
    {
      model: 'agent-under-test',
      overall: 0.25,
      runs: 4,
      state: 'measured',
      cells: [
        cell('agent-under-test', 'ASI01', 0.25, 'measured', 4),
        ...CATS.slice(1).map((c) => noData('agent-under-test', c.id)),
      ],
    },
  ],
};

function renderHeatmap() {
  return render(<LeaderboardHeatmap leaderboard={sevenColMock} />);
}

describe('LeaderboardHeatmap', () => {
  it('renders one column header per category (7 here — generic over categories.length)', () => {
    renderHeatmap();
    for (const c of CATS) {
      expect(screen.getByRole('columnheader', { name: new RegExp(c.id) })).toBeInTheDocument();
    }
    // MODEL + 7 categories + OVERALL = 9 column headers.
    expect(screen.getAllByRole('columnheader')).toHaveLength(CATS.length + 2);
    expect(screen.getByRole('columnheader', { name: /overall/i })).toBeInTheDocument();
  });

  it('renders one cell per model × category (2 × 7 = 14), none of them a link', () => {
    const { container } = renderHeatmap();
    // The drill-in was removed with the fabricated board, so cells no longer link
    // anywhere: there is no per-cell run to open, and nothing to collapse to a
    // featured run.
    expect(container.querySelectorAll('[data-cell-state="fixture"]')).toHaveLength(2 * CATS.length);
    const region = screen.getByRole('region', { name: /heatmap/i });
    expect(within(region).queryAllByRole('link')).toHaveLength(0);
  });

  it('surfaces the single weakest cell as a focal callout (text, not a link)', () => {
    renderHeatmap();
    // The weakest cell is M1 × ASI06 at 0.34. The callout states it for assistive
    // tech; with the drill-in gone it is no longer a link.
    expect(screen.getByText(/Weakest fixture cell:.*ASI06.*0\.34.*BREACH/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Weakest fixture cell/i })).not.toBeInTheDocument();
  });

  it('makes each cell the value-as-hero and names its band in text (never color-only)', () => {
    const { container } = renderHeatmap();
    // Each cell names its band in its accessible text, so the band never rides on
    // colour alone. (Cell name uses " · " between model and category.)
    expect(screen.getByText(/M1 · ASI03.*0\.40.*BREACH/)).toBeInTheDocument();
    expect(screen.getByText(/M1 · ASI01.*0\.91.*NOMINAL/)).toBeInTheDocument();
    expect(screen.getByText(/M1 · ASI02.*0\.78.*CAUTION/)).toBeInTheDocument();
    // The value itself is the visible hero, and a band-shape glyph carries the
    // band without relying on colour.
    expect(screen.getByText('0.40')).toBeInTheDocument();
    expect(
      container.querySelector('td[data-cell-state="fixture"] svg[aria-hidden="true"]'),
    ).toBeInTheDocument();
  });

  it('renders the per-row OVERALL magnitude', () => {
    renderHeatmap();
    expect(screen.getByText('0.62')).toBeInTheDocument();
    expect(screen.getByText('0.71')).toBeInTheDocument();
  });

  it('exposes a sticky model column (2-D heatmap horizontal-scroll pattern)', () => {
    const { container } = renderHeatmap();
    const sticky = container.querySelectorAll('[data-sticky="model"]');
    // one MODEL header + one per model row
    expect(sticky.length).toBe(1 + sevenColMock.rows.length);
    expect(container.querySelector('th[data-sticky="model"]')).toBeInTheDocument();
  });

  it('labels a fixture board as a fixture, in the readout AND in every cell', () => {
    renderHeatmap();
    expect(screen.getByText(/source\s*·\s*fixture/i)).toBeInTheDocument();
    expect(screen.getByText(/not a claimed benchmark/i)).toBeInTheDocument();
    // Every scored cell repeats it, so provenance travels with the value rather
    // than sitting in a chip a screen-reader user has to go and find: at least one
    // per model × category cell (14), all inside the scroll region.
    const region = screen.getByRole('region', { name: /heatmap/i });
    expect(within(region).getAllByText(/fixture data/i).length).toBeGreaterThanOrEqual(
      2 * CATS.length,
    );
  });

  it('never dresses a fixture cell as a measured one: no run count, no breach glow', () => {
    const { container } = renderHeatmap();
    expect(screen.queryByText(/^n=/)).not.toBeInTheDocument();
    expect(container.querySelector('.shadow-glow-breach')).toBeNull();
  });

  it('provides a keyboard-operable, labelled scroll region with a swipe affordance', () => {
    renderHeatmap();
    const region = screen.getByRole('region', { name: /heatmap/i });
    expect(region).toHaveAttribute('tabindex', '0');
    // The swipe cue (owner ruling 2026-10-18): one sentence, pointing at this
    // region, and drawn only when the table really overflows it. Before it is
    // measured it is in the markup, ready, and not yet decided.
    const cue = screen.getByText('Swipe the table left to see all 7 attack types.');
    expect(cue.closest('[data-swipe-cue]')).toHaveAttribute('data-swipe-cue', region.id);
    expect(screen.queryByText(/The model column stays in place/i)).toBeNull();
  });

  it('shows No data for an OVERALL with no valid runs, never 0.00, and names no weakest cell', () => {
    const allExcluded: Leaderboard = {
      source: 'measured',
      runs: 0,
      categories: CATS,
      rows: [
        {
          model: 'only-broken',
          overall: null,
          runs: 0,
          state: 'measured',
          cells: CATS.map((c) => noData('only-broken', c.id)),
        },
      ],
    };
    const { container } = render(<LeaderboardHeatmap leaderboard={allExcluded} />);
    const row = screen.getByRole('row', { name: /only-broken/ });
    expect(row).not.toHaveTextContent('0.00');
    const overall = row.querySelector('[data-overall]')!;
    expect(overall).toHaveTextContent('No data');
    expect(overall).toHaveAttribute('data-cell-state', 'none');
    // No cell has data, so no weakest (or strongest) is named.
    expect(screen.queryByText(/weakest/i)).toBeNull();
    expect(container.querySelector('[data-weakest]')).toBeNull();
  });

  describe('a MEASURED board', () => {
    it('says measured, states each run count, and links no run it cannot serve', () => {
      const { container } = render(<LeaderboardHeatmap leaderboard={measuredMock} />);
      expect(screen.getByText(/source\s*·\s*measured/i)).toBeInTheDocument();
      expect(screen.getByText('n=4')).toBeInTheDocument();
      const region = screen.getByRole('region', { name: /measured .*heatmap/i });
      expect(within(region).queryAllByRole('link')).toHaveLength(0);
      // The scored cell still names its value, band and sample size in text.
      expect(
        within(region).getByText(/agent-under-test.*ASI01.*0\.25.*BREACH.*measured over 4 runs/),
      ).toBeInTheDocument();
      expect(container.querySelector('[data-cell-state="measured"]')).toBeInTheDocument();
    });

    it('renders an uncovered pair as NO DATA, never as 0.00 and never in breach red', () => {
      const { container } = render(<LeaderboardHeatmap leaderboard={measuredMock} />);
      const blanks = container.querySelectorAll('[data-cell-state="none"]');
      expect(blanks).toHaveLength(CATS.length - 1);
      // Six blank cells + the legend entry, all reading the same words.
      expect(screen.getAllByText(/no data/i).length).toBeGreaterThanOrEqual(CATS.length - 1);
      // No blank has been formatted into a score.
      expect(screen.queryByText('0.00')).not.toBeInTheDocument();
      for (const blank of blanks) {
        expect(blank.className).not.toMatch(/breach/);
      }
    });

    it('keeps the reserved breach glow for a measured weakest cell', () => {
      const { container } = render(<LeaderboardHeatmap leaderboard={measuredMock} />);
      expect(container.querySelector('.shadow-glow-breach')).not.toBeNull();
    });
  });
});

/**
 * A COLUMN CODE IS NAMED IN SIGHT (UI audit 2026-10-12, batch C). A column is
 * too narrow for "Agentic Supply Chain Vulnerabilities", so the names are a
 * visible legend above the table and each column header points at its entry.
 * A `title` attribute is a hover tooltip and is not a name.
 */
describe('LeaderboardHeatmap · the column codes are named in a visible legend', () => {
  it('lists every code with its name as visible text', () => {
    renderHeatmap();
    const legend = screen.getByRole('list', { name: /category names/i });
    const entries = within(legend).getAllByRole('listitem');
    expect(entries).toHaveLength(CATS.length);
    for (const [i, c] of CATS.entries()) {
      expect(entries[i]).toHaveTextContent(`${c.id} ${c.full}`);
      expect(entries[i]!.closest('.sr-only')).toBeNull();
      expect(entries[i]!.querySelector('.sr-only')).toBeNull();
    }
  });

  it('ties each column header to its legend entry, and drops the hover title', () => {
    renderHeatmap();
    for (const c of CATS) {
      const header = screen.getByRole('columnheader', { name: new RegExp(c.id) });
      expect(header).not.toHaveAttribute('title');
      const id = header.getAttribute('aria-describedby');
      expect(id).toBeTruthy();
      expect(document.getElementById(id!)).toHaveTextContent(`${c.id} ${c.full}`);
    }
  });
});
