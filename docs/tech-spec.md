# SceneForge Technical Specification

## Stack

- Framework: Next.js App Router.
- UI: React, TypeScript, Tailwind CSS, lucide-react icons, local UI primitives.
- Workflow orchestration: LangGraph for Agent timeline node execution, dependency state, parallelism, and stale downstream regeneration.
- Editor state: Zustand.
- 2D canvas: Konva and React Konva.
- 3D viewport: Three.js, React Three Fiber, and Drei.
- Tests: Vitest with jsdom.
- Lint/type validation: ESLint and TypeScript `tsc --noEmit`.
- Image processing/runtime helpers: Sharp and local Node APIs inside server-side modules.

## Runtime Shape

SceneForge is a local-first web application:

- Client components render the editor, timeline, settings page, and interactive canvas state.
- Next.js API routes provide local disk persistence and integration boundaries.
- Server-side feature modules read environment variables and talk to local or external services.
- LangGraph runs the Agent single-image timeline workflow and owns dependency-aware execution.
- Runtime data is stored under `data/` by default or in configured absolute override paths.

## Source Layout

- `src/app/`: entry point and API routes.
- `src/components/ui/`: reusable UI primitives.
- `src/features/editor/`: editor shell, panels, canvas, viewport behavior, state store, 2D/3D placement, skeleton and pose logic, AI prompt helpers.
- `src/features/prompt-engine/`: prompt construction, formatters, face templates, spatial relations, prompt library taxonomy, import/export helpers.
- `src/features/persistence/`: project serialization, local disk storage, shared prompt library files, prompt bindings, and SQLite-backed storage helpers.
- `src/features/comfyui/`: client, workflow builders, generated image storage, inpainting, sequence references, model metadata, history, websocket, validation, and diagnosis helpers.
- `src/features/civitai-lora-library/`: client, parsing, normalization, download, cache, settings, imported images, enrichment, and recommendation logic.
- `src/features/artist-string-library/`: artist resources, adapters, service, platforms, image assets.
- `src/features/llm/`: LiteLLM-compatible chat client, validation, response parsing, and local logs.
- `src/features/tavily/`: Tavily client for web context.
- `src/features/agent-timeline/`: future home for LangGraph workflow state, node adapters, dependency rules, and timeline-specific domain types.
- `src/shared/`: shared project/scene types and pure utilities.

## Module Boundaries

- Client UI must not import `node:fs`, `node:path`, server-only storage modules, or server-only environment variables.
- API routes should validate request payloads, call feature modules, and return normalized responses. Keep reusable logic out of route handlers.
- LangGraph must own Agent timeline orchestration. React components and API routes must not manually chain graph nodes as an ad hoc waterfall.
- Timeline UI renders graph state and dispatches user actions such as edit, retry AI, confirm generation, and cancel.
- Prompt generation should consume typed scene/project/timeline data and remain deterministic whenever no LLM is involved.
- Persistence modules own serialization, migration, path resolution, and local file safety.
- External service clients must accept injectable fetchers where practical so tests can avoid live network calls.
- Editor store actions are the main mutation boundary for project state. Avoid ad hoc mutation from components.

## Core Data Model

The current domain model lives in `src/shared/types/`.

Important existing types:

- `SceneForgeProject`: project id, name, version, `Scene`, project settings, and timestamps.
- `Scene`: canvas settings, mode, 3D config, objects, characters, and scene prompt tags.
- `SceneObject`: 2D object data plus optional 3D transform for primitives.
- `CharacterSkeleton`: 2D joints, optional 3D transform, optional 3D stick-figure pose, body parts, and prompt tags.
- `PromptTag`: label, prompt text, category, optional subcategory, weight, and negative flag.
- `ProjectSettings`: prompt format, spatial hints, NSFW support, selected Civitai and artist resources, ComfyUI generation settings, prompt library overrides, and generated image history.

Timeline-specific data should be added separately so MVP workflow state does not accidentally mutate project state until a node explicitly binds to the 3D canvas or a future persistence task defines durable timeline storage.

Serialization rules:

- Preserve backwards compatibility when changing project data.
- Sanitize imported project data before it enters editor state.
- Keep shared prompt-library data separate from project-specific data unless explicitly exported.
- Keep generated timeline runtime state out of committed files and out of `data/` fixtures unless a scoped persistence task adds intentional placeholders.

## API Surface

Key route groups:

- `/api/projects`: local project listing and save/load/delete operations.
- `/api/prompt-library` and `/api/prompt-bindings`: shared prompt library and target binding state.
- `/api/llm/chat`: LiteLLM-compatible chat endpoint and the canonical LLM boundary for existing frontend-facing AI operations.
- `/api/comfyui/*`: workflow generation, queue/history/view helpers, image generation, inpainting, control models, upscale models, generated images, sequence references, events, and diagnosis.
- `/api/civitai-lora-library/*`: resources, selected resources, settings, import image parsing, imported images, downloads, cache repair, and AI recommendation.
- `/api/artist-string-library/*`: sync, selected resources, items, and images.
- `/api/agent-timeline/active-workflow`: active timeline workflow autosave record for Run/Settings navigation and page reload restoration.
- `/api/agent-timeline/workflows` and `/api/agent-timeline/workflows/item`: named timeline workflow list/save/open/rename/delete operations backed by local JSON records.
- Future `/api/settings/*` or equivalent settings routes: path, NSFW, and integration status updates, only where a scoped issue adds them.
- Future Agent timeline API routes should expose graph actions, not individual hand-written LLM waterfalls.

