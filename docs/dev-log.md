# SceneForge Development Log

This log records dated implementation and documentation work. Keep entries concise and evidence-oriented.

## 2026-05-29

### Issue #11 Node 5 Canvas Binding Review

Summary:

- Removed the prompt tag picker from the Node 5 visual output so layout planning shows the existing 3D canvas only.
- Expanded the Node 5 visual workspace width and canvas height while keeping the three-column workbench shell intact.
- Extracted the reverse prompt-tag missing-library review dialog and semantic matching helpers for reuse by the original character image prompt-tag panel and timeline Node 5.
- Added Node 5 prompt-library review handling for skip, transient bind, and import-and-bind choices before committing timeline prompt tags to the editor store.

Files changed:

- `src/features/editor/components/PromptTagImportReviewDialog.tsx`
- `src/features/editor/components/CharacterImagePromptTagPanel.tsx`
- `src/features/agent-timeline/components/TimelineEditorWorkspace.tsx`
- `src/features/agent-timeline/components/TimelineShell.tsx`
- `src/features/agent-timeline/components/TimelineShell.test.tsx`
- `src/features/agent-timeline/editor-canvas-binding.ts`
- `src/features/agent-timeline/editor-canvas-binding.test.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/agent-timeline` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with pre-existing `no-img-element` warnings in editor image-heavy panels.

### T5 Timeline Prompt Tag Metadata Fix

Summary:

- Preserved parsed prompt-tag metadata across Node 3 character tag output and Node 5 editor binding.
- Kept weighted tokens such as `reflective yellow jacket:1.25` as enabled editor prompt-tag weights after binding.
- Made explicit negative metadata preservation for allowed character/body-part tag categories.

Files changed:

- `src/features/agent-timeline/`
- `src/features/prompt-engine/prompt-library/character-image-prompt-tags.test.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/agent-timeline` passed: 6 files, 27 tests.
- `npm test -- src/features/prompt-engine/prompt-library/character-image-prompt-tags.test.ts` passed: 1 file, 9 tests.
- `npm run typecheck` passed.

### T5 Timeline Tag and Pose Reuse Follow-up

Summary:

- Changed Node 3 character tags to reuse the existing editor text reverse prompt-tag message builder and parser.
- Restored the Node 3 raw result shape to `{ items: [...] }` with direct `targetKind` and optional `bodyPartId` fields.
- Kept Node 4 pose planning on the existing stick-figure text generation helper and isolated its request text to Node 2 scene context.
- Kept Node 5 deterministic and LLM-free while binding Node 3 character/body-part items plus the Node 4 pose to the 3D editor character.

Files changed:

- `src/features/agent-timeline/`
- `src/features/prompt-engine/prompt-library/character-image-prompt-tags.ts`
- `src/features/prompt-engine/prompt-library/character-image-prompt-tags.test.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/prompt-engine/prompt-library/character-image-prompt-tags.test.ts` passed: 1 file, 8 tests.
- `npm test -- src/features/agent-timeline` passed: 6 files, 25 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing 22 `<img>` warnings in editor UI components.

### T5 Timeline Inference and Canvas Binding

Summary:

- Restored the timeline workbench to a responsive three-column desktop layout and ordered the narrow layout so the selected node workspace and scene composer appear before the full workflow list.
- Added T5 LangGraph adapters for scene prompt inference, primary character tag extraction, character action/pose inference, and canvas binding.
- Reused `/api/llm/chat` from the client for all LLM calls and kept resource recommendation, parameter recommendation, ComfyUI execution, image storage, and result display blocked or reserved.
- Added structured parsing and normalization for scene prompt fragments, primary character tags, extra people context, stick-figure pose output, and canvas binding results.
- Bound the inferred primary character to the existing editor store as one editable 3D character/skeleton using existing editor store actions.
- Added run invalidation so superseded or cleared timeline graph runs cannot restore stale workflow output or bind stale canvas/editor state.
- Updated the T5 DAG so prompt generation feeds character tags and action planning as parallel sibling nodes, then layout planning joins prompt, tags, and action.
- Expanded prompt generation into the canonical shared scene context producer with a narrow editable visual table and raw JSON inspection/editing fallback.
- Restricted character tags and action planning to non-editable raw JSON inspection, and kept the existing editor 3D canvas plus prompt tag picker visual workspace on layout planning only.

Files changed:

- `src/features/agent-timeline/`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/agent-timeline/components/TimelineShell.test.tsx` passed: 1 file, 4 tests.
- `npm test -- src/features/agent-timeline` passed: 6 files, 23 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing 22 `<img>` warnings in editor UI components.
- `npm test` passed: 74 files, 482 tests.
- `npm run build` passed with the existing Turbopack NFT trace warning for `next.config.ts` through ComfyUI sequence reference storage.
- `git diff --check` passed with line-ending warnings only.
- Orchestrator evidence for the current pass also includes real Edge headless layout measurement passing on `http://localhost:3001`.
- PR follow-up validation: `npm test -- src/features/agent-timeline/components/TimelineShell.test.tsx` passed: 1 file, 4 tests.
- PR follow-up validation: `npm test -- src/features/agent-timeline` passed: 6 files, 23 tests.
- PR follow-up validation: `npm run typecheck` passed.
- PR follow-up validation: `npm run lint` passed with the existing 22 `<img>` warnings in editor UI components.
- PR follow-up validation: `npm run build` passed with the existing Turbopack NFT trace warning.
- Earlier PR follow-up browser fallback validation on `http://localhost:3000` confirmed the desktop workbench layout; the product clarification pass below was validated with focused automated timeline coverage.
- Product clarification implementation validation: `npm test -- src/features/agent-timeline` passed: 6 files, 25 tests.
- Product clarification implementation validation: `npm run typecheck` passed.
- Product clarification implementation validation: `npm run lint` passed with the existing 22 `<img>` warnings in editor UI components.
- Product clarification implementation validation: `npm test` passed: 74 files, 484 tests.
- Product clarification implementation validation: `npm run build` passed with the existing Turbopack NFT trace warning.
- Product clarification browser validation on `http://localhost:3000` passed in headless Edge: desktop workbench measured as three columns, node 2 rendered the visual scene-context table, nodes 3 and 4 rendered non-editable raw JSON only, node 5 rendered the reused editor canvas and prompt tag binding workspace, node 5 preserved node 2's primary character identity despite conflicting node 3 output, and node 4's LLM request did not include node 3 tag-only output.

### T4 Initial Timeline Shell

Summary:

- Replaced the root route with an in-memory initial scene request screen and vertical timeline shell seeded from the T3 timeline state helpers.
- Added reusable timeline UI primitives for node cards, status pills, manual editing, and AI retry/suggestion affordances.
- Rendered all MVP timeline nodes in dependency order with shell output states, manual edit stale propagation, reserved future nodes, and an explicit ComfyUI confirmation gate notice.
- Redesigned the timeline shell as a modern AI agent workflow workbench with left step navigation, a central selected-step workspace, right-side inspector/activity panels, command-style scene composer, input-transform-output panels, and stable responsive layout CSS.
- Moved the legacy editor shell to `/editor` and added a minimal `/settings` entry target without exposing local paths or secrets.

Files changed:

- `src/app/page.tsx`
- `src/app/editor/page.tsx`
- `src/app/settings/page.tsx`
- `src/features/agent-timeline/components/`
- `README.md`
- `docs/dev-log.md`

Validation:

- `npm run typecheck` passed.
- `npm run lint` passed with 22 pre-existing `<img>` warnings in editor UI components.
- `npm run build` passed with the existing Turbopack NFT trace warning for ComfyUI sequence references.
- `git diff --check` passed with line-ending warnings only.
- Existing dev server responded with HTTP 200 for `/`, `/editor`, and `/settings`.
- `npm test` passed: 72 files, 476 tests.
- Browser verification passed for `/`, `/editor`, and `/settings`; the root route submitted a scene request into the vertical timeline shell with no console errors.
- PR #10 was merged to `master`; Issue #9 closed automatically via the PR closing reference.

### T3 LangGraph Workflow Foundation

Summary:

- Added `@langchain/langgraph` as the timeline orchestration dependency.
- Added the transient `src/features/agent-timeline/` feature boundary with exported node ids, statuses, result/error types, dependency DAG helpers, readiness checks, manual edit stale propagation, regeneration eligibility, and generation gate blocking.
- Implemented a LangGraph-backed execution runner with injectable node adapters and branch-safe state merging for the canvas/resource recommendation split.
- Added a graph-friendly LiteLLM adapter wrapper around existing LLM interfaces with mocked-response tests and normalized LLM error categories.
- Kept ComfyUI execution and result display as reserved, non-executable downstream nodes for this issue.

Files changed:

- `package.json`
- `package-lock.json`
- `src/features/agent-timeline/`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/agent-timeline` passed: 2 files, 13 tests.
- `npm test` passed: 70 files, 472 tests.
- `npm run typecheck` initially failed because stale generated `.next/types` referenced removed `src/app/agent/*` routes; after `npm run build` refreshed generated metadata, `npm run typecheck` passed.
- `npm run lint` passed with 22 pre-existing `<img>` warnings in editor UI components.
- `npm run build` passed. Turbopack reported an existing NFT trace warning involving `next.config.ts`, `src/features/comfyui/sequence-reference-storage.ts`, and the ComfyUI sequence references route.

### Timeline MVP Requirements Reset

Summary:

- Product direction was reset from standalone Agent draft to a LangGraph-driven, single-image vertical timeline MVP.
- Closed PR #5 and Issue #4 as superseded by the new timeline requirements.
- Deleted the `issue-4-agent-draft-workflow` local and remote branch.
- Replanned unfinished work into T3-T8: LangGraph orchestration, timeline UI shell, scene/person/action inference with 3D binding, settings page, resource/parameter recommendation, and confirmed ComfyUI execution.
- Updated product, technical, planning, README, and agent guidance so future work uses LangGraph and existing LLM interfaces instead of a bespoke draft-only flow.

Files changed:

- `AGENTS.md`
- `README.md`
- `docs/product-vision.md`
- `docs/product-spec.md`
- `docs/tech-spec.md`
- `docs/plan.md`
- `docs/dev-log.md`

Validation:

- Documentation-only reset; application tests were not required.
- PR #5 is closed.
- Issue #4 is closed as not planned.
- Local and remote `issue-4-agent-draft-workflow` branch references were removed.

## 2026-05-28

### T1 Agent Backend Contract Audit

Summary:

- Audited existing LiteLLM, ComfyUI text-to-image, ComfyUI history/events, and generated image storage backend contracts for GitHub Issue #1.
- Documented the standalone Agent single-image draft contract, explicit confirmation gate, default ComfyUI workflow reuse, seed behavior, image storage behavior, and error taxonomy in `docs/tech-spec.md`.
- Concluded that no production code is required for T1: T2 should add Agent-specific draft schema validation around the existing LiteLLM client, and T3 should thin-wrap existing ComfyUI feature modules for confirmed execution.

Files changed:

- `docs/tech-spec.md`
- `docs/dev-log.md`

Validation:

- Automated tests were not run because this pass only updates technical documentation.
- Inspected the scoped documentation diff.
- `git diff --check` passed with line-ending warnings only.

### Documentation and Agent Workflow Bootstrap

Summary:

- Added root `AGENTS.md` as the SceneForge-specific Codex CLI guide.
- Updated `.codex/agents/product-agent.toml`, `dev-agent.toml`, `tester-agent.toml`, and `reviewer-agent.toml` from the old template project to SceneForge-specific instructions.
- Filled the `docs/` Markdown set with current product, technical, planning, logging, and lessons guidance.
- Added documentation indexes for issues, test reports, and review reports.

Files changed:

- `AGENTS.md`
- `.codex/agents/product-agent.toml`
- `.codex/agents/dev-agent.toml`
- `.codex/agents/tester-agent.toml`
- `.codex/agents/reviewer-agent.toml`
- `docs/README.md`
- `docs/product-vision.md`
- `docs/product-spec.md`
- `docs/tech-spec.md`
- `docs/plan.md`
- `docs/dev-log.md`
- `docs/lessons-learned.md`
- `docs/test-reports/README.md`
- `docs/review-reports/README.md`

Follow-up:

- Moved the former root design document into `docs/product-vision.md` and updated agent/documentation references.
- Reviewed the new docs and agent configs for consistency, then aligned agent write permissions, Track-to-Issue rules, and multi-agent handoff gates across `AGENTS.md`, `.codex/agents/`, and `docs/`.
- Updated the closeout workflow so the Orchestrator automatically commits, pushes, and creates a PR after test and review gates pass. PR merge remains manual.
- Added post-merge cleanup rules: after a user-approved PR merge, the Orchestrator closes linked Issues when needed and deletes merged temporary local/remote branches.
- Removed the local issue-draft workflow so GitHub Issues are the only durable issue-detail records.
- Added agent reasoning effort policy so the Orchestrator knows when to use `high` versus `xhigh` for each sub-agent.

Validation:

- TOML parsing passed for all four files under `.codex/agents/`.
- Searched for stale template-project references in the new agent guidance and found none.
- Application tests were not run because the change is documentation and agent configuration only.

Notes:

- `git status` requires the one-shot `safe.directory` override in this sandbox because repository ownership differs from the sandbox user.
- Source files contain some existing mojibake in comments and UI strings. That issue is documented as a separate risk in `docs/plan.md`.
