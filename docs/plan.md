# SceneForge Development Plan

## Planning Model

This is the local roadmap and task tracker for the Orchestrator and sub-agents. It complements `AGENTS.md`, `.codex/agents/*.toml`, `docs/product-vision.md`, `docs/product-spec.md`, and `docs/tech-spec.md`.

Tracks are planning units. Implementation work must be split into issue-ready tasks before coding begins, unless the Track is explicitly marked `N/A` as local-only work.

## Immediate Next Step

Story Graph planning tracks `T16` through `T22` were added in PR `#60`.

`T20A` / Issue `#77` was added after `T20` to fill the Story Graph input/start-workflow gap. Implement `T20A` before `T21` so shot graph execution has real user-started story workflow state instead of static `/story` sample artifacts.

Story Graph prompt-planning refinements were merged in follow-up PR `#83`.

Story Graph refinement tracks `T23A` through `T23D` were added after saved-workflow review found redundant node outputs, overly tag-like Anima Story prompts, risky source-image inheritance for major pose/composition changes, and Visual Output that still exposes implementation details. Implement them in order: `T23A`, `T23B`, `T23C`, then `T23D`. Follow-up reviewer fixes for Story Visual diagnostics and server-ranked resource planning are tracked in PR `#95`; Story prompt-health warning cleanup is tracked in PR `#96`.

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
| T1 | #1 | Audit Agent backend contracts for single-image workflow reuse | Agent MVP | Done | PASS | APPROVE | Confirmed reusable LiteLLM, ComfyUI, image storage, and error contracts. The old standalone Agent draft direction is superseded, but the reuse audit remains useful. Merged PR #2. |
| T-CI | N/A | Configure GitHub Actions CI | Repository Infrastructure | Done | PASS | Self-reviewed | Temporary repository-bootstrap work requested directly; no GitHub Issue needed. Adds Node 22.x CI for install, lint, typecheck, test, and build. Full local and GitHub Actions validation passed. Merged PR #3. |
| T2 | N/A | Reset MVP requirements to LangGraph timeline | Agent Timeline MVP | Done | Docs only | Self-reviewed | Product direction was reset. PR #5 and Issue #4 were closed as superseded by the top-to-bottom LangGraph timeline MVP. This track updates planning, product, technical, and README docs only. |
| T3 | #7 | Add LangGraph workflow orchestration foundation | Agent Timeline MVP | Done | PASS | APPROVE | Add LangGraph dependency; define workflow state, node result, dependency DAG, status transitions, stale downstream regeneration, and adapters around existing LLM interfaces. No timeline UI or ComfyUI execution yet. Merged PR #8. |
| T4 | #9 | Build initial input and vertical timeline shell | Agent Timeline MVP | Done | PASS | APPROVE | Depends on T3. Initial screen is only scene input, start button, and settings entry. After submit, show the AI agent workflow workbench with step navigation, selected-step workspace, inspector/activity panels, manual edits, and reserved future execution nodes. Merged PR #10; Issue #9 closed. |
| T5 | #11 | Infer scene, character tags, action, and bind to 3D canvas | Agent Timeline MVP | Done | PASS | APPROVE | Depends on T3 and T4. Restores the timeline workbench to a usable desktop 3-column layout, reuses existing LLM interfaces and 3D/stick-figure modules to infer scene prompt, main-character tags, action pose, and binds results to the 3D canvas. MVP supports one primary character. Merged PR #12; Issue #11 closed. |
| T-AN1 | #23 | Add ComfyUI workflow profiles with Illustrious fallback and Anima txt2img | Editor ComfyUI Anima | Done | PASS | APPROVE | Temporary high-priority insertion before T6. Added workflow profile registry, preserved the existing Illustrious/default workflow as fallback, added Anima txt2img using UNETLoader + CLIPLoader + VAELoader + LoraLoader, kept preview metadata while capping preview steps, and made object_info validation profile-aware. Unknown or non-Anima diffusion models do not expose manual profile selection and fall back to Illustrious/default. Follow-up compatibility fixes added optional ComfyUI input parsing for CLIPLoader.device and runtime KSampler sampler/scheduler dropdown options from object_info. Merged PR #24; Issue #23 closed. |
| T-AN2 | #25 | Persist Anima model settings through /editor, style palette, Civitai resources, and saved params | Editor ComfyUI Anima | Done | PASS | APPROVE | Depends on T-AN1. Auto-select Anima profile when selected Civitai checkpoint has baseModel Anima; strict Anima LoRA compatibility by baseModel Anima; Anima CLIP/VAE model names are fixed profile defaults (`qwen_3_06b_base.safetensors`, `qwen_image_vae.safetensors`) rather than user selections; persist profile/baseModel/modelStorageKind metadata in saved params, generated image history, sequence defaults/shots, and project serialization. Merged PR #26; Issue #25 closed. |
| T-AN3 | #27 | Support Anima img2img, inpaint, high-res inpaint, and sequence inheritance | Editor ComfyUI Anima | Done | PASS | APPROVE | Depends on T-AN1 and T-AN2. Reuse VAEEncode for img2img, VAEEncodeForInpaint for inpaint, and the existing high-res/local-region inpaint pipeline with Anima profile model context. Sequence shots must inherit workflow metadata and support txt2img, previous-shot img2img, and inpaint without falling back to Illustrious. Merged PR #28; Issue #27 closed. |
| T-AN4 | #29 | Support Anima ControlNet, character references, and detailers | Editor ComfyUI Anima | Done | PASS | APPROVE | Depends on T-AN1 through T-AN3. First Anima release must support ControlNet, IPAdapter/character references, Face Detailer, and Hand Detailer. Detailers and add-ons must consume profile-provided model/clip/vae context instead of assuming CheckpointLoaderSimple. Unsupported or missing ComfyUI nodes/files must be caught before queueing with actionable errors. Merged PR #30; Issue #29 closed. |
| T-AN5 | #31 | Add Anima prompt formatting for /editor | Editor ComfyUI Anima | Done | PASS | APPROVE | High-priority insertion before T6. Added Anima prompt output for editor preview, ComfyUI, Comic Sequence, and Selected Artist Strings. Style Palette artist string formats now follow the selected checkpoint baseModel, with Anima showing only `@artist (:weight)` and non-Anima hiding the Anima format. Conservative safety behavior omits default `safe` when NSFW is enabled, while Anima prompt parts are reordered into the Anima-recommended order. Merged PR #32; Issue #31 closed. |
| T-AN6 | #33 | Refine Anima prompt formatting with natural descriptive clauses | Editor ComfyUI Anima | Done | PASS | APPROVE | Follow-up to T-AN5. Strengthened Anima AI prompt instructions so `/editor` prompts use concise English visual clauses for character identity, pose/action, expression, scene objects, lighting, mood, camera framing, foreground/background relationships, motion, and atmosphere while preserving Stable Diffusion / Anima prompt usability. Multi-person scenes request distinct hairstyle and distinct pose/action per person. Merged PR #34; Issue #33 closed. |
| T6 | #36 | Add centralized settings page | Agent Timeline MVP | Done | PASS | APPROVE | Central settings page for NSFW, path/status dashboard, Civitai path editing, and redacted integration status. Secrets remain server-only; full runtime secret editing is out of scope. Merged PR #37; Issue #36 closed. |
| T7 | #38 | Add checkpoint, LoRA, and parameter recommendation nodes | Agent Timeline MVP | Done | PASS | APPROVE | Depends on T5 and T6. Reuse Civitai recommendation, selected-resource UI, and ComfyUI parameter controls. LLM must choose from local candidates, not invent unavailable resource names. Merged PR #39; Issue #38 closed. |
| T8 | #40 | Add confirmed single-image ComfyUI execution timeline nodes | Agent Timeline MVP | Done | PASS | APPROVE | Depends on T7. Timeline stops before generation. Only the user clicking start image generation can advance to ComfyUI execution and result display. MVP remains single-image only. Merged PR #41; Issue #40 closed. |
| T9 | #42 | Add resource-aware final prompt formatting and local-only model selection | Agent Timeline MVP | Done | PASS | APPROVE | Depends on T7 and T8. Treat scene prompt as upstream semantic prompt draft, assemble the final ComfyUI prompt after selected local checkpoint and LoRAs are known, insert selected LoRA trainedWords from local metadata, format by checkpoint baseModel/profile, and prevent completed resource outputs from referencing checkpoint or LoRA resources outside the local candidate set. Follow-up preserves detailed ComfyUI object_info mismatch messages in step 9 when selected local Civitai resources are not available to the current ComfyUI instance. Merged PR #43, PR #44, and follow-up PR #46; Issue #42 closed. |
| T10 | #47 | Persist Agent timeline project state across Run and Settings navigation | Agent Timeline MVP | Done | PASS | APPROVE | Defines durable active timeline workflow autosave so node outputs, manual edits, stale/error statuses, selected resources/parameters, generation gate state, and result references survive expected Run/Settings navigation. Merged PR #48; Issue #47 closed. |
| T11 | #49 | Add workflow project management UI comparable to editor | Agent Timeline MVP | Done | PASS | APPROVE | Depends on T10. Adds timeline workflow project list/open/save/rename/delete affordances comparable to editor project management after durable timeline storage exists. Merged PR #50; Issue #49 closed. |
| T12 | #51 | Add Timeline Scene input img2img source image support | Agent Timeline MVP | Done | PASS | APPROVE | Adds root Timeline source-image upload, img2img denoise default/editing, forced single-image generation, and shared ComfyUI txt2img workflow support for default/Illustrious plus Anima VAEEncode. Merged PR #52; Issue #51 closed. |
| T13 | #53 | Add SQLite FTS5 BM25 ranking for Civitai recommendation candidates | Civitai Recommendation | Done | PASS | APPROVE | Replace hand keyword/includes candidate ordering with a rebuildable SQLite FTS5 derived index. BM25 ranks local checkpoint/LoRA candidates before the existing LLM recommendation step. No LanceDB, no API shape change, no automatic full reindex in request handlers, and no settings-page index status in this issue. Depends on existing Civitai SQLite storage and T7/T9 recommendation flow. Merged PR #54; Issue #53 closed. |
| T14 | #55 | Add simple and detailed Run workflow display modes | Agent Timeline MVP | Done | PASS | APPROVE | Default Run display to simple mode using the existing Scene input command composer content, add a Settings-controlled `simple`/`detailed` workflow display preference, preserve detailed workbench behavior, and reuse active workflow autosave so the same scene/workflow appears in the selected interface. Auto review automatically confirms and renders at the ComfyUI generation gate; otherwise users confirm manually. PR #56. |
| T15 | #57 | Add sqlite-vec embedding index and RRF Civitai recommendations | Civitai Recommendation | Done | PASS | APPROVE | Add sqlite-vec embedding support for local Civitai LoRA/checkpoint recommendation as derived index data. Keep the existing BM25/FTS migration and rebuild script unchanged; add a second embedding-only migration/reindex script that assumes the BM25 migration/index already exists and is complete. Generate embeddings through LiteLLM configuration. BM25 and embedding retrieval must each select and rank candidates independently, then merge with Reciprocal Rank Fusion; do not manually add configurable BM25/embedding weights. Do not rewrite existing Civitai resource business rows as a data migration; vector tables and metadata are derived index data. Merged PR #58; Issue #57 closed. |
| T16 | #61 | Extract shared workflow definitions and common node primitives | Story Graph Foundation | Done | PASS | APPROVE | First prerequisite for Story Graph work. Extract reusable timeline/workflow definition concepts, common node metadata, status handling, manual edit and stale propagation behavior, raw JSON display, visual workspace routing, AI retry affordance, and adapter contracts before any story-specific implementation. Adapter contracts must support single-artifact and future shot-graph artifacts. Resource-plan common behavior must not read, output, or depend on model NSFW markers because current resource NSFW metadata is unreliable; NSFW remains content and execution context only. Acceptance: existing single-image behavior remains unchanged while common primitives are available for later workflow definitions. Merged PR #68; Issue #61 closed. |
| T17 | #62 | Migrate single-image timeline to definition-driven orchestration | Story Graph Foundation | Done | PASS | APPROVE | Depends on T16. Introduced `TimelineWorkflowDefinition` for mode, node ids, DAG edges, common node type, workspace key, and adapter factory. LangGraph registration, readiness, downstream stale calculation, `canRun`, and React node/workspace rendering are definition-driven instead of hard-coded to the current single-image ids. Existing records that lack a workflow mode restore as `single-image`. Validation passed with timeline/API tests, typecheck, and lint warnings only. Merged PR #70; Issue #62 closed. |
| T18 | #63 | Define Story Graph domain models and workflow DAG | Story Graph Workflow | Done | PASS | APPROVE | Depends on T17. Add story workflow definitions and typed planning artifacts without execution or old editor sequence reuse. Story mode starts from shared workflow primitives, not the existing editor sequence implementation. Proposed story DAG: story-input, story-bible, story-outline, storyboard-shots, story-safety-plan, shot-dependency-graph, plot-state-graph, character-continuity-graph, resource-plan, parameter-plan, story-render-plan, story-consistency-check, generation-gate, shot-graph-execution, story-result-display. Models include StoryBible, StoryShot, StorySafetyPlan, ShotDependencyGraph, PlotStateGraph, CharacterContinuityGraph, and StoryConsistencyCheck. Acceptance: story node readiness validates required predecessors, rejects dependency cycles and invalid shot sources, and remains inactive until later UI/execution tracks wire it. Merged PR #72; Issue #63 closed. |
| T19 | #64 | Add Story Graph planning workspaces and manual editors | Story Graph Workflow | Done | PASS | APPROVE | Depends on T18. Add story-facing workspaces for storyboard shots, story safety, shot dependency graph editing, plot-state editing, and character continuity review. Extend shared resource, parameter, generation gate, and result workspaces for story-scoped data without duplicating common timeline controls. Manual edits must mark only the edited story artifact or shot scope as manual and stale dependent downstream nodes through the workflow definition. Acceptance: users can inspect and manually edit story planning outputs before any generation, with old sequence UI treated only as historical context and not the implementation foundation. Merged PR #74; Issue #64 closed. |
| T20 | #65 | Add story resource, parameter, render, preview, and NSFW planning | Story Graph Workflow | Done | PASS | APPROVE | Depends on T18 and T19. Resource planning must select only from validated local candidates and must ignore model NSFW markers entirely. Parameter-plan stores formal generation parameters; preview execution options and preview results must be separate and must never write back into the formal parameter plan. Story safety, render plan, generation gate, and execution request assembly handle NSFW as content and execution context rather than resource filtering or model-tag filtering. Acceptance: preview on/off does not mutate formal parameters, resource-plan output has no dependency on model NSFW metadata, and NSFW context is visible at safety/render/gate/execution boundaries. Merged PR #76; Issue #65 closed. |
| T20A | #77 | Add Story Graph input and planning start workflow | Story Graph Workflow | Done | PASS | APPROVE | Depends on T18, T19, and T20. Add the real Story Graph input/start workflow surface so users can submit a story request and optional target shot count, use AI suggest/rewrite for the request, and derive audience rating/NSFW context from Settings. Initialize typed `StoryInput`, generate or assemble inspectable planning artifacts through shared workflow actions and existing planning helpers, and make user-started workflow state the primary `/story` path instead of static sample artifacts. No shot execution, persistence, generated image bytes, old sequence reuse, user-entered title/content warning/NSFW fields, or model NSFW-marker filtering. Acceptance: user input starts a `story-graph` workflow, planning nodes render from user-started state, manual edits preserve shared stale propagation, and the generation gate remains non-executing until T21. Merged PR #79; Issue #77 closed. |
| T21 | #66 | Add shot graph execution scheduler and scoped regeneration | Story Graph Workflow | Done | PASS | APPROVE | Depends on T20A. Implement shot-graph execution through a topological scheduler using the shared execution infrastructure and existing ComfyUI validation, object_info compatibility checks, queueing, history polling, and generated image storage helpers. Independent shots may run in parallel; img2img shots wait for their source shot; multi-reference shots wait for all referenced source shots. Regeneration marks the selected shot and downstream dependent shots stale without disturbing unrelated branches. Acceptance: independent shot parallelism, source waiting, multi-reference waiting, selected-shot regeneration, and downstream-only stale propagation are covered by tests. Merged PR #81; Issue #66 closed. |
| T22 | #85 | Persist Story Graph workflow state and result references | Story Graph Workflow | Done | PASS | APPROVE | Depends on T18 through T21. Extend workflow persistence to save workflow mode, definition version, node outputs, selected node, selected shot, display mode, story planning artifacts, shot statuses, preview references, final result references, gate state, and recoverable execution metadata. Preserve compatibility for old single-image records and never persist generated bytes, secrets, downloaded models, caches, logs, or local resource databases. Acceptance: story workflows restore with preview and final references separated, interrupted running shots restore as recoverable errors, and legacy single-image records still load as `single-image`. Merged PR #86; Issue #85 closed. |
| T23A | #89 | Tighten Story Graph output contracts and raw debug boundaries | Story Graph Refinement | Done | PASS | APPROVE | Depends on T18 through T22. Implemented with T23B-D in merged PR #93; Issue #89 closed. |
| T23B | #90 | Refine Anima Story prompts into natural visual clauses | Story Graph Refinement | Done | PASS | APPROVE | Depends on T18 through T22. Implemented in merged PR #93 with Story Anima prompt parts, LLM-owned shot-count decisions, render prompt normalization hardening, and prompt conflict handling; Issue #90 closed. |
| T23C | #91 | Add source-image risk decisions for Story shot dependencies | Story Graph Refinement | Done | PASS | APPROVE | Depends on T18 through T22. Implemented in merged PR #93 with source-image risk metadata and execution-safe dependency handling for Story generation; Issue #91 closed. |
| T23D | #92 | Redesign Story Visual Output around shot cards and prompt health | Story Graph Refinement | Done | PASS | APPROVE | Depends on T23A-C. Implemented in merged PR #93 with shot-card Visual summaries, prompt health, source-chain display, and Raw JSON debug boundaries; Issue #92 closed. |

