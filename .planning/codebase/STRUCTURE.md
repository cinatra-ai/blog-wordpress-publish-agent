# Codebase Structure

**Analysis Date:** 2026-06-09

## Directory Layout

```
blog-wordpress-publish-agent/
├── cinatra/
│   └── oas.json              # Agent flow declaration (nodes, edges, I/O, LLM config)
├── skills/
│   └── blog-wordpress-publish-agent/
│       └── SKILL.md          # LLM system prompt: tool discipline, step-by-step recipe
├── .github/
│   └── workflows/
│       ├── ci.yml            # Standalone CI: install, typecheck, test, pack, kind-gate
│       └── release.yml       # Release workflow
├── .planning/
│   └── codebase/             # GSD codebase map documents (this directory)
├── extension-kind-gate.mjs   # Zero-dependency CI gate: validates oas.json + package shape
├── package.json              # Package manifest: name, version, cinatra.kind = "agent"
├── tsconfig.json             # TypeScript config (no .ts source files tracked; used by CI tsc check)
├── .npmrc                    # npm/pnpm registry config
└── LICENSE                   # Apache-2.0
```

## Directory Purposes

**`cinatra/`:**
- Purpose: Cinatra platform artifact directory — contains the agent's machine-readable specification
- Contains: `oas.json` — the agent flow graph (StartNode, ApiNode, EndNode, data/control-flow edges, HITL screen declarations, LLM preferences)
- Key files: `cinatra/oas.json`

**`skills/blog-wordpress-publish-agent/`:**
- Purpose: LLM instruction layer — the SKILL.md is embedded by the platform into the ApiNode system prompt at runtime
- Contains: `SKILL.md` — full step-by-step recipe, MCP tool discipline, polling cadence, HITL gate spec, output envelope contract
- Key files: `skills/blog-wordpress-publish-agent/SKILL.md`

**`.github/workflows/`:**
- Purpose: CI/CD pipeline definitions
- Contains: `ci.yml` (standalone CI gate), `release.yml` (release automation)
- Key files: `.github/workflows/ci.yml`

**`.planning/codebase/`:**
- Purpose: GSD codebase map documents written by `/gsd-map-codebase`
- Contains: ARCHITECTURE.md, STRUCTURE.md (and other focus-area docs as generated)
- Generated: Yes (by GSD tooling)
- Committed: Yes

## Key File Locations

**Entry Points:**
- `cinatra/oas.json`: Agent flow graph — the primary artifact consumed by the Cinatra platform. Defines inputs, outputs, node graph, and HITL screens.

**LLM Instructions:**
- `skills/blog-wordpress-publish-agent/SKILL.md`: Full step-by-step recipe for the LLM. Defines MCP tool constraints, polling logic, HITL gate behavior, error envelopes.

**CI Gate:**
- `extension-kind-gate.mjs`: Self-contained Node.js ESM script. Validates `cinatra/oas.json` for banned/retired MCP primitives. No external dependencies.

**Configuration:**
- `package.json`: Package identity (`@cinatra-ai/blog-wordpress-publish-agent`), version, `cinatra.kind: "agent"`, `cinatra.dependencies: []`
- `tsconfig.json`: TypeScript config (present for CI tsc invocation; no .ts source files)
- `.npmrc`: Registry configuration (existence noted; contents not read)

## Naming Conventions

**Files:**
- Agent flow: `cinatra/oas.json` (fixed platform convention — always this path)
- Skill files: `skills/<package-slug>/SKILL.md` (slug matches npm package name without `@cinatra-ai/` scope)
- CI gate: `extension-kind-gate.mjs` (shipped verbatim from extraction script; fixed name)
- Workflows: lowercase with hyphens (`ci.yml`, `release.yml`)

**Directories:**
- Platform artifact dir: `cinatra/` (fixed platform convention)
- Skill dir: `skills/<package-slug>/` (mirrors package name slug)

## Where to Add New Code

**Changing agent behavior / LLM recipe:**
- Edit: `skills/blog-wordpress-publish-agent/SKILL.md`
- Also update: `cinatra/oas.json` → `$referenced_components.publish.data.system` if the system prompt summary needs updating

**Adding or changing flow inputs/outputs:**
- Edit: `cinatra/oas.json` — update `inputs`/`outputs` at root, StartNode inputs, EndNode outputs, and DataFlowEdge declarations

**Changing LLM model or provider:**
- Edit: `cinatra/oas.json` → `metadata.cinatra.llm` (root preference) and `$referenced_components.publish.data.cinatra_llm`

**Adding a new HITL screen:**
- Edit: `cinatra/oas.json` → `metadata.cinatra.hitlScreens[]` (add renderer string)
- Document the INTERRUPT payload contract in `skills/blog-wordpress-publish-agent/SKILL.md`

**Updating the CI banned-primitive list:**
- Edit: `extension-kind-gate.mjs` → `BANNED_PRIMITIVES` array and/or `BANNED_TYPEHINTS` array

**No TypeScript source files exist.** This is a content-only agent extension. Do not add `.ts` files unless the repo is restructured as a standalone TypeScript package — this would require full CI pipeline changes.

## Special Directories

**`cinatra/`:**
- Purpose: Platform-required artifact directory; consumed by Cinatra marketplace and executor
- Generated: Partially (OAS generated from monorepo tooling, then committed)
- Committed: Yes

**`.planning/`:**
- Purpose: GSD planning and codebase map documents
- Generated: Yes (by `/gsd-map-codebase` and related GSD commands)
- Committed: Yes

---

*Structure analysis: 2026-06-09*
