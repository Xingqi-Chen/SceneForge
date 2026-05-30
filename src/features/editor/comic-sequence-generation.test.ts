import { describe, expect, it } from "vitest";

import { planComicSequenceGeneration } from "./comic-sequence-generation";

const shots = [
  { id: "shot-1" },
  { id: "shot-2" },
  { id: "shot-3" },
];

const results = [
  { promptId: "prompt-1", shotId: "shot-1" },
  { promptId: "prompt-2", shotId: "shot-2" },
  { promptId: "prompt-3", shotId: "shot-3" },
  { promptId: "prompt-orphan" },
];

describe("comic sequence generation planning", () => {
  it("keeps existing sequence behavior by generating from the selected shot onward", () => {
    const plan = planComicSequenceGeneration({
      mode: "sequence",
      results,
      selectedShotId: "shot-2",
      shots,
    });

    expect(plan.selectedShotIndex).toBe(1);
    expect(plan.shotsToGenerate.map((shot) => shot.id)).toEqual(["shot-2", "shot-3"]);
    expect(plan.retainedResults.map((result) => result.promptId)).toEqual(["prompt-1"]);
  });

  it("generates only the selected shot while retaining other shot results", () => {
    const plan = planComicSequenceGeneration({
      mode: "shot",
      results,
      selectedShotId: "shot-2",
      shots,
    });

    expect(plan.selectedShotIndex).toBe(1);
    expect(plan.shotsToGenerate.map((shot) => shot.id)).toEqual(["shot-2"]);
    expect(plan.retainedResults.map((result) => result.promptId)).toEqual(["prompt-1", "prompt-3"]);
  });

  it("falls back to the first shot when there is no selected shot", () => {
    const shotPlan = planComicSequenceGeneration({
      mode: "shot",
      results,
      shots,
    });
    const sequencePlan = planComicSequenceGeneration({
      mode: "sequence",
      results,
      selectedShotId: "missing-shot",
      shots,
    });

    expect(shotPlan.selectedShotIndex).toBe(0);
    expect(shotPlan.shotsToGenerate.map((shot) => shot.id)).toEqual(["shot-1"]);
    expect(shotPlan.retainedResults.map((result) => result.promptId)).toEqual(["prompt-2", "prompt-3"]);
    expect(sequencePlan.selectedShotIndex).toBe(0);
    expect(sequencePlan.shotsToGenerate.map((shot) => shot.id)).toEqual(["shot-1", "shot-2", "shot-3"]);
    expect(sequencePlan.retainedResults).toEqual([]);
  });
});
