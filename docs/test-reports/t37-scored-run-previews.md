# T37 Scored Run Previews Test Report

## Test Result: PASS

- Scope source: Track `T37`, GitHub Issue `#133`.
- Branch: `issue-133-scored-run-previews`.
- Date: 2026-07-20.
- Result: the focused matrix, relevant timeline/API/LLM regressions, full Vitest suite, TypeScript, lint, and production build passed after Fix Loop 14 request-local preview seed authorization and bounded Vision network retry classification.

## Automated Coverage Added

- Preview pool mapping K=1/2/3/4 to 4/4/6/8 and exact preview dimension transforms.
- Fixed/random seed materialization, stable candidate increments, candidate seed reuse in final requests, and source-img2img K preservation.
- Preview request transformations: independent batch size one, step cap 10, low resolution, disabled Detailers, preserved prompt/model/context/source denoise, and no formal-parameter mutation.
- Top-K final requests: selected-preview linkage, formal dimensions/steps/settings, candidate seeds, batch size one, internal denoise 0.50, and ranking order.
- Structured scoring: exact candidate coverage, duplicate/unknown/missing rejection, finite 0–100 bounds, local weights, total/composition/stable-order ties, identical one-time retry, Vision/default routing, and NSFW-only routing.
- Partial previews and recoverable blocking, partial final preservation, and missing-only final retry.
- Retry API validation, phase-specific DAG stale propagation, manual reselection boundaries, and retained confirmation.
- Single-image definition v2, legacy completed/incomplete recovery, interrupted state, preview/final reference separation, and data/secret/path/full-workflow redaction.
- Detailed preview UI ranking/five scores/exact-K interaction and source-img2img Composer behavior in both workflow display modes.

## Commands Run

1. Focused T37 suite:
   - `npm test -- --run src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/t37-preview-scoring.test.ts src/features/agent-timeline/t8-server-adapters.test.ts src/features/agent-timeline/workflow-definition.test.ts src/features/agent-timeline/workflow.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts src/features/agent-timeline/components/TimelinePreviewWorkspace.test.tsx src/app/api/agent-timeline/confirm-generation/route.test.ts`
   - Initial result: 8 files, 104 tests; 101 passed and 3 exact-K boundary tests failed.
2. Agent timeline/API/LLM regression suite:
   - `npm test -- --run src/features/agent-timeline src/app/api/agent-timeline src/app/api/llm/chat/route.test.ts src/features/llm`
   - Initial run: 44 files, 470 tests; 466 passed, 3 blocking exact-K tests failed, and 1 legacy source-img2img assertion was corrected for v2 behavior.
3. Source-img2img UI regression after assertion correction:
   - `npm test -- --run src/features/agent-timeline/components/TimelineShell.test.tsx`
   - PASS: 1 file, 35 tests.
4. `npm run typecheck`
   - PASS.
5. `npm run lint`
   - PASS with 0 errors and 23 pre-existing warnings (`no-unused-vars` and `no-img-element`).
6. `npm test`
   - Initial run before Fix Loop 1: 129 files, 1110 tests; 1107 passed and the 3 exact-K boundary tests failed.
7. `npm run build`
   - PASS: Next.js production build, TypeScript, page-data collection, and 46 static pages.
8. `git diff --check`
   - PASS; only line-ending notices were printed.

## Fix Loop 1

The initial Test Gate found that `createTimelineFinalRequests` trusted crafted persisted/manual selections. Fix Loop 1 added server-side validation before any final request is built:

- selection length and distinct ID count must both equal K;
- every ID must resolve to exactly one successful candidate with a stored image and valid safe seed;
- every selection must resolve to exactly one valid score/rank, with distinct ranks;
- too-few, duplicate, and unknown selections fail uniformly before final queueing.

Post-fix evidence:

1. Original focused matrix:
   - `npm test -- --run src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/t37-preview-scoring.test.ts src/features/agent-timeline/t8-server-adapters.test.ts src/features/agent-timeline/workflow-definition.test.ts src/features/agent-timeline/workflow.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts src/features/agent-timeline/components/TimelinePreviewWorkspace.test.tsx src/app/api/agent-timeline/confirm-generation/route.test.ts`
   - PASS: 8 files, 104 tests.
2. Relevant timeline/API/LLM regression suite:
   - `npm test -- --run src/features/agent-timeline src/app/api/agent-timeline src/app/api/llm/chat/route.test.ts src/features/llm`
   - PASS: 44 files, 470 tests.
3. Full suite:
   - `npm test`
   - PASS: 129 files, 1110 tests.
4. `npm run typecheck`
   - PASS.
