import { render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import AboutPage, { metadata } from '@/app/(hud)/about/page';
import * as copy from '@/lib/about/copy';
import { ABOUT_BIO, ABOUT_LINKEDIN_HREF, ABOUT_NAME } from '@/lib/about/copy';
import { ABOUT_SCRIPT } from '@/lib/about/script';
import { roadmapColumns } from '@/lib/about/roadmap';
import { SENTINEL_DEFINITION } from '@/lib/replay/roles';
import { NAV_ITEMS } from '@/components/shell/nav-items';
import { THREATS } from '@/components/threats/threat-data';
import { measuredCounts } from '@/lib/display/measured';

/**
 * /about (owner ruling ABOUT FINAL, 2026-10-20). One terminal: `man sentinel`,
 * a blank line, `whoami`, and a fresh prompt. Every word is real DOM text in
 * the server render; the playback only decides how it is drawn.
 */

const BIO =
  "I build AI systems, and I'm pursuing an M.S. in Artificial Intelligence at Johns Hopkins. I built MCProof because AI agents are vulnerable to tool misuse. Tool use is an attack vector in the agent harness, and it needs careful consideration.";

const FINAL_SCREEN = [
  'visitor@mcproof:~$ man sentinel',
  'SENTINEL(7) MCProof Manual SENTINEL(7)',
  '',
  'NAME',
  "sentinel - MCProof's proving ground",
  '',
  'DESCRIPTION',
  SENTINEL_DEFINITION,
  '',
  'visitor@mcproof:~$ whoami',
  'Dameion Ayers',
  BIO,
  '',
  'visitor@mcproof:~$',
];

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function renderAbout() {
  return render(<AboutPage />);
}

describe('/about · the page', () => {
  it('has a title of its own and one heading of level 1, "About", hidden from view', () => {
    expect(metadata.title).toBe('About · MCProof');
    expect(String(metadata.description)).not.toMatch(/—/);
    renderAbout();
    const h1 = screen.getAllByRole('heading', { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]).toHaveTextContent(/^About$/);
    expect(h1[0]!.className.split(/\s+/)).toContain('sr-only');
  });

  it('draws no visible "About" label and no "Why Sentinel" heading', () => {
    const { container } = renderAbout();
    expect(screen.queryByRole('heading', { name: /sentinel/i })).toBeNull();
    const visibleAbout = [...container.querySelectorAll('*')].filter(
      (el) =>
        el.children.length === 0 &&
        /^about$/i.test((el.textContent ?? '').trim()) &&
        !el.closest('.sr-only'),
    );
    expect(visibleAbout).toEqual([]);
  });

  it('prints the final screen exactly, line by line, as DOM text', () => {
    expect(ABOUT_NAME).toBe('Dameion Ayers');
    expect(ABOUT_BIO).toBe(BIO);
    const { container } = renderAbout();
    const terminals = container.querySelectorAll('[data-terminal]');
    expect(terminals).toHaveLength(1);
    const final = terminals[0]!.querySelector('[data-terminal-final]')!;
    expect(final.closest('[aria-hidden="true"]')).toBeNull();
    expect([...final.querySelectorAll('[data-line]')].map((el) => norm(el.textContent))).toEqual(
      FINAL_SCREEN,
    );
    // The script the playback runs is the same screen.
    expect(ABOUT_SCRIPT.map((line) => norm(line.text))).toEqual(
      FINAL_SCREEN.map((line) => line.replace(/^visitor@mcproof:~\$ ?/, '')),
    );
    expect(terminals[0]!.querySelector('[data-terminal-typed]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('lays the man page header out as three parts that can close up on a phone', () => {
    const { container } = renderAbout();
    const header = container.querySelector('[data-terminal-final] [data-line="man-header"]')!;
    expect(
      [...header.querySelector('[data-line-text]')!.children].map((el) => el.textContent),
    ).toEqual(['SENTINEL(7)', 'MCProof Manual', 'SENTINEL(7)']);
    expect(header.className.split(/\s+/)).toEqual(expect.arrayContaining(['flex', 'flex-wrap']));
  });

  it('has no outbound link, no handle or alias, and no photo', () => {
    const { container } = renderAbout();
    expect(container.querySelector('a[href^="http"], a[href^="mailto:"]')).toBeNull();
    expect(screen.queryByText(/Agentrifi/)).toBeNull();
    for (const alias of ['DameRA', 'DameionRA', 'thinkTanck', 'thinktanck']) {
      expect(container.innerHTML.toLowerCase()).not.toContain(alias.toLowerCase());
    }
    expect(container.querySelector('img, picture')).toBeNull();
    // Kept, unused, for later.
    expect(ABOUT_LINKEDIN_HREF).toBe('https://www.linkedin.com/in/dameion-a-662aa880/');
  });

  it('sends the terminal and the roadmap pending from the server, every word in it', () => {
    const html = renderToString(<AboutPage />);
    const states = [...html.matchAll(/data-(?:terminal|reveal)="[^"]+"[^>]*?data-state="(\w+)"/g)];
    expect(states.map((m) => m[1])).toEqual(['pending', 'pending']);
    expect(html).toContain('careful consideration.');
    expect(html).toContain('Sentinel is where we prove it.');
  });

  it('uses no em dash anywhere', () => {
    const { container } = renderAbout();
    expect(container.textContent).not.toMatch(/—/);
  });
});

describe('/about · the roadmap', () => {
  const covered = THREATS.filter((t) => t.state === 'covered').length;
  const c = measuredCounts();

  it(`is headed "What's next..." and has no note under the heading (ROADMAP NOTE, 2026-10-20)`, () => {
    const { container } = renderAbout();
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.textContent).toBe("What's next...");
    expect(container.textContent).not.toContain('Planned, not promised');
    expect(container.textContent).not.toContain('No dates.');
    expect('ROADMAP_NOTE' in copy).toBe(false);
  });

  it('keeps its three pills', () => {
    const { container } = renderAbout();
    const pills = [...container.querySelectorAll('[data-roadmap-column] [data-pill]')].map((p) =>
      norm(p.textContent),
    );
    expect(pills).toEqual(['Shipped (v1)', 'Next (v2)', 'Later (v3)']);
  });

  it('builds Shipped from the coverage board and the measurement, never typed numbers', () => {
    // The figures the cards quote, and that they are what the data says today.
    expect([covered, THREATS.length, c.caught, c.real, c.flagged - c.flaggedReal]).toEqual([
      7, 10, 22, 22, 1,
    ]);
    const [shipped] = roadmapColumns();
    expect(shipped!.cards.map((card) => [card.title, card.line])).toEqual([
      [
        'Seven attack types',
        'Seven of the ten OWASP agentic risks, tested live in one proving ground.',
      ],
      [
        'Verdicts you can check',
        'Caught 22 of 22 compromises in our labeled test set, with one false alarm. Every verdict points to the exact step.',
      ],
      [
        'Bring your own agent',
        'Claude Code, Copilot, Cursor, Codex and Gemini CLI connect in minutes.',
      ],
      ['Watch it break', 'Every step replayed, down to the moment the agent turns.'],
    ]);
    expect(shipped!.cards.map((card) => card.href)).toEqual([
      '/threats',
      undefined,
      '/connect',
      '/runs/sample',
    ]);
  });

  it('words Next and Later exactly, as plans', () => {
    const [, next, later] = roadmapColumns();
    expect(next!.cards.map((card) => [card.title, card.line])).toEqual([
      [
        'Any agent, any model',
        'Open-source and smaller models plug in, with first measured results for Copilot, Cursor, Codex and Gemini CLI.',
      ],
      ['Two judges, one verdict', 'A second detector model cross-checks every call.'],
      ['A private test set', 'A private attack set, kept off the public repo.'],
      ['Attack chains', 'Several attacks in one session, each building on the last.'],
    ]);
    expect(later!.cards.map((card) => [card.title, card.line])).toEqual([
      ['MCProof in your CI', 'Every agent update tested in CI before it ships.'],
      ['Agent versus agent', 'When your agent trusts another agent, we test that trust.'],
      ['The full Top 10', "The three risks one run can't reach, through multi-agent scenarios."],
      [
        'Regression alerts',
        'Scheduled re-tests that catch the update that made your agent easier to trick.',
      ],
      ['Live threat feed', 'New scenarios as real agent exploits are published.'],
    ]);
    for (const col of [next!, later!]) {
      for (const card of col.cards) {
        expect(`${card.title} ${card.line}`).not.toMatch(
          /\b(shipped|built|launched|live now|now available|released)\b/i,
        );
        expect(card.href).toBeUndefined();
      }
    }
  });

  it('draws every card as its title and its one line', () => {
    const { container } = renderAbout();
    const cards = [...container.querySelectorAll('[data-roadmap-card]')];
    expect(cards).toHaveLength(13);
    const all = roadmapColumns().flatMap((col) => col.cards);
    cards.forEach((card, i) => {
      expect(norm(card.querySelector('[data-card-title]')!.textContent)).toBe(all[i]!.title);
      expect(norm(card.querySelector('[data-card-line]')!.textContent)).toBe(all[i]!.line);
    });
  });
});

describe('/about · in the nav', () => {
  it('is an item of its own', () => {
    const about = NAV_ITEMS.find((i) => i.href === '/about');
    expect(about).toMatchObject({
      label: 'About',
      short: 'About',
      matchPrefix: '/about',
      available: true,
    });
  });
});
