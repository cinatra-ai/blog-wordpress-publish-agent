// THE PUBLISHING STEP IS DECLARED, AND THE APPLICATION HOLDS THE CONFIRMATION
// (cinatra-ai/cinatra#4150).
//
// The application stops a run directly in front of every step its pack
// declares with `metadata.cinatra.publishes: true` and shows one publish card
// that it owns. The card shows the rows the pack declares for that step,
// `metadata.cinatra.publishRows: [{ label, input }]`, as label over value.
// So this pack declares its publishing step and the card's rows, and keeps no
// confirmation of its own: no screen component, no root `hitlScreens`, no pause
// in the step's prompt. It keeps declaring the former screen's id, without a
// component, only for a run that paused there before this version (the last
// case below).
//
// Two readers decide whether the declaration counts, and the cases below read
// the flow the way they do:
//   - the application's compiler (cinatra-ai/cinatra,
//     packages/agents/src/oas-compiler.ts, `collectPublishingSteps` and
//     `collectPublishRows`): `publishes` is the JSON boolean true on a
//     top-level node of kind ApiNode, AgentNode, FlowNode or ParallelFlowNode;
//     `publishRows` sits only beside it, as 1 or 2 rows, each an object with
//     exactly the keys `label` and `input`, the label one line of 1 to 60
//     characters with no space at either end, the input the title of one of
//     that node's own inputs, and no input shown twice;
//   - the pack check (cinatra-ai/ci, scripts/agent-publish-gate.mjs): every
//     step that can reach a connector declares `publishes` as a boolean, no id
//     takes the host's gate prefix, and the pack keeps no confirm step of its
//     own in front of a publishing step.
//
// These cases restate those rules over this pack's own flow; they do not run
// either reader. The kind gate in this repository's CI and the readers in
// their own repositories stay the checks of record.

import { existsSync } from "node:fs";

import { expect, test } from "vitest";

import { components, manifest, node, oas, titles } from "./__tests__/oas-contract.mjs";

const ACTION_KINDS = ["ApiNode", "AgentNode", "FlowNode", "ParallelFlowNode"];
const NO_CONNECTOR_KINDS = [
  "StartNode",
  "EndNode",
  "InputMessageNode",
  "OutputMessageNode",
  "BranchingNode",
];
const GATE_PREFIX = "cinatra_publish_gate__";

/** The node's own `metadata.cinatra`, or an empty object. */
const cinatraOf = (component) => component?.metadata?.cinatra ?? {};
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/** The top-level step ids, in the order of the flow's `nodes` list. */
const topLevelIds = () => (oas.nodes ?? []).map((entry) => entry.$component_ref);

/** The steps the compiler lists as publishing: `publishes` is exactly true. */
const publishingSteps = () =>
  topLevelIds().filter((id) => cinatraOf(components[id]).publishes === true);

/** Every object in the flow that carries a key under `metadata.cinatra`. */
function carriersOf(key) {
  const found = [];
  const stack = [["(root)", oas]];
  while (stack.length > 0) {
    const [name, value] = stack.pop();
    if (!value || typeof value !== "object") continue;
    if (Array.isArray(value)) {
      for (const item of value) stack.push([name, item]);
      continue;
    }
    if (has(cinatraOf(value), key)) found.push(value.id ?? name);
    for (const [childKey, child] of Object.entries(value)) stack.push([childKey, child]);
  }
  return found;
}

test("the publish step is the one step the application holds, declared as the compiler reads it", () => {
  expect(publishingSteps(), "the steps that declare publishes: true").toEqual(["publish"]);
  const publish = node("publish");
  expect(
    ACTION_KINDS.includes(publish.component_type),
    "the publishing step is a kind that can be the publishing action",
  ).toBe(true);
  expect(topLevelIds(), "the publishing step is a top-level node of the flow").toContain("publish");
  expect(
    has(cinatraOf(oas), "publishes"),
    "the flow root declares no publishes key",
  ).toBe(false);
  expect(carriersOf("publishes").sort(), "the nodes that declare publishes at all").toEqual(
    ["publish", "write_address"],
  );
});

test("the address write-back writes but does not publish, and says so", () => {
  expect(cinatraOf(node("write_address")).publishes).toBe(false);
});

test("every step that can reach a connector declares publishes as a boolean", () => {
  const undeclared = [];
  for (const [id, component] of Object.entries(components)) {
    if (!String(component?.component_type ?? "").endsWith("Node")) continue;
    if (NO_CONNECTOR_KINDS.includes(component.component_type)) continue;
    const cinatra = cinatraOf(component);
    if (cinatra.riskClass === "read_only") continue;
    if (typeof cinatra.publishes !== "boolean") undeclared.push(id);
  }
  expect(undeclared, "steps the pack check would refuse as undeclared").toEqual([]);
});

test("no id in the flow takes the host's gate prefix", () => {
  const ids = [
    ...Object.keys(components),
    ...Object.values(components).map((c) => c?.id),
    ...topLevelIds(),
  ].filter((id) => typeof id === "string");
  expect(ids.filter((id) => id.startsWith(GATE_PREFIX))).toEqual([]);
});

