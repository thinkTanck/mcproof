import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToString } from 'react-dom/server';
import { render, screen } from '@testing-library/react';
import { Replay } from '@/components/replay/Replay';
import { PHONE_LAYOUT_QUERY } from '@/components/replay/phone-layout';
import { sampleRun } from '@/data/source';

/**
 * THE PHONE REPLAY, IN THE DOCUMENT (Part D).
 *
 * Below 768px, and on a phone held sideways, the replay reads terminal, then
 * the playback controls, then the verdict, and that order is the DOCUMENT order,
 * so Tab and a screen reader meet the controls where they are seen. From 768px
 * up the replay is main's own: terminal, verdict, then controls.
 *
 * The server cannot know the width, so it sends both placements of the
 * transport and CSS shows the one that fits: no reflow when the page hydrates,
 * which is what keeps the replay's layout shift at zero on a phone. Once the
 * browser has answered the media query, only the placement in use is kept.
 *
 * The layout geometry (the cap, the inside scroll, the empty room) is measured
 * in a real browser in tests/e2e/phone-replay-layout.spec.ts; this file holds
 * the parts jsdom can see.
 */
const RUN = sampleRun('ASI02');

function stubWidth(phone: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === PHONE_LAYOUT_QUERY ? phone : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const follows = (a: Node, b: Node) =>
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

const parts = () => ({
  terminal: screen.getByRole('list', { name: 'Attack replay step timeline' }),
  play: screen.getByRole('button', { name: 'Play' }),
  verdict: screen.getByRole('complementary', { name: 'Detector verdict' }),
});

describe('the phone layout query', () => {
  it('is the same query the `phone:` CSS variant is built on', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
    const variant = /@custom-variant phone \{\s*@media ([^{]+?)\s*\{/.exec(css);
    expect(variant?.[1]).toBe(PHONE_LAYOUT_QUERY);
  });

  it('covers narrower than 768px, and a phone on its side, and nothing from 768px up otherwise', () => {
    expect(PHONE_LAYOUT_QUERY).toContain('(max-width: 767.98px)');
    expect(PHONE_LAYOUT_QUERY).toContain('(max-height: 499.98px)');
  });
});

describe('Replay on a phone', () => {
  beforeEach(() => stubWidth(true));

  it('puts the controls after the terminal and before the verdict, in the document', () => {
    render(<Replay run={RUN} routeId="sample" />);
    const { terminal, play, verdict } = parts();
    expect(follows(terminal, play)).toBe(true);
    expect(follows(play, verdict)).toBe(true);
  });

  it('keeps one transport, not two', () => {
    render(<Replay run={RUN} routeId="sample" />);
    expect(screen.getAllByRole('button', { name: 'Restart' })).toHaveLength(1);
  });

  it('reserves the whole transcript height with one hidden line per step, invisible to assistive technology', () => {
    const { container } = render(<Replay run={RUN} routeId="sample" />);
    const reserve = container.querySelector('[data-terminal-reserve]');
    expect(reserve).not.toBeNull();
    expect(reserve).toHaveAttribute('aria-hidden', 'true');
    expect(reserve!.querySelectorAll('[data-reserve-line]')).toHaveLength(RUN.trace.steps.length);
    // Its text is drawn by CSS from an attribute, so no test or reader finds it twice.
    expect(reserve!.textContent).toBe('');
  });

  it('never calls scrollIntoView, which would scroll the page as well as the terminal', () => {
    const original = Element.prototype.scrollIntoView;
    const intoView = vi.fn();
    Element.prototype.scrollIntoView = intoView;
    try {
      render(<Replay run={RUN} routeId="sample" />);
      expect(intoView).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});

describe('Replay from 768px up', () => {
  beforeEach(() => stubWidth(false));

  it("keeps main's order: terminal, verdict, then the controls", () => {
    render(<Replay run={RUN} routeId="sample" />);
    const { terminal, play, verdict } = parts();
    expect(follows(terminal, verdict)).toBe(true);
    expect(follows(verdict, play)).toBe(true);
    expect(screen.getAllByRole('button', { name: 'Restart' })).toHaveLength(1);
  });

  it('draws no reserve copy of the transcript', () => {
    const { container } = render(<Replay run={RUN} routeId="sample" />);
    expect(container.querySelector('[data-terminal-reserve]')).toBeNull();
  });
});

describe('Replay as the server sends it', () => {
  it('carries both placements of the transport, each shown only by its own CSS', () => {
    const html = renderToString(<Replay run={RUN} routeId="sample" />);
    expect(html.match(/aria-label="Restart"/g)).toHaveLength(2);
    expect(html).toContain('data-transport-placement="phone"');
    expect(html).toContain('data-transport-placement="wide"');
  });
});
