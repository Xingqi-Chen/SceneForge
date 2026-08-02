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
- Civitai resource discovery, selected checkpoints/LoRAs, import image parsing, download support, cache repair, and recommendation helpers. Parse preview never calls the embedding provider or mutates recommendation indexes. Confirmed import incrementally embeds only new selected resources against a healthy compatible baseline, while existing resources remain link-only; confirmed reanalysis embeds only when deterministic recommendation search text changes. The first new resource can bootstrap indexes only in a genuinely empty model/LoRA library. Nonempty missing, stale, legacy, or configuration-incompatible indexes require the explicit full-rebuild commands.
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

Simple and detailed Run modes use the same Scene Composer state and controls. Switching display modes must not create a second settings source or discard the current scene request, visual style, output count, source image, explicit style resources, saved generation parameters, Detailer settings, or global style reference.

Run generation controls follow these rules:

- Checkpoint and LoRA selection is optional and limited to ready local resources. Explicit selections must be validated for resource type, availability, prompt profile or base model, and LoRA compatibility.
- When the user explicitly selects a checkpoint, that checkpoint and its enabled compatible LoRAs become the manual `resource-recommendation` result. The resource recommendation LLM is not called. Without an explicit checkpoint, Run retains the existing AI resource recommendation path.
- The Parameters dialog is available only after an explicit checkpoint is selected. It exposes supported ComfyUI generation settings and user-triggered AI Style Advice for the selected resources.
- Saved parameters become the manual `parameter-recommendation` result and bypass automatic parameter advice. If the user does not save parameters, Run retains the existing shared AI parameter recommendation path, including for Krea 2. A usable shared Style Advice response may contribute only fields already supported by that contract; its positive-prompt field never replaces the resource-aware prompt rendered locally by SceneForge.
- Changing checkpoint or LoRA selection clears saved parameters and prior AI Style Advice so advice and settings cannot silently survive a different resource context.
- FaceDetailer and HandDetailer are independent user-controlled settings. They do not require resource or parameter selection, may be enabled separately, and AI must not enable, disable, recommend, or modify either Detailer.
- Enabled Detailer settings are visible in the generation request preview and confirmation summary and are applied to the confirmed Run request.
- One optional PNG/JPEG/WEBP style reference is stored through the safe sequence-reference boundary and analyzed into one opaque base-model-compatible `stylePrompt`. The segment is appended exactly once after resource-aware formatting for preview, regeneration, restore, and confirmed execution.
- Illustrious-capable checkpoints always keep the style prompt and may additionally enable sequence-style IPAdapter with normalized `weight/start_at/end_at` defaults of `0.45/0/1`, values in `0..1`, and `start_at <= end_at`. Anima, unknown, and unsupported contexts are visibly prompt-only and must not receive hidden adapter nodes.
- Pending, failed, invalid, or context-mismatched references block start, regeneration, and confirmation without queueing ComfyUI. Retry/reanalysis, replacement, and removal remain available.

After a workflow has started, these Composer settings remain editable. Resource changes mark `resource-recommendation` and its downstream nodes stale. Parameter, Detailer, or style-reference changes mark `parameter-recommendation` and its downstream nodes stale. Either change cancels the existing generation confirmation, preserves unrelated prompt, character-tag, pose, and canvas results, and must not call ComfyUI until the user confirms the regenerated request again.

Output precedence is explicit:

- Text-to-image Run keeps the Composer output count of one to four, and its selected resources, parameters, and Detailers apply to every output in that Run.
- Attaching an image-to-image source preserves the selected output count of one to four and uses the source image dimensions.
- The Composer source-image denoise value overrides saved parameter denoise for image-to-image generation. Other compatible saved parameters remain effective.
- A saved parameter payload must not override the Composer output count.
- For Krea 2 without a source image, compatible saved dimensions take precedence; without saved parameters, a compatible AI-advised resolution may take precedence over the 1024×1024 fallback. Every selected Krea dimension must still satisfy the existing exact 16-pixel-alignment contract.

Active autosave and named workflows persist the normalized explicit resource ids, supported saved parameters, Detailer settings, and sanitized style-reference metadata/analysis/context/status/settings needed to restore the Composer. Style-reference records never persist bytes, base64/data URLs, secrets, unsafe paths, or full resource collections. Restored legacy Run workflows that lack these settings keep the automatic resource and parameter recommendation paths, default both Detailers to disabled, and restore no reference. Restoring a stale or previously confirmed workflow must not automatically submit a generation request.

