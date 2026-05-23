"use client";

import { Palette, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { ArtistStringItemRecord } from "@/features/artist-string-library";
import { formatArtistStringForPlatform } from "@/features/artist-string-library/novelai-artist-string";
import type {
  SelectedCivitaiResourcePreview,
  SelectedCivitaiResourcesPreview,
} from "@/features/civitai-lora-library";
import { getCivitaiImageVariantUrl } from "@/features/civitai-lora-library/image-url";
import { dispatchOpenCivitaiLibraryResourceDetail } from "@/features/civitai-lora-library/ui-events";
import {
  buildCivitaiAiJsonResponseInstructions,
  formatSelectedCivitaiResourcesForAi,
  hasSelectedCivitaiResources,
  parseCivitaiAiPromptResponse,
  selectedCivitaiResourceCards,
  type CivitaiAiPromptResult,
} from "@/features/editor/ai-prompt/civitai-ai-context";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { generatePrompt } from "@/features/prompt-engine";
import { inferSceneLayoutConstraints } from "@/features/prompt-engine/spatial-relations";
import { getLlmProxyErrorMessage, isLlmChatResponse } from "@/features/llm";
import type { ArtistStringPromptRenderMode, PromptTag, SceneForgeProject } from "@/shared/types";
import { characterAppearsInThreeViewport } from "@/shared/utils/character-space";

import { getCharacterStickFigurePose } from "@/features/editor/stick-figure-3d/get-character-stick-pose";
import { stickFigurePoseToPromptSnippet } from "@/features/editor/stick-figure-3d/PromptExporter";

type AiGenerationStatus = "idle" | "loading" | "success" | "error";
type SelectedResourceStatus = "idle" | "loading" | "success" | "error";

type PromptPreviewPanelProps = {
  onCaptureCanvas?: () => string | null;
};

type AiGenerationConstraints = {
  layout: boolean;
  pose: boolean;
  visual: boolean;
};

const EMPTY_SELECTED_CIVITAI_RESOURCES: SelectedCivitaiResourcesPreview = {
  checkpoint: null,
  loras: [],
};

type SelectedArtistStringsResponse = {
  items: ArtistStringItemRecord[];
};

const ARTIST_STRING_PROMPT_RENDER_MODE_OPTIONS: Array<{
  value: ArtistStringPromptRenderMode;
  label: string;
}> = [
  { value: "artist-weight", label: "(artist:name:weight)" },
  { value: "by-weight", label: "by name:weight" },
  { value: "novelai", label: "NovelAI" },
];

function readErrorMessage(payload: unknown, fallback: string) {
  if (
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof (payload as { error?: unknown }).error === "object" &&
    (payload as { error?: { message?: unknown } }).error &&
    typeof (payload as { error: { message?: unknown } }).error.message === "string"
  ) {
    return (payload as { error: { message: string } }).error.message;
  }

  return fallback;
}

async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(readErrorMessage(payload, response.statusText || "请求失败。"));
  }

  return payload as T;
}

function buildSelectedCivitaiResourcesQuery(checkpointId: string | null, loraIds: string[]) {
  const params = new URLSearchParams();

  if (checkpointId) {
    params.set("checkpointId", checkpointId);
  }

  if (loraIds.length > 0) {
    params.set("loraIds", loraIds.join(","));
  }

  return params.toString();
}

function selectedResourceVersionLabel(resource: SelectedCivitaiResourcePreview) {
  return resource.versionName?.trim() || "Unknown version";
}

function formatArtistStringSequence(value: number) {
  return String(value).padStart(3, "0");
}

function createPromptTagId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatSelectedArtistPrompt(item: ArtistStringItemRecord, renderMode: ArtistStringPromptRenderMode) {
  return formatArtistStringForPlatform(item.structuredArtistString, item.promptFormat, { renderMode });
}

function makeSelectedArtistPromptTag(item: ArtistStringItemRecord, prompt: string): PromptTag {
  return {
    id: createPromptTagId("artist-string"),
    label: `NAI ${formatArtistStringSequence(item.sourceSequence)} / ${item.categoryName}`,
    prompt,
    category: "style",
    subcategory: "style-rendering",
    weight: { enabled: false, value: 1 },
  };
}

