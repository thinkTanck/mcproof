/**
 * THE REPO-WIDE NO-LOG GUARD.
 *
 * `src/runs/run-token.ts` proved, for one credential, that no log line, no
 * persisted record and no serialized error carries the plaintext. That proof was
 * local: it holds for the token because its own tests say so, and it says nothing
 * about the next secret someone logs. This file generalizes it two ways.
 *
 * 1. BEHAVIOURAL — it drives the REAL logger with real secret values in every
 *    shape a caller can produce (top level, nested, inside an array, inside an
 *    Error, interpolated into the message itself) and asserts none of them
 *    survives serialization.
 * 2. STATIC — it scans `src/` and `scripts/` for the two ways a secret reaches a
 *    sink WITHOUT passing through that redaction: a bare `console.*` call, and a
 *    secret-named identifier handed to a log call or baked into an Error message.
 *
 * The static half is the half that catches FUTURE violations, which is the point:
 * a one-off sweep is clean the day it is written and silent forever after.
 *
 * ESCAPE HATCH: a call may carry `secret-safe:` in a comment on the call or the
 * line above it, with the reason. It is deliberately a conscious, reviewable act.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createLogger, logger } from '@/lib/logger';
import { redactSecrets, redactString, REDACTED } from '@/lib/redact';

// ── The sentinels. Not real credentials: shapes standing in for them. ──
const JUDGE_KEY = 'sk-ant-test-0123456789abcdef0123456789abcdef';
const SERVICE_ROLE = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.dGVzdHNpZ25hdHVyZQ';
const RUN_TOKEN = `rt_${'1'.repeat(32)}_${'2'.repeat(64)}`;
const OTP_CODE = '482913';

const ENV = {
  JUDGE_API_KEY: JUDGE_KEY,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE,
} as Record<string, string | undefined>;

// ── Static scan ──

const ROOT = process.cwd();
const SCAN_ROOTS = ['src', 'scripts'];

/**
 * The console rule applies to the APPLICATION only. `scripts/` holds operator
 * CLIs whose entire output is a console report (the eval measurement printers),
 * so forbidding a console there would be forbidding them to work. They stay
 * inside the secret-in-sink rule, which is the one that matters for them: they
 * are the only code that holds a judge key.
 */
const CONSOLE_RULE_ROOTS = ['src/'];

/** The one file allowed to write to a console: the logger's own default sink. */
const CONSOLE_ALLOWLIST = ['src/lib/logger.ts'];

/**
 * Identifiers that name a secret VALUE. Matched case-sensitively as whole words,
 * so `maxTokens`, `bandToken` and `hasVerifier` (a presence flag, not a value)
 * are not swept up.
 */
const SECRET_IDENTIFIERS = [
  'apiKey',
  'api_key',
  'apiSecret',
  'secretKey',
  'serviceRoleKey',
  'password',
  'passphrase',
  'plaintext',
  'verifier',
  'otp',
  'otpCode',
  'oneTimeCode',
  'credential',
  'credentials',
  'bearer',
  'token',
  'secret',
  'authorization',
  'JUDGE_API_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'MCP_TARGET_TOKEN',
  'DATABASE_URL',
];

const SINK_CALL =
  /(?:console\.(?:log|info|warn|error|debug|trace)|(?:logger|log)\.(?:debug|info|warn|error)|new\s+[A-Za-z]*Error|throw\s+new\s+[A-Za-z]+)\s*\(/g;

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.tsx?$/.test(entry)) out.push(full);
    }
  };
  for (const root of SCAN_ROOTS) walk(join(ROOT, root));
  return out;
}

const posix = (file: string) => relative(ROOT, file).split(sep).join('/');

/** Blank out comment bodies, keeping the character count so offsets still line up. */
function stripComments(code: string): string {
  const out = code.split('');
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < code.length) {
    const two = code.slice(i, i + 2);
    if (two === '//') {
      const end = code.indexOf('\n', i);
      blank(i, end === -1 ? code.length : end);
      i = end === -1 ? code.length : end;
    } else if (two === '/*') {
      const end = code.indexOf('*/', i + 2);
      blank(i, end === -1 ? code.length : end + 2);
      i = end === -1 ? code.length : end + 2;
    } else if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
      const quote = code[i];
      i += 1;
      while (i < code.length && code[i] !== quote) i += code[i] === '\\' ? 2 : 1;
      i += 1;
    } else {
      i += 1;
    }
  }
  return out.join('');
}

/**
 * Blank out the STATIC text of every string literal, keeping `${...}` interiors.
 *
 * This is what separates "the error names the variable" from "the error prints
 * its value": `new ConfigError('missing SUPABASE_SERVICE_ROLE_KEY')` names an
 * env var and leaks nothing, while `` `key=${apiKey}` `` leaks everything.
 */