### Run visual style contract

- Simple and detailed Composer modes share one closed `visualStyle` setting: `anime | photoreal`. New Runs and continuable legacy records missing the field normalize to `anime`. Completed historical outputs remain visible as `style-unassessed` and never trigger automatic provider evaluation.
- Visual style is independent from the Illustrious, Anima, and Krea 2 prompt profiles. Changing it preserves explicit checkpoint and LoRA selections, saved parameters, Detailers, source image, output count, and style reference. It stales from Scene Prompt, cancels confirmation, and prevents reuse of prior-style Preview, Final, Repair, review, or retry state.
- Suggest, Rewrite, Scene Prompt Generation, automatic resource recommendation, Style Advice, and style-reference analysis receive the normalized selection. The selector is authoritative over conflicting scene or LLM wording, while explicit ready resources continue to bypass resource recommendation and saved parameters continue to bypass automatic parameter advice.
- Illustrious and Anima accept optional structured `visualStyleAndMedium` content, and Krea reuses its existing visual-style/medium section. SceneForge compiles one local authoritative style segment in that profile-specific position, with minimal opposing-domain negative guidance, rather than appending loose keywords.
- Photoreal means live-action photography or film with natural human proportions, skin and material response, physically plausible lighting, and photographic optics; anime, manga, cel shading, cartoon rendering, 3D cartoon, and semi-real illustration do not match. Anime means Japanese anime illustration with stylized character design, clean linework, anime coloring, and illustrated shading; live-action photography does not match.
- If the LLM-authored dedicated style/medium section contains an opposing-domain signal, SceneForge discards that whole section and uses the local fallback. It does not globally delete or semantically rewrite unrelated prompt content, and generic `photo`, `realistic`, `photorealistic`, camera/lens, bokeh, or depth-of-field terms alone are not classifiers.
- Photoreal suppresses LLM-authored Illustrious `artistStyle` and Anima `artist` sections while retaining explicit checkpoint, LoRA, and resource-trigger content. Anime preserves the existing artist/style behavior.
- The normalized style and bounded compliance metadata are confirmation-bound and persist safely without image bytes, data URLs, secrets, or raw provider responses. This contract does not add a prompt profile, alter Story, change provider routing, classify resource compatibility, remove resources, or guarantee a model's aesthetic output.

### Run empty-input Suggest

Run treats Suggest as a diversity-oriented idea generator only when the effective scene request is empty after trimming. Nonempty Suggest keeps its existing draft-inspired alternate behavior, and Rewrite keeps its existing nonempty-input requirement and rewrite behavior. This scope does not change Story request actions, scene-prompt generation, resource or parameter recommendation, workflow orchestration, generation, or Preview Scoring.

One empty-input Suggest request asks the LLM for six structured candidates. Each candidate contains one complete `sceneRequest` plus categorical concept fingerprints for `protagonistType`, `ageGroup`, `occupationFamily`, `settingCategory`, `era`, `primaryAction`, `emotionalTone`, and `dominantPalette`. The `sceneRequest` is the sole semantic scene value: local code may validate the response and trim outer whitespace, but must not split, concatenate, enrich, reconstruct, or otherwise semantically rewrite it from the fingerprints. Fingerprints exist only for validation, comparison, ranking, and bounded history.

When NSFW is disabled, every candidate must depict exactly one person: one female protagonist who is the sole depicted person. Settings remain diverse; a campus is only one permitted example and is neither required nor the default. These SFW candidates must avoid additional people, couples, groups, and crowds. This single-female-protagonist rule does not add the NSFW-only 21+ age declaration requirement to SFW candidates.

When NSFW is enabled, the same six-candidate request directs the LLM to make the candidate pool lean toward adult NSFW subject matter while retaining the existing diversity and prompt-profile requirements. Every candidate must also depict exactly one person and avoid additional people, couples, groups, and crowds; this scope does not require the sole NSFW protagonist to be female. The sole depicted person must be explicitly 21 or older, and each candidate's structured `ageGroup` must make that 21+ status unambiguous. Candidates must not include minors, ambiguous-age or youth-coded subjects or settings, coercion, exploitation, non-consensual sexual activity, or unlawful sexual content. An NSFW candidate with an absent, invalid, or ambiguous 21+ `ageGroup` declaration is unusable and follows the existing bounded repair and zero-candidate failure behavior. These mode-specific requirements apply equally to the initial request and the single permitted repair request.

