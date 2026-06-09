# Coding Conventions

**Analysis Date:** 2026-06-09

## Overview

This is a content-only Cinatra agent extension. The repository ships no TypeScript `src/` — the agent behaviour is entirely encoded in `skills/blog-wordpress-publish-agent/SKILL.md` (a structured natural-language prompt) and `cinatra/oas.json` (the OAS surface), with one JavaScript gate utility (`extension-kind-gate.mjs`).

## Naming Patterns

**Files:**
- Skill document: `skills/<agent-slug>/SKILL.md` — kebab-case directory name matching the npm package slug
- Gate script: `extension-kind-gate.mjs` — kebab-case, `.mjs` extension for ES module
- Config sidecar: `cinatra/oas.json` — lowercase JSON in a `cinatra/` sidecar directory

**Functions (in `extension-kind-gate.mjs`):**
- Exported functions: camelCase verbs — `parseArgs`, `validateAgent`, `validateWorkflow`, `validateBpmnSanity`, `validateWorkflowPackageShape`, `findWorkflowSidecars`, `runGate`
- Internal helpers: camelCase — `walkLlmStrings`, `scanOasString`, `wordBoundary`, `prefixOf`, `localOf`
- Entry point: `main()` — conventional lowercase

**Variables:**
- Constants (module-level): SCREAMING_SNAKE_CASE — `LLM_VISIBLE_FIELDS`, `BANNED_PRIMITIVES`, `BANNED_TYPEHINTS`, `PRIMITIVE_PATTERNS`, `BPMN_MODEL_NS`, `WORKFLOW_PACKAGE_NAME_RE`
- Local variables: camelCase — `packageRoot`, `oasPath`, `findings`, `bpmnPrefixes`

**Types:**
- No TypeScript types declared in this repo (content-only extension). `tsconfig.json` targets a `src/` that does not exist — it is present as a template scaffold.

## Code Style

**Formatting:**
- No Prettier or Biome config detected. The single JS file (`extension-kind-gate.mjs`) uses 2-space indentation, double quotes for strings, and trailing commas in multi-line arrays/objects.

**Linting:**
- No ESLint config detected. `extension-kind-gate.mjs` is self-described as "self-contained, zero-dependency" and is designed to run with plain `node`.

## Module Design

**Module format:** ES Modules (`"type": "module"` in `package.json`). `extension-kind-gate.mjs` uses `import` from `node:fs`, `node:path`.

**Exports:** Named exports only from `extension-kind-gate.mjs` — all validator and helper functions are exported for testability. `main()` is NOT exported; it is guarded by an `invokedDirectly` check before calling.

**Direct-invocation guard pattern (in `extension-kind-gate.mjs`):**
```js
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  try { main(); } catch (err) { console.error(...); process.exit(1); }
}
```
This pattern allows the file to be both directly executable AND importable as a module in tests.

## Error Handling

**Patterns:**
- All validator functions are PURE: they accept input and return `string[]` of error messages. They do NOT throw.
- File I/O errors are caught with `try/catch` inside gate functions; errors are pushed to the `errors[]` array and the function returns early.
- `main()` wraps `runGate()` in a top-level try/catch and calls `process.exit(1)` on unexpected errors.
- Exit codes: 0 = pass, 1 = violations found, 2 = dependency-shape regression (in CI shell script).

**Error message style:** Short, operator-readable one-liners. Include the offending token/value in the message (e.g., `got ${JSON.stringify(value)}`).

## SKILL.md Conventions

The agent skill (`skills/blog-wordpress-publish-agent/SKILL.md`) follows these conventions:

- YAML front matter with `name` and `description` fields.
- Structured sections: `## Inputs`, `## Tool discipline`, `## Hard contract facts`, `## Step-by-step recipe`, `## Error envelope`.
- Step headers use `### Step N — <verb phrase>` format.
- Inline code blocks for tool calls and JSON payloads.
- Hard constraints stated as bullet lists under "Hard contract facts".
- Output shape always includes `approved: boolean` and `summary: string`.

## Comments

**When to Comment:**
- Module-level block comments explain design rationale and constraints (why zero-dependency, what the gate does NOT do, what the marketplace handles).
- Inline comments explain non-obvious regex patterns and algorithm steps.
- CI workflow YAML uses inline `#` comments extensively to explain each step's branching logic.

**Style:** Full sentences in block comments. Short phrases in inline comments.

## Logging

**Framework:** `console.log` / `console.error` directly in `main()`. No logging library.

**Patterns:**
- Success: `console.log("✓ extension-kind-gate: ...")` to stdout.
- Violations: `console.error("✗ extension-kind-gate: ...")` + per-error `console.error("  • " + e)` to stderr.

---

*Convention analysis: 2026-06-09*
