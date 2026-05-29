# SceneForge Development Log

This log records dated implementation and documentation work. Keep entries concise and evidence-oriented.

## 2026-05-29

### T4 Initial Timeline Shell

Summary:

- Replaced the root route with an in-memory initial scene request screen and vertical timeline shell seeded from the T3 timeline state helpers.
- Added reusable timeline UI primitives for node cards, status pills, manual editing, and AI retry/suggestion affordances.
- Rendered all MVP timeline nodes in dependency order with shell output states, manual edit stale propagation, reserved future nodes, and an explicit ComfyUI confirmation gate notice.
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
