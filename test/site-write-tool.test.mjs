// cinatra-ai/cinatra#3745 - the page is created through the site write tool.
//
// The WordPress connector's read proxy `wordpress_site_tool_call` forwards read
// abilities only. Creating the page is a write that publishes, so the recipe
// calls `wordpress_site_tool_write`, which the application holds for the
// person's recorded decision on an agent run. Listing the site's catalogue is a
// read and stays on `wordpress_site_tools_list`. The package declares exactly
// the two tools the recipe calls.
//
// Like the other suites of this package, these cases read the manifest and the
// flow; the pack ships no runtime of its own. The recipe's steps are found by
// their headings' words, never by their numbers.

import { expect, test } from "vitest";

import { bridgeNode, consumedPrimitives, oasText } from "./__tests__/oas-contract.mjs";

const READ_TOOL = "wordpress_site_tool_call";
const WRITE_TOOL = "wordpress_site_tool_write";
const LIST_TOOL = "wordpress_site_tools_list";

const system = () => bridgeNode().data.system;
const blocks = () => system().split(/\n(?=#{2,3} )/);
const block = (heading) => blocks().find((text) => heading.test(text.split("\n")[0])) ?? "";

test("the tool discipline names the list tool and the write tool, and no other primitive", () => {
  const discipline = block(/^## Tool discipline/);
  expect(discipline, "the section exists").not.toBe("");
  expect(discipline.includes(`${LIST_TOOL}({ instanceId })`)).toBeTruthy();
  expect(discipline.includes(`${WRITE_TOOL}({ instanceId, toolName, args })`)).toBeTruthy();
  expect(discipline.includes(READ_TOOL), "the read proxy is not named").toBeFalsy();
  expect(discipline, "the section still says there are two primitives").toMatch(/exactly these 2 primitives/);
});

test("the page is created with the write tool, after the listing, and the recipe says it is held", () => {
  const create = block(/^### Step \d+ .* create the page/);
  expect(create, "the create step exists").not.toBe("");
  expect(create.includes(`${WRITE_TOOL}({`), "the create step calls the write tool").toBeTruthy();
  expect(create.includes(READ_TOOL), "the create step does not call the read proxy").toBeFalsy();
  expect(create, "the create step says the call waits for the person's recorded decision").toMatch(
    /recorded decision/,
  );
  const find = block(/^### Step \d+ .* find the site's ability/);
  expect(find, "the find step exists").not.toBe("");
  expect(find.includes(`${LIST_TOOL}({ instanceId: <instanceId> })`), "the find step lists the catalogue").toBeTruthy();
  expect(find.includes(WRITE_TOOL), "the find step only reads").toBeFalsy();
  expect(system().indexOf(find) < system().indexOf(create), "the listing comes before the create call").toBeTruthy();
});

test("the read proxy is named nowhere in the flow", () => {
  expect(oasText().includes(READ_TOOL), "the flow never names the read proxy").toBeFalsy();
  expect(oasText().includes(WRITE_TOOL), "the flow names the write tool").toBeTruthy();
});

test("the package consumes the list tool and the write tool, not the read proxy", () => {
  const consumed = consumedPrimitives();
  expect(consumed.includes(LIST_TOOL)).toBeTruthy();
  expect(consumed.includes(WRITE_TOOL)).toBeTruthy();
  expect(consumed.includes(READ_TOOL), "the read proxy is not consumed").toBeFalsy();
});
