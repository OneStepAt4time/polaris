#!/usr/bin/env node
// Enforces the budgets defined in ADR-0006 and .claude/rules/budgets.md.
// Run via `npm run budget-check`.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const LIMITS = {
  totalLoc: 8000,
  runtimeDeps: 20,
  envVars: 12,
};

let failures = 0;

function report(ok, label, value, limit) {
  const mark = ok ? "✓" : "✗";
  const msg = `${mark} ${label}: ${value} / ${limit}`;
  if (ok) {
    console.log(msg);
  } else {
    console.error(`\x1b[31m${msg}\x1b[0m`);
    failures += 1;
  }
}

function countLoc(dir) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      total += countLoc(path);
      continue;
    }
    const isCounted = entry.name.endsWith(".ts") || entry.name.endsWith(".astro");
    if (!isCounted) continue;
    if (entry.name.endsWith(".test.ts")) continue;
    const content = readFileSync(path, "utf8");
    total += content.split("\n").length;
  }
  return total;
}

const totalLoc = countLoc("src");
report(totalLoc <= LIMITS.totalLoc, "Source LOC in src/ (excl. tests)", totalLoc, LIMITS.totalLoc);

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const depCount = Object.keys(pkg.dependencies ?? {}).length;
report(depCount <= LIMITS.runtimeDeps, "Runtime dependencies", depCount, LIMITS.runtimeDeps);

let envVars = 0;
if (existsSync("src/config.ts")) {
  const configContent = readFileSync("src/config.ts", "utf8");
  const matches = configContent.match(/env\.POLARIS_[A-Z_]+/g) ?? [];
  envVars = new Set(matches).size;
}
report(envVars <= LIMITS.envVars, "Env vars referenced in src/config.ts", envVars, LIMITS.envVars);

if (failures > 0) {
  console.error(`\n${failures} budget(s) exceeded. See ADR-0006 and .claude/rules/budgets.md.`);
  console.error("Raise a ceiling only via the ADR process — never silently.");
  process.exit(1);
}
console.log("\nAll budgets within limits.");
