# T61 Issue #197 Checkpoint-first Image Selection Test Report

## Test Result: PASS

- Scope source: Track `T61`, GitHub Issue `#197`.
- Date: 2026-08-16.
- Result: checkpoint-first image filtering and selection, unlimited ready same-base LoRA stacks, stale-response protection, Run-only UI exposure, persistence, API safety, and repository-wide gates passed.

## Test Cases Added

- The pure resolver ignores zero, one, or multiple image-associated checkpoint/model usages and always preserves the caller-selected checkpoint.
- Four or more ready same-base LoRAs are retained without truncation; usage order is stable and duplicate resource IDs are removed by first occurrence.
- Non-ready and base-mismatched LoRAs produce safe warnings; zero eligible LoRAs is a successful empty selection.
- The server validates the selected checkpoint ID, resource type, persisted base model, requested base model, and ready file status, and rejects image-level base-model mismatch.
- The API validates route/query parameters, closes storage handles, preserves typed status codes, and redacts absolute paths from unexpected errors.
- The image gallery is disabled until a ready checkpoint with a usable base model is selected, includes that base model in list queries, and reloads after checkpoint changes.
- Loading, error/retry, empty, thumbnail fallback, search, success, warning, and selection-failure UI states are covered.
- The image dialog uses the wider layout, a responsive one/two/three-column gallery, and complete 4:3 `object-contain` previews; ordinary resource mode retains its narrower layout.
- Image selection binds the current checkpoint ID/base model, preserves the checkpoint, clears prior LoRAs on a successful zero result, and performs no mutation on failure.
- Identical checkpoint plus identical ordered LoRA IDs is a no-op; identical IDs in a different order trigger the selection mutation.
- Stale gallery and selection responses cannot overwrite state after the current checkpoint changes.
- An in-flight selection started under checkpoint A is invalidated when props commit checkpoint B, remains stale after returning to A, cannot mutate the selection when it resolves, and cannot leave the A gallery stuck in a disabled/resolving state.
- Simple and Detailed Run expose image selection; Story planning and the ordinary selector do not opt in.
- Eight ordered LoRA IDs survive Run input serialization/restoration without image metadata or truncation.

## Commands Run

- Focused library/API/selector/storage matrix:
  `npx vitest run "src/features/civitai-lora-library/image-resource-selection.test.ts" "src/features/civitai-lora-library/image-resource-selection.server.test.ts" "src/app/api/civitai-lora-library/imported-images/[id]/resource-selection/route.test.ts" "src/features/editor/components/StylePaletteCivitaiResourceSelector.test.tsx" "src/features/persistence/sqlite-storage.test.ts" --reporter=verbose`
- Focused Run/Story/persistence matrix:
  `npx vitest run "src/features/agent-timeline/components/TimelineShell.test.tsx" "src/features/agent-timeline/components/StoryPlanningPreview.test.tsx" "src/features/agent-timeline/run-input-settings.test.ts" --reporter=verbose`
- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `git diff --check`
- Read-only local API checks against the existing imported-image/resource library on `localhost:3000`.
- Review fix loop 1 selector regression:
  `npx vitest run src/features/editor/components/StylePaletteCivitaiResourceSelector.test.tsx --reporter=verbose`
- Review fix loop 1 type check:
  `npm run typecheck`

## Evidence

- Focused library/API/selector/storage matrix: 5 files, 41 tests passed.
- Focused Run/Story/persistence matrix: 3 files, 101 tests passed.
- Pre-review full Vitest suite: 167 files, 2,241 tests passed.
- Review fix loop 1 selector regression: 1 file, 14 tests passed, including the new checkpoint A to B to A race.
- The race regression verifies the old request signal is aborted on the B prop commit, the old A payload cannot call `onSelectionChange` after returning to A, the A image card is enabled again, and a fresh second click succeeds.
- Review fix loop 1 TypeScript: passed with 0 errors after the new regression test.
- TypeScript: passed with 0 errors.
- ESLint: passed with 0 errors and 22 existing `no-img-element` warnings.
- Next.js production build: passed and generated all 51 static pages.
- `git diff --check`: passed; only existing LF-to-CRLF working-copy notices were emitted.
- Real-library regression: Civitai image `44204280` is stored as `Illustrious`, while its image-associated checkpoint is not ready. Selecting it with a ready Illustrious checkpoint returned HTTP 200, preserved the current checkpoint, returned zero LoRAs plus six warnings, and exposed no absolute path. This confirms image checkpoint readiness no longer gates selection.
- Real-library positive case: image `125969339` had one ready same-base LoRA usage; the route selected that one LoRA and preserved the current checkpoint.

