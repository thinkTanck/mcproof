import { render, screen } from '@testing-library/react';
import { StatusBar } from '@/components/shell/StatusBar';

/**
 * THE LOGO RING. A thin ring with a short bright arc that turns. At 30px, with
 * a 1.4-unit arc six units long going round once every 22 seconds, it read as a
 * static circle: the motion was there and nobody could see it.
 *
 * It is 34px now where the header has room, the arc is two units thick and about
 * a quarter of the ring, and it goes round in 13 seconds. Still slow, still one
 * colour, still nothing that moves the header.
 */
describe('StatusBar logo ring', () => {
  const ring = () =>
    screen.getByRole('link', { name: 'MCProof home' }).querySelector('svg') as SVGSVGElement;

  it('is drawn at 34px, and keeps 30px below 360px where the header has none to spare', () => {
    render(<StatusBar pathname="/" />);

    expect(ring()).toHaveAttribute('width', '34');
    expect(ring()).toHaveAttribute('height', '34');
    // Below 360px a run screen's header has 5px of slack (#178): the ring does
    // not spend four of them.
    expect(ring()).toHaveClass('h-[30px]', 'w-[30px]');
    expect(ring()).toHaveClass('min-[360px]:h-[34px]', 'min-[360px]:w-[34px]');
  });

  it('turns once every 13 seconds, at a constant rate', () => {
    render(<StatusBar pathname="/" />);

    expect(ring()).toHaveClass('animate-[spin_13s_linear_infinite]');
    expect(ring().getAttribute('class')).not.toContain('22s');
  });

  it('carries one arc, thick and long enough to be seen turning', () => {
    render(<StatusBar pathname="/" />);
    const [track, arc] = [...ring().querySelectorAll('circle')];

    // The faint full ring it travels on is unchanged.
    expect(track).toHaveAttribute('stroke', 'var(--line-emphasis)');
    expect(arc).toHaveAttribute('stroke', 'var(--status-nominal)');
    expect(Number(arc!.getAttribute('stroke-width'))).toBeGreaterThanOrEqual(2);

    // One arc and one gap that together make exactly one lap of the ring, so
    // there is a single arc and not a second stub where the pattern repeats.
    const [dash, gap] = arc!.getAttribute('stroke-dasharray')!.split(/\s+/).map(Number);
    const lap = 2 * Math.PI * Number(arc!.getAttribute('r'));
    expect(dash).toBeGreaterThanOrEqual(12);
    expect(dash! + gap!).toBeCloseTo(lap, 1);
    // About a quarter of the ring: visible, and still plainly an arc.
    expect(dash! / lap).toBeGreaterThan(0.2);
    expect(dash! / lap).toBeLessThan(0.34);
  });

  it('stays decorative: hidden from assistive technology, the link keeps its name', () => {
    render(<StatusBar pathname="/" />);

    expect(ring()).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('link', { name: 'MCProof home' })).toHaveTextContent('MCProof');
  });
});

describe('the wordmark below 360px', () => {
  it('sets MCProof without letter-spacing below 360px, and at the design 0.09em from 360px up', () => {
    render(<StatusBar pathname="/" />);
    const word = screen.getByRole('link', { name: 'MCProof home' }).querySelector('span')!;

    // MCProof is two letters longer than the old name. At 320 a run screen's
    // header (ring, wordmark, chip, menu) has no room for 0.09em on seven letters.
    expect(word).toHaveClass('tracking-[0em]', 'min-[360px]:tracking-[0.09em]');
    expect(word).not.toHaveClass('tracking-[0.09em]');
    expect(word).toHaveClass('text-[21px]');
  });
});
