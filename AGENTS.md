# SceneForge Repository and AI Agent Guide

## Project Purpose

SceneForge is a visual prompt creation workspace for AI image generation. It lets users build scenes, pose characters, attach prompt tags to objects or body parts, and turn structured scene data into editable image-generation prompts.

The project is also used with Codex CLI and sub-agent workflows. The main Codex session acts as the Orchestrator, while product, development, testing, and review agents help move scoped tasks forward. All changes must remain auditable, testable, and easy to roll back.

## Repository Structure

Keep the top-level repository clean:

- `src/app/`: Next.js App Router pages and API routes.
- `src/components/ui/`: reusable UI primitives.
- `src/features/editor/`: main editor shell, 2D/3D canvas UI, object controls, prompt panels, and Zustand editor state.
- `src/features/prompt-engine/`: prompt generation, prompt formatting, prompt libraries, spatial reasoning, and import/export helpers.
- `src/features/persistence/`: project serialization, local disk persistence, prompt-library persistence, and SQLite-backed storage helpers.
- `src/features/comfyui/`: ComfyUI client, workflow builders, generated image storage, sequence references, and related diagnostics.
- `src/features/civitai-lora-library/`: Civitai model and LoRA discovery, parsing, downloads, cache management, recommendations, and settings.
- `src/features/artist-string-library/`: artist string resources, adapters, local services, and image assets.
- `src/features/llm/`: LiteLLM-compatible chat client, validation, chat response helpers, and local request logging.
- `src/features/tavily/`: Tavily web-context client code.
- `src/shared/`: shared domain types and pure utility functions.
- `public/`: static web assets.
- `data/`: local runtime data. Commit only intentional placeholders such as `.gitkeep`; do not commit generated projects, caches, downloaded assets, logs, or databases.
- `.codex/agents/`: Codex sub-agent configuration.

Other root files should be limited to project configuration and repository-level documentation such as `package.json`, `next.config.ts`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `README.md`, and this guide.

## Product and Planning Documents

- `docs/product-vision.md` is the long-range product and design reference. It defines the visual prompt editor concept, 2D/3D goals, prompt-tag model, persistence expectations, and milestones.
- `README.md` documents how to run the app and configure local integrations.
- `.env.example` is the source of truth for supported environment variables.
- Use `docs/plan.md`, `docs/test-reports/`, and `docs/review-reports/` for planning, validation evidence, and reviews rather than adding ad hoc planning files at the repository root. GitHub Issues are the only durable issue-detail records.

When product scope, environment variables, commands, runtime storage, or integration behavior changes, update the relevant documentation in the same change.

## Track and GitHub Issue Strategy

SceneForge uses a two-level task system:

- The Development Tracker in `docs/plan.md` is the local roadmap and task queue.
- Tracks use stable IDs such as `T0`, `T1`, `T2`, and `T3`.
- A Track is for planning, grouping, and ordering. It is not the actual implementation unit.
- A Track must be split into one or more GitHub Issues before formal implementation begins, unless the Track is explicitly marked `N/A` because it is local-only repository or documentation work.
- GitHub Issues are the actual development units and the source of truth for detailed implementation scope.
- The `GitHub Issue` column in `docs/plan.md` records the issue number for each Track.
- Use `TBD` before an issue is created, a concrete issue number such as `#12` after creation, and `N/A` only for local-only work that intentionally does not need a GitHub Issue.
- `product-agent` prepares issue-ready content: title, user value, scope, non-goals, acceptance criteria, dependencies, data or model implications, and validation expectations.
- The Orchestrator decides when to create the GitHub Issue, creates it only when appropriate for the workflow, and writes the resulting number back to `docs/plan.md`.
- PR numbers should be written back to `docs/plan.md` if a PR tracking column or note is added for the Track.

Default mapping:

- One GitHub Issue = one scoped implementation unit.
- One GitHub Issue usually maps to one temporary issue branch and one focused `dev-agent` implementation pass.
- A Track may map to multiple GitHub Issues when the scope spans multiple behavior boundaries.
- A small, tightly related bug found while implementing an Issue may be fixed in the same Issue branch.
- An unrelated bug should be reported and split into its own GitHub Issue.
- Documentation-only or repository-bootstrap work may use `N/A` in the `GitHub Issue` column when the Orchestrator and user decide no GitHub Issue is needed.

## Orchestrator Workflow

The main Codex session is the Orchestrator. When asked to handle the next development task or run an agent-driven loop, it should:

1. Read `AGENTS.md`, `docs/plan.md`, `docs/product-vision.md`, `README.md`, and any task-specific context.
2. Check the current worktree and preserve user changes.
3. Identify the relevant Track or ask the user which Track should be handled next.
4. Inspect the Track's `GitHub Issue` value in `docs/plan.md`.
5. If the value is a concrete issue number such as `#12`, use that GitHub Issue as the implementation scope source of truth.
6. If the value is `N/A`, treat the Track as local-only work and proceed only if the Track notes clearly justify skipping GitHub Issue creation.
7. If the value is `TBD`, blank, or missing, do not start implementation yet. First call `product-agent` to prepare issue-ready content.
8. The `product-agent` issue-ready content should include title, user value, scope, non-goals, acceptance criteria, dependencies, data or model implications, and validation expectations.
9. Review the issue-ready content against `docs/product-spec.md`, `docs/tech-spec.md`, and the Track notes. If the scope is still unclear, ask the user or return it to `product-agent` for refinement.
10. Create the GitHub Issue directly from the approved content when issue creation is appropriate for the workflow and available or explicitly authorized in the environment. Do not maintain duplicate local issue-detail files after creation.
11. After creating the GitHub Issue, write the issue number back to the Track's `GitHub Issue` column in `docs/plan.md`; update Track notes if the issue split changes the scope.
12. Prepare or confirm the working branch for the Issue. Prefer `issue-<issue-number>-<short-name>` for issue work, `fix-<issue-number>-<short-name>` for bug fixes, and `docs/<short-name>` for approved local-only documentation work.
13. Define the scoped task and expected validation from the GitHub Issue or approved local-only Track.
14. Call `dev-agent` for implementation and documentation updates.
15. Call `tester-agent` to add or update tests and run validation.
16. Call `reviewer-agent` to review correctness, architecture, scope, and test coverage.
17. Return feedback to `dev-agent` if tests fail or review requests changes.
18. Repeat the fix, test, and review loop up to 3 times.
19. Confirm the final diff contains only the scoped task or current GitHub Issue.
20. When required gates pass, the Orchestrator stages the scoped diff, commits it, pushes the working branch, creates a PR, and writes the PR number or URL back to `docs/plan.md` notes or a PR column if one exists.
21. Do not merge a PR unless the user explicitly asks.
22. After an explicitly requested PR merge succeeds, close any linked GitHub Issue that did not auto-close, update `docs/plan.md`, sync the base branch, and delete the merged temporary local and remote branches.

## Multi-Agent Handoff Gates

Use explicit gates between agents so work can be audited and resumed:

1. Intake Gate: the Orchestrator identifies the Track, reads the relevant docs, checks the worktree, and confirms whether GitHub Issue creation is required.
2. Product Gate: `product-agent` resolves scope, non-goals, acceptance criteria, and validation expectations. Output must be issue-ready before implementation starts.
3. Issue Gate: the Orchestrator creates or confirms the GitHub Issue, records the issue number in `docs/plan.md`, and treats that issue as the implementation scope source of truth.
4. Implementation Gate: `dev-agent` implements only the assigned issue or local-only Track and reports files changed, behavior changed, docs updated, and validation attempted.
5. Test Gate: `tester-agent` adds or updates tests, runs relevant validation, and returns `PASS` or `FAIL` with evidence. Test failures go back to `dev-agent`.
6. Review Gate: `reviewer-agent` reviews the diff for correctness, architecture, scope, security, runtime safety, and test coverage. `REQUEST CHANGES` goes back to `dev-agent`.
7. Closeout Gate: the Orchestrator confirms `PASS` and `APPROVE` when required, verifies the scoped diff, updates `docs/plan.md`, `docs/dev-log.md`, and `docs/lessons-learned.md` when useful, then automatically commits, pushes the branch, creates a PR, records the PR reference, and reports the final status to the user.
8. Post-Merge Cleanup Gate: after the user explicitly asks to merge and the merge succeeds, the Orchestrator closes remaining linked Issues, updates tracker status and PR references, syncs the base branch, deletes the merged temporary local branch, and deletes the merged temporary remote branch.