## MVP Timeline Nodes

| Node | Inputs | Outputs | Dependencies | User Intervention | AI Re-entry |
| --- | --- | --- | --- | --- | --- |
| Scene input | Natural-language scene request | Workflow id, raw intent, settings snapshot | None | Edit input and restart workflow | Optional input rewrite, without mutating old downstream nodes |
| Scene prompt | Raw intent, settings | Positive scene prompt, negative suggestions, style/camera/light fragments | Scene input | Edit prompt sections | Re-run scene prompt node with user guidance |
| Character tags | Raw intent, scene prompt | Primary character description, body-part tags, clothing, expression | Scene prompt | Add, remove, or bind tags manually | Re-run character tag node with user guidance |
| Character action | Character tags, raw intent, current pose | Action description and 3D pose targets | Character tags | Edit action text or choose pose preset | Re-run pose node with user guidance |
| 3D canvas binding | Scene prompt, tags, pose | 3D scene entities, primary skeleton, spatial summary | Scene prompt, character tags, character action | Drag character, camera, and simple scene objects | Re-run pose or spatial suggestion against current canvas |
| Checkpoint and LoRA | Prompt data, tags, action, NSFW, local Civitai candidates | Selected checkpoint, LoRAs, reasons, suggested weights | Scene prompt, character tags, character action, settings/resources | Re-select from local candidate UI | Re-run recommendation with style/model preference |
| Generation parameters | Final prompt draft, selected resources, settings | Width, height, steps, cfg, sampler, scheduler, denoise, seed policy, negative additions | Checkpoint and LoRA, prompt data, canvas summary | Edit parameters with existing controls | Re-run parameter suggestion with quality/speed/aspect guidance |
| Start image generation | Prompt, resources, parameters, canvas summary | Confirmed ComfyUI request preview | All previous nodes done or manual | Click start image generation | AI may explain risks or suggest final adjustments, but must not call ComfyUI |
| ComfyUI execution | Confirmed request | Queue metadata, execution status | Start image generation confirmation | Retry/cancel where supported | Use existing diagnosis helpers on failure |
| Result display | ComfyUI result | Single image, metadata, reusable prompt/parameters | ComfyUI execution | Save, copy, or return to upstream nodes | Use result feedback to re-enter upstream nodes |

