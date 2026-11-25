// THE RUN PUBLISHES THE REVISION THE REVIEW APPROVED (cinatra-ai/cinatra#3471,
// #3650).
//
// The run parks on the host's review of the post. The person can approve the
// revision the run started with, or choose Regenerate and approve the successor
// revision. The host resumes the review step with its answer, JSON text that
// names the approved target (cinatra-ai/cinatra,
// src/lib/artifacts/artifact-review-rejection.ts, buildReviewApproveEnvelope).
// The read of the words, the publish card's "Post text" row and the publishing
// step must take that target, never the revision the run started with. An
// answer that names no approved revision stops the run before the read, so no
// card opens and nothing reaches the site.
//
// The cases run the flow as the runtime wires it: they follow cinatra/oas.json's
// control and data edges from the start, fill each `{{ name }}` slot of a
// step's call data from its inputs, give the review step the answer, run the
// read step's call (the module this pack declares, through fake host ports, or
// the host's content read on a fake store), and stop in front of the publishing
// step, where the application shows its card. The model step is not run: what
// it is given is what the card shows and what it publishes.

import { expect, test } from "vitest";

import { manifest, node, oas } from "./__tests__/oas-contract.mjs";

const START = "start";
const REVIEW = "review_post";
const READ = "read_post_text";
const PUBLISH = "publish";
const WRITE = "write_address";

const ARTIFACT = "art-post-1";
const ORIGINAL = "rev-original";
const SUCCESSOR = "rev-successor";
const WORDS = {
  [ORIGINAL]: "# The original post\n\nThe words the run started with.",
  [SUCCESSOR]: "# The regenerated post\n\nThe words a person approved after Regenerate.",
};

const refOf = (r) => r?.$component_ref;

/** The review's answer for an approval of `targets`, as the host builds it. */
const approval = (targets, comment = null) =>
  JSON.stringify({
    approved: true,
    review: { envelopeVersion: 1, decision: "approved", reviewTaskId: "wayflow-task-1", comment, targets },
  });

/** A legacy rejection: no `approved` key, decision "rejected". */
const rejection = (targets) =>
  JSON.stringify({
    review: { envelopeVersion: 1, decision: "rejected", reviewTaskId: "wayflow-task-1", comment: null, targets },
  });

/** Fills every `{{ name }}` slot of the strings in `value` from `inputs`. */
function fill(value, inputs) {
  if (typeof value === "string") {
    return value.replace(/\{#[\s\S]*?#\}/g, "").replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_, name) => {
      if (!Object.hasOwn(inputs, name)) throw new Error(`the slot ${name} has no input`);
      return String(inputs[name]);
    });
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, inputs));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, inputs)]));
  }
  return value;
}

/** The module this pack declares for `name`. */
async function declaredTool(name) {
  const entry = (manifest.cinatra?.tools ?? []).find((t) => t.name === name);
  if (!entry) throw new Error(`the pack declares no tool ${name}`);
  const mod = await import(new URL(`../${entry.module.replace(/^\.\//, "")}`, import.meta.url).href);
  return mod.extensionTool;
}

/**
 * Runs the flow from the start to the step in front of the publishing step.
 * Returns the content reads the run made, the inputs the publishing step is
 * given (what the card shows and what goes out), the write step's artifact, or
 * the refusal that stopped the run.
 */
