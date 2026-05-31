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
- Should generated results bind to the current project history in MVP, or remain standalone generated-image records?
- Should the legacy full editor remain the default route while the timeline MVP is built under a new route, or should timeline become the default entry after T4?

## Comic Sequence Prompt Architecture Plan (Issue-Ready)

### Problem Statement

Comic Sequence currently copies the current canvas prompt or `activePrompt` almost directly into each shot's Canvas prompt when creating shots. AI storyboard only generates the Manual shot prompt. The final ComfyUI positive prompt is roughly:

`Canvas prompt + reference character prompt + Manual shot prompt`

For Stable Diffusion / Illustrious, the final prompt is also reorganized through the Illustrious section builder. This works for simple one-character sequences with only a few shots, but it breaks down quickly for sequential comics:

- Each shot copies the full canvas prompt, making prompts too heavy.
- Global style, environment, character appearance, action, and camera language are mixed together and can conflict.
- Character traits are repeated across Canvas prompt, reference character prompt, and Manual shot prompt, reducing consistency.
- Multi-character scenes are hard to maintain because the system cannot cleanly express "Shot 1 has only character A, Shot 2 has character A and B."
- Editing a single shot back on the canvas can accidentally overwrite global style, character identity, or hand-written shot instructions.

### User Value

- Users can maintain consistent style, environment, and character definitions across a comic sequence while keeping each shot focused on the local difference.
- Multi-character sequences can explicitly declare which characters appear in each shot, reducing character leakage, missing characters, and duplicated character traits.
- Users can return to the canvas to adjust a shot's composition, local scene, or ControlNet settings without damaging the character library or sequence-level settings.
- AI storyboard output becomes an editable shot structure instead of one overloaded prompt string.
- ComfyUI / Stable Diffusion positive prompts become shorter, more stable, and easier to inspect and debug.

### Goals

- Split Comic Sequence prompts into clear layers: Sequence Style Prompt, Sequence Environment Prompt, Character Reference Prompt, Shot Canvas Prompt, and Manual Shot Prompt.
- Add a sequence-level character library in `characters` and shot-level `castCharacterIds`, then merge only the characters that appear in the current shot.
- Make Character Reference Prompt the source of truth for character appearance and identity.
- Keep Shot Canvas Prompt focused on visible elements, local setting, and composition derived from the current shot canvas.
- Keep Manual Shot Prompt focused on local action, camera, expression, interaction direction, character count, and placement tags.
- Define which fields are automatically updated when a single shot is edited on the canvas, and which fields require explicit user sync.
- Apply the new prompt architecture only to newly created or recreated Comic Sequences; migrating old saved comic sequences is out of scope.

### Non-Goals

- Do not rebuild the full Comic Sequence UI in this plan.
- Do not require complete multi-character 3D pose synchronization in one pass.
- Do not change the LangGraph single-image MVP product direction.
- Do not introduce new image models, remote services, or generation backends.
- Do not require AI storyboard to generate a complete canvas object diff or complex layout graph in the MVP.
- Do not migrate, repair, or preserve compatibility for old `savedComicSequence` data; users can recreate sequences or this can be handled in a separate future task.

### Recommended Data Model

Sequence-level data:

```ts
type ComicSequence = {
  id: string;
  title: string;
  stylePrompt: string;
  environmentPrompt: string;
  characters: ComicCharacter[];
  shots: ComicShot[];
};
```

Character library:

```ts
type ComicCharacter = {
  id: string;
  name: string;
  prompt: string;
  references?: CharacterReference[];
};
```

Character field rules:

- `prompt` is the Character Reference Prompt and is the source of truth for appearance, identity, baseline outfit, and stable traits.
- `references` stores character reference images, reference ids, weights, or other reference metadata.
- Character Reference Prompt should not include action, camera, temporary expression, local scene, or current-shot relative placement.

Shot-level data:

```ts
type ComicShot = {
  id: string;
  title: string;
  castCharacterIds: string[];
  sceneSnapshot: unknown;
  shotCanvasPrompt: string;
  manualShotPrompt: string;
  controlNet?: ShotControlNetSettings;
  references?: ShotReferenceSettings;
};
```

Shot field rules:

- `castCharacterIds` declares which sequence characters actually appear in the current shot.
- `sceneSnapshot` stores the canvas state for the current shot.
- `shotCanvasPrompt` describes visible elements, local setting, composition, foreground/background, props, and spatial relationships derived from the current shot canvas.
- `manualShotPrompt` describes local action, camera, expression, interaction direction, character count, and placement tags, such as `solo`, `2 people`, or `A left, B right`.
- Shot-level `references` stores only references that are unique to the current shot; character references are still merged from `characters` based on the shot cast.

### UI / Workflow

The Sequence editing area should expose these layers:

- Sequence Style: shared art style, medium, rendering language, and sequence-level aesthetic.
- Sequence Environment: stable location, world context, weather, era, and background setting.
- Characters: a character library where each character has a name, Reference Prompt, and references.
- Shots: each shot shows title, cast, Shot Canvas Prompt, Manual Shot Prompt, and reference/ControlNet status.

