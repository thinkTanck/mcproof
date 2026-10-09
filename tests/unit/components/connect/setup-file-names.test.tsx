import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ClientSetup,
  CURSOR_CONFIG_FILE,
  ISOLATED_CONFIG_FILE,
  ISOLATED_LAUNCH_COMMAND,
  VSCODE_CONFIG_FILE,
} from '@/components/connect/ClientSetup';
import { CopyOut } from '@/components/connect/CopyOut';
import type { LiveRunTicketView } from '@/components/connect/live-run-port';

/**
 * A FILE NAME IS SHOWN EXACTLY AS IT HAS TO BE TYPED (sweep 2026-10-07, C6).
 *
 * The labels above the setup snippets are INSTRUMENT micro-labels, and the
 * micro-label role is uppercase. So `SAVE AS run-mcp.json` was drawn
 * `SAVE AS RUN-MCP.JSON`, one line above a command that loads `run-mcp.json`.
 * File names are case-sensitive on Linux and macOS: a reader who saves the file
 * under the name the label shows gets a launch command that cannot find it. The
 * Cursor and VS Code labels had the same fault, and there the label is the ONLY
 * place the path is written.
 *
 * The file name is now its own element inside the label, exempt from the
 * uppercase transform, and its text is the same constant the command is built
 * from. jsdom applies no stylesheet, so what is asserted here is the structure
 * and the exact string; the rendered casing is measured in a browser in
 * tests/e2e/setup-file-names.spec.ts.
 */

const TICKET: LiveRunTicketView = {
  runId: 'run-77',
  endpoint: 'https://mcproof.dev/api/mcp/run-77',
  token: 'rt_secret',
  expiresAt: '2099-01-01T00:00:00.000Z',
  category: 'ASI01',
  kind: 'malicious',
  promptName: 'session_brief',
  taskGoal: 'Clear the finance inbox.',
};

/** Every file name a label shows, in document order. */
const fileNames = () => screen.queryAllByTestId('copy-out-file');

async function openTab(name: string) {
  const user = userEvent.setup();
  render(<ClientSetup ticket={TICKET} />);
  await user.click(
    within(screen.getByRole('group', { name: 'MCP client' })).getByRole('button', { name }),
  );
}

describe('the constants are the names as typed', () => {
  it('are lower-case paths, exactly', () => {
    expect(ISOLATED_CONFIG_FILE).toBe('run-mcp.json');
    expect(CURSOR_CONFIG_FILE).toBe('.cursor/mcp.json');
    expect(VSCODE_CONFIG_FILE).toBe('.vscode/mcp.json');
  });

  it('the launch command loads the file the label says to save', () => {
    expect(ISOLATED_LAUNCH_COMMAND.endsWith(` ${ISOLATED_CONFIG_FILE}`)).toBe(true);
  });
});

describe('CopyOut · a label that names a file', () => {
  it('draws the file name as its own element, exactly, and exempt from the label casing', () => {
    render(<CopyOut label="SAVE AS" file="Mixed-Case.Name.json" name="a file" value="{}" />);

    const file = screen.getByTestId('copy-out-file');
    expect(file.textContent).toBe('Mixed-Case.Name.json');
    // `normal-case` undoes the micro-label's uppercase for this element only.
    expect(file.className).toMatch(/\bnormal-case\b/);
    // Still part of the label a reader scans: inside the micro-label, after it.
    const label = file.closest('.micro-label');
    expect(label).not.toBeNull();
    expect(label!.textContent).toBe('SAVE AS Mixed-Case.Name.json');
  });

  it('draws no file element when the label names none', () => {
    render(<CopyOut label="RUN ENDPOINT" name="run endpoint" value="https://x" />);

    expect(screen.queryByTestId('copy-out-file')).not.toBeInTheDocument();
  });
});

describe('ClientSetup · Claude Code, terminal route', () => {
  it('the label names exactly the file the launch command loads', async () => {
    await openTab('CLAUDE CODE');

    const names = fileNames().map((el) => el.textContent);
    expect(names).toEqual([ISOLATED_CONFIG_FILE]);
    // The same string, three places: the label, the step sentence, the command.
    expect(screen.getByText(ISOLATED_LAUNCH_COMMAND)).toBeVisible();
    expect(ISOLATED_LAUNCH_COMMAND).toContain(names[0]!);
    expect(fileNames()[0]!.closest('.micro-label')!.textContent).toBe(
      `SAVE AS ${ISOLATED_CONFIG_FILE}`,
    );
  });

  it('no label carries the file name outside that element, where it would be uppercased', async () => {
    await openTab('CLAUDE CODE');

    for (const label of document.querySelectorAll('.micro-label')) {
      const outside = [...label.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join('');
      expect(outside.toLowerCase()).not.toContain(ISOLATED_CONFIG_FILE);
      expect(outside).not.toMatch(/\.json/i);
    }
  });
});

describe('ClientSetup · Cursor and VS Code', () => {
  it('each label names its config path exactly, from the constant', async () => {
    await openTab('CURSOR / VS CODE');

    expect(fileNames().map((el) => el.textContent)).toEqual([
      CURSOR_CONFIG_FILE,
      VSCODE_CONFIG_FILE,
    ]);
    expect(fileNames().map((el) => el.closest('.micro-label')!.textContent)).toEqual([
      `CURSOR · ${CURSOR_CONFIG_FILE}`,
      `VS CODE · ${VSCODE_CONFIG_FILE}`,
    ]);
    for (const el of fileNames()) expect(el.className).toMatch(/\bnormal-case\b/);
  });
});

describe('ClientSetup · the tabs that name no file', () => {
  it.each(['CLAUDE DESKTOP (CHAT)', 'ANY MCP CLIENT'])('%s shows none', async (tab) => {
    await openTab(tab);

    expect(fileNames()).toHaveLength(0);
    for (const label of document.querySelectorAll('.micro-label')) {
      expect(label.textContent).not.toMatch(/\.json/i);
    }
  });
});
