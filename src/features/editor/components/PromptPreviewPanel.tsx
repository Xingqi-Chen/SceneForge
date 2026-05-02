"use client";

import { Palette, Sparkles } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/features/editor/store/editor-store";
import { generatePrompt } from "@/features/prompt-engine";
import { inferSceneLayoutConstraints } from "@/features/prompt-engine/spatial-relations";
import { getLlmProxyErrorMessage, isLlmChatResponse } from "@/features/llm";
import type { SceneForgeProject } from "@/shared/types";
import { characterAppearsInThreeViewport } from "@/shared/utils/character-space";

import { getCharacterStickFigurePose } from "@/features/editor/stick-figure-3d/get-character-stick-pose";
import { stickFigurePoseToPromptSnippet } from "@/features/editor/stick-figure-3d/PromptExporter";

type AiGenerationStatus = "idle" | "loading" | "success" | "error";

type PromptPreviewPanelProps = {
  onCaptureCanvas?: () => string | null;
};

type AiGenerationConstraints = {
  layout: boolean;
  pose: boolean;
  visual: boolean;
};

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

function buildAiSystemPrompt(constraints: AiGenerationConstraints) {
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
    "Return only the final prompt text (no markdown, no labels like \"Prompt:\").",
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
  structuredSummary,
}: {
  constraints: AiGenerationConstraints;
  layoutConstraints: string | null;
  promptForAi: ReturnType<typeof generatePrompt>;
  project: SceneForgeProject;
  structuredSummary: string;
}) {
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
    `Negative prompt from project (reference only; your reply must be the positive prompt text only): ${promptForAi.negativePrompt || "(none)"}`,
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

export function PromptPreviewPanel({ onCaptureCanvas }: PromptPreviewPanelProps) {
  const project = useEditorStore((state) => state.project);
  const aiPrompt = useEditorStore((state) => state.aiGeneratedPrompt);
  const setAiGeneratedPrompt = useEditorStore((state) => state.setAiGeneratedPrompt);
  const [aiStatus, setAiStatus] = useState<AiGenerationStatus>("idle");
  const [aiError, setAiError] = useState("");
  const [useLayoutConstraints, setUseLayoutConstraints] = useState(false);
  const [usePoseConstraints, setUsePoseConstraints] = useState(false);
  const [useVisualConstraints, setUseVisualConstraints] = useState(false);
  const generatedPrompt = generatePrompt(project);

  async function handleGenerateAiPrompt() {
    const canvasImage = onCaptureCanvas?.();

    if (!canvasImage) {
      setAiStatus("error");
      setAiError("当前画布还没有准备好，请稍后再试。");
      return;
    }

    setAiStatus("loading");
    setAiError("");

    try {
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
      const systemPrompt = buildAiSystemPrompt(constraints);
      const userText = buildAiUserText({
        constraints,
        layoutConstraints,
        promptForAi,
        project,
        structuredSummary,
      });
      const requestBody = {
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
        maxTokens: 600,
      };

      console.info("[SceneForge] [llm] client outbound /api/llm/chat", {
        temperature: requestBody.temperature,
        maxTokens: requestBody.maxTokens,
        messageCount: requestBody.messages.length,
        layoutConstraintsEnabled: useLayoutConstraints,
        poseConstraintsEnabled: usePoseConstraints,
        visualConstraintsEnabled: useVisualConstraints,
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

      setAiGeneratedPrompt(payload.content.trim());
      setAiStatus("success");
    } catch (error) {
      console.error("[SceneForge] [llm] failed to generate AI prompt", { error });
      setAiStatus("error");
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
