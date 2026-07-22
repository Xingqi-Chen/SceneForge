# SceneForge Product Specification

## Product Summary

SceneForge is a visual prompt creation workspace for AI image generation. The near-term MVP is a single-scene, top-to-bottom AI-assisted Run timeline: the user enters one scene request, then SceneForge uses existing LLM and generation modules to infer scene prompt text, character tags, character action, 3D canvas binding, checkpoint/LoRA selection, and generation parameters. A text-to-image Run may produce one to four outputs from that shared scene request; an image-to-image Run produces one output.

The timeline is not a hidden automation script. Every node exposes its result, lets the user intervene, and can call AI again with the user's correction. The workflow stops at the "start image generation" gate until the user explicitly confirms.

## Target Users

- AI image creators who want a guided path from a natural-language scene idea to a structured generation request.
- Illustrators, concept artists, storyboard artists, and comic creators who need editable visual control before generation.
- Local ComfyUI users who maintain checkpoint, LoRA, prompt, and generation settings.
- Users who prefer visual timeline checkpoints over a single opaque prompt box.

## Core User Value

- Start from one scene request instead of assembling prompt, model, pose, and parameters manually.
- Inspect and edit each intermediate step before image generation.
- Bind AI-inferred character tags and action to the existing 3D canvas so visual edits remain possible.
- Reuse existing local Civitai resources and ComfyUI parameters instead of accepting unavailable model names invented by an LLM.
- Keep local-first workflows private by default, with explicit configuration for external services.

## Current Product Surface

SceneForge currently includes reusable capabilities that the timeline MVP should compose:

- Main editor shell, panels, 2D canvas, 3D viewport, prompt panels, and Zustand editor state.
- 3D stick-figure character controls, pose presets, and prompt export support.
- Prompt library and prompt binding workflows for scene, object, character, and body-part targets.
- Local project save/load through Next.js API routes backed by local disk storage.
- LiteLLM-compatible chat support for AI-assisted prompt and recommendation flows.
- ComfyUI workflow generation, generated image history, inpainting, sequence references, control image helpers, and diagnostic helpers.
- Civitai resource discovery, selected checkpoints/LoRAs, import image parsing, download support, cache repair, and recommendation helpers.
- Artist string library resources and selection.
- Tavily-backed web context for ComfyUI diagnosis when configured.

The old standalone Agent draft PR and Issue were rejected. The new MVP should not add a parallel draft-only surface that bypasses 3D binding, timeline dependencies, or LangGraph orchestration.

## MVP Definition

The MVP is a single-scene Run workflow with these boundaries:

- Initial screen: only a scene request input, a start button, and a settings entry point.
- Workflow display: a vertical timeline of nodes from top to bottom.
- Generation scope: one scene request at a time, with one to four final outputs for text-to-image or image-to-image.
- Character scope: one primary character in the 3D canvas. Additional people in the input may be represented as prompt or scene context until a later multi-character track.
- Orchestration: LangGraph owns node execution, dependency edges, parallelism, stale downstream regeneration, and errors.
- LLM access: reuse existing LLM interfaces through graph-friendly adapters; do not add a bespoke LLM path unless an existing interface cannot support the node.
- Generation gate: timeline must stop before ComfyUI execution until the user clicks start image generation.
- Settings: path settings, NSFW, and integration status belong in a settings page, not in the main workflow.

## Timeline User Flow

1. User opens the MVP entry point.
2. User sees a single scene input and settings entry point.
3. User enters a scene description, for example: "rainy cyberpunk street, one girl holding an umbrella and looking back at the camera".
4. SceneForge starts a LangGraph workflow and expands the vertical timeline.
5. The graph generates scene prompt suggestions.
6. The graph infers character tags and binds them to the primary character and body parts.
7. The graph infers the character action and produces a 3D pose suggestion.
8. SceneForge binds scene prompt, character tags, and pose to the 3D canvas.
9. The graph recommends checkpoint and LoRAs from local Civitai candidates.
10. The graph recommends generation parameters.
11. Timeline stops at the start image generation gate.
12. User reviews or edits any node.
13. If the user edits a node, dependent downstream nodes become stale and regenerate; unrelated nodes remain unchanged.
14. User clicks start image generation.
15. SceneForge calls the existing Run ComfyUI path and advances to execution and result nodes for the configured output count.

## Run Scene Composer Generation Controls

