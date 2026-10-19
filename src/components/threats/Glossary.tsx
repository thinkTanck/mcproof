import { SENTINEL_DEFINITION, SENTINEL_GLOSSARY_ID } from '@/lib/replay/roles';

/**
 * THE GLOSSARY (Batch G, 2026-10-13).
 *
 * One entry today: what "Sentinel" is. Every prompt in a replay that is drawn
 * inside the test environment ends in `@sentinel`, and nothing said what that
 * names. The first "@sentinel" on a replay links here, and so does the
 * definition any sentinel handle opens.
 *
 * It lives on the coverage page, at an anchor, and is not a route of its own:
 * the app had no glossary, one sentence does not make a page, and this is the
 * page that already explains what a run is tested against.
 *
 * The sentence is the owner's, held word for word in the roles lookup and by
 * test. It is prose, so it wears the READING role and the reading measure.
 */
export function Glossary() {
  return (
    <section aria-labelledby="glossary-title" className="mt-10 border-t border-line pt-6">
      <h2 id="glossary-title" className="reading-h3">
        Glossary
      </h2>
      <dl className="mt-3">
        {/* `scroll-mt`, so the entry is not left under the header when a link
            lands on it. */}
        <div id={SENTINEL_GLOSSARY_ID} className="scroll-mt-24">
          <dt className="reading font-semibold text-ink-hi">Sentinel</dt>
          <dd className="reading measure">{SENTINEL_DEFINITION}</dd>
        </div>
      </dl>
    </section>
  );
}
