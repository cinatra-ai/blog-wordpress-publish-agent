// The WordPress publisher produces no artifact and declares only what it READS
// — the post and its pictures. Before this it declared neither.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
);

test("it declares the two kinds it reads", () => {
  const names = (manifest.cinatra.dependencies || [])
    .filter((d) => d.kind === "artifact")
    .map((d) => d.packageName)
    .sort();
  assert.deepEqual(names, [
    "@cinatra-ai/blog-image-artifact",
    "@cinatra-ai/blog-post-artifact",
  ]);
});

test("it produces no artifact", () => {
  assert.ok(
    manifest.cinatra.produces == null ||
      (Array.isArray(manifest.cinatra.produces) && manifest.cinatra.produces.length === 0),
    "the WordPress publisher yields a receipt, never an artifact",
  );
});
