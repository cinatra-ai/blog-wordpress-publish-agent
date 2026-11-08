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
// name. Every card the suite draws is checked (draw() below): the card for the
// value and the card for the same value without its two site keys, each
// against the exact page expected for it and for the answers of its two
// buttons. So the button test also fails there, on the page of its first card.
// The answers the buttons send do not read the site key, and the button test
// checks them under either key: it guards that the rename leaves them
// unchanged.

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

// Each card is drawn by React itself: react-dom's client renderer mounts the
// card into a jsdom document (made below; the suite runs in Node) inside
// React's act(), which runs its effects and any update they cause. Then every
// timer the card set is run until none is left, again inside act(): timers of
// setTimeout or setInterval, the global ones or the document window's, which
// the test fakes. The page the test reads is then what React has put into the
// document: its whole head and body, so an element the card puts into a
// portal, or a style or link React moves into the head, is read too. Any error
// React reports while it draws fails the test.
// The host's shared primitives are the only mocks: each is a plain component
// that draws one element (a `button` for Button, a `div` for the others) with
// a `data-primitive` attribute naming it, and passes that element every prop
// it is given. So an attribute the card gives a primitive (`hidden` or `style`
// among them) is on the page the test compares.
// It does not load the stylesheet or lay out the page: what a class name
// makes of an element is not checked beyond the class names on the page. It
// draws the host's primitives as these mocks, not as the host draws them. It
// waits for nothing outside React and those timers (a network reply, for one),
// and it does not draw the card again for later props or after a press.
vi.mock("@cinatra-ai/design-primitives", async () => {
  const { createElement } = await import("react");
  const primitive = (name, tag) => (props) =>
    createElement(tag, { "data-primitive": name, ...props });
  return {
    Button: primitive("Button", "button"),
    Card: primitive("Card", "div"),
    CardContent: primitive("CardContent", "div"),
    CardFooter: primitive("CardFooter", "div"),
    CardHeader: primitive("CardHeader", "div"),
    CardTitle: primitive("CardTitle", "div"),
  };
});

import { JSDOM } from "jsdom";
import { act, createElement } from "react";

import DraftConfirmRenderer from "../src/renderers/draft-confirm.tsx";

// Each card is drawn into a new, empty document, so nothing React keeps for a
// document (a style it has moved into the head, for one) is carried from one
// card to the next. react-dom reads `window` and `document` when it loads, so
// it is loaded after a first document is set.
const EMPTY = "<!doctype html><html><head></head><body></body></html>";
const openDocument = () => {
  const { window } = new JSDOM(EMPTY);
  globalThis.window = window;
  globalThis.document = window.document;
  return window;
};
openDocument();
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
// under 0.4.x holds it): the card draws a title line and the excerpt for it.
const ABOUT = { title: "A first post", excerpt: "Its opening lines." };

/** A value the expected page shows as it is: no character HTML escapes. */
const plainText = (s) => {
  if (!/^[\w .:-]+$/.test(s)) throw new Error(`not plain text: ${s}`);
  return s;
};

/**
 * The page a person must see for one card, exactly: the card's title, the
 * line on what publishing does, the title line and the excerpt when the
 * value has them, the Site line `Site: <site>` when `site` is not null and no
 * Site line when it is, and the two enabled buttons, in this order. Nothing
 * else is on the page: no other element, text, attribute or class.
 */
function expectedPage({ title, excerpt }, site) {
  return [
    "<div>",
    '<div data-primitive="Card" class="border-line bg-surface backdrop-blur-none">',
    '<div data-primitive="CardHeader"><div data-primitive="CardTitle">Publish this post to WordPress?</div></div>',
    '<div data-primitive="CardContent" class="flex flex-col gap-3 text-sm">',
    '<p class="text-foreground">The post goes to the site exactly as you continued with it. Nothing is created on the site until you publish here, so declining leaves the site untouched. The page’s address comes back onto the post afterwards.</p>',
    title === undefined
      ? ""
      : `<p class="text-foreground"><span class="text-muted-foreground">Title:</span> ${plainText(title)}</p>`,
    excerpt === undefined
      ? ""
      : `<p class="whitespace-pre-wrap text-muted-foreground">${plainText(excerpt)}</p>`,
    site === null ? "" : `<p class="text-muted-foreground">Site: ${plainText(site)}</p>`,
    "</div>",
    '<div data-primitive="CardFooter" class="flex justify-end gap-2">',
    '<button data-primitive="Button" variant="outline" type="button">Do not publish</button>',
    '<button data-primitive="Button" type="button">Publish to WordPress</button>',
    "</div>",
    "</div>",
    "</div>",
  ].join("");
}

/** The shape of a value's site keys, as the failure labels name it. */
const shapeOf = (value) =>
  "instanceId" in value && OLD in value
    ? "both keys"
    : "instanceId" in value
      ? "instanceId"
      : OLD in value
        ? "only the old key"
        : "no site key";

/**
 * Draw the card for one value with React into a new, empty document and check it.
 * `site` is the one site the card must name, or null for none. React reports
 * no error; the document's head is empty and its body is exactly the page
 * expectedPage() gives; and pressing "Publish to WordPress" and then "Do not
 * publish" answers with `approved` and the value's post and revision, and no
 * other key.
 */
async function check(value, site) {
  const shape = shapeOf(value);
  const answers = [];
  const errors = [];
  const report = (error) => errors.push(String(error?.stack ?? error));
  const window = openDocument();
  const { document } = window;
  vi.useFakeTimers();
  for (const name of ["setTimeout", "clearTimeout", "setInterval", "clearInterval"]) {
    window[name] = globalThis[name];
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container, {
    onUncaughtError: report,
    onCaughtError: report,
    onRecoverableError: report,
  });
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
    await act(async () => {
      vi.runAllTimers();
    });
    expect(errors, `the errors React reports for a value with ${shape}`).toStrictEqual([]);
    expect(document.head.innerHTML, `the document's head for a value with ${shape}`).toBe("");
    // Compared as the list of its tags and texts, so a failure shows where the
    // page differs; the list joins back to the whole page, character for character.
    const tokens = (html) => html.split(/(?=<)/);
    expect(tokens(document.body.innerHTML), `the page drawn for a value with ${shape}`).toStrictEqual(
      tokens(expectedPage(value, site)),
    );
    const press = async (label) => {
      const button = [...container.querySelectorAll("button")].filter(
        (b) => b.textContent === label,
      );
      expect(button.length, `one button reads "${label}" for a value with ${shape}`).toBe(1);
      await act(async () => {
        button[0].click();
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
    vi.useRealTimers();
    window.close();
  }
}

/**
 * Check the card for one confirmation value and the card for the same value
 * without its two site keys. Every value the suite draws goes through here:
 * the card for the value names `site` (null for none), and the card without
 * the site keys names none.
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
