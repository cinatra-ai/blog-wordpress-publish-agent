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
// THE READS. In front of the review one step (gather_review_target) reads the
// post's record through artifacts_get, on purpose: it builds the target set the
// person reviews. Behind the review the first step is the read of the words
// (read_post_text), which checks the answer before it reads anything: an answer
// that is not an approval of exactly the expected artifact and revision stops
// the run there, so AFTER a refused review nothing is read (no artifacts_get, no
// content read), no card opens, the write-back is never called and the site is
// never reached. After an approval the reads behind the review are the approved
// revision's words and then the post's record (read_post_record), read for the
// approved artifact only, so a title changed while the review was open is the
// title that goes out. The title is named by the HTML step from that record.
//
// The cases run the flow as the runtime wires it: they follow cinatra/oas.json's
// control and data edges from the start, fill each `{{ name }}` slot of a
// step's call data from its inputs, give the review step the answer, run the
// read step's call (the module this pack declares, through fake host ports, or
// the host's content read on a fake store), and stop in front of the publishing
// step, where the application shows its card. The model step is not run: what
// it is given is what the card shows and what it publishes.

import { expect, test } from "vitest";

import { manifest, node, oas, titles } from "./__tests__/oas-contract.mjs";

const START = "start";
const GATHER = "gather_review_target";
const REVIEW = "review_post";
const RECORD = "read_post_record";
const READ = "read_post_text";
const HTML_STEP = "write_post_html";
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

/**
 * A stand-in for the HTML step's model answer: a value built from the words the
 * step is given, so a case can tell that the card's HTML row and the publishing
 * step's body are the answer of that step, for those words. The conversion
 * itself is the skill's (blog-post-html); this suite does not run a model.
 */
const HTML_OF = (words) => `<p data-stand-in>${words}</p>`;

/**
 * A stand-in for the HTML step's model answer for the title: the record's own
 * title with the white space around it removed (the first of the step's rules).
 * The step's prompt holds the rules (post-html-by-a-skill.test.mjs pins them);
 * this suite does not run a model. It pins that the title the step is given is
 * the title of the record read after the approval, and that this very title
 * reaches the card and the publishing step.
 */
const TITLE_OF = (record) => (typeof record?.title === "string" ? record.title.trim() : "");

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
 *   - `readsAfterReview` and `callsAfterReview`: the part of `reads` and of
 *     `calls` made by the steps behind the review (the review's own pause is
 *     where the two logs are cut);
 *   - the inputs the publishing step is given (what the card shows and what
 *     goes out), or the refusal that stopped the run and the step it stopped at.
 *   - `recordOutcomes`: for each record read, in order, the step that made it
 *     and whether the read answered (`ok: true`) or failed (`ok: false`);
 *   - `failure`: the error a failed record read threw, with the run stopped at
 *     that step (`stoppedAt`); null otherwise.
 * `record` answers the record read: by default the record of the artifact it
 * was asked for, with `recordTitle`; a function is called with the artifact id,
 * the step that makes the read (GATHER in front of the review, RECORD behind it)
 * and whether the review has been passed, and may throw, as a failed read does.
 */
async function runToThePublishCard({ reviewDecision, recordTitle = "The post's own title", words = WORDS, record }) {
  const reads = [];
  const calls = [];
  const steps = [];
  const recordOutcomes = [];
  let cut = null;
  const finish = (rest) => ({
    steps,
    reads,
    calls,
    recordOutcomes,
    readsAfterReview: cut === null ? [] : reads.slice(cut.reads),
    callsAfterReview: cut === null ? [] : calls.slice(cut.calls),
    publishInputs: null,
    card: null,
    refusal: null,
    failure: null,
    stoppedAt: null,
    ...rest,
  });
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
      return finish({ publishInputs: inputs, card });
    }
    if (step.component_type === "InputMessageNode") {
      outputs[id] = { [step.outputs[0].title]: reviewDecision };
      cut = { reads: reads.length, calls: calls.length };
      continue;
    }
    if (id === HTML_STEP) {
      // The HTML step is a model step that calls no host tool; its answer is
      // the stand-ins above, built from the words and the record it is given.
      expect(Object.keys(inputs).sort(), "the HTML step is given the approved words and the post's record only").toEqual([
        "postRecord",
        "postText",
      ]);
      outputs[id] = { postHtml: HTML_OF(inputs.postText), postTitle: TITLE_OF(inputs.postRecord) };
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
        answer = answerRecord(data.input.artifactId, id, cut !== null);
        recordOutcomes.push({ step: id, ok: true });
      } catch (e) {
        recordOutcomes.push({ step: id, ok: false });
        return finish({ failure: e, stoppedAt: id });
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
        return finish({ refusal: e.message, stoppedAt: id });
      }
    } else {
      throw new Error(`the run reached ${id} before the publishing step`);
    }
  }
}

