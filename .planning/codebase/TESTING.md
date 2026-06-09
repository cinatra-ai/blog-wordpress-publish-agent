# Testing Patterns

**Analysis Date:** 2026-06-09

## Test Framework

**Runner:** Not applicable for this repo in standalone mode.

This is a content-only Cinatra agent extension (no `src/` TypeScript). The repository declares no test runner in `package.json` (`scripts.test` is absent). CI runs `corepack pnpm test --if-present` which exits 0 with no action.

The repo is classified as a "source mirror" in CI: it declares host-internal `@cinatra-ai/*` optional peerDependencies, so the monorepo owns install, typecheck, and test. The gate script (`extension-kind-gate.mjs`) is the only testable logic in this repo.

**Assertion Library:** Not detected in this repo.

**Run Commands:**
```bash
# No standalone test command — test runner absent from package.json
corepack pnpm test --if-present   # CI command; exits 0 with no tests present

# The gate script itself can be run directly:
node extension-kind-gate.mjs --package-root .
```

## Test File Organization

**Location:** No test files exist in this repository.

**Naming:** Not applicable.

## Test Structure

**Suite Organization:** Not applicable — no test files present.

## Mocking

**Framework:** Not applicable.

## Fixtures and Factories

**Test Data:** Not applicable.

## Coverage

**Requirements:** None enforced in this repo. The monorepo covers `extension-kind-gate.mjs` logic (all exported functions are pure and importable).

## Test Types

**Unit Tests:**
- Not present in this repo. The exported functions in `extension-kind-gate.mjs` (`validateAgent`, `validateWorkflow`, `validateBpmnSanity`, `validateWorkflowPackageShape`, `findWorkflowSidecars`, `parseArgs`, `runGate`) are pure/side-effect-free and designed for unit testing in the monorepo context.

**Integration Tests:** Not present.

**E2E Tests:** Not present.

## CI Gate as Functional Test

The primary quality gate in this repo is the extension-kind-gate CI step in `.github/workflows/ci.yml`:

```yaml
- name: Agent OAS validation gate
  run: node extension-kind-gate.mjs --package-root .
```

This runs `validateAgent(packageRoot)` against `cinatra/oas.json`, scanning all LLM-visible OAS string fields (`system`, `user`, `description`) for banned retired-CRM primitives and legacy entity typeHints. Exit 0 = pass, exit 1 = violations.

The CI `build` job also runs:
- `npm pack --dry-run` — validates package shape and publish payload
- Dependency-shape classification — asserts no `@cinatra-ai/*` packages leaked into `dependencies`/`devDependencies`

These CI steps serve as the functional test suite for this agent extension.

## Testability Design in `extension-kind-gate.mjs`

All validator functions in `extension-kind-gate.mjs` are exported and pure to enable unit testing:
- Accept string or object input, return `string[]` of error messages
- No side effects (no file I/O inside validators — file reads happen in the calling `validateAgent`/`validateWorkflow` wrappers)
- `main()` is NOT exported and is guarded by a direct-invocation check, so importing the module for tests does not execute the CLI

---

*Testing analysis: 2026-06-09*
