import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The pack ships no runtime of its own — an agent's product IS its manifest and
// its flow — so the suites are plain Node: they read those two files and the
// renderer's source text. The rendered confirmation suite alone opts into jsdom.
//
// The include names the suites this package owns. Its shared readers live under
// `test/__tests__/`, which carries no `.test.` infix, so it is a MODULE the
// suites import and never a suite vitest tries to collect on its own.
export default defineConfig({
  cacheDir: "node_modules/.vite-owned",
  resolve: { alias: { "@cinatra-ai/design-primitives": fileURLToPath(new URL("./test/__tests__/design-primitives.mjs", import.meta.url)) } },
  test: {
    include: ["test/**/*.test.mjs"],
  },
});
