#!/usr/bin/env node
/**
 * scripts/verify-test-paths.mjs
 *
 * Verifies that:
 *   1. Every test file path referenced in docs/lab-04/tests.md exists on disk.
 *   2. Every Acceptance Criterion (AC-01..AC-N) defined in docs/lab-04/specification.md
 *      appears in docs/lab-04/tests.md §6 Traceability Matrix with at least one test ID.
 *   3. Every test ID referenced in §6 Traceability Matrix is defined in §§1–5 of tests.md.
 */

import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const testsMdPath = path.join(rootDir, "docs/lab-04/tests.md");
const specMdPath = path.join(rootDir, "docs/lab-04/specification.md");

const testsMd = fs.readFileSync(testsMdPath, "utf8");
const specMd = fs.readFileSync(specMdPath, "utf8");

let failed = false;

// 1. Extract all backticked file paths in docs/lab-04/tests.md matching test files
const pathRegex = /`((?:server|client|e2e)\/[^`\s*]+\.(?:test|spec)\.[jt]sx?)`/g;
const foundPaths = new Set();
for (const match of testsMd.matchAll(pathRegex)) {
  foundPaths.add(match[1]);
}

// Check for any unresolved placeholder paths like `client/...`
const placeholderRegex = /`((?:server|client|e2e)\/\.\.\.[^`]*)`/g;
for (const match of testsMd.matchAll(placeholderRegex)) {
  console.error(`✘ Placeholder path still present in docs/lab-04/tests.md: ${match[1]}`);
  failed = true;
}

for (const relPath of [...foundPaths].sort()) {
  const fullPath = path.join(rootDir, relPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`✘ Missing test file referenced in docs/lab-04/tests.md: ${relPath}`);
    failed = true;
  } else {
    console.log(`✔ Found test file: ${relPath}`);
  }
}

// 2. Extract all AC-XX defined in docs/lab-04/specification.md §9
const specAcRegex = /^\|\s*(?:\*\*)?(AC-\d+)(?:\*\*)?\s*\|/gm;
const specAcs = new Set();
for (const match of specMd.matchAll(specAcRegex)) {
  specAcs.add(match[1]);
}

// Extract traceability section (§6) from docs/lab-04/tests.md
const section6Index = testsMd.indexOf("## 6. Traceability Matrix");
const beforeSection6 = section6Index >= 0 ? testsMd.slice(0, section6Index) : testsMd;
const section6 = section6Index >= 0 ? testsMd.slice(section6Index) : "";

// All test IDs defined in §§1–5 tables: | ID | or | `ID` |
const idPattern = "(?:API|UNIT|WORKFLOW|AUTH|UI|RESP|MIGRATION|REGRESSION|PERF|E2E)-\\d+[a-z]*";
const definedIdRegex = new RegExp(`^\\|\\s*\`?(${idPattern})\`?\\s*\\|`, "gm");
const definedTestIds = new Set();
for (const match of beforeSection6.matchAll(definedIdRegex)) {
  definedTestIds.add(match[1]);
}

// All AC rows in §6 Traceability Matrix
const matrixAcRegex = /^\|\s*(AC-\d+)\s*\|\s*([^|]+)\|/gm;
const matrixAcs = new Map();
const cellIdRegex = new RegExp(`\\b(${idPattern})\\b`, "g");
for (const match of section6.matchAll(matrixAcRegex)) {
  const ac = match[1];
  const ids = [...match[2].matchAll(cellIdRegex)].map((m) => m[1]);
  matrixAcs.set(ac, ids);
}

for (const ac of [...specAcs].sort()) {
  if (!matrixAcs.has(ac)) {
    console.error(`✘ ${ac} from specification.md is missing in tests.md §6 Traceability Matrix`);
    failed = true;
    continue;
  }
  const ids = matrixAcs.get(ac);
  if (!ids || ids.length === 0) {
    console.error(`✘ ${ac} in tests.md §6 has no linked test IDs`);
    failed = true;
    continue;
  }
  for (const id of ids) {
    if (!definedTestIds.has(id)) {
      console.error(`✘ ${ac} references undefined test ID ${id} in tests.md §6`);
      failed = true;
    }
  }
}

console.log(
  `✔ Checked ${foundPaths.size} unique test file paths, ${specAcs.size} Acceptance Criteria, and ${definedTestIds.size} defined test IDs.`,
);

if (failed) {
  process.exit(1);
}
