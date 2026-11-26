// THE RUN PUBLISHES THE REVISION THE REVIEW APPROVED (cinatra-ai/cinatra#3471,
// #3650).
//
// The run parks on the host's review of the post. The person can approve the
// revision the run started with, or choose Regenerate and approve the successor
// revision. The host resumes the review step with its answer, JSON text that
// names the approved target (cinatra-ai/cinatra,
// src/lib/artifacts/artifact-review-rejection.ts, buildReviewApproveEnvelope).
// The read of the words, the publish card's "Post text" row and the publishing
// step must take that target, never the revision the run started with.
//
// THE ONE READ BEFORE THE REVIEW. The step in front of the review
// (gather_review_target) reads the post's record through artifacts_get on
// purpose: it builds the target set the person reviews. That read always
// happens. An answer that is not an approval of exactly the expected artifact
// and revision stops the run at the check right behind the review, so AFTER
// the review nothing more is read (no second artifacts_get, no content read),
// no card opens, the write-back is never called and the site is never reached.
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
const GATHER = "gather_review_target";
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
 * Returns
 *   - `steps`: every step the run reached, in order (the publishing step
 *     included when the run reaches its card);
 *   - `reads`: EVERY read the run made, in order, each with the step that made
 *     it: each `artifacts_get` (with or without the echo of its input) and
 *     each content read. Nothing is passed through unrecorded;
 *   - `calls`: every host tool every step called, in order, with its step;
 *   - the inputs the publishing step is given (what the card shows and what
 *     goes out), or the refusal that stopped the run and the step it stopped at.
 *   - `recordOutcomes`: for each record read, in order, the step that made it
 *     and whether the read answered (`ok: true`) or failed (`ok: false`);
 *   - `failure`: the error a failed record read threw, with the run stopped at
 *     that step (`stoppedAt`); null otherwise.
 * `record` answers the record read: by default the record of the artifact it
 * was asked for, with `recordTitle`; a function is called with the artifact id
 * and the step that makes the read (GATHER before the review, RECORD after it)
 * and may throw, as a failed read does.
 */
async function runToThePublishCard({ reviewDecision, recordTitle = "The post's own title", words = WORDS, record }) {
  const reads = [];
  const calls = [];
  const steps = [];
  const recordOutcomes = [];
  const answerRecord =
    record ?? ((artifactId) => ({ artifactId, title: recordTitle, objectType: "@cinatra-ai/blog-post-artifact:post" }));
  const contentReadOf = (step) => async ({ artifactId, representationRevisionId }) => {
    reads.push({ step, read: "content", artifactId, representationRevisionId });
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
    steps.push(id);
    const step = node(id);
    const inputs = inputsOf(id);
    if (id === PUBLISH) {
      const card = Object.fromEntries((step.metadata.cinatra.publishRows ?? []).map((r) => [r.label, inputs[r.input]]));
      return { steps, reads, calls, recordOutcomes, publishInputs: inputs, card, refusal: null, failure: null, stoppedAt: null };
    }
    if (step.component_type === "InputMessageNode") {
      outputs[id] = { [step.outputs[0].title]: reviewDecision };
      continue;
    }
    const data = fill(step.data, inputs);
    calls.push({ step: id, tool: data.tool });
    if (data.tool === "artifacts_get") {
      // The record read is a read whether or not the host echoes the call's
      // input back (result_input_passthrough): both are recorded.
      reads.push({ step: id, read: "artifacts_get", artifactId: data.input.artifactId });
      let answer;
      try {
        answer = answerRecord(data.input.artifactId, id);
        recordOutcomes.push({ step: id, ok: true });
      } catch (e) {
        recordOutcomes.push({ step: id, ok: false });
        return { steps, reads, calls, recordOutcomes, publishInputs: null, card: null, refusal: null, failure: e, stoppedAt: id };
      }
      outputs[id] = data.result_input_passthrough === true ? { ...data.input } : { artifact: answer };
    } else if (data.tool === "artifact_content_read") {
      outputs[id] = await contentReadOf(id)(data.input);
    } else if (data.tool === "extension_tool") {
      const run = await declaredTool(data.input.name);
      try {
        outputs[id] = await run({ input: data.input.input, ports: { artifacts: { contentRead: contentReadOf(id) } } });
      } catch (e) {
        if (e?.name !== "ExtensionToolCallRefusal") throw e;
        return { steps, reads, calls, recordOutcomes, publishInputs: null, card: null, refusal: e.message, failure: null, stoppedAt: id };
      }
    } else {
      throw new Error(`the run reached ${id} before the publishing step`);
    }
  }
}

