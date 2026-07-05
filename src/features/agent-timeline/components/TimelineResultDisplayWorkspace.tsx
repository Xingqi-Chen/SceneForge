"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { LoaderCircle, Paintbrush } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ResultDisplayTimelineResult } from "@/features/agent-timeline/types";
import type { SelectedCivitaiResourcesPreview } from "@/features/civitai-lora-library/types";
import type { ComfyUiGeneratedImage, ComfyUiPromptHistoryResponse } from "@/features/comfyui";
import type { ComfyUiGenerationLoraSetting } from "@/features/editor/ai-prompt/comfyui-generation-params";
import {
  InpaintMaskDialog,
  toInpaintRequestPayload,
  type GeneratedImageItem,
  type GenerationDraft,
  type InpaintSubmitInput,
} from "@/features/editor/components/ImageGenerationPanel";
import { cn } from "@/shared/utils/cn";

type GeneratedImageText = (item: GeneratedImageItem, index: number, total: number) => string;

export type TimelineResultDisplayWorkspaceProps = {
  draft: GenerationDraft | null;
  emptyState: string;
  errorMessage?: string;
  generatedImageAlt?: GeneratedImageText;
  generatedImageCaption?: GeneratedImageText;
  inpaintClientIdPrefix?: string;
  itemIdPrefix?: string;
  result: ResultDisplayTimelineResult | null;
  selectedResources: SelectedCivitaiResourcesPreview;
  testId?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getApiErrorMessage(payload: unknown, fallback: string) {
  if (!isRecord(payload)) {
    return fallback;
  }

  if (typeof payload.error === "string") {
    return payload.error;
  }

  if (isRecord(payload.error) && typeof payload.error.message === "string") {
    return payload.error.message;
  }

  if (typeof payload.message === "string") {
    return payload.message;
  }

  return fallback;
}

export function isResultDisplayTimelineResult(value: unknown): value is ResultDisplayTimelineResult {
  return (
    isRecord(value) &&
    isRecord(value.image) &&
    typeof value.image.url === "string" &&
    typeof value.promptId === "string" &&
    isRecord(value.storedImage)
  );
}

function getTimelineResultImages(result: ResultDisplayTimelineResult) {
  return result.images?.length ? result.images : [result.image];
}

function getTimelineResultStoredImages(result: ResultDisplayTimelineResult) {
  return result.storedImages?.length ? result.storedImages : [result.storedImage];
}

function createTimelineResultImageItem({
  idPrefix,
  image,
  index,
  promptId,
  seed,
  storedImage,
}: {
  idPrefix: string;
  image: ResultDisplayTimelineResult["image"];
  index: number;
  promptId: string;
  seed: number;
  storedImage: ResultDisplayTimelineResult["storedImage"];
}): GeneratedImageItem {
  return {
    favorited: false,
    id: `${idPrefix}-${promptId}-${index}-${image.filename}`,
    image,
    localFilename: storedImage.filename,
    persisted: true,
    promptId,
    resultSource: "text-to-image",
    sessionGenerated: true,
    sourceReference: {
      filename: image.filename,
      ...(image.subfolder !== undefined ? { subfolder: image.subfolder } : {}),
      ...(image.type !== undefined ? { type: image.type } : {}),
    },
    storage: "sceneforge",
    seed,
  };
}

function createTimelineInpaintImageItem({
  idPrefix,
  image,
  index,
  parentImageId,
  promptId,
  seed,
  storedImage,
}: {
  idPrefix: string;
  image: ComfyUiGeneratedImage;
  index: number;
  parentImageId: string;
  promptId: string;
  seed: number;
  storedImage: ResultDisplayTimelineResult["storedImage"];
}): GeneratedImageItem {
  return {
    favorited: false,
    id: `${idPrefix}-inpaint-${promptId}-${index}-${image.filename}`,
    localFilename: storedImage.filename,
    persisted: true,
    promptId,
    resultSource: "inpaint",
    sessionGenerated: true,
    sourceReference: {
      filename: image.filename,
      ...(image.subfolder !== undefined ? { subfolder: image.subfolder } : {}),
      ...(image.type !== undefined ? { type: image.type } : {}),
    },
    storage: "sceneforge",
    seed,
    historyId: parentImageId,
    image,
  };
}

async function waitForTimelineInpaintImages(
  promptId: string,
  expectedImageCount = 1,
  onPoll?: (history: ComfyUiPromptHistoryResponse) => void,
) {
  const deadline = Date.now() + 60 * 60 * 1000;

  while (Date.now() < deadline) {
    const response = await fetch(`/api/comfyui/history/${encodeURIComponent(promptId)}`, {
      cache: "no-store",
    });
    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(getApiErrorMessage(payload, "Unable to read ComfyUI inpaint history."));
    }

    const history = payload as ComfyUiPromptHistoryResponse;
    onPoll?.(history);

    if (history.images.length >= expectedImageCount) {
      return history;
    }

    if (history.completed) {
      throw new Error("ComfyUI completed the inpaint job without returning an image.");
    }

    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }

  throw new Error("Timed out waiting for ComfyUI inpaint output.");
}

