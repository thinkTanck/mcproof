import { CategorySchema, type Category } from '@/contract';
import { ASI_NAMES } from '@/lib/owasp/asi';

/**
 * The Core-7 attack categories offered on the Connect screen: the contract's
 * categories, in the contract's order, each with its title from the one
 * code-to-name lookup (`@/lib/owasp/asi`). A display table (id + human title)
 * so the checklist renders titles without threading the full attack modules into
 * a client component.
 */
export type Core7Category = { id: Category; title: string };

export const CORE7: readonly Core7Category[] = CategorySchema.options.map((id) => ({
  id,
  title: ASI_NAMES[id],
}));
