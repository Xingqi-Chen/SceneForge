import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import sharp from "sharp";

import {
  buildComfyUiSequenceCharacterReference,
  ComfyUiApiError,
  createComfyUiClient,
  createComfyUiTextToImagePreviewRequest,
  summarizeComfyUiErrorDetails,
  validateComfyUiRequestAgainstObjectInfo,
  validateComfyUiSequenceImageRequest,
  validateComfyUiTextToImageRequest,
} from "@/features/comfyui";
import {
  ComfyUiSequenceReferenceStorageError,
  getSequenceReferenceContentType,
  readSequenceReferenceImage,
} from "@/features/comfyui/sequence-reference-storage";
import type {
  ComfyUiCharacterReferenceConfig,
  ComfyUiClient,
  ComfyUiSequenceCharacter,
  ComfyUiSequenceReferenceImage,
  ComfyUiSequenceShot,
  ComfyUiTextToImageRequest,
} from "@/features/comfyui";

export const runtime = "nodejs";

const DEFAULT_COMFYUI_BASE_URL = "http://127.0.0.1:8188";
const RANDOM_SEED_UPPER_BOUND = 2 ** 50;

type UploadedSequenceReferenceImage = {
  id: string;
  imageName: string;
  weight?: number;
};

type UploadedSequenceCharacter = Omit<ComfyUiSequenceCharacter, "id" | "references"> & {
  id: string;
  references: UploadedSequenceReferenceImage[];
};

function errorResponse(message: string, status: number, details?: unknown) {
  return NextResponse.json(
    {
      error: {
        message,
        details,
      },
    },
    { status },
  );
}

function makeComfyUiErrorMessage(error: ComfyUiApiError) {
  const summaries = summarizeComfyUiErrorDetails(error.details);
  if (summaries.length === 0) {
    return error.message;
  }

  return `ComfyUI prompt validation failed: ${summaries.join(" | ")}`;
}

function createRandomSeed() {
  return Math.floor(Math.random() * (RANDOM_SEED_UPPER_BOUND + 1));
}

function sanitizeFilenamePart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "image";
}

function joinPrompt(parts: Array<string | undefined>) {
  return parts.map((part) => part?.trim()).filter(Boolean).join(", ");
}

function parseImageDataUrl(value: string) {
  const match = /^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value.trim());

  if (!match) {
    throw new Error("Reference images must be PNG, JPEG, or WEBP data URLs.");
  }

  const mimeType = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.replace("image/", "");

  return {
    bytes: Buffer.from(match[2], "base64"),
    extension,
    mimeType,
  };
}

function parsePngDataUrl(value: string) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(value.trim());

  if (!match) {
    throw new Error("ControlNet imageDataUrl must be a PNG data URL.");
  }

  return Buffer.from(match[1], "base64");
}

async function uploadReferenceImage({
  character,
  client,
  image,
  imageIndex,
  sequenceId,
}: {
  character: ComfyUiSequenceCharacter;
  client: ComfyUiClient;
  image: ComfyUiSequenceReferenceImage;
  imageIndex: number;
  sequenceId: string;
}): Promise<UploadedSequenceReferenceImage> {
  const id = image.id ?? `${character.id ?? sanitizeFilenamePart(character.name)}-reference-${imageIndex + 1}`;

  if (image.imageName) {
    return {
      id,
      imageName: image.imageName,
      ...(typeof image.weight === "number" ? { weight: image.weight } : {}),
    };
  }

  if (image.storedFilename) {
    const stored = await readSequenceReferenceImage(image.storedFilename);
    const extension = image.storedFilename.split(".").pop() ?? "png";
    const uploaded = await client.uploadImage({
      filename: `sceneforge-sequence-${sanitizeFilenamePart(sequenceId)}-${sanitizeFilenamePart(character.name)}-${imageIndex + 1}.${extension}`,
      bytes: stored.bytes,
      mimeType: stored.contentType || getSequenceReferenceContentType(image.storedFilename),
      overwrite: true,
      type: "input",
    });

    return {
      id,
      imageName: uploaded.imageName,
      ...(typeof image.weight === "number" ? { weight: image.weight } : {}),
    };
  }

  const dataUrl = image.imageDataUrl;
  if (!dataUrl) {
    throw new Error(`Character "${character.name}" reference ${imageIndex + 1} did not include an image.`);
  }

  const parsed = parseImageDataUrl(dataUrl);
  const uploaded = await client.uploadImage({
    filename: `sceneforge-sequence-${sanitizeFilenamePart(sequenceId)}-${sanitizeFilenamePart(character.name)}-${imageIndex + 1}.${parsed.extension}`,
    bytes: parsed.bytes,
    mimeType: parsed.mimeType,
    overwrite: true,
    type: "input",
  });

  return {
    id,
    imageName: uploaded.imageName,
    ...(typeof image.weight === "number" ? { weight: image.weight } : {}),
  };
}

