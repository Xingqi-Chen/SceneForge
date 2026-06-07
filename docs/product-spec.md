# SceneForge Product Specification

## Product Summary

SceneForge is a visual prompt creation workspace for AI image generation. The near-term MVP is a single-image, top-to-bottom AI-assisted timeline: the user enters one scene request, then SceneForge uses existing LLM and generation modules to infer scene prompt text, character tags, character action, 3D canvas binding, checkpoint/LoRA selection, and generation parameters.

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

The MVP is a single-image workflow with these boundaries:

- Initial screen: only a scene request input, a start button, and a settings entry point.
- Workflow display: a vertical timeline of nodes from top to bottom.
- Generation scope: one image request at a time.
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
15. SceneForge calls the existing single-image ComfyUI path and advances to execution and result nodes.

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
| ComfyUI execution | Confirmed request | Queue metadata, execution status | Start image generation confirmation | Retry or cancel where supported | Existing diagnosis helpers on failure |
| Result display | ComfyUI output | Single image, metadata, reusable prompt and parameters | ComfyUI execution | Save, copy prompt, or return to upstream nodes | Use result feedback to re-enter upstream nodes |

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

Workflow project management UI is a separate follow-up track. It should provide project list/open/save/rename/delete affordances comparable to the editor only after timeline workflow persistence exists. The persistence track owns the durable data contract; the project management UI track owns user-facing organization and navigation around saved workflow projects.

## Non-goals for MVP

- Multi-image batch generation.
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
- Clicking start image generation advances to single-image ComfyUI execution and result display.
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
