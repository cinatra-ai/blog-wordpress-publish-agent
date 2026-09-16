// The border between this package and the host's design primitives.
//
// The confirmation screen this pack renders takes Button and the Card family
// from the HOST at run time, through the virtual module id
// "@cinatra-ai/design-primitives" (contract major 1). A package that holds no
// byte copy of a primitive can never drift from the product's own source, so
// this suite guards the three halves of that border: no copy is left in the
// tree, the renderer names the bare id and nothing relative, and the id is
// declared NOWHERE in package.json — no package is published under it, so any
// specifier would make the install 404.
//
// Plain Node, like the package's other suites: it reads files as text.

import { existsSync, readFileSync, readdirSync } from "node:fs";

import { expect, test } from "vitest";

const root = new URL("..", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), "utf8");

const HOST_ID = "@cinatra-ai/design-primitives";
const PRIMITIVE_NAMES = [
  "Button",
  "Card",
  "CardContent",
  "CardFooter",
  "CardHeader",
  "CardTitle",
];

// Every VALUE import of the shape `import { a, b } from "spec"`, read as a
// specifier and its list of bindings. Parsing the statement — rather than
// searching the line for substrings — is what makes the assertions below
// exact: "Card" is a substring of "CardContent", and the bare id is a prefix
// of every near miss of it.
function namedImports(source) {
  const statements = source.matchAll(
    /(?:^|\n)\s*import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g
  );
  return [...statements].map((m) => ({
    spec: m[2],
    names: m[1]
      .split(",")
      .map((part) => part.trim().split(/\s+as\s+/)[0].trim())
      .filter(Boolean),
  }));
}

test("the package holds no vendored primitive copy", () => {
  const uiDir = new URL("src/components/ui/", root);
  const files = existsSync(uiDir) ? readdirSync(uiDir) : [];
  expect(files).toEqual([]);
  // The class-name helper existed only for those two copies, so it goes with
  // them: nothing in this package imports it any more.
  expect(existsSync(new URL("src/lib/utils.ts", root))).toBe(false);
});

test("the renderer takes the six names from the bare host id", () => {
  const source = read("src/renderers/draft-confirm.tsx");
  expect(source).not.toContain("components/ui");

  const imports = namedImports(source);

  // ONE import, whose specifier is the bare id EXACTLY.
  const fromHost = imports.filter((entry) => entry.spec === HOST_ID);
  expect(fromHost).toHaveLength(1);

  // Exactly the six names, each as its own binding: no name missing and none
  // added beyond the contract's frozen export list for major 1.
  expect([...fromHost[0].names].sort()).toEqual([...PRIMITIVE_NAMES].sort());

  // No near miss of the id — neither a sub-path nor a longer id that merely
  // starts with it — is imported anywhere in the file; the host's externals
  // check refuses those.
  const nearMisses = imports
    .map((entry) => entry.spec)
    .filter((spec) => spec !== HOST_ID && spec.startsWith(HOST_ID));
  expect(nearMisses).toEqual([]);
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
