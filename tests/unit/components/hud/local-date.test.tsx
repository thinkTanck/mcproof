import { render, screen } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { LocalDate } from '@/components/hud/LocalDate';
import { localDate } from '@/lib/display/dates';

/**
 * A live run's date in the VIEWER'S time zone (owner ruling 2026-10-15).
 *
 * The run pages are drawn on the server, which cannot know the reader's zone,
 * so the server prints the UTC day and the browser draws the reader's day once
 * it has hydrated. The `<time>` element always carries the ISO value.
 */
const LATE_CHICAGO_EVENING = '2026-10-16T00:37:00Z';

describe('LocalDate', () => {
  it('sends the UTC day from the server, inside a <time> with the ISO value', () => {
    const html = renderToString(<LocalDate iso={LATE_CHICAGO_EVENING} />);
    expect(html).toContain(`dateTime="${LATE_CHICAGO_EVENING}"`);
    expect(html).toContain('Oct 16, 2026');
  });

  it('draws the browser’s own day once on the client', () => {
    render(<LocalDate iso={LATE_CHICAGO_EVENING} />);
    const time = document.querySelector('time')!;
    expect(time).toHaveAttribute('dateTime', LATE_CHICAGO_EVENING);
    // Whatever zone this test runs in, the text is that zone's day.
    expect(time).toHaveTextContent(localDate(LATE_CHICAGO_EVENING)!);
  });

  it('takes a prefix, so a row can read "run Oct 15, 2026"', () => {
    render(<LocalDate iso="2026-08-05T12:00:00Z" prefix="run " />);
    expect(screen.getByText(/^run Aug 5, 2026$/)).toBeInTheDocument();
  });

  it('draws nothing for a value that is not a date', () => {
    const { container } = render(<LocalDate iso="not a date" />);
    expect(container).toBeEmptyDOMElement();
  });
});
