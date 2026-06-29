import { describe, expect, it } from "vitest";

import { LiteLlmError, type LlmChatResponse } from "@/features/llm";

import {
  createStoryGenerationGateFromWorkflow,
  createStoryRenderPlanFromWorkflow,
  createStoryLlmNodeAdapters,
  normalizeStoryParameterPlan,
  normalizeStoryRenderPromptPlan,
  normalizeStoryEntityCards,
  normalizeShotDependencyGraph,
  normalizeStoryBible,
  normalizeStoryResourcePlan,
  normalizeStoryShots,
  syncStoryShotsWithDependencyGraph,
} from "./story-llm-adapters";
import { createStoryWorkflowState } from "./story-state";
import {
  TimelineNodeExecutionError,
} from "./types";
import {
  createStoryParameterPlan,
  createStoryResourcePlan,
  type StoryParameterPlan,
  type StoryRenderPlan,
} from "./story-planning";
import type {
  CharacterContinuityGraph,
  StoryBible,
  StoryInput,
  StoryShot,
  StoryWorkflowNodeId,
} from "./story-types";

const input = {
  storyId: "story-1",
  rawIntent: "A courier follows a signal through a neon market.",
  targetShotCount: 2,
  audienceRating: "safe",
  nsfwContext: {
    enabled: false,
    audienceRating: "safe",
    contentWarnings: [],
    rationale: "Safe test context.",
  },
  settingsSnapshot: {
    resourceCandidates: {
      checkpoints: [
        {
          id: "checkpoint-local",
          name: "Local Checkpoint",
          baseModel: "Illustrious",
          modelFileName: "local.safetensors",
        },
      ],
      loras: [
        {
          id: "lora-local",
          name: "Local LoRA",
          baseModel: "Illustrious",
          modelFileName: "local-lora.safetensors",
          trainedWords: ["neon market"],
          usageGuide: "Use around 0.65 for neon signage without overpowering characters.",
          averageWeight: 0.65,
          minWeight: 0.45,
          maxWeight: 0.85,
          recommendations: [
            {
              condition: "Neon story continuity",
              baseModel: "Illustrious",
              checkpoint: "Local Checkpoint",
              sampler: null,
              loraWeightMin: 0.45,
              loraWeightMax: 0.85,
              loraWeight: 0.65,
              hdRedrawRate: null,
              notes: "Use lower weights when character identity is more important than signage.",
            },
          ],
        },
      ],
    },
  },
} satisfies StoryInput;

const shots = [
  {
    id: "shot-1",
    storyId: "story-1",
    order: 1,
    title: "Arrival",
    description: "The courier enters the market.",
    characterIds: ["courier"],
    sourceShotIds: [],
    camera: "wide",
    promptIntent: "neon market arrival",
    continuityNotes: [],
  },
  {
    id: "shot-2",
    storyId: "story-1",
    order: 2,
    title: "Signal",
    description: "The courier sees a signal.",
    characterIds: ["courier"],
    sourceShotIds: ["shot-1"],
    camera: "close",
    promptIntent: "signal reflection",
    continuityNotes: [],
  },
] satisfies StoryShot[];

const bible = {
  storyId: "story-1",
  title: "Neon Market Signal",
  logline: "A courier follows a signal through a neon market.",
  genre: ["visual story"],
  themes: ["signal", "rain"],
  worldSummary: "A rain-soaked neon market with a courier tracking a signal.",
  visualStyle: "Cinematic anime storyboard panels with wet neon reflections.",
  characters: [
    {
      id: "courier",
      name: "Courier",
      role: "Lead",
      description: "A courier in a yellow rain jacket.",
      continuityNotes: ["Keep the rain jacket consistent."],
      visualAnchors: ["yellow rain jacket", "messenger bag"],
    },
  ],
  locations: [
    {
      id: "market",
      name: "Neon market",
      description: "A crowded wet market alley under neon signs.",
      visualAnchors: ["wet pavement", "neon signage"],
    },
  ],
  props: [],
  continuityRules: ["Keep the courier identity stable."],
} satisfies StoryBible;

const courierStory = [
  "Characters: teenage courier in a yellow rain jacket, carrying a cake box.",
  "Beat 1: The courier pedals into a wet market alley with the cake box strapped to his backpack.",
  "Beat 2: The backpack strap snaps and he catches the falling bakery box in the wet market alley.",
  "Beat 3: He abandons the bicycle, tucks the box under his rain jacket, runs through a blocked crosswalk, and reaches the apartment stairwell.",
  "Beat 4: He smooths the crushed box corner and knocks at the apartment door with a forced calm expression.",
  "Final image: The courier holds the battered cake box beside a little girl in a party hat and her relieved father.",
].join("\n");

function chatResponse(content: string): LlmChatResponse {
  return {
    role: "assistant",
    content,
  };
}