SceneForge validates candidate structure, removes unusable duplicates, and ranks usable candidates for recent-concept novelty, scene completeness, and compatibility with the selected prompt profile. It chooses among the ranked top three with weights 50/30/20 rather than always taking rank one. With only two usable candidates after recovery, those first two weights are normalized to 62.5/37.5; with one usable candidate, that candidate is selected.

Empty-input Suggest uses a dedicated installation-level local Run concept history rather than active or named workflow autosave. The history retains at most the 20 newest valid fingerprints across selected and non-selected candidates, together with disposition, schema version, and timestamp. `not-selected` means only that the weighted draw did not choose the candidate and is not a durable negative preference. The history must not store candidate prompt text, the selected `sceneRequest`, raw LLM responses or reasoning, secrets, resource metadata, or generated assets. Later requests send at most those 20 fingerprint records as `recentConceptsToAvoid`. This bounded history is separate from ordinary local LLM logs: existing logging policy may still record the current request and six-candidate response for diagnostics.

Missing or empty history is normal first-use behavior and sends an empty avoidance list. Corrupt or unreadable history is ignored so Suggest can continue without history. A history write failure must not discard an otherwise valid selected suggestion; the UI may report that future diversity memory was not saved. A malformed response or fewer than three usable candidates permits one bounded schema-repair request. After that repair, SceneForge applies the three-, two-, or one-candidate selection behavior above. If no usable candidate remains, it leaves the Composer unchanged, writes no history, and presents a retryable error. Empty-input Suggest does not generate embeddings and must not query, update, or mix its history with Civitai FTS or sqlite-vec recommendation indexes.

### Krea 2 Turbo staged Run profile

The Krea 2 prompt profile is selected only for Krea 2-compatible ready local Civitai resources and treats the selected model as a diffusion model. Its final prompt is one cohesive English natural-language paragraph in this fixed author-recommended order: subject/mood, subject attributes/actions, environment/background, visual style/medium, lighting/color/texture, spatial composition/framing, and selected LoRA trigger words. New Krea Prompt Generation responses must include `environmentAndBackground`, and SceneForge persists that field with the other structured Krea sections. Parsing or manual-input normalization may tolerate a missing field defensively, but that optionality is input robustness rather than a historical-workflow compatibility or migration promise.

`environmentAndBackground` owns the setting, environment, background, and supported ambient scene details. Spatial composition/framing separately owns foreground, midground, and background placement, relative subject/environment scale, atmospheric depth, framing, and subject-background contrast or separation. The LLM may elaborate presentation and spatial relationships that are consistent with supplied facts, but detail must not introduce unsupported characters, animals, objects, clothing, materials, visible text, or other concrete scene facts. Requested media, colors, actions, quoted visible text, and spatial relationships remain faithful to the user input. For an ordinary character-and-scene request, Krea instructions target roughly 160–240 English words as guidance for useful detail, not as a truncation, rejection, or padding rule; sparse requests may remain shorter when more detail would require invention.

The Krea renderer compacts these supplied sections into one paragraph with punctuation-safe boundaries, including the optional style-prompt and selected-LoRA-trigger boundaries, so it does not produce malformed joins such as `.,`, `,,`, or whitespace before punctuation. It does not perform local semantic rewriting or invent missing content, and it appends each selected LoRA trigger once. This locally rendered positive prompt remains authoritative: the shared Style Advice response's positive-prompt field is ignored and cannot rewrite, replace, reorder, or append semantic content.

Krea Prompt Generation LLM instructions require each `negativeSuggestions` item to be one concise English undesirable visual concept written as a comma-ready noun or adjective fragment. Items must not use imperative wording such as `Do not`, `Don't`, or `Avoid`, and must not express positive desired outcomes; for example, use `extra people` rather than `keep a single subject`. An empty array is valid when no undesirable concept is justified. The positive-prompt refinements do not change this negative-suggestion behavior. This remains a Krea-only instruction contract: SceneForge does not locally classify or rewrite the returned semantics, does not migrate existing saved suggestions, and leaves Illustrious and Anima prompt generation and rendering unchanged. Legacy saved workflows retain their stored values until the user explicitly reruns Prompt Generation.

