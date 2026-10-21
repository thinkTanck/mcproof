import { CategorySchema } from '@/contract';
import { sampleRun } from '@/data/source';
import { UNKNOWN_CLIENT } from '@/harness/server/recorder';
import {
  DETECTOR_HANDLE,
  LEGEND_ROLE_ORDER,
  OPERATOR_HANDLE,
  ROLES,
  SENTINEL_GLOSSARY_HREF,
  SENTINEL_GLOSSARY_ID,
  SENTINEL_DEFINITION,
  agentHandle,
  handleForStep,
  handleName,
  isSentinelHandle,
  roleForHandle,
  speakHandle,
} from '@/lib/replay/roles';

/**
 * WHO IS SPEAKING IN A REPLAY (Batch G, 2026-10-13).
 *
 * One lookup says who each prompt in a replay is: the handle, the role's name
 * and one sentence. The legend above the terminal, the control on each handle
 * and these tests all read it, so the three cannot disagree.
 *
 * The definitions are the owner's words and are held verbatim.
 */

describe('the roles lookup: the four roles, word for word', () => {
  it('holds exactly four roles, in the order the legend draws them', () => {
    expect(Object.keys(ROLES).sort()).toEqual(['agent', 'detector', 'operator', 'tool']);
    expect(LEGEND_ROLE_ORDER).toEqual(['operator', 'agent', 'detector', 'tool']);
  });

  it.each([
    ['operator', 'Operator', 'The person who gives the agent a normal task.'],
    ['agent', 'Agent under test', 'The AI agent being tested.'],
    [
      'detector',
      'MCProof detector',
      'Judges the finished run and marks the compromised step, if any.',
    ],
    [
      'tool',
      'Served tool',
      'A tool MCProof provides for the test. In an attack run, one of them hides the attack.',
    ],
  ] as const)('%s is "%s. %s"', (id, name, definition) => {
    expect(ROLES[id].id).toBe(id);
    expect(ROLES[id].name).toBe(name);
    expect(ROLES[id].definition).toBe(definition);
  });

  it('writes no em dash and names no ASI code', () => {
    for (const role of Object.values(ROLES)) {
      expect(`${role.name} ${role.definition}`).not.toMatch(/—|ASI\d\d/);
    }
  });
});

describe('the roles lookup: every handle pattern resolves', () => {
  it('user@console is the operator', () => {
    expect(OPERATOR_HANDLE).toBe('user@console');
    expect(roleForHandle('user@console')).toBe(ROLES.operator);
  });

  it('detector@sentinel is the detector, ahead of the agent rule it would also match', () => {
    expect(DETECTOR_HANDLE).toBe('detector@sentinel');
    expect(roleForHandle('detector@sentinel')).toBe(ROLES.detector);
  });

  it.each(['target-agent', 'claude-code', UNKNOWN_CLIENT, 'Some Agent 2.1'])(
    '%s@sentinel is the agent under test',
    (model) => {
      expect(agentHandle(model)).toBe(`${model}@sentinel`);
      expect(roleForHandle(agentHandle(model))).toBe(ROLES.agent);
    },
  );

  it.each(['read_file@mcp', 'workspace-mcp', 'send_email@workspace-mcp', 'anything-else'])(
    'any other handle (%s) is a tool or server handle',
    (handle) => {
      expect(roleForHandle(handle)).toBe(ROLES.tool);
    },
  );

  it('tells a sentinel handle from the others', () => {
    expect(isSentinelHandle('target-agent@sentinel')).toBe(true);
    expect(isSentinelHandle('detector@sentinel')).toBe(true);
    expect(isSentinelHandle('user@console')).toBe(false);
    expect(isSentinelHandle('read_file@mcp')).toBe(false);
  });
});

describe('the roles lookup: the name a screen reader hears', () => {
  it('says "at" for the @ and adds the role', () => {
    expect(speakHandle('target-agent@sentinel')).toBe('target-agent at sentinel');
    expect(handleName('target-agent@sentinel')).toBe('target-agent at sentinel, Agent under test');
    expect(handleName('user@console')).toBe('user at console, Operator');
    expect(handleName('detector@sentinel')).toBe('detector at sentinel, MCProof detector');
  });
});

describe('the roles lookup: which handle a step is drawn under', () => {
  it('the instruction is the operator, a command is the agent, output has no handle', () => {
    const model = 'target-agent';
    const handle = (type: string) =>
      handleForStep({ type } as Parameters<typeof handleForStep>[0], model);
    expect(handle('principal_instruction')).toBe('user@console');
    expect(handle('tool_call')).toBe('target-agent@sentinel');
    expect(handle('memory_write')).toBe('target-agent@sentinel');
    expect(handle('task_complete')).toBe('target-agent@sentinel');
    expect(handle('agent_reasoning')).toBeNull();
    expect(handle('tool_result')).toBeNull();
    expect(handle('memory_read')).toBeNull();
  });

  it('every handle any of the seven sample runs draws has an entry', () => {
    const seen = new Set<string>([DETECTOR_HANDLE]);
    for (const category of CategorySchema.options) {
      const run = sampleRun(category);
      for (const step of run.trace.steps) {
        const handle = handleForStep(step, run.model);
        if (handle) seen.add(handle);
      }
    }
    // The whole set, so a new kind of handle cannot arrive unnoticed.
    expect([...seen].sort()).toEqual([
      'detector@sentinel',
      'target-agent@sentinel',
      'user@console',
    ]);
    for (const handle of seen) {
      expect(Object.values(ROLES)).toContain(roleForHandle(handle));
      expect(roleForHandle(handle)).not.toBe(ROLES.tool);
    }
  });
});

describe('the glossary entry for Sentinel', () => {
  it('is the exact sentence, with a straight apostrophe', () => {
    expect(SENTINEL_DEFINITION).toBe(
      "A sentinel is a guard posted to keep watch. Sentinel is MCProof's proving ground: a sealed test environment where your agent meets booby-trapped tools while our detector watches every step. In a replay, anything marked @sentinel happened inside it. MCProof is the proof. Sentinel is where we prove it.",
    );
  });

  it('lives at an anchor on the coverage page', () => {
    expect(SENTINEL_GLOSSARY_ID).toBe('sentinel');
    expect(SENTINEL_GLOSSARY_HREF).toBe('/threats#sentinel');
  });
});