function compactPromptSnippet(value: string, max = 180) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max)}...` : compact;
}

function findSceneArtistPromptTagIds(tags: SceneForgeProject["scene"]["promptTags"], prompt: string) {
  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) {
    return [];
  }

  return tags
    .filter(
      (tag) =>
        /^NAI \d{3} \//.test(tag.label) &&
        tag.category === "style" &&
        tag.subcategory === "style-rendering" &&
        !tag.negative &&
        tag.prompt.trim() === normalizedPrompt,
    )
    .map((tag) => tag.id);
}

function SelectedCivitaiResourceCard({
  onOpenDetail,
  onRemove,
  resource,
}: {
  onOpenDetail: () => void;
  onRemove: () => void;
  resource: SelectedCivitaiResourcePreview;
}) {
  const previewImage = resource.previewImage
    ? (getCivitaiImageVariantUrl(resource.previewImage, 256) ?? resource.previewImage)
    : null;

  return (
    <div className="grid gap-3 rounded-md border border-slate-200 bg-white p-3 sm:grid-cols-[72px_1fr]">
      <button
        aria-label={`打开 ${resource.name} 的 Civitai 详情`}
        className="flex h-[72px] w-[72px] overflow-hidden rounded-md bg-slate-100 transition hover:ring-2 hover:ring-indigo-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
        onClick={onOpenDetail}
        title="打开 Civitai 详情"
        type="button"
      >
        {previewImage ? (
          <img
            alt={`${resource.name} official reference`}
            className="h-full w-full object-cover"
            decoding="async"
            loading="lazy"
            src={previewImage}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">
            No image
          </div>
        )}
      </button>
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
              {resource.resourceType === "model" ? "Checkpoint" : "LoRA"}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
              {selectedResourceVersionLabel(resource)}
            </span>
          </div>
          <button
            aria-label={`去选中 ${resource.name}`}
            className="shrink-0 rounded-full p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
            onClick={onRemove}
            title="去选中"
            type="button"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <p className="mt-1 truncate text-sm font-semibold text-slate-900" title={resource.name}>
          {resource.name}
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          {resource.trainedWords.length > 0 ? (
            resource.trainedWords.map((word) => (
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600" key={word}>
                {word}
              </span>
            ))
          ) : (
            <span className="text-[11px] text-slate-400">无触发词</span>
          )}
        </div>
      </div>
    </div>
  );
}

function SelectedArtistStringResourceCard({
  item,
  onRemove,
  renderMode,
}: {
  item: ArtistStringItemRecord;
  onRemove: () => void;
  renderMode: ArtistStringPromptRenderMode;
}) {
  const previewImage = item.referenceImages.find((image) => image.localUrl)?.localUrl ?? null;
  const formattedPrompt = formatSelectedArtistPrompt(item, renderMode);
  const sequenceLabel = `NAI ${formatArtistStringSequence(item.sourceSequence)}`;

  return (
    <div className="grid gap-3 rounded-md border border-fuchsia-100 bg-white p-3 sm:grid-cols-[72px_1fr]">
      <div className="flex h-[72px] w-[72px] overflow-hidden rounded-md bg-slate-100">
        {previewImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={`${sequenceLabel} reference`}
            className="h-full w-full object-cover"
            decoding="async"
            loading="lazy"
            src={previewImage}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-400">
            No image
          </div>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-fuchsia-50 px-2 py-0.5 text-[10px] font-medium text-fuchsia-700">
              {sequenceLabel} / {item.categoryName}
            </span>
          </div>
          <button
            aria-label={`去选中 ${sequenceLabel}`}
            className="shrink-0 rounded-full p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
            onClick={onRemove}
            title="去选中"
            type="button"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-600 [overflow-wrap:anywhere]">
          {compactPromptSnippet(formattedPrompt, 160)}
        </p>
      </div>
    </div>
  );
}

function formatTagsForAi(tags: SceneForgeProject["scene"]["promptTags"]) {
  return tags
    .map((tag) => tag.prompt.trim())
    .filter(Boolean)
    .join(", ");
}

function describeHorizontalRelation(leftX: number, rightX: number) {
  const delta = leftX - rightX;

  if (Math.abs(delta) < 40) {
    return "horizontally aligned with";
  }

  return delta < 0 ? "left of" : "right of";
}

function describeVerticalRelation(topY: number, bottomY: number) {
  const delta = topY - bottomY;

  if (Math.abs(delta) < 40) {
    return "level with";
  }

  return delta < 0 ? "above" : "below";
}

function getObjectCenter(object: SceneForgeProject["scene"]["objects"][number]) {
  return {
    x: object.position.x + object.size.width / 2,
    y: object.position.y + object.size.height / 2,
  };
}

function getCharacterJointPosition(
  character: SceneForgeProject["scene"]["characters"][number],
  jointId: keyof SceneForgeProject["scene"]["characters"][number]["joints"],
) {
  const joint = character.joints[jointId];
  const sx = character.scaleX ?? 1;
  const sy = character.scaleY ?? 1;
  const rot = character.rotation ?? 0;
  const scaled = { x: joint.x * sx, y: joint.y * sy };
  const rad = (rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rx = scaled.x * cos - scaled.y * sin;
  const ry = scaled.x * sin + scaled.y * cos;

  return {
    x: character.position.x + rx,
    y: character.position.y + ry,
  };
}

function summarizeCharacterPoseForAi(
  character: SceneForgeProject["scene"]["characters"][number],
  scene: SceneForgeProject["scene"],
) {
  const joints = Object.entries(character.joints)
    .map(([jointId, position]) => `${jointId}: (${position.x},${position.y})`)
    .join("; ");

  const bodyParts = character.bodyParts
    .map((bodyPart) => `${bodyPart.label}: ${formatTagsForAi(bodyPart.promptTags) || "no prompt tags"}`)
    .join("; ");

  const lines = [
    `${character.name}: ${character.description || "character skeleton"}`,
    `Character origin: x=${character.position.x}, y=${character.position.y}, rotation=${character.rotation ?? 0}, scaleX=${character.scaleX ?? 1}, scaleY=${character.scaleY ?? 1}`,
    `Character prompt tags: ${formatTagsForAi(character.promptTags) || "none"}`,
    `Skeleton joints (local space, for pose inference only — do not quote coordinates in output): ${joints}`,
    `Body parts and local tags: ${bodyParts || "none"}`,
  ];
  if (scene.mode === "3d" && characterAppearsInThreeViewport(character)) {
    const pose = getCharacterStickFigurePose(character);
    lines.push(`3D stick pose hint: ${stickFigurePoseToPromptSnippet(pose)}`);
  }

  return lines.join("\n");
}

function summarizeObjectCharacterRelations(project: SceneForgeProject) {
  const { scene } = project;
  const objects = scene.objects.filter((object) => object.includeInPrompt);
  const characters = scene.characters.filter((character) => character.includeInPrompt);

  return objects.flatMap((object) => {
    const objectCenter = getObjectCenter(object);

    return characters.map((character) => {
      const hip = getCharacterJointPosition(character, "hip");
      const hRel = describeHorizontalRelation(objectCenter.x, hip.x);
      const vRel = describeVerticalRelation(objectCenter.y, hip.y);
      const horizontal =
        hRel === "horizontally aligned with"
          ? "roughly aligned with"
          : hRel === "left of"
            ? "to the viewer's left of"
            : "to the viewer's right of";
      const vertical =
        vRel === "level with"
          ? "around the same vertical band as"
          : vRel === "above"
            ? "above"
            : "below";

      return `${object.name}: ${horizontal} ${character.name}, ${vertical} the character's torso (hint only — phrase naturally in the final prompt, e.g. props beside or behind the figure).`;
    });
  });
}

