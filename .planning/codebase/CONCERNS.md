# Codebase Concerns

**Analysis Date:** 2026-06-09

## Tech Debt

**No `src/` directory — TypeScript config is vestigial:**
- Issue: `tsconfig.json` declares `"rootDir": "src"` and `"include": ["src/**/*.ts", "src/**/*.tsx"]` but there is no `src/` directory in the repo. The entire agent logic lives in `skills/blog-wordpress-publish-agent/SKILL.md` (LLM prompt text) and `cinatra/oas.json` (flow definition). The tsconfig is a copy from the extraction template and serves no function here.
- Files: `tsconfig.json`
- Impact: The CI typecheck step branches on `first_party` and skips tsc for this repo (since it is a source mirror), so it never fails — but the dead config creates confusion about whether TypeScript compilation is expected.
- Fix approach: Either remove `tsconfig.json` entirely (since there are no TS sources) or add a comment clarifying it is an inert template artefact.

**`extension-kind-gate.mjs` is a copied artefact, not owned here:**
- Issue: `extension-kind-gate.mjs` is explicitly described in its own header as "shipped INTO each extracted agent/workflow repo by the extraction script." It is not authored in this repo and contains logic for both `agent` and `workflow` kinds. Future updates to the monorepo gate must be manually re-extracted; there is no automated sync mechanism visible in this repo.
- Files: `extension-kind-gate.mjs`
- Impact: Gate drift — the banned-primitive list (`BANNED_PRIMITIVES`, `BANNED_TYPEHINTS`) may become stale relative to the monorepo's authoritative `scripts/audit/oas-banned-primitives-gate.mjs`.
- Fix approach: The extraction script that regenerates this file is the authoritative fix path; there is nothing to change in this repo directly. Document that this file must not be hand-edited.

**Polling cadence and timeout are instruction-only, not enforced:**
- Issue: `skills/blog-wordpress-publish-agent/SKILL.md` specifies "every 5 seconds, max 60 cycles (5 minute cap)" for polling `blog_project_get`. These are natural-language instructions to the LLM, not code constraints. The LLM may deviate (poll faster, slower, or not at all).
- Files: `skills/blog-wordpress-publish-agent/SKILL.md`
- Impact: In a degraded or busy environment the agent could spin indefinitely or timeout prematurely with no deterministic guarantee.
- Fix approach: Not fixable within this repo's architecture (pure LLM-driven agent). Document the limitation; consider a server-side timeout at the `blog_post_publish_wordpress_start` API level.

**`adminUrl` fallback logic is ambiguous in the SKILL.md spec:**
- Issue: Step 3 of `SKILL.md` says to read `wordpressAdminUrl` from `wordpressDraftGeneration.adminUrl` with a fallback to `entry.adminUrl`. The precedence is described in prose but the two fields may be independently stale or absent; the LLM may silently return an empty `wordpressAdminUrl` in the output without surfacing an error.
- Files: `skills/blog-wordpress-publish-agent/SKILL.md`
- Impact: Operator receives an unusable empty admin URL with `approved: true`, with no indication of the missing URL.
- Fix approach: Add an explicit error case: if both `wordpressDraftGeneration.adminUrl` and `entry.adminUrl` are absent/empty, return `approved: false` with a descriptive summary.

## Known Bugs

**`blog_post_publish_wordpress_cancel` referenced in OAS metadata but not in SKILL.md:**
- Symptoms: `cinatra/oas.json` node metadata description mentions `blog_post_publish_wordpress_{start,delete,cancel}` as primitives reachable via the injected Cinatra self-MCP, but `SKILL.md` (the authoritative recipe) only authorizes `blog_project_get`, `blog_post_publish_wordpress_start`, and `blog_post_publish_wordpress_delete`. The `cancel` primitive is listed as reachable but never defined when to use it.
- Files: `cinatra/oas.json` (line 297), `skills/blog-wordpress-publish-agent/SKILL.md` (line 18-24)
- Trigger: An LLM following the OAS metadata description rather than SKILL.md could attempt to call `blog_post_publish_wordpress_cancel` in error scenarios.
- Workaround: SKILL.md's "Tool discipline" section instructs the LLM to call exactly 3 primitives. The OAS description should be corrected to omit `cancel`.

