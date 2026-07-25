import { describe, expect, it, vi } from "vitest";

import { CivitaiApiError, createCivitaiClient } from "./client";
import { CIVITAI_IMAGE_UNAVAILABLE_MESSAGE } from "./normalize";

describe("Civitai client", () => {
  it("always looks up an image once with the fixed nsfw=X query", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        items: [{ id: 123, nsfw: true, nsfwLevel: 4 }],
      }),
    );
    const client = createCivitaiClient({
      baseUrl: "https://civitai.test/api/v1",
      fetcher,
    });

    await expect(client.getImageById(123)).resolves.toMatchObject({
      civitaiImageId: 123,
      civitaiImagePageUrl: "https://civitai.com/images/123",
      nsfw: true,
      nsfwLevel: 4,
    });

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://civitai.test/api/v1/images?imageId=123&nsfw=X",
    );
  });

  it("maps an empty image result to a neutral, detail-free 404", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({
        items: [],
        details: {
          secret: "raw-upstream-secret",
        },
      }),
    );
    const client = createCivitaiClient({
      baseUrl: "https://civitai.test/api/v1",
      fetcher,
    });

    let caught: unknown;
    try {
      await client.getImageById(135795968);
    } catch (error) {
      caught = error;
    }

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      "https://civitai.test/api/v1/images?imageId=135795968&nsfw=X",
    );
    expect(caught).toBeInstanceOf(CivitaiApiError);
    expect(caught).toMatchObject({
      message: CIVITAI_IMAGE_UNAVAILABLE_MESSAGE,
      statusCode: 404,
      details: undefined,
    });
    expect(CIVITAI_IMAGE_UNAVAILABLE_MESSAGE).toContain("may not exist");
    expect(CIVITAI_IMAGE_UNAVAILABLE_MESSAGE).toContain("private or deleted");
    expect(CIVITAI_IMAGE_UNAVAILABLE_MESSAGE).toContain("filtered by the current content settings");
    expect(JSON.stringify(caught)).not.toContain("raw-upstream-secret");
  });

  it("hydrates missing creator from the model detail endpoint", async () => {
    const requestedPaths: string[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      requestedPaths.push(url.pathname);

      if (url.pathname === "/api/v1/model-versions/992725") {
        return Response.json({
          id: 992725,
          name: "PONYv4.0",
          baseModel: "Pony",
          modelId: 313098,
          model: {
            id: 313098,
            name: "Red-blue fantasy",
            type: "Checkpoint",
          },
        });
      }

      if (url.pathname === "/api/v1/models/313098") {
        return Response.json({
          id: 313098,
          name: "Red-blue fantasy",
          type: "Checkpoint",
          creator: {
            username: "XUERYCJ",
          },
          modelVersions: [
            {
              id: 992725,
              name: "PONYv4.0",
              baseModel: "Pony",
              files: [
                {
                  hashes: {
                    AutoV2: "32BD8C1961",
                  },
                },
              ],
            },
          ],
        });
      }

      return Response.json({ message: "not found" }, { status: 404 });
    };

    const client = createCivitaiClient({
      baseUrl: "https://civitai.test/api/v1",
      fetcher,
    });

    const version = await client.getModelVersion(992725);

    expect(requestedPaths).toEqual(["/api/v1/model-versions/992725", "/api/v1/models/313098"]);
    expect(version).toMatchObject({
      civitaiModelId: 313098,
      civitaiModelVersionId: 992725,
      creator: "XUERYCJ",
      hash: "32BD8C1961",
    });
  });
});
