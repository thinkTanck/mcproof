import { CategorySchema, type Category } from '@/contract';
import { ASI_NAMES } from '@/lib/owasp/asi';
import type { CategoryTitles } from './view';

/**
 * THE BOARD'S CATEGORY AXIS — the Core-7, in the contract's own order.
 *
 * Taken from `CategorySchema.options` rather than re-typed, so a category can
 * never appear on the leaderboard that the rest of the product does not know
 * about, and none can quietly go missing from it either.
 *
 * The axis is stated by the CALLER and does not come out of the data. That is
 * deliberate: a board whose columns are whatever happened to be run cannot show
 * what has NOT been run, and "which of the Core-7 has this model never faced"
 * is the more useful half of an early leaderboard.
 */
export const CORE7_AXIS: readonly Category[] = CategorySchema.options;

/**
 * Column titles, read from the one code-to-name lookup (`@/lib/owasp/asi`),
 * which holds them verbatim from the official OWASP Top 10 for Agentic
 * Applications (2026). A code with no title here renders as the bare code
 * rather than as an invented name.
 */
export const CORE7_TITLES: CategoryTitles = Object.fromEntries(
  CORE7_AXIS.map((id) => [id, ASI_NAMES[id]]),
);
