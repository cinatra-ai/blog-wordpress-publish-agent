# External Integrations

**Analysis Date:** 2026-06-09

## APIs & External Services

**Cinatra Platform (LLM Bridge):**
- Cinatra `/api/llm-bridge` — the single HTTP endpoint called by the agent's `ApiNode`
  - URL template: `{{CINATRA_BASE_URL}}/api/llm-bridge`
  - Auth: `CINATRA_BASE_URL` environment variable (platform-injected)
  - Defined in: `cinatra/oas.json` (`publish` node, `ApiNode.url`)

**OpenAI:**
- GPT-5.5 — LLM used for agent orchestration reasoning
  - `preferredProvider: "openai"`, `preferredModel: "gpt-5.5"` declared in `cinatra/oas.json`
  - Auth: managed by Cinatra platform (not directly in this repo)

**WordPress:**
- External WordPress instances — the agent creates, manages, and optionally deletes WordPress draft posts
  - Integrated via Cinatra MCP tool primitives (not direct API calls from this repo):
    - `blog_post_publish_wordpress_start` — initiates background draft creation job
    - `blog_post_publish_wordpress_delete` — deletes draft from WordPress when operator rejects
  - WordPress admin URL returned as output (`wordpressAdminUrl`)
  - Connection identified by `wordpressInstanceId` input parameter
  - Defined in: `skills/blog-wordpress-publish-agent/SKILL.md`

## Data Storage

**Databases:**
- Not applicable — this agent holds no persistent state directly; state lives in the Cinatra platform

**File Storage:**
- Cinatra Artifact Store — blog post body and hero image stored as artifacts
  - `@cinatra-ai/blog-post-artifact` — artifact type for post body (`postArtifactId` + `postRepresentationRevisionId`)
  - `@cinatra-ai/blog-image-artifact` — artifact type for hero image (`imageArtifactId` + `imageRepresentationRevisionId`)
  - Bytes resolved server-side by `blog_post_publish_wordpress_start`; this agent never reads raw bytes

**Caching:**
- Not applicable

## Authentication & Identity

**Auth Provider:**
- Cinatra Platform — manages all auth for LLM bridge, WordPress instances, and artifact access
  - Implementation: credentials injected at runtime by the Cinatra platform; not configured in this repo

## Monitoring & Observability

**Error Tracking:**
- Not detected — no third-party error tracking integration in this repo

**Logs:**
- Agent returns structured JSON output with a `summary` field for human-readable status on all outcomes (success, reject, error, timeout)

## CI/CD & Deployment

**Hosting:**
- Cinatra Marketplace (`registry.cinatra.ai`) — distribution target
- Deployed and executed within the Cinatra AI agent runtime

**CI Pipeline:**
- GitHub Actions
  - `.github/workflows/ci.yml` — build, typecheck, test, pack (dry-run), and OAS validation gate on push/PR to `main`
  - `.github/workflows/release.yml` — triggers marketplace submission on GitHub Release publish; uses `cinatra-ai/.github/.github/workflows/reusable-extension-release.yml@main`
  - OAS validation: `node extension-kind-gate.mjs --package-root .` (self-contained, no external deps)

## Environment Configuration

**Required env vars:**
- `CINATRA_BASE_URL` — base URL for Cinatra platform API (used in `cinatra/oas.json`)
- `CINATRA_MARKETPLACE_VENDOR_TOKEN` — org-level GitHub secret for marketplace release (`.github/workflows/release.yml`)

**Secrets location:**
- GitHub org-level secrets (for CI/CD)
- `.npmrc` present — may contain registry auth token (not read)

## Webhooks & Callbacks

**Incoming:**
- Not applicable — agent is invoked by the Cinatra platform, not via webhooks

**Outgoing:**
- HITL (Human-in-the-Loop) INTERRUPT — agent emits an interrupt at the `:draft-confirm` gate with renderer `@cinatra-ai/blog-wordpress-publish-agent:draft-confirm`
  - Payload: `{ wordpressDraftId, wordpressAdminUrl, wordpressInstanceId }`
  - Declared in: `cinatra/oas.json` (`metadata.cinatra.hitlScreens`), `skills/blog-wordpress-publish-agent/SKILL.md` (Step 4)
  - Awaits operator approval or rejection before proceeding

## MCP Tool Primitives

The agent orchestrates via exactly three Cinatra MCP primitives (injected by platform; not npm packages):

| Primitive | Purpose | Defined in |
|-----------|---------|------------|
| `blog_project_get` | Poll background job status; discover `wordpressDraftId` and `adminUrl` | `skills/blog-wordpress-publish-agent/SKILL.md` |
| `blog_post_publish_wordpress_start` | Kick off async WordPress draft creation (resolves artifact bytes server-side) | `skills/blog-wordpress-publish-agent/SKILL.md` |
| `blog_post_publish_wordpress_delete` | Delete draft from WordPress on operator rejection (`deleteInWordPress: true`) | `skills/blog-wordpress-publish-agent/SKILL.md` |

Polling cadence: every 5 seconds, max 60 cycles (5-minute cap), as specified in `skills/blog-wordpress-publish-agent/SKILL.md`.

---

*Integration audit: 2026-06-09*
