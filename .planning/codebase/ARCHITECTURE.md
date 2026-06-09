<!-- refreshed: 2026-06-09 -->
# Architecture

**Analysis Date:** 2026-06-09

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                    Caller / Orchestrator                     │
│  Provides: projectId, postId, wordpressInstanceId            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│               StartNode  (`cinatra/oas.json` → "start")      │
│  Validates required inputs; passes them to the ApiNode       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│         ApiNode "publish"  (`cinatra/oas.json` → "publish")  │
│  POST {{CINATRA_BASE_URL}}/api/llm-bridge                    │
│  LLM: openai / gpt-5.5 — follows SKILL.md recipe            │
│  MCP tools available (via injected Cinatra self-MCP):        │
│   • blog_post_publish_wordpress_start                        │
│   • blog_project_get  (polling)                              │
│   • blog_post_publish_wordpress_delete                       │
│  HITL Gate: :draft-confirm  (operator confirms or rejects)   │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│               EndNode  (`cinatra/oas.json` → "end")          │
│  Outputs: projectId, postId, wordpressDraftId,               │
│           wordpressAdminUrl, approved, summary               │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| StartNode (`start`) | Declares and passes required inputs | `cinatra/oas.json` → `$referenced_components.start` |
| ApiNode (`publish`) | LLM orchestration via `/api/llm-bridge`; executes 4-step recipe; handles HITL | `cinatra/oas.json` → `$referenced_components.publish` |
| EndNode (`end`) | Collects and exposes final output fields with safe defaults | `cinatra/oas.json` → `$referenced_components.end` |
| SKILL.md | Authoritative LLM system prompt defining MCP tool discipline and step-by-step recipe | `skills/blog-wordpress-publish-agent/SKILL.md` |
| extension-kind-gate | Zero-dependency CI gate; validates `cinatra/oas.json` for retired MCP primitives | `extension-kind-gate.mjs` |

## Pattern Overview

**Overall:** Cinatra Agent Flow — a declarative JSON graph (`cinatra/oas.json`) executed by the Cinatra platform. The agent is LLM-driven and operational-metadata-only: it orchestrates IDs and status transitions; the platform resolves artifact bytes server-side.

**Key Characteristics:**
- Single ApiNode calls `/api/llm-bridge` with an injected system prompt and user message derived from SKILL.md.
- The LLM is constrained to exactly 3 MCP primitives; no others may be called.
- A single HITL gate (`:draft-confirm`) pauses execution for operator approval before finalizing.
- Blog post body and hero image are artifact-canonical — the LLM never reads raw bytes.
- All error paths produce the same output envelope shape (`approved: false`, descriptive `summary`).

## Layers

**Flow Declaration Layer:**
- Purpose: Declares the graph structure (nodes, edges, I/O bindings)
- Location: `cinatra/oas.json`
- Contains: StartNode, ApiNode, EndNode, control-flow edges, data-flow edges
- Depends on: Cinatra platform runtime
- Used by: Cinatra platform executor

**LLM Instruction Layer:**
- Purpose: System prompt / recipe governing exactly what the LLM does at runtime
- Location: `skills/blog-wordpress-publish-agent/SKILL.md`
- Contains: MCP tool discipline, polling cadence, HITL gate spec, error envelope contract
- Depends on: Cinatra self-MCP (injected at runtime)
- Used by: ApiNode `publish` (embedded in the `data.system` field of the llm-bridge POST)

**CI Validation Layer:**
- Purpose: Pre-publish sanity gate on the agent OAS and package shape
- Location: `extension-kind-gate.mjs`
- Contains: `validateAgent`, `runGate`, banned-primitive scanner, workflow BPMN validator
- Depends on: Node.js builtins only (zero external dependencies)
- Used by: `.github/workflows/ci.yml` `kind-gates` job

## Data Flow

### Primary Request Path (Happy Path — Operator Approves)

1. Caller provides `projectId`, `postId`, `wordpressInstanceId` → StartNode (`cinatra/oas.json`)
2. StartNode passes all three inputs via DataFlowEdges to ApiNode `publish`
3. ApiNode POSTs to `{{CINATRA_BASE_URL}}/api/llm-bridge`; LLM calls `blog_post_publish_wordpress_start` (Step 1)
4. LLM polls `blog_project_get` every 5 s, max 60 cycles, until `wordpressDraftGeneration.status === "succeeded"` (Step 2)
5. LLM scans `posts[].wordpressDrafts[]` for the matching draft entry; captures `wordpressDraftId` and `adminUrl` (Step 3)
6. LLM emits HITL INTERRUPT with renderer `@cinatra-ai/blog-wordpress-publish-agent:draft-confirm` (Step 4)
7. Operator confirms → LLM returns JSON `{ approved: true, ... }`
8. ApiNode outputs propagate via DataFlowEdges to EndNode → caller receives final output

### Reject Path (Operator Rejects)

1. Steps 1–6 same as above
2. Operator rejects → LLM calls `blog_post_publish_wordpress_delete({ deleteInWordPress: true })`
3. LLM returns JSON `{ approved: false, summary: "Operator rejected; WordPress draft deleted. Reason: ..." }`
4. EndNode propagates `approved: false` output to caller

### Error / Timeout Paths

