// THE REVIEW STEP HANDS ITS TARGET SET TO THE APPLICATION, AND THE PUBLISH STEP
// DECLARES THE SITE WRITE IT CALLS.
//
// A live run paused at `review_post` with no artifact review: the step carried
// the marker `artifactReview.targetsInput` but not `surfaceGateInputs: true`.
// The runtime loader (cinatra-ai/cinatra, docker/wayflow/agent_loader.py,
// `_reconcile_input_message_gates`) gives a gate without that flag a template of
// empty guards, so the pause's message is empty and the value of the input the
// marker names never reaches the application. The application then reads no
// target (packages/agents/src/execution.ts, `resolveDeclaredReviewTargets` over
// the pause's message), refuses the empty set ("targets must be a non-empty
// array") and falls back to an ordinary gate. The answer that comes back from
// that gate is no review answer, so the read of the approved revision refuses.
//
// The publish step: the application uses the person's released publish
// decision for an outward call (wordpress_site_tool_write) only when the step
// that calls it declares the tool in `metadata.cinatra.tools`
// (packages/agents/src/run-action-decision-consumption.ts,
// `action_decision_step_undeclared`).
//
// These cases read the flow file alone and restate the host's rules; they run
// none of the host's readers.

import { expect, test } from "vitest";

import { components, oas } from "./__tests__/oas-contract.mjs";

const refOf = (r) => r?.$component_ref;
const cinatraOf = (c) => c?.metadata?.cinatra ?? {};
const dataEdges = () =>
  (oas.data_flow_connections ?? []).map((e) => ({
    from: refOf(e.source_node),
    out: e.source_output,
    to: refOf(e.destination_node),
    in: e.destination_input,
  }));

// The loader's own rule for the titles it folds into a gate's template.
const GATE_INPUT_TITLE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const markedGates = () =>
  Object.entries(components).filter(([, c]) => {
    const t = cinatraOf(c).artifactReview?.targetsInput;
    return typeof t === "string" && t.length > 0;
  });

/** The message the loader's value-surfacing template renders for a gate, as the
 *  pinned runtime renders it (`"<t>": {% if t %}{{ t | tojson }}{% else %}null{% endif %}`). */
const surfacedMessage = (titles, values) =>
  "{" +
  titles.map((t) => `${JSON.stringify(t)}: ${values[t] ? JSON.stringify(values[t]) : "null"}`).join(", ") +
  "}";

/** The application's reading of a declared target set (artifact-review-target.ts):
 *  a JSON string is parsed; every entry must be exactly { artifactId, representationRevisionId }. */
function readTargets(value) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  expect(Array.isArray(parsed), "the targets are an array").toBe(true);
  expect(parsed.length, "the targets are not empty").toBeGreaterThan(0);
  for (const target of parsed) {
    expect(Object.keys(target).sort()).toEqual(["artifactId", "representationRevisionId"]);
    expect(typeof target.artifactId === "string" && target.artifactId.length > 0).toBe(true);
    expect(typeof target.representationRevisionId === "string" && target.representationRevisionId.length > 0).toBe(true);
  }
  return parsed;
}

test("the flow has a marked review step", () => {
  expect(markedGates().map(([id]) => id)).toEqual(["review_post"]);
});

test("every step with artifactReview.targetsInput sets surfaceGateInputs: true, declares that input once among plain-identifier inputs and has it fed by one data edge (red: the flag missing or not the boolean true, the input undeclared or unfed, a title the loader does not fold, or a template of the pack's own)", () => {
  for (const [id, gate] of markedGates()) {
    const cinatra = cinatraOf(gate);
    const targetsInput = cinatra.artifactReview.targetsInput;
    expect(gate.component_type, id).toBe("InputMessageNode");
    expect(cinatra.surfaceGateInputs, `${id}: the loader surfaces input values only for the boolean true`).toBe(true);
    expect(Object.hasOwn(gate, "message_template"), `${id}: a template of its own is never rewritten`).toBe(false);
    const titles = (gate.inputs ?? []).map((i) => i.title);
    expect(titles.filter((t) => t === targetsInput), id).toEqual([targetsInput]);
    expect(new Set(titles).size, id).toBe(titles.length);
    for (const t of titles) expect(t, id).toMatch(GATE_INPUT_TITLE);
    expect((gate.outputs ?? []).length, `${id}: one answer output`).toBe(1);
    expect(dataEdges().filter((e) => e.to === id && e.in === targetsInput).length, id).toBe(1);
  }
});

test("gather_review_target builds the target set the application accepts: one { artifactId, representationRevisionId } entry naming the post and revision the run started with, which reaches the review step's message intact (red: another shape, an extra key, another source, or a set lost on the way)", () => {
  const [, gate] = markedGates()[0];
  const targetsInput = cinatraOf(gate).artifactReview.targetsInput;
  const [edge] = dataEdges().filter((e) => e.to === "review_post" && e.in === targetsInput);
  expect(edge.from).toBe("gather_review_target");
  const gather = components.gather_review_target;
  expect(edge.out).toBe(targetsInput);
  expect((gather.outputs ?? []).map((o) => o.title)).toContain(targetsInput);
  // The value is the call's own input, echoed back by the host's passthrough.
  expect(gather.data.result_input_passthrough).toBe(true);
  const template = gather.data.input[targetsInput];
  expect(typeof template).toBe("string");
  const fed = Object.fromEntries(dataEdges().filter((e) => e.to === "gather_review_target").map((e) => [e.in, `${e.from}.${e.out}`]));
  expect(fed.postArtifactId).toBe("start.postArtifactId");
  expect(fed.postRepresentationRevisionId).toBe("start.postRepresentationRevisionId");

  const filled = template
    .replace(/\{\{\s*postArtifactId\s*\}\}/g, "art-1")
    .replace(/\{\{\s*postRepresentationRevisionId\s*\}\}/g, "rev-1");
  expect(filled).not.toMatch(/\{\{|\{%/);
  expect(readTargets(filled)).toEqual([{ artifactId: "art-1", representationRevisionId: "rev-1" }]);

  // The pause's message as the loader renders it for this gate, then read as the
  // application reads it: the whole message is a JSON object, its key is the
  // input the marker names, and its value is the same one-target set.
  const titles = (gate.inputs ?? []).map((i) => i.title);
  const message = JSON.parse(surfacedMessage(titles, { [targetsInput]: filled }));
  expect(readTargets(message[targetsInput])).toEqual([{ artifactId: "art-1", representationRevisionId: "rev-1" }]);
});

test("a publishing model step declares in metadata.cinatra.tools every connector tool its recipe calls, so the person's released decision can be used for the site write (red: no tool list, or a list without the write)", () => {
  for (const [id, step] of Object.entries(components)) {
    const cinatra = cinatraOf(step);
    if (cinatra.publishes !== true) continue;
    if (!String(step.url ?? "").includes("/api/llm-bridge")) continue;
    expect(Array.isArray(cinatra.tools), id).toBe(true);
    const called = [...new Set(String(step.data?.system ?? "").match(/\bwordpress_[a-z_]+\b/g) ?? [])].sort();
    expect(called.length, id).toBeGreaterThan(0);
    expect([...cinatra.tools].sort(), id).toEqual(called);
    expect(cinatra.tools, id).toContain("wordpress_site_tool_write");
  }
});
