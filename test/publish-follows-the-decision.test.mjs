// The publish follows the person's decision (cinatra-ai/cinatra#3745, the
// pack's side).
//
// A run of this agent creates a public page on a connected WordPress site on a
// person's behalf. The platform serves a send or publish tool of a run only
// with the person's recorded decision on that run's action. This suite pins the
// two things the FLOW itself owes that rule, over cinatra/oas.json and
// package.json:
//
//   1. The page is created in one step only, and that step is reached only
//      through the steps in front of it. No step is a way round it, no step
//      branches, no other step names a tool of the WordPress connector, and no
//      step names a tool the platform holds for a decision by its name.
//   2. The person's decision stands in front of the page, in the form the pack
//      holds it: either the step declares that it publishes and the
//      application asks on its own card before the step runs, or the step's
//      recipe asks first on the pack's own confirmation screen. The step
//      reaches the site through the host's own tool service, by the two tool
//      names listed below, and the manifest consumes both.
//
// The pack's flow does not evaluate the decision itself, so there is no road
// of its own to keep: the flow and the platform's hold are the two halves.
//
// The pins hold at the base: they guard it. Each test names the change that
// turns it red.
//
// Known limits
//   - A tool name is read as a snake_case word (it has an underscore) or as a
//     name followed directly by "(" in the call data of an ApiNode step. A
//     tool named by one plain word with no parenthesis is not seen.
//   - SITE_TOOLS is the list of the connector's tools the publish step names.
//     A step that names another tool of the connector, for example a tool
//     that writes to the site on its own, changes this list in the same
//     commit.
//   - OUTWARD below is a copy of the platform's list of the tools it holds
//     for a decision by their names. It is a change detector: when the
//     platform changes its list, this one is changed in the same commit.
//   - This package's own CI classifies it as a source mirror and skips the
//     standalone test step; the suite runs where the package is installed.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const root = new URL("../", import.meta.url);
const readJson = (rel) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, root)), "utf8"));
const oas = readJson("cinatra/oas.json");
const manifest = readJson("package.json");

const steps = oas.$referenced_components ?? {};
const refOf = (r) => r?.$component_ref;
const edges = (oas.control_flow_connections ?? []).map((e) => ({
  from: refOf(e.from_node),
  to: refOf(e.to_node),
  branch: e.from_branch,
}));
const into = (id) => edges.filter((e) => e.to === id);
const outOf = (id) => edges.filter((e) => e.from === id);

const START = "start";
const GATHER_REVIEW = "gather_review_target";
const REVIEW = "review_post";
const CHECK_REVIEW = "check_review";
const READ_RECORD = "read_post_record";
const READ_TEXT = "read_post_text";
const WRITE_HTML = "write_post_html";
const PUBLISH = "publish";
const WRITE_BACK = "write_address";
const END = "end";
const CHAIN = [START, GATHER_REVIEW, REVIEW, CHECK_REVIEW, READ_RECORD, READ_TEXT, WRITE_HTML, PUBLISH, WRITE_BACK, END];

// The tools of the WordPress connector the publish step names, and no other step.
const SITE_TOOLS = ["wordpress_site_tool_write", "wordpress_site_tools_list"];

// The tools the platform holds for the person's recorded decision on a run, by name.
const OUTWARD = [
  "agent_creation_request_decide",
  "agent_creation_request_propose",
  "agent_creation_request_retry_publish",
  "agent_registry_publish",
  "agent_run_resume",
  "agent_source_publish",
  "approvals_decide",
  "artifact_source_publish",
  "blog_post_publish_linkedin_publish",
  "email_outreach_send_initial_cancel",
  "email_outreach_send_initial_start",
  "email_outreach_send_test_start",
  "email_outreach_system_jobs_initial_send_run",
  "email_outreach_system_process_due_follow_ups",
  "email_send",
  "email_test_delivery_run_send",
  "gmail_email_send",
  "linkedin_post_publish",
  "permissions_members_invite",
  "skill_source_publish",
  "social_media_publish",
];

