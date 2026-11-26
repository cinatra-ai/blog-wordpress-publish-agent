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
// answer that names no approved revision stops the run at the check in front
// of every read, so neither the post's record nor its words are read, no card
// opens and nothing reaches the site.
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
const CHECK = "check_review";
const RECORD = "read_post_record";
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

/** Fills every `{{ name }}` and `{{ name | tojson }}` slot of the strings in `value` from `inputs`. */
function fill(value, inputs) {
  if (typeof value === "string") {
    return value
      .replace(/\{#[\s\S]*?#\}/g, "")
      .replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(\|\s*tojson\s*)?\}\}/g, (_, name, tojson) => {
        if (!Object.hasOwn(inputs, name)) throw new Error(`the slot ${name} has no input`);
        return tojson ? JSON.stringify(inputs[name]) : String(inputs[name]);
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
 * Returns every read the run made, in order (the record read `artifacts_get`
 * and the content read), the inputs the publishing step is given (what the
 * card shows and what goes out), or the refusal that stopped the run and the
 * step it stopped at. `record` answers the record read: by default the record
 * of the artifact it was asked for, with `recordTitle`; a function is called
 * with the artifact id and may throw, as a failed read does.
 */
async function runToThePublishCard({ reviewDecision, recordTitle = "The post's own title", words = WORDS, record }) {
  const reads = [];
  const answerRecord =
    record ?? ((artifactId) => ({ artifactId, title: recordTitle, objectType: "@cinatra-ai/blog-post-artifact:post" }));
  const contentRead = async ({ artifactId, representationRevisionId }) => {
    reads.push({ read: "content", artifactId, representationRevisionId });
    if (artifactId !== ARTIFACT || !Object.hasOwn(words, representationRevisionId)) {
      throw new Error("the revision does not resolve");
    }
    return { artifactId, representationRevisionId, mime: "text/markdown", text: words[representationRevisionId], truncated: false };
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
      return { reads, publishInputs: inputs, card, refusal: null, stoppedAt: null };
    }
    if (step.component_type === "InputMessageNode") {
      outputs[id] = { [step.outputs[0].title]: reviewDecision };
      continue;
    }
    const data = fill(step.data, inputs);
    if (data.tool === "artifacts_get" && data.result_input_passthrough === true) {
      outputs[id] = { ...data.input };
    } else if (data.tool === "artifacts_get") {
      // The host answers the record as `{ artifact }` (artifacts_get without the echo).
      reads.push({ read: "artifacts_get", artifactId: data.input.artifactId });
      outputs[id] = { artifact: answerRecord(data.input.artifactId) };
    } else if (data.tool === "artifact_content_read") {
      outputs[id] = await contentRead(data.input);
    } else if (data.tool === "extension_tool") {
      const run = await declaredTool(data.input.name);
      try {
        outputs[id] = await run({ input: data.input.input, ports: { artifacts: { contentRead } } });
      } catch (e) {
        if (e?.name !== "ExtensionToolCallRefusal") throw e;
        return { reads, publishInputs: null, card: null, refusal: e.message, stoppedAt: id };
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
  expect(run.reads, "the record, then the words, each read once").toEqual([
    { read: "artifacts_get", artifactId: ARTIFACT },
    { read: "content", artifactId: ARTIFACT, representationRevisionId: SUCCESSOR },
  ]);
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
  expect(run.reads).toEqual([
    { read: "artifacts_get", artifactId: ARTIFACT },
    { read: "content", artifactId: ARTIFACT, representationRevisionId: ORIGINAL },
  ]);
  expect(run.card["Post text"]).toBe(WORDS[ORIGINAL]);
  expect(run.publishInputs.postText).toBe(WORDS[ORIGINAL]);
  expect(run.publishInputs.postRepresentationRevisionId).toBe(ORIGINAL);

  const intoRead = oas.data_flow_connections
    .filter((e) => refOf(e.destination_node) === READ)
    .map((e) => `${refOf(e.source_node)}.${e.source_output}`);
  expect(intoRead, "the read takes the review's answer").toContain(`${REVIEW}.${node(REVIEW).outputs[0].title}`);
  expect(intoRead, "and never the revision the run started with").not.toContain(`${START}.postRepresentationRevisionId`);
});

// THE PAGE'S TITLE. The pinned draft writer files the title as the artifact's
// own title and starts the body at its first `## ` section, with no `# ` title
// heading (cinatra-ai/blog-draft-writer-agent, cinatra/oas.json). The card's
// Title row and the publishing step's title are the record's own title; only
// when the record has none is a leading `# ` heading used, and a `## ` section
// heading is never the title. The words go out unchanged.
const DRAFTED = {
  [ORIGINAL]: "## Why it matters\n\nThe first section of the drafted post.",
  [SUCCESSOR]: "## Why it matters now\n\nThe regenerated first section.",
};

test("a drafted post whose body starts at a `## ` section is published under the post's own title, with its words unchanged (red: the first section heading as the title)", async () => {
  const run = await runToThePublishCard({
    reviewDecision: approval([{ artifactId: ARTIFACT, representationRevisionId: SUCCESSOR }]),
    recordTitle: "  Ten ways to ship faster  ",
    words: DRAFTED,
  });
  expect(run.refusal).toBeNull();
  expect(run.card.Title).toBe("Ten ways to ship faster");
  expect(run.publishInputs.postTitle).toBe("Ten ways to ship faster");
  expect(run.card["Post text"]).toBe(DRAFTED[SUCCESSOR]);
  expect(run.publishInputs.postText).toBe(DRAFTED[SUCCESSOR]);
});

test("a post with no title of its own takes a leading `# ` heading of the approved words", async () => {
  const run = await runToThePublishCard({
    reviewDecision: approval([{ artifactId: ARTIFACT, representationRevisionId: SUCCESSOR }]),
    recordTitle: null,
  });
  expect(run.card.Title).toBe("The regenerated post");
  expect(run.publishInputs.postTitle).toBe("The regenerated post");
  expect(run.publishInputs.postText, "the heading stays in the words").toBe(WORDS[SUCCESSOR]);
});

test("a post with no title of its own and only `## ` sections gets an empty title, never a section heading (red: the first section heading as the title)", async () => {
  const run = await runToThePublishCard({
    reviewDecision: approval([{ artifactId: ARTIFACT, representationRevisionId: ORIGINAL }]),
    recordTitle: "   ",
    words: DRAFTED,
  });
  expect(run.card.Title).toBe("");
  expect(run.publishInputs.postTitle).toBe("");
  expect(run.publishInputs.postText).toBe(DRAFTED[ORIGINAL]);
});

/** The module this pack declares for the read step. */
async function readModule() {
  const entry = (manifest.cinatra.tools ?? []).find((t) => t.name === node(READ).data.input.name);
  return import(new URL(`../${entry.module.replace(/^\.\//, "")}`, import.meta.url).href);
}

/** Calls the read step's module for the approved SUCCESSOR with `postRecord`
 *  and `words`; answers its result (or refusal) and the content reads it made. */
async function readStep({ postRecord, words = DRAFTED[SUCCESSOR] }) {
  const mod = await readModule();
  const reads = [];
  try {
    const result = await mod.extensionTool({
      input: {
        artifactId: ARTIFACT,
        reviewDecision: approval([{ artifactId: ARTIFACT, representationRevisionId: SUCCESSOR }]),
        postRecord,
      },
      ports: {
        artifacts: {
          contentRead: async ({ representationRevisionId }) => {
            reads.push(representationRevisionId);
            return { representationRevisionId, text: words, truncated: false };
          },
        },
      },
    });
    return { result, refusal: null, reads };
  } catch (e) {
    if (e?.name !== "ExtensionToolCallRefusal") throw e;
    return { result: null, refusal: e.message, reads };
  }
}

const recordOf = (title) => JSON.stringify({ artifactId: ARTIFACT, title });

test("the title comes only from the record of the approved artifact; a record that is not it stops the run before the content read (red: a record of another artifact names the title, or the run goes on without the record)", async () => {
  expect((await readStep({ postRecord: recordOf("Mine") })).result.title).toBe("Mine");
  for (const postRecord of [
    JSON.stringify({ artifactId: "art-other", title: "Other" }),
    JSON.stringify(null),
    JSON.stringify([{ artifactId: ARTIFACT, title: "Mine" }]),
    "not json",
    undefined,
  ]) {
    const step = await readStep({ postRecord });
    expect(step.refusal, String(postRecord)).toBe(
      "The post's record could not be read after the review, so nothing is published; start the run again.",
    );
    expect(step.reads, `${String(postRecord)}: no content read`).toEqual([]);
  }
});

// The record's own title: spaces around it are removed, a title of spaces only
// is no title (a leading `# ` heading is used), and a long title is kept whole
// (the module does not cut it; the site's own ability decides any limit).
test.each([
  ["a title with spaces around it", "  Ten ways to ship  ", "Ten ways to ship"],
  ["a title of spaces only", " \t ", "The heading"],
  ["no title", null, "The heading"],
  ["a long title", "T".repeat(1000), "T".repeat(1000)],
])("the record's own title: %s", async (_, title, expected) => {
  const words = "# The heading\n\nThe body.";
  const step = await readStep({ postRecord: recordOf(title), words });
  expect(step.result.title).toBe(expected);
  expect(step.result.text, "the words go out unchanged").toBe(words);
});

test("a record title wins over a leading `# ` heading, and the heading stays in the words (the page shows it in its body)", async () => {
  const words = "# A heading of the words\n\nThe body.";
  const step = await readStep({ postRecord: recordOf("The record's title"), words });
  expect(step.result.title).toBe("The record's title");
  expect(step.result.text).toBe(words);
});

// A leading heading by the CommonMark rule for ATX headings: up to three spaces
// of indentation, `#` then a space, a tab or the end of the line; a closing
// run of `#` only after a space or a tab, followed by spaces or tabs only; a
// backslash escape made plain outside a code span. Only level one is a title.
test.each([
  ["# C#", "C#"],
  ["# C #", "C"],
  ["# C#  ", "C#"],
  ["# C ##  \t", "C"],
  ["# C \\#", "C #"],
  ["# foo #\\##", "foo ###"],
  ["# `a\\#` b", "`a\\#` b"],
  ["#\tC", "C"],
  ["   # C", "C"],
  ["    # C", ""],
  ["\t# C", ""],
  ["#C", ""],
  ["#", ""],
  ["# #", ""],
  ["## C", ""],
  ["### C", ""],
  ["\n\n# After blank lines\n\nbody", "After blank lines"],
  ["Intro\n# Later", ""],
  ["# Windows\r\n\r\nbody", "Windows"],
])("with no record title, the words %j give the title %j", async (words, expected) => {
  const step = await readStep({ postRecord: recordOf(null), words });
  expect(step.result.title).toBe(expected);
  expect(step.result.text).toBe(words);
});

test("the record read is the host's artifacts_get, after the check of the review's answer and of the artifact it approved, feeding the read step's postRecord", () => {
  const record = node(RECORD);
  expect(record.data.tool).toBe("artifacts_get");
  expect(record.data.result_input_passthrough).toBeUndefined();
  expect(record.metadata.cinatra.riskClass).toBe("read_only");
  const from = oas.control_flow_connections.filter((e) => refOf(e.to_node) === RECORD).map((e) => refOf(e.from_node));
  expect(from).toEqual([CHECK]);
  expect(oas.control_flow_connections.filter((e) => refOf(e.from_node) === REVIEW).map((e) => refOf(e.to_node))).toEqual([
    CHECK,
  ]);
  const check = node(CHECK);
  expect(check.data.tool).toBe("extension_tool");
  expect(check.data.input.name).toBe(node(READ).data.input.name);
  expect(check.data.input.input.checkOnly).toBe(true);
  expect(check.metadata.cinatra.riskClass).toBe("read_only");
  const recordArtifact = oas.data_flow_connections
    .filter((e) => refOf(e.destination_node) === RECORD && e.destination_input === "postArtifactId")
    .map((e) => `${refOf(e.source_node)}.${e.source_output}`);
  expect(recordArtifact).toEqual([`${CHECK}.artifactId`]);
  const into = oas.data_flow_connections
    .filter((e) => refOf(e.destination_node) === READ && e.destination_input === "postRecord")
    .map((e) => `${refOf(e.source_node)}.${e.source_output}`);
  expect(into).toEqual([`${RECORD}.artifact`]);
});

const NO_APPROVED_REVISION = [
  ["a legacy rejection", rejection([{ artifactId: ARTIFACT, representationRevisionId: SUCCESSOR }])],
  [
    "a decline",
    JSON.stringify({
      approved: false,
      review: { envelopeVersion: 1, decision: "rejected", targets: [{ artifactId: ARTIFACT, representationRevisionId: SUCCESSOR }] },
    }),
  ],
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
  ["an approval whose revision is blank", approval([{ artifactId: ARTIFACT, representationRevisionId: " " }])],
  [
    "an approval of another revision as well",
    approval([
      { artifactId: ARTIFACT, representationRevisionId: SUCCESSOR },
      { artifactId: "art-other", representationRevisionId: "rev-other" },
    ]),
  ],
  ["an approval of another artifact", approval([{ artifactId: "art-other", representationRevisionId: SUCCESSOR }])],
];

test.each(NO_APPROVED_REVISION)(
  "%s stops the run at the check, before any read: no record read, no content read, no card, no publish, and a sentence that says why (red: the run reads the record or the words, or publishes)",
  async (_, reviewDecision) => {
    const run = await runToThePublishCard({ reviewDecision });
    expect(run.reads, "neither artifacts_get nor the content read").toEqual([]);
    expect(run.stoppedAt).toBe(CHECK);
    expect(run.publishInputs).toBeNull();
    expect(run.card).toBeNull();
    expect(run.refusal).toMatch(/nothing is published/);
  },
);

test("after a valid approval, a failed record read stops the run before the content read and the card (red: the run reads the words or opens the card)", async () => {
  const fault = new Error("artifacts_get: the artifact is not one this run's organisation can see");
  await expect(
    runToThePublishCard({
      reviewDecision: approval([{ artifactId: ARTIFACT, representationRevisionId: SUCCESSOR }]),
      record: () => {
        throw fault;
      },
    }),
  ).rejects.toBe(fault);

  const unreadable = await runToThePublishCard({
    reviewDecision: approval([{ artifactId: ARTIFACT, representationRevisionId: SUCCESSOR }]),
    record: () => null,
  });
  expect(unreadable.reads).toEqual([{ read: "artifacts_get", artifactId: ARTIFACT }]);
  expect(unreadable.card).toBeNull();
  expect(unreadable.publishInputs).toBeNull();
  expect(unreadable.stoppedAt).toBe(READ);
  expect(unreadable.refusal).toBe(
    "The post's record could not be read after the review, so nothing is published; start the run again.",
  );
});

test("the check alone reads nothing and answers the approved revision", async () => {
  const mod = await readModule();
  const refuse = async () => {
    throw new Error("the check read something");
  };
  const result = await mod.extensionTool({
    input: {
      artifactId: ARTIFACT,
      reviewDecision: approval([{ artifactId: ARTIFACT, representationRevisionId: SUCCESSOR }]),
      checkOnly: true,
    },
    ports: { artifacts: { contentRead: refuse, list: refuse } },
  });
  expect(result).toEqual({ artifactId: ARTIFACT, representationRevisionId: SUCCESSOR });
});

test("the publishing step and the write-back take the approved artifact and revision from the read, never from the start inputs (red: a start edge into either)", () => {
  const into = (id, name) =>
    oas.data_flow_connections
      .filter((e) => refOf(e.destination_node) === id && e.destination_input === name)
      .map((e) => `${refOf(e.source_node)}.${e.source_output}`);
  expect(into(PUBLISH, "postArtifactId")).toEqual([`${READ}.artifactId`]);
  expect(into(PUBLISH, "postRepresentationRevisionId")).toEqual([`${READ}.representationRevisionId`]);
  expect(into(PUBLISH, "postText")).toEqual([`${READ}.text`]);
  expect(into(PUBLISH, "truncated")).toEqual([`${READ}.truncated`]);
  expect(into(PUBLISH, "postTitle")).toEqual([`${READ}.title`]);
  expect(writeTargetSource()).toEqual([`${READ}.artifactId`]);
  const cardInputs = (node(PUBLISH).metadata.cinatra.publishRows ?? []).map((r) => r.input);
  expect(cardInputs).toEqual(["postTitle", "postText"]);
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
        postRecord: JSON.stringify({ artifactId: ARTIFACT, title: "The post's own title" }),
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
