'use client';

import { useCallback, useState } from 'react';
import { Button } from '@/components/hud';
import { toMarkdown, type FixReport, type TicketIds } from '@/fix-report';

/**
 * Serialise a fix report for a ticket. This is module 6's own `toMarkdown`, so
 * what an engineer pastes is the report the product generates, not a second
 * rendering of it maintained beside the first. `ids` names the run by the id in
 * the page's URL, and a live run's hosted run id under its own label.
 */
export function formatReport(report: FixReport, ids: TicketIds = {}): string {
  return toMarkdown(report, ids);
}

/**
 * Client copy control: writes the report to the clipboard and swaps its label to
 * a confirmation so the copy is visible in the system status (Nielsen H1). The
 * accessible name stays stable while the visible label toggles.
 */
type CopyStatus = 'idle' | 'copied' | 'failed';

export function CopyReportButton({
  report,
  runId,
  hostedRunId,
}: {
  report: FixReport;
  /** The id the report is opened under (its URL). */
  runId?: string;
  /** A live run's hosted MCP run id, labelled as such in the ticket. */
  hostedRunId?: string;
}) {
  const [status, setStatus] = useState<CopyStatus>('idle');

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(
        formatReport(report, {
          ...(runId === undefined ? {} : { runId }),
          ...(hostedRunId === undefined ? {} : { hostedRunId }),
        }),
      );
      setStatus('copied');
      window.setTimeout(() => setStatus('idle'), 2000);
    } catch {
      // Clipboard unavailable (no permission / insecure context): announce the
      // FAILURE rather than assert a copy that did not happen (or fail silently).
      setStatus('failed');
      window.setTimeout(() => setStatus('idle'), 3000);
    }
  }, [report, runId, hostedRunId]);

  const label =
    status === 'copied' ? 'COPIED ✓' : status === 'failed' ? 'COPY FAILED' : 'COPY REPORT';

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onCopy}
      aria-label="Copy report"
      className={`min-h-11 shrink-0 uppercase tracking-[0.08em] ${status === 'failed' ? 'text-breach-text' : ''}`}
    >
      <span aria-live="polite">{label}</span>
    </Button>
  );
}