5. `npm run lint`
   - PASS with 0 errors and 23 pre-existing warnings.
6. `npm run build`
   - PASS: Next.js production build, TypeScript, page-data collection, and 46 static pages.

## Blocking Issues

- None.

## Fix Loops 2–3

Reviewer-requested security, persistence, scoring-order, and default-Simple-mode regressions were added and passed:

- Vision ranking compares the unrounded weighted total. Candidates whose displayed totals both round to `80.00` retain their true raw-total order instead of entering the composition tie-break.
- Confirmation retry uses a server HMAC fingerprint of scene input, prompt, character/canvas state, resources, parameters, source image, K, and NSFW state. Crafted prompt/resource/parameter/source/K/NSFW retry payloads return `409 confirmation_required` before any ComfyUI call.
- Incomplete current-v2 Runs with missing or legacy confirmation fingerprints restore unconfirmed and block every generation phase pending review.
- Preview/final persistence accepts only managed generated-image filenames and derived local API URLs. Traversal paths, arbitrary URLs, missing source/stored refs, and malformed completed phases become recoverable errors.
- Cross-node restore validates selected candidate IDs, preview seeds, scoring ranks, final records, and result links. Complete mismatches fail closed; partial finals retain only valid done records and convert mismatches to recoverable missing/error records.
- Simple mode exposes preview/scoring/final error details and phase-specific retry actions. The requested phase becomes visibly running while the synchronous server request is pending, and partial final errors show the safely stored `done/K` count plus missing-only retry guidance.

Post-fix evidence:

1. Focused T37/API/UI/persistence matrix:
   - `npm test -- --run src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/t37-preview-scoring.test.ts src/features/agent-timeline/t8-server-adapters.test.ts src/features/agent-timeline/workflow-definition.test.ts src/features/agent-timeline/workflow.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts src/features/agent-timeline/components/TimelinePreviewWorkspace.test.tsx src/features/agent-timeline/components/TimelineShell.test.tsx src/app/api/agent-timeline/confirm-generation/route.test.ts`
   - PASS: 9 files, 161 tests.
2. Related timeline/API/LLM/generated-image regression suite:
   - `npm test -- --run src/features/agent-timeline src/app/api/agent-timeline src/app/api/llm/chat/route.test.ts src/features/llm src/features/comfyui/generated-image-storage.test.ts`
   - PASS: 44 files, 492 tests.
3. Full suite:
   - `npm test`
   - PASS: 129 files, 1132 tests.
4. `npm run typecheck`
   - PASS.
5. `npm run lint`
   - PASS with 0 errors and 23 pre-existing warnings.
6. `npm run build`
   - PASS: Next.js production build, TypeScript, page-data collection, and 46 static pages.

## Fix Loop 4

Reviewer-requested replay, manual-ranking, legacy migration, and staged-progress regressions were added and passed:

- A valid HMAC copied from one `workflowId` to another returns `409 confirmation_required` before any ComfyUI call.
- Detailed K=2 manual selection can choose global scoring ranks 1 and 3; final requests, final persistence, result links, serialization, and restore preserve those ranks.
- Completed legacy Runs remain compatible only when their generated-image references are complete and safe. Missing images, arbitrary URLs, unsafe filenames/subfolders/prompt IDs, and Windows drive-shaped paths fail closed and require reconfirmation.
- Simple initial confirmation makes three observable requests: `confirm/preview-execution`, `continue/preview-scoring`, then `continue/comfyui-execution`. The UI visibly advances through Preview generation, Preview scoring, and Render execution while each request is pending.
- The staged endpoint rejects confirmation that starts after preview, continuation that skips dependencies, and continuation with a stale fingerprint. Scoring continuation retains completed previews and does not call ComfyUI to regenerate them.

Post-fix evidence:

1. Focused T37/API/UI/persistence matrix:
   - `npx vitest run src/features/agent-timeline/t37-preview-scoring.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts src/app/api/agent-timeline/confirm-generation/route.test.ts src/features/agent-timeline/components/TimelineShell.test.tsx src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/t8-server-adapters.test.ts src/features/agent-timeline/workflow-definition.test.ts src/features/agent-timeline/workflow.test.ts src/features/agent-timeline/components/TimelinePreviewWorkspace.test.tsx`
   - PASS: 9 files, 175 tests.
2. Related timeline/API/LLM/generated-image regression suite:
   - `npx vitest run src/features/agent-timeline src/app/api/agent-timeline src/app/api/llm/chat/route.test.ts src/features/llm src/features/comfyui/generated-image-storage.test.ts`
   - PASS: 44 files, 506 tests.
