/**
 * Prove a build contains no e2e fixture route.
 *
 * Run by CI right after the normal (production-shaped) build, against the
 * routes manifest Next writes, so the exclusion is checked on the artifact the
 * CWV gate then measures, not assumed from config. Pass `--expect-present` to
 * check the opposite on a fixture build, so this script cannot pass vacuously.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findFixtureRoutes } from '../src/config/e2e-fixtures';

const manifestPath = join(process.cwd(), '.next', 'app-path-routes-manifest.json');
const expectPresent = process.argv.includes('--expect-present');

let routes: Record<string, string>;
try {
  routes = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, string>;
} catch {
  console.error(`No routes manifest at ${manifestPath}. Run a build first.`);
  process.exit(1);
}

const found = findFixtureRoutes(routes);
const total = Object.keys(routes).length;

if (expectPresent) {
  if (found.length === 0) {
    console.error(`Expected fixture routes in this build, found none in ${total} routes.`);
    process.exit(1);
  }
  console.log(`Fixture build: ${found.length} fixture route(s): ${found.join(', ')}`);
} else {
  if (found.length > 0) {
    console.error(`Fixture routes found in a build that must not have them: ${found.join(', ')}`);
    process.exit(1);
  }
  console.log(`No fixture routes in ${total} built routes.`);
}
