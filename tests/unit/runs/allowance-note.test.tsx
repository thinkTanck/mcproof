import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react';
import { FreeRunsNote } from '@/components/hud/FreeRunsNote';
import { describeLiveRunAllowance, describeLiveRunAllowanceNote } from '@/runs/allowance';

/**
 * THE FREE-RUNS NOTE BESIDE "CONNECT YOUR AGENT" (UI audit 2026-10-12, batch D).
 *
 * One sentence that says how many free live runs an account gets. The number
 * is read from `LIVE_RUN_ALLOWANCE` and becomes words in one place,
 * `describeLiveRunAllowance()`; the note is built on that and types no numeral
 * of its own.
 *
 * WHEN IT IS SHOWN is stricter than when the allowance is enforced. Unset, the
 * gate falls back to a default; the note does not. It is shown only when the
 * variable is set to a whole number above zero that the gate itself would
 * accept, and it is hidden when the variable is 0, unset, empty or not valid.
 * A count the operator never chose is not printed as a promise.
 */

const env = (value: string | undefined) => ({ LIVE_RUN_ALLOWANCE: value });

describe('describeLiveRunAllowanceNote: the sentence, or nothing', () => {
  it.each([
    ['3', 3],
    ['1', 1],
    ['12', 12],
    [' 5 ', 5],
    ['1000', 1000],
  ])('LIVE_RUN_ALLOWANCE=%j shows the note, built on describeLiveRunAllowance()', (raw, n) => {
    const note = describeLiveRunAllowanceNote(env(raw));
    expect(note).not.toBeNull();
    // The number reaches the sentence only as the words the one describer gives.
    expect(note).toContain(describeLiveRunAllowance(n));
    // And it appears once: no second numeral typed beside it.
    expect(note!.match(/\d+/g)).toEqual([String(n)]);
  });

  it('says a single run in the singular', () => {
    expect(describeLiveRunAllowanceNote(env('1'))).toContain('1 free live run in total.');
  });

  it.each([
    ['unset', undefined],
    ['zero', '0'],
    ['zero, padded', '000'],
    ['empty', ''],
    ['blank', '   '],
    ['a word', 'three'],
    ['negative', '-1'],
    ['a fraction', '2.5'],
    ['an exponent', '1e3'],
    ['a signed number', '+3'],
    ['over the upper bound the gate accepts', '1001'],
    ['far over it', '999999999999'],
  ])('hides the note when the variable is %s', (_name, raw) => {
    expect(describeLiveRunAllowanceNote(env(raw))).toBeNull();
  });

  it('never throws on a bad value: a broken setting hides the note, it does not break the page', () => {
    expect(() => describeLiveRunAllowanceNote(env('not a number'))).not.toThrow();
  });

  it('reads process.env when handed nothing', () => {
    vi.stubEnv('LIVE_RUN_ALLOWANCE', '4');
    try {
      expect(describeLiveRunAllowanceNote()).toContain(describeLiveRunAllowance(4));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('says the count is a total that never resets, and never promises a daily one', () => {
    const note = describeLiveRunAllowanceNote(env('3'))!;
    expect(note).toMatch(/in total. The count does not reset./);
    expect(note).not.toMatch(/daily|per day|a day|each day/i);
    // It states the limit for any account, never what this reader has left.
    expect(note).not.toMatch(/\b(you have|your|left|remaining|used)\b/i);
    expect(note).not.toContain('—');
  });

  it('types no numeral in its source: the count comes from config alone', () => {
    const source = readFileSync(join(process.cwd(), 'src/runs/allowance.ts'), 'utf8');
    const start = source.indexOf('export function describeLiveRunAllowanceNote');
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf('\n}\n', start));
    // No digit inside any string or template text of the function.
    const strings = body.match(/'[^'\n]*'|`[^`]*`/g) ?? [];
    expect(strings.join('').replace(/\$\{[^}]*\}/g, '')).not.toMatch(/\d/);
    expect(body).toContain('describeLiveRunAllowance(');
    expect(body).not.toMatch(/NEXT_PUBLIC_/);
  });
});

describe('FreeRunsNote: the sentence on screen', () => {
  it('draws the sentence it is given, as READING prose in the muted tone', () => {
    const text = describeLiveRunAllowanceNote(env('3'))!;
    const { container } = render(<FreeRunsNote text={text} />);
    const note = container.querySelector('[data-free-runs-note]')!;
    expect(note.tagName).toBe('P');
    expect(note).toHaveTextContent(text);
    const classes = note.className.split(/\s+/);
    expect(classes).toContain('reading');
    expect(classes).toContain('measure');
    expect(classes).toContain('text-ink-muted');
    // Never red, never caution, never an INSTRUMENT role.
    expect(classes.some((c) => /breach|caution|instrument|micro-label/.test(c))).toBe(false);
  });

  it.each([[null], [undefined], ['']])('draws nothing at all for %j', (text) => {
    const { container } = render(<FreeRunsNote text={text} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is not a live region', () => {
    const { container } = render(<FreeRunsNote text="Each account gets up to 3 free live runs." />);
    expect(
      container.querySelector('[aria-live], [role="status"], [role="alert"], output'),
    ).toBeNull();
  });

  it('is a plain component: it reads no environment, so the browser never decides the count', () => {
    const source = readFileSync(join(process.cwd(), 'src/components/hud/FreeRunsNote.tsx'), 'utf8');
    expect(source).not.toMatch(/process\.env|NEXT_PUBLIC_|@\/config\/env|\d+ free/);
  });
});
