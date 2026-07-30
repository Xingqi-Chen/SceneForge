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
- Civitai image parse/import accepts only numeric IDs or exact `/images/<id>` pages on the trusted `.com`/`.red` host allowlist. URLs are never used as fetch targets. Each parse and confirmed import independently queries the fixed Civitai API with exactly `nsfw=X`; this explicit metadata lookup does not read or depend on `SCENEFORGE_SHOW_NSFW_BUTTON`, persisted `supportsNsfw`, or downstream generation context.
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
  | "final-review"
  | "final-repair"
  | "repair-verification"
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
| `final-review` | `comfyui-execution` | none |
| `final-repair` | `final-review` | none |
| `repair-verification` | `final-repair` | none |
| `result-display` | `repair-verification` | none |

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
- T7 appends a ready Run style reference as one opaque segment after resource-aware positive-prompt formatting, including the Krea natural-language renderer. T8 revalidates status/context at confirmation, keeps Anima/unknown requests prompt-only, and uploads an enabled Illustrious reference through the existing sequence-reference helper before `object_info` validation and queueing. Krea uses a distinct Krea 2 Turbo reference-adapter branch: only a selected compatible diffusion checkpoint can expose it after no-queue and queue-time checks for `TextEncodeKrea2OstrisEdit`, `Krea2OstrisEditModelPatch`, their required ports, `LoraLoaderModelOnly`, and exact `krea2_style_reference.safetensors`. A restored or newly enabled Krea adapter remains explicitly selected while no-queue preflight is pending or unavailable, persists a blocking reference status, and can continue prompt-only only after explicit user opt-out; successful preflight restores readiness without losing adapter settings. The branch attaches the stored image only at queue time, keeps Krea adapter timing fixed at 0→1, and rejects rather than silently drops an unavailable adapter. Img2img source upload and style-reference upload remain independent; batch size, source dimensions/denoise precedence, and Hand-before-Face Detailer workflow order are unchanged.
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
- Civitai recommendation candidate search uses rebuildable derived indexes over local `model` and `lora` resources: SQLite FTS5 for BM25 keyword ranking and sqlite-vec for embedding similarity. BM25 and embedding retrieval rank candidates independently, then merge with fixed Reciprocal Rank Fusion before the existing LLM selection step. The embedding index stores overlapping chunks of each resource's full FTS source text, and semantic ranking uses each resource's nearest chunk distance.
- Parse preview is read-only with respect to both derived indexes and never requests embeddings. Confirmed import builds deterministic full FTS search text and overlapping chunks only for selected new resources, prepares their embeddings through the existing LiteLLM client in batches of at most 16, then opens `BEGIN IMMEDIATE`, revalidates the exact FTS/vector/model/dimension/schema/chunk baseline, and atomically commits imported-image, usage, resource/category, FTS, vector, and metadata rows. Existing-resource imports are link-only and preserve stored metadata without an embedding call. Confirmed reanalysis compares deterministic search text, skips embedding and derived writes when unchanged, and otherwise replaces only that resource's FTS/vector rows in the same guarded atomic commit. Conflict merges delete obsolete source-resource FTS/vector rows before metadata is finalized.
- A first import may create compatible FTS/vector tables only when the business library has zero `model`/`lora` rows. A nonempty missing, stale, legacy, or incompatible index, including embedding-model, vector-dimension, schema, chunk-size, or overlap incompatibility, fails without database mutation and directs the user to `npm run civitai:reindex` followed by `npm run civitai:reindex-embeddings`. Provider failures, malformed or non-finite vectors, wrong vector counts, dimension mismatch, and concurrent baseline changes are sanitized and fail before partial database mutation. Recommendation request handlers continue to validate readiness without rebuilding, and ordinary imports never embed the full library.
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

### Run visual-style contract

`RunVisualStyle` is the closed enum `anime | photoreal`, stored in the sanitized single-image scene-input settings snapshot independently from `PromptProfileId`. New Runs and continuable legacy records with no stored value normalize to `anime`. The Simple and Detailed Composer controls share the same state. A style change cancels confirmation and stales from `scene-prompt` through `result-display`, but it must retain explicit checkpoint/LoRA selections, saved generation parameters, source-img2img state, FaceDetailer/HandDetailer settings, and the uploaded style-reference snapshot. Because style-reference analysis is context-bound, a retained snapshot analyzed for the old style blocks reuse until it is reanalyzed, replaced, or removed.

The selected value is explicit input to empty and nonempty Suggest, Rewrite, Scene Prompt, resource recommendation, Style Advice, and style-reference analysis. Prompt-profile rendering exposes one structured `visualStyleAndMedium` section. Local compilation inserts these exact positive strings once in that dedicated section:

- Anime tag profiles: `anime illustration, clean lineart, anime coloring, stylized character design`
- Photoreal tag profiles: `live-action photography, natural skin texture, realistic material response, physically plausible lighting, photographic camera optics`
- Anime Krea: `Rendered as a polished Japanese anime illustration with stylized character design, clean linework, and illustrated shading.`
- Photoreal Krea: `Rendered as a live-action photograph with natural human proportions, realistic skin and material response, physically plausible lighting, and photographic camera optics.`

The matching minimal negative additions are `live-action human photography, documentary photograph, photographic skin texture` for Anime and `anime illustration, manga, cel shading, cartoon character rendering` for Photoreal. Only a strong opposing-domain signal can replace the whole dedicated style/medium section. SceneForge does not globally delete prompt text, and generic photo, realistic, photorealistic, camera/lens, bokeh, or depth-of-field terms are not opposing-domain classifiers by themselves. Photoreal compilation suppresses LLM-authored Illustrious `artistStyle` and Anima `artist` content, but resource-derived checkpoint and LoRA trigger words remain intact.

Preview scoring requires boolean `visualStyleMatch` for every successful candidate and persists the assessed `visualStyle`. Style matching is a hard gate separate from blocking-defect eligibility: only matching candidates may enter automatic or Detailed exact-K selection, and fewer than K matching candidates produces a recoverable scoring error before Final. Final review separately requires a boolean match for every Final; false, missing, malformed, failed, unavailable, or unreconciled assessment keeps that Final unselectable and uses only its already verified `preview-upscale`. Repair verification follows the same rule and never promotes a false or unassessed Repair. Confirmation, retry reuse, persistence, restoration, selection, and result display reconcile the same style identity before reuse. Completed pre-feature history stays displayable as `style-unassessed` without automatic LLM or ComfyUI calls; a continuable pre-feature Run defaults to Anime, requires reconfirmation, and must cross the new Preview assessment gate before Final. Story profile behavior, LiteLLM purpose/model routing, and environment variables are unchanged.

### Empty Run Suggest boundary

Only `suggest` with an effective scene request that is empty after trimming uses `POST /api/agent-timeline/run-scene-suggestion`. The client sends only the selected `promptProfile` and NSFW routing flag. The Node route delegates to a server feature module that loads bounded history, calls the existing LiteLLM client, validates and ranks candidates with pure functions, performs one weighted draw, and attempts the history append. Nonempty Suggest and Rewrite continue through `/api/llm/chat` with their existing message construction, temperatures, response normalization, and downstream staling behavior.

The initial request explicitly asks for exactly six candidates. Each candidate contains one complete `sceneRequest`, structured `compatiblePromptProfiles`, and all eight bounded categorical fingerprint fields. Profile compatibility is validated from that structured marker and never inferred by parsing prompt semantics. Candidate parsing may extract bounded JSON and trim the outer `sceneRequest`, but it does not split, concatenate, normalize internal whitespace, enrich, or reconstruct the semantic text. Duplicate scene or fingerprint identities, missing fields, invalid bounds, and explicit profile mismatches are rejected. Ranking is deterministic for the same candidate order and history: recent fingerprint novelty contributes 50 percent, current-batch diversity 30 percent, and bounded scene completeness 20 percent; deterministic fingerprint/original-index tie breaks follow. Randomness exists only in final selection with weights 50/30/20, normalized to 62.5/37.5 for two candidates, or direct selection for one.

For every mode, both the initial and repair contracts require each candidate to depict exactly one person as the sole visual subject and prohibit multi-person scenes, another person, a couple, group, crowd, or background person. When `nsfw` is false, the sole protagonist must be female and the six candidates use diverse safe settings; campus is one optional possibility rather than a requirement or default. SFW candidates have no 21+ declaration requirement.

When `nsfw` is true, both the initial and single repair prompts require all six candidates to lean clearly adult and NSFW with varied mature intensity across sensual, nude, and erotic concepts without requiring the sole protagonist to be female. The sole depicted person must be explicitly 21 or older, and minors, ambiguous-age or youth-coded subjects or settings, coercion, exploitation, non-consensual sexual content, and unlawful sexual content are prohibited. Before ranking, each NSFW candidate's existing `ageGroup` fingerprint must fully match a bounded English age-label grammar: bare numeric `N+`; `age | ages | aged N` with an optional plus or `years old`; `N years old`; `N-year-old` with an optional adult suffix; explicit adult-prefixed age declarations; or `age | ages` numeric ranges/lists. Every declared number must be 21 or greater. Free text that merely co-occurs with an adult word and number is rejected, as are youth/non-adult tokens including youth, schoolgirl/schoolboy, and preteen labels. Invalid declarations use the existing bounded repair/failure path. This is fingerprint validation only: `sceneRequest` remains opaque LLM-authored text with outer trimming and is not parsed, semantically scored, reconstructed, or rewritten. Person count, background-person exclusion, and SFW protagonist gender remain provider contract instructions because the existing fingerprint schema does not encode those facts reliably; SceneForge does not add keyword validation, history fields, or ranking changes to infer them. NSFW model routing remains `LITELLM_NSFW_MODEL` with `LITELLM_DEFAULT_MODEL` fallback, and SFW/NSFW continue sharing the same bounded history schema.

