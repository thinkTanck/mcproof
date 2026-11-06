import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { AssessmentCta, ASSESSMENT_CTA_HREF, ASSESSMENT_CTA_LABEL } from '@/components/hud';

/**
 * "GET AN EXPERT ASSESSMENT" IS ONE OUTLINED BUTTON (P0; plan H4 and Q8).
 *
 * It always goes to /assessments and never straight to the booking link, so
 * it is drawn the same whether or not booking is open. Same look as
 * ConnectCta: an outline, no fill, the label in the main text colour, a full
 * target, and the accent glow only under the pointer or the keyboard.
 */

function sourceFiles(dir: string): string[] {
  return readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(rel);
    return /\.tsx$/.test(entry.name) ? [rel] : [];
  });
}

describe('AssessmentCta', () => {
  it('is a link named by its words alone, to /assessments', () => {
    render(<AssessmentCta />);
    const link = screen.getByRole('link', { name: 'Get an expert assessment' });
    expect(link).toHaveAttribute('href', '/assessments');
    expect(ASSESSMENT_CTA_HREF).toBe('/assessments');
    expect(ASSESSMENT_CTA_LABEL).toBe('Get an expert assessment');
    expect(link).toHaveAttribute('data-cta', 'assessment');
    expect(link).not.toHaveAttribute('target');
    expect(link.querySelector('[aria-hidden="true"]')?.textContent).toBe('→');
  });

  it('is outlined: a border, no fill, no glow at rest, a full target', () => {
    render(<AssessmentCta />);
    const classes = screen.getByRole('link').className.split(/\s+/);
    expect(classes).toContain('border');
    expect(classes).toContain('border-nominal');
    expect(classes.filter((c) => /^bg-/.test(c))).toEqual(['bg-transparent']);
    expect(classes).toContain('text-ink');
    expect(classes).toContain('target-min');
    expect(classes).toContain('glow-accent');
    expect(classes.filter((c) => /shadow/.test(c))).toEqual([]);
  });

  it('takes no props, so no page can restyle it', () => {
    expect(AssessmentCta.length).toBe(0);
  });

  it('is the only place the words are drawn as a control', () => {
    const offenders = sourceFiles('src')
      .filter((file) => !file.endsWith('components/hud/AssessmentCta.tsx'))
      .filter((file) =>
        />\s*Get an expert assessment\b/.test(readFileSync(join(process.cwd(), file), 'utf8')),
      );
    expect(offenders).toEqual([]);
  });
});
