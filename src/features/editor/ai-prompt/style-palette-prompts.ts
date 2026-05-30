import type { SelectedCivitaiResourcesPreview } from "@/features/civitai-lora-library";
import type { LlmChatMessage } from "@/features/llm";

import {
  buildCivitaiAiJsonResponseInstructions,
  formatSelectedCivitaiResourcesForAi,
} from "./civitai-ai-context";
import {
  COMFYUI_SAMPLER_OPTIONS,
  COMFYUI_SCHEDULER_OPTIONS,
  formatComfyUiOptionValuesForPrompt,
} from "./comfyui-generation-options";

export type StylePalettePromptPresetId =
  | "portrait"
  | "full-body"
  | "indoor"
  | "outdoor"
  | "action"
  | "object";

export type StylePalettePromptPreset = {
  id: StylePalettePromptPresetId;
  label: string;
  description: string;
  positive: string;
  negative: string;
};

const CHARACTER_NEGATIVE_PROMPT = [
  "low quality",
  "worst quality",
  "blurry",
  "text",
  "watermark",
].join(", ");

const SCENE_NEGATIVE_PROMPT = [
  "low quality",
  "worst quality",
  "blurry",
  "text",
  "watermark",
].join(", ");

const OBJECT_NEGATIVE_PROMPT = [
  "low quality",
  "worst quality",
  "blurry",
  "text",
  "watermark",
].join(", ");

export const STYLE_PALETTE_PROMPT_PRESETS: StylePalettePromptPreset[] = [
  {
    id: "portrait",
    label: "Portrait",
    description: "Generic portrait for face, linework, color, and texture checks.",
    positive:
      "1girl, solo, upper body, looking at viewer, simple background, detailed face",
    negative: CHARACTER_NEGATIVE_PROMPT,
  },
  {
    id: "full-body",
    label: "Full body",
    description: "Generic full-body character view for outfit, proportion, and style consistency checks.",
    positive:
      "1girl, solo, full body, looking at viewer, simple background, detailed face",
    negative: CHARACTER_NEGATIVE_PROMPT,
  },
  {
    id: "indoor",
    label: "Indoor",
    description: "Small interior scene for material, space, and window-light checks.",
    positive:
      "quiet indoor room, window light, simple furniture, everyday objects, clear foreground and background, cozy atmosphere, readable spatial depth, balanced color palette",
    negative: SCENE_NEGATIVE_PROMPT,
  },
  {
    id: "outdoor",
    label: "Outdoor",
    description: "Wide environment scene for mood, palette, and depth checks.",
    positive:
      "wide outdoor scene, open sky, path or street leading into the distance, foreground middle ground and background, natural atmospheric perspective, coherent lighting, balanced scenery",
    negative: SCENE_NEGATIVE_PROMPT,
  },
  {
    id: "action",
    label: "Action",
    description: "Dynamic character pose for motion, shape stability, and style consistency checks.",
    positive:
      "one young adult character, dynamic action pose, diagonal composition, flowing hair and clothing, sense of motion, clean readable silhouette, simple background, dramatic but clear lighting",
    negative: CHARACTER_NEGATIVE_PROMPT,
  },
  {
    id: "object",
    label: "Object",
    description: "Single prop/object render for material, edges, and rendering-style checks.",
    positive:
      "single detailed object on a neutral surface, simple clean background, three-quarter view, clear silhouette, visible material texture, soft studio lighting, centered composition",
    negative: OBJECT_NEGATIVE_PROMPT,
  },
];

function normalizePromptPart(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function splitPromptParts(value: string) {
  return value
    .split(/[,，\n]+/g)
    .map(normalizePromptPart)
    .filter(Boolean);
}

function dedupePromptParts(parts: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of parts) {
    const key = part.toLocaleLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(part);
  }

  return result;
}

export function getStylePalettePromptPreset(id: string) {
  return STYLE_PALETTE_PROMPT_PRESETS.find((preset) => preset.id === id) ?? STYLE_PALETTE_PROMPT_PRESETS[0];
}

