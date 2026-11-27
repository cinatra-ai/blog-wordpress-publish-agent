// THE CONTRACT THIS AGENT IS FOR (cinatra-ai/cinatra#3035, plan section 6.1
// step 7): "The WordPress step, converted to take the post artifact and its
// pictures, creates the site's page ... and writes the address back onto the
// post artifact's data."
//
// The pack ships no runtime of its own — an agent's product IS its manifest and
// its flow — so every case below reads those two files. Each names the sentence
// it serves.

import { expect, test } from "vitest";

import {
  artifactDependencies,
  bridgeNode,
  consumedPrimitives,
  manifest,
  node,
  oas,
  oasText,
  passthroughNodes,
  titles,
} from "./__tests__/oas-contract.mjs";

const ADDRESS_KEYS = [
  "wordpressPublishedUrl",
  "wordpressPublishedExternalId",
  "wordpressPublishedRevisionId",
];

// ---------------------------------------------------------------------------
// 1. "the revision the person continued with published FROM THE ARTIFACT"
// ---------------------------------------------------------------------------

test("the flow takes an artifact reference, not a blog record", () => {
  const inputs = titles(oas.inputs);
  expect(
    inputs.includes("postArtifactId"),
    "postArtifactId is an input",
  ).toBeTruthy();
  expect(
    inputs.includes("postRepresentationRevisionId"),
    "the revision the person continued with is an input",
  ).toBeTruthy();
  expect(
    inputs.includes("projectId"),
    "the blog project id is gone",
  ).toBeFalsy();
  expect(
    inputs.includes("postId"),
    "the blog post record id is gone",
  ).toBeFalsy();
});

test("the artifact reference is what the person is asked for", () => {
  const required = node("start").metadata.cinatra.required;
  expect(required).toEqual(
    ["postArtifactId", "postRepresentationRevisionId", "instanceId"],
  );
});

test("the words come from the revision the review APPROVED, read through the pack's declared tool", () => {
  const read = node("read_post_text");
  expect(read.data.tool, "the read runs the module this pack declares").toBe("extension_tool");
  expect(read.data.input.name).toBe("approved_post_text");
  expect(read.data.input.input.artifactId, "the artifact under review").toBe("{{ postArtifactId }}");
  expect(
    read.data.input.input.reviewDecision,
    "the revision is the one the review's answer names, never the latest and never the start input",
  ).toBe("{{ reviewDecision }}");
  expect(JSON.stringify(read.data)).not.toMatch(/postRepresentationRevisionId/);
  expect(read.metadata.cinatra.riskClass).toBe("read_only");
});

test("the read is admitted by a declared artifact dependency", () => {
  expect(
    artifactDependencies().includes("@cinatra-ai/blog-post-artifact"),
    "the type's owning package is declared, which is what admits the read",
  ).toBeTruthy();
  for (const primitive of ["artifacts_get", "artifact_content_read"]) {
    expect(
      consumedPrimitives().includes(primitive),
      `${primitive} is declared in cinatra.consumes`,
    ).toBeTruthy();
  }
});

test("the body the orchestration publishes is that read, not text of its own", () => {
  const edges = oas.data_flow_connections;
  const fed = edges.find(
    (e) =>
      e.source_node.$component_ref === "read_post_text" &&
      e.source_output === "text" &&
      e.destination_node.$component_ref === "publish",
  );
  expect(
    fed,
    "the pinned revision's text feeds the orchestration node",
  ).toBeTruthy();
  const system = bridgeNode().data.system;
  expect(system, "the recipe forbids publishing anything but the pinned bytes").toMatch(
    /You do NOT re-word, re-generate, summarise or extend `postText`/,
  );
});

// ---------------------------------------------------------------------------
// 2. "writes the address back onto the post artifact's data"
// ---------------------------------------------------------------------------

test("the address is written back onto the SAME artifact, through the host's write-back primitive", () => {
  const write = passthroughNodes().get("objects_update");
  expect(
    write,
    "a deterministic node writes through objects_update",
  ).toBeTruthy();
  expect(
    write.data.input.objectId,
    "the write lands on the artifact that was read, never a new row",
  ).toBe("{{ postArtifactId }}");
  // The patch reaches the artifact: the leaf hands objects_update the patch as
  // JSON text encoding an object, under the key `data`, when every address
  // member is non-empty, and `{}` otherwise. The hint keeps `addressPatch`
  // visible to the runtime's placeholder inference.
  expect(write.data.input.data).toBe(
    "{# pyagentspec-input-hint: {{ addressPatch }} #}{% if ('wordpressPublishedUrl' in addressPatch and addressPatch['wordpressPublishedUrl']) and ('wordpressPublishedExternalId' in addressPatch and addressPatch['wordpressPublishedExternalId']) and ('wordpressPublishedRevisionId' in addressPatch and addressPatch['wordpressPublishedRevisionId']) %}{{ addressPatch | tojson }}{% else %}{}{% endif %}",
  );
  expect(
    write.metadata.cinatra.riskClass,
    "a persisting node is never labelled read_only",
  ).not.toBe("read_only");
  expect(consumedPrimitives().includes("objects_update")).toBeTruthy();
});

