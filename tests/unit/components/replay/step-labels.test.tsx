import { render, screen } from '@testing-library/react';
import { SampleTrailer } from '@/components/home/SampleTrailer';
import { StepDetail } from '@/components/replay/StepDetail';

/** A step a person counts reads "#N" (owner ruling, 2026-10-14). */
describe('step labels read "#N"', () => {
  it('the step detail names its step "#N"', () => {
    render(
      <StepDetail
        step={{ id: 's2', type: 'tool_call', tool: 'read_file', args: { path: 'a' } }}
        index={1}
        compromised
      />,
    );
    const detail = screen.getByRole('region', { name: 'Step detail' });
    expect(detail.querySelector('header')?.textContent).toMatch(/^#2/);
    expect(detail.querySelector('header')?.textContent).not.toMatch(/^02/);
  });

  it('the Home trailer labels its first, breach and last steps "#N"', () => {
    render(
      <SampleTrailer
        runId="r"
        category="ASI02"
        descriptor="d"
        total={11}
        compromiseIndex={6}
        offendingTool="read_file"
        firstLabel="task"
        lastLabel="done"
        watchHref="/runs/sample"
      />,
    );
    expect(screen.getByText('#1 · task')).toBeInTheDocument();
    expect(screen.getByText('#6 · read_file, compromised here')).toBeInTheDocument();
    expect(screen.getByText('#11 · done')).toBeInTheDocument();
  });
});