Route expectations:

- Validate input at the edge.
- Avoid leaking secrets or absolute local paths in responses unless explicitly needed for local file access.
- Normalize external service errors into user-actionable responses.
- Use configured storage roots and reject path traversal.
- Preserve the `/api/llm/chat` logging, validation, and model-selection semantics when wrapping existing LLM calls for LangGraph nodes. Story Graph planning adapters should write local request, response, and error records with workflow id, story id, and node id context.

## LangGraph Timeline MVP Contract

The Agent MVP is a single-image, vertical timeline workflow. It replaces the previous standalone draft-only Agent scope.

### Workflow State

The graph state should be explicit and typed. A future implementation can refine names, but the contract should include:

```ts
type TimelineNodeStatus =
  | "blocked"
  | "ready"
  | "running"
  | "done"
  | "stale"
  | "error"
  | "manual";

type TimelineNodeId =
  | "scene-input"
  | "scene-prompt"
  | "character-tags"
  | "character-action"
  | "canvas-binding"
  | "resource-recommendation"
  | "parameter-recommendation"
  | "generation-gate"
  | "preview-execution"
  | "preview-scoring"
  | "comfyui-execution"
  | "result-display";

type TimelineNodeResult<T> = {
  nodeId: TimelineNodeId;
  status: TimelineNodeStatus;
  result?: T;
  error?: { message: string; details?: unknown };
  updatedAt: string;
  source: "ai" | "manual" | "system";
};
```

### Node Dependencies

| Node | Required predecessors | May run in parallel with |
| --- | --- | --- |
| `scene-input` | none | none |
| `scene-prompt` | `scene-input` | none |
| `character-tags` | `scene-prompt` | future independent resource/status checks |
| `character-action` | `character-tags` | resource candidate loading if it has no prompt dependency |
| `canvas-binding` | `scene-prompt`, `character-tags`, `character-action` | none |
| `resource-recommendation` | `scene-prompt`, `character-tags`, `character-action`, settings/resource snapshot | canvas-binding if resource recommendation does not consume canvas summary |
| `parameter-recommendation` | `resource-recommendation`, prompt data, optional canvas summary | none |
| `generation-gate` | all prompt/resource/parameter nodes complete or manual | none |
| `preview-execution` | user confirmation at `generation-gate` | none |
| `preview-scoring` | `preview-execution` | none |
| `comfyui-execution` | `preview-scoring` | none |
| `result-display` | `comfyui-execution` | none |

### Regeneration Rules

- A node may execute only when all required predecessors are `done` or `manual`.
- Manual edits set the edited node to `manual`.
- LangGraph must mark every dependent downstream node as `stale`.
- Stale downstream nodes regenerate automatically after dependencies are valid.
- Nodes outside the edited node's dependency closure preserve their current result.
- Graph execution must stop at `generation-gate` until the user confirms.
- ComfyUI calls must not be constructed before confirmation.

### Shared Workflow Primitives

