# SceneForge Development Plan

## Planning Model

This is the local roadmap and task tracker for the Orchestrator and sub-agents. It complements `AGENTS.md`, `.codex/agents/*.toml`, `docs/product-vision.md`, `docs/product-spec.md`, and `docs/tech-spec.md`.

Tracks are planning units. Implementation work must be split into issue-ready tasks before coding begins, unless the Track is explicitly marked `N/A` as local-only work.

## Immediate Next Step

Prioritize `T10`: persist Agent timeline project state across Run and Settings navigation. `T-AN1` through `T-AN6`, `T6`, `T7`, `T8`, and `T9` are complete and together define the first usable Anima release plus the centralized settings entry point, pre-generation recommendation flow, confirmed single-image ComfyUI execution, and resource-aware final prompt formatting.

The new MVP is a single-image, top-to-bottom visual timeline. The first screen is only a user scene request input plus a settings entry point. LangGraph owns workflow orchestration, dependency tracking, stale downstream regeneration, and the stop-at-generation confirmation gate. `T10` should create the durable timeline project/autosave contract before `T11` adds workflow project management UI comparable to the editor.

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
| T10 | #47 | Persist Agent timeline project state across Run and Settings navigation | Agent Timeline MVP | In Progress | PASS | APPROVE | Priority first. Defines durable active timeline workflow autosave so node outputs, manual edits, stale/error statuses, selected resources/parameters, generation gate state, and result references survive expected Run/Settings navigation. PR #48: https://github.com/Xingqi-Chen/SceneForge/pull/48 |
| T11 | #49 | Add workflow project management UI comparable to editor | Agent Timeline MVP | In Progress | PASS | APPROVE | Depends on T10 / PR #48. Adds timeline workflow project list/open/save/rename/delete affordances comparable to editor project management after durable timeline storage exists. PR #50: https://github.com/Xingqi-Chen/SceneForge/pull/50 |

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
