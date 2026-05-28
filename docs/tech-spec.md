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
- `/api/comfyui/*`: workflow generation, queue/history/view helpers, image generation, inpainting, control models, upscale models, generated images, sequence references, events, and diagnosis.
- `/api/civitai-lora-library/*`: resources, selected resources, settings, import image parsing, imported images, downloads, cache repair, and AI recommendation.
- `/api/artist-string-library/*`: sync, selected resources, items, and images.

Route expectations:

- Validate input at the edge.
- Avoid leaking secrets or absolute local paths in responses unless explicitly needed for local file access.
- Normalize external service errors into user-actionable responses.
- Use configured storage roots and reject path traversal.

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
