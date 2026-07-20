# T37 Scored Run Previews Test Report

## Test Result: PASS

- Scope source: Track `T37`, GitHub Issue `#133`.
- Branch: `issue-133-scored-run-previews`.
- Date: 2026-07-20.
- Result: the focused matrix, relevant timeline/API/LLM regressions, full Vitest suite, TypeScript, lint, and production build passed after Fix Loop 9 enforced exact-aspect, 8-pixel-aligned preview dimensions without upscaling.

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

## Manual QA Still Needed

- Live LiteLLM Vision scoring and configured multimodal NSFW scoring.
- Live ComfyUI txt2img/source-img2img runs for K=1–4 across Illustrious, Anima, LoRA, style/IPAdapter, and enabled Detailers.
- Desktop/mobile Simple and Detailed mode checks for progress, preview grids, manual reselection, partial errors, retries, and final ordering.
- Inspection of real persisted records and local LLM logs for absence of bytes, data URLs, secrets, unsafe paths, and full ComfyUI workflows.

## Recommended Next Action

- Proceed to `reviewer-agent`. Retain the live LiteLLM/ComfyUI and desktop/mobile checklist for an environment with the required services and models.
