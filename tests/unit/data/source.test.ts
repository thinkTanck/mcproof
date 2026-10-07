import { RunResultSchema, CategorySchema, type Category } from '@/contract';
import { getDataSource, SAMPLE_RUN_ID, sampleRun } from '@/data/source';
import { SAMPLE_VERDICTS, SAMPLE_VERDICT_PROVENANCE } from '@/data/fixtures/sample-verdicts';
import { generateFixReport } from '@/fix-report';
import { getAttack } from '@/attacks';

// GUARDRAIL SPY: wrap every attack build result so any read of its `groundTruth`
// key is recorded. The DataSource must assemble samples from the observable
// `trace` ONLY — it must never touch the held-out label.
const { gtReads } = vi.hoisted(() => ({ gtReads: new Set<string>() }));
vi.mock('@/attacks', async (importActual) => {
  const actual = await importActual<typeof import('@/attacks')>();
  return {
    ...actual,
    getAttack: (category: Category) => {
      const real = actual.getAttack(category);
      return {
        ...real,
        build: (variant: string) => {
          const result = real.build(variant);
          return new Proxy(result, {
            get(target, prop, receiver) {
              if (prop === 'groundTruth') gtReads.add(category);
              return Reflect.get(target, prop, receiver);
            },
          });
        },
      };
    },
  };
});

const CATEGORIES = CategorySchema.options;

/** Recursively true if `key` appears anywhere in the object graph. */
function hasKeyDeep(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((v) => hasKeyDeep(v, key));
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (key in record) return true;
    return Object.values(record).some((v) => hasKeyDeep(v, key));
  }
  return false;
}

describe('DataSource — sample runs served from the real attack builders', () => {
  const ds = getDataSource();

  it('serves a schema-valid, unlabeled sample RunResult for all seven categories', async () => {
    const runs = await ds.listRuns();
    expect(runs).toHaveLength(7);
    expect([...new Set(runs.map((r) => r.category))].sort()).toEqual([...CATEGORIES].sort());
    for (const r of runs) {
      expect(() => RunResultSchema.parse(r)).not.toThrow();
      expect(Object.keys(r)).not.toContain('groundTruth');
    }
  });

  it("each sample's trace IS the builder-constructed attack, not a hand-authored mock", () => {
    for (const cat of CATEGORIES) {
      const run = sampleRun(cat);
      const builderTrace = getAttack(cat).build('malicious').trace;
      expect(run.trace).toEqual(builderTrace);
      // run / trace / verdict all agree on the builder's run id (single source of truth)
      expect(run.runId).toBe(builderTrace.runId);
      expect(run.trace.runId).toBe(builderTrace.runId);
      expect(run.verdict.runId).toBe(builderTrace.runId);
    }
  });

  it('every recorded verdict anchors stepId to a REAL step of that builder trace (invariant × 7)', () => {
    for (const cat of CATEGORIES) {
      const run = sampleRun(cat);
      expect(run.verdict.compromised).toBe(true);
      expect(run.verdict.stepId).toBeDefined();
      const ids = run.trace.steps.map((s) => s.id);
      expect(ids).toContain(run.verdict.stepId);
      // the anchored step is an observable ACTION the agent took — the rubric
      // forbids anchoring to the ingestion step the hostile content arrived
      // through (tool_result / memory_read), to the principal_instruction turn,
      // or to agent_reasoning.
      const step = run.trace.steps.find((s) => s.id === run.verdict.stepId);
      expect(['tool_call', 'memory_write']).toContain(step?.type);
    }
  });

  it('binds every verdict field from the RECORDING, never from a literal in the assembler', () => {
    for (const cat of CATEGORIES) {
      const recorded = SAMPLE_VERDICTS[cat];
      const { verdict } = sampleRun(cat);
      expect(verdict.compromised).toBe(recorded.compromised);
      expect(verdict.score).toBe(recorded.score);
      expect(verdict.severity).toBe(recorded.severity);
      expect(verdict.category).toBe(recorded.category);
      expect(verdict.rationale).toBe(recorded.rationale);
      expect(verdict.stepId).toBe(recorded.stepId);
    }
  });

  it('carries the exact recorded-verdict provenance, and never claims a live capture', () => {
    expect(SAMPLE_VERDICT_PROVENANCE).toBe(
      'constructed demonstration · recorded validated-judge verdict · claude-haiku-4-5 · 2026-08-05',
    );
    // The traces are BUILT, not captured from a real agent: the label must not
    // imply otherwise, and must name the frozen judge that produced the verdicts.
    expect(SAMPLE_VERDICT_PROVENANCE).toMatch(/constructed demonstration/);
    expect(SAMPLE_VERDICT_PROVENANCE).not.toMatch(/live|captured|real agent|measured/i);
  });

  it('GUARDRAIL: assembling samples never reads groundTruth (spy, same as the detector)', async () => {
    gtReads.clear();
    await ds.listRuns();
    await ds.getRun('sample');
    await ds.getFixReport('sample');
    for (const cat of CATEGORIES) sampleRun(cat);
    expect([...gtReads]).toEqual([]);
  });

  it('leakage barrier: no sample fixture leaks a held-out label anywhere in its graph', async () => {
    const runs = await ds.listRuns();
    const reports = await Promise.all(runs.map((r) => ds.getFixReport(r.runId)));
    for (const fixture of [...runs, ...reports]) {
      expect(hasKeyDeep(fixture, 'groundTruth')).toBe(false);
    }
    for (const run of runs) {
      for (const step of run.trace.steps) {
        expect(hasKeyDeep(step, 'label')).toBe(false);
        expect(hasKeyDeep(step, 'compromiseFlag')).toBe(false);
      }
    }
  });

  it('getRun resolves by canonical id and the "sample" alias, null otherwise', async () => {
    const featured = sampleRun('ASI02');
    expect(SAMPLE_RUN_ID).toBe(featured.runId);
    expect(await ds.getRun(SAMPLE_RUN_ID)).toEqual(featured);
    expect(await ds.getRun('sample')).toEqual(featured);
    expect(await ds.getRun('nope')).toBeNull();
  });

  it('getFixReport is the REAL module-6 generator over the sample run, for every category', async () => {
    for (const cat of CATEGORIES) {
      const run = sampleRun(cat);
      const report = await ds.getFixReport(run.runId);
      // Identical to calling the generator directly: the screen reads the real
      // module, not a hand-authored fixture standing in for it.
      // A sample report is labelled a sample wherever it is read from.
      expect(report).toEqual(generateFixReport(run, { provenance: SAMPLE_VERDICT_PROVENANCE }));
      expect(report?.finding?.stepId).toBe(run.verdict.stepId);
      expect(run.trace.steps.map((s) => s.id)).toContain(report?.finding?.stepId);
    }
    expect(await ds.getFixReport('nope')).toBeNull();
  });

  it('getFixReport resolves the "sample" alias to the canonical sample run', async () => {
    expect(await ds.getFixReport('sample')).toEqual(
      generateFixReport(sampleRun('ASI02'), { provenance: SAMPLE_VERDICT_PROVENANCE }),
    );
  });

  it('getVerdictProvenance labels a sample verdict and returns null for an unknown run', async () => {
    expect(await ds.getVerdictProvenance(SAMPLE_RUN_ID)).toBe(SAMPLE_VERDICT_PROVENANCE);
    expect(await ds.getVerdictProvenance('sample')).toBe(SAMPLE_VERDICT_PROVENANCE);
    expect(await ds.getVerdictProvenance('nope')).toBeNull();
  });
});
