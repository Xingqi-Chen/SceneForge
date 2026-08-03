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
- An independent Anime or Photoreal visual-style selector, defaulting to Anime.
- An AI Suggest action that, when the input is empty, selects from six complete LLM-authored concepts using recent local concept diversity rather than repeatedly returning the same archetype.
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
12. Paired Preview/Final Vision review and local recommendation.
13. Optional one-shot local Final repair and verification.
14. User-selected result display.

The timeline stops at the start image generation gate. ComfyUI execution starts only after the user clicks the confirmation control.

## User Control

Every timeline node must allow user intervention:

- Scene prompt can be edited.
- Character tags can be manually added, removed, and bound to the character or body parts.
- The 3D canvas can be manually dragged and adjusted.
- Checkpoint and LoRA selections can be changed from a visible local candidate UI.
- Generation parameters can be edited with the same style of controls used by the original ComfyUI configuration UI.
- Anime or Photoreal is selected independently from the Illustrious, Anima, or Krea 2 prompt profile. Changing visual style preserves explicit checkpoints, LoRAs, saved parameters, Detailers, source images, and style references; the selector never silently switches profile or removes resources.
- SceneForge compiles the selected visual domain into the profile's structured visual-style/medium position rather than appending loose keywords. Photoreal targets live-action photography or film and excludes illustrated rendering; Anime targets Japanese anime illustration and excludes live-action photography. Conflicting LLM style content falls back as one whole style section without deleting unrelated prompt text.
- Explicit Run resources bypass AI resource recommendation; saved Run parameters bypass automatic parameter advice, while an unsaved parameter state preserves the automatic path. Krea 2 follows that same shared Style Advice rule: without saved parameters, AI may advise a compatible resolution, negative-prompt additions, selected-LoRA weights, and user-facing rationale, but its returned positive prompt is never authoritative. SceneForge continues to render the Krea positive prompt locally and fixes formal planning and Preview at 8 steps, CFG 1, Euler, and simple scheduling. Krea policy v3 resolves Final Conservative to 4 steps/0.12 denoise, Balanced to 4/0.18, and Strong to 6/0.28. The 1024×1024 resolution is only the no-source fallback; Composer source dimensions and denoise retain precedence for Preview, while independent FaceDetailer/HandDetailer settings remain unchanged.
- Krea 2 positive prompts use one cohesive, punctuation-safe natural-language paragraph with distinct responsibilities for subject, environment/background, visual style, lighting, and spatial composition. New Prompt Generation responses require a persisted `environmentAndBackground` section; a missing value may be tolerated only as parser or manual-input robustness, not as a historical compatibility commitment. Ordinary character-and-scene prompts generally aim for roughly 160–240 English words as guidance rather than a hard limit, using known foreground, midground, and background elements to explain scale, atmospheric depth, and subject-background separation without inventing unsupported characters, objects, or other concrete facts. Krea negative suggestions, Illustrious and Anima prompts, sampling, and staged execution remain unchanged.
- Empty-input Run Suggest asks the LLM for six structured, profile-compatible concepts, then locally ranks novelty and completeness against up to 20 installation-level recent concept fingerprints and makes a weighted 50/30/20 choice among the top three. The chosen scene request remains wholly LLM-authored; SceneForge does not assemble it from fingerprint fragments. Nonempty Suggest and Rewrite remain unchanged.
- Run Suggest diversity memory stores only bounded selected and non-selected concept fingerprints, not prompt text, and stays separate from workflow projects, ordinary LLM diagnostic logs, and Civitai search or embedding indexes. Missing or damaged history degrades to stateless Suggest. One bounded response repair is allowed; a surviving set of two or one candidates uses normalized selection, while zero valid candidates leaves the input unchanged for explicit retry.
- FaceDetailer and HandDetailer are controlled only by the user and stay outside AI input.
- One optional global Run style reference is shared across simple and detailed Composer modes. Its analyzed style prompt applies exactly once to every preview and final output, including Krea 2. Illustrious may optionally add the same stored image through IPAdapter. Krea style-image conditioning remains a verified single-image adapter path. Krea2 ReID is always labeled Experimental and upstream-unverified because it is an unofficial community identity workflow; it has no separate Verified setup tier. ReID uses one server-prepared image, pauses the style-image adapter without deleting it, keeps the analyzed style prompt, and restores a compatible style adapter when removed. Metadata-valid Krea diffusion checkpoints and compatible Krea encoders, including FP8 and RedCraft combinations, remain allowed for ReID under that warning while model-difference investigation is deferred. Anima and unknown contexts remain visibly prompt-only.
- Krea2 ReID preprocessing is local and consent-forward. Users compare an upstream head/shoulders face crop with an EXIF-oriented RGB normalized original, see a no-face warning when applicable, make an explicit selection, and acknowledge consent or lawful use. Only the chosen bounded prepared image is retained; the raw upload and alternate preview are transient. ReID candidates use at most 1,048,576 pixels while preserving the exact formal aspect ratio with 16-pixel-aligned axes; for example, a 1024×1536 formal request previews at 832×1248. Its selected seed is rerendered from noise at the formal dimensions through the same upstream-parity conditioning topology, never through the ordinary low-denoise Preview img2img Final. Active ReID is incompatible with a Composer img2img source and pauses FaceDetailer without deleting either setting.
- Every node can ask AI for another suggestion based on user guidance.