function summarizeSceneForAi(project: SceneForgeProject, includeHardLayoutConstraints: boolean) {
  const { scene } = project;
  const layoutConstraints = includeHardLayoutConstraints && project.settings.includeSpatialHints
    ? inferSceneLayoutConstraints(scene)
    : null;
  const objects = scene.objects
    .filter((object) => object.includeInPrompt)
    .map(
      (object) =>
        [
          `${object.name}: ${object.description || object.kind}`,
          `position: x=${object.position.x}, y=${object.position.y}, width=${object.size.width}, height=${object.size.height}, rotation=${object.rotation}`,
          `center: x=${Math.round(getObjectCenter(object).x)}, y=${Math.round(getObjectCenter(object).y)}`,
          `prompt tags: ${formatTagsForAi(object.promptTags) || "none"}`,
        ].join("; "),
    );
  const characters = scene.characters
    .filter((character) => character.includeInPrompt)
    .map((character) => summarizeCharacterPoseForAi(character, scene));
  const objectCharacterRelations = summarizeObjectCharacterRelations(project);

  return [
    `Scene: ${scene.name}`,
    `Canvas: ${scene.canvas.width}x${scene.canvas.height}, background ${scene.canvas.background}`,
    scene.description ? `Description: ${scene.description}` : null,
    `Scene prompt tags: ${formatTagsForAi(scene.promptTags) || "none"}`,
    layoutConstraints ? `Hard layout constraints:\n${layoutConstraints}` : null,
    objects.length > 0 ? `Objects:\n${objects.join("\n")}` : "Objects: none",
    characters.length > 0 ? `Characters:\n${characters.join("\n\n")}` : "Characters: none",
    objectCharacterRelations.length > 0
      ? `Object-character spatial relations:\n${objectCharacterRelations.join("\n")}`
      : "Object-character spatial relations: none",
  ]
    .filter(Boolean)
    .join("\n");
}

function summarizeCameraForAi(project: SceneForgeProject) {
  const { scene } = project;

  if (scene.mode !== "3d") {
    return "2D canvas view: preserve the screenshot framing, crop, and apparent viewing angle.";
  }

  const { camera } = scene.three;

  return [
    "3D camera view metadata (reference only — do not quote coordinates in output):",
    `camera position: x=${camera.position.x}, y=${camera.position.y}, z=${camera.position.z}`,
    `camera target: x=${camera.target.x}, y=${camera.target.y}, z=${camera.target.z}`,
    `field of view: ${camera.fov}`,
    "Use this metadata together with the screenshot to infer natural terms such as low angle, high angle, side view, three-quarter view, close-up, or wide shot.",
  ].join("\n");
}

function getConstraintButtonClass(enabled: boolean) {
  return `h-8 min-w-0 whitespace-nowrap rounded-md px-2 text-xs transition-all disabled:opacity-60 ${
    enabled
      ? "border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100"
      : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
  }`;
}

function buildAiSystemPrompt(
  constraints: AiGenerationConstraints,
  options: { civitaiAware: boolean } = { civitaiAware: false },
) {
  const priority = [
    constraints.layout ? "hard layout constraints" : null,
    constraints.pose ? "the character pose in the screenshot" : null,
    constraints.visual ? "the current camera angle / shot perspective" : null,
    "the canvas screenshot",
    "the user's prompt preview",
  ]
    .filter(Boolean)
    .join(", ");
  const rules = [
    constraints.layout
      ? "Preserve object placement from the canvas: viewer-left/right, foreground/background, beside/near, behind/in front of, and visible-through-window relationships must remain in the final prompt."
      : "Spatial hints: use simple viewer-left/right, foreground/background, beside/near — not anatomical ruler language.",
    constraints.pose
      ? "ACTION CONSTRAINT: strongly preserve the character pose from the screenshot. Describe limb direction, body lean, hand/foot placement, silhouette, and balance as naturally as possible so the generated image recreates the pose."
      : null,
    constraints.visual
      ? "VISUAL CONSTRAINT: strongly preserve the current camera view. Describe the shot angle, perspective, framing, distance, and lens feel in natural image-prompt language so the generated image recreates the screenshot viewpoint."
      : null,
    "Describe pose, expression, and props in natural, artistic language (e.g. leaning on a wall, dynamic stance, one arm raised). Never echo raw coordinates, pixel math, or awkward joint-vs-joint alignment phrases (e.g. do not write \"wrist level with neck\", \"ankle left of other ankle\", \"horizontally aligned with neck\").",
    "Skeleton notes in the summary are hints only; infer a plausible pose from the image, do not transcribe joint tuples.",
    "Merge duplicates; keep token economy; preserve style and subject tags from the preview when they matter.",
    options.civitaiAware
      ? "Use selected Civitai resources as model-specific context; their trigger words are optional tools, not mandatory text."
      : null,
    options.civitaiAware
      ? buildCivitaiAiJsonResponseInstructions()
      : "Return only the final prompt text (no markdown, no labels like \"Prompt:\").",
  ].filter(Boolean);

  return [
    "You are SceneForge's visual prompt assistant. Produce ONE concise image-generation prompt (Stable Diffusion-style: comma-separated tags and short phrases; anime-friendly).",
    "",
    `Prioritize ${priority}.`,
    constraints.layout
      ? "The hard layout constraints are composition requirements, not optional metadata."
      : "Prioritize the canvas screenshot and the user's prompt preview over structured metadata.",
    "",
    "Rules:",
    ...rules.map((rule) => `- ${rule}`),
  ].join("\n");
}