- `src/features/agent-timeline/workflow-definition.ts` owns reusable workflow contracts for mode, definition version, node metadata, dependency DAGs, node status, readiness, manual-edit stale propagation, raw JSON display, workspace routing, AI retry affordance, and adapter result normalization.
- Adapter contracts support workflow-scoped single artifacts and story/shot-scoped artifacts through explicit artifact scopes. Single-image v2 registration and stale propagation are definition-driven.
- `src/features/agent-timeline/workflow-definitions.ts` exposes the extracted single-image workflow definition data for future migration without changing the current LangGraph registration path.
- `src/features/agent-timeline/generation-detailers.ts`, `generation-style-palette.ts`, and `style-reference.ts` own workflow-neutral sanitized Detailer, style-palette, and global style-reference contracts shared by Run and Story. `story-style-palette.ts` preserves the Story-named re-export surface. `run-input-settings.ts` composes the single-scene Run snapshot; legacy Run records receive disabled FaceDetailer and HandDetailer defaults and no style reference.
- Run scene input may hold an explicit ready local checkpoint, enabled LoRAs with model/clip strengths, supported saved generation parameters, and independent Detailer configurations. An explicit checkpoint produces a manual `resource-recommendation` result without calling the recommendation provider. Saved parameters produce a manual `parameter-recommendation` result without calling automatic Style Advice; unsaved parameters retain the existing AI path. Detailers never enter AI requests.
- Post-start Run resource edits update the authoritative scene-input snapshot and stale `resource-recommendation` plus downstream nodes. Parameter, Detailer, analyzed-prompt, context, enablement, and IPAdapter value edits stale `parameter-recommendation` plus downstream nodes. Both reset generation confirmation while leaving completed scene-prompt, tag, action, and canvas artifacts intact.
- T7 appends a ready Run style reference as one opaque segment after resource-aware positive-prompt formatting. T8 revalidates status/context at confirmation, keeps Anima/unknown/unsupported requests prompt-only, and uploads an enabled Illustrious reference through the existing sequence-reference helper before `object_info` validation and queueing. Img2img source upload and style-reference upload remain independent; batch size, source dimensions/denoise precedence, and Hand-before-Face Detailer workflow order are unchanged.
- `src/features/agent-timeline/resource-plan.ts` owns reusable local resource-plan validation. It selects only validated local candidates, rejects invented or ambiguous resources, and strips model NSFW marker fields from common resource-plan outputs. Resource-plan behavior must not read, depend on, or expose model NSFW markers; NSFW remains content and execution context only.
- `src/features/agent-timeline/story-input.ts` owns Story Graph start request normalization and deterministic in-memory planning artifact assembly. It initializes typed `StoryInput` data from `/story` story request input, optional shot count, optional sanitized `settingsSnapshot.stylePalette` resource/parameter ids that require an explicit checkpoint selection, and settings-derived NSFW state, uses existing Story Graph planning helpers where resource, parameter, render, and gate artifacts are needed, and initializes confirmation-gated shot execution state from the Story Graph scheduler.
- `src/features/agent-timeline/story-planning.ts` owns Story Graph resource, parameter, preview, render-plan, and execution-request assembly contracts. Story resource planning loads server-ranked local Civitai candidates through the shared BM25/embedding recommendation search before the Story `resource-plan` LLM chooses checkpoint and LoRA ids; explicitly selected Story checkpoint/LoRA ids are included from local SQLite even when they are not top-ranked candidates. When a Story style checkpoint is saved, `resource-plan` uses that checkpoint and enabled saved LoRAs directly with source `manual` and does not call the resource-plan LLM. Missing, wrong-type, unavailable, or checkpoint-incompatible manual selections must fail with `resource_selection_invalid`. Story input AI Style Advice can use selected resource metadata to seed the parameter dialog, but the dialog is available only after explicit checkpoint selection and only saved Story generation parameters become authoritative planning input; when saved Story generation parameters exist, `parameter-plan` uses them directly with source `manual` and does not call the parameter-plan LLM. Story parameter planning stores formal generation parameters; preview execution options and preview result references are separate from the formal parameter plan and must not write back into it. Story render plans and execution request batches carry NSFW only as content/execution context from the story safety plan. Story Illustrious render plans store per-shot `resourceTriggerSelections`; only selected exact original `trainedWords` members are injected, rating marker trained words such as `general`, `sensitive`, `nsfw`, `explicit`, and any `rating:*` value are ignored with prompt warnings so Settings remains the only rating source, missing selections inject no Story resource triggers, invalid selections become prompt warnings, the positive rating tag is set locally from Settings NSFW as `safe` or `nsfw`, LLM-authored Illustrious sections are responsible for high-quality Danbooru-style subject/count/name tags without local semantic string rewriting, filtering, or truncation, and the negative prompt is the common Illustrious base `bad quality, worst quality, worst detail, censor` without shot-specific safety or content terms. Story render plans keep full prompt text, structured `animaPromptParts` or `illustriousSections`, and anchors but store only shared lightweight resource references; generation-gate previews carry the same structured prompt parts or sections so Visual prompt health does not re-infer quality from compact prompt strings. Execution request assembly must use the authoritative `resource-plan` result for full checkpoint and LoRA details, with legacy per-shot render-plan resources tolerated only for old workflow records. Story Anima prompt parts are structured as subject, character, series, artist, outfit, prop, action, setting, camera, lighting, style, caption, and negative-addition fields. LLM output owns semantic prompt quality; local code trims strings, drops empties, exact-dedupes arrays, supplies missing-field defaults, and compiles the positive prompt in fixed Anima order: recommended quality/safety prefix, subject tags, character tags, series tags, artist tags, then general visual tags and caption. `negativeAdditions` merge only into the negative prompt. Shot dependency graph edges are executable source-image dependencies only when reason is `img2img-source`; planning-only `reference`, `continuity`, `story-order`, and `manual` reasons remain non-executable. Automatic high-risk source-image transitions such as standing-to-kneeling, sitting-to-running, close-up-to-wide, major composition reset, camera reset, or scene reset are downgraded to prompt-only continuity with risk metadata. Manually retained high-risk `img2img-source` edges stay executable but render/gate previews expose per-edge risk level, reason, factors, and source chain metadata for warning summaries and later Visual consumption. Story source-image execution requests use denoise `0.9` so img2img shots can retain loose continuity while allowing strong redraw.
- `src/features/agent-timeline/story-style-palette.ts` keeps the Story compatibility names for the workflow-neutral global style-reference contract. The style reference stores only sequence-reference metadata, analyzed base-model-compatible style prompt text, selected-base-model settings, and optional IPAdapter controls; workflow JSON must not contain image bytes or data URLs. The Story Core Settings Illustrious base model may attach the stored reference through the shared sequence-style IPAdapter helper with `weight`, `start_at`, and `end_at` values in the `0..1` range, while Anima and unsupported selected checkpoints use the analyzed prompt only. Story prompt assembly appends the analyzed `stylePrompt` as a complete segment and must not split or re-dedupe it after the LLM has formatted it for the selected base model.
- `src/features/agent-timeline/story-execution.ts` owns Story Graph shot scheduling and scoped regeneration. It uses `StoryExecutionRequestBatch` inputs, exposes per-shot status, queue metadata, result references, and recoverable errors, runs independent source-ready shots together through an injected execution adapter, waits for img2img/source and multi-reference shot results, blocks dependents when sources fail or are unavailable, and marks only selected shots plus downstream dependents stale for regeneration.
- `src/features/agent-timeline/story-comfyui-execution.ts` owns the server-side Story Graph ComfyUI execution adapter. It reuses existing text-to-image validation, `object_info` compatibility validation, queueing, history polling, ComfyUI view reads, and generated-image storage helpers while keeping the scheduler itself pure and testable.
- `src/features/agent-timeline/story-state.ts` owns Story Graph runtime mutation helpers for story-scoped and shot-scoped manual edits plus generation confirmation state. It reuses common workflow stale propagation for node dependencies and records downstream shot ids for shot dependency graph edits without staling unrelated shot branches.
- `src/features/agent-timeline/story-node-output-summary.ts` owns compact, pure Story node summaries for the 15 Story workflow nodes. Visual Step output uses these summaries by default. Story render plan, generation gate, shot execution, and result display nodes render shot cards rather than raw artifact tables. Cards show shot number/id, scene beat, structured Anima prompt parts or Illustrious sections when present, final visual prompt, explicitly removed negatives, source-image dependencies and risk metadata, parameters/resources when present, stored-image thumbnails or placeholders, prompt health, and generation/readiness state. Prompt health flags empty or too-short tag lists, missing identity/action/setting/camera/lighting information, hardcoded-looking prompt fragments, upstream-reported removed negative conflicts, and high-risk source-image inheritance using structured prompt parts or sections before falling back to prompt string pattern checks. It does not infer conflicts from positive/negative prompt string overlap. Visual mode must hide debug-only fields including ComfyUI node ids, queue prompt ids, temporary view URLs, full workflow JSON, and queue internals. Raw JSON remains the complete debugging and artifact-inspection view.
- `src/features/agent-timeline/components/StoryPlanningWorkspace.tsx` owns Story Graph planning workspaces for storyboard shots, story safety, shot dependencies, plot state, character continuity, and story-scoped shared JSON nodes. `src/features/agent-timeline/components/StoryPlanningPreview.tsx` mounts those workspaces at `/story`, exposes story request, optional shots, explicit checkpoint/LoRA resources, and saved ComfyUI parameters as start inputs after checkpoint selection, nests AI Style Advice inside the Story Parameters dialog, routes request suggest/rewrite and resource style advice through `/api/llm/chat`, asks `/api/llm/chat` to choose shot count when users leave shots blank, starts a user-driven Story Graph workflow, displays summary-first Step output with collapsible artifact editing, displays confirmation-gated shot execution, and autosaves/restores `story-graph` workflow records through the shared timeline workflow persistence APIs.