/** The one read in front of the review: the record read that builds the target set. */
const PRE_REVIEW_READ = { step: GATHER, read: "artifacts_get", artifactId: ARTIFACT };

/** The full read log of a run whose review approved `revision`, in order. */
const APPROVED_READS = (revision) => [
  PRE_REVIEW_READ,
  { step: RECORD, read: "artifacts_get", artifactId: ARTIFACT },
  { step: READ, read: "content", artifactId: ARTIFACT, representationRevisionId: revision },
];

/** Every step whose call writes the store, and every step that names a site tool. */
const ALL_STEPS = Object.keys(oas.$referenced_components ?? {}).filter((id) => node(id)?.component_type);
const SITE_TOOLS = (manifest.cinatra?.consumes ?? [])
  .map((c) => c.primitive)
  .filter((name) => typeof name === "string" && name.startsWith("wordpress_"));
const STEPS_THAT_WRITE_THE_STORE = ALL_STEPS.filter((id) => node(id).data?.tool === "objects_update");
const STEPS_THAT_REACH_THE_SITE = ALL_STEPS.filter((id) =>
  SITE_TOOLS.some((tool) => JSON.stringify(node(id)).includes(tool)),
);

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
  expect(run.steps).toEqual([GATHER, REVIEW, CHECK, RECORD, READ, PUBLISH]);
  expect(run.reads, "the record before the review, then after the approval the record and the words, each once").toEqual(
    APPROVED_READS(SUCCESSOR),
  );
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
  expect(run.reads).toEqual(APPROVED_READS(ORIGINAL));
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

// The record's own title is plain text, not Markdown: the white space around
// it is removed as JavaScript's trim reads it (Unicode white space included),
// a title of white space only is no title (a leading `# ` heading is used),
// and a long title is kept whole (the module does not cut it; the site's own
// ability decides any limit).
test.each([
  ["a title with spaces around it", "  Ten ways to ship  ", "Ten ways to ship"],
  ["a title of spaces only", " \t ", "The heading"],
  ["a title of U+00A0 only", "\u00A0", "The heading"],
  ["a title of Unicode white space only", "\u3000\u2003\uFEFF\u000B\u000C\u00A0", "The heading"],
  ["a title with Unicode white space around it", "\u3000Ten ways\u00A0\uFEFF", "Ten ways"],
  ["a title with U+00A0 inside it", "Ten\u00A0ways", "Ten\u00A0ways"],
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
  [" \n# Later", "Later"],
  ["\t\n# Later", "Later"],
  [" \t \r\n\t\n# Later", "Later"],
  ["Intro\n# Later", ""],
  ["# Windows\r\n\r\nbody", "Windows"],
])("with no record title, the words %j give the title %j", async (words, expected) => {
  const step = await readStep({ postRecord: recordOf(null), words });
  expect(step.result.title).toBe(expected);
  expect(step.result.text).toBe(words);
});

