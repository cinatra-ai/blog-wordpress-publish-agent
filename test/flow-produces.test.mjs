// The flow document and the manifest must say the same thing about what this
// agent produces. This agent produces NOTHING — it returns a receipt and the
// deterministic step behind it writes the address onto an artifact somebody
// else owns — so both sides declare an empty ARRAY, never a missing key and
// never a word standing in for one.

import { test } from "node:test";
import assert from "node:assert/strict";

import { manifest, oas } from "./oas-contract.test.mjs";

test("the flow's produces mirrors the manifest's, as an array", () => {
  assert.ok(Array.isArray(manifest.cinatra.produces));
  assert.ok(Array.isArray(oas.metadata.cinatra.produces));
  assert.deepEqual(oas.metadata.cinatra.produces, manifest.cinatra.produces);
});

test("this agent declares that it produces nothing", () => {
  assert.deepEqual(manifest.cinatra.produces, []);
});
