import { describe, expect, it } from "vitest";

import type { LlmChatRequest, LlmChatResponse } from "@/features/llm";

import { executeTimelineGraph } from "./graph";
import { createTimelineWorkflowState } from "./state";
import {
  createTimelineT5NodeAdapters,
  normalizeCharacterTagsTimelineResult,
  normalizeScenePromptTimelineResult,
  type TimelineCanvasBindingInput,
} from "./t5-node-adapters";

function createPoseResponse() {
  return JSON.stringify({
    characterDescription: "courier leaping across wet pavement",
    targets: {
      pelvis: { x: 0, y: 1.05, z: 0 },
      chest: { x: 0, y: 1.45, z: 0.08 },
      head: { x: 0, y: 1.72, z: 0.1 },
      leftHand: { x: -0.5, y: 1.25, z: 0.2 },
      rightHand: { x: 0.45, y: 1.36, z: -0.1 },
      leftFoot: { x: -0.2, y: 0.35, z: 0.22 },
      rightFoot: { x: 0.25, y: 0.04, z: -0.08 },
    },
    poles: {
      leftElbowPole: { x: -0.65, y: 1.2, z: 0.25 },
      rightElbowPole: { x: 0.65, y: 1.2, z: 0.15 },
      leftKneePole: { x: -0.28, y: 0.58, z: 0.8 },
      rightKneePole: { x: 0.28, y: 0.52, z: 0.2 },
    },
  });
}

describe("T5 timeline node adapters", () => {
  it("parses and normalizes scene prompt and character tag JSON", () => {
    expect(
      normalizeScenePromptTimelineResult(`\`\`\`json
{"positivePrompt":" neon alley courier ","negativeSuggestions":[" blur "],"style":["cinematic"],"camera":[{"label":"Lens","prompt":"wide lens"}],"lighting":["sunrise rim light"]}
\`\`\``),
    ).toEqual({
      positivePrompt: "neon alley courier",
      negativeSuggestions: ["blur"],
      style: [{ label: "cinematic", prompt: "cinematic" }],
      camera: [{ label: "Lens", prompt: "wide lens" }],
      lighting: [{ label: "sunrise rim light", prompt: "sunrise rim light" }],
    });

    expect(
      normalizeCharacterTagsTimelineResult({
        primaryCharacter: {
          name: "Courier",
          description: "A focused courier in a reflective jacket",
        },
        tags: [
          {
            label: "Reflective jacket",
            prompt: "reflective yellow courier jacket",
            category: "outfit",
            subcategory: "outfit-upper",
            bodyPartId: "torso",
          },
          {
            label: "Determined",
            prompt: "determined expression",
            category: "character",
            subcategory: "character-expression",
          },
        ],
        extraPeopleContext: ["market crowd stays background-only"],
      }),
    ).toMatchObject({
      primaryCharacter: {
        name: "Courier",
        description: "A focused courier in a reflective jacket",
      },
      tags: [
        {
          category: "outfit",
          bodyPartId: "torso",
          subcategory: "outfit-upper",
        },
        {
          category: "character",
          subcategory: "character-expression",
        },
      ],
      extraPeopleContext: ["market crowd stays background-only"],
    });
  });

  it("runs scene prompt, tags, action, and canvas binding through LangGraph adapters only", async () => {
    const requests: LlmChatRequest[] = [];
    const bindings: TimelineCanvasBindingInput[] = [];
    const completeChat = async (request: LlmChatRequest): Promise<LlmChatResponse> => {
      requests.push(request);

      if (request.purpose === "stable-diffusion-prompt-generation") {
        return {
          role: "assistant",
          content: JSON.stringify({
            positivePrompt: "neon market alley, sunrise, courier sprinting",
            negativeSuggestions: ["low detail"],
            style: [{ label: "Cinematic", prompt: "cinematic realism" }],
            camera: [{ label: "Wide", prompt: "wide angle tracking shot" }],
            lighting: [{ label: "Rim", prompt: "warm sunrise rim light" }],
          }),
        };
      }

      if (request.purpose === "prompt-tag-reverse") {
        return {
          role: "assistant",
          content: JSON.stringify({
            primaryCharacter: {
              name: "Courier",
              description: "A focused courier in a reflective jacket",
            },
            tags: [
              {
                label: "Courier",
                prompt: "solo courier protagonist",
                category: "character",
                subcategory: "character-subject",
              },
              {
                label: "Jacket",
                prompt: "reflective yellow jacket",
                category: "outfit",
                subcategory: "outfit-upper",
                bodyPartId: "torso",
              },
            ],
            extraPeopleContext: ["distant shoppers are background context"],
          }),
        };
      }

      return {
        role: "assistant",
        content: createPoseResponse(),
      };
    };
    const workflow = createTimelineWorkflowState({
      workflowId: "t5-workflow",
      sceneRequest: "A courier runs through a neon market alley at sunrise",
      now: () => "2026-05-29T00:00:00.000Z",
    });

    const result = await executeTimelineGraph(
      workflow,
      createTimelineT5NodeAdapters({
        completeChat,
        bindCanvas: (input) => {
          bindings.push(input);
          return {
            primaryCharacter: {
              id: "editor-character-1",
              name: input.primaryCharacter.name,
              description: input.primaryCharacter.description,
            },
            characterTags: input.characterTags,
            action: input.action,
            transform: input.transform,
            pose: input.pose,
            spatialSummary: input.spatialSummary,
          };
        },
      }),
      { now: () => "2026-05-29T00:00:01.000Z" },
    );

    expect(requests.map((request) => request.purpose)).toEqual([
      "stable-diffusion-prompt-generation",
      "prompt-tag-reverse",
      "stick-figure-pose-generation",
    ]);
    expect(bindings).toHaveLength(1);
    expect(result.nodes["scene-prompt"]).toMatchObject({
      status: "done",
      result: {
        positivePrompt: "neon market alley, sunrise, courier sprinting",
      },
    });
    expect(result.nodes["character-tags"]).toMatchObject({
      status: "done",
      result: {
        primaryCharacter: {
          name: "Courier",
        },
      },
    });
    expect(result.nodes["character-action"]).toMatchObject({
      status: "done",
      result: {
        action: "courier leaping across wet pavement",
      },
    });
    expect(result.nodes["canvas-binding"]).toMatchObject({
      status: "done",
      source: "system",
      result: {
        primaryCharacter: {
          id: "editor-character-1",
          name: "Courier",
        },
      },
    });
    expect(result.nodes["resource-recommendation"].status).toBe("blocked");
    expect(result.nodes["parameter-recommendation"].status).toBe("blocked");
    expect(result.nodes["generation-gate"].status).toBe("blocked");
  });

  it("surfaces malformed LLM output as a node error without running downstream nodes", async () => {
    const workflow = createTimelineWorkflowState({
      workflowId: "t5-malformed",
      sceneRequest: "A quiet greenhouse",
      now: () => "2026-05-29T00:00:00.000Z",
    });

    const result = await executeTimelineGraph(
      workflow,
      createTimelineT5NodeAdapters({
        completeChat: async () => ({
          role: "assistant",
          content: "not json",
        }),
      }),
      { now: () => "2026-05-29T00:00:01.000Z" },
    );

    expect(result.nodes["scene-prompt"]).toMatchObject({
      status: "error",
      error: {
        code: "llm_malformed_response",
      },
    });
    expect(result.nodes["character-tags"].status).toBe("blocked");
    expect(result.nodes["canvas-binding"].status).toBe("blocked");
  });
});