// CommonMark names its white space exactly: a blank line holds only spaces
// (U+0020) and tabs (U+0009); the indent is up to three spaces; the separator
// after `#` and before a closing run is a space or a tab. Any other Unicode
// white space is CONTENT. As a first line it is not blank, so a heading behind
// it is not the leading heading and the title is empty (nothing is published).
const UNICODE_WHITE_SPACE = [
  ["U+00A0", "\u00A0"],
  ["U+2003", "\u2003"],
  ["U+FEFF", "\uFEFF"],
  ["U+3000", "\u3000"],
  ["U+000B", "\u000B"],
  ["U+000C", "\u000C"],
];
test.each(UNICODE_WHITE_SPACE)(
  "with no record title, a first line of %s alone is not blank, so `# Later` behind it is no title (red: trim or \\s reading it as blank)",
  async (_, ws) => {
    for (const words of [`${ws}\n# Later`, `${ws}${ws}\n\n# Later`, ` ${ws}\t\n# Later`]) {
      const step = await readStep({ postRecord: recordOf(null), words });
      expect(step.result.title, JSON.stringify(words)).toBe("");
      expect(step.result.text).toBe(words);
    }
  },
);
test.each(UNICODE_WHITE_SPACE)(
  "with no record title, %s in and around a heading is content, never an indent or a separator",
  async (_, ws) => {
    const cases = [
      [`${ws}# C`, ""], // not an indent: the line does not start with `#`
      [`#${ws}C`, ""], // not the space or tab `#` needs: no heading
      [`# C${ws}`, `C${ws}`], // not trailing space or tab: kept
      [`# ${ws}C`, `${ws}C`], // not leading space or tab: kept
      [`# C${ws}#`, `C${ws}#`], // not the space or tab a closing run needs
      [`# C #${ws}`, `C #${ws}`], // not the space or tab a closing run may end with
      [`# ${ws}`, ""], // a title of white space only shows nothing: no title
    ];
    for (const [words, expected] of cases) {
      const step = await readStep({ postRecord: recordOf(null), words });
      expect(step.result.title, JSON.stringify(words)).toBe(expected);
      expect(step.result.text).toBe(words);
    }
  },
);

