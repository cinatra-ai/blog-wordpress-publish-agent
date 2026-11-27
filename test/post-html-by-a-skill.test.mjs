// THE APPROVED WORDS ARE TURNED INTO HTML BY A SKILL, AND THE CARD SHOWS THAT
// HTML (cinatra-ai/cinatra#4893, part A).
//
// WordPress stores a post's text as it is given, so markdown sent as is shows
// headings and links as raw symbols. The conversion is agent work, not code:
// one model step, write_post_html, guided by the skill this package declares
// (@cinatra-ai/blog-post-html-skill), stands between the read of the approved
// words and the publish card. The card shows its answer in its own row, and the
// publish step sends exactly that answer. So the person approves the bytes that
// go out.
//
// How the application delivers the skill, read on cinatra-ai/cinatra main:
//   - the model bridge resolves the package's ONE role-less runtime dependency
//     of kind skill by the step's agent_id
//     (resolveDeclaredSkillEdgeForExtensionDir) and offers it to the model as
//     the built-in skill-read tool;
//   - a step that declares metadata.cinatra.tools gets that list as a ceiling,
//     and a ceiling (even an empty one) also removes the built-in skill-read
//     tool (restrictStepToolOffers; "the empty ceiling also drops the built-in
//     skill-delivery tools" in step-tool-offer-policy.test.ts). So the HTML step
//     declares NO tool list, and data.toolbox_ids: [] keeps every MCP server and
//     connector tool away from it.
//
// These cases read the flow and the manifest; they do not run the bridge.

import { expect, test } from "vitest";

import { manifest, node, oas, titles } from "./__tests__/oas-contract.mjs";

const HTML_STEP = "write_post_html";
const READ = "read_post_text";
const RECORD = "read_post_record";
const PUBLISH = "publish";
// The name ends in "-skill" (singular): that is the product's rule for a skill extension
// (its naming test accepts a folder that ends in "-skill", and every pinned skill extension
// is named so, e.g. @cinatra-ai/web-research-skill). The "-skills" pattern in this
// repository's copy of extension-kind-gate.mjs is an older form; that check only reads
// this package, which is an agent, and never resolves a dependency.
const SKILL = "@cinatra-ai/blog-post-html-skill";
const AGENT_DIR = "blog-wordpress-publish-agent";

const refOf = (r) => r?.$component_ref;
const step = () => node(HTML_STEP);
const into = (id, name) =>
  (oas.data_flow_connections ?? [])
    .filter((e) => refOf(e.destination_node) === id && e.destination_input === name)
    .map((e) => `${refOf(e.source_node)}.${e.source_output}`);

test("the package declares exactly one role-less runtime dependency of kind skill, on the HTML skill (red: none, a second one, a role, or another kind of edge)", () => {
  const skillEdges = (manifest.cinatra?.dependencies ?? []).filter((d) => d.kind === "skill");
  expect(skillEdges).toEqual([
    {
      packageName: SKILL,
      edgeType: "runtime",
      versionConstraint: { kind: "semver-range", range: "*" },
      requirement: "required",
      kind: "skill",
    },
  ]);
  expect(Object.hasOwn(skillEdges[0], "role"), "the edge carries no role").toBe(false);
});

test("the package ships no skill of its own (red: a SKILL.md or a skills folder in the package)", () => {
  expect(manifest.files).toEqual(["cinatra"]);
  expect(JSON.stringify(manifest)).not.toMatch(/SKILL\.md/);
});

test("the HTML step sits between the reads behind the review and the publish step, on the only way between them (red: another order, or a way round it)", () => {
  const order = (oas.nodes ?? []).map(refOf);
  expect(order.indexOf(RECORD)).toBe(order.indexOf(READ) + 1);
  expect(order.indexOf(HTML_STEP)).toBe(order.indexOf(RECORD) + 1);
  expect(order.indexOf(PUBLISH)).toBe(order.indexOf(HTML_STEP) + 1);
  const edges = (oas.control_flow_connections ?? []).map((e) => `${refOf(e.from_node)}>${refOf(e.to_node)}`);
  expect(edges).toContain(`${READ}>${RECORD}`);
  expect(edges).toContain(`${RECORD}>${HTML_STEP}`);
  expect(edges).toContain(`${HTML_STEP}>${PUBLISH}`);
  expect(edges).not.toContain(`${READ}>${PUBLISH}`);
  expect(edges).not.toContain(`${RECORD}>${PUBLISH}`);
});

