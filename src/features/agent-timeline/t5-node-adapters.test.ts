import { beforeEach, describe, expect, it } from "vitest";

import { createDefaultProject } from "@/features/editor/store/defaults";
import { renderKrea2Prompt } from "@/features/editor/ai-prompt/krea2-prompt";
import { useEditorStore } from "@/features/editor/store/editor-store";
import type { LlmChatRequest, LlmChatResponse } from "@/features/llm";

import { bindPrimaryTimelineCharacterToEditorStore } from "./editor-canvas-binding";
import { executeTimelineGraph } from "./graph";
import { completeTimelineNode, createTimelineWorkflowState } from "./state";
import {
  buildRunStyleAdviceLlmRequest,
  isAuthorizedRunPlanningResponsesApiRequest,
  type RunPlanningResponsesNodeId,
} from "./run-planning-responses";
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

const KREA_ONLY_NEGATIVE_SUGGESTION_INSTRUCTION_SNIPPETS = [
  "still return the top-level negativeSuggestions array",
  "one concise English undesirable visual concept",
  "short noun or adjective fragment that is directly comma-ready",
  "never use imperative wording",
  "never express a positive desired outcome",
  "Return [] when no undesirable visual concept is justified",
  "do not invent negative content",
];

function parseRequiredJsonExample(systemText: string) {
  const prefix = "Required JSON example: ";
  const line = systemText.split("\n").find((candidate) => candidate.startsWith(prefix));
  expect(line).toBeDefined();
  const exampleText = String(line).slice(prefix.length);

  expect(exampleText).not.toContain("?");
  expect(exampleText).not.toContain("illustrious|anima|krea2");
  return JSON.parse(exampleText) as Record<string, unknown>;
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

    expect(
      normalizeScenePromptTimelineResult({
        positivePrompt: "legacy prompt",
        negativeSuggestions: [" Do not add crowds ", "Avoid blur", " keep a single subject "],
      }).negativeSuggestions,
    ).toEqual(["Do not add crowds", "Avoid blur", "keep a single subject"]);
  });

  it("preserves opaque quoted text from a T5-shaped Krea response through final rendering", () => {
    const result = normalizeScenePromptTimelineResult(JSON.stringify({
      promptProfile: "krea2",
      positivePrompt: "flat prompt is not authoritative",
      krea2Sections: {
        subjectMood: '  A   sign reads "GO   NOW  . ,"   beneath   the canopy  ',
        environmentAndBackground: "  Rain   crosses   the station platform  ",
        spatialCompositionAndFraming: "  centered   at eye level  ",
      },
    }), "krea2");

    expect(result.krea2Sections).toEqual({
      subjectMood: 'A sign reads "GO   NOW  . ," beneath the canopy',
      environmentAndBackground: "Rain crosses the station platform",
      spatialCompositionAndFraming: "centered at eye level",
    });
    expect(renderKrea2Prompt({
      sections: result.krea2Sections,
      sourcePrompt: result.positivePrompt,
    })).toBe(
      'A sign reads "GO   NOW  . ," beneath the canopy, ' +
      "Rain crosses the station platform, centered at eye level",
    );
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
    expect(requests[0]?.maxTokens).toBe(900);
    const systemText = String(requests[0]?.messages[0]?.content);
    expect(systemText).toContain("Selected prompt profile: Illustrious (illustrious)");
    expect(systemText).toContain("include illustriousSections");
    expect(systemText).not.toContain('"promptProfile":"illustrious|anima|krea2"');
    expect(systemText).not.toContain("generic");
    expect(parseRequiredJsonExample(systemText)).toMatchObject({
      promptProfile: "illustrious",
      negativeSuggestions: [],
      style: [{ label: expect.any(String), prompt: expect.any(String) }],
      camera: [{ label: expect.any(String), prompt: expect.any(String) }],
      lighting: [{ label: expect.any(String), prompt: expect.any(String) }],
      illustriousSections: expect.any(Object),
    });
    expect(parseRequiredJsonExample(systemText)).not.toHaveProperty("animaSections");
    expect(parseRequiredJsonExample(systemText)).not.toHaveProperty("krea2Sections");
    expect(requests[0]?.responseFormat).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "sceneforge_run_scene_prompt_illustrious_v1",
        strict: true,
      },
    });
    for (const snippet of KREA_ONLY_NEGATIVE_SUGGESTION_INSTRUCTION_SNIPPETS) {
      expect(systemText).not.toContain(snippet);
    }
    expect(JSON.parse(String(requests[0]?.messages[1]?.content))).toMatchObject({
      promptProfile: "illustrious",
      sceneRequest: "A pilot in a glass greenhouse",
    });
    expect(result).toMatchObject({
      value: {
        promptProfile: "illustrious",
        visualStyle: "anime",
        illustriousSections: {
          subjectIdentity: ["solo pilot"],
        },
      },
    });
  });

  it("propagates Photoreal into the Scene Prompt request and normalized result", async () => {
    const requests: LlmChatRequest[] = [];
    const workflow = createTimelineWorkflowState({
      sceneRequest: "A pilot in a glass greenhouse",
      settingsSnapshot: { visualStyle: "photoreal" },
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
              visualStyleAndMedium: ["natural light photography"],
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

    const systemText = String(requests[0]?.messages[0]?.content);
    expect(systemText).toContain("Selected visual style: Photoreal (photoreal)");
    expect(systemText).toContain(
      "live-action photography, natural skin texture, realistic material response, physically plausible lighting, photographic camera optics",
    );
    expect(JSON.parse(String(requests[0]?.messages[1]?.content))).toMatchObject({
      promptProfile: "illustrious",
      visualStyle: "photoreal",
    });
    expect(result).toMatchObject({
      value: {
        promptProfile: "illustrious",
        visualStyle: "photoreal",
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

    const systemText = String(requests[0]?.messages[0]?.content);
    expect(requests[0]?.maxTokens).toBe(900);
    expect(systemText).toContain("Selected prompt profile: Anima (anima)");
    expect(systemText).toContain("include animaSections");
    const example = parseRequiredJsonExample(systemText);
    expect(example).toMatchObject({
      promptProfile: "anima",
      negativeSuggestions: [],
      style: [{ label: expect.any(String), prompt: expect.any(String) }],
      camera: [{ label: expect.any(String), prompt: expect.any(String) }],
      lighting: [{ label: expect.any(String), prompt: expect.any(String) }],
      animaSections: expect.any(Object),
    });
    expect(example).not.toHaveProperty("illustriousSections");
    expect(example).not.toHaveProperty("krea2Sections");
    expect(requests[0]?.responseFormat).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "sceneforge_run_scene_prompt_anima_v1",
        strict: true,
      },
    });
    for (const snippet of KREA_ONLY_NEGATIVE_SUGGESTION_INSTRUCTION_SNIPPETS) {
      expect(systemText).not.toContain(snippet);
    }
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

  it("requests concise Krea negative concepts and preserves a compliant response", async () => {
    const requests: LlmChatRequest[] = [];
    const workflow = createTimelineWorkflowState({
      workflowId: "profile-krea-negative-suggestions",
      promptProfile: "krea2",
      sceneRequest: "A courier waits beneath a neon station canopy",
      now: () => "2026-07-26T00:00:00.000Z",
    });
    const adapter = createTimelineT5NodeAdapters({
      completeChat: async (request) => {
        requests.push(request);
        return {
          role: "assistant",
          content: JSON.stringify({
            promptProfile: "krea2",
            positivePrompt:
              "A focused courier waits beneath a neon station canopy in cinematic rain.",
            negativeSuggestions: [" blurry ", "extra fingers", " watermark "],
            krea2Sections: {
              subjectMood: "A focused courier waits beneath a neon station canopy",
              subjectAttributesAndActions: "standing calmly with a messenger bag",
              environmentAndBackground:
                "a rain-dark station platform extends beneath the canopy",
              visualStyleAndMedium: "cinematic digital photography",
              lightingColorAndTexture: "neon reflections across wet surfaces",
              spatialCompositionAndFraming: "a medium-wide eye-level composition",
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
    expect(requests[0]?.maxTokens).toBe(1800);
    const systemText = String(requests[0]?.messages[0]?.content ?? "");
    expect(systemText).toContain("Selected prompt profile: Krea 2 Turbo (krea2)");
    const example = parseRequiredJsonExample(systemText);
    expect(example).toMatchObject({
      promptProfile: "krea2",
      negativeSuggestions: [],
      style: [{ label: expect.any(String), prompt: expect.any(String) }],
      camera: [{ label: expect.any(String), prompt: expect.any(String) }],
      lighting: [{ label: expect.any(String), prompt: expect.any(String) }],
      krea2Sections: {
        subjectMood: expect.any(String),
        subjectAttributesAndActions: expect.any(String),
        environmentAndBackground: expect.any(String),
        visualStyleAndMedium: expect.any(String),
        lightingColorAndTexture: expect.any(String),
        spatialCompositionAndFraming: expect.any(String),
      },
    });
    expect(example).not.toHaveProperty("illustriousSections");
    expect(example).not.toHaveProperty("animaSections");
    expect(JSON.stringify(example)).not.toContain("selectedLoraTriggerWords");
    expect(requests[0]?.responseFormat).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "sceneforge_run_scene_prompt_krea2_v1",
        strict: true,
      },
    });
    expect(systemText).toContain("must include environmentAndBackground");
    expect(systemText).toContain("roughly 160-240 English words");
    expect(systemText).toContain("guidance, not a hard limit");
    expect(systemText).toContain("environmentAndBackground alone owns");
    expect(systemText).toContain("spatialCompositionAndFraming alone owns foreground");
    expect(systemText).toContain("relative scale");
    expect(systemText).toContain("atmospheric depth");
    expect(systemText).toContain("subject-background separation or contrast");
    expect(systemText).toContain("one cohesive paragraph");
    expect(systemText).toContain("Do not invent unsupported characters");
    expect(systemText).toContain("still return the top-level negativeSuggestions array");
    expect(systemText).toContain("one concise English undesirable visual concept");
    expect(systemText).toContain("short noun or adjective fragment that is directly comma-ready");
    expect(systemText).toContain(
      'never use imperative wording such as "Do not", "Don\'t", or "Avoid"',
    );
    expect(systemText).toContain("never express a positive desired outcome");
    expect(systemText).toContain("Return [] when no undesirable visual concept is justified");
    expect(systemText).toContain("do not invent negative content");
    expect(result).toMatchObject({
      value: {
        promptProfile: "krea2",
        positivePrompt:
          "A focused courier waits beneath a neon station canopy in cinematic rain.",
        negativeSuggestions: ["blurry", "extra fingers", "watermark"],
        krea2Sections: {
          subjectMood: "A focused courier waits beneath a neon station canopy",
          subjectAttributesAndActions: "standing calmly with a messenger bag",
          environmentAndBackground:
            "a rain-dark station platform extends beneath the canopy",
          visualStyleAndMedium: "cinematic digital photography",
          lightingColorAndTexture: "neon reflections across wet surfaces",
          spatialCompositionAndFraming: "a medium-wide eye-level composition",
        },
      },
    });
  });

  it("preserves node 2 primary identity when node 3 returns conflicting character identity", async () => {
    const requests: LlmChatRequest[] = [];
    const runPlanningRequests: Array<{
      nodeId: RunPlanningResponsesNodeId;
      request: LlmChatRequest;
    }> = [];
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
          completeRunPlanningResponse: async (nodeId, request) => {
            runPlanningRequests.push({ nodeId, request });
            return completeChat(request);
          },
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
    expect(runPlanningRequests.map(({ nodeId }) => nodeId).sort()).toEqual([
      "character-action",
      "character-tags",
    ]);
    for (const runPlanningRequest of runPlanningRequests) {
      expect(isAuthorizedRunPlanningResponsesApiRequest({
        ...runPlanningRequest,
        request: { ...runPlanningRequest.request, nsfw: false },
      })).toBe(true);
    }
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

  it("authorizes exact Run style advice and rejects transport-spill or prompt mutations", () => {
    const request = buildRunStyleAdviceLlmRequest({
      baseNegativePrompt: "blurry, watermark",
      finalPositivePrompt: "solo courier, neon station, wet pavement",
      referenceResolution: { width: 1216, height: 832 },
      selectedResources: {
        checkpoint: {
          id: "checkpoint-a",
          name: "Cyber Checkpoint",
          modelFileName: "Cyber Checkpoint.safetensors",
          resourceType: "model",
          versionName: "v1",
          baseModel: "Illustrious",
          creator: "tester",
          trainedWords: [],
          tags: ["anime"],
          categories: [],
          usageGuide: null,
          descriptionSnippet: "Local anime checkpoint",
          averageWeight: null,
          minWeight: null,
          maxWeight: null,
          recommendations: [],
          previewImage: null,
        },
        loras: [],
      },
      visualStyle: "anime",
    });
    const exact = { nodeId: "style-advice" as const, request };

    expect(isAuthorizedRunPlanningResponsesApiRequest(exact)).toBe(true);

    const clone = () => JSON.parse(JSON.stringify(exact)) as Record<string, unknown> & {
      request: Record<string, unknown> & { messages: Array<Record<string, unknown>> };
    };
    const mutations: Array<(payload: ReturnType<typeof clone>) => void> = [
      (payload) => { payload.nodeId = "character-tags"; },
      (payload) => { payload.request.purpose = "scene-prompt-reverse"; },
      (payload) => { payload.request.temperature = 0.26; },
      (payload) => { payload.request.maxTokens = 901; },
      (payload) => { payload.request.messages.reverse(); },
      (payload) => { payload.request.messages[0].content += " MUTATED"; },
      (payload) => {
        const user = JSON.parse(String(payload.request.messages[1].content));
        user.extra = "spill";
        payload.request.messages[1].content = JSON.stringify(user);
      },
      (payload) => { payload.request.nsfw = false; },
      (payload) => { payload.request.model = "caller-model"; },
      (payload) => { payload.request.responseFormat = { type: "json_object" }; },
      (payload) => { payload.request.extra = true; },
      (payload) => { payload.extra = true; },
    ];

    for (const mutate of mutations) {
      const payload = clone();
      mutate(payload);
      expect(isAuthorizedRunPlanningResponsesApiRequest(payload)).toBe(false);
    }
  });

  it("keeps standard Style Advice requests unchanged and allowlists only exact Krea request variants", () => {
    const selectedResources = {
      checkpoint: {
        id: "checkpoint-a",
        name: "Cyber Checkpoint",
        modelFileName: "Cyber Checkpoint.safetensors",
        resourceType: "model" as const,
        versionName: "v1",
        baseModel: "Illustrious",
        creator: "tester",
        trainedWords: [],
        tags: ["anime"],
        categories: [],
        usageGuide: null,
        descriptionSnippet: "Local anime checkpoint",
        averageWeight: null,
        minWeight: null,
        maxWeight: null,
        recommendations: [],
        previewImage: null,
      },
      loras: [],
    };
    const buildRequest = (
      promptProfile: "illustrious" | "anima" | "krea2" | undefined,
      visualStyle: "anime" | "photoreal",
      referenceResolution?: { width: number; height: number },
    ) => buildRunStyleAdviceLlmRequest({
      baseNegativePrompt: "blurry, watermark",
      finalPositivePrompt: "solo courier, neon station, wet pavement",
      promptProfile,
      referenceResolution,
      selectedResources,
      visualStyle,
    });

    for (const visualStyle of ["anime", "photoreal"] as const) {
      const legacyStandard = buildRequest(undefined, visualStyle);
      expect(buildRequest("illustrious", visualStyle)).toEqual(legacyStandard);
      expect(buildRequest("anima", visualStyle)).toEqual(legacyStandard);
      expect(String(legacyStandard.messages[0]?.content)).not.toContain("Krea 2 resolution contract");
      expect(isAuthorizedRunPlanningResponsesApiRequest({
        nodeId: "style-advice",
        request: legacyStandard,
      })).toBe(true);

      for (const referenceResolution of [undefined, { width: 1216, height: 832 }]) {
        const request = buildRequest("krea2", visualStyle, referenceResolution);
        const systemPrompt = String(request.messages[0]?.content);
        const userPayload = JSON.parse(String(request.messages[1]?.content)) as {
          preset: { description: string };
        };

        expect(systemPrompt).toContain(
          "WIDTH and HEIGHT must each be exact base-10 integers from 16 through 16384 inclusive and divisible by 16.",
        );
        if (referenceResolution) {
          expect(systemPrompt).toContain(
            "never round, resize, crop, pad, stretch, substitute dimensions, or change its aspect ratio.",
          );
        } else {
          expect(systemPrompt).toContain(
            "SceneForge may deterministically normalize a positive-integer recommendation for exact-aspect Preview compatibility.",
          );
        }
        expect(userPayload.preset.description).toBe(referenceResolution
          ? "Timeline prompt used for Krea 2 img2img model parameter advice. Return exactly the uploaded source image dimensions 1216x832; do not resize, crop, pad, stretch, substitute dimensions, or change its aspect ratio."
          : "Timeline prompt used for Krea 2 txt2img model parameter advice. Return a resolution that satisfies the Krea 2 resolution contract.");
        expect(isAuthorizedRunPlanningResponsesApiRequest({
          nodeId: "style-advice",
          request,
        })).toBe(true);
      }
    }

    const exactKrea = {
      nodeId: "style-advice" as const,
      request: buildRequest("krea2", "anime", { width: 1216, height: 832 }),
    };
    const clone = () => JSON.parse(JSON.stringify(exactKrea)) as Record<string, unknown> & {
      request: Record<string, unknown> & { messages: Array<Record<string, unknown>> };
    };
    const mutations: Array<(payload: ReturnType<typeof clone>) => void> = [
      (payload) => { payload.request.messages[0].content += " Permit rounding."; },
      (payload) => {
        const user = JSON.parse(String(payload.request.messages[1].content));
        user.preset.description = String(user.preset.description).replace("1216x832", "1201x832");
        payload.request.messages[1].content = JSON.stringify(user);
      },
      (payload) => {
        const user = JSON.parse(String(payload.request.messages[1].content));
        user.preset.description = String(user.preset.description).replace("1216x832", "01216x832");
        payload.request.messages[1].content = JSON.stringify(user);
      },
      (payload) => {
        const user = JSON.parse(String(payload.request.messages[1].content));
        user.preset.description += " Extra instruction.";
        payload.request.messages[1].content = JSON.stringify(user);
      },
      (payload) => {
        const user = JSON.parse(String(payload.request.messages[1].content));
        user.preset.extra = "transport spill";
        payload.request.messages[1].content = JSON.stringify(user);
      },
    ];

    for (const mutate of mutations) {
      const payload = clone();
      mutate(payload);
      expect(isAuthorizedRunPlanningResponsesApiRequest(payload)).toBe(false);
    }
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