3. Full suite:
   - `npm test`
   - PASS: 129 files, 1146 tests.
4. `npm run typecheck`
   - PASS.
5. `npm run lint`
   - PASS with 0 errors and 23 pre-existing warnings.
6. `npm run build`
   - PASS: Next.js production build, TypeScript, page-data collection, and 46 static pages.
7. `git diff --check`
   - PASS; only line-ending notices were printed.

## Fix Loop 5

The final targeted restore boundary now has table-driven malformed scoring coverage:

- Current-v2 restore rejects unsupported rubric versions; missing, duplicate, or unknown candidate coverage; non-finite, string, negative, or over-100 dimensions/totals; duplicate, gapped, or out-of-range ranks; and invalid exact-K selections or selection sources.
- Every malformed scoring case restores `preview-scoring` as recoverable `timeline_request_invalid`, clears its result, and clears/invalidates `comfyui-execution` and `result-display` so no untrusted final can continue or display.
- A forged but finite in-range persisted `total` is ignored and recomputed from the fixed 30/25/20/15/10 weights; the regression fixture recalculates `0` to `75.00`.
- A staged final continuation whose persisted scoring sanitizes to invalid is rejected with `409 timeline_node_blocked` before any ComfyUI call.
- Detailed UI restore receives the sanitized scoring error, renders the retained previews without ranking values, disables selection, and does not throw from `total.toFixed`.

Post-fix evidence:

1. Focused T37/API/UI/persistence matrix:
   - `npx vitest run src/features/agent-timeline/t37-preview-scoring.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts src/app/api/agent-timeline/confirm-generation/route.test.ts src/features/agent-timeline/components/TimelineShell.test.tsx src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/t8-server-adapters.test.ts src/features/agent-timeline/workflow-definition.test.ts src/features/agent-timeline/workflow.test.ts src/features/agent-timeline/components/TimelinePreviewWorkspace.test.tsx`
   - PASS: 9 files, 198 tests.
2. Full suite:
   - `npm test`
   - PASS: 129 files, 1169 tests.
3. `npm run typecheck`
   - PASS.
4. `npm run lint`
   - PASS with 0 errors and 23 pre-existing warnings.
5. `npm run build`
   - PASS: Next.js production build, TypeScript, page-data collection, and 46 static pages.
6. `git diff --check`
   - PASS; only line-ending notices were printed.

## Fix Loop 6

Persisted scoring is now validated semantically, not only structurally:

- Swapped but unique ranks fail closed when they disagree with recomputed score order.
- Rank order is recomputed using raw fixed-weight total descending, then composition descending, then preview index ascending. Incorrect composition and preview-index tie-break records are rejected.
- AI selection must equal the ordered Top-K candidates. A schema-valid AI rank 1+3 selection for K=2 fails closed, while the same exact-K selection remains valid when `selectionSource` is `manual`.
- Forging only the persisted `total` is harmless: it is recomputed from unchanged dimensions and the valid Run is retained. Changing dimensions so the expected rank changes invalidates the stale rank and clears downstream results.
- A staged final continuation carrying schema-valid but swapped ranks is blocked with `409 timeline_node_blocked` before any ComfyUI call.

Post-fix evidence:

1. Focused T37/API/UI/persistence matrix:
   - `npx vitest run src/features/agent-timeline/t37-preview-scoring.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts src/app/api/agent-timeline/confirm-generation/route.test.ts src/features/agent-timeline/components/TimelineShell.test.tsx src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/t8-server-adapters.test.ts src/features/agent-timeline/workflow-definition.test.ts src/features/agent-timeline/workflow.test.ts src/features/agent-timeline/components/TimelinePreviewWorkspace.test.tsx`
   - PASS: 9 files, 204 tests.
2. Full suite:
   - `npm test`
   - PASS: 129 files, 1175 tests.
3. `npm run typecheck`
   - PASS.
4. `npm run lint`
   - PASS with 0 errors and 23 pre-existing warnings.
5. `npm run build`
   - PASS: Next.js production build, TypeScript, page-data collection, and 46 static pages.
6. `git diff --check`
   - PASS; only line-ending notices were printed.

## Fix Loop 7

The model-family quality policy and final-output integrity follow-up passed:

- Illustrious uses 768px longest-edge previews, a 16-step cap, and 0.60 final denoise. Anima uses 768/18/0.65; unknown models safely fall back to 768/16/0.65.
- Preview resizing preserves aspect ratio on a 64px grid after downscaling, floors extreme short edges at 64px, and does not upscale inputs already below the longest-edge limit.
- Preview and final requests retain the reviewed sampler, scheduler, CFG, and materialized seed. Detailers are disabled only for preview candidates and restored for the final request.
- When ComfyUI history contains multiple output nodes, only the image matching the queued `outputNodeId` is fetched and stored. Completed history without that target fails recoverably rather than selecting another node.
- A fresh final whose filename is identical to its preview, or whose managed filename carries the same content hash under another extension, fails recoverably as a no-op. Retrying queues that missing selection again and succeeds only with changed content.
- Retry preserves prior legitimate done finals while rerendering only the no-op/missing selection.

Post-fix evidence:

1. Focused T37/API/UI/persistence matrix:
   - `npx vitest run src/features/agent-timeline/t37-preview-scoring.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts src/app/api/agent-timeline/confirm-generation/route.test.ts src/features/agent-timeline/components/TimelineShell.test.tsx src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/t8-server-adapters.test.ts src/features/agent-timeline/workflow-definition.test.ts src/features/agent-timeline/workflow.test.ts src/features/agent-timeline/components/TimelinePreviewWorkspace.test.tsx`
   - PASS: 9 files, 213 tests.
2. Related timeline/API/LLM/generated-image/history suite:
   - `npx vitest run src/features/agent-timeline src/app/api/agent-timeline src/app/api/llm/chat/route.test.ts src/features/llm src/features/comfyui/generated-image-storage.test.ts src/features/comfyui/history.test.ts`
   - PASS: 45 files, 546 tests.
3. Full suite:
   - `npm test`
   - PASS: 129 files, 1184 tests.
4. `npm run typecheck`
   - PASS.
5. `npm run lint`
   - PASS with 0 errors and 23 pre-existing warnings.
6. `npm run build`
   - PASS: Next.js production build, TypeScript, page-data collection, and 46 static pages.
7. `git diff --check`
   - PASS; only line-ending notices were printed.

## Fix Loop 8

The live-Run empty-subfolder regression is closed without weakening path safety:

- `normalizeComfyUiViewImageReference` treats `subfolder: ""` and whitespace-only subfolders as absent, matching real ComfyUI temp/output history references.
- A real-shaped reference such as `{ filename: "ComfyUI_temp_00001_.png", subfolder: "", type: "temp", nodeId: "23" }` remains a done preview through persistence serialization/restore and the staged confirmation API sanitizer.
- Empty or whitespace-only filenames, filename paths, absolute and drive-prefixed subfolders, colons, parent traversal, and empty path segments remain rejected.
- Restored preview scoring, final execution, and result display remain done when every persisted reference is otherwise valid.

Post-fix evidence:

1. Focused empty-subfolder regression:
   - `npx vitest run src/features/comfyui/generated-image-reference.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts src/app/api/agent-timeline/confirm-generation/route.test.ts`
   - PASS: 3 files, 92 tests.
2. Extended T37 focused matrix:
   - `npx vitest run src/features/comfyui/generated-image-reference.test.ts src/features/agent-timeline/t37-preview-scoring.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts src/app/api/agent-timeline/confirm-generation/route.test.ts src/features/agent-timeline/components/TimelineShell.test.tsx src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/t8-server-adapters.test.ts src/features/agent-timeline/workflow-definition.test.ts src/features/agent-timeline/workflow.test.ts src/features/agent-timeline/components/TimelinePreviewWorkspace.test.tsx`
   - PASS: 10 files, 226 tests.
3. Full suite:
   - `npm test`
   - PASS: 130 files, 1197 tests.
4. `npm run typecheck`
   - PASS.
5. `npm run lint`
   - PASS with 0 errors and 23 pre-existing warnings.
6. `npm run build`
   - PASS: Next.js production build, TypeScript, page-data collection, and 46 static pages.
7. `git diff --check`
   - PASS; only line-ending notices were printed.

## Fix Loop 9

The preview-dimension follow-up replaces independent-axis rounding with exact-ratio integer scaling:

- Oversized inputs use the largest common integer scale whose width and height are both divisible by 8 and whose longest edge is at most 768px. The matrix includes `832x1216 -> 520x760`, its reverse, `1024x1024 -> 768x768`, `1024x576 -> 768x432`, portrait/wide cases, and extreme-but-representable ratios such as `4096x128 -> 768x24`.
- Every downscaled case asserts both axes are 8-pixel aligned and uses integer cross-multiplication (`previewWidth * finalHeight === previewHeight * finalWidth`) to prove exact aspect-ratio preservation without floating-point tolerance or independent-axis distortion.
- Positive safe dimensions already at or below the 768px longest-edge limit are returned unchanged, including non-8-aligned examples, so previews are never upscaled or unnecessarily resampled.
- Coprime and extreme ratios that cannot satisfy exact aspect ratio plus 8-pixel alignment within the bound, including `997x991` and `10000x1` in both orientations, fail closed with `comfyui_request_invalid`, actionable exact-aspect guidance, and structured width/height/longest-edge details.
- Current-v2 persistence round-trips exact-aspect `520x760` dimensions, and staged API/server fixtures now expect the 768px quality profile while retaining bounds validation.
- This contract supersedes Fix Loop 7's interim 64px-grid behavior; exact aspect ratio is now the controlling invariant.

