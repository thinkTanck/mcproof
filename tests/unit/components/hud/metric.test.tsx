import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { Metric } from '@/components/hud/Metric';

/**
 * ONE MEASURED FIGURE, DRAWN ONE WAY (UI audit 2026-10-12, batch D).
 *
 * Precision, recall and category classification accuracy were drawn at two
 * sizes with a one-word label each. One component draws all three now: the
 * label (INSTRUMENT), the value (DISPLAY) and a plain sentence saying what the
 * figure measures (READING), every one at the same size wherever it is used.
 *
 * It draws ONE figure and nothing about where the figure came from. The two
 * measurements keep their own groups and their own provenance lines in the
 * page that uses this; that separation is asserted in
 * tests/unit/app/home.test.tsx and measured in
 * tests/e2e/readability-hierarchy.spec.ts.
 */

function draw() {
  return render(
    <dl>
      <Metric
        id="precision"
        label="Precision"
        value="0.96"
        meaning="Of the runs it flagged, the share that were real compromises."
      />
    </dl>,
  );
}

describe('Metric', () => {
  it('draws a label, a value and what the value measures, as a term and its descriptions', () => {
    const { container } = draw();
    const metric = container.querySelector('[data-metric="precision"]')!;
    expect(metric).not.toBeNull();

    const label = metric.querySelector('[data-metric-label]')!;
    const value = metric.querySelector('[data-metric-value]')!;
    const meaning = metric.querySelector('[data-metric-meaning]')!;
    expect(label.tagName).toBe('DT');
    expect(value.tagName).toBe('DD');
    expect(meaning.tagName).toBe('DD');
    expect(label).toHaveTextContent('Precision');
    expect(value).toHaveTextContent('0.96');
    expect(meaning).toHaveTextContent(
      'Of the runs it flagged, the share that were real compromises.',
    );
    // A screen reader meets the name before the number it names.
    expect(screen.getByRole('term')).toHaveTextContent('Precision');
  });

  it('gives each part its own type role: INSTRUMENT label, DISPLAY value, READING sentence', () => {
    const { container } = draw();
    const classes = (selector: string) => container.querySelector(selector)!.className.split(/\s+/);
    expect(classes('[data-metric-label]')).toContain('micro-label');
    expect(classes('[data-metric-value]')).toContain('display-lg');
    expect(classes('[data-metric-meaning]')).toContain('reading');
    // A sentence never wears an INSTRUMENT role.
    expect(
      classes('[data-metric-meaning]').some((c) => /instrument|micro-label|readout/.test(c)),
    ).toBe(false);
  });

  it('draws every figure at the same size: the classes do not depend on what is passed', () => {
    const { container } = render(
      <dl>
        <Metric id="a" label="Precision" value="0.96" meaning="One." />
        <Metric id="b" label="Category classification accuracy" value="0.68" meaning="Two." />
      </dl>,
    );
    const parts = (id: string) =>
      ['[data-metric-label]', '[data-metric-value]', '[data-metric-meaning]'].map(
        (selector) => container.querySelector(`[data-metric="${id}"] ${selector}`)!.className,
      );
    expect(parts('a')).toEqual(parts('b'));
  });

  it('prints the value it is given at once: evidence is never counted up', () => {
    const { container } = draw();
    // The first paint is the final value, with nothing that animates it.
    expect(container.querySelector('[data-metric-value]')!.textContent).toBe('0.96');
    const source = readFileSync(join(process.cwd(), 'src/components/hud/Metric.tsx'), 'utf8');
    expect(source).not.toMatch(/use client|useEffect|useState|CountUp|requestAnimationFrame/);
  });

  it('is not a live region and takes no size or tone from its caller', () => {
    const { container } = draw();
    expect(
      container.querySelector('[aria-live], [role="status"], [role="alert"], output'),
    ).toBeNull();
    const source = readFileSync(join(process.cwd(), 'src/components/hud/Metric.tsx'), 'utf8');
    // No className or size prop: a page cannot make one figure larger than another.
    expect(source).not.toMatch(/className\??:\s*string|size\??:/);
  });
});