Simple and detailed Run modes use the same Scene Composer state and controls. Switching display modes must not create a second settings source or discard the current scene request, output count, source image, explicit style resources, saved generation parameters, Detailer settings, or global style reference.

Run generation controls follow these rules:

- Checkpoint and LoRA selection is optional and limited to ready local resources. Explicit selections must be validated for resource type, availability, prompt profile or base model, and LoRA compatibility.
- When the user explicitly selects a checkpoint, that checkpoint and its enabled compatible LoRAs become the manual `resource-recommendation` result. The resource recommendation LLM is not called. Without an explicit checkpoint, Run retains the existing AI resource recommendation path.
- The Parameters dialog is available only after an explicit checkpoint is selected. It exposes supported ComfyUI generation settings and user-triggered AI Style Advice for the selected resources.
- Saved parameters become the manual `parameter-recommendation` result and bypass automatic parameter advice. If the user does not save parameters, Run retains the existing AI parameter recommendation path.
- Changing checkpoint or LoRA selection clears saved parameters and prior AI Style Advice so advice and settings cannot silently survive a different resource context.
- FaceDetailer and HandDetailer are independent user-controlled settings. They do not require resource or parameter selection, may be enabled separately, and AI must not enable, disable, recommend, or modify either Detailer.
- Enabled Detailer settings are visible in the generation request preview and confirmation summary and are applied to the confirmed Run request.
- One optional PNG/JPEG/WEBP style reference is stored through the safe sequence-reference boundary and analyzed into one opaque base-model-compatible `stylePrompt`. The segment is appended exactly once after resource-aware formatting for preview, regeneration, restore, and confirmed execution.
- Illustrious-capable checkpoints always keep the style prompt and may additionally enable sequence-style IPAdapter with normalized `weight/start_at/end_at` defaults of `0.45/0/1`, values in `0..1`, and `start_at <= end_at`. Anima, unknown, and unsupported contexts are visibly prompt-only and must not receive hidden adapter nodes.
- Pending, failed, invalid, or context-mismatched references block start, regeneration, and confirmation without queueing ComfyUI. Retry/reanalysis, replacement, and removal remain available.

After a workflow has started, these Composer settings remain editable. Resource changes mark `resource-recommendation` and its downstream nodes stale. Parameter, Detailer, or style-reference changes mark `parameter-recommendation` and its downstream nodes stale. Either change cancels the existing generation confirmation, preserves unrelated prompt, character-tag, pose, and canvas results, and must not call ComfyUI until the user confirms the regenerated request again.

Output precedence is explicit:

- Text-to-image Run keeps the Composer output count of one to four, and its selected resources, parameters, and Detailers apply to every output in that Run.
- Attaching an image-to-image source forces the output count to one and uses the source image dimensions.
- The Composer source-image denoise value overrides saved parameter denoise for image-to-image generation. Other compatible saved parameters remain effective.
- A saved parameter payload must not override the Composer output count.

Active autosave and named workflows persist the normalized explicit resource ids, supported saved parameters, Detailer settings, and sanitized style-reference metadata/analysis/context/status/settings needed to restore the Composer. Style-reference records never persist bytes, base64/data URLs, secrets, unsafe paths, or full resource collections. Restored legacy Run workflows that lack these settings keep the automatic resource and parameter recommendation paths, default both Detailers to disabled, and restore no reference. Restoring a stale or previously confirmed workflow must not automatically submit a generation request.

## Timeline Nodes