function stripStringContent(code: string): string {
  const out = code.split('');
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < code.length) {
    const ch = code[i];
    if (ch === '"' || ch === "'") {
      const start = i;
      i += 1;
      while (i < code.length && code[i] !== ch) i += code[i] === '\\' ? 2 : 1;
      blank(start + 1, Math.min(i, code.length));
      i += 1;
    } else if (ch === '`') {
      i += 1;
      let chunk = i;
      while (i < code.length && code[i] !== '`') {
        if (code[i] === '\\') {
          i += 2;
          continue;
        }
        if (code[i] === '$' && code[i + 1] === '{') {
          blank(chunk, i);
          let depth = 1;
          i += 2;
          while (i < code.length && depth > 0) {
            if (code[i] === '{') depth += 1;
            if (code[i] === '}') depth -= 1;
            i += 1;
          }
          chunk = i;
          continue;
        }
        i += 1;
      }
      blank(chunk, Math.min(i, code.length));
      i += 1;
    } else {
      i += 1;
    }
  }
  return out.join('');
}

/** The text between a call's opening paren and its matching close. */
function callArguments(code: string, openParen: number): { text: string; end: number } {
  let depth = 0;
  for (let i = openParen; i < code.length; i += 1) {
    if (code[i] === '(') depth += 1;
    else if (code[i] === ')') {
      depth -= 1;
      if (depth === 0) return { text: code.slice(openParen + 1, i), end: i };
    }
  }
  return { text: code.slice(openParen + 1), end: code.length };
}

const lineOf = (code: string, index: number) => code.slice(0, index).split('\n').length;

function hasEscapeHatch(original: string, startLine: number, endLine: number): boolean {
  const lines = original.split('\n');
  const from = Math.max(0, startLine - 2);
  return lines.slice(from, endLine).join('\n').includes('secret-safe:');
}

export interface Finding {
  file: string;
  line: number;
  rule: 'console' | 'secret-in-sink';
  detail: string;
}

