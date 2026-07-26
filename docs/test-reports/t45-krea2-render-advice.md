# T45 / Issue #159 Krea 2 Render Prompt AI Advice Test Report

Date: 2026-07-26
Scope source: T45 / GitHub Issue #159
Status: PASS

## Automated coverage

- Unsaved Krea parameters call the shared Style Advice provider exactly once.
- Saved Krea parameters skip Style Advice.
- Null and structurally unusable advice retain local Krea fallback values.
- The locally rendered Krea positive prompt remains authoritative; the LLM `prompt` field is ignored.
- Valid advice can supply a 16-aligned resolution, negative-prompt additions, and a weight for an already selected LoRA. An unselected LoRA suggestion is ignored.
- Conflicting AI and saved values cannot override Krea's primary sampling contract: 8 steps, CFG 1, Euler, and simple scheduling. Top-level result fields and `requestPreview` remain consistent.
- Source dimensions and Composer denoise override saved values. Without a source, saved dimensions override advised dimensions, advised dimensions override the 1024×1024 fallback.
- Non-16-aligned source, saved, and advised Krea dimensions fail explicitly without rounding.
- Confirmed Krea request construction and Preview queue construction re-lock tampered or restored sampling values.
- Krea identity remains authoritative when the request profile is missing or forged as `default` but scene input/settings still select Krea.
- Krea diffusion metadata (`modelBaseModel=Krea 2`, `modelStorageKind=diffusion`) independently restores the canonical profile and sampling lock when the request profile is forged.
- Final requests inherit the canonical confirmed Krea sampling values for all three missing/forged profile cases.
- An ordinary FLUX diffusion request with the `default` profile is not misclassified as Krea and retains its non-Krea sampling values.
- The Krea parameter UI shows the four canonical values, disables their controls, and writes the canonical values on save. Width, height, denoise, positive prompt, and negative additions remain editable.
- Existing Illustrious and Anima adapter regressions remain green in the focused and full suites.

## Prior T45 commands and evidence

| Command | Result |
| --- | --- |
| `npm test -- src/features/agent-timeline/t7-node-adapters.test.ts src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/t8-server-adapters.test.ts src/features/agent-timeline/components/TimelineRecommendationWorkspaces.test.tsx src/app/api/agent-timeline/confirm-generation/route.test.ts` | PASS — 5 files, 173 tests |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS — 0 errors, 23 pre-existing warnings |
| `npm test` | PASS — 147 files, 1683 tests |
| `npm run build` | PASS — Next.js production build completed |
| `git diff --check` | PASS — exit 0; only Git line-ending notices |

Changed-file runtime-artifact scanning found no generated images, databases, logs, caches, or `data/` runtime files. Diff secret scanning found no credentials or private keys. Its only data-URL matches were synthetic test fixtures containing the base64 encoding of the word `source`.

The round-one queue-boundary fix added a shared ComfyUI profile resolver export to the T8 adapter dependency surface. Two integration tests fully mocked that module, so their mocks were changed to partial mocks that preserve the real resolver while continuing to mock external ComfyUI operations. The previously affected two files pass all 62 tests.

## PR #160 stack-safety and persistence follow-up

Follow-up coverage:

- The shared image data URL parser accepts a 4,600,000-character Base64 PNG payload representing 3,450,000 bytes without regular-expression stack exhaustion.
- Shared parser, request validation, and the source-upload parser agree for PNG, JPG, JPEG, and WEBP.
- An invalid Base64 character near the end of a 4.6 MB payload, an empty payload, and unsupported GIF/BMP MIME types fail closed.
- Tests exercise only pure parsing and request validation. They do not create a ComfyUI client, upload an image, or queue a workflow.
- A structurally valid Final `status:error` record preserves the original sanitized `{ code: "comfyui_execution_failed", message: "Maximum call stack size exceeded", details: { name: "RangeError" } }` through state restoration and workflow-record serialization/parsing.
- Data URLs, API keys, and tokens nested in Final error details are replaced with `[redacted]` and absent from serialized output.
- Forged done-image storage, forged error candidate linkage, and a malformed error record without an error object fail closed to `image_storage_invalid`.
- A legitimate current-policy Final error that occurred before Preview upscale, and therefore has no `previewUpscale`, preserves its sanitized original error through state sanitization and workflow-record round-trip.
- If an error record does include `previewUpscale`, its formal dimensions and selected-Preview linkage remain mandatory; a mismatched artifact fails closed to `image_storage_invalid`.

Follow-up command totals:

| Command | Result |
| --- | --- |
| `npm test -- src/features/comfyui/image-data-url.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts` | PASS - 2 files, 152 tests |
| `npm test` | PASS - 148 files, 1698 tests |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS - 0 errors, 23 pre-existing warnings |
| `npm run build` | PASS - Next.js production build completed |
| `git diff --check` | PASS - exit 0; only Git line-ending notices |

## Manual QA

Live LiteLLM and Krea ComfyUI queue verification was not performed because availability and configured local model resources were not established during this test gate. The provider call contract, effective request values, confirmation boundary, Preview queue boundary, and UI behavior are covered with local deterministic tests.

Suggested optional live check:

1. Run one unsaved Krea scene and verify Style Advice is requested once.
2. Confirm the displayed resolution, negative additions, and selected-LoRA weight reflect compatible advice while the positive prompt remains locally rendered.
3. Inspect the queued Preview and Final requests for 8 steps, CFG 1, Euler, and simple scheduling.
4. Save Krea parameters, rerun, and verify automatic Style Advice is skipped while compatible saved fields remain effective.

## Non-blocking observations

- ESLint reports 23 existing warnings outside this change: one unused test parameter and 22 `next/image` recommendations.
- Git reports existing LF-to-CRLF conversion notices for modified working-tree files.