## Security Considerations

**LLM prompt injection via `postId`/`projectId`/`wordpressInstanceId` inputs:**
- Risk: All three inputs are interpolated directly into the LLM user prompt (`cinatra/oas.json` line 246: `"user": "...{{ projectId }}...{{ postId }}...{{ wordpressInstanceId }}"`) without sanitization. A crafted input value could inject additional instructions into the LLM context.
- Files: `cinatra/oas.json` (line 246)
- Current mitigation: These are internal Cinatra IDs (UUIDs or opaque strings), so injection is unlikely in practice. The `{{CINATRA_BASE_URL}}/api/llm-bridge` endpoint presumably validates callers.
- Recommendations: Validate that all three input IDs are UUID-format before interpolation into the LLM prompt, or strip characters that could constitute prompt injection.

**`.npmrc` present — may contain registry auth tokens:**
- Risk: `.npmrc` exists at the repo root. If it contains auth tokens for a private registry, those tokens are checked into source control.
- Files: `.npmrc`
- Current mitigation: File contents not read (forbidden file policy). Verify the file contains only registry URL configuration (e.g., `@cinatra-ai:registry=...`) and no auth tokens.
- Recommendations: Confirm `.npmrc` is limited to registry URL declarations and add a CI step to assert no `_authToken` is present.

**`CINATRA_BASE_URL` runtime secret injection via template variable:**
- Risk: `cinatra/oas.json` uses `{{CINATRA_BASE_URL}}` as the API endpoint URL. If the variable substitution is misconfigured or left unresolved, requests could be sent to an unintended host.
- Files: `cinatra/oas.json` (line 241)
- Current mitigation: The Cinatra runtime is responsible for substituting this value.
- Recommendations: The CI gate does not validate that `{{CINATRA_BASE_URL}}` resolves to a trusted host; this is entirely runtime-trust.

## Performance Bottlenecks

**Sequential polling with LLM latency overhead:**
- Problem: Each poll cycle requires an LLM inference step to process the response from `blog_project_get` and decide whether to continue. With a 5-second poll cadence and LLM round-trip latency, the effective cadence may be 8-15 seconds, extending the worst-case wait from 5 minutes to 10-15 minutes.
- Files: `skills/blog-wordpress-publish-agent/SKILL.md` (Step 2)
- Cause: Polling logic is embedded in LLM natural-language instructions; each cycle requires a full LLM inference pass.
- Improvement path: Move status polling to a deterministic platform primitive (a built-in wait/poll node in the flow engine) rather than relying on the LLM to loop.

## Fragile Areas

**Single-node `publish` ApiNode handles the entire flow:**
- Files: `cinatra/oas.json` (`$referenced_components.publish`)
- Why fragile: The entire orchestration — kick-off, polling, draft discovery, HITL gate, conditional delete — is delegated to a single `ApiNode` calling `/api/llm-bridge`. If the LLM produces a partial response (e.g., drops `wordpressDraftId` from output), the EndNode receives default empty strings silently.
- Safe modification: Any change to the flow shape (adding retry nodes, splitting steps) requires regenerating the full `cinatra/oas.json` and corresponding SKILL.md in sync.
- Test coverage: No tests in this repo validate the OAS structure or the LLM's adherence to the step recipe.

**Draft discovery relies on LLM to pick the "newest by `updatedAt`" entry:**
- Files: `skills/blog-wordpress-publish-agent/SKILL.md` (Step 3)
- Why fragile: The instruction "pick the latest by `updatedAt`" is implemented by the LLM with no schema validation. If `updatedAt` is absent or the array ordering changes, the LLM may pick the wrong draft silently.
- Safe modification: Add a server-side canonical "current draft" field to the API response rather than requiring client-side sorting.
- Test coverage: Not tested; no mock fixtures exist.

