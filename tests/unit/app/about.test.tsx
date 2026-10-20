import { render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import AboutPage, { metadata } from '@/app/(hud)/about/page';
import {
  ABOUT_BIO,
  ABOUT_LINKEDIN_HREF,
  ABOUT_PROMPT,
  ROADMAP_LATER,
  ROADMAP_NEXT,
} from '@/lib/about/copy';
import { SENTINEL_DEFINITION } from '@/lib/replay/roles';
import { NAV_ITEMS } from '@/components/shell/nav-items';
import {
  measuredCopy,
  compromiseDisplayProvenance,
  classificationDisplayProvenance,
} from '@/lib/display/measured';
import { THREATS } from '@/components/threats/threat-data';
import {
  CONNECT_CLIENT_TABS,
  CORE7_LIST_LABEL,
  METRIC_HEADING_CLASSIFICATION,
  METRIC_HEADING_COMPROMISE,
} from '@/lib/site-copy';
import { HOW_A_TEST_WORKS } from '@/components/home/HowATestWorks';
import { OWASP_BADGE_LABEL } from '@/components/hud/OwaspTopTen';

/**
 * /about (owner rulings 2026-10-18 and ABOUT REVISION, 2026-10-19). Every word
 * the page shows is real DOM text in the server render; the terminals and the
 * motion only decide how it is drawn.
 */

const BIO =
  "I've been writing code for most of my working life. After a B.S. in Mathematics with computer science coursework, I wrote AutoLISP and VBA tools that automated engineering work on commercial glass and glazing projects. Today I build AI systems, and I'm pursuing an M.S. in Artificial Intelligence at Johns Hopkins. I built MCProof because AI agents are vulnerable to tool misuse. Tool use is an attack vector in the agent harness, and it needs careful consideration.";

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function renderAbout() {
  return render(<AboutPage />);
}

describe('/about · the page', () => {
  it('has a title of its own and one level-1 heading, "About", hidden from view', () => {
    expect(metadata.title).toBe('About · MCProof');
    expect(String(metadata.description)).not.toMatch(/—/);
    renderAbout();
    const h1 = screen.getAllByRole('heading', { level: 1 });
    expect(h1).toHaveLength(1);
    expect(h1[0]).toHaveTextContent(/^About$/);
    expect(h1[0]!.className.split(/\s+/)).toContain('sr-only');
  });

  it('prints the bio word for word, under the visitor@mcproof prompt', () => {
    expect(ABOUT_BIO).toBe(BIO);
    expect(ABOUT_PROMPT).toBe('visitor@mcproof:~$');
    const { container } = renderAbout();
    const terminal = container.querySelector('[data-terminal="whoami"]')!;
    const final = terminal.querySelector('[data-terminal-final]')!;
    expect([...final.querySelectorAll('p')].map((el) => norm(el.textContent))).toEqual([
      'visitor@mcproof:~$ whoami',
      'dameion-ayers',
      BIO,
    ]);
    expect(terminal.querySelector('[data-terminal-typed]')).toHaveAttribute('aria-hidden', 'true');
  });

  it('wears the replay terminal look: its box, its background, its prompt and caret', () => {
    const { container } = renderAbout();
    for (const terminal of container.querySelectorAll<HTMLElement>('[data-terminal]')) {
      const classes = terminal.className.split(/\s+/);
      for (const c of ['rounded-lg', 'px-4', 'py-3', 'font-mono', 'text-[15px]', 'leading-[1.6]']) {
        expect(classes, c).toContain(c);
      }
      expect(terminal).toHaveAttribute('data-elev', '2');
      expect(terminal.style.background).toBe('var(--terminal-bg)');
      expect(terminal.querySelector('[data-terminal-prompt]')).toHaveStyle({
        color: 'var(--terminal-prompt)',
      });
    }
  });

  it('removes the name heading, the Agentrifi line, the career line and every outbound link', () => {
    const { container } = renderAbout();
    expect(screen.queryByText(/Built by Dameion Ayers/)).toBeNull();
    expect(screen.queryByText(/Agentrifi/)).toBeNull();
    expect(screen.queryByRole('link', { name: /LinkedIn/ })).toBeNull();
    expect(container.querySelector('[data-career-line], [data-reveal="career"]')).toBeNull();
    expect(container.querySelector('[data-career-continues]')).toBeNull();
    expect(container.querySelector('a[href^="http"], a[href^="mailto:"]')).toBeNull();
    // The LinkedIn URL is kept, unused, for later (owner, 19:12).
    expect(ABOUT_LINKEDIN_HREF).toBe('https://www.linkedin.com/in/dameion-a-662aa880/');
  });

  it('carries no GitHub link, no handle or alias, and no photo', () => {
    const { container } = renderAbout();
    expect(container.querySelector('a[href*="github.com"]')).toBeNull();
    const all = container.innerHTML;
    for (const alias of ['DameRA', 'DameionRA', 'thinkTanck', 'thinktanck']) {
      expect(all.toLowerCase()).not.toContain(alias.toLowerCase());
    }
    expect(container.querySelector('img, picture')).toBeNull();
  });

  it('says why "Sentinel", under its own prompt, in the constant the glossary renders', () => {
    const { container } = renderAbout();
    expect(screen.getByRole('heading', { level: 2, name: 'Why "Sentinel"' })).toBeInTheDocument();
    const terminal = container.querySelector('[data-terminal="sentinel"]')!;
    const final = terminal.querySelector('[data-terminal-final]')!;
    expect([...final.querySelectorAll('p')].map((el) => norm(el.textContent))).toEqual([
      'visitor@mcproof:~$ man sentinel',
      SENTINEL_DEFINITION,
    ]);
    const whoami = container.querySelector('[data-terminal="whoami"]')!;
    expect(
      whoami.compareDocumentPosition(terminal) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('lays out the roadmap: heading, note, three pills, every item in the owner’s words', () => {
    const { container } = renderAbout();
    expect(screen.getByRole('heading', { level: 2, name: "What's next" })).toBeInTheDocument();
    expect(screen.getByText('Planned, not promised. No dates.')).toBeInTheDocument();
    const columns = [...container.querySelectorAll('[data-roadmap-column]')];
    expect(columns.map((c) => c.getAttribute('data-roadmap-column'))).toEqual([
      'shipped',
      'next',
      'later',
    ]);
    expect(columns.map((c) => norm(c.querySelector('[data-pill]')!.textContent))).toEqual([
      'Shipped (v1)',
      'Next (v2)',
      'Later (v3)',
    ]);
    const items = (col: Element) =>
      [...col.querySelectorAll('[data-roadmap-card]')].map((c) => norm(c.textContent));
    expect(ROADMAP_NEXT).toEqual([
      'Test weaker and open-source agents with a pluggable runner, and measure GitHub Copilot, Cursor, Codex and Gemini CLI.',
      'Re-measure ASI02 on the fixed trap.',
      'A held-out test set kept outside the repo.',
      'A second detector model to cross-check verdicts.',
      'More than one test per session.',
      'Clearer results history.',
    ]);
    expect(items(columns[1]!)).toEqual(ROADMAP_NEXT);
    expect(ROADMAP_LATER).toEqual([
      'Test any agent from your own CI pipeline.',
      "The 3 OWASP risks a single run can't test, via multi-run and multi-agent scenarios.",
      'Agent-to-agent tests.',
      'Scheduled re-tests that flag when an update makes your agent easier to trick.',
      'Team accounts.',
      'New attack scenarios as real agent exploits are published.',
    ]);
    expect(items(columns[2]!)).toEqual(ROADMAP_LATER);
  });

  it('builds Shipped only from wording the site already shows, numbers included', () => {
    const { container } = renderAbout();
    const shipped = container.querySelector('[data-roadmap-column="shipped"]')!;
    const text = norm(shipped.textContent);
    const copy = measuredCopy();
    const covered = THREATS.filter((t) => t.state === 'covered').length;
    for (const expected of [
      OWASP_BADGE_LABEL,
      `MCProof tests ${covered} of the ${THREATS.length}.`,
      METRIC_HEADING_COMPROMISE,
      copy.precision,
      copy.recall,
      compromiseDisplayProvenance(),
      METRIC_HEADING_CLASSIFICATION,
      copy.classification,
      classificationDisplayProvenance(),
      ...CONNECT_CLIENT_TABS.map((t) => t.label),
      HOW_A_TEST_WORKS.find((s) => s.id === 'report')!.text,
      CORE7_LIST_LABEL,
    ]) {
      expect(text, expected).toContain(norm(expected));
    }
    expect(shipped.querySelectorAll('[data-roadmap-card]')).toHaveLength(6);
  });

  it('never words a planned item as if it shipped', () => {
    const { container } = renderAbout();
    for (const col of ['next', 'later']) {
      const text = norm(container.querySelector(`[data-roadmap-column="${col}"]`)!.textContent);
      expect(text).not.toMatch(/\b(shipped|built|launched|live now|now available|released)\b/i);
    }
  });

  it('uses no em dash anywhere', () => {
    const { container } = renderAbout();
    expect(container.textContent).not.toMatch(/—/);
  });

  it('sends every animated part pending from the server, every word already in it', () => {
    // The SERVER'S markup: every animated part waits in a pending state that
    // CSS resolves to the final picture under reduced motion or with no
    // script. (On the client whoami starts at once, by design.)
    const html = renderToString(<AboutPage />);
    const states = [...html.matchAll(/data-(?:terminal|reveal)="[^"]+"[^>]*?data-state="(\w+)"/g)];
    expect(states.map((m) => m[1])).toEqual(['pending', 'pending', 'pending']);
    expect(html).toContain('needs careful consideration.');
    expect(html).toContain('Sentinel is where we prove it.');
    const { container } = renderAbout();
    expect(within(container).getAllByText(/./).length).toBeGreaterThan(0);
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