Krea 2 Turbo is confirmation-gated and ordinarily uses the normal Run Preview → comparative scoring → exact-K selection → managed `preview-upscale` → Final img2img path. Txt2img and Composer source img2img support K=1–4 output selection and 4/4/6/8 candidate pools when ReID is inactive. Defaults are 1024×1024, 8 steps, CFG 1, Euler/simple sampling, and batch size 1 for formal planning and Preview. Formal and Preview dimensions must preserve the requested aspect ratio and be divisible by 16; invalid source or saved dimensions fail before queueing rather than being rounded or stretched. Composer source denoise takes precedence over saved parameter denoise for ordinary source-img2img Preview. Without active ReID, Krea policy v3 resolves Final Conservative to 4 steps/0.12 denoise, Balanced to 4/0.18, and Strong to 6/0.28 while reusing the selected Preview seed and managed upscale. Corrected ReID follows the separate policy below. Krea uses the ordinary bounded Final review, local recommendation, and explicit Final/Preview variant selection. Its one-shot Repair remains default-off and confirmation-signed; only the bounded local Krea img2img/inpaint graph may run after its required nodes, ports, sampler, and exact local UNET/CLIP/VAE/LoRA files validate from `object_info`. Incompatibility is a safe skipped repair, never a queue. One analyzed global style reference contributes a faithful natural-language `stylePrompt` exactly once. Prompt-only use requires no adapter nodes; the optional Krea reference adapter requires compatible Krea context plus successful local graph/port/file preflight and queue-time validation. An explicitly selected adapter remains selected but blocks generation while preflight is pending or unavailable until validation succeeds or the user explicitly opts out to prompt-only. FaceDetailer and HandDetailer are independent user controls for ordinary Krea Final and compatible Repair requests, run Hand-before-Face, and remain disabled for every Preview. Active ReID pauses FaceDetailer without deleting its saved selection; HandDetailer remains user-controlled. Before either selected compatible Detailer queues, SceneForge validates the complete generated graph, required node inputs, sampler settings, detector models, and exact Krea UNET/CLIP/VAE context. Legacy or missing Detailer settings default both controls off. Krea excludes ControlNet, Story, API/RAW, manual inpaint, and AI planning or control of Detailers. Completed legacy direct records stay read-only with truthful direct provenance; incomplete or continuable direct records stale and require a fresh confirmation without fabricated Preview or Final links.

T55 supersedes the former Krea dual-role character image behavior. Krea style-image conditioning stays on the verified single-image `krea2_style_reference.safetensors` path. Krea2 ReID is always labeled Experimental and upstream-unverified because the community workflow is unofficial. It has no separate runtime-certification tier. The current correction deliberately defers checkpoint/encoder comparison: metadata-valid Krea diffusion checkpoints and compatible Krea encoders, including FP8 and RedCraft combinations, remain selectable for ReID under the same warning. SceneForge records the selected runtime truthfully and never silently substitutes another checkpoint or encoder.

The ReID graph uses exactly one user-selected, server-prepared RGB image and no `image2` or generic `characterReferences`. One `Krea2OstrisEditModelPatch(kv_cache=true)` consumes the exact ReID LoRA. Both the positive and negative `TextEncodeKrea2OstrisEdit` nodes receive the same prepared image and VAE, and both conditioning outputs pass through `FluxKontextMultiReferenceLatentMethod(index_timestep_zero)` before sampling. Missing or mismatched descriptor version, required node, port, fixed value, edge, compatible Krea resource metadata, or generated-graph topology blocks before managed storage, ComfyUI upload, or queue; there is no topology fallback. Validation does not require one exact checkpoint or encoder identity. Active ReID pauses without deleting the style-image adapter, preserves the analyzed `stylePrompt` exactly once, and restores a compatible style adapter when removed.

ReID is txt2img-only in this corrected slice. A Composer source image and active ReID cannot be confirmed together. Active-ReID execution uses policy v5: Preview candidates use at most 1,048,576 pixels, preserve the exact formal aspect ratio, align both axes to 16 pixels, and never upscale a smaller formal request; 1024×1536 therefore resolves to 832×1248. The selected candidate's seed is rerun from noise at the formal dimensions through the same upstream-parity topology. The managed `preview-upscale` remains a selectable fallback but is never the ReID Final's img2img source, and Final redraw strength/denoise does not apply. Active ReID pauses FaceDetailer because an unverified face redraw can destroy identity; removing ReID restores the prior setting. HandDetailer may remain enabled. Repair is always ReID-free.