async function uploadCharacterReferences(
  client: ComfyUiClient,
  sequenceId: string,
  characters: ComfyUiSequenceCharacter[],
): Promise<UploadedSequenceCharacter[]> {
  return Promise.all(
    characters.map(async (character, characterIndex) => {
      const id = character.id ?? `character-${characterIndex + 1}`;
      const references = await Promise.all(
        character.references.map((image, imageIndex) =>
          uploadReferenceImage({
            character: {
              ...character,
              id,
            },
            client,
            image,
            imageIndex,
            sequenceId,
          }),
        ),
      );

      return {
        ...character,
        id,
        references,
      };
    }),
  );
}

async function uploadControlNetImages(
  client: ComfyUiClient,
  request: ComfyUiTextToImageRequest,
  sequenceId: string,
  shotId: string,
) {
  if (!request.controlNets?.some((controlNet) => controlNet.enabled && (controlNet.svg || controlNet.imageDataUrl))) {
    return request;
  }

  const uploadedControlNets = await Promise.all(
    request.controlNets.map(async (controlNet) => {
      if (!controlNet.enabled || (!controlNet.svg && !controlNet.imageDataUrl)) {
        return controlNet;
      }

      const png = controlNet.imageDataUrl
        ? parsePngDataUrl(controlNet.imageDataUrl)
        : await sharp(Buffer.from(controlNet.svg ?? "")).png().toBuffer();
      const uploaded = await client.uploadImage({
        filename: `sceneforge-sequence-${sanitizeFilenamePart(sequenceId)}-${sanitizeFilenamePart(shotId)}-${controlNet.type}.png`,
        bytes: png,
        mimeType: "image/png",
        overwrite: true,
        type: "input",
      });

      return {
        ...controlNet,
        imageName: uploaded.imageName,
      };
    }),
  );

  return {
    ...request,
    controlNets: uploadedControlNets,
  };
}

function getShotCharacters(characters: UploadedSequenceCharacter[], shot: ComfyUiSequenceShot) {
  const enabledCharacters = characters.filter((character) => character.enabled !== false);

  if (!shot.characterIds || shot.characterIds.length === 0) {
    return enabledCharacters;
  }

  const selectedIds = new Set(shot.characterIds);
  return enabledCharacters.filter((character) => selectedIds.has(character.id));
}

function getUnknownShotCharacterIds(characters: UploadedSequenceCharacter[], shot: ComfyUiSequenceShot) {
  if (!shot.characterIds || shot.characterIds.length === 0) {
    return [];
  }

  const characterIds = new Set(characters.map((character) => character.id));
  return shot.characterIds.filter((characterId) => !characterIds.has(characterId));
}

function buildShotRequest({
  baseRequest,
  baseSeed,
  globalPrompt,
  imageCount,
  negativePrompt,
  shot,
  shotIndex,
  characters,
}: {
  baseRequest: ComfyUiTextToImageRequest;
  baseSeed: number;
  globalPrompt: string;
  imageCount: number;
  negativePrompt?: string;
  shot: ComfyUiSequenceShot;
  shotIndex: number;
  characters: UploadedSequenceCharacter[];
}) {
  const selectedCharacters = getShotCharacters(characters, shot);
  const characterPrompts = selectedCharacters.map((character) =>
    character.prompt ? `${character.name}: ${character.prompt}` : character.name,
  );
  const characterReferences: ComfyUiCharacterReferenceConfig[] = selectedCharacters.map((character) =>
    buildComfyUiSequenceCharacterReference(
      character,
      character.references.map((reference) => ({
        id: reference.id,
        imageName: reference.imageName,
        weight: reference.weight,
      })),
    ),
  );
  const positivePrompt = joinPrompt([
    globalPrompt,
    characterPrompts.length > 0 ? characterPrompts.join(", ") : undefined,
    shot.prompt,
    shot.cameraPrompt,
  ]);
  const explicitRequest = shot.request;
  const requestBase = explicitRequest ? { ...baseRequest, ...explicitRequest } : baseRequest;

  return {
    request: {
      ...requestBase,
      positivePrompt: explicitRequest?.positivePrompt?.trim() || positivePrompt,
      negativePrompt: explicitRequest?.negativePrompt ?? negativePrompt ?? baseRequest.negativePrompt,
      seed: explicitRequest?.seed ?? baseSeed + shotIndex,
      batchSize: shot.imageCount ?? explicitRequest?.batchSize ?? imageCount,
      controlNet: shot.controlNet ?? explicitRequest?.controlNet ?? baseRequest.controlNet,
      controlNets: shot.controlNets ?? explicitRequest?.controlNets ?? baseRequest.controlNets,
      characterReferences,
      outputPrefix: explicitRequest?.outputPrefix ?? baseRequest.outputPrefix ?? "SceneForge_sequence",
    },
    characterReferenceIds: selectedCharacters.flatMap((character) => character.references.map((reference) => reference.id)),
  };
}

