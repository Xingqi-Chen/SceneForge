import type {
  ComfyUiDiagnosisWebContext,
  ComfyUiDiagnosisWebSource,
  ComfyUiGenerationDiagnosisConfig,
  ComfyUiGenerationVisualDiagnosisResult,
} from "./comfyui-generation-diagnosis";
import type { TavilyClient, TavilySearchResponse } from "@/features/tavily";

export const COMFYUI_DIAGNOSIS_WEB_DOMAINS = [
  "civitai.com",
  "docs.comfy.org",
  "github.com",
  "huggingface.co",
  "stable-diffusion-art.com",
];

const MAX_QUERY_COUNT = 3;
const MAX_SOURCE_COUNT = 8;

type BuildComfyUiDiagnosisWebContextInput = {
  client: TavilyClient;
  config: ComfyUiGenerationDiagnosisConfig;
  userInput: string;
  visualDiagnosis: ComfyUiGenerationVisualDiagnosisResult;
};

function compactText(value: string | undefined, maxLength: number) {
  const compacted = (value ?? "").replace(/\s+/g, " ").trim();
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 3)}...` : compacted;
}

function readDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function getTopObservation(visualDiagnosis: ComfyUiGenerationVisualDiagnosisResult) {
  return visualDiagnosis.observations[0];
}

function getResourceSearchText(config: ComfyUiGenerationDiagnosisConfig) {
  const loraNames = config.loras
    .filter((lora) => lora.enabled)
    .slice(0, 3)
    .map((lora) => lora.resourceName || lora.loraName)
    .join(" ");
  const trainedWords = config.loras
    .flatMap((lora) => lora.trainedWords ?? [])
    .slice(0, 6)
    .join(" ");

  return compactText(
    [config.checkpointResourceName || config.checkpointName, config.checkpointBaseModel, loraNames, trainedWords]
      .filter(Boolean)
      .join(" "),
    220,
  );
}

export function buildComfyUiDiagnosisWebQueries(
  config: ComfyUiGenerationDiagnosisConfig,
  visualDiagnosis: ComfyUiGenerationVisualDiagnosisResult,
  userInput: string,
) {
  const topObservation = getTopObservation(visualDiagnosis);
  const resourceText = getResourceSearchText(config);
  const issueText = compactText(
    [
      userInput,
      topObservation?.category,
      topObservation?.likelyCause,
      topObservation?.fixDirection,
      visualDiagnosis.summary,
    ]
      .filter(Boolean)
      .join(" "),
    260,
  );

  return [
    `${resourceText} Civitai recommended settings LoRA weight trigger words ComfyUI`,
    `${issueText} Stable Diffusion ComfyUI fix prompt negative prompt LoRA weight`,
    `ComfyUI ${config.samplerName} ${config.scheduler} CFG steps denoise ${topObservation?.category ?? "image quality"} tuning Stable Diffusion`,
  ]
    .map((query) => compactText(query, 280))
    .filter(Boolean)
    .slice(0, MAX_QUERY_COUNT);
}

function toSources(response: TavilySearchResponse, query: string, relevance: string): ComfyUiDiagnosisWebSource[] {
  return response.results.map((result) => ({
    content: compactText(result.content, 700),
    domain: readDomain(result.url),
    query,
    relevance,
    score: result.score,
    title: compactText(result.title, 160) || result.url,
    url: result.url,
  }));
}

function sourceKey(source: ComfyUiDiagnosisWebSource) {
  return source.url.trim().toLowerCase();
}

export async function buildComfyUiDiagnosisWebContext({
  client,
  config,
  userInput,
  visualDiagnosis,
}: BuildComfyUiDiagnosisWebContextInput): Promise<ComfyUiDiagnosisWebContext> {
  const queries = buildComfyUiDiagnosisWebQueries(config, visualDiagnosis, userInput);
  const warnings: string[] = [];
  const sourcesByUrl = new Map<string, ComfyUiDiagnosisWebSource>();
  const summaries: string[] = [];

  const relevanceLabels = [
    "Current checkpoint and LoRA usage guidance",
    "Visual issue repair guidance",
    "Sampler and parameter tuning guidance",
  ];

  for (const [index, query] of queries.entries()) {
    try {
      const response = await client.search(query, {
        includeDomains: COMFYUI_DIAGNOSIS_WEB_DOMAINS,
      });
      if (response.answer) {
        summaries.push(`${relevanceLabels[index]}: ${response.answer}`);
      }

      for (const source of toSources(response, query, relevanceLabels[index])) {
        if (!sourcesByUrl.has(sourceKey(source))) {
          sourcesByUrl.set(sourceKey(source), source);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Tavily error.";
      warnings.push(`Tavily search failed for "${query}": ${message}`);
    }
  }

  const sources = Array.from(sourcesByUrl.values()).slice(0, MAX_SOURCE_COUNT);
  if (sources.length === 0) {
    warnings.push("No useful Tavily sources were found; using local diagnosis context.");
  }

  return {
    enabled: true,
    queries,
    sources,
    summary: compactText(summaries.join("\n"), 1800),
    warnings,
  };
}