async function runToThePublishCard({ reviewDecision }) {
  const reads = [];
  const contentRead = async ({ artifactId, representationRevisionId }) => {
    reads.push({ artifactId, representationRevisionId });
    if (artifactId !== ARTIFACT || !Object.hasOwn(WORDS, representationRevisionId)) {
      throw new Error("the revision does not resolve");
    }
    return { artifactId, representationRevisionId, mime: "text/markdown", text: WORDS[representationRevisionId], truncated: false };
  };

  const outputs = {
    [START]: { postArtifactId: ARTIFACT, postRepresentationRevisionId: ORIGINAL, instanceId: "site-1", cinatra_run_id: "run-1" },
  };
  const inputsOf = (id) => {
    const into = {};
    for (const e of oas.data_flow_connections) {
      if (refOf(e.destination_node) !== id) continue;
      const from = outputs[refOf(e.source_node)];
      if (from && Object.hasOwn(from, e.source_output)) into[e.destination_input] = from[e.source_output];
    }
    return into;
  };

  let id = refOf(oas.start_node);
  const visited = new Set();
  while (true) {
    const next = oas.control_flow_connections.filter((e) => refOf(e.from_node) === id).map((e) => refOf(e.to_node));
    expect(next.length, `one way out of ${id}`).toBe(1);
    id = next[0];
    if (visited.has(id)) throw new Error(`the run loops at ${id}`);
    visited.add(id);
    const step = node(id);
    const inputs = inputsOf(id);
    if (id === PUBLISH) {
      const card = Object.fromEntries((step.metadata.cinatra.publishRows ?? []).map((r) => [r.label, inputs[r.input]]));
      return { reads, publishInputs: inputs, card, refusal: null };
    }
    if (step.component_type === "InputMessageNode") {
      outputs[id] = { [step.outputs[0].title]: reviewDecision };
      continue;
    }
    const data = fill(step.data, inputs);
    if (data.tool === "artifacts_get") {
      outputs[id] = { ...data.input };
    } else if (data.tool === "artifact_content_read") {
      outputs[id] = await contentRead(data.input);
    } else if (data.tool === "extension_tool") {
      const run = await declaredTool(data.input.name);
      try {
        outputs[id] = await run({ input: data.input.input, ports: { artifacts: { contentRead } } });
      } catch (e) {
        if (e?.name !== "ExtensionToolCallRefusal") throw e;
        return { reads, publishInputs: null, card: null, refusal: e.message };
      }
    } else {
      throw new Error(`the run reached ${id} before the publishing step`);
    }
  }
}

/** The artifact the write step after the publishing step writes the address onto. */
function writeTargetSource() {
  return oas.data_flow_connections
    .filter((e) => refOf(e.destination_node) === WRITE && e.destination_input === "postArtifactId")
    .map((e) => `${refOf(e.source_node)}.${e.source_output}`);
}

test("after Regenerate and an approval of the successor, the read, the card's Post text row and the publish are the successor's (red: any of them from the revision the run started with)", async () => {
  const run = await runToThePublishCard({
    reviewDecision: approval([{ artifactId: ARTIFACT, representationRevisionId: SUCCESSOR }]),
  });
  expect(run.refusal).toBeNull();
  expect(run.reads).toEqual([{ artifactId: ARTIFACT, representationRevisionId: SUCCESSOR }]);
  expect(run.card["Post text"]).toBe(WORDS[SUCCESSOR]);
  expect(run.publishInputs.postText).toBe(WORDS[SUCCESSOR]);
  expect(run.publishInputs.postArtifactId).toBe(ARTIFACT);
  expect(run.publishInputs.postRepresentationRevisionId, "the address patch names the revision that went out").toBe(
    SUCCESSOR,
  );
  expect(run.publishInputs.truncated).toBe(false);
});

test("an approval of the revision the run started with publishes that revision, taken from the review's answer (red: the read fed from the start inputs)", async () => {
  const run = await runToThePublishCard({
    reviewDecision: approval([{ artifactId: ARTIFACT, representationRevisionId: ORIGINAL }], "Looks good."),
  });
  expect(run.refusal).toBeNull();
  expect(run.reads).toEqual([{ artifactId: ARTIFACT, representationRevisionId: ORIGINAL }]);
  expect(run.card["Post text"]).toBe(WORDS[ORIGINAL]);
  expect(run.publishInputs.postText).toBe(WORDS[ORIGINAL]);
  expect(run.publishInputs.postRepresentationRevisionId).toBe(ORIGINAL);

  const intoRead = oas.data_flow_connections
    .filter((e) => refOf(e.destination_node) === READ)
    .map((e) => `${refOf(e.source_node)}.${e.source_output}`);
  expect(intoRead, "the read takes the review's answer").toContain(`${REVIEW}.${node(REVIEW).outputs[0].title}`);
  expect(intoRead, "and never the revision the run started with").not.toContain(`${START}.postRepresentationRevisionId`);
});

