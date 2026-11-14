// TEMPORARY PROOF CONFIG for F-A (owner ruling 2026-11-13). Runs ONLY the
// changed spec, about.spec.ts, in chromium, webkit and webkit-desktop, with the
// projects' own device settings and no retries. Deleted, with
// .github/workflows/fa-proof.yml, before the PR merges.
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

const ABOUT = /about\.spec\.ts$/;
const wanted = new Set(['chromium', 'webkit', 'webkit-desktop']);

export default defineConfig({
  ...base,
  retries: 0,
  failOnFlakyTests: true,
  projects: (base.projects ?? [])
    .filter((project) => wanted.has(project.name ?? ''))
    .map((project) => ({ ...project, testMatch: ABOUT, testIgnore: [] })),
});
