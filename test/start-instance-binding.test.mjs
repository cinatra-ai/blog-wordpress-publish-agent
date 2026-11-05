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
// Every test below except the button test fails against a flow and a card that
// still use the old name, on the assertion its title names. The button test
// holds under either name: it guards that the rename leaves the answer the card
// sends unchanged.

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
// runs at once), and the host's shared primitives are stand-ins: the card's
// own JSX tree comes back, and its paragraphs and its buttons' click handlers
// are read from that tree.
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

const isElement = (n) =>
  n !== null && typeof n === "object" && typeof n.$$typeof === "symbol";
const childrenOf = (el) => {
  const c = el.props?.children;
  if (c === undefined) return [];
  return Array.isArray(c) ? c.flat(Infinity) : [c];
};
const textOf = (n) => {
  if (typeof n === "string" || typeof n === "number") return String(n);
  return isElement(n) ? childrenOf(n).map(textOf).join("") : "";
};
const elementsOf = (n, out = []) => {
  if (isElement(n)) {
    out.push(n);
    for (const c of childrenOf(n)) elementsOf(c, out);
  }
  return out;
};

// The text a node holds itself, whatever kind of element it is.
const ownTextOf = (el) =>
  childrenOf(el)
    .filter((c) => typeof c === "string" || typeof c === "number")
    .map(String)
    .join("");

/** Draw the card for one confirmation value. */
function draw(value) {
  const answers = [];
  const tree = DraftConfirmRenderer({
    fieldName: "confirmation",
    schema: {},
    value,
    onChange: (answer) => answers.push(answer),
    context: {},
  });
  const elements = elementsOf(tree);
  // Every element that holds a "Site:" text of its own counts, not only a
  // paragraph, and the whole tree's text is counted too, so a "Site:" label
  // split over two elements or drawn by another kind of element shows up.
  const siteLines = elements.map(ownTextOf).filter((line) => line.includes("Site:"));
  const text = textOf(tree);
  const siteMentions = text.split("Site:").length - 1;
  const click = (label) => {
    const buttons = elements.filter(
      (el) => typeof el.props.onClick === "function" && textOf(el) === label,
    );
    expect(buttons.length, `one button reads "${label}"`).toBe(1);
    expect(buttons[0].props.disabled, `"${label}" is enabled`).toBe(false);
    buttons[0].props.onClick();
  };
  return { siteLines, siteMentions, text, click, answers };
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
    const { siteLines, siteMentions } = draw({ ...reference, instanceId: site });
    expect(
      siteLines,
      "the Site line drawn for a value with instanceId",
    ).toEqual([`Site: ${site}`]);
    expect(
      siteMentions,
      "the number of Site labels drawn for a value with instanceId",
    ).toBe(1);
  }
  // A value that carries both keys: the site is the one under instanceId.
  const both = draw({ ...REFERENCE, instanceId: "wp-new", [OLD]: "wp-old" });
  expect(
    both.siteLines,
    "the Site line drawn for a value with both keys",
  ).toEqual(["Site: wp-new"]);
  expect(
    both.siteMentions,
    "the number of Site labels drawn for a value with both keys",
  ).toBe(1);
  expect(
    both.text.includes("wp-old"),
    "the old key's value drawn for a value with both keys",
  ).toBe(false);
});

test("a confirmation that carries only the old key draws no Site line", () => {
  // A confirmation parked before the rename carries the site under the old
  // key only. The card no longer reads that key.
  const { siteLines, siteMentions } = draw({ ...REFERENCE, [OLD]: "wp-1" });
  expect(
    siteLines,
    "the Site line drawn for a value with only the old key",
  ).toEqual([]);
  expect(
    siteMentions,
    "the number of Site labels drawn for a value with only the old key",
  ).toBe(0);
});

test("both buttons answer with the post and its revision only, under either key", () => {
  for (const [reference, site] of POSTS) {
    for (const key of ["instanceId", OLD]) {
      const { click, answers } = draw({ ...reference, [key]: site });
      click("Publish to WordPress");
      click("Do not publish");
      expect(answers, "the answers of both buttons").toEqual([
        { approved: true, ...reference },
        { approved: false, ...reference },
      ]);
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
