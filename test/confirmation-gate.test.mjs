// THE CONFIRMATION IS A GATE OF THE FLOW, NOT A SENTENCE OF A PROMPT
// (cinatra-ai/cinatra#3564). The host raises a pack's screen in exactly one
// way: an authored InputMessageNode, whose declared inputs are fed by data
// edges and whose ONE string output carries the person's answer back into the
// flow. A confirmation that lives only as prose inside the orchestration's
// instructions is never raised, so the post went out without the screen.
//
// These arms pin that gate, its place on the only road into `publish`, the
// answer that road carries, and the pure module the screen builds it with.

import { expect, test } from "vitest";

import {
  manifest,
  node,
  oas,
  oasText,
  source,
  titles,
} from "./__tests__/oas-contract.mjs";

const RENDERER_ID = "@cinatra-ai/blog-wordpress-publish-agent:draft-confirm";
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

// The decision module is loaded when an arm runs, so a missing module reads
// RED on the arms that need it and never hides the flow's own arms.
const decisionModule = () =>
  import("../src/renderers/draft-confirm-decision.ts");

const gates = () =>
  Object.entries(oas.$referenced_components ?? {}).filter(
    ([, c]) => c?.component_type === "InputMessageNode",
  );

const controlEdges = () =>
  (oas.control_flow_connections ?? []).map((e) => [
    e.from_node?.$component_ref,
    e.to_node?.$component_ref,
  ]);

/** Whether `to` is reachable from `from` on the control edges, never entering `skip`. */
function reachable(from, to, skip) {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const at = queue.shift();
    if (at === to) return true;
    for (const [a, b] of controlEdges()) {
      if (a !== at || b === skip || seen.has(b)) continue;
      seen.add(b);
      queue.push(b);
    }
  }
  return false;
}

const dataEdgeInto = (dn, di) =>
  (oas.data_flow_connections ?? []).filter(
    (e) =>
      e.destination_node?.$component_ref === dn && e.destination_input === di,
  );

// ---------------------------------------------------------------------------
// (i) one gate, and every road from the start into `publish` passes through it
// ---------------------------------------------------------------------------

test("the flow carries exactly one InputMessageNode gate", () => {
  expect(gates().map(([id]) => id)).toHaveLength(1);
});

test("every control path from the start to publish passes through the gate", () => {
  const [[gateId] = []] = gates();
  expect(gateId, "a gate exists").toBeTruthy();
  expect(
    reachable("start", "publish"),
    "publish is reached from the start at all",
  ).toBe(true);
  expect(
    reachable("start", "publish", gateId),
    "without the gate there is no road into publish",
  ).toBe(false);
  const into = controlEdges().filter(([, b]) => b === "publish");
  expect(into, "the gate is the only control edge into publish").toEqual([
    [gateId, "publish"],
  ]);
});

// ---------------------------------------------------------------------------
// (ii) the gate has the shape the host mounts
// ---------------------------------------------------------------------------

test("the gate raises this pack's screen as an approval gate", () => {
  const [[, gate] = []] = gates();
  expect(gate, "a gate exists").toBeTruthy();
  const meta = gate.metadata?.cinatra ?? {};
  expect(meta.renderer).toBe(RENDERER_ID);
  expect(meta.renderer).toBe(oas.metadata.cinatra.hitlScreens[0]);
  expect(meta.renderer).toBe(manifest.cinatra.fieldRenderers[0].id);
  expect(meta.surfaceGateInputs).toBe(true);
  expect(meta.requiresApproval).toBe(true);
  expect(meta.riskClass).toBe("approval");
});

test("the gate returns exactly one string output and carries no message_template", () => {
  const [[, gate] = []] = gates();
  expect(gate, "a gate exists").toBeTruthy();
  expect(gate.outputs).toEqual([{ title: "userResponse", type: "string" }]);
  expect(gate.message_template ?? null).toBeNull();
});

test("every declared gate input is a unique plain identifier fed by its edge", () => {
  const [[gateId, gate] = []] = gates();
  expect(gate, "a gate exists").toBeTruthy();
  const declared = titles(gate.inputs);
  for (const t of declared) {
    expect(IDENTIFIER.test(t), `${t} is a plain identifier`).toBe(true);
  }
  expect(new Set(declared).size, "no title repeats").toBe(declared.length);
  const expected = {
    postArtifactId: ["start", "postArtifactId"],
    postRepresentationRevisionId: ["start", "postRepresentationRevisionId"],
    wordpressInstanceId: ["start", "wordpressInstanceId"],
    postText: ["read_post_text", "text"],
    postArtifact: ["read_post_record", "artifact"],
  };
  expect([...declared].sort()).toEqual(Object.keys(expected).sort());
  for (const [input, [source, output]] of Object.entries(expected)) {
    const edges = dataEdgeInto(gateId, input);
    expect(edges, `${gateId}.${input} has exactly one inbound edge`).toHaveLength(1);
    expect(edges[0].source_node.$component_ref).toBe(source);
    expect(edges[0].source_output).toBe(output);
  }
});

// ---------------------------------------------------------------------------
// (iii) the answer rides into `publish`; the prose INTERRUPT is gone
// ---------------------------------------------------------------------------

test("publish takes the gate's answer as its confirmation input", () => {
  const [[gateId] = []] = gates();
  expect(gateId, "a gate exists").toBeTruthy();
  const publish = node("publish");
  const confirmation = (publish.inputs ?? []).find(
    (i) => i.title === "confirmation",
  );
  expect(confirmation, "publish declares confirmation").toBeTruthy();
  expect(confirmation.type).toBe("string");
  const edges = dataEdgeInto("publish", "confirmation");
  expect(edges).toHaveLength(1);
  expect(edges[0].source_node.$component_ref).toBe(gateId);
  expect(edges[0].source_output).toBe("userResponse");
});

