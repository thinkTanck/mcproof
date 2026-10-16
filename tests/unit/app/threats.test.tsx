import { render, screen, within } from '@testing-library/react';
import ThreatsPage from '@/app/(hud)/threats/page';
import { getDataSource } from '@/data/source';
import { asi10 } from '@/attacks/asi10';

/**
 * /threats — Threat Model / Coverage. An editorial reference over all ten OWASP
 * Agentic categories: seven COVERED, three NOT MEASURABLE (--status-inert, never
 * red). These tests assert the honest substance renders (pinned codes + titles,
 * the measurability bar, the three-state legend, and the not-measurable reasons)
 * and that the not-measurable state never borrows the breach-red signal.
 *
 * The page is a server component that derives each covered row's "watch" target
 * from the sample library, so the tests render its resolved tree.
 */

const renderPage = async () => render(await ThreatsPage());

const COVERED = ['ASI01', 'ASI02', 'ASI03', 'ASI04', 'ASI05', 'ASI06', 'ASI10'] as const;

const PINNED: Array<[string, string]> = [
  ['ASI01', 'Agent Goal Hijack'],
  ['ASI02', 'Tool Misuse and Exploitation'],
  ['ASI03', 'Identity and Privilege Abuse'],
  ['ASI04', 'Agentic Supply Chain Vulnerabilities'],
  ['ASI05', 'Unexpected Code Execution (RCE)'],
  ['ASI06', 'Memory & Context Poisoning'],
  ['ASI07', 'Insecure Inter-Agent Communication'],
  ['ASI08', 'Cascading Agent Failures'],
  ['ASI09', 'Human-Agent Trust Exploitation'],
  ['ASI10', 'Rogue Agents'],
];