test("the address never travels a side channel", () => {
  const text = oasText();
  for (const forbidden of [
    "artifact_authoring_emit",
    "blog_post_publish_wordpress_start",
    "blog_post_publish_wordpress_delete",
    "blog_post_publish_wordpress_status",
    "blog_project_get",
  ]) {
    expect(
      text.includes(forbidden),
      `${forbidden} is gone from the flow — the publish is not keyed by a blog record and mints no artifact`,
    ).toBeFalsy();
    expect(
      consumedPrimitives().includes(forbidden),
      `${forbidden} is gone from cinatra.consumes`,
    ).toBeFalsy();
  }
});

test("the patch carries exactly the three address keys", () => {
  const system = bridgeNode().data.system;
  for (const key of ADDRESS_KEYS) {
    expect(system.includes(`"${key}"`), `the recipe names ${key}`).toBeTruthy();
  }
  const patchOutput = bridgeNode().outputs.find((o) => o.title === "addressPatch");
  expect(patchOutput, "the orchestration emits the patch").toBeTruthy();
  expect(patchOutput.type).toBe("object");
});

test("the patch's three members are declared, not left to an empty object level", () => {
  const patchOutput = bridgeNode().outputs.find((o) => o.title === "addressPatch");
  expect(
    patchOutput.type,
    "the plain type stays readable — an output without one makes the step derive nothing at all",
  ).toBe("object");
  const schema = patchOutput.json_schema;
  expect(
    schema,
    "an object output that declares no members is asked for as a closed, empty object, so the address never reaches the artifact",
  ).toBeTruthy();
  expect(schema.type).toBe("object");
  expect(
    Object.keys(schema.properties ?? {}),
    "the declared members are exactly the three address keys the recipe names",
  ).toEqual(ADDRESS_KEYS);
  for (const key of ADDRESS_KEYS) {
    expect(
      schema.properties[key].type,
      `${key} is a string the site returned`,
    ).toBe("string");
    expect(
      (schema.properties[key].description ?? "").length > 0,
      `${key} says in words what it carries`,
    ).toBeTruthy();
  }
  expect(
    schema.required,
    "every declared member is required — the contract derived from this declaration carries no optional key",
  ).toEqual(ADDRESS_KEYS);
});

test("nothing published means nothing written", () => {
  expect(
    bridgeNode().data.system,
    "the recipe states the empty patch, so no empty address is ever merged",
  ).toMatch(/The empty patch is the same three keys, each the empty string/);
});

// ---------------------------------------------------------------------------
// 3. "the declared inputs/outputs updated so the pipeline's end node can bind"
// ---------------------------------------------------------------------------

test("the end node hands the pipeline the address it published", () => {
  const outputs = titles(oas.outputs);
  for (const t of [
    "postArtifactId",
    "postRepresentationRevisionId",
    "publishedUrl",
    "publishedExternalId",
    "approved",
    "addressWritten",
    "summary",
  ]) {
    expect(outputs.includes(t), `${t} is a declared output`).toBeTruthy();
  }
  expect(titles(node("end").outputs)).toEqual(outputs);
  expect(
    outputs.includes("wordpressAdminUrl"),
    "the admin address of a draft is not the published address",
  ).toBeFalsy();
});

test("the site write goes through the declared connector", () => {
  for (const primitive of ["wordpress_site_tools_list", "wordpress_site_tool_write"]) {
    expect(
      consumedPrimitives().includes(primitive),
      `${primitive} is declared`,
    ).toBeTruthy();
    expect(
      bridgeNode().data.system.includes(primitive),
      `${primitive} is in the recipe`,
    ).toBeTruthy();
  }
  const declared = (manifest.cinatra.dependencies ?? []).map((d) => d.packageName);
  expect(declared.includes("@cinatra-ai/wordpress-mcp-connector")).toBeTruthy();
});

// ---------------------------------------------------------------------------
// The flow's own integrity — a typo in a reference is a broken agent.
// ---------------------------------------------------------------------------