/** Scan one file's text. Exported shape kept simple so the tests below can seed it. */
function scan(file: string, source: string): Finding[] {
  const findings: Finding[] = [];
  const commentless = stripComments(source);
  const code = stripStringContent(commentless);

  const consoleRuleApplies =
    CONSOLE_RULE_ROOTS.some((root) => file.startsWith(root)) && !CONSOLE_ALLOWLIST.includes(file);

  if (consoleRuleApplies) {
    const consoleCall = /\bconsole\.[a-z]+\s*\(/g;
    for (let m = consoleCall.exec(code); m; m = consoleCall.exec(code)) {
      const line = lineOf(code, m.index);
      if (hasEscapeHatch(source, line, line)) continue;
      findings.push({
        file,
        line,
        rule: 'console',
        detail: 'writes to a console directly; log through @/lib/logger so redaction applies',
      });
    }
  }

  SINK_CALL.lastIndex = 0;
  for (let m = SINK_CALL.exec(code); m; m = SINK_CALL.exec(code)) {
    const open = m.index + m[0].length - 1;
    const { text, end } = callArguments(code, open);
    const hit = SECRET_IDENTIFIERS.find((word) =>
      new RegExp(`(?<![A-Za-z0-9_$])${word}(?![A-Za-z0-9_$])`).test(text),
    );
    if (!hit) continue;
    const startLine = lineOf(code, m.index);
    if (hasEscapeHatch(source, startLine, lineOf(code, end))) continue;
    findings.push({
      file,
      line: startLine,
      rule: 'secret-in-sink',
      detail: `passes "${hit}" into ${m[0].trim()})`,
    });
  }

  return findings;
}

function scanRepository(): Finding[] {
  return sourceFiles().flatMap((file) => scan(posix(file), readFileSync(file, 'utf8')));
}

const describeFindings = (findings: Finding[]) =>
  findings.map((f) => `${f.file}:${f.line} [${f.rule}] ${f.detail}`).join('\n');

describe('no secret reaches a log sink anywhere in the codebase (static)', () => {
  it('finds no violation in src/ or scripts/', () => {
    const findings = scanRepository();

    expect(describeFindings(findings)).toBe('');
  });

  it('scans a real number of files, so a broken walker cannot pass by finding nothing', () => {
    expect(sourceFiles().length).toBeGreaterThan(50);
  });

  it('allows the logger its own console sink, and nothing else', () => {
    expect(CONSOLE_ALLOWLIST).toEqual(['src/lib/logger.ts']);
    expect(scan('src/lib/logger.ts', 'console.log(line);')).toEqual([]);
  });

  it('lets an operator CLI print, but still refuses to let it print a secret', () => {
    expect(scan('scripts/eval-measure.ts', 'console.log("precision 0.9565");')).toEqual([]);
    expect(scan('scripts/eval-measure.ts', 'console.log(`using ${apiKey}`);')).toHaveLength(1);
  });
});

describe('the static guard actually catches the violations it claims to', () => {
  it('catches a secret interpolated into a log message', () => {
    const findings = scan('src/x.ts', 'logger.info(`judge key ${apiKey} used`);');

    expect(findings).toHaveLength(1);
    expect(findings[0]!.rule).toBe('secret-in-sink');
  });

  it('catches a secret handed to a log call as context', () => {
    expect(scan('src/x.ts', 'logger.warn("sending", { token });')).toHaveLength(1);
  });

  it('catches a secret baked into a thrown error message', () => {
    expect(scan('src/x.ts', 'throw new ConfigError(`bad key ${JUDGE_API_KEY}`);')).toHaveLength(1);
  });

  it('catches a bare console call', () => {
    const findings = scan('src/x.ts', 'console.log("hello");');

    expect(findings).toHaveLength(1);
    expect(findings[0]!.rule).toBe('console');
  });

  it('catches a violation spread across several lines', () => {
    const findings = scan(
      'src/x.ts',
      ['logger.error("failed", {', '  detail: `bearer ${token}`,', '});'].join('\n'),
    );

    expect(findings.length).toBeGreaterThan(0);
  });

  it('does NOT flag an error that names an env var without printing it', () => {
    expect(scan('src/x.ts', "throw new ConfigError('missing SUPABASE_SERVICE_ROLE_KEY');")).toEqual(
      [],
    );
  });

  it('does NOT flag a presence flag or a lookalike identifier', () => {
    expect(
      scan('src/x.ts', 'logger.warn("callback", { hasVerifier, maxTokens, bandToken });'),
    ).toEqual([]);
  });

  it('does NOT flag a comment that discusses secrets', () => {
    expect(scan('src/x.ts', '// never pass apiKey to logger.info(apiKey)\nconst a = 1;')).toEqual(
      [],
    );
  });

  it('does NOT flag building a credential outside a sink', () => {
    expect(scan('src/x.ts', 'const header = `Bearer ${apiKey}`;')).toEqual([]);
  });

  it('honours an explicit, documented escape hatch', () => {
    const source = [
      '// secret-safe: presence only, the value never reaches this line',
      'logger.info("judge", { token: Boolean(token) });',
    ].join('\n');

    expect(scan('src/x.ts', source)).toEqual([]);
  });
});

// ── Behavioural: drive the real logger ──

function capturingLogger() {
  const lines: string[] = [];
  return {
    lines,
    log: createLogger({ sink: (line) => lines.push(line), now: () => new Date(0) }),
  };
}

describe('no secret reaches a log sink (behavioural, real logger)', () => {
  const previous = { ...process.env };

  beforeEach(() => {
    process.env.JUDGE_API_KEY = JUDGE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE;
  });

  afterEach(() => {
    process.env.JUDGE_API_KEY = previous.JUDGE_API_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = previous.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('redacts a configured secret in every shape a caller can produce', () => {
    const { lines, log } = capturingLogger();

    log.info(`judge call failed with ${JUDGE_KEY}`, {
      nested: { deeper: { detail: `service role ${SERVICE_ROLE}` } },
      list: [`key ${JUDGE_KEY}`, { also: SERVICE_ROLE }],
      error: new Error(`upstream rejected ${JUDGE_KEY}`),
    });

    const emitted = lines.join('\n');
    expect(emitted).not.toContain(JUDGE_KEY);
    expect(emitted).not.toContain(SERVICE_ROLE);
    expect(emitted).toContain(REDACTED);
  });

  it('redacts a per-run token by shape, with nothing configured', () => {
    const { lines, log } = capturingLogger();

    log.warn('inbound connection refused', {
      presented: RUN_TOKEN,
      detail: `authorization: Bearer ${RUN_TOKEN}`,
    });

    expect(lines.join('\n')).not.toContain(RUN_TOKEN);
  });

  it('redacts an emailed one-time code handed in under any of its names', () => {
    const { lines, log } = capturingLogger();

    log.info('verify attempted', { otp: OTP_CODE, oneTimeCode: OTP_CODE, token: OTP_CODE });

    expect(lines.join('\n')).not.toContain(OTP_CODE);
  });

  it('redacts through the default logger, not just an injected sink', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      logger.info(`default sink ${JUDGE_KEY}`, { nested: { key: JUDGE_KEY } });

      expect(String(spy.mock.calls[0]![0])).not.toContain(JUDGE_KEY);
    } finally {
      spy.mockRestore();
    }
  });

  it('keeps the operational detail that makes a log line worth having', () => {
    const { lines, log } = capturingLogger();

    log.warn('run token rejected', { runId: 'run-1', code: 'UNKNOWN' });

    const record = JSON.parse(lines[0]!);
    expect(record.ctx).toEqual({ runId: 'run-1', code: 'UNKNOWN' });
  });
});

describe('no secret survives serialization into an error', () => {
  it('redacts a secret out of a serialized error', () => {
    const error = new Error(`POST failed for key ${JUDGE_KEY}`);

    const serialized = JSON.stringify(redactSecrets({ error }, { env: ENV }));

    expect(serialized).not.toContain(JUDGE_KEY);
  });

  it('redacts a secret out of an error message rendered as text', () => {
    expect(redactString(`refused: ${SERVICE_ROLE}`, { env: ENV })).not.toContain(SERVICE_ROLE);
  });
});
