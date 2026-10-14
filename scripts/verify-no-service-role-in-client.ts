/**
 * Prove a build sends the browser nothing of the service-role key.
 *
 * The service-role key skips Row-Level Security, and since the run writer
 * (`src/runs/run-writes.ts`) it is what every `public.runs` insert is made
 * with. Everything under `.next/static` is served to anybody who asks, so this
 * reads every file there and fails if it finds either:
 *
 *   - the key's NAME. A client chunk has no reason to mention it, and a chunk
 *     that does means a server module was pulled into the browser bundle;
 *   - the key's VALUE, when the variable is set in the environment this script
 *     runs in. That is the leak itself, and it is checked on the artifact, not
 *     inferred from the import graph.
 *
 * The static half of the same guarantee is in
 * `tests/unit/lib/secret-leakage.guard.test.ts`, which walks the import graph
 * from every `'use client'` module. This is the half that looks at what was
 * actually built.
 *
 * Run it after `npm run build`. `--dir <path>` points it somewhere else (its own
 * test uses that); a directory that does not exist is a failure, so it cannot
 * pass by reading nothing. The value is never printed, in any outcome.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const KEY_NAME = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');
/** Shorter than this and a match would mean nothing: it could be any substring. */
const MIN_VALUE_LENGTH = 20;

const dirFlag = process.argv.indexOf('--dir');
const staticDir =
  dirFlag !== -1 && process.argv[dirFlag + 1] !== undefined
    ? process.argv[dirFlag + 1]!
    : join(process.cwd(), '.next', 'static');

if (!existsSync(staticDir) || !statSync(staticDir).isDirectory()) {
  console.error(`No client bundle at ${staticDir}. Run a build first.`);
  process.exit(1);
}

function files(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files(path, out);
    else out.push(path);
  }
  return out;
}

const configured = process.env[KEY_NAME]?.trim() ?? '';
const checkValue = configured.length >= MIN_VALUE_LENGTH;

const all = files(staticDir);
const named: string[] = [];
const carried: string[] = [];

for (const file of all) {
  // latin1 keeps every byte, so a match cannot be lost to a decoding error in a
  // binary asset.
  const text = readFileSync(file, 'latin1');
  if (text.includes(KEY_NAME)) named.push(relative(staticDir, file));
  if (checkValue && text.includes(configured)) carried.push(relative(staticDir, file));
}

if (all.length === 0) {
  console.error(`The client bundle at ${staticDir} is empty. Run a build first.`);
  process.exit(1);
}

if (named.length > 0 || carried.length > 0) {
  if (named.length > 0) {
    console.error(`The service-role key is NAMED in the client bundle: ${named.join(', ')}`);
  }
  if (carried.length > 0) {
    console.error(`The service-role key's VALUE is in the client bundle: ${carried.join(', ')}`);
  }
  process.exit(1);
}

console.log(
  `No trace of the service-role key in ${all.length} client files ` +
    `(name checked; value ${checkValue ? 'checked' : 'not set in this environment, so not checked'}).`,
);
