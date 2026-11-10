// Reads the latest versioned release from CHANGELOG.md and synchronizes
// app.json (expo.version), package.json (version), and constants/changelogMeta.js
// so the changelog is the single source of truth for the app version.
//
// Idempotent: files are only rewritten when their version actually changes.
//
// Usage: node --import ./scripts/register.mjs ./scripts/sync-version.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { latestDocumentedRelease } from '../utils/changelog';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const changelogPath = resolve(repoRoot, 'CHANGELOG.md');
const appJsonPath = resolve(repoRoot, 'app.json');
const packageJsonPath = resolve(repoRoot, 'package.json');

// Normalize the user-facing heading format to what the shared parser expects.
const USER_RELEASE_HEADING =
  /^#\s+v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\s+[-–—]\s+(\d{4}-\d{2}-\d{2})\s*$/gm;
const normalizeReleaseHeadings = (markdown) =>
  markdown.replace(USER_RELEASE_HEADING, '## [$1] - $2');

// 1. Extract the latest version from CHANGELOG.md.
let changelogText;
try {
  changelogText = readFileSync(changelogPath, 'utf8');
} catch (error) {
  console.error(`ERROR: could not read CHANGELOG.md (${error.code ?? error.message})`);
  process.exit(1);
}

const release = latestDocumentedRelease(normalizeReleaseHeadings(changelogText));
if (!release) {
  console.error('ERROR: no versioned release heading found in CHANGELOG.md');
  console.error('       Add a heading like: # v1.2.0 — 2026-11-10');
  process.exit(1);
}

const version = release.version;
console.log(`Changelog version: ${version}`);

// 2. Update app.json (expo.version) if it differs.
let appJsonUpdated = false;
try {
  const appJsonText = readFileSync(appJsonPath, 'utf8');
  const appJson = JSON.parse(appJsonText);
  const oldVersion = appJson.expo?.version;
  if (oldVersion !== version) {
    appJson.expo.version = version;
    writeFileSync(appJsonPath, JSON.stringify(appJson, null, 2) + '\n');
    appJsonUpdated = true;
    console.log(`  app.json: ${oldVersion ?? '(missing)'} → ${version}`);
  } else {
    console.log(`  app.json: already ${version}`);
  }
} catch (error) {
  console.error(`ERROR: could not update app.json (${error.code ?? error.message})`);
  process.exit(1);
}

// 3. Update package.json (version) if it differs.
let packageJsonUpdated = false;
try {
  const packageJsonText = readFileSync(packageJsonPath, 'utf8');
  const packageJson = JSON.parse(packageJsonText);
  const oldVersion = packageJson.version;
  if (oldVersion !== version) {
    packageJson.version = version;
    writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
    packageJsonUpdated = true;
    console.log(`  package.json: ${oldVersion ?? '(missing)'} → ${version}`);
  } else {
    console.log(`  package.json: already ${version}`);
  }
} catch (error) {
  console.error(`ERROR: could not update package.json (${error.code ?? error.message})`);
  process.exit(1);
}

// 4. Regenerate constants/changelogMeta.js (always, to pick up section changes).
try {
  const genScript = resolve(repoRoot, 'scripts/generate-changelog-meta.mjs');
  execFileSync(process.execPath, ['--import', './scripts/register.mjs', genScript], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
} catch (error) {
  console.error(`ERROR: could not regenerate changelogMeta.js (${error.message})`);
  process.exit(1);
}

const changed = appJsonUpdated || packageJsonUpdated;
if (changed) {
  console.log(`\nVersion synced to ${version}.`);
} else {
  console.log(`\nAll versions already at ${version}.`);
}
