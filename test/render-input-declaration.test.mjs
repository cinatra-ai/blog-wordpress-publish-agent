import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
describe("the confirmation's declared host display input", () => {
  it("declares destination host separately from the ID-only recipe", () => {
    const binding = manifest.cinatra.fieldRenderers.find(b => b.id === `${manifest.name}:draft-confirm`);
    expect(binding.params.renderInputs).toEqual({ siteHost: { provider: "connector-destination-host", connectorKind: "wordpress", connectorPackage: "@cinatra-ai/wordpress-mcp-connector", instanceField: "wordpressInstanceId", identityFields: ["postArtifactId", "postRepresentationRevisionId"] } });
    expect(manifest.cinatra.dependencies).toContainEqual(expect.objectContaining({ packageName: binding.params.renderInputs.siteHost.connectorPackage, kind: "connector", requirement: "required", edgeType: "runtime" }));
  });
});