The corrected ReID descriptor, confirmation, and execution policy are newly versioned. Version-1 ReID descriptors, confirmation, candidates, Finals, and retry state do not migrate or authorize new work; the user must prepare and confirm the reference again. Completed images may remain historical and read-only without automatic provider or ComfyUI calls. Formal renders above the one-megapixel Preview budget show that a 12 GB GPU may require ComfyUI offload or a lower requested resolution. Memory failure is recoverable and never silently changes model precision, runtime resources, or dimensions.

ReID acceptance requires both structural evidence and live reporting. With the selected metadata-valid Krea resources, prepared image, prompt, seed, and dimensions, SceneForge's conditioning topology must be behaviorally equivalent to the pinned upstream dual-encoder/VAE/Flux workflow except for resource identities and managed output/storage nodes. A four-seed run records candidate identity consistency and whether the selected formal Final improves, preserves, or reduces identity relative to its Preview. Validation records sanitized resource identities, dimensions, ComfyUI memory/offload mode, graph evidence, and the observed outcome; reference images and generated outputs remain local and uncommitted. Automated graph assertions alone cannot close the corrective gate, but this report does not certify or rank checkpoint/encoder combinations.

The ReID upload flow is server-only and explicit: apply EXIF orientation and RGB normalization, run the bundled YuNet March 2023 INT8 detector at confidence 0.35, select its highest-confidence face, apply the pinned upstream head/shoulders crop, bound each prepared choice to a 384×384 total-pixel budget, and show crop/original previews. No-face input keeps only the normalized original with a warning. The user selects one image and acknowledges consent or lawful use; only that prepared PNG and safe preparation metadata are retained. Raw upload bytes, the alternate preview, data URLs, tensors, paths, and temporary ComfyUI identifiers are not persisted or logged. Metadata-valid Krea diffusion resources, including RedCraft and FP8 variants, remain selectable for ReID and non-ReID generation with an experimental upstream-unverified warning rather than a compatibility certification claim.

For Krea 2, the shared Render prompt / `parameter-recommendation` behavior matches the other Run profiles: saved Composer parameters skip automatic Style Advice, while an unsaved parameter state invokes the shared advice path when it is available. Compatible advice may contribute a valid resolution, negative-prompt additions, weights for already selected local LoRAs, and user-facing rationale or overall-effect text. Advice cannot select a different checkpoint, introduce an unselected LoRA, or override the locally rendered positive prompt.

Krea formal planning, the displayed parameter result, request preview, and Preview execution are fixed at 8 steps, CFG 1, Euler, and simple scheduling; conflicting AI advice, saved parameters, or persisted/client state cannot override those values. For prompt-only and style-only Runs without active ReID, Krea policy v3 resolves Final Conservative to 4 steps/0.12 denoise, Balanced to 4/0.18, and Strong to 6/0.28. Active ReID uses policy v5 for its separate upstream-parity Preview and formal txt2img execution. Resolution defaults to 1024×1024 only when no compatible source, saved dimensions, or AI-advised resolution takes precedence. Composer source dimensions and denoise retain precedence only while ReID is inactive; an active ReID reference and Composer source image are mutually incompatible. Invalid source, saved, or advised Krea dimensions fail the existing exact 16-pixel-alignment checks rather than being rounded or stretched. The positive-prompt refinements do not change Krea sampling, confirmation, Preview, scoring, Final, Repair, Detailer, style-reference adapter, or ComfyUI execution behavior. Illustrious and Anima behavior is unchanged.

#### Krea Final second-pass policy

Krea formal planning and Preview remain fixed at 8 steps, CFG 1, Euler, and simple scheduling. For prompt-only and style-only Runs without active ReID, each selected Final uses policy v3, reuses that Preview's seed and managed `preview-upscale`, and resolves a separate base sampler from the selected redraw preset: Conservative is 4 steps at 0.12 denoise, Balanced is 4 steps at 0.18 denoise, and Strong is 6 steps at 0.28 denoise. Corrected ReID policy v5 instead reruns the selected seed from noise at the formal dimensions with 8 steps through the required upstream-parity topology. Its managed upscale is fallback-only, and no redraw preset or denoise participates in Final generation. This ReID exception does not change ordinary source Preview denoise, prompts, resources, analyzed style text, HandDetailer, review, ReID-free Repair, or Illustrious/Anima/fallback behavior.

