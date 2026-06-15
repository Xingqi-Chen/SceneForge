# SceneForge Development Log

This log records dated implementation and documentation work. Keep entries concise and evidence-oriented.

## 2026-06-14

### T21 / Issue #66 Shot Graph Execution Scheduler

Summary:

- Added a Story Graph shot execution scheduler with per-shot status, queue metadata, result references, and recoverable error state.
- Scheduled `StoryExecutionRequestBatch` inputs topologically so independent shots are ready together, source/img2img shots wait for source results, and multi-reference shots wait for all referenced sources.
- Added an injected shot execution adapter boundary that can wrap existing ComfyUI validation, queue, history, and generated image storage helpers without hard-wiring live network calls into scheduler tests.
- Added selected-shot regeneration that marks only the selected shot and downstream dependent shots stale while preserving unrelated branch result references.
- Replaced the old T21-unavailable Story Graph execution placeholder with confirmation-gated scheduler state.
- Added a server-side Story Graph ComfyUI execution adapter that reuses existing text-to-image validation, `object_info` compatibility checks, queueing, history polling, view reads, and generated-image storage helpers behind the scheduler adapter boundary.

Files changed:

- `src/features/agent-timeline/story-execution.ts`
- `src/features/agent-timeline/story-execution.test.ts`
- `src/features/agent-timeline/story-comfyui-execution.ts`
- `src/features/agent-timeline/story-comfyui-execution.test.ts`
- `src/features/agent-timeline/story-input.ts`
- `src/features/agent-timeline/story-input.test.ts`
- `src/features/agent-timeline/story-state.ts`
- `src/features/agent-timeline/story-types.ts`
- `src/features/agent-timeline/story-workflow.test.ts`
- `docs/product-spec.md`
- `docs/tech-spec.md`
- `docs/dev-log.md`

Validation:

- `npm test -- --run src/features/agent-timeline/story-state.test.ts src/features/agent-timeline/story-input.test.ts src/features/agent-timeline/story-comfyui-execution.test.ts src/features/agent-timeline/story-execution.test.ts` passed with 4 files and 22 tests after the confirmation-gate stale regression fix and ComfyUI adapter coverage.
- `npm test -- --run src/features/agent-timeline` passed with 24 files and 158 tests.
- `npm test` passed with 113 files and 823 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings unrelated to this change.
- `npm run build` passed.

### T20A / Issue #77 Story Graph Input and Planning Start Workflow

Summary:

- Added a typed Story Graph start action that normalizes user story input, target shot count, audience rating, NSFW context, and a settings snapshot into `StoryInput`.
- Assembled deterministic, inspectable planning artifacts for Story Graph nodes from user-started input, including story bible, outline, storyboard shots, safety, dependency, plot, continuity, resource, parameter, render, consistency, gate, execution, and result placeholders.
- Updated `/story` so the primary path starts from user input; static sample content is now only a fallback start action.
- Reserved shot execution and result nodes until T21 so the generation gate can show a render/request preview without making shot execution runnable.
- Follow-up: simplified the start surface to only story request and optional shots, derived audience rating from the Settings NSFW switch, removed user-entered title/content warning/NSFW fields, and added story request Suggest/Rewrite through the existing LiteLLM chat boundary.

Files changed:

- `src/features/agent-timeline/story-input.ts`
- `src/features/agent-timeline/story-input.test.ts`
- `src/features/agent-timeline/story-types.ts`
- `src/features/agent-timeline/story-workflow.test.ts`
- `src/features/agent-timeline/components/StoryPlanningPreview.tsx`
- `src/features/agent-timeline/components/StoryPlanningPreview.test.tsx`
- `src/features/agent-timeline/index.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- --run src/features/agent-timeline/story-input.test.ts src/features/agent-timeline/story-workflow.test.ts src/features/agent-timeline/story-state.test.ts src/features/agent-timeline/components/StoryPlanningPreview.test.tsx src/features/agent-timeline/components/StoryPlanningWorkspace.test.tsx` passed with 5 files and 20 tests.
- `npm test -- --run src/features/agent-timeline` passed with 22 files and 140 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings unrelated to this change.

### T20 / Issue #65 Story Graph Resource, Parameter, Render, Preview, and NSFW Planning

Summary:

- Added deterministic Story Graph planning helpers for local-only resource plans, formal generation parameter plans, separate preview execution options/results, story render-plan assembly, and execution request batches.
- Reused shared local resource validation so story resource planning selects only validated local candidates and strips model NSFW marker fields from outputs.
- Kept NSFW as content/execution context from the story safety plan at render, generation gate, result, and execution request boundaries instead of using model tags as filters.
- Updated the inactive `/story` planning preview with typed resource, parameter, render, gate, and result sample artifacts.

Files changed:

- `src/features/agent-timeline/story-planning.ts`
- `src/features/agent-timeline/story-planning.test.ts`
- `src/features/agent-timeline/story-types.ts`
- `src/features/agent-timeline/components/StoryPlanningPreview.tsx`
- `src/features/agent-timeline/index.ts`
- `docs/tech-spec.md`
- `docs/dev-log.md`

Validation:

- `npm test -- --run src/features/agent-timeline/story-planning.test.ts` passed with 5 tests.
- `npm test -- --run src/features/agent-timeline` passed with 20 files and 135 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings unrelated to this change.

### T19 / Issue #64 Story Graph Planning Workspaces

Summary:

- Added Story Graph runtime mutation helpers for story-scoped and shot-scoped manual edits.
- Reused shared workflow stale propagation for Story Graph DAG nodes and recorded downstream shot ids for shot dependency graph edits.
- Added story-facing planning workspaces for storyboard shots, story safety, shot dependency graph, plot-state graph, character continuity, and story-scoped shared JSON nodes.
- Mounted the inactive `/story` planning preview with the same three-column detailed workbench layout style used by the Run route's detailed display mode.
- Kept Story Graph planning code independent of the old editor sequence implementation and did not activate story execution or persistence.

Files changed:

- `src/features/agent-timeline/story-state.ts`
- `src/features/agent-timeline/story-state.test.ts`
- `src/features/agent-timeline/components/StoryPlanningPreview.tsx`
- `src/features/agent-timeline/components/StoryPlanningWorkspace.tsx`
- `src/features/agent-timeline/components/StoryPlanningWorkspace.test.tsx`
- `src/features/agent-timeline/components/index.ts`
- `src/features/agent-timeline/index.ts`
- `src/features/agent-timeline/components/TimelineShell.tsx`
- `src/app/story/page.tsx`
- `README.md`
- `docs/product-spec.md`
- `docs/tech-spec.md`
- `docs/dev-log.md`

Validation:

- `npm test -- --run src/features/agent-timeline/story-workflow.test.ts src/features/agent-timeline/story-state.test.ts src/features/agent-timeline/components/StoryPlanningWorkspace.test.tsx src/features/agent-timeline/components/TimelineShell.test.tsx` passed with 4 files and 45 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings unrelated to this change.
- `npm run build` passed and generated the `/story` static route.

### T18 / Issue #63 Story Graph Domain Models and DAG

Summary:

- Added typed Story Graph planning artifacts for story input, story bible, outline, storyboard shots, story safety, shot dependencies, plot state, character continuity, and consistency checks.
- Added an inactive Story Graph workflow definition using the shared T16/T17 workflow primitives and the scoped story DAG nodes from Issue #63.
- Added validation for the story workflow DAG, required predecessors, shot dependency cycles, and invalid source shot references.
- Kept the active timeline runtime selector on the existing single-image workflow so story mode remains unreachable until later UI/execution tracks wire it.

Files changed:

- `src/features/agent-timeline/story-types.ts`
- `src/features/agent-timeline/story-workflow.ts`
- `src/features/agent-timeline/story-workflow.test.ts`
- `src/features/agent-timeline/index.ts`
- `src/features/agent-timeline/workflow-definitions.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- --run src/features/agent-timeline/story-workflow.test.ts src/features/agent-timeline/workflow.test.ts src/features/agent-timeline/workflow-definition.test.ts` passed with 3 files and 23 tests.
- `npm test -- --run src/features/agent-timeline` passed with 17 files and 122 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings unrelated to this change.

### T17 / Issue #62 Definition-Driven Single-Image Timeline

Summary:

- Moved the single-image timeline DAG edges into `TimelineWorkflowDefinition` and made the legacy timeline DAG helpers delegate to common workflow-definition utilities.
- Added `workflowMode` to timeline workflow state, defaulted new workflows to `single-image`, and restored legacy persisted workflow records without a mode as `single-image`.
- Drove timeline readiness, `canRun`, stale downstream propagation, LangGraph node/edge registration, and adapter lookup from the single-image workflow definition.
- Routed React timeline step iteration, labels, AI/manual affordance labels, and visual workspace selection through definition metadata while preserving current single-image UI behavior.
- Sanitized confirm-generation API payloads through workflow persistence restore logic before enforcing the generation gate.