A malformed response, a response count other than six, or fewer than three usable initial candidates permits exactly one fresh bounded schema-repair request containing only a safe validation summary plus the same profile and fingerprint-only avoidance context. No second repair is permitted. Zero usable candidates produces a safe retryable error and the client restores the pre-request workflow/input. Successful rounds append selected and not-selected valid fingerprints through a serialized atomic write; a write failure returns the selected scene with a nonblocking warning.

`data/agent-timeline-run-suggestion-history/history.json` is a dedicated ignored runtime file with schema version 1. The reader bounds the file at 64 KiB, sanitizes records, and treats missing, corrupt, oversized, or unreadable data as empty. The newest 20 records retain only record schema version, timestamp, `selected | not-selected` disposition, and the eight categorical fingerprints. They never contain `sceneRequest`, prompt text, raw responses, reasoning, resources, secrets, asset references, or Civitai data. Later calls pass at most 20 fingerprint objects as `recentConceptsToAvoid`. Existing configured LiteLLM logs remain a separate diagnostic boundary and may contain request/response content under their established policy. This workflow does not call Civitai FTS/sqlite-vec, ComfyUI, workflow execution, or generated-image storage.

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
- The Krea 2 profile is selected only when normalized Civitai base-model metadata identifies the Krea 2 family (for example `Krea 2` or `Krea-2 Turbo`) and model storage is `diffusion`; filenames and an asserted profile alone cannot select it. Requests that assert `workflowProfile: "krea2"` without that metadata are rejected. Its standard graph is `UNETLoader -> CLIPLoader(type=krea2) -> VAELoader -> optional LoraLoaderModelOnly -> (EmptyLatentImage or LoadImage -> ImageScale -> VAEEncode) -> KSampler -> VAEDecode -> SaveImage`, preserving the fixed model context for both Preview and Final img2img. A verified global reference adds only the profile-specific branch `LoadImage -> LoraLoaderModelOnly(krea2_style_reference.safetensors) -> Krea2OstrisEditModelPatch` and `TextEncodeKrea2OstrisEdit` positive conditioning with the reference image; negative conditioning uses the same Krea encoder without an image. FaceDetailer and HandDetailer are independent additions for Final and compatible Repair requests. They run Hand-before-Face and consume the selected graph's model connection, including the Krea reference patch when present on Final, plus the same Krea CLIP/VAE context. Generic IPAdapter, ControlNet, and entity/character references remain unavailable. The profile pins `qwen3vl_4b_fp8_scaled.safetensors`, `qwen_image_vae.safetensors`, and UNET dtype `default`; `object_info` validation must verify every selected-path node and required input, KSampler/Detailer sampler options, detector models, optional model-only LoRA support, and exact local model-file availability before queueing.
- Unknown diffusion models that are neither Anima nor Krea 2 continue to fall back to the default profile.

Execution should reuse the current single-image path:

1. Validate request shape with `validateComfyUiTextToImageRequest`.
2. Read ComfyUI `object_info` and validate model/node compatibility with `validateComfyUiRequestAgainstObjectInfo`.
3. Queue `buildBasicTextToImageWorkflow` through `createComfyUiClient().generateImage`.
4. Return queue metadata compatible with existing ComfyUI responses: `clientId`, `promptId`, `number`, `nodeErrors`, `workflow`, `nodeIds`, `outputNodeId`, `warnings`, and sanitized resolved `request`.
5. Read completion through existing history or event helpers when needed.

Run single-image definition v4 executes `generation-gate → preview-execution → preview-scoring → comfyui-execution → final-review → final-repair → repair-verification → result-display`. K is 1-4 for txt2img and img2img Runs, including Krea, and maps to candidate pools 4/4/6/8. Each preview is a batch-size-1 request with a materialized base seed plus candidate index, disabled Detailers, formal CFG/sampler/scheduler/context retained, and `min(formal steps, 20)`. Initial fixed-seed execution uses the formal seed as its base. After workflow sanitization and confirmation-fingerprint verification, only the server handling that explicit `preview-execution` retry passes a transient adapter authorization to advance the retained `baseSeed` by `candidateCount`; no retry marker is accepted from or written to workflow persistence. Base and per-candidate seed addition wrap through zero at `Number.MAX_SAFE_INTEGER`, so consecutive authorized retries move through non-overlapping windows. Completed-result inspection does not advance, and normal stale regeneration after prompt/resource changes plus reconfirmation restarts from the newly confirmed formal seed. Random policy always materializes a fresh base. The transient authorization is request-local and outside the persisted workflow and confirmation contract. Preview dimensions use longest-edge 768. Dimensions already within 768 remain unchanged and are never upscaled. Larger integer inputs are reduced by their greatest common divisor, then use the largest common multiplier that keeps both axes aligned and within 768, preserving the formal aspect ratio exactly; ordinary profiles use 8-pixel alignment and Krea uses 16-pixel alignment. If no exact aligned multiplier fits an extreme ratio, request construction fails closed with an actionable validation error instead of independently rounding or stretching either axis. Source-img2img previews use the original source and Composer denoise.