### Story Reference Workflow Contract

Story Reference Workflow extends `story-graph` with typed entity, reference, render, execution, and persistence artifacts for Anima-compatible multi-shot generation.

Planning contracts:

- `StoryBible` includes props as first-class story entities.
- Entity-card planning derives characters, outfits, props, and locations from the Story Bible, storyboard shots, and character continuity graph.
- Shot planning may include `appearanceState`, `interactionState`, and `locationViewState`.
- LLM outputs should be structured JSON. Local code validates ids, enum values, required fields, referential integrity, and recoverable error states.
- Local code must not infer references from string matching, crop generated shots to create identity references, perform consistency scoring, or add ControlNet, pose, or depth requirements in v1.

Reference asset-plan contracts:

- Reference assets carry importance `required`, `recommended`, or `optional`.
- Reference resolution states are `missing`, `generated`, `uploaded`, `approved`, `failed`, `rejected`, and `prompt-only`.
- Reference assets include canonical prompt text, rationale, source entity or shot ids where applicable, candidate asset references, approved asset references, and user decisions.
- Main character face/bust identity references are required by default. High-frequency or story-critical outfit references are planned by default. Prop and location references are optional or planned by default.
- Reference plate generation uses selected Anima-compatible ComfyUI resources and creates one candidate per plate by default.
- Workflow state stores reference metadata and asset references only; it must not persist generated bytes, caches, logs, local model data, or secrets.

Gate and review contracts:

- Final Story generation is blocked when any required reference is unresolved, failed, generated but unapproved, uploaded but unapproved, or missing.
- A required reference is resolved only when approved or explicitly set to prompt-only fallback.
- Optional references may be rejected without blocking final generation.
- Canonical prompt edits stale reference generation, render plans, and generation gate state.

