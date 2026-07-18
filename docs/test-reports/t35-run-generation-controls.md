# T35 Run Generation Controls Test Report

- Scope: Track T35 / GitHub Issue #127
- Branch: `issue-127-run-generation-controls`
- Result: PASS
- Date: 2026-07-18

## Automated coverage

- Manual Run checkpoint/LoRA selection bypasses the resource recommendation provider and rejects unavailable selections.
- Saved Run parameters bypass AI Style Advice; unsaved parameters retain the existing AI path.
- LoRA model/clip strengths, fixed/random seed normalization, and checkpoint requirement are covered.
- Img2img source dimensions and Composer denoise override saved values while other saved parameters remain active.
- FaceDetailer and HandDetailer default off for legacy records, remain independently configurable, and reach the confirmed T8 request.
- Resource edits stale from resource recommendation; parameter/detailer edits stale from parameter recommendation; both reset confirmation and preserve upstream work.
- Active/named workflow serialization restores Run resources, parameters, and detailers.
- Shared simple/detailed Scene Composer renders the same control surface and keeps Parameters disabled until a checkpoint is selected.
- Existing Story and ComfyUI regression suites remain green.

## Validation evidence

- Targeted Vitest: PASS - 8 files, 101 tests.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS with 23 pre-existing warnings and 0 errors.
- `npm test`: PASS - 124 files, 1028 tests.
- `npm run build`: PASS - Next.js production build completed and generated 46 static pages.

## Reviewer fix-loop evidence

- Added a Run UI regression that selects checkpoint and LoRA resources, starts a deferred workflow, and verifies resource, parameter, and Detailer controls are disabled while running.
- Forced the shared Detailer change handler and resolved a stale selected-resource callback during the active run; neither changed the scene-input settings nor marked resource/parameter nodes stale.
- Verified the original checkpoint/LoRA settings still drive the completed manual resource result after the delayed callback.
- Targeted Vitest: PASS - TimelineShell 33 tests; TimelineShell plus StoryPlanningPreview shared Detailer regression 56 tests.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS with existing repository warnings and 0 errors.
- Full suite and production build were not rerun because the reviewer fix was localized to client-side running-state guards; both passed before this fix-loop.

## Manual browser QA still recommended

- Switch between simple and detailed Run modes after editing resources, parameters, and both detailers; confirm state is unchanged.
- Exercise pre-start and post-start resource/parameter/detailer edits and verify the intended stale boundary and confirmation reset.
- Verify txt2img output counts 1-4, img2img single-output behavior, Settings navigation, reload, and named workflow restore against a live ComfyUI instance.
- Enable each detailer with installed detector models and verify actionable `object_info` errors for missing samplers, schedulers, custom nodes, or detector models.
- In a live browser, attempt resource, parameter, and Detailer edits during slow LLM and ComfyUI calls and confirm the controls remain locked until the active run finishes.

## Single-image input layout refinement

- Result: PASS (2026-07-18).
- Added regression coverage proving the shared simple and detailed Run branches both receive the compact Detailer layout and compact selected-resource summary.
- Covered compact Detailer responsive columns, content-start alignment, checkbox updates, disabled-state guards, and settings-dialog opening while preserving Story's default density.
- Covered compact/default Civitai summary density, accessible remove and picker controls, checkpoint selection, ready-only filtering, and removal callbacks.
- Confirmed the Parameters action remains checkpoint-gated and retains the accessible `Parameters` name.
- Targeted Vitest: PASS - 4 files, 80 tests.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS with 23 pre-existing warnings and 0 errors.
- `git diff --check`: PASS (line-ending conversion notices only).
- Browser evidence supplied by the implementation pass: no horizontal overflow at 1707, 1280, 1024, 768, or 390 px; visuals checked at 1707, 1024, and 390 px. Form/Detailer heights were 629/93 px at 1707, 629/153 px at 1280, 604.5/153 px at 1024, 690/93 px at 768, and 897/153 px at 390 (improved from 684/402 px at 1707 and 1017/261 px at 390).

## Single-image generation setup refinement v2

- Result: PASS (2026-07-18).
- Verified simple and detailed Run modes share the same single-card hierarchy, with the embedded Detailer strip inside Style resources / parameters.
- Added compact-strip coverage for mobile-first one-column behavior, the `md` two-column breakpoint, compact controls, interaction/dialog preservation, and the absence of duplicated container chrome.
- Added Run-only selected-resource grid coverage for checkpoint-first ordering, one-column-to-`xl` two-column responsiveness, unconstrained vertical overflow, and checkpoint removal behavior.
- Added reverse assertions proving the default compact selector keeps its constrained stacked summary and the default Story Detailer editor retains its existing density and disabled behavior.
- Existing tests continue to cover the Parameters checkpoint gate, ready-only selection, selection/removal callbacks, and running-state disabling.
- Targeted Vitest: PASS - 3 files, 64 tests.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS with 23 pre-existing warnings and 0 errors.
- `npm test`: PASS - 125 files, 1038 tests.
- Browser evidence supplied by the Orchestrator: no horizontal overflow at 1707, 1280, 768, or 390 px.
- Residual manual QA: verify the live breakpoint transitions and resource-card wrapping with unusually long names/localized labels; live ComfyUI generation remains outside this layout-only test pass.
