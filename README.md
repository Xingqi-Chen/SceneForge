# SceneForge

SceneForge is a local-first visual prompt workspace for AI image generation.

The current MVP direction is a single-scene, top-to-bottom Run timeline driven by LangGraph. Users enter one scene request, then review and edit scene prompt, character tags, 3D pose/canvas binding, checkpoint/LoRA selection, generation parameters, FaceDetailer, HandDetailer, and the final ComfyUI generation gate. Both text-to-image and img2img Runs deliver 1-4 selected final images.

## Screenshots

Timeline workflow:

![SceneForge timeline workflow](docs/assets/sceneforge-timeline.png)

Visual editor:

![SceneForge visual editor](docs/assets/sceneforge-editor.png)

## Getting Started

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser. The timeline MVP is the root route.
The legacy visual editor remains available at [http://localhost:3000/editor](http://localhost:3000/editor).
The Story Graph planning surface is available at [http://localhost:3000/story](http://localhost:3000/story). It accepts a story request, optional shot count, optional explicit checkpoint/LoRA style resources, and one optional global style reference image. The style reference is uploaded through the existing sequence-reference storage route, analyzed with LiteLLM vision chat into base-model-compatible reusable style prompt text, and appended as a complete prompt segment to every final or regenerated Story shot. The Core Settings Illustrious base model exposes IPAdapter `weight`, `start_at`, and `end_at` controls from 0 to 1; Anima and unsupported selected checkpoints use the analyzed prompt only. After a checkpoint is selected, the Story Parameters dialog can generate AI Style Advice for the selected resources and save ComfyUI generation parameters. Saved Story style resources bypass the `resource-plan` LLM, saved Story generation parameters bypass the `parameter-plan` LLM, and render-prompt planning can still use AI. It supports AI suggest/rewrite for the request and asks AI to choose the shot count when the field is left blank. It creates an inspectable `story-graph` workflow, supports confirmation-gated shot execution, and autosaves Story Graph state through the same local workflow record storage used by Run. The Story header includes a workflow project menu for opening saved Story Graph workflows before entering a node and for saving named workflows after planning starts. Audience rating is derived internally from the Settings NSFW switch.

After importing or changing local Civitai model/LoRA metadata, rebuild the derived FTS search index and then the derived sqlite-vec embedding index used by recommendation ranking:

```bash
npm run civitai:reindex
npm run civitai:reindex-embeddings
```

Both commands read `SCENEFORGE_SQLITE_FILE` from the shell environment first, then from `.env.local` or `.env`, and otherwise use `data/sceneforge.sqlite`. `npm run civitai:reindex` rebuilds only the derived Civitai FTS index and does not rewrite original Civitai resource rows. `npm run civitai:reindex-embeddings` requires the FTS index to already exist, reads `LITELLM_BASE_URL`, optional `LITELLM_API_KEY`, and `LITELLM_CIVITAI_EMBEDDING_MODEL`, then rebuilds only derived chunked vector tables/metadata from the full FTS source text. Run both again after importing or modifying Civitai resources so recommendations do not use stale indexes.

## Continuous Integration

GitHub Actions runs the CI workflow on pull requests and pushes to `master`.
It can also be run manually from the Actions tab.
The workflow uses Node.js 22.x with the committed `package-lock.json`, then runs:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

## MVP Workflow

The MVP starts with a Scene Composer, a start button, and a settings entry point. The Composer can optionally select ready local checkpoint/LoRA resources, save supported ComfyUI parameters with user-triggered AI Style Advice, configure independent FaceDetailer and HandDetailer settings, and attach an img2img source. After the user submits the scene request, SceneForge expands a vertical timeline:

1. Scene prompt inference.
2. Character tag inference.
3. Character action and 3D pose inference.
4. 3D canvas binding.
5. Checkpoint and LoRA recommendation.
6. Generation parameter recommendation.
7. Start image generation gate.
8. Confirmed low-step, longest-edge-512 preview generation.
9. Structured Vision scoring and Top-K selection.
10. Full-resolution img2img second-pass execution.
11. Result display.

Every node exposes manual controls and an AI retry/suggestion action. User edits mark dependent downstream nodes stale and LangGraph regenerates only those dependent nodes. The timeline must stop before ComfyUI execution until the user explicitly clicks start image generation.

Explicit Composer resources bypass the resource-recommendation provider. Saved Composer parameters require an explicit checkpoint and bypass automatic parameter advice; leaving parameters unsaved preserves the automatic path. Changing checkpoint or LoRAs clears saved parameters and prior Style Advice. After a Run starts, resource changes stale from resource recommendation, while parameter or Detailer changes stale from parameter recommendation; both cancel prior confirmation without discarding completed prompt, tag, pose, or canvas work. Detailers are user-controlled only and are never sent to AI planning. Both text-to-image and img2img keep the selected 1-4 final output count. A Run generates 4/4/6/8 independent previews for K=1/2/3/4, scores them with a Vision model, and renders the selected K previews at formal dimensions with fixed second-pass denoise 0.50. Source-img2img previews use the Composer source dimensions and denoise.

The shared Run Scene Composer also accepts one optional PNG, JPEG, or WEBP global style reference. SceneForge stores it through the existing sequence-reference boundary and analyzes it through LiteLLM vision into one reusable `stylePrompt` segment. The segment is appended exactly once after Run resource-aware prompt formatting. Illustrious-capable checkpoints may additionally enable IPAdapter with defaults `weight=0.45`, `start_at=0`, and `end_at=1`; Anima, unknown, and unsupported checkpoints remain prompt-only. Pending, failed, or model-mismatched analysis blocks start, regeneration, and confirmation until the reference is retried, replaced, or removed. Workflow JSON stores only sanitized metadata, analysis context/status, and adapter settings—not image bytes or data URLs.

The active timeline workflow is autosaved locally. After a workflow has started, SceneForge restores the active workflow when you visit Settings and return, or when you reload the Run page and the active record is still available. Interrupted running nodes restore as visible retryable errors rather than pretending background work continued while the page was away. The Run header also includes a workflow project menu for saved timeline workflows: save the current active draft as a named workflow, open a saved workflow, rename it, refresh the list, or delete saved workflow records.

## LLM API

SceneForge exposes a server-side LiteLLM chat endpoint at `POST /api/llm/chat`. Existing AI features use this endpoint for prompt, tag, pose, diagnosis, enrichment, and recommendation flows. Timeline work should reuse these interfaces through graph-friendly adapters before adding any new LLM route.

Configure the LiteLLM proxy with server-only environment variables:

```bash
LITELLM_BASE_URL=http://localhost:4000
LITELLM_API_KEY=your-litellm-proxy-key
LITELLM_DEFAULT_MODEL=your-model-name
LITELLM_NSFW_MODEL=optional-nsfw-model
LITELLM_VISION_MODEL=optional-vision-model
SCENEFORGE_SHOW_NSFW_BUTTON=false
LITELLM_CIVITAI_RECOMMENDATION_MODEL=optional-civitai-recommendation-model
LITELLM_CIVITAI_EMBEDDING_MODEL=required-civitai-embedding-model
```

The endpoint accepts `model`, `messages`, `temperature`, `maxTokens`, and optional `nsfw`. Requests marked `nsfw` use `LITELLM_NSFW_MODEL` when it is configured before forwarding to LiteLLM's OpenAI-compatible `/v1/chat/completions` API. Story Graph LLM planning nodes also use `LITELLM_NSFW_MODEL` for NSFW workflows, except `shot-dependency-graph`, `resource-plan`, and `parameter-plan`. Run preview scoring uses `LITELLM_VISION_MODEL`, then the default model, for ordinary Runs. NSFW preview scoring requires a multimodal `LITELLM_NSFW_MODEL` and never sends those preview images to the ordinary Vision/default model. Run and Story style-reference analysis reuse the `story-style-reference-analysis` purpose and fall back to `LITELLM_VISION_MODEL`, then `LITELLM_DEFAULT_MODEL`, when no explicit model is provided. Civitai semantic candidate retrieval requires `LITELLM_CIVITAI_EMBEDDING_MODEL` through LiteLLM's `/v1/embeddings` API during `npm run civitai:reindex-embeddings` and recommendation requests. Long Civitai source text is embedded in overlapping chunks, and recommendation ranking uses each resource's nearest chunk. Timeline model-resource and render-parameter recommendation nodes keep their purpose-specific models.

## Settings

The MVP settings page should centralize configuration outside the main timeline:

- NSFW mode.
- Project storage path.
- Prompt library path.
- Generated image storage path.
- ComfyUI temp directory path.
- Civitai LoRA, checkpoint, diffusion model, and ControlNet resource paths and status.
- ComfyUI connection status.
- LiteLLM configuration status.

Secrets should remain server-only in `.env.local` unless a later scoped issue adds secure runtime secret editing. The settings UI may display whether a secret is configured, but must not echo secret values.

## Local Data

Runtime data is stored under `data/` by default or in configured absolute paths. Do not commit generated projects, logs, caches, databases, downloaded assets, or generated images.

SQLite-backed settings and Civitai metadata use `data/sceneforge.sqlite` by default. Set `SCENEFORGE_SQLITE_FILE` to an absolute path to override the database location. `npm run civitai:reindex` and `npm run civitai:reindex-embeddings` use the same value from the shell, `.env.local`, or `.env`.

Timeline workflow records are stored under `data/timeline-workflows/` by default. The active autosave record remains `active-workflow.json`; named workflow records are separate JSON files in the same directory. Records can hold either `single-image` Run workflows or `story-graph` workflows. They contain local workflow state and references needed to restore progress; they must not contain API keys, `.env.local` secret values, generated image bytes, downloaded models, caches, logs, or local resource databases. Deleting a named workflow removes only that workflow JSON record and does not delete generated images or external assets referenced by the workflow.

Important environment variables are documented in `.env.example`.

## Privacy and Local Logs

SceneForge is designed for local use. LLM request, response, and error records are written to split local JSONL files under `data/logs/llm/<category>/<YYYY-MM-DD>.jsonl` by default. Current categories include `chat`, `civitai-enrichment`, `civitai-recommendation`, `story-planning`, and `misc`. Records keep full text prompts and model responses for diagnosis, while image data URLs are redacted before writing. The log directory is ignored by git, but users should still treat it as private local data.

Split logs are pruned after 14 days by default. Set `SCENEFORGE_LLM_LOG_RETENTION_DAYS=off` to keep split logs until manually deleted, or set `SCENEFORGE_LLM_LOG_DIR` to move the split log root. Set `SCENEFORGE_LLM_LOG_DIR=off` to disable split local logging when `SCENEFORGE_LLM_LOG_FILE` is unset.

To disable LLM local logging, set:

```bash
SCENEFORGE_LLM_LOG_FILE=off
```

`SCENEFORGE_LLM_LOG_FILE` remains available as a legacy single-file override. When it is set to a file path, SceneForge writes only that file and skips split-log pruning. Existing `data/logs/llm-chat.jsonl` files are not migrated automatically; delete that file, the split log directory, or the custom file configured by `SCENEFORGE_LLM_LOG_FILE` to clear local logs.

## Third-Party Services and Content

SceneForge can connect to local or user-configured services such as LiteLLM, ComfyUI, Tavily, Civitai, and artist-string source pages. Users are responsible for complying with each service's terms, model licenses, content policies, and applicable law. The repository does not distribute generated images, downloaded models, LoRAs, checkpoints, Civitai caches, prompt-library runtime data, or local project files.

Do not expose the development server directly to the public internet without adding authentication, authorization, rate limiting, path isolation, and a deployment-specific review of the local file and integration routes.

## License

SceneForge is released under the MIT License. See `LICENSE`.

Third-party dependency license inventory is maintained in `docs/third-party-licenses.md`.

## Documentation

Product and technical planning lives in:

- `docs/product-vision.md`
- `docs/product-spec.md`
- `docs/tech-spec.md`
- `docs/plan.md`
