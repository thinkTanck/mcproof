/**
 * WORDS MORE THAN ONE PAGE SHOWS. Each is written once here, so a page that
 * quotes another (the /about roadmap's Shipped column quotes Home and Connect)
 * shows exactly what that page shows, and the two cannot drift apart.
 *
 * No 'use client': a Server Component can read these values, which it cannot
 * do through a client module.
 */

/** Home's heading over the compromise figures. */
export const METRIC_HEADING_COMPROMISE = 'Catching compromises';
/** Home's heading over the attack-type figure. */
export const METRIC_HEADING_CLASSIFICATION = 'Naming the attack type';
/** The label over Home's list of the seven sample runs. */
export const CORE7_LIST_LABEL = 'The 7 attack types we test · pick a sample';
/** The heading of Home's five-step list. */
export const HOW_A_TEST_WORKS_TITLE = 'How a test works';

export type ConnectClientId = 'claude-code' | 'vscode' | 'cursor' | 'codex' | 'gemini' | 'other';

/** The Connect page's setup tabs, in the order they are offered. */
export const CONNECT_CLIENT_TABS: readonly { id: ConnectClientId; label: string }[] = [
  { id: 'claude-code', label: 'CLAUDE CODE' },
  { id: 'vscode', label: 'GITHUB COPILOT / VS CODE' },
  { id: 'cursor', label: 'CURSOR' },
  { id: 'codex', label: 'CODEX' },
  { id: 'gemini', label: 'GEMINI CLI' },
  { id: 'other', label: 'OTHER AGENT' },
];
