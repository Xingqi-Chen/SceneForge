import {
  normalizeCivitaiImageResponse,
  normalizeCivitaiModelVersionResponse,
} from "./normalize";
import type { CivitaiResolvedVersion, NormalizedCivitaiImage } from "./types";

type Fetcher = typeof fetch;

export class CivitaiApiError extends Error {
  readonly statusCode?: number;
  readonly details?: unknown;

  constructor(message: string, options: { statusCode?: number; details?: unknown } = {}) {
    super(message);
    this.name = "CivitaiApiError";
    this.statusCode = options.statusCode;
    this.details = options.details;
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

export function createCivitaiClient(options: {
  baseUrl?: string;
  fetcher?: Fetcher;
  apiKey?: string;
} = {}) {
  const baseUrl = (options.baseUrl ?? "https://civitai.com/api/v1").replace(/\/+$/, "");
  const fetcher = options.fetcher ?? fetch;
  const headers = {
    accept: "application/json",
    ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
  };

  async function getJson(path: string): Promise<unknown> {
    const response = await fetcher(`${baseUrl}${path}`, { headers });
    const payload = await parseResponse(response);

    if (!response.ok) {
      throw new CivitaiApiError("Civitai request failed.", {
        statusCode: response.status,
        details: payload,
      });
    }

    return payload;
  }

  async function hydrateModelVersionCreator(version: CivitaiResolvedVersion): Promise<CivitaiResolvedVersion> {
    if (version.creator || version.civitaiModelId === null || version.civitaiModelVersionId === null) {
      return version;
    }

    try {
      const modelPayload = await getJson(`/models/${encodeURIComponent(String(version.civitaiModelId))}`);
      const hydrated = normalizeCivitaiModelVersionResponse(modelPayload, {
        preferredModelVersionId: version.civitaiModelVersionId,
      });

      return {
        ...version,
        ...hydrated,
      };
    } catch {
      return version;
    }
  }

  return {
    async getImageById(imageId: number): Promise<NormalizedCivitaiImage> {
      const payload = await getJson(`/images?imageId=${encodeURIComponent(String(imageId))}`);
      return normalizeCivitaiImageResponse(payload, imageId);
    },

    async getModelVersionByHash(hash: string): Promise<CivitaiResolvedVersion> {
      const payload = await getJson(`/model-versions/by-hash/${encodeURIComponent(hash)}`);
      return hydrateModelVersionCreator(normalizeCivitaiModelVersionResponse(payload));
    },

    async getModelVersion(modelVersionId: number): Promise<CivitaiResolvedVersion> {
      const payload = await getJson(`/model-versions/${encodeURIComponent(String(modelVersionId))}`);
      return hydrateModelVersionCreator(normalizeCivitaiModelVersionResponse(payload));
    },

    async searchModelVersionByName(name: string): Promise<CivitaiResolvedVersion | null> {
      const payload = await getJson(`/models?query=${encodeURIComponent(name)}&limit=1`);
      if (
        typeof payload !== "object" ||
        payload === null ||
        !("items" in payload) ||
        !Array.isArray((payload as { items?: unknown }).items)
      ) {
        return null;
      }

      const [model] = (payload as { items: unknown[] }).items;
      if (typeof model !== "object" || model === null || !("modelVersions" in model)) {
        return null;
      }

      const versions = (model as { modelVersions?: unknown }).modelVersions;
      if (!Array.isArray(versions) || versions.length === 0) {
        return null;
      }

      return normalizeCivitaiModelVersionResponse({
        ...(versions[0] as Record<string, unknown>),
        model,
      });
    },
  };
}

export type CivitaiClient = ReturnType<typeof createCivitaiClient>;
