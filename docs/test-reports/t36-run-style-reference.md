# T36 Run Style Reference Test Report

## Test Result: PASS

- Scope source: Track `T36`, GitHub Issue `#130`.
- Branch: `issue-130-run-style-reference`.
- Date: 2026-07-19.
- Result: the targeted suite, TypeScript, lint, full Vitest suite, production build, and practical local browser checks passed. No blocking production defect was found.

## Automated Coverage Added

- `src/features/agent-timeline/style-reference.test.ts`
  - workflow-neutral sanitization and Story-compatible contract behavior
  - accepted safe metadata and derived local URL
  - removal of bytes, data URLs, unknown fields, forged URLs, unsafe display paths, cache data, and secret-like fields
  - pending, failed, mismatch, and invalid blocking states
  - analysis parsing and missing-prompt rejection
  - IPAdapter defaults `0.45 / 0 / 1`, aliases, `0..1` bounds, and `start <= end`
  - Illustrious capability and Anima/unknown/unsupported prompt-only capability
  - context mismatch and exact-once opaque prompt append
  - normalized sequence-style character construction
- `src/features/agent-timeline/components/StyleReferencePanel.test.tsx`
  - shared state across simple/detailed Composer-mode changes
  - upload, failed analysis, retry, replace, remove, visible ready state, and IPAdapter defaults
  - rejection of unsupported MIME types before upload or analysis
- `src/features/agent-timeline/run-input-settings.test.ts`
  - legacy Run restore with no style reference
  - sanitized Run settings snapshot round trip without data URLs or forged URLs
- `src/features/agent-timeline/workflow.test.ts`
  - post-start style-reference edits stale from `parameter-recommendation`
  - generation confirmation reset while prompt, tag, action, canvas, and resource results remain intact
- `src/features/agent-timeline/t7-node-adapters.test.ts`
  - resource-aware exact-once append for Illustrious and Anima
  - pending, failed, invalid, and context-mismatch rejection before parameter preview/regeneration
- `src/features/agent-timeline/t8-node-adapters.test.ts`
  - reviewed preview/confirmed execution parity and txt2img batch preservation
  - pending, failed, invalid, mismatch, changed-snapshot, and malformed-prompt confirmation blocking
  - formal validated checkpoint fixture with resource id, model filename, base model, and display name
  - boundary-aware `art` prompt parity for bases containing `cartoon` or another non-token substring, while true duplicate tail segments remain rejected
  - removal-after-review and missing, legacy-string, or malformed checkpoint rejection
  - existing img2img source dimensions/one-output behavior and independent Detailer settings remain covered
- `src/features/agent-timeline/t8-server-adapters.test.ts`
  - Illustrious style-reference upload and sequence-style IPAdapter injection before `object_info` validation
  - Anima, unsupported, and unknown checkpoints remain prompt-only even when persisted input claims IPAdapter mode
  - storage, filesystem/upload, and unknown upstream diagnostics cannot expose absolute paths, tokens, secrets, or raw details to the timeline client; unknown failures emit one fixed redacted log string with no dynamic fields
  - actionable missing-node/file failure remains before queueing
- `src/features/agent-timeline/timeline-workflow-persistence.test.ts`
  - active/named Run round trip of safe reference metadata, analysis/context/status, and normalized settings
  - crafted-payload removal of bytes, data URLs, secrets, forged URLs, caches, and unsafe paths
  - legacy Run restore with no reference
- Existing Story regression suites remained green, including Story input, prompt assembly, persistence, and sequence-style IPAdapter execution.

## Commands Run

1. Targeted baseline before new tests:
   - `npm test -- --run src/features/agent-timeline/run-input-settings.test.ts src/features/agent-timeline/t7-node-adapters.test.ts src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/t8-server-adapters.test.ts src/features/agent-timeline/story-input.test.ts src/features/agent-timeline/story-planning.test.ts src/features/agent-timeline/story-comfyui-execution.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts`
   - PASS: 8 files, 128 tests.
2. Added Run style-reference targeted suite:
   - `npm test -- --run src/features/agent-timeline/components/StyleReferencePanel.test.tsx src/features/agent-timeline/style-reference.test.ts src/features/agent-timeline/run-input-settings.test.ts src/features/agent-timeline/workflow.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts src/features/agent-timeline/t7-node-adapters.test.ts src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/t8-server-adapters.test.ts`
   - PASS: 8 files, 84 tests.
3. `npm run typecheck`
   - PASS.
4. `npm run lint`
   - PASS with 0 errors and 23 pre-existing warnings outside the T36 test changes (`no-unused-vars` and `no-img-element`).
5. `npm test`
   - PASS: 127 files, 1056 tests.
6. `npm run build`
   - PASS: Next.js production compile, TypeScript, page-data collection, and 46 static pages completed.
7. `git diff --check`
   - PASS; only existing Git line-ending notices were printed.

## Fix Loop 1 Validation

Reviewer-requested regression coverage was added without weakening production validation:

- T8 preview/confirmed fixtures now use the formal `resource-recommendation.result.checkpoint.resource` contract.
- Exact-tail validation accepts `stylePrompt="art"` when `art` occurs only inside a longer base word such as `cartoon` or `martial`, while rejecting a true duplicate `art` segment.
- Removing a reviewed reference and using a missing, legacy-string, or malformed checkpoint all reject confirmation.
- Only a validated Illustrious checkpoint uploads and injects IPAdapter data; Anima, unsupported, and unknown checkpoints do neither.
- Storage and unknown upload failures return fixed safe client messages. Sensitive absolute paths, tokens, secrets, raw messages, and custom error names are absent from serialized node errors and console output; generic failures emit exactly one fixed log string with no dynamic arguments.

