// A REVIEW OF THE POST COMES BEFORE THE PUBLISHING STEP, IN THE SAME RUN
// (cinatra-ai/cinatra#4150, #3650; the application's side is cinatra-ai/cinatra#4762).
//
// The application opens its publish card only after a person approved a review
// earlier in the same run. A run without one stops with "No approved review came
// before this change outside Cinatra." and never reaches the card. The
// application reads only the reviews of the run itself, so this pack raises its
// own review, whether a person starts it by hand or another flow starts it.
//
// The review is the host's declared artifact review: an InputMessageNode whose
// `metadata.cinatra.artifactReview.targetsInput` names the input that carries the
// run's target set, as JSON text of `[{ artifactId, representationRevisionId }]`
// (cinatra-ai/cinatra, packages/agents/src/artifact-binding.ts
// `readArtifactReviewTargetsInput`, src/lib/artifacts/artifact-review-target.ts
// `resolveDeclaredReviewTargets`). The host's review core pins exactly that
// revision and opens its review while the run parks there.
//
// The pack check (cinatra-ai/ci, scripts/agent-publish-gate.mjs, at the commit
// .github/workflows/agent-publish-gate.yml pins) walks back from a publishing step
// through BranchingNodes only and refuses an InputMessageNode it reaches as a
// confirm step of the pack's own. The read of the pinned words stands between the review
// and the publishing step, so the review is not that.
//
// These cases restate those rules over this pack's own flow; they run none of
// the readers.

import { expect, test } from "vitest";

import { components, consumedPrimitives, node, oas, titles } from "./__tests__/oas-contract.mjs";

const REVIEW = "review_post";
const GATHER = "gather_review_target";
const PUBLISH = "publish";
const START = "start";

const refOf = (r) => r?.$component_ref;
const controlEdges = (flow) =>
  (flow.control_flow_connections ?? []).map((e) => ({ from: refOf(e.from_node), to: refOf(e.to_node) }));
const dataEdges = () =>
  (oas.data_flow_connections ?? []).map((e) => ({
    from: refOf(e.source_node),
    out: e.source_output,
    to: refOf(e.destination_node),
    in: e.destination_input,
  }));
const cinatraOf = (component) => component?.metadata?.cinatra ?? {};
const publishingSteps = (flow) =>
  (flow.nodes ?? []).map(refOf).filter((id) => cinatraOf(flow.$referenced_components?.[id]).publishes === true);

/** The steps reachable from the start step when `without` is taken out of the flow. */
function reachableWithout(flow, without) {
  const edges = controlEdges(flow);
  const seen = new Set();
  const queue = [refOf(flow.start_node)];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === without || seen.has(id)) continue;
    seen.add(id);
    for (const e of edges) if (e.from === id) queue.push(e.to);
  }
  return seen;
}

/** The pauses the pack check reaches walking back from `step` through BranchingNodes only. */
function pausesInFrontOf(flow, step) {
  const steps = flow.$referenced_components ?? {};
  const edges = controlEdges(flow);
  const found = [];
  const visited = new Set([step]);
  const queue = edges.filter((e) => e.to === step).map((e) => e.from);
  while (queue.length > 0) {
    const before = queue.shift();
    if (visited.has(before)) continue;
    visited.add(before);
    const kind = steps[before]?.component_type;
    if (kind === "InputMessageNode") found.push(before);
    else if (kind === "BranchingNode") queue.push(...edges.filter((e) => e.to === before).map((e) => e.from));
  }
  return found;
}

test("the flow has one review step, marked as the host's declared artifact review", () => {
  const pauses = Object.entries(components)
    .filter(([, c]) => c?.component_type === "InputMessageNode")
    .map(([id]) => id);
  expect(pauses).toEqual([REVIEW]);
  const review = node(REVIEW);
  expect(review.id).toBe(REVIEW);
  expect((oas.nodes ?? []).map(refOf), "the review is a top-level step").toContain(REVIEW);
  const cinatra = cinatraOf(review);
  expect(cinatra.artifactReview).toEqual({ targetsInput: "reviewTargets" });
  expect(cinatra.requiresApproval).toBe(true);
  expect(cinatra.riskClass).toBe("read_only");
  expect(Object.hasOwn(cinatra, "publishes"), "the review does not publish").toBe(false);
  const input = (review.inputs ?? []).find((i) => i.title === cinatra.artifactReview.targetsInput);
  expect(input, "the marker names one of the review's own inputs").toBeDefined();
  expect(input.type, "the target set travels as JSON text").toBe("string");
  expect(input.default, "with no set the core refuses the review, so the card never opens").toBe("[]");
});