describe('Threat Model / Coverage (/threats)', () => {
  it('renders a single level-1 heading (heading order starts at h1)', async () => {
    await renderPage();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('states the measurability bar in the header', async () => {
    await renderPage();
    expect(
      screen.getByText(/only if the harm shows up in the agent.s own steps during one run/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/^compromised at step N$/)).toBeInTheDocument();
    expect(screen.getByText(/^not compromised$/)).toBeInTheDocument();
  });

  it('renders all ten codes with their pinned titles verbatim', async () => {
    await renderPage();
    for (const [code, title] of PINNED) {
      expect(screen.getByText(code)).toBeInTheDocument();
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it('pins ASI04 as "Vulnerabilities" and never "Compromise"', async () => {
    await renderPage();
    expect(screen.getByText('Agentic Supply Chain Vulnerabilities')).toBeInTheDocument();
    expect(screen.queryByText(/Agentic Supply Chain Compromise/i)).not.toBeInTheDocument();
  });

  it('shows a three-state legend: covered, not testable, could be added later', async () => {
    await renderPage();
    const legend = screen.getByRole('list', { name: /coverage legend/i });
    expect(within(legend).getByText(/covered/i)).toBeInTheDocument();
    expect(within(legend).getByText(/not testable/i)).toBeInTheDocument();
    expect(within(legend).getByText(/could be added later/i)).toBeInTheDocument();
  });

  it('marks ASI07/08/09 NOT TESTABLE with their honest reasons', async () => {
    await renderPage();
    const cases: Array<[string, RegExp]> = [
      ['ASI07', /no step for messages between agents/i],
      ['ASI08', /a fault spreading from one part to the next/i],
      ['ASI09', /a person acts on what the agent said/i],
    ];
    for (const [code, reason] of cases) {
      const entry = screen.getByTestId(`threat-${code}`);
      expect(entry).toHaveAttribute('data-state', 'inert');
      expect(within(entry).getByText(/not testable/i)).toBeInTheDocument();
      expect(within(entry).getByText(reason)).toBeInTheDocument();
    }
  });

  it('keeps the not-testable rows on the "What we can test" link, not a run', async () => {
    await renderPage();
    for (const code of ['ASI07', 'ASI08', 'ASI09']) {
      const entry = screen.getByTestId(`threat-${code}`);
      expect(within(entry).getByRole('link', { name: /what we can test/i })).toBeInTheDocument();
      expect(
        within(entry).queryByRole('link', { name: /watch a sample run/i }),
      ).not.toBeInTheDocument();
    }
  });

  it('never styles the not-measurable state with breach red', async () => {
    await renderPage();
    for (const code of ['ASI07', 'ASI08', 'ASI09']) {
      const entry = screen.getByTestId(`threat-${code}`);
      // No breach/red token or class leaks into the inert state.
      expect(entry.innerHTML).not.toMatch(/breach|red-|status-breach|glow-breach/i);
      expect(entry.querySelector('[class*="breach"]')).toBeNull();
      // The inert marker resolves through the neutral token, not a status one.
      expect(entry.innerHTML).toContain('var(--status-inert)');
    }
  });

  it('covers the seven Core-7 categories (state=covered)', async () => {
    await renderPage();
    for (const code of COVERED) {
      expect(screen.getByTestId(`threat-${code}`)).toHaveAttribute('data-state', 'covered');
    }
  });

  /**
   * THE DRIFT GUARD. Every covered row's "watch" button used to hardcode
   * `/runs/sample`, so all seven opened the featured ASI02 run regardless of which
   * threat they sat under (same class of bug as the Findings nav and the hero
   * label). Each row must link to ITS OWN category's sample run, derived from the
   * source rather than a literal, so it cannot silently drift again.
   */
  it('links each covered row to its OWN category sample run, never the featured one', async () => {
    const runs = await getDataSource().listRuns();
    const runIdByCategory = Object.fromEntries(runs.map((r) => [r.category, r.runId]));
    await renderPage();

    const featuredHref = `/runs/${runIdByCategory.ASI02}`;
    for (const code of COVERED) {
      const entry = screen.getByTestId(`threat-${code}`);
      const watch = within(entry).getByRole('link', { name: /watch a sample run/i });
      expect(watch).toHaveAttribute('href', `/runs/${runIdByCategory[code]}`);
      if (code !== 'ASI02') {
        expect(watch).not.toHaveAttribute('href', featuredHref);
      }
    }
  });

  /**
   * D1 — ASI10 is covered AND its classification is measured at 0 of 4. The row
   * has to say both without overclaiming in either direction: it stays covered
   * (detection is reliable, recall 1.0000 with the offending step anchored) and
   * it states plainly that the filing is not.
   */
  describe('ASI10 — detection reliable, classification unreliable', () => {
    it('stays COVERED: a measured filing weakness is not a failing category', async () => {
      await renderPage();
      const entry = screen.getByTestId('threat-ASI10');
      expect(entry).toHaveAttribute('data-state', 'covered');
      expect(within(entry).getByText(/covered/i)).toBeInTheDocument();
      expect(within(entry).queryByText(/not testable/i)).not.toBeInTheDocument();
    });

    it('states the measured split: detection holds, classification does not', async () => {
      await renderPage();
      const entry = screen.getByTestId('threat-ASI10');
      expect(within(entry).getByText(/caught reliably/i)).toBeInTheDocument();
      expect(within(entry).getByText(/attack type often wrong/i)).toBeInTheDocument();
      expect(within(entry).getByText(/0 of 4/)).toBeInTheDocument();
      expect(within(entry).getByText(/fix reports leave out fix steps/i)).toBeInTheDocument();
    });

    it('renders the caveat in the neutral inert token, never breach red', async () => {
      await renderPage();
      const caveat = screen.getByTestId('threat-caveat-ASI10');
      expect(caveat.innerHTML).not.toMatch(/breach|status-breach|glow-breach/i);
      expect(caveat.innerHTML).toContain('var(--status-inert)');
    });

    it('counts the rogue-behavior kinds it tests from the attack itself', async () => {
      // The row once said "three signatures" while src/attacks/asi10.ts held four
      // pairs. The number in the sentence is the number of malicious realizations.
      const kinds = asi10.variants.filter((v) => v.kind === 'malicious').length;
      const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
      await renderPage();
      const entry = screen.getByTestId('threat-ASI10');
      expect(
        within(entry).getByText(new RegExp(`We test ${words[kinds]} kinds of rogue behavior`)),
      ).toBeInTheDocument();
    });

    it('carries no caveat on the categories that have none', async () => {
      await renderPage();
      for (const code of ['ASI01', 'ASI02', 'ASI05', 'ASI07']) {
        expect(screen.queryByTestId(`threat-caveat-${code}`)).not.toBeInTheDocument();
      }
    });
  });

  it('links every entry to the OWASP source on genai.owasp.org', async () => {
    await renderPage();
    const owasp = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href')?.includes('genai.owasp.org'));
    expect(owasp.length).toBeGreaterThanOrEqual(10);
    for (const a of owasp) {
      expect(a).toHaveAttribute('href', expect.stringContaining('genai.owasp.org'));
    }
  });
});

/**
 * A CODE IS TIED TO ITS NAME (UI audit 2026-10-12, batch C). On the board the
 * code and the title are two elements of one rail, so the code points at the
 * title, and the caveat's prose names each code it mentions.
 */
describe('Threat Model / Coverage · every code is named', () => {
  it('ties each code on the rail to the title beside it', async () => {
    await renderPage();
    for (const [code, title] of PINNED) {
      const id = screen.getByText(code).getAttribute('aria-describedby');
      expect(id, code).toBeTruthy();
      expect(document.getElementById(id!)).toHaveTextContent(title);
    }
  });

  it('names every code the ASI10 caveat mentions, in the sentence', async () => {
    await renderPage();
    const caveat = screen.getByTestId('threat-caveat-ASI10').textContent ?? '';
    expect(caveat).toContain('ASI10 Rogue Agents');
    expect(caveat).toContain('ASI01 Agent Goal Hijack');
    expect(caveat).toContain('ASI03 Identity and Privilege Abuse');
  });
});
