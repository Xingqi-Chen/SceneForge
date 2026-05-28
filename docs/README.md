# SceneForge Docs Index

This directory contains the working documents used by the Orchestrator and the four Codex sub-agents defined in `AGENTS.md` and `.codex/agents/`.

## Documents

- `product-spec.md`: current product goals, users, core flows, MVP scope, acceptance criteria, and open product questions. Owned by `product-agent`.
- `product-vision.md`: long-range product and design vision, migrated from the former root design document. Maintained by `product-agent` when product direction changes.
- `tech-spec.md`: current technical architecture, module boundaries, runtime data, integrations, validation commands, and implementation constraints. Maintained by `dev-agent` when technical contracts change.
- `plan.md`: local roadmap, development tracker, Track-to-Issue mapping, and Orchestrator workflow state. Maintained by `product-agent` and the Orchestrator.
- `dev-log.md`: dated implementation notes, validation evidence, command changes, and documentation updates. Maintained by `dev-agent` and the Orchestrator.
- `lessons-learned.md`: reusable engineering, testing, review, and workflow lessons. Updated only when a lesson should affect future work.

Agent reasoning effort policy lives in `AGENTS.md`. The short version is: Orchestrator and reviewer default to `xhigh`; product, dev, and tester default to `high`; dev/test/product escalate to `xhigh` for high-risk, ambiguous, security-sensitive, persistence, integration, 3D, LLM, or cross-module work.

## Report Directories

- `test-reports/`: validation reports and manual QA evidence from `tester-agent`.
- `review-reports/`: code review, architecture review, and commit and PR readiness reports from `reviewer-agent`.

## Multi-Agent Flow

The default flow is:

1. Orchestrator identifies a Track in `docs/plan.md`.
2. `product-agent` clarifies scope and prepares issue-ready acceptance criteria.
3. Orchestrator creates or confirms the GitHub Issue and writes its number back to `docs/plan.md`.
4. `dev-agent` implements only that Issue or approved `N/A` local-only Track.
5. `tester-agent` validates and returns `PASS` or `FAIL` with evidence.
6. `reviewer-agent` returns `APPROVE` or `REQUEST CHANGES`.
7. Orchestrator closes the loop, updates docs when needed, commits the scoped diff, pushes the branch, opens a PR, records the PR reference, and reports final status.
8. After the user explicitly requests merge and the PR merge succeeds, Orchestrator closes any remaining linked Issue and deletes merged temporary local and remote branches.

## Source of Truth Order

Use this order when documents appear to conflict:

1. User instructions in the active task.
2. `AGENTS.md` and `.codex/agents/*.toml` workflow and permission rules.
3. `docs/product-vision.md` for product vision and long-range design intent.
4. `docs/product-spec.md` and `docs/tech-spec.md` for current scoped product and technical contracts.
5. `docs/plan.md` for local task priority and progress.
6. GitHub Issues for durable issue details and implementation scope.
7. `README.md` and `.env.example` for run commands and environment setup.

If a change updates one source of truth, update the affected supporting docs in the same change.
