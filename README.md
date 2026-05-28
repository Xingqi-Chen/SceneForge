This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm install
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Continuous Integration

GitHub Actions runs the CI workflow on pull requests and pushes to `master`.
It can also be run manually from the Actions tab.
The workflow uses Node.js 20.x with the committed `package-lock.json`, then runs:

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

## LLM API

SceneForge exposes a server-side LiteLLM chat endpoint at `POST /api/llm/chat`. The **Prompt 预览** panel can call this endpoint when you use the optional AI-assisted prompt action (optional `model` override per request). The rest of the editor works without any LLM configuration.

Configure the LiteLLM proxy with server-only environment variables:

```bash
LITELLM_BASE_URL=http://localhost:4000
LITELLM_API_KEY=your-litellm-proxy-key
LITELLM_DEFAULT_MODEL=your-model-name
LITELLM_NSFW_MODEL=optional-nsfw-model
SCENEFORGE_SHOW_NSFW_BUTTON=false
LITELLM_CIVITAI_RECOMMENDATION_MODEL=optional-civitai-recommendation-model
```

The endpoint accepts `model`, `messages`, `temperature`, `maxTokens`, and optional `nsfw`. When a project has NSFW enabled, supported AI operations such as reverse prompt/pose and Comic Sequence storyboard generation use `LITELLM_NSFW_MODEL` by default if it is configured, then forward the request to LiteLLM's OpenAI-compatible `/v1/chat/completions` API.

Set `SCENEFORGE_SHOW_NSFW_BUTTON=true` to display the main editor NSFW toggle. It defaults to hidden when unset.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