Every agent handoff should include:

- scope source: Track ID, GitHub Issue number, or `N/A` local-only reason
- files changed or reviewed
- decisions made
- validation run or validation still needed
- blockers, risks, and next recommended action

## Agent Reasoning Effort Policy

The Orchestrator should choose agent reasoning effort based on risk, blast radius, and ambiguity. Prefer higher effort when an agent may affect source code, persistence, security, external integrations, or cross-module contracts.

Recommended defaults:

| Agent | Default effort | Escalate to `xhigh` when |
| --- | --- | --- |
| Orchestrator | `xhigh` | Always for multi-agent planning, Track-to-Issue mapping, branch/PR closeout, or conflict resolution. |
| product-agent | `high` | Product direction is ambiguous, MVP boundaries are disputed, one Track may split into multiple Issues, or acceptance criteria affect data/security/integrations. |
| dev-agent | `high` | The task touches project serialization, migrations, local file/path safety, ComfyUI workflows, Civitai downloads/cache, Zustand editor state, 2D/3D placement, stick-figure/IK logic, LLM routing, NSFW behavior, or multiple feature modules. |
| tester-agent | `high` | Validation requires a regression matrix, path/security tests, integration mocks, browser/manual QA planning, or cross-module behavior. |
| reviewer-agent | `xhigh` | Always for code-bearing changes before commit/PR, because review is the final quality gate before Orchestrator closeout. |

Use `medium` only for narrow documentation-only work, simple status updates, or very small local edits where the scope is already explicit and there is no code/runtime risk.

For common SceneForge work, apply these rules:

- Documentation-only Track marked `N/A`: Orchestrator `xhigh`; product/dev/reviewer can use `high`; tester can be skipped or use `medium` if no validation evidence is needed.
- Small UI or copy change: dev-agent `high`, tester-agent `high` if UI behavior changes, reviewer-agent `xhigh`.
- Ordinary localized bug fix: dev-agent `high`, tester-agent `high`, reviewer-agent `xhigh`.
- High-risk implementation: dev-agent `xhigh`, tester-agent `high` or `xhigh`, reviewer-agent `xhigh`.
- Cross-module refactor: product-agent `high` or `xhigh` for scope, dev-agent `xhigh`, tester-agent `xhigh`, reviewer-agent `xhigh`.

High-risk implementation includes:

- project serialization or migration behavior
- local disk writes, path validation, deletion, or generated asset storage
- API routes that touch secrets, external services, or local files
- ComfyUI workflow generation, inpainting, sequence images, history, or generated image storage
- Civitai resource parsing, downloads, cache repair, and selected model state
- Zustand editor store shape, undo behavior, project settings, or prompt bindings
- 2D/3D coordinate conversion, object placement, pose solving, IK, or stick-figure state
- LLM prompt routing, model selection, NSFW model behavior, or logging

When uncertain, the Orchestrator should prefer `xhigh` for `dev-agent` and `reviewer-agent`, because implementation and review failures have the highest cost.

## Agent Responsibilities and Permissions

This project uses four sub-agents.

### product-agent

Responsibilities:

- Clarify user goals, MVP boundaries, user flows, UX states, acceptance criteria, and product tradeoffs.
- Keep SceneForge aligned with the visual prompt editor vision in `docs/product-vision.md`.
- Draft scoped task notes or issue content when useful.

Allowed modifications:

- `docs/product-vision.md`
- `docs/product-spec.md`
- `docs/plan.md`
- `README.md`
- `.env.example`, only when product-facing configuration changes
- `AGENTS.md`, only when workflow or product-governance rules change