Manual intervention is not an escape hatch from the workflow. It is part of the workflow. When a user changes a node, dependent downstream nodes should regenerate and unrelated nodes should remain stable.

Run Composer changes follow the same rule: visual-style edits stale from Scene Prompt, resource edits stale from resource recommendation, while parameter, Detailer, style-reference, source, and output-count edits stale from parameter recommendation. All cancel any prior generation confirmation. Txt2img and img2img use the selected 1-4 delivery count. The original img2img source and denoise apply only to previews; downscaled previews preserve the formal aspect ratio exactly with 8-pixel-aligned axes and no upscaling or stretching. Preview scoring validates every candidate against the selected visual domain. Only matching candidates may be ranked or selected, and fewer than K matches stops recoverably before Final instead of filling from a known mismatch. Before Final, each selected preview is deterministically resized to the confirmed formal dimensions with Lanczos3 and stored as a managed `preview-upscale` PNG. Except for active ReID, Final img2img must use only that artifact. ReID retains the artifact only as a fallback and instead performs a same-seed formal txt2img rerender. Users choose Conservative, Balanced, or Strong Final redraw strength for non-ReID staged generation; Balanced is the default. Illustrious resolves these presets to 0.30/0.40/0.50, while Anima and unknown/default fallback resolve to 0.35/0.45/0.55. A Final-only preset change requires reconfirmation but retains valid previews, scoring, selection, and seeds, and never reuses a Final created under another preset. After complete Final execution, one bounded Vision request compares every Preview/Final pair and validates each Final's visual domain. A mismatched or unverified Final is unavailable, and only its already verified Preview may be delivered; review retry never reruns generation. If the user explicitly enables automatic local repair before confirmation, SceneForge may make one tightly masked attempt per eligible Final for a major or blocking Final-introduced contact or object-count defect. One clear point/box target may receive one compatible SAM2 refinement, while unavailable or invalid SAM2 never broadens the independently validated structured mask. The original Preview and Final remain immutable. Repair must independently pass visual-domain verification before explicit promotion; a mismatched or unverified Repair remains unavailable.

### Krea Final second-pass policy

Krea formal planning and Preview remain 8 steps, CFG 1, Euler, and simple. Prompt-only/style-only Final retains policy v3 with Conservative 4/0.12, Balanced 4/0.18, and Strong 6/0.28. Corrected ReID uses a new confirmation-bound policy: one-megapixel Preview candidates and a selected-seed formal txt2img rerender through the pinned upstream dual-encoder/VAE/Flux topology, with no redraw denoise or Preview img2img source. Repair is always ReID-free. Version-1 ReID descriptors, confirmation, candidates, Finals, and retry state are not migrated or reused; completed images may remain historical and read-only. Closing the corrective gate requires a sanitized live four-seed report for the selected experimental runtime, including candidate identity consistency and any identity change in the formal Final. Structural graph tests alone are insufficient, but the report does not certify or rank checkpoint/encoder combinations. Formal renders above the Preview budget show a 12 GB/offload warning and fail recoverably on memory pressure without silently changing the selected model or resolution.

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
- Visual style does not add a prompt profile, change Story workflows, classify checkpoint or LoRA compatibility, or remove explicit resources.
- Visual-style validation is a fail-closed delivery safeguard, not a guarantee that an image model will produce a particular aesthetic.

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
