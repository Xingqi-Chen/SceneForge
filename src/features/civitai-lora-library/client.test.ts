import { describe, expect, it } from "vitest";

import { createCivitaiClient } from "./client";

describe("Civitai client", () => {
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