const TEMPLATE = /\{\{[\s\S]*?\}\}|\{#[\s\S]*?#\}/g;
const SNAKE_NAME = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;
const CALLED_NAME = /\b([A-Za-z_][A-Za-z0-9_]*)\(/g;

function stringsOf(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsOf(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) stringsOf(v, out);
  return out;
}

/** Every tool-shaped name in a step's call data, template slots and comments left out. */
function namesIn(step) {
  const names = new Set();
  for (const raw of stringsOf(step.data ?? {})) {
    const text = raw.replace(TEMPLATE, " ");
    for (const m of text.matchAll(SNAKE_NAME)) names.add(m[0]);
    for (const m of text.matchAll(CALLED_NAME)) names.add(m[1]);
  }
  if (typeof step.data?.tool === "string") names.add(step.data.tool);
  return [...names].sort();
}

const apiSteps = () => Object.entries(steps).filter(([, c]) => c.component_type === "ApiNode");
const isModelStep = (c) => /\/api\/llm-bridge$/.test(c.url ?? "");
const publish = steps[PUBLISH];

// ---------------------------------------------------------------------------
// 1. One step creates the page, and it is reached only through the steps in front of it
// ---------------------------------------------------------------------------

test("the flow is the one chain of steps this suite names, with no branch and no nested flow (red: a step added or removed, an edge around the publish step, a branching step, a nested flow or a second pause)", () => {
  const nodeIds = (oas.nodes ?? []).map(refOf);
  expect([...nodeIds].sort()).toEqual([...CHAIN].sort());
  expect(Object.keys(steps).sort()).toEqual([...CHAIN].sort());
  expect(refOf(oas.start_node)).toBe(START);
  expect(edges.map((e) => `${e.from}>${e.to}`)).toEqual(CHAIN.slice(1).map((id, i) => `${CHAIN[i]}>${id}`));
  expect(edges.filter((e) => e.branch !== undefined)).toEqual([]);
  const odd = Object.values(steps).filter((c) =>
    ["BranchingNode", "FlowNode", "Flow", "ParallelFlowNode"].includes(c.component_type),
  );
  expect(odd).toEqual([]);
  // The one pause is the review in front of the read (review-before-publish.test.mjs).
  expect(
    Object.entries(steps).filter(([, c]) => c.component_type === "InputMessageNode").map(([id]) => id),
  ).toEqual([REVIEW]);
  expect(steps[START].component_type).toBe("StartNode");
  expect(steps[END].component_type).toBe("EndNode");
});

test("the publish step is reached only from the HTML step, which is reached only from the read of the pinned words; the two are the only model steps, and only the publish step writes (red: a second way into the publish step, a third model step, or a writing HTML step)", () => {
  expect(into(PUBLISH).map((e) => e.from)).toEqual([WRITE_HTML]);
  expect(into(WRITE_HTML).map((e) => e.from)).toEqual([READ_TEXT]);
  expect(outOf(WRITE_HTML).map((e) => e.to)).toEqual([PUBLISH]);
  expect(outOf(PUBLISH).map((e) => e.to)).toEqual([WRITE_BACK]);
  expect(apiSteps().filter(([, c]) => isModelStep(c)).map(([id]) => id).sort()).toEqual([PUBLISH, WRITE_HTML].sort());
  expect(steps[WRITE_HTML].metadata?.cinatra?.riskClass).toBe("read_only");
  expect(steps[WRITE_HTML].metadata?.cinatra?.publishes).toBe(false);
  expect(publish.component_type).toBe("ApiNode");
  expect(publish.metadata?.cinatra?.riskClass).toBe("write");
});

test("only the publish step names a tool of the WordPress connector, and it names the tools of SITE_TOOLS alone; no step names a tool the platform holds by its name (red: a connector tool named by any other step or another connector tool named by the publish step, or a held tool named by any step)", () => {
  for (const [id, step] of apiSteps()) {
    const names = namesIn(step);
    expect(names.filter((name) => name.startsWith("wordpress_")), id).toEqual(id === PUBLISH ? SITE_TOOLS : []);
    expect(names.filter((name) => OUTWARD.includes(name)), id).toEqual([]);
  }
});

test("the steps around the publish step are the host's own reads, the read of the approved revision through the pack's declared tool, and the write-back, none of them a send or a publish (red: another tool or another passthrough step)", () => {
  const tools = Object.fromEntries(
    apiSteps()
      .filter(([, c]) => !isModelStep(c))
      .map(([id, c]) => [id, c.data?.tool]),
  );
  expect(tools).toEqual({
    [GATHER_REVIEW]: "artifacts_get",
    [CHECK_REVIEW]: "extension_tool",
    [READ_RECORD]: "artifacts_get",
    [READ_TEXT]: "extension_tool",
    [WRITE_BACK]: "objects_update",
  });
  for (const id of [GATHER_REVIEW, CHECK_REVIEW, READ_RECORD, READ_TEXT]) {
    expect(steps[id].metadata.cinatra.riskClass).toBe("read_only");
  }
  expect(steps[CHECK_REVIEW].data.input.name).toBe("approved_post_text");
  expect(steps[CHECK_REVIEW].data.input.input.checkOnly, "the check reads nothing").toBe(true);
  expect(steps[READ_TEXT].data.input.name).toBe("approved_post_text");
  expect(Object.hasOwn(steps[READ_TEXT].data.input.input, "checkOnly")).toBe(false);
});

// ---------------------------------------------------------------------------
// 2. The decision stands in front of the page
// ---------------------------------------------------------------------------

const recipe = () => String(publish.data?.system ?? "");

test("the person's decision stands in front of the page, held by the application or asked by the step's own screen (red: neither form, both forms at once, or the confirmation after the site call)", () => {
  const cinatra = publish.metadata.cinatra;
  const hitl = oas.metadata?.cinatra?.hitlScreens;
  if (cinatra.publishes === true) {
    // The application holds the run in front of this step and asks on its own
    // card; the recipe asks nothing and the pack names no screen of its own.
    expect(Array.isArray(cinatra.publishRows)).toBe(true);
    expect(cinatra.publishRows.length).toBeGreaterThanOrEqual(1);
    expect(cinatra.publishRows.length).toBeLessThanOrEqual(4);
    expect(recipe()).not.toMatch(/INTERRUPT/);
    expect(hitl ?? []).toEqual([]);
    return;
  }
  expect(cinatra.publishes).toBeUndefined();
  expect(cinatra.publishRows).toBeUndefined();
  expect(Array.isArray(hitl) && hitl.length === 1).toBe(true);
  expect(recipe()).toMatch(/INTERRUPT/);
  const confirmation = recipe().search(/^### Step \d+ — the confirmation/m);
  const create = recipe().search(/^### Step \d+ — create the page/m);
  expect(confirmation).toBeGreaterThan(0);
  expect(create).toBeGreaterThan(confirmation);
});

test("the publish step reaches the site through the host's own tool service, by the two tool names of SITE_TOOLS, and the manifest consumes both and depends on the connector (red: a toolbox on the step, a tool list that holds more than SITE_TOOLS, another tool name, a tool the manifest does not consume or a connector it does not depend on)", () => {
  expect(Object.hasOwn(publish.metadata.cinatra, "toolboxes")).toBe(false);
  // A list the step declares for its tool offer holds the site tools and no other.
  if (Object.hasOwn(publish.metadata.cinatra, "tools")) {
    expect([...publish.metadata.cinatra.tools].sort()).toEqual(SITE_TOOLS);
  }
  expect(namesIn(publish).filter((name) => name.startsWith("wordpress_"))).toEqual(SITE_TOOLS);
  for (const name of SITE_TOOLS) expect(recipe()).toContain(name);
  const consumed = (manifest.cinatra?.consumes ?? []).map((c) => c.primitive);
  for (const name of SITE_TOOLS) expect(consumed).toContain(name);
  expect(consumed.filter((name) => name.startsWith("wordpress_")).sort()).toEqual(SITE_TOOLS);
  const dependsOn = (manifest.cinatra?.dependencies ?? []).map((d) => d.packageName);
  expect(dependsOn).toContain("@cinatra-ai/wordpress-mcp-connector");
});