- `blog_post_publish_wordpress_start` throws → immediate `{ approved: false, summary: "...failed: <error>" }` return from ApiNode
- Poll returns `"failed"` or `"stopped"` status → immediate error envelope
- 60 poll cycles elapsed → timeout error envelope (`summary: "...timed out after 5 minutes."`)

**State Management:**
- No local state. All state lives in the Cinatra backend (blog project, WordPress draft records). The LLM reads state by polling `blog_project_get`.

## Key Abstractions

**HITL Gate (`:draft-confirm`):**
- Purpose: Pause the flow for a human operator to review the newly created WordPress draft
- Declared in: `cinatra/oas.json` → `metadata.cinatra.hitlScreens`
- Renderer: `@cinatra-ai/blog-wordpress-publish-agent:draft-confirm`
- Pattern: A2UI INTERRUPT mechanism; LLM emits interrupt, platform suspends flow, resumes on operator action

**MCP Primitive Set (3 tools only):**
- `blog_project_get` — read/poll blog project state
- `blog_post_publish_wordpress_start` — kick off async WP draft creation
- `blog_post_publish_wordpress_delete` — delete WP draft on reject
- Pattern: Injected via Cinatra self-MCP; `metadata.cinatra.toolboxes` intentionally omitted so the platform injects only these.

**Artifact-Canonical Content:**
- Purpose: Decouple the agent from large binary payloads (post body HTML, hero image)
- Pattern: `blog_project_get` returns only `postArtifactId` + `imageArtifactId` refs; `blog_post_publish_wordpress_start` resolves bytes server-side via artifact reader helpers.

**Output Envelope:**
- Every code path returns the same 6-field JSON: `{ projectId, postId, wordpressDraftId, wordpressAdminUrl, approved, summary }`
- EndNode declares safe defaults (empty strings / `false`) for all fields.

## Entry Points

**Flow Invocation:**
- Location: `cinatra/oas.json` → StartNode `start`
- Triggers: Cinatra platform executor when a caller invokes the `blog-wordpress-publish-agent` agent
- Responsibilities: Accept and validate `projectId`, `postId`, `wordpressInstanceId`

**CI Gate:**
- Location: `extension-kind-gate.mjs` → `main()` function
- Triggers: `node extension-kind-gate.mjs --package-root .` in `.github/workflows/ci.yml`
- Responsibilities: Parse `cinatra/oas.json`, scan LLM-visible strings for banned/retired MCP primitives, exit 0 or 1

## Architectural Constraints

- **Threading:** Not applicable — the agent is a declarative JSON flow executed by the Cinatra platform runtime; the LLM call is async/stateless.
- **Global state:** None. All mutable state is in Cinatra backend services.
- **Circular imports:** Not applicable — no TypeScript source files; the only executable is `extension-kind-gate.mjs` (ESM, Node builtins only).
- **MCP tool discipline:** The LLM MUST call exactly the 3 declared MCP primitives. `blog_post_publish_wordpress_status` is explicitly forbidden — use `blog_project_get` for polling instead (the draft ID is not available until polling succeeds).
- **Poll cap:** Maximum 60 cycles at 5-second intervals (5-minute timeout) hard-coded in SKILL.md.
- **No inline content:** The agent is operational-metadata-only. It never reads or transmits post body bytes or image bytes.

## Anti-Patterns

### Calling `blog_post_publish_wordpress_status`

**What happens:** LLM calls the status primitive directly instead of polling via `blog_project_get`.
**Why it's wrong:** `wordpressDraftId` is not known until the poll succeeds, so the status primitive would fail; SKILL.md explicitly forbids it.
**Do this instead:** Poll `blog_project_get({ projectId })` and read `wordpressDraftGeneration.status` until `"succeeded"` — see `skills/blog-wordpress-publish-agent/SKILL.md` Step 2.

### Adding first-party deps to `dependencies` / `devDependencies`

**What happens:** A `@cinatra-ai/*` package is added to `dependencies` or `devDependencies` instead of `peerDependencies`.
**Why it's wrong:** First-party packages are not published to any public registry; standalone CI would fail to install them. The CI gate (`ci.yml` "Classify repo" step) exits 2 on detection.
**Do this instead:** Declare as `peerDependencies` with `peerDependenciesMeta[pkg].optional = true`.

## Error Handling

**Strategy:** All error paths converge to the same output envelope `{ approved: false, summary: "<explanation>" }`. No exceptions bubble to the caller — the LLM catches errors from MCP primitives and converts them to `summary` strings.

**Patterns:**
- MCP primitive throws → catch error, embed in `summary`, return `approved: false` immediately
- Poll status `"failed"` or `"stopped"` → return error envelope with status-specific message
- Poll timeout (60 cycles) → return `{ approved: false, summary: "WP draft creation timed out after 5 minutes." }`
- Delete-on-reject throws → capture error in `summary`, still return `approved: false`

## Cross-Cutting Concerns

**Logging:** Delegated to Cinatra platform runtime. The agent itself emits no logs.
**Validation:** CI gate (`extension-kind-gate.mjs`) validates `cinatra/oas.json` for banned primitives pre-publish. Package shape validated by `ci.yml` "Classify repo" step.
**Authentication:** Not applicable at agent level — Cinatra platform injects credentials for MCP primitives and the `/api/llm-bridge` endpoint.

---

*Architecture analysis: 2026-06-09*
