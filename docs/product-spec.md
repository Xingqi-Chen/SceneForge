# SceneForge Product Specification

## Product Summary

SceneForge is a visual prompt creation workspace for AI image generation. Instead of writing a long prompt from a blank text area, users compose a scene with objects, characters, poses, local prompt tags, style references, and generation settings. SceneForge turns that structured scene into editable prompts and can send the result to local or connected generation workflows such as ComfyUI.

The product vision is defined in `docs/product-vision.md`. This document captures the current implementation-aligned product contract for development and agent work.

## Target Users

- AI image creators who want structured scene composition before generation.
- Illustrators, concept artists, storyboard artists, and comic creators.
- Users who prefer visual editing over raw prompt writing.
- Users maintaining local prompt libraries, LoRA selections, and ComfyUI generation settings.
- Advanced local-workflow users who want prompt, model, image, and sequence state in one workspace.

## Core User Value

- Build prompts by arranging visible scene data instead of remembering prompt syntax.
- Keep prompt tags attached to meaningful targets: scene, object, character, or body part.
- Reuse local prompt library entries and selected resources across projects.
- Move between prompt preview, image generation, inpainting, sequence references, and project persistence without losing context.
- Keep local-first workflows private by default, with explicit environment configuration for external services.

## Current Product Surface

SceneForge currently includes these major surfaces:

- Main editor shell with left asset/prompt panels, central canvas/viewport, and right-side property, prompt, image generation, and export panels.
- 2D scene editing with scene objects, characters, selection, multi-selection, object transforms, prompt tags, and prompt preview.
- 3D scene mode with primitive placement, camera/grid lighting configuration, 3D stick-figure character controls, pose presets, and prompt export support.
- Prompt library and prompt binding workflows for scene, object, character, and body-part targets.
- Local project save/load through Next.js API routes backed by local disk storage.
- LiteLLM-compatible chat support for AI-assisted prompt and recommendation flows.
- Standalone Agent draft page for editable single-image prompt drafts before any confirmed generation call.
- ComfyUI workflow generation, generated image history, inpainting, sequence references, control image helpers, and diagnostic helpers.
- Civitai resource discovery, selected checkpoints/LoRAs, import image parsing, download support, cache repair, and recommendation helpers.
- Artist string library resources and selection.
- Tavily-backed web context for ComfyUI diagnosis when configured.

## MVP Boundaries

For near-term work, protect these product boundaries:

- Scene editing and prompt generation are the center of the product.
- Local-first persistence is required; cloud accounts and collaboration are out of scope.
- ComfyUI integration can rely on a user-managed local or proxied ComfyUI server.
- LiteLLM, Tavily, Civitai, and ComfyUI integrations must be optional. The editor should remain usable without those credentials or services.
- Generated images, logs, local projects, prompt libraries, and model caches are runtime data and must not be committed.
- NSFW support is gated by `SCENEFORGE_SHOW_NSFW_BUTTON` and project settings.

## Non-goals

- Multi-user collaboration.
- A hosted commercial asset marketplace.
- Cloud identity, billing, or remote project sync.
- Full 3D DCC modeling capabilities.
- Replacing ComfyUI; SceneForge prepares and sends workflow data but does not become a full node-graph editor.
- Depending on live external APIs for the basic editor experience.

## Primary User Flows

### Create or Load a Project

1. User opens the editor.
2. SceneForge loads the most recent local project if one exists.
3. If no project exists, SceneForge starts from a default project and merges shared prompt library bindings.
4. User can create a new scene, clear the canvas, save, load, export, or import project data.

Acceptance criteria:

- The editor opens without requiring external service configuration.
- Local project loading failure does not prevent the editor from reaching a usable state.
- Project identity, timestamps, settings, scene data, and prompt bindings remain stable through save/load.

### Compose a Scene

1. User adds scene objects or characters from available panels.
2. User selects one or more targets.
3. User edits position, size, rotation, layer, description, prompt tags, and prompt inclusion.
4. User switches between 2D and 3D modes when needed.

Acceptance criteria:

- Scene edits update the Zustand project state through explicit store actions.
- Undo history remains bounded and meaningful for ordinary edits.
- 2D and 3D data do not corrupt each other when switching modes.
- Objects and characters can be excluded from prompt generation.

### Build a Prompt

1. User attaches prompt tags to the scene, objects, characters, and body parts.
2. User chooses prompt model format, spatial hints, negative prompt, artist strings, and resource selections.
3. SceneForge generates a positive prompt and negative prompt preview.
4. User can copy or export the prompt result.

Acceptance criteria:

- Prompt generation is deterministic for the same project state.
- Disabled tags and disabled weights are respected.
- Negative tags are separated from positive prompt content.
- Spatial hints are included only when enabled.
- Model-specific formatting is isolated in prompt-engine helpers.

### Generate or Manage Images

1. User configures ComfyUI connection and generation parameters.
2. User sends prompt data to ComfyUI routes.
3. SceneForge tracks generated image records, favorites, source references, and local saved images.
4. User can use generated or uploaded images as sequence references or inpainting inputs.

Acceptance criteria:

- ComfyUI calls fail with clear user-facing errors when the service is unavailable or misconfigured.
- API routes validate input before building workflows or touching disk.
- Local saved images use configured storage directories and avoid path traversal.
- Generated image history is deduplicated and bounded.

## Product Constraints for Agents

- `product-agent` owns product scope, Track definition, issue-ready acceptance criteria, and planning notes.
- The Orchestrator owns GitHub Issue creation, tracker updates, cross-agent handoff, automatic commit/push/PR creation after gates pass, and post-merge Issue/branch cleanup after a user-approved merge.
- `dev-agent` owns implementation and documentation updates for technical or user-visible changes within the assigned Issue or approved local-only Track.
- `tester-agent` owns test coverage and validation reports, not production fixes.
- `reviewer-agent` is read-only by default and must lead with blocking issues.

When scope is unclear, product clarification should happen before implementation.

## Open Product Questions

- Which workflows should become first-class: single-image generation, comic sequence generation, inpainting, or model-resource curation?
- How much 3D editing should remain in MVP versus later versions?
- Should project files embed generated image records permanently, or should generated images be managed as a separate library?
- What is the expected minimum screen size for the full editor versus tablet drawer layout?
- Which prompt formats beyond generic and Stable Diffusion should be supported next?
