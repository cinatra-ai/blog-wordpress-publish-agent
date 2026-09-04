// Shared readers for this package's declarations. The pack ships no runtime of
// its own — an agent's product IS its manifest and its flow — so the suites
// read those two files and assert the contract the pipeline binds against.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);

export const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("package.json", root)), "utf8"),
);
export const oas = JSON.parse(
  readFileSync(fileURLToPath(new URL("cinatra/oas.json", root)), "utf8"),
);
export const source = (rel) =>
  readFileSync(fileURLToPath(new URL(rel, root)), "utf8");

export const components = oas.$referenced_components ?? {};
export const node = (id) => components[id];
export const titles = (list) => (list ?? []).map((e) => e.title);

/** Every deterministic passthrough node, keyed by the tool it invokes. */
export function passthroughNodes() {
  const out = new Map();
  for (const [id, c] of Object.entries(components)) {
    if (c?.component_type !== "ApiNode") continue;
    if (!String(c.url ?? "").includes("/api/agents/passthrough")) continue;
    const tool = c?.data?.tool;
    if (typeof tool === "string") out.set(tool, { id, ...c });
  }
  return out;
}

/** The single LLM-bridge orchestration node. */
export function bridgeNode() {
  for (const [id, c] of Object.entries(components)) {
    if (c?.component_type !== "ApiNode") continue;
    if (String(c.url ?? "").includes("/api/llm-bridge")) return { id, ...c };
  }
  return null;
}

export const consumedPrimitives = () =>
  (manifest.cinatra?.consumes ?? []).map((c) => c.primitive);

export const artifactDependencies = () =>
  (manifest.cinatra?.dependencies ?? [])
    .filter((d) => d.kind === "artifact")
    .map((d) => d.packageName);

/** The whole flow as one string — for "this name appears nowhere" assertions. */
export const oasText = () => JSON.stringify(oas);