function buildAiUserText({
  constraints,
  layoutConstraints,
  promptForAi,
  project,
  selectedCivitaiResourcesText,
  structuredSummary,
}: {
  constraints: AiGenerationConstraints;
  layoutConstraints: string | null;
  promptForAi: ReturnType<typeof generatePrompt>;
  project: SceneForgeProject;
  selectedCivitaiResourcesText: string | null;
  structuredSummary: string;
}) {
  const civitaiAware = selectedCivitaiResourcesText !== null;

  return [
    "Generate a stronger positive prompt from the preview + screenshot below.",
    constraints.layout || constraints.pose || constraints.visual
      ? `Order of trust: (1) enabled hard constraints and canvas image, (2) prompt preview, (3) character/object descriptions and prompt tags.`
      : "Order of trust: (1) canvas image and prompt preview, (2) character/object descriptions and prompt tags, (3) coarse layout hints in the structured summary.",
    constraints.layout
      ? "Rewrite the layout constraints naturally, but keep every important placement relationship."
      : "Do not paste structured-summary wording verbatim if it reads like geometry homework.",
    constraints.pose
      ? "Action constraint is enabled: the final prompt must strongly emphasize recreating the character's pose from the screenshot. Prefer natural pose words over coordinates."
      : null,
    constraints.visual
      ? "Visual constraint is enabled: the final prompt must strongly emphasize recreating the screenshot's camera angle, framing, and perspective."
      : null,
    constraints.layout
      ? "Do not paste coordinate wording or structured-summary wording verbatim if it reads like geometry homework."
      : null,
    "",
    `Prompt preview: ${promptForAi.prompt || "(empty)"}`,
    `Negative prompt (from scene tags and legacy settings; reference only; your reply must ${
      civitaiAware ? "put the positive prompt in the JSON prompt field" : "be the positive prompt text only"
    }): ${promptForAi.negativePrompt || "(none)"}`,
    selectedCivitaiResourcesText ? "" : null,
    selectedCivitaiResourcesText
      ? "Selected Civitai resources (model-specific context; use trigger words only when useful):"
      : null,
    selectedCivitaiResourcesText,
    selectedCivitaiResourcesText
      ? "Civitai rules: do not invent trigger words, do not force every trigger word, and do not include local paths, hashes, or download links. The JSON overallEffect field must be written in Simplified Chinese and describe only the style/effect expected from the selected checkpoint + LoRA combination, not the image subject, pose, action, composition, or scene contents. The JSON parameterSuggestionReason field must be written in Simplified Chinese as one or two user-facing sentences explaining why the suggested parameters fit this resource combination. The JSON parameterSuggestions.loraWeights field must include one item for every selected LoRA, preserving each LoRA name and giving a suggestedWeight."
      : null,
    constraints.layout ? "" : null,
    constraints.layout ? "Hard layout constraints (must be preserved in the final prompt):" : null,
    constraints.layout ? layoutConstraints || "(none)" : null,
    constraints.visual ? "" : null,
    constraints.visual ? "Current camera / screenshot view (must be preserved in the final prompt):" : null,
    constraints.visual ? summarizeCameraForAi(project) : null,
    "",
    "Structured scene summary (reference only):",
    structuredSummary,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function hasRenderableCivitaiAdvice(advice: CivitaiAiPromptResult | null) {
  return Boolean(
    advice &&
      (advice.parseWarning ||
        advice.parameterSuggestionReason ||
        advice.overallEffect ||
        advice.parameterSuggestions !== null),
  );
}

function formatAdviceLabel(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
}

function isAdviceRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEmptyAdviceValue(value: unknown) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim().length === 0) ||
    (Array.isArray(value) && value.length === 0) ||
    (isAdviceRecord(value) && Object.keys(value).length === 0)
  );
}

function formatAdvicePrimitive(value: unknown) {
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
  }

  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }

  return typeof value === "string" ? value : String(value);
}