function sanitizeReturnedRequest(request: ComfyUiTextToImageRequest) {
  return {
    ...request,
    ...(request.controlNet
      ? {
          controlNet: {
            ...request.controlNet,
            openPoseSvg: "",
            svg: "",
            imageDataUrl: "",
          },
        }
      : {}),
    ...(request.controlNets
      ? {
          controlNets: request.controlNets.map((controlNet) => ({
            ...controlNet,
            svg: "",
            imageDataUrl: "",
          })),
        }
      : {}),
  };
}

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return errorResponse("Request body must be valid JSON.", 400);
  }

  const sequenceValidation = validateComfyUiSequenceImageRequest(payload);
  if (!sequenceValidation.ok) {
    return errorResponse(sequenceValidation.message, 400, sequenceValidation.details);
  }

  const sequence = sequenceValidation.request;
  const sequenceId = sequence.sequenceId ?? randomUUID();
  const baseSeed = sequence.baseSeed ?? sequence.baseRequest.seed ?? createRandomSeed();
  const imageCount = sequence.imageCount ?? sequence.baseRequest.batchSize ?? 1;
  const globalPrompt = sequence.globalPrompt ?? sequence.baseRequest.positivePrompt ?? "";
  const negativePrompt = sequence.negativePrompt ?? sequence.baseRequest.negativePrompt;

  try {
    const client = createComfyUiClient({
      baseUrl: process.env.COMFYUI_BASE_URL ?? DEFAULT_COMFYUI_BASE_URL,
      apiKey: process.env.COMFYUI_API_KEY || undefined,
    });
    const objectInfo = await client.getObjectInfo();
    const globalCharacters = await uploadCharacterReferences(client, sequenceId, sequence.characters);
    const preparedShots = [];

    for (const [shotIndex, shot] of sequence.shots.entries()) {
      const shotCharacters = shot.characters
        ? await uploadCharacterReferences(client, sequenceId, shot.characters)
        : globalCharacters;
      const unknownCharacterIds = getUnknownShotCharacterIds(shotCharacters, shot);
      if (unknownCharacterIds.length > 0) {
        return errorResponse(`Shot "${shot.id}" references unknown characters.`, 400, {
          characterIds: unknownCharacterIds,
        });
      }

      const shotRequest = buildShotRequest({
        baseRequest: sequence.baseRequest,
        baseSeed,
        globalPrompt,
        imageCount,
        negativePrompt,
        shot,
        shotIndex,
        characters: shotCharacters,
      });
      const generationRequest = sequence.preview
        ? createComfyUiTextToImagePreviewRequest(shotRequest.request)
        : shotRequest.request;
      const validation = validateComfyUiTextToImageRequest(generationRequest);
      if (!validation.ok) {
        return errorResponse(`Shot "${shot.id}" is invalid: ${validation.message}`, 400, validation.details);
      }

      const objectValidation = validateComfyUiRequestAgainstObjectInfo(validation.request, objectInfo);
      if (objectValidation.errors.length > 0) {
        return errorResponse(`Shot "${shot.id}" does not match the current ComfyUI model/node options.`, 400, {
          errors: objectValidation.errors,
          warnings: objectValidation.warnings,
        });
      }

      preparedShots.push({
        characterReferenceIds: shotRequest.characterReferenceIds,
        request: objectValidation.request,
        shot,
        warnings: objectValidation.warnings,
      });
    }

    const queuedShots = [];
    const allWarnings: string[] = [];

    for (const preparedShot of preparedShots) {
      const requestWithControlImages = await uploadControlNetImages(
        client,
        preparedShot.request,
        sequenceId,
        preparedShot.shot.id ?? "shot",
      );
      const shotClientId = sequence.clientId ? `${sequence.clientId}:${preparedShot.shot.id}` : undefined;
      const result = await client.generateImage(
        requestWithControlImages,
        shotClientId ? { clientId: shotClientId } : undefined,
      );

      allWarnings.push(...preparedShot.warnings);
      queuedShots.push({
        shotId: preparedShot.shot.id,
        title: preparedShot.shot.title,
        promptId: result.promptId,
        number: result.number,
        nodeErrors: result.nodeErrors,
        nodeIds: result.nodeIds,
        outputNodeId: result.outputNodeId,
        clientId: shotClientId,
        seed: result.request.seed,
        imageCount: result.request.batchSize,
        positivePrompt: result.request.positivePrompt,
        negativePrompt: result.request.negativePrompt,
        characterReferenceIds: preparedShot.characterReferenceIds,
        warnings: preparedShot.warnings,
        request: sanitizeReturnedRequest(result.request),
      });
    }

    return NextResponse.json({
      sequenceId,
      warnings: Array.from(new Set(allWarnings)),
      shots: queuedShots,
    });
  } catch (error) {
    if (error instanceof ComfyUiApiError) {
      const message = makeComfyUiErrorMessage(error);
      console.error("[SceneForge] [comfyui] ComfyUI sequence request failed", {
        statusCode: error.statusCode,
        details: JSON.stringify(error.details),
        summary: message,
      });

      return errorResponse(message, error.statusCode ?? 500, error.details);
    }

    if (error instanceof ComfyUiSequenceReferenceStorageError) {
      return errorResponse(error.message, error.statusCode);
    }

    console.error("[SceneForge] [comfyui] unexpected sequence image generation failure", { error });

    return errorResponse(error instanceof Error ? error.message : "Unexpected ComfyUI sequence request failure.", 500);
  }
}