Krea 2 follows the same signed confirmation gate and ordinary staged Run execution. `krea2Sections.environmentAndBackground` is part of the persisted section map and is recognized through canonical and parser-alias keys. Newly generated ordinary character-and-scene responses must include and populate it with supported setting/background content, using the order subject/mood, subject attributes/actions, environment/background, visual style/medium, lighting/color/texture, spatial composition/framing, then locally selected LoRA triggers. The section type and parser remain tolerant of an omitted value for malformed LLM responses and manual-input robustness only; T46 adds no historical-project compatibility branch or migration behavior. Environment/background exclusively owns setting and supported ambient scene details, while spatial composition/framing exclusively owns foreground/midground/background placement, relative scale, atmospheric depth, framing, and subject-background separation or contrast. Krea-only instructions request detailed, faithful prose around 160-240 English words as guidance rather than a local limit: sparse input may remain shorter, and SceneForge does not truncate, reject, pad, repeat, or force a minimum. Presentation or spatial elaboration must stay grounded in supplied facts and must preserve requested subjects, actions, colors, quoted visible text, media, and spatial relationships without adding unsupported concrete scene facts. The authoritative renderer assembles one cohesive paragraph with punctuation-aware section, trigger, and analyzed style-reference boundaries while keeping selected LoRA triggers and the opaque style prompt exact-once; it removes presentation-only boundary collisions such as `.,`, `,,`, `; ,`, and whitespace before punctuation without semantic rewriting. Krea-aware confirmation validates the normalized opaque style segment under the same paragraph-boundary rules. The Krea scene request alone receives a larger structured-response token budget; Illustrious and Anima request and rendering behavior are unchanged. Its scene prompt system instructions keep negative language out of `positivePrompt` and `krea2Sections` while still requesting top-level `negativeSuggestions`. Each suggestion is one concise English undesirable visual concept expressed as a comma-ready noun or adjective fragment, never a sentence, instruction, imperative prohibition, or positive desired outcome; an empty array is valid when the user input justifies no negative concept, and the model must not invent one. Parsing and persistence continue to use the shared normalization without Krea-specific semantic rewriting, rejection, or migration. Unsaved Composer parameters invoke the shared resource-aware Style Advice provider once when available; saved parameters suppress that call. The shared resolver may apply a valid no-source resolution, negative-prompt additions, weights for already selected local LoRAs, and advice rationale, but `CivitaiAiPromptResult.prompt` remains non-authoritative and the locally rendered Krea paragraph is always the request's positive prompt. Source dimensions and Composer source denoise retain precedence. Resolution uses compatible source dimensions, then saved dimensions, then advised dimensions, then the 1024×1024 fallback, and every effective Krea dimension is validated as an exact 16-pixel-aligned value before shared 8-pixel normalization could round it. After all saved/advised/default resolution, Krea formal planning and Preview are normalized to exactly 8 steps, CFG 1, Euler, and simple scheduling in both the displayed parameter result and request preview; the confirmed execution boundary repeats this Preview lock so client or restored request conflicts cannot override it. Krea policy v3 separately resolves Final Conservative to 4 steps/0.12 denoise, Balanced to 4/0.18, and Strong to 6/0.28. These locks do not alter independent Detailer sampler settings. A ready global style reference is compiled exactly once into the Krea prompt before the parameter result is reviewed and remains byte-free in persistence; changing its analysis, context, mode, or adapter settings stales parameter planning and cancels confirmation. Prompt-only Krea generation remains usable without adapter preflight, including after explicit opt-out. Selecting the adapter requires compatible Krea 2 Turbo context, exact timing 0→1, required custom nodes/ports, and the fixed local LoRA at both preflight and queue time; pending or unavailable preflight preserves the explicit selection but blocks generation, and a failed queue-time recheck rejects the request before queueing rather than falling back silently. Krea source img2img uses Composer source denoise in preference to saved parameters for Preview; selected Preview candidates become server-side Lanczos3 `preview-upscale` artifacts and the sole Final img2img sources. The selected candidate seed is reused for its Final. Krea runs the existing bounded Final-review and verification providers and preserves their local recommendation and explicit selection behavior. FaceDetailer and HandDetailer remain disabled in every Preview and may be independently enabled for Final and compatible Repair; both graphs preserve Hand-before-Face ordering. Krea Repair inherits the user's confirmation-bound Detailer choices and ignores diagnosis-proposed Detailer enablement changes, so AI does not control those settings. Default-off Repair retains its signed authorization, durable one-shot parent/request identity, and closed uncertain-queue handling; its base identity also retains sanitized adapter settings while excluding uploaded reference-image transport names. Before any new Krea Repair queues, SceneForge validates the bounded local Lanczos/latent-noise-mask img2img/inpaint graph against `object_info`: required node classes and input ports, KSampler/Detailer sampler options, Detailer detector models, 16-aligned source dimensions, model-only LoRA support, and exact local UNET/CLIP/VAE/LoRA files. Failure yields a persisted `comfyui-unavailable` skipped pair without a Vision diagnosis, upload, or ComfyUI queue; Preview and Final remain selectable. Manual inpaint, ControlNet, entity references, Story, global composition/identity repair, broad masks, extra attempts, and AI planning/control of Detailers remain unavailable. Persistence reconciles Krea repair linkage under the same canonical parent/request/checkpoint identity rules; historic T41 T42-unavailable nodes migrate to a retryable review-only state without an automatic external call. Completed pre-T41 direct records remain read-only with direct provenance, while incomplete direct records are made stale and require a fresh confirmation without invented links.

