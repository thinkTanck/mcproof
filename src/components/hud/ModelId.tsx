import { cn } from '@/lib/utils';

/**
 * A MODEL ID THAT NEVER BREAKS (owner ruling PROVENANCE WRAP, 2026-10-21).
 * "claude-haiku-4-5" split at a hyphen reads as two things, so every model id
 * on screen sits in one no-wrap span. A span and not non-breaking hyphens, so a
 * copy and paste gives the id exactly as it is.
 */
export function ModelId({ id, className }: { id: string; className?: string }) {
  return (
    <span data-model-id="" className={cn('whitespace-nowrap', className)}>
      {id}
    </span>
  );
}
