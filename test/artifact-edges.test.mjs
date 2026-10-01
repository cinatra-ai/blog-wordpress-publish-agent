// THE ARTIFACT EDGES OF THIS AGENT (the application's issue 3033).
//
// The agent reads only the blog post: it loads the post, publishes its text
// through the WordPress connector and writes the address back onto the post.
// So its only artifact edge is the post's. The featured picture of a post is an
// ordinary image, and this agent reads none, so neither its manifest nor its
// flow names the blog image extension.

import { expect, test } from "vitest";

import {
  artifactDependencies,
  oasText,
  source,
} from "./__tests__/oas-contract.mjs";

const BLOG_IMAGE = "@cinatra-ai/blog-image-artifact";

test("the only artifact edge is the blog post's", () => {
  expect(artifactDependencies()).toEqual(["@cinatra-ai/blog-post-artifact"]);
});

test("the blog image extension is named nowhere", () => {
  expect(
    source("package.json").includes(BLOG_IMAGE),
    "package.json names the blog image extension",
  ).toBe(false);
  expect(
    oasText().includes(BLOG_IMAGE),
    "cinatra/oas.json names the blog image extension",
  ).toBe(false);
});
