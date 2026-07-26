# T47 Krea 2 Turbo Second-Pass Test Report

## Test Result: PASS

- Scope source: Track `T47`, GitHub Issue `#163`.
- Branch: `issue-163-krea2-second-pass`.
- Date: 2026-07-26.
- Result: Krea policy v3, confirmation binding, persistence compatibility, partial retry behavior, shared Run UI, full Vitest suite, TypeScript, lint, production build, and diff hygiene passed.

## Test Cases Added

- Exact Krea conservative `4 / 0.12`, balanced `4 / 0.18`, and strong `6 / 0.28` Final mappings with policy version 3, while ordinary Illustrious, Anima, and fallback mappings remain version 2 without a Final-step override.
- Krea formal and Preview requests remain fixed at 8 steps, CFG 1, Euler, and Simple for every Final preset.
- Final requests preserve formal dimensions and the selected Preview seed, consume the managed Preview artifact, omit the Composer source image, and apply Composer source denoise only to Preview.
- Confirmation fingerprints and current-gate validation bind Krea policy version, preset, family, Final steps, and Final denoise. Missing or tampered fields fail validation.
- Confirmation API responses persist the complete balanced Krea v3 gate contract.
- Same-policy Krea v3 partial retries reuse a valid completed sibling; changing to another Krea preset regenerates both Finals under the new step/denoise policy.
- Persisted staged Krea artifacts with an incomplete or cross-policy contract fail closed and require reconfirmation.
- A genuine completed staged Krea v2 fixture remains safely displayable with its linked Final and managed Preview upscale. Its aggregate/candidate policy is version 2, has no `steps`, and retains the historical balanced denoise of `0.45`.
- The corresponding incomplete confirmed staged Krea v2 fixture fails closed and requires reconfirmation.
- A current v3 retry cannot reuse that staged v2 Final or its policy-v2 managed Preview upscale; both artifacts are regenerated and rebound to balanced v3 `4 / 0.18`.
- Existing completed and incomplete legacy-direct Krea compatibility tests continue to cover historical direct-output display and fail-closed reconfirmation separately.
- Simple and Detailed Run composers show the balanced `4 steps / 0.18` Krea resolution and update to `6 steps / 0.28` for Strong.
- Existing Detailer, style-reference, paired-review, Repair, seed, and ordinary-profile regression suites remain passing.

## Commands Run

- Focused matrix:
  `npx vitest run src/features/agent-timeline/final-generation-policy.test.ts src/features/agent-timeline/generation-confirmation.server.test.ts src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/t8-server-adapters.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts src/app/api/agent-timeline/confirm-generation/route.test.ts src/features/agent-timeline/components/TimelineShell.test.tsx`
- Review fix-loop matrix:
  `npx vitest run src/features/agent-timeline/timeline-workflow-persistence.test.ts src/features/agent-timeline/t8-server-adapters.test.ts`
- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `git diff --check`
- Changed-file runtime-artifact scan and added-line secret-pattern scan.

## Evidence

- Review fix-loop matrix: 2 files, 182 tests passed.
- Focused matrix: 7 files, 366 tests passed.
- Full Vitest suite: 148 files, 1,744 tests passed.
- TypeScript: passed.
- ESLint: passed with 0 errors and 23 pre-existing warnings.
- Next.js production build: passed; all 47 pages generated.
- Diff hygiene: `git diff --check` passed; only line-ending notices were emitted.
- Artifact scan: 0 generated/runtime artifact paths among changed files.
- Secret scan: 0 credential-like patterns in added lines.

## Manual QA

- jsdom coverage verified the shared Simple/Detailed composer text and preset interaction.
- Live ComfyUI image generation was not performed because this Test Gate has no approved checkpoint/seed fixture and tester-agent must not create generated runtime data.
- Recommended follow-up: with one fixed Krea checkpoint, prompt, source/Preview, and seed, render all three presets and visually compare structure retention, detail gain, drift, anatomy, paired review, and partial retry.

## Blocking Issues

- None.

## Non-blocking Issues

- ESLint reports 23 existing warnings outside the T47 test changes: one unused test parameter and 22 `no-img-element` warnings.
- Git reports existing LF-to-CRLF working-copy notices.

## Recommended Fixes

- No T47 production fix is required from Test Gate evidence.
- Address the unrelated lint warnings in a separate scoped task.

## Review Fix Loop 1

- Reviewer requested direct staged Krea v2 compatibility evidence because legacy-direct fixtures exercise a different migration path.
- Added a staged v2 fixture with Preview execution/scoring linkage, selected seed/rank linkage, a policy-v2 managed Preview upscale, and the historical Krea policy `{ version: 2, preset: "balanced", family: "krea2", denoise: 0.45 }` without a `steps` field.
- Verified completed historical display, incomplete confirmation revocation, and v3 retry regeneration of both the old Final and its managed upscale.
- No production defect was found.
