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
// name. Every card the suite draws is checked the same way (draw() below): its
// site, the old key's value, the rest of the card and the answers of its two
// buttons. So the button test also fails there, on the Site line of its first
// card. The answers the buttons send do not read the site key, and the button
// test checks them under either key: it guards that the rename leaves them
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

// The confirmation card is drawn by calling it, with no DOM. Its three hooks
// are made plain calls (a memo computes, a ref holds its first value, an effect
// runs at once), and the host's shared primitives are stand-ins that draw
// their children. Every element of the tree that comes back is then drawn in
// turn: a component element (a function, a class, a memo or forwardRef
// wrapper, a context provider or consumer, one of the stand-ins) is called and
// what it returns is drawn in its place. An element or a node of a kind this
// test cannot draw, raw HTML among them, fails the test, and so does a
// component that calls a hook other than those three.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useMemo: (compute) => compute(),
    useRef: (initial) => ({ current: initial }),
    useEffect: (effect) => {
      effect();
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

/** What an element draws in its place: its children, or what its component returns. */
function contentOf(type, props) {
  if (typeof type === "string" || typeof type === "symbol") {
    // A DOM element, or an element whose type is a symbol (a Fragment,
    // StrictMode, Suspense or Profiler).
    return props.children;
  }
  if (typeof type === "function") {
    if (type.prototype?.isReactComponent) {
      const instance = new type(props);
      instance.props = props;
      return instance.render();
    }
    return type(props);
  }
  switch (type?.$$typeof) {
    case Symbol.for("react.memo"):
      return contentOf(type.type, props);
    case Symbol.for("react.forward_ref"):
      return type.render(props, null);
    case Symbol.for("react.context"):
    case Symbol.for("react.provider"):
      return props.children;
    case Symbol.for("react.consumer"):
      return props.children(type._context._currentValue);
    default:
      throw new Error(
        `the card draws an element this test cannot draw: ${String(type?.$$typeof ?? type)}`,
      );
  }
}

// A "Site:" label in any width or case of its letters, with any white space
// before its colon and any format character (a zero-width space, for one)
// inside it. A word that ends in "site" before a colon counts too.
const plain = (s) => s.normalize("NFKC").replace(/\p{Cf}/gu, "").toLowerCase();
const labelsIn = (s) => (plain(s).match(/site\s*:/g) ?? []).length;

/**
 * Draw the card for one value, with no checks. Each element becomes a record:
 * the text it draws itself and the value of each of its props that is a
 * string or a number (an element passed as a prop is drawn into the record).
 * The text of the whole tree is kept too, in order, so a label split over
 * several elements shows up there.
 */
function render(value) {
  const answers = [];
  const records = [];
  const texts = [];
  const visit = (node, owner) => {
    if (node === null || node === undefined || typeof node === "boolean") return;
    if (typeof node === "function") return; // React draws nothing for a function
    if (["string", "number", "bigint"].includes(typeof node)) {
      texts.push(String(node));
      owner.own.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      for (const c of node) visit(c, owner);
      return;
    }
    if (isElement(node)) {
      const { children, dangerouslySetInnerHTML, ...rest } = node.props ?? {};
      if (dangerouslySetInnerHTML !== undefined) {
        throw new Error("the card draws raw HTML, which this test cannot read");
      }
      const record = { element: node, own: [], props: [] };
      records.push(record);
      for (const key of Object.keys(rest).sort()) {
        const p = rest[key];
        if (["string", "number", "bigint"].includes(typeof p)) record.props.push(String(p));
        else if (isElement(p) || Array.isArray(p)) visit(p, record); // drawn by a prop
      }
      visit(contentOf(node.type, node.props ?? {}), record);
      return;
    }
    if (typeof node === "object" && node.$$typeof === Symbol.for("react.portal")) {
      visit(node.children, owner);
      return;
    }
    if (typeof node === "object" && typeof node[Symbol.iterator] === "function") {
      for (const c of node) visit(c, owner);
      return;
    }
    throw new Error(`the card draws a node this test cannot draw: ${typeof node}`);
  };
  visit(
    DraftConfirmRenderer({
      fieldName: "confirmation",
      schema: {},
      value,
      onChange: (answer) => answers.push(answer),
      context: {},
    }),
    { own: [] },
  );
  const lines = records.map((r) => [r.own.join(""), ...r.props]);
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

/**
 * Draw the card for one confirmation value and check it. `site` is the one
 * site the card must name, or null for none. Every value the suite draws goes
 * through here, so no card is drawn without these checks: the Site label (in
 * the own text of any element, in any string prop, split over elements or not)
 * appears once, as the line "Site: <site>", or not at all; the old key's value
 * is not drawn; the own texts and string props of the rest of the card are
 * those that the same value draws without its two site keys; and "Publish to
 * WordPress" and "Do not publish" are enabled and answer with `approved` and
 * the value's post and revision only.
 */
function draw(value, site) {
  const shape = shapeOf(value);
  // The same value without its two site keys.
  const { [OLD]: old, instanceId: _ignored, ...bare } = value;
  const drawn = render(value);
  const without = render(bare);
  const line = site === null ? null : `Site: ${site}`;
  expect(
    drawn.lines.flat().filter((s) => labelsIn(s) > 0),
    `the Site line drawn for a value with ${shape}`,
  ).toEqual(line === null ? [] : [line]);
  expect(
    drawn.strings.reduce((n, s) => n + labelsIn(s), 0),
    `the number of Site labels drawn for a value with ${shape}`,
  ).toBe(line === null ? 0 : 1);
  if (typeof old === "string" && old !== site) {
    expect(
      drawn.strings.some((s) => plain(s).includes(plain(old))),
      `the old key's value drawn for a value with ${shape}`,
    ).toBe(false);
  }
  expect(
    drawn.lines.filter((l) => l[0] !== line),
    `the rest of the card drawn for a value with ${shape}, against the same value without its site`,
  ).toEqual(without.lines);
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
  expect(drawn.answers, `the answers of both buttons for a value with ${shape}`).toEqual([
    { approved: true, postArtifactId, postRepresentationRevisionId },
    { approved: false, postArtifactId, postRepresentationRevisionId },
  ]);
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