| Node | Inputs | Outputs | Dependencies | User Intervention | AI Re-entry |
| --- | --- | --- | --- | --- | --- |
| Scene input | User scene request | Workflow id, raw intent, settings snapshot | None | Edit input and restart workflow | Optional AI rewrite of input without mutating old downstream results |
| Scene prompt | Raw intent, settings | Positive scene prompt, negative suggestions, style, camera, lighting | Scene input | Edit prompt sections | Re-run scene prompt node with user guidance |
| Character tags | Raw intent, scene prompt | Primary character description, body-part tags, clothing, expression | Scene prompt | Add, remove, or bind tags manually | Re-run character tag node with user guidance |
| Character action | Raw intent, character tags, current pose | Action description and 3D pose targets | Character tags | Edit action text or choose a pose preset | Re-run action/pose node with user guidance |
| 3D canvas binding | Scene prompt, tags, pose | 3D scene entities, primary skeleton, spatial summary | Scene prompt, character tags, character action | Drag character, camera, and simple scene objects | Re-run pose or spatial suggestion using the current canvas |
| Checkpoint and LoRA | Prompt data, tags, action, NSFW setting, local Civitai candidates | Selected checkpoint, LoRAs, reasons, suggested weights | Scene prompt, character tags, character action, settings/resources | Re-select checkpoint or LoRAs from local candidate UI | Re-run recommendation with style/model preference |
| Generation parameters | Prompt draft, selected resources, settings | Width, height, steps, cfg, sampler, scheduler, denoise, seed policy, negative additions | Checkpoint and LoRA, prompt data, canvas summary | Edit parameters with existing controls | Re-run parameter node with quality/speed/aspect guidance |
| Start image generation | Prompt, resources, parameters, canvas summary | Confirmed ComfyUI request preview | Previous nodes done or manual | Click start image generation | AI may explain risk or suggest final adjustment, but must not call ComfyUI |
| Preview execution | Confirmed request | Four to eight low-cost candidate references and seeds | Start image generation confirmation | Retry the preview round | Retain successful safe references when fewer than K complete |
| Preview scoring | Successful previews | Fixed-rubric scores, ranking, and Top-K selection | At least K previews | Retry scoring or manually choose exactly K in Detailed mode | Send one safe schema-repair retry, then fail closed |
| ComfyUI execution | Selected previews | One managed formal-size Preview fallback and one independent second-pass result per selection | Preview scoring | Retry missing or failed fallback/Final work | Preserve valid fallbacks and successful Finals across retry |
| Final review | Completed managed Preview/Final pairs | Five-dimensional scores, four consistency findings, and local recommendation/default | ComfyUI execution | Retry review or select Final/Preview per pair | One bounded comparative Vision request; selection is local only |
| Result display | Completed managed variants and selection | One to four selected images, metadata, and candidate linkage | Final review, including safe review-failure result | Select variant, save, copy prompt, or return upstream | Selection autosaves without AI or generation |

## Dependency and Regeneration Rules

- Each node has explicit dependencies in LangGraph.
- Nodes with no dependency relation may run in parallel.
- A node can run only after all required dependencies are `done` or `manual`.
- Node statuses should include `blocked`, `ready`, `running`, `done`, `stale`, `error`, and `manual`.
- User edits mark the edited node as `manual`.
- Downstream nodes that depend on the edited node become `stale`.
- Stale dependent nodes regenerate automatically once their dependencies are valid.
- Nodes outside the dependency closure of an edit preserve their current result.
- The UI renders graph state and sends user actions; it must not manually chain LLM calls outside LangGraph.

## Settings Page

The MVP needs a settings page or settings route that keeps the main workflow clean.

Required setting areas:

- NSFW mode.
- Local path settings for generated images, project storage, prompt library, ComfyUI temp directory, and Civitai resource paths where applicable.
- ComfyUI connection status.
- Civitai resource index/status.
- LiteLLM configuration status.

Security expectations:

- API keys and secrets remain server-only in `.env.local` unless a future scoped issue explicitly introduces secure runtime secret editing.
- The settings page may display whether required environment variables are configured, but must not echo secret values.
- Path updates must validate absolute paths, reject traversal, and avoid writing outside configured roots.

## Timeline Persistence and Project Management

Timeline runtime state is durable for the active workflow once the persistence/autosave track is implemented. The active workflow record saves and restores a timeline workflow across expected Run and Settings navigation, including node outputs, manual edits, stale/error statuses, selected resources and parameters, generation gate state, execution metadata, result references, selected node, and display mode. Interrupted `running` nodes must restore as visible recoverable errors rather than pretending that background work continued reliably.

Run workflow persistence also restores Scene Composer output count, source-image settings, explicit style resources, supported saved generation parameters, and FaceDetailer/HandDetailer settings. Records without the newer resource, parameter, or Detailer snapshot fields remain valid; they use automatic recommendations and restore both Detailers disabled. Persisted settings must be sanitized and must not include full resource candidate collections, secrets, logs, downloaded resources, or generated image bytes.

Workflow project management UI is a separate follow-up track. It should provide project list/open/save/rename/delete affordances comparable to the editor only after timeline workflow persistence exists. The persistence track owns the durable data contract; the project management UI track owns user-facing organization and navigation around saved workflow projects.