describe("story LLM adapters", () => {
  it("parses valid StoryBible JSON from LiteLLM content", () => {
    const bible = normalizeStoryBible(
      JSON.stringify({
        title: "Signal Market",
        logline: "A courier follows a signal.",
        genre: ["cyberpunk"],
        themes: ["curiosity"],
        worldSummary: "A neon market at night.",
        visualStyle: "Cinematic neon panels.",
        characters: [
          {
            id: "courier",
            name: "Courier",
            role: "Lead",
            description: "A focused courier.",
            continuityNotes: ["Keep the jacket."],
            visualAnchors: ["blue jacket"],
          },
        ],
        locations: [
          {
            id: "market",
            name: "Market",
            description: "A wet neon market.",
            visualAnchors: ["wet signs"],
          },
        ],
        continuityRules: ["Keep the signal red."],
      }),
      input,
    );

    expect(bible).toMatchObject({
      storyId: "story-1",
      title: "Signal Market",
      characters: [{ id: "courier", name: "Courier" }],
      locations: [{ id: "market", name: "Market" }],
    });
  });

  it("normalizes StoryBible props and records invalid owner references as planning errors", () => {
    const normalized = normalizeStoryBible(
      {
        title: "Signal Market",
        logline: "A courier protects a cake box.",
        characters: [
          {
            id: "courier",
            name: "Courier",
            description: "A rain-jacket courier.",
          },
        ],
        locations: [
          {
            id: "market",
            name: "Market",
            description: "A wet neon market.",
          },
        ],
        props: [
          {
            id: "cake-box",
            name: "Cake box",
            description: "A white bakery box tied with red string.",
            ownerCharacterIds: ["courier", "unknown-character"],
            visualAnchors: ["red string", "creased cardboard corner"],
          },
        ],
      },
      input,
    );

    expect(normalized.props).toEqual([
      expect.objectContaining({
        id: "cake-box",
        name: "Cake box",
        ownerCharacterIds: ["courier"],
        visualAnchors: ["red string", "creased cardboard corner"],
      }),
    ]);
    expect(normalized.planningErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "story_bible_prop_owner_ref",
          message: expect.stringContaining("unknown-character"),
        }),
      ]),
    );
  });

  it("normalizes shot state fields and keeps invalid references as recoverable planning errors", () => {
    const storyBible = normalizeStoryBible(
      {
        title: "Signal Market",
        logline: "A courier protects a cake box.",
        characters: [{ id: "courier", name: "Courier", description: "A rain-jacket courier." }],
        locations: [{ id: "market", name: "Market", description: "A wet neon market." }],
        props: [{ id: "cake-box", name: "Cake box", description: "A white bakery box." }],
      },
      input,
    );
    const outline = {
      storyId: input.storyId,
      beats: [
        {
          id: "beat-1",
          title: "Arrival",
          summary: "The courier enters the market.",
          order: 1,
          characterIds: ["courier"],
        },
      ],
    };
    const normalized = normalizeStoryShots(
      {
        shots: [
          {
            id: "shot-1",
            order: 1,
            title: "Arrival",
            description: "The courier enters the market.",
            beatId: "beat-1",
            locationId: "market",
            characterIds: ["courier"],
            camera: "wide",
            promptIntent: "courier holding the cake box in a wet neon market",
            continuityNotes: [],
            appearanceState: {
              characterStates: [
                {
                  characterId: "courier",
                  outfitId: "courier-raincoat",
                  appearance: "yellow rain jacket",
                  visible: true,
                },
                {
                  characterId: "ghost-character",
                  appearance: "invalid extra subject",
                },
              ],
              propIds: ["cake-box", "unknown-prop"],
            },
            interactionState: {
              characterIds: ["courier", "ghost-character"],
              propIds: ["cake-box", "unknown-prop"],
              description: "Courier grips the cake box.",
              physicalContact: ["hands around box"],
            },
            locationViewState: {
              locationId: "unknown-location",
              viewDescription: "Neon market aisle.",
              visibleAnchors: ["wet pavement"],
              camera: "wide",
            },
          },
        ],
      },
      input,
      storyBible,
      outline,
    );

    expect(normalized[0]).toMatchObject({
      appearanceState: {
        characterStates: [
          expect.objectContaining({
            characterId: "courier",
            outfitId: "courier-raincoat",
          }),
        ],
        propIds: ["cake-box"],
      },
      interactionState: {
        characterIds: ["courier"],
        propIds: ["cake-box"],
      },
      locationViewState: {
        viewDescription: "Neon market aisle.",
        visibleAnchors: ["wet pavement"],
      },
    });
    expect(normalized[0].locationViewState?.locationId).toBeUndefined();
    expect(normalized[0].planningErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "shot_appearance_character_ref" }),
        expect.objectContaining({ code: "shot_appearance_prop_ref" }),
        expect.objectContaining({ code: "shot_interaction_character_ref" }),
        expect.objectContaining({ code: "shot_interaction_prop_ref" }),
        expect.objectContaining({ code: "shot_location_view_ref" }),
      ]),
    );
  });

  it("records missing and malformed shot state fields as recoverable planning errors", () => {
    const storyBible = normalizeStoryBible(
      {
        title: "Signal Market",
        logline: "A courier protects a cake box.",
        characters: [{ id: "courier", name: "Courier", description: "A rain-jacket courier." }],
        locations: [{ id: "market", name: "Market", description: "A wet neon market." }],
      },
      input,
    );
    const outline = {
      storyId: input.storyId,
      beats: [
        {
          id: "beat-1",
          title: "Arrival",
          summary: "The courier enters the market.",
          order: 1,
          characterIds: ["courier"],
        },
      ],
    };
    const normalized = normalizeStoryShots(
      {
        shots: [
          {
            id: "shot-1",
            order: 1,
            title: "Arrival",
            description: "The courier enters the market.",
            beatId: "beat-1",
            locationId: "market",
            characterIds: ["courier"],
            camera: "wide",
            promptIntent: "courier in a wet neon market",
            continuityNotes: ["Keep the rain jacket visible."],
            interactionState: "not an object",
            locationViewState: [],
          },
        ],
      },
      input,
      storyBible,
      outline,
    );

    expect(normalized[0]).toMatchObject({
      appearanceState: {
        characterStates: [
          expect.objectContaining({
            characterId: "courier",
            appearance: "courier in a wet neon market",
            visible: true,
          }),
        ],
        propIds: [],
      },
      interactionState: {
        characterIds: ["courier"],
        description: "The courier enters the market.",
        propIds: [],
      },
      locationViewState: {
        camera: "wide",
        locationId: "market",
        viewDescription: "The courier enters the market.",
      },
    });
    expect(normalized[0].planningErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "shot_appearance_state_missing" }),
        expect.objectContaining({ code: "shot_interaction_state_malformed" }),
        expect.objectContaining({ code: "shot_location_view_state_malformed" }),
      ]),
    );
  });

  it("normalizes entity cards from structured refs and reports invalid ids without throwing", () => {
    const storyBible = {
      ...bible,
      props: [
        {
          id: "cake-box",
          name: "Cake box",
          description: "A white bakery box tied with red string.",
          continuityNotes: ["Keep the red string visible."],
          ownerCharacterIds: ["courier"],
          visualAnchors: ["red string"],
        },
      ],
    } satisfies StoryBible;
    const continuityGraph = {
      storyId: input.storyId,
      characters: [
        {
          characterId: "courier",
          name: "Courier",
          canonicalDescription: "A courier in a yellow rain jacket.",
          visualAnchors: ["yellow rain jacket"],
        },
      ],
      appearances: [
        {
          shotId: "shot-1",
          characterId: "courier",
          wardrobe: ["yellow rain jacket"],
          poseOrAction: "holding cake box",
          expression: "focused",
          continuityNotes: ["Keep the rain jacket."],
        },
      ],
    } satisfies CharacterContinuityGraph;
    const normalized = normalizeStoryEntityCards({
      bible: storyBible,
      continuityGraph,
      input,
      shots: [
        {
          ...shots[0],
          locationId: "market",
          appearanceState: {
            characterStates: [
              {
                characterId: "courier",
                appearance: "yellow rain jacket",
                outfitId: "rain-outfit",
                visible: true,
                continuityNotes: [],
              },
            ],
            notes: [],
            propIds: ["cake-box"],
          },
          interactionState: {
            characterIds: ["courier"],
            continuityNotes: [],
            description: "Courier holds the cake box.",
            physicalContact: ["hands on cake box"],
            propIds: ["cake-box"],
          },
          locationViewState: {
            camera: "wide",
            locationId: "market",
            viewDescription: "Wet neon market aisle.",
            visibleAnchors: ["wet pavement"],
          },
        },
      ],
      raw: {
        characters: [
          {
            id: "courier",
            outfitIds: ["rain-outfit", "ghost-outfit"],
            propIds: ["cake-box", "ghost-prop"],
            shotIds: ["shot-1", "ghost-shot"],
          },
        ],
        outfits: [
          {
            id: "rain-outfit",
            characterId: "courier",
            name: "Yellow rain jacket",
            shotIds: ["shot-1"],
          },
          {
            id: "ghost-outfit",
            characterId: "ghost-character",
            name: "Invalid outfit",
            shotIds: ["shot-1"],
          },
        ],
        props: [
          {
            id: "cake-box",
            ownerCharacterIds: ["courier", "ghost-character"],
            shotIds: ["shot-1", "ghost-shot"],
          },
          {
            id: "ghost-prop",
            shotIds: ["shot-1"],
          },
        ],
        locations: [
          {
            id: "market",
            shotIds: ["shot-1", "ghost-shot"],
            viewStates: [
              {
                shotId: "shot-1",
                viewDescription: "Wet neon market aisle.",
              },
              {
                shotId: "ghost-shot",
                viewDescription: "Invalid view.",
              },
            ],
          },
        ],
      },
    });

    expect(normalized.characters[0]).toMatchObject({
      id: "courier",
      outfitIds: ["rain-outfit"],
      propIds: ["cake-box"],
      shotIds: ["shot-1"],
    });
    expect(normalized.outfits).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "rain-outfit",
        characterId: "courier",
      }),
    ]));
    expect(normalized.props[0]).toMatchObject({
      id: "cake-box",
      ownerCharacterIds: ["courier"],
      shotIds: ["shot-1"],
    });
    expect(normalized.locations[0]).toMatchObject({
      id: "market",
      shotIds: ["shot-1"],
      viewStates: [expect.objectContaining({ shotId: "shot-1" })],
    });
    expect(normalized.planningErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "entity_cards_character_outfit_ref" }),
        expect.objectContaining({ code: "entity_cards_character_prop_ref" }),
        expect.objectContaining({ code: "entity_cards_shot_ref" }),
        expect.objectContaining({ code: "entity_cards_outfit_character_ref" }),
        expect.objectContaining({ code: "entity_cards_prop_owner_ref" }),
        expect.objectContaining({ code: "entity_cards_prop_ref" }),
        expect.objectContaining({ code: "entity_cards_location_view_shot_ref" }),
      ]),
    );
  });

  it("preserves derived entity cards when LLM output only returns partial sections", () => {
    const storyBible = {
      ...bible,
      characters: [
        ...bible.characters,
        {
          id: "villain",
          name: "Villain",
          role: "Rival",
          description: "A rival in a black coat.",
          continuityNotes: ["Keep the black coat."],
          visualAnchors: ["black coat"],
        },
      ],
      locations: [
        ...bible.locations,
        {
          id: "rooftop",
          name: "Rooftop",
          description: "A rain-soaked rooftop.",
          visualAnchors: ["antenna lights"],
        },
      ],
      props: [
        {
          id: "cake-box",
          name: "Cake box",
          description: "A white bakery box tied with red string.",
          continuityNotes: ["Keep the red string visible."],
          ownerCharacterIds: ["courier"],
          visualAnchors: ["red string"],
        },
        {
          id: "signal-charm",
          name: "Signal charm",
          description: "A small glowing charm.",
          continuityNotes: ["Keep the glow blue."],
          ownerCharacterIds: ["villain"],
          visualAnchors: ["blue glow"],
        },
      ],
    } satisfies StoryBible;
    const continuityGraph = {
      storyId: input.storyId,
      characters: storyBible.characters.map((character) => ({
        characterId: character.id,
        name: character.name,
        canonicalDescription: character.description,
        visualAnchors: character.visualAnchors,
      })),
      appearances: [
        {
          shotId: "shot-1",
          characterId: "courier",
          wardrobe: ["yellow rain jacket"],
          poseOrAction: "holding cake box",
          expression: "focused",
          continuityNotes: ["Keep the rain jacket."],
        },
        {
          shotId: "shot-2",
          characterId: "villain",
          wardrobe: ["black coat"],
          poseOrAction: "holding signal charm",
          expression: "calm",
          continuityNotes: ["Keep the black coat."],
        },
      ],
    } satisfies CharacterContinuityGraph;
    const normalized = normalizeStoryEntityCards({
      bible: storyBible,
      continuityGraph,
      input,
      shots: [
        {
          ...shots[0],
          locationId: "market",
          appearanceState: {
            characterStates: [
              {
                characterId: "courier",
                appearance: "yellow rain jacket",
                outfitId: "courier-yellow-rain-jacket",
                visible: true,
                continuityNotes: [],
              },
            ],
            notes: [],
            propIds: ["cake-box"],
          },
          interactionState: {
            characterIds: ["courier"],
            continuityNotes: [],
            description: "Courier holds the cake box.",
            physicalContact: ["hands on cake box"],
            propIds: ["cake-box"],
          },
          locationViewState: {
            camera: "wide",
            locationId: "market",
            viewDescription: "Wet neon market aisle.",
            visibleAnchors: ["wet pavement"],
          },
        },
        {
          ...shots[1],
          characterIds: ["villain"],
          locationId: "rooftop",
          appearanceState: {
            characterStates: [
              {
                characterId: "villain",
                appearance: "black coat",
                outfitId: "villain-black-coat",
                visible: true,
                continuityNotes: [],
              },
            ],
            notes: [],
            propIds: ["signal-charm"],
          },
          interactionState: {
            characterIds: ["villain"],
            continuityNotes: [],
            description: "Villain holds the signal charm.",
            physicalContact: ["hand around charm"],
            propIds: ["signal-charm"],
          },
          locationViewState: {
            camera: "close",
            locationId: "rooftop",
            viewDescription: "Rain-soaked rooftop.",
            visibleAnchors: ["antenna lights"],
          },
        },
      ],
      raw: {
        characters: [
          {
            id: "courier",
            outfitIds: ["courier-yellow-rain-jacket"],
            propIds: ["cake-box"],
            shotIds: ["shot-1"],
          },
        ],
        outfits: [
          {
            id: "courier-yellow-rain-jacket",
            characterId: "courier",
            name: "Yellow rain jacket",
            shotIds: ["shot-1"],
          },
        ],
        props: [
          {
            id: "cake-box",
            ownerCharacterIds: ["courier"],
            shotIds: ["shot-1"],
          },
        ],
        locations: [
          {
            id: "market",
            shotIds: ["shot-1"],
          },
        ],
      },
    });

    expect(normalized.characters.map((character) => character.id)).toEqual(["courier", "villain"]);
    expect(normalized.outfits.map((outfit) => outfit.id)).toEqual(["courier-yellow-rain-jacket", "villain-black-coat"]);
    expect(normalized.props.map((prop) => prop.id)).toEqual(["cake-box", "signal-charm"]);
    expect(normalized.locations.map((location) => location.id)).toEqual(["market", "rooftop"]);
    expect(normalized.characters.find((character) => character.id === "villain")).toMatchObject({
      shotIds: ["shot-2"],
      propIds: ["signal-charm"],
    });
    expect(normalized.planningErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "entity_cards_character_missing" }),
        expect.objectContaining({ code: "entity_cards_outfit_missing" }),
        expect.objectContaining({ code: "entity_cards_prop_missing" }),
        expect.objectContaining({ code: "entity_cards_location_missing" }),
      ]),
    );
  });

  it("derives entity cards when structured sections are missing and reports planning errors", () => {
    const storyBible = {
      ...bible,
      props: [
        {
          id: "cake-box",
          name: "Cake box",
          description: "A white bakery box tied with red string.",
          continuityNotes: ["Keep the red string visible."],
          ownerCharacterIds: ["courier"],
          visualAnchors: ["red string"],
        },
      ],
    } satisfies StoryBible;
    const continuityGraph = {
      storyId: input.storyId,
      characters: [
        {
          characterId: "courier",
          name: "Courier",
          canonicalDescription: "A courier in a yellow rain jacket.",
          visualAnchors: ["yellow rain jacket"],
        },
      ],
      appearances: [
        {
          shotId: "shot-1",
          characterId: "courier",
          wardrobe: ["yellow rain jacket"],
          poseOrAction: "holding cake box",
          expression: "focused",
          continuityNotes: ["Keep the rain jacket."],
        },
      ],
    } satisfies CharacterContinuityGraph;
    const normalized = normalizeStoryEntityCards({
      bible: storyBible,
      continuityGraph,
      input,
      shots: [
        {
          ...shots[0],
          locationId: "market",
          appearanceState: {
            characterStates: [
              {
                characterId: "courier",
                appearance: "yellow rain jacket",
                outfitId: "rain-outfit",
                visible: true,
                continuityNotes: [],
              },
            ],
            notes: [],
            propIds: ["cake-box"],
          },
          interactionState: {
            characterIds: ["courier"],
            continuityNotes: [],
            description: "Courier holds the cake box.",
            physicalContact: ["hands on cake box"],
            propIds: ["cake-box"],
          },
          locationViewState: {
            camera: "wide",
            locationId: "market",
            viewDescription: "Wet neon market aisle.",
            visibleAnchors: ["wet pavement"],
          },
        },
      ],
      raw: {},
    });

    expect(normalized.characters[0]).toMatchObject({
      id: "courier",
      propIds: ["cake-box"],
      shotIds: ["shot-1"],
    });
    expect(normalized.outfits[0]).toMatchObject({
      characterId: "courier",
      shotIds: ["shot-1"],
    });
    expect(normalized.props[0]).toMatchObject({
      id: "cake-box",
      ownerCharacterIds: ["courier"],
      shotIds: ["shot-1"],
    });
    expect(normalized.locations[0]).toMatchObject({
      id: "market",
      shotIds: ["shot-1"],
      viewStates: [expect.objectContaining({ shotId: "shot-1" })],
    });
    expect(normalized.planningErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "entity_cards_characters_missing" }),
        expect.objectContaining({ code: "entity_cards_outfits_missing" }),
        expect.objectContaining({ code: "entity_cards_props_missing" }),
        expect.objectContaining({ code: "entity_cards_locations_missing" }),
      ]),
    );
  });

  it("records planning errors when entity-card sections are present but empty", () => {
    const storyBible = {
      ...bible,
      props: [
        {
          id: "cake-box",
          name: "Cake box",
          description: "A white bakery box tied with red string.",
          continuityNotes: ["Keep the red string visible."],
          ownerCharacterIds: ["courier"],
          visualAnchors: ["red string"],
        },
      ],
    } satisfies StoryBible;
    const continuityGraph = {
      storyId: input.storyId,
      characters: [
        {
          characterId: "courier",
          name: "Courier",
          canonicalDescription: "A courier in a yellow rain jacket.",
          visualAnchors: ["yellow rain jacket"],
        },
      ],
      appearances: [
        {
          shotId: "shot-1",
          characterId: "courier",
          wardrobe: ["yellow rain jacket"],
          poseOrAction: "holding cake box",
          expression: "focused",
          continuityNotes: ["Keep the rain jacket."],
        },
      ],
    } satisfies CharacterContinuityGraph;
    const normalized = normalizeStoryEntityCards({
      bible: storyBible,
      continuityGraph,
      input,
      shots: [
        {
          ...shots[0],
          locationId: "market",
          appearanceState: {
            characterStates: [
              {
                characterId: "courier",
                appearance: "yellow rain jacket",
                visible: true,
                continuityNotes: [],
              },
            ],
            notes: [],
            propIds: ["cake-box"],
          },
          interactionState: {
            characterIds: ["courier"],
            continuityNotes: [],
            description: "Courier holds the cake box.",
            physicalContact: ["hands on cake box"],
            propIds: ["cake-box"],
          },
          locationViewState: {
            camera: "wide",
            locationId: "market",
            viewDescription: "Wet neon market aisle.",
            visibleAnchors: ["wet pavement"],
          },
        },
      ],
      raw: {
        characters: [],
        outfits: [],
        props: [],
        locations: [],
      },
    });

    expect(normalized.characters.map((character) => character.id)).toEqual(["courier"]);
    expect(normalized.outfits.map((outfit) => outfit.characterId)).toEqual(["courier"]);
    expect(normalized.props.map((prop) => prop.id)).toEqual(["cake-box"]);
    expect(normalized.locations.map((location) => location.id)).toEqual(["market"]);
    expect(normalized.planningErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "entity_cards_character_missing" }),
        expect.objectContaining({ code: "entity_cards_outfit_missing" }),
        expect.objectContaining({ code: "entity_cards_prop_missing" }),
        expect.objectContaining({ code: "entity_cards_location_missing" }),
      ]),
    );
  });

  it("normalizes malformed JSON and LiteLLM errors into timeline node errors", async () => {
    const workflow = createStoryWorkflowState({ storyId: "story-1", workflowId: "workflow-1" });
    workflow.nodes["story-input"] = {
      nodeId: "story-input",
      result: input,
      source: "manual",
      status: "manual",
      updatedAt: workflow.updatedAt,
    };
    const malformedAdapters = createStoryLlmNodeAdapters({
      completeChat: async () => chatResponse("not json"),
    });

    await expect(malformedAdapters["story-bible"]?.({
      nodeId: "story-bible",
      workflow,
      dependencies: [workflow.nodes["story-input"]],
    })).rejects.toMatchObject({
      code: "llm_malformed_response",
    });

    const errorAdapters = createStoryLlmNodeAdapters({
      completeChat: async () => {
        throw new LiteLlmError("LITELLM_BASE_URL is required before calling the LLM API.", { statusCode: 500 });
      },
    });

    await expect(errorAdapters["story-bible"]?.({
      nodeId: "story-bible",
      workflow,
      dependencies: [workflow.nodes["story-input"]],
    })).rejects.toMatchObject({
      code: "llm_config",
    });
  });

  it("uses the configured NSFW model for Story LLM nodes except dependency, resource, and parameter planning", async () => {
    const previousNsfwModel = process.env.LITELLM_NSFW_MODEL;
    process.env.LITELLM_NSFW_MODEL = "story-nsfw-model";

    try {
      const explicitInput = {
        ...input,
        audienceRating: "explicit",
        nsfwContext: {
          enabled: true,
          audienceRating: "explicit",
          contentWarnings: ["adult content"],
          rationale: "NSFW test context.",
        },
        settingsSnapshot: {
          ...input.settingsSnapshot,
          audienceRating: "explicit",
          nsfwEnabled: true,
        },
      } satisfies StoryInput;
      const workflow = createStoryWorkflowState({ storyId: "story-1", workflowId: "workflow-nsfw-model" });
      const outline = {
        storyId: explicitInput.storyId,
        beats: [{ id: "beat-1", title: "Arrival", summary: "The courier enters.", order: 1, characterIds: ["courier"] }],
      };
      const safetyPlan = {
        storyId: explicitInput.storyId,
        audienceRating: "explicit" as const,
        contentWarnings: ["adult content"],
        blockedContent: [],
        perShotNotes: [],
        nsfwContext: {
          enabled: true,
          rationale: "NSFW test context.",
        },
      };
      const dependencyGraph = {
        storyId: explicitInput.storyId,
        nodes: shots.map((shot) => ({ shotId: shot.id, label: shot.title })),
        edges: [],
      };
      const plotStateGraph = {
        storyId: explicitInput.storyId,
        states: [{ id: "state-1", title: "Arrival", summary: "The courier enters.", shotIds: ["shot-1"] }],
        transitions: [],
      };
      const continuityGraph = {
        storyId: explicitInput.storyId,
        characters: [{
          characterId: "courier",
          name: "Courier",
          canonicalDescription: "A courier in a yellow rain jacket.",
          visualAnchors: ["yellow rain jacket"],
        }],
        appearances: [{
          shotId: "shot-1",
          characterId: "courier",
          wardrobe: ["yellow rain jacket"],
          poseOrAction: "entering the market",
          expression: "focused",
          continuityNotes: [],
        }],
      };
      const entityCards = {
        storyId: explicitInput.storyId,
        characters: [{
          id: "courier",
          name: "Courier",
          role: "Lead",
          description: "A courier in a yellow rain jacket.",
          continuityNotes: [],
          outfitIds: ["courier-yellow-rain-jacket"],
          propIds: [],
          shotIds: ["shot-1"],
          visualAnchors: ["yellow rain jacket"],
        }],
        outfits: [{
          id: "courier-yellow-rain-jacket",
          characterId: "courier",
          name: "Yellow rain jacket",
          description: "Yellow rain jacket.",
          continuityNotes: [],
          shotIds: ["shot-1"],
          visualAnchors: ["yellow rain jacket"],
        }],
        props: [],
        locations: [{
          id: "market",
          name: "Neon market",
          description: "A crowded wet market alley under neon signs.",
          shotIds: ["shot-1"],
          viewStates: [],
          visualAnchors: ["wet pavement", "neon signage"],
        }],
        planningErrors: [],
      };
      const checkpoint = explicitInput.settingsSnapshot.resourceCandidates.checkpoints[0]!;
      const lora = explicitInput.settingsSnapshot.resourceCandidates.loras[0]!;
      const resourcePlan = createStoryResourcePlan({
        storyId: explicitInput.storyId,
        candidates: {
          checkpoints: [{ resource: checkpoint }],
          loras: [{ resource: lora }],
        },
        recommendation: {
          checkpoint: { resource: checkpoint, reason: "Local checkpoint." },
          loras: [{ resource: lora, suggestedWeight: 0.6, reason: "Local LoRA." }],
          recommendationReason: "Use local resources.",
          overallEffect: "Neon continuity.",
          warnings: [],
        },
      });
      const parameterPlan = createStoryParameterPlan({
        storyId: explicitInput.storyId,
        defaults: {
          width: 1024,
          height: 768,
          steps: 28,
          cfg: 5.5,
          samplerName: "dpmpp_2m",
          scheduler: "karras",
          denoise: 1,
        },
      });
      workflow.nodes["story-input"] = {
        nodeId: "story-input",
        result: explicitInput,
        source: "manual",
        status: "manual",
        updatedAt: workflow.updatedAt,
      };
      workflow.nodes["story-bible"] = {
        nodeId: "story-bible",
        result: bible,
        source: "ai",
        status: "done",
        updatedAt: workflow.updatedAt,
      };
      workflow.nodes["story-outline"] = {
        nodeId: "story-outline",
        result: outline,
        source: "ai",
        status: "done",
        updatedAt: workflow.updatedAt,
      };
      workflow.nodes["storyboard-shots"] = {
        nodeId: "storyboard-shots",
        result: shots,
        source: "ai",
        status: "done",
        updatedAt: workflow.updatedAt,
      };
      workflow.nodes["story-safety-plan"] = {
        nodeId: "story-safety-plan",
        result: safetyPlan,
        source: "ai",
        status: "done",
        updatedAt: workflow.updatedAt,
      };
      workflow.nodes["shot-dependency-graph"] = {
        nodeId: "shot-dependency-graph",
        result: dependencyGraph,
        source: "ai",
        status: "done",
        updatedAt: workflow.updatedAt,
      };
      workflow.nodes["plot-state-graph"] = {
        nodeId: "plot-state-graph",
        result: plotStateGraph,
        source: "ai",
        status: "done",
        updatedAt: workflow.updatedAt,
      };
      workflow.nodes["character-continuity-graph"] = {
        nodeId: "character-continuity-graph",
        result: continuityGraph,
        source: "ai",
        status: "done",
        updatedAt: workflow.updatedAt,
      };
      workflow.nodes["entity-cards"] = {
        nodeId: "entity-cards",
        result: entityCards,
        source: "ai",
        status: "done",
        updatedAt: workflow.updatedAt,
      };
      workflow.nodes["resource-plan"] = {
        nodeId: "resource-plan",
        result: resourcePlan,
        source: "ai",
        status: "done",
        updatedAt: workflow.updatedAt,
      };
      workflow.nodes["parameter-plan"] = {
        nodeId: "parameter-plan",
        result: parameterPlan,
        source: "ai",
        status: "done",
        updatedAt: workflow.updatedAt,
      };

      let currentNodeId: StoryWorkflowNodeId | null = null;
      const requests: Partial<Record<StoryWorkflowNodeId, { model?: string; nsfw?: boolean }>> = {};
      const adapters = createStoryLlmNodeAdapters({
        completeChat: async (request) => {
          if (currentNodeId) {
            requests[currentNodeId] = {
              model: request.model,
              nsfw: request.nsfw,
            };
          }

          return chatResponse(JSON.stringify({
            title: "Signal Market",
            logline: "A courier follows a signal.",
            characters: bible.characters,
            locations: bible.locations,
            props: bible.props,
            outfits: entityCards.outfits,
            beats: outline.beats,
            shots: shots.map((shot) => ({
              ...shot,
              shotId: shot.id,
              animaPromptParts: {
                subjectTags: ["1boy", "solo"],
                characterTags: ["courier in yellow rain jacket"],
                seriesTags: [],
                artistTags: [],
                outfitTags: ["yellow rain jacket"],
                propTags: ["signal card"],
                actionTags: ["standing in neon market"],
                settingTags: ["wet neon market"],
                cameraTags: ["medium frame"],
                lightingTags: ["neon light"],
                styleTags: ["anime illustration"],
                singleFrameCaption: "The courier stands in a wet neon market.",
                negativeAdditions: [],
              },
            })),
            audienceRating: "explicit",
            contentWarnings: ["adult content"],
            blockedContent: [],
            perShotNotes: [],
            nsfwContext: { enabled: true, rationale: "NSFW test context." },
            nodes: dependencyGraph.nodes,
            edges: dependencyGraph.edges,
            states: plotStateGraph.states,
            transitions: plotStateGraph.transitions,
            appearances: continuityGraph.appearances,
            checkpoint: { resource: { id: checkpoint.id }, reason: "Local checkpoint." },
            loras: [{ resource: { id: lora.id }, suggestedWeight: 0.6, reason: "Local LoRA." }],
            recommendationReason: "Use local resources.",
            overallEffect: "Neon continuity.",
            defaults: parameterPlan.defaults,
            perShotOverrides: [],
            warnings: [],
          }));
        },
      });
      const nodeIds = [
        "story-bible",
        "story-outline",
        "storyboard-shots",
        "story-safety-plan",
        "shot-dependency-graph",
        "plot-state-graph",
        "character-continuity-graph",
        "entity-cards",
        "resource-plan",
        "parameter-plan",
        "story-render-plan",
      ] as const satisfies readonly StoryWorkflowNodeId[];

      for (const nodeId of nodeIds) {
        currentNodeId = nodeId;
        await adapters[nodeId]?.({
          nodeId,
          workflow,
          dependencies: [],
        });
      }

      expect(requests).toMatchObject({
        "story-bible": { model: "story-nsfw-model", nsfw: true },
        "story-outline": { model: "story-nsfw-model", nsfw: true },
        "storyboard-shots": { model: "story-nsfw-model", nsfw: true },
        "story-safety-plan": { model: "story-nsfw-model", nsfw: true },
        "plot-state-graph": { model: "story-nsfw-model", nsfw: true },
        "character-continuity-graph": { model: "story-nsfw-model", nsfw: true },
        "entity-cards": { model: "story-nsfw-model", nsfw: true },
        "story-render-plan": { model: "story-nsfw-model", nsfw: true },
        "shot-dependency-graph": { nsfw: true },
        "resource-plan": { nsfw: true },
        "parameter-plan": { nsfw: true },
      });
      expect(requests["shot-dependency-graph"]?.model).toBeUndefined();
      expect(requests["resource-plan"]?.model).toBeUndefined();
      expect(requests["parameter-plan"]?.model).toBeUndefined();
    } finally {
      if (previousNsfwModel === undefined) {
        delete process.env.LITELLM_NSFW_MODEL;
      } else {
        process.env.LITELLM_NSFW_MODEL = previousNsfwModel;
      }
    }
  });

  it("asks Story planning nodes for concrete visual anchors and selective source semantics", async () => {
    const workflow = createStoryWorkflowState({ storyId: "story-1", workflowId: "workflow-1" });
    const bible = normalizeStoryBible(
      {
        title: "Signal Market",
        logline: "A courier follows a signal.",
        characters: [{ id: "courier", name: "Courier", description: "A blue-jacket courier." }],
        locations: [{ id: "market", name: "Market", description: "A neon market." }],
      },
      input,
    );
    const outline = {
      storyId: input.storyId,
      beats: [{ id: "beat-1", title: "Arrival", summary: "The courier enters.", order: 1, characterIds: ["courier"] }],
    };
    const systemPrompts: string[] = [];
    const adapters = createStoryLlmNodeAdapters({
      completeChat: async (request) => {
        const systemContent = request.messages[0]?.content;
        if (typeof systemContent === "string") {
          systemPrompts.push(systemContent);
        }

        return chatResponse(JSON.stringify({
          nodes: shots.map((shot) => ({ shotId: shot.id, label: shot.title })),
          edges: [],
          shots,
          title: "Signal Market",
          logline: "A courier follows a signal.",
          characters: [{ id: "courier", name: "Courier", description: "A blue-jacket courier." }],
          locations: [{ id: "market", name: "Market", description: "A neon market." }],
        }));
      },
    });
    workflow.nodes["story-input"] = {
      nodeId: "story-input",
      result: input,
      source: "manual",
      status: "manual",
      updatedAt: workflow.updatedAt,
    };

    await adapters["story-bible"]?.({
      nodeId: "story-bible",
      workflow,
      dependencies: [workflow.nodes["story-input"]],
    });

    workflow.nodes["story-bible"] = {
      nodeId: "story-bible",
      result: bible,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["story-outline"] = {
      nodeId: "story-outline",
      result: outline,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };

    await adapters["storyboard-shots"]?.({
      nodeId: "storyboard-shots",
      workflow,
      dependencies: [workflow.nodes["story-outline"]],
    });

    workflow.nodes["storyboard-shots"] = {
      nodeId: "storyboard-shots",
      result: shots,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };

    await adapters["shot-dependency-graph"]?.({
      nodeId: "shot-dependency-graph",
      workflow,
      dependencies: [workflow.nodes["storyboard-shots"]],
    });

    expect(systemPrompts.join("\n")).toContain("concrete visual anchors");
    expect(systemPrompts.join("\n")).toContain("image-generation-ready visual brief");
    expect(systemPrompts.join("\n")).toContain("Visible subjects must match current segment explicitly named characters");
    expect(systemPrompts.join("\n")).toContain("do not invent extra visible people");
    expect(systemPrompts.join("\n")).not.toContain("Show only");
    expect(systemPrompts.join("\n")).toContain("ordinary story order and continuity do not need sourceShotIds");
    expect(systemPrompts.join("\n")).toContain("standing to kneeling");
    expect(systemPrompts.join("\n")).toContain("close-up to wide shot");
    expect(systemPrompts.join("\n")).toContain("Create a shot dependency graph using only supplied shot ids");
    expect(systemPrompts.join("\n")).toContain('Use reason "img2img-source" only when the later shot should receive the earlier generated image');
    expect(systemPrompts.join("\n")).toContain("Never use img2img-source for high-risk source-image transitions");
    expect(systemPrompts.join("\n")).toContain("planning-only reasons must remain non-executable");
    expect(systemPrompts.join("\n")).toContain('"reason":"img2img-source|reference|continuity|story-order|manual"');
    expect(systemPrompts.join("\n")).not.toContain('Every returned edge must use reason "img2img-source"');
  });

  it("passes explicit storySegments to outline and storyboard LLM payloads", async () => {
    const segmentedInput = {
      ...input,
      rawIntent: courierStory,
      targetShotCount: undefined,
      storyContext: "Characters: teenage courier in a yellow rain jacket, carrying a cake box.",
      storySegments: [
        { id: "beat-1", title: "Beat 1", sourceText: "The courier pedals into a wet market alley.", order: 1, kind: "beat" },
        { id: "final-image", title: "Final image", sourceText: "The courier, little girl, and father share the cake handoff.", order: 2, kind: "final-image" },
      ],
    } satisfies StoryInput;
    const workflow = createStoryWorkflowState({ storyId: "story-1", workflowId: "workflow-segments" });
    const bible = normalizeStoryBible(
      {
        title: "Courier Cake",
        logline: "A courier protects a cake.",
        characters: [
          { id: "courier", name: "Courier", description: "A teenage courier in a yellow rain jacket." },
          { id: "girl", name: "Little girl", description: "A little girl in a party hat." },
          { id: "father", name: "Father", description: "A relieved father." },
        ],
        locations: [{ id: "market", name: "Market", description: "A wet market alley." }],
      },
      segmentedInput,
    );
    const outline = {
      storyId: segmentedInput.storyId,
      beats: segmentedInput.storySegments.map((segment) => ({
        id: segment.id,
        title: segment.title,
        summary: segment.sourceText,
        order: segment.order,
        characterIds: ["courier"],
      })),
    };
    const payloads: Array<Record<string, unknown>> = [];
    const adapters = createStoryLlmNodeAdapters({
      completeChat: async (request) => {
        const content = request.messages[1]?.content;
        payloads.push(typeof content === "string" ? JSON.parse(content) as Record<string, unknown> : {});
        return chatResponse(JSON.stringify({
          beats: outline.beats,
          shots,
          nodes: [],
          edges: [],
          title: "Courier Cake",
          logline: "A courier protects a cake.",
          characters: bible.characters,
          locations: bible.locations,
        }));
      },
    });
    workflow.nodes["story-input"] = {
      nodeId: "story-input",
      result: segmentedInput,
      source: "manual",
      status: "manual",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["story-bible"] = {
      nodeId: "story-bible",
      result: bible,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["story-outline"] = {
      nodeId: "story-outline",
      result: outline,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };

    await adapters["story-outline"]?.({
      nodeId: "story-outline",
      workflow,
      dependencies: [workflow.nodes["story-bible"]],
    });
    await adapters["storyboard-shots"]?.({
      nodeId: "storyboard-shots",
      workflow,
      dependencies: [workflow.nodes["story-outline"]],
    });

    expect(payloads[0]).toMatchObject({
      shotCountMode: "provided-story-segments",
      storySegments: segmentedInput.storySegments,
    });
    expect(payloads[0]).not.toHaveProperty("targetShotCount");
    expect(payloads[1]).toMatchObject({
      shotCountMode: "provided-story-segments",
      storySegments: segmentedInput.storySegments,
    });
    expect(payloads[1]).not.toHaveProperty("targetShotCount");
  });

  it("does not pass a local estimated target shot count when the user leaves shots blank", async () => {
    const inlineStory = "Context before the labeled sequence. Beat 1: The student finds the missing photo at her desk. Beat 2: The student reprints the photo at the copy shop. Beat 3: The student finishes the collage at a cafe table. Beat 4: The student offers the wrapped collage on a side street. Final image: Her friend opens the collage in sunset light.";
    const autoInput = {
      ...input,
      rawIntent: inlineStory,
      targetShotCount: undefined,
      storyContext: undefined,
      storySegments: undefined,
    } satisfies StoryInput;
    const workflow = createStoryWorkflowState({ storyId: "story-1", workflowId: "workflow-llm-count" });
    const bible = normalizeStoryBible(
      {
        title: "Photo Collage",
        logline: "A student completes a collage.",
        characters: [{ id: "student", name: "Student", description: "A college student with a collage." }],
        locations: [{ id: "campus", name: "Campus", description: "A campus sequence." }],
      },
      autoInput,
    );
    const outline = {
      storyId: autoInput.storyId,
      beats: [
        { id: "beat-1", title: "Beat 1", summary: "The student finds the missing photo.", order: 1, characterIds: ["student"] },
        { id: "beat-2", title: "Beat 2", summary: "The student reprints the photo.", order: 2, characterIds: ["student"] },
        { id: "beat-3", title: "Beat 3", summary: "The student finishes the collage.", order: 3, characterIds: ["student"] },
        { id: "beat-4", title: "Beat 4", summary: "The student offers the wrapped collage.", order: 4, characterIds: ["student"] },
        { id: "final-image", title: "Final image", summary: "Her friend opens the collage.", order: 5, characterIds: ["student"] },
      ],
    };
    const payloads: Array<Record<string, unknown>> = [];
    const systemPrompts: string[] = [];
    const adapters = createStoryLlmNodeAdapters({
      completeChat: async (request) => {
        const systemContent = request.messages[0]?.content;
        const userContent = request.messages[1]?.content;
        systemPrompts.push(typeof systemContent === "string" ? systemContent : "");
        payloads.push(typeof userContent === "string" ? JSON.parse(userContent) as Record<string, unknown> : {});
        return chatResponse(JSON.stringify({
          beats: outline.beats,
          shots: outline.beats.map((beat) => ({
            id: beat.id.replace("beat", "shot"),
            order: beat.order,
            title: beat.title,
            description: beat.summary,
            beatId: beat.id,
            locationId: "campus",
            characterIds: ["student"],
            sourceShotIds: [],
            camera: "medium frame",
            promptIntent: beat.summary,
            continuityNotes: [],
          })),
          title: "Photo Collage",
          logline: "A student completes a collage.",
          characters: bible.characters,
          locations: bible.locations,
        }));
      },
    });
    workflow.nodes["story-input"] = {
      nodeId: "story-input",
      result: autoInput,
      source: "manual",
      status: "manual",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["story-bible"] = {
      nodeId: "story-bible",
      result: bible,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["story-outline"] = {
      nodeId: "story-outline",
      result: outline,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };

    await adapters["story-outline"]?.({
      nodeId: "story-outline",
      workflow,
      dependencies: [workflow.nodes["story-bible"]],
    });
    await adapters["storyboard-shots"]?.({
      nodeId: "storyboard-shots",
      workflow,
      dependencies: [workflow.nodes["story-outline"]],
    });

    expect(payloads[0]).toMatchObject({
      shotCountMode: "llm-decides",
      storySegments: [],
    });
    expect(payloads[0]).not.toHaveProperty("targetShotCount");
    expect(payloads[1]).toMatchObject({
      shotCountMode: "llm-decides",
      storySegments: [],
    });
    expect(payloads[1]).not.toHaveProperty("targetShotCount");
    expect(systemPrompts.join("\n")).toContain("local code has not parsed labels");
    expect(systemPrompts.join("\n")).toContain("Beat 1:");
    expect(systemPrompts.join("\n")).not.toContain("estimated target");
  });

  it("limits LLM-decided Story shots to outline beats instead of padding to three", () => {
    const autoInput = {
      ...input,
      rawIntent: "Maya waits at a rainy bus stop.",
      targetShotCount: undefined,
    } satisfies StoryInput;
    const bible = normalizeStoryBible(
      {
        title: "Rain Stop",
        logline: "Maya waits.",
        characters: [{ id: "maya", name: "Maya", description: "A teenage girl in a yellow rain jacket." }],
        locations: [{ id: "bus-stop", name: "Bus stop", description: "A rainy bus stop." }],
      },
      autoInput,
    );
    const outline = {
      storyId: autoInput.storyId,
      beats: [{ id: "beat-1", title: "Wait", summary: "Maya waits.", order: 1, characterIds: ["maya"] }],
    };
    const normalized = normalizeStoryShots(
      {
        shots: [
          {
            id: "shot-1",
            order: 1,
            title: "Wait",
            description: "Maya waits.",
            beatId: "beat-1",
            locationId: "bus-stop",
            characterIds: ["maya"],
            sourceShotIds: [],
            camera: "wide",
            promptIntent: "Maya waits at a rainy bus stop",
            continuityNotes: [],
          },
          {
            id: "shot-2",
            order: 2,
            title: "Filler",
            description: "Unneeded filler.",
            beatId: "beat-1",
            locationId: "bus-stop",
            characterIds: ["maya"],
            sourceShotIds: [],
            camera: "medium",
            promptIntent: "filler beat",
            continuityNotes: [],
          },
        ],
      },
      autoInput,
      bible,
      outline,
    );

    expect(normalized).toHaveLength(1);
    expect(normalized[0]?.title).toBe("Wait");
  });

  it("limits filler shots for explicit segments and preserves final image subjects", () => {
    const segmentedInput = {
      ...input,
      rawIntent: courierStory,
      targetShotCount: undefined,
      storySegments: [
        { id: "beat-1", title: "Beat 1", sourceText: "The courier enters the wet alley.", order: 1, kind: "beat" },
        { id: "beat-2", title: "Beat 2", sourceText: "The courier catches the bakery box.", order: 2, kind: "beat" },
        { id: "beat-3", title: "Beat 3", sourceText: "The courier runs to the apartment.", order: 3, kind: "beat" },
        { id: "beat-4", title: "Beat 4", sourceText: "The courier knocks at the door.", order: 4, kind: "beat" },
        { id: "final-image", title: "Final image", sourceText: "The courier, little girl, and father receive the battered cake box.", order: 5, kind: "final-image" },
      ],
    } satisfies StoryInput;
    const bible = normalizeStoryBible(
      {
        title: "Cake Run",
        logline: "A courier protects a cake.",
        characters: [
          { id: "courier", name: "Courier", description: "A teenage courier in a yellow rain jacket." },
          { id: "girl", name: "Little girl", description: "A little girl in a party hat." },
          { id: "father", name: "Father", description: "A relieved father." },
        ],
        locations: [{ id: "apartment", name: "Apartment", description: "An apartment doorway." }],
      },
      segmentedInput,
    );
    const outline = {
      storyId: segmentedInput.storyId,
      beats: segmentedInput.storySegments.map((segment) => ({
        id: segment.id,
        title: segment.title,
        summary: segment.sourceText,
        order: segment.order,
        characterIds: segment.id === "final-image" ? ["courier", "girl", "father"] : ["courier"],
      })),
    };
    const normalized = normalizeStoryShots(
      {
        shots: [
          ...segmentedInput.storySegments.map((segment) => ({
            id: segment.id.replace("beat", "shot"),
            order: segment.order,
            title: segment.title,
            description: segment.sourceText,
            beatId: segment.id,
            locationId: "apartment",
            characterIds: segment.id === "final-image" ? ["courier", "girl", "father"] : ["courier"],
            sourceShotIds: [],
            camera: "medium frame",
            promptIntent: segment.sourceText,
            continuityNotes: [],
          })),
          {
            id: "shot-6",
            order: 6,
            title: "Filler",
            description: "Unneeded extra shot.",
            beatId: "final-image",
            locationId: "apartment",
            characterIds: ["courier"],
            sourceShotIds: [],
            camera: "medium frame",
            promptIntent: "filler",
            continuityNotes: [],
          },
        ],
      },
      segmentedInput,
      bible,
      outline,
    );

    expect(normalized).toHaveLength(5);
    expect(normalized[4]).toMatchObject({
      title: "Final image",
      characterIds: ["courier", "girl", "father"],
    });
    expect(normalized[4]?.promptIntent).toContain("little girl");
    expect(normalized[4]?.promptIntent).toContain("father");
  });

  it("rejects invented Story resource checkpoint or LoRA ids and blocks missing checkpoint candidates", () => {
    expect(() =>
      normalizeStoryResourcePlan(
        {
          checkpoint: { resource: { id: "invented-checkpoint" }, reason: "Invented." },
          loras: [],
          recommendationReason: "Bad",
          overallEffect: "Bad",
          warnings: [],
        },
        input,
      ),
    ).toThrow(TimelineNodeExecutionError);

    expect(() =>
      normalizeStoryResourcePlan(
        {
          checkpoint: { resource: { id: "checkpoint-local" }, reason: "Local." },
          loras: [{ resource: { id: "invented-lora" }, reason: "Invented.", suggestedWeight: 0.6 }],
          recommendationReason: "Bad",
          overallEffect: "Bad",
          warnings: [],
        },
        input,
      ),
    ).toThrow(TimelineNodeExecutionError);

    expect(() =>
      normalizeStoryResourcePlan(
        {
          checkpoint: { resource: { id: "checkpoint-local" }, reason: "Local." },
          loras: [],
          recommendationReason: "Bad",
          overallEffect: "Bad",
          warnings: [],
        },
        {
          ...input,
          settingsSnapshot: {
            resourceCandidates: {
              checkpoints: [],
              loras: [],
            },
          },
        },
      ),
    ).toThrow(TimelineNodeExecutionError);
  });

  it("accepts only real Story resource candidates", () => {
    const plan = normalizeStoryResourcePlan(
      {
        checkpoint: { resource: { id: "checkpoint-local" }, reason: "Local checkpoint." },
        loras: [{ resource: { id: "lora-local" }, reason: "Local LoRA.", suggestedWeight: 0.6 }],
        recommendationReason: "Use real resources.",
        overallEffect: "Neon continuity.",
        warnings: [],
      },
      input,
    );

    expect(plan.checkpoint.resource).toMatchObject({
      id: "checkpoint-local",
      modelFileName: "local.safetensors",
    });
    expect(plan.loras[0]?.resource).toMatchObject({
      id: "lora-local",
      modelFileName: "local-lora.safetensors",
    });
  });

  it("preserves full resource-plan reasons and warnings for node summaries", () => {
    const checkpointTail = "checkpoint reason tail visible in resource plan summary";
    const loraTail = "lora reason tail visible in resource plan summary";
    const recommendationTail = "recommendation reason tail visible in resource plan summary";
    const warningTail = "warning tail visible in resource plan summary";
    const makeLongText = (tail: string) => [
      ...Array.from({ length: 30 }, (_, index) =>
        `Detailed resource-selection rationale segment ${index + 1} with candidate metadata, tags, preview dimensions, and story fit.`,
      ),
      tail,
    ].join(" ");

    const plan = normalizeStoryResourcePlan(
      {
        checkpoint: { resource: { id: "checkpoint-local" }, reason: makeLongText(checkpointTail) },
        loras: [{ resource: { id: "lora-local" }, reason: makeLongText(loraTail), suggestedWeight: 0.6 }],
        recommendationReason: makeLongText(recommendationTail),
        overallEffect: "Neon continuity.",
        warnings: [makeLongText(warningTail)],
      },
      input,
    );

    expect(plan.checkpoint.reason).toContain(checkpointTail);
    expect(plan.loras[0]?.reason).toContain(loraTail);
    expect(plan.recommendationReason).toContain(recommendationTail);
    expect(plan.warnings[0]).toContain(warningTail);
  });

  it("uses transient resource candidates when Story input stores only candidate counts", async () => {
    const lightInput = {
      ...input,
      settingsSnapshot: {
        resourceCandidateCounts: {
          checkpoints: 1,
          loras: 1,
        },
      },
    } satisfies StoryInput;
    const workflow = createStoryWorkflowState({ storyId: "story-1", workflowId: "workflow-1" });
    workflow.nodes["story-input"] = {
      nodeId: "story-input",
      result: lightInput,
      source: "manual",
      status: "manual",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["story-bible"] = {
      nodeId: "story-bible",
      result: bible,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["storyboard-shots"] = {
      nodeId: "storyboard-shots",
      result: shots,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["story-safety-plan"] = {
      nodeId: "story-safety-plan",
      result: {
        storyId: "story-1",
        audienceRating: "safe",
        contentWarnings: [],
        blockedContent: [],
        perShotNotes: [],
        nsfwContext: {
          enabled: false,
          rationale: "Safe test context.",
        },
      },
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    let requestPayload: unknown;
    const resourceCandidates = input.settingsSnapshot.resourceCandidates;
    const adapters = createStoryLlmNodeAdapters({
      completeChat: async (request) => {
        const content = request.messages[1]?.content;
        requestPayload = typeof content === "string" ? JSON.parse(content) : {};
        return chatResponse(JSON.stringify({
          checkpoint: { resource: { id: "checkpoint-local" }, reason: "Local checkpoint." },
          loras: [{ resource: { id: "lora-local" }, reason: "Local LoRA.", suggestedWeight: 0.6 }],
          recommendationReason: "Use real resources.",
          overallEffect: "Neon continuity.",
          warnings: [],
        }));
      },
      resourceCandidates,
    });

    const result = await adapters["resource-plan"]?.({
      nodeId: "resource-plan",
      workflow,
      dependencies: [workflow.nodes["story-safety-plan"], workflow.nodes["storyboard-shots"]],
    });

    expect(requestPayload).toMatchObject({
      candidates: {
        checkpoints: [expect.objectContaining({ id: "checkpoint-local" })],
        loras: [
          expect.objectContaining({
            id: "lora-local",
            averageWeight: 0.65,
            usageGuide: "Use around 0.65 for neon signage without overpowering characters.",
            recommendations: [
              expect.objectContaining({
                loraWeight: 0.65,
                notes: "Use lower weights when character identity is more important than signage.",
              }),
            ],
          }),
        ],
      },
      input: {
        settingsSnapshot: {
          resourceCandidateCounts: {
            checkpoints: 1,
            loras: 1,
          },
        },
      },
    });
    expect(JSON.stringify(requestPayload)).not.toContain("resourceCandidates");
    expect((result as { value?: { checkpoint?: { resource?: { id?: string } } } } | undefined)?.value?.checkpoint?.resource?.id)
      .toBe("checkpoint-local");
  });

  it("loads ranked Story resource candidates before asking the LLM to choose", async () => {
    const rankedInput = {
      ...input,
      settingsSnapshot: {
        promptProfile: "anima",
        resourceCandidateCounts: {
          checkpoints: 1,
          loras: 1,
        },
      },
    } satisfies StoryInput;
    const workflow = createStoryWorkflowState({ storyId: "story-1", workflowId: "workflow-1" });
    workflow.nodes["story-input"] = {
      nodeId: "story-input",
      result: rankedInput,
      source: "manual",
      status: "manual",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["story-bible"] = {
      nodeId: "story-bible",
      result: bible,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["storyboard-shots"] = {
      nodeId: "storyboard-shots",
      result: shots,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["story-safety-plan"] = {
      nodeId: "story-safety-plan",
      result: {
        storyId: "story-1",
        audienceRating: "safe",
        contentWarnings: [],
        blockedContent: [],
        perShotNotes: [],
        nsfwContext: {
          enabled: false,
          rationale: "Safe test context.",
        },
      },
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    let loadRequest: unknown;
    let requestPayload: unknown;
    const adapters = createStoryLlmNodeAdapters({
      completeChat: async (request) => {
        const content = request.messages[1]?.content;
        requestPayload = typeof content === "string" ? JSON.parse(content) : {};
        return chatResponse(JSON.stringify({
          checkpoint: { resource: { id: "checkpoint-ranked" }, reason: "Ranked Anima checkpoint." },
          loras: [{ resource: { id: "lora-ranked" }, reason: "Ranked Anima LoRA.", suggestedWeight: 0.62 }],
          recommendationReason: "Use ranked resources.",
          overallEffect: "Anima neon continuity.",
          warnings: [],
        }));
      },
      loadResourceCandidates: async (request) => {
        loadRequest = request;
        return {
          checkpoints: [
            {
              id: "checkpoint-ranked",
              name: "Ranked Anima Checkpoint",
              baseModel: "Anima",
              modelFileName: "ranked-anima.safetensors",
              recommendationRank: 1,
              recommendationScore: 0.032,
              importedImageCount: 7,
              commonLoras: [{ resourceId: "lora-ranked", name: "Ranked Anima LoRA", count: 4 }],
            },
          ],
          loras: [
            {
              id: "lora-ranked",
              name: "Ranked Anima LoRA",
              baseModel: "Anima",
              modelFileName: "ranked-lora.safetensors",
              trainedWords: ["anima_neon"],
              recommendationRank: 1,
              recommendationScore: 0.029,
              importedImageCount: 5,
              commonCheckpoints: [{ resourceId: "checkpoint-ranked", name: "Ranked Anima Checkpoint", count: 4 }],
            },
          ],
        };
      },
    });

    const result = await adapters["resource-plan"]?.({
      nodeId: "resource-plan",
      workflow,
      dependencies: [workflow.nodes["story-safety-plan"], workflow.nodes["storyboard-shots"]],
    });

    expect(loadRequest).toMatchObject({
      promptProfile: "anima",
      desiredEffect: expect.stringContaining("Prompt profile: Anima (anima)"),
    });
    expect(loadRequest).toMatchObject({
      desiredEffect: expect.stringContaining("neon market arrival"),
    });
    expect(requestPayload).toMatchObject({
      desiredEffect: expect.stringContaining("neon market arrival"),
      promptProfile: "anima",
      candidates: {
        checkpoints: [
          expect.objectContaining({
            id: "checkpoint-ranked",
            recommendationRank: 1,
            recommendationScore: 0.032,
            importedImageCount: 7,
            commonLoras: [{ resourceId: "lora-ranked", name: "Ranked Anima LoRA", count: 4 }],
          }),
        ],
        loras: [
          expect.objectContaining({
            id: "lora-ranked",
            recommendationRank: 1,
            recommendationScore: 0.029,
            trainedWords: ["anima_neon"],
            commonCheckpoints: [{ resourceId: "checkpoint-ranked", name: "Ranked Anima Checkpoint", count: 4 }],
          }),
        ],
      },
    });
    expect((result as { value?: { checkpoint?: { resource?: { id?: string } } } } | undefined)?.value?.checkpoint?.resource?.id)
      .toBe("checkpoint-ranked");
  });

  it("uses explicit Story style resources without asking the resource-plan LLM", async () => {
    const styleInput = {
      ...input,
      settingsSnapshot: {
        promptProfile: "illustrious",
        stylePalette: {
          checkpointId: "checkpoint-manual",
          loras: [
            { id: "lora-enabled", enabled: true, strengthModel: 0.84, strengthClip: 0.41 },
            { id: "lora-disabled", enabled: false, strengthModel: 0.9, strengthClip: 0.9 },
          ],
        },
      },
    } satisfies StoryInput;
    const workflow = createStoryWorkflowState({ storyId: "story-1", workflowId: "workflow-manual-resources" });
    workflow.nodes["story-input"] = {
      nodeId: "story-input",
      result: styleInput,
      source: "manual",
      status: "manual",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["story-bible"] = {
      nodeId: "story-bible",
      result: bible,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["storyboard-shots"] = {
      nodeId: "storyboard-shots",
      result: shots,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["story-safety-plan"] = {
      nodeId: "story-safety-plan",
      result: {
        storyId: "story-1",
        audienceRating: "safe",
        contentWarnings: [],
        blockedContent: [],
        perShotNotes: [],
        nsfwContext: {
          enabled: false,
          rationale: "Safe test context.",
        },
      },
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    let loadRequest: unknown;
    let chatCalled = false;
    const adapters = createStoryLlmNodeAdapters({
      completeChat: async () => {
        chatCalled = true;
        return chatResponse("{}");
      },
      loadResourceCandidates: async (request) => {
        loadRequest = request;
        return {
          checkpoints: [
            {
              id: "checkpoint-manual",
              name: "Manual Checkpoint",
              baseModel: "Illustrious",
              modelFileName: "manual.safetensors",
            },
          ],
          loras: [
            {
              id: "lora-enabled",
              name: "Enabled LoRA",
              baseModel: "Illustrious",
              modelFileName: "enabled-lora.safetensors",
              averageWeight: 0.55,
            },
            {
              id: "lora-disabled",
              name: "Disabled LoRA",
              baseModel: "Illustrious",
              modelFileName: "disabled-lora.safetensors",
              averageWeight: 0.9,
            },
          ],
        };
      },
    });

    const result = await adapters["resource-plan"]?.({
      nodeId: "resource-plan",
      workflow,
      dependencies: [workflow.nodes["story-safety-plan"], workflow.nodes["storyboard-shots"]],
    });
    const resourcePlan = (result as { source: string; value: ReturnType<typeof normalizeStoryResourcePlan> } | undefined);

    expect(chatCalled).toBe(false);
    expect(loadRequest).toMatchObject({
      selectedCheckpointId: "checkpoint-manual",
      selectedLoraIds: ["lora-enabled"],
    });
    expect(resourcePlan?.source).toBe("manual");
    expect(resourcePlan?.value.checkpoint.resource.id).toBe("checkpoint-manual");
    expect(resourcePlan?.value.loras).toHaveLength(1);
    expect(resourcePlan?.value.loras[0]).toMatchObject({
      resource: {
        id: "lora-enabled",
        storyInputStrengthModel: 0.84,
        storyInputStrengthClip: 0.41,
      },
      suggestedWeight: 0.84,
    });
  });

  it("rejects incompatible explicit Story style LoRAs before asking the resource-plan LLM", async () => {
    const styleInput = {
      ...input,
      settingsSnapshot: {
        promptProfile: "illustrious",
        stylePalette: {
          checkpointId: "checkpoint-manual",
          loras: [{ id: "lora-pony", enabled: true, strengthModel: 0.7 }],
        },
      },
    } satisfies StoryInput;
    const workflow = createStoryWorkflowState({ storyId: "story-1", workflowId: "workflow-incompatible-lora" });
    workflow.nodes["story-input"] = {
      nodeId: "story-input",
      result: styleInput,
      source: "manual",
      status: "manual",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["story-bible"] = {
      nodeId: "story-bible",
      result: bible,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["storyboard-shots"] = {
      nodeId: "storyboard-shots",
      result: shots,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["story-safety-plan"] = {
      nodeId: "story-safety-plan",
      result: {
        storyId: "story-1",
        audienceRating: "safe",
        contentWarnings: [],
        blockedContent: [],
        perShotNotes: [],
        nsfwContext: {
          enabled: false,
          rationale: "Safe test context.",
        },
      },
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    let chatCalled = false;
    const adapters = createStoryLlmNodeAdapters({
      completeChat: async () => {
        chatCalled = true;
        return chatResponse("{}");
      },
      loadResourceCandidates: async () => ({
        checkpoints: [
          {
            id: "checkpoint-manual",
            name: "Manual Checkpoint",
            baseModel: "Illustrious",
            modelFileName: "manual.safetensors",
          },
        ],
        loras: [
          {
            id: "lora-pony",
            name: "Pony LoRA",
            baseModel: "Pony",
            modelFileName: "pony-lora.safetensors",
            averageWeight: 0.7,
          },
        ],
      }),
    });
    const resourcePlanAdapter = adapters["resource-plan"];

    expect(resourcePlanAdapter).toBeDefined();
    await expect(resourcePlanAdapter?.({
      nodeId: "resource-plan",
      workflow,
      dependencies: [workflow.nodes["story-safety-plan"], workflow.nodes["storyboard-shots"]],
    })).rejects.toMatchObject({
      code: "resource_selection_invalid",
      message: expect.stringContaining("incompatible"),
    });
    expect(chatCalled).toBe(false);
  });

  it("uses saved Story style parameters without asking the parameter-plan LLM", async () => {
    const styleInput = {
      ...input,
      settingsSnapshot: {
        stylePalette: {
          checkpointId: "checkpoint-local",
          loras: [],
          parameters: {
            width: 832,
            height: 1216,
            steps: 31,
            cfg: 4.25,
            samplerName: "euler",
            scheduler: "normal",
            denoise: 0.88,
            seed: 12345,
          },
        },
      },
    } satisfies StoryInput;
    const workflow = createStoryWorkflowState({ storyId: "story-1", workflowId: "workflow-manual-parameters" });
    workflow.nodes["story-input"] = {
      nodeId: "story-input",
      result: styleInput,
      source: "manual",
      status: "manual",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["storyboard-shots"] = {
      nodeId: "storyboard-shots",
      result: shots,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["resource-plan"] = {
      nodeId: "resource-plan",
      result: normalizeStoryResourcePlan(
        {
          checkpoint: { resource: { id: "checkpoint-local" }, reason: "Local checkpoint." },
          loras: [],
          recommendationReason: "Use real resources.",
          overallEffect: "Neon continuity.",
          warnings: [],
        },
        input,
      ),
      source: "manual",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    let chatCalled = false;
    const adapters = createStoryLlmNodeAdapters({
      completeChat: async () => {
        chatCalled = true;
        return chatResponse("{}");
      },
      samplerOptions: {
        samplers: ["euler"],
        schedulers: ["normal"],
      },
    });

    const result = await adapters["parameter-plan"]?.({
      nodeId: "parameter-plan",
      workflow,
      dependencies: [workflow.nodes["resource-plan"], workflow.nodes["storyboard-shots"]],
    });
    const parameterPlan = (result as { source: string; value: StoryParameterPlan } | undefined);

    expect(chatCalled).toBe(false);
    expect(parameterPlan?.source).toBe("manual");
    expect(parameterPlan?.value.defaults).toMatchObject({
      width: 832,
      height: 1216,
      steps: 31,
      cfg: 4.25,
      samplerName: "euler",
      scheduler: "normal",
      denoise: 0.88,
      seed: 12345,
    });
  });

  it("caps Story resource desiredEffect at the external candidate-ranking boundary", async () => {
    const tailMarker = "desired effect tail marker beyond compact boundary";
    const longInput = {
      ...input,
      rawIntent: [
        ...Array.from({ length: 900 }, (_, index) =>
          `Detailed storyboard planning clause ${index + 1} with visible character action, setting, lighting, and continuity.`,
        ),
        tailMarker,
      ].join(" "),
      settingsSnapshot: {
        promptProfile: "anima",
        resourceCandidateCounts: {
          checkpoints: 1,
          loras: 0,
        },
      },
    } satisfies StoryInput;
    const workflow = createStoryWorkflowState({ storyId: "story-1", workflowId: "workflow-long-desired-effect" });
    workflow.nodes["story-input"] = {
      nodeId: "story-input",
      result: longInput,
      source: "manual",
      status: "manual",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["story-bible"] = {
      nodeId: "story-bible",
      result: bible,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["storyboard-shots"] = {
      nodeId: "storyboard-shots",
      result: shots,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["story-safety-plan"] = {
      nodeId: "story-safety-plan",
      result: {
        storyId: "story-1",
        audienceRating: "safe",
        contentWarnings: [],
        blockedContent: [],
        perShotNotes: [],
        nsfwContext: {
          enabled: false,
          rationale: "Safe test context.",
        },
      },
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    let loadRequest: unknown;
    let requestPayload: unknown;
    const adapters = createStoryLlmNodeAdapters({
      completeChat: async (request) => {
        const content = request.messages[1]?.content;
        requestPayload = typeof content === "string" ? JSON.parse(content) : {};

        return chatResponse(JSON.stringify({
          checkpoint: { resource: { id: "checkpoint-ranked" }, reason: "Ranked Anima checkpoint." },
          loras: [],
          recommendationReason: "Use ranked resources.",
          overallEffect: "Anima continuity.",
          warnings: [],
        }));
      },
      loadResourceCandidates: async (request) => {
        loadRequest = request;
        return {
          checkpoints: [
            {
              id: "checkpoint-ranked",
              name: "Ranked Anima Checkpoint",
              baseModel: "Anima",
              modelFileName: "ranked-anima.safetensors",
            },
          ],
          loras: [],
        };
      },
    });

    await adapters["resource-plan"]?.({
      nodeId: "resource-plan",
      workflow,
      dependencies: [workflow.nodes["story-safety-plan"], workflow.nodes["storyboard-shots"]],
    });

    const desiredEffect = (loadRequest as { desiredEffect?: string }).desiredEffect ?? "";
    const payloadDesiredEffect = (requestPayload as { desiredEffect?: string }).desiredEffect ?? "";

    expect(desiredEffect.length).toBeLessThanOrEqual(6000);
    expect(payloadDesiredEffect.length).toBeLessThanOrEqual(6000);
    expect(desiredEffect).toContain("Prompt profile: Anima (anima)");
    expect(desiredEffect).not.toContain(tailMarker);
    expect(desiredEffect).not.toContain("...");
  });

  it("constrains parameter planning to live sampler and scheduler options", async () => {
    const workflow = createStoryWorkflowState({ storyId: "story-1", workflowId: "workflow-1" });
    workflow.nodes["story-input"] = {
      nodeId: "story-input",
      result: input,
      source: "manual",
      status: "manual",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["storyboard-shots"] = {
      nodeId: "storyboard-shots",
      result: shots,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["resource-plan"] = {
      nodeId: "resource-plan",
      result: normalizeStoryResourcePlan(
        {
          checkpoint: { resource: { id: "checkpoint-local" }, reason: "Local checkpoint." },
          loras: [],
          recommendationReason: "Use real resources.",
          overallEffect: "Neon continuity.",
          warnings: [],
        },
        input,
      ),
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    let requestPayload: unknown;
    const adapters = createStoryLlmNodeAdapters({
      completeChat: async (request) => {
        const content = request.messages[1]?.content;
        requestPayload = typeof content === "string" ? JSON.parse(content) : {};
        return chatResponse(JSON.stringify({
          defaults: {
            width: 1024,
            height: 768,
            steps: 28,
            cfg: 5.5,
            samplerName: "dpmpp_2m",
            scheduler: "karras",
            denoise: 1,
          },
          perShotOverrides: [],
          warnings: [],
        }));
      },
      samplerOptions: {
        samplers: ["uni_pc"],
        schedulers: ["sgm_uniform"],
      },
    });

    const result = await adapters["parameter-plan"]?.({
      nodeId: "parameter-plan",
      workflow,
      dependencies: [workflow.nodes["resource-plan"], workflow.nodes["storyboard-shots"]],
    });
    const parameterPlan = (result as { value: StoryParameterPlan } | undefined)?.value;

    expect(requestPayload).toMatchObject({
      availableSamplers: ["uni_pc"],
      availableSchedulers: ["sgm_uniform"],
    });
    expect(parameterPlan).toMatchObject({
      defaults: {
        samplerName: "uni_pc",
        scheduler: "sgm_uniform",
      },
    });
  });

  it("passes selected resource context and one story-level resolution requirements into parameter planning", async () => {
    const animaInput = {
      ...input,
      settingsSnapshot: {
        resourceCandidates: {
          checkpoints: [
            {
              id: "checkpoint-anima",
              name: "Anima Checkpoint",
              baseModel: "Anima",
              modelBaseModel: "Anima",
              modelFileName: "anima.safetensors",
              usageGuide: "Use 768x1152 for portrait story panels with this checkpoint.",
              exampleImageDimensions: ["768x1152 (4 examples)", "1152x768"],
            },
          ],
          loras: [],
        },
      },
    } satisfies StoryInput;
    const workflow = createStoryWorkflowState({ storyId: "story-1", workflowId: "workflow-1" });
    workflow.nodes["story-input"] = {
      nodeId: "story-input",
      result: animaInput,
      source: "manual",
      status: "manual",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["storyboard-shots"] = {
      nodeId: "storyboard-shots",
      result: shots,
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    workflow.nodes["resource-plan"] = {
      nodeId: "resource-plan",
      result: normalizeStoryResourcePlan(
        {
          checkpoint: { resource: { id: "checkpoint-anima" }, reason: "Local Anima checkpoint." },
          loras: [],
          recommendationReason: "Use real resources.",
          overallEffect: "Anime continuity.",
          warnings: [],
        },
        animaInput,
      ),
      source: "ai",
      status: "done",
      updatedAt: workflow.updatedAt,
    };
    let requestPayload: unknown;
    let requestSystemPrompt = "";
    const adapters = createStoryLlmNodeAdapters({
      completeChat: async (request) => {
        requestSystemPrompt = typeof request.messages[0]?.content === "string" ? request.messages[0].content : "";
        const content = request.messages[1]?.content;
        requestPayload = typeof content === "string" ? JSON.parse(content) : {};
        return chatResponse(JSON.stringify({
          defaults: {},
          perShotOverrides: [],
          warnings: [],
        }));
      },
      samplerOptions: {
        samplers: ["er_sde", "euler", "dpmpp_2m"],
        schedulers: ["simple", "normal", "karras"],
      },
    });

    const result = await adapters["parameter-plan"]?.({
      nodeId: "parameter-plan",
      workflow,
      dependencies: [workflow.nodes["resource-plan"], workflow.nodes["storyboard-shots"]],
    });
    const parameterPlan = (result as { value: StoryParameterPlan } | undefined)?.value;

    expect(requestPayload).toMatchObject({
      modelDefaultParameters: {
        width: 768,
        height: 1152,
        steps: 36,
        cfg: 4.5,
        samplerName: "er_sde",
        scheduler: "simple",
      },
      selectedResourceParameterContext: expect.stringContaining("Checkpoint:"),
      selectedResources: {
        checkpoint: expect.objectContaining({
          id: "checkpoint-anima",
          usageGuide: "Use 768x1152 for portrait story panels with this checkpoint.",
          exampleImageDimensions: ["768x1152 (4 examples)", "1152x768"],
        }),
      },
    });
    expect(requestPayload).toMatchObject({
      selectedResourceParameterContext: expect.stringContaining("Use 768x1152"),
    });
    expect(requestPayload).toMatchObject({
      selectedResourceParameterContext: expect.stringContaining("exampleImageDimensions: 768x1152 (4 examples), 1152x768"),
    });
    expect(requestSystemPrompt).toContain("one story-level generation resolution");
    expect(requestSystemPrompt).toContain("exampleImageDimensions");
    expect(requestSystemPrompt).toContain("stronger evidence than modelDefaultParameters");
    expect(requestSystemPrompt).toContain("put resolution only in defaults and never include width or height in perShotOverrides");
    expect(requestSystemPrompt).toContain("local code will not infer resolution from scene keywords");
    expect(requestSystemPrompt).toContain("Put a brief resolution rationale in warnings");
    expect(parameterPlan?.defaults).toMatchObject({
      width: 768,
      height: 1152,
      steps: 36,
      cfg: 4.5,
      samplerName: "er_sde",
      scheduler: "simple",
    });
  });

  it("normalizes structured render Anima prompt parts from LLM output without truncating tags", () => {
    const longVisibleTag = "very long but still atomic visible tag describing a reflective courier jacket with exact badge stitching and wet fabric folds";
    const plan = normalizeStoryRenderPromptPlan(
      {
        shots: [
          {
            shot_id: "shot-1",
            anima_prompt_parts: {
              subject_tags: ["1boy", "solo", "solo"],
              character_tags: [" courier in reflective jacket ", "", longVisibleTag],
              prop_tags: ["red signal card"],
              negative_additions: ["cropped signal"],
              single_frame_caption: " The courier studies the red signal card in rain. ",
            },
          },
          {
            shot_id: "shot-2",
            anima_prompt_parts: {
              action_tags: ["leans toward reflected signal"],
              camera_tags: ["low close view"],
              single_frame_caption: "The courier leans toward the reflected signal.",
            },
          },
          {
            shotId: "shot-missing",
            animaPromptParts: {
              characterTags: ["unknown subject"],
            },
          },
        ],
        warnings: ["Use naturalized visual anchors."],
      },
      input,
      shots,
    );

    expect(plan).toMatchObject({
      storyId: "story-1",
      warnings: ["Use naturalized visual anchors."],
      shots: [
        {
          shotId: "shot-1",
          animaPromptParts: {
            subjectTags: ["1boy", "solo"],
            characterTags: ["courier in reflective jacket", longVisibleTag],
            propTags: ["red signal card"],
            singleFrameCaption: "The courier studies the red signal card in rain.",
            negativeAdditions: ["cropped signal"],
          },
        },
        {
          shotId: "shot-2",
          animaPromptParts: {
            actionTags: ["leans toward reflected signal"],
            cameraTags: ["low close view"],
            singleFrameCaption: "The courier leans toward the reflected signal.",
          },
        },
      ],
    });
  });

  it("falls back when an LLM returns empty Anima prompt parts for a matched shot", () => {
    const plan = normalizeStoryRenderPromptPlan(
      {
        shots: [
          {
            shotId: "shot-1",
            animaPromptParts: {},
          },
        ],
      },
      input,
      shots,
    );

    expect(plan.shots[0]).toMatchObject({
      shotId: "shot-1",
      animaPromptParts: {
        actionTags: ["neon market arrival"],
        cameraTags: ["wide"],
        singleFrameCaption: "The courier enters the market.",
      },
      warnings: ["LLM returned empty animaPromptParts; used storyboard prompt fallback."],
    });
  });

  it("asks the LLM for structured Anima prompt parts before assembling render plans", async () => {
    const workflow = createStoryWorkflowState({ storyId: "story-1", workflowId: "workflow-render-prompt" });
    const updatedAt = workflow.updatedAt;
    const resourcePlan = normalizeStoryResourcePlan(
      {
        checkpoint: { resource: { id: "checkpoint-local" }, reason: "Local checkpoint." },
        loras: [{ resource: { id: "lora-local" }, reason: "Local LoRA.", suggestedWeight: 0.6 }],
        recommendationReason: "Use real resources.",
        overallEffect: "Neon continuity.",
        warnings: [],
      },
      input,
    );
    let requestSystemPrompt = "";
    let requestPayload: unknown;
    const adapters = createStoryLlmNodeAdapters({
      completeChat: async (request) => {
        requestSystemPrompt = typeof request.messages[0]?.content === "string" ? request.messages[0].content : "";
        const content = request.messages[1]?.content;
        requestPayload = typeof content === "string" ? JSON.parse(content) : {};

        return chatResponse(JSON.stringify({
          shots: [
            {
              shotId: "shot-1",
              animaPromptParts: {
                subjectTags: ["1boy", "solo"],
                characterTags: ["courier in reflective yellow jacket"],
                outfitTags: ["reflective yellow rain jacket"],
                propTags: ["red signal card"],
                actionTags: ["studies the signal reflection"],
                settingTags: ["wet neon market aisle"],
                cameraTags: ["close view"],
                lightingTags: ["rainy neon light"],
                styleTags: ["teal theme"],
                singleFrameCaption: "The courier studies the red signal reflection in a wet neon market aisle.",
                negativeAdditions: ["cropped signal"],
              },
              rationale: "Keep the signal readable.",
            },
            {
              shotId: "shot-2",
              animaPromptParts: {
                subjectTags: ["1boy", "solo"],
                characterTags: ["courier in reflective yellow jacket"],
                actionTags: ["leans toward the reflected signal"],
                settingTags: ["wet neon market puddle"],
                cameraTags: ["low close view"],
                lightingTags: ["red neon reflection"],
                singleFrameCaption: "The courier leans toward the red signal reflected in a puddle.",
              },
            },
          ],
          warnings: ["Structured Anima prompt parts returned."],
        }));
      },
    });

    workflow.nodes["story-input"] = {
      nodeId: "story-input",
      result: input,
      source: "manual",
      status: "manual",
      updatedAt,
    };
    workflow.nodes["story-bible"] = {
      nodeId: "story-bible",
      result: normalizeStoryBible(
        {
          title: "Signal Market",
          logline: "A courier follows a signal.",
          characters: [{ id: "courier", name: "Courier", description: "A courier in a reflective yellow jacket." }],
          locations: [{ id: "market", name: "Market", description: "A wet neon market." }],
        },
        input,
      ),
      source: "ai",
      status: "done",
      updatedAt,
    };
    workflow.nodes["storyboard-shots"] = {
      nodeId: "storyboard-shots",
      result: shots.map((shot) => ({ ...shot, sourceShotIds: [] })),
      source: "ai",
      status: "done",
      updatedAt,
    };
    workflow.nodes["character-continuity-graph"] = {
      nodeId: "character-continuity-graph",
      result: {
        storyId: "story-1",
        characters: [
          {
            characterId: "courier",
            name: "Courier",
            canonicalDescription: "A courier in a reflective yellow jacket.",
            visualAnchors: ["reflective yellow jacket"],
          },
        ],
        appearances: shots.map((shot) => ({
          shotId: shot.id,
          characterId: "courier",
          wardrobe: ["reflective yellow jacket"],
          poseOrAction: shot.id === "shot-1" ? "studies the signal reflection" : "leans toward the signal",
          expression: "focused",
          continuityNotes: ["Keep reflective yellow jacket visible."],
        })),
      },
      source: "ai",
      status: "done",
      updatedAt,
    };
    workflow.nodes["entity-cards"] = {
      nodeId: "entity-cards",
      result: {
        storyId: "story-1",
        characters: [{
          id: "courier",
          name: "Courier",
          role: "Lead",
          description: "A courier in a reflective yellow jacket.",
          continuityNotes: ["Keep reflective yellow jacket visible."],
          outfitIds: ["courier-reflective-yellow-jacket"],
          propIds: [],
          shotIds: ["shot-1", "shot-2"],
          visualAnchors: ["reflective yellow jacket"],
        }],
        outfits: [{
          id: "courier-reflective-yellow-jacket",
          characterId: "courier",
          name: "Reflective yellow jacket",
          description: "Reflective yellow jacket.",
          continuityNotes: ["Keep reflective yellow jacket visible."],
          shotIds: ["shot-1", "shot-2"],
          visualAnchors: ["reflective yellow jacket"],
        }],
        props: [],
        locations: [{
          id: "market",
          name: "Market",
          description: "A wet neon market.",
          shotIds: ["shot-1", "shot-2"],
          viewStates: [],
          visualAnchors: ["wet neon market"],
        }],
        planningErrors: [],
      },
      source: "ai",
      status: "done",
      updatedAt,
    };
    workflow.nodes["shot-dependency-graph"] = {
      nodeId: "shot-dependency-graph",
      result: {
        storyId: "story-1",
        nodes: shots.map((shot) => ({ shotId: shot.id, label: shot.title })),
        edges: [],
      },
      source: "ai",
      status: "done",
      updatedAt,
    };
    workflow.nodes["story-safety-plan"] = {
      nodeId: "story-safety-plan",
      result: {
        storyId: "story-1",
        audienceRating: "safe",
        contentWarnings: [],
        blockedContent: [],
        perShotNotes: [],
        nsfwContext: {
          enabled: false,
          rationale: "Safe story.",
        },
      },
      source: "ai",
      status: "done",
      updatedAt,
    };
    workflow.nodes["resource-plan"] = {
      nodeId: "resource-plan",
      result: resourcePlan,
      source: "ai",
      status: "done",
      updatedAt,
    };
    workflow.nodes["parameter-plan"] = {
      nodeId: "parameter-plan",
      result: createStoryParameterPlan({
        storyId: "story-1",
        defaults: {
          width: 1024,
          height: 768,
          steps: 28,
          cfg: 5.5,
          samplerName: "dpmpp_2m",
          scheduler: "karras",
          denoise: 1,
        },
      }),
      source: "ai",
      status: "done",
      updatedAt,
    };

    const result = await adapters["story-render-plan"]?.({
      nodeId: "story-render-plan",
      workflow,
      dependencies: [
        workflow.nodes["character-continuity-graph"],
        workflow.nodes["entity-cards"],
        workflow.nodes["shot-dependency-graph"],
        workflow.nodes["resource-plan"],
        workflow.nodes["parameter-plan"],
      ],
    });
    const renderResult = result as { source: string; value: StoryRenderPlan } | undefined;
    const renderPlan = renderResult?.value;

    expect(renderResult?.source).toBe("ai");
    expect(requestSystemPrompt).toContain("Do not output a raw final prompt string");
    expect(requestSystemPrompt).toContain("animaPromptParts");
    expect(requestSystemPrompt).toContain("subjectTags");
    expect(requestSystemPrompt).toContain("seriesTags");
    expect(requestSystemPrompt).toContain("artistTags");
    expect(requestSystemPrompt).toContain("Follow Anima tag order semantics");
    expect(requestSystemPrompt).toContain("singleFrameCaption");
    expect(requestSystemPrompt).toContain("Prefer 3-8 tags per category");
    expect(requestSystemPrompt).toContain("Avoid repeating the same visible object");
    expect(requestSystemPrompt).toContain("one complete English sentence");
    expect(requestSystemPrompt).toContain("one frozen tableau");
    expect(requestSystemPrompt).toContain("Action tags must be static visible poses");
    expect(requestSystemPrompt).toContain("Avoid video-like wording such as stepping");
    expect(requestSystemPrompt).toContain("singleFrameCaption must also describe a static held instant");
    expect(requestSystemPrompt).toContain("Background people should be described as visible figures or paused observers");
    expect(requestSystemPrompt).not.toContain("Each section item should usually be 1-6 words");
    expect(requestSystemPrompt).not.toContain("never a full sentence");
    expect(requestSystemPrompt).not.toContain('"sections"');
    expect(requestSystemPrompt).toContain("Do not include story intent");
    expect(requestSystemPrompt).toContain("teal theme");
    expect(requestSystemPrompt).toContain("Do not use original-story character names as prompt tags");
    expect(requestSystemPrompt).toContain("Do not include <lora:...> syntax");
    expect(requestSystemPrompt).toContain("Translate structural ids");
    expect(requestSystemPrompt).toContain("adult/age context");
    expect(requestSystemPrompt).toContain("each visible person must get a distinct clause");
    expect(requestSystemPrompt).toContain("hairstyle, clothing, pose/action, spatial position");
    expect(requestSystemPrompt).toContain("For subjectTags use conservative tags");
    expect(requestSystemPrompt).toContain("prefix each item with @");
    expect(requestSystemPrompt).toContain("must not negate positive key characters, actions, props, clothing, or environments");
    expect(requestSystemPrompt).toContain("sketchbook or visible sketch pages");
    expect(requestPayload).toMatchObject({
      characterContinuityGraph: expect.objectContaining({
        storyId: "story-1",
      }),
      entityCards: expect.objectContaining({
        storyId: "story-1",
      }),
      parameterPlan: expect.objectContaining({
        storyId: "story-1",
      }),
      selectedResourcePromptContext: expect.stringContaining("Checkpoint:"),
    });
    expect(renderPlan?.shots[0]?.animaPromptParts).toMatchObject({
      subjectTags: ["1boy", "solo"],
      characterTags: ["courier in reflective yellow jacket"],
      propTags: ["red signal card"],
      singleFrameCaption: "The courier studies the red signal reflection in a wet neon market aisle.",
      negativeAdditions: ["cropped signal"],
    });
    expect(renderPlan?.shots[0]).not.toHaveProperty("promptSections");
    expect(renderPlan?.shots[0]?.positivePrompt).toContain("courier in reflective yellow jacket");
    expect(renderPlan?.shots[0]?.positivePrompt).toContain("red signal card");
    expect(renderPlan?.shots[0]?.positivePrompt).toContain("The courier studies the red signal reflection");
    expect(renderPlan?.shots[0]?.positivePrompt).not.toContain("cropped signal");
    expect(renderPlan?.shots[0]?.negativePrompt).toContain("cropped signal");
    expect(renderPlan?.shots[0]?.promptRationale).toBe("Keep the signal readable.");
    expect(renderPlan?.warnings).toContain("Structured Anima prompt parts returned.");
  });

  it("normalizes raw parameter plans to supplied sampler and scheduler options", () => {
    const plan = normalizeStoryParameterPlan(
      {
        defaults: {
          width: 1024,
          height: 768,
          steps: 28,
          cfg: 5.5,
          samplerName: "invented_sampler",
          scheduler: "invented_scheduler",
          denoise: 1,
        },
        perShotOverrides: [],
        warnings: [],
      },
      input,
      shots,
      {
        samplers: ["uni_pc"],
        schedulers: ["sgm_uniform"],
      },
    );

    expect(plan.defaults).toMatchObject({
      samplerName: "uni_pc",
      scheduler: "sgm_uniform",
    });
  });

  it("uses inferred fallback dimensions when AI returns the legacy fixed Story size", () => {
    const plan = normalizeStoryParameterPlan(
      {
        defaults: {
          width: 1024,
          height: 768,
          steps: 36,
          cfg: 4.5,
          samplerName: "er_sde",
          scheduler: "simple",
          denoise: 1,
        },
        perShotOverrides: [],
        warnings: [],
      },
      {
        ...input,
        rawIntent: "A vertical full body portrait of a courier.",
      },
      shots,
      {
        samplers: ["er_sde"],
        schedulers: ["simple"],
      },
      {
        width: 832,
        height: 1216,
        steps: 36,
        cfg: 4.5,
        samplerName: "er_sde",
        scheduler: "simple",
        denoise: 1,
      },
    );

    expect(plan.defaults).toMatchObject({
      width: 832,
      height: 1216,
      samplerName: "er_sde",
      scheduler: "simple",
    });
  });

  it("normalizes raw per-shot override numbers before render planning uses toFixed", () => {
    const plan = normalizeStoryParameterPlan(
      {
        defaults: {
          width: 1024,
          height: 768,
          steps: 28,
          cfg: 5.5,
          samplerName: "dpmpp_2m",
          scheduler: "karras",
          denoise: 1,
        },
        perShotOverrides: [
          {
            shotId: "shot-2",
            parameters: {
              cfg: "6",
              denoise: "0.7",
              height: "512",
              steps: "12",
              width: "512",
            },
          },
          {
            shotId: "shot-1",
            parameters: {
              cfg: "bad",
              denoise: "bad",
            },
          },
        ],
        warnings: [],
      },
      input,
      shots,
    );

    expect(plan.perShotOverrides[0]?.parameters).toMatchObject({
      cfg: 6,
      denoise: 0.7,
      steps: 12,
    });
    expect(plan.perShotOverrides[0]?.parameters).not.toHaveProperty("width");
    expect(plan.perShotOverrides[0]?.parameters).not.toHaveProperty("height");
    expect(plan.perShotOverrides[1]?.parameters).toMatchObject({
      cfg: 5.5,
      denoise: 1,
    });
  });

  it("rejects unknown shots and cycles in dependency graph output", () => {
    expect(() =>
      normalizeShotDependencyGraph(
        {
          nodes: [{ shotId: "shot-1" }, { shotId: "shot-2" }],
          edges: [{ fromShotId: "shot-missing", toShotId: "shot-2", reason: "reference" }],
        },
        input,
        shots,
      ),
    ).toThrow(TimelineNodeExecutionError);

    expect(() =>
      normalizeShotDependencyGraph(
        {
          nodes: [{ shotId: "shot-1" }, { shotId: "shot-2" }],
          edges: [
            { fromShotId: "shot-1", toShotId: "shot-2", reason: "continuity" },
            { fromShotId: "shot-2", toShotId: "shot-1", reason: "continuity" },
          ],
        },
        input,
        shots,
      ),
    ).toThrow(TimelineNodeExecutionError);
  });

  it("keeps planning-only dependency graph edges out of render source shots", () => {
    const graph = normalizeShotDependencyGraph(
      {
        nodes: [{ shotId: "shot-1" }, { shotId: "shot-2" }],
        edges: [{ fromShotId: "shot-1", toShotId: "shot-2", reason: "continuity" }],
      },
      input,
      shots.map((shot) => ({ ...shot, sourceShotIds: shot.id === "shot-2" ? [] : shot.sourceShotIds })),
    );
    const synced = syncStoryShotsWithDependencyGraph(shots, graph);

    expect(synced.find((shot) => shot.id === "shot-2")?.sourceShotIds).toEqual([]);
  });

  it("syncs only executable image reference dependency edges into render source shots", () => {
    const graph = normalizeShotDependencyGraph(
      {
        nodes: [{ shotId: "shot-1" }, { shotId: "shot-2" }],
        edges: [{ fromShotId: "shot-1", toShotId: "shot-2", reason: "img2img-source" }],
      },
      input,
      shots.map((shot) => ({ ...shot, sourceShotIds: [] })),
    );
    const synced = syncStoryShotsWithDependencyGraph(shots, graph);

    expect(synced.find((shot) => shot.id === "shot-2")?.sourceShotIds).toEqual(["shot-1"]);
  });

  it("downgrades automatic standing-to-kneeling source edges to planning-only continuity", () => {
    const poseShots = [
      {
        ...shots[0],
        camera: "medium frame",
        description: "The courier is standing upright in the same alley.",
        promptIntent: "courier standing with yellow jacket",
      },
      {
        ...shots[1],
        camera: "medium frame",
        description: "The courier is kneeling on one knee beside the dropped box.",
        promptIntent: "courier kneeling to pick up the bakery box",
        sourceShotIds: [],
      },
    ] satisfies StoryShot[];
    const graph = normalizeShotDependencyGraph(
      {
        nodes: poseShots.map((shot) => ({ shotId: shot.id })),
        edges: [{ fromShotId: "shot-1", toShotId: "shot-2", reason: "img2img-source" }],
      },
      input,
      poseShots,
    );
    const synced = syncStoryShotsWithDependencyGraph(poseShots, graph);

    expect(graph.edges[0]).toMatchObject({
      reason: "continuity",
      sourceImageRisk: {
        level: "high",
        reason: expect.stringContaining("standing to kneeling"),
      },
    });
    expect(synced.find((shot) => shot.id === "shot-2")?.sourceShotIds).toEqual([]);
  });

  it("downgrades automatic close-up to wide camera reset source edges", () => {
    const cameraShots = [
      {
        ...shots[0],
        camera: "tight close-up on the courier face",
        description: "Close-up of the courier checking the signal.",
        promptIntent: "close-up courier expression",
      },
      {
        ...shots[1],
        camera: "wide establishing shot of the whole station plaza",
        description: "Wide shot resets the camera to reveal the whole plaza.",
        promptIntent: "wide establishing plaza reset",
        sourceShotIds: [],
      },
    ] satisfies StoryShot[];
    const graph = normalizeShotDependencyGraph(
      {
        nodes: cameraShots.map((shot) => ({ shotId: shot.id })),
        edges: [{ fromShotId: "shot-1", toShotId: "shot-2", reason: "img2img-source" }],
      },
      input,
      cameraShots,
    );
    const synced = syncStoryShotsWithDependencyGraph(cameraShots, graph);

    expect(graph.edges[0]).toMatchObject({
      reason: "continuity",
      sourceImageRisk: {
        level: "high",
        reason: expect.stringContaining("close-up to wide"),
      },
    });
    expect(synced.find((shot) => shot.id === "shot-2")?.sourceShotIds).toEqual([]);
  });

  it("downgrades automatic scene reset source edges", () => {
    const sceneShots = [
      {
        ...shots[0],
        camera: "medium frame",
        description: "The courier waits inside a neon market.",
        locationId: "market",
        promptIntent: "courier inside neon market",
      },
      {
        ...shots[1],
        camera: "medium frame",
        description: "Large scene reset to a quiet mountain overlook.",
        locationId: "mountain-overlook",
        promptIntent: "new location mountain overlook",
        sourceShotIds: [],
      },
    ] satisfies StoryShot[];
    const graph = normalizeShotDependencyGraph(
      {
        nodes: sceneShots.map((shot) => ({ shotId: shot.id })),
        edges: [{ fromShotId: "shot-1", toShotId: "shot-2", reason: "img2img-source" }],
      },
      input,
      sceneShots,
    );
    const synced = syncStoryShotsWithDependencyGraph(sceneShots, graph);

    expect(graph.edges[0]).toMatchObject({
      reason: "continuity",
      sourceImageRisk: {
        level: "high",
      },
    });
    expect(graph.edges[0]?.sourceImageRisk?.reason).toMatch(/scene changes|scene reset/i);
    expect(synced.find((shot) => shot.id === "shot-2")?.sourceShotIds).toEqual([]);
  });

  it("carries Story input img2img denoise into workflow render plans", () => {
    const workflow = createStoryWorkflowState({ storyId: "story-1", workflowId: "workflow-img2img-denoise" });
    const updatedAt = workflow.updatedAt;
    const checkpoint = input.settingsSnapshot.resourceCandidates.checkpoints[0]!;

    workflow.nodes["story-input"] = {
      nodeId: "story-input",
      result: {
        ...input,
        settingsSnapshot: {
          ...input.settingsSnapshot,
          img2imgDenoise: 0.72,
        },
      },
      source: "manual",
      status: "manual",
      updatedAt,
    };
    workflow.nodes["storyboard-shots"] = {
      nodeId: "storyboard-shots",
      result: shots.map((shot) => ({ ...shot, sourceShotIds: [] })),
      source: "ai",
      status: "done",
      updatedAt,
    };
    workflow.nodes["shot-dependency-graph"] = {
      nodeId: "shot-dependency-graph",
      result: {
        storyId: "story-1",
        nodes: shots.map((shot) => ({ shotId: shot.id, label: shot.title })),
        edges: [{ fromShotId: "shot-1", toShotId: "shot-2", reason: "img2img-source" }],
      },
      source: "ai",
      status: "done",
      updatedAt,
    };
    workflow.nodes["story-safety-plan"] = {
      nodeId: "story-safety-plan",
      result: {
        storyId: "story-1",
        audienceRating: "safe",
        contentWarnings: [],
        blockedContent: [],
        perShotNotes: [],
        nsfwContext: { enabled: false, rationale: "Safe story." },
      },
      source: "ai",
      status: "done",
      updatedAt,
    };
    workflow.nodes["resource-plan"] = {
      nodeId: "resource-plan",
      result: createStoryResourcePlan({
        storyId: "story-1",
        candidates: {
          checkpoints: [{ resource: checkpoint }],
          loras: [],
        },
        recommendation: {
          checkpoint: { resource: checkpoint, reason: "Local checkpoint." },
          loras: [],
          recommendationReason: "Use local checkpoint.",
          overallEffect: "Continuity test.",
          warnings: [],
        },
      }),
      source: "ai",
      status: "done",
      updatedAt,
    };
    workflow.nodes["parameter-plan"] = {
      nodeId: "parameter-plan",
      result: createStoryParameterPlan({
        storyId: "story-1",
        defaults: {
          width: 1024,
          height: 768,
          steps: 28,
          cfg: 5.5,
          samplerName: "dpmpp_2m",
          scheduler: "karras",
          denoise: 1,
        },
      }),
      source: "ai",
      status: "done",
      updatedAt,
    };

    const renderPlan = createStoryRenderPlanFromWorkflow(workflow);

    expect(renderPlan.img2imgDenoise).toBe(0.72);
    expect(renderPlan.shots[1]?.sourceShotIds).toEqual(["shot-1"]);
  });

  it("preserves manual high-risk source edges and exposes gate risk metadata", () => {
    const workflow = createStoryWorkflowState({ storyId: "story-1", workflowId: "workflow-manual-source-risk" });
    const updatedAt = workflow.updatedAt;
    const checkpoint = input.settingsSnapshot.resourceCandidates.checkpoints[0]!;
    const manualShots = [
      {
        ...shots[0],
        camera: "medium frame",
        description: "The courier is standing upright in the market.",
        promptIntent: "courier standing upright",
        sourceShotIds: [],
      },
      {
        ...shots[1],
        camera: "medium frame",
        description: "The courier is kneeling on one knee beside the package.",
        promptIntent: "courier kneeling beside package",
        sourceShotIds: [],
      },
    ] satisfies StoryShot[];

    workflow.nodes["story-input"] = {
      nodeId: "story-input",
      result: input,
      source: "manual",
      status: "manual",
      updatedAt,
    };
    workflow.nodes["storyboard-shots"] = {
      nodeId: "storyboard-shots",
      result: manualShots,
      source: "ai",
      status: "done",
      updatedAt,
    };
    workflow.nodes["shot-dependency-graph"] = {
      nodeId: "shot-dependency-graph",
      result: {
        storyId: "story-1",
        nodes: manualShots.map((shot) => ({ shotId: shot.id, label: shot.title })),
        edges: [{ fromShotId: "shot-1", toShotId: "shot-2", reason: "img2img-source" }],
      },
      source: "manual",
      status: "manual",
      updatedAt,
    };
    workflow.nodes["story-safety-plan"] = {
      nodeId: "story-safety-plan",
      result: {
        storyId: "story-1",
        audienceRating: "safe",
        contentWarnings: [],
        blockedContent: [],
        perShotNotes: [],
        nsfwContext: { enabled: false, rationale: "Safe story." },
      },
      source: "ai",
      status: "done",
      updatedAt,
    };
    workflow.nodes["resource-plan"] = {
      nodeId: "resource-plan",
      result: createStoryResourcePlan({
        storyId: "story-1",
        candidates: {
          checkpoints: [{ resource: checkpoint }],
          loras: [],
        },
        recommendation: {
          checkpoint: { resource: checkpoint, reason: "Local checkpoint." },
          loras: [],
          recommendationReason: "Use local checkpoint.",
          overallEffect: "Manual source risk test.",
          warnings: [],
        },
      }),
      source: "ai",
      status: "done",
      updatedAt,
    };
    workflow.nodes["parameter-plan"] = {
      nodeId: "parameter-plan",
      result: createStoryParameterPlan({
        storyId: "story-1",
        defaults: {
          width: 1024,
          height: 768,
          steps: 28,
          cfg: 5.5,
          samplerName: "dpmpp_2m",
          scheduler: "karras",
          denoise: 1,
        },
      }),
      source: "ai",
      status: "done",
      updatedAt,
    };
    workflow.nodes["story-consistency-check"] = {
      nodeId: "story-consistency-check",
      result: {
        storyId: "story-1",
        passed: true,
        checkedAt: updatedAt,
        issues: [],
        warnings: [],
      },
      source: "system",
      status: "done",
      updatedAt,
    };

    const renderPlan = createStoryRenderPlanFromWorkflow(workflow);
    workflow.nodes["story-render-plan"] = {
      nodeId: "story-render-plan",
      result: renderPlan,
      source: "system",
      status: "done",
      updatedAt,
    };
    const gate = createStoryGenerationGateFromWorkflow(workflow);

    expect(renderPlan.shots[1]?.sourceShotIds).toEqual(["shot-1"]);
    expect(renderPlan.shots[1]?.sourceImageEdges[0]).toMatchObject({
      riskLevel: "high",
      riskReason: expect.stringContaining("standing to kneeling"),
      sourceChain: ["shot-1", "shot-2"],
    });
    expect(renderPlan.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('Shot "shot-2" uses high-risk source image "shot-1"'),
    ]));
    expect(gate.requestPreview[1]?.sourceImageEdges[0]).toMatchObject({
      riskLevel: "high",
      riskReason: expect.stringContaining("standing to kneeling"),
      sourceChain: ["shot-1", "shot-2"],
    });
  });

  it("keeps non-img2img reference dependencies out of render source shots", () => {
    const graph = normalizeShotDependencyGraph(
      {
        nodes: [{ shotId: "shot-1" }, { shotId: "shot-2" }],
        edges: [{ fromShotId: "shot-1", toShotId: "shot-2", reason: "reference" }],
      },
      input,
      shots.map((shot) => ({ ...shot, sourceShotIds: [] })),
    );
    const synced = syncStoryShotsWithDependencyGraph(shots, graph);

    expect(synced.find((shot) => shot.id === "shot-2")?.sourceShotIds).toEqual([]);
  });

  it("fills missing Story shot character and location ids from the bible", () => {
    const bible = normalizeStoryBible(
      {
        title: "Signal Market",
        logline: "A courier follows a signal.",
        characters: [{ id: "courier", name: "Courier", description: "A blue-jacket courier." }],
        locations: [{ id: "market", name: "Market", description: "A neon market." }],
      },
      input,
    );
    const outline = {
      storyId: input.storyId,
      beats: [{ id: "beat-1", title: "Beat", summary: "Summary", order: 1, characterIds: ["courier"] }],
    };
    const normalized = normalizeStoryShots(
      {
        shots: [{
          id: "shot-1",
          order: 1,
          title: "Arrival",
          description: "The courier enters.",
          beatId: "beat-1",
          locationId: "invented-location",
          characterIds: ["invented-character"],
          sourceShotIds: [],
          camera: "wide",
          promptIntent: "blue-jacket courier enters the neon market",
          continuityNotes: [],
        }],
      },
      input,
      bible,
      outline,
    );

    expect(normalized[0]).toMatchObject({
      characterIds: ["courier"],
      locationId: "market",
    });
  });
});
