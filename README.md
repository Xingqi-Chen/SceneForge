# SceneForge

SceneForge is a local-first visual prompt workspace for AI image generation.

The current MVP direction is a single-image, top-to-bottom timeline driven by LangGraph. Users enter one scene request, then review and edit scene prompt, character tags, 3D pose/canvas binding, checkpoint/LoRA selection, generation parameters, and the final ComfyUI generation gate.

## Getting Started

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser. The timeline MVP is the root route.
The legacy visual editor remains available at [http://localhost:3000/editor](http://localhost:3000/editor).

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

The MVP starts with only a scene input, a start button, and a settings entry point. After the user submits the scene request, SceneForge expands a vertical timeline:

1. Scene prompt inference.
2. Character tag inference.
3. Character action and 3D pose inference.
4. 3D canvas binding.
5. Checkpoint and LoRA recommendation.
6. Generation parameter recommendation.
7. Start image generation gate.
8. Confirmed single-image ComfyUI execution.
9. Result display.

Every node exposes manual controls and an AI retry/suggestion action. User edits mark dependent downstream nodes stale and LangGraph regenerates only those dependent nodes. The timeline must stop before ComfyUI execution until the user explicitly clicks start image generation.

## LLM API

SceneForge exposes a server-side LiteLLM chat endpoint at `POST /api/llm/chat`. Existing AI features use this endpoint for prompt, tag, pose, diagnosis, enrichment, and recommendation flows. Timeline work should reuse these interfaces through graph-friendly adapters before adding any new LLM route.

Configure the LiteLLM proxy with server-only environment variables:

```bash
LITELLM_BASE_URL=http://localhost:4000
LITELLM_API_KEY=your-litellm-proxy-key
LITELLM_DEFAULT_MODEL=your-model-name
LITELLM_NSFW_MODEL=optional-nsfw-model
SCENEFORGE_SHOW_NSFW_BUTTON=false
LITELLM_CIVITAI_RECOMMENDATION_MODEL=optional-civitai-recommendation-model
```

The endpoint accepts `model`, `messages`, `temperature`, `maxTokens`, and optional `nsfw`. Supported AI operations use `LITELLM_NSFW_MODEL` by default when NSFW is enabled and that model is configured, then forward the request to LiteLLM's OpenAI-compatible `/v1/chat/completions` API.

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

Important environment variables are documented in `.env.example`.

## Documentation

Product and technical planning lives in:

- `docs/product-vision.md`
- `docs/product-spec.md`
- `docs/tech-spec.md`
- `docs/plan.md`
