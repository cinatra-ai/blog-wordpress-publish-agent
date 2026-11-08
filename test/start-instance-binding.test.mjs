// THE START INPUT THE HOST BINDS A RUN'S SITE CONNECTION FROM
// (cinatra-ai/cinatra#4220, cinatra-ai/cinatra#4313).
//
// The orchestration reaches the site only through the WordPress connector's
// governed site calls (`wordpress_site_tools_list`, `wordpress_site_tool_call`).
// The application refuses such a call from an agent run unless the run carries
// a connector-instance pin. The binding of cinatra-ai/cinatra#4220 (pull
// request cinatra-ai/cinatra#4258) derives that pin at dispatch from ONE start
// input, named `instanceId` — the name the WordPress agent already starts with.
// A start input under any other name leaves the run unpinned, and every site
// call of the run is refused before it reaches the site.
//
// So the connected site is the start input `instanceId`, it reaches the
// orchestration under that name, the site calls and the confirmation name it,
// and the old name `wordpressInstanceId` is gone from everything this package
// ships.
//
// Every test below fails against a flow and a card that still use the old
// name.
//
// WHAT THE CARD TESTS CHECK, AND WHAT THEY DO NOT. The confirmation card is
// drawn once per value by react-dom's client renderer into a jsdom document,
// inside one act() (the first render, its effects and the updates they cause).
// On that drawn document each card test checks these named facts only:
//   1. the Site line: the innermost elements whose text contains "Site:" are
//      exactly one element reading `Site: <the value's instanceId>`, or none
//      when the value has no instanceId;
//   2. the value of the old key `wordpressInstanceId`, when the value carries
//      one, is nowhere in the card's text;
//   3. one enabled button reads "Publish to WordPress" and one "Do not
//      publish"; pressing them answers `{ approved, postArtifactId,
//      postRepresentationRevisionId }` with the value's post and revision and
//      no other key.
// The tests do NOT prove the whole page a person sees. Out of their scope:
// the rest of the card's markup, text, attributes and styles; timers and any
// update after the first act(); hover, focus, keyboard and later props; the
// host's real primitives (they are mocked below); and anything that depends on
// a real browser (layout, CSS, shadow trees, the page outside the card).
// Those belong to a check on the real surface (a picture round), not to this
// suite.

import { expect, test, vi } from "vitest";

import {
  bridgeNode,
  manifest,
  node,
  oas,
  oasText,
  source,
  titles,
} from "./__tests__/oas-contract.mjs";

// The host's shared primitives are not installed with this package; each is
// mocked as a plain component that draws one element (`button` for Button,
// `div` for the others) and passes it every prop, so a button's `onClick` and
// `disabled` reach the drawn button.
vi.mock("@cinatra-ai/design-primitives", async () => {
  const { createElement } = await import("react");
  const primitive = (tag) => (props) => createElement(tag, props);
  return {
    Button: primitive("button"),
    Card: primitive("div"),
    CardContent: primitive("div"),
    CardFooter: primitive("div"),
    CardHeader: primitive("div"),
    CardTitle: primitive("div"),
  };
});

import { JSDOM } from "jsdom";
import { act, createElement } from "react";

import DraftConfirmRenderer from "../src/renderers/draft-confirm.tsx";

// react-dom reads `window` and `document` when it loads, so the document is
// set first. The suite runs in Node; jsdom and react-dom are devDependencies.
const { window } = new JSDOM("<!doctype html><html><head></head><body></body></html>");
globalThis.window = window;
globalThis.document = window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");

const OLD = "wordpressInstanceId";
const REFERENCE = {
  postArtifactId: "artifact-1",
  postRepresentationRevisionId: "revision-1",
};
const REFERENCE_2 = {
  postArtifactId: "artifact-2",
  postRepresentationRevisionId: "revision-2",
};
// Two posts, each with its own connected site: a card or a button that holds
// one post's values in its code answers wrongly for the other.
const POSTS = [
  [REFERENCE, "wp-1"],
  [REFERENCE_2, "wp-2"],
];
// The rest of a confirmation value as the flow emits it (and as a run parked
// under 0.4.x holds it).
const ABOUT = { title: "A first post", excerpt: "Its opening lines." };