async function saveTimelineInpaintImage(image: ComfyUiGeneratedImage) {
  const response = await fetch("/api/comfyui/generated-images", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      image: {
        filename: image.filename,
        ...(image.subfolder !== undefined ? { subfolder: image.subfolder } : {}),
        ...(image.type !== undefined ? { type: image.type } : {}),
      },
    }),
  });
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(getApiErrorMessage(payload, "Unable to store timeline inpaint image."));
  }

  return payload as ResultDisplayTimelineResult["storedImage"];
}

export function TimelineResultDisplayWorkspace({
  draft,
  emptyState,
  errorMessage,
  generatedImageAlt,
  generatedImageCaption,
  inpaintClientIdPrefix = "timeline-inpaint",
  itemIdPrefix = "timeline",
  result,
  selectedResources,
  testId = "timeline-result-workspace",
}: TimelineResultDisplayWorkspaceProps) {
  const [inpaintImageItem, setInpaintImageItem] = useState<GeneratedImageItem | null>(null);
  const [inpaintItems, setInpaintItems] = useState<GeneratedImageItem[]>([]);
  const [inpaintStatus, setInpaintStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [inpaintMessage, setInpaintMessage] = useState("");
  const loraSettings: ComfyUiGenerationLoraSetting[] = useMemo(() => selectedResources.loras
    .map((resource, index) => {
      const draftLora = draft?.loras.find((lora) => lora.loraName === resource.modelFileName) ?? draft?.loras[index];

      if (!draftLora) {
        return null;
      }

      return {
        enabled: draftLora.enabled,
        loraName: draftLora.loraName,
        resource,
        source: "ai",
        strengthClip: draftLora.strengthClip,
        strengthModel: draftLora.strengthModel,
      };
    })
    .filter((entry): entry is ComfyUiGenerationLoraSetting => entry !== null), [draft, selectedResources.loras]);

  if (!result) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
        {errorMessage ?? emptyState}
      </div>
    );
  }

  const resultImages = getTimelineResultImages(result);
  const storedImages = getTimelineResultStoredImages(result);
  const totalBytes = storedImages.reduce((total, image) => total + image.byteLength, 0);
  const parentSeed = draft?.seed ?? 0;
  const parentItems = resultImages.map((image, index) => createTimelineResultImageItem({
    idPrefix: itemIdPrefix,
    image,
    index,
    promptId: result.promptId,
    seed: parentSeed,
    storedImage: storedImages[index] ?? result.storedImage,
  }));

  async function submitTimelineInpaint(input: InpaintSubmitInput) {
    if (!draft || !inpaintImageItem) {
      throw new Error("Inpaint settings are not ready.");
    }

    setInpaintStatus("loading");
    setInpaintMessage("Submitting inpaint job to ComfyUI...");

    try {
      const clientId = `${inpaintClientIdPrefix}-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
      const requestPayload = toInpaintRequestPayload(draft, input);
      const response = await fetch("/api/comfyui/inpaint-image", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ ...requestPayload, clientId }),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, "ComfyUI inpaint request failed."));
      }

      if (!isRecord(payload) || typeof payload.promptId !== "string") {
        throw new Error("ComfyUI inpaint response did not include a prompt id.");
      }

      setInpaintMessage(`Inpaint job submitted to ComfyUI, seed ${input.seed}.`);
      const history = await waitForTimelineInpaintImages(payload.promptId, 1, (historyUpdate) => {
        if (historyUpdate.images.length > 0) {
          setInpaintMessage(`Received ${historyUpdate.images.length}/1 inpaint image, seed ${input.seed}.`);
        }
      });
      const image = history.images[0];

      if (!image) {
        throw new Error("ComfyUI inpaint completed without an image.");
      }

      const storedImage = await saveTimelineInpaintImage(image);
      const inpaintItem = createTimelineInpaintImageItem({
        idPrefix: itemIdPrefix,
        image: {
          ...image,
          url: storedImage.url,
        },
        index: inpaintItems.length,
        parentImageId: inpaintImageItem.id,
        promptId: payload.promptId,
        seed: input.seed,
        storedImage,
      });

      setInpaintItems((current) => [...current, inpaintItem]);
      setInpaintStatus("success");
      setInpaintMessage("Inpaint image generated and stored.");
      setInpaintImageItem(null);
    } catch (error) {
      setInpaintStatus("error");
      setInpaintMessage(error instanceof Error ? error.message : "Inpaint failed.");
      throw error;
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <div className={cn(
        "grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3",
        resultImages.length > 1 ? "md:grid-cols-2" : "grid-cols-1",
      )}>
        {parentItems.map((item, index) => (
          <figure className="overflow-hidden rounded-md border border-slate-200 bg-white" key={`${item.image.nodeId}:${item.image.filename}:${index}`}>
            <Image
              alt={generatedImageAlt?.(item, index, parentItems.length) ?? `Timeline generated ComfyUI result ${index + 1}`}
              className="max-h-[42rem] w-full object-contain"
              height={1024}
              src={item.image.url}
              unoptimized
              width={1024}
            />
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
              <figcaption className="text-[11px] font-semibold text-slate-500">
                {generatedImageCaption?.(item, index, parentItems.length) ?? (
                  resultImages.length > 1 ? `Image ${index + 1} of ${resultImages.length}` : "Generated image"
                )}
              </figcaption>
              <Button
                className="h-8 gap-1.5 rounded-md bg-sky-600 px-2.5 text-xs text-white hover:bg-sky-700 disabled:opacity-60"
                disabled={!draft || inpaintStatus === "loading"}
                onClick={() => setInpaintImageItem(item)}
                type="button"
              >
                <Paintbrush className="size-3.5" />
                Inpaint
              </Button>
            </div>
          </figure>
        ))}
      </div>
      {inpaintItems.length > 0 ? (
        <div className={cn(
          "grid gap-3 rounded-md border border-sky-200 bg-sky-50 p-3",
          inpaintItems.length > 1 ? "md:grid-cols-2" : "grid-cols-1",
        )}>
          {inpaintItems.map((item, index) => (
            <figure className="overflow-hidden rounded-md border border-sky-200 bg-white" key={item.id}>
              <Image
                alt={`Timeline inpaint result ${index + 1}`}
                className="max-h-[42rem] w-full object-contain"
                height={1024}
                src={item.image.url}
                unoptimized
                width={1024}
              />
              <figcaption className="border-t border-sky-100 px-3 py-2 text-[11px] font-semibold text-sky-700">
                Inpaint result {index + 1}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : null}
      {inpaintStatus !== "idle" && inpaintMessage ? (
        <div className={cn(
          "rounded-md border p-3 text-xs leading-relaxed",
          inpaintStatus === "error"
            ? "border-rose-200 bg-rose-50 text-rose-700"
            : "border-sky-200 bg-sky-50 text-sky-700",
        )}>
          {inpaintStatus === "loading" ? <LoaderCircle className="mr-1.5 inline size-3.5 animate-spin" /> : null}
          {inpaintMessage}
        </div>
      ) : null}
      {draft && inpaintImageItem ? (
        <InpaintMaskDialog
          busy={inpaintStatus === "loading"}
          draft={draft}
          imageItem={inpaintImageItem}
          loraSettings={loraSettings}
          onClose={() => setInpaintImageItem(null)}
          onSubmit={submitTimelineInpaint}
          open
          selectedResources={selectedResources}
        />
      ) : null}
      <dl className="grid gap-2 rounded-md border border-slate-200 bg-white p-3 text-xs md:grid-cols-2">
        <div>
          <dt className="font-semibold uppercase text-slate-500">Prompt ID</dt>
          <dd className="mt-1 break-all text-slate-800">{result.promptId}</dd>
        </div>
        <div>
          <dt className="font-semibold uppercase text-slate-500">Stored images</dt>
          <dd className="mt-1 break-all text-slate-800">
            {storedImages.length === 1 ? result.storedImage.filename : `${storedImages.length} images`}
          </dd>
        </div>
        <div>
          <dt className="font-semibold uppercase text-slate-500">Content type</dt>
          <dd className="mt-1 text-slate-800">{result.storedImage.contentType}</dd>
        </div>
        <div>
          <dt className="font-semibold uppercase text-slate-500">Total bytes</dt>
          <dd className="mt-1 text-slate-800">{totalBytes.toLocaleString()}</dd>
        </div>
      </dl>
      {result.warnings.length > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
          {result.warnings.join(" ")}
        </div>
      ) : null}
    </div>
  );
}
