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
// value and the card for the same value without its two site keys, each for
// its site and the answers of its two buttons, and the first card also for the
// old key's value and for the rest of the card against the second. So the
// button test also fails there, on the Site line of its first card. The
// answers the buttons send do not read the site key, and the button test
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

// Each card is drawn by calling the renderer once, in Node, with no DOM: its
// first render, which React keeps showing until the host draws it again (the
// card can set no state: React's other hooks throw here, see below). Its
// three hooks are made plain calls (a memo computes, a ref holds its first
// value, an effect waits until the whole tree is drawn, as React runs it after
// it commits the render), and the host's shared primitives are stand-ins that
// draw their children. The tree that comes back is then drawn element by
// element, and the test draws only what it can read the way React does; every
// other kind fails it:
// - a node is nothing (null, undefined, true, false), text (a string or a
//   number), an array of nodes or an element;
// - an element is a `div`, a `p` or a `span` whose props are only `children`
//   and a string `className`; a Fragment, which draws its children; or a plain
//   function component (one of the stand-ins among them), which is called
//   with its props and drawn as what it returns;
// - a class, a `memo` or `forwardRef` wrapper, a context provider or consumer,
//   any other symbol type, any other tag and any other prop of a tag (raw HTML,
//   an embedded document, a style or the `hidden` attribute among them) fail
//   the test, and so does a component that calls a React hook other than those
//   three (React throws outside its own render).
// It does not read the stylesheet or run the card in a browser: what a class
// name or the browser makes of the drawn tree is not checked beyond the class
// names compared below.
const effects = vi.hoisted(() => []);
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useMemo: (compute) => compute(),
    useRef: (initial) => ({ current: initial }),
    useEffect: (effect) => {
      effects.push(effect);
    },
  };
});
vi.mock("@cinatra-ai/design-primitives", () => {
  const standIn = (name) => {
    const component = ({ children }) => children ?? null;
    Object.defineProperty(component, "name", { value: name });
    return component;
  };
  return {
    Button: standIn("Button"),
    Card: standIn("Card"),
    CardContent: standIn("CardContent"),
    CardFooter: standIn("CardFooter"),
    CardHeader: standIn("CardHeader"),
    CardTitle: standIn("CardTitle"),
  };
});

import DraftConfirmRenderer from "../src/renderers/draft-confirm.tsx";

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

const ELEMENT = new Set([
  Symbol.for("react.transitional.element"),
  Symbol.for("react.element"),
]);
const isElement = (n) =>
  n !== null && typeof n === "object" && ELEMENT.has(n.$$typeof);
const FRAGMENT = Symbol.for("react.fragment");
const TAGS = new Set(["div", "p", "span"]);
const TAG_PROPS = new Set(["children", "className"]);

/** The name an element's path gives it: its tag, Fragment, or its function's name. */
const nameOf = (type) =>
  typeof type === "string" ? type : type === FRAGMENT ? "Fragment" : type.name;

/** What an element draws in its place: its children, or what its function returns. */
function contentOf(type, props) {
  if (typeof type === "string" && TAGS.has(type)) {
    const extra = Object.keys(props).filter(
      (key) => !TAG_PROPS.has(key) || (key === "className" && typeof props.className !== "string"),
    );
    if (extra.length > 0) {
      throw new Error(
        `the card gives a ${type} a prop this test does not draw: ${extra.join(", ")}`,
      );
    }
    return props.children;
  }
  if (type === FRAGMENT) return props.children;
  if (
    typeof type === "function" &&
    !type.prototype?.isReactComponent &&
    type.$$typeof === undefined
  ) {
    return type(props);
  }
  throw new Error(
    `the card draws an element this test does not draw: ${String(type?.$$typeof ?? type?.name ?? type)}`,
  );
}

// A "Site:" label in any width or case of its letters, with any white space
// before its colon and any format character (a zero-width space, for one)
// inside it. A word that ends in "site" before a colon counts too.
const plain = (s) => s.normalize("NFKC").replace(/\p{Cf}/gu, "").toLowerCase();
const labelsIn = (s) => (plain(s).match(/site\s*:/g) ?? []).length;

/**
 * Draw the card for one value, with no checks. Each element becomes a record:
 * its path (the names of the elements above it and its own, "Card>CardContent>p"
 * for one), the text it draws itself and the value of each of its props that
 * is a string or a number (an element passed as a prop is drawn into the
 * record). The text of the whole tree is kept too, in order, so a label split
 * over several elements shows up there. The effects of the render run after
 * the whole tree is drawn.
 */