Commands and evidence after the reviewer fixes:

1. `npm test -- --run src/features/agent-timeline/t8-node-adapters.test.ts`
   - PASS: 1 file, 13 tests.
2. `npm test -- --run src/features/agent-timeline/t8-server-adapters.test.ts`
   - PASS: 1 file, 13 tests.
3. `npm test -- --run src/features/agent-timeline/style-reference.test.ts src/features/agent-timeline/components/StyleReferencePanel.test.tsx src/features/agent-timeline/run-input-settings.test.ts src/features/agent-timeline/workflow.test.ts src/features/agent-timeline/t7-node-adapters.test.ts src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/t8-server-adapters.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts`
   - PASS: 8 files, 96 tests.
4. `npm run typecheck`
   - PASS.
5. `npm run lint`
   - PASS with 0 errors and 23 unrelated pre-existing warnings.
6. `npm test`
   - PASS: 127 files, 1068 tests.
7. `npm run build`
   - PASS: Next.js production compile, TypeScript, page-data collection, and 46 static pages completed.

No UI production code changed in Fix Loop 1, so the practical desktop/mobile browser evidence below remains applicable and was not repeated.

## Fix Loop 2 Validation

The upload-failure logging regression now matches the hardened fixed-log production contract:

- The rejected error carries an absolute path, token, and raw diagnostics independently in both its custom `name` and `message`.
- The timeline client result contains the fixed safe message and none of the sensitive name/message content.
- `console.error` is called exactly once with exactly the fixed text `[SceneForge] [timeline] Run style reference upload failed; details were redacted.` and no second argument or dynamic field.
- Serialized console arguments contain no absolute path, token, custom error name, sensitive message, or raw diagnostics.

Commands and evidence after the Fix Loop 2 production change:

1. `npm test -- --run src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/t8-server-adapters.test.ts`
   - PASS: 2 files, 26 tests.
2. `npm test -- --run src/features/agent-timeline/style-reference.test.ts src/features/agent-timeline/components/StyleReferencePanel.test.tsx src/features/agent-timeline/run-input-settings.test.ts src/features/agent-timeline/workflow.test.ts src/features/agent-timeline/t7-node-adapters.test.ts src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/t8-server-adapters.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts`
   - PASS: 8 files, 96 tests.
3. `npm run typecheck`
   - PASS.
4. `npm run lint`
   - PASS with 0 errors and 23 unrelated pre-existing warnings.
5. `npm test`
   - PASS: 127 files, 1068 tests.
6. `npm run build`
   - PASS: Next.js production compile, TypeScript, page-data collection, and 46 static pages completed.

Fix Loop 2 changed no UI production code, so the practical desktop/mobile browser evidence below remains applicable and was not repeated.

## Browser QA

Practical local QA used the development server at `http://127.0.0.1:3000/`:

- Detailed Run Composer showed one global Style reference panel with an Illustrious capability message and no-reference empty state.
- Upload input accepted exactly `image/png,image/jpeg,image/webp` and remained keyboard-focusable.
- Desktop viewport (`1707x898`) had no horizontal page overflow; the reference panel remained within its content column.
- Mobile viewport (`390x844`) had no horizontal page overflow; the reference panel measured about `301px` wide inside the viewport and retained the upload control and capability/empty-state text.
- Prompt profile and image-count controls were present with Illustrious/Anima and 1-4 choices.
- Browser console contained only Chrome-extension message-channel noise, not a SceneForge application exception.

Environment limitations:

- No live LiteLLM vision analysis or live ComfyUI queue was exercised; these require configured external services and model/node files.
- The Settings route in this browser session rendered its navigation shell but not the workflow setting controls, so a live simple/detailed toggle was not available. Shared-state behavior across mode changes is covered by `StyleReferencePanel.test.tsx` and the existing `TimelineShell` display-mode regression suite.
- No runtime reference file was uploaded during browser QA, keeping `data/` unchanged.

## Reproducible Live Manual Follow-up

With LiteLLM vision and ComfyUI configured:

1. In both simple and detailed Run modes, upload PNG, JPEG, and WEBP references; verify pending, ready, retry, replace, and remove states survive mode switches.
2. Verify invalid MIME, failed analysis, pending analysis, and changed checkpoint/profile block Start, Regenerate, and Confirm without a ComfyUI queue request.
3. Select an Illustrious checkpoint; verify `weight=0.45`, `start_at=0`, `end_at=1`, boundary values, ordering validation, prompt-only disablement, and actionable missing-node/file errors.
4. Select Anima and an unsupported/unknown checkpoint; verify the style prompt remains and no reference IPAdapter data is queued.
5. Run txt2img with counts 1 and 4, then img2img with a distinct source; verify batch behavior, source dimensions, Composer denoise precedence, enabled Hand/Face Detailers, and Hand-before-Face workflow order.
6. Compare preview and confirmed requests, reload the active workflow, save/open a named workflow, and restore a legacy record; verify the style segment is appended exactly once and no generation auto-submits.
7. Inspect persisted JSON and logs for absence of bytes, data URLs, secrets, absolute paths, caches, downloaded model data, and full resource collections.

## Blocking Issues

- None.

## Non-blocking Issues

- Live external-service execution remains environment-dependent as documented above.
- Repository lint currently reports 23 unrelated warnings but no errors.

## Recommended Next Action

- Proceed to reviewer-agent. Retain the live LiteLLM/ComfyUI checklist for an environment with the required services and models.
