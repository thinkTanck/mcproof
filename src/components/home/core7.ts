import { CategorySchema, type Category } from '@/contract';
import { ASI_NAMES } from '@/lib/owasp/asi';

/**
 * The Core-7 as the Home front door lists them: the contract's categories, in
 * the contract's order, each with its title from the one code-to-name lookup
 * (`@/lib/owasp/asi`). `num` mirrors the ASI code numeral.
 */
export type Core7Entry = { num: string; id: Category; title: string };

export const CORE7: Core7Entry[] = CategorySchema.options.map((id) => ({
  num: id.slice(3),
  id,
  title: ASI_NAMES[id],
}));

/** The id of a category's row in the Home launcher, where its name is drawn. */
export const core7RowId = (id: string) => `core7-${id}`;