The Krea policy revision, family, resolved steps, generation mode, and applicable preset/denoise are part of signed confirmation and persisted Final provenance. Same-policy partial retry may reuse only an exact candidate/seed/request/resource/policy match. Older, incomplete, missing-policy, or cross-policy Krea state must be reconfirmed and cannot supply a reusable Final; changing only the ordinary non-ReID preset retains Preview generation, scoring, exact-K selection, and seeds while staling Final and downstream work. Version-1 ReID state is invalidated rather than migrated. Completed historical outputs remain read-only displayable.

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
| Final repair | Signed opt-in plus eligible Final-review findings | At most one managed local Repair, mask provenance, or a closed skip/failure reason per pair | Final review | Retry failed/skipped-eligible pairs only | Structured local diagnosis; mask coverage must remain at most 35% before and after bounded growth |
| Repair verification | Completed repair stage | One bounded Preview/Final/Repair comparison and local recommendation | Final repair | Retry verification only | At most one safe schema-repair attempt; no per-pair calls |
| Result display | Completed managed variants and selection | One to four selected images, metadata, and candidate linkage | Repair verification, including safe unavailable results | Select Final, Preview, or a verified Repair | Selection autosaves without AI or generation |

For Krea 2 Turbo without active ReID, Preview execution, Preview scoring, exact-K selection, `preview-upscale`, Final img2img, bounded Final review, and explicit Final/Preview selection use the ordinary Run path. Active ReID changes only the documented Preview resolution and Final generation mode while retaining comparative scoring, exact-K selection, the managed fallback, bounded Final review, and explicit Final/Preview selection. Default-off Repair and its verification retain the shared signed authorization, one-shot recovery identity, and explicit-only promotion rules, but Krea queues Repair only after profile-specific local graph validation; an incompatible installation records a safe skipped result while the linked Final and managed Preview fallback remain selectable.

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
- Simple and detailed Run modes share one Anime or Photoreal setting; new and continuable missing-field Runs default to Anime, while completed historical results remain style-unassessed without automatic evaluation.
- Empty-input Run Suggest requests six complete structured scene candidates, ranks them against at most 20 installation-local recent concept fingerprints, and chooses among the top three with 50/30/20 weights. Every candidate depicts exactly one person and excludes additional people, couples, groups, and crowds.
- With NSFW disabled, the sole depicted person in every candidate is one female protagonist. Candidate settings remain diverse; campus is an optional example rather than a required or default setting, and SFW candidates do not inherit the NSFW-only 21+ declaration requirement.
- With NSFW enabled, all six candidates lean toward adult NSFW subject matter and the sole depicted person is explicitly 21+; the sole NSFW protagonist is not required to be female.
- NSFW empty-input candidates prohibit minors, ambiguous-age or youth-coded subjects or settings, coercion, exploitation, non-consensual sexual activity, and unlawful sexual content. Their existing `ageGroup` fingerprint must unambiguously declare 21+ adulthood; invalid or ambiguous declarations are rejected through the existing single bounded repair and zero-candidate failure path.
- Nonempty Suggest, Rewrite, Story request actions, downstream prompt generation, the diversity ranking and weighted selection algorithm, bounded history behavior, and Preview Scoring retain their existing behavior.
- A selected empty-input suggestion uses the LLM-returned `sceneRequest` intact as its semantic value; local code does not split, concatenate, enrich, reconstruct, or rewrite it from fingerprint fields.
- Empty-input Suggest history persists only bounded fingerprints and disposition metadata, never prompt text or raw LLM output, and remains separate from ordinary LLM diagnostic logs and all Civitai FTS or embedding indexes.
- Missing, corrupt, unreadable, or unwritable Suggest history does not block a valid result. Malformed or insufficient candidate output receives at most one bounded repair; three, two, or one usable candidates use the defined weighted fallback, while zero leaves the Composer and history unchanged with a retryable error.
- Explicit ready local resources bypass AI resource recommendation; saved parameters require a checkpoint and bypass AI parameter recommendation; absent manual settings preserve the existing AI paths.
- Krea 2 without saved parameters invokes the shared Style Advice path. Compatible resolution, negative-prompt additions, selected-LoRA weights, and rationale may affect the parameter result, but the LLM positive prompt remains non-authoritative.
- Krea 2 locally renders one punctuation-safe natural-language paragraph from ordered subject, environment, style, lighting, and composition responsibilities. New Prompt Generation responses require the persisted `environmentAndBackground` section. Ordinary character-and-scene prompts target roughly 160–240 English words as non-binding detail guidance and remain faithful to supplied concrete facts.
- Krea 2 keeps formal planning and Preview canonical at 8 steps, CFG 1, Euler, and simple scheduling across advice, saved parameters, confirmation, retry, and restore. Without active ReID, Krea policy v3 resolves Final Conservative to 4 steps/0.12 denoise, Balanced to 4/0.18, and Strong to 6/0.28. Active ReID uses policy v5 for its separate one-megapixel Preview and same-seed formal txt2img execution. Its 1024×1024 resolution is a fallback rather than a lock.
- FaceDetailer and HandDetailer remain independent user controls, are not controlled by AI, and default disabled for legacy workflow records. Active ReID pauses FaceDetailer while preserving its saved selection; HandDetailer remains available.
- Post-start visual-style edits stale from `scene-prompt`; resource edits stale from `resource-recommendation`; parameter or Detailer edits stale from `parameter-recommendation`. Each resets generation confirmation without invalidating unrelated upstream input.
- Final output count remains one to four for both text-to-image and image-to-image. K maps to 4/4/6/8 previews; an image-to-image source takes precedence for preview dimensions and denoise only when ReID is inactive.