Recommended interactions:

- When creating a sequence, users should confirm global style/environment and the character library before generating or editing shots.
- Each shot card should provide cast multi-select; characters that are not selected should not participate in prompt merging by default.
- The shot prompt panel should display `shotCanvasPrompt` and `manualShotPrompt` as separate fields or sections, so users are not pushed to write character appearance into shot prompts.
- If the system detects likely full character appearance repeated in a shot prompt, it may suggest moving that text to Character Reference Prompt, but the MVP should not force automatic rewriting.
- When a single shot is opened for canvas editing, the UI should communicate that the user is editing shot-level canvas state, not sequence-level role/style state.

### AI Storyboard Changes

Storyboard currently receives `globalPrompt` as context but only outputs `{ title, prompt }`. The recommended path is staged.

MVP output:

```ts
type StoryboardShotDraft = {
  title: string;
  castCharacterIds: string[];
  shotPrompt: string;
};
```

MVP rules:

- AI can read `globalPrompt`, sequence style, environment, and characters as context.
- AI outputs `castCharacterIds` and `shotPrompt`.
- `shotPrompt` is written into `manualShotPrompt`.
- MVP does not require AI to generate `shotCanvasPrompt` unless a canvas snapshot can be converted reliably.

Future output:

```ts
type StoryboardShotDraftV2 = {
  title: string;
  castCharacterIds: string[];
  canvasPromptPatch?: string;
  shotPrompt: string;
};
```

Future rules:

- `canvasPromptPatch` can be used as a suggestion or patch source for `shotCanvasPrompt`.
- AI should not repeat full character appearance in `shotPrompt`.
- AI should use cast to output character-count and relative-placement tags, such as `solo`, `2 people`, or `A on the left, B on the right`.

### Prompt Merge Rules

Recommended Stable Diffusion / Illustrious positive prompt order:

1. Quality / aesthetic tags.
2. Sequence style prompt.
3. Checkpoint trigger words.
4. Current shot cast character prompts.
5. Character LoRA trigger words.
6. Sequence environment prompt.
7. Shot Canvas Prompt.
8. Manual Shot Prompt.
9. Camera / lighting / detail fragments.

Merge constraints:

- Merge only the Character Reference Prompt and references for characters listed in the current shot's `castCharacterIds`.
- Character Reference Prompt should not be duplicated into Canvas prompt or Manual shot prompt.
- `shotCanvasPrompt` should not include full character identity, fixed appearance, or global art style.
- `manualShotPrompt` may include temporary action, expression, camera, interaction, character count, and left/right relationships.
- LoRA triggers and LoRA configuration should be managed through resource selection and the workflow builder, avoiding direct `<lora:...>` syntax in editable prompt text.
- Illustrious section rebuilding should preserve the semantic layers above instead of treating every fragment as one flat prompt.

### Second-Pass Canvas Editing Rules

When a user returns to the canvas from a shot, edits it, and saves it back to that shot:

- Automatically update `sceneSnapshot`.
- Automatically update `shotCanvasPrompt`.
- Automatically update current-shot ControlNet previews/settings.
- Preserve `stylePrompt`.
- Preserve `environmentPrompt`.
- Preserve `characters[].prompt`.
- Preserve `manualShotPrompt`.
- Preserve other shots' scene snapshots, canvas prompts, manual shot prompts, and casts.

Only explicit actions such as `Sync character/reference from canvas` should allow the current canvas state to update the character library's Character Reference Prompt or references.

If the canvas contains a visible character that is not declared in the shot cast:

- MVP should prompt the user to add that character to the cast, or store the visible person as shot-local extra description in `shotCanvasPrompt`.
- The system should not automatically create a long-term sequence character unless the user explicitly saves it as a sequence character.

### Multi-Character / Reference Rules

- Sequence must maintain a `characters` library.
- Each shot must maintain `castCharacterIds`.
- ComfyUI reference merging must use only references from the current shot cast.
- When Shot 1 has cast `[A]`, merge only A's prompt/reference.
- When Shot 2 has cast `[A, B]`, merge A and B prompt/reference, and require the manual prompt to describe count and placement.
- When a user deletes a character, the system should warn about affected shots and require cast reassignment or removal of that character reference.
- When multiple characters share similar traits, character prompts should retain distinguishable identity tokens, clothing differences, or stable visual anchors.

### MVP Issue Split

Issue 1: New data model

- User value: saved comic sequences can represent global style/environment, character library, shot cast, and layered prompts.
- Scope: define and persist the new layered Comic Sequence prompt structure; new sequences use `stylePrompt`, `environmentPrompt`, `characters`, `castCharacterIds`, `shotCanvasPrompt`, and `manualShotPrompt`.
- Non-goals: do not change AI storyboard output; do not rebuild UI.
- Data/model implications: add `stylePrompt`, `environmentPrompt`, `characters`, `castCharacterIds`, `shotCanvasPrompt`, and `manualShotPrompt`.
- Validation: new sequence round-trip save/load; missing new fields get defaults only for the new structure; no old-data migration cases.

