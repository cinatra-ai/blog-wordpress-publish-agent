import { defineConfig } from "vitest/config";

// The pack ships no runtime of its own — an agent's product IS its manifest and
// its flow — so the suites are plain Node: they read those two files and the
// renderer's source text. One suite also draws the confirmation card by calling
// it, with React's hooks stubbed and the host primitives mocked
// (test/start-instance-binding.test.mjs). No DOM, no environment override.
//
// The include names the suites this package owns. Its shared readers live under
// `test/__tests__/`, which carries no `.test.` infix, so it is a MODULE the
// suites import and never a suite vitest tries to collect on its own.
export default defineConfig({
  test: {
    include: ["test/**/*.test.mjs"],
  },
});