### Run preview selection

- Preview requests use batch size 1, Detailers disabled, and model-family Balanced settings with `min(formal steps, 20)` for every Run profile. Ordinary inputs above longest-edge 768 are reduced to the largest exact-formal-aspect dimensions that fit the limit and align both axes to 8 pixels; axes are never rounded independently or stretched. Active ReID instead uses the largest exact-formal-aspect, 16-pixel-aligned dimensions at or below 1,048,576 pixels, so 1024×1536 becomes 832×1248. Inputs already within their applicable limit remain unchanged and are never upscaled. An extreme ratio with no valid exact-aspect downscale fails with an actionable validation error. Initial fixed-seed execution starts at the formal seed; retrying preview execution advances from the retained base seed by the candidate count with safe maximum-seed wraparound, so consecutive retries use non-overlapping windows. Random policy always materializes a fresh base seed.
- High-detail Vision scoring compares every successful current-round preview in one request. All 4/6/8 candidates stay in that single comparative request, but each managed preview is transcoded only in memory to a quality-85 JPEG with longest edge at most 768 for provider-compatible bounded payloads; this never replaces or persists over the preview used by final rendering. The model returns defect-category strings plus one validated `visualStyleMatch` value for every successful candidate. SceneForge derives eligibility locally, accepts finite 0-100 numeric strings, and normalizes only case/space/hyphen variants that map exactly to an allowed category. Missing or unknown defects, missing style decisions, and incomplete candidate coverage fail closed. Blocking eligibility is rare and limited to major anatomy/structural failure that makes the render unusable, unmistakable physical impossibility/contradiction that makes it unusable, or catastrophic exposure/technical corruption. Missing prompt details, prop/contact omissions, character appearance mismatch, gaze/action mismatch, and subject scale/framing mismatch normally reduce adherence, composition, style, or technical scores instead of blocking; supported soft categories remain visible as annotations. Candidates retain the fixed scene-adherence, composition, anatomy/structure, style/identity, and technical-quality weights of 30/25/20/15/10 percent.
- A malformed first scoring response receives one bounded schema-repair instruction containing only a safe validation reason. Final error details distinguish malformed schema from upstream failure and never include raw responses, prompts, image data, or secrets.
- Only candidates whose `visualStyleMatch` is true may enter AI ranking, annotated eligibility fallback, or Detailed manual selection. If fewer than K candidates match, scoring stops recoverably before Final generation and never fills from a known mismatch. Within the matching set, AI Top-K ranks eligible candidates first, followed by ineligible candidates using the same weighted total, composition, and stable candidate order. If fewer than K matching candidates are otherwise eligible, the exact Top-K may still use the highest-ranked annotated matching fallbacks and persist safe `eligibleCount`, `fallbackCandidateIds`, and a visible warning. Rubric-v1 remains read-only.
- All single-image Run Preview Scoring, including ordinary, NSFW, and Krea Runs, uses only `LITELLM_DEFAULT_MODEL`; neither `LITELLM_VISION_MODEL` nor `LITELLM_NSFW_MODEL` may override or serve as a fallback for this node. NSFW scoring requests retain the truthful `nsfw` flag without using it to change the selected model. When `LITELLM_DEFAULT_MODEL` is missing, scoring fails closed with a recoverable configuration error before any provider call, preserves the completed Preview candidates, and does not advance to Final generation. The configured default model must support the image inputs and content it is expected to score. This routing rule is limited to Preview Scoring and does not change Final Review, Repair diagnosis or verification, Run or Story style-reference analysis, Story workflows, or any other LLM purpose.
- Each selected Top-K managed Preview is first resized server-side with deterministic Lanczos3 to the exact confirmed formal dimensions, without crop, padding, independent-axis rounding, or stretch. An incompatible legacy aspect ratio fails recoverably before ComfyUI queueing. The candidate-linked managed `preview-upscale` is retained as an accessible fallback. It is the sole img2img source for an ordinary Final, but active ReID never consumes it and instead reruns the selected seed from noise at formal dimensions.
- Finals preserve the candidate seed, formal dimensions/steps/CFG/sampler/scheduler, checkpoint/LoRAs, prompts, style/IPAdapter context, and compatible enabled Detailers. The shared Simple/Detailed Composer exposes Final redraw strength for non-ReID generation after the parameter summary and before Detailers. Conservative resolves to 0.30 for Illustrious and 0.35 for Anima/fallback; default Balanced resolves to 0.40/0.45; Strong resolves to 0.50/0.55 and visibly warns about anatomy, structure, and object drift. The preset does not change source denoise or parameter-recommendation state and is unavailable while ReID is active. A fresh ordinary Final whose managed content hash is unchanged from its `preview-upscale` fallback is a recoverable failure. Detailed mode may override the selection with exactly K successful candidates.
- The versioned deterministic-resize and preset/family/denoise policy is part of the signed confirmation contract and Final execution metadata. Missing or altered policy confirmation blocks new execution. Changing only the preset cancels confirmation, stales only Final execution/result display when valid Preview/scoring state exists, retains the Preview pool, scoring selection, and seeds, and resumes at Final after reconfirmation. Same-preset partial retry retains valid candidate fallbacks and successful Finals; cross-preset retry never reuses an old Final. Completed policy-v1 results remain read-only displayable, while incomplete or confirmed policy-v1 Runs require reconfirmation.
- Run definition v4 orders `comfyui-execution -> final-review -> final-repair -> repair-verification -> result-display`. One high-detail Final-review request covers all 1-4 complete pairs. Each pair contains finite five-dimensional scores, exactly one closed-contract finding for pose, contact, object count, and composition consistency, and a validated style-compliance result for Final. SceneForge ignores model-authored eligibility or recommendation values and may select Final only when it matches the normalized visual style; otherwise it falls back to that candidate's already style-verified `preview-upscale`.
- A false, missing, malformed, unavailable, or unreconciled Final style result makes Final unselectable without rerunning generation. Review-only retry remains available, and Simple and Detailed modes expose only compliant choices. Completed historical workflows remain visible as style-unassessed without automatic review calls and expose only stored variants that exist.
- Automatic local repair is disabled by default and is authorized only by an explicit Composer setting covered by the generation-confirmation fingerprint. Only major/blocking Final-introduced `contact` or `object-count` findings are eligible. Diagnosis must declare one localized region through the closed cardinality/locality contract; missing, ambiguous, global, multiple, or separated targets skip before SAM2 or ComfyUI. Each eligible pair permits at most one successful attempt, uses one structured mask whose actual pixel coverage is validated at no more than 35% both before and after growth, limits growth to 64 pixels, preserves the confirmed Final request except for a Repair-owned safe output prefix, and keeps Detailers request-local. A single clear unrotated rectangle or ellipse may receive one optional SAM2 refinement after current `object_info` validation; unavailable or invalid refinement retains only the independently validated structured mask and records the safe outcome. Safe queue-started/queued/output-ready/stored checkpoint state and exact parent Final/review/target identity prevent a retry or interruption from queueing a second Repair; uncertain queue acceptance fails closed for manual recovery.
- Repair verification compares all available Preview/Final/Repair triples in one bounded high-detail request, with at most one safe schema repair. SceneForge derives the recommendation locally. A Repair is never auto-promoted and is selectable only when its managed output, successful verification pair, and positive visual-style match all persist and reconcile safely; false, missing, malformed, unavailable, or unreconciled style verification leaves it unavailable.
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