Files changed:

- `src/app/api/agent-timeline/confirm-generation/route.ts`
- `src/features/agent-timeline/components/TimelineEditorWorkspace.tsx`
- `src/features/agent-timeline/components/TimelineShell.tsx`
- `src/features/agent-timeline/components/timeline-node-content.ts`
- `src/features/agent-timeline/dag.ts`
- `src/features/agent-timeline/graph.ts`
- `src/features/agent-timeline/state.ts`
- `src/features/agent-timeline/timeline-workflow-persistence.ts`
- `src/features/agent-timeline/types.ts`
- `src/features/agent-timeline/workflow-definition.ts`
- `src/features/agent-timeline/workflow-definitions.ts`
- `src/features/agent-timeline/timeline-workflow-persistence.test.ts`
- `src/features/agent-timeline/workflow-definition.test.ts`
- `src/features/agent-timeline/workflow.test.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- --run src/features/agent-timeline src/app/api/agent-timeline` passed with 20 files and 137 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings unrelated to this change.

### T16 / Issue #61 Shared Workflow Definitions and Node Primitives

Summary:

- Added reusable workflow primitives for definition version, workflow mode, node metadata, dependency DAGs, readiness, manual edit stale propagation, raw JSON display, workspace routing, AI retry affordances, and adapter result normalization.
- Added adapter artifact scopes for current workflow-scoped single artifacts and future story-scoped or shot-scoped artifacts.
- Extracted a single-image workflow definition data object without migrating current LangGraph registration or changing single-image runtime behavior.
- Extracted shared local resource-plan validation and routed timeline resource recommendation through it.
- Kept common resource-plan behavior independent of model NSFW markers and stripped known NSFW marker fields from shared resource-plan outputs.

Files changed:

- `src/features/agent-timeline/workflow-definition.ts`
- `src/features/agent-timeline/workflow-definitions.ts`
- `src/features/agent-timeline/resource-plan.ts`
- `src/features/agent-timeline/t7-node-adapters.ts`
- `src/features/agent-timeline/index.ts`
- `src/features/agent-timeline/workflow-definition.test.ts`
- `src/features/agent-timeline/resource-plan.test.ts`
- `docs/tech-spec.md`
- `docs/dev-log.md`

Validation:

- `npm test -- --run src/features/agent-timeline` passed with 16 files and 114 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with 23 existing warnings unrelated to this change.

## 2026-06-13

### T15 / Issue #57 sqlite-vec Civitai Recommendation Index

Summary:

- Added a sqlite-vec derived embedding index for local Civitai `model` and `lora` resources, with metadata tracking for embedding model, dimensions, indexed time, and indexed chunk count.
- Added deterministic source-text fingerprint metadata so request-time readiness detects stale embeddings when FTS `search_text` changes without a resource count change.
- Split per-resource embedding input text into overlapping chunks before LiteLLM requests so long Civitai descriptions do not exceed embedding model input limits; recommendation ranking uses each resource's nearest chunk distance.
- Added chunked embedding schema/chunking metadata and vector-table column validation so legacy single-vector embedding indexes are treated as missing until rebuilt.
- Added `npm run civitai:reindex-embeddings` to rebuild only the derived embedding index after the FTS index exists and is current.
- Added LiteLLM `/v1/embeddings` support for `LITELLM_CIVITAI_EMBEDDING_MODEL`.
- Updated Civitai recommendation candidate loading to require the FTS index and embedding index/config, rank BM25 and embedding retrieval independently, merge with fixed Reciprocal Rank Fusion, and preserve downloaded-resource, prompt-profile, Anima, limit, and LLM validation gates.

Files changed:

- `src/features/llm/litellm-client.ts`
- `src/features/llm/types.ts`
- `src/features/persistence/civitai-embedding-index.ts`
- `src/features/persistence/sqlite-storage.ts`
- `src/features/civitai-lora-library/ai-recommendation.ts`
- `src/features/civitai-lora-library/ai-recommendation.test.ts`
- `src/app/api/civitai-lora-library/ai-recommendation/route.test.ts`
- `scripts/rebuild-civitai-embedding-index.mjs`
- `package.json`
- `README.md`
- `.env.example`
- `docs/tech-spec.md`
- `docs/plan.md`
- `docs/dev-log.md`

Validation:

- `npm run typecheck` passed.
- `npm test -- --run src/features/civitai-lora-library/ai-recommendation.test.ts src/app/api/civitai-lora-library/ai-recommendation/route.test.ts src/features/persistence/sqlite-storage.test.ts` passed with 21 tests.
- Follow-up stale-source validation: `npm test -- --run src/app/api/civitai-lora-library/ai-recommendation/route.test.ts src/features/persistence/sqlite-storage.test.ts` passed with 17 tests; `npm run typecheck` passed.
- Follow-up long embedding input validation: `npm test -- --run src/features/persistence/civitai-embedding-index.test.ts` passed with 5 tests; `npm run typecheck` passed.
- `npm run lint` passed with existing unrelated warnings.
- `npm run build` passed.
- `npm test` passed with 102 files and 755 tests.

### T14 / Issue #55 Simple and Detailed Run Display Modes

Summary:

- Added a persisted global workflow display mode setting with `simple` and `detailed` options, defaulting missing or legacy settings to `simple`.
- Added the Settings page Run display mode selector and restored auto-review behavior so enabled workflows automatically confirm and render at the ComfyUI generation gate.
- Added simple Run mode with the existing command composer controls, compact progress state, generation confirmation or auto-review rendering, and result display while preserving the detailed timeline workbench.
- Reused active timeline workflow autosave for both display modes without adding a second workflow persistence model.

Files changed:

- `src/features/settings/types.ts`
- `src/features/settings/central-settings.ts`
- `src/features/persistence/sqlite-storage.ts`
- `src/app/settings/page.tsx`
- `src/features/agent-timeline/components/TimelineShell.tsx`
- Focused tests for settings, SQLite settings persistence, Settings UI, and TimelineShell.

Validation:

- Focused settings and TimelineShell Vitest runs passed, including manual confirmation and auto-review generation-gate coverage.
- `npm test` passed with 102 files and 752 tests.
- `npm run lint` passed with existing unrelated warnings.
- `npm run typecheck` passed.
- `npm run build` passed.

### T13 / Issue #53 Civitai BM25 Recommendation Ranking

Summary:

- Added a rebuildable SQLite FTS5 derived index for local Civitai `model` and `lora` resources, with Unicode-safe search text expansion for Latin tokens, CJK word segmentation, CJK 2-3 grams, and Civitai/domain synonyms.
- Added `npm run civitai:reindex` to rebuild only the derived FTS index from `SCENEFORGE_SQLITE_FILE` or `data/sceneforge.sqlite`.
- Updated Civitai recommendation candidate loading to require the FTS index and use SQLite `bm25()` ranking after downloaded-resource filtering and before the existing LLM selection step.
- Preserved API request/response shape, prompt profile filtering, base model compatibility checks, candidate limits, private-field redaction, and final LLM validation.

Files changed:

- `src/features/persistence/civitai-search-index.ts`
- `src/features/civitai-lora-library/ai-recommendation.ts`
- `src/features/persistence/sqlite-storage.test.ts`
- `src/app/api/civitai-lora-library/ai-recommendation/route.test.ts`
- `scripts/rebuild-civitai-search-index.mjs`
- `package.json`
- `README.md`
- `.env.example`
- `docs/tech-spec.md`
- `docs/dev-log.md`

Validation:

- `npm test -- --run src/features/persistence/sqlite-storage.test.ts src/features/civitai-lora-library/ai-recommendation.test.ts src/app/api/civitai-lora-library/ai-recommendation/route.test.ts` passed with 17 tests.
- `npm run civitai:reindex` passed against `data/sceneforge.sqlite` and indexed 93 resources.
- `npm run typecheck` passed.
- `npm run lint` passed with existing unrelated warnings.
- `npm test` passed with 748 tests.
- Review follow-up: `npm test -- --run src/features/persistence/sqlite-storage.test.ts src/app/api/civitai-lora-library/ai-recommendation/route.test.ts` passed with 13 tests after readable Chinese synonym regression coverage; `npm run civitai:reindex` passed again against `data/sceneforge.sqlite`.
- Review follow-up: `scripts/rebuild-civitai-search-index.mjs` now loads `SCENEFORGE_SQLITE_FILE` from `.env.local` or `.env` without overriding a shell-provided value, and README / `.env.example` document that Civitai imports or metadata changes require manual reindexing.
- Review follow-up validation: `npm run civitai:reindex` passed against `data/sceneforge.sqlite` with 93 indexed resources; `npm test -- --run src/features/persistence/sqlite-storage.test.ts src/app/api/civitai-lora-library/ai-recommendation/route.test.ts` passed with 14 tests; `npm run typecheck` passed.

