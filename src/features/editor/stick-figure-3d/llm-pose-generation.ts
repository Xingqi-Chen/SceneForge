import type { LlmChatMessage } from "@/features/llm";
import type { StickFigurePolesV1, StickFigurePoseV1, StickFigureVec3 } from "@/shared/types/stick-figure-pose";

import {
  mergeTargets,
  solveStickFigurePose,
  stickPoseToTargets,
  type StickFigureSolveTargets,
} from "./solveStickFigurePose";
import { sanitizeStickFigurePoseV1 } from "./stick-figure-pose-io";

const TARGET_IDS = ["pelvis", "chest", "head", "leftHand", "rightHand", "leftFoot", "rightFoot"] as const;
const POLE_IDS = ["leftElbowPole", "rightElbowPole", "leftKneePole", "rightKneePole"] as const;

const CURRENT_POSE_PRECISION = 3;

const STICK_FIGURE_POSE_SYSTEM_PROMPT = [
  "You generate 3D stick-figure pose data for SceneForge.",
  "Return only valid JSON. No markdown, no comments, no prose.",
  "Also rewrite the user's pose/action input into a concise natural character description that can be stored in the character description field.",
  "If an existing character description is provided, preserve identity/style details and update or append only the pose/action part.",
  "Use meters in a character-local Y-up coordinate system: X left/right, Y up, Z depth.",
  "Keep the pose anatomically plausible for a low-poly humanoid. Feet should normally stay near y=0.04 unless the user asks for jumping or lying.",
  "Prefer returning IK targets plus optional pole hints, not all solved joints.",
  'Required JSON shape: {"characterDescription":"short natural-language character pose/action description","targets":{"pelvis":{"x":0,"y":1.05,"z":0},"chest":{},"head":{},"leftHand":{},"rightHand":{},"leftFoot":{},"rightFoot":{}},"poles":{"leftElbowPole":{},"rightElbowPole":{},"leftKneePole":{},"rightKneePole":{}}}',
].join("\n");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function roundVec3(v: StickFigureVec3): StickFigureVec3 {
  return {
    x: Number(v.x.toFixed(CURRENT_POSE_PRECISION)),
    y: Number(v.y.toFixed(CURRENT_POSE_PRECISION)),
    z: Number(v.z.toFixed(CURRENT_POSE_PRECISION)),
  };
}

function compactPoseForPrompt(pose: StickFigurePoseV1) {
  const targets = stickPoseToTargets(pose);
  return {
    targets: Object.fromEntries(TARGET_IDS.map((id) => [id, roundVec3(targets[id])])),
    poles: pose.poles
      ? Object.fromEntries(
          POLE_IDS.flatMap((id) => (pose.poles?.[id] ? [[id, roundVec3(pose.poles[id])]] : [])),
        )
      : {},
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sanitizeGeneratedVec3(value: unknown, fallback: StickFigureVec3): StickFigureVec3 {
  if (
    isRecord(value) &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    typeof value.z === "number" &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.z)
  ) {
    return {
      x: clamp(value.x, -1.4, 1.4),
      y: clamp(value.y, 0.02, 2.2),
      z: clamp(value.z, -1.4, 1.4),
    };
  }

  return { ...fallback };
}

function sanitizeTargets(raw: unknown, fallback: StickFigureSolveTargets): StickFigureSolveTargets {
  if (!isRecord(raw)) {
    return fallback;
  }

  return mergeTargets(
    fallback,
    Object.fromEntries(TARGET_IDS.map((id) => [id, sanitizeGeneratedVec3(raw[id], fallback[id])])) as Partial<
      StickFigureSolveTargets
    >,
  );
}

function sanitizePoles(raw: unknown, fallback?: StickFigurePolesV1): StickFigurePolesV1 | undefined {
  if (!isRecord(raw)) {
    return fallback;
  }

  const poles: StickFigurePolesV1 = {};
  for (const id of POLE_IDS) {
    const base = fallback?.[id] ?? { x: 0, y: 1, z: 0 };
    poles[id] = sanitizeGeneratedVec3(raw[id], base);
  }

  return poles;
}

function extractJsonObject(text: string): unknown | null {
  const trimmed = text.trim();
  const candidates = [
    trimmed,
    ...Array.from(trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi), (match) => match[1]?.trim() ?? ""),
  ];

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next likely JSON span.
    }
  }

  return null;
}

export function buildStickFigurePoseGenerationMessages(
  description: string,
  currentPose: StickFigurePoseV1,
  currentCharacterDescription = "",
): LlmChatMessage[] {
  return [
    {
      role: "system",
      content: STICK_FIGURE_POSE_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          poseDescription: description,
          currentCharacterDescription,
          currentPose: compactPoseForPrompt(currentPose),
        },
        null,
        2,
      ),
    },
  ];
}

export function buildStickFigurePoseImageGenerationMessages(
  imageDataUrl: string,
  currentPose: StickFigurePoseV1,
  currentCharacterDescription = "",
  userNotes = "",
): LlmChatMessage[] {
  return [
    {
      role: "system",
      content: [
        STICK_FIGURE_POSE_SYSTEM_PROMPT,
        "Infer the visible human pose from the uploaded image. Ignore background, clothing details, and camera style unless they clarify limb placement.",
        "If body parts are occluded, infer a plausible low-poly humanoid pose from the silhouette and visible joints.",
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              poseDescription: userNotes.trim() || "Infer the character pose from the uploaded image.",
              currentCharacterDescription,
              currentPose: compactPoseForPrompt(currentPose),
              imageNote: "The image was downscaled by the client before upload to reduce vision token cost.",
            },
            null,
            2,
          ),
        },
        {
          type: "image_url",
          image_url: {
            url: imageDataUrl,
            detail: "low",
          },
        },
      ],
    },
  ];
}

export type StickFigurePoseGenerationResult = {
  pose: StickFigurePoseV1;
  characterDescription?: string;
};

function sanitizeCharacterDescription(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized.slice(0, 500) : undefined;
}

export function parseStickFigurePoseGenerationResponse(
  content: string,
  currentPose: StickFigurePoseV1,
): StickFigurePoseGenerationResult | null {
  const parsed = extractJsonObject(content);
  if (!isRecord(parsed)) {
    return null;
  }

  const directPose = parsed.stickFigurePose3D ?? parsed.stickFigurePose ?? parsed;
  if (isRecord(directPose) && directPose.version === 1 && isRecord(directPose.joints)) {
    return {
      pose: sanitizeStickFigurePoseV1(directPose, currentPose),
      characterDescription: sanitizeCharacterDescription(parsed.characterDescription),
    };
  }

  if (!isRecord(parsed.targets)) {
    return null;
  }

  const fallbackTargets = stickPoseToTargets(currentPose);
  const targets = sanitizeTargets(parsed.targets, fallbackTargets);
  const poles = sanitizePoles(parsed.poles, currentPose.poles);
  const warm = solveStickFigurePose(targets, currentPose, poles);

  return {
    pose: sanitizeStickFigurePoseV1(warm, currentPose),
    characterDescription: sanitizeCharacterDescription(parsed.characterDescription),
  };
}