function AiAdviceValue({ depth = 0, value }: { depth?: number; value: unknown }) {
  if (isEmptyAdviceValue(value)) {
    return <span className="text-slate-400">未提供</span>;
  }

  if (Array.isArray(value)) {
    return (
      <div className="space-y-1">
        {value.map((item, index) => (
          <div className="rounded-md bg-white/70 px-2 py-1" key={index}>
            <AiAdviceValue depth={depth + 1} value={item} />
          </div>
        ))}
      </div>
    );
  }

  if (isAdviceRecord(value)) {
    const entries = Object.entries(value).filter(([, entryValue]) => !isEmptyAdviceValue(entryValue));

    if (entries.length === 0) {
      return <span className="text-slate-400">未提供</span>;
    }

    return (
      <div className={depth > 0 ? "space-y-1" : "grid gap-2"}>
        {entries.map(([key, entryValue]) => (
          <div className="rounded-md bg-white/70 px-2 py-1" key={key}>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {formatAdviceLabel(key)}
            </p>
            <div className="mt-0.5 text-xs leading-relaxed text-slate-700">
              <AiAdviceValue depth={depth + 1} value={entryValue} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return <span>{formatAdvicePrimitive(value)}</span>;
}

export function PromptPreviewPanel({ onCaptureCanvas }: PromptPreviewPanelProps) {
  const project = useEditorStore((state) => state.project);
  const aiPrompt = useEditorStore((state) => state.aiGeneratedPrompt);
  const setAiGeneratedPrompt = useEditorStore((state) => state.setAiGeneratedPrompt);
  const selectCivitaiCheckpoint = useEditorStore((state) => state.selectCivitaiCheckpoint);
  const toggleCivitaiLora = useEditorStore((state) => state.toggleCivitaiLora);
  const updateProjectSettings = useEditorStore((state) => state.updateProjectSettings);
  const addPromptTag = useEditorStore((state) => state.addPromptTag);
  const removePromptTag = useEditorStore((state) => state.removePromptTag);
  const [aiStatus, setAiStatus] = useState<AiGenerationStatus>("idle");
  const [aiError, setAiError] = useState("");
  const [useLayoutConstraints, setUseLayoutConstraints] = useState(false);
  const [usePoseConstraints, setUsePoseConstraints] = useState(false);
  const [useVisualConstraints, setUseVisualConstraints] = useState(false);
  const [aiCivitaiAdvice, setAiCivitaiAdvice] = useState<CivitaiAiPromptResult | null>(null);
  const [selectedResources, setSelectedResources] = useState<SelectedCivitaiResourcesPreview>(
    EMPTY_SELECTED_CIVITAI_RESOURCES,
  );
  const [selectedResourceStatus, setSelectedResourceStatus] = useState<SelectedResourceStatus>("idle");
  const [selectedResourceError, setSelectedResourceError] = useState("");
  const [selectedResourcesResultQuery, setSelectedResourcesResultQuery] = useState("");
  const [selectedArtistStrings, setSelectedArtistStrings] = useState<ArtistStringItemRecord[]>([]);
  const [selectedArtistStringStatus, setSelectedArtistStringStatus] = useState<SelectedResourceStatus>("idle");
  const [selectedArtistStringError, setSelectedArtistStringError] = useState("");
  const [selectedArtistStringResultKey, setSelectedArtistStringResultKey] = useState("");
  const generatedPrompt = generatePrompt(project);
  const selectedCheckpointId = project.settings.selectedCivitaiCheckpointId;
  const selectedLoraIds = project.settings.selectedCivitaiLoraIds ?? [];
  const selectedArtistStringIds = project.settings.selectedArtistStringIds ?? [];
  const artistStringPromptRenderMode = project.settings.artistStringPromptRenderMode ?? "artist-weight";
  const selectedLoraIdsKey = selectedLoraIds.join(",");
  const selectedArtistStringIdsKey = selectedArtistStringIds.join(",");
  const shouldLoadSelectedArtistStrings =
    project.settings.modelFormat === "stable-diffusion" && selectedArtistStringIds.length > 0;
  const shouldLoadSelectedResources =
    project.settings.modelFormat === "stable-diffusion" && (Boolean(selectedCheckpointId) || selectedLoraIds.length > 0);
  const selectedResourcesQuery = useMemo(
    () =>
      shouldLoadSelectedResources
        ? buildSelectedCivitaiResourcesQuery(
            selectedCheckpointId,
            selectedLoraIdsKey ? selectedLoraIdsKey.split(",") : [],
          )
        : "",
    [selectedCheckpointId, selectedLoraIdsKey, shouldLoadSelectedResources],
  );
  const effectiveSelectedResourceStatus: SelectedResourceStatus = !shouldLoadSelectedResources
    ? "idle"
    : selectedResourcesResultQuery === selectedResourcesQuery
      ? selectedResourceStatus
      : "loading";
  const displayedSelectedResources = shouldLoadSelectedResources && selectedResourcesResultQuery === selectedResourcesQuery
    ? selectedResources
    : EMPTY_SELECTED_CIVITAI_RESOURCES;
  const selectedResourceCards = useMemo(
    () => selectedCivitaiResourceCards(displayedSelectedResources),
    [displayedSelectedResources],
  );
  const effectiveSelectedArtistStringStatus: SelectedResourceStatus = !shouldLoadSelectedArtistStrings
    ? "idle"
    : selectedArtistStringResultKey === selectedArtistStringIdsKey
      ? selectedArtistStringStatus
      : "loading";
  const displayedSelectedArtistStrings =
    shouldLoadSelectedArtistStrings && selectedArtistStringResultKey === selectedArtistStringIdsKey
      ? selectedArtistStrings
      : [];

  useEffect(() => {
    if (!shouldLoadSelectedArtistStrings) {
      return;
    }

    const controller = new AbortController();

    fetchJson<SelectedArtistStringsResponse>(
      `/api/artist-string-library/selected-resources?ids=${encodeURIComponent(selectedArtistStringIdsKey)}`,
      { signal: controller.signal },
    )
      .then((payload) => {
        setSelectedArtistStrings(payload.items);
        setSelectedArtistStringStatus("success");
        setSelectedArtistStringError("");
        setSelectedArtistStringResultKey(selectedArtistStringIdsKey);
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }

        setSelectedArtistStrings([]);
        setSelectedArtistStringStatus("error");
        setSelectedArtistStringError(error instanceof Error ? error.message : "无法读取已选画师串资源。");
        setSelectedArtistStringResultKey(selectedArtistStringIdsKey);
      });

    return () => controller.abort();
  }, [selectedArtistStringIdsKey, shouldLoadSelectedArtistStrings]);

  useEffect(() => {
    if (!shouldLoadSelectedResources) {
      return;
    }

    const controller = new AbortController();

    fetchJson<SelectedCivitaiResourcesPreview>(`/api/civitai-lora-library/selected-resources?${selectedResourcesQuery}`, {
      signal: controller.signal,
    })
      .then((payload) => {
        setSelectedResources(payload);
        setSelectedResourceStatus("success");
        setSelectedResourceError("");
        setSelectedResourcesResultQuery(selectedResourcesQuery);
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }

        setSelectedResources(EMPTY_SELECTED_CIVITAI_RESOURCES);
        setSelectedResourceStatus("error");
        setSelectedResourceError(error instanceof Error ? error.message : "无法读取已选 Civitai 资源。");
        setSelectedResourcesResultQuery(selectedResourcesQuery);
      });

    return () => controller.abort();
  }, [selectedResourcesQuery, shouldLoadSelectedResources]);

  async function loadSelectedResourcesForAi() {
    if (!shouldLoadSelectedResources) {
      return EMPTY_SELECTED_CIVITAI_RESOURCES;
    }

    if (selectedResourcesResultQuery === selectedResourcesQuery && selectedResourceStatus === "success") {
      return selectedResources;
    }

    const payload = await fetchJson<SelectedCivitaiResourcesPreview>(
      `/api/civitai-lora-library/selected-resources?${selectedResourcesQuery}`,
    );
    setSelectedResources(payload);
    setSelectedResourceStatus("success");
    setSelectedResourceError("");
    setSelectedResourcesResultQuery(selectedResourcesQuery);
    return payload;
  }

  function handleRemoveSelectedResource(resource: SelectedCivitaiResourcePreview) {
    if (resource.resourceType === "model") {
      selectCivitaiCheckpoint(resource.id);
      return;
    }

    toggleCivitaiLora(resource.id);
  }

  function removeSceneArtistPrompt(prompt: string | null) {
    if (!prompt) {
      return;
    }

    for (const tagId of findSceneArtistPromptTagIds(project.scene.promptTags, prompt)) {
      removePromptTag({ kind: "scene" }, tagId);
    }
  }

  function handleArtistStringPromptRenderModeChange(nextMode: ArtistStringPromptRenderMode) {
    if (nextMode === artistStringPromptRenderMode) {
      return;
    }

    const selectedIds = project.settings.selectedArtistStringIds ?? [];
    const selectedPrompts = project.settings.selectedArtistStringPrompts ?? [];
    const itemById = new Map(displayedSelectedArtistStrings.map((item) => [item.id, item]));
    const currentPrompts = selectedIds.map((id, index) => {
      const item = itemById.get(id);
      return selectedPrompts[index] ?? (item ? formatSelectedArtistPrompt(item, artistStringPromptRenderMode) : "");
    });
    const nextPrompts = selectedIds.map((id, index) => {
      const item = itemById.get(id);
      return item ? formatSelectedArtistPrompt(item, nextMode) : (selectedPrompts[index] ?? "");
    });

    for (const prompt of new Set(currentPrompts.filter((prompt) => prompt.trim()))) {
      removeSceneArtistPrompt(prompt);
    }

    for (const id of selectedIds) {
      const item = itemById.get(id);
      if (!item) {
        continue;
      }

      const prompt = formatSelectedArtistPrompt(item, nextMode);
      if (prompt.trim()) {
        addPromptTag({ kind: "scene" }, makeSelectedArtistPromptTag(item, prompt));
      }
    }

    updateProjectSettings({
      artistStringPromptRenderMode: nextMode,
      selectedArtistStringPrompts: nextPrompts,
    });
  }

  function handleRemoveSelectedArtistString(item: ArtistStringItemRecord) {
    const selectedIds = project.settings.selectedArtistStringIds ?? [];
    const selectedPrompts = project.settings.selectedArtistStringPrompts ?? [];
    const removedIndex = selectedIds.indexOf(item.id);
    const formattedPrompt = selectedPrompts[removedIndex]
      ?? formatSelectedArtistPrompt(item, artistStringPromptRenderMode);
    const nextIds = selectedIds.filter((id) => id !== item.id);
    const nextPrompts =
      removedIndex >= 0
        ? selectedPrompts.filter((_, index) => index !== removedIndex)
        : selectedPrompts.filter((prompt) => prompt.trim() !== formattedPrompt.trim());

    if (!nextPrompts.some((prompt) => prompt.trim() === formattedPrompt.trim())) {
      removeSceneArtistPrompt(formattedPrompt);
    }

    updateProjectSettings({
      selectedArtistStringIds: nextIds,
      selectedArtistStringPrompts: nextPrompts,
    });
    setSelectedArtistStrings((current) => current.filter((entry) => entry.id !== item.id));
    setSelectedArtistStringResultKey(nextIds.join(","));
  }

  function handleClearSelectedArtistStrings() {
    const prompts = project.settings.selectedArtistStringPrompts ?? [];
    const fallbackPrompts = selectedArtistStrings.map((item) =>
      formatSelectedArtistPrompt(item, artistStringPromptRenderMode),
    );

    for (const prompt of [...new Set(prompts.length > 0 ? prompts : fallbackPrompts)]) {
      removeSceneArtistPrompt(prompt);
    }

    updateProjectSettings({ selectedArtistStringIds: [], selectedArtistStringPrompts: [] });
    setSelectedArtistStrings([]);
    setSelectedArtistStringStatus("idle");
    setSelectedArtistStringError("");
    setSelectedArtistStringResultKey("");
  }

  function handleOpenSelectedResourceDetail(resource: SelectedCivitaiResourcePreview) {
    dispatchOpenCivitaiLibraryResourceDetail({
      id: resource.id,
      resourceType: resource.resourceType,
    });
  }

  async function handleGenerateAiPrompt() {
    const canvasImage = onCaptureCanvas?.();

    if (!canvasImage) {
      setAiStatus("error");
      setAiError("当前画布还没有准备好，请稍后再试。");
      return;
    }

    setAiStatus("loading");
    setAiError("");
    setAiCivitaiAdvice(null);

    try {
      const selectedResourcesForAi = shouldLoadSelectedResources
        ? await loadSelectedResourcesForAi()
        : EMPTY_SELECTED_CIVITAI_RESOURCES;
      const selectedCivitaiResourcesText =
        project.settings.modelFormat === "stable-diffusion" && hasSelectedCivitaiResources(selectedResourcesForAi)
          ? formatSelectedCivitaiResourcesForAi(selectedResourcesForAi)
          : null;
      const civitaiAware = selectedCivitaiResourcesText !== null;
      const promptForAi = generatePrompt(project, {
        includeLayoutConstraints: useLayoutConstraints,
      });
      const constraints: AiGenerationConstraints = {
        layout: useLayoutConstraints,
        pose: usePoseConstraints,
        visual: useVisualConstraints,
      };
      const structuredSummary = summarizeSceneForAi(project, useLayoutConstraints);
      const layoutConstraints = useLayoutConstraints && project.settings.includeSpatialHints
        ? inferSceneLayoutConstraints(project.scene)
        : null;
      const systemPrompt = buildAiSystemPrompt(constraints, { civitaiAware });
      const userText = buildAiUserText({
        constraints,
        layoutConstraints,
        promptForAi,
        project,
        selectedCivitaiResourcesText,
        structuredSummary,
      });
      const requestBody = {
        purpose: civitaiAware ? ("stable-diffusion-prompt-generation" as const) : undefined,
        messages: [
          {
            role: "system" as const,
            content: systemPrompt,
          },
          {
            role: "user" as const,
            content: [
              {
                type: "text" as const,
                text: userText,
              },
              {
                type: "image_url" as const,
                image_url: {
                  url: canvasImage,
                  detail: "auto" as const,
                },
              },
            ],
          },
        ],
        temperature: 0.4,
        maxTokens: civitaiAware ? 900 : 600,
      };

      console.info("[SceneForge] [llm] client outbound /api/llm/chat", {
        temperature: requestBody.temperature,
        maxTokens: requestBody.maxTokens,
        messageCount: requestBody.messages.length,
        layoutConstraintsEnabled: useLayoutConstraints,
        poseConstraintsEnabled: usePoseConstraints,
        visualConstraintsEnabled: useVisualConstraints,
        civitaiAware,
        selectedCivitaiResourceCount: selectedCivitaiResourceCards(selectedResourcesForAi).length,
        selectedCivitaiContextChars: selectedCivitaiResourcesText?.length ?? 0,
        promptPreviewChars: (promptForAi.prompt ?? "").length,
        structuredSummaryChars: structuredSummary.length,
        canvasImageDataUrlChars: canvasImage.length,
      });

      const response = await fetch("/api/llm/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      const payload: unknown = await response.json();

      if (!response.ok) {
        console.info("[SceneForge] [llm] client inbound /api/llm/chat error", {
          httpStatus: response.status,
        });
        throw new Error(getLlmProxyErrorMessage(payload));
      }

      if (!isLlmChatResponse(payload)) {
        console.info("[SceneForge] [llm] client inbound /api/llm/chat invalid response shape", {
          httpStatus: response.status,
        });
        throw new Error("AI 返回格式不正确。");
      }

      console.info("[SceneForge] [llm] client inbound /api/llm/chat", {
        httpStatus: response.status,
        contentChars: payload.content.length,
        model: payload.model,
        usage: payload.usage,
      });

      if (civitaiAware) {
        const parsed = parseCivitaiAiPromptResponse(payload.content);
        setAiGeneratedPrompt(parsed.prompt.trim());
        setAiCivitaiAdvice(parsed);
      } else {
        setAiGeneratedPrompt(payload.content.trim());
        setAiCivitaiAdvice(null);
      }
      setAiStatus("success");
    } catch (error) {
      console.error("[SceneForge] [llm] failed to generate AI prompt", { error });
      setAiStatus("error");
      setAiCivitaiAdvice(null);
      setAiError(error instanceof Error ? error.message : "AI 生成失败，请稍后重试。");
    }
  }

  return (
    <section className="flex flex-col">
      <div className="mb-4 flex flex-col gap-3 border-b border-slate-100 pb-3 shrink-0">
        <div className="flex shrink-0 items-center gap-2.5">
          <div className="rounded-md bg-purple-50 p-1.5 text-purple-600">
            <Palette className="size-4" />
          </div>
          <h2 className="text-[15px] font-semibold text-slate-800">提示词预览</h2>
        </div>
        <div className="grid w-full grid-cols-[repeat(3,minmax(0,1fr))_auto] items-center gap-2">
          <Button
            aria-pressed={useLayoutConstraints}
            className={getConstraintButtonClass(useLayoutConstraints)}
            disabled={aiStatus === "loading"}
            onClick={() => setUseLayoutConstraints((enabled) => !enabled)}
            size="sm"
            title="开启后，AI 生成会把画布布局作为必须保留的构图约束；关闭时不额外传入全局布局约束。"
            type="button"
            variant="secondary"
          >
            布局约束
          </Button>
          <Button
            aria-pressed={usePoseConstraints}
            className={getConstraintButtonClass(usePoseConstraints)}
            disabled={aiStatus === "loading"}
            onClick={() => setUsePoseConstraints((enabled) => !enabled)}
            size="sm"
            title="开启后，AI 生成会强关注截图中的人物姿势，尽可能还原角色的动作、肢体方向与身体重心。"
            type="button"
            variant="secondary"
          >
            动作约束
          </Button>
          <Button
            aria-pressed={useVisualConstraints}
            className={getConstraintButtonClass(useVisualConstraints)}
            disabled={aiStatus === "loading"}
            onClick={() => setUseVisualConstraints((enabled) => !enabled)}
            size="sm"
            title="开启后，AI 生成会强关注当前相机拍摄角度，尽可能还原截图的视角、构图和透视。"
            type="button"
            variant="secondary"
          >
            视觉约束
          </Button>
          <Button
            className="h-8 shrink-0 whitespace-nowrap rounded-md bg-purple-600 px-3 text-xs text-white transition-all hover:bg-purple-700 disabled:opacity-60"
            disabled={aiStatus === "loading"}
            onClick={handleGenerateAiPrompt}
            size="sm"
            type="button"
          >
            <Sparkles className="size-3.5" />
            {aiStatus === "loading" ? "生成中..." : "AI 生成"}
          </Button>
        </div>
      </div>
      <div className="space-y-4">
        {shouldLoadSelectedArtistStrings ? (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">已选画师串资源</p>
              <div className="flex items-center gap-2">
                {effectiveSelectedArtistStringStatus === "loading" ? (
                  <span className="text-[11px] text-slate-400">读取中...</span>
                ) : null}
                <select
                  aria-label="选择画师串 Prompt 格式"
                  className="h-7 max-w-[170px] rounded-md border border-fuchsia-100 bg-white px-2 text-[11px] font-medium text-slate-700 outline-none transition focus:border-fuchsia-300 focus:ring-2 focus:ring-fuchsia-100"
                  disabled={
                    effectiveSelectedArtistStringStatus !== "success" ||
                    displayedSelectedArtistStrings.length !== selectedArtistStringIds.length
                  }
                  onChange={(event) =>
                    handleArtistStringPromptRenderModeChange(event.target.value as ArtistStringPromptRenderMode)
                  }
                  title="选择添加到 Prompt 的画师串格式"
                  value={artistStringPromptRenderMode}
                >
                  {ARTIST_STRING_PROMPT_RENDER_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  className="text-[11px] font-medium text-fuchsia-600 transition hover:text-fuchsia-700"
                  onClick={handleClearSelectedArtistStrings}
                  type="button"
                >
                  全部去选中
                </button>
              </div>
            </div>
            <div className="space-y-2 rounded-md border border-fuchsia-100 bg-fuchsia-50/50 p-3">
              {effectiveSelectedArtistStringStatus === "error" ? (
                <p className="text-xs leading-relaxed text-rose-600">{selectedArtistStringError}</p>
              ) : null}
              {displayedSelectedArtistStrings.length > 0 ? (
                displayedSelectedArtistStrings.map((item) => (
                  <SelectedArtistStringResourceCard
                    item={item}
                    key={item.id}
                    onRemove={() => handleRemoveSelectedArtistString(item)}
                    renderMode={artistStringPromptRenderMode}
                  />
                ))
              ) : effectiveSelectedArtistStringStatus === "success" ? (
                <p className="text-xs leading-relaxed text-slate-500">
                  已选画师串未在本地画师串库中找到，可以先去选中后重新选择。
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
        {shouldLoadSelectedResources ? (
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">已选 Civitai 资源</p>
              {effectiveSelectedResourceStatus === "loading" ? (
                <span className="text-[11px] text-slate-400">读取中...</span>
              ) : null}
            </div>
            <div className="space-y-2 rounded-md border border-indigo-100 bg-indigo-50/50 p-3">
              {effectiveSelectedResourceStatus === "error" ? (
                <p className="text-xs leading-relaxed text-rose-600">{selectedResourceError}</p>
              ) : null}
              {selectedResourceCards.length > 0 ? (
                selectedResourceCards.map((resource) => (
                  <SelectedCivitaiResourceCard
                    key={resource.id}
                    onOpenDetail={() => handleOpenSelectedResourceDetail(resource)}
                    onRemove={() => handleRemoveSelectedResource(resource)}
                    resource={resource}
                  />
                ))
              ) : effectiveSelectedResourceStatus === "success" ? (
                <p className="text-xs leading-relaxed text-slate-500">
                  已选资源未在本机 Civitai 收藏库中找到。
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Prompt</p>
          <div className="relative rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm leading-relaxed text-slate-700 break-words">
              {generatedPrompt.prompt || <span className="text-slate-400 italic">暂无提示词...</span>}
            </p>
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">AI Prompt</p>
            {aiStatus === "success" ? (
              <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-600">
                已生成
              </span>
            ) : null}
          </div>
          <div className="relative rounded-md border border-purple-200 bg-purple-50 p-4">
            {aiStatus === "error" ? (
              <p className="mb-2 text-sm leading-relaxed text-rose-600">{aiError}</p>
            ) : null}
            <textarea
              className="min-h-[120px] w-full resize-y rounded-md border border-purple-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-700 outline-none transition-all placeholder:text-slate-400 placeholder:italic focus:border-purple-400 focus:ring-1 focus:ring-purple-400 disabled:cursor-not-allowed disabled:opacity-75"
              disabled={aiStatus === "loading"}
              onChange={(event) => setAiGeneratedPrompt(event.target.value)}
              placeholder={
                aiStatus === "loading"
                  ? "正在基于画布和当前 Prompt 生成..."
                  : "点击「AI 生成」或在此直接编辑"
              }
              rows={6}
              spellCheck={false}
              value={aiPrompt}
            />
          </div>
        </div>
        {hasRenderableCivitaiAdvice(aiCivitaiAdvice) ? (
          <div>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              AI 参数建议 / 整体效果
            </p>
            <div className="space-y-3 rounded-md border border-indigo-100 bg-indigo-50/50 p-4">
              {aiCivitaiAdvice?.parseWarning ? (
                <p className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
                  {aiCivitaiAdvice.parseWarning}
                </p>
              ) : null}
              {aiCivitaiAdvice?.parameterSuggestionReason ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500">参数建议理由</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-700">
                    {aiCivitaiAdvice.parameterSuggestionReason}
                  </p>
                </div>
              ) : null}
              {aiCivitaiAdvice?.overallEffect ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500">模型组合效果</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-700">{aiCivitaiAdvice.overallEffect}</p>
                </div>
              ) : null}
              {aiCivitaiAdvice && aiCivitaiAdvice.parameterSuggestions !== null ? (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500">参数建议</p>
                  <div className="mt-1 text-xs leading-relaxed text-slate-700">
                    <AiAdviceValue value={aiCivitaiAdvice.parameterSuggestions} />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">Negative Prompt</p>
          <div className="relative rounded-md border border-rose-200 bg-rose-50 p-4">
            <p className="text-sm leading-relaxed text-slate-700 break-words">
              {generatedPrompt.negativePrompt || <span className="text-slate-400 italic">未设置负面提示词</span>}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
