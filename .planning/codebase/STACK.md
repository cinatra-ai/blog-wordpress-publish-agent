# Technology Stack

**Analysis Date:** 2026-06-09

## Languages

**Primary:**
- JSON — agent flow definition (`cinatra/oas.json`), package manifest (`package.json`)
- Markdown — skill/agent instructions (`skills/blog-wordpress-publish-agent/SKILL.md`)

**Secondary:**
- TypeScript — configured via `tsconfig.json` targeting `src/` (no `src/` directory exists in current repo; this is a content-only agent extension with no TypeScript sources tracked)
- JavaScript (ESM) — CI gate utility `extension-kind-gate.mjs` (plain Node.js, zero dependencies)

## Runtime

**Environment:**
- Node.js 24 (specified in `.github/workflows/ci.yml` via `actions/setup-node`)

**Package Manager:**
- pnpm (managed via corepack; `corepack enable` in CI)
- Lockfile: not committed (CI uses `--no-frozen-lockfile`; this is a source-mirror repo resolved by the Cinatra monorepo)

## Frameworks

**Core:**
- Cinatra AI agent platform — `cinatra.apiVersion: "cinatra.ai/v1"`, `cinatra.kind: "agent"` (declared in `package.json`)
- Agentspec — `agentspec_version: "26.1.0"` (declared in `cinatra/oas.json`)
- OpenAI GPT — LLM provider; `preferredProvider: "openai"`, `preferredModel: "gpt-5.5"` (declared in `cinatra/oas.json`)

**Testing:**
- Not applicable — this repo has no test files; testing runs in the Cinatra monorepo

**Build/Dev:**
- GitHub Actions — CI pipeline (`.github/workflows/ci.yml`, `.github/workflows/release.yml`)
- `extension-kind-gate.mjs` — self-contained, zero-dependency OAS validation gate run via plain `node`

## Key Dependencies

**Critical:**
- `@cinatra-ai/blog-wordpress-publish-agent` (this package, `v0.1.0`) — the agent itself
- Cinatra MCP (injected at runtime) — provides `blog_project_get`, `blog_post_publish_wordpress_start`, `blog_post_publish_wordpress_delete` as MCP tool primitives
- `@cinatra-ai/blog-post-artifact` — artifact type for blog post body (resolved server-side; no direct npm dep)
- `@cinatra-ai/blog-image-artifact` — artifact type for blog hero image (resolved server-side; no direct npm dep)

**Infrastructure:**
- `cinatra-ai/.github` reusable workflow — `reusable-extension-release.yml@main` used for marketplace release
- `registry.cinatra.ai` — Cinatra Marketplace registry (publish target)

## Configuration

**Environment:**
- `.npmrc` file is present — contents not read (may contain registry auth)
- `CINATRA_MARKETPLACE_VENDOR_TOKEN` — org-level GitHub secret required for marketplace release (referenced in `.github/workflows/release.yml`)
- `CINATRA_BASE_URL` — template variable used in `cinatra/oas.json` `ApiNode.url` (`{{CINATRA_BASE_URL}}/api/llm-bridge`)

**Build:**
- `tsconfig.json` — standalone TypeScript config targeting `ES2023`, `ESNext` modules, `bundler` module resolution, outputs to `dist/`; `rootDir: "src"` (no `src/` exists, this is a content-only extension)
- `package.json` — declares `cinatra.apiVersion`, `cinatra.kind: "agent"`, `cinatra.dependencies: []`

## Platform Requirements

**Development:**
- Node.js 24+
- pnpm (via corepack)
- Access to Cinatra monorepo for type-checking and testing (this is a source-mirror repo)

**Production:**
- Deployed and executed within the Cinatra AI platform
- LLM inference via OpenAI (gpt-5.5)
- Agent runtime accesses `{{CINATRA_BASE_URL}}/api/llm-bridge` endpoint
- Cinatra Marketplace registry (`registry.cinatra.ai`) as the package distribution target

---

*Stack analysis: 2026-06-09*
