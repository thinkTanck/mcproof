import { test, expect, type Page } from '@playwright/test';
import { suppressBootSplash } from '../e2e/support/screen';

/**
 * F-A DIAGNOSTIC (flake on `about.spec.ts` "plays to the exact final screen",
 * WebKit, 375x667). Not a gate: it runs only through
 * `playwright.diagnostics.config.ts`.
 *
 * It does exactly what the flaky test does up to the end of the terminal
 * (same viewport, same splash suppression, same 25 s wait for `done`), and
 * records, on the page's own clock, every thing that could stretch the
 * playback:
 *
 *  - when the page hydrated (`pending` to `typing`): the playback clock
 *    starts there, so time before it is outside the clock;
 *  - when the test began its 25 s wait, on the same clock;
 *  - the end timer (any timeout of a second or more): when it was set, when
 *    it was due, when it fired;
 *  - every waker the terminal uses (the 30 ms interval, animation frames) and
 *    React's scheduler (MessageChannel): how many fired, the longest gap, the
 *    last one;
 *  - how far the typed layer had got, each time it changed;
 *  - visibility, focus and page show or hide;
 *  - from the test side, a poll every 250 ms that reads the page's clock, so
 *    a page that answers the test while its own timers stall is visible.
 *
 * The record is attached to every run, passed or failed.
 */

const DONE_MS = 25_000;

type Gap = { count: number; last: number; maxGap: number; maxGapAt: number };

declare global {
  interface Window {
    __aboutClock?: {
      events: [string, number, ...unknown[]][];
      raf: Gap;
      interval: Gap;
      message: Gap;
      chars: [number, number][];
    };
  }
}

async function instrument(page: Page) {
  await page.addInitScript(() => {
    const gap = (): Gap => ({ count: 0, last: 0, maxGap: 0, maxGapAt: 0 });
    const rec = {
      events: [] as [string, number, ...unknown[]][],
      raf: gap(),
      interval: gap(),
      message: gap(),
      chars: [] as [number, number][],
    };
    window.__aboutClock = rec;
    const now = () => performance.now();
    const tick = (g: Gap) => {
      const n = now();
      if (g.last && n - g.last > g.maxGap) {
        g.maxGap = n - g.last;
        g.maxGapAt = n;
      }
      g.last = n;
      g.count += 1;
    };
    const event = (name: string, ...rest: unknown[]) => rec.events.push([name, now(), ...rest]);

    event('visibility', document.visibilityState);
    document.addEventListener('visibilitychange', () =>
      event('visibility', document.visibilityState),
    );
    window.addEventListener('pageshow', () => event('pageshow'));
    window.addEventListener('pagehide', () => event('pagehide'));
    window.addEventListener('focus', () => event('focus'));
    window.addEventListener('blur', () => event('blur'));

    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) =>
      raf((t) => {
        tick(rec.raf);
        cb(t);
      });

    const setI = window.setInterval.bind(window);
    window.setInterval = ((cb: () => void, ms?: number) =>
      setI(() => {
        tick(rec.interval);
        cb();
      }, ms)) as typeof window.setInterval;

    const setT = window.setTimeout.bind(window);
    window.setTimeout = ((cb: (...a: unknown[]) => void, ms = 0, ...args: unknown[]) => {
      const set = now();
      return setT(() => {
        if (ms >= 1000) event('long-timeout', { ms, set, due: set + ms, fired: now() });
        cb(...args);
      }, ms);
    }) as typeof window.setTimeout;

    // React's scheduler posts to a MessageChannel to run each render.
    const NativeChannel = window.MessageChannel;
    window.MessageChannel = class extends NativeChannel {
      constructor() {
        super();
        const port = this.port1;
        let handler: ((e: MessageEvent) => void) | null = null;
        Object.defineProperty(port, 'onmessage', {
          configurable: true,
          get: () => handler,
          set: (fn: ((e: MessageEvent) => void) | null) => {
            handler = fn;
            port.addEventListener('message', (e) => {
              tick(rec.message);
              handler?.(e);
            });
            port.start();
          },
        });
      }
    };

    let lastState = '';
    let lastChars = -1;
    new MutationObserver(() => {
      const terminal = document.querySelector('[data-terminal]');
      if (!terminal) return;
      const state = terminal.getAttribute('data-state') ?? '';
      if (state !== lastState) {
        lastState = state;
        event('state', state);
      }
      const chars = (terminal.querySelector('[data-terminal-typed]')?.textContent ?? '').length;
      if (chars !== lastChars) {
        lastChars = chars;
        rec.chars.push([now(), chars]);
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  });
}

test('/about at 375x667: where the time goes on the way to done', async ({ page }, testInfo) => {
  await instrument(page);
  await page.setViewportSize({ width: 375, height: 667 });
  await suppressBootSplash(page);
  await page.goto('/about');
  await expect(page.getByRole('heading', { level: 1, name: 'About' })).toBeAttached();

  const polls: { at: number; state: string | null }[] = [];
  const waitBegan = await page.evaluate(() => performance.now());
  let failure: unknown = null;
  try {
    await expect
      .poll(
        async () => {
          const sample = await page.evaluate(() => ({
            at: performance.now(),
            state: document.querySelector('[data-terminal]')?.getAttribute('data-state') ?? null,
          }));
          polls.push(sample);
          return sample.state;
        },
        { timeout: DONE_MS, intervals: [250] },
      )
      .toBe('done');
  } catch (error) {
    failure = error;
  }

  const record = await page.evaluate(() => window.__aboutClock);
  const states = (record?.events ?? []).filter((e) => e[0] === 'state');
  const at = (s: string) => states.find((e) => e[2] === s)?.[1] ?? null;
  const typingAt = at('typing');
  const doneAt = at('done');
  const summary = {
    passed: failure === null,
    waitBegan,
    hydratedAt: typingAt,
    hydratedBeforeWait: typingAt !== null && typingAt <= waitBegan,
    doneAt,
    playbackMs: typingAt !== null && doneAt !== null ? doneAt - typingAt : null,
    lastCharsChange: record?.chars.at(-1) ?? null,
    raf: record?.raf,
    interval: record?.interval,
    message: record?.message,
    longestTestPollGap: polls.reduce(
      (max, p, i) => (i === 0 ? 0 : Math.max(max, p.at - polls[i - 1]!.at)),
      0,
    ),
  };
  const body = JSON.stringify(
    { summary, events: record?.events, chars: record?.chars, polls },
    null,
    1,
  );
  await testInfo.attach('about-clock.json', { body, contentType: 'application/json' });
  console.log(`ABOUT-CLOCK ${JSON.stringify(summary)}`);
  if (failure) throw failure;
});
