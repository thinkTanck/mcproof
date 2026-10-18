import type { ReactElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

/**
 * A replay shows no verdict until it is revealed (owner ruling 2026-10-17): at
 * the last step, or on "Show verdict now". A test that is about the verdict,
 * its rail, its badge or its export prompt reveals it first, the way a reader
 * would, so it says plainly that it is looking at the revealed state.
 */
export function revealVerdict(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Show verdict now' }));
}

/** Render a replay (or a page that holds one) and reveal its verdict. */
export function renderRevealed(ui: ReactElement): ReturnType<typeof render> {
  const result = render(ui);
  revealVerdict();
  return result;
}
