import { render } from '@testing-library/react';
import { ModelId } from '@/components/hud/ModelId';
import { ProvenanceLine } from '@/components/hud/ProvenanceLine';
import {
  classificationDisplayProvenance,
  compromiseDisplayProvenance,
} from '@/lib/display/measured';

/**
 * PROVENANCE WRAP (owner ruling 2026-10-21). A measured provenance line wraps
 * only between its " · " segments, never inside one; on the metric cards the
 * detector segment starts a line of its own. A model id never breaks, and it
 * is wrapped in a no-wrap span, never spelled with non-breaking hyphens, so a
 * copy and paste gives the id exactly. Line positions are measured in
 * tests/e2e/model-id-wrap.spec.ts.
 */
describe('ProvenanceLine', () => {
  for (const line of [compromiseDisplayProvenance(), classificationDisplayProvenance()]) {
    it(`keeps each segment of "${line.slice(0, 30)}..." a whole unit, and the text as it was`, () => {
      const { container } = render(<ProvenanceLine text={line} />);
      const segments = [...container.querySelectorAll<HTMLElement>('[data-provenance-segment]')];
      expect(segments.map((s) => s.textContent)).toEqual(line.split(' · '));
      // A whole unit on a line, breaking inside only when wider than the line
      // (PROVENANCE WRAP 2, 2026-10-22).
      for (const s of segments) {
        expect(s.className.split(/\s+/)).toEqual(
          expect.arrayContaining(['inline-block', 'max-w-full']),
        );
      }
      expect(container.textContent).toBe(line);
    });
  }

  it('puts the detector segment on a line of its own when asked, and keeps the text', () => {
    const line = compromiseDisplayProvenance();
    const { container } = render(<ProvenanceLine text={line} detectorOnOwnLine />);
    const detector = container.querySelector<HTMLElement>('[data-provenance-segment="detector"]')!;
    expect(detector.textContent).toBe('detector claude-haiku-4-5');
    expect(detector.className.split(/\s+/)).toContain('block');
    expect(container.textContent).toBe(line);
  });

  it('wraps the detector model in a model id span', () => {
    const { container } = render(<ProvenanceLine text={compromiseDisplayProvenance()} />);
    expect(container.querySelector('[data-model-id]')?.textContent).toBe('claude-haiku-4-5');
  });
});

describe('ModelId', () => {
  it('is a no-wrap span with the id exactly, and no non-breaking hyphen', () => {
    const { container } = render(<ModelId id="claude-haiku-4-5" />);
    const el = container.querySelector<HTMLElement>('[data-model-id]')!;
    expect(el.tagName).toBe('SPAN');
    expect(el.className.split(/\s+/)).toContain('whitespace-nowrap');
    expect(el.textContent).toBe('claude-haiku-4-5');
    expect(el.textContent).not.toMatch(/‑/);
  });
});