Render and execution contracts:

- `StoryRenderPlanShot` may include a `referenceRecipe` describing intended reference use.
- `locationContinuity.mode` is `prompt-only`, `source-image`, or `inpaint-preferred`.
- Only `source-image` creates an executable img2img/source-image dependency. `prompt-only` and `inpaint-preferred` do not pass a source shot to execution.
- `inpaint-preferred` is advisory in v1 and must not trigger automatic masks, repair, or inpaint execution.
- Approved character identity and outfit references may become Anima `characterReferences` only when selected resources are Anima-compatible and required IPAdapter nodes are available.
- Missing IPAdapter support must visibly degrade to prompt-only with install guidance and must omit reference injection rather than silently failing.
- Prop and location references remain visible anchors and are not injected into full-image generation by default in v1.

Persistence contracts:

- Story Reference persistence saves new artifacts, asset references, approval states, prompt-only fallback decisions, render recipes, continuity modes, and gate state.
- Old Story Graph workflow records must load and stale downstream reference, render, and gate nodes as needed instead of pretending references exist.
- Interrupted reference generation restores as a recoverable error.

## LLM and AI Node Adapter Rules

Existing LLM-facing behavior should be reused before adding new calls:

- Scene prompt inference should reuse the LiteLLM chat boundary and existing prompt-generation prompt patterns where possible.
- Character tag inference should reuse existing prompt-library/tag and prompt binding concepts where possible.
- Character action inference should reuse the existing stick-figure pose generation interface and parser where possible.
- Checkpoint/LoRA recommendation should reuse Civitai recommendation logic and local candidate loading.
- Civitai recommendation candidate search uses rebuildable derived indexes over local `model` and `lora` resources: SQLite FTS5 for BM25 keyword ranking and sqlite-vec for embedding similarity. BM25 and embedding retrieval rank candidates independently, then merge with fixed Reciprocal Rank Fusion before the existing LLM selection step. The embedding index stores overlapping chunks of each resource's full FTS source text, and semantic ranking uses each resource's nearest chunk distance. If either derived index, sqlite-vec, or `LITELLM_CIVITAI_EMBEDDING_MODEL` is missing or unusable, the API should return an actionable error instructing the user to configure embeddings and run `npm run civitai:reindex` followed by `npm run civitai:reindex-embeddings`; request handlers must not perform reindexing.
- Parameter recommendation should reuse existing ComfyUI generation parameter parsing and controls.

Implementation expectations:

- Prefer shared feature-module adapters that preserve `/api/llm/chat` validation, logging, model selection, and NSFW behavior.
- Avoid server-to-server HTTP calls back into Next.js routes when shared feature modules can provide the same behavior.
- If an existing LLM interface lacks a required prompt or output shape, extend that interface deliberately and update tests.
- LLM output must not be trusted for local file or model availability. Resource nodes must select from validated local candidates.
- Each graph node adapter should be testable with mocked LLM responses and without live network calls.

## Timeline UI Contract

- Initial view contains only a scene request input, a start button, and settings entry.
- After submission, render a vertical timeline from top to bottom.
- Reuse existing editor visual language: light shell, slate borders, compact controls, lucide icons, and existing parameter controls where possible.
- Extract shared timeline primitives before duplicating UI: `TimelineNodeCard`, `TimelineNodeStatus`, `TimelineNodeEditor`, `TimelineAiRetry`, and resource/parameter selectors where useful.
- Every node must show current status, generated output, user edit controls, and an AI suggestion or retry affordance.
- The 3D canvas node should reuse existing 3D canvas and skeleton controls rather than adding a separate custom canvas.

## Timeline Persistence Contract

The active timeline workflow is autosaved separately from the editor project-management UI. The persistence record is a versioned `sceneforge-timeline-workflow` JSON document stored under `data/timeline-workflows/active-workflow.json` by default. It is exposed through `/api/agent-timeline/active-workflow` for load, save, and clear operations.

Named timeline workflow records use the same versioned record shape with optional `projectId` and `name` metadata. They are stored as separate JSON files under `data/timeline-workflows/` and exposed through `/api/agent-timeline/workflows` for list/save plus `/api/agent-timeline/workflows/item?id=...` for open/rename/delete. Named workflow ids must be simple local ids and storage code must reject malformed ids, path traversal, and the reserved `active-workflow` id.

The active record includes workflow id, workflow mode, definition version, created/updated timestamps, selected node, display mode, scene request, prompt profile, image count or story shot count, node statuses, node outputs, node errors, manual/stale state, selected resources, generation parameters, generation gate state, execution metadata when present, result references, and canvas binding or story planning state needed to restore the current workflow view.

Story Graph records use the same `sceneforge-timeline-workflow` envelope with `workflow.workflowMode: "story-graph"`. They persist story input, planning artifacts, selected Story node, selected shot id, visual/raw JSON display modes, generation gate state, shot execution statuses, safe queue/history metadata references, preview result references, final result references, and Story style reference metadata/analysis/settings snapshots. Preview references and final result references must remain separate. Generated image bytes, style reference data URLs, downloaded model files, cache payloads, logs, SQLite/resource database contents, and secret-like fields are not valid persisted workflow data.