**On-reject delete error is swallowed:**
- Files: `skills/blog-wordpress-publish-agent/SKILL.md` (Step 4b)
- Why fragile: "If the delete throws, capture the error in `summary` but still return `approved: false`." A failed delete leaves an orphaned WordPress draft that the operator has no automated way to discover or clean up; the only signal is the error text in `summary`.
- Safe modification: Surface the delete failure as a distinct `summary` state (e.g., `"approved": false, "deleteError": true`) so callers can alert operators.
- Test coverage: Not tested.

## Scaling Limits

**5-minute hard cap on WordPress draft generation:**
- Current capacity: 60 poll cycles at ~5 seconds each = 300 seconds.
- Limit: Any WordPress environment with a slow REST API or large image upload that exceeds 5 minutes causes the agent to return `approved: false` (timeout), abandoning a potentially in-progress draft with no cleanup call.
- Scaling path: Make the timeout configurable as an optional agent input, and add a cleanup step (call `blog_post_publish_wordpress_delete`) on timeout rather than abandoning silently.

## Dependencies at Risk

**LLM model pinned to `gpt-5.5` (non-standard identifier):**
- Risk: `cinatra/oas.json` declares `"preferredModel": "gpt-5.5"` in both the root metadata and the ApiNode `cinatra_llm`. `gpt-5.5` is not a generally-available OpenAI model name as of mid-2026; if this is a Cinatra-internal alias that gets deprecated or renamed, the agent silently falls back to an unknown default or errors at runtime.
- Files: `cinatra/oas.json` (lines 18, 249)
- Impact: Silent model substitution could alter the agent's instruction-following behaviour.
- Migration plan: Verify `gpt-5.5` resolves to a stable Cinatra-internal alias and add a CI gate that validates the model identifier against a known-good list.

## Missing Critical Features

**No input validation:**
- Problem: All three required inputs (`projectId`, `postId`, `wordpressInstanceId`) are accepted as arbitrary strings with no format validation before they are passed to the LLM and embedded in API calls.
- Blocks: Cannot detect caller mistakes (swapped IDs, empty strings) until the backend returns an error.

**No cancellation path for in-progress draft creation:**
- Problem: If the operator closes the browser or the session drops during the polling loop (Step 2), there is no mechanism to cancel the in-progress background job. The `blog_post_publish_wordpress_cancel` primitive appears to exist but is not wired into any flow path.
- Blocks: Orphaned background jobs accumulate if sessions are interrupted.

## Test Coverage Gaps

**No tests exist in this repo:**
- What's not tested: All logic in `extension-kind-gate.mjs` (agent OAS validation, workflow shape validation, BPMN sanity check), the SKILL.md step recipe, and the `cinatra/oas.json` structure.
- Files: `extension-kind-gate.mjs`, `cinatra/oas.json`, `skills/blog-wordpress-publish-agent/SKILL.md`
- Risk: Changes to the gate logic, banned-primitive list, or OAS structure could silently break agent correctness with no regression detection in this repo. (The monorepo runs tests; this extracted mirror has none.)
- Priority: Medium — the monorepo is the authoritative test host, but the extracted gate (`extension-kind-gate.mjs`) ships independently and has no standalone tests to verify its own correctness.

**HITL gate renderer contract is untested:**
- What's not tested: The `x-renderer: "@cinatra-ai/blog-wordpress-publish-agent:draft-confirm"` INTERRUPT shape and the two response shapes (`{approved: true}` / `{approved: false, reason}`) are defined only in SKILL.md prose.
- Files: `skills/blog-wordpress-publish-agent/SKILL.md` (Step 4), `cinatra/oas.json` (line 12)
- Risk: A UI renderer change that alters the response shape would silently break the agent's approve/reject branching.
- Priority: High — the HITL gate is the core user-facing interaction point.

---

*Concerns audit: 2026-06-09*