Post-fix evidence:

1. Targeted adapter/server/persistence/API matrix:
   - `npx vitest run src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/t8-server-adapters.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts src/app/api/agent-timeline/confirm-generation/route.test.ts`
   - PASS: 4 files, 152 tests.
2. Extended T37 focused matrix:
   - `npx vitest run src/features/comfyui/generated-image-reference.test.ts src/features/agent-timeline/t37-preview-scoring.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts src/app/api/agent-timeline/confirm-generation/route.test.ts src/features/agent-timeline/components/TimelineShell.test.tsx src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/t8-server-adapters.test.ts src/features/agent-timeline/workflow-definition.test.ts src/features/agent-timeline/workflow.test.ts src/features/agent-timeline/components/TimelinePreviewWorkspace.test.tsx`
   - PASS: 10 files, 240 tests.
3. Related timeline/API/LLM/generated-image/history suite:
   - `npx vitest run src/features/agent-timeline src/app/api/agent-timeline src/app/api/llm/chat/route.test.ts src/features/llm src/features/comfyui/generated-image-storage.test.ts src/features/comfyui/generated-image-reference.test.ts src/features/comfyui/history.test.ts`
   - PASS: 46 files, 573 tests.
4. Full suite:
   - `npm test`
   - PASS: 130 files, 1211 tests.
5. `npm run typecheck`
   - PASS.
6. `npm run lint`
   - PASS with 0 errors and 23 pre-existing warnings.
7. `npm run build`
   - PASS: Next.js production build, TypeScript, page-data collection, and 46 static pages.
8. `git diff --check`
   - PASS; only line-ending notices were printed.

## Fix Loop 10

The scoring-quality follow-up adds hard visual eligibility gates without changing Story or Editor generation:

- Every Run model family now uses `min(finalSteps, 20)` for previews. Tests cover a 30-step final capped at 20 and a 12-step final retained at 12; persisted previews accept 20 and reject 21.
- Rubric v2 requires `eligible` and `criticalDefects` for every candidate. All five supported categories are accepted, while missing fields, unknown or duplicate categories, blank descriptions, and both directions of the eligibility/defect invariant mismatch fail closed.
- Ranking places eligible candidates first, then preserves raw weighted-total, composition, and stable preview-order tie-breaks. A perfect-score ineligible candidate ranks behind lower-score eligible candidates and cannot enter the AI Top-K.
- Fewer than K eligible candidates produces `timeline_request_invalid` after one Vision request, retains the completed previews, reports `recoverable: true`, and routes retry to `preview-execution` instead of repeating the same scoring request.
- Final request construction rejects rubric v1 and any manual selection containing an ineligible candidate. Historical rubric v1 records still restore for display, but UI selection and fresh final continuation remain disabled until rubric v2 scoring exists.
- Persistence validates v2 defect schema, eligibility, eligible-first ranks, AI Top-K, and manual eligible-only selection. Tampered scoring invalidates final execution and result display.
- Vision scoring sends every candidate with `detail: high`, uses `maxTokens: 4000`, and includes original intent, action/pose, spatial layout, formal prompt, and comparative critical-defect guidance.
- Detailed mode labels eligible/ineligible candidates, displays defect descriptions, disables ineligible and rubric-v1 selection, and Simple mode maps insufficient-eligibility scoring retries back to Preview generation.

Post-fix evidence:

1. Focused scoring/node/server/persistence/UI/API matrix:
   - `npx vitest run src/features/agent-timeline/t37-preview-scoring.test.ts src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/t8-server-adapters.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts src/features/agent-timeline/components/TimelinePreviewWorkspace.test.tsx src/features/agent-timeline/components/TimelineShell.test.tsx src/app/api/agent-timeline/confirm-generation/route.test.ts`
   - PASS: 7 files, 233 tests.
