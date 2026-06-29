import { describe, expect, it } from "vitest";

import {
  deriveStoryReferenceAssetPlan,
  evaluateStoryReferenceAssetFreezeGate,
} from "./story-reference-assets";
import {
  storyReferenceImportanceValues,
  storyReferenceResolutionStateValues,
  type StoryEntityCards,
  type StoryReferenceAssetPlan,
  type StoryShot,
} from "./story-types";

const shots = [
  {
    id: "shot-1",
    storyId: "story-reference",
    order: 1,
    title: "Market Opening",
    description: "The courier enters the market.",
    characterIds: ["courier"],
    sourceShotIds: [],
    camera: "wide",
    promptIntent: "courier in wet market",
    continuityNotes: [],
    appearanceState: {
      characterStates: [
        {
          characterId: "courier",
          appearance: "blue jacket and satchel",
          continuityNotes: [],
          outfitId: "courier-blue-jacket",
          visible: true,
        },
      ],
      notes: [],
      propIds: ["signal-box"],
    },
    interactionState: {
      characterIds: ["courier"],
      continuityNotes: [],
      description: "Courier holds the signal box.",
      physicalContact: ["signal box in hand"],
      propIds: ["signal-box"],
    },
    locationId: "market",
    locationViewState: {
      camera: "wide",
      locationId: "market",
      viewDescription: "Wet neon market lane.",
      visibleAnchors: ["wet signs"],
    },
  },
  {
    id: "shot-2",
    storyId: "story-reference",
    order: 2,
    title: "Signal Close-up",
    description: "The courier opens the signal box.",
    characterIds: ["courier"],
    sourceShotIds: [],
    camera: "close-up",
    promptIntent: "signal box close-up",
    continuityNotes: [],
    appearanceState: {
      characterStates: [
        {
          characterId: "courier",
          appearance: "blue jacket and satchel",
          continuityNotes: [],
          outfitId: "courier-blue-jacket",
          visible: true,
        },
      ],
      notes: [],
      propIds: ["signal-box"],
    },
    interactionState: {
      characterIds: ["courier"],
      continuityNotes: [],
      description: "Signal box is open.",
      physicalContact: ["signal box in hand"],
      propIds: ["signal-box"],
    },
    locationId: "market",
    locationViewState: {
      camera: "close-up",
      locationId: "market",
      viewDescription: "Market stall signs behind the courier.",
      visibleAnchors: ["wet signs", "red lanterns"],
    },
  },
] satisfies StoryShot[];

const entityCards = {
  storyId: "story-reference",
  characters: [
    {
      id: "courier",
      name: "Courier",
      role: "Lead",
      description: "Focused teenage courier with short black hair.",
      continuityNotes: ["Keep identity stable."],
      outfitIds: ["courier-blue-jacket"],
      propIds: ["signal-box"],
      shotIds: ["shot-1", "shot-2"],
      visualAnchors: ["short black hair", "determined expression"],
    },
  ],
  outfits: [
    {
      id: "courier-blue-jacket",
      characterId: "courier",
      name: "Blue courier jacket",
      description: "Bright blue rain jacket and satchel.",
      continuityNotes: ["Story-critical wardrobe marker."],
      shotIds: ["shot-1", "shot-2"],
      storyCritical: true,
      visualAnchors: ["bright blue jacket", "crossbody satchel"],
    },
  ],
  props: [
    {
      id: "signal-box",
      name: "Signal box",
      description: "Small brass signal box with a red diode.",
      continuityNotes: ["Recurring clue."],
      ownerCharacterIds: ["courier"],
      shotIds: ["shot-1", "shot-2"],
      visualAnchors: ["red diode"],
    },
  ],
  locations: [
    {
      id: "market",
      name: "Neon market",
      description: "Rainy covered market with wet signs.",
      shotIds: ["shot-1", "shot-2"],
      viewStates: [
        {
          shotId: "shot-1",
          camera: "wide",
          viewDescription: "Wet neon market lane.",
          visibleAnchors: ["wet signs"],
        },
      ],
      visualAnchors: ["wet signs", "red lanterns"],
    },
  ],
  planningErrors: [],
} satisfies StoryEntityCards;