Restore rules:

- Route changes to Settings and back should restore the same active workflow.
- Page reload should restore the active workflow when the record exists.
- Autosave should run after meaningful workflow state changes without requiring project list/open/save UI.
- The Run header should expose saved workflow project management: save the current active workflow, open another saved workflow, rename the current named workflow, refresh the list, and delete saved workflow records.
- The Story header should expose the same local workflow project management for `story-graph` records while filtering out `single-image` records. The Run header should filter out `story-graph` records.
- `Save` updates the current named workflow when one is open. If the active workflow is unnamed, `Save` creates a named workflow using the scene request or a timestamp fallback.
- Deleting the current named workflow must keep the active in-memory and autosaved workflow open as an unnamed draft.
- Persisted `running` nodes and `running` or `queued` Story Graph shots must restore as visible recoverable errors so the UI does not imply that interrupted background work continued reliably.
- Restored generation gate state must not trigger ComfyUI execution without explicit user confirmation unless the record already represents a completed confirmed execution.
- Persistence must redact secret-like fields and must not store `.env.local` values, API keys, generated cache payloads, downloaded model files, generated bytes, local resource databases, or local logs.

## Settings Contract

The MVP needs a settings page or settings route that holds configuration away from the main workflow.

Required setting areas:

- NSFW mode.
- Project storage path.
- Prompt library path.
- Generated image storage path.
- ComfyUI temp directory path.
- Civitai LoRA, checkpoint, diffusion model, and ControlNet resource paths and status where applicable.
- ComfyUI connection status.
- LiteLLM configuration status.

Security and runtime rules:

- `.env.local` remains local only and must not be committed.
- API keys and secrets remain server-only unless a later scoped issue adds secure runtime secret editing.
- The settings UI may show whether a secret is configured, but must not echo the secret.
- Path updates must validate absolute paths, reject traversal, and avoid deleting or moving user data.

## ComfyUI Execution Contract

Timeline execution should convert the confirmed graph state into the existing `ComfyUiTextToImageRequest` contract:

- Required: `checkpointName`, `positivePrompt`.
- Optional: `negativePrompt`, `loras`, `width`, `height`, `seed`, `steps`, `cfg`, `samplerName`, `scheduler`, `denoise`, `batchSize`, `latentImageNode`, `promptWrapper`, `outputPrefix`.
- Optional workflow metadata: `modelBaseModel`, `modelStorageKind`, `clipName`, `clipDevice`, `vaeName`, and `unetWeightDtype`.
- Text-to-image workflow construction is profile-based. The default profile preserves the existing `CheckpointLoaderSimple` workflow. The Anima profile is selected only when the model metadata or file name identifies Anima, and builds `UNETLoader -> CLIPLoader/VAELoader -> optional LoraLoader -> EmptyLatentImage -> KSampler -> VAEDecode -> PreviewImage` without `CheckpointLoaderSimple`.
- Unknown or non-Anima diffusion models currently fall back to the default profile until a later scoped task adds explicit support.

Execution should reuse the current single-image path:

1. Validate request shape with `validateComfyUiTextToImageRequest`.
2. Read ComfyUI `object_info` and validate model/node compatibility with `validateComfyUiRequestAgainstObjectInfo`.
3. Queue `buildBasicTextToImageWorkflow` through `createComfyUiClient().generateImage`.
4. Return queue metadata compatible with existing ComfyUI responses: `clientId`, `promptId`, `number`, `nodeErrors`, `workflow`, `nodeIds`, `outputNodeId`, `warnings`, and sanitized resolved `request`.
5. Read completion through existing history or event helpers when needed.

Run single-image definition v2 executes `generation-gate → preview-execution → preview-scoring → comfyui-execution → result-display`. K is 1-4 for txt2img and img2img and maps to candidate pools 4/4/6/8. Each preview is a batch-size-1 request with a materialized base seed plus candidate index, disabled Detailers, and formal CFG/sampler/scheduler/context retained. Balanced policy derives from the authoritative request profile/base model: Illustrious and fallback cap formal steps at 16, Anima at 18, and all use longest-edge 768. Dimensions already within 768 remain unchanged and are never upscaled. Larger integer inputs are reduced by their greatest common divisor, then use the largest common multiplier that keeps both axes 8-pixel aligned and within 768, preserving the formal aspect ratio exactly; for example, 832×1216 becomes 520×760. If no exact aligned multiplier fits an extreme ratio, request construction fails closed with an actionable validation error instead of independently rounding or stretching either axis. Source-img2img previews use the original source and Composer denoise.

`single-image-preview-scoring` sends all successful candidate images in one multimodal request, strictly validates exact candidate coverage and finite 0-100 rubric values, computes weighted totals locally at 30/25/20/15/10, and sorts by total, composition, then candidate index. The identical request is attempted at most twice. Ordinary Runs route to `LITELLM_VISION_MODEL` with default fallback; NSFW Runs require `LITELLM_NSFW_MODEL` and fail closed when it is unavailable or not multimodal.