2. Related timeline/API/LLM/generated-image/history suite:
   - `npx vitest run src/features/agent-timeline src/app/api/agent-timeline src/app/api/llm/chat/route.test.ts src/features/llm src/features/comfyui/generated-image-storage.test.ts src/features/comfyui/generated-image-reference.test.ts src/features/comfyui/history.test.ts`
   - PASS: 46 files, 602 tests.
3. Full suite:
   - `npm test`
   - PASS: 130 files, 1240 tests.
4. `npm run typecheck`
   - PASS.
5. `npm run lint`
   - PASS with 0 errors and 23 pre-existing warnings.
6. `npm run build`
   - PASS: Next.js production build, TypeScript, page-data collection, and 46 static pages.
7. `git diff --check`
   - PASS; only line-ending notices were printed.

## Fix Loop 11

Reviewer follow-up hardened retry diversity and model-response handling:

- Only an explicit `retryTimelineGenerationFrom("preview-execution")` adds the persisted `advanceSeedOnRetry` marker. Fixed-seed retries advance by the candidate count, consecutive retries use disjoint ranges, and a range ending at `Number.MAX_SAFE_INTEGER` wraps the next base seed to zero.
- Merely inspecting a completed preview result does not advance its seed. Ordinary upstream stale/reconfirmation restarts from the reviewed formal fixed seed, while random-mode retries materialize a fresh random base instead of applying fixed-seed advancement.
- Persistence preserves the explicit retry marker alongside the validated preview result. Scoring-only and final-only retries leave preview seed state unchanged.
- The canonical Vision response uses `criticalDefects: string[]` and emits no eligibility decision. SceneForge derives eligibility locally, ignores any model-emitted `eligible` field, and converts supported defects to local canonical descriptions.
- Parsing extracts exactly one JSON object from prose or fenced Markdown, accepts finite numeric strings, accepts legacy defect objects, normalizes exact category case/space/hyphen variants, and deduplicates equivalent categories.
- Missing/non-array/unknown defects, invalid numeric ranges, malformed JSON, multiple JSON objects, and candidate coverage errors fail closed. The single second attempt adds a bounded schema-repair instruction while retaining the original image request.
- Final malformed-response errors expose only safe `validationCode` and bounded `validationReason` diagnostics; raw malicious category text and upstream private messages are not returned. Upstream Vision failures remain separately classified as `llm_upstream`.
- Historical rubric v1 previews explicitly display `Legacy rubric · eligibility not assessed` and remain disabled for manual selection.

Post-fix evidence:

1. Seed/parser/persistence/UI focused matrix:
   - `npx vitest run src/features/agent-timeline/t37-preview-scoring.test.ts src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/workflow.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts src/features/agent-timeline/components/TimelinePreviewWorkspace.test.tsx`
   - PASS: 5 files, 180 tests.
2. Extended server/API/UI focused matrix:
   - `npx vitest run src/features/agent-timeline/t37-preview-scoring.test.ts src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/t8-server-adapters.test.ts src/features/agent-timeline/workflow.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts src/features/agent-timeline/components/TimelinePreviewWorkspace.test.tsx src/features/agent-timeline/components/TimelineShell.test.tsx src/app/api/agent-timeline/confirm-generation/route.test.ts`
   - PASS: 8 files, 257 tests.
3. Related timeline/API/LLM/generated-image/history suite:
   - `npx vitest run src/features/agent-timeline src/app/api/agent-timeline src/app/api/llm/chat/route.test.ts src/features/llm src/features/comfyui/generated-image-storage.test.ts src/features/comfyui/generated-image-reference.test.ts src/features/comfyui/history.test.ts`
   - PASS: 46 files, 607 tests.
4. Full suite:
   - `npm test`
   - PASS: 130 files, 1245 tests.
5. `npm run typecheck`
   - PASS.
6. `npm run lint`
   - PASS with 0 errors and 23 pre-existing warnings.
7. `npm run build`
   - PASS: Next.js production build, TypeScript, page-data collection, and 46 static pages.
8. `git diff --check`
   - PASS; only line-ending notices were printed.

## Fix Loop 12

The scoring payload follow-up limits multimodal request size without modifying generated assets or final rendering inputs:

