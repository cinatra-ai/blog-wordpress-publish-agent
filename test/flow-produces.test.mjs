// The flow document and the manifest must say the same thing about what this
// agent produces. This agent produces NOTHING — it returns a receipt and the
// deterministic step behind it writes the address onto an artifact somebody
// else owns — so both sides declare an empty ARRAY, never a missing key and
// never a word standing in for one.

import { expect, test } from "vitest";

import { manifest, oas } from "./__tests__/oas-contract.mjs";

test("the flow's produces mirrors the manifest's, as an array", () => {
  expect(Array.isArray(manifest.cinatra.produces)).toBeTruthy();
  expect(Array.isArray(oas.metadata.cinatra.produces)).toBeTruthy();
  expect(oas.metadata.cinatra.produces).toEqual(manifest.cinatra.produces);
});

test("this agent declares that it produces nothing", () => {
  expect(manifest.cinatra.produces).toEqual([]);
});