/** The one read in front of the review: the record read that builds the target set. */
const PRE_REVIEW_READ = { step: GATHER, read: "artifacts_get", artifactId: ARTIFACT };

/** The two reads behind the review of a run that approved `revision`: its words, then the record. */
const WORDS_READ = (revision) => ({ step: READ, read: "content", artifactId: ARTIFACT, representationRevisionId: revision });
const RECORD_READ = { step: RECORD, read: "artifacts_get", artifactId: ARTIFACT };

/** The full read log of a run whose review approved `revision`, in order. */
const APPROVED_READS = (revision) => [PRE_REVIEW_READ, WORDS_READ(revision), RECORD_READ];

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
  expect(run.steps).toEqual([GATHER, REVIEW, READ, RECORD, HTML_STEP, PUBLISH]);
  expect(run.reads, "the record before the review, then after the approval the words and the record, each once").toEqual(
    APPROVED_READS(SUCCESSOR),
  );
  expect(run.readsAfterReview, "behind the review the run reads the approved revision's words, then the record").toEqual([
    WORDS_READ(SUCCESSOR),
    RECORD_READ,
  ]);
  expect(run.card["Post text"]).toBe(WORDS[SUCCESSOR]);
  expect(run.publishInputs.postText).toBe(WORDS[SUCCESSOR]);
  expect(run.card["Post HTML"], "the card's HTML row is the HTML of the successor's words").toBe(HTML_OF(WORDS[SUCCESSOR]));
  expect(run.publishInputs.postHtml, "the body that goes out is the value the card shows").toBe(run.card["Post HTML"]);
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
  expect(run.card["Post HTML"]).toBe(HTML_OF(WORDS[ORIGINAL]));
  expect(run.publishInputs.postHtml).toBe(HTML_OF(WORDS[ORIGINAL]));
  expect(run.publishInputs.postRepresentationRevisionId).toBe(ORIGINAL);

  const intoRead = oas.data_flow_connections
    .filter((e) => refOf(e.destination_node) === READ)
    .map((e) => `${refOf(e.source_node)}.${e.source_output}`);
  expect(intoRead, "the read takes the review's answer").toContain(`${REVIEW}.${node(REVIEW).outputs[0].title}`);
  expect(intoRead, "and never the revision the run started with").not.toContain(`${START}.postRepresentationRevisionId`);
});

// THE PAGE'S TITLE. The pinned draft writer files the title as the artifact's
// own title and starts the body at its first `## ` section, with no `# ` title
// heading (cinatra-ai/blog-draft-writer-agent, cinatra/oas.json). The HTML step
// names the title from the record read after the approval (its rules are in its
// prompt, pinned in post-html-by-a-skill.test.mjs); the card's Title row and the
// publishing step's title are the answer of that step. The words go out unchanged.
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

test("a title changed while the review is open is the title that goes out: title A when the review opened, title B at the approval, and B reaches the card and the publishing step (red: the title taken from a record read in front of the review)", async () => {
  const run = await runToThePublishCard({
    reviewDecision: approval([{ artifactId: ARTIFACT, representationRevisionId: SUCCESSOR }]),
    record: (artifactId, _step, afterReview) => ({ artifactId, title: afterReview ? "Title B, at the approval" : "Title A, when the review opened" }),
  });
  expect(run.refusal).toBeNull();
  expect(run.reads.filter((r) => r.read === "artifacts_get"), "one read in front of the review, one behind it").toEqual([
    PRE_REVIEW_READ,
    RECORD_READ,
  ]);
  expect(run.card.Title).toBe("Title B, at the approval");
  expect(run.publishInputs.postTitle).toBe("Title B, at the approval");
  expect(JSON.stringify(run.publishInputs), "nothing of the title in front of the review goes out").not.toMatch(/Title A/);
  expect(run.card["Post text"]).toBe(WORDS[SUCCESSOR]);
});

/** The module this pack declares for the read step. */
async function readModule() {
  const entry = (manifest.cinatra.tools ?? []).find((t) => t.name === node(READ).data.input.name);
  return import(new URL(`../${entry.module.replace(/^\.\//, "")}`, import.meta.url).href);
}

/** Calls the read step's module with `reviewDecision` (the approval of the SUCCESSOR
 *  by default); answers its result (or refusal) and the content reads it made. */