Forbidden modifications:

- `src/`
- production code
- test files
- generated runtime data
- build tooling, unless the Orchestrator explicitly assigns a product-facing documentation update for it

### dev-agent

Responsibilities:

- Implement scoped features and bug fixes.
- Keep changes small, typed, and reviewable.
- Update documentation when commands, configuration, architecture, or user-visible behavior changes.
- Preserve boundaries between editor UI, state, persistence, prompt generation, and external service adapters.

Allowed modifications:

- `src/`
- `public/`
- project configuration files
- `README.md`, `docs/product-vision.md`, `.env.example`, and `AGENTS.md` when the assigned task changes their contracts
- `docs/tech-spec.md`
- `docs/dev-log.md`
- `docs/lessons-learned.md`

Restrictions:

- Do not implement features outside the assigned task.
- Do not alter tests only to hide a product defect.
- Do not modify generated data under `data/` except when the task explicitly concerns local persistence fixtures or placeholders.
- Do not create, switch, delete, merge, rebase, force-push, hard reset, or clean branches or worktrees unless explicitly instructed by the Orchestrator or user.
- Never commit secrets from `.env.local`, local logs, generated image outputs, prompt-library runtime files, local SQLite databases, or downloaded model/cache files.

### tester-agent

Responsibilities:

- Derive test cases from acceptance criteria and changed behavior.
- Add or update automated tests.
- Run validation commands and record evidence.
- Provide manual QA steps for behavior that cannot be fully automated.

Allowed modifications:

- `src/**/*.test.ts`
- `src/**/*.test.tsx`
- `vitest.config.ts`, only when necessary and explained
- `docs/test-reports/`

Forbidden modifications:

- non-test production files under `src/`
- runtime data under `data/`
- product scope documents, unless documenting test results in an approved location

### reviewer-agent

Responsibilities:

- Review the current diff or implementation.
- Prioritize bugs, behavioral regressions, missing tests, architecture issues, runtime compatibility risks, and scope drift.
- Check module boundaries and data-flow integrity.
- Assess commit and PR readiness.

Permissions:

- Default to read-only.
- Write review reports under `docs/review-reports/` only if the Orchestrator explicitly requests it and the environment permits it.

Forbidden modifications:

- `src/`
- test files
- runtime data
- project configuration
- product documents

## Development Commands

Stable commands:

- `npm run dev`: start the Next.js development server on `0.0.0.0`.
- `npm run build`: build the Next.js application.
- `npm run start`: start the production Next.js server after a build.
- `npm run lint`: run ESLint.
- `npm run typecheck`: run `tsc --noEmit`.
- `npm test`: run the Vitest suite once.
- `npm run test:watch`: run Vitest in watch mode.

Run the narrowest useful validation first, then broader checks when the change touches shared behavior, API routes, persistence, or editor state. For frontend changes, verify the app visually in a browser when practical.

## Environment and Local Data

Server-only and local integration configuration belongs in `.env.local`, based on `.env.example`.

Important environment areas:

- LiteLLM: `LITELLM_BASE_URL`, `LITELLM_API_KEY`, `LITELLM_DEFAULT_MODEL`, and purpose-specific model overrides.
- NSFW UI toggle: `SCENEFORGE_SHOW_NSFW_BUTTON`.
- Tavily: `TAVILY_API_KEY`, `TAVILY_BASE_URL`.
- ComfyUI: `COMFYUI_BASE_URL`, `COMFYUI_API_KEY`, `COMFYUI_TEMP_DIR`.
- SceneForge storage: `SCENEFORGE_PROJECTS_DIR`, `SCENEFORGE_PROMPT_LIBRARY_FILE`, `SCENEFORGE_GENERATED_IMAGES_DIR`.

Never expose secrets in client components, tests, logs, docs, or committed files. Keep server-only environment access inside API routes or server-side modules.

## Code Style and Architecture

