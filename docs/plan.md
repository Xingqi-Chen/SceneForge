# SceneForge Development Plan

## Planning Model

This is the local roadmap and task tracker for the Orchestrator and sub-agents. It complements `AGENTS.md`, `.codex/agents/*.toml`, `docs/product-vision.md`, `docs/product-spec.md`, and `docs/tech-spec.md`.

Tracks are planning units. Implementation work must be split into issue-ready tasks before coding begins, unless the Track is explicitly marked `N/A` as local-only work.

## Immediate Next Step

Prepare GitHub Issue content for `T2`. `T-CI` added the temporary repository CI setup, and `T1` has confirmed the backend contracts that the Agent single-image workflow will use before `/agent` UI or ComfyUI execution work starts.

## Status Values

- `Todo`: not yet scoped.
- `Ready`: scoped enough for GitHub Issue creation or implementation.
- `In Progress`: actively being worked.
- `Done`: completed and validated.
- `Blocked`: cannot proceed without external input or dependency.
- `Deferred`: intentionally postponed.

## Tracker

| Track ID | GitHub Issue | Task | Phase | Status | Test | Review | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T0 | N/A | Align Codex agent workflow and docs with SceneForge | Documentation | Done | PASS | Not requested | Covers AGENTS.md, `.codex/agents/`, and docs bootstrap. |
| T1 | #1 | Audit Agent backend contracts for LangGraph single-image workflow | Agent MVP | Done | PASS | APPROVE | Confirmed LiteLLM draft, ComfyUI single-image runner, default workflow, seed behavior, image storage, and error contracts before implementation. Merged PR #2. |
| T-CI | N/A | Configure GitHub Actions CI | Repository Infrastructure | Done | PARTIAL | Self-reviewed | Temporary repository-bootstrap work requested directly; no GitHub Issue needed. Adds CI for install, lint, typecheck, test, and build. `git diff --check` passed; local npm validation was blocked by Windows sandbox process startup errors. Opened PR #3. |
| T2 | TBD | Add standalone Agent draft workflow | Agent MVP | Ready | TBD | TBD | Depends on T1; `/agent` independent entry; LiteLLM creates editable single-image draft; user confirmation required before any ComfyUI call. |
| T3 | TBD | Run confirmed Agent single-image drafts through ComfyUI | Agent MVP | Ready | TBD | TBD | Depends on T1 and T2; confirmed drafts call existing default single-image ComfyUI workflow directly; results may use existing image storage but must not bind to the current project. |

## Task Slicing Rules

- A track becomes implementation-ready only when acceptance criteria and validation expectations are clear.
- A Track with `GitHub Issue` set to `TBD`, blank, or missing is not ready for implementation.
- A Track with `GitHub Issue` set to `N/A` is local-only work and must explain that decision in `Notes`.
- A Track with a concrete issue number such as `#12` uses that GitHub Issue as the implementation scope source of truth.
- Prefer one issue-ready task per behavior boundary: editor state, prompt engine, persistence, API route, integration adapter, or UI panel.
- Do not mix unrelated production fixes with docs-only or test-only tasks.
- If a task changes environment variables, update `.env.example`, `README.md`, `docs/tech-spec.md`, and `AGENTS.md` if workflow rules change.
- If a task changes user-visible scope, update `docs/product-vision.md` and `docs/product-spec.md`.

## Orchestrator Handoff Checklist

Intake:

- Read `AGENTS.md`, the relevant TOML agent instructions, and this plan.
- Check the worktree and preserve user changes.
- Confirm which Track is in scope.
- Inspect the Track's `GitHub Issue` value.

Product and issue gate:

- Ask `product-agent` to clarify scope when acceptance criteria are unclear.
- For `TBD`, blank, or missing issue values, prepare issue-ready content and create the GitHub Issue before implementation.
- After GitHub Issue creation, write the issue number back to the tracker.

Implementation gate:

- Keep changes inside the assigned scope.
- Update docs alongside command, environment, architecture, or workflow changes.
- Use the narrowest useful tests first.

Test and review gate:

- Require `tester-agent` evidence for changed behavior unless the Track is docs-only or explicitly local-only.
- Require `reviewer-agent` approval before work can be committed, pushed, and opened as a PR.

Closeout:

- Run relevant validation or clearly explain skipped checks.
- Request review for behavior, architecture, scope, and test coverage.
- Confirm the diff does not include secrets or runtime artifacts.
- After `PASS` and `APPROVE`, the Orchestrator commits the scoped diff, pushes the working branch, creates a PR, and records the PR reference in `Notes` or a PR column if one is added.
- PR merge remains manual and requires explicit user direction.
- After a user-approved PR merge succeeds, the Orchestrator closes any linked GitHub Issue not already closed, updates this tracker, syncs the base branch, and deletes merged temporary local and remote branches.

## Current Risks

- Some source comments or UI strings appear to contain mojibake. Treat encoding cleanup as a separate scoped task so product behavior is not mixed with text repair.
- Local runtime data can grow quickly under `data/`; commits must be checked carefully.
- ComfyUI, Civitai, Tavily, and LiteLLM behavior depends on local configuration and should not be assumed available in tests.
- 2D and 3D editor state share project data but have different interaction expectations; regression tests should cover migration and mode switching.