async function readStep({ reviewDecision = approval([{ artifactId: ARTIFACT, representationRevisionId: SUCCESSOR }]), words = DRAFTED[SUCCESSOR] } = {}) {
  const mod = await readModule();
  const reads = [];
  try {
    const result = await mod.extensionTool({
      input: { artifactId: ARTIFACT, reviewDecision },
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

test("the read answers the approved artifact, revision and words, and no title: the title is not the module's work (red: a title, a record or a heading rule in the module)", async () => {
  const { result, refusal, reads } = await readStep({ words: "# A heading\n\nThe body." });
  expect(refusal).toBeNull();
  expect(reads).toEqual([SUCCESSOR]);
  expect(result).toEqual({
    artifactId: ARTIFACT,
    representationRevisionId: SUCCESSOR,
    text: "# A heading\n\nThe body.",
    truncated: false,
  });
  expect(titles(node(READ).outputs)).toEqual(["artifactId", "representationRevisionId", "text", "truncated"]);
  expect(titles(node(READ).inputs)).toEqual(["reviewDecision", "postArtifactId", "cinatra_run_id"]);
});

test("the record read is the host's artifacts_get of the approved artifact, behind the read of the words and in front of the HTML step, feeding that step's postRecord; no step checks the answer on its own and the pack's code runs once (red: a record read in front of the review that is carried over the pause, a record read of another artifact, or a second call of the tool)", () => {
  const record = node(RECORD);
  expect(record.data.tool).toBe("artifacts_get");
  expect(record.data.result_input_passthrough).toBeUndefined();
  expect(record.metadata.cinatra.riskClass).toBe("read_only");
  const control = (side, id) =>
    oas.control_flow_connections.filter((e) => refOf(e[side === "to" ? "to_node" : "from_node"]) === id).map((e) => refOf(e[side === "to" ? "from_node" : "to_node"]));
  expect(control("to", RECORD), "reached only from the read of the words").toEqual([READ]);
  expect(control("from", RECORD)).toEqual([HTML_STEP]);
  expect(control("from", REVIEW), "the read of the words is right behind the review").toEqual([READ]);
  expect(control("to", READ)).toEqual([REVIEW]);
  const recordArtifact = oas.data_flow_connections
    .filter((e) => refOf(e.destination_node) === RECORD && e.destination_input === "postArtifactId")
    .map((e) => `${refOf(e.source_node)}.${e.source_output}`);
  expect(recordArtifact, "the artifact the answer approved, as the read of the words handed it on").toEqual([`${READ}.artifactId`]);
  const into = oas.data_flow_connections
    .filter((e) => refOf(e.destination_node) === HTML_STEP && e.destination_input === "postRecord")
    .map((e) => `${refOf(e.source_node)}.${e.source_output}`);
  expect(into).toEqual([`${RECORD}.artifact`]);
  // The pack's code runs once: the read step is the only step that calls the tool, and it has no check-only form.
  const toolSteps = ALL_STEPS.filter((id) => node(id).data?.tool === "extension_tool");
  expect(toolSteps).toEqual([READ]);
  expect(Object.hasOwn(node(READ).data.input.input, "checkOnly")).toBe(false);
  expect(Object.hasOwn(node(READ).data.input.input, "postRecord")).toBe(false);
  expect(ALL_STEPS).not.toContain("check_review");
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
  "%s stops the run at the read step right behind the review: the only read is the one in front of the review, and after the review nothing is read, no card opens, the write-back is never called and the site is never reached (red: a read after the review, or a publish)",
  async (_, reviewDecision) => {
    const run = await runToThePublishCard({ reviewDecision });
    expect(run.steps, "the run ends at the read step").toEqual([GATHER, REVIEW, READ]);
    expect(run.reads, "exactly the read in front of the review; no artifacts_get and no content read behind it").toEqual([
      PRE_REVIEW_READ,
    ]);
    expect(run.readsAfterReview, "after the review nothing is read").toEqual([]);
    expect(run.calls, "the host tools called: the read in front of the review and the read step's call, nothing else").toEqual([
      { step: GATHER, tool: "artifacts_get" },
      { step: READ, tool: "extension_tool" },
    ]);
    expect(run.callsAfterReview, "behind the review only the read step is called, and it refuses").toEqual([
      { step: READ, tool: "extension_tool" },
    ]);
    // The store write and the site are reached only through the steps that name
    // them (the write-back's objects_update, the publishing step's site tools);
    // none of those steps is reached.
    expect(SITE_TOOLS.length, "the site tools the manifest consumes").toBe(2);
    expect(STEPS_THAT_WRITE_THE_STORE).toEqual([WRITE]);
    expect(STEPS_THAT_REACH_THE_SITE).toEqual([PUBLISH]);
    for (const id of [...STEPS_THAT_WRITE_THE_STORE, ...STEPS_THAT_REACH_THE_SITE, RECORD, HTML_STEP]) {
      expect(run.steps, `${id} is never reached`).not.toContain(id);
    }
    expect(run.calls.filter((c) => c.tool === "objects_update"), "objects_update is never called").toEqual([]);
    expect(run.stoppedAt).toBe(READ);
    expect(run.failure).toBeNull();
    expect(run.publishInputs).toBeNull();
    expect(run.card).toBeNull();
    expect(run.refusal).toMatch(/nothing is published/);
    const mod = await readModule();
    expect(mod.REFUSAL_SENTENCES, "the run stops with one of the module's own sentences").toContain(run.refusal);
  },
);

test.each(NO_APPROVED_REVISION)(
  "%s is refused by the module before any read: no content read, and the refusal is the answer's (red: a content read before the check)",
  async (_, reviewDecision) => {
    const step = await readStep({ reviewDecision });
    expect(step.result).toBeNull();
    expect(step.refusal).toMatch(/nothing is published/);
    expect(step.reads).toEqual([]);
  },
);

// The record is read twice in a run that is approved: in front of the review by
// gather_review_target (it builds the target set; the answer is not used
// afterwards) and behind the approval by read_post_record (it feeds the title).
// These cases let the first read answer and make only the second one fail.
const APPROVED_SUCCESSOR = approval([{ artifactId: ARTIFACT, representationRevisionId: SUCCESSOR }]);
const ownRecord = (artifactId) => ({ artifactId, title: "The post's own title", objectType: "@cinatra-ai/blog-post-artifact:post" });

test("after a valid approval, a record read that FAILS stops the run as a failure before the HTML step and the card (red: the run goes on without the record, or the failure is swallowed)", async () => {
  const fault = new Error("artifacts_get: the artifact is not one this run's organisation can see");
  const run = await runToThePublishCard({
    reviewDecision: APPROVED_SUCCESSOR,
    record: (artifactId, step) => {
      if (step === GATHER) return ownRecord(artifactId);
      throw fault;
    },
  });
  expect(run.steps, "the run went through the review and the read of the words to the record read").toEqual([
    GATHER,
    REVIEW,
    READ,
    RECORD,
  ]);
  expect(run.recordOutcomes, "the gather read answered; the record read was made and failed").toEqual([
    { step: GATHER, ok: true },
    { step: RECORD, ok: false },
  ]);
  expect(run.reads, "the read in front of the review, the words, the record read (attempted)").toEqual(APPROVED_READS(SUCCESSOR));
  expect(run.steps).not.toContain(HTML_STEP);
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

test("a record read that fails at the gather step stops the run there: no review, no later step", async () => {
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

test("the publishing step and the write-back take the approved artifact and revision from the read, never from the start inputs (red: a start edge into either)", () => {
  const into = (id, name) =>
    oas.data_flow_connections
      .filter((e) => refOf(e.destination_node) === id && e.destination_input === name)
      .map((e) => `${refOf(e.source_node)}.${e.source_output}`);
  expect(into(PUBLISH, "postArtifactId")).toEqual([`${READ}.artifactId`]);
  expect(into(PUBLISH, "postRepresentationRevisionId")).toEqual([`${READ}.representationRevisionId`]);
  expect(into(PUBLISH, "postText")).toEqual([`${READ}.text`]);
  expect(into(PUBLISH, "truncated")).toEqual([`${READ}.truncated`]);
  expect(into(PUBLISH, "postTitle"), "the title is the HTML step's answer, named from the record read after the approval").toEqual([
    `${HTML_STEP}.postTitle`,
  ]);
  expect(into(HTML_STEP, "postRecord")).toEqual([`${RECORD}.artifact`]);
  expect(into(PUBLISH, "postHtml"), "the body is the HTML step's answer").toEqual([`${HTML_STEP}.postHtml`]);
  expect(into(HTML_STEP, "postText"), "the HTML step writes the approved words").toEqual([`${READ}.text`]);
  expect(writeTargetSource()).toEqual([`${READ}.artifactId`]);
  const cardInputs = (node(PUBLISH).metadata.cinatra.publishRows ?? []).map((r) => r.input);
  expect(cardInputs).toEqual(["postTitle", "postText", "postHtml"]);
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