export function buildStylePalettePositivePrompt(input: {
  artistPrompts: string[];
  preset: StylePalettePromptPreset;
  resources: SelectedCivitaiResourcesPreview;
}) {
  const resourceTriggerWords = input.resources.loras.flatMap((lora) => lora.trainedWords);
  const parts = [
    ...splitPromptParts(input.preset.positive),
    ...input.artistPrompts.flatMap(splitPromptParts),
    ...resourceTriggerWords.map(normalizePromptPart),
  ];

  return dedupePromptParts(parts).join(", ");
}

export function buildStylePaletteActivePrompt(input: {
  stylePrompt: string;
  subjectPrompt: string;
}) {
  return dedupePromptParts([
    ...splitPromptParts(input.subjectPrompt),
    ...splitPromptParts(input.stylePrompt),
  ]).join(", ");
}

export function normalizeStylePaletteSubjectPrompt(value: string) {
  const withoutFence = value
    .trim()
    .replace(/^```[a-zA-Z0-9_-]*\s*/, "")
    .replace(/\s*```$/, "")
    .trim();
  const withoutLabel = withoutFence.replace(
    /^(?:danbooru\s+tags|danbooru\s+prompt|subject\s+tags|tags|prompt|subject)\s*:\s*/i,
    "",
  );

  return dedupePromptParts(splitPromptParts(withoutLabel)).join(", ");
}

export function buildStylePaletteSubjectDanbooruMessages(input: { subject: string }): LlmChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are SceneForge's Danbooru tag normalizer for Stable Diffusion prompts.",
        "Convert one character, object, or subject name into concise Danbooru/booru-style positive prompt tags.",
        "Return only comma-separated tags. Do not include markdown, labels, explanations, style tags, quality tags, lighting, composition, or negative prompt terms.",
        "Do not connect separate words with underscores; preserve underscores only when they are part of a known canonical tag, character name, object name, or exact source token.",
      ].join("\n"),
    },
    {
      role: "user",
      content: `Subject name:\n${input.subject.trim()}`,
    },
  ];
}

export function buildStylePaletteAdviceMessages(input: {
  artistPrompts: string[];
  preset: StylePalettePromptPreset;
  resources: SelectedCivitaiResourcesPreview;
}): LlmChatMessage[] {
  const civitaiContext = formatSelectedCivitaiResourcesForAi(input.resources) ?? "none";
  const artistPrompt = dedupePromptParts(input.artistPrompts.flatMap(splitPromptParts)).join(", ") || "none";

  return [
    {
      role: "system",
      content: [
        "You are SceneForge's style palette assistant for Stable Diffusion and ComfyUI.",
        "Your task is only to evaluate the selected artist strings, checkpoint, and LoRAs as a style combination.",
        "Return JSON only. Do not wrap it in markdown.",
        buildCivitaiAiJsonResponseInstructions(),
        "The JSON prompt field must be the supplied preset positive prompt plus useful artist prompt parts and listed LoRA trigger words only.",
        "Do not invent image subjects, characters, poses, actions, locations, or compositions beyond the supplied preset.",
        "Do not rewrite the preset into a new scene. Keep prompt content generic so style can be tested without subject-specific prompt interference.",
        "parameterSuggestions should focus on sampler, scheduler, steps, CFG, resolution, negativePromptAdditions, and LoRA weights.",
        `sampler must be one ComfyUI KSampler sampler_name value from: ${formatComfyUiOptionValuesForPrompt(COMFYUI_SAMPLER_OPTIONS)}.`,
        `scheduler must be one ComfyUI KSampler scheduler value from: ${formatComfyUiOptionValuesForPrompt(COMFYUI_SCHEDULER_OPTIONS)}.`,
        "Return sampler and scheduler as separate fields. Do not return combined A1111/Civitai strings such as \"DPM++ 2M Karras\".",
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          artistPrompt,
          civitaiResources: civitaiContext,
          preset: {
            id: input.preset.id,
            label: input.preset.label,
            positive: input.preset.positive,
            negative: input.preset.negative,
          },
        },
        null,
        2,
      ),
    },
  ];
}