## Browser QA

The Orchestrator served the passing production build locally and exercised the Run selector in the in-app browser. With an existing ready Anima checkpoint, **By image** loaded 12 matching imported images. At the desktop viewport the wide dialog rendered three large cards per row with complete portrait/landscape images inside 4:3 `object-contain` frames. At 390 px it rendered one large card per row with vertical scrolling and reachable search/mode/close controls. The temporary viewport override was reset and the dialog was closed without changing the saved resource selection.

### Simple

1. Open `/` in Simple Run mode with no checkpoint selected. Open the Civitai selector and confirm **By image** is disabled with guidance to choose a checkpoint first.
2. Select a ready checkpoint with a known base model. Open **By image** and confirm the gallery loads only images for that checkpoint base model.
3. On a desktop viewport (at least 1280 px wide), confirm the image dialog is visibly wider than resource mode, cards form up to three columns, each preview keeps a 4:3 frame, and the whole source image is visible without center-cropping.
4. Resize to a narrow viewport (about 390 px wide). Confirm the gallery becomes one column, the complete preview remains visible, the dialog content scrolls vertically, and the close/search controls remain reachable.
5. Enter a search that has no matches, then clear it. Confirm the empty state and restored results. Break or block one thumbnail request and confirm the fallback remains clickable.
6. Click an image containing ready same-base LoRAs. Confirm the clicked card shows its loading/disabled state, the current checkpoint does not change, all eligible LoRAs are selected in image usage order, and a stack larger than three is not truncated.
7. Click an image whose LoRAs are unavailable or mismatched. Confirm the operation succeeds, old LoRAs are cleared when none are eligible, and safe skip warnings are shown without local paths.
8. Trigger a selection API failure and retry. Confirm existing checkpoint/LoRA state is preserved on failure and the retry can succeed.
9. While a slow gallery or selection request is pending, change the checkpoint. Confirm the new base-model gallery wins and the stale response cannot mutate the new checkpoint selection.

### Detailed

1. Repeat steps 1-9 in Detailed Run mode and confirm behavior matches Simple mode.
2. Save/reload the active workflow after selecting a large LoRA stack. Confirm checkpoint and ordered LoRA IDs restore without truncation and no image metadata is persisted.
3. Open Story planning and an ordinary Civitai selector outside Run. Confirm neither exposes the **By image** entry.

## Skipped Checks

- Browser QA did not click an image resource because that would mutate the existing autosaved local workflow. Image-selection mutations, loading, warnings, empty results, failures, retries, and ABA cancellation are covered by the automated component/API tests and the read-only live API checks above.
- No external Civitai or ComfyUI request was made. Tests use local fixtures/mocks, and live verification was limited to read-only local APIs and existing local metadata.
- The full suite, lint, and production build were not repeated in review fix loop 1 because the fix was isolated to selector request cancellation. Their pre-review gates remain recorded above; the changed selector test and repository typecheck were rerun after the fix.

## Review Fix Loop 1

- Review identified an ABA race: checkpoint A starts image selection, props switch to B and back to A, then the old A response resolves. A context-key-only guard could accept that response again or leave the returned gallery permanently resolving.
- Added a deferred-response component regression that performs the full A to B to A sequence.
- The production fix aborts the in-flight selection during the checkpoint prop commit, invalidates request identity, clears resolving state, and rejects the stale completion even though the final checkpoint context is A again.
- Focused selector tests and repository typecheck passed after the fix.

## Blocking Issues

- None.

## Non-blocking Issues

- The full suite emits Node's existing experimental SQLite warnings.
- Some existing Timeline/Story component tests emit autosave/relative-URL stderr while still passing.
- ESLint reports 22 existing `no-img-element` warnings outside the new selector test files.
- Git reports existing LF-to-CRLF working-copy notices.

## Recommended Fixes

- Address unrelated lint and test-noise warnings in a separate scoped task.
