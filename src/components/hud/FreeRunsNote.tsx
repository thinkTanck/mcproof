import { cn } from '@/lib/utils';

/**
 * THE FREE-RUNS NOTE (UI audit 2026-10-12, batch D): one sentence beside a
 * Connect call to action, saying how many free live runs an account gets.
 *
 * It draws the sentence it is handed and decides nothing. The sentence is
 * built on the server by `describeLiveRunAllowanceNote()` (src/runs/allowance.ts),
 * which returns nothing when no count has been configured, and then this draws
 * nothing: no empty paragraph, no gap. The count itself never reaches the
 * browser as a setting, only as words already written.
 *
 * READING prose in the muted tone: it is a note, not a status. Never a live
 * region, since it does not change while the page is open.
 */
export function FreeRunsNote({
  text,
  className,
}: {
  /** The sentence, or nothing when no count is configured. */
  text: string | null | undefined;
  className?: string;
}) {
  if (!text) return null;
  return (
    <p data-free-runs-note="" className={cn('reading measure text-ink-muted', className)}>
      {text}
    </p>
  );
}