## Non-goals for MVP

- Multiple independent scene requests or arbitrary multi-scene batch queues.
- Comic sequence generation.
- Inpainting.
- ControlNet.
- Upscaling.
- Full ComfyUI node graph editing.
- Multi-character pose synchronization.
- Cloud identity, billing, collaboration, or remote project sync.
- A hosted model or asset marketplace.

## Acceptance Criteria

- A new user can start the MVP from one scene input.
- The timeline is shown vertically from top to bottom after submission.
- Each timeline node shows status, output, user edit controls, and an AI suggestion/retry affordance.
- Scene prompt text is editable.
- Character tags can be manually bound to the primary character or body parts.
- 3D canvas pose and placement can be manually adjusted.
- Checkpoint and LoRA selection is made from local candidates and can be changed through a visible resource-selection UI.
- Generation parameters use existing ComfyUI-style controls and can be manually edited.
- LangGraph drives node execution, dependencies, stale state, and regeneration.
- Timeline stops before ComfyUI execution until explicit user confirmation.
- Clicking start image generation authorizes preview generation, structured scoring, and the selected second-pass renders; it displays one to four final results for txt2img or img2img.
- Simple and detailed Run modes edit the same Scene Composer resource, parameter, and Detailer settings.
- Explicit ready local resources bypass AI resource recommendation; saved parameters require a checkpoint and bypass AI parameter recommendation; absent manual settings preserve the existing AI paths.
- FaceDetailer and HandDetailer remain independent user controls, are not controlled by AI, and default disabled for legacy workflow records.
- Post-start resource edits stale from `resource-recommendation`; parameter or Detailer edits stale from `parameter-recommendation`; both reset generation confirmation without invalidating unrelated prompt, tag, pose, or canvas results.
- Final output count remains one to four for both text-to-image and image-to-image. K maps to 4/4/6/8 previews; an image-to-image source takes precedence for preview dimensions and denoise.

### Run preview selection

