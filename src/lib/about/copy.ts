/**
 * THE WORDS OF /about (owner rulings 2026-10-18; plan in
 * claude/reports/about-plan.md). Each string is the owner's, held word for
 * word by `tests/unit/app/about.test.tsx`. The roadmap items are the owner's
 * list written as sentences, with the v2 wording ruled on 2026-10-18.
 *
 * NO HANDLE OR ALIAS, AND NO CONTACT ADDRESS. The page names its author and
 * nothing else; the security.txt address is never on it (owner ruling 1).
 */

export const ABOUT_HEADING = 'Built by Dameion Ayers';

/** What `whoami` prints first. */
export const ABOUT_WHOAMI = 'dameion-ayers';

export const ABOUT_BIO =
  "I've been writing code for most of my working life. After a B.S. in Mathematics with computer science coursework, I wrote AutoLISP and VBA tools that automated engineering work on commercial glass and glazing projects. Today I build AI systems, and I'm pursuing an M.S. in Artificial Intelligence at Johns Hopkins. I built MCProof because AI agents are being handed real tools before anyone checks whether they can be tricked into misusing them.";

/** Plain text: Agentrifi is not a link. */
export const ABOUT_AGENTRIFI_LINE = 'MCProof is a project of Agentrifi, my AI company.';

/** The LinkedIn profile (owner, 2026-10-19). Opens in a new tab. */
export const ABOUT_LINKEDIN_HREF = 'https://www.linkedin.com/in/dameion-a-662aa880/';

export const CAREER_NODES: readonly string[] = [
  'B.S. Mathematics',
  'AutoLISP + VBA engineering tools',
  'AI systems, M.S. AI at Johns Hopkins',
  'MCProof',
];

export const ROADMAP_NOTE = 'Planned, not promised. No dates.';

export const ROADMAP_NEXT: readonly string[] = [
  'Test weaker and open-source agents with a pluggable runner, and measure GitHub Copilot, Cursor, Codex and Gemini CLI.',
  'Re-measure ASI02 on the fixed trap.',
  'A held-out test set kept outside the repo.',
  'A second detector model to cross-check verdicts.',
  'More than one test per session.',
  'Clearer results history.',
];

export const ROADMAP_LATER: readonly string[] = [
  'Test any agent from your own CI pipeline.',
  "The 3 OWASP risks a single run can't test, via multi-run and multi-agent scenarios.",
  'Agent-to-agent tests.',
  'Scheduled re-tests that flag when an update makes your agent easier to trick.',
  'Team accounts.',
  'New attack scenarios as real agent exploits are published.',
];