Krea 2 is Run-only. Story's multi-shot/img2img workflow UI exposes only Illustrious and Anima, and Story input/persistence coercion converts a malformed or legacy Krea profile to Illustrious before planning or execution.

`single-image-preview-scoring` sends all successful candidate images at high detail in one comparative multimodal request together with original intent, intended action/pose, spatial summary, and formal prompt. The 4/6/8 managed preview files are read without mutation and separately transcoded in memory to provider-compatible quality-85 JPEG data URLs, preserving aspect ratio and useful resolution while bounding longest edge at 768; these scoring-only bytes are never stored and final generation continues to read the original managed preview. Read and transcode failures expose only safe candidate/stage diagnostics and never raw bytes, paths, or data URLs. The simplified model contract requires exact candidate coverage, five finite 0-100 scores, and a `criticalDefects` array of allowed category strings; it does not ask the model to decide or echo eligibility. The parser accepts one JSON object wrapped in ordinary prose or Markdown, finite numeric strings, legacy defect objects, and case/space/hyphen category variants only when normalization maps exactly to an allowed enum. It deduplicates known categories, rejects missing/unparseable defect arrays and unknown categories, and assigns canonical safe descriptions. Eligibility is derived locally from a narrow blocking subset: `anatomy_or_structure`, `spatial_physical_contradiction`, and `severe_exposure` block only when they represent an unusable structural failure, unmistakable physical impossibility, or catastrophic unreadable corruption. `gaze_or_action_mismatch` and `subject_scale_or_framing` are non-blocking annotations; missing prompt details, props/contact, and appearance differences belong in dimension scores/rationale rather than eligibility. Eligible candidates sort first by the locally computed 30/25/20/15/10 total, composition, then candidate index; ineligible candidates follow with the same tie-breaks. Selection always returns exact-K from successful scored candidates: when eligible candidates are insufficient, it fills from the highest-ranked ineligible candidates and persists derived safe `eligibleCount`, ordered `fallbackCandidateIds`, and `selectionWarning` while retaining every defect. Manual exact-K selection may also include annotated ineligible candidates. Rubric-v2 persistence accepts legacy soft-only records that conservatively marked those candidates ineligible, recomputes fallback metadata, and continues enforcing exact coverage, rank, selection, and candidate linkage. A restored pre-correction eligible-insufficiency error keeps its preview references but is migrated to an actionable scoring retry without `retryFrom: preview-execution`; retrying rescoring can therefore apply fallback selection to the existing preview round. A first schema failure gets one repair call containing only a bounded safe validation reason; scoring request text and response content are redacted from client console summaries, and raw model output, prompts, or images are never added to persisted diagnostics. Final schema and upstream failures use distinct error codes, and total upstream calls remain capped at two. Ordinary, NSFW, and Krea Preview Scoring use only `LITELLM_DEFAULT_MODEL`; this purpose ignores Vision, NSFW, and request-level model overrides while preserving the true `nsfw` flag. If the default model is absent, scoring fails before a provider call with a safe recoverable `llm_config` error, retains the completed Preview candidates, and does not advance to Final generation. The configured default model must support multimodal image input and have a content policy that permits the ordinary or NSFW images it is expected to score. Final Review, Repair, style-reference analysis, Story, and all other purpose routes are unchanged.

Preview scoring separates provider invocation from response validation. A thrown network/runtime error before a completion is obtained, including a generic fetch `TypeError`, is retried at most once with the same safe request and terminates as `llm_upstream`; it never creates a schema-repair instruction and its raw message is not exposed. Only a received completion that fails JSON/schema validation can authorize the single bounded repair instruction and terminate as `llm_malformed_response`. Mixed attempts are classified by the terminal attempt, total provider calls remain capped at two, and only a safe upstream status code is retained when available.