test("every node input is fed and every edge resolves", () => {
  const comps = oas.$referenced_components;
  const fed = new Set(
    oas.data_flow_connections.map(
      (e) => `${e.destination_node.$component_ref}.${e.destination_input}`,
    ),
  );
  for (const e of oas.data_flow_connections) {
    const src = comps[e.source_node.$component_ref];
    const dst = comps[e.destination_node.$component_ref];
    expect(
      src,
      `edge source ${e.source_node.$component_ref} exists`,
    ).toBeTruthy();
    expect(
      dst,
      `edge destination ${e.destination_node.$component_ref} exists`,
    ).toBeTruthy();
    const srcNames = titles(src.outputs ?? src.inputs);
    expect(
      srcNames.includes(e.source_output),
      `${e.name}: ${e.source_node.$component_ref} emits ${e.source_output}`,
    ).toBeTruthy();
    expect(
      titles(dst.inputs ?? dst.outputs).includes(e.destination_input),
      `${e.name}: ${e.destination_node.$component_ref} takes ${e.destination_input}`,
    ).toBeTruthy();
  }
  for (const [id, c] of Object.entries(comps)) {
    if (id === "start") continue;
    for (const input of titles(c.inputs)) {
      expect(
        fed.has(`${id}.${input}`),
        `${id}.${input} has an inbound edge`,
      ).toBeTruthy();
    }
  }
});

// ---------------------------------------------------------------------------
// 7. The convergence round: what the pinned revision means at the edges
// ---------------------------------------------------------------------------

const dataEdge = (s, so, dn, di) =>
  (oas.data_flow_connections ?? []).find(
    (c) =>
      c.source_node?.$component_ref === s &&
      c.source_output === so &&
      c.destination_node?.$component_ref === dn &&
      c.destination_input === di,
  );
const edgeInto = (dn, di) =>
  (oas.data_flow_connections ?? []).find(
    (c) => c.destination_node?.$component_ref === dn && c.destination_input === di,
  );

test("a cut-short read is never published as the pinned revision", () => {
  const read = node("read_post_text");
  expect(
    titles(read.outputs).includes("truncated"),
    "the host's read reports truncation",
  ).toBeTruthy();
  expect(
    titles(bridgeNode().inputs).includes("truncated"),
    "the orchestration step is told about it",
  ).toBeTruthy();
  expect(
    dataEdge("read_post_text", "truncated", "publish", "truncated"),
    "and it is actually wired, not merely declared",
  ).toBeTruthy();
  const recipe = bridgeNode().data.system;
  expect(recipe).toMatch(/When `truncated` is true/);
  expect(recipe).toMatch(/Never publish a cut-short body/);
});

