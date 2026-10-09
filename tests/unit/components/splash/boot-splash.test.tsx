import { act, render, screen, within } from '@testing-library/react';
import { BootSplash } from '@/components/splash/BootSplash';

/**
 * Boot splash — radar target-lock. In jsdom there is no matchMedia desktop match,
 * so the sequence runs on fake timers. These assertions pin the load-bearing
 * contract: it is absent until the idle kick fires (so Home paints first), it
 * acquires the Core-7 signatures and resolves to SYSTEM ONLINE, and it never shows
 * on a repeat visit.
 */
beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  // Force the setTimeout fallback so fake timers drive the sequence deterministically.
  // @ts-expect-error — narrowing the capability off for the test env
  delete window.requestIdleCallback;
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('BootSplash', () => {
  it('is absent on first render (Home paints under), then acquires the Core-7 and reaches SYSTEM ONLINE', () => {
    render(<BootSplash />);
    // Absent until the idle kick — Home is never blocked.
    expect(screen.queryByRole('status', { name: /booting/i })).toBeNull();

    act(() => {
      vi.advanceTimersByTime(320);
    });

    const status = screen.getByRole('status', { name: /mcproof booting/i });
    // The radar names the Core-7 as the acquisition targets.
    expect(within(status).getByText(/signatures acquired/i)).toBeInTheDocument();
    expect(within(status).getByText('ASI01')).toBeInTheDocument();
    expect(within(status).getByText('ASI06')).toBeInTheDocument();
    expect(within(status).getByText('ASI10')).toBeInTheDocument();
    // No stale Core-5 label.
    expect(screen.queryByText(/CORE-5/i)).toBeNull();

    // Drive the sweep through all seven locks to the resolved state.
    act(() => {
      vi.advanceTimersByTime(3200);
    });
    expect(within(status).getByText(/system online/i)).toBeInTheDocument();
  });

  it('never shows on a repeat visit in the same session (session flag)', () => {
    sessionStorage.setItem('mcproof.boot.v1.seen', '1');
    render(<BootSplash />);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.queryByRole('status', { name: /booting/i })).toBeNull();
  });
});