## 2026-06-05

### T11 / Issue #49 Named Timeline Workflow Project Management

Summary:

- Added optional timeline workflow project metadata for named records while preserving T10 active autosave record compatibility.
- Added local disk storage and API routes for named timeline workflow list, save, open, rename, and delete operations under `data/timeline-workflows/`.
- Added a Run-header timeline workflow project menu for saving unnamed drafts, updating/opening/renaming saved workflows, refreshing the list, and deleting saved records.
- Preserved active autosave behavior: named workflows remain explicit-save records, while active workflow autosave continues to track the current in-memory workflow and its current named/unnamed status.

Files changed:

- `src/features/agent-timeline/timeline-workflow-persistence.ts`
- `src/features/agent-timeline/timeline-workflow-persistence.test.ts`
- `src/features/agent-timeline/timeline-workflow-local-disk.ts`
- `src/features/agent-timeline/timeline-workflow-local-disk.test.ts`
- `src/features/agent-timeline/timeline-workflow-storage.ts`
- `src/features/agent-timeline/components/TimelineShell.tsx`
- `src/features/agent-timeline/components/TimelineShell.test.tsx`
- `src/features/agent-timeline/components/TimelineWorkflowProjectMenu.tsx`
- `src/features/agent-timeline/components/index.ts`
- `src/app/api/agent-timeline/workflows/route.ts`
- `src/app/api/agent-timeline/workflows/route.test.ts`
- `src/app/api/agent-timeline/workflows/item/route.ts`
- `src/app/api/agent-timeline/workflows/item/route.test.ts`
- `README.md`
- `docs/tech-spec.md`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/agent-timeline/components/TimelineWorkflowProjectMenu.test.tsx src/features/agent-timeline/components/TimelineShell.test.tsx src/features/agent-timeline/timeline-workflow-local-disk.test.ts src/features/agent-timeline/timeline-workflow-persistence.test.ts src/app/api/agent-timeline/workflows/route.test.ts src/app/api/agent-timeline/workflows/item/route.test.ts` passed with 52 tests.
- `npm test` passed with 738 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with existing warnings in unrelated files.
- `npm run build` passed and listed `/api/agent-timeline/workflows` and `/api/agent-timeline/workflows/item` as dynamic routes.
- After reviewer follow-up fixes, `npm test -- src/features/agent-timeline/components/TimelineWorkflowProjectMenu.test.tsx src/features/agent-timeline/components/TimelineShell.test.tsx` passed with 30 tests; `npm run lint`, `npm run typecheck`, and `npm run build` passed again.

### T10 / Issue #47 Active Timeline Workflow Persistence

Summary:

- Reviewed the active timeline workflow persistence implementation for Issue #47.
- Added a stale-autosave reconciliation guard so `New scene` cannot leave an old active workflow record behind when an earlier autosave finishes after the clear request.
- Added regression coverage for late autosave completion after clearing the active timeline workflow.

Files changed:

- `src/features/agent-timeline/components/TimelineShell.tsx`
- `src/features/agent-timeline/components/TimelineShell.test.tsx`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/agent-timeline/components/TimelineShell.test.tsx` passed with 24 tests.
- `npx vitest run src/features/agent-timeline/components/TimelineShell.test.tsx src/features/agent-timeline/timeline-workflow-persistence.test.ts src/features/agent-timeline/timeline-workflow-local-disk.test.ts src/app/api/agent-timeline/active-workflow/route.test.ts` passed with 38 tests after race-condition and API-error regression coverage.
- `npm run typecheck` passed.
- `npm run lint` passed with existing warnings in unrelated files.

## 2026-06-02

### T9 / Issue #42 Resource-Aware Final Prompt Formatting

Summary:

- Added timeline final positive prompt assembly inside the parameter recommendation path after local checkpoint and LoRA resources are selected.
- Reused Anima and Illustrious prompt renderers, added Pony score-tag formatting, and kept SDXL/generic fallback focused on the semantic prompt plus selected local LoRA trained words.
- Inserted selected LoRA trained words from local metadata into the final prompt with de-duping, while allowing selected LoRAs without trained words to remain valid.
- Tightened resource recommendation validation so unavailable checkpoint or LoRA recommendations fail the node instead of completing; only exact ID or unambiguous local name/model-file matches are mapped.
- Ensured the parameter recommendation request preview carries the final formatted prompt consumed by the generation gate and confirmed ComfyUI request.
- Follow-up: preserved ComfyUI `object_info` mismatch details in the step 9 node error message so missing checkpoints, LoRAs, samplers, or nodes are visible to the user.
- Follow-up: prevented timeline-assembled Anima prompts from being formatted a second time inside shared ComfyUI generation settings.
- Follow-up: included nested API error detail messages in timeline notices for non-OK confirmation responses.
- Follow-up: added explicit timeline prompt/base-model profile selection for Illustrious, Anima, and Generic; defaulted missing selections to Illustrious; made scene prompt generation, local Civitai candidate filtering, and final prompt assembly profile-aware.

Files changed:

- `src/features/agent-timeline/t7-node-adapters.ts`
- `src/features/agent-timeline/t7-node-adapters.test.ts`
- `src/features/agent-timeline/t8-server-adapters.ts`
- `src/features/agent-timeline/t8-server-adapters.test.ts`
- `src/app/api/agent-timeline/confirm-generation/route.test.ts`
- `src/features/agent-timeline/components/TimelineShell.tsx`
- `src/features/agent-timeline/components/TimelineShell.test.tsx`
- `src/features/agent-timeline/components/TimelineScenePromptWorkspace.tsx`
- `src/features/agent-timeline/t5-node-adapters.ts`
- `src/features/agent-timeline/t5-node-adapters.test.ts`
- `src/features/editor/ai-prompt/comfyui-generation-params.ts`
- `src/features/civitai-lora-library/ai-recommendation.ts`
- `src/features/civitai-lora-library/ai-recommendation.test.ts`
- `src/app/api/civitai-lora-library/ai-recommendation/route.ts`
- `src/app/api/civitai-lora-library/ai-recommendation/route.test.ts`
- `src/shared/prompt-profile.ts`
- `src/features/agent-timeline/types.ts`
- `docs/plan.md`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/agent-timeline/t7-node-adapters.test.ts` passed with 13 tests.
- `npm test -- src/features/agent-timeline/t7-node-adapters.test.ts src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/components/TimelineRecommendationWorkspaces.test.tsx` passed with 18 tests.
- Follow-up: `npm test -- src/features/agent-timeline/t7-node-adapters.test.ts src/features/agent-timeline/t8-server-adapters.test.ts` passed with 19 tests.
- Follow-up: `npm test -- src/features/agent-timeline/components/TimelineShell.test.tsx` passed with 12 tests.
- Follow-up: `npm test -- src/app/api/agent-timeline/confirm-generation/route.test.ts src/features/agent-timeline/t7-node-adapters.test.ts src/features/agent-timeline/t8-server-adapters.test.ts src/features/agent-timeline/components/TimelineShell.test.tsx src/features/editor/ai-prompt/comfyui-generation-params.test.ts` passed with 44 tests.
- Follow-up: `npm test -- --run src/features/agent-timeline/t5-node-adapters.test.ts src/features/agent-timeline/t7-node-adapters.test.ts src/features/agent-timeline/components/TimelineShell.test.tsx src/app/api/civitai-lora-library/ai-recommendation/route.test.ts src/features/civitai-lora-library/ai-recommendation.test.ts` passed with 39 tests.
- Follow-up: `npm test` passed with 669 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing 22 `@next/next/no-img-element` warnings in unrelated editor components.
- Follow-up: `npm run build` passed.

### T8 / Issue #40 Confirmed ComfyUI Execution Timeline

Summary:

- Converted the ComfyUI execution and result-display timeline nodes from reserved placeholders into post-confirmation executable graph nodes.
- Kept the generation gate blocking before explicit confirmation and guarded confirmed request conversion so ComfyUI requests are not constructed by T8 adapters before confirmation.
- Added a thin confirmation API route that confirms eligible timeline state, runs LangGraph with server-side T8 adapters, validates against ComfyUI `object_info`, queues the existing text-to-image workflow, polls for one image, and stores the returned image as standalone timeline result state.
- Updated the timeline shell with a `Confirm and render` gate action, queue/result status copy, and visual result display without appending to project generated-image history.

Files changed:

- `src/app/api/agent-timeline/confirm-generation/route.ts`
- `src/features/agent-timeline/graph.ts`
- `src/features/agent-timeline/index.ts`
- `src/features/agent-timeline/t8-node-adapters.ts`
- `src/features/agent-timeline/t8-node-adapters.test.ts`
- `src/features/agent-timeline/t8-server-adapters.ts`
- `src/features/agent-timeline/types.ts`
- `src/features/agent-timeline/workflow.test.ts`
- `src/features/agent-timeline/components/TimelineShell.tsx`
- `src/features/agent-timeline/components/TimelineShell.test.tsx`
- `src/features/agent-timeline/components/timeline-node-content.ts`

Validation:

- `npm test -- src/features/agent-timeline/workflow.test.ts src/features/agent-timeline/t8-node-adapters.test.ts src/features/agent-timeline/t8-server-adapters.test.ts src/features/agent-timeline/components/TimelineShell.test.tsx` passed with 29 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing 22 `<img>` warnings in unrelated editor components.
- `npm run build` passed and listed `/api/agent-timeline/confirm-generation` as a dynamic route.

## 2026-06-01

### T7 / Issue #38 Timeline Resource and Parameter Recommendations

Summary:

- Activated the timeline resource recommendation and parameter recommendation nodes before the generation gate.
- Added T7 adapters that validate AI checkpoint picks against local Civitai candidates, filter unavailable, duplicate, and incompatible LoRAs, and keep ComfyUI execution blocked for T8.
- Added parameter recommendation output with ComfyUI request previews built from the existing generation settings helpers and sampler options.
- Kept automatic and manual sampler/scheduler selections constrained to the live ComfyUI option set used by the timeline run.
- Added visual workspaces for manual checkpoint, LoRA, and render parameter review before future generation execution.

Files changed:

- `docs/plan.md`
- `src/features/agent-timeline/types.ts`
- `src/features/agent-timeline/t7-node-adapters.ts`
- `src/features/agent-timeline/t7-node-adapters.test.ts`
- `src/features/agent-timeline/index.ts`
- `src/features/agent-timeline/components/TimelineShell.tsx`
- `src/features/agent-timeline/components/TimelineResourceRecommendationWorkspace.tsx`
- `src/features/agent-timeline/components/TimelineParameterRecommendationWorkspace.tsx`
- `src/features/agent-timeline/components/TimelineRecommendationWorkspaces.test.tsx`
- `src/features/agent-timeline/components/timeline-node-content.ts`
- `src/features/agent-timeline/components/TimelineShell.test.tsx`
- `src/features/agent-timeline/workflow.test.ts`
- `src/features/agent-timeline/t5-node-adapters.test.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/agent-timeline/workflow.test.ts src/features/agent-timeline/t7-node-adapters.test.ts src/features/agent-timeline/components/TimelineShell.test.tsx src/features/agent-timeline/components/TimelineRecommendationWorkspaces.test.tsx` passed with 29 tests.
- `npm test` passed with 646 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with existing `<img>` warnings.
- Browser smoke loaded `http://localhost:3000/`, confirmed the timeline shell shows 10 steps including Model resources and Render prompt, with no browser console errors.

