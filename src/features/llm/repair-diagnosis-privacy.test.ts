// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import { createLiteLlmClient, summarizeLlmChatRequestForLog } from "./litellm-client";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("repair diagnosis logging privacy", () => {
  it("redacts diagnosis request text, image content, and completion content", async () => {
    const request = {
      model: "vision-model",
      purpose: "single-image-repair-diagnosis" as const,
      messages: [{
        role: "user" as const,
        content: [
          { type: "text" as const, text: "PRIVATE_REPAIR_TARGET" },
          { type: "image_url" as const, image_url: { url: "data:image/png;base64,PRIVATE_IMAGE" } },
        ],
      }],
    };
    expect(JSON.stringify(summarizeLlmChatRequestForLog(request))).not.toContain("PRIVATE_REPAIR_TARGET");
    expect(JSON.stringify(summarizeLlmChatRequestForLog(request))).not.toContain("PRIVATE_IMAGE");

    const logs: unknown[][] = [];
    vi.spyOn(console, "info").mockImplementation((...items: unknown[]) => { logs.push(items); });
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      id: "repair-diagnosis-1",
      model: "vision-model",
      choices: [{ message: { role: "assistant", content: "PRIVATE_DIAGNOSIS_COMPLETION" } }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const client = createLiteLlmClient({ baseUrl: "http://litellm.test", defaultModel: "vision-model", fetcher });
    await client.completeChat(request);

    const serializedLogs = JSON.stringify(logs);
    expect(serializedLogs).not.toContain("PRIVATE_REPAIR_TARGET");
    expect(serializedLogs).not.toContain("PRIVATE_IMAGE");
    expect(serializedLogs).not.toContain("PRIVATE_DIAGNOSIS_COMPLETION");
    expect(serializedLogs).toContain("contentRedacted");
  });
});