Final execution resolves the confirmed formal dimensions, reads each selected managed Preview, verifies exact aspect compatibility, applies EXIF orientation, and uses Sharp Lanczos3 to produce an exact-size PNG without crop, padding, independent-axis rounding, or stretch. The resulting candidate-linked managed `preview-upscale` is stored before ComfyUI queueing and is the sole Final img2img source; Illustrious style-reference upload remains separate. `RunSceneInputSettingsSnapshot` stores only the `conservative | balanced | strong` enum; missing, unknown, or numeric values sanitize to default `balanced`. Ordinary Final policy v2 maps Illustrious to 0.30/0.40/0.50 denoise and Anima/fallback to 0.35/0.45/0.55 while retaining formal steps. Krea Final policy v3 maps Conservative to 4 steps/0.12 denoise, Balanced to 4/0.18, and Strong to 6/0.28 while formal planning and Preview remain 8 steps, CFG 1, Euler, and simple. The resolved policy version, resize mode, preset, family, Krea steps when applicable, and denoise are bound into the signed confirmation, gate summary, execution result, and each Final record without mutating source Preview denoise or the formal parameter result. Final requests otherwise restore formal dimensions/CFG/sampler/scheduler/resources/prompts/style context and Hand-before-Face Detailers and reuse the candidate seed. A preset-only mutation preserves valid Preview execution/scoring/selection/seed state, stales only `comfyui-execution` and `result-display`, blocks the gate for reconfirmation, and resumes from Final. Retry reuse requires exact resolved-policy equality, so same-preset partial work is reusable and cross-preset or cross-policy Finals are not. History extraction accepts only the queued workflow's declared output node. A fresh Final with the same managed content hash as its `preview-upscale` becomes a recoverable no-op error. Final records preserve Preview, fallback, Final, seed, candidate, and unique global-rank linkage, so a Detailed K=2 selection may legitimately retain ranks 1 and 3. Completed historical Krea v2 and ordinary policy-v1 results remain read-only displayable; incomplete or confirmed legacy state must be reconfirmed. Persistence accepts only normalized managed references and policy/linkage metadata, never bytes, data URLs, absolute paths, masks, full ComfyUI workflows, secrets, or raw service responses.

Confirmation persists a server-signed HMAC-SHA-256 fingerprint of a domain-separated, versioned canonical Run generation contract. The contract binds the workflow ID plus scene input/source/NSFW/settings, prompt, tags, action, canvas, resources, and parameters, so confirmation cannot be replayed across otherwise identical Runs. Every continuation or phase retry recomputes and timing-safely compares this fingerprint after workflow sanitization; clients cannot mint a valid replacement, and missing legacy fingerprints, server restarts, or any contract mismatch require explicit reconfirmation. Persisted preview, scoring, partial-final, final, and result-display records use typed validation. Restored rubric-v2 scoring must cover every successful preview exactly once, recompute raw weighted totals, validate compatible defect/eligibility semantics and derived fallback metadata, and verify each persisted rank against eligibility, fixed raw total, composition, then preview-index ordering. AI selection must equal the eligible-first ordered Top-K including required annotated fallback; manual selection may choose any successful scored exact-K subset. Rubric-v1 records remain readable for existing restored results but cannot authorize a new final render or manual reselection; users must rerun scoring to obtain current eligibility semantics. Image records additionally use the shared ComfyUI path-safe reference and managed generated-image filename/URL contract. Invalid scoring or `done` image references become recoverable errors and are never displayed or reused as completed retry inputs.

The confirmation endpoint accepts an explicit preview, scoring, or final stage. Simple mode confirms and executes preview first, merges that persisted workflow, then continues scoring and final rendering in separate requests; the final-stage request also resolves result display. The server verifies the confirmation fingerprint and target dependencies on every continuation, rejects skipped stages, and scopes retries to their requested stage before the client advances through only the remaining downstream stages. The UI marks each stage running before its request and retains partial/failure state after each response; every preview/scoring/final error exposes an in-place retry, and partial final state reports the safely stored count. Background jobs and streaming phase events remain out of scope.

Out of scope for MVP execution:

- Inpainting.
- Sequence/comic generation.
- ControlNet.
- Upscaling.
- Multiple independent scene requests or arbitrary multi-workflow batch queues; one Run scene may still produce 1-4 txt2img outputs.
- Full ComfyUI graph editing.

### Krea Final second-pass policy

Krea policy version 3 is isolated from the unchanged ordinary Final policy v2. `resolveTimelineFinalGenerationPolicy` returns v3 only for family `krea2`, with Conservative `{ steps: 4, denoise: 0.12 }`, Balanced `{ steps: 4, denoise: 0.18 }`, and Strong `{ steps: 6, denoise: 0.28 }`; Illustrious, Anima, and fallback continue to resolve their v2 denoise mappings and formal step behavior. Krea formal planning and Preview remain 8 steps, CFG 1, Euler, and simple. Final overwrites only base-sampler steps and denoise, reuses the selected candidate seed, and reads the candidate's policy-version-matched managed `preview-upscale`. Prompts, resources, style-reference binding, Detailers, source Preview denoise, review, and Repair semantics are unchanged.