Issue 2: Sequence / Character / Shot Prompt UI

- User value: users can clearly edit global style, environment, character library, and shot-local prompts.
- Scope: expose and edit layered fields in Comic Sequence UI; support shot cast multi-select; show second-pass editing save-rule guidance.
- Non-goals: do not implement complex multi-character 3D pose synchronization.
- Data/model implications: UI writes the fields from Issue 1; no ComfyUI execution path changes.
- Validation: manually editing style/environment/character/shot fields survives save/load; different shot casts do not contaminate each other.

Issue 3: Prompt merge and ComfyUI integration

- User value: final positive prompts are shorter, more stable, and contain only characters present in the current shot.
- Scope: merge prompts in the recommended order; use character library for reference character prompts; merge only current-shot cast references; make Illustrious section rebuilding preserve semantic layers.
- Non-goals: do not change checkpoint/LoRA resource selection UI.
- Data/model implications: ComfyUI request builder reads layered sequence/character/shot fields.
- Validation: final prompt and references are correct for single-character shots, two-character shots, and environment-only shots.

Issue 4: AI Storyboard cast-aware MVP

- User value: AI storyboard can choose which characters appear in each shot instead of copying the global prompt into every shot.
- Scope: storyboard outputs `{ title, castCharacterIds, shotPrompt }`; writes to `manualShotPrompt`; uses the character library as context.
- Non-goals: do not generate complex canvas prompt patches.
- Data/model implications: LLM response schema must validate that cast ids exist.
- Validation: invalid AI-generated character ids degrade safely or report a clear error; generated shots do not repeat full character appearance.

Issue 5: Shot-to-canvas second-pass editing protection

- User value: users can adjust a single shot's composition or ControlNet settings without accidentally damaging global characters or hand-written actions.
- Scope: saving back to a shot updates only `sceneSnapshot`, `shotCanvasPrompt`, and ControlNet previews/settings; explicit sync is required before character/reference updates.
- Non-goals: do not implement automatic character-library extraction.
- Data/model implications: distinguish shot-local save actions from character sync actions.
- Validation: after returning to canvas and editing a shot, style/environment/character/manual prompt remain unchanged; explicit sync is required to change character fields.

### Legacy Data Strategy

- This plan does not migrate old `savedComicSequence` data.
- The new Comic Sequence prompt architecture only guarantees save, load, and generation behavior for newly created sequences.
- If an old sequence lacks the new fields, the MVP may block entry into the new architecture editing flow and ask the user to recreate the sequence.
- Old data can continue through existing paths or be handled by a separate future task; this plan does not require compatibility with old generated sequence results.

### Acceptance Criteria

- A new comic sequence can maintain sequence style, sequence environment, characters, and shots separately.
- Character Reference Prompt is the source of truth for character appearance/identity; default shot prompts do not repeat full character appearance.
- Each shot can select a different cast, and final prompt/reference output includes only characters present in the current shot.
- Shot Canvas Prompt describes only visible elements, local setting, and composition from the current shot canvas.
- Manual Shot Prompt describes current-shot action, camera, expression, interaction, count, and relative placement.
- AI storyboard MVP can output at least shot title, `castCharacterIds`, and manual shot prompt.
- Editing a single shot on the canvas and saving it back updates only shot-local canvas/snapshot/ControlNet fields.
- Explicit `sync character/reference from canvas` is required before the character library prompt/reference can change.
- Newly created saved comic sequences can be saved, loaded, and generated; old saved comic sequence migration is not an acceptance requirement.
- Stable Diffusion / Illustrious positive prompts merge by semantic layer and do not write `<lora:...>` syntax into ordinary editable prompt text.

### Risks

- Initializing a new sequence from the current canvas prompt may start from text that mixes style, environment, characters, action, and camera, and automatic splitting will not be fully reliable.
- Users may continue writing character appearance into Manual Shot Prompt, so the UI needs guidance and copy.
- Multi-character reference merging may increase ComfyUI workflow complexity, especially when combined with ControlNet, IPAdapter, or regional conditioning.
- If Illustrious section rebuilding still treats input as flat text, it may break the new layered order.
- AI storyboard cast id output must be strictly validated to avoid missing or nonexistent characters.
- If save/sync entry points are unclear, users may assume canvas editing automatically updates the character library.

### Validation Recommendations

- Unit tests: new Comic Sequence prompt schema defaults and round-trip save/load; do not cover old-data migration.
- Unit tests: prompt merge order, cast filtering, empty cast, multi-cast, and character deletion fallback behavior.
- Unit tests: AI storyboard response schema validation, especially invalid `castCharacterIds`.
- Integration tests: ComfyUI request builder positive prompt and references for single-character shots, two-character shots, and environment-only shots.
- Regression tests: second-pass shot canvas editing updates only shot-local fields and does not change sequence or character fields.
- Manual QA: create an A-only shot, an A+B shot, and an environment-only shot; inspect UI, save/load behavior, final prompt, and reference merge output.
