import { render, screen, within } from '@testing-library/react';
import { AsiLabel } from '@/components/hud';
import { OwaspBadge, OwaspExplainer, OWASP_BADGE_LABEL } from '@/components/hud/OwaspTopTen';
import { THREATS } from '@/components/threats/threat-data';

/**
 * The words that say what the product maps to (UI audit 2026-10-12, batch C):
 * a code with its name, the badge, and the explanation of "OWASP Agentic Top 10".
 */

describe('AsiLabel', () => {
  it('draws the code and its name as one marked pair', () => {
    render(<AsiLabel code="ASI02" />);
    const pair = screen.getByText('ASI02').closest('[data-asi]');
    expect(pair).not.toBeNull();
    expect(pair).toHaveAttribute('data-asi', 'ASI02');
    expect(pair).toHaveTextContent('ASI02 Tool Misuse and Exploitation');
    // Visible text, not a hover tooltip.
    expect(pair).not.toHaveAttribute('title');
    expect(pair!.querySelector('[title]')).toBeNull();
    expect(pair!.querySelector('abbr')).toBeNull();
  });

  it('can put a separator between the two without losing either', () => {
    render(<AsiLabel code="ASI10" separator=" · " />);
    expect(screen.getByText('ASI10').closest('[data-asi]')).toHaveTextContent(
      'ASI10 · Rogue Agents',
    );
  });

  it('prints an unknown code bare instead of inventing a name', () => {
    render(<AsiLabel code="ASI42" />);
    expect(screen.getByText('ASI42').closest('[data-asi]')).toHaveTextContent(/^ASI42$/);
  });

  it('takes an id, so a tight spot elsewhere on the page can point at it', () => {
    render(<AsiLabel code="ASI01" id="named-here" />);
    expect(document.getElementById('named-here')).toHaveTextContent('ASI01 Agent Goal Hijack');
  });
});

describe('OwaspBadge', () => {
  it('is a text link to the coverage board, with the exact words and no picture', () => {
    render(<OwaspBadge />);
    const badge = screen.getByRole('link', { name: 'Maps to OWASP Agentic Top 10' });
    expect(OWASP_BADGE_LABEL).toBe('Maps to OWASP Agentic Top 10');
    expect(badge).toHaveAttribute('href', '/threats');
    expect(badge).toHaveAttribute('data-testid', 'owasp-badge');
    expect(badge.querySelector('svg, img, picture, canvas')).toBeNull();
    expect(badge).not.toHaveAttribute('title');
    // INSTRUMENT role, and never a status colour.
    expect(badge.className).toMatch(/\bmicro-label\b/);
    expect(badge.className).not.toMatch(/breach|caution|danger/);
  });
});

describe('OwaspExplainer', () => {
  it('is a native disclosure, closed, with a summary that names the phrase', () => {
    render(<OwaspExplainer />);
    const details = screen.getByTestId('owasp-explainer');
    expect(details.tagName).toBe('DETAILS');
    expect(details).not.toHaveAttribute('open');
    const summary = details.querySelector('summary');
    expect(summary).not.toBeNull();
    expect(summary).toHaveTextContent('What is the OWASP Agentic Top 10?');
    // No hover-only help, no live region.
    expect(details.querySelector('[title]')).toBeNull();
    expect(details.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
    // The summary is a full-size target and keeps the shared focus ring.
    expect(summary!.className).toMatch(/\btarget-min\b/);
    expect(summary!.className).not.toMatch(/outline-none|focus:outline/);
  });

  it('says what OWASP is, what the list is, and how much of it is tested, from the board', () => {
    render(<OwaspExplainer />);
    const body = screen.getByTestId('owasp-explainer-body');
    const covered = THREATS.filter((threat) => threat.state === 'covered').length;
    const inert = THREATS.filter((threat) => threat.state === 'inert').length;
    expect(covered + inert).toBe(THREATS.length);
    expect(body).toHaveTextContent(/OWASP is /);
    expect(body).toHaveTextContent(/Top 10 for Agentic Applications/);
    expect(body).toHaveTextContent(`tests ${covered} of the ${THREATS.length}`);
    expect(body).toHaveTextContent(new RegExp(`other ${inert} `));
    expect(body.textContent ?? '').not.toMatch(/—/);
    expect(body.textContent ?? '').not.toMatch(/all ten|every one|full coverage/i);
    const link = within(body).getByRole('link');
    expect(link).toHaveAttribute('href', '/threats');
    // Prose, so the READING role.
    expect(body.querySelector('p')!.className).toMatch(/\breading\b/);
  });
});
