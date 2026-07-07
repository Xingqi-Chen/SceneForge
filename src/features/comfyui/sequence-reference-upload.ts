import type { ComfyUiClient } from "./client";
import type {
  ComfyUiSequenceCharacter,
  ComfyUiSequenceReferenceImage,
} from "./sequence";
import {
  getSequenceReferenceContentType,
  parseSequenceReferenceDataUrl,
  readSequenceReferenceImage,
} from "./sequence-reference-storage";

export type UploadedSequenceReferenceImage = {
  id: string;
  imageName: string;
  weight?: number;
};

export type UploadedSequenceCharacter = Omit<ComfyUiSequenceCharacter, "id" | "references"> & {
  id: string;
  references: UploadedSequenceReferenceImage[];
};

type SequenceReferenceUploadClient = Pick<ComfyUiClient, "uploadImage">;

export function sanitizeSequenceUploadFilenamePart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "image";
}

async function uploadSequenceReferenceImage({
  character,
  client,
  image,
  imageIndex,
  sequenceId,
}: {
  character: ComfyUiSequenceCharacter;
  client: SequenceReferenceUploadClient;
  image: ComfyUiSequenceReferenceImage;
  imageIndex: number;
  sequenceId: string;
}): Promise<UploadedSequenceReferenceImage> {
  const id = image.id ?? `${character.id ?? sanitizeSequenceUploadFilenamePart(character.name)}-reference-${imageIndex + 1}`;

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
      filename: `sceneforge-sequence-${sanitizeSequenceUploadFilenamePart(sequenceId)}-${sanitizeSequenceUploadFilenamePart(character.name)}-${imageIndex + 1}.${extension}`,
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

  const parsed = parseSequenceReferenceDataUrl(dataUrl);
  const uploaded = await client.uploadImage({
    filename: `sceneforge-sequence-${sanitizeSequenceUploadFilenamePart(sequenceId)}-${sanitizeSequenceUploadFilenamePart(character.name)}-${imageIndex + 1}.${parsed.extension}`,
    bytes: parsed.bytes,
    mimeType: parsed.contentType,
    overwrite: true,
    type: "input",
  });

  return {
    id,
    imageName: uploaded.imageName,
    ...(typeof image.weight === "number" ? { weight: image.weight } : {}),
  };
}

export async function uploadSequenceCharacterReferences(
  client: SequenceReferenceUploadClient,
  sequenceId: string,
  characters: ComfyUiSequenceCharacter[],
): Promise<UploadedSequenceCharacter[]> {
  return Promise.all(
    characters.map(async (character, characterIndex) => {
      const id = character.id ?? `character-${characterIndex + 1}`;
      const references = await Promise.all(
        character.references.map((image, imageIndex) =>
          uploadSequenceReferenceImage({
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