- Preview requests use batch size 1, Detailers disabled, and model-family Balanced settings with `min(formal steps, 20)` for every Run profile. Inputs above longest-edge 768 are reduced to the largest exact-formal-aspect dimensions that fit the limit and align both axes to 8 pixels; axes are never rounded independently or stretched. Inputs already within the limit remain unchanged and are never upscaled. An extreme ratio with no exact 8-pixel-aligned downscale inside the limit fails with an actionable validation error. Initial fixed-seed execution starts at the formal seed; retrying preview execution advances from the retained base seed by the candidate count with safe maximum-seed wraparound, so consecutive retries use non-overlapping windows. Random policy always materializes a fresh base seed.
- High-detail Vision scoring compares every successful current-round preview in one request. All 4/6/8 candidates stay in that single comparative request, but each managed preview is transcoded only in memory to a quality-85 JPEG with longest edge at most 768 for provider-compatible bounded payloads; this never replaces or persists over the preview used by final rendering. The model returns defect-category strings; SceneForge derives eligibility locally, accepts finite 0-100 numeric strings, and normalizes only case/space/hyphen variants that map exactly to an allowed category. Missing or unknown defects and incomplete candidate coverage still fail closed. Blocking eligibility is rare and limited to major anatomy/structural failure that makes the render unusable, unmistakable physical impossibility/contradiction that makes it unusable, or catastrophic exposure/technical corruption. Missing prompt details, prop/contact omissions, character appearance mismatch, gaze/action mismatch, and subject scale/framing mismatch normally reduce adherence, composition, style, or technical scores instead of blocking; supported soft categories remain visible as annotations. Candidates retain the fixed scene-adherence, composition, anatomy/structure, style/identity, and technical-quality weights of 30/25/20/15/10 percent.
- A malformed first scoring response receives one bounded schema-repair instruction containing only a safe validation reason. Final error details distinguish malformed schema from upstream failure and never include raw responses, prompts, image data, or secrets.
- AI Top-K ranks eligible candidates first, followed by ineligible candidates using the same weighted total, composition, and stable candidate order. If fewer than K are eligible, the exact Top-K is filled with the highest-ranked annotated fallback candidates and scoring persists safe `eligibleCount`, `fallbackCandidateIds`, and a visible warning instead of ending the workflow. Detailed-mode manual reselection accepts any exact-K successful scored candidates, including an explicit annotated fallback; rubric-v1 remains read-only.
- Ordinary scoring uses the Vision model with default fallback. NSFW scoring requires the multimodal NSFW model and must never fall back to an ordinary model.
- Each selected Top-K managed Preview is first resized server-side with deterministic Lanczos3 to the exact confirmed formal dimensions, without crop, padding, independent-axis rounding, or stretch. An incompatible legacy aspect ratio fails recoverably before ComfyUI queueing. The candidate-linked managed `preview-upscale` is retained as an accessible fallback and is the sole img2img source for that candidate's Final.
- Finals preserve the candidate seed, formal dimensions/steps/CFG/sampler/scheduler, checkpoint/LoRAs, prompts, style/IPAdapter context, and enabled Hand-before-Face Detailers. The shared Simple/Detailed Composer exposes Final redraw strength after the parameter summary and before Detailers. Conservative resolves to 0.30 for Illustrious and 0.35 for Anima/fallback; default Balanced resolves to 0.40/0.45; Strong resolves to 0.50/0.55 and visibly warns about anatomy, structure, and object drift. The preset does not change source denoise or parameter-recommendation state. A fresh Final whose managed content hash is unchanged from its `preview-upscale` fallback is a recoverable failure. Detailed mode may override the selection with exactly K successful candidates.
- The versioned deterministic-resize and preset/family/denoise policy is part of the signed confirmation contract and Final execution metadata. Missing or altered policy confirmation blocks new execution. Changing only the preset cancels confirmation, stales only Final execution/result display when valid Preview/scoring state exists, retains the Preview pool, scoring selection, and seeds, and resumes at Final after reconfirmation. Same-preset partial retry retains valid candidate fallbacks and successful Finals; cross-preset retry never reuses an old Final. Completed policy-v1 results remain read-only displayable, while incomplete or confirmed policy-v1 Runs require reconfirmation.
- Run definition v3 orders `comfyui-execution -> final-review -> result-display`. One high-detail request covers all 1-4 complete pairs. Each pair contains finite five-dimensional scores and exactly one closed-contract finding for pose, contact, object count, and composition consistency. SceneForge ignores model-authored eligibility or recommendation values and locally selects `preview-upscale` only for a major/blocking issue introduced by Final; otherwise it selects Final.
- Final-review failures persist a safe actionable unavailable status, retain both managed variants, and allow review-only retry. Simple and Detailed modes expose the same Final/Preview selector; an explicit choice overrides the local default, autosaves/restores, and never stales or reruns generation. Old completed workflows remain visible without automatic review calls and expose only stored variants that exist.
- Settings are outside the main workflow and include NSFW plus required path/integration configuration.
- After the scoped persistence/autosave track lands, timeline workflow state survives expected Run and Settings navigation according to its durable storage contract.
- After the follow-up project management track lands, saved timeline workflow projects can be found and managed through visible project management UI comparable to the editor.

## Product Constraints for Agents

- `product-agent` owns product scope, Track definition, issue-ready acceptance criteria, and planning notes.
- The Orchestrator owns GitHub Issue creation, tracker updates, cross-agent handoff, automatic commit/push/PR creation after gates pass, and post-merge Issue/branch cleanup after a user-approved merge.
- `dev-agent` owns implementation and documentation updates for technical or user-visible changes within the assigned Issue or approved local-only Track.
- `tester-agent` owns test coverage and validation reports, not production fixes.
- `reviewer-agent` is read-only by default and must lead with blocking issues.
- Timeline workflow work must preserve the LangGraph boundary. If implementation starts hand-coding node order in a React component or API route, it is out of scope.

## Open Product Questions

- Should MVP strictly limit to one primary character, or allow multiple characters as separate later timeline branches?
- Should settings allow editing LiteLLM and ComfyUI API keys, or only show server-side configuration status?
- Should persisted timeline result references also bind to the legacy editor project generated-image history, or stay in workflow-project history only?
- Should the legacy full editor remain the default route while the timeline MVP is built under a new route, or should timeline become the default entry after T4?

## Story Graph Planning Workspaces

