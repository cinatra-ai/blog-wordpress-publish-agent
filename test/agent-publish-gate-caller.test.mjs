// THE PACK CHECK RUNS ON EVERY CHANGE (cinatra-ai/cinatra#4150): the shared
// agent pack publish gate lives in cinatra-ai/ci as a reusable workflow, and
// this pack calls it from its own caller. This file pins that caller: it runs
// on every pull request and on every push to main, it calls the shared gate
// pinned to one commit, the `ref` input checks out that same commit (so the
// gate code never comes from a moving branch), and it checks this package.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const CALLER = ".github/workflows/agent-publish-gate.yml";
const USES_RE =
  /^\s*uses:\s*cinatra-ai\/ci\/\.github\/workflows\/agent-publish-gate\.yml@([0-9a-f]{40})(?:\s+#.*)?$/m;

const callerPath = fileURLToPath(new URL(`../${CALLER}`, import.meta.url));
const text = () => readFileSync(callerPath, "utf8");

test("the pack has a caller of the shared publish gate", () => {
  expect(existsSync(callerPath), CALLER).toBe(true);
});

test("the caller runs on every pull request and on every push to main", () => {
  const t = text();
  expect(t).toMatch(/^on:\s*$/m);
  expect(t).toMatch(/^\s{2}pull_request:\s*$/m);
  expect(t).toMatch(/^\s{2}push:\s*\n\s{4}branches:\s*\[\s*main\s*\]\s*$/m);
});

test("the caller pins the shared gate and checks out the same commit", () => {
  const t = text();
  const uses = t.match(USES_RE);
  expect(uses, "uses: cinatra-ai/ci/.github/workflows/agent-publish-gate.yml@<40 hex>").not.toBeNull();
  const refs = [...t.matchAll(/^\s*ref:\s*["']?([^"'\s]+)["']?\s*$/gm)].map((m) => m[1]);
  expect(refs, "one ref input, the pinned commit").toEqual([uses[1]]);
});

test("the caller checks this package", () => {
  const pkgs = [...text().matchAll(/^\s*package:\s*["']?([^"'\s]+)["']?\s*$/gm)].map((m) => m[1]);
  expect(pkgs).toEqual(["."]);
});
