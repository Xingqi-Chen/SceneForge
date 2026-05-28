# SceneForge Lessons Learned

Use this file for reusable lessons that should shape future work. Do not add one-off status updates here; use `docs/dev-log.md` for those.

## Documentation and Agent Workflow

- Keep `AGENTS.md`, `.codex/agents/*.toml`, and `docs/` synchronized. If an agent permission changes in one place, update the others in the same task.
- Treat `docs/product-spec.md` as current product scope and `docs/product-vision.md` as long-range product vision. When they diverge, update the current scoped doc before implementation.
- Keep GitHub Issues as the only durable issue-detail records; `docs/plan.md` should record Track-to-Issue mapping rather than duplicating issue bodies locally.
- Do not start implementation from a Track with `GitHub Issue` set to `TBD`, blank, or missing. Create or confirm the Issue first unless the Track is explicitly `N/A`.
- Require each agent handoff to state the scope source, files changed or reviewed, validation status, blockers, and next action.
- Keep commit, push, and PR creation as Orchestrator closeout duties after `PASS` and `APPROVE`; sub-agents should not perform those git or GitHub actions themselves.
- Keep PR merge manual, but make post-merge cleanup automatic: close remaining linked Issues, update the tracker, sync the base branch, and delete temporary local and remote branches.

## Runtime Data Safety

- Local runtime files under `data/` are easy to create accidentally during manual testing. Always check diffs before staging.
- Environment-specific values belong in `.env.local`; `.env.example` should document shape and defaults without secrets.
- Any feature that reads or writes local paths must include path traversal checks and tests where practical.

## Testing and Review

- Prefer mocked fetchers for ComfyUI, Civitai, Tavily, and LiteLLM tests so CI and local validation do not require live services.
- Prompt generation should remain deterministic unless an LLM call is explicitly part of the feature.
- Review should lead with blocking risks: state corruption, path safety, client/server boundary leaks, missing regression tests, and documentation drift.

## Editor Architecture

- Keep UI panels thin and push reusable behavior into feature modules or store actions.
- Use the Zustand store as the mutation boundary for project state.
- Keep 2D canvas semantics and 3D viewport semantics distinct, with shared project data normalized at typed boundaries.
- Treat source text encoding cleanup as its own scoped task so it does not hide behavior changes.