test("the HTML step is a model step of this agent that the bridge can give its skill: agent_id, the model block, and no tool list (red: another agent id, no cinatra_llm, or a declared tool list that would remove the skill)", () => {
  const s = step();
  expect(s.component_type).toBe("ApiNode");
  expect(s.url).toBe("{{CINATRA_BASE_URL}}/api/llm-bridge");
  expect(s.data.agent_id, "the bridge finds the skill by this id").toBe(AGENT_DIR);
  expect(s.data.cinatra_llm).toEqual({ preferredProvider: "openai", preferredModel: "gpt-5.5" });
  expect(
    Object.hasOwn(s.metadata.cinatra, "tools"),
    "no metadata.cinatra.tools: a declared list, even an empty one, also removes the skill-read tool",
  ).toBe(false);
  expect(s.metadata.cinatra.description).toMatch(/declares NO metadata\.cinatra\.tools/);
  expect(s.metadata.cinatra.description).toMatch(/also removes the application's built-in skill-read tool/);
});

test("the HTML step is offered no connector or MCP tool and writes nothing (red: a toolbox, a toolboxes declaration, a passthrough tool, or a step that publishes or writes)", () => {
  const s = step();
  expect(s.data.toolbox_ids, "an empty toolbox: no MCP server, no connector tool").toEqual([]);
  expect(Object.hasOwn(s.metadata.cinatra, "toolboxes")).toBe(false);
  expect(Object.hasOwn(s.data, "tool")).toBe(false);
  expect(s.metadata.cinatra.publishes).toBe(false);
  expect(s.metadata.cinatra.riskClass).toBe("read_only");
  expect(s.metadata.cinatra.requiresApproval).toBe(false);
  expect(JSON.stringify(s)).not.toMatch(/wordpress_|objects_|artifacts_|artifact_content_read/);
});

test("the HTML step takes the approved words and the post's record and answers postTitle and postHtml, and its prompt names the skill and forbids changing a word (red: another input, another output, or a prompt without the skill)", () => {
  const s = step();
  expect(titles(s.inputs)).toEqual(["postText", "postRecord"]);
  expect(titles(s.outputs)).toEqual(["postHtml", "postTitle"]);
  expect(into(HTML_STEP, "postText")).toEqual([`${READ}.text`]);
  expect(into(HTML_STEP, "postRecord")).toEqual([`${RECORD}.artifact`]);
  expect(s.data.user).toMatch(/- postText: \{\{ postText \}\}/);
  expect(s.data.user).toMatch(/- postRecord: \{\{ postRecord \| tojson \}\}/);
  expect(s.data.system).toMatch(/blog-post-html/);
  expect(s.data.system).toMatch(/Return a single JSON object \{postTitle, postHtml\}/);
  expect(s.data.system).toMatch(/never change, add, remove or reorder a word of `postText`/);
});

// THE PAGE'S TITLE IS NAMED BY THIS STEP, FROM THE RECORD READ AFTER THE APPROVAL.
// The title is agent work, not code: the rules are in the step's prompt, so these
// cases pin the prompt's rules (the model is not run here). The card shows the
// title the step answers and the publish step sends exactly that title, so the
// person sees what goes out.
test("the HTML step's prompt gives the title rules: the record's trimmed title first, else a leading level-one heading, never a section heading, else empty, and never a re-worded title (red: a rule gone from the prompt)", () => {
  const system = step().data.system;
  expect(system).toMatch(/When `postRecord\.title` is a string with anything in it besides white space, `postTitle` is that string with the white space around it removed/);
  expect(system).toMatch(/Otherwise, when the first line of `postText` that is not blank[^]*?is a level-one heading[^]*?`postTitle` is that heading's text/);
  expect(system).toMatch(/Otherwise `postTitle` is the empty string\. A `## ` heading, or a heading of any other level, is never a title\./);
  expect(system).toMatch(/never re-word, shorten, translate, complete or invent a title/);
  expect(system, "the title is not part of the HTML").toMatch(/with no title, no wrapper/);
});

test("the title the step answers is the title the card shows and the publish step sends, and the record reaches no step but this one (red: a title from another step, or a record fed to the publish step)", () => {
  expect(into(PUBLISH, "postTitle")).toEqual([`${HTML_STEP}.postTitle`]);
  const recordTargets = (oas.data_flow_connections ?? [])
    .filter((e) => refOf(e.source_node) === RECORD)
    .map((e) => `${refOf(e.destination_node)}.${e.destination_input}`);
  expect(recordTargets).toEqual([`${HTML_STEP}.postRecord`]);
  expect(node(PUBLISH).metadata.cinatra.publishRows[0]).toEqual({ label: "Title", input: "postTitle" });
  expect(titles(node(READ).outputs), "the read of the words answers no title").not.toContain("title");
});

test("the card shows the HTML in its own row, bound to postHtml, beside the title and the approved words (red: no HTML row, or a row bound to another input)", () => {
  expect(node(PUBLISH).metadata.cinatra.publishRows).toEqual([
    { label: "Title", input: "postTitle" },
    { label: "Post text", input: "postText" },
    { label: "Post HTML", input: "postHtml" },
  ]);
  expect(into(PUBLISH, "postHtml")).toEqual([`${HTML_STEP}.postHtml`]);
});

test("the publish step sends postHtml unchanged as the page's body, and its prompt says so (red: postText as the body, a conversion of its own, or an empty body sent)", () => {
  const publish = node(PUBLISH);
  expect(titles(publish.inputs)).toContain("postHtml");
  const system = publish.data.system;
  expect(system).toMatch(/This is the ONLY body you publish, and you send it unchanged\./);
  expect(system).toMatch(/You do not send them: the body is `postHtml`\./);
  expect(system).toMatch(/carrying postTitle as the title, postHtml unchanged as the body/);
  expect(system).not.toMatch(/postText as the body/);
  expect(system).toMatch(/you convert nothing yourself/);
  expect(system).toMatch(/When `postHtml` is empty[^]*?Publish nothing/);
  expect(system).toMatch(/Never send `postText` in its place/);
  expect(publish.data.user).toMatch(/- postHtml: \{\{ postHtml \}\}/);
});