- Managed preview files are read through the scoring-only path and transcoded in memory to `data:image/jpeg` at quality 85. A real 1024x512 PNG fixture decodes successfully after scoring conversion as a 768x384, three-channel JPEG.
- The converted JPEG is smaller than the source fixture, preserves its 2:1 aspect ratio, and respects the 768px inside bound. The source byte buffer and persisted preview result remain byte-for-byte/JSON unchanged.
- K=4 still sends all eight labeled preview JPEGs in one comparative Vision request. The test observes eight image parts, eight candidate labels, one LLM call, and eight managed-file reads.
- Scoring never calls generated-image storage. The final-render regression continues to pass the original managed PNG bytes as `data:image/png` to the existing upload path, proving the JPEG helper is isolated from final generation.
- Read and transcode failures return only `candidateId`, `stage`, and `recoverable` diagnostics. Private paths, raw bytes, and data URLs are absent, and no Vision or storage-write call occurs after preparation failure.
- The real Sharp resize/decode test uses a 15-second per-test timeout because the first parallel related-suite run exceeded the default 5-second limit by 225ms under CPU contention; the unchanged assertion passed on rerun and in the full suite.

Post-fix evidence:

1. Directed scoring/final-helper matrix:
   - `npx vitest run src/features/agent-timeline/t37-preview-scoring.test.ts src/features/agent-timeline/t8-server-adapters.test.ts`
   - PASS: 2 files, 49 tests.
2. Extended server/API/UI focused matrix:
   - `npx vitest run src/features/agent-timeline/t37-preview-scoring.test.ts src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/t8-server-adapters.test.ts src/features/agent-timeline/workflow.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts src/features/agent-timeline/components/TimelinePreviewWorkspace.test.tsx src/features/agent-timeline/components/TimelineShell.test.tsx src/app/api/agent-timeline/confirm-generation/route.test.ts`
   - PASS: 8 files, 261 tests.
3. Related timeline/API/LLM/generated-image/history suite:
   - `npx vitest run src/features/agent-timeline src/app/api/agent-timeline src/app/api/llm/chat/route.test.ts src/features/llm src/features/comfyui/generated-image-storage.test.ts src/features/comfyui/generated-image-reference.test.ts src/features/comfyui/history.test.ts`
   - PASS after timeout calibration: 46 files, 611 tests.
4. Full suite:
   - `npm test`
   - PASS: 130 files, 1249 tests.
5. `npm run typecheck`
   - PASS.
6. `npm run lint`
   - PASS with 0 errors and 23 pre-existing warnings.
7. `npm run build`
   - PASS: Next.js production build, TypeScript, page-data collection, and 46 static pages.
8. `git diff --check`
   - PASS; only line-ending notices were printed.

## Fix Loop 13

The exact-K scoring follow-up distinguishes rare blocking failures from quality annotations while preserving a deterministic final count:

- Only spatial/physical contradiction, catastrophic exposure or corruption, and anatomy/structure defects make a candidate ineligible. Gaze/action and subject-scale/framing annotations remain eligible and reduce the relevant score instead of blocking selection.
- AI selection always returns exactly K candidates: eligible previews first, then the highest-ranked annotated ineligible fallbacks by raw total, composition, and stable preview index. Mixed and zero-eligible pools both retain exact-K output and expose recomputed `eligibleCount`, `fallbackCandidateIds`, and a safe generic warning.
- Final request construction accepts rubric-v2 annotated fallbacks, validates supplied selection metadata, and retains strict AI Top-K/rank/coverage validation. Manual exact-K reselection can include an annotated fallback and persistence recomputes metadata instead of trusting forged values.
- Current soft-only annotations remain eligible. Historical rubric-v2 soft-only records incorrectly marked ineligible are accepted for compatibility, while blocking-defect/eligibility contradictions and no-defect/ineligible records still fail closed.
- Detailed and Simple modes both display the annotated-fallback warning. Detailed mode keeps rubric-v2 ineligible cards selectable with an explicit `Ineligible · fallback allowed` label; rubric-v1 cards remain disabled.
- Historical scoring errors that requested a preview-execution retry are restored as scoring retries, preserving safe eligible/final counts, removing the obsolete `retryFrom`, and replacing the contradictory message with annotated-fallback recovery guidance.

Post-fix evidence:

1. Focused scoring/persistence/UI matrix:
   - `npx vitest run src/features/agent-timeline/t37-preview-scoring.test.ts src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts src/features/agent-timeline/components/TimelinePreviewWorkspace.test.tsx src/features/agent-timeline/components/TimelineShell.test.tsx`
   - PASS: 5 files, 210 tests.
2. Extended server/API/UI focused matrix:
   - `npx vitest run src/features/agent-timeline/t37-preview-scoring.test.ts src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/t8-server-adapters.test.ts src/features/agent-timeline/workflow.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts src/features/agent-timeline/components/TimelinePreviewWorkspace.test.tsx src/features/agent-timeline/components/TimelineShell.test.tsx src/app/api/agent-timeline/confirm-generation/route.test.ts`
   - PASS: 8 files, 266 tests.
