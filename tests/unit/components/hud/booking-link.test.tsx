import { render, screen } from '@testing-library/react';
import { BookingLink } from '@/components/hud';

/**
 * BOOKING LINK: DRAWN ONLY WHEN THERE IS A REAL LINK (P0).
 *
 * While the booking URL is the placeholder the component draws nothing at all:
 * no anchor, no wrapper, nothing in the tab order. With a real link it draws
 * one anchor that opens in a new tab and says so to a screen reader.
 */

const REAL = 'https://calendly.com/agentrifi/assessment-scoping-call';

describe('BookingLink', () => {
  it('renders nothing while the link is the placeholder', () => {
    const { container } = render(<BookingLink>Book a scoping call</BookingLink>);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders one link with a real URL, opening in a new tab', () => {
    render(<BookingLink url={REAL}>Book a scoping call</BookingLink>);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    const link = links[0]!;
    expect(link).toHaveAttribute('href', REAL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('data-cta', 'book-assessment');
    expect(link).toHaveAccessibleName('Book a scoping call (opens in a new tab)');
    expect(link).not.toHaveAttribute('title');
  });

  it('is a full-size target in the main text colour', () => {
    render(<BookingLink url={REAL}>Book a scoping call</BookingLink>);
    const classes = screen.getByRole('link').className.split(/\s+/);
    expect(classes).toContain('target-min');
    expect(classes).toContain('text-ink');
    expect(classes).toContain('glow-accent');
    expect(classes.filter((c) => /shadow/.test(c))).toEqual([]);
  });

  it('refuses a look-alike host even when one is passed in', () => {
    const { container } = render(
      <BookingLink url="https://calendly.com.evil.example/x">Book</BookingLink>,
    );
    expect(container.firstChild).toBeNull();
  });
});