test("with no record title, U+2028 inside the heading line is content of that line (red: the heading lost to a line break CommonMark does not have)", async () => {
  const words = "# One\u2028Two\n\nbody";
  const step = await readStep({ postRecord: recordOf(null), words });
  expect(step.result.title).toBe("One\u2028Two");
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
  "%s stops the run at the check right behind the review: the only read is the record read in front of the review, and after the review nothing is read, no card opens, the write-back is never called and the site is never reached (red: a read after the review, or a publish)",
  async (_, reviewDecision) => {
    const run = await runToThePublishCard({ reviewDecision });
    expect(run.steps, "the run ends at the check").toEqual([GATHER, REVIEW, CHECK]);
    expect(run.reads, "exactly the pre-review record read; no second artifacts_get, no content read").toEqual([
      PRE_REVIEW_READ,
    ]);
    expect(run.calls, "the host tools called: the pre-review read and the check, nothing else").toEqual([
      { step: GATHER, tool: "artifacts_get" },
      { step: CHECK, tool: "extension_tool" },
    ]);
    // The store write and the site are reached only through the steps that name
    // them (the write-back's objects_update, the publishing step's site tools);
    // none of those steps is reached.
    expect(SITE_TOOLS.length, "the site tools the manifest consumes").toBe(2);
    expect(STEPS_THAT_WRITE_THE_STORE).toEqual([WRITE]);
    expect(STEPS_THAT_REACH_THE_SITE).toEqual([PUBLISH]);
    for (const id of [...STEPS_THAT_WRITE_THE_STORE, ...STEPS_THAT_REACH_THE_SITE]) {
      expect(run.steps, `${id} is never reached`).not.toContain(id);
    }
    expect(run.calls.filter((c) => c.tool === "objects_update"), "objects_update is never called").toEqual([]);
    expect(run.stoppedAt).toBe(CHECK);
    expect(run.publishInputs).toBeNull();
    expect(run.card).toBeNull();
    expect(run.refusal).toMatch(/nothing is published/);
  },
);

// The record is read twice: BEFORE the review by gather_review_target (it builds
// the target set; the answer is not used afterwards) and AFTER the approval by
// read_post_record (it feeds the title). These cases let the first read answer
// and make only the second one fail or answer something unusable, so they reach
// the post-review step the name says.
const APPROVED_SUCCESSOR = approval([{ artifactId: ARTIFACT, representationRevisionId: SUCCESSOR }]);
const RECORD_REFUSAL =
  "The post's record could not be read after the review, so nothing is published; start the run again.";
const ownRecord = (artifactId) => ({ artifactId, title: "The post's own title", objectType: "@cinatra-ai/blog-post-artifact:post" });

test("after a valid approval, a record read that FAILS after the review (the pre-review read answered) stops the run as a failure before the content read and the card (red: the run reads the words or opens the card, or the failure is swallowed)", async () => {
  const fault = new Error("artifacts_get: the artifact is not one this run's organisation can see");
  const run = await runToThePublishCard({
    reviewDecision: APPROVED_SUCCESSOR,
    record: (artifactId, step) => {
      if (step === GATHER) return ownRecord(artifactId);
      throw fault;
    },
  });
  expect(run.steps, "the run went through the review and the check to the post-review record read").toEqual([
    GATHER,
    REVIEW,
    CHECK,
    RECORD,
  ]);
  expect(run.recordOutcomes, "the pre-review read answered; the post-review read was made and failed").toEqual([
    { step: GATHER, ok: true },
    { step: RECORD, ok: false },
  ]);
  expect(run.reads, "the record before the review, the record after it (attempted), no content read").toEqual([
    PRE_REVIEW_READ,
    { step: RECORD, read: "artifacts_get", artifactId: ARTIFACT },
  ]);
  expect(run.calls).toEqual([
    { step: GATHER, tool: "artifacts_get" },
    { step: CHECK, tool: "extension_tool" },
    { step: RECORD, tool: "artifacts_get" },
  ]);
  expect(run.steps).not.toContain(READ);
  expect(run.steps).not.toContain(PUBLISH);
  expect(run.steps).not.toContain(WRITE);
  expect(run.calls.filter((c) => c.tool === "objects_update")).toEqual([]);
  // The run ends with the host's own error, thrown on as a failure: no refusal
  // text of the pack, no card, nothing published.
  expect(run.failure).toBe(fault);
  expect(run.failure.message).toBe("artifacts_get: the artifact is not one this run's organisation can see");
  expect(run.refusal).toBeNull();
  expect(run.stoppedAt).toBe(RECORD);
  expect(run.card).toBeNull();
  expect(run.publishInputs).toBeNull();
});

test.each([
  ["nothing (null)", () => null],
  ["text that is not JSON", () => "not json"],
  ["a list", (artifactId) => [ownRecord(artifactId)]],
  ["the record of another artifact", () => ownRecord("art-other")],
])(
  "after a valid approval, a post-review record read that answers %s (the pre-review read answered normally) stops the run with the pack's refusal at the read step, before the content read and the card (red: the run goes on without the record)",
  async (_, unusable) => {
    const run = await runToThePublishCard({
      reviewDecision: APPROVED_SUCCESSOR,
      record: (artifactId, step) => (step === GATHER ? ownRecord(artifactId) : unusable(artifactId)),
    });
    expect(run.steps, "through the review, the check and the post-review record read, to the read step").toEqual([
      GATHER,
      REVIEW,
      CHECK,
      RECORD,
      READ,
    ]);
    expect(run.recordOutcomes, "both record reads answered; the second answer is the unusable one").toEqual([
      { step: GATHER, ok: true },
      { step: RECORD, ok: true },
    ]);
    expect(run.reads, "the record before the review, the record after it, no content read").toEqual([
      PRE_REVIEW_READ,
      { step: RECORD, read: "artifacts_get", artifactId: ARTIFACT },
    ]);
    expect(run.steps).not.toContain(PUBLISH);
    expect(run.steps).not.toContain(WRITE);
    expect(run.calls.filter((c) => c.tool === "objects_update")).toEqual([]);
    expect(run.stoppedAt).toBe(READ);
    expect(run.failure).toBeNull();
    expect(run.card).toBeNull();
    expect(run.publishInputs).toBeNull();
    expect(run.refusal).toBe(RECORD_REFUSAL);
  },
);

test("a record read that fails BEFORE the review stops the run at the pre-review step: no review, no later step", async () => {
  const fault = new Error("artifacts_get: down");
  const run = await runToThePublishCard({
    reviewDecision: APPROVED_SUCCESSOR,
    record: () => {
      throw fault;
    },
  });
  expect(run.steps).toEqual([GATHER]);
  expect(run.recordOutcomes).toEqual([{ step: GATHER, ok: false }]);
  expect(run.failure).toBe(fault);
  expect(run.stoppedAt).toBe(GATHER);
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