function markRequiredAssets(
  plan: StoryReferenceAssetPlan,
  resolutionState: StoryReferenceAssetPlan["assets"][number]["resolutionState"],
): StoryReferenceAssetPlan {
  return {
    ...plan,
    assets: plan.assets.map((asset) =>
      asset.importance === "required"
        ? { ...asset, resolutionState }
        : asset,
    ),
  };
}

describe("story reference assets", () => {
  it("keeps importance and resolution states as separate exact enums", () => {
    expect(storyReferenceImportanceValues).toEqual(["required", "recommended", "optional"]);
    expect(storyReferenceResolutionStateValues).toEqual([
      "missing",
      "generated",
      "uploaded",
      "approved",
      "failed",
      "rejected",
      "prompt-only",
    ]);
  });

  it("derives required main character refs, blocking critical outfit refs, and optional prop/location refs", () => {
    const plan = deriveStoryReferenceAssetPlan({ entityCards, shots });

    expect(plan.assets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        referenceType: "character-face",
        importance: "required",
        resolutionState: "missing",
        sourceEntity: expect.objectContaining({ id: "courier", type: "character" }),
      }),
      expect.objectContaining({
        referenceType: "character-bust",
        importance: "required",
        resolutionState: "missing",
        sourceEntity: expect.objectContaining({ id: "courier", type: "character" }),
      }),
      expect.objectContaining({
        referenceType: "outfit",
        importance: "required",
        sourceEntity: expect.objectContaining({ id: "courier-blue-jacket", type: "outfit" }),
      }),
      expect.objectContaining({
        referenceType: "prop",
        importance: "optional",
        sourceEntity: expect.objectContaining({ id: "signal-box", type: "prop" }),
      }),
      expect.objectContaining({
        referenceType: "location",
        importance: "optional",
        sourceEntity: expect.objectContaining({ id: "market", type: "location" }),
      }),
    ]));
    expect(plan.assets.find((asset) => asset.referenceType === "prop")?.canonicalPrompt).toContain("red diode");
    expect(plan.assets.find((asset) => asset.referenceType === "location")?.sourceShotIds).toEqual(["shot-1", "shot-2"]);
  });

  it("derives reference shot coverage from shot state when entity-card shot ids are incomplete", () => {
    const plan = deriveStoryReferenceAssetPlan({
      shots,
      entityCards: {
        ...entityCards,
        characters: entityCards.characters.map((character) => ({ ...character, shotIds: [] })),
        outfits: entityCards.outfits.map((outfit) => ({ ...outfit, shotIds: [] })),
        props: entityCards.props.map((prop) => ({ ...prop, shotIds: [] })),
        locations: entityCards.locations.map((location) => ({ ...location, shotIds: [] })),
      },
    });

    expect(plan.assets.find((asset) => asset.referenceType === "character-face")?.sourceShotIds).toEqual([
      "shot-1",
      "shot-2",
    ]);
    expect(plan.assets.find((asset) => asset.referenceType === "outfit")?.sourceShotIds).toEqual([
      "shot-1",
      "shot-2",
    ]);
    expect(plan.assets.find((asset) => asset.referenceType === "prop")?.sourceShotIds).toEqual([
      "shot-1",
      "shot-2",
    ]);
    expect(plan.assets.find((asset) => asset.referenceType === "location")?.sourceShotIds).toEqual([
      "shot-1",
      "shot-2",
    ]);
  });

  it("selects the required main-character refs from shot-state visibility before stale entity-card shot counts", () => {
    const plan = deriveStoryReferenceAssetPlan({
      shots,
      entityCards: {
        ...entityCards,
        characters: [
          {
            ...entityCards.characters[0],
            shotIds: [],
          },
          {
            id: "mentor",
            name: "Mentor",
            role: "Supporting",
            description: "A background mentor who should not own the required identity refs.",
            continuityNotes: [],
            outfitIds: [],
            propIds: [],
            shotIds: ["shot-1", "shot-2", "stale-shot"],
            visualAnchors: ["silver hair"],
          },
        ],
      },
    });
    const identityRefs = plan.assets.filter((asset) =>
      asset.referenceType === "character-face" || asset.referenceType === "character-bust",
    );

    expect(identityRefs).toHaveLength(2);
    expect(identityRefs).toEqual([
      expect.objectContaining({
        sourceEntity: expect.objectContaining({ id: "courier" }),
      }),
      expect.objectContaining({
        sourceEntity: expect.objectContaining({ id: "courier" }),
      }),
    ]);
  });

  it("keeps non-critical outfits recommended and optional references nonblocking while unresolved", () => {
    const plan = deriveStoryReferenceAssetPlan({
      entityCards: {
        ...entityCards,
        outfits: entityCards.outfits.map((outfit) => ({ ...outfit, storyCritical: false })),
      },
      shots,
    });
    const unresolvedPlan = {
      ...plan,
      assets: plan.assets.map((asset) =>
        asset.importance === "required"
          ? { ...asset, resolutionState: "approved" as const }
          : { ...asset, resolutionState: "failed" as const },
      ),
    } satisfies StoryReferenceAssetPlan;
    const gate = evaluateStoryReferenceAssetFreezeGate(unresolvedPlan);

    expect(plan.assets.find((asset) => asset.referenceType === "outfit")).toMatchObject({
      importance: "recommended",
      resolutionState: "missing",
    });
    expect(gate).toMatchObject({
      ready: true,
      requiredReferenceCount: 2,
      resolvedRequiredReferenceCount: 2,
      blockingReferences: [],
    });
  });

  it("blocks required missing, generated, uploaded, failed, and rejected references", () => {
    const plan = deriveStoryReferenceAssetPlan({ entityCards, shots });

    for (const state of ["missing", "generated", "uploaded", "failed", "rejected"] as const) {
      const gate = evaluateStoryReferenceAssetFreezeGate(markRequiredAssets(plan, state));

      expect(gate.ready).toBe(false);
      expect(gate.blockingReferences).toEqual(expect.arrayContaining([
        expect.objectContaining({
          entityId: "courier",
          importance: "required",
          resolutionState: state,
          referenceType: "character-face",
          reason: expect.any(String),
        }),
      ]));
    }
  });

  it("does not block approved required references or explicit prompt-only fallback decisions", () => {
    const plan = deriveStoryReferenceAssetPlan({ entityCards, shots });
    const approvedGate = evaluateStoryReferenceAssetFreezeGate(markRequiredAssets(plan, "approved"));
    const promptOnlyGate = evaluateStoryReferenceAssetFreezeGate({
      ...plan,
      assets: plan.assets.map((asset) =>
        asset.importance === "required"
          ? {
              ...asset,
              resolutionState: "prompt-only",
              promptOnlyFallback: {
                decidedAt: "2026-06-29T00:00:00.000Z",
                decidedBy: "user",
                reason: "User accepted prompt-only continuity for this reference.",
              },
            }
          : asset,
      ),
    });

    expect(approvedGate).toMatchObject({
      ready: true,
      requiredReferenceCount: 3,
      resolvedRequiredReferenceCount: 3,
      blockingReferences: [],
    });
    expect(promptOnlyGate).toMatchObject({
      ready: true,
      requiredReferenceCount: 3,
      resolvedRequiredReferenceCount: 3,
      blockingReferences: [],
    });
  });

  it("blocks prompt-only required references when the user decision is missing", () => {
    const plan = deriveStoryReferenceAssetPlan({ entityCards, shots });
    const gate = evaluateStoryReferenceAssetFreezeGate(markRequiredAssets(plan, "prompt-only"));

    expect(gate.ready).toBe(false);
    expect(gate.blockingReferences[0]).toMatchObject({
      resolutionState: "prompt-only",
      reason: "Required reference is prompt-only without an explicit user fallback decision.",
    });
  });
});