### T6 / Issue #36 Centralized Settings Page

Summary:

- Replaced the `/settings` placeholder with a centralized settings workspace for NSFW status, read-only storage paths, editable Civitai resource paths, and redacted integration status.
- Added server-side `/api/settings` status/update handling so the client does not read environment variables or server-only path helpers.
- Added Civitai resource path validation before SQLite persistence and kept secret-backed integration values redacted.
- Changed the Civitai library panel to link to centralized settings as the primary path editing surface.

Files changed:

- `src/app/settings/page.tsx`
- `src/app/settings/page.test.tsx`
- `src/app/api/settings/route.ts`
- `src/app/api/settings/route.test.ts`
- `src/app/api/civitai-lora-library/settings/route.ts`
- `src/features/settings/`
- `src/features/civitai-lora-library/settings.ts`
- `src/features/civitai-lora-library/settings.test.ts`
- `src/features/comfyui/generated-image-storage.ts`
- `src/features/comfyui/sequence-reference-storage.ts`
- `src/features/editor/components/CivitaiLoraLibraryPanel.tsx`
- `docs/dev-log.md`

Validation:

- `npm test -- src/app/api/settings/route.test.ts src/app/settings/page.test.tsx src/features/civitai-lora-library/settings.test.ts src/features/settings/central-settings.test.ts` passed with 12 tests.
- `npm test` passed with 637 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with existing `<img>` warnings.
- `npm run build` passed.
- `git diff --check` passed with line-ending warnings only.
- Browser verification loaded `/settings`, confirmed General, Storage Paths, Civitai Resource Paths, Integration Status, and invalid-path field errors with no console errors.

### T-AN6 / Issue #33 Anima Natural Prompt Clauses

Summary:

- Strengthened Anima AI prompt instructions to prefer descriptive English visual phrases and short clauses over bare tag-only output.
- Kept Anima output comma-separated and prompt-like while explicitly requesting visible action, expression, scene, lighting, atmosphere, camera/framing, composition, foreground/background relationships, and motion details.
- Added Anima multi-person guidance requiring distinct hairstyle and distinct pose/action per visible person.
- Aligned Anima Comic Sequence storyboard prompt instructions with the same natural visual clause style.
- Preserved non-Anima Illustrious/default prompt instructions, Anima safety defaults, and artist formatting behavior.

Files changed:

- `src/features/editor/ai-prompt/anima-prompt.ts`
- `src/features/editor/ai-prompt/anima-prompt.test.ts`
- `src/features/editor/ai-prompt/comic-sequence-storyboard.ts`
- `src/features/editor/ai-prompt/comic-sequence-storyboard.test.ts`
- `src/features/editor/components/PromptPreviewPanel.tsx`
- `src/features/editor/components/PromptPreviewPanel.test.tsx`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/editor/ai-prompt/anima-prompt.test.ts src/features/editor/components/PromptPreviewPanel.test.tsx src/features/editor/ai-prompt/comic-sequence-storyboard.test.ts` passed with 28 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with existing `<img>` warnings.

### T-AN5 / Issue #31 Anima Prompt Formatting

Summary:

- Added a reusable Anima prompt renderer for `/editor` that activates from Anima workflow profile or base model metadata.
- Ordered Anima positive prompts as quality/meta/year/safety, subject count, character, series/source, artist, and general tags, with case-insensitive dedupe after ordering.
- Routed Anima formatting through prompt preview, AI prompt response rendering, ComfyUI generation settings, Comic Sequence shots, and previous-shot img2img/inpaint requests.
- Split LLM prompt instructions by prompt profile so Anima AI responses use compact anime-style natural-language visual phrases while Illustrious/default responses keep booru-style tag instructions.
- Split Comic Sequence storyboard shot prompts by prompt profile so Anima storyboards use compact anime-style natural-language visual phrases while default storyboards keep booru-style shot tags.
- Synced the Style Palette Artist String render mode with Anima context so Anima checkpoints only show the `@artist` dropdown format and automatically use it in selected cards, active prompt, and saved project settings.
- Added Anima safety behavior: default `safe` is included only when NSFW is disabled, while explicit safety/rating tags are preserved.
- Converted compatible selected Artist String tags into Anima `@artist` syntax when they land in the artist section.
- Kept non-Anima Illustrious/default prompt ordering and negative prompt behavior unchanged.

Files changed:

- `src/features/editor/ai-prompt/anima-prompt.ts`
- `src/features/editor/ai-prompt/anima-prompt.test.ts`
- `src/features/editor/ai-prompt/comic-sequence-storyboard.ts`
- `src/features/editor/ai-prompt/comic-sequence-storyboard.test.ts`
- `src/features/editor/ai-prompt/comfyui-generation-params.ts`
- `src/features/editor/ai-prompt/comfyui-generation-params.test.ts`
- `src/features/artist-string-library/novelai-artist-string.ts`
- `src/features/artist-string-library/novelai-artist-string.test.ts`
- `src/features/editor/components/ImageGenerationPanel.tsx`
- `src/features/editor/components/PromptPreviewPanel.tsx`
- `src/features/editor/components/PromptPreviewPanel.test.tsx`
- `src/features/editor/components/StylePalettePanel.tsx`
- `src/features/editor/components/StylePalettePanel.test.tsx`
- `src/features/persistence/project-serialization.ts`
- `src/features/persistence/project-serialization.test.ts`
- `src/shared/types/project.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/editor/ai-prompt/anima-prompt.test.ts src/features/editor/ai-prompt/illustrious-prompt.test.ts src/features/editor/ai-prompt/comfyui-generation-params.test.ts src/features/editor/components/PromptPreviewPanel.test.tsx` passed with 37 tests.
- `npm test -- src/features/artist-string-library/novelai-artist-string.test.ts src/features/editor/components/StylePalettePanel.test.tsx src/features/persistence/project-serialization.test.ts` passed with 69 tests.
- `npm test` passed: 84 files, 622 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing 22 `@next/next/no-img-element` warnings.

### T-AN4 / Issue #29 Anima Add-ons

Summary:

- Reused the shared text-to-image add-on graph for Anima so ControlNet, IPAdapter character references, Face Detailer, and Hand Detailer consume the Anima `UNETLoader`, `CLIPLoader`, and `VAELoader` context instead of `CheckpointLoaderSimple`.
- Kept Anima txt2img on `EmptyLatentImage` while preserving the resolved Anima profile metadata in workflow requests.
- Removed the Anima pre-queue blockers for supported add-ons and replaced them with object_info validation for missing ControlNet, IPAdapter, Face Detailer, Hand Detailer, detector model, and model file resources.
- Enabled Anima inpaint and high-res inpaint detailers through the existing shared inpaint model/CLIP/VAE context.

Files changed:

- `src/app/api/comfyui/generate-image/route.test.ts`
- `src/app/api/comfyui/sequence-image/route.test.ts`
- `src/features/comfyui/object-info.ts`
- `src/features/comfyui/object-info.test.ts`
- `src/features/comfyui/validation.ts`
- `src/features/comfyui/workflow.ts`
- `src/features/comfyui/workflow.test.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/comfyui/workflow.test.ts src/features/comfyui/object-info.test.ts` passed with 76 tests.
- `npm test -- src/app/api/comfyui/generate-image/route.test.ts src/app/api/comfyui/inpaint-image/route.test.ts src/app/api/comfyui/sequence-image/route.test.ts` passed with 34 tests.
- `npm test -- src/app/api/comfyui/generate-image/route.test.ts src/app/api/comfyui/sequence-image/route.test.ts` passed with 25 tests.
- `npm test -- src/features/comfyui/workflow.test.ts src/features/comfyui/object-info.test.ts src/app/api/comfyui/generate-image/route.test.ts src/app/api/comfyui/inpaint-image/route.test.ts src/app/api/comfyui/sequence-image/route.test.ts` passed with 113 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing 22 `@next/next/no-img-element` warnings.

## 2026-05-31

### T-AN3 Anima Img2Img, Inpaint, and Sequence Inheritance

Summary:

- Extended Anima workflow metadata and fixed CLIP/VAE defaults from text-to-image into inpaint request validation, resolution, and workflow generation.
- Added a shared ComfyUI model context builder so Anima inpaint and previous-shot img2img use `UNETLoader`, `CLIPLoader`, `VAELoader`, source-image VAE encoding, and `VAEEncodeForInpaint` without `CheckpointLoaderSimple`.
- Kept high-res and local-region inpaint behavior intact while routing VAE encode/decode and harmonization through the selected Anima VAE context.
- Merged sequence per-shot requests over base requests so `workflowProfile`, base model, storage kind, fixed CLIP/VAE, clip device, and UNET dtype metadata inherit into Anima sequence shots.
- Preserved Anima metadata in generated-image saved parameter records and kept T-AN4 features such as detailers blocked by pre-queue validation for Anima inpaint.

Files changed:

- `src/app/api/comfyui/inpaint-image/route.test.ts`
- `src/app/api/comfyui/sequence-image/route.test.ts`
- `src/app/api/comfyui/sequence-image/route.ts`
- `src/features/comfyui/object-info.test.ts`
- `src/features/comfyui/object-info.ts`
- `src/features/comfyui/types.ts`
- `src/features/comfyui/validation.ts`
- `src/features/comfyui/workflow-profiles.ts`
- `src/features/comfyui/workflow.test.ts`
- `src/features/comfyui/workflow.ts`
- `src/features/editor/components/ImageGenerationPanel.tsx`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/comfyui/workflow.test.ts src/features/comfyui/object-info.test.ts src/app/api/comfyui/inpaint-image/route.test.ts src/app/api/comfyui/sequence-image/route.test.ts` passed with 83 tests.
- `npm test -- src/features/editor/ai-prompt/comfyui-generation-params.test.ts src/features/persistence/project-serialization.test.ts src/features/comfyui/preview.test.ts` passed with 56 tests.
- `npm test` passed: 83 files, 585 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing 22 `@next/next/no-img-element` warnings.
- `npm run build` passed with the existing Turbopack NFT trace warning for `sequence-reference-storage`.
- Merged PR #28 and confirmed Issue #27 closed.

### T-AN2 Fixed Anima Model Settings Persistence

Summary:

- Added Anima profile metadata to ComfyUI text-to-image requests and saved generation parameter serialization.
- Fixed Anima CLIP and VAE model names at the workflow profile level (`qwen_3_06b_base.safetensors` and `qwen_image_vae.safetensors`) while preserving base model, workflow profile, and storage kind metadata through editor request construction, generated-image parameters, Comic Sequence defaults/shots, and project serialization.
- Validated the fixed Anima CLIP/VAE files against ComfyUI `object_info` before queueing.
- Filtered Civitai selected LoRAs and AI recommendations by checkpoint base model so Anima checkpoints only keep Anima-compatible LoRAs.
- Kept Anima CLIP/VAE out of the editor generation dialog so users no longer choose those model files manually; Illustrious/default behavior stays on the existing checkpoint workflow.

Files changed:

- `src/app/api/civitai-lora-library/selected-resources/route.ts`
- `src/app/api/civitai-lora-library/selected-resources/route.test.ts`
- `src/app/api/comfyui/generate-image/route.test.ts`
- `src/features/civitai-lora-library/base-model.ts`
- `src/features/civitai-lora-library/ai-recommendation.ts`
- `src/features/civitai-lora-library/ai-recommendation.test.ts`
- `src/features/civitai-lora-library/download.ts`
- `src/features/civitai-lora-library/index.ts`
- `src/features/civitai-lora-library/resource-files.ts`
- `src/features/comfyui/object-info.ts`
- `src/features/comfyui/object-info.test.ts`
- `src/features/comfyui/preview.test.ts`
- `src/features/comfyui/types.ts`
- `src/features/comfyui/validation.ts`
- `src/features/comfyui/workflow-profiles.ts`
- `src/features/comfyui/workflow.ts`
- `src/features/comfyui/workflow.test.ts`
- `src/features/editor/ai-prompt/comfyui-generation-params.ts`
- `src/features/editor/ai-prompt/comfyui-generation-params.test.ts`
- `src/features/editor/components/CivitaiLoraLibraryPanel.tsx`
- `src/features/editor/components/ImageGenerationPanel.tsx`
- `src/features/editor/components/StylePalettePanel.tsx`
- `src/features/editor/components/StylePalettePanel.test.tsx`
- `src/features/persistence/project-serialization.ts`
- `src/features/persistence/project-serialization.test.ts`
- `src/shared/types/project.ts`

Validation:

- `npm test -- src/features/comfyui/object-info.test.ts src/features/comfyui/workflow.test.ts src/features/comfyui/preview.test.ts src/app/api/comfyui/generate-image/route.test.ts src/app/api/civitai-lora-library/selected-resources/route.test.ts src/features/civitai-lora-library/ai-recommendation.test.ts src/features/editor/ai-prompt/comfyui-generation-params.test.ts src/features/editor/components/StylePalettePanel.test.tsx src/features/persistence/project-serialization.test.ts` passed with 154 tests.
- `npm test -- src/features/civitai-lora-library/download.test.ts` passed with 4 tests during review.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing 22 `@next/next/no-img-element` warnings.
- `npm run build` passed with the existing Turbopack NFT trace warning for `sequence-reference-storage`.

### T-AN1 Anima Workflow Profiles

Summary:

- Added a ComfyUI text-to-image workflow profile boundary with the existing Illustrious/default checkpoint workflow as fallback.
- Added Anima txt2img workflow generation using `UNETLoader`, `CLIPLoader`, `VAELoader`, optional standard `LoraLoader`, `EmptyLatentImage`, `KSampler`, `VAEDecode`, and `PreviewImage`.
- Kept unknown and non-Anima diffusion models on the default checkpoint workflow.
- Made text-to-image `object_info` validation profile-aware so default and Anima profiles validate their own required loader nodes, inputs, and model file options before queueing.
- Preserved preview request metadata while retaining the preview step cap behavior.
- Follow-up: parsed ComfyUI `object_info` optional inputs so Anima `CLIPLoader.device` can be retained when ComfyUI exposes it as optional.
- Follow-up: expanded KSampler sampler/scheduler fallback options and added a server-side sampler-options endpoint so editor dropdowns can use the local ComfyUI `object_info` values.

Files changed:

- `src/features/comfyui/workflow-profiles.ts`
- `src/features/comfyui/workflow.ts`
- `src/features/comfyui/object-info.ts`
- `src/features/comfyui/types.ts`
- `src/features/comfyui/validation.ts`
- `src/features/comfyui/index.ts`
- `src/features/comfyui/workflow.test.ts`
- `src/features/comfyui/object-info.test.ts`
- `src/features/comfyui/preview.test.ts`
- `src/app/api/comfyui/generate-image/route.test.ts`
- `src/app/api/comfyui/sampler-options/route.ts`
- `src/app/api/comfyui/sampler-options/route.test.ts`
- `src/app/api/comfyui/sequence-image/route.test.ts`
- `src/features/editor/ai-prompt/comfyui-generation-params.ts`
- `src/features/editor/ai-prompt/comfyui-generation-options.ts`
- `src/features/editor/ai-prompt/comfyui-generation-options.test.ts`
- `src/features/editor/components/ImageGenerationPanel.tsx`
- `docs/tech-spec.md`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/comfyui/workflow.test.ts src/features/comfyui/object-info.test.ts src/features/comfyui/preview.test.ts src/app/api/comfyui/generate-image/route.test.ts src/app/api/comfyui/workflow/text-to-image/route.test.ts` passed.
- `npm test -- src/app/api/comfyui/sequence-image/route.test.ts` passed.
- `npm test -- src/features/editor/ai-prompt/comfyui-generation-params.test.ts` passed.
- `npm test -- src/features/editor/ai-prompt/comfyui-generation-options.test.ts src/features/editor/ai-prompt/comfyui-generation-params.test.ts src/features/comfyui/object-info.test.ts src/app/api/comfyui/sampler-options/route.test.ts` passed.
- `npm test -- src/features/comfyui src/app/api/comfyui src/features/editor/ai-prompt/comfyui-generation-options.test.ts src/features/editor/ai-prompt/comfyui-generation-params.test.ts src/features/editor/ai-prompt/comfyui-generation-diagnosis.test.ts src/features/editor/ai-prompt/style-palette-prompts.test.ts` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing 22 `@next/next/no-img-element` warnings.
- Merged PR #24 and confirmed Issue #23 closed.

### Legacy Editor ComfyUI Preview Generation

Summary:

- Added a shared ComfyUI text-to-image preview request transform that reduces target dimensions to a max 512px side with 8px alignment, limits previews to one image, and disables face/hand detailers.
- Added `preview` flow-through for ordinary `/api/comfyui/generate-image` and `/api/comfyui/sequence-image` requests.
- Added preview generation entries to the legacy `/editor` ComfyUI dialog, Style Palette reuse path, and Comic Sequence shot/sequence controls.
- Follow-up: changed preview acceleration from resolution downscaling to fixed 10-step sampling while preserving the requested width and height; preview still limits output to one image and disables face/hand detailers.
- Follow-up: capped preview sampling at a maximum of 10 steps so low-step requests stay low, added preview handling for Comic Sequence previous-shot img2img/inpaint, and replaced separate preview generation buttons with a Preview toggle that changes the normal Generate action.

Files changed:

- `src/features/comfyui/preview.ts`
- `src/features/comfyui/preview.test.ts`
- `src/features/comfyui/types.ts`
- `src/features/comfyui/validation.ts`
- `src/features/comfyui/sequence.ts`
- `src/features/comfyui/index.ts`
- `src/app/api/comfyui/generate-image/route.ts`
- `src/app/api/comfyui/generate-image/route.test.ts`
- `src/app/api/comfyui/inpaint-image/route.ts`
- `src/app/api/comfyui/inpaint-image/route.test.ts`
- `src/app/api/comfyui/sequence-image/route.ts`
- `src/app/api/comfyui/sequence-image/route.test.ts`
- `src/features/editor/components/ImageGenerationPanel.tsx`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/comfyui/preview.test.ts src/app/api/comfyui/generate-image/route.test.ts src/app/api/comfyui/sequence-image/route.test.ts` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with existing `@next/next/no-img-element` warnings in editor image-heavy panels.

## 2026-05-30

### Illustrious Prompt Ordering Refactor

Summary:

- Added a shared pure Illustrious prompt renderer for Stable Diffusion prompt sections, default quality/aesthetic tags, Civitai checkpoint trigger words, and LoRA trigger placement by category/tag.
- Updated `/editor` AI prompt generation to request Illustrious JSON sections with selected Civitai trainedWords context and locally render the final stored prompt, with flat-prompt classification fallback.
- Follow-up: Stable Diffusion AI generation now resolves the current selected Civitai resource previews before building the LLM request so checkpoint/LoRA trainedWords are not omitted while the panel preview fetch is still loading.
- Updated Comic Sequence text-to-image and previous-shot inpaint prompt construction to use the shared Illustrious merge path for Stable Diffusion while preserving generic positive prompt joins.
- Deduped Comic Sequence negative prompts across the base negative prompt and per-shot negative prompt.

Files changed:

- `src/features/editor/ai-prompt/illustrious-prompt.ts`
- `src/features/editor/ai-prompt/illustrious-prompt.test.ts`
- `src/features/editor/components/PromptPreviewPanel.tsx`
- `src/features/editor/components/PromptPreviewPanel.test.tsx`
- `src/features/editor/components/ImageGenerationPanel.tsx`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/editor/ai-prompt/illustrious-prompt.test.ts src/features/editor/components/PromptPreviewPanel.test.tsx` passed.
- Follow-up validation: `npm test -- src/features/editor/components/PromptPreviewPanel.test.tsx` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with existing `@next/next/no-img-element` warnings in editor image-heavy panels.
- `npm test` passed: 80 files, 534 tests.
- `npm run build` passed with the existing Turbopack NFT trace warning for `sequence-reference-storage.ts`.

### Comic Sequence Direct Shot Previous Source Fix

Summary:

- Fixed the legacy `/editor` Comic Sequence shot workspace so saving an image from direct `Generate shot` also binds the saved history record back to that shot.
- Promoted the saved local image URL over the stale ComfyUI temp `/api/comfyui/view` URL in the current session results after saving, preventing previous-shot generation from reusing a deleted temp file.
- Reused the existing bound-image previous-shot source path, preserving imported references, manual previous-source settings, sequence reference uploads, and ComfyUI generated image history.
- Added focused regression coverage for binding saved direct-shot image IDs without duplicating existing shot bindings.

Files changed:

- `src/features/editor/components/ImageGenerationPanel.tsx`
- `src/features/editor/comic-sequence-previous-shot.ts`
- `src/features/editor/comic-sequence-previous-shot.test.ts`
- `src/features/editor/comic-sequence-shot-settings.ts`
- `src/features/editor/comic-sequence-shot-settings.test.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/editor/comic-sequence-shot-settings.test.ts src/features/editor/comic-sequence-previous-shot.test.ts` passed.
- `npm run typecheck` passed.

PR:

- #17

### Style Palette Resource Selection Stability

Summary:

- Split style palette selected Civitai resource loading from selected artist string loading so artist string changes no longer flip the Civitai selected-resource panel into loading.
- Kept existing selected Civitai cards and quick-picker list data mounted while refreshes are in flight.
- Removed the LoRA picker dependency on selected-resource loading state so checkpoint/LoRA selection and right-side removal do not clear the bottom resource list.
- Optimistically applied clicked checkpoint/LoRA list items to selected-resource preview state so checkpoint-to-LoRA switching can use the clicked checkpoint base model immediately.
- Made missing checkpoint base model metadata a stable empty LoRA picker state, with stale picker rows hidden synchronously and aborted picker fetches guarded from late writes.
- Added regression coverage for artist selection not refetching Civitai selected resources, LoRA toggles not refetching/clearing the picker list, checkpoint-to-LoRA switching using the clicked base model without showing stale checkpoint rows, and missing checkpoint base model metadata not showing stale rows or fetching LoRAs.

Files changed:

- `src/features/editor/components/StylePalettePanel.tsx`
- `src/features/editor/components/StylePalettePanel.test.tsx`
- `docs/dev-log.md`

Validation:

- `npm test -- --run src/features/editor/components/StylePalettePanel.test.tsx` passed.
- `npm test` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with existing `@next/next/no-img-element` warnings.

### Local `/editor` Style Palette UX Fix

Summary:

- Added right-side remove buttons for selected artist strings and selected Civitai resources in the style palette.
- Reversed the visible order of quick-pick suggestions and selected content so quick selections appear above the selected lists when open.
- Revised the style palette prompt refresh key so active/negative prompt drafts refresh on preset, checkpoint, LoRA, selected resource, and AI advice changes.
- Added a Subject Input slot above the style palette ComfyUI prompt flow; it persists across palette/resource changes, prepends into the active prompt, and can call the existing LiteLLM chat endpoint to convert a subject name into Danbooru-style tags with loading/error states.

Files changed:

- `src/features/editor/components/StylePalettePanel.tsx`
- `src/features/editor/components/ImageGenerationPanel.tsx`
- `src/features/editor/ai-prompt/style-palette-prompts.ts`
- `src/features/editor/ai-prompt/style-palette-prompts.test.ts`
- `src/features/editor/ai-prompt/comfyui-generation-draft.ts`
- `src/features/editor/ai-prompt/comfyui-generation-draft.test.ts`
- `src/features/editor/components/StylePalettePanel.test.tsx`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/editor/ai-prompt/comfyui-generation-draft.test.ts src/features/editor/ai-prompt/style-palette-prompts.test.ts src/features/editor/components/StylePalettePanel.test.tsx` passed.
- `npm test` passed.
- `npm run typecheck` passed.
- `npm run lint -- src/features/editor/components/StylePalettePanel.tsx src/features/editor/components/StylePalettePanel.test.tsx src/features/editor/ai-prompt/style-palette-prompts.ts src/features/editor/ai-prompt/style-palette-prompts.test.ts` passed.
- `npm run lint` passed with existing `@next/next/no-img-element` warnings.
- `npm run build` passed with the existing Turbopack NFT warning for `sequence-reference-storage.ts`.
- Browser QA opened `/editor`, opened the style palette, confirmed the Subject Input and quick-pick/selected-content ordering, confirmed right-side remove buttons are visible, and confirmed a subject input is prepended into the Active Prompt draft.