Final execution uses each selected preview as the only img2img source, restores formal dimensions/steps/CFG/sampler/scheduler/resources/style context and Detailers, and reuses the candidate seed. Balanced final denoise is 0.60 for Illustrious and 0.65 for Anima or unknown/default fallback without mutating the formal parameter result. History extraction accepts only the queued workflow's declared output node. A fresh final with the same managed content hash as its input preview becomes a recoverable no-op error, while previously successful partial-final records remain reusable. Final records preserve candidate linkage and each candidate's unique global scoring rank within the preview pool, so a Detailed K=2 selection may legitimately retain ranks 1 and 3. Partial success is stored as safe structured state and a final retry executes only missing or failed selections. Preview and final persisted state contains generated-image references rather than bytes, data URLs, local paths, or full ComfyUI workflows.

Confirmation persists a server-signed HMAC-SHA-256 fingerprint of a domain-separated, versioned canonical Run generation contract. The contract binds the workflow ID plus scene input/source/NSFW/settings, prompt, tags, action, canvas, resources, and parameters, so confirmation cannot be replayed across otherwise identical Runs. Every continuation or phase retry recomputes and timing-safely compares this fingerprint after workflow sanitization; clients cannot mint a valid replacement, and missing legacy fingerprints, server restarts, or any contract mismatch require explicit reconfirmation. Persisted v2 preview, scoring, partial-final, final, and result-display records use typed validation. Restored scoring must cover every successful preview exactly once, recomputes raw weighted totals, and verifies each persisted rank against the fixed raw-total, composition, then preview-index ordering. AI selection must equal the ordered top K; manual selection may choose any valid exact-K subset. Image records additionally use the shared ComfyUI path-safe reference and managed generated-image filename/URL contract. Invalid scoring or `done` image references become recoverable errors and are never displayed or reused as completed retry inputs.

The confirmation endpoint accepts an explicit preview, scoring, or final stage. Simple mode confirms and executes preview first, merges that persisted workflow, then continues scoring and final rendering in separate requests; the final-stage request also resolves result display. The server verifies the confirmation fingerprint and target dependencies on every continuation, rejects skipped stages, and scopes retries to their requested stage before the client advances through only the remaining downstream stages. The UI marks each stage running before its request and retains partial/failure state after each response; every preview/scoring/final error exposes an in-place retry, and partial final state reports the safely stored count. Background jobs and streaming phase events remain out of scope.

Out of scope for MVP execution:

- Inpainting.
- Sequence/comic generation.
- ControlNet.
- Upscaling.
- Multiple independent scene requests or arbitrary multi-workflow batch queues; one Run scene may still produce 1-4 txt2img outputs.
- Full ComfyUI graph editing.

## Image Storage Behavior

- Agent-generated images may be saved with the existing generated image storage route/helper after ComfyUI returns an image reference.
- `storeGeneratedImage` writes content-addressed image files under `SCENEFORGE_GENERATED_IMAGES_DIR` or `data/comfyui-generated-images/` and returns `{ byteLength, contentType, filename, url }`.
- Whether a timeline result is bound to project history must be decided in the scoped execution issue. Do not silently mutate current project history from timeline MVP code.
- If Agent later needs durable draft history or timeline replay, that should be a separate persistence contract.

## Error Taxonomy

Use stable categories in timeline responses while preserving useful upstream details:

- `timeline_request_invalid`: malformed timeline action payload.
- `timeline_node_blocked`: requested node cannot run because dependencies are incomplete.
- `timeline_node_stale`: requested confirmed output depends on stale upstream data.
- `timeline_node_failed`: graph node failed after validation.
- `llm_config`: missing LiteLLM base URL or model configuration.
- `llm_upstream`: LiteLLM request failed with an upstream status or network/runtime error.
- `llm_malformed_response`: LiteLLM completed but did not return usable chat content.
- `resource_selection_invalid`: selected checkpoint or LoRA is missing, wrong type, unavailable, or outside local candidate set.
- `confirmation_required`: execution requested before explicit user confirmation.
- `comfyui_request_invalid`: confirmed payload does not satisfy `ComfyUiTextToImageRequest`.
- `comfyui_object_info_mismatch`: selected checkpoint, sampler, scheduler, LoRA, or required node does not match current ComfyUI `object_info`.
- `comfyui_workflow_build_failed`: the confirmed request passes initial validation but cannot be converted into the expected single-image workflow.
- `comfyui_upstream`: ComfyUI queue/history/view request failed.
- `comfyui_execution_failed`: queued workflow reported execution failure through history or events.
- `image_storage_invalid`: generated image reference, content type, byte size, or filename is invalid.
- `image_storage_failed`: local generated-image write/delete/read failed unexpectedly.
- `timeline_unexpected`: an unclassified timeline backend failure; responses should use a safe generic message while server logs preserve diagnostics.

