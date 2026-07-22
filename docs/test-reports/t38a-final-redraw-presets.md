# T38A Final Redraw Presets Test Report

## Test Result: PASS

- Scope source: Track `T38A`, GitHub Issue `#136`, PR `#137` amendment dated 2026-07-22.
- Branch: `issue-136-preserve-preview-structure`.
- Date: 2026-07-22.
- Result: the preset policy, shared Run UI, confirmation integrity, Final-only resume, retry reuse, persistence compatibility, full Vitest suite, TypeScript, lint, production build, and diff hygiene passed after two Test Gate fix loops and the final Review Gate hardening pass.

## Coverage

- Exact conservative/balanced/strong mapping for Illustrious, Anima, and unknown fallback families; balanced is the default and arbitrary string/numeric denoise input cannot become a custom Final denoise.
- Shared Simple/Detailed radio control, resolved family/denoise text, persistent structure-risk copy, elevated Strong styling, native fieldset/label/radio semantics, and disabled execution state.
- Preset changes use the dedicated Final-only mutation, cancel confirmation, preserve completed parameter recommendations, preserve valid Preview candidates/scoring/manual exact-K selection/seed, and resume at Final after reconfirmation without advancing Preview seeds.
- Explicit preset allowlists reject `__proto__`, `constructor`, `toString`, numeric, and unknown values in settings, policy resolution, and persisted current-v2 aggregate/candidate policy metadata.
- HMAC replay/tamper checks for workflow, policy version, preset, family, and denoise before any ComfyUI request.
- Cross-preset Finals are not reused; same-preset partial retry retains valid fallbacks and completed siblings.
- Run settings and policy metadata survive persistence round trips. Current policy-v2 aggregate/candidate policy removal or tampering fails closed, while completed policy-v1/pre-policy results remain read-only displayable and incomplete v1 Runs require reconfirmation.
- Existing source-img2img denoise, formal parameters, seeds, prompts, resources, style/IPAdapter, Detailers, deterministic fallback, no-op detection, and managed-reference safety contracts remain covered.
- No Story, T38B Vision review, or T38C repair source files changed.

## Fix Loops

1. Generation confirmation initially accepted tampered gate preset, family, and denoise metadata. Current confirmation validation now re-resolves the signed v2 policy and compares all four policy fields; the three-case API matrix returns `409 confirmation_required` before ComfyUI.
2. Persistence initially treated a missing or invalid current-v2 aggregate execution policy like a legacy completed result, and Simple confirmation omitted the resolved policy summary. Current-v2 restore now fails closed while preserving explicit legacy compatibility, and both display modes show the same version/preset/family/denoise and risk summary.
3. Review Gate found that preset changes before Preview could unnecessarily stale parameter recommendations and that manual exact-K scoring was not recognized for Final-only resume. The dedicated mutation now preserves parameters in every state, accepts valid rubric-v2 `done` or `manual` scoring for Final-only continuation, and uses prototype-safe explicit preset membership checks across runtime and persistence.

## Commands and Evidence

- Focused matrix: 9 files, 290 tests passed.
- `npm test`: 133 files, 1,313 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with 0 errors and 23 pre-existing warnings outside this change.
- `npm run build`: passed; Next.js production build generated all 46 pages.
- `git diff --check`: passed; only line-ending notices were printed.

## Manual QA

- The local ComfyUI health endpoint responded successfully, but no live three-preset image generation was performed because this Test Gate has no stable approved checkpoint/seed fixture and tester-agent must not create runtime generated data.
- Recommended follow-up: with one fixed Preview, checkpoint, seed, prompts, style reference, and Detailer configuration, render all three presets for Illustrious and Anima; compare structure preservation, detail gain, object drift, anatomy, fallback access, and partial retry in both Simple and Detailed modes.

## Blocking Issues

- None.
