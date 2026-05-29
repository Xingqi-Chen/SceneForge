# SceneForge Development Log

This log records dated implementation and documentation work. Keep entries concise and evidence-oriented.

## 2026-05-28

### T2 Standalone Agent Draft Workflow

Summary:

- Created GitHub Issue #4 for the standalone Agent draft workflow and marked T2 in progress.
- Added `/agent` as an independent single-image draft page.
- Aligned `/agent` styling with the main editor shell, panel layout, form controls, and light SceneForge UI palette.
- Removed the exposed LiteLLM model override from `/agent`; draft generation now relies on `LITELLM_DEFAULT_MODEL` or `LITELLM_NSFW_MODEL` based on the NSFW toggle.
- Moved the NSFW toggle into a global Agent settings control so future Agent settings have one page-level entry point.
- Reduced the left draft panel to request-only input; the LLM now supplies editable checkpoint, LoRA, prompt, and generation-default candidates in the right draft panel.
- Extracted reusable ComfyUI parameter controls from `ImageGenerationPanel` and reused them in `/agent` so numeric, select, text, textarea, and boolean inputs match the original ComfyUI configuration UI.
- Added `POST /api/agent/draft` plus Agent-specific request validation, LiteLLM draft generation, response normalization, and error taxonomy.
- Kept T2 behind the confirmation gate: no ComfyUI calls, generated-image storage, editor project state, or editor store dependencies.

Files changed:

- `src/features/agent/`
- `src/components/ui/comfyui-parameter-controls.tsx`
- `src/features/editor/components/ImageGenerationPanel.tsx`
- `src/app/agent/page.tsx`
- `src/app/api/agent/draft/route.ts`
- `src/app/api/agent/draft/route.test.ts`
- `README.md`
- `docs/product-spec.md`
- `docs/tech-spec.md`
- `docs/plan.md`
- `docs/dev-log.md`

Validation:

- `npm test -- src/app/api/agent/draft/route.test.ts` passed.
- `npm test -- src/features/agent/components/AgentDraftWorkspace.test.tsx src/app/api/agent/draft/route.test.ts` passed: 2 test files, 11 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with existing `<img>` warnings in editor components only.
- `npm test` passed: 70 test files, 470 tests.
- `npm run build` passed; Turbopack reported the existing ComfyUI sequence-reference NFT tracing warning.
- `GET http://127.0.0.1:3000/agent` returned 200 and included the Agent page marker from the already-running dev server.
- Chrome headless screenshot check confirmed `/agent` now renders with the light editor shell, white side panel, and slate/blue form styling.
- Chrome headless screenshot check confirmed the global Settings button and request-only left panel are visible; the component test covers opening Settings, the default unchecked NSFW state, and rendering LLM-selected editable defaults.

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