## Environment Variables

Source of truth: `.env.example`.

- LiteLLM: `LITELLM_BASE_URL`, `LITELLM_API_KEY`, `LITELLM_DEFAULT_MODEL`, `LITELLM_NSFW_MODEL`, `LITELLM_VISION_MODEL`, `LITELLM_CLASSIFICATION_MODEL`, `LITELLM_CIVITAI_RECOMMENDATION_MODEL`, `LITELLM_CIVITAI_EMBEDDING_MODEL`, `LITELLM_COMFYUI_DIAGNOSIS_MODEL`. Requests marked `nsfw` use `LITELLM_NSFW_MODEL` if configured. NSFW Run preview scoring requires that model to accept multimodal image input and has no ordinary-model fallback. Ordinary Run preview scoring uses `LITELLM_VISION_MODEL`, then the default. Story style reference analysis uses the `story-style-reference-analysis` purpose and falls back to `LITELLM_VISION_MODEL`, then the default model, when no explicit model is provided; Civitai vector reindexing and semantic retrieval use the embedding model; timeline model-resource and render-parameter recommendation nodes keep their purpose-specific models.
- Tavily: `TAVILY_API_KEY`, `TAVILY_BASE_URL`.
- ComfyUI: `COMFYUI_BASE_URL`, `COMFYUI_API_KEY`, `COMFYUI_TEMP_DIR`.
- SceneForge: `SCENEFORGE_SHOW_NSFW_BUTTON`, `SCENEFORGE_SQLITE_FILE`, `SCENEFORGE_PROJECTS_DIR`, `SCENEFORGE_GENERATED_IMAGES_DIR`, `SCENEFORGE_PROMPT_LIBRARY_FILE`, `SCENEFORGE_LLM_LOG_DIR`, `SCENEFORGE_LLM_LOG_RETENTION_DAYS`, `SCENEFORGE_LLM_LOG_FILE`.

Rules:

- `.env.local` is local only and must not be committed.
- Server-only variables must remain in API routes or server-side modules.
- Optional integrations must degrade gracefully when variables are absent.
- Settings UI should reflect configuration status without exposing secrets.

## Local Data and Persistence

Default runtime paths:

- `data/projects/`: local project JSON files.
- `data/prompt-library.json`: shared custom prompt library and hidden built-in ids.
- `data/prompt-bindings.json`: shared prompt binding defaults.
- `data/sceneforge.sqlite`: local SQLite data.
- `civitai_resource_search_fts`: rebuildable SQLite FTS5 derived index inside the SceneForge SQLite database; rebuild manually with `npm run civitai:reindex` after Civitai resource metadata changes.
- `civitai_resource_embedding_vec` and `civitai_resource_embedding_index_metadata`: rebuildable sqlite-vec derived embedding index and metadata inside the SceneForge SQLite database; the vector table stores chunk-level rows with `resource_id`, `resource_type`, `chunk_index`, source fingerprint, and chunk fingerprint metadata. Metadata includes the chunked schema version, chunk size/overlap, embedding model, dimensions, and a deterministic fingerprint of ordered full FTS `resource_type`/`resource_id`/`search_text` source rows. Rebuild manually with `npm run civitai:reindex-embeddings` after the FTS index exists and after Civitai resource metadata or `LITELLM_CIVITAI_EMBEDDING_MODEL` changes.
- `data/comfyui-sequence-references/`: uploaded sequence reference images reused by editor sequence IPAdapter paths and Story global style references.
- `data/civitai-lora-library/`: Civitai runtime cache and downloads.
- `data/comfyui-generated-images/`: locally stored generated images.
- `data/logs/llm/<category>/<YYYY-MM-DD>.jsonl`: default split local LLM interaction logs. Supported categories include `chat`, `civitai-enrichment`, `civitai-recommendation`, `story-planning`, and `misc`. `SCENEFORGE_LLM_LOG_DIR` changes the split-log root and accepts `off` to disable split local logging when `SCENEFORGE_LLM_LOG_FILE` is unset. `SCENEFORGE_LLM_LOG_RETENTION_DAYS` defaults to `14` and accepts `off` to keep logs until manual deletion, and the legacy `SCENEFORGE_LLM_LOG_FILE` path writes one file instead of split logs. `SCENEFORGE_LLM_LOG_FILE=off` disables local LLM logging.

Do not commit generated projects, logs, caches, databases, downloaded assets, or generated images.

## Testing Priorities

Prioritize tests for:

- LangGraph node dependency execution and stale downstream regeneration.
- LLM node adapters with mocked completions.
- Prompt parsing and character tag normalization.
- 3D canvas binding and pose state updates.
- Project serialization and migration behavior when timeline data becomes persistent.
- Local disk and SQLite persistence boundaries.
- ComfyUI workflow construction and response normalization.
- Civitai parsing, normalization, downloads, cache repair, and recommendations.
- API route validation and error handling.
- Settings path validation and secret redaction.

Bug fixes should include a regression test when practical. Browser or canvas behavior should combine unit tests with manual or browser-based verification.
