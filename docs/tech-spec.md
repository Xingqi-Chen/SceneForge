# SceneForge Technical Specification

## Stack

- Framework: Next.js App Router.
- UI: React, TypeScript, Tailwind CSS, lucide-react icons, local UI primitives.
- Editor state: Zustand.
- 2D canvas: Konva and React Konva.
- 3D viewport: Three.js, React Three Fiber, and Drei.
- Tests: Vitest with jsdom.
- Lint/type validation: ESLint and TypeScript `tsc --noEmit`.
- Image processing/runtime helpers: Sharp and local Node APIs inside server-side modules.

## Runtime Shape

SceneForge is a local-first web application:

- Client components render the editor and manage interactive canvas state.
- Next.js API routes provide local disk persistence and integration boundaries.
- Server-side feature modules read environment variables and talk to local or external services.
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
- `src/shared/`: shared project/scene types and pure utilities.

## Module Boundaries

- Client UI must not import `node:fs`, `node:path`, server-only storage modules, or server-only environment variables.
- API routes should validate request payloads, call feature modules, and return normalized responses. Keep reusable logic out of route handlers.
- Prompt generation should consume typed scene/project data and remain deterministic whenever no LLM is involved.
- Persistence modules own serialization, migration, path resolution, and local file safety.
- External service clients must accept injectable fetchers where practical so tests can avoid live network calls.
- Editor store actions are the main mutation boundary for project state. Avoid ad hoc mutation from components.

## Core Data Model

The current domain model lives in `src/shared/types/`.

Important types:

- `SceneForgeProject`: project id, name, version, `Scene`, project settings, and timestamps.
- `Scene`: canvas settings, mode, 3D config, objects, characters, and scene prompt tags.
- `SceneObject`: 2D object data plus optional 3D transform for primitives.
- `CharacterSkeleton`: 2D joints, optional 3D transform, optional 3D stick-figure pose, body parts, and prompt tags.
- `PromptTag`: label, prompt text, category, optional subcategory, weight, and negative flag.
- `ProjectSettings`: prompt format, spatial hints, NSFW support, selected Civitai and artist resources, ComfyUI generation settings, prompt library overrides, and generated image history.

Serialization rules:

- Preserve backwards compatibility when changing project data.
- Sanitize imported project data before it enters editor state.
- Keep shared prompt-library data separate from project-specific data unless explicitly exported.

## API Surface

Key route groups:

- `/api/projects`: local project listing and save/load/delete operations.
- `/api/prompt-library` and `/api/prompt-bindings`: shared prompt library and target binding state.
- `/api/llm/chat`: LiteLLM-compatible chat endpoint.
- `/api/agent/draft`: standalone Agent single-image draft endpoint backed by LiteLLM; it returns editable drafts and does not call ComfyUI.
- `/api/comfyui/*`: workflow generation, queue/history/view helpers, image generation, inpainting, control models, upscale models, generated images, sequence references, events, and diagnosis.
- `/api/civitai-lora-library/*`: resources, selected resources, settings, import image parsing, imported images, downloads, cache repair, and AI recommendation.
- `/api/artist-string-library/*`: sync, selected resources, items, and images.

Route expectations:

- Validate input at the edge.
- Avoid leaking secrets or absolute local paths in responses unless explicitly needed for local file access.
- Normalize external service errors into user-actionable responses.
- Use configured storage roots and reject path traversal.

## Agent Single-Image Backend Contract

This contract covers T1 conclusions for the future standalone `/agent` single-image MVP. The Agent flow is independent from the editor workspace: it must not read the current canvas, project summary, editor store, generated-image history, or prompt panel state.

### Reuse Assessment

- LiteLLM can be reused through `src/features/llm` (`createLiteLlmClient`, `LlmChatRequest`, validation, and `LiteLlmError`). T2 should add an Agent-specific draft schema/parser around the chat response instead of weakening the generic chat contract.
- ComfyUI single-image execution can reuse `src/features/comfyui` (`validateComfyUiTextToImageRequest`, `validateComfyUiRequestAgainstObjectInfo`, `buildBasicTextToImageWorkflow`, and `createComfyUiClient().generateImage`). T3 may add a thin Agent route/service wrapper, but should not build a new workflow selector.
- Generated image file storage can reuse `src/features/comfyui/generated-image-storage` and `/api/comfyui/generated-images`. That storage is file-based and not project-bound by itself. Project history binding happens separately through editor store actions and must not be used by Agent MVP.
- Existing API routes are useful compatibility references, but new server code should prefer shared feature modules over making server-to-server HTTP calls back into Next.js routes.

### Draft Contract

T2 draft generation should accept only standalone Agent input, for example:

```ts
type AgentSingleImageDraftRequest = {
  userRequest: string;
  model?: string;
  nsfw?: boolean;
  generationDefaults?: Partial<
    Pick<
      ComfyUiTextToImageRequest,
      | "checkpointName"
      | "negativePrompt"
      | "loras"
      | "width"
      | "height"
      | "steps"
      | "cfg"
      | "samplerName"
      | "scheduler"
      | "denoise"
      | "batchSize"
      | "latentImageNode"
      | "promptWrapper"
      | "outputPrefix"
    >
  >;
};
```

The draft response should be structured JSON that can be edited before execution:

```ts
type AgentSingleImageDraftResponse = {
  draftId: string;
  status: "draft";
  title?: string;
  positivePrompt: string;
  negativePrompt: string;
  comfyUiRequest: Partial<ComfyUiTextToImageRequest> & {
    positivePrompt: string;
    negativePrompt?: string;
  };
  confirmationRequired: true;
  warnings: string[];
};
```

The LLM may draft prompt text and optional rationale, but backend code must validate and normalize the JSON. Fields that determine model availability or local files, especially `checkpointName` and `loras`, should come from explicit standalone Agent inputs or validated UI choices rather than untrusted LLM invention.

### Confirmation Gate

- Draft generation must never call ComfyUI, ComfyUI history/events, ComfyUI image view, generated image storage, or editor store actions.
- ComfyUI execution requires an explicit confirmation request from the user after the draft is visible and editable.
- The execution boundary should require a confirmed payload, such as `confirmed: true`, plus the final `ComfyUiTextToImageRequest` fields.
- Missing confirmation is a backend validation failure and must stop before any ComfyUI client or storage code is constructed.

### ComfyUI Execution Input and Output

T3 execution should convert the confirmed draft into the existing `ComfyUiTextToImageRequest` contract:

- Required: `checkpointName`, `positivePrompt`.
- Optional: `negativePrompt`, `loras`, `width`, `height`, `seed`, `steps`, `cfg`, `samplerName`, `scheduler`, `denoise`, `batchSize`, `latentImageNode`, `promptWrapper`, `outputPrefix`.
- Out of scope for Agent single-image MVP: inpainting, Sequence, ControlNet, character references, SAM masks, upscaling, and editor/project state mutation.

Execution should reuse the current single-image path:

1. Validate request shape with `validateComfyUiTextToImageRequest`.
2. Read ComfyUI `object_info` and validate model/node compatibility with `validateComfyUiRequestAgainstObjectInfo`.
3. Queue `buildBasicTextToImageWorkflow` through `createComfyUiClient().generateImage`.
4. Return queue metadata compatible with existing ComfyUI responses: `clientId`, `promptId`, `number`, `nodeErrors`, `workflow`, `nodeIds`, `outputNodeId`, `warnings`, and sanitized resolved `request`.
5. Read completion through existing history or event helpers when needed.

### Default Workflow and Seed

- Agent MVP uses the existing default single-image workflow from `buildBasicTextToImageWorkflow`.
- The workflow uses `CheckpointLoaderSimple`, optional LoRA loaders, `CLIPTextEncode`, the default latent image node, `KSampler`, `VAEDecode`, and `PreviewImage`.
- Existing defaults remain authoritative: `1024x1024`, `steps: 30`, `cfg: 7`, `samplerName: "euler"`, `scheduler: "normal"`, `denoise: 1`, `batchSize: 1`, `outputPrefix: "SceneForge"`, face/hand detailers disabled, no ControlNet units, and no character references unless a later scoped issue changes that.
- Seed behavior must be inherited from `resolveComfyUiTextToImageRequest`: if `seed` is omitted, the runner creates a random safe integer in the existing range. Agent code must not introduce a second seed default or seed mode.

### Image Storage Behavior

- Agent-generated images may be saved with the existing generated image storage route/helper after ComfyUI returns an image reference.
- `storeGeneratedImage` writes content-addressed image files under `SCENEFORGE_GENERATED_IMAGES_DIR` or `data/comfyui-generated-images/` and returns `{ byteLength, contentType, filename, url }`.
- Saving an Agent image must not append `SavedComfyUiGeneratedImage` records to `project.settings.comfyUiGeneratedImages`, must not touch `useEditorStore`, and must not bind results to the current project.
- If Agent later needs a gallery or durable draft history, that should be a separate non-editor storage contract.

### Error Taxonomy

Use stable categories in Agent route responses while preserving useful upstream details:

- `agent_request_invalid`: malformed Agent draft or execution payload.
- `agent_draft_invalid`: LiteLLM returned content that cannot be parsed into the draft schema.
- `confirmation_required`: execution requested before explicit user confirmation; no ComfyUI or storage calls may have happened.
- `llm_config`: missing LiteLLM base URL or model configuration.
- `llm_upstream`: LiteLLM request failed with an upstream status or network/runtime error.
- `llm_malformed_response`: LiteLLM completed but did not return usable chat content.
- `comfyui_request_invalid`: confirmed payload does not satisfy `ComfyUiTextToImageRequest`.
- `comfyui_object_info_mismatch`: selected checkpoint, sampler, scheduler, LoRA, or required node does not match current ComfyUI `object_info`.
- `comfyui_workflow_build_failed`: the confirmed request passes initial validation but cannot be converted into the expected single-image workflow.
- `comfyui_upstream`: ComfyUI queue/history/view request failed.
- `comfyui_execution_failed`: queued workflow reported execution failure through history or events.
- `image_storage_invalid`: generated image reference, content type, byte size, or filename is invalid.
- `image_storage_failed`: local generated-image write/delete/read failed unexpectedly.
- `agent_unexpected`: an unclassified Agent backend failure; responses should use a safe generic message while server logs preserve diagnostics.

