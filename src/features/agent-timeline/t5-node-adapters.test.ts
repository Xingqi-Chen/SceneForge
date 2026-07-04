import { beforeEach, describe, expect, it } from "vitest";

import { createDefaultProject } from "@/features/editor/store/defaults";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { LlmChatRequest, LlmChatResponse } from "@/features/llm";

import { bindPrimaryTimelineCharacterToEditorStore } from "./editor-canvas-binding";
import { executeTimelineGraph } from "./graph";
import { completeTimelineNode, createTimelineWorkflowState } from "./state";
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
  beforeEach(() => {
    useEditorStore.getState().setProject(createDefaultProject());
  });

  it("parses and normalizes scene prompt and character tag JSON", () => {
    expect(
      normalizeScenePromptTimelineResult(`\`\`\`json
{"positivePrompt":" neon alley courier ","negativeSuggestions":[" blur "],"style":["cinematic"],"camera":[{"label":"Lens","prompt":"wide lens"}],"lighting":["sunrise rim light"]}
\`\`\``),
    ).toEqual({
      promptProfile: "illustrious",
      primaryCharacter: {
        name: "Primary character",
        identity: "neon alley courier",
        publicFacts: [],
      },
      sceneIntent: "neon alley courier",
      styleTone: "cinematic",
      setting: "",
      sharedFacts: [],
      positivePrompt: "neon alley courier",
      negativeSuggestions: ["blur"],
      style: [{ label: "cinematic", prompt: "cinematic" }],
      camera: [{ label: "Lens", prompt: "wide lens" }],
      lighting: [{ label: "sunrise rim light", prompt: "sunrise rim light" }],
    });

    expect(
      normalizeCharacterTagsTimelineResult({
        items: [
          {
            targetKind: "bodyPart",
            label: "反光夹克",
            prompt: "reflective yellow courier jacket",
            category: "outfit",
            subcategory: "outfit-upper",
            bodyPartId: "torso",
          },
          {
            targetKind: "character",
            label: "坚定表情",
            prompt: "determined expression",
            category: "character",
            subcategory: "character-expression",
          },
        ],
      }),
    ).toMatchObject({
      items: [
        {
          targetKind: "bodyPart",
          category: "outfit",
          bodyPartId: "torso",
          subcategory: "outfit-upper",
          label: "反光夹克",
          prompt: "reflective yellow courier jacket",
        },
        {
          targetKind: "character",
          category: "character",
          subcategory: "character-expression",
          label: "坚定表情",
          prompt: "determined expression",
        },
      ],
    });

    expect(() =>
      normalizeScenePromptTimelineResult({
        positivePrompt: "legacy prompt",
        promptProfile: "generic" as never,
      }),
    ).toThrow("Invalid promptProfile");
    expect(
      normalizeScenePromptTimelineResult(
        {
          positivePrompt: "legacy prompt",
          promptProfile: "generic" as never,
        },
        "illustrious",
        { strictPromptProfile: false },
      ).promptProfile,
    ).toBe("illustrious");
  });

  it("defaults scene input to Illustrious and builds profile-specific scene prompt instructions", async () => {
    const requests: LlmChatRequest[] = [];
    const workflow = createTimelineWorkflowState({
      workflowId: "profile-default",
      sceneRequest: "A pilot in a glass greenhouse",
      now: () => "2026-05-29T00:00:00.000Z",
    });
    const adapter = createTimelineT5NodeAdapters({
      completeChat: async (request) => {
        requests.push(request);
        return {
          role: "assistant",
          content: JSON.stringify({
            positivePrompt: "solo pilot, glass greenhouse",
            illustriousSections: {
              subjectIdentity: ["solo pilot"],
              backgroundEnvironmentObjects: ["glass greenhouse"],
            },
          }),
        };
      },
    })["scene-prompt"];

    expect(workflow.nodes["scene-input"].result).toMatchObject({
      promptProfile: "illustrious",
      rawIntent: "A pilot in a glass greenhouse",
    });

    const result = await adapter?.({
      dependencies: [workflow.nodes["scene-input"]],
      nodeId: "scene-prompt",
      workflow,
    });

    expect(requests).toHaveLength(1);
    expect(String(requests[0]?.messages[0]?.content)).toContain("Selected prompt profile: Illustrious (illustrious)");
    expect(String(requests[0]?.messages[0]?.content)).toContain("include illustriousSections");
    expect(String(requests[0]?.messages[0]?.content)).toContain('"promptProfile":"illustrious|anima"');
    expect(String(requests[0]?.messages[0]?.content)).not.toContain("generic");
    expect(JSON.parse(String(requests[0]?.messages[1]?.content))).toMatchObject({
      promptProfile: "illustrious",
      sceneRequest: "A pilot in a glass greenhouse",
    });
    expect(result).toMatchObject({
      value: {
        promptProfile: "illustrious",
        illustriousSections: {
          subjectIdentity: ["solo pilot"],
        },
      },
    });
  });

  it("coerces old generic scene input when building T5 scene prompt instructions", async () => {
    const requests: LlmChatRequest[] = [];
    const workflow = createTimelineWorkflowState({
      workflowId: "legacy-generic-scene-input",
      sceneRequest: "A pilot in a glass greenhouse",
      now: () => "2026-05-29T00:00:00.000Z",
    });
    workflow.nodes["scene-input"] = {
      ...workflow.nodes["scene-input"],
      result: {
        ...(workflow.nodes["scene-input"].result as Record<string, unknown>),
        promptProfile: "generic" as never,
      },
    };
    const adapter = createTimelineT5NodeAdapters({
      completeChat: async (request) => {
        requests.push(request);
        return {
          role: "assistant",
          content: JSON.stringify({
            positivePrompt: "solo pilot, glass greenhouse",
            illustriousSections: {
              subjectIdentity: ["solo pilot"],
            },
          }),
        };
      },
    })["scene-prompt"];

    const result = await adapter?.({
      dependencies: [workflow.nodes["scene-input"]],
      nodeId: "scene-prompt",
      workflow,
    });

    expect(requests).toHaveLength(1);
    expect(String(requests[0]?.messages[0]?.content)).toContain("Selected prompt profile: Illustrious (illustrious)");
    expect(String(requests[0]?.messages[0]?.content)).not.toContain("generic");
    expect(JSON.parse(String(requests[0]?.messages[1]?.content))).toMatchObject({
      promptProfile: "illustrious",
    });
    expect(result).toMatchObject({
      value: {
        promptProfile: "illustrious",
      },
    });
  });

  it("coerces old generic scene prompt dependencies for downstream T5 nodes", async () => {
    const requests: LlmChatRequest[] = [];
    let workflow = createTimelineWorkflowState({
      workflowId: "legacy-generic-scene-prompt",
      sceneRequest: "A pilot in a glass greenhouse",
      now: () => "2026-05-29T00:00:00.000Z",
    });
    workflow = completeTimelineNode(
      workflow,
      "scene-prompt",
      {
        promptProfile: "generic" as never,
        primaryCharacter: {
          name: "Pilot",
          identity: "solo pilot in a glass greenhouse",
          publicFacts: ["solo pilot"],
        },
        sceneIntent: "Pilot studies seedlings in a glass greenhouse",
        styleTone: "cinematic anime",
        setting: "glass greenhouse",
        sharedFacts: ["seedlings"],
        positivePrompt: "solo pilot, glass greenhouse, seedlings",
        negativeSuggestions: [],
        style: [],
        camera: [],
        lighting: [],
      },
      "ai",
      { now: () => "2026-05-29T00:00:01.000Z" },
    );
    const adapter = createTimelineT5NodeAdapters({
      completeChat: async (request) => {
        requests.push(request);
        return {
          role: "assistant",
          content: JSON.stringify({
            items: [
              {
                targetKind: "character",
                label: "Pilot",
                prompt: "solo pilot protagonist",
                category: "character",
                subcategory: "character-subject",
              },
            ],
          }),
        };
      },
    })["character-tags"];

    const result = await adapter?.({
      dependencies: [workflow.nodes["scene-prompt"]],
      nodeId: "character-tags",
      workflow,
    });

    expect(requests).toHaveLength(1);
    expect(String(requests[0]?.messages[1]?.content)).toContain("Primary character identity: solo pilot in a glass greenhouse");
    expect(result).toMatchObject({
      value: {
        items: [
          {
            targetKind: "character",
            label: "Pilot",
            prompt: "solo pilot protagonist",
          },
        ],
      },
    });
  });

  it("builds Anima scene prompt instructions when the selected profile is Anima", async () => {
    const requests: LlmChatRequest[] = [];
    const workflow = createTimelineWorkflowState({
      workflowId: "profile-anima",
      promptProfile: "anima",
      sceneRequest: "A courier waits beside a rainy window",
      now: () => "2026-05-29T00:00:00.000Z",
    });
    const adapter = createTimelineT5NodeAdapters({
      completeChat: async (request) => {
        requests.push(request);
        return {
          role: "assistant",
          content: JSON.stringify({
            positivePrompt: "1girl, courier beside a rainy window",
            animaSections: {
              character: ["1girl courier"],
              general: ["rainy window"],
            },
          }),
        };
      },
    })["scene-prompt"];

    const result = await adapter?.({
      dependencies: [workflow.nodes["scene-input"]],
      nodeId: "scene-prompt",
      workflow,
    });

    expect(String(requests[0]?.messages[0]?.content)).toContain("Selected prompt profile: Anima (anima)");
    expect(String(requests[0]?.messages[0]?.content)).toContain("include animaSections");
    expect(JSON.parse(String(requests[0]?.messages[1]?.content))).toMatchObject({
      promptProfile: "anima",
    });
    expect(result).toMatchObject({
      value: {
        promptProfile: "anima",
        animaSections: {
          character: ["1girl courier"],
        },
      },
    });
  });

  it("preserves node 2 primary identity when node 3 returns conflicting character identity", async () => {
    const requests: LlmChatRequest[] = [];
    const bindings: TimelineCanvasBindingInput[] = [];
    const completeChat = async (request: LlmChatRequest): Promise<LlmChatResponse> => {
      requests.push(request);

      if (request.purpose === "stable-diffusion-prompt-generation") {
        return {
          role: "assistant",
          content: JSON.stringify({
            positivePrompt: "neon market alley, sunrise, courier sprinting",
            primaryCharacter: {
              name: "Courier",
              identity: "A focused courier in a reflective jacket",
              publicFacts: ["reflective jacket", "solo protagonist"],
            },
            sceneIntent: "Courier sprints through a market alley at sunrise",
            styleTone: "cinematic realism",
            setting: "neon market alley",
            sharedFacts: ["sunrise", "wet pavement"],
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
              name: "Conflicting scout",
              description: "A conflicting identity that must not drive layout binding",
            },
            items: [
              {
                targetKind: "character",
                label: "快递员",
                prompt: "solo courier protagonist",
                category: "character",
                subcategory: "character-subject",
              },
              {
                targetKind: "bodyPart",
                label: "反光夹克",
                prompt: "reflective yellow jacket",
                category: "outfit",
                subcategory: "outfit-upper",
                bodyPartId: "torso",
              },
            ],
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
      {
        ...createTimelineT5NodeAdapters({
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
        "resource-recommendation": () => ({
          source: "ai",
          value: {
            checkpoint: "local-checkpoint.safetensors",
            loras: [],
            candidates: {
              checkpoints: [],
              loras: [],
            },
          },
        }),
        "parameter-recommendation": () => ({
          source: "system",
          value: {
            availableSamplers: ["euler"],
            availableSchedulers: ["normal"],
            width: 1024,
            height: 768,
            steps: 28,
            cfgScale: 7,
            sampler: "euler",
            scheduler: "normal",
            denoise: 1,
            seedPolicy: "random",
            negativePromptAdditions: [],
            requestPreview: null,
          },
        }),
      },
      { now: () => "2026-05-29T00:00:01.000Z" },
    );

    expect(requests[0]?.purpose).toBe("stable-diffusion-prompt-generation");
    const scenePromptSystemText = String(requests[0]?.messages[0]?.content ?? "");
    expect(scenePromptSystemText).toContain("All generated natural-language fields must be English");
    expect(scenePromptSystemText).toContain("negativeSuggestions");
    expect(new Set(requests.slice(1).map((request) => request.purpose))).toEqual(
      new Set(["prompt-tag-reverse", "stick-figure-pose-generation"]),
    );
    expect(requests).toHaveLength(3);
    const characterTagRequest = requests.find((request) => request.purpose === "prompt-tag-reverse");
    const characterTagSystemText = String(characterTagRequest?.messages[0]?.content ?? "");
    const characterTagUserText = String(characterTagRequest?.messages[1]?.content ?? "");
    expect(characterTagSystemText).toContain("label MUST be a short Simplified Chinese");
    expect(characterTagSystemText).toContain("prompt MUST stay in English");
    expect(characterTagSystemText).toContain('Shape: {"items"');
    expect(characterTagUserText).toContain("Already-selected primary character: Courier");
    expect(characterTagUserText).toContain("Do not rename, reselect, or redefine the primary character");
    const actionRequestText =
      JSON.stringify(
        requests.find((request) => request.purpose === "stick-figure-pose-generation")?.messages,
      ) ?? "";
    expect(actionRequestText).toContain("Return the characterDescription/action summary in English.");
    expect(actionRequestText).toContain("A focused courier in a reflective jacket");
    expect(actionRequestText).not.toContain("reflective yellow jacket");
    expect(actionRequestText).not.toContain("反光夹克");
    expect(bindings).toHaveLength(1);
    expect(bindings[0]?.primaryCharacter).toEqual({
      name: "Courier",
      description: "A focused courier in a reflective jacket",
    });
    expect(bindings[0]?.characterTags).toEqual([
      {
        targetKind: "character",
        label: "快递员",
        prompt: "solo courier protagonist",
        category: "character",
        subcategory: "character-subject",
        negative: false,
        weight: { enabled: false, value: 1 },
      },
      {
        targetKind: "bodyPart",
        bodyPartId: "torso",
        label: "反光夹克",
        prompt: "reflective yellow jacket",
        category: "outfit",
        subcategory: "outfit-upper",
        negative: false,
        weight: { enabled: false, value: 1 },
      },
    ]);
    expect(result.nodes["scene-prompt"]).toMatchObject({
      status: "done",
      result: {
        positivePrompt: "neon market alley, sunrise, courier sprinting",
      },
    });
    expect(result.nodes["character-tags"]).toMatchObject({
      status: "done",
      result: {
        items: [
          {
            targetKind: "character",
            label: "快递员",
            prompt: "solo courier protagonist",
          },
          {
            targetKind: "bodyPart",
            bodyPartId: "torso",
            label: "反光夹克",
            prompt: "reflective yellow jacket",
          },
        ],
      },
    });
    expect(result.nodes["character-tags"].result).not.toHaveProperty("primaryCharacter");
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
          description: "A focused courier in a reflective jacket",
        },
      },
    });
    expect(result.nodes["resource-recommendation"].status).toBe("done");
    expect(result.nodes["parameter-recommendation"].status).toBe("done");
    expect(result.nodes["generation-gate"].status).toBe("blocked");
  });

  it("preserves parsed prompt tag metadata through Node 3 and editor binding", async () => {
    const completeChat = async (request: LlmChatRequest): Promise<LlmChatResponse> => {
      if (request.purpose === "stable-diffusion-prompt-generation") {
        return {
          role: "assistant",
          content: JSON.stringify({
            positivePrompt: "courier in a reflective yellow jacket",
            primaryCharacter: {
              name: "Courier",
              identity: "A focused courier in a reflective jacket",
              publicFacts: ["reflective jacket"],
            },
            sceneIntent: "Courier checks a rainy loading dock",
            styleTone: "cinematic realism",
            setting: "rainy loading dock",
            sharedFacts: ["rain"],
            negativeSuggestions: [],
            style: [],
            camera: [],
            lighting: [],
          }),
        };
      }

      if (request.purpose === "prompt-tag-reverse") {
        return {
          role: "assistant",
          content: JSON.stringify({
            items: [
              {
                targetKind: "bodyPart",
                bodyPartId: "torso",
                label: "Reflective jacket",
                prompt: "reflective yellow jacket:1.25",
                category: "outfit",
                subcategory: "outfit-upper",
              },
              {
                targetKind: "bodyPart",
                bodyPartId: "torso",
                label: "Muddy fabric",
                prompt: "muddy fabric",
                category: "outfit",
                subcategory: "outfit-upper",
                negative: true,
              },
            ],
          }),
        };
      }

      return {
        role: "assistant",
        content: createPoseResponse(),
      };
    };
    let boundTorsoTags: Array<{
      id: string;
      negative?: boolean;
      prompt: string;
      weight: { enabled: boolean; value: number };
    }> = [];
    const workflow = createTimelineWorkflowState({
      workflowId: "t5-weighted-tags",
      sceneRequest: "A courier in a reflective yellow jacket",
      now: () => "2026-05-29T00:00:00.000Z",
    });

    const result = await executeTimelineGraph(
      workflow,
      createTimelineT5NodeAdapters({
        completeChat,
        bindCanvas: (input) => {
          const binding = bindPrimaryTimelineCharacterToEditorStore(input);
          const boundCharacter = useEditorStore
            .getState()
            .project.scene.characters.find((character) => character.id === binding.primaryCharacter.id);
          boundTorsoTags =
            boundCharacter?.bodyParts.find((bodyPart) => bodyPart.id === "torso")?.promptTags ?? [];

          return binding;
        },
      }),
      { now: () => "2026-05-29T00:00:01.000Z" },
    );

    const jacketTag = boundTorsoTags.find((tag) => tag.id.startsWith("timeline-t5-torso-0-"));
    const negativeTag = boundTorsoTags.find((tag) => tag.id.startsWith("timeline-t5-torso-1-"));

    expect(result.nodes["character-tags"].result).toMatchObject({
      items: [
        {
          targetKind: "bodyPart",
          bodyPartId: "torso",
          label: "Reflective jacket",
          prompt: "reflective yellow jacket",
          category: "outfit",
          subcategory: "outfit-upper",
          negative: false,
          weight: { enabled: true, value: 1.25 },
        },
        {
          targetKind: "bodyPart",
          bodyPartId: "torso",
          label: "Muddy fabric",
          prompt: "muddy fabric",
          category: "outfit",
          subcategory: "outfit-upper",
          negative: true,
          weight: { enabled: false, value: 1 },
        },
      ],
    });
    expect(jacketTag?.weight).toEqual({ enabled: true, value: 1.25 });
    expect(jacketTag?.negative).toBe(false);
    expect(negativeTag?.negative).toBe(true);
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
