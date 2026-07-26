# T48 Empty Run Suggest Diversity Test Report

## Test Result: PASS

- Scope source: Track `T48`, GitHub Issue `#165`.
- Date: 2026-07-26.
- Result: structured candidate validation, novelty ranking, weighted selection, repair fallback, privacy-bounded history, API safety, shared Simple/Detailed UI behavior, and repository-wide gates passed after the Test Gate fixes and Review Gate loop 1.

## Test Cases Added

- Exact six-candidate request contract, required scene/fingerprint/profile fields, scene length and control-character bounds, fingerprint length/character bounds, complete six-candidate parsing, and malformed/count mismatch detection.
- Missing, invalid, profile-incompatible, duplicate-scene, and duplicate-fingerprint candidates cannot be selected.
- Selected `sceneRequest` content retains internal whitespace and semantics while only outer whitespace is trimmed.
- Ranking is deterministic for identical inputs and accounts for both recent-history novelty and intra-batch diversity.
- Controlled random boundaries verify 50/30/20 selection for three candidates, 62.5/37.5 for two, direct selection for one, and null for zero.
- Malformed/insufficient initial output receives exactly one repair; repaired 3/2/1 candidates use the required fallback and zero produces an actionable error without a history append.
- Missing, non-file, corrupt, oversized, unreadable, and unwritable history behavior.
- Latest-20-valid pruning, selected/not-selected dispositions, fingerprint-only serialization, temporary-file cleanup, atomic rename, and serialized concurrent writes.
- Later requests receive at most the latest 20 fingerprint objects without scene prompts.
- History write failure preserves the valid suggestion and returns a nonblocking warning.
- API rejects malformed/invalid input, forwards only validated profile/NSFW routing fields, returns actionable zero-candidate errors, and redacts typed upstream and unexpected failures.
- Empty Suggest uses the dedicated route in both Simple and Detailed modes, preserves the returned scene intact, and leaves Composer/workflow state unchanged on failure.
- For restored active workflows in both modes, clearing the visible Composer routes Suggest by visible emptiness rather than falling back to persisted `scene-input.rawIntent`. Success replaces `rawIntent` and stales completed downstream prompt work; failure preserves the existing workflow while leaving the visible Composer cleared.
- Empty Suggest performs no generic-chat, Civitai, embedding, ComfyUI, confirmation, workflow-save/start, or generated-image request.
- Nonempty Suggest remains on generic chat at temperature `0.55`; Rewrite remains on generic chat at temperature `0.25`; their response and downstream-staling behavior remains covered.

## Production Defects Found and Resolved

1. History parsing pruned the raw tail before validation, so corrupt tail entries displaced older valid records and could return fewer than the latest 20 valid fingerprints. The reader now validates before pruning.
2. History append serialized caller-supplied record objects directly, allowing extra prompt/raw-response fields across the privacy boundary. The writer now projects additions through the bounded history schema before writing.
3. The API returned `llm_unavailable` messages verbatim, which could expose provider credentials or internal endpoints. The route now maps that code to a fixed safe message while preserving status and error code.

## Commands Run

- Focused matrix:
  `npx vitest run src/features/agent-timeline/run-scene-suggestion.test.ts src/features/agent-timeline/run-scene-suggestion.server.test.ts src/features/agent-timeline/run-scene-suggestion-history.server.test.ts src/app/api/agent-timeline/run-scene-suggestion/route.test.ts src/features/agent-timeline/components/TimelineShell.test.tsx`
- API/server recheck:
  `npx vitest run src/features/agent-timeline/run-scene-suggestion.server.test.ts src/app/api/agent-timeline/run-scene-suggestion/route.test.ts`
- Review loop active-workflow recheck:
  `npx vitest run src/features/agent-timeline/components/TimelineShell.test.tsx`
- `npx eslint src/features/agent-timeline/components/TimelineShell.test.tsx`
- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `git diff --check`
- Changed-path runtime-artifact scan and added-line credential-pattern scan.

## Evidence

- Focused matrix after Review Gate loop 1: 5 files, 121 tests passed.
- TimelineShell after Review Gate loop 1: 60 tests passed.
- API/server recheck: 2 files, 21 tests passed.
- Full Vitest suite: 152 files, 1,809 tests passed.
- TypeScript: passed after the final test and production fixes.
- ESLint: passed with 0 errors and 23 pre-existing warnings.
- Next.js production build: passed; all 48 pages generated, including the new suggestion API route.
- `git diff --check`: passed; only existing LF-to-CRLF working-copy notices were emitted.
- Runtime/generated artifact scan: 0 changed-path hits.
- Added-line credential-pattern scan: 0 hits.

## Review Gate Loop 1

- Review found that empty Suggest previously fell back to a restored workflow's nonempty persisted `rawIntent` after the user cleared the visible textarea, incorrectly choosing generic chat.
- Added four component cases covering Simple/Detailed modes across success/failure.
- Every case restores a workflow with nonempty persisted intent and completed downstream prompt work, clears the visible textarea, and proves the only scene-suggestion endpoint called is `/api/agent-timeline/run-scene-suggestion`, never `/api/llm/chat`.
- Successful Suggest persists the new scene intent and invalidates the completed downstream prompt. Failed Suggest retains the original persisted intent and completed prompt while the visible Composer remains cleared.
- Focused matrix, TypeScript, and focused ESLint passed after the production fix.

## Manual QA

- jsdom exercised successful and failed empty Suggest behavior in both shared Simple and Detailed modes, including routing, intact text insertion, error visibility, unchanged Composer state, and absence of generation/resource side effects.
- No live LiteLLM request or installation-local history file was created during Test Gate; provider variability and actual filesystem permissions remain manual integration checks.
- Recommended manual check: with a configured local LiteLLM endpoint, click empty Suggest repeatedly in both modes, confirm visibly varied complete scenes, inspect the ignored history file for fingerprint-only records and 20-record pruning, then make the history directory read-only and verify a valid suggestion still appears with the nonblocking warning.

## Blocking Issues

- None.

## Non-blocking Issues

- ESLint reports 23 existing warnings outside the T48 implementation: one unused test parameter and 22 `no-img-element` warnings.
- SQLite experimental warnings appear during the existing full Vitest suite.
- Git reports existing LF-to-CRLF working-copy notices.

## Recommended Fixes

- No further T48 production fix is required from Test Gate evidence.
- Address unrelated lint warnings in a separate scoped task.