// The review pins one revision and the publish card shows what goes out
// (publishRows). The draft writer files the post's title as the artifact's own
// title and starts the body at its first `## ` section, so the pinned words
// carry no title heading: a title taken from their first heading would be a
// section heading, and a rule that wants a heading would publish nothing. So
// the read step answers the title as plain text (the record's own title, else
// a leading `# ` heading, never a `## ` one), the card shows it in its own row,
// and the publishing step takes it from there and from nowhere else.
test("the page's title is the title the read step answers, shown in its own row of the publish card", () => {
  const publish = bridgeNode();
  const recipe = publish.data.system;
  const cardInputs = (publish.metadata.cinatra.publishRows ?? []).map((r) => r.input);

  // One source for the title, and it is a row of the card.
  expect(recipe).toMatch(/The page's title is `postTitle`, exactly as given/);
  expect(recipe).toMatch(/never take one from a section heading of `postText`/);
  expect(recipe).not.toMatch(/first heading/);
  expect(cardInputs, "the card shows the title").toContain("postTitle");
  expect(cardInputs, "the card shows the words").toContain("postText");
  expect(
    dataEdge("read_post_text", "title", "publish", "postTitle"),
    "the shown title is the read step's answer, the same value the step sends",
  ).toBeTruthy();
  expect(
    dataEdge("read_post_text", "text", "publish", "postText"),
    "the shown words are the pinned read",
  ).toBeTruthy();
  expect(cardInputs, "the card shows the HTML").toContain("postHtml");
  expect(
    dataEdge("write_post_html", "postHtml", "publish", "postHtml"),
    "the shown HTML is the HTML step's answer, the same value the step sends",
  ).toBeTruthy();

  // An empty title publishes nothing.
  expect(recipe).toMatch(/When `postTitle` is empty[^]*?Publish nothing/);

  // The step is given no record of the artifact: only the title the card shows.
  expect(recipe).not.toMatch(/postArtifact\b(?!Id)/);
  expect(publish.data.user).not.toMatch(/postArtifact\b(?!Id)/);
  expect(titles(publish.inputs).sort()).toEqual(
    ["instanceId", "postArtifactId", "postHtml", "postRepresentationRevisionId", "postText", "postTitle", "truncated"].sort(),
  );
  const contentInputs = titles(publish.inputs).filter(
    (t) => !["instanceId", "postArtifactId", "postRepresentationRevisionId", "truncated"].includes(t),
  );
  expect(contentInputs, "every input the page is made of is a row of the card").toEqual(
    contentInputs.filter((t) => cardInputs.includes(t)),
  );
});

test("the record read in front of the review reaches only the read step, never the publishing step; after the review the flow reads nothing but the words (red: a record feeding the publish, or a record read behind the review)", () => {
  const refOf = (r) => r?.$component_ref;
  const edges = (oas.control_flow_connections ?? []).map((e) => [refOf(e.from_node), refOf(e.to_node)]);
  const reachFrom = (first) => {
    const seen = new Set();
    const queue = [first];
    while (queue.length > 0) {
      const id = queue.shift();
      for (const [from, to] of edges) if (from === id && !seen.has(to)) (seen.add(to), queue.push(to));
    }
    return seen;
  };
  const after = reachFrom("review_post");
  expect(after.has("publish"), "the publish step follows the review").toBe(true);
  // Every artifacts_get of the flow is in front of the review: none is behind it.
  expect([...after].filter((id) => node(id)?.data?.tool === "artifacts_get"), "no record read behind the review").toEqual([]);
  expect(reachFrom("start").has("read_post_record")).toBe(true);
  expect(after.has("read_post_record"), "the record read is not behind the review").toBe(false);
  const fromRecord = (oas.data_flow_connections ?? [])
    .filter((e) => refOf(e.source_node) === "read_post_record")
    .map((e) => `${refOf(e.destination_node)}.${e.destination_input}`);
  expect(fromRecord).toEqual(["read_post_text.postRecord"]);
  const intoPublish = (oas.data_flow_connections ?? [])
    .filter((e) => refOf(e.destination_node) === "publish")
    .map((e) => refOf(e.source_node));
  for (const src of intoPublish) expect(["start", "read_post_text", "write_post_html"], src).toContain(src);
});

test("the page is published publicly — a draft has no address to write back", () => {
  const recipe = bridgeNode().data.system;
  expect(recipe).toMatch(
    /can make it PUBLICLY\nVISIBLE|can make it PUBLICLY VISIBLE/,
  );
  expect(recipe).toMatch(
    /An ability whose only outcome is a draft does NOT satisfy this step/,
  );
  expect(recipe).toMatch(
    /Only a page the site reports as publicly\npublished carries an address worth writing back\.|Only a page the site reports as publicly published carries an address worth writing back\./,
  );
});

test("the run reports the address as written only when a patch was built", () => {
  expect(
    titles(bridgeNode().outputs).includes("addressWritten"),
    "the orchestration step says whether it built a patch",
  ).toBeTruthy();
  const e = edgeInto("end", "addressWritten");
  expect(e, "the end node's addressWritten is fed").toBeTruthy();
  expect(
    e.source_node.$component_ref,
    "from the step that knows whether there was an address — the write node's ok is true for an empty patch too",
  ).toBe("publish");
  expect(e.source_output).toBe("addressWritten");
});

test("the patch's key space is declared closed, not only described", () => {
  const write = passthroughNodes().get("objects_update");
  expect(
    write.metadata.cinatra.addressPatchKeys,
    "the allowlist is a declaration the next leg can read",
  ).toEqual(ADDRESS_KEYS);
  const recipe = bridgeNode().data.system;
  expect(recipe).toMatch(/The patch's key space is CLOSED/);
  expect(recipe, "an invented key would land on the artifact's own data").toMatch(
    /never a field of the artifact itself/,
  );
});

test("the write-back leaf hands the patch over as JSON text of exactly the three declared members", () => {
  const write = passthroughNodes().get("objects_update");
  // A template comment renders to nothing, so what the leaf renders is the rest.
  const rest = write.data.input.data
    .replace(/\{#[\s\S]*?#\}/g, "")
    .replace(/^\{% if [^%]* %\}(\{\{ addressPatch \| tojson \}\})\{% else %\}\{\}\{% endif %\}$/, "$1");
  expect(rest).toBe("{{ addressPatch | tojson }}");
  const full =
    '{"wordpressPublishedExternalId": "42", "wordpressPublishedRevisionId": "rev-1", "wordpressPublishedUrl": "https://blog.example.com/hello-world/"}';
  const parsed = JSON.parse(rest.replace("{{ addressPatch | tojson }}", full));
  expect(parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)).toBe(true);
  expect(Object.keys(parsed).sort()).toEqual([...ADDRESS_KEYS].sort());
  expect(Object.keys(parsed).sort()).toEqual(
    [...write.metadata.cinatra.addressPatchKeys].sort(),
  );
  expect(JSON.parse(rest.replace("{{ addressPatch | tojson }}", "{}"))).toEqual({});
});