## Dependency and Regeneration Rules

- LangGraph is the source of truth for node order, dependency edges, and execution state.
- Nodes with no dependency relationship may run in parallel.
- A node may run only when all required dependencies are `done` or `manual`.
- User intervention marks the edited node as `manual`.
- Every downstream node that depends on a manual edit must become `stale` and automatically regenerate when its dependencies are valid again.
- Nodes outside the dependency closure of an edit must keep their existing result.
- The UI must not implement an ad hoc waterfall of LLM calls. It renders graph state and invokes graph actions.

## Task Slicing Rules

- A track becomes implementation-ready only when acceptance criteria and validation expectations are clear.
- A Track with `GitHub Issue` set to `TBD`, blank, or missing is not ready for implementation.
- A Track with `GitHub Issue` set to `N/A` is local-only work and must explain that decision in `Notes`.
- A Track with a concrete issue number such as `#12` uses that GitHub Issue as the implementation scope source of truth.
- Prefer one issue-ready task per behavior boundary: LangGraph orchestration, timeline UI, LLM node adapters, editor/3D binding, settings, Civitai resources, ComfyUI execution, or persistence.
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
- For timeline work, verify LangGraph owns orchestration and UI/API code is not manually chaining graph nodes.

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

- T5 must bind inferred scene, character, and action outputs to existing 3D/stick-figure modules without bypassing LangGraph workflow state.
- Future LLM node work must continue wrapping existing interfaces as graph node adapters rather than adding ad hoc timeline-specific request paths.
- Some source comments or UI strings appear to contain mojibake. Treat encoding cleanup as a separate scoped task so product behavior is not mixed with text repair.
- Local runtime data can grow quickly under `data/`; commits must be checked carefully.
- ComfyUI, Civitai, Tavily, and LiteLLM behavior depends on local configuration and should not be assumed available in tests.
- 2D and 3D editor state share project data but have different interaction expectations; regression tests should cover migration, graph binding, and manual canvas edits.
