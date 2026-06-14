import { describe, expect, it } from "vitest";

import {
  validateLocalResourcePlan,
  type ResourcePlanCandidate,
  type ResourcePlanLocalResource,
} from "./resource-plan";

type TestResource = ResourcePlanLocalResource & {
  baseModel: string | null;
  nsfw?: boolean;
  nsfwLevel?: number;
};

function candidate(resource: TestResource): ResourcePlanCandidate<TestResource> {
  return { resource };
}

function fail(message: string, details?: unknown): never {
  throw new Error(`${message} ${JSON.stringify(details)}`);
}

describe("shared resource plan validation", () => {
  it("selects only resources from validated local candidates", () => {
    const checkpoint = {
      id: "checkpoint-local",
      name: "Local Checkpoint",
      baseModel: "Pony",
      modelFileName: "local.safetensors",
    };
    const lora = {
      id: "lora-local",
      name: "Local LoRA",
      baseModel: "Pony",
      modelFileName: "lora.safetensors",
    };

    const result = validateLocalResourcePlan({
      candidates: {
        checkpoints: [candidate(checkpoint)],
        loras: [candidate(lora)],
      },
      recommendation: {
        checkpoint: {
          resource: {
            id: "checkpoint-invented",
            name: "Local Checkpoint",
            baseModel: "Pony",
            modelFileName: "invented.safetensors",
          },
          reason: "Same local name.",
        },
        loras: [
          {
            resource: {
              id: "lora-invented",
              name: "Local LoRA",
              baseModel: "Pony",
              modelFileName: "invented-lora.safetensors",
            },
            suggestedWeight: 0.7,
            reason: "Same local name.",
          },
        ],
        recommendationReason: "Use local resources.",
        overallEffect: "Neon portrait.",
        warnings: [],
      },
      options: {
        onInvalidSelection: fail,
      },
    });

    expect(result.checkpoint.resource.id).toBe("checkpoint-local");
    expect(result.loras[0]?.resource.id).toBe("lora-local");
    expect(result.warnings).toEqual([
      "Mapped recommended checkpoint Local Checkpoint to local candidate Local Checkpoint.",
      "Mapped recommended LoRA Local LoRA to local candidate Local LoRA.",
    ]);
  });

  it("rejects recommendations that are not in the local candidate set", () => {
    expect(() =>
      validateLocalResourcePlan({
        candidates: {
          checkpoints: [
            candidate({
              id: "checkpoint-local",
              name: "Local Checkpoint",
              baseModel: "Pony",
            }),
          ],
          loras: [],
        },
        recommendation: {
          checkpoint: {
            resource: {
              id: "checkpoint-invented",
              name: "Invented Checkpoint",
              baseModel: "Pony",
            },
            reason: "Unavailable.",
          },
          loras: [],
          recommendationReason: "Unavailable.",
          overallEffect: "Unavailable.",
          warnings: [],
        },
        options: {
          onInvalidSelection: fail,
        },
      }),
    ).toThrow("Recommended checkpoint is not in the local candidate set.");
  });

  it("does not read, depend on, or output model NSFW markers", () => {
    const checkpoint = {
      id: "checkpoint-local",
      name: "Local Checkpoint",
      baseModel: "Pony",
      nsfw: true,
      nsfwLevel: 5,
    };
    const lora = {
      id: "lora-local",
      name: "Local LoRA",
      baseModel: "Pony",
      nsfw: true,
      nsfwLevel: 5,
    };

    const result = validateLocalResourcePlan({
      candidates: {
        checkpoints: [candidate(checkpoint)],
        loras: [candidate(lora)],
      },
      recommendation: {
        checkpoint: {
          resource: {
            ...checkpoint,
            nsfw: false,
            nsfwLevel: 0,
          },
          reason: "Local checkpoint.",
        },
        loras: [
          {
            resource: {
              ...lora,
              nsfw: false,
              nsfwLevel: 0,
            },
            suggestedWeight: 0.8,
            reason: "Local LoRA.",
          },
        ],
        recommendationReason: "Use local resources.",
        overallEffect: "Neon portrait.",
        warnings: [],
      },
      options: {
        areResourcesCompatible: (candidateLora, candidateCheckpoint) =>
          candidateLora.baseModel === candidateCheckpoint.baseModel,
        onInvalidSelection: fail,
      },
    });

    expect(result.checkpoint.resource).toEqual({
      id: "checkpoint-local",
      name: "Local Checkpoint",
      baseModel: "Pony",
    });
    expect(result.loras[0]?.resource).toEqual({
      id: "lora-local",
      name: "Local LoRA",
      baseModel: "Pony",
    });
    expect(JSON.stringify(result)).not.toContain("nsfw");
    expect(JSON.stringify(result)).not.toContain("Nsfw");
  });
});