The confirmation HMAC contract and gate metadata bind the resolved Krea version, preset, family, steps, and denoise. The same resolved identity is stored on the execution result and every Final record; the managed upscale records the matching policy revision. Exact retry requires the candidate, rank, seed, semantic request digest, resolved policy, and upscale identity to match, so v2, incomplete, missing-step, or cross-preset Krea records cannot be reused. Persistence continues to accept completed Krea v2 output for historical display, but incomplete v2 state becomes non-reusable and requires reconfirmation. Ordinary v2 records retain their existing compatibility behavior.

### Run Final Review Contract

Run single-image definition v3 inserts `final-review` between Final ComfyUI execution and result display. `single-image-final-review` accepts exactly 1-4 complete managed `preview-upscale`/Final pairs and sends all pairs in one high-detail multimodal request. It reuses the server-only managed-image path validation and transient quality-85, longest-edge-768 JPEG conversion used by preview scoring. Ordinary review uses `LITELLM_VISION_MODEL` with default fallback; NSFW review requires `LITELLM_NSFW_MODEL`. Request/response logs redact prompt text and image payloads. A received malformed response may cause one safe schema-repair call; upstream failures may retry once without a repair prompt, and total provider calls remain capped at two.

Final-review schema v1 requires finite 0-100 adherence/composition/anatomy/style/technical scores for both variants and exactly one finding for each closed operation `pose | contact | object-count | composition-consistency`. Severity is `none | minor | major | blocking`, scope is `preview-upscale | final | pair`, and `introducedByFinal` is normalized to boolean. Unknown enums, duplicate/missing pairs or operations, invalid references, and incomplete coverage fail validation. SceneForge computes weighted totals and recommendation/default locally: a major/blocking finding introduced by Final chooses `preview-upscale`; every other valid review chooses `final`. Model-authored recommendation and eligibility fields have no authority.

Review failure is represented as a completed safe review artifact with recommendation unavailable, default Final display, both managed variants, and a redacted actionable error, so `result-display` still runs. Retrying `final-review` stales only review/result nodes and reuses existing generation. Per-pair user selection is an enum-only local workflow mutation that preserves node readiness, triggers autosave, and never calls LLM/ComfyUI or stales upstream state. Persistence reconciles candidate/rank/seed and both managed references against verified Final execution; legacy workflows missing `final-review` never start review automatically.

### Run One-Shot Local Repair Contract

Run single-image definition v4 inserts `final-repair` and `repair-verification` after Final review. The generation gate stores the default-off `automaticLocalRepair` authorization and its signed fingerprint covers the complete sanitized settings snapshot. A pair is eligible only when Final review reports a major or blocking `contact` or `object-count` finding scoped to Final and introduced by Final. Disabled, unsupported, ambiguous, or unsafe cases produce an explicit closed skip reason and never queue ComfyUI.

Repair diagnosis uses the redacted `single-image-repair-diagnosis` LiteLLM purpose and accepts exactly one local mask shape only after a closed `cardinality/locality/regionCount` declaration proves one naturally localized region. Missing, ambiguous, global, multiple, or separated targets skip before SAM2, `object_info`, upload, or queue. A single unrotated rectangle or ellipse supplies one bounded box/point target for at most one optional SAM2 refinement, after request and current `object_info` compatibility validation. Missing nodes, queue/history failure, dimension mismatch, empty output, or oversized SAM2 output records a safe skipped refinement and retains only the independently validated structured mask; it never creates or broadens a fallback mask. The server rasterizes the selected mask, measures non-zero coverage before growth, applies no more than 64 pixels of growth, measures coverage again, and rejects empty masks or either coverage above 35%. A successful request preserves the confirmed Final seed, dimensions, checkpoint, LoRAs, prompts, style/IPAdapter context, sampler, scheduler, steps, CFG, and request-local Hand-before-Face Detailers, but always replaces any inherited `outputPrefix` with a bounded Repair-owned prefix derived from the hashed attempt identity. It uses the existing high-resolution inpaint workflow and generated-image storage without mutating Composer settings.

