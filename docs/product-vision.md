# SceneForge Product Vision

## Vision

SceneForge turns AI image prompting into a visible, editable production workflow. Users should not need to trust one opaque prompt box. They should be able to see how a scene idea becomes prompt text, character attributes, pose, model resources, generation parameters, and finally an image.

The product direction is a visual semantic editor for AI image generation:

- The user expresses an image goal in natural language.
- AI helps infer structured scene data.
- The user can inspect and correct each intermediate result.
- Visual controls, especially the 3D canvas, remain available for manual control.
- Image generation happens only after explicit user confirmation.

## MVP Direction

The current MVP is a single-scene, top-to-bottom timeline driven by LangGraph. Text-to-image and img2img Runs both deliver 1-4 outputs selected from scored low-cost previews.

The first screen contains:

- A scene request input.
- Optional ready local checkpoint and LoRA selection.
- Optional saved generation parameters with user-triggered AI Style Advice.
- Independent FaceDetailer and HandDetailer controls.
- A start button.
- A settings entry point.

After the user submits the request, SceneForge expands a vertical timeline. Each node shows its status, AI result, manual controls, and an AI retry/suggestion affordance.

The MVP supports one primary character in the 3D canvas. Multi-character composition, sequence generation, inpainting, ControlNet, and learned or generative upscaling are later work.

## Timeline Workflow

The MVP workflow is:

1. Scene input.
2. Scene prompt inference.
3. Character tag inference.
4. Character action and pose inference.
5. 3D canvas binding.
6. Checkpoint and LoRA recommendation.
7. Generation parameter recommendation.
8. Start image generation gate.
9. Low-cost preview execution.
10. Structured Vision scoring and Top-K selection.
11. Full-quality img2img second-pass execution.
12. Result display.

The timeline stops at the start image generation gate. ComfyUI execution starts only after the user clicks the confirmation control.

## User Control

Every timeline node must allow user intervention:

- Scene prompt can be edited.
- Character tags can be manually added, removed, and bound to the character or body parts.
- The 3D canvas can be manually dragged and adjusted.
- Checkpoint and LoRA selections can be changed from a visible local candidate UI.
- Generation parameters can be edited with the same style of controls used by the original ComfyUI configuration UI.
- Explicit Run resources bypass AI resource recommendation; saved Run parameters bypass automatic parameter advice, while an unsaved parameter state preserves the automatic path.
- FaceDetailer and HandDetailer are controlled only by the user and stay outside AI input.
- One optional global Run style reference is shared across simple and detailed Composer modes. Its analyzed style prompt applies to every preview and final output; Illustrious may optionally add the same stored image through IPAdapter, while Anima and unsupported contexts remain prompt-only.
- Every node can ask AI for another suggestion based on user guidance.

Manual intervention is not an escape hatch from the workflow. It is part of the workflow. When a user changes a node, dependent downstream nodes should regenerate and unrelated nodes should remain stable.

Run Composer changes follow the same rule: resource edits stale from resource recommendation, while parameter, Detailer, style-reference, source, and output-count edits stale from parameter recommendation. All cancel any prior generation confirmation. Txt2img and img2img use the selected 1-4 delivery count. The original img2img source and denoise apply only to previews; downscaled previews preserve the formal aspect ratio exactly with 8-pixel-aligned axes and no upscaling or stretching. Before Final, each selected preview is deterministically resized to the confirmed formal dimensions with Lanczos3 and stored as a managed `preview-upscale` PNG. Final img2img must use only that artifact, with denoise 0.30 for Illustrious and 0.35 for Anima or unknown/default fallback. The deterministic artifact remains available when Final fails or only partially completes, but the UI keeps completed Final images as the default result and does not automatically choose a fallback.

## Orchestration Principle

LangGraph is the orchestration layer for the MVP. It owns:

- Node dependencies.
- Parallel execution where dependencies allow it.
- Node statuses.
- Downstream stale state.
- Regeneration after manual edits.
- The stop-before-generation gate.

React components render graph state. API routes expose graph actions. Neither should implement a separate hand-written chain of LLM calls.

## Reuse Principle

SceneForge already has useful modules for the MVP:

- LiteLLM chat gateway.
- Prompt generation and prompt-library helpers.
- Stick-figure pose generation.
- 3D canvas and skeleton controls.
- Civitai checkpoint and LoRA recommendation.
- ComfyUI parameter controls and workflow builders.
- Generated image storage.

The MVP should wrap these capabilities as LangGraph node adapters before adding new APIs. New LLM calls are allowed only when the existing interface cannot express a required node.

## Settings Principle

The main workflow should stay visually simple. Configuration belongs in a settings page:

- NSFW mode.
- Local storage paths.
- ComfyUI path and connection status.
- Civitai paths and resource index status.
- LiteLLM configuration status.

Secrets should remain server-only unless a later scoped issue introduces secure runtime secret editing.

## Non-goals

The MVP does not include:

- Multi-image batch generation.
- Comic sequence generation.
- Inpainting.
- ControlNet.
- Upscaling.
- Full ComfyUI node graph editing.
- Multi-character pose synchronization.
- Cloud accounts, collaboration, billing, or hosted sync.

## Success Criteria

The MVP is successful when a user can:

- Start from one scene description.
- Watch the timeline produce structured prompt, character, pose, resource, and parameter nodes.
- Edit any node without losing unrelated work.
- See dependent downstream nodes update automatically.
- Confirm generation only after reviewing the final request.
- Generate one image through the existing ComfyUI path.

## Later Direction

After the MVP is stable, SceneForge can expand in these directions:

- Multiple characters and dependency branches.
- Persistent timeline history and replay.
- Advanced 3D pose editing and IK.
- Inpainting and ControlNet nodes.
- Comic sequence and storyboard timelines.
- Result-to-prompt feedback loops.
- Template and preset libraries for common workflows.
