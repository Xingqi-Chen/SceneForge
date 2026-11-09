# T63 / Issue #203: Responses-only generation

## Review Result: APPROVE

Reviewed on 2026-11-09 on `issue-203-openai-responses`. Scope source: [GitHub Issue #203](https://github.com/Xingqi-Chen/SceneForge/issues/203), recorded under T63 in `docs/plan.md`. The final diff matches the Issue's Responses-only generation, native input/schema support, legacy compatibility, preserved routing/embeddings, privacy, and documentation scope.

## Blocking Issues

None remain. Two issues found during review were corrected and rechecked:

- Native `input_image` now accepts valid HTTP(S) URLs as well as data-image URLs, preserves the exact supplied URL and detail, and rejects unsupported schemes before upstream requests. Legacy image validation remains data-only.
- Local log metadata now retains the actual `style-advice` Run planning node identifier. Story correlation uses bounded hashes, and arbitrary context is omitted.

## Non-blocking Suggestions

No changes required. Live provider compatibility was not exercised; configured generation models must support Responses, as documented. This residual integration risk is acceptable for the approved mocked validation scope.

## Architecture Notes

- One closed-over Responses executor owns all generation transport. The unbound-safe `completeChat` alias delegates to it; no production Chat Completions endpoint, request serializer, or fallback remains. Embeddings retain their existing endpoint and behavior.
- Both public API routes use the shared server handler. Native string input stays a string; message roles, order, image URLs, and detail are preserved. Supported fields alone are serialized upstream.
- Native generic formats validate names, object schemas, JSON data, description, and optional strictness. Conflicting native/legacy input, token, and format fields fail before provider calls. The legacy Run schema/purpose whitelist and dedicated Run planning authorization remain intact.
- Purpose/default/explicit/NSFW routing and the Preview Scoring exception retain their previous behavior. Strict completed-output validation, forced-SSE decoding, and existing retry bounds are preserved.
- Generation console and local logging use metadata summaries. Prompt/completion bodies, schema contents, image URLs, routing/model identifiers, credentials, provider payloads, raw errors, stack traces, and paths are omitted. Log write failures remain nonfatal and safe.
- New server logging and environment access remain behind server boundaries; no new client dependency on Node APIs or secrets was found. No dependency, persistence, project schema, or ComfyUI behavior changes are included.

Reviewed production files:

- `src/features/llm/{litellm-client,types,validation,llm-local-log,model-routing.server,run-scene-prompt-response-format,responses-handler.server}.ts`
- `src/app/api/llm/{chat,responses}/route.ts`
- `src/features/agent-timeline/{run-planning-responses,run-scene-suggestion.server}.ts`
- `src/features/civitai-lora-library/{ai-recommendation,enrichment}.ts`

Also reviewed related direct Story/Run integration call sites, all changed colocated tests, the new Responses client/route tests, `.env.example`, `README.md`, `docs/{plan,product-spec,tech-spec,dev-log}.md`, and the final Test Gate report. Final production source was rechecked after fixes, and final test changes retained business-result assertions rather than masking defects.

## Test Coverage

The [Test Gate report](../test-reports/t63-openai-responses.md) records:

- Focused migration coverage: PASS, including native/legacy inputs, strict omitted/true/false, URL handling, conflicts, routing, privacy, embeddings, and integration behavior.
- Full Vitest suite: PASS, 170 files / 2,367 tests.
- Typecheck: PASS; final local-log regression rerun: PASS, 17 tests.
- Lint: PASS, zero errors and 22 existing image-element warnings.
- Production build: PASS; both public LLM routes registered.

Reviewer `git diff --check` and production transport searches passed. Existing strict-output and SSE rejection coverage remains active. Root's changed-file credential/runtime-artifact scan was clean. No live provider requests were made.

## Commit / PR Readiness

Ready for the Orchestrator's scoped commit, push, and PR for Issue #203. Test Gate is PASS and Review Gate is APPROVE. Update the tracker with these gates and the resulting PR reference. Merge remains subject to explicit user instruction.