Each eligible pair persists exact parent Final managed metadata plus the reviewed finding/target snapshot. Repair checkpoint version 3 adds a base semantic digest that is stable-canonicalized from the validated confirmed generation request and the trusted Final dimensions and seed. It covers prompt, model and profile selection, LoRA configuration and weights, generation parameters, detailers, ControlNet, style, and IP-Adapter references while excluding the output prefix; only the digest is persisted, never the raw request or prompt. A SHA-256 attempt identity derived from workflow, candidate, parent binding, and that base digest names a server-local checkpoint under `SCENEFORGE_REPAIR_ATTEMPTS_DIR` or `data/agent-timeline-repair-attempts/`; the default runtime directory is ignored by Git. This prevents the same topology from reusing diagnosis or masks after semantic request changes. After diagnosis, SceneForge derives a second digest from the validated diagnosis-adjusted Repair request, excluding transient image and mask identifiers, mask bytes, source-image payloads, and the output prefix. That digest is stored on the Repair attempt and must match before queue submission, history recovery, or managed output storage can be accepted. Before calling ComfyUI, SceneForge atomically creates `queue-started` with the expected output node. It then advances through `queued` (prompt/output node), `output-ready` (history source), and `stored` (managed Repair). Retry and process recovery load both the exact-parent disk checkpoint and the workflow attempt before any queue, reject mismatched attempt/request/output/prompt/source/storage identities, and select only the more advanced compatible state. Only the invocation that created `queue-started` may issue the first queue. A restored `queue-started` means acceptance is uncertain, records the closed `queue-outcome-unknown` reason, disables ordinary Repair retry in Simple and Detailed modes, and directs the user to inspect ComfyUI queue/history; if acceptance cannot be proven, the Repair stays closed while Preview and Final remain usable. Known prompt state recovers history/storage in place and never queues again. Workflow persistence re-derives both digests, the attempt identity, and the output node from trusted Final state. Restore, verification, and promotion also require the repaired pair's top-level source image to exactly match the attempt source image and for both to reference the derived output node. Legacy or incomplete checkpoints and any Final, review, target, prompt, request, output, source-provenance, or managed-image linkage mismatch fail closed; persistence demotes the invalid Repair result while preserving Preview and Final state.

`single-image-repair-verification` sends all available Preview/Final/Repair triples in one high-detail request and permits at most one safe schema-repair attempt. Its schema requires finite scores plus the closed pose, contact, object-count, and composition-consistency findings for every repaired pair. SceneForge ignores model-authored recommendation fields and computes a local recommendation from the validated findings and scores. Repair remains a third stored variant; it is never auto-promoted and becomes selectable only when both its managed image and reconciled verification pair exist. Legacy workflows or authorization/linkage mismatches restore safely with repair disabled and no automatic network calls.

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

- LiteLLM: `LITELLM_BASE_URL`, `LITELLM_API_KEY`, `LITELLM_DEFAULT_MODEL`, `LITELLM_NSFW_MODEL`, `LITELLM_VISION_MODEL`, `LITELLM_CLASSIFICATION_MODEL`, `LITELLM_CIVITAI_RECOMMENDATION_MODEL`, `LITELLM_CIVITAI_EMBEDDING_MODEL`, `LITELLM_COMFYUI_DIAGNOSIS_MODEL`. Requests marked `nsfw` generally use `LITELLM_NSFW_MODEL` if configured. Single-image Run Preview Scoring is purpose-locked to `LITELLM_DEFAULT_MODEL` for ordinary, NSFW, and Krea Runs, preserves `nsfw`, and ignores Vision, NSFW, and explicit model overrides; the default must support multimodal input and have a content policy that permits the content being scored. Story style reference analysis uses the `story-style-reference-analysis` purpose and falls back to `LITELLM_VISION_MODEL`, then the default model, when no explicit model is provided; Civitai vector reindexing and semantic retrieval use the embedding model; timeline model-resource and render-parameter recommendation nodes keep their purpose-specific models.
- Tavily: `TAVILY_API_KEY`, `TAVILY_BASE_URL`.
- ComfyUI: `COMFYUI_BASE_URL`, `COMFYUI_API_KEY`, `COMFYUI_TEMP_DIR`.
- SceneForge: `SCENEFORGE_SHOW_NSFW_BUTTON`, `SCENEFORGE_SQLITE_FILE`, `SCENEFORGE_PROJECTS_DIR`, `SCENEFORGE_GENERATED_IMAGES_DIR`, `SCENEFORGE_REPAIR_ATTEMPTS_DIR`, `SCENEFORGE_PROMPT_LIBRARY_FILE`, `SCENEFORGE_LLM_LOG_DIR`, `SCENEFORGE_LLM_LOG_RETENTION_DAYS`, `SCENEFORGE_LLM_LOG_FILE`.

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
- `civitai_resource_search_fts`: SQLite FTS5 derived index inside the SceneForge SQLite database. Successful ordinary import/reanalysis maintains affected rows atomically; `npm run civitai:reindex` remains the full repair path.
- `civitai_resource_embedding_vec` and `civitai_resource_embedding_index_metadata`: sqlite-vec derived embedding index and metadata inside the SceneForge SQLite database; the vector table stores chunk-level rows with `resource_id`, `resource_type`, `chunk_index`, source fingerprint, and chunk fingerprint metadata. Metadata includes the chunked schema version, chunk size/overlap, embedding model, dimensions, indexed timestamp/count, and a deterministic fingerprint of ordered full FTS `resource_type`/`resource_id`/`search_text` source rows. Successful ordinary import/reanalysis maintains only affected chunks and recomputes global metadata; `npm run civitai:reindex-embeddings` remains the full repair path after FTS rebuild or embedding configuration/schema changes.
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