function render(value) {
  const answers = [];
  const records = [];
  const texts = [];
  const visit = (node, owner) => {
    if (node === null || node === undefined || typeof node === "boolean") return;
    if (typeof node === "string" || typeof node === "number") {
      texts.push(String(node));
      owner.own.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      for (const c of node) visit(c, owner);
      return;
    }
    if (isElement(node)) {
      const props = node.props ?? {};
      const content = contentOf(node.type, props);
      const record = {
        element: node,
        path: owner.path === "" ? nameOf(node.type) : `${owner.path}>${nameOf(node.type)}`,
        own: [],
        props: [],
      };
      records.push(record);
      for (const key of Object.keys(props).sort()) {
        if (key === "children") continue;
        const p = props[key];
        if (typeof p === "string" || typeof p === "number") record.props.push(String(p));
        else if (isElement(p) || Array.isArray(p)) visit(p, record); // drawn by a prop
      }
      visit(content, record);
      return;
    }
    throw new Error(`the card draws a node this test does not draw: ${typeof node}`);
  };
  effects.length = 0;
  visit(
    DraftConfirmRenderer({
      fieldName: "confirmation",
      schema: {},
      value,
      onChange: (answer) => answers.push(answer),
      context: {},
    }),
    { path: "", own: [] },
  );
  for (const effect of effects.splice(0)) effect();
  const lines = records.map((r) => [r.path, r.own.join(""), ...r.props]);
  const strings = [texts.join(""), ...records.flatMap((r) => r.props)];
  return { records, lines, strings, answers };
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

/** The element that draws the Site line: a `p` in the card's content, with the class of its muted text. */
const SITE_PATH = "Card>CardContent>p";
const SITE_CLASS = "text-muted-foreground";

/**
 * Check one drawn card. `site` is the one site the card must name, or null for
 * none: the Site label (in the own text of any element, in any string prop,
 * split over elements or not) appears once, as the own text "Site: <site>" of
 * one `p` in the card's content whose only prop besides its children is the
 * class of the card's muted text, or not at all; the old key's value, if
 * given, is not drawn; and "Publish to WordPress" and "Do not publish" are
 * enabled and answer with `approved` and the value's post and revision, and no
 * other key. `rest` runs between the Site checks and the buttons.
 */
function check(drawn, value, site, shape, old, rest) {
  const line = site === null ? null : `Site: ${site}`;
  expect(
    drawn.lines.flat().filter((s) => labelsIn(s) > 0),
    `the Site line drawn for a value with ${shape}`,
  ).toStrictEqual(line === null ? [] : [line]);
  expect(
    drawn.strings.reduce((n, s) => n + labelsIn(s), 0),
    `the number of Site labels drawn for a value with ${shape}`,
  ).toBe(line === null ? 0 : 1);
  if (line !== null) {
    expect(
      drawn.lines.filter((l) => l[1] === line),
      `the element that draws the Site line for a value with ${shape}`,
    ).toStrictEqual([[SITE_PATH, line, SITE_CLASS]]);
  }
  if (typeof old === "string" && old !== site) {
    expect(
      drawn.strings.some((s) => plain(s).includes(plain(old))),
      `the old key's value drawn for a value with ${shape}`,
    ).toBe(false);
  }
  rest();
  const click = (label) => {
    const buttons = drawn.records
      .filter((r) => typeof r.element.props.onClick === "function")
      .filter((r) => r.own.join("") === label)
      .map((r) => r.element);
    expect(buttons.length, `one button reads "${label}" for a value with ${shape}`).toBe(1);
    expect(buttons[0].props.disabled, `"${label}" is enabled for a value with ${shape}`).toBe(false);
    buttons[0].props.onClick();
  };
  click("Publish to WordPress");
  click("Do not publish");
  const { postArtifactId, postRepresentationRevisionId } = value;
  expect(drawn.answers, `the answers of both buttons for a value with ${shape}`).toStrictEqual([
    { approved: true, postArtifactId, postRepresentationRevisionId },
    { approved: false, postArtifactId, postRepresentationRevisionId },
  ]);
}

/**
 * Draw the card for one confirmation value and the card for the same value
 * without its two site keys, and check both. Every value the suite draws goes
 * through here, and every card it draws goes through check(): the card for the
 * value names `site` (null for none), and the card without the site keys names
 * none. For the card for the value, the old key's value is not drawn, and the
 * records of the rest of the card (path, own text and string props of every
 * element but the Site line) are those of the card without the site keys.
 */
function draw(value, site) {
  const shape = shapeOf(value);
  // The same value without its two site keys.
  const { [OLD]: old, instanceId: _ignored, ...bare } = value;
  const drawn = render(value);
  const without = render(bare);
  const line = site === null ? null : `Site: ${site}`;
  check(drawn, value, site, shape, old, () => {
    expect(
      drawn.lines.filter((l) => l[1] !== line),
      `the rest of the card drawn for a value with ${shape}, against the same value without its site`,
    ).toStrictEqual(without.lines);
  });
  check(without, bare, null, shapeOf(bare), undefined, () => {});
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

test("the confirmation card draws the site from instanceId", () => {
  for (const [reference, site] of POSTS) {
    for (const about of [{}, ABOUT]) {
      draw({ ...reference, ...about, instanceId: site }, site);
      // A value that carries both keys: the site is the one under instanceId.
      draw({ ...reference, ...about, instanceId: site, [OLD]: `old-${site}` }, site);
    }
  }
});

test("a confirmation that carries only the old key draws no Site line", () => {
  // A confirmation parked before the rename carries the site under the old
  // key only, beside the post, its revision, the title and the excerpt. The
  // card no longer reads that key.
  for (const [reference, site] of POSTS) {
    for (const about of [{}, ABOUT]) {
      draw({ ...reference, ...about, [OLD]: site }, null);
    }
  }
});

test("both buttons answer with the post and its revision only, under either key", () => {
  // draw() presses both buttons of every card it draws; here each post is
  // drawn under each key alone.
  for (const [reference, site] of POSTS) {
    for (const key of ["instanceId", OLD]) {
      draw({ ...reference, [key]: site }, key === "instanceId" ? site : null);
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