3. Related timeline/API/LLM/generated-image/history suite:
   - `npx vitest run src/features/agent-timeline src/app/api/agent-timeline src/app/api/llm/chat/route.test.ts src/features/llm src/features/comfyui/generated-image-storage.test.ts src/features/comfyui/generated-image-reference.test.ts src/features/comfyui/history.test.ts`
   - PASS: 46 files, 616 tests.
4. Full suite:
   - `npm test`
   - PASS: 130 files, 1254 tests.
5. `npm run typecheck`
   - PASS.
6. `npm run lint`
   - PASS with 0 errors and 23 pre-existing warnings.
7. `npm run build`
   - PASS: Next.js production build, TypeScript, page-data collection, and 46 static pages.
8. `git diff --check`
   - PASS; only line-ending notices were printed.

## Fix Loop 14

The retry-hardening follow-up removes attacker-controlled preview seed advancement from durable workflow state and separates pre-completion network failures from malformed model responses:

- `advanceSeedOnRetry` is no longer trusted or persisted. Direct retry state retains the prior preview result without adding a marker, persistence drops a forged legacy marker, and upstream manual edits, Run settings staleness, and reconfirmation strip it from stale preview results.
- Preview seed advancement is a request-local adapter option. Without it, a retained fixed preview round reuses the reviewed formal seed; with it, an authorized preview retry advances to the next disjoint range, including consecutive ranges and safe wraparound at `Number.MAX_SAFE_INTEGER`.
- Random seed policy still materializes a fresh base when the retry option is present. A changed fixed seed followed by upstream staleness and reconfirmation uses the newly reviewed formal seed instead of a forged legacy marker.
- The confirmation route advances the seed only after payload sanitization and current HMAC confirmation validation for `retry` of `preview-execution`. The accepted route test observes seeds `104-107` from a retained `100-103` round; tampered signed contracts invoke neither ComfyUI nor request validation.
- Vision pre-completion failures retry the identical safe request once without a schema-repair message. Both `LiteLlmError` and generic network errors return sanitized `llm_upstream`; a status code is retained only when supplied by `LiteLlmError`, and private exception text is never exposed.
- Mixed terminal attempts are classified by the last attempt: malformed then network ends as upstream, while network then malformed ends as malformed without a third request. Two malformed completions still receive exactly one bounded schema-repair attempt and report failure after the bounded request attempts.

Post-fix evidence:

1. Focused seed/network/persistence/API matrix:
   - `npx vitest run src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/workflow.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts src/features/agent-timeline/t37-preview-scoring.test.ts src/app/api/agent-timeline/confirm-generation/route.test.ts`
   - PASS: 5 files, 207 tests.
2. Extended server/API/UI focused matrix:
   - `npx vitest run src/features/agent-timeline/t37-preview-scoring.test.ts src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/t8-server-adapters.test.ts src/features/agent-timeline/workflow.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts src/features/agent-timeline/components/TimelinePreviewWorkspace.test.tsx src/features/agent-timeline/components/TimelineShell.test.tsx src/app/api/agent-timeline/confirm-generation/route.test.ts`
   - PASS: 8 files, 272 tests.
3. Related timeline/API/LLM/generated-image/history suite:
   - `npx vitest run src/features/agent-timeline src/app/api/agent-timeline src/app/api/llm/chat/route.test.ts src/features/llm src/features/comfyui/generated-image-storage.test.ts src/features/comfyui/generated-image-reference.test.ts src/features/comfyui/history.test.ts`
   - PASS: 46 files, 622 tests.
4. Full suite:
   - `npm test`
   - PASS: 130 files, 1260 tests.
5. `npm run typecheck`
   - PASS.
6. `npm run lint`
   - PASS with 0 errors and 23 pre-existing warnings.
7. `npm run build`
   - PASS: Next.js production build, TypeScript, page-data collection, and 46 static pages.
8. `git diff --check`
   - PASS; only line-ending notices were printed.

## Manual QA Still Needed

- Live LiteLLM Vision scoring and configured multimodal NSFW scoring.
- Live ComfyUI txt2img/source-img2img runs for K=1–4 across Illustrious, Anima, LoRA, style/IPAdapter, and enabled Detailers.
- Desktop/mobile Simple and Detailed mode checks for progress, preview grids, manual reselection, partial errors, retries, and final ordering.
- Inspection of real persisted records and local LLM logs for absence of bytes, data URLs, secrets, unsafe paths, and full ComfyUI workflows.

## Recommended Next Action

- Proceed to `reviewer-agent`. Retain the live LiteLLM/ComfyUI and desktop/mobile checklist for an environment with the required services and models.