const NO_APPROVED_REVISION = [
  ["a legacy rejection", rejection([{ artifactId: ARTIFACT, representationRevisionId: SUCCESSOR }])],
  ["an empty answer", ""],
  ["an answer that is not JSON", "[Approved by operator]"],
  ["an answer that is not an object", JSON.stringify([{ artifactId: ARTIFACT, representationRevisionId: SUCCESSOR }])],
  [
    "an approval marker without the approved decision",
    JSON.stringify({ approved: true, review: { envelopeVersion: 1, decision: "rejected", targets: [] } }),
  ],
  [
    "an approval of another envelope version",
    JSON.stringify({
      approved: true,
      review: { envelopeVersion: 2, decision: "approved", targets: [{ artifactId: ARTIFACT, representationRevisionId: SUCCESSOR }] },
    }),
  ],
  ["an approval with no target", approval([])],
  [
    "an approval with two targets",
    approval([
      { artifactId: ARTIFACT, representationRevisionId: ORIGINAL },
      { artifactId: ARTIFACT, representationRevisionId: SUCCESSOR },
    ]),
  ],
  ["an approval whose target has no revision", approval([{ artifactId: ARTIFACT }])],
  ["an approval of another artifact", approval([{ artifactId: "art-other", representationRevisionId: SUCCESSOR }])],
];

test.each(NO_APPROVED_REVISION)(
  "%s stops the run before the read: no card, no publish, and a sentence that says why (red: the run reads and publishes)",
  async (_, reviewDecision) => {
    const run = await runToThePublishCard({ reviewDecision });
    expect(run.reads).toEqual([]);
    expect(run.publishInputs).toBeNull();
    expect(run.card).toBeNull();
    expect(run.refusal).toMatch(/nothing is published/);
  },
);

test("the publishing step and the write-back take the approved artifact and revision from the read, never from the start inputs (red: a start edge into either)", () => {
  const into = (id, name) =>
    oas.data_flow_connections
      .filter((e) => refOf(e.destination_node) === id && e.destination_input === name)
      .map((e) => `${refOf(e.source_node)}.${e.source_output}`);
  expect(into(PUBLISH, "postArtifactId")).toEqual([`${READ}.artifactId`]);
  expect(into(PUBLISH, "postRepresentationRevisionId")).toEqual([`${READ}.representationRevisionId`]);
  expect(into(PUBLISH, "postText")).toEqual([`${READ}.text`]);
  expect(into(PUBLISH, "truncated")).toEqual([`${READ}.truncated`]);
  expect(writeTargetSource()).toEqual([`${READ}.artifactId`]);
  const cardInputs = (node(PUBLISH).metadata.cinatra.publishRows ?? []).map((r) => r.input);
  expect(cardInputs).toEqual(["postText"]);
});

test("the read is the module this pack declares, shipped in the package, and its refusals fit the host's bounds", async () => {
  const read = node(READ);
  expect(read.data.tool).toBe("extension_tool");
  const tools = manifest.cinatra.tools ?? [];
  const entry = tools.find((t) => t.name === read.data.input.name);
  expect(entry, "the read names a tool the manifest declares").toBeDefined();
  expect(entry.module).toMatch(/^\.\/cinatra\/tools\/[a-z-]+\.mjs$/);
  expect(Object.hasOwn(entry, "embeddable"), "no embedding agent reaches it").toBe(false);
  expect(manifest.files).toContain("cinatra");
  for (const key of ["agent_run_id", "cinatra_agent_run_id", "cinatra_run_id"]) {
    expect(Object.hasOwn(read.data.input.input, key), `the run's identity stays in the envelope: ${key}`).toBe(false);
  }
  expect(read.metadata.cinatra.riskClass).toBe("read_only");

  const mod = await import(new URL(`../${entry.module.replace(/^\.\//, "")}`, import.meta.url).href);
  expect(typeof mod.extensionTool).toBe("function");
  for (const sentence of mod.REFUSAL_SENTENCES) {
    expect(sentence.length).toBeLessThanOrEqual(400);
    expect(sentence).not.toMatch(/[\r\n\u2028\u2029]/);
    expect(sentence).not.toMatch(/\//);
    expect(sentence).not.toMatch(/[A-Za-z0-9_-]{40,}/);
  }
});

test("a failed content read is thrown on as a failure, never turned into a refusal", async () => {
  const entry = (manifest.cinatra.tools ?? []).find((t) => t.name === node(READ).data.input.name);
  const mod = await import(new URL(`../${entry.module.replace(/^\.\//, "")}`, import.meta.url).href);
  const fault = new Error("store fault");
  await expect(
    mod.extensionTool({
      input: {
        artifactId: ARTIFACT,
        reviewDecision: approval([{ artifactId: ARTIFACT, representationRevisionId: SUCCESSOR }]),
      },
      ports: {
        artifacts: {
          contentRead: async () => {
            throw fault;
          },
        },
      },
    }),
  ).rejects.toBe(fault);
});
