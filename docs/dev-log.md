# SceneForge Development Log

This log records dated implementation and documentation work. Keep entries concise and evidence-oriented.

## 2026-05-28

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

Validation:

- TOML parsing passed for all four files under `.codex/agents/`.
- Searched for stale template-project references in the new agent guidance and found none.
- Application tests were not run because the change is documentation and agent configuration only.

Notes:

- `git status` requires the one-shot `safe.directory` override in this sandbox because repository ownership differs from the sandbox user.
- Source files contain some existing mojibake in comments and UI strings. That issue is documented as a separate risk in `docs/plan.md`.