### T2/T3 Implementation Boundary

- T2 owns the standalone `/agent` draft flow, Agent draft schema validation, prompt-to-draft LiteLLM call, and editable draft response. T2 must not call ComfyUI or generated image storage.
- T3 owns the explicit confirmation execution path, thin ComfyUI wrapper, completion polling/events, and optional use of generated image storage. T3 must not add Sequence, inpainting, workflow selection, current-project binding, or editor-state mutation.
- Both tracks should keep server modules isolated from client components and keep the editor store as a non-dependency of Agent backend code.

## Environment Variables

Source of truth: `.env.example`.

- LiteLLM: `LITELLM_BASE_URL`, `LITELLM_API_KEY`, `LITELLM_DEFAULT_MODEL`, `LITELLM_NSFW_MODEL`, `LITELLM_CLASSIFICATION_MODEL`, `LITELLM_CIVITAI_RECOMMENDATION_MODEL`, `LITELLM_COMFYUI_DIAGNOSIS_MODEL`.
- Tavily: `TAVILY_API_KEY`, `TAVILY_BASE_URL`.
- ComfyUI: `COMFYUI_BASE_URL`, `COMFYUI_API_KEY`, `COMFYUI_TEMP_DIR`.
- SceneForge: `SCENEFORGE_SHOW_NSFW_BUTTON`, `SCENEFORGE_PROJECTS_DIR`, `SCENEFORGE_GENERATED_IMAGES_DIR`, `SCENEFORGE_PROMPT_LIBRARY_FILE`.

Rules:

- `.env.local` is local only and must not be committed.
- Server-only variables must remain in API routes or server-side modules.
- Optional integrations must degrade gracefully when variables are absent.

## Local Data and Persistence

Default runtime paths:

- `data/projects/`: local project JSON files.
- `data/prompt-library.json`: shared custom prompt library and hidden built-in ids.
- `data/prompt-bindings.json`: shared prompt binding defaults.
- `data/sceneforge.sqlite`: local SQLite data.
- `data/civitai-lora-library/`: Civitai runtime cache and downloads.
- `data/artist-string-library/`: artist library runtime data.
- `data/comfyui-generated-images/`: saved generated images.
- `data/comfyui-sequence-references/`: sequence reference assets.
- `data/logs/`: local LLM interaction logs.

Only intentional placeholders such as `.gitkeep` should be committed from these paths.

## Validation Commands

- `npm test`: run Vitest once.
- `npm run typecheck`: run TypeScript without emit.
- `npm run lint`: run ESLint.
- `npm run build`: verify production build compatibility.
- `npm run dev`: run the local Next.js server for manual/browser verification.

Validation scope:

- Run targeted tests first when touching an isolated module.
- Run `npm run typecheck` after type, API, or model changes.
- Run `npm run build` after route, Next.js config, environment, or framework-boundary changes.
- Use browser verification for visible editor, canvas, responsive, or 3D changes.

## Testing Strategy

Use unit and integration-style Vitest coverage for:

- prompt generation and formatting
- prompt library import/merge/taxonomy behavior
- project serialization and local persistence safety
- editor store transitions and undo behavior
- object placement, marquee selection, 3D placement, and stick-figure solving
- ComfyUI workflow construction, response normalization, and API route validation
- Civitai parsing, normalization, downloads, cache repair, and recommendations
- LLM validation and chat response parsing

Avoid live external service dependencies in tests unless the task explicitly requires them.

## Security and Safety Constraints

- Do not expose API keys to client components.
- Reject path traversal for local files and configured storage directories.
- Do not commit generated local runtime data.
- Do not log prompt payloads or user data unnecessarily.
- Treat imported JSON and external API responses as untrusted.
- Keep NSFW-related UI gated by environment and project settings.

## Agent-Aligned Ownership

- Product scope, Track definition, and issue-ready acceptance criteria: `product-agent`.
- GitHub Issue creation, tracker updates, cross-agent handoff, closeout commit/push/PR creation, and post-merge Issue/branch cleanup: Orchestrator.
- Implementation and technical docs: `dev-agent`.
- Tests and validation reports: `tester-agent`.
- Read-only code and architecture review: `reviewer-agent`.

Changes that cross ownership boundaries should be coordinated by the Orchestrator.
