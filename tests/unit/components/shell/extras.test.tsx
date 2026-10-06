import { render, screen } from '@testing-library/react';
import { ModeBadge } from '@/components/shell/ModeBadge';
import { StatusBar } from '@/components/shell/StatusBar';
import { stepColorToken } from '@/lib/hud/trace-view';
import RunReplay from '@/app/(hud)/runs/[id]/page';

describe('ModeBadge', () => {
  it('names the mode it is given: SAMPLE or LIVE', () => {
    const { rerender } = render(<ModeBadge mode="sample" />);
    expect(screen.getByText('SAMPLE')).toBeInTheDocument();
    rerender(<ModeBadge mode="live" />);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
  });
});

describe('StatusBar mode chip', () => {
  // No default: a bar that is told nothing about a run says nothing about one.
  it('renders no chip when it is given no mode', () => {
    render(<StatusBar pathname="/" />);

    expect(screen.queryByText(/^(SAMPLE|LIVE)$/)).not.toBeInTheDocument();
  });

  it.each([
    ['sample', 'SAMPLE'],
    ['live', 'LIVE'],
  ] as const)('renders the %s chip when it is given that mode', (mode, label) => {
    render(<StatusBar pathname="/runs/x" mode={mode} />);

    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe('trace-view step colours', () => {
  it('maps the reasoning tiers', () => {
    expect(stepColorToken('agent_reasoning')).toContain('--text-muted');
    expect(stepColorToken('tool_result')).toContain('--status-nominal');
    expect(stepColorToken('memory_read')).toContain('--line-emphasis');
  });
});

describe('runs/[id] replay', () => {
  it('resolves the run and renders the operable replay bound to the run id', async () => {
    const ui = await RunReplay({ params: Promise.resolve({ id: 'asi06-run' }) });
    render(ui);
    // Run id is surfaced (bound to the record, not a literal) via the export off-ramp.
    expect(screen.getByRole('link', { name: /export fix report/i })).toHaveAttribute(
      'href',
      '/findings/asi06-run',
    );
    // The reliable base — the operable step timeline — is present.
    expect(screen.getByRole('list', { name: /step timeline/i })).toBeInTheDocument();
  });
});
