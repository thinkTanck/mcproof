import { reportTitle } from '@/components/findings';

describe('reportTitle: a resolved report names itself in the tab', () => {
  it('calls a compromised run a fix report', () => {
    expect(reportTitle({ compromised: true })).toBe('Fix report · MCProof');
  });

  it('calls a clean run a run result, since there is nothing to fix', () => {
    expect(reportTitle({ compromised: false })).toBe('Run result · MCProof');
  });
});