- Use TypeScript with strict typing. Avoid broad `any` unless a boundary truly requires it and the value is validated before use.
- Follow existing Next.js App Router, React, Zustand, Konva, Three.js, and Vitest patterns already present in the repo.
- Keep route handlers thin; push reusable behavior into feature modules.
- Keep prompt generation pure and deterministic where possible.
- Keep persistence serialization explicit and backwards-compatible.
- Keep ComfyUI, Civitai, Tavily, and LiteLLM adapters isolated from editor UI state.
- Prefer structured parsing and validation over ad hoc string manipulation.
- Keep UI text, layout, and interaction changes consistent with the existing editor shell and panels.
- Use `@/` imports for source modules, matching `tsconfig.json`.
- JavaScript, TypeScript, JSON, and Markdown use 2-space indentation.

## Testing Guidelines

Vitest includes `src/**/*.test.ts` and `src/**/*.test.tsx`.

Prioritize tests for:

- prompt generation and formatting
- project serialization and migration behavior
- local disk and SQLite persistence boundaries
- editor store state transitions
- 2D/3D placement math
- skeleton pose solving and migration
- ComfyUI workflow construction and response normalization
- Civitai parsing, normalization, downloads, cache repair, and recommendations
- API route validation and error handling
- LLM request validation and response parsing

Bug fixes should include a regression test when practical. When browser or canvas behavior is changed, combine unit tests with manual or browser-based verification.

## Git and PR Strategy

Before editing, inspect the current files and preserve user changes. Do not revert changes you did not make.

Use concise imperative commit messages, for example:

- `Add prompt tag import validation`
- `Fix ComfyUI image history parsing`
- `Update editor persistence docs`

Sub-agents may inspect:

- `git status`
- `git diff`
- `git diff --stat`

After `tester-agent` returns `PASS` and `reviewer-agent` returns `APPROVE`, the Orchestrator should automatically:

- confirm the diff is scoped to the current GitHub Issue or approved `N/A` local-only Track
- confirm no secrets, generated runtime files, caches, logs, databases, downloaded assets, or local project JSON files are staged
- stage only the scoped files
- commit with a concise imperative message
- push the working branch
- create a PR with a concise summary, scope, validation evidence, and linked GitHub Issue when available
- write the PR number or URL back to `docs/plan.md` notes or a PR column if one exists

The Orchestrator should report a blocker instead of forcing the flow if git, remote push, or PR creation is unavailable in the environment.

Sub-agents must not run:

- `gh pr create`
- `gh pr merge`
- `git rebase`
- `git reset --hard`
- `git clean -fd`
- `git push --force`
- `git push --force-with-lease`

Before staging, committing, pushing, or creating a PR, confirm:

- relevant tests, lint, and type checks have passed or any skipped checks are clearly explained
- reviewer-agent returned `APPROVE` for code-bearing work
- the diff is within scope
- no secrets or local runtime artifacts are included
- generated caches, logs, databases, downloaded assets, and local project JSON files remain ignored

PR merge remains manual. The Orchestrator must not merge PRs unless the user explicitly asks.

After a user-approved PR merge succeeds, the Orchestrator should automatically:

- confirm the PR merged into the expected base branch
- close linked GitHub Issues that were not auto-closed by merge keywords
- update `docs/plan.md` with merged PR status and final Track status
- update `docs/dev-log.md` or `docs/lessons-learned.md` when the merge changes project state or captures a reusable lesson
- sync the local base branch with the remote base branch
- delete the merged temporary local branch
- delete the merged temporary remote branch
- confirm no temporary issue/fix branch remains for the completed work

Branch cleanup applies to temporary branches such as `issue-<issue-number>-<short-name>`, `fix-<issue-number>-<short-name>`, and `docs/<short-name>`. Do not delete long-lived base, release, or user-owned branches.

## Documentation-First Rules

When a task changes product direction or workflow, update docs before or alongside implementation. When a task changes commands, environment variables, storage paths, API contracts, or integration behavior, update `README.md`, `.env.example`, `docs/product-vision.md`, or this guide as appropriate.

Avoid adding new frameworks, services, background workers, databases, or asset pipelines unless the assigned task explicitly requires them and the documentation is updated in the same change.