### Comic Sequence Single-Shot Generation Button

Summary:

- Added a `Generate shot` action to the Comic Sequence workspace footer before `Generate sequence`.
- Reused the existing ComfyUI shot submission path while limiting the new action to the currently selected shot.
- Kept the existing sequence action generating from the selected shot onward.

Files changed:

- `src/features/editor/components/ImageGenerationPanel.tsx`
- `src/features/editor/comic-sequence-generation.ts`
- `src/features/editor/comic-sequence-generation.test.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/editor/comic-sequence-generation.test.ts` passed.
- `npm run typecheck` passed.
- `npm run lint -- src/features/editor/comic-sequence-generation.ts src/features/editor/comic-sequence-generation.test.ts src/features/editor/components/ImageGenerationPanel.tsx` passed with existing `@next/next/no-img-element` warnings in `ImageGenerationPanel.tsx`.

## 2026-05-29

### Issue #11 Node 5 Layout Planning UI Follow-up

Summary:

- Locked the Node 5 layout-planning workspace to the 3D editor canvas and hid the embedded 2D/3D canvas mode switch there.
- Restored prompt-library tag selection in Node 5 as a compact right-side/bottom overlay drawer using the existing prompt-library data and editor store binding flow.
- Made the selected-step workspace width and Step output minimum height stable across timeline nodes.
- Kept Node 5 visual-only in the selected workspace while leaving the normal editor canvas mode switch enabled by default.

Files changed:

- `src/features/editor/components/CanvasViewport.tsx`
- `src/features/editor/components/CanvasViewport.test.tsx`
- `src/features/agent-timeline/components/TimelineEditorWorkspace.tsx`
- `src/features/agent-timeline/components/TimelinePromptLibraryDrawer.tsx`
- `src/features/agent-timeline/components/TimelinePromptLibraryDrawer.test.tsx`
- `src/features/agent-timeline/components/TimelineShell.tsx`
- `src/features/agent-timeline/components/TimelineShell.test.tsx`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/editor/components/CanvasViewport.test.tsx src/features/agent-timeline/components/TimelineShell.test.tsx src/features/agent-timeline/components/TimelinePromptLibraryDrawer.test.tsx` passed: 3 files, 13 tests.
- `npm run typecheck` passed.
- `npm test` passed: 76 files, 498 tests.
- `npm run lint` passed with the existing 22 `<img>` warnings in editor image-heavy panels.

### Issue #11 Node 5 Canvas Binding Review

Summary:

- Removed the prompt tag picker from the Node 5 visual output so layout planning shows the existing 3D canvas only.
- Expanded the Node 5 visual workspace width and canvas height while keeping the three-column workbench shell intact.
- Extracted the reverse prompt-tag missing-library review dialog and semantic matching helpers for reuse by the original character image prompt-tag panel and timeline Node 5.
- Added Node 5 prompt-library review handling for skip, transient bind, and import-and-bind choices before committing timeline prompt tags to the editor store.

Files changed:

- `src/features/editor/components/PromptTagImportReviewDialog.tsx`
- `src/features/editor/components/CharacterImagePromptTagPanel.tsx`
- `src/features/agent-timeline/components/TimelineEditorWorkspace.tsx`
- `src/features/agent-timeline/components/TimelineShell.tsx`
- `src/features/agent-timeline/components/TimelineShell.test.tsx`
- `src/features/agent-timeline/editor-canvas-binding.ts`
- `src/features/agent-timeline/editor-canvas-binding.test.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/agent-timeline` passed.
- `npm run typecheck` passed.
- `npm run lint` passed with pre-existing `no-img-element` warnings in editor image-heavy panels.

### T5 Timeline Prompt Tag Metadata Fix

Summary:

- Preserved parsed prompt-tag metadata across Node 3 character tag output and Node 5 editor binding.
- Kept weighted tokens such as `reflective yellow jacket:1.25` as enabled editor prompt-tag weights after binding.
- Made explicit negative metadata preservation for allowed character/body-part tag categories.

Files changed:

- `src/features/agent-timeline/`
- `src/features/prompt-engine/prompt-library/character-image-prompt-tags.test.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/agent-timeline` passed: 6 files, 27 tests.
- `npm test -- src/features/prompt-engine/prompt-library/character-image-prompt-tags.test.ts` passed: 1 file, 9 tests.
- `npm run typecheck` passed.

### T5 Timeline Tag and Pose Reuse Follow-up

Summary:

- Changed Node 3 character tags to reuse the existing editor text reverse prompt-tag message builder and parser.
- Restored the Node 3 raw result shape to `{ items: [...] }` with direct `targetKind` and optional `bodyPartId` fields.
- Kept Node 4 pose planning on the existing stick-figure text generation helper and isolated its request text to Node 2 scene context.
- Kept Node 5 deterministic and LLM-free while binding Node 3 character/body-part items plus the Node 4 pose to the 3D editor character.

Files changed:

- `src/features/agent-timeline/`
- `src/features/prompt-engine/prompt-library/character-image-prompt-tags.ts`
- `src/features/prompt-engine/prompt-library/character-image-prompt-tags.test.ts`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/prompt-engine/prompt-library/character-image-prompt-tags.test.ts` passed: 1 file, 8 tests.
- `npm test -- src/features/agent-timeline` passed: 6 files, 25 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing 22 `<img>` warnings in editor UI components.

### T5 Timeline Inference and Canvas Binding

Summary:

- Restored the timeline workbench to a responsive three-column desktop layout and ordered the narrow layout so the selected node workspace and scene composer appear before the full workflow list.
- Added T5 LangGraph adapters for scene prompt inference, primary character tag extraction, character action/pose inference, and canvas binding.
- Reused `/api/llm/chat` from the client for all LLM calls and kept resource recommendation, parameter recommendation, ComfyUI execution, image storage, and result display blocked or reserved.
- Added structured parsing and normalization for scene prompt fragments, primary character tags, extra people context, stick-figure pose output, and canvas binding results.
- Bound the inferred primary character to the existing editor store as one editable 3D character/skeleton using existing editor store actions.
- Added run invalidation so superseded or cleared timeline graph runs cannot restore stale workflow output or bind stale canvas/editor state.
- Updated the T5 DAG so prompt generation feeds character tags and action planning as parallel sibling nodes, then layout planning joins prompt, tags, and action.
- Expanded prompt generation into the canonical shared scene context producer with a narrow editable visual table and raw JSON inspection/editing fallback.
- Restricted character tags and action planning to non-editable raw JSON inspection, and kept the existing editor 3D canvas plus prompt tag picker visual workspace on layout planning only.

Files changed:

- `src/features/agent-timeline/`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/agent-timeline/components/TimelineShell.test.tsx` passed: 1 file, 4 tests.
- `npm test -- src/features/agent-timeline` passed: 6 files, 23 tests.
- `npm run typecheck` passed.
- `npm run lint` passed with the existing 22 `<img>` warnings in editor UI components.
- `npm test` passed: 74 files, 482 tests.
- `npm run build` passed with the existing Turbopack NFT trace warning for `next.config.ts` through ComfyUI sequence reference storage.
- `git diff --check` passed with line-ending warnings only.
- Orchestrator evidence for the current pass also includes real Edge headless layout measurement passing on `http://localhost:3001`.
- PR follow-up validation: `npm test -- src/features/agent-timeline/components/TimelineShell.test.tsx` passed: 1 file, 4 tests.
- PR follow-up validation: `npm test -- src/features/agent-timeline` passed: 6 files, 23 tests.
- PR follow-up validation: `npm run typecheck` passed.
- PR follow-up validation: `npm run lint` passed with the existing 22 `<img>` warnings in editor UI components.
- PR follow-up validation: `npm run build` passed with the existing Turbopack NFT trace warning.
- Earlier PR follow-up browser fallback validation on `http://localhost:3000` confirmed the desktop workbench layout; the product clarification pass below was validated with focused automated timeline coverage.
- Product clarification implementation validation: `npm test -- src/features/agent-timeline` passed: 6 files, 25 tests.
- Product clarification implementation validation: `npm run typecheck` passed.
- Product clarification implementation validation: `npm run lint` passed with the existing 22 `<img>` warnings in editor UI components.
- Product clarification implementation validation: `npm test` passed: 74 files, 484 tests.
- Product clarification implementation validation: `npm run build` passed with the existing Turbopack NFT trace warning.
- Product clarification browser validation on `http://localhost:3000` passed in headless Edge: desktop workbench measured as three columns, node 2 rendered the visual scene-context table, nodes 3 and 4 rendered non-editable raw JSON only, node 5 rendered the reused editor canvas and prompt tag binding workspace, node 5 preserved node 2's primary character identity despite conflicting node 3 output, and node 4's LLM request did not include node 3 tag-only output.

### T4 Initial Timeline Shell

Summary:

- Replaced the root route with an in-memory initial scene request screen and vertical timeline shell seeded from the T3 timeline state helpers.
- Added reusable timeline UI primitives for node cards, status pills, manual editing, and AI retry/suggestion affordances.
- Rendered all MVP timeline nodes in dependency order with shell output states, manual edit stale propagation, reserved future nodes, and an explicit ComfyUI confirmation gate notice.
- Redesigned the timeline shell as a modern AI agent workflow workbench with left step navigation, a central selected-step workspace, right-side inspector/activity panels, command-style scene composer, input-transform-output panels, and stable responsive layout CSS.
- Moved the legacy editor shell to `/editor` and added a minimal `/settings` entry target without exposing local paths or secrets.

Files changed:

- `src/app/page.tsx`
- `src/app/editor/page.tsx`
- `src/app/settings/page.tsx`
- `src/features/agent-timeline/components/`
- `README.md`
- `docs/dev-log.md`

Validation:

- `npm run typecheck` passed.
- `npm run lint` passed with 22 pre-existing `<img>` warnings in editor UI components.
- `npm run build` passed with the existing Turbopack NFT trace warning for ComfyUI sequence references.
- `git diff --check` passed with line-ending warnings only.
- Existing dev server responded with HTTP 200 for `/`, `/editor`, and `/settings`.
- `npm test` passed: 72 files, 476 tests.
- Browser verification passed for `/`, `/editor`, and `/settings`; the root route submitted a scene request into the vertical timeline shell with no console errors.
- PR #10 was merged to `master`; Issue #9 closed automatically via the PR closing reference.

### T3 LangGraph Workflow Foundation

Summary:

- Added `@langchain/langgraph` as the timeline orchestration dependency.
- Added the transient `src/features/agent-timeline/` feature boundary with exported node ids, statuses, result/error types, dependency DAG helpers, readiness checks, manual edit stale propagation, regeneration eligibility, and generation gate blocking.
- Implemented a LangGraph-backed execution runner with injectable node adapters and branch-safe state merging for the canvas/resource recommendation split.
- Added a graph-friendly LiteLLM adapter wrapper around existing LLM interfaces with mocked-response tests and normalized LLM error categories.
- Kept ComfyUI execution and result display as reserved, non-executable downstream nodes for this issue.

Files changed:

- `package.json`
- `package-lock.json`
- `src/features/agent-timeline/`
- `docs/dev-log.md`

Validation:

- `npm test -- src/features/agent-timeline` passed: 2 files, 13 tests.
- `npm test` passed: 70 files, 472 tests.
- `npm run typecheck` initially failed because stale generated `.next/types` referenced removed `src/app/agent/*` routes; after `npm run build` refreshed generated metadata, `npm run typecheck` passed.
- `npm run lint` passed with 22 pre-existing `<img>` warnings in editor UI components.
- `npm run build` passed. Turbopack reported an existing NFT trace warning involving `next.config.ts`, `src/features/comfyui/sequence-reference-storage.ts`, and the ComfyUI sequence references route.

### Timeline MVP Requirements Reset

Summary:

- Product direction was reset from standalone Agent draft to a LangGraph-driven, single-image vertical timeline MVP.
- Closed PR #5 and Issue #4 as superseded by the new timeline requirements.
- Deleted the `issue-4-agent-draft-workflow` local and remote branch.
- Replanned unfinished work into T3-T8: LangGraph orchestration, timeline UI shell, scene/person/action inference with 3D binding, settings page, resource/parameter recommendation, and confirmed ComfyUI execution.
- Updated product, technical, planning, README, and agent guidance so future work uses LangGraph and existing LLM interfaces instead of a bespoke draft-only flow.

Files changed:

- `AGENTS.md`
- `README.md`
- `docs/product-vision.md`
- `docs/product-spec.md`
- `docs/tech-spec.md`
- `docs/plan.md`
- `docs/dev-log.md`

Validation:

- Documentation-only reset; application tests were not required.
- PR #5 is closed.
- Issue #4 is closed as not planned.
- Local and remote `issue-4-agent-draft-workflow` branch references were removed.

## 2026-05-28

### T1 Agent Backend Contract Audit

Summary:

- Audited existing LiteLLM, ComfyUI text-to-image, ComfyUI history/events, and generated image storage backend contracts for GitHub Issue #1.
- Documented the standalone Agent single-image draft contract, explicit confirmation gate, default ComfyUI workflow reuse, seed behavior, image storage behavior, and error taxonomy in `docs/tech-spec.md`.
- Concluded that no production code is required for T1: T2 should add Agent-specific draft schema validation around the existing LiteLLM client, and T3 should thin-wrap existing ComfyUI feature modules for confirmed execution.

Files changed:

- `docs/tech-spec.md`
- `docs/dev-log.md`

Validation:

- Automated tests were not run because this pass only updates technical documentation.
- Inspected the scoped documentation diff.
- `git diff --check` passed with line-ending warnings only.

### Documentation and Agent Workflow Bootstrap

Summary:

- Added root `AGENTS.md` as the SceneForge-specific Codex CLI guide.
- Updated `.codex/agents/product-agent.toml`, `dev-agent.toml`, `tester-agent.toml`, and `reviewer-agent.toml` from the old template project to SceneForge-specific instructions.
- Filled the `docs/` Markdown set with current product, technical, planning, logging, and lessons guidance.
- Added documentation indexes for issues, test reports, and review reports.

Files changed:

- `AGENTS.md`
- `.codex/agents/product-agent.toml`
- `.codex/agents/dev-agent.toml`
- `.codex/agents/tester-agent.toml`
- `.codex/agents/reviewer-agent.toml`
- `docs/README.md`
- `docs/product-vision.md`
- `docs/product-spec.md`
- `docs/tech-spec.md`
- `docs/plan.md`
- `docs/dev-log.md`
- `docs/lessons-learned.md`
- `docs/test-reports/README.md`
- `docs/review-reports/README.md`

Follow-up:

- Moved the former root design document into `docs/product-vision.md` and updated agent/documentation references.
- Reviewed the new docs and agent configs for consistency, then aligned agent write permissions, Track-to-Issue rules, and multi-agent handoff gates across `AGENTS.md`, `.codex/agents/`, and `docs/`.
- Updated the closeout workflow so the Orchestrator automatically commits, pushes, and creates a PR after test and review gates pass. PR merge remains manual.
- Added post-merge cleanup rules: after a user-approved PR merge, the Orchestrator closes linked Issues when needed and deletes merged temporary local/remote branches.
- Removed the local issue-draft workflow so GitHub Issues are the only durable issue-detail records.
- Added agent reasoning effort policy so the Orchestrator knows when to use `high` versus `xhigh` for each sub-agent.

Validation:

- TOML parsing passed for all four files under `.codex/agents/`.
- Searched for stale template-project references in the new agent guidance and found none.
- Application tests were not run because the change is documentation and agent configuration only.

Notes:

- `git status` requires the one-shot `safe.directory` override in this sandbox because repository ownership differs from the sandbox user.
- Source files contain some existing mojibake in comments and UI strings. That issue is documented as a separate risk in `docs/plan.md`.
