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
- Preserve the `/api/llm/chat` logging, validation, and model-selection semantics when wrapping existing LLM calls for LangGraph nodes.

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
| `comfyui-execution` | user confirmation at `generation-gate` | none |
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
- Adapter contracts must support current workflow-scoped single artifacts and future story-scoped or shot-scoped artifacts through explicit artifact scopes. Current single-image execution remains hard-coded until the definition-driven migration track.
- `src/features/agent-timeline/workflow-definitions.ts` exposes the extracted single-image workflow definition data for future migration without changing the current LangGraph registration path.
- `src/features/agent-timeline/resource-plan.ts` owns reusable local resource-plan validation. It selects only validated local candidates, rejects invented or ambiguous resources, and strips model NSFW marker fields from common resource-plan outputs. Resource-plan behavior must not read, depend on, or expose model NSFW markers; NSFW remains content and execution context only.
- `src/features/agent-timeline/story-planning.ts` owns Story Graph resource, parameter, preview, render-plan, and execution-request assembly contracts. Story resource planning reuses the shared local-candidate validator and does not use model NSFW metadata as a filter. Story parameter planning stores formal generation parameters; preview execution options and preview result references are separate from the formal parameter plan and must not write back into it. Story render plans and execution request batches carry NSFW only as content/execution context from the story safety plan.
- `src/features/agent-timeline/story-state.ts` owns Story Graph runtime mutation helpers for story-scoped and shot-scoped manual edits. It reuses common workflow stale propagation for node dependencies and records downstream shot ids for shot dependency graph edits without staling unrelated shot branches.
- `src/features/agent-timeline/components/StoryPlanningWorkspace.tsx` owns inactive Story Graph planning workspaces for storyboard shots, story safety, shot dependencies, plot state, character continuity, and story-scoped shared JSON nodes. `src/features/agent-timeline/components/StoryPlanningPreview.tsx` mounts those workspaces at `/story` with in-memory sample artifacts so the planning surface is inspectable before later route, persistence, and execution tracks wire real story generation.

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

The active record includes workflow id, created/updated timestamps, selected node, display mode, scene request, prompt profile, image count, timeline node statuses, node outputs, node errors, manual/stale state, selected resources, generation parameters, generation gate state, ComfyUI execution metadata when present, result references, and canvas binding state needed to restore the current timeline view.

Restore rules:

- Route changes to Settings and back should restore the same active workflow.
- Page reload should restore the active workflow when the record exists.
- Autosave should run after meaningful workflow state changes without requiring project list/open/save UI.
- The Run header should expose saved workflow project management: save the current active workflow, open another saved workflow, rename the current named workflow, refresh the list, and delete saved workflow records.
- `Save` updates the current named workflow when one is open. If the active workflow is unnamed, `Save` creates a named workflow using the scene request or a timestamp fallback.
- Deleting the current named workflow must keep the active in-memory and autosaved workflow open as an unnamed draft.
- Persisted `running` nodes must restore as visible recoverable errors so the UI does not imply that interrupted background work continued reliably.
- Restored generation gate state must not trigger ComfyUI execution without explicit user confirmation unless the record already represents a completed confirmed execution.
- Persistence must redact secret-like fields and must not store `.env.local` values, API keys, generated cache payloads, downloaded model files, or local logs.

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

Out of scope for MVP execution:

- Inpainting.
- Sequence/comic generation.
- ControlNet.
- Upscaling.
- Multiple output images or batch queues.
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

- LiteLLM: `LITELLM_BASE_URL`, `LITELLM_API_KEY`, `LITELLM_DEFAULT_MODEL`, `LITELLM_NSFW_MODEL`, `LITELLM_CLASSIFICATION_MODEL`, `LITELLM_CIVITAI_RECOMMENDATION_MODEL`, `LITELLM_CIVITAI_EMBEDDING_MODEL`, `LITELLM_COMFYUI_DIAGNOSIS_MODEL`. Requests marked `nsfw` use `LITELLM_NSFW_MODEL` if configured; Civitai vector reindexing and semantic retrieval use the embedding model; timeline model-resource and render-parameter recommendation nodes keep their purpose-specific models.
- Tavily: `TAVILY_API_KEY`, `TAVILY_BASE_URL`.
- ComfyUI: `COMFYUI_BASE_URL`, `COMFYUI_API_KEY`, `COMFYUI_TEMP_DIR`.
- SceneForge: `SCENEFORGE_SHOW_NSFW_BUTTON`, `SCENEFORGE_SQLITE_FILE`, `SCENEFORGE_PROJECTS_DIR`, `SCENEFORGE_GENERATED_IMAGES_DIR`, `SCENEFORGE_PROMPT_LIBRARY_FILE`.

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
- `data/civitai-lora-library/`: Civitai runtime cache and downloads.
- `data/comfyui-generated-images/`: locally stored generated images.
- `data/logs/`: local LLM interaction logs.

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
