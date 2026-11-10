// Verifies that app.json, package.json, and constants/changelogMeta.js
// all report the same version as the latest release in CHANGELOG.md.
//
// Usage: node --import ./scripts/register.mjs ./scripts/verify-version.mjs

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { latestDocumentedRelease } from '../utils/changelog';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

let passed = 0;
let failed = 0;

function check(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// Normalize user-facing headings so the shared parser can read them.
const USER_RELEASE_HEADING =
  /^#\s+v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)\s+[-–—]\s+(\d{4}-\d{2}-\d{2})\s*$/gm;
const normalizeReleaseHeadings = (markdown) =>
  markdown.replace(USER_RELEASE_HEADING, '## [$1] - $2');

// 1. Changelog is readable and has a versioned release.
let changelogVersion = null;
let changelogText;
try {
  changelogText = readFileSync(resolve(repoRoot, 'CHANGELOG.md'), 'utf8');
  const release = latestDocumentedRelease(normalizeReleaseHeadings(changelogText));
  changelogVersion = release?.version ?? null;
} catch (error) {
  check('CHANGELOG.md is readable', false, error.code ?? error.message);
}
check('CHANGELOG.md has a versioned release', changelogVersion !== null);

// 2. app.json expo.version matches.
let appJsonVersion = null;
try {
  const appJson = JSON.parse(readFileSync(resolve(repoRoot, 'app.json'), 'utf8'));
  appJsonVersion = appJson.expo?.version ?? null;
} catch (error) {
  check('app.json is readable', false, error.code ?? error.message);
}
check(
  'app.json expo.version matches changelog',
  appJsonVersion === changelogVersion,
  `app.json has "${appJsonVersion}", changelog has "${changelogVersion}"`,
);

// 3. package.json version matches.
let packageJsonVersion = null;
try {
  const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
  packageJsonVersion = packageJson.version ?? null;
} catch (error) {
  check('package.json is readable', false, error.code ?? error.message);
}
check(
  'package.json version matches changelog',
  packageJsonVersion === changelogVersion,
  `package.json has "${packageJsonVersion}", changelog has "${changelogVersion}"`,
);

// 4. constants/changelogMeta.js latestVersion matches.
let metaVersion = null;
try {
  // The generated module uses ESM exports. Import the raw text and extract
  // the latestVersion value with a regex to avoid needing a dynamic import
  // (which would conflict with the verify script's own module graph).
  const metaText = readFileSync(resolve(repoRoot, 'constants/changelogMeta.js'), 'utf8');
  const match = /"latestVersion":\s*"([^"]+)"/.exec(metaText);
  metaVersion = match?.[1] ?? null;
} catch (error) {
  check('constants/changelogMeta.js is readable', false, error.code ?? error.message);
}
check(
  'changelogMeta.js latestVersion matches changelog',
  metaVersion === changelogVersion,
  `changelogMeta.js has "${metaVersion}", changelog has "${changelogVersion}"`,
);

// 5. All versions agree.
const allVersions = [changelogVersion, appJsonVersion, packageJsonVersion, metaVersion];
const unique = [...new Set(allVersions.filter(Boolean))];
check(
  'all version sources agree',
  unique.length <= 1 && unique[0] === changelogVersion,
  `found: changelog=${changelogVersion}, app.json=${appJsonVersion}, package.json=${packageJsonVersion}, changelogMeta.js=${metaVersion}`,
);

console.log(`\nverify:version ${passed}/${passed + failed} checks passed`);
process.exit(failed ? 1 : 0);
