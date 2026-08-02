import { createComfyUiClient } from "./client";
import { validateComfyUiRequestAgainstObjectInfo } from "./object-info";
import { validateComfyUiTextToImageRequest } from "./validation";
import { buildBasicTextToImageWorkflow } from "./workflow";

const DEFAULT_COMFYUI_BASE_URL = "http://127.0.0.1:8188";
const PREFLIGHT_REFERENCE_DIGEST = `sha256:${"0".repeat(64)}`;

export type Krea2ReferenceCapabilityMode = "style" | "reid";

export async function preflightKrea2ReferenceCapability({
  checkpointName,
  mode,
  modelBaseModel,
}: {
  checkpointName: string;
  mode: Krea2ReferenceCapabilityMode;
  modelBaseModel: string;
}) {
  const validation = validateComfyUiTextToImageRequest({
    checkpointName,
    modelBaseModel,
    modelStorageKind: "diffusion",
    workflowProfile: "krea2",
    positivePrompt: mode === "reid" ? "Krea2 ReID preflight" : "Krea style reference preflight",
    width: 1024,
    height: 1024,
    steps: 8,
    cfg: 1,
    samplerName: "euler",
    scheduler: "simple",
    ...(mode === "reid"
      ? {
          krea2ReId: { imageName: "sceneforge-krea-reid-preflight.png" },
          krea2ReIdDescriptor: {
            version: 1 as const,
            referenceDigest: PREFLIGHT_REFERENCE_DIGEST,
            loraName: "krea2_reid_rank32.safetensors" as const,
            strengthModel: 1 as const,
            kvCache: true as const,
            imageCount: 1 as const,
          },
        }
      : {
          krea2StyleReference: {
            styleImageName: "sceneforge-krea-style-reference-preflight.png",
          },
        }),
  });
  if (!validation.ok) return { available: false, reason: validation.message };

  const client = createComfyUiClient({
    baseUrl: process.env.COMFYUI_BASE_URL ?? DEFAULT_COMFYUI_BASE_URL,
    apiKey: process.env.COMFYUI_API_KEY || undefined,
  });
  const objectInfo = await client.getObjectInfo();
  const objectValidation = validateComfyUiRequestAgainstObjectInfo(validation.request, objectInfo);
  if (objectValidation.errors.length > 0) {
    return { available: false, reason: objectValidation.errors.join(" ") };
  }

  // Building is part of preflight: ReID's generated-graph invariant audit runs
  // here and repeats again at queue time through the client workflow builder.
  buildBasicTextToImageWorkflow(objectValidation.request);
  return {
    available: true,
    reason: mode === "reid"
      ? "Krea2 ReID verified against the selected local Krea 2 diffusion model and ComfyUI graph."
      : "Krea style-reference adapter verified for this local Krea 2 diffusion model.",
  };
}
