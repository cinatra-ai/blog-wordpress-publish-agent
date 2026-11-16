// THE PACK CHECK RUNS ON EVERY CHANGE (cinatra-ai/cinatra#4150): the shared
// agent pack publish gate lives in cinatra-ai/ci as a reusable workflow, and
// this pack calls it from its own caller. This file pins that caller: it runs
// on every pull request and on every push to main, it calls the shared gate
// pinned to one commit, the `ref` input checks out that same commit (so the
// gate code never comes from a moving branch), and it checks this package.
//
// The cases under "refused" change the committed caller one way each (a line
// that only looks like the call, a condition, a filter, a second job, a moving
// ref, a duplicate key) and must each be refused. The reading below still
// matches single lines of text, so it lets many of them through; the next
// commit reads the workflow's structure instead.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const CALLER = ".github/workflows/agent-publish-gate.yml";
const GATE = "cinatra-ai/ci/.github/workflows/agent-publish-gate.yml";

const callerPath = fileURLToPath(new URL(`../${CALLER}`, import.meta.url));
const text = () => readFileSync(callerPath, "utf8");

const USES_RE =
  /^\s*uses:\s*cinatra-ai\/ci\/\.github\/workflows\/agent-publish-gate\.yml@([0-9a-f]{40})(?:\s+#.*)?$/m;

// Every reason the source is not this pack's caller, by matching its lines.
function callerFaults(source) {
  const faults = [];
  if (!/^on:\s*$/m.test(source)) faults.push("no on:");
  if (!/^\s{2}pull_request:\s*$/m.test(source)) faults.push("no pull_request trigger");
  if (!/^\s{2}push:\s*\n\s{4}branches:\s*\[\s*main\s*\]\s*$/m.test(source)) faults.push("no push to main trigger");
  const uses = source.match(USES_RE);
  if (!uses) faults.push("no uses line of the shared gate at a 40-hex commit");
  const refs = [...source.matchAll(/^\s*ref:\s*["']?([^"'\s]+)["']?\s*$/gm)].map((m) => m[1]);
  if (!uses || refs.length !== 1 || refs[0] !== uses[1]) faults.push("not one ref equal to the pinned commit");
  const pkgs = [...source.matchAll(/^\s*package:\s*["']?([^"'\s]+)["']?\s*$/gm)].map((m) => m[1]);
  if (pkgs.length !== 1 || pkgs[0] !== ".") faults.push("not one package, this one");
  return faults;
}

// ---- the committed caller ---------------------------------------------------

test("the pack has a caller of the shared publish gate", () => {
  expect(existsSync(callerPath), CALLER).toBe(true);
});

test("the caller is exactly the call of the shared gate: on every pull request and every push to main, pinned, this package", () => {
  expect(callerFaults(text())).toEqual([]);
});

// ---- fixtures: the committed caller, changed one way each ---------------------

const PIN = () => {
  const m = /@([0-9a-f]{40})/.exec(text());
  if (!m) throw new Error("the committed caller pins no commit");
  return m[1];
};
// swap(from, to) changes the ONE place `from` matches; a fixture that matches
// nothing, or more than one place, is a broken fixture and fails its case.
const swap = (from, to) => (source) => {
  const hits = source.match(new RegExp(from.source, "gm")) || [];
  if (hits.length !== 1) throw new Error(`the fixture matches ${hits.length} places, not one: ${from}`);
  return source.replace(new RegExp(from.source, "m"), to);
};
const then = (...steps) => (source) => steps.reduce((value, step) => step(value), source);
const USES_LINE = /^    uses: .*$/;
const REF_LINE = /^      ref: .*\n/;
const JOBS = /^jobs:\n[\s\S]*$/;
const jobsAre = (lines) => (source) => swap(JOBS, ["jobs:", ...lines, ""].join("\n"))(source);

const KEPT = [
  ["the values quoted the other way", then(swap(/^      package: .*$/, "      package: '.'"), (s) => swap(REF_LINE, `      ref: "${PIN()}"\n`)(s))],
  ["more comments and blank lines", then(swap(/^on:$/, "# when\n\non:"), swap(/^    with:$/, "    with: # the inputs"))],
  ["another job name", swap(/^  agent-publish-gate:$/, "  gate:")],
  ["with before uses", (s) => jobsAre(["  agent-publish-gate:", "    with:", '      package: "."', `      ref: ${PIN()}`, `    uses: ${GATE}@${PIN()} # v0`])(s)],
];
for (const [name, change] of KEPT) {
  test(`kept: ${name}`, () => {
    const base = text();
    const changed = change(base);
    expect(changed !== base, "the fixture changes the caller").toBe(true);
    expect(callerFaults(changed)).toEqual([]);
  });
}

const REFUSED = [
  ["the call's lines sit in a run block of an ordinary job", (s) => jobsAre(["  agent-publish-gate:", "    runs-on: ubuntu-latest", "    steps:", "      - run: |", `          uses: ${GATE}@${PIN()}`, '          package: "."', `          ref: ${PIN()}`])(s)],
  ["the call sits at step level", (s) => jobsAre(["  agent-publish-gate:", "    runs-on: ubuntu-latest", "    steps:", `      - uses: ${GATE}@${PIN()}`, "        with:", '          package: "."', `          ref: ${PIN()}`])(s)],
  ["the job has an if", swap(USES_LINE, "    if: false\n$&")],
  ["the job needs another job", swap(USES_LINE, "    needs: other\n$&")],
  ["the job passes every secret", swap(USES_LINE, "$&\n    secrets: inherit")],
  ["the job holds a key named __proto__", swap(USES_LINE, "    __proto__: x\n$&")],
  ["a second job", (s) => `${s.replace(/\n*$/, "\n")}  other:\n    runs-on: ubuntu-latest\n`],
  ["uses written twice in the job", swap(USES_LINE, "$&\n$&")],
  ["ref written twice in with", swap(REF_LINE, "$&      ref: main\n")],
  ["ref stands under a top-level env, not in with", then(swap(REF_LINE, ""), (s) => swap(/^jobs:$/, `env:\n  ref: ${PIN()}\n\njobs:`)(s))],
  ["no ref in with (the gate would check out its default branch)", swap(REF_LINE, "")],
  ["ref is another commit than uses pins", swap(REF_LINE, `      ref: ${"0".repeat(40)}\n`)],
  ["ref is a branch", swap(REF_LINE, "      ref: main\n")],
  ["uses names a branch", (s) => swap(USES_LINE, `    uses: ${GATE}@main`)(s)],
  ["uses names a short commit", (s) => swap(USES_LINE, `    uses: ${GATE}@${PIN().slice(0, 12)}`)(s)],
  ["uses names another workflow of the shared repository", (s) => swap(USES_LINE, `    uses: cinatra-ai/ci/.github/workflows/actions-pinned-gate.yml@${PIN()}`)(s)],
  ["uses names the gate in another repository", (s) => swap(USES_LINE, `    uses: someone/ci/.github/workflows/agent-publish-gate.yml@${PIN()}`)(s)],
  ["another package", swap(/^      package: .*$/, '      package: "packages/other"')],
  ["with as an inline mapping", (s) => jobsAre(["  agent-publish-gate:", `    uses: ${GATE}@${PIN()}`, `    with: { package: ".", ref: ${PIN()} }`])(s)],
  ["with holds a third input", swap(REF_LINE, "$&      format: json\n")],
  ["pull_request with a paths filter", swap(/^  pull_request:$/, "  pull_request:\n    paths: [docs]")],
  ["pull_request with a types filter", swap(/^  pull_request:$/, "  pull_request:\n    types: [closed]")],
  ["pull_request with a block list filter", swap(/^  pull_request:$/, "  pull_request:\n    branches:\n      - release")],
  ["no pull_request trigger", swap(/^  pull_request:\n/, "")],
  ["pull_request commented out", swap(/^  pull_request:$/, "  # pull_request:")],
  ["pull_request_target instead of pull_request", swap(/^  pull_request:$/, "  pull_request_target:")],
  ["push on another branch", swap(/^    branches: .*$/, "    branches: [release]")],
  ["push with a paths filter", swap(/^    branches: .*$/, "$&\n    paths: [docs]")],
  ["push with no branches", swap(/^    branches: .*\n/, "")],
  ["no push trigger", swap(/^  push:\n    branches: .*\n/, "")],
  ["a third trigger", swap(/^  pull_request:$/, "  workflow_dispatch:\n$&")],
  ["on written twice", (s) => `${s.replace(/\n*$/, "\n")}on:\n  workflow_dispatch:\n`],
  ["the triggers in an inline list", swap(/^on:\n  pull_request:\n  push:\n    branches: .*$/, "on: [pull_request, push]")],
  ["permissions widened to write", swap(/^  contents: read$/, "  contents: write")],
  ["a second permission", swap(/^  contents: read$/, "$&\n  id-token: write")],
  ["no permissions", swap(/^permissions:\n  contents: read\n/, "")],
  ["a tab before uses", swap(USES_LINE, (line) => line.replace(/^ {4}/, "\t"))],
  ["uses indented by three spaces", swap(USES_LINE, (line) => line.replace(/^ {4}/, "   "))],
  ["with's inputs indented like the job's keys", then(swap(/^      package: /, "    package: "), swap(/^      ref: /, "    ref: "))],
  ["a value that starts with an at sign", swap(/^name: .*$/, "name: @gate")],
  ["an empty file", () => ""],
];
for (const [name, change] of REFUSED) {
  test(`refused: ${name}`, () => {
    const base = text();
    const changed = change(base);
    expect(changed !== base, "the fixture changes the caller").toBe(true);
    expect(callerFaults(changed).length > 0, name).toBe(true);
  });
}
