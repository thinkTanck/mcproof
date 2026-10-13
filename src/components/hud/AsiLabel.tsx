import { asiName } from '@/lib/owasp/asi';

/**
 * The id of the one place a replay spells out the category its verdict carries
 * (the verdict rail). The status bar's chip, which is drawn over a replay and
 * nowhere else, has no room for the name, so it points here with
 * `aria-describedby`.
 */
export const RUN_CATEGORY_NAME_ID = 'run-category-name';

/**
 * A CATEGORY CODE WITH ITS NAME, as visible text (UI audit 2026-10-12, batch C).
 *
 * `ASI02` alone tells a reader nothing unless they already know the list. This
 * draws the code and its official name side by side, as one marked pair, so
 * the name is on screen wherever the code is. It is plain text and never a
 * tooltip: a `title` cannot be reached by touch or by keyboard.
 *
 * It inherits its type from where it sits and adds none of its own, so it can
 * stand inside a heading, a chip row or a sentence. `id` lets a spot that is
 * too tight for the name point at this one with `aria-describedby`.
 *
 * A code the lookup does not hold is drawn bare. No name is ever invented.
 */
export function AsiLabel({
  code,
  separator = ' ',
  id,
  className,
}: {
  code: string;
  /** What goes between the code and the name. A space unless the row uses a dot. */
  separator?: string;
  id?: string;
  className?: string;
}) {
  const name = asiName(code);
  return (
    <span data-asi={code} id={id} className={className}>
      <span>{code}</span>
      {name === undefined ? null : (
        <>
          {separator}
          <span>{name}</span>
        </>
      )}
    </span>
  );
}
