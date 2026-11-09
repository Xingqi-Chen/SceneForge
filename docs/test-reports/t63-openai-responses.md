# T63 / Issue #203: Responses-only generation

## Test Result: PASS

Validated on 2026-11-09 on `issue-203-openai-responses`. Scope source: GitHub Issue #203, “Standardize all LLM generation calls on OpenAI Responses.” Test changes are limited to colocated tests and this report; no production changes were made by the tester.

## Test Cases Added

- `src/features/llm/responses-client.test.ts`: native string input, instructions, native token limit, explicit/default model, normalized application response and usage; generic schemas with strict omitted/true/false; ordered system/developer/assistant/user messages and multimodal parts; data and HTTP(S) image URLs with exact URL/detail preservation; conflicting fields rejected before fetch; malformed and unsupported image URLs rejected; unbound `completeChat` compatibility; metadata-only console logs; hostile Chat-shaped output rejection without fallback.
- `src/app/api/llm/responses/route.test.ts`: the same native and legacy contracts on both `/api/llm/responses` and `/api/llm/chat`; generic schemas; ordered multimodal input; conflict/schema/URL/JSON rejection before constructing a client; safe provider failures; default, purpose, explicit, NSFW, Preview Scoring, Final Review, and Repair routing; missing scoring default configuration.
- `src/features/llm/validation.test.ts`: structural generic schema validation, optional strict, native message/part validation, finite positive integer native tokens, conflicts, preserved legacy schema whitelist, and preserved legacy data-only image boundary.
- `src/features/llm/llm-local-log.test.ts`: legacy/default logging privacy, native log category, hashed Story correlation, allowed Run node metadata including `style-advice`, rejected arbitrary context, and path-free log write failure diagnostics.
- Updated successful client, repair privacy, Civitai enrichment/import/reanalysis/recommendation, and Story logging fixtures and assertions to Responses. Retained business-result and embedding assertions. Retained hostile `choices` fixtures used by existing strict-output and SSE rejection regressions.

## Commands Run

| Command | Result |
| --- | --- |
| Focused LLM, API, and Civitai enrichment/import/reanalysis tests | PASS: 11 files, 273 tests |
| Focused LLM, API, Civitai recommendation, and Story runner tests after all coverage additions | PASS: 10 files, 294 tests |
| `npm test` | PASS: 170 files, 2,367 tests; 31.97 seconds |
| `npm run typecheck` | PASS after the final test typing correction |
| `npm run lint` | PASS: 0 errors; 22 existing `@next/next/no-img-element` warnings |
| Scoped ESLint over new/updated native, validation, logging, Story, and recommendation tests | PASS |
| `npm test -- src/features/llm/llm-local-log.test.ts` after the typing correction | PASS: 17 tests |
| `npm run build` | PASS: compilation, TypeScript, static generation, and route collection |
| Source search for `chat/completions`, `response_format`, and `stream: true` in non-test LLM source | No matches |

Interim runs identified stale Chat mock/log expectations in two additional integration test files; these were migrated and the full suite then passed. One new log test initially failed typecheck because its phase discriminator was widened; explicit typed phase calls corrected the test, followed by successful typecheck, its focused rerun, and the production build.

## Evidence

- Mocked fetch assertions require `/v1/responses`, `stream:false`, and `store:false`; legacy fields map to native fields without leaking Chat transport fields. Existing embedding tests still require `/v1/embeddings` with unchanged inputs and output normalization.
- Both API routes construct one Responses client call for valid requests and no client for conflicting or malformed requests. Optional strict stays absent when omitted and forwards false without coercion.
- Existing strict completion, refusal, incomplete output, malformed response, and forced-SSE validation tests pass unchanged in behavior, including no Chat fallback and no transport retries. Existing timeline retry and workflow regression suites also pass in the full run.
- Sentinel assertions exclude input text, instructions, completion text, schema names/descriptions/bodies, image data/URLs, model identifiers, credentials, raw errors, and private paths from generation log boundaries. Story correlation remains stable through hashed IDs.
- Production build includes both `/api/llm/responses` and `/api/llm/chat` as dynamic routes.
- All integration responses were mocked or used local temporary fixtures. No request was sent to the configured live LLM endpoint. No browser QA is required for this backend-only change.

## Blocking Issues

None.

## Non-blocking Issues

- Existing image-element lint warnings and Node SQLite experimental warnings remain.
- Live provider compatibility was not exercised; the configured provider/model must support Responses. This is outside the requested mocked validation scope.

## Recommended Fixes

None for Issue #203. Proceed to the Review and Closeout gates.