/** The shape of a value's site keys, as the failure labels name it. */
const shapeOf = (value) =>
  "instanceId" in value && OLD in value
    ? "both keys"
    : "instanceId" in value
      ? "instanceId"
      : OLD in value
        ? "only the old key"
        : "no site key";

/** The text of each innermost element whose text contains "Site:". */
const siteLines = (container) =>
  [...container.querySelectorAll("*")]
    .filter(
      (el) =>
        el.textContent.includes("Site:") &&
        ![...el.children].some((child) => child.textContent.includes("Site:")),
    )
    .map((el) => el.textContent.trim());

/**
 * Draw the card for one value and check facts 1 to 3 of the header. `site`
 * is the one site the Site line must name, or null for no Site line.
 */
async function check(value, site) {
  const shape = shapeOf(value);
  const answers = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        createElement(DraftConfirmRenderer, {
          fieldName: "confirmation",
          schema: {},
          value,
          onChange: (answer) => answers.push(answer),
          context: {},
        }),
      );
    });
    expect(siteLines(container), `the Site line for a value with ${shape}`).toStrictEqual(
      site === null ? [] : [`Site: ${site}`],
    );
    if (OLD in value) {
      expect(
        container.textContent.includes(value[OLD]),
        `the card's text names the old key's value for a value with ${shape}`,
      ).toBe(false);
    }
    const press = async (label) => {
      const buttons = [...container.querySelectorAll("button")].filter(
        (b) => b.textContent.trim() === label,
      );
      expect(buttons.length, `one button reads "${label}" for a value with ${shape}`).toBe(1);
      expect(buttons[0].disabled, `"${label}" is enabled for a value with ${shape}`).toBe(false);
      await act(async () => {
        buttons[0].click();
      });
    };
    await press("Publish to WordPress");
    await press("Do not publish");
    const { postArtifactId, postRepresentationRevisionId } = value;
    expect(answers, `the answers of both buttons for a value with ${shape}`).toStrictEqual([
      { approved: true, postArtifactId, postRepresentationRevisionId },
      { approved: false, postArtifactId, postRepresentationRevisionId },
    ]);
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
}

/**
 * Check the card for one confirmation value and the card for the same value
 * without its two site keys: the first names `site` (null for none), the
 * second names none.
 */
async function draw(value, site) {
  const { [OLD]: _old, instanceId: _ignored, ...bare } = value;
  await check(value, site);
  await check(bare, null);
}

/** The type each declaration named instanceId in a list of inputs carries. */
const instanceIdTypes = (list) =>
  (list ?? []).filter((e) => e.title === "instanceId").map((e) => e.type);

