// The border between this package and the host's design primitives.
//
// This pack draws no screen of its own: the application shows the publish
// card in front of the publishing step. The pack once drew a confirmation
// screen that took Button and the Card family from the HOST at run time,
// through the virtual module id "@cinatra-ai/design-primitives". With that
// screen gone, this suite keeps the two halves of the border that still
// apply: no byte copy of a primitive is left in the tree, and the id is
// declared NOWHERE in package.json — no package is published under it, so any
// specifier would make the install 404.
//
// Plain Node, like the package's other suites: it reads files as text.

import { existsSync, readFileSync, readdirSync } from "node:fs";

import { expect, test } from "vitest";

const root = new URL("..", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), "utf8");

test("the package holds no vendored primitive copy", () => {
  const uiDir = new URL("src/components/ui/", root);
  const files = existsSync(uiDir) ? readdirSync(uiDir) : [];
  expect(files).toEqual([]);
  // The class-name helper existed only for those two copies, so it goes with
  // them: nothing in this package imports it any more.
  expect(existsSync(new URL("src/lib/utils.ts", root))).toBe(false);
});

test("package.json declares the host id nowhere", () => {
  const pkg = JSON.parse(read("package.json"));
  const fields = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "peerDependenciesMeta",
    "optionalDependencies",
  ];
  for (const field of fields) {
    const names = Object.keys(pkg[field] ?? {});
    expect(names.filter((n) => n.includes("design-primitives"))).toEqual([]);
  }
  expect(read("package.json").includes("design-primitives")).toBe(false);
});