test("the publishing step declares the rows the card shows, in the form the compiler accepts", () => {
  const publish = node("publish");
  const rows = cinatraOf(publish).publishRows;
  expect(Array.isArray(rows), "publishRows is a list").toBe(true);
  expect(rows.length >= 1 && rows.length <= 2, "one or two rows").toBe(true);
  const inputs = titles(publish.inputs);
  const shown = [];
  for (const row of rows) {
    expect(Object.keys(row).sort(), "a row has exactly a label and an input").toEqual([
      "input",
      "label",
    ]);
    expect(typeof row.label).toBe("string");
    expect(row.label.length >= 1 && row.label.length <= 60, "the label is 1 to 60 characters").toBe(
      true,
    );
    expect(row.label, "the label has no space at either end").toBe(row.label.trim());
    expect(/[\p{Cc}\u2028\u2029]/u.test(row.label), "the label is one line").toBe(false);
    expect(inputs, "the row shows one of the step's own inputs").toContain(row.input);
    expect(shown, "no input is shown twice").not.toContain(row.input);
    shown.push(row.input);
  }
  expect(carriersOf("publishRows"), "only the publishing step carries rows").toEqual(["publish"]);
});

test("the card shows the words that go out, never an internal identifier", () => {
  expect(cinatraOf(node("publish")).publishRows).toEqual([
    { label: "Post text", input: "postText" },
  ]);
});

test("the pack keeps no confirmation of its own in front of the publishing step", () => {
  const rootCinatra = cinatraOf(oas);
  expect(has(rootCinatra, "hitlScreens"), "the flow root lists no screen").toBe(false);
  expect(cinatraOf(node("publish")).requiresApproval).toBe(false);
  const intoPublish = (oas.control_flow_connections ?? [])
    .filter((edge) => edge.to_node?.$component_ref === "publish")
    .map((edge) => components[edge.from_node?.$component_ref]?.component_type);
  expect(intoPublish, "the steps with a control edge into the publishing step").not.toContain(
    "InputMessageNode",
  );
  // The one step that waits for a person is the review of the post
  // (review-before-publish.test.mjs). The pack check walks back from the
  // publishing step and refuses a pause it reaches; the read of the pinned words stands
  // between the review and the publishing step.
  expect(
    Object.entries(components)
      .filter(([, c]) => c?.component_type === "InputMessageNode")
      .map(([id]) => id),
    "the steps of the flow that wait for a person",
  ).toEqual(["review_post"]);
  expect(
    (manifest.cinatra.fieldRenderers ?? []).filter((r) => Object.hasOwn(r, "component")),
    "the package ships no screen component",
  ).toEqual([]);
  expect(existsSync(new URL("../src/renderers/draft-confirm.tsx", import.meta.url))).toBe(false);
});

test("the step's prompt does not pause for a confirmation of its own", () => {
  const system = node("publish").data.system;
  expect(system).not.toMatch(/INTERRUPT/);
  expect(system).not.toMatch(/HITL/);
  expect(system).not.toMatch(/draft-confirm/);
  expect(system, "the prompt says the person has already decided").toMatch(
    /the person has already approved this publish/,
  );
});

// Every branch of the step runs after the application's card approved the
// publish, so each envelope the step returns keeps `approved: true`. A branch
// that fails reports it in `publishedUrl`, `addressWritten` and `summary`,
// never by turning the approval into a decline.

/** The prompt's section (one `### ` heading to the next) that `pattern` matches. */
const sectionOf = (pattern) =>
  node("publish")
    .data.system.split(/\n(?=### )/)
    .find((section) => pattern.test(section));

/** Every `approved` value a section sets, in order. */
const approvedIn = (section) =>
  [...String(section ?? "").matchAll(/approved"?: (true|false)/g)].map((m) => m[1]);

test("the cut-short-read branch keeps the approval the card gave", () => {
  const section = sectionOf(/When `truncated` is true/);
  expect(section, "the prompt has a cut-short-read branch").toBeDefined();
  expect(
    approvedIn(section),
    "the cut-short-read branch returns approved: true after the card approved",
  ).toEqual(["true"]);
});

test("the no-heading branch keeps the approval the card gave and publishes nothing", () => {
  const section = sectionOf(/When `postText` carries no heading line/);
  expect(section, "the prompt has a no-heading branch").toBeDefined();
  expect(
    approvedIn(section),
    "the no-heading branch returns approved: true after the card approved",
  ).toEqual(["true"]);
  expect(section).toMatch(/Publish nothing/);
  expect(section).toMatch(/`addressPatch: \{\}`/);
});

test("the no-ability branch keeps the approval the card gave", () => {
  const section = sectionOf(/If the listing offers no such ability/);
  expect(section, "the prompt has a no-ability branch").toBeDefined();
  expect(
    approvedIn(section),
    "the no-ability branch returns approved: true after the card approved",
  ).toEqual(["true"]);
});

test("the failed-site-call branch keeps the approval the card gave", () => {
  const section = sectionOf(/If the call throws/);
  expect(section, "the prompt has a failed-site-call branch").toBeDefined();
  expect(
    approvedIn(section),
    "the failed-site-call branch returns approved: true after the card approved",
  ).toEqual(["true"]);
});

test("the published branch keeps the approval the card gave", () => {
  const section = sectionOf(/^### Step \d+ — return$/m);
  expect(section, "the prompt has a return step").toBeDefined();
  expect(
    approvedIn(section),
    "the published branch returns approved: true after the card approved",
  ).toEqual(["true"]);
});

// A run that paused at the former confirmation screen before this version keeps
// that screen's id in its stored question. The package keeps declaring the id,
// with no component, so the application still reads that question as a step in
// the middle of the run and draws its own schema form with Continue for it. The
// flow never asks with the id: nothing in it names the screen.
test("the former screen id stays declared, without a component, for a run paused before this version", () => {
  expect(manifest.cinatra.fieldRenderers).toEqual([
    {
      id: "@cinatra-ai/blog-wordpress-publish-agent:draft-confirm",
      kind: "wordpress-draft-confirm",
      priority: 90,
      midRunHitl: true,
    },
  ]);
  expect(JSON.stringify(oas), "the flow never names the former screen").not.toContain(":draft-confirm");
});
