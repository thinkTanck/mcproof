import { act, render, screen } from '@testing-library/react';
import { SwipeCue } from '@/components/leaderboard/SwipeCue';

/**
 * THE SWIPE CUE TELLS THE TRUTH (owner ruling 2026-10-18). "Swipe the table
 * left to see all 7 attack types." is shown only when the table really
 * overflows its scroll region (scrollWidth > clientWidth), and the answer is
 * measured again when the region or the window changes size.
 */
function region(scrollWidth: number, clientWidth: number) {
  const el = document.createElement('div');
  el.id = 'board-scroll';
  Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => scrollWidth });
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => clientWidth });
  document.body.append(el);
  return {
    el,
    resize(nextScroll: number, nextClient: number) {
      Object.defineProperty(el, 'scrollWidth', { configurable: true, get: () => nextScroll });
      Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => nextClient });
      act(() => {
        window.dispatchEvent(new Event('resize'));
      });
    },
  };
}

afterEach(() => {
  document.getElementById('board-scroll')?.remove();
});

const cue = () => screen.getByText('Swipe the table left to see all 7 attack types.');

it('is shown when the table overflows its region', () => {
  region(1100, 390);
  render(<SwipeCue regionId="board-scroll" count={7} />);
  expect(cue().closest('[data-swipe-cue]')).toHaveAttribute('data-overflow', 'true');
  expect(cue().closest('[data-swipe-cue]')).not.toHaveAttribute('hidden');
});

it('is hidden when every column fits', () => {
  region(1100, 1100);
  render(<SwipeCue regionId="board-scroll" count={7} />);
  const box = cue().closest('[data-swipe-cue]')!;
  expect(box).toHaveAttribute('data-overflow', 'false');
  expect(box).toHaveAttribute('hidden');
});

it('measures again when the window is resized', () => {
  const r = region(1100, 1200);
  render(<SwipeCue regionId="board-scroll" count={7} />);
  const box = () => cue().closest('[data-swipe-cue]')!;
  expect(box()).toHaveAttribute('data-overflow', 'false');
  r.resize(1100, 390);
  expect(box()).toHaveAttribute('data-overflow', 'true');
  r.resize(1100, 1300);
  expect(box()).toHaveAttribute('data-overflow', 'false');
});

it('names the count it is given, in one sentence with no em dash', () => {
  region(900, 300);
  render(<SwipeCue regionId="board-scroll" count={3} />);
  expect(screen.getByText('Swipe the table left to see all 3 attack types.')).toBeInTheDocument();
});
