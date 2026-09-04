// A node that declares an input the template never reads is a lie in the flow
// document: the runtime binds the value, the model never sees it. Every input
// an ApiNode declares must appear in that node's own templated request body,
// either as a bare {{ name }} or through a filter such as {{ name | tojson }}.
//
// The walk is deliberately narrow on both sides. It reads ONLY the string
// leaves of a node's `data` — the payload the runtime templates — so a name
// that appears merely in a node's prose metadata, or as an object KEY, does
// not count as a reference. And it matches only a COMPLETE expression, closing
// braces included, so a half-written `{{ name |` cannot pass for a use.

import { test } from "node:test";
import assert from "node:assert/strict";

import { components } from "./oas-contract.test.mjs";

const REFERENCE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\|[^{}]*?)?\}\}/g;

/** Every string leaf of a templated payload, keys excluded. */
export function templateStrings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(templateStrings);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(templateStrings);
  }
  return [];
}

/** The names a templated payload actually reads. */
export function referencedNames(data) {
  const names = new Set();
  for (const s of templateStrings(data)) {
    for (const m of s.matchAll(REFERENCE)) names.add(m[1]);
  }
  return names;
}

const apiNodes = () =>
  Object.entries(components).filter(
    ([, c]) => c?.component_type === "ApiNode",
  );

test("every ApiNode input is referenced in that node's template body", () => {
  const dead = [];
  for (const [id, c] of apiNodes()) {
    const referenced = referencedNames(c.data ?? {});
    for (const input of c.inputs ?? []) {
      if (!referenced.has(input.title)) dead.push(`${id}.${input.title}`);
    }
  }
  assert.deepEqual(dead, []);
});

test("the flow has ApiNodes with inputs to check at all", () => {
  const withInputs = apiNodes().filter(([, c]) => (c.inputs ?? []).length > 0);
  assert.ok(withInputs.length >= 4);
});

test("a complete expression counts as a reference, bare or filtered", () => {
  assert.deepEqual([...referencedNames({ user: "x {{ truncated }} y" })], [
    "truncated",
  ]);
  assert.deepEqual(
    [...referencedNames({ user: "x {{ truncated | tojson }} y" })],
    ["truncated"],
  );
  assert.deepEqual([...referencedNames({ user: "{{postText}}" })], [
    "postText",
  ]);
});

test("a half-written expression is not a reference", () => {
  assert.deepEqual([...referencedNames({ user: "x {{ truncated | y" })], []);
  assert.deepEqual([...referencedNames({ user: "x {{ truncated y" })], []);
});

test("a name outside the templated payload is not a reference", () => {
  // Only the payload's string leaves are read: not an object key, and not the
  // prose a node carries beside its payload.
  assert.deepEqual([...referencedNames({ "{{ truncated }}": "x" })], []);
  const node = {
    data: { input: { objectId: "{{ postArtifactId }}" } },
    metadata: { cinatra: { description: "reads {{ truncated }} first" } },
  };
  assert.deepEqual([...referencedNames(node.data)], ["postArtifactId"]);
});
