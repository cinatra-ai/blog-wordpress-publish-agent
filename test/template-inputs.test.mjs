// A node that declares an input the template never reads is a lie in the flow
// document: the runtime binds the value, the model never sees it. Every input
// an ApiNode declares must appear in that node's own template body, either as a
// bare {{ name }} or through a filter such as {{ name | tojson }}.

import { test } from "node:test";
import assert from "node:assert/strict";

import { components } from "./oas-contract.test.mjs";

const REFERENCE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\||\}\})/g;

const apiNodes = () =>
  Object.entries(components).filter(
    ([, c]) => c?.component_type === "ApiNode",
  );

test("every ApiNode input is referenced in that node's template body", () => {
  const dead = [];
  for (const [id, c] of apiNodes()) {
    const body = JSON.stringify(c.data ?? {});
    const referenced = new Set(
      [...body.matchAll(REFERENCE)].map((m) => m[1]),
    );
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