test("publish renders the answer and posts only on a confirmation of this exact reference", () => {
  const { system, user } = node("publish").data;
  expect(user, "the hint names the answer").toMatch(
    /pyagentspec-input-hint:[^#]*\{\{ confirmation \}\}[^#]*#\}/,
  );
  expect(user, "the answer is rendered to the step").toContain(
    "- confirmation: {{ confirmation }}",
  );
  const step1 = system.slice(
    system.indexOf("### Step 1"),
    system.indexOf("### Step 2"),
  );
  expect(step1).toContain("parses as a JSON object whose `approved` is `true`");
  expect(step1).toContain(
    "whose `postArtifactId` and `postRepresentationRevisionId` equal this step's own `postArtifactId` and `postRepresentationRevisionId`",
  );
  for (const refused of [
    "a decline (`approved` false)",
    "a reference that differs from this step's inputs",
    "an empty answer",
    "text that is not a JSON object",
    "the bare approval marker `[Approved by operator]`",
  ]) {
    expect(step1, `${refused} is not a confirmation`).toContain(refused);
  }
  expect(step1).toContain("publish nothing");
  expect(step1).toContain("`approved: false`");
  expect(step1).toContain("`addressPatch: {}`");
});

test("both buttons of the screen hand the host the decision module's answer", () => {
  // The renderer imports the host's first-party peers, which a package-only
  // install does not carry, so it is read as source: each button calls
  // `decide`, and `decide` hands onChange the module's answer for the
  // screen's own reference, never a hand-built object without userResponse.
  const tsx = source("src/renderers/draft-confirm.tsx");
  expect(tsx).toMatch(/from "\.\/draft-confirm-decision"/);
  expect(tsx).toMatch(/onClick=\{decide\(false\)\}/);
  expect(tsx).toMatch(/onClick=\{decide\(true\)\}/);
  expect(tsx.replace(/\s+/g, " ")).toContain(
    "onChangeRef.current( draftConfirmDecision( approved, v.postArtifactId, v.postRepresentationRevisionId, ), )",
  );
  expect(tsx.match(/onChangeRef\.current\(/g), "onChange is called in one place").toHaveLength(1);
});

test("the orchestration no longer claims to emit the screen itself", () => {
  expect(oasText().includes("Emit INTERRUPT")).toBe(false);
  expect(
    (node("publish").metadata?.cinatra?.description ?? "").includes(
      "A2UI INTERRUPT",
    ),
  ).toBe(false);
});

// ---------------------------------------------------------------------------
// (iv) the screen's decision module: the answer, the title and the excerpt
// ---------------------------------------------------------------------------

test("a confirm carries a userResponse naming the decision and the reference", async () => {
  const { draftConfirmDecision } = await decisionModule();
  const out = draftConfirmDecision(true, "art-1", "rev-7");
  expect(out.approved).toBe(true);
  expect(out.postArtifactId).toBe("art-1");
  expect(out.postRepresentationRevisionId).toBe("rev-7");
  expect(typeof out.userResponse).toBe("string");
  expect(JSON.parse(out.userResponse)).toEqual({
    approved: true,
    postArtifactId: "art-1",
    postRepresentationRevisionId: "rev-7",
  });
});

test("a decline carries a userResponse naming the decline and the reference", async () => {
  const { draftConfirmDecision } = await decisionModule();
  const out = draftConfirmDecision(false, "art-1", "rev-7");
  expect(out.approved).toBe(false);
  expect(JSON.parse(out.userResponse)).toEqual({
    approved: false,
    postArtifactId: "art-1",
    postRepresentationRevisionId: "rev-7",
  });
});

test("the screen's title comes from the first heading line of the pinned words", async () => {
  const { screenTitle } = await decisionModule();
  expect(
    screenTitle({
      postText: "Intro line\n\n## The Real Title\n\nBody\n# Later heading",
      postArtifact: { title: "Record title" },
    }),
  ).toBe("The Real Title");
  expect(
    screenTitle({
      postText: "No heading here.\nJust words.",
      postArtifact: { title: "Record title" },
    }),
    "an unheaded text falls back to the artifact's record",
  ).toBe("Record title");
  expect(
    screenTitle({ postText: "# Learning C#" }),
    "a literal # ending the title is kept",
  ).toBe("Learning C#");
  expect(
    screenTitle({ postText: "## Closed Heading ##" }),
    "a closing marker run after whitespace is dropped",
  ).toBe("Closed Heading");
  expect(
    screenTitle({ title: "Given", postText: "# Other", postArtifact: {} }),
    "a title the screen was given is kept",
  ).toBe("Given");
});

test("the screen's excerpt is the first 400 characters of the pinned words", async () => {
  const { screenExcerpt } = await decisionModule();
  const long = "a".repeat(390) + "b".repeat(20);
  expect(screenExcerpt({ postText: long })).toBe(
    "a".repeat(390) + "b".repeat(10),
  );
  expect(screenExcerpt({ postText: long })).toHaveLength(400);
  expect(screenExcerpt({ postText: "Short text." })).toBe("Short text.");
  expect(
    screenExcerpt({ excerpt: "Given", postText: long }),
    "an excerpt the screen was given is kept",
  ).toBe("Given");
});