Story Graph planning builds on the shared workflow definition primitives rather than the old editor sequence implementation. The `/story` surface now starts from user input and creates a durable `story-graph` planning workflow with typed `StoryInput` data, including the story request, optional target shot count, settings-derived audience rating and NSFW context, and settings snapshot. Users can ask AI to suggest or rewrite the story request before starting planning; when shots are left blank, AI chooses the target shot count during planning start. It provides dedicated inspection and manual-edit workspaces for storyboard shots, story safety, shot dependency graph, plot state graph, and character continuity graph. The shot dependency graph is for executable source-image dependencies only: edges should mean the target shot receives the source shot's generated image through img2img/source-image execution. Same character, same location, or story continuity alone does not imply source-image inheritance. Story render planning uses structured `locationContinuity.mode` values: `prompt-only`, `source-image`, and `inpaint-preferred`. Only `source-image` is executable and passes a source shot to execution planning. `inpaint-preferred` is advisory in v1 and must not trigger automatic mask, repair, or inpaint execution. Ordinary story order without visual inheritance, prompt-only continuity, and non-executing references belong in shot notes, plot state, character continuity, or render-plan reference recipes instead of dependency graph edges. Step output defaults to compact node summaries for the 15 Story nodes, while Raw JSON remains available for debugging and full artifact inspection. Shared story-scoped resource, parameter, render, generation gate, execution, and result nodes use common raw JSON/manual edit controls until later tracks define execution-specific story controls.

Manual story edits must record whether the edited artifact is story-scoped or shot-scoped. Shot dependency edits also record downstream shot ids from the Story Graph shot DAG so execution can regenerate only affected shot branches. The shot execution scheduler plans source-aware execution, keeps independent shots parallel-ready, blocks dependents when source results fail or are unavailable, and marks selected-shot downstream branches stale for scoped regeneration. Story Graph workflow records autosave and restore through the shared local workflow persistence APIs, preserving planning artifacts, selected node, selected shot, display modes, gate state, shot execution statuses, preview references, and final references while keeping generated bytes, secrets, caches, logs, downloaded models, and local resource databases out of the JSON record.

## Story Reference Workflow Planning Contract

Story Reference Workflow extends `story-graph` for Anima-compatible multi-shot stories to plan, generate, review, and use explicit visual reference plates before final shot generation. It is not a first-image-crop workflow: references are system-generated plates, approved uploads, or explicit prompt-only fallbacks. V1 uses structured LLM outputs plus local validation, not local string recognition, image cropping, or first-shot crop extraction.

V1 excludes consistency scoring, ControlNet, pose or depth control, automatic mask generation, and automatic inpaint execution. Pose and composition remain prompt-controlled. Same-location continuity is a render-plan decision, not a dependency shortcut.

Default reference planning rules:

- Main character face/bust identity references are required by default.
- High-frequency or story-critical outfit references are planned by default.
- Prop and location references are visible as optional or planned anchors by default and are not injected into final full-image generation by default.
- One generated candidate is created per reference plate by default.

Reference review must give users visible control over each plate. Users can approve, reroll, upload, reject optional references, edit the canonical prompt and regenerate, or explicitly choose prompt-only fallback. Required references block final story generation until approved, uploaded and approved, generated and approved, or explicitly set to prompt-only fallback. Prompt-only fallback is a visible user decision, never a silent degradation.

Reference importance is separate from resolution state. Importance values are `required`, `recommended`, and `optional`. Resolution states are `missing`, `generated`, `uploaded`, `approved`, `failed`, `rejected`, and `prompt-only`. `generated` and `uploaded` still require approval before satisfying a required reference.

Approved character identity and outfit references may be used for final Anima execution only when the selected workflow supports the required reference nodes. When Anima IPAdapter nodes or required reference nodes are unavailable, Story execution visibly degrades to prompt-only with install guidance. Missing IPAdapter support must not silently omit references, fail without explanation, or block unrelated prompt-only generation.

Product-surface implications:

- Client UI must expose reference plans, importance, resolution state, previews where available, canonical prompts, rationale, and review actions.
- Prompt output must retain prompt-only continuity and fallback decisions explicitly rather than inferring hidden image inheritance.
- Persistence must save reference artifact metadata, approval states, prompt-only fallback decisions, render recipes, and continuity modes without storing generated bytes, secrets, caches, logs, local model data, or downloaded assets.
- Generated assets are reference plates or user-approved uploads tracked by metadata; final-shot generation must not crop references from earlier story outputs.
- External integration behavior is limited to Anima-compatible ComfyUI reference support in v1, with visible prompt-only degradation when required nodes are unavailable.
