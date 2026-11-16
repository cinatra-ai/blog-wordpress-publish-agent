import { defineConfig } from "vitest/config";

// The pack ships no runtime of its own — an agent's product IS its manifest and
// its flow — so the suites are plain Node: they read those two files as text
// and JSON. No environment override: every suite runs in the Node environment.
//
// The include names the suites this package owns. Its shared readers live under
// `test/__tests__/`, which carries no `.test.` infix, so it is a MODULE the
// suites import and never a suite vitest tries to collect on its own.
export default defineConfig({
  test: {
    include: ["test/**/*.test.mjs"],
  },
});
