/**
 * THE WORDS OF /about (owner rulings 2026-10-18; plan in
 * claude/reports/about-plan.md). Each string is the owner's, held word for
 * word by `tests/unit/app/about.test.tsx`. The roadmap cards are in
 * `roadmap.ts` (ABOUT FINAL, 2026-10-20).
 *
 * NO HANDLE OR ALIAS, AND NO CONTACT ADDRESS. The page names its author and
 * nothing else; the security.txt address is never on it (owner ruling 1).
 */

/** The prompt the /about terminal types under (ABOUT REVISION, 2026-10-19). */
export const ABOUT_PROMPT = 'visitor@mcproof:~$';

/** What `whoami` prints first (ABOUT FINAL, 2026-10-20). */
export const ABOUT_NAME = 'Dameion Ayers';

export const ABOUT_BIO =
  "I build AI systems, and I'm pursuing an M.S. in Artificial Intelligence at Johns Hopkins. I built MCProof because AI agents are vulnerable to tool misuse. Tool use is an attack vector in the agent harness, and it needs careful consideration.";

/** The man page's header line, in its three parts, and its NAME line. */
export const MAN_HEADER: readonly string[] = ['SENTINEL(7)', 'MCProof Manual', 'SENTINEL(7)'];
export const MAN_NAME_LINE = "sentinel - MCProof's proving ground";

/**
 * The LinkedIn profile (owner, 2026-10-19). NOT ON THE PAGE: the link was
 * removed for now (ABOUT REVISION, 19:12) and the URL is kept here, unused,
 * for later.
 */
export const ABOUT_LINKEDIN_HREF = 'https://www.linkedin.com/in/dameion-a-662aa880/';