test("the review shows no screen of the pack's own", () => {
  const cinatra = cinatraOf(node(REVIEW));
  for (const key of ["renderer", "inputRenderers", "a2uiSurfaceId", "inputMessageSchema"]) {
    expect(Object.hasOwn(cinatra, key), key).toBe(false);
  }
  expect(Object.hasOwn(cinatraOf(oas), "hitlScreens")).toBe(false);
});

test("every way from the start to the publishing step passes the review", () => {
  expect(publishingSteps(oas)).toEqual([PUBLISH]);
  expect(reachableWithout(oas, null).has(PUBLISH), "the publishing step is reachable").toBe(true);
  expect(reachableWithout(oas, REVIEW).has(PUBLISH), "without the review the publishing step is unreachable").toBe(
    false,
  );
});

test("the review comes before the publishing step, with the read of the pinned words between them", () => {
  const order = (oas.nodes ?? []).map(refOf);
  expect(order.indexOf(REVIEW)).toBeGreaterThan(order.indexOf(START));
  expect(order.indexOf(REVIEW)).toBeLessThan(order.indexOf(PUBLISH));
  const edges = controlEdges(oas);
  expect(edges.filter((e) => e.from === REVIEW).map((e) => e.to)).toEqual(["read_post_text"]);
  expect(edges.filter((e) => e.to === REVIEW).map((e) => e.from)).toEqual([GATHER]);
  expect(pausesInFrontOf(oas, PUBLISH), "the pack check reaches no pause in front of the publishing step").toEqual([]);
});

test("the walk-back reading turns red for a review placed directly in front of the publishing step", () => {
  const moved = structuredClone(oas);
  moved.control_flow_connections = [
    { from_node: { $component_ref: START }, to_node: { $component_ref: "read_post_text" } },
    { from_node: { $component_ref: "read_post_text" }, to_node: { $component_ref: REVIEW } },
    { from_node: { $component_ref: REVIEW }, to_node: { $component_ref: PUBLISH } },
  ];
  expect(pausesInFrontOf(moved, PUBLISH)).toEqual([REVIEW]);
});

test("the review pins the revision the run started with, and the read and the publishing step take the revision its answer approved", () => {
  const into = dataEdges().filter((e) => e.to === REVIEW);
  expect(into).toEqual([{ from: GATHER, out: "reviewTargets", to: REVIEW, in: "reviewTargets" }]);

  const sources = (to, name) => dataEdges().filter((e) => e.to === to && e.in === name).map((e) => `${e.from}.${e.out}`);
  for (const name of ["postArtifactId", "postRepresentationRevisionId"]) {
    expect(sources(GATHER, name), name).toEqual([`${START}.${name}`]);
  }
  // The answer names the approved revision (publish-the-approved-revision.test.mjs).
  expect(sources("read_post_text", "reviewDecision")).toEqual([`${REVIEW}.reviewDecision`]);
  expect(sources("read_post_text", "postArtifactId"), "the artifact under review").toEqual([`${START}.postArtifactId`]);
  expect(sources("read_post_text", "postRepresentationRevisionId")).toEqual([]);
  expect(sources(PUBLISH, "postArtifactId")).toEqual(["read_post_text.artifactId"]);
  expect(sources(PUBLISH, "postRepresentationRevisionId")).toEqual(["read_post_text.representationRevisionId"]);

  // The set the gather step sends, with its slots filled as the runtime fills them.
  const template = node(GATHER).data.input.reviewTargets;
  const filled = template
    .replace(/\{\{\s*postArtifactId\s*\}\}/g, "art-1")
    .replace(/\{\{\s*postRepresentationRevisionId\s*\}\}/g, "rev-1");
  expect(filled).not.toMatch(/\{\{|\}\}/);
  expect(JSON.parse(filled)).toEqual([{ artifactId: "art-1", representationRevisionId: "rev-1" }]);
});

test("the gather step is a read the host echoes back, and the manifest consumes its tool", () => {
  const gather = node(GATHER);
  expect(gather.component_type).toBe("ApiNode");
  expect(gather.url).toBe("{{CINATRA_BASE_URL}}/api/agents/passthrough");
  expect(gather.data.tool).toBe("artifacts_get");
  expect(gather.data.input.artifactId).toMatch(/^\{\{\s*postArtifactId\s*\}\}$/);
  expect(gather.data.result_input_passthrough).toBe(true);
  expect(consumedPrimitives()).toContain("artifacts_get");
  expect(cinatraOf(gather).riskClass).toBe("read_only");
  expect(cinatraOf(gather).requiresApproval).toBe(false);
  expect(titles(gather.outputs)).toEqual(["reviewTargets"]);
  expect(gather.outputs[0]).toMatchObject({ type: "string", default: "[]" });
});
