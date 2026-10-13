import { fireEvent, render, screen } from '@testing-library/react';
import { SkipLinks } from '@/components/shell/SkipLinks';
import { RUN_CONTROLS_ID } from '@/components/connect/run-controls';

/**
 * THE SKIP LINKS (UI audit 2026-10-12, batch B; WCAG 2.4.1).
 *
 * "Skip to content" on every screen; "Skip to run controls" second, on Connect
 * only, styled exactly as the first. Activating it moves the keyboard to the
 * element that carries `RUN_CONTROLS_ID`.
 *
 * That it is the second tab stop, cannot be seen until focused and lands
 * clear of the header and the bar is measured in a browser
 * (tests/e2e/buttons-targets-nav-skip.spec.ts).
 */

const names = () => screen.getAllByRole('link').map((link) => link.textContent);

describe('SkipLinks', () => {
  it.each(['/', '/runs/sample', '/findings/sample', '/leaderboard', '/threats', '/account'])(
    '%s has the one link, to the content',
    (pathname) => {
      render(<SkipLinks pathname={pathname} />);
      expect(names()).toEqual(['Skip to content']);
      expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
        'href',
        '#main',
      );
    },
  );

  it('Connect has a second, to the run controls, after the first and styled the same', () => {
    render(<SkipLinks pathname="/connect" />);
    expect(names()).toEqual(['Skip to content', 'Skip to run controls']);
    const [first, second] = screen.getAllByRole('link');
    expect(second).toHaveAttribute('href', `#${RUN_CONTROLS_ID}`);
    expect(second!.className).toBe(first!.className);
  });

  it('both are hidden until focused, and a full target when they are', () => {
    render(<SkipLinks pathname="/connect" />);
    for (const link of screen.getAllByRole('link')) {
      const classes = link.className.split(/\s+/);
      expect(classes).toContain('sr-only');
      expect(classes).toContain('focus:not-sr-only');
      expect(classes).toContain('focus:target-min');
    }
  });

  it('activating it puts the keyboard on the region, without a fragment jump', () => {
    render(
      <>
        <SkipLinks pathname="/connect" />
        <div id={RUN_CONTROLS_ID} tabIndex={-1} />
      </>,
    );
    const link = screen.getByRole('link', { name: 'Skip to run controls' });
    // `fireEvent` returns false when the handler prevented the default action.
    const followed = fireEvent.click(link);
    expect(followed).toBe(false);
    expect(document.activeElement).toBe(document.getElementById(RUN_CONTROLS_ID));
  });

  it('with no region on the page it stays an ordinary link', () => {
    render(<SkipLinks pathname="/connect" />);
    const followed = fireEvent.click(screen.getByRole('link', { name: 'Skip to run controls' }));
    expect(followed).toBe(true);
  });
});