/** A template with its `{# ... #}` comments removed: what the model reads. */
const withoutComments = (template) => template.replace(/\{#[\s\S]*?#\}/g, "");

test("the connected site is the start input instanceId, the one name the host binds a run's connection from", () => {
  const start = node("start");
  expect(start.metadata.cinatra.required, "the start step's required list").toEqual([
    "postArtifactId",
    "postRepresentationRevisionId",
    "instanceId",
  ]);
  expect(titles(start.inputs)).toContain("instanceId");
  expect(titles(oas.inputs)).toContain("instanceId");
  expect(
    instanceIdTypes(start.inputs),
    "the start step's declaration of instanceId",
  ).toEqual(["string"]);
  expect(
    instanceIdTypes(oas.inputs),
    "the flow's declaration of instanceId",
  ).toEqual(["string"]);
});

test("the start input reaches the orchestration step on one edge under the same name", () => {
  const edges = oas.data_flow_connections.filter(
    (e) =>
      e.source_node.$component_ref === "start" &&
      e.source_output === "instanceId",
  );
  expect(
    edges.length,
    "edges from the start step's instanceId output",
  ).toBe(1);
  expect(edges[0].destination_node.$component_ref).toBe("publish");
  expect(edges[0].destination_input).toBe("instanceId");
  const publish = bridgeNode();
  expect(publish.id).toBe("publish");
  expect(titles(publish.inputs)).toContain("instanceId");
  expect(
    instanceIdTypes(publish.inputs),
    "the orchestration step's declaration of instanceId",
  ).toEqual(["string"]);
});

test("the orchestration step's prompt hands the model the input outside a template comment", () => {
  // A `{# ... #}` comment renders to nothing, so the input hint at the head of
  // the template does not count: the rendered input line must name it.
  expect(
    withoutComments(bridgeNode().data.user),
    "the rendered input line of the prompt",
  ).toMatch(/^- instanceId: \{\{\s*instanceId\s*\}\}$/m);
});

test("the prompt describes the input instanceId as the connected site", () => {
  expect(
    bridgeNode().data.system,
    "the prompt's description of instanceId",
  ).toContain("- `instanceId: string` — the connected WordPress site");
});

test("both site calls pass the input instanceId", () => {
  const system = bridgeNode().data.system;
  const list = [
    ...system.matchAll(
      /wordpress_site_tools_list\(\{ instanceId: (<[^>]*>) \}\)/g,
    ),
  ].map((m) => m[1]);
  const call = [
    ...system.matchAll(
      /wordpress_site_tool_call\(\{\n {2}instanceId: (<[^>]*>),\n {2}toolName:/g,
    ),
  ].map((m) => m[1]);
  expect({ list, call }, "the instanceId argument of both site calls").toEqual({
    list: ["<instanceId>"],
    call: ["<instanceId>"],
  });
});

test("the confirmation value names the site under the same name", () => {
  const block = bridgeNode().data.system.match(
    /Emit INTERRUPT[\s\S]*?```json\n([\s\S]*?)\n```/,
  );
  expect(block, "the confirmation value is a JSON block").not.toBeNull();
  const value = JSON.parse(block[1]);
  expect(Object.keys(value), "the keys of the confirmation value").toEqual([
    "postArtifactId",
    "postRepresentationRevisionId",
    "instanceId",
    "title",
    "excerpt",
  ]);
  expect(value.instanceId).toBe("<instanceId>");
});

test("the confirmation card draws the site from instanceId", async () => {
  for (const [reference, site] of POSTS) {
    for (const about of [{}, ABOUT]) {
      await draw({ ...reference, ...about, instanceId: site }, site);
      // A value that carries both keys: the site is the one under instanceId.
      await draw({ ...reference, ...about, instanceId: site, [OLD]: `old-${site}` }, site);
    }
  }
});

test("a confirmation that carries only the old key draws no Site line", async () => {
  // A confirmation parked before the rename carries the site under the old
  // key only, beside the post, its revision, the title and the excerpt. The
  // card no longer reads that key.
  for (const [reference, site] of POSTS) {
    for (const about of [{}, ABOUT]) {
      await draw({ ...reference, ...about, [OLD]: site }, null);
    }
  }
});

test("both buttons answer with the post and its revision only, under either key", async () => {
  // check() presses both buttons of every card it draws; here each post is
  // drawn under each key alone.
  for (const [reference, site] of POSTS) {
    for (const key of ["instanceId", OLD]) {
      await draw({ ...reference, [key]: site }, key === "instanceId" ? site : null);
    }
  }
});

test("the old start name is gone from everything the package ships and documents", () => {
  const shipped = [
    ["cinatra/oas.json", oasText()],
    ["package.json", JSON.stringify(manifest)],
    ["src/renderers/draft-confirm.tsx", source("src/renderers/draft-confirm.tsx")],
    ["README.md", source("README.md")],
  ];
  const naming = shipped
    .filter(([, text]) => text.includes(OLD))
    .map(([file]) => file);
  expect(naming, `files that still name ${OLD}`).toEqual([]);
});
